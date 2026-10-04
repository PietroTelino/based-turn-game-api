import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chooseAction } from '../ai';
import { getCharacter } from '../data/characters';
import { applyAction, createBattle, getAvailableActions, getUnit, isCorpse } from '../engine';
import type { BattleResult, BattleState, SkillDefinition } from '../types';
import { assertRuleError, basicAttackTurn, eventsOfType, makeCharacter } from './helpers';

/*
 * O Necromante: cura reduzida (heal_down), a conta de cadáveres e o Guerreiro
 * Esqueleto erguido no lugar de um aliado derrotado.
 */

const necromante = getCharacter('necromante');
const esqueleto = necromante.summons?.find((summon) => summon.id === 'esqueleto');

function skill(id: string, effects: SkillDefinition['effects'], target: SkillDefinition['target'] = 'single-ally'): SkillDefinition {
    return { id, name: id, description: '', energyCost: 0, target, effects };
}

describe('status: cura reduzida', () => {
    const heal = skill('a.heal', [{ type: 'heal', power: 2 }]);
    const curse = skill('b.curse', [{ type: 'status', status: 'heal_down', turns: 2, power: 0.6 }], 'single-enemy');

    function setup() {
        return createBattle({
            teamA: [makeCharacter('a', { speed: 200 }, [heal]), makeCharacter('ally', { speed: 50 })],
            teamB: [makeCharacter('b', { speed: 100, maxHp: 100_000 }, [curse])],
            seed: 1,
        }).state;
    }

    function cursed(state: BattleState, unitId: string): void {
        getUnit(state, unitId).statuses = [{ kind: 'heal_down', turns: 2, value: 0.6, sourceId: 'B1', appliedOnStep: 0 }];
    }

    it('quem está com a cura reduzida recebe só a parte que sobra', () => {
        const state = setup();

        getUnit(state, 'A2').hp = 100;

        // ATK 100 x 2 = 200 de cura.
        assert.equal(eventsOfType(applyAction(state, { unitId: 'A1', skillId: 'a.heal', targetId: 'A2' }).events, 'heal')[0]?.amount, 200);

        cursed(state, 'A2');

        // Com 60% a menos: 80.
        const { state: after, events } = applyAction(state, { unitId: 'A1', skillId: 'a.heal', targetId: 'A2' });

        assert.equal(eventsOfType(events, 'heal')[0]?.amount, 80);
        assert.equal(getUnit(after, 'A2').hp, 180);
    });

    it('a redução é de quem recebe, não de quem cura', () => {
        const state = setup();

        getUnit(state, 'A2').hp = 100;
        cursed(state, 'A1');

        assert.equal(eventsOfType(applyAction(state, { unitId: 'A1', skillId: 'a.heal', targetId: 'A2' }).events, 'heal')[0]?.amount, 200);
    });

    it('vale para o roubo de vida', () => {
        const bite = skill('a.bite', [{ type: 'damage', power: 1, drain: 1 }], 'single-enemy');
        const state = createBattle({ teamA: [makeCharacter('a', { speed: 200 }, [bite])], teamB: [makeCharacter('b', { maxHp: 100_000 })], seed: 1 }).state;

        getUnit(state, 'A1').hp = 100;
        cursed(state, 'A1');

        // 50 de dano; roubaria 50, com 60% a menos recupera 20.
        const { events } = applyAction(state, { unitId: 'A1', skillId: 'a.bite', targetId: 'B1' });

        assert.equal(eventsOfType(events, 'heal')[0]?.amount, 20);
    });

    it('vale para a cura das passivas de começo de vez', () => {
        const state = createBattle({ teamA: [getCharacter('sacerdote'), getCharacter('cavaleiro')], teamB: [getCharacter('guardiao')], seed: 1 }).state;

        // A vez é do Sacerdote; a aura dele age quando a vez dele chegar de novo.
        getUnit(state, 'A2').hp = 500;
        getUnit(state, 'A2').statuses = [{ kind: 'heal_down', turns: 9, value: 0.6, sourceId: 'B1', appliedOnStep: 0 }];

        let result = applyAction(state, { unitId: 'A1', skillId: 'sacerdote.raio-de-luz', targetId: 'B1' });

        while (result.state.activeUnitId !== 'A1') {
            const actor = getUnit(result.state, result.state.activeUnitId ?? '');
            const target = result.state.units.find((unit) => unit.team !== actor.team);

            result = applyAction(result.state, { unitId: actor.id, skillId: actor.skills[0]?.id ?? '', targetId: target?.id ?? '' });
        }

        // A aura cura 64 (ATK 160 x 0,4); com 60% a menos, 26.
        assert.ok(eventsOfType(result.events, 'heal').some((event) => event.targetId === 'A2' && event.amount === 26));
    });

    it('dura os turnos da habilidade e sai com a purificação', () => {
        const purify = skill('a.purify', [{ type: 'cleanse' }]);
        const state = createBattle({
            teamA: [makeCharacter('a', { speed: 200, maxHp: 100_000 }, [purify]), makeCharacter('ally', { speed: 50, maxHp: 100_000 })],
            teamB: [makeCharacter('b', { speed: 100, maxHp: 100_000 }, [curse])],
            seed: 1,
        }).state;

        let current = basicAttackTurn(state).state;

        current = applyAction(current, { unitId: 'B1', skillId: 'b.curse', targetId: 'A2' }).state;
        assert.deepEqual(getUnit(current, 'A2').statuses.map((status) => [status.kind, status.turns, status.value]), [['heal_down', 2, 0.6]]);

        // Duas vezes de A2 depois, o status acabou.
        const turnsLeft: number[] = [];

        for (let i = 0; i < 6; i++) {
            const wasA2 = current.activeUnitId === 'A2';

            current = basicAttackTurn(current).state;

            if (wasA2) turnsLeft.push(getUnit(current, 'A2').statuses[0]?.turns ?? 0);
        }

        assert.deepEqual(turnsLeft, [1, 0]);

        while (current.activeUnitId !== 'A1') current = basicAttackTurn(current).state;

        cursed(current, 'A2');

        const { events } = applyAction(current, { unitId: 'A1', skillId: 'a.purify', targetId: 'A2' });

        assert.deepEqual(eventsOfType(events, 'cleansed')[0]?.statuses, ['heal_down']);
    });
});

