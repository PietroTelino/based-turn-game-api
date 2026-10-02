import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chooseAction } from '../ai';
import { MIN_STAT_FACTOR } from '../constants';
import { CHARACTERS } from '../data/characters';
import { applyAction, createBattle, getEffectiveStats, getUnit } from '../engine';
import type { BattleState, SkillDefinition, SkillEffect, StatusEffect, StatusKind } from '../types';
import { basicAttackTurn, eventsOfType, makeCharacter } from './helpers';

function statusSkill(id: string, effects: SkillEffect[], target: SkillDefinition['target'] = 'single-enemy'): SkillDefinition {
    return { id, name: id, description: '', energyCost: 0, target, effects };
}

function status(kind: StatusKind, overrides: Partial<StatusEffect> = {}): StatusEffect {
    return { kind, turns: 2, value: 0, sourceId: 'A1', appliedOnTurn: 0, ...overrides };
}

/** Joga ataques básicos até a unidade informada estar na vez. Devolve o estado e os eventos do caminho. */
function playUntilTurnOf(start: BattleState, unitId: string) {
    let state = start;
    const events = [];

    for (let i = 0; state.activeUnitId !== unitId; i++) {
        assert.ok(i < 50, `a vez de ${unitId} nunca chegou`);

        const result = basicAttackTurn(state);

        state = result.state;
        events.push(...result.events);
    }

    return { state, events };
}

describe('status: dano por turno', () => {
    const burn = statusSkill('a.burn', [{ type: 'status', status: 'burn', turns: 2, power: 0.5 }]);

    function setup() {
        return createBattle({
            teamA: [makeCharacter('a', { speed: 200, atk: 100, maxHp: 1_000_000 }, [burn])],
            teamB: [makeCharacter('b', { speed: 100, def: 900, maxHp: 1_000_000 })],
            seed: 1,
        }).state;
    }

    it('aplica o status e avisa a tela com a lista completa', () => {
        const { state, events } = applyAction(setup(), { unitId: 'A1', skillId: 'a.burn', targetId: 'B1' });
        const expected = { kind: 'burn', turns: 2, value: 50, sourceId: 'A1', appliedOnTurn: 1 };

        assert.deepEqual(getUnit(state, 'B1').statuses, [expected]);
        assert.deepEqual(eventsOfType(events, 'status_applied'), [
            { type: 'status_applied', sourceId: 'A1', targetId: 'B1', status: 'burn', turns: 2, value: 50 },
        ]);
        assert.deepEqual(eventsOfType(events, 'statuses_changed'), [
            { type: 'statuses_changed', unitId: 'B1', statuses: [expected] },
        ]);
    });

    it('causa dano no começo de cada turno do alvo, ignora a defesa e acaba depois da duração', () => {
        let state = applyAction(setup(), { unitId: 'A1', skillId: 'a.burn', targetId: 'B1' }).state;
        const events = [];

        // Tempo suficiente para B jogar bem mais que 2 vezes.
        for (let i = 0; i < 12; i++) {
            const result = basicAttackTurn(state);

            state = result.state;
            events.push(...result.events);
        }

        const ticks = eventsOfType(events, 'status_damage');

        assert.deepEqual(
            ticks.map((e) => [e.targetId, e.status, e.amount]),
            [
                ['B1', 'burn', 50],
                ['B1', 'burn', 50],
            ],
        );
        assert.deepEqual(eventsOfType(events, 'status_expired'), [{ type: 'status_expired', unitId: 'B1', status: 'burn' }]);
        assert.deepEqual(getUnit(state, 'B1').statuses, []);
    });

    it('pode derrotar a unidade e encerrar a batalha', () => {
        const state = setup();

        getUnit(state, 'B1').hp = 10;
        getUnit(state, 'B1').stats.def = 1_000_000; // o ataque básico de A tira só 1
        getUnit(state, 'B1').statuses = [status('burn', { value: 500 })];

        const { state: final, events } = playUntilWinner(state);

        assert.equal(final.winner, 'A');
        assert.equal(getUnit(final, 'B1').hp, 0);
        assert.deepEqual(getUnit(final, 'B1').statuses, [], 'quem caiu não carrega status');
        assert.ok(eventsOfType(events, 'status_damage').some((e) => e.hp === 0));
        assert.equal(events[events.length - 1]?.type, 'battle_ended');
    });

    function playUntilWinner(start: BattleState) {
        let state = start;
        const events = [];

        for (let i = 0; state.winner === null; i++) {
            assert.ok(i < 50);

            const result = basicAttackTurn(state);

            state = result.state;
            events.push(...result.events);
        }

        return { state, events };
    }
});

