import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chooseAction } from '../ai';
import { MIN_STAT_FACTOR } from '../constants';
import { CHARACTERS, getCharacter } from '../data/characters';
import { applyAction, createBattle, getAvailableActions, getEffectiveStats, getUnit, NEGATIVE_STATUSES } from '../engine';
import type { BattleState, PassiveDefinition, SkillDefinition, SkillEffect, StatusEffect, StatusKind } from '../types';
import { assertRuleError, basicAttackTurn, eventsOfType, makeCharacter } from './helpers';

function statusSkill(id: string, effects: SkillEffect[], target: SkillDefinition['target'] = 'single-enemy'): SkillDefinition {
    return { id, name: id, description: '', energyCost: 0, target, effects };
}

function status(kind: StatusKind, overrides: Partial<StatusEffect> = {}): StatusEffect {
    return { kind, turns: 2, value: 0, sourceId: 'A1', appliedOnStep: 0, ...overrides };
}

/** Joga ataques básicos até a unidade informada estar na vez. Devolve o estado e os eventos do caminho. */
function playUntilTurnOf(start: BattleState, unitId: string) {
    let state = start;
    const events = [];

    for (let i = 0; state.activeUnitId !== unitId; i++) {
        assert.ok(i < 50, `a vez de ${unitId} nunca chegou`);

        const result = basicAttackTurn(state);

        state = result.state;
        events.push(...result.events);
    }

    return { state, events };
}

describe('status: dano por turno', () => {
    const burn = statusSkill('a.burn', [{ type: 'status', status: 'burn', turns: 2, power: 0.5 }]);

    function setup() {
        return createBattle({
            teamA: [makeCharacter('a', { speed: 200, atk: 100, maxHp: 1_000_000 }, [burn])],
            teamB: [makeCharacter('b', { speed: 100, def: 900, maxHp: 1_000_000 })],
            seed: 1,
        }).state;
    }

    it('aplica o status e avisa a tela com a lista completa', () => {
        const { state, events } = applyAction(setup(), { unitId: 'A1', skillId: 'a.burn', targetId: 'B1' });
        const expected = { kind: 'burn', turns: 2, value: 50, sourceId: 'A1', appliedOnStep: 1 };

        assert.deepEqual(getUnit(state, 'B1').statuses, [expected]);
        assert.deepEqual(eventsOfType(events, 'status_applied'), [
            { type: 'status_applied', sourceId: 'A1', targetId: 'B1', status: 'burn', turns: 2, value: 50 },
        ]);
        assert.deepEqual(eventsOfType(events, 'statuses_changed'), [
            { type: 'statuses_changed', unitId: 'B1', statuses: [expected] },
        ]);
    });

    it('causa dano quando chega a vez do alvo, ignora a defesa e acaba depois da duração', () => {
        // A vez de B vem logo depois da de A, no mesmo applyAction: a primeira
        // queimadura já aparece nos eventos desta jogada.
        const burned = applyAction(setup(), { unitId: 'A1', skillId: 'a.burn', targetId: 'B1' });
        let state = burned.state;
        const events = [...burned.events];

        // Seis turnos: tempo de sobra para B jogar bem mais que 2 vezes.
        for (let i = 0; i < 12; i++) {
            const result = basicAttackTurn(state);

            state = result.state;
            events.push(...result.events);
        }

        const ticks = eventsOfType(events, 'status_damage');

        assert.deepEqual(
            ticks.map((e) => [e.targetId, e.status, e.amount]),
            [
                ['B1', 'burn', 50],
                ['B1', 'burn', 50],
            ],
        );
        assert.deepEqual(eventsOfType(events, 'status_expired'), [{ type: 'status_expired', unitId: 'B1', status: 'burn' }]);
        assert.deepEqual(getUnit(state, 'B1').statuses, []);
    });

    it('pode derrotar a unidade e encerrar a batalha', () => {
        const state = setup();

        getUnit(state, 'B1').hp = 10;
        getUnit(state, 'B1').stats.def = 1_000_000; // o ataque básico de A tira só 1
        getUnit(state, 'B1').statuses = [status('burn', { value: 500 })];

        const { state: final, events } = playUntilWinner(state);

        assert.equal(final.winner, 'A');
        assert.equal(getUnit(final, 'B1').hp, 0);
        assert.deepEqual(getUnit(final, 'B1').statuses, [], 'quem caiu não carrega status');
        assert.ok(eventsOfType(events, 'status_damage').some((e) => e.hp === 0));
        assert.equal(events[events.length - 1]?.type, 'battle_ended');
    });

    function playUntilWinner(start: BattleState) {
        let state = start;
        const events = [];

        for (let i = 0; state.winner === null; i++) {
            assert.ok(i < 50);

            const result = basicAttackTurn(state);

            state = result.state;
            events.push(...result.events);
        }

        return { state, events };
    }
});