/** Necromante (A1), Bárbaro (A2) e Cavaleiro (A3) contra dois Cavaleiros com vida de sobra. A vez é do Necromante. */
function setup(): BattleState {
    const tough = { ...getCharacter('cavaleiro'), stats: { ...getCharacter('cavaleiro').stats, maxHp: 100_000 } };
    const state = createBattle({ teamA: [necromante, getCharacter('barbaro'), getCharacter('cavaleiro')], teamB: [tough, tough], seed: 1 }).state;

    state.activeUnitId = 'A1';
    state.order = ['A1', 'A2', 'A3', 'B1', 'B2'];
    state.energy.A = 10;
    getUnit(state, 'A1').stats.critChance = 0;

    return state;
}

function use(state: BattleState, skillName: string, targetId?: string): BattleResult {
    return applyAction(state, { unitId: 'A1', skillId: `necromante.${skillName}`, ...(targetId && { targetId }) });
}

/** Derruba uma unidade "por fora": tira a vida e os status, como fica quem caiu numa vez anterior. */
function kill(state: BattleState, unitId: string): void {
    const unit = getUnit(state, unitId);

    unit.hp = 0;
    unit.statuses = [];
    state.order = state.order.filter((id) => id !== unitId);
}

describe('Necromante: maldições', () => {
    it('o Toque da Morte causa dano e reduz em 60% a cura do alvo por 2 turnos', () => {
        const { state, events } = use(setup(), 'toque-da-morte', 'B1');

        // ATK 195 x 0,9 x 100 / (100 + 90) = 92.
        assert.equal(eventsOfType(events, 'damage')[0]?.amount, 92);
        assert.deepEqual(getUnit(state, 'B1').statuses.map((status) => [status.kind, status.turns, status.value]), [['heal_down', 2, 0.6]]);
        assert.equal(state.energy.A, 10, 'o ataque básico não tem custo');
    });

    it('a Praga causa dano em todos os inimigos e reduz a cura de todos', () => {
        const { state, events } = use(setup(), 'praga');

        assert.deepEqual(eventsOfType(events, 'damage').map((event) => [event.targetId, event.amount]), [['B1', 82], ['B2', 82]]);
        assert.deepEqual(
            eventsOfType(events, 'status_applied').map((event) => [event.targetId, event.status, event.turns, event.value]),
            [['B1', 'heal_down', 2, 0.6], ['B2', 'heal_down', 2, 0.6]],
        );
        assert.equal(state.energy.A, 9, 'custa 1 de energia');
    });
});

