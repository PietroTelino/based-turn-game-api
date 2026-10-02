import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENERGY_PER_TURN, FURY_DAMAGE_PER_TURN, FURY_START_TURN, INITIAL_ENERGY, MAX_ENERGY } from '../constants';
import {
    applyAction,
    calculateDamage,
    createBattle,
    getAvailableActions,
    getFuryMultiplier,
    getUnit,
    previewTurnOrder,
} from '../engine';
import type { SkillDefinition } from '../types';
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
    it('a unidade mais rápida joga primeiro e o time dela ganha energia', () => {
        const { state, events } = createBattle({
            teamA: [makeCharacter('a', { speed: 100 })],
            teamB: [makeCharacter('b', { speed: 150 })],
            seed: 1,
        });

        assert.equal(state.activeUnitId, 'B1');
        assert.equal(state.turn, 1);
        assert.equal(state.winner, null);
        assert.deepEqual(state.energy, { A: INITIAL_ENERGY, B: INITIAL_ENERGY + ENERGY_PER_TURN });
        assert.deepEqual(events, [
            { type: 'turn_started', turn: 1, unitId: 'B1', team: 'B', energy: INITIAL_ENERGY + ENERGY_PER_TURN },
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

describe('ordem dos turnos', () => {
    it('quem tem o dobro de velocidade joga o dobro de vezes', () => {
        let { state } = createBattle({
            teamA: [makeCharacter('a', { speed: 200, maxHp: 1_000_000 })],
            teamB: [makeCharacter('b', { speed: 100, maxHp: 1_000_000 })],
            seed: 1,
        });
        const turns = { A: 0, B: 0 };

        for (let i = 0; i < 30; i++) {
            turns[getUnit(state, state.activeUnitId ?? '').team] += 1;
            state = basicAttackTurn(state).state;
        }

        assert.deepEqual(turns, { A: 20, B: 10 });
    });

    it('a previsão da fila bate com a ordem real', () => {
        let { state } = createBattle({
            teamA: [
                makeCharacter('a1', { speed: 130, maxHp: 1_000_000 }),
                makeCharacter('a2', { speed: 90, maxHp: 1_000_000 }),
            ],
            teamB: [
                makeCharacter('b1', { speed: 110, maxHp: 1_000_000 }),
                makeCharacter('b2', { speed: 75, maxHp: 1_000_000 }),
            ],
            seed: 1,
        });
        const predicted = previewTurnOrder(state, 12);
        const actual: string[] = [];

        for (let i = 0; i < 12; i++) {
            actual.push(state.activeUnitId ?? '');
            state = basicAttackTurn(state).state;
        }

        assert.equal(predicted.length, 12);
        assert.deepEqual(predicted, actual);
    });

    it('unidade derrotada não joga mais', () => {
        let { state } = createBattle({
            teamA: [makeCharacter('a', { speed: 100, atk: 5000, maxHp: 1_000_000 })],
            teamB: [makeCharacter('b1', { speed: 50, maxHp: 1_000_000 }), makeCharacter('b2', { speed: 90, maxHp: 10 })],
            seed: 1,
        });

        assert.equal(state.activeUnitId, 'A1');
        state = applyAction(state, { unitId: 'A1', skillId: 'a.basic', targetId: 'B2' }).state;
        assert.equal(getUnit(state, 'B2').hp, 0);

        for (let i = 0; i < 10; i++) {
            assert.notEqual(state.activeUnitId, 'B2');
            state = basicAttackTurn(state).state;
        }
    });
});

describe('energia', () => {
    const big = skill('a.big', { energyCost: 3, effects: [{ type: 'damage', power: 2 }] });

    it('a habilidade gasta a energia do time e é recusada quando falta', () => {
        const { state } = createBattle({
            teamA: [makeCharacter('a', { speed: 200 }, [big])],
            teamB: [makeCharacter('b', { maxHp: 1_000_000 })],
            seed: 1,
        });
        const energyBefore = state.energy.A;

        const result = applyAction(state, { unitId: 'A1', skillId: 'a.big', targetId: 'B1' });
        const [used] = eventsOfType(result.events, 'skill_used');

        assert.equal(used?.energy, energyBefore - 3);

        // A joga de novo (é duas vezes mais rápida) e ganhou só +1 de energia.
        assert.equal(result.state.activeUnitId, 'A1');
        assert.equal(result.state.energy.A, energyBefore - 3 + ENERGY_PER_TURN);
        assertRuleError(
            () => applyAction(result.state, { unitId: 'A1', skillId: 'a.big', targetId: 'B1' }),
            'NOT_ENOUGH_ENERGY',
        );
    });

    it('a energia não passa do teto', () => {
        let { state } = createBattle({
            teamA: [makeCharacter('a', { maxHp: 1_000_000 })],
            teamB: [makeCharacter('b', { maxHp: 1_000_000 })],
            seed: 1,
        });

        for (let i = 0; i < 40; i++) {
            state = basicAttackTurn(state).state;
            assert.ok(state.energy.A <= MAX_ENERGY && state.energy.B <= MAX_ENERGY);
        }

        assert.deepEqual(state.energy, { A: MAX_ENERGY, B: MAX_ENERGY });
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
});
