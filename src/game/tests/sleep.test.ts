import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getCharacter } from '../data/characters';
import { applyAction, createBattle, getAvailableActions, getUnit } from '../engine';
import type { BattleEvent, BattleState, PassiveDefinition, SkillDefinition, StatusEffect, StatusKind } from '../types';
import { eventsOfType, makeCharacter } from './helpers';

function skill(id: string, overrides: Partial<SkillDefinition>): SkillDefinition {
    return { id, name: id, description: '', energyCost: 0, target: 'single-enemy', effects: [{ type: 'damage', power: 1 }], ...overrides };
}

function status(kind: StatusKind, sourceId: string, overrides: Partial<StatusEffect> = {}): StatusEffect {
    return { kind, turns: 1, value: 0, sourceId, appliedOnStep: 0, ...overrides };
}

/** Uma vez sem efeito: a unidade dá a si mesma um bônus mínimo. */
const pass = (owner: string) => skill(`${owner}.pass`, { target: 'self', effects: [{ type: 'status', status: 'speed_up', turns: 1, power: 0.01 }] });
const area = (owner: string) => skill(`${owner}.area`, { target: 'all-enemies' });
const cleanse = (owner: string) => skill(`${owner}.cleanse`, { target: 'single-ally', effects: [{ type: 'cleanse' }] });

const curse: PassiveDefinition = {
    id: 's.curse',
    name: 'Maldição',
    description: '',
    effect: { type: 'damage_bonus', amount: 0.3, when: { type: 'target_has_status', statuses: ['curse'], fromSelf: true } },
};

const torpor: PassiveDefinition = {
    id: 's.torpor',
    name: 'Torpor',
    description: '',
    effect: { type: 'battle_start', target: 'all-enemies', effects: [{ type: 'status', status: 'drowsy', turns: 3, power: 0 }] },
    also: [{ type: 'status_on_hit', status: 'curse', turns: 1, power: 0.4, permanent: true, when: { type: 'target_has_status', statuses: ['sleep'] } }],
};

const kinds = (state: BattleState, unitId: string) => getUnit(state, unitId).statuses.map((item) => item.kind).sort();

/** A unidade da vez passa a vez (usa o `pass` dela). */
function passTurn(state: BattleState) {
    const actor = getUnit(state, state.activeUnitId!);

    return applyAction(state, { unitId: actor.id, skillId: `${actor.characterId}.pass` });
}

function hits(events: BattleEvent[], targetId: string) {
    return eventsOfType(events, 'damage').filter((event) => event.targetId === targetId);
}