describe('Necromante: cadáveres', () => {
    it('conta os aliados que caem, e só os aliados', () => {
        const state = setup();

        assert.equal(getUnit(state, 'A1').passiveStacks ?? 0, 0);

        // O Bárbaro cai para um golpe do inimigo.
        state.activeUnitId = 'B1';
        getUnit(state, 'A2').hp = 1;

        const { state: after, events } = applyAction(state, { unitId: 'B1', skillId: 'cavaleiro.corte', targetId: 'A2' });

        assert.equal(getUnit(after, 'A1').passiveStacks, 1);
        assert.deepEqual(
            eventsOfType(events, 'passive_triggered').filter((event) => event.unitId === 'A1'),
            [{ type: 'passive_triggered', unitId: 'A1', passiveId: 'necromante.senhor-dos-mortos', targetIds: [], stacks: 1 }],
        );

        // Um inimigo que cai não entra na conta.
        const hunt = setup();

        getUnit(hunt, 'B1').hp = 1;

        const struck = use(hunt, 'toque-da-morte', 'B1');

        assert.equal(getUnit(struck.state, 'B1').hp, 0);
        assert.equal(getUnit(struck.state, 'A1').passiveStacks ?? 0, 0);
        assert.equal(eventsOfType(struck.events, 'passive_triggered').length, 0);
    });

    it('também conta quem cai para veneno, queimadura ou sangramento', () => {
        const state = setup();

        getUnit(state, 'A2').hp = 5;
        getUnit(state, 'A2').statuses = [{ kind: 'poison', turns: 2, value: 50, sourceId: 'B1', appliedOnStep: 0 }];

        // Depois do Necromante é a vez do Bárbaro, que cai para o veneno.
        const { state: after } = use(state, 'toque-da-morte', 'B1');

        assert.equal(getUnit(after, 'A2').hp, 0);
        assert.equal(getUnit(after, 'A1').passiveStacks, 1);
    });

    it('sem cadáver, Erguer Esqueleto não pode ser usada', () => {
        const state = setup();
        const option = getAvailableActions(state).find((item) => item.skill.id === 'necromante.erguer-esqueleto');

        assert.equal(option?.usable, false);
        assert.deepEqual(option?.targetIds, []);
        assert.equal(option?.requiresTarget, false);
        assertRuleError(() => use(state, 'erguer-esqueleto'), 'INVALID_TARGET');
    });
});