describe('status: atordoamento', () => {
    const stun = statusSkill('a.stun', [{ type: 'status', status: 'stun', turns: 1, power: 0 }]);

    it('o alvo perde a vez neste turno e volta a jogar no seguinte', () => {
        const start = createBattle({
            teamA: [makeCharacter('a', { speed: 200, maxHp: 1_000_000 }, [stun])],
            teamB: [makeCharacter('b', { speed: 100, maxHp: 1_000_000 })],
            seed: 1,
        }).state;

        const stunned = applyAction(start, { unitId: 'A1', skillId: 'a.stun', targetId: 'B1' });

        assert.deepEqual(eventsOfType(stunned.events, 'unit_skipped'), [{ type: 'unit_skipped', unitId: 'B1', status: 'stun' }]);
        assert.equal(stunned.state.turn, 2, 'B perdeu a vez, então o turno 1 acabou');

        let state = stunned.state;
        const events = [];
        const actors: string[] = [];

        for (let i = 0; i < 6; i++) {
            actors.push(state.activeUnitId ?? '');

            const result = basicAttackTurn(state);

            state = result.state;
            events.push(...result.events);
        }

        // A atordoou B no turno 1, antes da vez de B: B perdeu a vez e o turno
        // 2 já começou com A. Dali em diante os dois alternam normalmente.
        assert.deepEqual(actors, ['A1', 'B1', 'A1', 'B1', 'A1', 'B1']);
        assert.equal(state.turn, 5);
        assert.deepEqual(eventsOfType(events, 'unit_skipped'), []);
        assert.deepEqual(getUnit(state, 'B1').statuses, []);
    });

    it('chance: 0 nunca pega, 1 sempre pega', () => {
        const never = statusSkill('a.never', [{ type: 'status', status: 'stun', turns: 1, power: 0, chance: 0 }]);
        const always = statusSkill('a.always', [{ type: 'status', status: 'stun', turns: 1, power: 0, chance: 1 }]);
        const start = createBattle({
            teamA: [makeCharacter('a', { speed: 200 }, [never, always])],
            teamB: [makeCharacter('b')],
            seed: 1,
        }).state;

        const missed = applyAction(start, { unitId: 'A1', skillId: 'a.never', targetId: 'B1' });
        const landed = applyAction(start, { unitId: 'A1', skillId: 'a.always', targetId: 'B1' });

        // (O atordoamento de 1 turno já é gasto na vez perdida, logo em seguida;
        // por isso a conferência é pelos eventos, não pelo estado final.)
        assert.deepEqual(eventsOfType(missed.events, 'status_applied'), []);
        assert.deepEqual(eventsOfType(missed.events, 'unit_skipped'), []);
        assert.deepEqual(eventsOfType(landed.events, 'status_applied').map((e) => [e.targetId, e.status]), [['B1', 'stun']]);
        assert.deepEqual(eventsOfType(landed.events, 'unit_skipped').map((e) => e.unitId), ['B1']);
    });
});

