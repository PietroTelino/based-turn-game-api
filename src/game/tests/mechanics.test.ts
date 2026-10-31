import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chooseAction } from '../ai';
import { getCharacter } from '../data/characters';
import { applyAction, createBattle, getAvailableActions, getUnit } from '../engine';
import type { BattleState, PassiveDefinition, SkillDefinition, StatusEffect, StatusKind } from '../types';
import { assertRuleError, eventsOfType, makeCharacter } from './helpers';

function skill(id: string, overrides: Partial<SkillDefinition>): SkillDefinition {
    return { id, name: id, description: '', energyCost: 0, target: 'single-enemy', effects: [{ type: 'damage', power: 1 }], ...overrides };
}

function passive(id: string, effect: PassiveDefinition['effect']): PassiveDefinition {
    return { id, name: id, description: '', effect };
}

function status(kind: StatusKind, sourceId: string, value = 0, turns = 2): StatusEffect {
    return { kind, turns, value, sourceId, appliedOnStep: 0 };
}

const kinds = (state: BattleState, unitId: string) => getUnit(state, unitId).statuses.map((item) => item.kind).sort();

describe('tirar efeitos (dispel)', () => {
    const judge = skill('a.judge', { effects: [{ type: 'dispel' }, { type: 'damage', power: 1 }] });
    const purge = skill('a.purge', { target: 'all-enemies', effects: [{ type: 'dispel', statuses: ['shield'] }] });
    const zeal = passive('a.zeal', { type: 'damage_per_dispel', amount: 0.1, max: 3 });

    function setup() {
        const state = createBattle({
            teamA: [makeCharacter('a', { atk: 200, speed: 200 }, [judge, purge], [zeal])],
            teamB: [makeCharacter('b', { def: 100 }), makeCharacter('b2')],
            seed: 1,
        }).state;

        getUnit(state, 'B1').statuses = [status('shield', 'B1', 500), status('def_up', 'B1', 0.5), status('taunt', 'B1'), status('burn', 'A1', 10)];

        return state;
    }

    it('tira os efeitos que ajudam (escudo, bônus, provocação) antes do golpe, e deixa os que atrapalham', () => {
        const { state, events } = applyAction(setup(), { unitId: 'A1', skillId: 'a.judge', targetId: 'B1' });

        assert.deepEqual(kinds(state, 'B1'), ['burn']);
        assert.deepEqual(eventsOfType(events, 'dispelled')[0]?.statuses.sort(), ['def_up', 'shield', 'taunt']);
        // Sem escudo e sem o bônus de defesa: 200 x 100 / 200 = 100, mais 30% das três
        // cargas que a passiva ganhou ao tirar os efeitos (já valem para o golpe da mesma habilidade).
        assert.deepEqual(eventsOfType(events, 'damage').map((e) => [e.amount, e.absorbed]), [[130, 0]]);
    });

    it('com `statuses`, tira só esses', () => {
        const { state } = applyAction(setup(), { unitId: 'A1', skillId: 'a.purge' });

        assert.deepEqual(kinds(state, 'B1'), ['burn', 'def_up', 'taunt']);
    });

    it('cada efeito tirado é uma carga da passiva damage_per_dispel, até o limite', () => {
        const { state, events } = applyAction(setup(), { unitId: 'A1', skillId: 'a.judge', targetId: 'B1' });

        assert.equal(getUnit(state, 'A1').passiveStacks, 3);
        assert.deepEqual(eventsOfType(events, 'passive_triggered').map((e) => e.stacks), [3]);
        // A carga já vale para o golpe seguinte: +30%.
        assert.equal(getAvailableActions({ ...state, activeUnitId: 'A1' })[0]?.preview.damage, 260);
    });

    it('sem nada para tirar, passa em branco', () => {
        const state = setup();

        getUnit(state, 'B1').statuses = [];

        const { events } = applyAction(state, { unitId: 'A1', skillId: 'a.judge', targetId: 'B1' });

        assert.equal(eventsOfType(events, 'dispelled').length, 0);
    });
});

