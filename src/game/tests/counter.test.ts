import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chooseAction, chooseTrainingAction } from '../ai';
import { getCharacter } from '../data/characters';
import { applyAction, createBattle, getUnit, NEGATIVE_STATUSES } from '../engine';
import type { BattleState, PassiveDefinition, SkillDefinition, SkillEffect, StatusEffect } from '../types';
import { eventsOfType, makeCharacter } from './helpers';

/*
 * Os personagens de teste têm ATK 100, DEF 100, sem crítico (helpers.ts): um
 * ataque básico causa 100 x 100 / (100 + 100) = 50, e o revide também.
 */

function skill(id: string, effects: SkillEffect[], target: SkillDefinition['target'] = 'single-enemy'): SkillDefinition {
    return { id, name: id, description: '', energyCost: 0, target, effects };
}

const STANCE = skill('a.postura', [{ type: 'status', status: 'counter', turns: 2, power: 0 }], 'self');

function counter(overrides: Partial<StatusEffect> = {}): StatusEffect {
    return { kind: 'counter', turns: 2, value: 0, sourceId: 'A1', appliedOnStep: 0, ...overrides };
}

interface DuelOptions {
    /** Habilidades extras de quem bate (B1). */
    skills?: SkillDefinition[];
    passives?: PassiveDefinition[];
    /** Quantos aliados em postura do lado A (o padrão é um). */
    defenders?: number;
}

/** B1 (veloz) bate primeiro em A, que já está em postura de contra-ataque. */
function duel(options: DuelOptions = {}): BattleState {
    const defenders = Array.from({ length: options.defenders ?? 1 }, (_, index) => makeCharacter(`a${index + 1}`, { speed: 50 - index }));
    const { state } = createBattle({
        teamA: defenders,
        teamB: [makeCharacter('b', { speed: 200 }, options.skills ?? [], options.passives ?? [])],
        seed: 1,
    });

    for (const unit of state.units) {
        if (unit.team === 'A') unit.statuses = [counter({ sourceId: unit.id })];
    }

    return state;
}

function counters(events: Parameters<typeof eventsOfType>[0]) {
    return eventsOfType(events, 'counter_attack').map((event) => [event.unitId, event.skillId, event.targetIds]);
}

