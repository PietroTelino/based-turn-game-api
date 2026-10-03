import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENERGY_GROWTH_PER_TURN, FURY_DAMAGE_PER_TURN, FURY_START_TURN, INITIAL_ENERGY, MAX_ENERGY } from '../constants';
import {
    applyAction,
    calculateBaseDamage,
    calculateDamage,
    createBattle,
    getAvailableActions,
    getFuryBonus,
    getFuryMultiplier,
    getTurnEnergy,
    getUnit,
    surrender,
    upgradeState,
} from '../engine';
import type { BattleEvent, BattleState, SkillDefinition } from '../types';
import { assertRuleError, basicAttackTurn, eventsOfType, makeCharacter } from './helpers';

function skill(id: string, overrides: Partial<SkillDefinition>): SkillDefinition {
    return {
        id,
        name: id,
        description: '',
        energyCost: 0,
        target: 'single-enemy',
        effects: [{ type: 'damage', power: 1 }],
        ...overrides,
    };
}

describe('criação da batalha', () => {
    it('começa no turno 1, com a unidade mais rápida na vez e os dois times com a energia inicial', () => {
        const { state, events } = createBattle({
            teamA: [makeCharacter('a', { speed: 100 })],
            teamB: [makeCharacter('b', { speed: 150 })],
            seed: 1,
        });

        assert.equal(state.turn, 1);
        assert.deepEqual(state.order, ['B1', 'A1']);
        assert.equal(state.activeUnitId, 'B1');
        assert.equal(state.step, 1);
        assert.equal(state.winner, null);
        assert.deepEqual(state.energy, { A: INITIAL_ENERGY, B: INITIAL_ENERGY });
        assert.equal(state.turnEnergy, INITIAL_ENERGY);
        assert.deepEqual(events, [
            { type: 'turn_started', turn: 1, order: ['B1', 'A1'], energy: INITIAL_ENERGY, fury: 0 },
            { type: 'unit_activated', unitId: 'B1', team: 'B' },
        ]);
    });

    it('recusa time vazio', () => {
        assertRuleError(() => createBattle({ teamA: [], teamB: [makeCharacter('b')] }), 'INVALID_SETUP');
    });

    it('o estado sobrevive a uma ida e volta por JSON (é assim que vai para o banco)', () => {
        const { state } = createBattle({ teamA: [makeCharacter('a')], teamB: [makeCharacter('b')], seed: 7 });

        assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
    });
});

describe('ataque e vitória (1 contra 1)', () => {
    it('o ataque básico tira vida conforme a fórmula e não altera o estado recebido', () => {
        const { state } = createBattle({
            teamA: [makeCharacter('a', { atk: 100, speed: 200 })],
            teamB: [makeCharacter('b', { def: 100, maxHp: 1000 })],
            seed: 1,
        });
        const before = structuredClone(state);

        const result = applyAction(state, { unitId: 'A1', skillId: 'a.basic', targetId: 'B1' });

        // 100 de ATK contra 100 de DEF = metade do dano
        assert.equal(getUnit(result.state, 'B1').hp, 950);
        assert.deepEqual(eventsOfType(result.events, 'damage'), [
            { type: 'damage', sourceId: 'A1', targetId: 'B1', amount: 50, absorbed: 0, critical: false, hp: 950 },
        ]);
        assert.deepEqual(state, before, 'applyAction não pode modificar o estado de entrada');
    });

    it('a batalha termina quando um time é derrotado e bloqueia novas ações', () => {
        const { state } = createBattle({
            teamA: [makeCharacter('a', { atk: 5000, speed: 200 })],
            teamB: [makeCharacter('b', { maxHp: 100 })],
            seed: 1,
        });

        const result = applyAction(state, { unitId: 'A1', skillId: 'a.basic', targetId: 'B1' });

        assert.equal(result.state.winner, 'A');
        assert.equal(result.state.activeUnitId, null);
        assert.equal(getUnit(result.state, 'B1').hp, 0);
        assert.deepEqual(
            result.events.map((e) => e.type),
            ['skill_used', 'damage', 'unit_defeated', 'battle_ended'],
        );
        assertRuleError(
            () => applyAction(result.state, { unitId: 'A1', skillId: 'a.basic', targetId: 'B1' }),
            'BATTLE_OVER',
        );
    });

    it('crítico multiplica o dano', () => {
        const { state } = createBattle({
            teamA: [makeCharacter('a', { atk: 100, speed: 200, critChance: 1, critDamage: 2 })],
            teamB: [makeCharacter('b', { def: 100 })],
            seed: 1,
        });

        const { events } = applyAction(state, { unitId: 'A1', skillId: 'a.basic', targetId: 'B1' });
        const [damage] = eventsOfType(events, 'damage');

        assert.equal(damage?.amount, 100);
        assert.equal(damage?.critical, true);
    });
});