describe('status: atordoamento', () => {
    const stun = statusSkill('a.stun', [{ type: 'status', status: 'stun', turns: 1, power: 0 }]);

    it('o alvo perde a próxima vez e depois volta a jogar', () => {
        const start = createBattle({
            teamA: [makeCharacter('a', { speed: 200, maxHp: 1_000_000 }, [stun])],
            teamB: [makeCharacter('b', { speed: 100, maxHp: 1_000_000 })],
            seed: 1,
        }).state;

        let state = applyAction(start, { unitId: 'A1', skillId: 'a.stun', targetId: 'B1' }).state;
        const events = [];
        const actors: string[] = [];

        for (let i = 0; i < 6; i++) {
            actors.push(state.activeUnitId ?? '');

            const result = basicAttackTurn(state);

            state = result.state;
            events.push(...result.events);
        }

        // Sem o atordoamento a ordem seria A, B, A, A, B, A.
        assert.deepEqual(actors, ['A1', 'A1', 'A1', 'B1', 'A1', 'A1']);
        assert.deepEqual(eventsOfType(events, 'turn_skipped'), [{ type: 'turn_skipped', unitId: 'B1', status: 'stun' }]);
        assert.deepEqual(getUnit(state, 'B1').statuses, []);
    });

    it('chance: 0 nunca pega, 1 sempre pega', () => {
        const never = statusSkill('a.never', [{ type: 'status', status: 'stun', turns: 1, power: 0, chance: 0 }]);
        const always = statusSkill('a.always', [{ type: 'status', status: 'stun', turns: 1, power: 0, chance: 1 }]);
        const start = createBattle({
            teamA: [makeCharacter('a', { speed: 200 }, [never, always])],
            teamB: [makeCharacter('b')],
            seed: 1,
        }).state;

        const missed = applyAction(start, { unitId: 'A1', skillId: 'a.never', targetId: 'B1' });
        const landed = applyAction(start, { unitId: 'A1', skillId: 'a.always', targetId: 'B1' });

        assert.deepEqual(getUnit(missed.state, 'B1').statuses, []);
        assert.deepEqual(getUnit(landed.state, 'B1').statuses.map((s) => s.kind), ['stun']);
    });
});

describe('status: escudo', () => {
    function setup(shieldValue: number) {
        // B é mais rápido: joga primeiro e bate em A, que já começa com escudo.
        const state = createBattle({
            teamA: [makeCharacter('a', { speed: 50, def: 100 })],
            teamB: [makeCharacter('b', { speed: 100, atk: 100 })],
            seed: 1,
        }).state;

        getUnit(state, 'A1').statuses = [status('shield', { value: shieldValue })];

        return state;
    }

    it('absorve o dano antes da vida', () => {
        const { state, events } = applyAction(setup(80), { unitId: 'B1', skillId: 'b.basic', targetId: 'A1' });
        const [damage] = eventsOfType(events, 'damage');

        assert.deepEqual([damage?.amount, damage?.absorbed, damage?.hp], [50, 50, 1000]);
        assert.deepEqual(getUnit(state, 'A1').statuses.map((s) => [s.kind, s.value]), [['shield', 30]]);
    });

    it('quebra quando o dano é maior, e o resto passa para a vida', () => {
        const { state, events } = applyAction(setup(30), { unitId: 'B1', skillId: 'b.basic', targetId: 'A1' });
        const [damage] = eventsOfType(events, 'damage');

        assert.deepEqual([damage?.amount, damage?.absorbed, damage?.hp], [50, 30, 980]);
        assert.deepEqual(eventsOfType(events, 'status_expired'), [{ type: 'status_expired', unitId: 'A1', status: 'shield' }]);
        assert.deepEqual(getUnit(state, 'A1').statuses, []);
    });

    it('é criado com ATK x poder de quem usou', () => {
        const shield = statusSkill('a1.shield', [{ type: 'status', status: 'shield', turns: 2, power: 1.5 }], 'single-ally');
        const start = createBattle({
            teamA: [makeCharacter('a1', { speed: 200, atk: 100 }, [shield]), makeCharacter('a2')],
            teamB: [makeCharacter('b')],
            seed: 1,
        }).state;

        const { state } = applyAction(start, { unitId: 'A1', skillId: 'a1.shield', targetId: 'A2' });

        assert.deepEqual(getUnit(state, 'A2').statuses.map((s) => [s.kind, s.value, s.turns]), [['shield', 150, 2]]);
    });
});