describe('energia', () => {
    const song = skill('a.song', { energyCost: 1, target: 'all-allies', effects: [{ type: 'status', status: 'speed_up', turns: 2, power: 0.2 }, { type: 'energy', amount: 2, team: 'own' }] });
    const noise = skill('a.noise', { energyCost: 0, target: 'all-enemies', effects: [{ type: 'energy', amount: 2, team: 'enemy' }] });
    const refrain = passive('a.refrain', { type: 'energy_when_empty', amount: 2 });

    function setup() {
        return createBattle({
            teamA: [makeCharacter('a', { speed: 200 }, [song, noise], [refrain]), makeCharacter('a2', { speed: 50 })],
            teamB: [makeCharacter('b', { speed: 100 }), makeCharacter('b2', { speed: 90 })],
            seed: 1,
        }).state;
    }

    it('dar energia ao time vale uma vez por ação, não uma por alvo', () => {
        const { state, events } = applyAction(setup(), { unitId: 'A1', skillId: 'a.song' });

        // 3 do turno 1, menos 1 do custo, mais 2.
        assert.equal(state.energy.A, 4);
        assert.deepEqual(eventsOfType(events, 'energy_gained').map((e) => [e.team, e.amount, e.energy]), [['A', 2, 4]]);
    });

    it('tirar energia do inimigo não passa de zero', () => {
        const state = setup();

        state.energy.B = 1;

        const { state: after, events } = applyAction(state, { unitId: 'A1', skillId: 'a.noise' });

        assert.equal(after.energy.B, 0);
        assert.deepEqual(eventsOfType(events, 'energy_lost').map((e) => [e.team, e.amount, e.energy]), [['B', 1, 0]]);
    });

    it('energy_when_empty: no começo da vez, o time sem energia recupera', () => {
        const state = setup();

        // Faz a vez de A1 terminar com o time zerado e passar pelas outras até voltar a ele no turno seguinte não serve:
        // a energia recomeça no turno. Então a vez de A1 é reaberta com o time sem energia.
        state.energy.A = 0;
        state.activeUnitId = 'B2';
        state.order = ['B2', 'A1'];

        const { state: after, events } = applyAction(state, { unitId: 'B2', skillId: 'b2.basic', targetId: 'A2' });

        assert.equal(after.activeUnitId, 'A1');
        assert.equal(after.energy.A, 2);
        assert.ok(eventsOfType(events, 'passive_triggered').some((e) => e.passiveId === 'a.refrain'));
    });
});

describe('proteção (guard)', () => {
    const aegis = skill('a.aegis', { target: 'single-ally', effects: [{ type: 'status', status: 'guard', turns: 2, power: 0 }] });
    const quake = skill('b.quake', { target: 'all-enemies' });

    function setup() {
        const state = createBattle({
            teamA: [makeCharacter('a', { speed: 200, def: 300 }, [aegis]), makeCharacter('a2', { speed: 50, def: 0 })],
            teamB: [makeCharacter('b', { speed: 100, atk: 200 }, [quake])],
            seed: 1,
        }).state;

        return applyAction(state, { unitId: 'A1', skillId: 'a.aegis', targetId: 'A2' }).state;
    }

    it('não dá para proteger a si mesmo', () => {
        const state = createBattle({ teamA: [makeCharacter('a', { speed: 200 }, [aegis]), makeCharacter('a2')], teamB: [makeCharacter('b')], seed: 1 }).state;

        assert.deepEqual(getAvailableActions(state).find((a) => a.skill.id === 'a.aegis')?.targetIds, ['A2']);
    });

    it('o golpe de alvo único no protegido vai para o protetor', () => {
        const state = setup();

        assert.equal(state.activeUnitId, 'B1');

        const { state: after, events } = applyAction(state, { unitId: 'B1', skillId: 'b.basic', targetId: 'A2' });

        assert.deepEqual(eventsOfType(events, 'skill_used')[0]?.targetIds, ['A1']);
        assert.deepEqual(eventsOfType(events, 'guarded'), [{ type: 'guarded', unitId: 'A1', protectedId: 'A2' }]);
        assert.equal(getUnit(after, 'A2').hp, 1000);
        assert.equal(getUnit(after, 'A1').hp, 1000 - 50);
    });

    it('a prévia no protegido mostra o golpe no protetor', () => {
        const preview = getAvailableActions(setup())[0]?.targets.find((t) => t.unitId === 'A2');

        assert.equal(preview?.guardedBy, 'A1');
        assert.equal(preview?.damage, 50);
    });

    it('golpe em área não muda', () => {
        const { events } = applyAction(setup(), { unitId: 'B1', skillId: 'b.quake' });

        assert.deepEqual(eventsOfType(events, 'damage').map((e) => [e.targetId, e.amount]), [['A1', 50], ['A2', 200]]);
    });

    it('com o protetor caído, a proteção não vale', () => {
        const state = setup();

        getUnit(state, 'A1').hp = 0;

        const { events } = applyAction(state, { unitId: 'B1', skillId: 'b.basic', targetId: 'A2' });

        assert.deepEqual(eventsOfType(events, 'damage').map((e) => e.targetId), ['A2']);
    });
});