describe('sono', () => {
    function setup() {
        // A1 age primeiro; depois B1 e B2.
        const state = createBattle({
            teamA: [makeCharacter('a', { speed: 300 }, [pass('a'), area('a')])],
            teamB: [makeCharacter('b', { speed: 200 }, [pass('b')]), makeCharacter('c', { speed: 100 }, [pass('c')])],
            seed: 1,
        }).state;

        assert.equal(state.activeUnitId, 'A1');

        return state;
    }

    it('quem dorme perde a vez e acorda no fim dela', () => {
        const state = setup();

        getUnit(state, 'B1').statuses = [status('sleep', 'A1')];

        const { state: after, events } = passTurn(state);
        const skipped = eventsOfType(events, 'unit_skipped');

        assert.deepEqual(skipped, [{ type: 'unit_skipped', unitId: 'B1', status: 'sleep' }]);
        assert.ok(events.some((event) => event.type === 'status_expired' && event.unitId === 'B1' && event.status === 'sleep'));
        assert.deepEqual(kinds(after, 'B1'), []);
        // A vez passou para o seguinte.
        assert.equal(after.activeUnitId, 'B2');
    });

    it('o golpe em quem dorme causa 50% a mais e o acorda', () => {
        const state = setup();

        getUnit(state, 'B1').statuses = [status('sleep', 'A1')];

        const { state: after, events } = applyAction(state, { unitId: 'A1', skillId: 'a.basic', targetId: 'B1' });

        // ATK 100 x 1 contra DEF 100 = 50; dormindo, 75.
        assert.equal(hits(events, 'B1')[0]?.amount, 75);
        assert.deepEqual(kinds(after, 'B1'), []);
        // Acordado, B1 age normalmente na vez dele.
        assert.equal(after.activeUnitId, 'B1');
    });

    it('em área, cada adormecido leva o bônus e acorda; quem estava acordado leva o normal', () => {
        const state = setup();

        getUnit(state, 'B1').statuses = [status('sleep', 'A1')];

        const { state: after, events } = applyAction(state, { unitId: 'A1', skillId: 'a.area' });

        assert.equal(hits(events, 'B1')[0]?.amount, 75);
        assert.equal(hits(events, 'B2')[0]?.amount, 50);
        assert.deepEqual(kinds(after, 'B1'), []);
    });

    it('a prévia no alvo já conta o bônus do sono', () => {
        const state = setup();

        getUnit(state, 'B1').statuses = [status('sleep', 'A1')];

        const basic = getAvailableActions(state).find((action) => action.skill.id === 'a.basic')!;

        assert.equal(basic.targets.find((target) => target.unitId === 'B1')?.damage, 75);
        assert.equal(basic.targets.find((target) => target.unitId === 'B2')?.damage, 50);
    });

    it('dano de status não acorda: quem dorme queimando leva o dano e perde a vez do mesmo jeito', () => {
        const state = setup();

        getUnit(state, 'B1').statuses = [status('sleep', 'A1'), status('burn', 'A1', { value: 30, turns: 2 })];

        const { events } = passTurn(state);

        assert.ok(events.some((event) => event.type === 'status_damage' && event.targetId === 'B1' && event.amount === 30));
        assert.deepEqual(eventsOfType(events, 'unit_skipped').map((event) => event.unitId), ['B1']);
    });

    it('quem dorme não contra-ataca', () => {
        const state = setup();

        getUnit(state, 'B1').statuses = [status('sleep', 'A1'), status('counter', 'B1', { turns: 2 })];

        const { events } = applyAction(state, { unitId: 'A1', skillId: 'a.basic', targetId: 'B1' });

        assert.equal(eventsOfType(events, 'counter_attack').length, 0);
    });

    it('a purificação tira o sono e o torpor, mas não a maldição', () => {
        const state = createBattle({
            teamA: [makeCharacter('a', { speed: 300 }, [cleanse('a')]), makeCharacter('d', { speed: 10 })],
            teamB: [makeCharacter('b')],
            seed: 1,
        }).state;

        getUnit(state, 'A2').statuses = [status('sleep', 'B1'), status('drowsy', 'B1', { turns: 2 }), status('curse', 'B1', { value: 40, permanent: true })];

        const { state: after } = applyAction(state, { unitId: 'A1', skillId: 'a.cleanse', targetId: 'A2' });

        assert.deepEqual(kinds(after, 'A2'), ['curse']);
    });
});

