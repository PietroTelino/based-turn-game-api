import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FURY_DAMAGE_PER_TURN, FURY_START_TURN, GameRuleError, chooseAction, createBattle, getCharacter } from '../../../game';
import type { BattleState, GameRuleErrorCode } from '../../../game';
import { BattleError } from '../battle.errors';
import type { BattleErrorCode } from '../battle.errors';
import { BattleService, TEAM_SIZE } from '../battle.service';
import { InMemoryBattleStore } from './in-memory-store';

const PLAYER = 'jogador-1';
const OTHER_PLAYER = 'jogador-2';

/**
 * No jogo toda batalha é 5 contra 5. A maioria dos testes usa 1 contra 1,
 * que dá para acompanhar jogada a jogada; os que testam o tamanho do time
 * pedem o tamanho de verdade (TEAM_SIZE).
 */
function setup(teamSize = 1) {
    const store = new InMemoryBattleStore();
    // random fixo em 0: o time sorteado da IA é sempre o começo do catálogo.
    const service = new BattleService(store, () => 0, { teamSize });

    return { store, service };
}

const FIVE = ['barbaro', 'criomante', 'guardiao', 'clerigo', 'arqueiro'];

function rejectsWith(promise: Promise<unknown>, code: BattleErrorCode): Promise<void> {
    return assert.rejects(promise, (error: unknown) => error instanceof BattleError && error.code === code, code);
}

function rejectsWithRule(promise: Promise<unknown>, code: GameRuleErrorCode): Promise<void> {
    return assert.rejects(promise, (error: unknown) => error instanceof GameRuleError && error.code === code, code);
}

