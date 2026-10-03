import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_ENERGY } from '../constants';
import { getCharacter } from '../data/characters';
import { applyAction, createBattle, getAvailableActions, getUnit } from '../engine';
import type { BattleState, PassiveDefinition, PassiveEffect, SkillDefinition, SkillEffect, StatusEffect, StatusKind } from '../types';
import { basicAttackTurn, eventsOfType, makeCharacter } from './helpers';

/*
 * Os personagens de teste têm ATK 100, DEF 100, sem crítico (helpers.ts): um
 * ataque básico causa 100 x 100 / (100 + 100) = 50. As contas abaixo partem daí.
 */

function passive(effect: PassiveEffect, id = 'a.passiva'): PassiveDefinition {
    return { id, name: id, description: '', effect };
}

function skill(id: string, effects: SkillEffect[], target: SkillDefinition['target'] = 'single-enemy'): SkillDefinition {
    return { id, name: id, description: '', energyCost: 0, target, effects };
}

function status(kind: StatusKind): StatusEffect {
    return { kind, turns: 5, value: 1, sourceId: 'A1', appliedOnStep: 0 };
}

/** A (veloz, com a passiva) contra um ou mais B. A vez começa com A1. */
function duel(effect: PassiveEffect, options: { stats?: Parameters<typeof makeCharacter>[1]; skills?: SkillDefinition[]; enemies?: number } = {}): BattleState {
    const enemies = Array.from({ length: options.enemies ?? 1 }, (_, index) => makeCharacter(`b${index + 1}`, { speed: 100 - index, maxHp: 10_000 }));

    return createBattle({
        teamA: [makeCharacter('a', { speed: 200, maxHp: 10_000, ...options.stats }, options.skills ?? [], [passive(effect)])],
        teamB: enemies,
        seed: 1,
    }).state;
}

function basic(state: BattleState, targetId = 'B1') {
    return applyAction(state, { unitId: 'A1', skillId: 'a.basic', targetId });
}