describe('desistência', () => {
    function setup() {
        return createBattle({
            teamA: [makeCharacter('a', { speed: 100 })],
            teamB: [makeCharacter('b', { speed: 200 })],
            seed: 1,
        }).state;
    }

    it('encerra a batalha com vitória do outro time, mesmo fora da vez de quem desiste', () => {
        const state = setup();
        const before = structuredClone(state);

        assert.equal(state.activeUnitId, 'B1', 'a vez é do time B');

        const result = surrender(state, 'A');

        assert.equal(result.state.winner, 'B');
        assert.equal(result.state.surrenderedBy, 'A');
        assert.equal(result.state.activeUnitId, null);
        assert.deepEqual(result.events, [
            { type: 'surrendered', team: 'A' },
            { type: 'battle_ended', winner: 'B' },
        ]);
        assert.deepEqual(result.state.units.map((u) => u.hp), [1000, 1000], 'ninguém é derrotado pela desistência');
        assert.deepEqual(state, before, 'surrender não pode modificar o estado de entrada');
    });

    it('não permite desistir nem jogar depois que a batalha acabou', () => {
        const { state } = surrender(setup(), 'B');

        assert.equal(state.winner, 'A');
        assertRuleError(() => surrender(state, 'A'), 'BATTLE_OVER');
        assertRuleError(() => applyAction(state, { unitId: 'B1', skillId: 'b.basic', targetId: 'A1' }), 'BATTLE_OVER');
    });
});