describe('Necromante: erguer o Guerreiro Esqueleto', () => {
    function withCorpse(): BattleState {
        const state = setup();

        kill(state, 'A2');
        getUnit(state, 'A1').passiveStacks = 1;

        return state;
    }

    it('o cadáver dá lugar a um Guerreiro Esqueleto com a vida cheia, no mesmo lugar do time', () => {
        const state = withCorpse();
        const option = getAvailableActions(state).find((item) => item.skill.id === 'necromante.erguer-esqueleto');

        assert.equal(option?.usable, true);
        assert.deepEqual(option?.targetIds, ['A2']);

        const { state: after, events } = use(state, 'erguer-esqueleto');
        const raised = getUnit(after, 'A2');

        assert.equal(after.energy.A, 9, 'custa 1 de energia');
        assert.deepEqual(after.units.map((unit) => unit.id), ['A1', 'A2', 'A3', 'B1', 'B2'], 'a ordem das unidades não muda');
        assert.equal(raised.characterId, 'esqueleto');
        assert.equal(raised.name, 'Guerreiro Esqueleto');
        assert.equal(raised.team, 'A');
        assert.equal(raised.summoned, true);
        assert.deepEqual(raised.stats, esqueleto?.stats);
        assert.equal(raised.hp, esqueleto?.stats.maxHp);
        assert.deepEqual(raised.statuses, []);
        assert.deepEqual(raised.skills.map((item) => item.id), ['esqueleto.espada-enferrujada', 'esqueleto.golpe-profano']);
        assert.deepEqual(raised.passives?.map((item) => item.id), ['esqueleto.servo-da-maldicao']);

        const summoned = eventsOfType(events, 'summoned')[0];

        assert.equal(summoned?.sourceId, 'A1');
        assert.equal(summoned?.unitId, 'A2');
        assert.deepEqual(summoned?.unit, raised);
    });

    it('gasta o cadáver: a conta do Necromante cai e a tela é avisada', () => {
        const { state, events } = use(withCorpse(), 'erguer-esqueleto');

        assert.equal(getUnit(state, 'A1').passiveStacks, 0);
        assert.deepEqual(eventsOfType(events, 'passive_triggered').map((event) => [event.passiveId, event.stacks]), [['necromante.senhor-dos-mortos', 0]]);
    });

    it('o esqueleto entra na fila do turno em que é erguido, no lugar que a velocidade dele dá', () => {
        // O Bárbaro caiu num turno anterior: não estava na fila deste.
        const state = withCorpse();

        assert.ok(!state.order.includes('A2'));

        const { state: after, events } = use(state, 'erguer-esqueleto');

        // Esqueleto (104 de velocidade) passa à frente dos Cavaleiros (88) que ainda não agiram.
        assert.equal(after.order[0], 'A1');
        assert.equal(after.order[1], 'A2');
        assert.deepEqual([...after.order].sort(), ['A1', 'A2', 'A3', 'B1', 'B2']);
        const changes = eventsOfType(events, 'order_changed');

        assert.deepEqual(changes[changes.length - 1]?.order, after.order);
        assert.equal(after.activeUnitId, 'A2', 'a vez seguinte já é a dele');
        assert.deepEqual(eventsOfType(events, 'unit_activated').map((event) => event.unitId), ['A2']);

        // E ele joga normalmente: ataca e a vez passa adiante.
        const played = applyAction(after, { unitId: 'A2', skillId: 'esqueleto.espada-enferrujada', targetId: 'B1' });

        assert.equal(eventsOfType(played.events, 'damage')[0]?.sourceId, 'A2');
        assert.notEqual(played.state.activeUnitId, 'A2');
    });

    it('entra atrás de quem é mais veloz e ainda não agiu', () => {
        const state = withCorpse();

        // Um inimigo veloz (200) ainda espera a vez neste turno.
        getUnit(state, 'B1').stats.speed = 200;

        const { state: after } = use(state, 'erguer-esqueleto');

        assert.deepEqual(after.order.slice(0, 3), ['A1', 'B1', 'A2']);
        assert.equal(after.activeUnitId, 'B1');
    });

    it('age neste turno mesmo que o aliado derrotado já tivesse agido (ou caído antes de agir)', () => {
        // Já tinha agido: o id do cadáver está na fila antes do Necromante.
        const acted = setup();

        acted.order = ['A2', 'A1', 'A3', 'B1', 'B2'];
        getUnit(acted, 'A2').hp = 0;

        const afterActed = use(acted, 'erguer-esqueleto').state;

        assert.deepEqual(afterActed.order.slice(0, 2), ['A1', 'A2'], 'sai do lugar antigo e entra entre os que esperam');
        assert.equal(afterActed.order.filter((unitId) => unitId === 'A2').length, 1);
        assert.equal(afterActed.activeUnitId, 'A2');

        // Caiu antes de agir: o id estava entre os que esperam.
        const waiting = setup();

        getUnit(waiting, 'A2').hp = 0;
        assert.ok(waiting.order.indexOf('A2') > waiting.order.indexOf('A1'));

        const afterWaiting = use(waiting, 'erguer-esqueleto').state;

        assert.equal(afterWaiting.order.filter((unitId) => unitId === 'A2').length, 1);
        assert.equal(afterWaiting.activeUnitId, 'A2');
    });

    it('no turno seguinte, segue na fila como qualquer unidade', () => {
        let state = use(withCorpse(), 'erguer-esqueleto').state;
        const turn = state.turn;
        let turnsOfSkeleton = 0;

        for (let i = 0; i < 20 && state.turn <= turn + 1; i++) {
            if (state.activeUnitId === 'A2') turnsOfSkeleton++;
            state = basicAttackTurnOf(state);
        }

        assert.equal(turnsOfSkeleton, 2, 'uma vez no turno em que foi erguido e uma no seguinte');
    });

    it('cada cadáver é erguido uma vez, um por uso; esqueleto que cai não deixa cadáver', () => {
        const state = withCorpse();

        kill(state, 'A3');
        getUnit(state, 'A1').passiveStacks = 2;

        let after = use(state, 'erguer-esqueleto').state;

        assert.equal(getUnit(after, 'A2').characterId, 'esqueleto', 'o primeiro cadáver do time');
        assert.equal(getUnit(after, 'A3').hp, 0, 'o outro continua caído');
        assert.equal(getUnit(after, 'A1').passiveStacks, 1);

        // O esqueleto cai: não é cadáver, e a conta não sobe.
        after.activeUnitId = 'B1';
        getUnit(after, 'A2').hp = 1;
        after = applyAction(after, { unitId: 'B1', skillId: 'cavaleiro.corte', targetId: 'A2' }).state;

        assert.equal(getUnit(after, 'A2').hp, 0);
        assert.equal(isCorpse(getUnit(after, 'A2')), false);
        assert.equal(getUnit(after, 'A1').passiveStacks, 1);

        after.activeUnitId = 'A1';
        after.energy.A = 10;

        const second = use(after, 'erguer-esqueleto').state;

        assert.equal(getUnit(second, 'A3').characterId, 'esqueleto');
        assert.equal(getUnit(second, 'A1').passiveStacks, 0);

        second.activeUnitId = 'A1';
        second.energy.A = 10;
        assert.equal(getAvailableActions(second).find((item) => item.skill.id === 'necromante.erguer-esqueleto')?.usable, false);
    });

    it('quem caiu transformado é erguido como um esqueleto comum', () => {
        const state = createBattle({ teamA: [necromante, getCharacter('druida')], teamB: [getCharacter('cavaleiro')], seed: 1 }).state;
        const druid = getUnit(state, 'A2');

        // O Druida cai na forma de urso.
        druid.form = 'urso';
        druid.hp = 0;
        state.activeUnitId = 'A1';
        state.energy.A = 10;

        const raised = getUnit(use(state, 'erguer-esqueleto').state, 'A2');

        assert.equal(raised.characterId, 'esqueleto');
        assert.equal(raised.form, undefined);
        assert.equal(raised.forms, undefined);
        assert.equal(raised.baseForm, undefined);
    });

    it('não altera o estado recebido', () => {
        const state = withCorpse();
        const before = structuredClone(state);

        use(state, 'erguer-esqueleto');

        assert.deepEqual(state, before);
    });

    it('o esqueleto joga com as habilidades dele e bate mais forte em quem está com a cura reduzida', () => {
        const state = use(withCorpse(), 'erguer-esqueleto').state;

        state.activeUnitId = 'A2';
        state.energy.A = 10;
        getUnit(state, 'A2').stats.critChance = 0;

        const sword = (target: BattleState) => eventsOfType(applyAction(target, { unitId: 'A2', skillId: 'esqueleto.espada-enferrujada', targetId: 'B1' }).events, 'damage')[0]?.amount;

        // ATK 180 x 100 / (100 + 90) = 95; com a cura do alvo reduzida, 30% a mais.
        assert.equal(sword(state), 95);

        getUnit(state, 'B1').statuses = [{ kind: 'heal_down', turns: 2, value: 0.6, sourceId: 'A1', appliedOnStep: 0 }];
        assert.equal(sword(state), 123);

        const profane = applyAction(state, { unitId: 'A2', skillId: 'esqueleto.golpe-profano', targetId: 'B2' });

        assert.equal(profane.state.energy.A, 9, 'o esqueleto gasta a energia do time');
        assert.deepEqual(eventsOfType(profane.events, 'status_applied').map((event) => [event.targetId, event.status, event.turns, event.value]), [['B2', 'def_down', 2, 0.2]]);
    });

    it('enquanto houver um esqueleto de pé, o time não perdeu', () => {
        let state = use(withCorpse(), 'erguer-esqueleto').state;

        // Caem o Necromante e o Cavaleiro: sobra só o esqueleto.
        for (const unitId of ['A1', 'A3']) {
            state.activeUnitId = 'B1';
            getUnit(state, unitId).hp = 1;
            state = applyAction(state, { unitId: 'B1', skillId: 'cavaleiro.corte', targetId: unitId }).state;
        }

        assert.equal(state.winner, null);

        state.activeUnitId = 'B1';
        getUnit(state, 'A2').hp = 1;
        state = applyAction(state, { unitId: 'B1', skillId: 'cavaleiro.corte', targetId: 'A2' }).state;

        assert.equal(state.winner, 'B');
    });
});