describe('status: escudo', () => {
    function setup(shieldValue: number) {
        // B é mais rápido: joga primeiro e bate em A, que já começa com escudo.
        const state = createBattle({
            teamA: [makeCharacter('a', { speed: 50, def: 100 })],
            teamB: [makeCharacter('b', { speed: 100, atk: 100 })],
            seed: 1,
        }).state;

        getUnit(state, 'A1').statuses = [status('shield', { value: shieldValue })];

        return state;
    }

    it('absorve o dano antes da vida', () => {
        const { state, events } = applyAction(setup(80), { unitId: 'B1', skillId: 'b.basic', targetId: 'A1' });
        const [damage] = eventsOfType(events, 'damage');

        assert.deepEqual([damage?.amount, damage?.absorbed, damage?.hp], [50, 50, 1000]);
        assert.deepEqual(getUnit(state, 'A1').statuses.map((s) => [s.kind, s.value]), [['shield', 30]]);
    });

    it('quebra quando o dano é maior, e o resto passa para a vida', () => {
        const { state, events } = applyAction(setup(30), { unitId: 'B1', skillId: 'b.basic', targetId: 'A1' });
        const [damage] = eventsOfType(events, 'damage');

        assert.deepEqual([damage?.amount, damage?.absorbed, damage?.hp], [50, 30, 980]);
        assert.deepEqual(eventsOfType(events, 'status_expired'), [{ type: 'status_expired', unitId: 'A1', status: 'shield' }]);
        assert.deepEqual(getUnit(state, 'A1').statuses, []);
    });

    it('é criado com ATK x poder de quem usou', () => {
        const shield = statusSkill('a1.shield', [{ type: 'status', status: 'shield', turns: 2, power: 1.5 }], 'single-ally');
        const start = createBattle({
            teamA: [makeCharacter('a1', { speed: 200, atk: 100 }, [shield]), makeCharacter('a2')],
            teamB: [makeCharacter('b')],
            seed: 1,
        }).state;

        const { state } = applyAction(start, { unitId: 'A1', skillId: 'a1.shield', targetId: 'A2' });

        assert.deepEqual(getUnit(state, 'A2').statuses.map((s) => [s.kind, s.value, s.turns]), [['shield', 150, 2]]);
    });
});