describe('BattleService: criar batalha', () => {
    it('cria, grava e devolve a batalha já na vez do jogador', async () => {
        const { store, service } = setup();

        const { battle, events } = await service.create(PLAYER, { team: ['barbaro'], enemyTeam: ['cavaleiro'], seed: 1 });
        const stored = await store.findById(battle.id);

        assert.equal(battle.status, 'in_progress');
        assert.equal(battle.playerTeam, 'A');
        assert.equal(battle.state.turn, 1);
        assert.deepEqual(battle.state.order, ['A1', 'B1'], 'o bárbaro é mais veloz que o cavaleiro');
        assert.equal(battle.state.activeUnitId, 'A1');
        assert.deepEqual(
            battle.availableActions.map((a) => a.skill.id),
            ['barbaro.machadada', 'barbaro.golpe-trovejante'],
        );
        assert.deepEqual(events.map((e) => e.type), ['turn_started', 'unit_activated']);
        assert.ok(!('rngState' in battle.state) && !('draws' in battle.state), 'o sorteio fica só no servidor');

        assert.equal(stored?.userId, PLAYER);
        assert.equal(stored?.turn, 1);
        assert.equal(stored?.step, battle.state.step);
    });

    it('quando a IA é mais rápida, ela joga antes e os eventos vêm juntos', async () => {
        const { service } = setup();

        const { battle, events } = await service.create(PLAYER, { team: ['cavaleiro'], enemyTeam: ['barbaro'], seed: 1 });

        const last = events[events.length - 1];

        assert.equal(battle.state.activeUnitId, 'A1');
        assert.equal(battle.state.turn, 1, 'a IA jogou, mas o turno 1 só acaba depois da vez do jogador');
        assert.deepEqual(events[0], { type: 'turn_started', turn: 1, order: ['B1', 'A1'], energy: 3, fury: 0 });
        assert.deepEqual(events[1], { type: 'unit_activated', unitId: 'B1', team: 'B' });
        assert.ok(last?.type === 'unit_activated' && last.unitId === 'A1', 'a resposta termina na vez do jogador');
        assert.deepEqual(events[2], {
            type: 'skill_used',
            unitId: 'B1',
            skillId: 'barbaro.golpe-trovejante',
            targetIds: ['A1'],
            team: 'B',
            energy: 0,
        });
    });

    it('não envia o gerador de números aleatórios para o cliente', async () => {
        const { store, service } = setup();

        const { battle } = await service.create(PLAYER, { team: ['piromante'], seed: 1 });
        const stored = await store.findById(battle.id);

        assert.equal('rngState' in battle.state, false);
        assert.equal(typeof stored?.state.rngState, 'number');
    });

    it('sorteia para a IA um time do mesmo tamanho, sem repetir personagem', async () => {
        const { service } = setup(3);

        const { battle } = await service.create(PLAYER, { team: ['barbaro', 'criomante', 'guardiao'], seed: 1 });
        const enemies = battle.state.units.filter((u) => u.team === 'B').map((u) => u.characterId);

        assert.equal(enemies.length, 3);
        assert.equal(new Set(enemies).size, 3);
    });

    it('toda batalha é 5 contra 5: aceita exatamente cinco, e a IA entra com cinco também', async () => {
        const store = new InMemoryBattleStore();
        // Sem a opção de teste: é o serviço como o jogo usa.
        const service = new BattleService(store, () => 0);

        const { battle } = await service.create(PLAYER, { team: FIVE, seed: 1 });
        const idsOf = (side: string) => battle.state.units.filter((u) => u.team === side).map((u) => u.characterId);

        assert.equal(FIVE.length, TEAM_SIZE);
        assert.deepEqual(idsOf('A'), FIVE);
        assert.equal(new Set(idsOf('B')).size, TEAM_SIZE);
        assert.equal(battle.state.order.length, 2 * TEAM_SIZE, 'as dez unidades entram na ordem do turno');
    });

    it('recusa qualquer time que não tenha exatamente cinco personagens, do jogador ou da IA', async () => {
        const service = new BattleService(new InMemoryBattleStore(), () => 0);

        for (const size of [0, 1, 2, 3, 4]) {
            await rejectsWith(service.create(PLAYER, { team: FIVE.slice(0, size) }), 'INVALID_TEAM');
        }

        await rejectsWith(service.create(PLAYER, { team: [...FIVE, 'ladino'] }), 'INVALID_TEAM');
        await rejectsWith(service.create(PLAYER, { team: ['barbaro', 'barbaro', 'guardiao', 'clerigo', 'arqueiro'] }), 'INVALID_TEAM');
        await rejectsWith(service.create(PLAYER, { team: FIVE, enemyTeam: ['cavaleiro'] }), 'INVALID_TEAM');
        await rejectsWith(service.create(PLAYER, { team: FIVE, enemyTeam: ['cavaleiro', 'ladino', 'vampiro', 'driade', 'banshee', 'piromante'] }), 'INVALID_TEAM');
    });

    it('recusa personagem repetido e personagem que não existe', async () => {
        const { service } = setup(2);

        await rejectsWith(service.create(PLAYER, { team: ['piromante', 'piromante'] }), 'INVALID_TEAM');
        await rejectsWith(service.create(PLAYER, { team: ['piromante', 'nao-existe'] }), 'UNKNOWN_CHARACTER');
        await rejectsWith(service.create(PLAYER, { team: ['piromante', 'clerigo'], enemyTeam: ['cavaleiro', 'nao-existe'] }), 'UNKNOWN_CHARACTER');
    });
});