describe('passivas de golpe', () => {
    it('damage_bonus com condição: só vale (e só é anunciada) quando o alvo está na condição', () => {
        const effect: PassiveEffect = { type: 'damage_bonus', amount: 0.5, when: { type: 'target_has_status', statuses: ['burn'] } };
        const state = duel(effect);

        const plain = basic(state);

        assert.equal(eventsOfType(plain.events, 'damage')[0]?.amount, 50);
        assert.equal(eventsOfType(plain.events, 'passive_triggered').length, 0);

        getUnit(state, 'B1').statuses = [status('burn')];

        const boosted = basic(state);

        assert.equal(eventsOfType(boosted.events, 'damage')[0]?.amount, 75);
        assert.deepEqual(
            boosted.events.slice(0, 3).map((event) => event.type),
            ['skill_used', 'passive_triggered', 'damage'],
            'o aviso vem antes do dano que a passiva mudou',
        );
        assert.deepEqual(eventsOfType(boosted.events, 'passive_triggered')[0], {
            type: 'passive_triggered',
            unitId: 'A1',
            passiveId: 'a.passiva',
            targetIds: ['B1'],
        });
    });

    it('damage_bonus pela vida do alvo: abaixo ou acima de uma fração', () => {
        const below = duel({ type: 'damage_bonus', amount: 0.4, when: { type: 'target_hp_below', ratio: 0.4 } });
        const above = duel({ type: 'damage_bonus', amount: 0.4, when: { type: 'target_hp_above', ratio: 0.7 } });

        assert.equal(eventsOfType(basic(below).events, 'damage')[0]?.amount, 50, 'alvo com a vida cheia: sem bônus');
        assert.equal(eventsOfType(basic(above).events, 'damage')[0]?.amount, 70, 'alvo com a vida cheia: com bônus');

        getUnit(below, 'B1').hp = 3000;
        getUnit(above, 'B1').hp = 3000;

        assert.equal(eventsOfType(basic(below).events, 'damage')[0]?.amount, 70, 'alvo com 30% da vida: com bônus');
        assert.equal(eventsOfType(basic(above).events, 'damage')[0]?.amount, 50, 'alvo com 30% da vida: sem bônus');
    });

    it('em área, a condição é conferida alvo por alvo e o aviso sai uma vez só', () => {
        const area = skill('a.area', [{ type: 'damage', power: 1 }], 'all-enemies');
        const state = duel(
            { type: 'damage_bonus', amount: 0.5, when: { type: 'target_has_status', statuses: ['burn'] } },
            { skills: [area], enemies: 3 },
        );

        getUnit(state, 'B1').statuses = [status('burn')];
        getUnit(state, 'B3').statuses = [status('burn')];

        const { events } = applyAction(state, { unitId: 'A1', skillId: 'a.area' });

        assert.deepEqual(eventsOfType(events, 'damage').map((event) => event.amount), [75, 50, 75]);
        assert.equal(eventsOfType(events, 'passive_triggered').length, 1);
    });

    it('damage_bonus sem condição vale sempre, entra na prévia da habilidade e não é anunciada', () => {
        const state = duel({ type: 'damage_bonus', amount: 0.2 });
        const { events } = basic(state);

        assert.equal(eventsOfType(events, 'damage')[0]?.amount, 60);
        assert.equal(getAvailableActions(state)[0]?.preview.damage, 120);
        assert.equal(eventsOfType(events, 'passive_triggered').length, 0);
    });

    it('crit_chance_bonus soma à chance de crítico quando a condição vale', () => {
        const state = duel({ type: 'crit_chance_bonus', amount: 1, when: { type: 'target_has_status', statuses: ['poison'] } });

        assert.equal(eventsOfType(basic(state).events, 'damage')[0]?.critical, false);

        getUnit(state, 'B1').statuses = [status('poison')];

        const hit = eventsOfType(basic(state).events, 'damage')[0];

        assert.equal(hit?.critical, true);
        assert.equal(hit?.amount, 100, 'crítico dobra o dano nos personagens de teste');
    });

    it('ignore_defense: o golpe ignora parte da defesa do alvo', () => {
        // DEF 100 vira 50: 100 x 100 / 150 = 66,7.
        assert.equal(eventsOfType(basic(duel({ type: 'ignore_defense', amount: 0.5 })).events, 'damage')[0]?.amount, 67);
    });

    it('atk_from_def: a defesa de quem bate entra no ataque dos golpes, e só dos golpes', () => {
        const heal = skill('a.heal', [{ type: 'heal', power: 1 }], 'self');
        const state = duel({ type: 'atk_from_def', amount: 0.5 }, { skills: [heal] });
        const [attack, healing] = getAvailableActions(state);

        // ATK 100 + metade da DEF 100 = 150.
        assert.equal(eventsOfType(basic(state).events, 'damage')[0]?.amount, 75);
        assert.equal(attack?.preview.damage, 150);
        assert.equal(healing?.preview.heal, 100, 'a cura continua usando o ataque puro');
    });

    it('lifesteal: todo golpe devolve vida, e soma com o roubo de vida da habilidade', () => {
        const bite = skill('a.bite', [{ type: 'damage', power: 1, drain: 0.5 }]);
        const state = duel({ type: 'lifesteal', amount: 0.2 }, { skills: [bite] });

        getUnit(state, 'A1').hp = 5000;

        const plain = basic(state);
        const withDrain = applyAction(state, { unitId: 'A1', skillId: 'a.bite', targetId: 'B1' });

        assert.equal(eventsOfType(plain.events, 'heal')[0]?.amount, 10, '20% de 50');
        assert.equal(eventsOfType(withDrain.events, 'heal')[0]?.amount, 35, '70% de 50');
        assert.equal(eventsOfType(plain.events, 'passive_triggered').length, 0, 'vale em todo golpe: não precisa de aviso');
    });

    it('energy_on_crit: o crítico devolve energia ao time, até o máximo do jogo', () => {
        const state = duel({ type: 'energy_on_crit', amount: 1 }, { stats: { critChance: 1 } });
        const { state: after, events } = basic(state);

        assert.equal(state.energy.A, 3);
        assert.equal(after.energy.A, 4, 'pode passar da energia com que o turno começou');
        assert.deepEqual(eventsOfType(events, 'energy_gained')[0], { type: 'energy_gained', team: 'A', unitId: 'A1', amount: 1, energy: 4 });
        assert.deepEqual(
            events.slice(0, 4).map((event) => event.type),
            ['skill_used', 'damage', 'passive_triggered', 'energy_gained'],
        );

        state.energy.A = MAX_ENERGY;

        const capped = basic(state);

        assert.equal(capped.state.energy.A, MAX_ENERGY);
        assert.equal(eventsOfType(capped.events, 'energy_gained').length, 0);
    });

    it('energy_on_crit: sem crítico, nada acontece', () => {
        const { state, events } = basic(duel({ type: 'energy_on_crit', amount: 1 }));

        assert.equal(state.energy.A, 3);
        assert.equal(eventsOfType(events, 'energy_gained').length, 0);
    });

    it('status_power: aumenta o valor dos status daquele tipo que a unidade aplica', () => {
        const venom = skill('a.venom', [
            { type: 'status', status: 'poison', turns: 2, power: 0.5 },
            { type: 'status', status: 'burn', turns: 2, power: 0.5 },
        ]);
        const state = duel({ type: 'status_power', statuses: ['poison'], amount: 0.4 }, { skills: [venom] });
        const { events } = applyAction(state, { unitId: 'A1', skillId: 'a.venom', targetId: 'B1' });

        assert.deepEqual(
            eventsOfType(events, 'status_applied').map((event) => [event.status, event.value]),
            [['poison', 70], ['burn', 50]],
        );
    });

    it('uma batalha gravada antes das passivas (unidades sem o campo) continua jogável', () => {
        const state = duel({ type: 'damage_bonus', amount: 1 });

        for (const unit of state.units) {
            delete unit.passives;
        }

        assert.equal(eventsOfType(basic(state).events, 'damage')[0]?.amount, 50);
    });
});

