import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chooseAction } from '../ai';
import { getCharacter } from '../data/characters';
import { applyAction, BASE_FORM, createBattle, getAvailableActions, getUnit } from '../engine';
import type { BattleResult, BattleState, CharacterDefinition } from '../types';
import { eventsOfType, makeCharacter } from './helpers';

/*
 * Transformações: o Druida do catálogo (humano, urso e lobo) e um personagem
 * de teste sem a passiva de ação extra, para a regra geral.
 */

const druida = getCharacter('druida');
const urso = druida.forms?.find((form) => form.id === 'urso');
const lobo = druida.forms?.find((form) => form.id === 'lobo');

/** Druida (A1) contra dois Cavaleiros com vida de sobra. A vez começa com o Druida. */
function setup(enemies = 2): BattleState {
    const tough = { ...getCharacter('cavaleiro'), stats: { ...getCharacter('cavaleiro').stats, maxHp: 100_000 } };
    const state = createBattle({ teamA: [druida], teamB: Array.from({ length: enemies }, () => tough), seed: 1 }).state;

    assert.equal(state.activeUnitId, 'A1');
    state.energy.A = 10;

    return state;
}

function use(state: BattleState, skill: string, targetId?: string): BattleResult {
    return applyAction(state, { unitId: 'A1', skillId: `druida.${skill}`, ...(targetId && { targetId }) });
}

/** Joga o ataque básico de quem estiver na vez até voltar a ser a vez de A1. */
function untilDruid(start: BattleState): BattleState {
    let state = start;

    for (let i = 0; state.activeUnitId !== 'A1'; i++) {
        assert.ok(i < 20, 'a vez do Druida nunca chegou');

        const actor = getUnit(state, state.activeUnitId ?? '');

        state = applyAction(state, { unitId: actor.id, skillId: actor.skills[0]?.id ?? '', targetId: 'A1' }).state;
    }

    return state;
}

describe('formas: transformar', () => {
    it('quem tem formas leva para a batalha as formas e a forma original; os outros, não', () => {
        const state = setup();
        const unit = getUnit(state, 'A1');

        assert.equal(unit.form, undefined);
        assert.deepEqual(unit.forms?.map((form) => form.id), ['urso', 'lobo']);
        assert.equal(unit.baseForm?.id, BASE_FORM);
        assert.deepEqual(unit.baseForm?.stats, druida.stats);
        assert.equal(getUnit(state, 'B1').forms, undefined);
        assert.equal(getUnit(state, 'B1').baseForm, undefined);
    });

    it('troca atributos, habilidades e passivas pelos da forma e mantém a proporção da vida', () => {
        const state = setup();

        getUnit(state, 'A1').hp = 410; // metade dos 820 do humano

        const { state: after, events } = use(state, 'forma-de-urso');
        const unit = getUnit(after, 'A1');

        assert.equal(unit.form, 'urso');
        assert.deepEqual(unit.stats, urso?.stats);
        assert.deepEqual(unit.skills.map((skill) => skill.id), ['druida.patada', 'druida.rugido', 'druida.esmagar']);
        assert.deepEqual(unit.passives?.map((passive) => passive.id), ['druida.vigor-do-urso']);
        assert.equal(unit.hp, 650, 'metade dos 1300 do urso');
        assert.deepEqual(eventsOfType(events, 'transformed'), [{ type: 'transformed', unitId: 'A1', form: 'urso', hp: 650 }]);
        assert.deepEqual(unit.statuses, [{ kind: 'form', turns: 3, value: 0, sourceId: 'A1', appliedOnStep: state.step }]);
    });

    it('não altera o estado recebido nem o catálogo', () => {
        const state = setup();
        const before = structuredClone(state);

        use(state, 'forma-de-lobo');

        assert.deepEqual(state, before);
        assert.equal(getCharacter('druida').stats.maxHp, 820);
    });
});