describe('BattleService: jogar', () => {
    it('aplica a ação do jogador, deixa a IA responder e grava o resultado', async () => {
        const { store, service } = setup();
        const created = await service.create(PLAYER, { team: ['barbaro'], enemyTeam: ['cavaleiro'], seed: 1 });

        const { battle, events } = await service.act(PLAYER, created.battle.id, {
            unitId: 'A1',
            skillId: 'barbaro.machadada',
            targetId: 'B1',
        });
        const stored = await store.findById(battle.id);
        const actors = events.flatMap((e) => (e.type === 'skill_used' ? [e.unitId] : []));

        assert.deepEqual(actors, ['A1', 'B1'], 'jogador e depois a IA');
        assert.equal(events[events.length - 1]?.type, 'unit_activated');
        assert.equal(battle.state.activeUnitId, 'A1');
        assert.equal(created.battle.state.turn, 1);
        assert.equal(battle.state.turn, 2, 'os dois agiram: começou o turno 2');
        assert.equal(stored?.turn, 2);
        assert.equal(stored?.step, battle.state.step);
        assert.deepEqual(await service.get(PLAYER, battle.id), battle);
    });

    it('recusa mexer na unidade da IA e em batalha de outro jogador', async () => {
        const { service } = setup();
        const { battle } = await service.create(PLAYER, { team: ['barbaro'], enemyTeam: ['cavaleiro'], seed: 1 });
        const action = { unitId: 'A1', skillId: 'barbaro.machadada', targetId: 'B1' };

        await rejectsWith(
            service.act(PLAYER, battle.id, { unitId: 'B1', skillId: 'cavaleiro.corte', targetId: 'A1' }),
            'NOT_YOUR_UNIT',
        );
        await rejectsWith(service.act(OTHER_PLAYER, battle.id, action), 'BATTLE_NOT_FOUND');
        await rejectsWith(service.get(OTHER_PLAYER, battle.id), 'BATTLE_NOT_FOUND');
        await rejectsWith(service.get(PLAYER, 'isso-nao-e-um-uuid'), 'BATTLE_NOT_FOUND');
        await rejectsWith(service.get(PLAYER, '00000000-0000-4000-8000-000000000000'), 'BATTLE_NOT_FOUND');
    });

    it('uma ação que quebra regra do jogo não altera a batalha gravada', async () => {
        const { store, service } = setup();
        const { battle } = await service.create(PLAYER, { team: ['barbaro'], enemyTeam: ['cavaleiro'], seed: 1 });
        const before = await store.findById(battle.id);

        await rejectsWithRule(service.act(PLAYER, battle.id, { unitId: 'A1', skillId: 'barbaro.machadada' }), 'TARGET_REQUIRED');
        await rejectsWithRule(
            service.act(PLAYER, battle.id, { unitId: 'A1', skillId: 'nao-existe', targetId: 'B1' }),
            'SKILL_NOT_FOUND',
        );

        assert.deepEqual(await store.findById(battle.id), before);
    });

    it('duas ações simultâneas na mesma vez: só uma vale', async () => {
        const { service } = setup();
        const { battle } = await service.create(PLAYER, { team: ['barbaro'], enemyTeam: ['cavaleiro'], seed: 1 });
        const action = { unitId: 'A1', skillId: 'barbaro.machadada', targetId: 'B1' };

        const results = await Promise.allSettled([
            service.act(PLAYER, battle.id, action),
            service.act(PLAYER, battle.id, action),
        ]);
        const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

        assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
        assert.equal(rejected.length, 1);
        assert.ok(rejected[0]?.reason instanceof BattleError && rejected[0].reason.code === 'BATTLE_CONFLICT');
    });

    it('a batalha chega ao fim, registra o vencedor e não aceita mais ações', async () => {
        const { store, service } = setup(3);
        let { battle } = await service.create(PLAYER, {
            team: ['piromante', 'cavaleiro', 'clerigo'],
            enemyTeam: ['barbaro', 'criomante', 'guardiao'],
            seed: 1,
        });

        for (let i = 0; battle.status === 'in_progress'; i++) {
            assert.ok(i < 300, 'a batalha deveria terminar');

            const stored = await store.findById(battle.id);
            assert.ok(stored);

            // O "jogador" deste teste escolhe as jogadas com a mesma IA.
            ({ battle } = await service.act(PLAYER, battle.id, chooseAction(stored.state)));
        }

        const stored = await store.findById(battle.id);

        assert.equal(battle.status, 'finished');
        assert.ok(battle.winner === 'A' || battle.winner === 'B');
        assert.ok(battle.finishedAt instanceof Date);
        assert.deepEqual(battle.availableActions, []);
        assert.equal(battle.state.activeUnitId, null);
        assert.equal(stored?.status, 'finished');
        assert.equal(stored?.winner, battle.winner);

        await rejectsWithRule(
            service.act(PLAYER, battle.id, { unitId: 'A1', skillId: 'piromante.labareda', targetId: 'B1' }),
            'BATTLE_OVER',
        );
    });

    it('desistir encerra a batalha como derrota e bloqueia novas jogadas', async () => {
        const { store, service } = setup();
        const created = await service.create(PLAYER, { team: ['barbaro'], enemyTeam: ['cavaleiro'], seed: 1 });

        const { battle, events } = await service.surrender(PLAYER, created.battle.id);
        const stored = await store.findById(battle.id);

        assert.equal(battle.status, 'finished');
        assert.equal(battle.winner, 'B');
        assert.equal(battle.state.surrenderedBy, 'A');
        assert.ok(battle.finishedAt instanceof Date);
        assert.deepEqual(battle.availableActions, []);
        assert.deepEqual(events.map((e) => e.type), ['surrendered', 'battle_ended']);
        assert.equal(stored?.status, 'finished');
        assert.equal(stored?.winner, 'B');

        await rejectsWithRule(service.surrender(PLAYER, battle.id), 'BATTLE_OVER');
        await rejectsWithRule(
            service.act(PLAYER, battle.id, { unitId: 'A1', skillId: 'barbaro.machadada', targetId: 'B1' }),
            'BATTLE_OVER',
        );
    });

    it('desistência e jogada ao mesmo tempo: só uma vale, e a batalha não reabre', async () => {
        for (const surrenderFirst of [true, false]) {
            const { store, service } = setup();
            const { battle } = await service.create(PLAYER, { team: ['barbaro'], enemyTeam: ['cavaleiro'], seed: 1 });
            const act = () => service.act(PLAYER, battle.id, { unitId: 'A1', skillId: 'barbaro.machadada', targetId: 'B1' });
            const giveUp = () => service.surrender(PLAYER, battle.id);

            const results = await Promise.allSettled(surrenderFirst ? [giveUp(), act()] : [act(), giveUp()]);
            const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
            const stored = await store.findById(battle.id);

            assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
            assert.ok(rejected[0]?.reason instanceof BattleError && rejected[0].reason.code === 'BATTLE_CONFLICT');
            // Quem chegou primeiro é o que ficou gravado.
            assert.equal(stored?.status, surrenderFirst ? 'finished' : 'in_progress');
        }
    });

    it('não deixa desistir da batalha de outro jogador', async () => {
        const { store, service } = setup();
        const { battle } = await service.create(PLAYER, { team: ['barbaro'], enemyTeam: ['cavaleiro'], seed: 1 });

        await rejectsWith(service.surrender(OTHER_PLAYER, battle.id), 'BATTLE_NOT_FOUND');
        assert.equal((await store.findById(battle.id))?.status, 'in_progress');
    });

    it('a batalha enviada para a tela diz quanto a fúria aumenta o dano no turno atual', async () => {
        const { store, service } = setup();
        const { battle } = await service.create(PLAYER, { team: ['cavaleiro'], enemyTeam: ['cavaleiro'], seed: 1 });

        assert.equal(battle.state.fury, 0);

        // Avança a batalha gravada para dois turnos depois do começo da fúria.
        const stored = await store.findById(battle.id);

        assert.ok(stored);
        stored.state.turn = FURY_START_TURN + 2;
        await store.saveIfStep(battle.id, stored.step, { ...stored, turn: stored.state.turn });

        assert.equal((await service.get(PLAYER, battle.id)).state.fury, 2 * FURY_DAMAGE_PER_TURN);
        assert.ok(!('fury' in ((await store.findById(battle.id))?.state ?? {})), 'é calculada na hora, não fica gravada');
    });

    it('lista só as batalhas do próprio jogador, sem o estado completo', async () => {
        const { service } = setup();

        await service.create(PLAYER, { team: ['piromante'], seed: 1 });
        await service.create(PLAYER, { team: ['criomante'], seed: 2 });
        await service.create(OTHER_PLAYER, { team: ['clerigo'], seed: 3 });

        const battles = await service.list(PLAYER);

        assert.equal(battles.length, 2);
        assert.ok(battles.every((b) => b.mode === 'ai' && b.playerTeam === 'A'));
        assert.ok(battles.every((b) => !('state' in b) && !('events' in b) && !('userId' in b)), 'só o resumo, sem ids de jogadores');
    });
});