describe('passivas de começo de vez', () => {
    const aura: PassiveEffect = { type: 'turn_start', target: 'all-allies', effects: [{ type: 'heal', power: 0.3 }] };
    const roots: PassiveEffect = {
        type: 'turn_start',
        target: 'fastest-enemy',
        effects: [
            { type: 'damage', power: 1 },
            { type: 'status', status: 'speed_down', turns: 1, power: 0.5 },
        ],
    };

    /** Joga ataques básicos até chegar de novo a vez de A1. Devolve os eventos da jogada que a chamou. */
    function untilNextTurnOfA1(start: BattleState) {
        let result = basicAttackTurn(start);

        for (let i = 0; result.state.activeUnitId !== 'A1'; i++) {
            assert.ok(i < 20, 'a vez de A1 nunca chegou');
            result = basicAttackTurn(result.state);
        }

        return result;
    }

    function auraTeam() {
        return createBattle({
            teamA: [makeCharacter('a', { speed: 200 }, [], [passive(aura)]), makeCharacter('a2', { speed: 50 })],
            teamB: [makeCharacter('b', { speed: 100 })],
            seed: 1,
        });
    }

    it('cura em área: age quando chega a vez da unidade, só em quem está ferido', () => {
        const opening = auraTeam();

        assert.equal(eventsOfType(opening.events, 'passive_triggered').length, 0, 'ninguém ferido: a passiva nem é anunciada');

        getUnit(opening.state, 'A2').hp = 500;

        // A1 bate, B1 bate em A1 (50 de dano), A2 bate, e começa o turno 2 com A1.
        const { state, events } = untilNextTurnOfA1(opening.state);
        const from = events.findIndex((event) => event.type === 'unit_activated' && event.unitId === 'A1');

        assert.deepEqual(events.slice(from).map((event) => event.type), ['unit_activated', 'passive_triggered', 'heal', 'heal']);
        assert.deepEqual(eventsOfType(events, 'passive_triggered')[0]?.targetIds, ['A1', 'A2']);
        assert.equal(getUnit(state, 'A1').hp, 980, '950 + 30');
        assert.equal(getUnit(state, 'A2').hp, 530);
    });

    it('unidade atordoada perde a vez e a passiva junto', () => {
        const { state: opening } = auraTeam();

        getUnit(opening, 'A2').hp = 500;
        // O atordoamento é gasto quando A1 termina esta vez; para valer na próxima, dura 2.
        getUnit(opening, 'A1').statuses = [{ kind: 'stun', turns: 2, value: 0, sourceId: 'B1', appliedOnStep: 0 }];

        let result = basicAttackTurn(opening);

        while (result.state.turn === 1) {
            result = basicAttackTurn(result.state);
        }

        assert.equal(eventsOfType(result.events, 'unit_skipped')[0]?.unitId, 'A1');
        assert.equal(eventsOfType(result.events, 'passive_triggered').length, 0);
    });

    it('golpe no inimigo mais veloz: causa dano, aplica o status e reordena quem ainda não agiu', () => {
        // Ordem do turno 1 sem a passiva: A1 (200), B1 (150), B2 (120), A2 (100).
        const { state, events } = createBattle({
            teamA: [makeCharacter('a', { speed: 200 }, [], [passive(roots)]), makeCharacter('a2', { speed: 100 })],
            teamB: [makeCharacter('b', { speed: 150 }), makeCharacter('b2', { speed: 120 })],
            seed: 1,
        });

        assert.deepEqual(eventsOfType(events, 'passive_triggered')[0]?.targetIds, ['B1']);
        assert.equal(getUnit(state, 'B1').hp, 950);
        assert.equal(getUnit(state, 'B1').statuses[0]?.kind, 'speed_down');
        // B1 caiu para 75 de velocidade: vai para o fim da fila já neste turno.
        assert.deepEqual(state.order, ['A1', 'B2', 'A2', 'B1']);
        assert.equal(events[events.length - 1]?.type, 'order_changed');
        assert.equal(state.activeUnitId, 'A1', 'a passiva não gasta a vez: A1 ainda vai agir');
    });

    it('o golpe da passiva pode derrubar o último inimigo e encerrar a batalha', () => {
        const opening = createBattle({
            teamA: [makeCharacter('a', { speed: 200 }, [], [passive(roots)])],
            teamB: [makeCharacter('b', { speed: 100 })],
            seed: 1,
        }).state;

        getUnit(opening, 'B1').hp = 60;

        // A1 bate (50), B1 fica com 10 e bate de volta; na vez seguinte de A1 a passiva termina o serviço.
        const { state, events } = untilNextTurnOfA1FinishOrNot(opening);

        assert.equal(state.winner, 'A');
        assert.equal(state.activeUnitId, null);
        assert.deepEqual(events.slice(-4).map((event) => event.type), ['passive_triggered', 'damage', 'unit_defeated', 'battle_ended']);
    });

    function untilNextTurnOfA1FinishOrNot(start: BattleState) {
        let result = basicAttackTurn(start);

        for (let i = 0; result.state.winner === null && i < 20; i++) {
            result = basicAttackTurn(result.state);
        }

        return result;
    }
});