describe('status: bônus e penalidades de atributo', () => {
    it('somam e subtraem frações do atributo, com um piso', () => {
        const { state } = createBattle({ teamA: [makeCharacter('a', { atk: 100, def: 100, speed: 100 })], teamB: [makeCharacter('b')], seed: 1 });
        const unit = getUnit(state, 'A1');

        unit.statuses = [status('atk_up', { value: 0.5 }), status('def_down', { value: 0.25 }), status('speed_up', { value: 0.3 })];
        assert.deepEqual(
            [getEffectiveStats(unit).atk, getEffectiveStats(unit).def, getEffectiveStats(unit).speed],
            [150, 75, 130],
        );

        unit.statuses = [status('atk_up', { value: 0.5 }), status('atk_down', { value: 0.2 })];
        assert.equal(Math.round(getEffectiveStats(unit).atk), 130);

        unit.statuses = [status('speed_down', { value: 5 })];
        assert.equal(getEffectiveStats(unit).speed, 100 * MIN_STAT_FACTOR);
    });

    it('um bônus dado a si mesmo vale para as duas próximas vezes, não para a atual', () => {
        const rage = statusSkill('a.rage', [{ type: 'status', status: 'atk_up', turns: 2, power: 0.5 }], 'self');
        let state = createBattle({
            // B quase não joga: assim só A age durante o teste.
            teamA: [makeCharacter('a', { speed: 200, atk: 100, maxHp: 1_000_000 }, [rage])],
            teamB: [makeCharacter('b', { speed: 1, def: 100, maxHp: 1_000_000 })],
            seed: 1,
        }).state;
        const damages: number[] = [];

        state = applyAction(state, { unitId: 'A1', skillId: 'a.rage' }).state;

        for (let i = 0; i < 3; i++) {
            const result = basicAttackTurn(state);

            state = result.state;
            damages.push(eventsOfType(result.events, 'damage')[0]?.amount ?? 0);
        }

        // 100 de ATK contra 100 de DEF = 50; com +50% de ATK = 75.
        assert.deepEqual(damages, [75, 75, 50]);
    });

    it('velocidade maior faz jogar mais vezes', () => {
        const { state: start } = createBattle({
            teamA: [makeCharacter('a', { speed: 100, maxHp: 1_000_000 })],
            teamB: [makeCharacter('b', { speed: 100, maxHp: 1_000_000 })],
            seed: 1,
        });

        // Dobra a velocidade de A por muitos turnos.
        getUnit(start, 'A1').statuses = [status('speed_up', { value: 1, turns: 99 })];

        let state = start;
        const turns = { A: 0, B: 0 };

        for (let i = 0; i < 30; i++) {
            turns[getUnit(state, state.activeUnitId ?? '').team] += 1;
            state = basicAttackTurn(state).state;
        }

        assert.deepEqual(turns, { A: 20, B: 10 });
    });

    it('reaplicar o mesmo status substitui o anterior', () => {
        const slow = statusSkill('a.slow', [{ type: 'status', status: 'speed_down', turns: 3, power: 0.3 }]);
        const start = createBattle({
            teamA: [makeCharacter('a', { speed: 500 }, [slow])],
            teamB: [makeCharacter('b', { speed: 100 })],
            seed: 1,
        }).state;

        let state = applyAction(start, { unitId: 'A1', skillId: 'a.slow', targetId: 'B1' }).state;
        state = applyAction(state, { unitId: 'A1', skillId: 'a.slow', targetId: 'B1' }).state;

        assert.deepEqual(getUnit(state, 'B1').statuses.map((s) => [s.kind, s.turns]), [['speed_down', 3]]);
    });
});

describe('status: compatibilidade e consistência', () => {
    it('uma batalha gravada antes de os status existirem continua jogável', () => {
        const { state } = createBattle({ teamA: [makeCharacter('a', { speed: 200 })], teamB: [makeCharacter('b')], seed: 1 });
        const old = JSON.parse(JSON.stringify(state)) as BattleState;

        for (const unit of old.units) {
            delete (unit as Partial<typeof unit>).statuses;
        }

        const result = applyAction(old, { unitId: 'A1', skillId: 'a.basic', targetId: 'B1' });

        assert.deepEqual(result.state.units.map((u) => u.statuses), [[], []]);
    });

    it('os eventos statuses_changed sempre deixam a tela igual ao estado do servidor', () => {
        const teams = [
            [CHARACTERS.slice(0, 3), CHARACTERS.slice(3, 6)],
            [CHARACTERS.slice(3, 6), CHARACTERS.slice(0, 3)],
            [[CHARACTERS[0], CHARACTERS[2], CHARACTERS[4]], [CHARACTERS[1], CHARACTERS[3], CHARACTERS[5]]],
        ];

        for (const [teamA, teamB] of teams) {
            for (const seed of [1, 2, 3, 4, 5]) {
                assert.ok(teamA && teamB);

                let { state, events } = createBattle({
                    teamA: teamA.flatMap((c) => (c ? [c] : [])),
                    teamB: teamB.flatMap((c) => (c ? [c] : [])),
                    seed,
                });
                const shown = new Map<string, StatusEffect[]>(state.units.map((u) => [u.id, []]));

                for (let i = 0; ; i++) {
                    assert.ok(i < 500);

                    for (const event of events) {
                        if (event.type === 'statuses_changed') shown.set(event.unitId, event.statuses);
                    }

                    for (const unit of state.units) {
                        assert.deepEqual(shown.get(unit.id), unit.statuses, `${unit.id} no turno ${state.turn} (semente ${seed})`);
                    }

                    if (state.winner !== null) break;

                    ({ state, events } = applyAction(state, chooseAction(state)));
                }
            }
        }
    });
});