describe('BattleService: batalha de treino (tutorial)', () => {
    const TRAINING_TEAM = ['cavaleiro', 'barbaro', 'piromante', 'arqueiro', 'clerigo'];
    const TRAINING_ENEMY = ['guardiao', 'vampiro', 'espadachim', 'criomante', 'driade'];

    it('a marca de treino vai no estado, chega à tela e continua lá depois de cada jogada', async () => {
        const { store, service } = setup(TEAM_SIZE);

        const { battle } = await service.create(PLAYER, { team: TRAINING_TEAM, enemyTeam: TRAINING_ENEMY, seed: 1, training: true });

        assert.equal(battle.state.training, true);
        assert.equal(battle.state.activeUnitId, 'A2', 'o Bárbaro é o mais veloz: o jogador abre a batalha');

        const played = await service.act(PLAYER, battle.id, { unitId: 'A2', skillId: 'barbaro.machadada', targetId: 'B1' });

        assert.equal(played.battle.state.training, true);
        assert.equal((await store.findById(battle.id))?.state.training, true);
        assert.equal((await service.get(PLAYER, battle.id)).state.training, true);
    });

    it('batalha comum não tem a marca', async () => {
        const { service } = setup();

        const { battle } = await service.create(PLAYER, { team: ['barbaro'], enemyTeam: ['cavaleiro'], seed: 1 });

        assert.equal(battle.state.training, undefined);
    });

    it('a IA joga fraco: uma habilidade com custo por turno, e quem só usa o ataque básico vence', async () => {
        const { service } = setup(TEAM_SIZE);
        const costOf = new Map(TRAINING_ENEMY.flatMap((id) => getCharacter(id).skills.map((skill) => [skill.id, skill.energyCost] as const)));

        let { battle } = await service.create(PLAYER, { team: TRAINING_TEAM, enemyTeam: TRAINING_ENEMY, seed: 2, training: true });
        let turn = 1;
        /** Quantas habilidades com custo a IA usou em cada turno. */
        const paidByTurn = new Map<number, number>();

        for (let i = 0; battle.status === 'in_progress' && i < 500; i++) {
            const basic = battle.availableActions[0];

            assert.ok(basic, 'na vez do jogador sempre há o ataque básico');

            const response = await service.act(PLAYER, battle.id, {
                unitId: battle.state.activeUnitId ?? '',
                skillId: basic.skill.id,
                targetId: basic.targetIds[0] ?? '',
            });

            for (const event of response.events) {
                if (event.type === 'turn_started') turn = event.turn;

                if (event.type === 'skill_used' && event.team === 'B' && (costOf.get(event.skillId) ?? 0) > 0) {
                    paidByTurn.set(turn, (paidByTurn.get(turn) ?? 0) + 1);
                }
            }

            battle = response.battle;
        }

        assert.equal(battle.winner, 'A');
        assert.ok(paidByTurn.size > 0, 'a IA de treino também usa habilidades com custo');
        assert.ok([...paidByTurn.values()].every((count) => count === 1), JSON.stringify([...paidByTurn]));
    });
});