describe('Necromante: IA', () => {
    it('com cadáver e energia, ergue o esqueleto; sem cadáver, usa a Praga', () => {
        const state = setup();

        state.energy.A = 1;
        assert.deepEqual(chooseAction(state), { unitId: 'A1', skillId: 'necromante.praga' });

        kill(state, 'A2');
        assert.deepEqual(chooseAction(state), { unitId: 'A1', skillId: 'necromante.erguer-esqueleto' });

        state.energy.A = 0;
        assert.equal(chooseAction(state).skillId, 'necromante.toque-da-morte');
    });

    it('uma batalha inteira com Necromantes dos dois lados termina, com esqueletos erguidos', () => {
        const team = ['necromante', 'barbaro', 'ladino', 'sacerdote', 'druida'].map(getCharacter);
        let state = createBattle({ teamA: team, teamB: team, seed: 11 }).state;
        let raised = 0;

        for (let i = 0; state.winner === null; i++) {
            assert.ok(i < 3000, 'a batalha não terminou');

            const result = applyAction(state, chooseAction(state));

            raised += eventsOfType(result.events, 'summoned').length;
            state = result.state;
        }

        assert.ok(raised > 0, 'alguém foi erguido');
        assert.equal(state.units.length, 10, 'erguer não cria unidades a mais');
    });
});

/** A unidade da vez usa o ataque básico (a primeira habilidade) no primeiro inimigo vivo. */
function basicAttackTurnOf(state: BattleState): BattleState {
    const actor = getUnit(state, state.activeUnitId ?? '');
    const target = state.units.find((unit) => unit.team !== actor.team && unit.hp > 0);

    return applyAction(state, { unitId: actor.id, skillId: actor.skills[0]?.id ?? '', targetId: target?.id ?? '' }).state;
}