describe('status: contra-ataque', () => {
    it('quem leva um golpe revida com o ataque básico, sem gastar energia e sem perder a própria vez', () => {
        const opening = duel();
        const { state, events } = applyAction(opening, { unitId: 'B1', skillId: 'b.basic', targetId: 'A1' });

        assert.deepEqual(counters(events), [['A1', 'a1.basic', ['B1']]]);
        assert.deepEqual(
            eventsOfType(events, 'damage').map((event) => [event.sourceId, event.targetId, event.amount]),
            [['B1', 'A1', 50], ['A1', 'B1', 50]],
        );
        // O revide vem depois do golpe que o provocou.
        assert.ok(events.findIndex((event) => event.type === 'counter_attack') > events.findIndex((event) => event.type === 'damage'));
        assert.deepEqual(state.energy, opening.energy);
        assert.equal(state.activeUnitId, 'A1', 'a vez dele no turno continua valendo');
        assert.ok(getUnit(state, 'A1').statuses.some((item) => item.kind === 'counter'), 'revidar não gasta a postura');
    });

    it('sem o status, ninguém revida', () => {
        const opening = duel();

        getUnit(opening, 'A1').statuses = [];

        assert.deepEqual(counters(applyAction(opening, { unitId: 'B1', skillId: 'b.basic', targetId: 'A1' }).events), []);
    });

    it('dano de veneno, queimadura e sangramento não é revidado', () => {
        const opening = duel();

        getUnit(opening, 'A1').statuses = [
            counter(),
            { kind: 'poison', turns: 3, value: 40, sourceId: 'B1', appliedOnStep: 0 },
            { kind: 'burn', turns: 3, value: 40, sourceId: 'B1', appliedOnStep: 0 },
            { kind: 'bleed', turns: 3, value: 40, sourceId: 'B1', appliedOnStep: 0 },
        ];

        // B1 usa um bônus em si mesmo (não bate em ninguém), e chega a vez de A1 com os três danos por turno.
        const wait = skill('b.espera', [{ type: 'status', status: 'def_up', turns: 1, power: 0.1 }], 'self');
        const withWait = structuredClone(opening);

        getUnit(withWait, 'B1').skills.push(wait);

        const { events } = applyAction(withWait, { unitId: 'B1', skillId: 'b.espera' });

        assert.equal(eventsOfType(events, 'status_damage').length, 3);
        assert.deepEqual(counters(events), []);
    });

    it('uma habilidade que bate várias vezes é revidada uma vez só', () => {
        const flurry = skill('b.rajada', [{ type: 'damage', power: 0.5 }, { type: 'damage', power: 0.5 }, { type: 'damage', power: 0.5 }]);
        const { events } = applyAction(duel({ skills: [flurry] }), { unitId: 'B1', skillId: 'b.rajada', targetId: 'A1' });

        assert.equal(eventsOfType(events, 'damage').filter((event) => event.sourceId === 'B1').length, 3);
        assert.deepEqual(counters(events), [['A1', 'a1.basic', ['B1']]]);
        // Os três golpes primeiro, o revide depois.
        assert.deepEqual(eventsOfType(events, 'damage').map((event) => event.sourceId), ['B1', 'B1', 'B1', 'A1']);
    });

    it('golpe em área: cada um que está em postura revida', () => {
        const wave = skill('b.onda', [{ type: 'damage', power: 1 }], 'all-enemies');
        const { state, events } = applyAction(duel({ skills: [wave], defenders: 2 }), { unitId: 'B1', skillId: 'b.onda' });

        assert.deepEqual(counters(events), [['A1', 'a1.basic', ['B1']], ['A2', 'a2.basic', ['B1']]]);
        assert.equal(getUnit(state, 'B1').hp, 900);
    });

    it('o golpe de uma passiva que bate sozinha também é revidado', () => {
        const thorn: PassiveDefinition = {
            id: 'b.espinho',
            name: 'Espinho',
            description: '',
            effect: { type: 'turn_start', target: 'fastest-enemy', effects: [{ type: 'damage', power: 1 }] },
        };
        const { events } = createBattle({ teamA: [makeCharacter('a1', { speed: 50 }, [STANCE])], teamB: [makeCharacter('b', { speed: 200 }, [], [thorn])], seed: 1 });

        // Na abertura ninguém está em postura ainda: a passiva bate e não leva nada.
        assert.deepEqual(counters(events), []);

        const opening = duel({ passives: [thorn] });
        // Um turno inteiro: B1 bate (revide), A1 bate, e no turno 2 a passiva de B1 bate (outro revide).
        const first = applyAction(opening, { unitId: 'B1', skillId: 'b.basic', targetId: 'A1' });
        const second = applyAction(first.state, { unitId: 'A1', skillId: 'a1.basic', targetId: 'B1' });
        const passiveAt = second.events.findIndex((event) => event.type === 'passive_triggered');
        const counterAt = second.events.findIndex((event) => event.type === 'counter_attack');

        assert.ok(passiveAt >= 0 && counterAt > passiveAt, 'o revide vem depois do golpe da passiva');
        assert.equal(second.state.activeUnitId, 'B1');
    });

    it('se o revide derruba quem a passiva fez bater, a vez dele não acontece', () => {
        const thorn: PassiveDefinition = {
            id: 'b.espinho',
            name: 'Espinho',
            description: '',
            effect: { type: 'turn_start', target: 'fastest-enemy', effects: [{ type: 'damage', power: 1 }] },
        };
        const { state: opening } = createBattle({
            teamA: [makeCharacter('a1', { speed: 100 })],
            teamB: [makeCharacter('b', { speed: 50 }, [], [thorn]), makeCharacter('c', { speed: 40 })],
            seed: 1,
        });

        getUnit(opening, 'A1').statuses = [counter({ turns: 5 })];
        getUnit(opening, 'B1').hp = 30;

        // A1 bate em B2; chega a vez de B1, a passiva dele bate em A1 e o revide o derruba.
        const { state, events } = applyAction(opening, { unitId: 'A1', skillId: 'a1.basic', targetId: 'B2' });

        assert.equal(getUnit(state, 'B1').hp, 0);
        assert.deepEqual(eventsOfType(events, 'unit_defeated').map((event) => event.unitId), ['B1']);
        assert.equal(state.activeUnitId, 'B2', 'a fila segue para o próximo');
        assert.equal(state.winner, null);
    });

    it('atordoado pelo golpe, ou derrotado por ele, não revida', () => {
        const bash = skill('b.pancada', [{ type: 'status', status: 'stun', turns: 1, power: 0 }, { type: 'damage', power: 1 }]);

        assert.deepEqual(counters(applyAction(duel({ skills: [bash] }), { unitId: 'B1', skillId: 'b.pancada', targetId: 'A1' }).events), []);

        const dying = duel();

        getUnit(dying, 'A1').hp = 20;

        const { state, events } = applyAction(dying, { unitId: 'B1', skillId: 'b.basic', targetId: 'A1' });

        assert.deepEqual(counters(events), []);
        assert.equal(state.winner, 'B');
    });

    it('um revide não provoca outro: dois em postura não ficam batendo para sempre', () => {
        const opening = duel();

        getUnit(opening, 'B1').statuses = [counter({ sourceId: 'B1' })];

        const { events } = applyAction(opening, { unitId: 'B1', skillId: 'b.basic', targetId: 'A1' });

        assert.deepEqual(counters(events), [['A1', 'a1.basic', ['B1']]]);
    });

    it('com um inimigo provocando, o revide vai em quem provoca, e não em quem bateu', () => {
        const { state: opening } = createBattle({
            teamA: [makeCharacter('a1', { speed: 50 })],
            teamB: [makeCharacter('b', { speed: 200 }), makeCharacter('c', { speed: 150 })],
            seed: 1,
        });

        getUnit(opening, 'A1').statuses = [counter()];
        getUnit(opening, 'B2').statuses = [{ kind: 'taunt', turns: 2, value: 0, sourceId: 'B2', appliedOnStep: 0 }];

        const { state, events } = applyAction(opening, { unitId: 'B1', skillId: 'b.basic', targetId: 'A1' });

        assert.deepEqual(counters(events), [['A1', 'a1.basic', ['B2']]]);
        assert.deepEqual([getUnit(state, 'B1').hp, getUnit(state, 'B2').hp], [1000, 950]);

        // Se quem bateu é quem provoca, o revide vai nele mesmo.
        const self = structuredClone(opening);

        getUnit(self, 'B1').statuses = [{ kind: 'taunt', turns: 2, value: 0, sourceId: 'B1', appliedOnStep: 0 }];

        assert.deepEqual(counters(applyAction(self, { unitId: 'B1', skillId: 'b.basic', targetId: 'A1' }).events), [['A1', 'a1.basic', ['B1']]]);
    });

    it('o golpe que o escudo segurou inteiro ainda é um golpe: é revidado', () => {
        const opening = duel();

        getUnit(opening, 'A1').statuses = [counter(), { kind: 'shield', turns: 2, value: 500, sourceId: 'A1', appliedOnStep: 0 }];

        const { state, events } = applyAction(opening, { unitId: 'B1', skillId: 'b.basic', targetId: 'A1' });

        assert.equal(getUnit(state, 'A1').hp, 1000);
        assert.deepEqual(counters(events), [['A1', 'a1.basic', ['B1']]]);
    });

    it('o revide pode derrubar quem bateu: a batalha segue, ou acaba se era o último', () => {
        const last = duel();

        getUnit(last, 'B1').hp = 40;

        const ended = applyAction(last, { unitId: 'B1', skillId: 'b.basic', targetId: 'A1' });

        assert.equal(ended.state.winner, 'A');
        assert.equal(ended.events[ended.events.length - 1]?.type, 'battle_ended');

        const { state: two } = createBattle({
            teamA: [makeCharacter('a1', { speed: 50 })],
            teamB: [makeCharacter('b', { speed: 200 }), makeCharacter('c', { speed: 150 })],
            seed: 1,
        });

        getUnit(two, 'A1').statuses = [counter()];
        getUnit(two, 'B1').hp = 40;

        const { state, events } = applyAction(two, { unitId: 'B1', skillId: 'b.basic', targetId: 'A1' });

        assert.deepEqual(eventsOfType(events, 'unit_defeated').map((event) => event.unitId), ['B1']);
        assert.equal(state.winner, null);
        assert.equal(state.activeUnitId, 'B2');
    });

    it('dura dois turnos: revida nos dois e não revida mais no terceiro', () => {
        let { state } = createBattle({ teamA: [makeCharacter('a1', { speed: 200 }, [STANCE])], teamB: [makeCharacter('b', { speed: 50 })], seed: 1 });
        const perTurn: number[] = [];

        for (const skillId of ['a.postura', 'a1.basic', 'a1.basic']) {
            state = applyAction(state, skillId === 'a.postura' ? { unitId: 'A1', skillId } : { unitId: 'A1', skillId, targetId: 'B1' }).state;

            const hit = applyAction(state, { unitId: 'B1', skillId: 'b.basic', targetId: 'A1' });

            perTurn.push(eventsOfType(hit.events, 'counter_attack').length);
            state = hit.state;
        }

        assert.deepEqual(perTurn, [1, 1, 0]);
    });

    it('é um bônus: a purificação não tira', () => {
        assert.ok(!NEGATIVE_STATUSES.includes('counter'));
    });
});

