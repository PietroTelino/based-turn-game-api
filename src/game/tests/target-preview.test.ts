import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyAction, createBattle, getAvailableActions, getUnit } from '../engine';
import type { BattleState, SkillDefinition } from '../types';
import { eventsOfType, makeCharacter } from './helpers';

function skill(id: string, overrides: Partial<SkillDefinition>): SkillDefinition {
    return { id, name: id, description: '', energyCost: 0, target: 'single-enemy', effects: [{ type: 'damage', power: 1 }], ...overrides };
}

const weaken = skill('a.weaken', {
    effects: [
        { type: 'status', status: 'def_down', turns: 2, power: 0.5 },
        { type: 'damage', power: 1 },
    ],
});
const maybeWeaken = skill('a.maybe', {
    effects: [
        { type: 'status', status: 'def_down', turns: 2, power: 0.5, chance: 0.5 },
        { type: 'damage', power: 1 },
    ],
});
const flurry = skill('a.flurry', { effects: [{ type: 'damage', power: 0.5 }, { type: 'damage', power: 0.5 }] });
const quake = skill('a.quake', { target: 'all-enemies', effects: [{ type: 'damage', power: 1 }] });
const mend = skill('a.mend', { target: 'single-ally', effects: [{ type: 'heal', power: 1 }] });
const rally = skill('a.rally', { target: 'all-allies', effects: [{ type: 'status', status: 'atk_up', turns: 2, power: 0.3 }] });

/**
 * A1 (200 de ATK) joga primeiro. B1 tem 100 de DEF e B2 tem 300: o golpe de
 * poder 1 tira 100 de B1 e 50 de B2. Sem crítico, a não ser que o teste dê.
 */
function setup(critChance = 0): BattleState {
    return createBattle({
        teamA: [makeCharacter('a', { atk: 200, speed: 200, critChance, critDamage: 1.5 }, [weaken, maybeWeaken, flurry, quake, mend, rally]), makeCharacter('a2')],
        teamB: [makeCharacter('b', { def: 100 }), makeCharacter('b2', { def: 300 })],
        seed: 1,
    }).state;
}

const action = (state: BattleState, id: string) => getAvailableActions(state).find((a) => a.skill.id === id)!;
const on = (state: BattleState, skillId: string, unitId: string) => action(state, skillId).targets.find((t) => t.unitId === unitId)!;

describe('prévia da habilidade em cada alvo', () => {
    it('há uma prévia para cada alvo possível, com o dano depois da defesa dele', () => {
        const state = setup();
        const basic = action(state, 'a.basic');

        assert.deepEqual(basic.targets.map((t) => t.unitId), basic.targetIds);
        assert.equal(on(state, 'a.basic', 'B1').damage, 100);
        assert.equal(on(state, 'a.basic', 'B2').damage, 50);
    });

    it('é o mesmo dano que o golpe causa de verdade, quando não é crítico', () => {
        const state = setup();

        for (const targetId of ['B1', 'B2']) {
            const expected = on(state, 'a.basic', targetId).damage;
            const { events } = applyAction(state, { unitId: 'A1', skillId: 'a.basic', targetId });

            assert.equal(eventsOfType(events, 'damage')[0]?.amount, expected);
        }
    });

    it('mostra o dano do crítico e a chance dele', () => {
        const preview = on(setup(0.25), 'a.basic', 'B1');

        assert.equal(preview.critDamage, 150);
        assert.equal(preview.critChance, 0.25);
    });

    it('conta o status garantido que a habilidade aplica antes do golpe, mas não o que depende de sorte', () => {
        const state = setup();

        // Metade da defesa: 200 x 100 / 150.
        assert.equal(on(state, 'a.weaken', 'B1').damage, 133);
        assert.equal(on(state, 'a.maybe', 'B1').damage, 100);
    });

    it('soma os golpes de uma habilidade de vários golpes', () => {
        assert.equal(on(setup(), 'a.flurry', 'B1').damage, 100);
    });

    it('em área, cada alvo tem a sua prévia', () => {
        const state = setup();

        assert.deepEqual(action(state, 'a.quake').targets.map((t) => [t.unitId, t.damage]), [['B1', 100], ['B2', 50]]);
    });

    it('diz quanto o escudo segura e se o golpe derruba', () => {
        const state = setup();

        getUnit(state, 'B1').hp = 90;
        assert.equal(on(state, 'a.basic', 'B1').defeats, true);

        getUnit(state, 'B1').statuses = [{ kind: 'shield', turns: 2, value: 30, sourceId: 'B1', appliedOnStep: 0 }];

        const shielded = on(state, 'a.basic', 'B1');

        assert.equal(shielded.absorbed, 30);
        assert.equal(shielded.defeats, false);
    });

    it('em área, o que um alvo muda vale para o seguinte, como na ação de verdade', () => {
        // Cada cura do roubo de vida dá 10% de dano a mais, já no alvo seguinte do mesmo golpe.
        const feast = skill('v.feast', { target: 'all-enemies', effects: [{ type: 'damage', power: 1, drain: 0.5 }] });
        const thirst = { id: 'v.thirst', name: 'Sede', description: '', effect: { type: 'damage_per_drain' as const, amount: 0.1 } };
        const state = createBattle({
            teamA: [makeCharacter('v', { atk: 200, speed: 200 }, [feast], [thirst])],
            teamB: [makeCharacter('b', { def: 100 }), makeCharacter('b2', { def: 300 })],
            seed: 1,
        }).state;

        getUnit(state, 'A1').hp = 500;

        const preview = action(state, 'v.feast').targets.map((t) => [t.unitId, t.damage]);
        const { events } = applyAction(state, { unitId: 'A1', skillId: 'v.feast' });

        assert.deepEqual(preview, [['B1', 100], ['B2', 55]]);
        assert.deepEqual(eventsOfType(events, 'damage').map((e) => [e.targetId, e.amount]), preview);
    });

    it('a cura mostrada é a que o aliado recebe, limitada à vida que falta', () => {
        const state = setup();

        getUnit(state, 'A2').hp = 900;

        assert.equal(on(state, 'a.mend', 'A2').heal, 100);
        assert.equal(on(state, 'a.mend', 'A1').heal, 0);
        assert.equal(on(state, 'a.mend', 'A2').damage, null);
    });

    it('habilidade sem dano nem cura não tem prévia', () => {
        assert.deepEqual(action(setup(), 'a.rally').targets, []);
    });

    it('não muda a batalha, nem o sorteio dela', () => {
        const state = setup(0.5);
        const before = structuredClone(state);

        getAvailableActions(state);

        assert.deepEqual(state, before);
    });
});