describe('status: bônus e penalidades de atributo', () => {
    it('somam e subtraem frações do atributo, com um piso', () => {
        const { state } = createBattle({ teamA: [makeCharacter('a', { atk: 100, def: 100, speed: 100 })], teamB: [makeCharacter('b')], seed: 1 });
        const unit = getUnit(state, 'A1');

        unit.statuses = [status('atk_up', { value: 0.5 }), status('def_down', { value: 0.25 }), status('speed_up', { value: 0.3 })];
        assert.deepEqual(
            [getEffectiveStats(unit).atk, getEffectiveStats(unit).def, getEffectiveStats(unit).speed],
            [150, 75, 130],
        );

        unit.statuses = [status('atk_up', { value: 0.5 }), status('atk_down', { value: 0.2 })];
        assert.equal(Math.round(getEffectiveStats(unit).atk), 130);

        unit.statuses = [status('speed_down', { value: 5 })];
        assert.equal(getEffectiveStats(unit).speed, 100 * MIN_STAT_FACTOR);
    });

    it('um bônus dado a si mesmo vale para as duas próximas vezes, não para a atual', () => {
        const rage = statusSkill('a.rage', [{ type: 'status', status: 'atk_up', turns: 2, power: 0.5 }], 'self');
        let state = createBattle({
            teamA: [makeCharacter('a', { speed: 200, atk: 100, maxHp: 1_000_000 }, [rage])],
            teamB: [makeCharacter('b', { speed: 1, def: 100, maxHp: 1_000_000 })],
            seed: 1,
        }).state;
        const damages: number[] = [];

        state = applyAction(state, { unitId: 'A1', skillId: 'a.rage' }).state;

        // Três turnos; só interessa o dano que A causa em cada um.
        for (let i = 0; i < 6; i++) {
            const attacker = state.activeUnitId;
            const result = basicAttackTurn(state);

            state = result.state;

            if (attacker === 'A1') {
                damages.push(eventsOfType(result.events, 'damage')[0]?.amount ?? 0);
            }
        }

        // 100 de ATK contra 100 de DEF = 50; com +50% de ATK = 75.
        assert.deepEqual(damages, [75, 75, 50]);
    });

    it('velocidade maior faz agir antes no turno seguinte', () => {
        let { state } = createBattle({
            teamA: [makeCharacter('a', { speed: 100, maxHp: 1_000_000 })],
            teamB: [makeCharacter('b', { speed: 150, maxHp: 1_000_000 })],
            seed: 1,
        });

        assert.deepEqual(state.order, ['B1', 'A1']);

        // Dobra a velocidade de A por muitos turnos: 200 contra 150.
        getUnit(state, 'A1').statuses = [status('speed_up', { value: 1, turns: 99 })];

        state = basicAttackTurn(state).state;
        state = basicAttackTurn(state).state;

        assert.equal(state.turn, 2);
        assert.deepEqual(state.order, ['A1', 'B1']);
    });

    it('reaplicar o mesmo status substitui o anterior', () => {
        const slow = statusSkill('a.slow', [{ type: 'status', status: 'speed_down', turns: 3, power: 0.3 }]);
        const start = createBattle({
            teamA: [makeCharacter('a', { speed: 500 }, [slow])],
            teamB: [makeCharacter('b', { speed: 100 })],
            seed: 1,
        }).state;

        // Turno 1: A aplica (3 turnos) e B gasta um na própria vez. Turno 2: A reaplica.
        let state = applyAction(start, { unitId: 'A1', skillId: 'a.slow', targetId: 'B1' }).state;
        state = basicAttackTurn(state).state;
        assert.deepEqual(getUnit(state, 'B1').statuses.map((s) => [s.kind, s.turns]), [['speed_down', 2]]);

        state = applyAction(state, { unitId: 'A1', skillId: 'a.slow', targetId: 'B1' }).state;

        assert.deepEqual(getUnit(state, 'B1').statuses.map((s) => [s.kind, s.turns]), [['speed_down', 3]]);
    });
});

describe('status: compatibilidade e consistência', () => {
    it('uma batalha gravada antes de os status existirem continua jogável', () => {
        const { state } = createBattle({ teamA: [makeCharacter('a', { speed: 200 })], teamB: [makeCharacter('b')], seed: 1 });
        const old = JSON.parse(JSON.stringify(state)) as BattleState;

        for (const unit of old.units) {
            delete (unit as Partial<typeof unit>).statuses;
        }

        const result = applyAction(old, { unitId: 'A1', skillId: 'a.basic', targetId: 'B1' });

        assert.deepEqual(result.state.units.map((u) => u.statuses), [[], []]);
    });

    it('os eventos statuses_changed sempre deixam a tela igual ao estado do servidor', () => {
        const teams = [
            [CHARACTERS.slice(0, 3), CHARACTERS.slice(3, 6)],
            [CHARACTERS.slice(3, 6), CHARACTERS.slice(0, 3)],
            [[CHARACTERS[0], CHARACTERS[2], CHARACTERS[4]], [CHARACTERS[1], CHARACTERS[3], CHARACTERS[5]]],
        ];

        for (const [teamA, teamB] of teams) {
            for (const seed of [1, 2, 3, 4, 5]) {
                assert.ok(teamA && teamB);

                let { state, events } = createBattle({
                    teamA: teamA.flatMap((c) => (c ? [c] : [])),
                    teamB: teamB.flatMap((c) => (c ? [c] : [])),
                    seed,
                });
                const shown = new Map<string, StatusEffect[]>(state.units.map((u) => [u.id, []]));

                for (let i = 0; ; i++) {
                    assert.ok(i < 500);

                    for (const event of events) {
                        if (event.type === 'statuses_changed') shown.set(event.unitId, event.statuses);
                    }

                    for (const unit of state.units) {
                        assert.deepEqual(shown.get(unit.id), unit.statuses, `${unit.id} no turno ${state.turn} (semente ${seed})`);
                    }

                    if (state.winner !== null) break;

                    ({ state, events } = applyAction(state, chooseAction(state)));
                }
            }
        }
    });
});