describe('catálogo: Espadachim', () => {
    it('a Postura de Duelo não tem custo e dá ataque, defesa e contra-ataque por 2 turnos', () => {
        const stance = getCharacter('espadachim').skills.find((item) => item.id === 'espadachim.postura-de-duelo');

        assert.equal(stance?.energyCost, 0);
        assert.deepEqual(
            stance?.effects.map((effect) => (effect.type === 'status' ? [effect.status, effect.turns] : [])),
            [['atk_up', 2], ['def_up', 2], ['counter', 2]],
        );
        assert.match(stance?.description ?? '', /contra-ataca/);
    });

    it('em postura, revida com a Estocada o golpe do inimigo, e o veneno do Guardião não é revidado', () => {
        const opening = createBattle({ teamA: [getCharacter('espadachim')], teamB: [getCharacter('guardiao')], seed: 1 }).state;

        assert.equal(opening.activeUnitId, 'A1', 'o Espadachim é mais veloz');

        const stance = applyAction(opening, { unitId: 'A1', skillId: 'espadachim.postura-de-duelo' });
        const energy = stance.state.energy.A;
        const hit = applyAction(stance.state, { unitId: 'B1', skillId: 'guardiao.raizes', targetId: 'A1' });
        const back = eventsOfType(hit.events, 'damage').find((event) => event.sourceId === 'A1');

        assert.deepEqual(counters(hit.events), [['A1', 'espadachim.estocada', ['B1']]]);
        assert.ok(back && back.targetId === 'B1' && back.amount > 0);
        assert.equal(hit.state.energy.A >= energy, true, 'o revide não gasta energia');

        // O turno 2 abre com a vez do Espadachim: o veneno das Raízes dói, mas só há o revide do golpe.
        assert.ok(eventsOfType(hit.events, 'status_damage').some((event) => event.targetId === 'A1'));
        assert.equal(eventsOfType(hit.events, 'counter_attack').length, 1);
    });

    it('a IA entra em postura quando não está, e bate quando já está', () => {
        const opening = createBattle({ teamA: [getCharacter('espadachim')], teamB: [getCharacter('cavaleiro')], seed: 1 }).state;

        assert.deepEqual(chooseAction(opening), { unitId: 'A1', skillId: 'espadachim.postura-de-duelo' });

        const inStance = applyAction(opening, { unitId: 'A1', skillId: 'espadachim.postura-de-duelo' }).state;

        inStance.activeUnitId = 'A1';

        assert.deepEqual(chooseAction(inStance), { unitId: 'A1', skillId: 'espadachim.danca-das-laminas', targetId: 'B1' });
    });

    it('a IA de treino não entra em postura: o Espadachim do tutorial não contra-ataca', () => {
        const opening = createBattle({ teamA: [getCharacter('espadachim')], teamB: [getCharacter('cavaleiro')], seed: 1 }).state;

        assert.equal(chooseTrainingAction(opening).skillId, 'espadachim.danca-das-laminas');

        opening.energy.A = 0;

        assert.equal(chooseTrainingAction(opening).skillId, 'espadachim.estocada');
    });
});