describe('turnos', () => {
    /** Joga `count` vezes com ataque básico e anota, a cada vez, o turno e quem agiu. */
    function play(start: BattleState, count: number) {
        let state = start;
        const log: { turn: number; unitId: string }[] = [];
        const events: BattleEvent[] = [];

        for (let i = 0; i < count && state.winner === null; i++) {
            log.push({ turn: state.turn, unitId: state.activeUnitId ?? '' });

            const result = basicAttackTurn(state);

            state = result.state;
            events.push(...result.events);
        }

        return { state, log, events };
    }

    function fourUnits(seed = 1) {
        return createBattle({
            teamA: [makeCharacter('a1', { speed: 130, maxHp: 1_000_000 }), makeCharacter('a2', { speed: 90, maxHp: 1_000_000 })],
            teamB: [makeCharacter('b1', { speed: 110, maxHp: 1_000_000 }), makeCharacter('b2', { speed: 75, maxHp: 1_000_000 })],
            seed,
        });
    }

    it('o turno só sobe depois que todas as unidades agiram, cada uma uma vez', () => {
        const { state, events } = fourUnits();
        const played = play(state, 12);

        assert.deepEqual(
            played.log.map((entry) => entry.turn),
            [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3],
        );
        assert.equal(played.state.turn, 4);
        assert.equal(played.state.step, 13, 'step conta cada vez: 12 jogadas mais a que está aberta');

        // Um aviso de turno novo por turno, com o número certo.
        assert.deepEqual(
            eventsOfType([...events, ...played.events], 'turn_started').map((event) => event.turn),
            [1, 2, 3, 4],
        );
    });

    it('dentro do turno a ordem é da mais veloz para a mais lenta, e a velocidade não dá vezes a mais', () => {
        const { state } = fourUnits();
        const { log } = play(state, 12);
        const fastestFirst = ['A1', 'B1', 'A2', 'B2'];

        assert.deepEqual(state.order, fastestFirst);
        assert.deepEqual(
            log.map((entry) => entry.unitId),
            [...fastestFirst, ...fastestFirst, ...fastestFirst],
        );
    });

    it('velocidade igual: a sorte decide quem vai antes, e o sorteio é refeito a cada turno', () => {
        const { state } = createBattle({
            teamA: [makeCharacter('a', { speed: 100, maxHp: 1_000_000_000 })],
            teamB: [
                makeCharacter('b', { speed: 100, maxHp: 1_000_000_000 }),
                makeCharacter('c', { speed: 150, maxHp: 1_000_000_000 }),
            ],
            seed: 42,
        });
        const TURNS = 400;
        const { log } = play(state, TURNS * 3);
        const orders: string[] = [];

        for (let turn = 1; turn <= TURNS; turn++) {
            orders.push(
                log
                    .filter((entry) => entry.turn === turn)
                    .map((entry) => entry.unitId)
                    .join(','),
            );
        }

        const aFirst = orders.filter((order) => order === 'B2,A1,B1').length;
        const bFirst = orders.filter((order) => order === 'B2,B1,A1').length;
        const swaps = orders.filter((order, index) => index > 0 && order !== orders[index - 1]).length;

        assert.equal(aFirst + bFirst, TURNS, 'a mais veloz (B2) é sempre a primeira');
        assert.ok(aFirst > TURNS * 0.4 && aFirst < TURNS * 0.6, `A foi antes em ${aFirst} de ${TURNS} turnos`);
        assert.ok(swaps > TURNS * 0.4 && swaps < TURNS * 0.6, `a ordem trocou ${swaps} vezes em ${TURNS} turnos`);
    });

    it('mudança de velocidade no meio do turno já reordena quem ainda não agiu', () => {
        const slow = skill('a.slow', {
            effects: [{ type: 'status', status: 'speed_down', turns: 3, power: 0.5 }],
        });
        const { state } = createBattle({
            teamA: [makeCharacter('a', { speed: 150, maxHp: 1_000_000 }, [slow])],
            teamB: [makeCharacter('b1', { speed: 120, maxHp: 1_000_000 }), makeCharacter('b2', { speed: 100, maxHp: 1_000_000 })],
            seed: 1,
        });

        assert.deepEqual(state.order, ['A1', 'B1', 'B2']);

        // B1 cai de 120 para 60 de velocidade: B2 passa na frente já neste turno.
        const slowed = applyAction(state, { unitId: 'A1', skillId: 'a.slow', targetId: 'B1' });

        assert.equal(slowed.state.turn, 1);
        assert.deepEqual(slowed.state.order, ['A1', 'B2', 'B1']);
        assert.equal(slowed.state.activeUnitId, 'B2');
        assert.deepEqual(eventsOfType(slowed.events, 'order_changed'), [{ type: 'order_changed', order: ['A1', 'B2', 'B1'] }]);

        // Cada uma ainda age uma vez só neste turno, na ordem nova.
        const { log, state: nextTurn } = play(slowed.state, 2);

        assert.deepEqual(log, [
            { turn: 1, unitId: 'B2' },
            { turn: 1, unitId: 'B1' },
        ]);
        assert.equal(nextTurn.turn, 2);
        assert.deepEqual(nextTurn.order, ['A1', 'B2', 'B1']);
    });

    it('quem já agiu não muda de lugar nem age de novo, por mais rápido que fique', () => {
        const haste = skill('a2.haste', {
            target: 'all-allies',
            effects: [{ type: 'status', status: 'speed_up', turns: 2, power: 2 }],
        });
        const { state } = createBattle({
            teamA: [
                makeCharacter('a1', { speed: 150, maxHp: 1_000_000 }),
                makeCharacter('a2', { speed: 110, maxHp: 1_000_000 }, [haste]),
                makeCharacter('a3', { speed: 50, maxHp: 1_000_000 }),
            ],
            teamB: [makeCharacter('b1', { speed: 130, maxHp: 1_000_000 }), makeCharacter('b2', { speed: 90, maxHp: 1_000_000 })],
            seed: 1,
        });

        assert.deepEqual(state.order, ['A1', 'B1', 'A2', 'B2', 'A3']);

        // A1 e B1 agem; A2 triplica a velocidade do time dela.
        const beforeHaste = play(state, 2).state;
        const hasted = applyAction(beforeHaste, { unitId: 'A2', skillId: 'a2.haste' });

        // A3 (50 -> 150) passa na frente de B2 (90). A1 já agiu: fica onde estava.
        assert.deepEqual(hasted.state.order, ['A1', 'B1', 'A2', 'A3', 'B2']);
        assert.equal(hasted.state.activeUnitId, 'A3');

        const { log, state: nextTurn } = play(hasted.state, 2);

        assert.deepEqual(log.map((entry) => entry.unitId), ['A3', 'B2']);
        assert.equal(nextTurn.turn, 2);
    });

    it('sem mudança de velocidade a ordem fica igual e nenhum aviso é emitido', () => {
        const { state } = fourUnits();
        const { events } = play(state, 12);

        assert.deepEqual(eventsOfType(events, 'order_changed'), []);
    });

    it('empate que aparece no meio do turno também é decidido na sorte', () => {
        const slow = skill('a.slow', {
            effects: [{ type: 'status', status: 'speed_down', turns: 3, power: 0.5 }],
        });
        const SEEDS = 300;
        let slowedFirst = 0;

        for (let seed = 1; seed <= SEEDS; seed++) {
            const { state } = createBattle({
                teamA: [makeCharacter('a', { speed: 300 }, [slow])],
                teamB: [makeCharacter('b1', { speed: 200 }), makeCharacter('b2', { speed: 100 })],
                seed,
            });

            // B1 cai de 200 para 100 e empata com B2.
            const { state: slowed } = applyAction(state, { unitId: 'A1', skillId: 'a.slow', targetId: 'B1' });

            if (slowed.activeUnitId === 'B1') slowedFirst += 1;
        }

        assert.ok(slowedFirst > SEEDS * 0.4 && slowedFirst < SEEDS * 0.6, `B1 continuou na frente em ${slowedFirst} de ${SEEDS}`);
    });

    it('unidade derrotada antes da própria vez não age, e o turno segue', () => {
        const { state } = createBattle({
            teamA: [makeCharacter('a', { speed: 100, atk: 5000, maxHp: 1_000_000 })],
            teamB: [makeCharacter('b1', { speed: 50, maxHp: 1_000_000 }), makeCharacter('b2', { speed: 90, maxHp: 10 })],
            seed: 1,
        });

        assert.deepEqual(state.order, ['A1', 'B2', 'B1']);

        const afterKill = applyAction(state, { unitId: 'A1', skillId: 'a.basic', targetId: 'B2' }).state;

        assert.equal(getUnit(afterKill, 'B2').hp, 0);
        assert.equal(afterKill.activeUnitId, 'B1', 'a vez pula B2 e vai para B1');
        assert.equal(afterKill.turn, 1);

        const { state: later, log } = play(afterKill, 9);

        assert.ok(log.every((entry) => entry.unitId !== 'B2'));
        assert.deepEqual(later.order, ['A1', 'B1'], 'a ordem dos turnos seguintes só tem as vivas');
    });
});