describe('status: provocação', () => {
    const taunt = statusSkill('a.taunt', [{ type: 'status', status: 'taunt', turns: 2, power: 0, to: 'self' }], 'self');
    const blast = statusSkill('b.blast', [{ type: 'damage', power: 1 }], 'all-enemies');

    /** A1 (veloz, provoca), B1 (com um golpe em área) e A2 (lento). A ordem de cada turno é A1, B1, A2. */
    function setup() {
        return createBattle({
            teamA: [makeCharacter('a', { speed: 200, maxHp: 100_000 }, [taunt]), makeCharacter('ally', { speed: 50, maxHp: 100_000 })],
            teamB: [makeCharacter('b', { speed: 100, maxHp: 100_000 }, [blast])],
            seed: 1,
        }).state;
    }

    function targetsOf(state: BattleState, skillId: string): string[] {
        return getAvailableActions(state).find((option) => option.skill.id === skillId)?.targetIds ?? [];
    }

    it('os golpes de alvo único dos inimigos só podem mirar em quem provoca', () => {
        const { state, events } = applyAction(setup(), { unitId: 'A1', skillId: 'a.taunt' });

        assert.deepEqual(eventsOfType(events, 'status_applied').map((event) => [event.targetId, event.status, event.turns]), [['A1', 'taunt', 2]]);
        assert.equal(state.activeUnitId, 'B1');
        assert.deepEqual(targetsOf(state, 'b.basic'), ['A1']);
        assertRuleError(() => applyAction(state, { unitId: 'B1', skillId: 'b.basic', targetId: 'A2' }), 'INVALID_TARGET');
        assert.equal(eventsOfType(applyAction(state, { unitId: 'B1', skillId: 'b.basic', targetId: 'A1' }).events, 'damage')[0]?.targetId, 'A1');
    });

    it('golpes em área continuam pegando todo mundo', () => {
        const { state } = applyAction(setup(), { unitId: 'A1', skillId: 'a.taunt' });

        assert.deepEqual(targetsOf(state, 'b.blast'), ['A1', 'A2']);
        assert.deepEqual(eventsOfType(applyAction(state, { unitId: 'B1', skillId: 'b.blast' }).events, 'damage').map((event) => event.targetId), ['A1', 'A2']);
    });

    it('sem ninguém provocando, qualquer inimigo pode ser alvo', () => {
        const state = basicAttackTurn(setup()).state;

        assert.equal(state.activeUnitId, 'B1');
        assert.deepEqual(targetsOf(state, 'b.basic'), ['A1', 'A2']);
    });

    it('dura dois turnos: o inimigo fica preso em duas vezes e solto na terceira', () => {
        let state = applyAction(setup(), { unitId: 'A1', skillId: 'a.taunt' }).state;
        const seen: string[][] = [];

        for (let i = 0; i < 3; i++) {
            state = playUntilTurnOf(state, 'B1').state;
            seen.push(targetsOf(state, 'b.basic'));
            state = applyAction(state, { unitId: 'B1', skillId: 'b.blast' }).state;
        }

        assert.deepEqual(seen, [['A1'], ['A1'], ['A1', 'A2']]);
        assert.equal(hasTaunt(state), false);
    });

    it('acaba quando quem provoca é derrotado', () => {
        const taunted = applyAction(setup(), { unitId: 'A1', skillId: 'a.taunt' }).state;

        getUnit(taunted, 'A1').hp = 1;

        const state = playUntilTurnOf(applyAction(taunted, { unitId: 'B1', skillId: 'b.basic', targetId: 'A1' }).state, 'B1').state;

        assert.equal(getUnit(state, 'A1').hp, 0);
        assert.deepEqual(targetsOf(state, 'b.basic'), ['A2']);
    });

    it('não muda o alvo de uma passiva que escolhe sozinha (o inimigo mais veloz)', () => {
        const roots: PassiveDefinition = {
            id: 'b.roots',
            name: 'roots',
            description: '',
            effect: { type: 'turn_start', target: 'fastest-enemy', effects: [{ type: 'damage', power: 1 }] },
        };
        const state = createBattle({
            teamA: [makeCharacter('a', { speed: 50, maxHp: 100_000 }, [taunt]), makeCharacter('ally', { speed: 200, maxHp: 100_000 })],
            teamB: [makeCharacter('b', { speed: 100, maxHp: 100_000 }, [], [roots])],
            seed: 1,
        }).state;

        // A1 é lento e provoca; A2 é o mais veloz. A ordem é A2, B1, A1.
        getUnit(state, 'A1').statuses = [status('taunt')];

        const { events } = basicAttackTurn(state);

        assert.equal(eventsOfType(events, 'passive_triggered')[0]?.targetIds[0], 'A2');
    });

    function hasTaunt(state: BattleState): boolean {
        return getUnit(state, 'A1').statuses.some((item) => item.kind === 'taunt');
    }
});