describe('reviver', () => {
    const rise = skill('a.rise', { energyCost: 0, target: 'corpse', uses: 1, effects: [{ type: 'revive', ratio: 0.4 }] });

    function setup() {
        const state = createBattle({
            teamA: [makeCharacter('a', { speed: 200 }, [rise]), makeCharacter('a2', { speed: 150 })],
            teamB: [makeCharacter('b', { speed: 100 })],
            seed: 1,
        }).state;

        getUnit(state, 'A2').hp = 0;
        getUnit(state, 'A2').statuses = [];

        return state;
    }

    it('traz o aliado caído de volta com a fração da vida, e ele age neste turno', () => {
        const { state, events } = applyAction(setup(), { unitId: 'A1', skillId: 'a.rise' });

        assert.equal(getUnit(state, 'A2').hp, 400);
        assert.deepEqual(eventsOfType(events, 'revived'), [{ type: 'revived', sourceId: 'A1', unitId: 'A2', hp: 400 }]);
        assert.equal(state.activeUnitId, 'A2');
    });

    it('só pode ser usada as vezes do limite', () => {
        let { state } = applyAction(setup(), { unitId: 'A1', skillId: 'a.rise' });

        getUnit(state, 'A2').hp = 0;
        state.activeUnitId = 'A1';

        const option = getAvailableActions(state).find((a) => a.skill.id === 'a.rise');

        assert.equal(option?.usesLeft, 0);
        assert.equal(option?.usable, false);
        assertRuleError(() => applyAction(state, { unitId: 'A1', skillId: 'a.rise' }), 'SKILL_USED_UP');
    });

    it('sem cadáver não dá para usar', () => {
        const state = setup();

        getUnit(state, 'A2').hp = 1000;

        assert.equal(getAvailableActions(state).find((a) => a.skill.id === 'a.rise')?.usable, false);
    });

    it('a IA revive quando pode', () => {
        assert.equal(chooseAction(setup()).skillId, 'a.rise');
    });

    describe('com mais de um aliado caído', () => {
        function setupTwo() {
            const state = createBattle({
                teamA: [makeCharacter('a', { speed: 300 }, [rise]), makeCharacter('a2', { speed: 200, atk: 50 }), makeCharacter('a3', { speed: 100, atk: 300 })],
                teamB: [makeCharacter('b', { speed: 10 })],
                seed: 1,
            }).state;

            for (const id of ['A2', 'A3']) {
                getUnit(state, id).hp = 0;
                getUnit(state, id).statuses = [];
            }

            return state;
        }

        it('o jogador escolhe qual trazer de volta: todos os caídos são alvo', () => {
            const state = setupTwo();
            const option = getAvailableActions(state).find((a) => a.skill.id === 'a.rise');

            assert.equal(option?.requiresTarget, true);
            assert.deepEqual(option?.targetIds, ['A2', 'A3']);

            const after = applyAction(state, { unitId: 'A1', skillId: 'a.rise', targetId: 'A3' }).state;

            assert.equal(getUnit(after, 'A3').hp, 400);
            assert.equal(getUnit(after, 'A2').hp, 0);
        });

        it('sem alvo escolhido (pedido antigo), vale o primeiro caído', () => {
            const after = applyAction(setupTwo(), { unitId: 'A1', skillId: 'a.rise' }).state;

            assert.equal(getUnit(after, 'A2').hp, 400);
        });

        it('quem está vivo não pode ser escolhido', () => {
            assertRuleError(() => applyAction(setupTwo(), { unitId: 'A1', skillId: 'a.rise', targetId: 'A1' }), 'INVALID_TARGET');
        });

        it('a IA traz de volta o de maior ataque', () => {
            assert.deepEqual(chooseAction(setupTwo()), { unitId: 'A1', skillId: 'a.rise', targetId: 'A3' });
        });
    });
});