describe('formas: ação extra ao se transformar', () => {
    it('a vez não acaba: o Druida age de novo, já com as habilidades da forma', () => {
        const state = setup();
        const { state: after, events } = use(state, 'forma-de-lobo');

        assert.equal(after.activeUnitId, 'A1');
        assert.equal(after.energy.A, 9, 'a transformação custa 1 de energia');
        assert.deepEqual(eventsOfType(events, 'extra_action'), [{ type: 'extra_action', unitId: 'A1' }]);
        assert.equal(eventsOfType(events, 'unit_activated').length, 0, 'ninguém mais foi chamado');
        assert.deepEqual(getAvailableActions(after).map((option) => option.skill.id), ['druida.mordida', 'druida.dilacerar', 'druida.frenesi']);

        const bite = use(after, 'mordida', 'B1');

        assert.equal(eventsOfType(bite.events, 'damage')[0]?.sourceId, 'A1');
        assert.notEqual(bite.state.activeUnitId, 'A1', 'depois da ação extra a vez passa');
    });

    it('a ação extra conta como outra vez no relógio da batalha (trava contra jogada dupla)', () => {
        const state = setup();

        assert.equal(use(state, 'forma-de-urso').state.step, state.step + 1);
    });

    it('não repete o dano de status nem conta a duração dos outros status duas vezes', () => {
        const state = setup();

        getUnit(state, 'A1').statuses = [
            { kind: 'poison', turns: 3, value: 10, sourceId: 'B1', appliedOnStep: 0 },
            { kind: 'atk_up', turns: 2, value: 0.3, sourceId: 'A1', appliedOnStep: 0 },
        ];

        const shifted = use(state, 'forma-de-lobo');

        assert.equal(eventsOfType(shifted.events, 'status_damage').length, 0);
        assert.deepEqual(getUnit(shifted.state, 'A1').statuses.map((status) => [status.kind, status.turns]), [['poison', 3], ['atk_up', 2], ['form', 3]]);

        const after = use(shifted.state, 'mordida', 'B1').state;

        // No fim da vez (uma só), cada status gasta um turno.
        assert.deepEqual(getUnit(after, 'A1').statuses.map((status) => [status.kind, status.turns]), [['poison', 2], ['atk_up', 1], ['form', 2]]);
    });

    it('a velocidade da forma já vale para quem ainda não agiu neste turno', () => {
        // Um inimigo mais veloz que o urso (92) e mais lento que o humano (112) e o lobo (138).
        const runner = makeCharacter('runner', { speed: 100, maxHp: 100_000 });
        const slow = makeCharacter('slow', { speed: 95, maxHp: 100_000 });
        const state = createBattle({ teamA: [druida, slow], teamB: [runner], seed: 1 }).state;

        assert.deepEqual(state.order, ['A1', 'B1', 'A2']);
        // A ordem de quem espera é pela velocidade deles: a transformação não os troca de lugar.
        assert.deepEqual(use(state, 'forma-de-urso').state.order, ['A1', 'B1', 'A2']);
    });

    it('sem a passiva, a transformação gasta a vez', () => {
        const beast = { id: 'fera', name: 'Fera', stats: { maxHp: 2000, atk: 100, def: 100, speed: 100, critChance: 0, critDamage: 2 }, skills: makeCharacter('shifter').skills, passives: [] };
        const shifter: CharacterDefinition = {
            ...makeCharacter('shifter', { speed: 200 }, [
                { id: 'shifter.shift', name: 'shift', description: '', energyCost: 0, target: 'self', effects: [{ type: 'transform', form: 'fera', turns: 2 }] },
            ]),
            forms: [beast],
        };
        const state = createBattle({ teamA: [shifter], teamB: [makeCharacter('b')], seed: 1 }).state;
        const { state: after, events } = applyAction(state, { unitId: 'A1', skillId: 'shifter.shift' });

        assert.equal(getUnit(after, 'A1').form, 'fera');
        assert.equal(getUnit(after, 'A1').hp, 2000);
        assert.equal(eventsOfType(events, 'extra_action').length, 0);
        assert.equal(after.activeUnitId, 'B1');
        // Aplicada na própria vez e sem ação extra: a duração só começa a contar na vez seguinte.
        assert.equal(getUnit(after, 'A1').statuses[0]?.turns, 2);
    });
});