describe('BattleService: batalha gravada no formato antigo', () => {
    it('abre e continua jogável (antes, o turno contava cada vez e não havia ordem gravada)', async () => {
        const { store, service } = setup();
        const { state } = createBattle({ teamA: [getCharacter('barbaro')], teamB: [getCharacter('cavaleiro')], seed: 1 });
        const legacy = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;

        delete legacy.order;
        delete legacy.step;
        legacy.turn = 5;

        // No banco, a coluna nova `step` de uma batalha antiga vale o que a migração gravou.
        const old = await store.create(PLAYER, {
            status: 'in_progress',
            winner: null,
            turn: 3,
            step: 5,
            state: legacy as unknown as BattleState,
            finishedAt: null,
        });

        const view = await service.get(PLAYER, old.id);

        assert.deepEqual(view.state.order, ['A1', 'B1']);
        assert.equal(view.state.step, 5);
        assert.equal(view.state.turn, 3);

        const { battle } = await service.act(PLAYER, old.id, { unitId: 'A1', skillId: 'barbaro.machadada', targetId: 'B1' });
        const stored = await store.findById(old.id);

        assert.equal(battle.state.activeUnitId, 'A1');
        assert.equal(battle.state.turn, 4);
        assert.equal(stored?.step, battle.state.step);
        assert.ok((stored?.step ?? 0) > 5);
    });
});