describe('passivas do catálogo', () => {
    it('Clérigo: a Aura Restauradora cura os aliados feridos a cada vez dele, sem gastar energia', () => {
        const opening = createBattle({ teamA: [getCharacter('clerigo'), getCharacter('cavaleiro')], teamB: [getCharacter('guardiao')], seed: 1 }).state;

        assert.equal(opening.activeUnitId, 'A1');
        assert.ok(!getCharacter('clerigo').skills.some((item) => item.id === 'clerigo.luz-restauradora'), 'a habilidade virou passiva');

        getUnit(opening, 'A2').hp = 500;

        let result = applyAction(opening, { unitId: 'A1', skillId: 'clerigo.raio-de-luz', targetId: 'B1' });

        while (result.state.activeUnitId !== 'A1') {
            const actor = getUnit(result.state, result.state.activeUnitId ?? '');
            const target = result.state.units.find((unit) => unit.team !== actor.team);

            result = applyAction(result.state, { unitId: actor.id, skillId: actor.skills[0]?.id ?? '', targetId: target?.id ?? '' });
        }

        const trigger = eventsOfType(result.events, 'passive_triggered')[0];

        assert.equal(trigger?.passiveId, 'clerigo.aura-restauradora');
        assert.ok(trigger?.targetIds.includes('A2'));
        assert.equal(result.state.energy.A, result.state.turnEnergy, 'a passiva não custa energia');
        // ATK 160 x 0,2 = 32 de cura.
        assert.ok(eventsOfType(result.events, 'heal').some((event) => event.targetId === 'A2' && event.amount === 32));
    });

    it('Dríade: as Raízes Enredantes acertam sozinhas o inimigo mais veloz', () => {
        const { events } = createBattle({ teamA: [getCharacter('driade')], teamB: [getCharacter('cavaleiro'), getCharacter('criomante')], seed: 1 });
        const trigger = eventsOfType(events, 'passive_triggered')[0];

        assert.equal(trigger?.passiveId, 'driade.raizes-enredantes');
        assert.deepEqual(trigger?.targetIds, ['B2'], 'a Criomante (108) é mais veloz que o Cavaleiro (88)');
        assert.equal(eventsOfType(events, 'damage')[0]?.targetId, 'B2');
        assert.deepEqual(
            eventsOfType(events, 'status_applied').map((event) => [event.targetId, event.status, event.turns, event.value]),
            [['B2', 'speed_down', 1, 0.2]],
        );
    });

    it('Vampiro: até o ataque básico rouba vida', () => {
        const opening = createBattle({ teamA: [getCharacter('vampiro')], teamB: [getCharacter('cavaleiro')], seed: 1 }).state;

        getUnit(opening, 'A1').hp = 100;

        const { events } = applyAction(opening, { unitId: 'A1', skillId: 'vampiro.garras', targetId: 'B1' });
        const hit = eventsOfType(events, 'damage')[0];

        assert.equal(eventsOfType(events, 'heal')[0]?.amount, Math.round((hit?.amount ?? 0) * 0.3));
    });
});