describe('formas: duração', () => {
    it('dura 3 turnos contando o da transformação, e depois o Druida volta a ser humano', () => {
        let state = use(setup(), 'forma-de-urso').state;
        const turnsLeft: (number | undefined)[] = [];

        // Três vezes agindo como urso: a da transformação e mais duas.
        for (let i = 0; i < 3; i++) {
            assert.equal(getUnit(state, 'A1').form, 'urso', `vez ${i + 1}`);
            turnsLeft.push(getUnit(state, 'A1').statuses.find((status) => status.kind === 'form')?.turns);

            const played = use(state, 'patada', 'B1');

            if (i === 2) {
                assert.deepEqual(eventsOfType(played.events, 'status_expired'), [{ type: 'status_expired', unitId: 'A1', status: 'form' }]);
                assert.equal(eventsOfType(played.events, 'transformed')[0]?.form, null);
            }

            state = untilDruid(played.state);
        }

        const unit = getUnit(state, 'A1');

        assert.deepEqual(turnsLeft, [3, 2, 1]);
        assert.equal(unit.form, undefined);
        assert.deepEqual(unit.stats, druida.stats);
        assert.deepEqual(unit.skills.map((skill) => skill.id), druida.skills.map((skill) => skill.id));
        assert.deepEqual(unit.passives?.map((passive) => passive.id), ['druida.chamado-selvagem']);
        assert.ok(!unit.statuses.some((status) => status.kind === 'form'));
    });

    it('ao voltar, a vida mantém a proporção', () => {
        const shifted = use(setup(), 'forma-de-urso').state;
        const unit = getUnit(shifted, 'A1');

        unit.statuses = unit.statuses.map((status) => ({ ...status, turns: 1 }));
        unit.hp = 325; // um quarto dos 1300

        // O Rugido não causa dano nem cura: a vida só muda pela volta à forma humana.
        const { state } = use(shifted, 'rugido');

        assert.equal(getUnit(state, 'A1').form, undefined);
        assert.equal(getUnit(state, 'A1').hp, 205, 'um quarto dos 820');
    });

    it('humano de novo, pode se transformar outra vez (e ganha a ação extra de novo)', () => {
        const shifted = use(setup(), 'forma-de-lobo').state;
        const unit = getUnit(shifted, 'A1');

        unit.statuses = unit.statuses.map((status) => ({ ...status, turns: 1 }));

        const human = untilDruid(use(shifted, 'mordida', 'B1').state);

        human.energy.A = 10;
        assert.equal(getUnit(human, 'A1').form, undefined);

        const again = use(human, 'forma-de-urso');

        assert.equal(getUnit(again.state, 'A1').form, 'urso');
        assert.equal(again.state.activeUnitId, 'A1');
    });

    it('quem cai transformado não trava a batalha', () => {
        let state = use(setup(1), 'forma-de-lobo').state;

        getUnit(state, 'A1').hp = 1;
        state = use(state, 'mordida', 'B1').state;

        const { state: final } = applyAction(state, { unitId: 'B1', skillId: 'cavaleiro.corte', targetId: 'A1' });

        assert.equal(final.winner, 'B');
        assert.deepEqual(getUnit(final, 'A1').statuses, []);
    });
});