describe('batalha gravada no formato antigo', () => {
    /** Como era um estado antes dos turnos por rodada: barra de ação, sem `order` nem `step`. */
    function legacyState(): BattleState {
        const { state } = createBattle({
            teamA: [makeCharacter('a1', { speed: 100 }), makeCharacter('a2', { speed: 120 })],
            teamB: [makeCharacter('b1', { speed: 110 }), makeCharacter('b2', { speed: 90 })],
            seed: 1,
        });
        const legacy = JSON.parse(JSON.stringify(state)) as Record<string, unknown> & { units: Record<string, unknown>[] };

        delete legacy.order;
        delete legacy.step;
        legacy.turn = 9; // no formato antigo, o turno contava cada vez
        legacy.activeUnitId = 'B2';

        for (const unit of legacy.units) {
            unit.actionGauge = 500;
        }

        legacy.units[0]!.statuses = [{ kind: 'burn', turns: 2, value: 10, sourceId: 'B1', appliedOnTurn: 8 }];

        return legacy as unknown as BattleState;
    }

    it('é convertida: quem está na vez abre a ordem e o turno vira o contador de vezes', () => {
        const legacy = legacyState();
        const before = structuredClone(legacy);
        const state = upgradeState(legacy);

        assert.deepEqual(state.order, ['B2', 'A2', 'B1', 'A1']);
        assert.equal(state.step, 9);
        assert.equal(state.turn, 3, '9 vezes com 4 unidades: terceiro turno');
        assert.deepEqual(getUnit(state, 'A1').statuses, [{ kind: 'burn', turns: 2, value: 10, sourceId: 'B1', appliedOnStep: 8 }]);
        assert.ok(state.units.every((unit) => !('actionGauge' in unit)));
        assert.deepEqual(legacy, before, 'upgradeState não pode modificar o estado recebido');
    });

    it('continua jogável até o fim depois de convertida', () => {
        let state = upgradeState(legacyState());

        for (let i = 0; state.winner === null; i++) {
            assert.ok(i < 500);
            state = basicAttackTurn(state).state;
        }

        assert.ok(state.winner);
    });

    it('batalha gravada sem o sorteio do turno ganha um, pela posição que cada unidade já tinha', () => {
        const { state } = createBattle({
            teamA: [makeCharacter('a', { speed: 100 })],
            teamB: [makeCharacter('b', { speed: 150 })],
            seed: 1,
        });
        const saved = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;

        delete saved.draws;

        const upgraded = upgradeState(saved as unknown as BattleState);

        assert.deepEqual(upgraded.draws, { B1: 0, A1: 0.5 });
        assert.deepEqual(upgraded.order, state.order);

        // E segue jogável: a reordenação usa o sorteio reconstruído.
        assert.ok(basicAttackTurn(upgraded).state.activeUnitId);
    });

    it('um estado no formato atual passa sem alteração', () => {
        const { state } = createBattle({ teamA: [makeCharacter('a')], teamB: [makeCharacter('b')], seed: 1 });

        assert.equal(upgradeState(state), state);
    });
});

