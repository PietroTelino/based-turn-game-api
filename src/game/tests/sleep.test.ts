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
    effect: { type: 'countdown', turns: 3, target: 'all-enemies', effects: [{ type: 'status', status: 'sleep', turns: 1, power: 0 }] },
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

describe('contagem do sono e maldição (a passiva da Súcubo)', () => {
    function setup() {
        return createBattle({
            teamA: [makeCharacter('s', { speed: 300 }, [pass('s'), area('s')], [curse, torpor])],
            teamB: [makeCharacter('b', { speed: 200 }, [pass('b')]), makeCharacter('c', { speed: 100 }, [pass('c')])],
            seed: 1,
        }).state;
    }

    /** Em que turnos cada unidade perdeu a vez, jogando até o fim do turno `last`. */
    function skips(start: BattleState, last: number): Record<string, number[]> {
        let state = start;
        const result: Record<string, number[]> = {};

        while (state.turn <= last) {
            const { state: next, events } = passTurn(state);
            let turn = state.turn;

            // Uma mesma ação pode virar o turno; conta cada vez perdida no turno em que aconteceu.
            for (const event of events) {
                if (event.type === 'turn_started') turn = event.turn;
                if (event.type === 'unit_skipped' && turn <= last) (result[event.unitId] ??= []).push(turn);
            }

            state = next;
        }

        return result;
    }

    it('a contagem começa em 3 na própria Súcubo; os inimigos não recebem nada', () => {
        const state = setup();
        const countdown = getUnit(state, 'A1').statuses.find((item) => item.kind === 'countdown');

        assert.equal(countdown?.turns, 3);
        assert.deepEqual(kinds(state, 'B1'), []);
        assert.deepEqual(kinds(state, 'B2'), []);
    });

    it('a contagem desce no começo de cada vez dela: 3, 2 e dispara no 3º', () => {
        let state = setup();
        const seen: (number | undefined)[] = [];

        while (state.turn <= 3) {
            if (state.activeUnitId === 'A1') seen.push(getUnit(state, 'A1').statuses.find((item) => item.kind === 'countdown')?.turns);
            state = passTurn(state).state;
        }

        assert.deepEqual(seen, [3, 2, undefined]);
    });

    it('no começo do 3º turno dela, todos os inimigos adormecem e a contagem sai', () => {
        let state = setup();

        while (!(state.turn === 2 && state.activeUnitId === 'B2')) state = passTurn(state).state;

        // B2 encerra o turno 2: abre o turno 3 e chega a vez da Súcubo.
        const { state: after, events } = passTurn(state);

        assert.equal(after.activeUnitId, 'A1');
        assert.ok(events.some((event) => event.type === 'passive_triggered' && event.passiveId === 's.torpor' && event.targetIds.join() === 'B1,B2'));
        assert.ok(kinds(after, 'B1').includes('sleep'));
        assert.ok(kinds(after, 'B2').includes('sleep'));
        assert.ok(!kinds(after, 'A1').includes('countdown'));
    });

    it('mais rápida que os inimigos, eles perdem a vez do 3º turno; depois acordam, e não volta a acontecer', () => {
        const result = skips(setup(), 6);

        assert.deepEqual(result, { B1: [3], B2: [3] });
    });

    it('mais lenta que os inimigos, eles já agiram no 3º turno: perdem a vez do 4º', () => {
        const state = createBattle({
            teamA: [makeCharacter('s', { speed: 50 }, [pass('s')], [curse, torpor])],
            teamB: [makeCharacter('b', { speed: 200 }, [pass('b')]), makeCharacter('c', { speed: 100 }, [pass('c')])],
            seed: 1,
        }).state;

        assert.deepEqual(skips(state, 5), { B1: [4], B2: [4] });
    });

    it('se a Súcubo cair antes, ninguém adormece', () => {
        const state = setup();

        getUnit(state, 'A1').hp = 0;
        state.units.push({ ...structuredClone(getUnit(state, 'B1')), id: 'A9', team: 'A', hp: 1000, statuses: [], skills: [pass('z')], characterId: 'z' });
        state.order = [...state.order, 'A9'];
        state.activeUnitId = 'B1';

        assert.deepEqual(skips(state, 5), {});
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
    it('a Súcubo de verdade começa com a contagem de 3 nela', () => {
        const { state } = createBattle({
            teamA: [getCharacter('sucubo')],
            teamB: [getCharacter('cavaleiro'), getCharacter('sacerdote')],
            seed: 3,
        });

        assert.ok(getUnit(state, 'A1').statuses.some((item) => item.kind === 'countdown' && item.turns === 3));

        for (const unit of state.units.filter((item) => item.team === 'B')) {
            assert.ok(!unit.statuses.some((item) => item.kind === 'drowsy'));
        }
    });
});