describe('BattleService: batalha entre dois jogadores', () => {
    const HOST = PLAYER;
    const GUEST = OTHER_PLAYER;
    const STRANGER = 'jogador-3';

    /** Bárbaro (135 de velocidade) do anfitrião contra Cavaleiro (88) do convidado: o anfitrião começa. */
    async function versus(teamSize = 1, hostTeam = ['barbaro'], guestTeam = ['cavaleiro']) {
        const { store, service } = setup(teamSize);
        const id = await service.createVersus({ hostId: HOST, hostTeam, guestId: GUEST, guestTeam, seed: 1 });

        return { store, service, id };
    }

    it('nasce parada na vez de quem é mais veloz, e cada jogador a enxerga do seu lado', async () => {
        const { service, id } = await versus();
        const host = await service.get(HOST, id);
        const guest = await service.get(GUEST, id);

        assert.deepEqual([host.mode, host.playerTeam, guest.mode, guest.playerTeam], ['pvp', 'A', 'pvp', 'B']);
        assert.equal(host.state.activeUnitId, 'A1');
        assert.equal(host.state.step, 1, 'ninguém jogou ainda: a IA não entra nesta batalha');
        assert.ok(host.availableActions.length > 0, 'quem está na vez recebe as opções');
        assert.deepEqual(guest.availableActions, [], 'quem espera não recebe opção nenhuma');
        await rejectsWith(service.get(STRANGER, id), 'BATTLE_NOT_FOUND');
    });

    it('cada jogador só mexe nas próprias unidades, na vez delas, e ninguém joga pelo outro', async () => {
        const { service, id } = await versus();

        // Não é a vez do convidado, e a unidade do anfitrião não é dele.
        await rejectsWithRule(service.act(GUEST, id, { unitId: 'B1', skillId: 'cavaleiro.corte', targetId: 'A1' }), 'NOT_YOUR_TURN');
        await rejectsWith(service.act(GUEST, id, { unitId: 'A1', skillId: 'barbaro.machadada', targetId: 'B1' }), 'NOT_YOUR_UNIT');
        await rejectsWith(service.act(STRANGER, id, { unitId: 'A1', skillId: 'barbaro.machadada', targetId: 'B1' }), 'BATTLE_NOT_FOUND');

        const played = await service.act(HOST, id, { unitId: 'A1', skillId: 'barbaro.machadada', targetId: 'B1' });

        assert.equal(played.events.filter((e) => e.type === 'skill_used').length, 1, 'só a jogada do anfitrião');
        assert.equal(played.battle.state.activeUnitId, 'B1', 'a vez passou para o convidado e ficou parada nele');
        assert.deepEqual(played.battle.availableActions, []);

        // Agora é o convidado quem joga; o anfitrião não pode jogar por ele.
        await rejectsWith(service.act(HOST, id, { unitId: 'B1', skillId: 'cavaleiro.corte', targetId: 'A1' }), 'NOT_YOUR_UNIT');

        const answered = await service.act(GUEST, id, { unitId: 'B1', skillId: 'cavaleiro.corte', targetId: 'A1' });

        assert.equal(answered.battle.playerTeam, 'B');
        assert.ok(answered.events.some((e) => e.type === 'damage' && e.targetId === 'A1'));
    });

    it('o oponente acompanha as jogadas pelo histórico: pede o que veio depois do que já viu', async () => {
        const { service, id } = await versus();
        const opening = await service.events(GUEST, id, 0);

        assert.deepEqual(opening.events.map((e) => e.type), ['turn_started', 'unit_activated']);
        assert.equal(opening.battle.cursor, 2);

        const played = await service.act(HOST, id, { unitId: 'A1', skillId: 'barbaro.machadada', targetId: 'B1' });
        const seen = await service.events(GUEST, id, opening.battle.cursor);

        assert.deepEqual(seen.events, played.events, 'o convidado recebe exatamente o que o anfitrião recebeu');
        assert.equal(seen.battle.cursor, 2 + played.events.length);
        assert.equal(played.battle.cursor, seen.battle.cursor, 'quem jogou já sai com o contador em dia');
        assert.ok(seen.battle.availableActions.length > 0, 'e agora as opções são do convidado');

        // Nada de novo: lista vazia, contador igual.
        const idle = await service.events(GUEST, id, seen.battle.cursor);

        assert.deepEqual([idle.events.length, idle.battle.cursor], [0, seen.battle.cursor]);
        await rejectsWith(service.events(STRANGER, id, 0), 'BATTLE_NOT_FOUND');
    });

    it('batalha contra a IA não guarda histórico: o contador fica em zero', async () => {
        const { service } = setup();
        const { battle } = await service.create(PLAYER, { team: ['barbaro'], enemyTeam: ['cavaleiro'], seed: 1 });
        const played = await service.act(PLAYER, battle.id, { unitId: 'A1', skillId: 'barbaro.machadada', targetId: 'B1' });

        assert.deepEqual([battle.mode, battle.cursor, played.battle.cursor], ['ai', 0, 0]);
        assert.deepEqual((await service.events(PLAYER, battle.id, 0)).events, []);
    });

    it('qualquer um dos dois pode desistir, a qualquer momento, e o outro vence', async () => {
        const first = await versus();
        // Não é a vez do convidado, e mesmo assim ele pode desistir.
        const quit = await first.service.surrender(GUEST, first.id);

        assert.deepEqual([quit.battle.status, quit.battle.winner, quit.battle.state.surrenderedBy], ['finished', 'A', 'B']);
        assert.deepEqual((await first.service.events(HOST, first.id, 2)).events, quit.events, 'o anfitrião fica sabendo pelo histórico');
        await rejectsWithRule(first.service.act(HOST, first.id, { unitId: 'A1', skillId: 'barbaro.machadada', targetId: 'B1' }), 'BATTLE_OVER');

        const second = await versus();
        const hostQuit = await second.service.surrender(HOST, second.id);

        assert.deepEqual([hostQuit.battle.winner, hostQuit.battle.state.surrenderedBy], ['B', 'A']);
    });

    it('uma batalha inteira, com cada lado jogando na sua vez, chega ao fim e aparece na lista dos dois', async () => {
        const { store, service, id } = await versus(3, ['piromante', 'cavaleiro', 'clerigo'], ['barbaro', 'criomante', 'guardiao']);
        let view = await service.get(HOST, id);

        for (let i = 0; view.status === 'in_progress'; i++) {
            assert.ok(i < 400, 'a batalha deveria terminar');

            const stored = await store.findById(id);

            assert.ok(stored);

            const action = chooseAction(stored.state);
            const mover = action.unitId.startsWith('A') ? HOST : GUEST;

            view = (await service.act(mover, id, action)).battle;
        }

        const [mine] = await service.list(HOST);
        const [theirs] = await service.list(GUEST);

        assert.ok(view.winner === 'A' || view.winner === 'B');
        assert.deepEqual([mine?.id, mine?.mode, mine?.playerTeam, mine?.winner], [id, 'pvp', 'A', view.winner]);
        assert.deepEqual([theirs?.id, theirs?.mode, theirs?.playerTeam], [id, 'pvp', 'B']);
        assert.deepEqual(await service.list(STRANGER), []);
    });

    it('os times da sala seguem a mesma regra de tamanho das outras batalhas', async () => {
        const service = new BattleService(new InMemoryBattleStore(), () => 0);

        await rejectsWith(service.createVersus({ hostId: HOST, hostTeam: FIVE, guestId: GUEST, guestTeam: ['cavaleiro'] }), 'INVALID_TEAM');
        assert.throws(() => service.validateTeam(['cavaleiro']), (error: unknown) => error instanceof BattleError && error.code === 'INVALID_TEAM');
        assert.doesNotThrow(() => service.validateTeam(FIVE));
    });
});