describe('efeito: purificação', () => {
    const purify = statusSkill('a.purify', [{ type: 'cleanse' }, { type: 'heal', power: 1 }], 'single-ally');

    function setup() {
        return createBattle({
            teamA: [makeCharacter('a', { speed: 200 }, [purify]), makeCharacter('ally', { speed: 150 })],
            teamB: [makeCharacter('b', { speed: 100 })],
            seed: 1,
        }).state;
    }

    it('tira os efeitos negativos do alvo e deixa os bônus e o escudo', () => {
        const state = setup();

        getUnit(state, 'A2').statuses = [
            status('poison', { value: 50 }),
            status('atk_up', { value: 0.3 }),
            status('def_down', { value: 0.3 }),
            status('shield', { value: 80 }),
            status('burn', { value: 20 }),
            status('speed_down', { value: 0.2 }),
            status('atk_down', { value: 0.2 }),
        ];

        const { state: after, events } = applyAction(state, { unitId: 'A1', skillId: 'a.purify', targetId: 'A2' });

        assert.deepEqual(getUnit(after, 'A2').statuses.map((item) => item.kind), ['atk_up', 'shield']);
        assert.deepEqual(eventsOfType(events, 'cleansed'), [
            { type: 'cleansed', sourceId: 'A1', targetId: 'A2', statuses: ['poison', 'def_down', 'burn', 'speed_down', 'atk_down'] },
        ]);

        const at = events.findIndex((event) => event.type === 'cleansed');
        const next = events[at + 1];

        assert.equal(next?.type, 'statuses_changed');
        assert.equal(eventsOfType(events, 'status_damage').length, 0, 'o veneno saiu antes da vez do aliado');
    });

    it('tira o atordoamento: o aliado purificado não perde a vez', () => {
        const state = setup();

        getUnit(state, 'A2').statuses = [status('stun', { turns: 1 })];

        const stunned = basicAttackTurn(state);

        assert.equal(eventsOfType(stunned.events, 'unit_skipped')[0]?.unitId, 'A2');

        const { state: after, events } = applyAction(state, { unitId: 'A1', skillId: 'a.purify', targetId: 'A2' });

        assert.equal(eventsOfType(events, 'unit_skipped').length, 0);
        assert.equal(after.activeUnitId, 'A2');
    });

    it('sem nada para tirar, não avisa nada (e o resto da habilidade acontece)', () => {
        const state = setup();

        getUnit(state, 'A2').hp = 900;
        getUnit(state, 'A2').statuses = [status('def_up', { value: 0.3 })];

        const { state: after, events } = applyAction(state, { unitId: 'A1', skillId: 'a.purify', targetId: 'A2' });

        assert.equal(eventsOfType(events, 'cleansed').length, 0);
        assert.equal(getUnit(after, 'A2').hp, 1000);
        assert.deepEqual(getUnit(after, 'A2').statuses.map((item) => item.kind), ['def_up']);
    });

    it('os status negativos são exatamente os que atrapalham quem carrega', () => {
        assert.deepEqual([...NEGATIVE_STATUSES].sort(), ['atk_down', 'bleed', 'burn', 'def_down', 'heal_down', 'poison', 'speed_down', 'stun']);
    });
});

