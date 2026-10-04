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

    it('damage_per_drain: cada cura recebida por roubo de vida vira uma carga, e cada carga aumenta o dano', () => {
        const bite = skill('a.bite', [{ type: 'damage', power: 1, drain: 0.5 }]);
        const state = duel({ type: 'damage_per_drain', amount: 0.05 }, { skills: [bite] });

        // Com a vida cheia não há o que curar: sem cura, sem carga.
        const full = applyAction(state, { unitId: 'A1', skillId: 'a.bite', targetId: 'B1' });

        assert.equal(getUnit(full.state, 'A1').passiveStacks ?? 0, 0);
        assert.equal(eventsOfType(full.events, 'passive_triggered').length, 0);

        getUnit(state, 'A1').hp = 5000;

        const bitten = applyAction(state, { unitId: 'A1', skillId: 'a.bite', targetId: 'B1' });

        assert.equal(getUnit(bitten.state, 'A1').passiveStacks, 1);
        assert.deepEqual(
            bitten.events.slice(0, 4).map((event) => event.type),
            ['skill_used', 'damage', 'heal', 'passive_triggered'],
            'o aviso vem depois dos golpes da ação',
        );
        assert.deepEqual(eventsOfType(bitten.events, 'passive_triggered')[0], {
            type: 'passive_triggered',
            unitId: 'A1',
            passiveId: 'a.passiva',
            targetIds: [],
            stacks: 1,
        });

        // Com 4 cargas: +20% em todo golpe, e a prévia da habilidade já mostra.
        getUnit(state, 'A1').passiveStacks = 4;

        assert.equal(eventsOfType(basic(state).events, 'damage')[0]?.amount, 60);
        assert.equal(getAvailableActions(state)[0]?.preview.damage, 120);
        assert.equal(eventsOfType(basic(state).events, 'passive_triggered').length, 0, 'golpe sem roubo de vida não ganha carga');
    });

    it('damage_per_drain: em área, cada alvo que cura dá uma carga, que já vale no golpe seguinte; `max` limita', () => {
        const feast = skill('a.feast', [{ type: 'damage', power: 1, drain: 0.5 }], 'all-enemies');
        const free = duel({ type: 'damage_per_drain', amount: 0.1 }, { skills: [feast], enemies: 3 });
        const capped = duel({ type: 'damage_per_drain', amount: 0.1, max: 2 }, { skills: [feast], enemies: 3 });

        getUnit(free, 'A1').hp = 5000;
        getUnit(capped, 'A1').hp = 5000;

        const feastFree = applyAction(free, { unitId: 'A1', skillId: 'a.feast' });
        const feastCapped = applyAction(capped, { unitId: 'A1', skillId: 'a.feast' });

        // 50, depois 50 x 1,1 e 50 x 1,2.
        assert.deepEqual(eventsOfType(feastFree.events, 'damage').map((event) => event.amount), [50, 55, 60]);
        assert.deepEqual(eventsOfType(feastFree.events, 'passive_triggered').map((event) => event.stacks), [3], 'um aviso só, com o total');
        assert.equal(getUnit(feastCapped.state, 'A1').passiveStacks, 2);
    });

    it('damage_per_missing_hp: cada 1% de vida perdida aumenta o dano, e o bônus acompanha a vida', () => {
        // A tem 10.000 de vida máxima neste duelo.
        const state = duel({ type: 'damage_per_missing_hp', amount: 1 });

        assert.equal(eventsOfType(basic(state).events, 'damage')[0]?.amount, 50, 'vida cheia: sem bônus');
        assert.equal(eventsOfType(basic(state).events, 'passive_triggered').length, 0, 'vale em todo golpe: não é anunciada');

        getUnit(state, 'A1').hp = 6000;

        assert.equal(eventsOfType(basic(state).events, 'damage')[0]?.amount, 70, '40% da vida perdida: +40%');
        assert.equal(getAvailableActions(state)[0]?.preview.damage, 140, 'a prévia da habilidade já mostra');

        // Só pontos inteiros de porcentagem contam: 40,99% perdidos ainda valem 40.
        getUnit(state, 'A1').hp = 5901;
        assert.equal(eventsOfType(basic(state).events, 'damage')[0]?.amount, 70);

        getUnit(state, 'A1').hp = 1;
        assert.equal(eventsOfType(basic(state).events, 'damage')[0]?.amount, 100, 'por um fio: +99%, arredondado no dano');

        // Curado, o bônus cai de volta.
        getUnit(state, 'A1').hp = 9000;
        assert.equal(eventsOfType(basic(state).events, 'damage')[0]?.amount, 55);

        const half = duel({ type: 'damage_per_missing_hp', amount: 0.5 });

        getUnit(half, 'A1').hp = 6000;
        assert.equal(eventsOfType(basic(half).events, 'damage')[0]?.amount, 60, 'amount 0,5: +20% com 40% perdidos');
    });

    it('status_on_hit: todo golpe também aplica o status, depois do dano, e não troca um status mais forte', () => {
        const state = duel({ type: 'status_on_hit', status: 'def_down', turns: 2, power: 0.2 });
        const first = basic(state);

        assert.deepEqual(
            first.events.slice(0, 4).map((event) => event.type),
            ['skill_used', 'damage', 'status_applied', 'statuses_changed'],
        );
        assert.equal(eventsOfType(first.events, 'damage')[0]?.amount, 50, 'o golpe que aplica o status ainda não aproveita a defesa menor');
        assert.deepEqual(
            getUnit(first.state, 'B1').statuses.map((status) => [status.kind, status.turns, status.value]),
            [['def_down', 2, 0.2]],
        );
        assert.equal(eventsOfType(first.events, 'passive_triggered').length, 0, 'vale em todo golpe: o status aplicado já é o aviso');

        // Alvo já com a defesa reduzida em 20%: DEF 80, e 100 x 100 / 180 = 56.
        getUnit(state, 'B1').statuses = [{ kind: 'def_down', turns: 1, value: 0.2, sourceId: 'A1', appliedOnStep: 0 }];

        const second = basic(state);

        assert.equal(eventsOfType(second.events, 'damage')[0]?.amount, 56);
        assert.equal(getUnit(second.state, 'B1').statuses[0]?.appliedOnStep, 1, 'mesmo valor: o golpe renova a duração');

        // Um status igual e mais forte, de outra fonte, não é trocado pelo mais fraco.
        getUnit(state, 'B1').statuses = [{ kind: 'def_down', turns: 1, value: 0.5, sourceId: 'X', appliedOnStep: 0 }];

        const third = basic(state);

        assert.equal(eventsOfType(third.events, 'status_applied').length, 0);
        assert.equal(getUnit(third.state, 'B1').statuses[0]?.value, 0.5);
    });

    it('status_on_hit: em área aplica em cada alvo atingido, e alvo derrubado não recebe status', () => {
        const area = skill('a.area', [{ type: 'damage', power: 1 }], 'all-enemies');
        const state = duel({ type: 'status_on_hit', status: 'def_down', turns: 2, power: 0.2 }, { skills: [area], enemies: 3 });

        getUnit(state, 'B2').hp = 10;

        const { events } = applyAction(state, { unitId: 'A1', skillId: 'a.area' });

        assert.deepEqual(eventsOfType(events, 'status_applied').map((event) => event.targetId), ['B1', 'B3']);
    });

    it('uma passiva pode ter mais de um efeito (`also`), e todos valem', () => {
        const state = createBattle({
            teamA: [
                makeCharacter('a', { speed: 200 }, [], [
                    {
                        ...passive({ type: 'damage_bonus', amount: 0.5, when: { type: 'target_hp_above', ratio: 0.7 } }),
                        also: [{ type: 'status_on_hit', status: 'def_down', turns: 2, power: 0.2 }],
                    },
                ]),
            ],
            teamB: [makeCharacter('b', { speed: 100, maxHp: 10_000 })],
            seed: 1,
        }).state;
        const { events } = basic(state);

        assert.equal(eventsOfType(events, 'damage')[0]?.amount, 75);
        assert.equal(eventsOfType(events, 'status_applied')[0]?.status, 'def_down');
        assert.equal(eventsOfType(events, 'passive_triggered').length, 1, 'o bônus com condição é anunciado uma vez');
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

    it('o status passive_up fortalece a cura e o dano da passiva, mas não os status que ela aplica', () => {
        const { state: opening } = auraTeam();

        getUnit(opening, 'A2').hp = 500;
        getUnit(opening, 'A1').statuses = [{ kind: 'passive_up', turns: 3, value: 0.8, sourceId: 'A1', appliedOnStep: 0 }];

        const healed = untilNextTurnOfA1(opening);

        // 30 de cura com 80% a mais = 54. (A1 só tinha perdido 50, então a cura dele para aí.)
        assert.deepEqual(
            eventsOfType(healed.events, 'heal').map((event) => [event.targetId, event.amount]),
            [['A1', 50], ['A2', 54]],
        );

        const strike = createBattle({
            teamA: [makeCharacter('a', { speed: 200 }, [], [passive(roots)])],
            teamB: [makeCharacter('b', { speed: 100, maxHp: 10_000 })],
            seed: 1,
        }).state;

        getUnit(strike, 'A1').statuses = [{ kind: 'passive_up', turns: 3, value: 0.8, sourceId: 'A1', appliedOnStep: 0 }];

        const hit = untilNextTurnOfA1(strike);

        // 50 de dano com 80% a mais = 90; a lentidão continua em 50%.
        assert.equal(eventsOfType(hit.events, 'damage').find((event) => event.sourceId === 'A1' && event.targetId === 'B1' && event.amount === 90)?.amount, 90);
        assert.ok(eventsOfType(hit.events, 'status_applied').every((event) => event.value === 0.5));
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

describe('status que cresce (status_growth)', () => {
    // ATK 100 x 0,5 = 50 de veneno por turno, no valor original.
    const venom = skill('a.venom', [{ type: 'status', status: 'poison', turns: 3, power: 0.5 }]);
    const growth: PassiveEffect = { type: 'status_growth', statuses: ['poison'], amount: 0.6 };

    /** Joga a vez de A1 com a habilidade dada e a de B1 com o ataque básico. Devolve o dano do veneno em B1 nesse caminho. */
    function round(state: BattleState, skillId: string): { state: BattleState; ticks: number[] } {
        const first = applyAction(state, { unitId: 'A1', skillId, targetId: 'B1' });
        const second = basicAttackTurn(first.state);

        return { state: second.state, ticks: eventsOfType([...first.events, ...second.events], 'status_damage').map((event) => event.amount) };
    }

    it('o primeiro dano é o normal e cada turno seguinte soma a fração do valor original', () => {
        const applied = applyAction(duel(growth, { skills: [venom] }), { unitId: 'A1', skillId: 'a.venom', targetId: 'B1' });

        // O veneno já causou dano uma vez (a vez de B1 veio em seguida).
        assert.deepEqual(eventsOfType(applied.events, 'status_damage').map((event) => event.amount), [50]);
        assert.deepEqual(getUnit(applied.state, 'B1').statuses, [
            { kind: 'poison', turns: 3, value: 50, sourceId: 'A1', growth: 0.6, ticks: 1, appliedOnStep: 1 },
        ]);

        let state = basicAttackTurn(applied.state).state;
        const ticks: number[] = [];

        for (let i = 0; i < 3; i++) {
            const played = round(state, 'a.basic');

            state = played.state;
            ticks.push(...played.ticks);
        }

        // 50, depois 50 x 1,6 e 50 x 2,2; o veneno durava 3 turnos e acabou.
        assert.deepEqual(ticks, [80, 110]);
        assert.deepEqual(getUnit(state, 'B1').statuses, []);
    });

    it('avisa a tela depois de cada dano, com a conta atualizada', () => {
        const { events } = applyAction(duel(growth, { skills: [venom] }), { unitId: 'A1', skillId: 'a.venom', targetId: 'B1' });
        const tick = events.findIndex((event) => event.type === 'status_damage');
        const next = events[tick + 1];

        assert.equal(next?.type, 'statuses_changed');
        assert.equal(next?.type === 'statuses_changed' ? next.statuses[0]?.ticks : undefined, 1);
    });

    it('renovar o veneno antes de ele acabar mantém o crescimento', () => {
        let state = duel(growth, { skills: [venom] });
        const ticks: number[] = [];

        for (let i = 0; i < 4; i++) {
            const played = round(state, 'a.venom');

            state = played.state;
            ticks.push(...played.ticks);
        }

        assert.deepEqual(ticks, [50, 80, 110, 140]);
        assert.equal(getUnit(state, 'B1').statuses[0]?.turns, 2, 'a duração foi renovada');
    });

    it('se o veneno acabar, o próximo recomeça do normal', () => {
        let state = duel(growth, { skills: [venom] });
        const ticks: number[] = [];

        for (const skillId of ['a.venom', 'a.basic', 'a.basic', 'a.venom']) {
            const played = round(state, skillId);

            state = played.state;
            ticks.push(...played.ticks);
        }

        assert.deepEqual(ticks, [50, 80, 110, 50]);
    });

    it('o crescimento continua quando um aliado sem a passiva renova o veneno, com o valor dele', () => {
        const weak = skill('ally.venom', [{ type: 'status', status: 'poison', turns: 3, power: 0.3 }]);
        let state = createBattle({
            teamA: [
                makeCharacter('a', { speed: 200, maxHp: 10_000 }, [venom], [passive(growth)]),
                makeCharacter('ally', { speed: 150, maxHp: 10_000 }, [weak]),
            ],
            teamB: [makeCharacter('b1', { maxHp: 10_000 })],
            seed: 1,
        }).state;

        state = applyAction(state, { unitId: 'A1', skillId: 'a.venom', targetId: 'B1' }).state;

        // Sozinho, o aliado aplicaria um veneno comum de 30.
        const renewed = applyAction(state, { unitId: 'A2', skillId: 'ally.venom', targetId: 'B1' });

        assert.deepEqual(eventsOfType(renewed.events, 'status_damage').map((event) => event.amount), [30]);

        state = basicAttackTurn(renewed.state).state;
        state = applyAction(state, { unitId: 'A1', skillId: 'a.basic', targetId: 'B1' }).state;

        const next = applyAction(state, { unitId: 'A2', skillId: 'ally.basic', targetId: 'B1' });

        // 30 x 1,6: a conta de turnos envenenado seguiu.
        assert.deepEqual(eventsOfType(next.events, 'status_damage').map((event) => event.amount), [48]);
    });

    it('não mexe nos status de outros tipos nem nos de quem não tem a passiva', () => {
        const fire = skill('a.fire', [{ type: 'status', status: 'burn', turns: 3, power: 0.5 }]);
        const { state } = applyAction(duel(growth, { skills: [fire] }), { unitId: 'A1', skillId: 'a.fire', targetId: 'B1' });

        assert.deepEqual(getUnit(state, 'B1').statuses, [{ kind: 'burn', turns: 3, value: 50, sourceId: 'A1', appliedOnStep: 1 }]);
    });
});

describe('golpe de execução (perTargetMissingHp)', () => {
    const execute = skill('a.execute', [{ type: 'damage', power: 1, perTargetMissingHp: 1 }]);

    function hit(state: BattleState, hp: number): number {
        getUnit(state, 'B1').hp = hp;

        return eventsOfType(applyAction(state, { unitId: 'A1', skillId: 'a.execute', targetId: 'B1' }).events, 'damage')[0]?.amount ?? 0;
    }

    function plain(): BattleState {
        return createBattle({
            teamA: [makeCharacter('a', { speed: 200 }, [execute])],
            teamB: [makeCharacter('b1', { maxHp: 10_000 })],
            seed: 1,
        }).state;
    }

    it('causa 1% a mais para cada 1% de vida que o alvo já perdeu', () => {
        assert.equal(hit(plain(), 10_000), 50, 'alvo com a vida cheia: dano normal');
        assert.equal(hit(plain(), 6_000), 70, '40% perdidos: +40%');
        assert.equal(hit(plain(), 1_000), 95, '90% perdidos: +90%');
    });

    it('conta só pontos inteiros de porcentagem', () => {
        assert.equal(hit(plain(), 9_901), 50, '0,99% perdido ainda não soma nada');
        assert.equal(hit(plain(), 9_900), 51);
    });

    it('soma com o bônus de dano das passivas de quem bate', () => {
        // 50 x (1 + 0,5 da passiva + 0,4 do alvo ferido).
        assert.equal(hit(duel({ type: 'damage_bonus', amount: 0.5 }, { skills: [execute] }), 6_000), 95);
    });

    it('os outros golpes não mudam com a vida do alvo', () => {
        const state = plain();

        getUnit(state, 'B1').hp = 100;

        assert.equal(eventsOfType(basic(state).events, 'damage')[0]?.amount, 50);
    });
});

describe('passivas do catálogo', () => {
    it('Sacerdote: a Aura Restauradora cura os aliados feridos a cada vez dele, sem gastar energia', () => {
        const opening = createBattle({ teamA: [getCharacter('sacerdote'), getCharacter('cavaleiro')], teamB: [getCharacter('guardiao')], seed: 1 }).state;

        assert.equal(opening.activeUnitId, 'A1');
        assert.ok(!getCharacter('sacerdote').skills.some((item) => item.id === 'sacerdote.luz-restauradora'), 'a habilidade virou passiva');

        getUnit(opening, 'A2').hp = 500;

        let result = applyAction(opening, { unitId: 'A1', skillId: 'sacerdote.raio-de-luz', targetId: 'B1' });

        while (result.state.activeUnitId !== 'A1') {
            const actor = getUnit(result.state, result.state.activeUnitId ?? '');
            const target = result.state.units.find((unit) => unit.team !== actor.team);

            result = applyAction(result.state, { unitId: actor.id, skillId: actor.skills[0]?.id ?? '', targetId: target?.id ?? '' });
        }

        const trigger = eventsOfType(result.events, 'passive_triggered')[0];

        assert.equal(trigger?.passiveId, 'sacerdote.aura-restauradora');
        assert.ok(trigger?.targetIds.includes('A2'));
        assert.equal(result.state.energy.A, result.state.turnEnergy, 'a passiva não custa energia');
        // ATK 160 x 0,4 = 64 de cura.
        assert.ok(eventsOfType(result.events, 'heal').some((event) => event.targetId === 'A2' && event.amount === 64));
    });

    it('Sacerdote: depois da Bênção, a Aura Restauradora cura 80% a mais nas duas vezes seguintes, e só nelas', () => {
        // O Cavaleiro inimigo tem vida de sobra para a batalha não acabar no meio do teste.
        let state = createBattle({ teamA: [getCharacter('sacerdote'), getCharacter('cavaleiro')], teamB: [getCharacter('cavaleiro')], seed: 1 }).state;

        /** Joga até a próxima vez do Sacerdote e devolve quanto a aura curou o Cavaleiro (A2) nela. */
        function nextAuraHeal(first: { skillId: string; targetId?: string }): number {
            // Mantém o Cavaleiro bem ferido, para a cura nunca ser cortada pela vida máxima.
            getUnit(state, 'A2').hp = 300;
            state.energy.A = 10;

            let result = applyAction(state, { unitId: 'A1', ...first });

            while (result.state.activeUnitId !== 'A1') {
                const actor = getUnit(result.state, result.state.activeUnitId ?? '');
                const target = result.state.units.find((unit) => unit.team !== actor.team && unit.hp > 0);

                getUnit(result.state, 'A2').hp = 300;
                result = applyAction(result.state, { unitId: actor.id, skillId: actor.skills[0]?.id ?? '', targetId: target?.id ?? '' });
            }

            state = result.state;

            const from = result.events.findIndex((event) => event.type === 'passive_triggered' && event.passiveId === 'sacerdote.aura-restauradora');

            return eventsOfType(result.events.slice(from), 'heal').find((event) => event.targetId === 'A2')?.amount ?? 0;
        }

        const attack = { skillId: 'sacerdote.raio-de-luz', targetId: 'B1' };

        // Sem a Bênção: ATK 160 x 0,4 = 64.
        assert.equal(nextAuraHeal(attack), 64);

        // Com a Bênção o ataque do Sacerdote sobe 20% (192 x 0,4 = 76,8) e a aura cura 80% a mais: 138.
        assert.equal(nextAuraHeal({ skillId: 'sacerdote.bencao' }), 138);
        assert.equal(getUnit(state, 'A1').statuses.find((status) => status.kind === 'passive_up')?.turns, 2);
        assert.equal(nextAuraHeal(attack), 138);
        assert.equal(getUnit(state, 'A1').statuses.find((status) => status.kind === 'passive_up')?.turns, 1);

        // Terceira vez depois da Bênção: os efeitos dela acabaram e a aura volta ao normal.
        assert.equal(nextAuraHeal(attack), 64);
        assert.equal(getUnit(state, 'A1').statuses.length, 0);
    });

    it('Bárbaro: tem duas passivas, e ferido ele bate mais forte', () => {
        const opening = createBattle({ teamA: [getCharacter('barbaro')], teamB: [getCharacter('cavaleiro')], seed: 1 }).state;

        assert.deepEqual(getCharacter('barbaro').passives.map((item) => item.id), ['barbaro.sede-de-batalha', 'barbaro.sangue-quente']);
        assert.equal(getAvailableActions(opening)[0]?.preview.damage, 167, 'vida cheia: 185 x 0,9');

        // 650 de vida máxima; com 325, perdeu 50%.
        getUnit(opening, 'A1').hp = 325;

        assert.equal(getAvailableActions(opening)[0]?.preview.damage, 250, '185 x 0,9 x 1,5');
    });

    it('Arqueiro: bate 50% mais forte em quem está acima de 70% da vida, e todo golpe reduz a defesa por 2 turnos', () => {
        const opening = createBattle({ teamA: [getCharacter('arqueiro')], teamB: [getCharacter('cavaleiro'), getCharacter('guardiao')], seed: 1 }).state;

        opening.activeUnitId = 'A1';
        opening.energy.A = 10;
        // Sem crítico, para as contas baterem.
        getUnit(opening, 'A1').stats.critChance = 0;

        // Flecha no Cavaleiro com a vida cheia: 220 x 100 / 190 = 115,8; com 50% a mais, 174.
        const fresh = applyAction(opening, { unitId: 'A1', skillId: 'arqueiro.flecha', targetId: 'B1' });

        assert.equal(eventsOfType(fresh.events, 'damage')[0]?.amount, 174);
        assert.deepEqual(
            eventsOfType(fresh.events, 'status_applied').map((event) => [event.targetId, event.status, event.turns, event.value]),
            [['B1', 'def_down', 2, 0.2]],
        );

        // Cavaleiro com 60% da vida: sem o bônus, 116.
        getUnit(opening, 'B1').hp = 780;

        assert.equal(eventsOfType(applyAction(opening, { unitId: 'A1', skillId: 'arqueiro.flecha', targetId: 'B1' }).events, 'damage')[0]?.amount, 116);

        // A Chuva de Flechas reduz a defesa de todos os atingidos.
        const rain = applyAction(opening, { unitId: 'A1', skillId: 'arqueiro.chuva-de-flechas' });

        assert.deepEqual(eventsOfType(rain.events, 'status_applied').map((event) => [event.targetId, event.status]), [['B1', 'def_down'], ['B2', 'def_down']]);
    });

    it('Dríade: as Raízes Enredantes acertam sozinhas o inimigo mais veloz', () => {
        const { events } = createBattle({ teamA: [getCharacter('driade')], teamB: [getCharacter('cavaleiro'), getCharacter('criomante')], seed: 1 });
        const trigger = eventsOfType(events, 'passive_triggered')[0];

        const damage = eventsOfType(events, 'damage')[0];

        assert.equal(trigger?.passiveId, 'driade.raizes-enredantes');
        assert.deepEqual(trigger?.targetIds, ['B2'], 'a Criomante (108) é mais veloz que o Cavaleiro (88)');
        assert.equal(damage?.targetId, 'B2');
        // 100% do ataque: ATK 170 x 100 / (100 + 35 de defesa) = 126.
        assert.equal(damage?.critical, false);
        assert.equal(damage?.amount, 126);
        assert.deepEqual(
            eventsOfType(events, 'status_applied').map((event) => [event.targetId, event.status, event.turns, event.value]),
            [['B2', 'speed_down', 1, 0.2]],
        );
    });

    it('Vampiro: cada cura da Mordida ou do Banquete de Sangue aumenta o dano dele em 5%', () => {
        const opening = createBattle({ teamA: [getCharacter('vampiro')], teamB: [getCharacter('cavaleiro'), getCharacter('guardiao')], seed: 1 }).state;

        // Põe a vez no Vampiro, ferido e com energia, para testar só a passiva.
        opening.activeUnitId = 'A1';
        opening.energy.A = 10;
        getUnit(opening, 'A1').hp = 100;

        const claws = applyAction(opening, { unitId: 'A1', skillId: 'vampiro.garras', targetId: 'B1' });

        assert.equal(eventsOfType(claws.events, 'heal').length, 0, 'as Garras não roubam vida');
        assert.equal(getUnit(claws.state, 'A1').passiveStacks ?? 0, 0);

        const bite = applyAction(opening, { unitId: 'A1', skillId: 'vampiro.mordida', targetId: 'B1' });

        assert.equal(getUnit(bite.state, 'A1').passiveStacks, 1);

        const feast = applyAction(opening, { unitId: 'A1', skillId: 'vampiro.banquete-de-sangue' });

        assert.equal(getUnit(feast.state, 'A1').passiveStacks, 2, 'dois inimigos atingidos, duas curas');
        assert.deepEqual(eventsOfType(feast.events, 'passive_triggered').map((event) => [event.passiveId, event.stacks]), [['vampiro.sede-de-sangue', 2]]);
    });

    it('Ladino: o Golpe Fatal causa 1% a mais para cada 1% de vida que o alvo perdeu', () => {
        const opening = createBattle({ teamA: [getCharacter('ladino')], teamB: [getCharacter('cavaleiro')], seed: 1 }).state;

        // Põe a vez no Ladino, sem crítico, para a conta ser só a do golpe.
        opening.activeUnitId = 'A1';
        getUnit(opening, 'A1').stats.critChance = 0;

        const fatal = (hp: number) => {
            getUnit(opening, 'B1').hp = hp;

            return eventsOfType(applyAction(opening, { unitId: 'A1', skillId: 'ladino.golpe-fatal', targetId: 'B1' }).events, 'damage')[0]?.amount;
        };

        // ATK 200 x 2,3 x 100 / (100 + 90 de defesa) = 242; com metade da vida perdida, 50% a mais.
        assert.equal(fatal(1300), 242);
        assert.equal(fatal(650), 363);
    });

    it('Piromante: a Chuva de Meteoros deixa todos os atingidos queimando por 2 turnos', () => {
        const opening = createBattle({ teamA: [getCharacter('piromante')], teamB: [getCharacter('cavaleiro'), getCharacter('guardiao')], seed: 1 }).state;

        opening.activeUnitId = 'A1';

        const { state, events } = applyAction(opening, { unitId: 'A1', skillId: 'piromante.chuva-de-meteoros' });
        const burns = eventsOfType(events, 'status_applied').filter((event) => event.status === 'burn');

        // Mesma queimadura da Bola de Fogo: ATK 205 x 0,3.
        assert.deepEqual(burns.map((event) => [event.targetId, event.turns, event.value]), [['B1', 2, 62], ['B2', 2, 62]]);
        assert.ok(getUnit(state, 'B2').statuses.some((item) => item.kind === 'def_down'), 'a redução de defesa continua');
    });

    it('Guardião: a Nuvem de Esporos envenena todos os inimigos no começo da batalha, uma vez só, e esse veneno também cresce', () => {
        const opening = createBattle({
            teamA: [getCharacter('guardiao')],
            teamB: [getCharacter('cavaleiro'), getCharacter('ladino'), getCharacter('sacerdote')],
            seed: 1,
        });
        const cloud = eventsOfType(opening.events, 'passive_triggered').filter((event) => event.passiveId === 'guardiao.nuvem-de-esporos');
        const poisons = eventsOfType(opening.events, 'status_applied').filter((event) => event.status === 'poison');

        // ATK 190 x 0,15 = 29 por turno, em todos: o Ladino escondido não escapa (não é golpe de alvo único).
        assert.deepEqual(cloud.map((event) => [event.unitId, event.targetIds]), [['A1', ['B1', 'B2', 'B3']]]);
        assert.deepEqual(poisons.map((event) => [event.targetId, event.turns, event.value]), [['B1', 3, 29], ['B2', 3, 29], ['B3', 3, 29]]);
        assert.ok(getUnit(opening.state, 'B2').statuses.some((item) => item.kind === 'stealth'), 'ser envenenado não revela: só o dano revela');

        // O Guardião bate sempre no Cavaleiro (B1); o Sacerdote (B3) fica só com o veneno da abertura.
        let result = { state: opening.state, events: opening.events };
        // O Sacerdote é o primeiro da fila: o primeiro dano do veneno já sai na abertura.
        const ticks = eventsOfType(opening.events, 'status_damage').filter((event) => event.targetId === 'B3').map((event) => event.amount);
        let clouds = 0;

        // Vida de sobra, para ele aguentar os três até o veneno acabar.
        getUnit(result.state, 'A1').stats.maxHp = 10_000;
        getUnit(result.state, 'A1').hp = 10_000;

        for (let i = 0; result.state.winner === null && result.state.turn <= 5 && i < 40; i++) {
            const actor = getUnit(result.state, result.state.activeUnitId ?? '');

            result = applyAction(result.state, { unitId: actor.id, skillId: actor.skills[0]?.id ?? '', targetId: actor.team === 'A' ? 'B1' : 'A1' });
            ticks.push(...eventsOfType(result.events, 'status_damage').filter((event) => event.targetId === 'B3').map((event) => event.amount));
            clouds += eventsOfType(result.events, 'passive_triggered').filter((event) => event.passiveId === 'guardiao.nuvem-de-esporos').length;
        }

        // 29, depois 29 x 1,6 e 29 x 2,2 (Toxina Potente). Acabou o veneno, acabou: a nuvem não volta nos turnos seguintes.
        assert.deepEqual(ticks, [29, 46, 64]);
        assert.ok(result.state.turn > 5);
        assert.equal(clouds, 0);
    });

    it('Guardião: as Raízes causam dano e envenenam por 3 turnos; renovado a cada golpe, o veneno não para de crescer', () => {
        const opening = createBattle({ teamA: [getCharacter('guardiao')], teamB: [getCharacter('cavaleiro')], seed: 1 }).state;

        assert.equal(opening.activeUnitId, 'A1', 'o Guardião é mais veloz que o Cavaleiro');
        assert.deepEqual(getCharacter('guardiao').skills.map((skill) => skill.id), ['guardiao.raizes', 'guardiao.seiva']);

        let result = applyAction(opening, { unitId: 'A1', skillId: 'guardiao.raizes', targetId: 'B1' });
        const poison = eventsOfType(result.events, 'status_applied').find((event) => event.status === 'poison');
        const ticks = eventsOfType(result.events, 'status_damage').map((event) => event.amount);

        // ATK 190 x 100 / (100 + 90 de defesa) = 100 de dano, e o veneno de 190 x 0,55 = 105 no lugar do da abertura.
        assert.equal(eventsOfType(result.events, 'damage')[0]?.amount, 100);
        assert.deepEqual([poison?.targetId, poison?.turns, poison?.value], ['B1', 3, 105]);

        for (let i = 0; i < 7; i++) {
            const actor = getUnit(result.state, result.state.activeUnitId ?? '');

            result = applyAction(result.state, { unitId: actor.id, skillId: actor.skills[0]?.id ?? '', targetId: actor.team === 'A' ? 'B1' : 'A1' });
            ticks.push(...eventsOfType(result.events, 'status_damage').map((event) => event.amount));
        }

        // 105, depois 105 x 1,6, x 2,2 e x 2,8: como o alvo nunca fica sem veneno, a conta não zera.
        assert.deepEqual(ticks, [105, 168, 231, 294]);
    });
});