describe('energia', () => {
    const big = skill('a1.big', { energyCost: 3, effects: [{ type: 'damage', power: 2 }] });

    it('a habilidade gasta a energia do time e é recusada quando falta', () => {
        const { state } = createBattle({
            teamA: [makeCharacter('a1', { speed: 200 }, [big]), makeCharacter('a2', { speed: 150 }, [skill('a2.big', { energyCost: 3 })])],
            teamB: [makeCharacter('b', { maxHp: 1_000_000 })],
            seed: 1,
        });

        assert.equal(state.energy.A, 3);

        const result = applyAction(state, { unitId: 'A1', skillId: 'a1.big', targetId: 'B1' });
        const [used] = eventsOfType(result.events, 'skill_used');

        assert.equal(used?.energy, 0);
        assert.equal(result.state.energy.A, 0);

        // A energia é do time: a segunda unidade de A, no mesmo turno, já não paga.
        assert.equal(result.state.activeUnitId, 'A2');
        assertRuleError(
            () => applyAction(result.state, { unitId: 'A2', skillId: 'a2.big', targetId: 'B1' }),
            'NOT_ENOUGH_ENERGY',
        );
    });

    it('a cada turno a energia é reabastecida com 1 a mais, sem acumular o que sobrou', () => {
        let { state } = createBattle({
            teamA: [makeCharacter('a', { speed: 200, maxHp: 1_000_000 }, [skill('a.two', { energyCost: 2 })])],
            teamB: [makeCharacter('b', { maxHp: 1_000_000 })],
            seed: 1,
        });

        // Turno 1: 3 de energia. A gasta 2 e sobra 1; B não gasta nada.
        state = applyAction(state, { unitId: 'A1', skillId: 'a.two', targetId: 'B1' }).state;
        assert.deepEqual(state.energy, { A: 1, B: 3 });

        // Turno 2: os dois recomeçam com 4. A sobra de A (1) e a de B (3) não somam.
        const turnTwo = basicAttackTurn(state);
        const [started] = eventsOfType(turnTwo.events, 'turn_started');

        assert.equal(turnTwo.state.turn, 2);
        assert.deepEqual(turnTwo.state.energy, { A: 4, B: 4 });
        assert.equal(turnTwo.state.turnEnergy, 4);
        assert.equal(started?.energy, 4);
    });

    it('a energia do turno cresce até o máximo e para de crescer', () => {
        assert.deepEqual(
            [1, 2, 3, 7, 8, 9, 30].map(getTurnEnergy),
            [3, 4, 5, 9, 10, 10, 10],
        );
        assert.equal(getTurnEnergy(1), INITIAL_ENERGY);
        assert.equal(getTurnEnergy(2), INITIAL_ENERGY + ENERGY_GROWTH_PER_TURN);
        assert.equal(getTurnEnergy(1000), MAX_ENERGY);

        let { state } = createBattle({
            teamA: [makeCharacter('a', { maxHp: 1_000_000_000 })],
            teamB: [makeCharacter('b', { maxHp: 1_000_000_000 })],
            seed: 1,
        });
        const seen: number[] = [];

        // 12 turnos de ataques básicos (que não gastam energia).
        for (let i = 0; i < 24; i++) {
            if (seen.length < state.turn) seen.push(state.energy.A);
            assert.deepEqual(state.energy, { A: state.turnEnergy, B: state.turnEnergy });
            state = basicAttackTurn(state).state;
        }

        assert.deepEqual(seen, [3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10, 10]);
    });

    it('getAvailableActions marca como indisponível o que a energia não paga', () => {
        const expensive = skill('a.expensive', { energyCost: MAX_ENERGY });
        const { state } = createBattle({
            teamA: [makeCharacter('a', { speed: 200 }, [expensive])],
            teamB: [makeCharacter('b')],
            seed: 1,
        });

        const actions = getAvailableActions(state);

        assert.deepEqual(
            actions.map((a) => [a.skill.id, a.usable, a.requiresTarget, a.targetIds]),
            [
                ['a.basic', true, true, ['B1']],
                ['a.expensive', false, true, ['B1']],
            ],
        );
    });
});