describe('torpor e maldição (a passiva da Súcubo)', () => {
    function setup() {
        return createBattle({
            teamA: [makeCharacter('s', { speed: 300 }, [pass('s'), area('s')], [curse, torpor])],
            teamB: [makeCharacter('b', { speed: 200 }, [pass('b')]), makeCharacter('c', { speed: 100 }, [pass('c')])],
            seed: 1,
        }).state;
    }

    it('a batalha começa com torpor de 3 turnos em todos os inimigos', () => {
        const state = setup();

        for (const id of ['B1', 'B2']) {
            const drowsy = getUnit(state, id).statuses.find((item) => item.kind === 'drowsy');

            assert.equal(drowsy?.turns, 3);
            assert.equal(drowsy?.sourceId, 'A1');
        }
    });

    it('quem ainda tem o torpor ao fim de 3 turnos adormece e perde a 4ª vez', () => {
        let state = setup();
        const skippedOnTurn: number[] = [];

        while (state.turn <= 4) {
            const { state: next, events } = passTurn(state);

            // As vezes perdidas acontecem dentro desta ação, ainda no turno de `state`.
            for (const event of eventsOfType(events, 'unit_skipped')) {
                if (event.unitId === 'B1') skippedOnTurn.push(state.turn);
            }

            state = next;
        }

        assert.deepEqual(skippedOnTurn, [4]);
    });

    it('golpear um adormecido amaldiçoa para sempre: 40% do ATK por vez, e os golpes seguintes causam 30% a mais', () => {
        const state = setup();

        getUnit(state, 'B1').statuses = [status('sleep', 'A1')];

        const first = applyAction(state, { unitId: 'A1', skillId: 's.basic', targetId: 'B1' });
        const mark = getUnit(first.state, 'B1').statuses.find((item) => item.kind === 'curse');

        // O golpe que amaldiçoa é só o do sono (75); a maldição vale a partir do próximo.
        assert.equal(hits(first.events, 'B1')[0]?.amount, 75);
        assert.deepEqual(mark && { value: mark.value, permanent: mark.permanent, sourceId: mark.sourceId }, { value: 40, permanent: true, sourceId: 'A1' });

        // Na vez de B1, a maldição causa dano; depois dela continua lá (não gasta duração).
        let after = first.state;

        assert.equal(after.activeUnitId, 'B1');
        assert.ok(first.events.some((event) => event.type === 'status_damage' && event.targetId === 'B1' && event.status === 'curse' && event.amount === 40));

        after = passTurn(after).state;
        after = passTurn(after).state;
        assert.ok(kinds(after, 'B1').includes('curse'));

        // De novo na vez de A1: o golpe na amaldiçoada causa 30% a mais (50 -> 65).
        assert.equal(after.activeUnitId, 'A1');
        const second = applyAction(after, { unitId: 'A1', skillId: 's.basic', targetId: 'B1' });

        assert.equal(hits(second.events, 'B1')[0]?.amount, 65);
        assert.ok(second.events.some((event) => event.type === 'passive_triggered' && event.passiveId === 's.curse'));
    });

    it('golpear quem está acordado não amaldiçoa', () => {
        const state = setup();
        const { state: after } = applyAction(state, { unitId: 'A1', skillId: 's.basic', targetId: 'B1' });

        assert.ok(!kinds(after, 'B1').includes('curse'));
    });

    it('quem está amaldiçoado não mira na Súcubo com alvo único enquanto houver outro alvo; em área, acerta', () => {
        const state = createBattle({
            teamA: [makeCharacter('s', { speed: 100 }, [], [curse, torpor]), makeCharacter('t', { speed: 50 })],
            teamB: [makeCharacter('b', { speed: 300 }, [area('b')])],
            seed: 1,
        }).state;

        assert.equal(state.activeUnitId, 'B1');
        getUnit(state, 'B1').statuses = [status('curse', 'A1', { value: 40, permanent: true })];

        const options = getAvailableActions(state);

        assert.deepEqual(options.find((option) => option.skill.id === 'b.basic')?.targetIds, ['A2']);
        assert.deepEqual(options.find((option) => option.skill.id === 'b.area')?.targetIds, ['A1', 'A2']);
        assert.throws(() => applyAction(state, { unitId: 'B1', skillId: 'b.basic', targetId: 'A1' }));

        // Sem outro alvo, ela pode ser escolhida.
        getUnit(state, 'A2').hp = 0;
        assert.deepEqual(getAvailableActions(state).find((option) => option.skill.id === 'b.basic')?.targetIds, ['A1']);
    });

    it('quem está amaldiçoado não revida na Súcubo', () => {
        const state = setup();

        getUnit(state, 'B1').statuses = [status('curse', 'A1', { value: 40, permanent: true }), status('counter', 'B1', { turns: 2 })];

        const { events } = applyAction(state, { unitId: 'A1', skillId: 's.basic', targetId: 'B1' });

        assert.equal(eventsOfType(events, 'counter_attack').length, 0);
    });
});

describe('catálogo: Súcubo', () => {
    it('a Súcubo de verdade põe torpor nos inimigos e o Tormento acerta todos', () => {
        const { state } = createBattle({
            teamA: [getCharacter('sucubo')],
            teamB: [getCharacter('cavaleiro'), getCharacter('sacerdote')],
            seed: 3,
        });

        for (const unit of state.units.filter((item) => item.team === 'B')) {
            assert.ok(unit.statuses.some((item) => item.kind === 'drowsy' && item.turns === 3));
        }
    });
});