describe('catálogo: provocação e purificação', () => {
    it('Cavaleiro: o Brado de Guerra provoca por 2 turnos e reduz o ataque dos inimigos, sem causar dano', () => {
        const opening = createBattle({ teamA: [getCharacter('cavaleiro'), getCharacter('sacerdote')], teamB: [getCharacter('barbaro'), getCharacter('arqueiro')], seed: 1 }).state;

        opening.activeUnitId = 'A1';
        opening.order = ['A1', 'B1', 'B2', 'A2'];

        const { state, events } = applyAction(opening, { unitId: 'A1', skillId: 'cavaleiro.brado-de-guerra' });

        assert.equal(eventsOfType(events, 'damage').length, 0);
        assert.deepEqual(
            eventsOfType(events, 'status_applied').map((event) => [event.targetId, event.status, event.turns]),
            [['A1', 'taunt', 2], ['B1', 'atk_down', 2], ['B2', 'atk_down', 2]],
        );

        // O Bárbaro e o Arqueiro só podem mirar no Cavaleiro com os golpes de alvo único...
        for (const option of getAvailableActions(state)) {
            if (option.requiresTarget) assert.deepEqual(option.targetIds, ['A1'], option.skill.id);
        }

        // ...mas a Chuva de Flechas ainda pega os dois.
        const archer = structuredClone(state);

        archer.activeUnitId = 'B2';

        const rain = getAvailableActions(archer).find((option) => option.skill.id === 'arqueiro.chuva-de-flechas');

        assert.deepEqual(rain?.targetIds, ['A1', 'A2']);
    });

    it('Sacerdote e Dríade: o Toque Curativo e o Abraço da Floresta purificam o aliado antes de curar', () => {
        for (const [healer, skillId] of [['sacerdote', 'sacerdote.toque-curativo'], ['driade', 'driade.abraco-da-floresta']] as const) {
            const opening = createBattle({ teamA: [getCharacter(healer), getCharacter('cavaleiro')], teamB: [getCharacter('guardiao')], seed: 1 }).state;

            opening.activeUnitId = 'A1';
            opening.energy.A = 10;
            getUnit(opening, 'A2').hp = 500;
            getUnit(opening, 'A2').statuses = [status('poison', { value: 105, growth: 0.6, ticks: 2 }), status('stun', { turns: 1 })];

            const { state, events } = applyAction(opening, { unitId: 'A1', skillId, targetId: 'A2' });

            assert.deepEqual(eventsOfType(events, 'cleansed').map((event) => [event.targetId, event.statuses]), [['A2', ['poison', 'stun']]], healer);
            assert.ok(getUnit(state, 'A2').hp > 500, healer);
            assert.ok(!getUnit(state, 'A2').statuses.some((item) => NEGATIVE_STATUSES.includes(item.kind)), healer);
        }
    });
});