describe('alvos', () => {
    const aoe = skill('a1.aoe', { target: 'all-enemies' });
    const heal = skill('a1.heal', { target: 'single-ally', effects: [{ type: 'heal', power: 5 }] });
    const selfHeal = skill('a1.self', { target: 'self', effects: [{ type: 'heal', power: 0.5 }] });

    function setup() {
        return createBattle({
            teamA: [makeCharacter('a1', { speed: 200 }, [aoe, heal, selfHeal]), makeCharacter('a2')],
            teamB: [makeCharacter('b1'), makeCharacter('b2'), makeCharacter('b3')],
            seed: 1,
        }).state;
    }

    it('recusa ações inválidas', () => {
        const state = setup();

        assertRuleError(() => applyAction(state, { unitId: 'B1', skillId: 'b1.basic', targetId: 'A1' }), 'NOT_YOUR_TURN');
        assertRuleError(() => applyAction(state, { unitId: 'X9', skillId: 'a1.basic', targetId: 'B1' }), 'UNIT_NOT_FOUND');
        assertRuleError(() => applyAction(state, { unitId: 'A1', skillId: 'a2.basic', targetId: 'B1' }), 'SKILL_NOT_FOUND');
        assertRuleError(() => applyAction(state, { unitId: 'A1', skillId: 'a1.basic' }), 'TARGET_REQUIRED');
        assertRuleError(() => applyAction(state, { unitId: 'A1', skillId: 'a1.basic', targetId: 'A2' }), 'INVALID_TARGET');
        assertRuleError(() => applyAction(state, { unitId: 'A1', skillId: 'a1.heal', targetId: 'B1' }), 'INVALID_TARGET');
    });

    it('não permite mirar em quem já foi derrotado', () => {
        const state = setup();
        getUnit(state, 'B2').hp = 0;

        assertRuleError(() => applyAction(state, { unitId: 'A1', skillId: 'a1.basic', targetId: 'B2' }), 'INVALID_TARGET');
    });

    it('habilidade em área atinge todos os inimigos vivos, sem precisar de alvo', () => {
        const state = setup();
        getUnit(state, 'B2').hp = 0;

        const { events } = applyAction(state, { unitId: 'A1', skillId: 'a1.aoe' });

        assert.deepEqual(
            eventsOfType(events, 'damage').map((e) => e.targetId),
            ['B1', 'B3'],
        );
    });

    it('a cura não passa da vida máxima', () => {
        const state = setup();
        getUnit(state, 'A2').hp = 990;

        const result = applyAction(state, { unitId: 'A1', skillId: 'a1.heal', targetId: 'A2' });

        assert.deepEqual(eventsOfType(result.events, 'heal'), [
            { type: 'heal', sourceId: 'A1', targetId: 'A2', amount: 10, hp: 1000 },
        ]);
        assert.equal(getUnit(result.state, 'A2').hp, 1000);
    });

    it('habilidade em si mesmo não precisa de alvo', () => {
        const state = setup();
        getUnit(state, 'A1').hp = 500;

        const result = applyAction(state, { unitId: 'A1', skillId: 'a1.self' });

        // 100 de ATK x 0.5 de poder = 50 de cura
        assert.equal(getUnit(result.state, 'A1').hp, 550);
    });
});