describe('formas: o lobo e o sangramento', () => {
    function wolf(enemies = 2): BattleState {
        const state = use(setup(enemies), 'forma-de-lobo').state;

        // Sem crítico, para as contas serem fixas.
        getUnit(state, 'A1').stats.critChance = 0;

        return state;
    }

    it('todas as habilidades do lobo fazem o alvo sangrar por 2 turnos (30% do ataque por turno)', () => {
        // ATK 215 x 0,3 = 64,5, arredondado para 65.
        for (const [skill, targetId, bleeding] of [['mordida', 'B1', ['B1']], ['dilacerar', 'B2', ['B2']], ['frenesi', undefined, ['B1', 'B2']]] as const) {
            const { state, events } = use(wolf(), skill, targetId);

            for (const unitId of bleeding) {
                const bleed = getUnit(state, unitId).statuses.find((status) => status.kind === 'bleed');

                assert.equal(bleed?.value, 65, `${skill} em ${unitId}`);
            }

            assert.ok(eventsOfType(events, 'status_applied').every((event) => event.status === 'bleed' && event.turns === 2), skill);
        }
    });

    it('o sangramento causa dano no começo da vez do alvo, ignora a defesa e convive com veneno e queimadura', () => {
        const state = wolf(1);

        getUnit(state, 'B1').statuses = [
            { kind: 'poison', turns: 2, value: 10, sourceId: 'A1', appliedOnStep: 0 },
            { kind: 'burn', turns: 2, value: 20, sourceId: 'A1', appliedOnStep: 0 },
        ];

        const { state: after, events } = use(state, 'mordida', 'B1');

        assert.deepEqual(eventsOfType(events, 'status_damage').map((event) => [event.status, event.amount]), [['poison', 10], ['burn', 20], ['bleed', 65]]);
        assert.deepEqual(getUnit(after, 'B1').statuses.map((status) => status.kind), ['poison', 'burn', 'bleed']);
    });

    it('o lobo causa 10% a mais de dano para cada inimigo sangrando', () => {
        const bleed = { kind: 'bleed' as const, turns: 2, value: 65, sourceId: 'A1', appliedOnStep: 0 };
        const bite = (bleeding: string[]) => {
            const state = wolf(3);

            for (const unitId of bleeding) getUnit(state, unitId).statuses = [bleed];

            return eventsOfType(use(state, 'mordida', 'B1').events, 'damage')[0]?.amount;
        };

        // ATK 215 x 100 / (100 + 90 de defesa) = 113; com um, dois e três sangrando, 10%, 20% e 30% a mais.
        assert.deepEqual([bite([]), bite(['B2']), bite(['B2', 'B3']), bite(['B1', 'B2', 'B3'])], [113, 124, 136, 147]);

        // Só os inimigos contam: o próprio lobo sangrando não soma nada.
        const selfBleeding = wolf(3);

        getUnit(selfBleeding, 'A1').statuses = [...getUnit(selfBleeding, 'A1').statuses, bleed];

        assert.equal(eventsOfType(use(selfBleeding, 'mordida', 'B1').events, 'damage')[0]?.amount, 113);
    });

    it('o bônus é contado uma vez por golpe: no Frenesi todos levam o mesmo', () => {
        const fresh = use(wolf(3), 'frenesi');

        // 215 x 0,9 x 100 / 190 = 102 em todos: ninguém sangrava, e o sangramento que o próprio Frenesi causa não conta para ele.
        assert.deepEqual(eventsOfType(fresh.events, 'damage').map((event) => [event.targetId, event.amount]), [['B1', 102], ['B2', 102], ['B3', 102]]);

        // Com um inimigo já sangrando antes do golpe, os três levam os mesmos 10% a mais.
        const state = wolf(3);

        getUnit(state, 'B3').statuses = [{ kind: 'bleed', turns: 2, value: 65, sourceId: 'A1', appliedOnStep: 0 }];

        assert.deepEqual(eventsOfType(use(state, 'frenesi').events, 'damage').map((event) => event.amount), [112, 112, 112]);
    });

    it('no Dilacerar, o segundo golpe já ganha o bônus pelo sangramento que o primeiro causou', () => {
        const first = use(wolf(1), 'dilacerar', 'B1');

        // 215 x 0,85 x 100 / 190 = 96 no primeiro; o alvo sai sangrando e o segundo leva 10% a mais (106).
        assert.deepEqual(eventsOfType(first.events, 'damage').filter((event) => event.sourceId === 'A1').map((event) => event.amount), [96, 106]);

        // Com outro inimigo já sangrando antes, são 10% no primeiro e 20% no segundo.
        const two = wolf(2);

        getUnit(two, 'B2').statuses = [{ kind: 'bleed', turns: 2, value: 65, sourceId: 'A1', appliedOnStep: 0 }];

        assert.deepEqual(eventsOfType(use(two, 'dilacerar', 'B1').events, 'damage').filter((event) => event.sourceId === 'A1').map((event) => event.amount), [106, 115]);

        const again = untilDruid(first.state);

        getUnit(again, 'A1').stats.critChance = 0;

        // Agora o alvo sangra: a Mordida sai com 10% a mais (113 vira 124).
        assert.equal(eventsOfType(use(again, 'mordida', 'B1').events, 'damage')[0]?.amount, 124);
    });

    it('o bônus pelos inimigos sangrando aparece no dano previsto das habilidades do lobo', () => {
        const state = wolf(3);
        const before = getAvailableActions(state).find((option) => option.skill.id === 'druida.mordida')?.preview.damage;

        getUnit(state, 'B1').statuses = [{ kind: 'bleed', turns: 2, value: 65, sourceId: 'A1', appliedOnStep: 0 }];
        getUnit(state, 'B2').statuses = [{ kind: 'bleed', turns: 2, value: 65, sourceId: 'A1', appliedOnStep: 0 }];

        const after = getAvailableActions(state).find((option) => option.skill.id === 'druida.mordida')?.preview.damage;

        assert.deepEqual([before, after], [215, 258]);
    });

    it('a purificação tira o sangramento', () => {
        const state = createBattle({ teamA: [getCharacter('sacerdote'), getCharacter('cavaleiro')], teamB: [druida], seed: 1 }).state;

        state.activeUnitId = 'A1';
        getUnit(state, 'A2').statuses = [{ kind: 'bleed', turns: 2, value: 65, sourceId: 'B1', appliedOnStep: 0 }];

        const { events } = applyAction(state, { unitId: 'A1', skillId: 'sacerdote.toque-curativo', targetId: 'A2' });

        assert.deepEqual(eventsOfType(events, 'cleansed')[0]?.statuses, ['bleed']);
    });

    it('o lobo é o atacante: mais veloz, mais ataque e mais crítico que o humano, e menos vida', () => {
        assert.ok(lobo && lobo.stats.speed > druida.stats.speed && lobo.stats.atk > druida.stats.atk && lobo.stats.critChance > druida.stats.critChance);
        assert.ok(lobo && lobo.stats.maxHp < druida.stats.maxHp);
    });
});