describe('golpe que salta', () => {
    const chain = skill('a.chain', { effects: [{ type: 'damage', power: 1, bounces: 2, falloff: 0.5 }] });

    function setup(seed = 1) {
        return createBattle({
            teamA: [makeCharacter('a', { speed: 200, atk: 200 }, [chain])],
            teamB: [makeCharacter('b', { def: 100 }), makeCharacter('b2', { def: 100 }), makeCharacter('b3', { def: 100 }), makeCharacter('b4', { def: 100 })],
            seed,
        }).state;
    }

    it('acerta o alvo e salta para outros, cada salto mais fraco', () => {
        const { events } = applyAction(setup(), { unitId: 'A1', skillId: 'a.chain', targetId: 'B1' });
        const hits = eventsOfType(events, 'damage');

        assert.equal(hits.length, 3);
        assert.equal(new Set(hits.map((e) => e.targetId)).size, 3);
        assert.equal(hits[0]?.targetId, 'B1');
        assert.deepEqual(hits.map((e) => e.amount), [100, 50, 25]);
        assert.equal(eventsOfType(events, 'chain_jump').length, 2);
    });

    it('os saltos vêm do sorteio da batalha: a mesma semente salta igual', () => {
        const targets = (seed: number) => eventsOfType(applyAction(setup(seed), { unitId: 'A1', skillId: 'a.chain', targetId: 'B1' }).events, 'damage').map((e) => e.targetId);

        assert.deepEqual(targets(3), targets(3));
    });

    it('para quando acabam os inimigos', () => {
        const state = createBattle({ teamA: [makeCharacter('a', { speed: 200 }, [chain])], teamB: [makeCharacter('b'), makeCharacter('b2')], seed: 1 }).state;

        assert.equal(eventsOfType(applyAction(state, { unitId: 'A1', skillId: 'a.chain', targetId: 'B1' }).events, 'damage').length, 2);
    });

    it('a prévia conta só o alvo escolhido', () => {
        assert.equal(getAvailableActions(setup())[1]?.targets.find((t) => t.unitId === 'B1')?.damage, 100);
    });
});

describe('bônus de time e escudo no aliado mais ferido', () => {
    it('team_damage_bonus vale para os golpes dos aliados enquanto quem tem a passiva está vivo', () => {
        const charge = passive('s.charge', { type: 'team_damage_bonus', amount: 0.25, when: { type: 'target_has_status', statuses: ['stun'] } });
        const state = createBattle({
            teamA: [makeCharacter('a', { speed: 200, atk: 200 }), makeCharacter('s', { speed: 50 }, [], [charge])],
            teamB: [makeCharacter('b', { def: 100 })],
            seed: 1,
        }).state;

        getUnit(state, 'B1').statuses = [status('stun', 'A2')];

        const { events } = applyAction(state, { unitId: 'A1', skillId: 'a.basic', targetId: 'B1' });

        assert.equal(eventsOfType(events, 'damage')[0]?.amount, 125);
        assert.ok(eventsOfType(events, 'passive_triggered').some((e) => e.unitId === 'A2' && e.passiveId === 's.charge'));

        getUnit(state, 'A2').hp = 0;
        assert.equal(eventsOfType(applyAction(state, { unitId: 'A1', skillId: 'a.basic', targetId: 'B1' }).events, 'damage')[0]?.amount, 100);
    });

    it('turn_start lowest-ally: o aliado com a menor fração da vida recebe o efeito', () => {
        const light = passive('p.light', { type: 'turn_start', target: 'lowest-ally', effects: [{ type: 'status', status: 'shield', turns: 2, power: 0.5 }] });
        const state = createBattle({
            teamA: [makeCharacter('p', { speed: 50, atk: 100 }, [], [light]), makeCharacter('a2', { speed: 200 })],
            teamB: [makeCharacter('b', { speed: 100 })],
            seed: 1,
        }).state;

        getUnit(state, 'A2').hp = 300;

        let current = applyAction(state, { unitId: 'A2', skillId: 'a2.basic', targetId: 'B1' }).state;
        current = applyAction(current, { unitId: 'B1', skillId: 'b.basic', targetId: 'A2' }).state;

        assert.equal(current.activeUnitId, 'A1');
        assert.deepEqual(getUnit(current, 'A2').statuses.map((item) => [item.kind, item.value]), [['shield', 50]]);
    });
});

describe('os quatro personagens novos', () => {
    it('jogam batalhas inteiras contra o elenco, nos dois lados, sem erro', () => {
        const fresh = ['paladino', 'inquisidora', 'xama', 'bardo'];
        const others = ['cavaleiro', 'ladino', 'espadachim', 'sacerdote', 'necromante'];

        for (let seed = 1; seed <= 6; seed++) {
            for (const [teamA, teamB] of [[fresh, others], [others, fresh]] as const) {
                let { state } = createBattle({ teamA: teamA.map(getCharacter), teamB: teamB.slice(0, 4).map(getCharacter), seed });

                for (let step = 0; step < 400 && state.winner === null; step++) {
                    state = applyAction(state, chooseAction(state)).state;
                }

                assert.notEqual(state.winner, null);
            }
        }
    });
});