describe('números mostrados na descrição da habilidade', () => {
    const fireball = skill('a1.fireball', { effects: [{ type: 'damage', power: 1.5 }, { type: 'status', status: 'burn', turns: 2, power: 0.3 }] });
    const heal = skill('a1.heal', { target: 'single-ally', effects: [{ type: 'heal', power: 1.8 }] });
    const bless = skill('a1.bless', { target: 'all-allies', effects: [{ type: 'status', status: 'atk_up', turns: 2, power: 0.5 }] });

    function setup() {
        return createBattle({
            teamA: [makeCharacter('a1', { atk: 200, speed: 200 }, [fireball, heal, bless]), makeCharacter('a2')],
            teamB: [makeCharacter('b', { def: 300 })],
            seed: 1,
        }).state;
    }

    const previews = (state: BattleState) => getAvailableActions(state).map((a) => [a.skill.id, a.preview.damage, a.preview.heal]);

    it('dano base é ATK x poder, sem a defesa do alvo; cura base é ATK x poder', () => {
        assert.deepEqual(previews(setup()), [
            ['a1.basic', 200, null],
            ['a1.fireball', 300, null],
            ['a1.heal', null, 360],
            ['a1.bless', null, null],
        ]);
    });

    it('acompanha o ataque atual de quem usa: bônus e penalidades entram na conta', () => {
        const state = setup();

        getUnit(state, 'A1').statuses = [{ kind: 'atk_up', turns: 2, value: 0.5, sourceId: 'A1', appliedOnStep: 0 }];

        assert.deepEqual(previews(state).slice(0, 3), [
            ['a1.basic', 300, null],
            ['a1.fireball', 450, null],
            ['a1.heal', null, 540],
        ]);
    });

    it('a fúria aumenta o dano mostrado, mas não a cura', () => {
        const state = setup();

        state.turn = FURY_START_TURN + 2;

        const fury = getFuryMultiplier(state.turn);

        assert.deepEqual(previews(state).slice(1, 3), [
            ['a1.fireball', Math.round(300 * fury), null],
            ['a1.heal', null, 360],
        ]);
    });

    it('o dano que o alvo leva é o dano base reduzido pela defesa dele', () => {
        const state = setup();
        const base = getAvailableActions(state).find((a) => a.skill.id === 'a1.fireball')?.preview.damage;
        const { events } = applyAction(state, { unitId: 'A1', skillId: 'a1.fireball', targetId: 'B1' });
        const [damage] = eventsOfType(events, 'damage');

        // 300 de DEF: o alvo leva um quarto do dano base.
        assert.equal(base, calculateBaseDamage(getUnit(state, 'A1').stats, 1.5));
        assert.equal(damage?.amount, 75);
        assert.equal(base, 300);
    });
});

describe('roubo de vida e golpes múltiplos', () => {
    const bite = skill('a.bite', { effects: [{ type: 'damage', power: 1, drain: 0.5 }] });
    const flurry = skill('a.flurry', { effects: [{ type: 'damage', power: 0.5 }, { type: 'damage', power: 0.5 }, { type: 'damage', power: 0.5 }] });

    function setup() {
        // 200 de ATK contra 100 de DEF: o golpe de poder 1 tira 100.
        const state = createBattle({
            teamA: [makeCharacter('a', { atk: 200, speed: 200 }, [bite, flurry])],
            teamB: [makeCharacter('b', { def: 100 })],
            seed: 1,
        }).state;

        getUnit(state, 'A1').hp = 500;

        return state;
    }

    it('quem usa recupera a fração do dano que o alvo perdeu', () => {
        const { state, events } = applyAction(setup(), { unitId: 'A1', skillId: 'a.bite', targetId: 'B1' });

        assert.equal(getUnit(state, 'B1').hp, 900);
        assert.equal(getUnit(state, 'A1').hp, 550);
        assert.deepEqual(eventsOfType(events, 'heal'), [{ type: 'heal', sourceId: 'A1', targetId: 'A1', amount: 50, hp: 550 }]);
    });

    it('não passa da vida máxima, e o que o escudo segurou não conta', () => {
        const full = setup();

        getUnit(full, 'A1').hp = 980;
        assert.equal(getUnit(applyAction(full, { unitId: 'A1', skillId: 'a.bite', targetId: 'B1' }).state, 'A1').hp, 1000);

        const shielded = setup();

        getUnit(shielded, 'B1').statuses = [{ kind: 'shield', turns: 2, value: 60, sourceId: 'B1', appliedOnStep: 0 }];

        const result = applyAction(shielded, { unitId: 'A1', skillId: 'a.bite', targetId: 'B1' });

        // Dos 100 de dano, o escudo segurou 60: o alvo perdeu 40 e quem bateu recupera 20.
        assert.equal(getUnit(result.state, 'B1').hp, 960);
        assert.equal(getUnit(result.state, 'A1').hp, 520);
    });

    it('habilidade com vários golpes acerta o mesmo alvo várias vezes, e a descrição mostra a soma', () => {
        const state = setup();
        const preview = getAvailableActions(state).find((a) => a.skill.id === 'a.flurry')?.preview;
        const { state: after, events } = applyAction(state, { unitId: 'A1', skillId: 'a.flurry', targetId: 'B1' });

        assert.equal(preview?.damage, 300);
        assert.deepEqual(eventsOfType(events, 'damage').map((e) => [e.targetId, e.amount]), [['B1', 50], ['B1', 50], ['B1', 50]]);
        assert.equal(getUnit(after, 'B1').hp, 850);
    });

    it('os golpes param quando o alvo cai', () => {
        const state = setup();

        getUnit(state, 'B1').hp = 60;

        const { state: after, events } = applyAction(state, { unitId: 'A1', skillId: 'a.flurry', targetId: 'B1' });

        assert.equal(eventsOfType(events, 'damage').length, 2);
        assert.equal(after.winner, 'A');
    });
});