describe('formas: o urso', () => {
    function bear(): BattleState {
        const state = use(setup(), 'forma-de-urso').state;

        getUnit(state, 'A1').stats.critChance = 0;

        return state;
    }

    it('o urso é o tanque: mais vida e defesa que o humano', () => {
        assert.ok(urso && urso.stats.maxHp > druida.stats.maxHp && urso.stats.def > druida.stats.def);
    });

    it('o Rugido provoca e aumenta a defesa do urso por 2 turnos', () => {
        const { state, events } = use(bear(), 'rugido');

        assert.deepEqual(
            eventsOfType(events, 'status_applied').map((event) => [event.targetId, event.status, event.turns]),
            [['A1', 'taunt', 2], ['A1', 'def_up', 2]],
        );
        assert.equal(state.activeUnitId, 'B1');
        assert.deepEqual(getAvailableActions(state).find((option) => option.skill.id === 'cavaleiro.corte')?.targetIds, ['A1']);
    });

    it('os golpes do urso devolvem como vida 40% do dano causado', () => {
        const state = bear();

        getUnit(state, 'A1').hp = 500;

        const { events } = use(state, 'patada', 'B1');
        const damage = eventsOfType(events, 'damage')[0];
        const heal = eventsOfType(events, 'heal')[0];

        // ATK 165 x 100 / (100 + 90 de defesa) = 87 de dano; 40% disso = 35.
        assert.equal(damage?.amount, 87);
        assert.equal(heal?.amount, 35);
    });

    it('o Esmagar reduz o ataque do alvo por 2 turnos', () => {
        const { events } = use(bear(), 'esmagar', 'B1');

        assert.deepEqual(eventsOfType(events, 'status_applied').map((event) => [event.targetId, event.status, event.turns, event.value]), [['B1', 'atk_down', 2, 0.3]]);
    });
});

describe('formas: IA', () => {
    it('inteiro, o Druida vira lobo; ferido, vira urso; e gasta a ação extra com uma habilidade da forma', () => {
        const healthy = setup();

        assert.deepEqual(chooseAction(healthy), { unitId: 'A1', skillId: 'druida.forma-de-lobo' });

        const wounded = setup();

        getUnit(wounded, 'A1').hp = 300;
        assert.deepEqual(chooseAction(wounded), { unitId: 'A1', skillId: 'druida.forma-de-urso' });

        const asWolf = applyAction(healthy, chooseAction(healthy)).state;

        assert.equal(chooseAction(asWolf).skillId, 'druida.frenesi');
    });

    it('sem energia para se transformar, usa o ataque básico', () => {
        const state = setup();

        state.energy.A = 0;

        assert.equal(chooseAction(state).skillId, 'druida.golpe-de-cajado');
    });

    it('uma batalha inteira com Druidas dos dois lados termina', () => {
        const team = ['druida', 'cavaleiro', 'sacerdote'].map(getCharacter);
        let state = createBattle({ teamA: team, teamB: team, seed: 7 }).state;
        const forms = new Set<string>();

        for (let i = 0; state.winner === null; i++) {
            assert.ok(i < 2000, 'a batalha não terminou');
            state = applyAction(state, chooseAction(state)).state;

            for (const unit of state.units) {
                if (unit.form) forms.add(unit.form);
            }
        }

        assert.ok(forms.size > 0, 'alguém se transformou');
    });
});