describe('acaso controlado', () => {
    function playTwentyTurns(seed: number) {
        let { state } = createBattle({
            teamA: [makeCharacter('a', { critChance: 0.5, maxHp: 1_000_000 })],
            teamB: [makeCharacter('b', { critChance: 0.5, maxHp: 1_000_000 })],
            seed,
        });

        for (let i = 0; i < 20; i++) {
            state = basicAttackTurn(state).state;
        }

        return state;
    }

    it('mesma semente e mesmas ações dão exatamente a mesma batalha', () => {
        assert.deepEqual(playTwentyTurns(123), playTwentyTurns(123));
    });

    it('sementes diferentes dão batalhas diferentes', () => {
        assert.notDeepEqual(playTwentyTurns(1).units, playTwentyTurns(2).units);
    });
});

describe('fúria', () => {
    it('só começa depois do turno limite e cresce a cada turno', () => {
        assert.equal(getFuryMultiplier(1), 1);
        assert.equal(getFuryMultiplier(FURY_START_TURN), 1);
        assert.ok(Math.abs(getFuryMultiplier(FURY_START_TURN + 10) - (1 + 10 * FURY_DAMAGE_PER_TURN)) < 1e-9);
    });

    it('aumenta o dano causado na batalha', () => {
        const { state } = createBattle({
            teamA: [makeCharacter('a', { atk: 100, speed: 200 })],
            teamB: [makeCharacter('b', { def: 100, maxHp: 1_000_000 })],
            seed: 1,
        });
        const stats = getUnit(state, 'A1').stats;
        const targetStats = getUnit(state, 'B1').stats;

        state.turn = FURY_START_TURN + 10;

        const { events } = applyAction(state, { unitId: 'A1', skillId: 'a.basic', targetId: 'B1' });
        const [damage] = eventsOfType(events, 'damage');
        const expected = calculateDamage(stats, targetStats, 1, false, getFuryMultiplier(state.turn));

        assert.equal(damage?.amount, expected);
        assert.ok(expected > calculateDamage(stats, targetStats, 1, false));
    });

    it('o aviso de turno novo diz quanto o dano está aumentado, para a tela mostrar', () => {
        let { state, events } = createBattle({
            teamA: [makeCharacter('a', { maxHp: 1_000_000 })],
            teamB: [makeCharacter('b', { maxHp: 1_000_000 })],
            seed: 1,
        });
        const turns = [...eventsOfType(events, 'turn_started')];

        while (state.turn < FURY_START_TURN + 2) {
            ({ state, events } = basicAttackTurn(state));
            turns.push(...eventsOfType(events, 'turn_started'));
        }

        const furyOf = (turn: number) => turns.find((event) => event.turn === turn)?.fury;

        assert.equal(furyOf(1), 0);
        assert.equal(furyOf(FURY_START_TURN), 0, 'no último turno normal ainda não há fúria');
        assert.equal(furyOf(FURY_START_TURN + 1), FURY_DAMAGE_PER_TURN);
        assert.equal(furyOf(FURY_START_TURN + 2), 2 * FURY_DAMAGE_PER_TURN);
        assert.equal(getFuryBonus(FURY_START_TURN + 2), getFuryMultiplier(FURY_START_TURN + 2) - 1);
    });
});
