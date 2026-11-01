import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BattleService, RANKED_TURN_LIMIT_MS } from '../../battles/battle.service';
import { InMemoryBattleStore } from '../../battles/tests/in-memory-store';
import { DRAFT_ORDER, DRAFT_TURN_MS } from '../ranked.draft';
import { RankedError } from '../ranked.errors';
import type { RankedErrorCode } from '../ranked.errors';
import { RANKS, nextRankOf, rankFloorOf, rankOf, ratingChange, searchWindow } from '../ranked.rules';
import { RankedService } from '../ranked.service';
import { InMemoryRankedStore } from './in-memory-ranked-store';

const ANA = 'ana-id';
const BRUNO = 'bruno-id';
const CAIO = 'caio-id';

const ANA_TEAM = ['barbaro', 'criomante', 'guardiao', 'sacerdote', 'arqueiro'];
const BRUNO_TEAM = ['cavaleiro', 'ladino', 'vampiro', 'driade', 'banshee'];

/**
 * A fila, os pontos e as batalhas em memória, com os serviços de verdade
 * (times de cinco) ligados como no jogo: quando uma batalha acaba, a
 * ranqueada lança os pontos. O relógio só anda quando o teste manda.
 */
function setup() {
    const clock = { now: new Date('2026-10-04T12:00:00Z').getTime() };
    const now = () => new Date(clock.now);
    const battleStore = new InMemoryBattleStore(now);
    const battles = new BattleService(battleStore, () => 0, { now });
    const store = new InMemoryRankedStore(battleStore, [ANA, BRUNO, CAIO], now);
    // O sorteio em 0: a escolha por tempo esgotado é sempre a primeira que vale.
    const service = new RankedService(store, battles, { now, random: () => 0 });

    battles.onFinished((battle) => service.settle(battle));

    return { clock, battleStore, battles, store, service };
}

function rejectsWith(promise: Promise<unknown>, code: RankedErrorCode): Promise<void> {
    return assert.rejects(promise, (error: unknown) => error instanceof RankedError && error.code === code, code);
}

const IDLE = { status: 'idle', draftId: null, battleId: null, waitedSeconds: 0 };

/** Ana e Bruno entram na fila e são pareados. Devolve o id da seleção de personagens. */
async function pair(context: ReturnType<typeof setup>): Promise<string> {
    await context.service.enter(ANA);
    // O Bruno chega um segundo depois: quem esperou mais (a Ana) fica com o time A e começa.
    context.clock.now += 1_000;

    const queue = await context.service.enter(BRUNO);

    assert.equal(queue.status, 'drafting');
    assert.ok(queue.draftId);

    return queue.draftId;
}

/**
 * Joga a seleção inteira: a Ana bane o Necromante, o Bruno bane o Druida, e
 * cada um escolhe o seu time de teste, na ordem. Devolve a partida.
 */
async function draftThrough(context: ReturnType<typeof setup>, teams = { A: ANA_TEAM, B: BRUNO_TEAM }): Promise<string> {
    const bans = { A: 'necromante', B: 'druida' };
    const used = { A: 0, B: 0 };
    let view = await context.service.draft(ANA);

    for (const step of DRAFT_ORDER) {
        const player = step.team === 'A' ? ANA : BRUNO;
        const characterId = step.kind === 'ban' ? bans[step.team] : teams[step.team][used[step.team]++]!;

        view = await context.service.draftAction(player, characterId);
    }

    assert.equal(view.status, 'done');
    assert.ok(view.battleId);

    return view.battleId;
}

/** Ana e Bruno são pareados e montam os times. Devolve a partida. */
async function match(context: ReturnType<typeof setup>): Promise<string> {
    await pair(context);

    return draftThrough(context);
}

describe('ranqueada: ranks e pontos', () => {
    it('os ranks vão de Bronze a Lendário, de 100 em 100 pontos', () => {
        assert.deepEqual(RANKS.map((rank) => rank.id), ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'legendary']);
        assert.deepEqual([0, 99, 100, 250, 399, 400, 500, 9999].map(rankOf), ['bronze', 'bronze', 'silver', 'gold', 'platinum', 'diamond', 'legendary', 'legendary']);
        assert.deepEqual(nextRankOf(0), { rank: 'silver', at: 100 });
        assert.deepEqual(nextRankOf(450), { rank: 'legendary', at: 500 });
        assert.equal(nextRankOf(500), null, 'Lendário é o último');
        assert.deepEqual([rankFloorOf(0), rankFloorOf(150), rankFloorOf(720)], [0, 100, 500]);
    });

    it('entre iguais, a vitória vale 16 e a derrota custa 12', () => {
        assert.deepEqual(ratingChange(200, 200), { gain: 16, loss: 12 });
    });

    it('ganhar de quem tem mais pontos vale mais; ganhar de quem tem menos vale menos', () => {
        const upset = ratingChange(100, 200);
        const expected = ratingChange(200, 100);

        assert.deepEqual(upset, { gain: 24, loss: 18 });
        assert.deepEqual(expected, { gain: 8, loss: 6 });
        // Nem com uma diferença enorme a partida deixa de valer alguma coisa, nem passa do teto.
        assert.deepEqual(ratingChange(600, 0), { gain: 6, loss: 4 });
        assert.deepEqual(ratingChange(0, 600), { gain: 32, loss: 24 });
    });

    it('a fila começa procurando perto e abre com o tempo, até aceitar qualquer um', () => {
        assert.deepEqual([0, 4_999, 5_000, 12_000, 19_999].map(searchWindow), [100, 100, 200, 300, 400]);
        assert.equal(searchWindow(20_000), Number.POSITIVE_INFINITY);
    });

    it('quem nunca jogou começa no Bronze, sem pontos e fora da fila', async () => {
        const { service } = setup();

        assert.deepEqual(await service.profile(ANA), {
            points: 0,
            rank: 'bronze',
            rankFloor: 0,
            next: { rank: 'silver', at: 100 },
            wins: 0,
            losses: 0,
            queue: IDLE,
        });
        await rejectsWith(service.profile('ninguem'), 'PLAYER_NOT_FOUND');
    });
});

describe('ranqueada: fila e pareamento', () => {
    it('sozinho na fila, o jogador fica procurando, e o tempo de espera conta', async () => {
        const { clock, service } = setup();
        const entered = await service.enter(ANA);

        assert.deepEqual(entered, { status: 'searching', draftId: null, battleId: null, waitedSeconds: 0 });

        clock.now += 7_500;

        assert.equal((await service.queue(ANA)).waitedSeconds, 7);
    });

    it('quando o segundo entra, os dois vão para a seleção de personagens; no fim dela, a partida ranqueada começa com os times escolhidos', async () => {
        const context = setup();
        const draftId = await pair(context);

        assert.deepEqual(await context.service.queue(ANA), { status: 'drafting', draftId, battleId: null, waitedSeconds: 0 }, 'a Ana descobre na consulta seguinte');
        assert.deepEqual(await context.battleStore.findManyByUser(ANA, 10), [], 'a partida só existe depois da seleção');

        const battleId = await draftThrough(context);
        const ana = await context.service.queue(ANA);
        const asAna = await context.battles.get(ANA, battleId);
        const asBruno = await context.battles.get(BRUNO, battleId);

        assert.deepEqual(ana, { status: 'matched', draftId: null, battleId, waitedSeconds: 0 });
        assert.deepEqual([asAna.mode, asAna.ranked, asAna.status], ['pvp', true, 'in_progress']);
        // Quem esperou mais fica com o time A.
        assert.deepEqual([asAna.playerTeam, asBruno.playerTeam], ['A', 'B']);
        assert.deepEqual(asAna.state.units.filter((unit) => unit.team === 'A').map((unit) => unit.characterId), ANA_TEAM);
        assert.deepEqual(asAna.state.units.filter((unit) => unit.team === 'B').map((unit) => unit.characterId), BRUNO_TEAM);
        assert.equal(asAna.turnTimeLeftMs, RANKED_TURN_LIMIT_MS);
    });

    it('o jogador precisa existir', async () => {
        const { service } = setup();

        await rejectsWith(service.enter('ninguem'), 'PLAYER_NOT_FOUND');
    });

    it('ninguém é pareado consigo mesmo: entrar de novo só recomeça a espera', async () => {
        const { clock, service } = setup();

        await service.enter(ANA);
        clock.now += 30_000;

        assert.deepEqual(await service.enter(ANA), { status: 'searching', draftId: null, battleId: null, waitedSeconds: 0 });
    });

    it('com pontos muito diferentes, a fila espera: só pareia quando o tempo abre a busca', async () => {
        const { clock, store, service } = setup();

        store.setRating(BRUNO, 450);
        await service.enter(ANA);

        assert.equal((await service.enter(BRUNO)).status, 'searching', '450 pontos de diferença: longe demais para começar');

        // As telas dos dois seguem perguntando; aos 15s a busca abre para 400 pontos, e ainda não chega.
        for (let waited = 0; waited < 15_000; waited += 1_500) {
            clock.now += 1_500;
            assert.equal((await service.queue(ANA)).status, 'searching');
            assert.equal((await service.queue(BRUNO)).status, 'searching');
        }

        clock.now += 5_000;

        assert.equal((await service.queue(ANA)).status, 'drafting', 'depois de 20s, aceita qualquer um');
        assert.equal((await service.queue(BRUNO)).status, 'drafting');
    });

    it('entre vários na fila, escolhe quem tem os pontos mais próximos', async () => {
        const { clock, store, service } = setup();

        store.setRating(ANA, 120);
        store.setRating(BRUNO, 60);
        store.setRating(CAIO, 400);
        // O Caio e o Bruno estão longe demais um do outro (340 pontos) para se parearem ao entrar.
        await service.enter(CAIO);
        clock.now += 1_000;
        await service.enter(BRUNO);
        clock.now += 1_000;

        const ana = await service.enter(ANA);

        assert.ok(ana.draftId);
        // A Ana pareou com o Bruno (60 pontos de diferença), não com o Caio (280), que chegou antes.
        assert.equal((await service.queue(BRUNO)).draftId, ana.draftId);
        // O Bruno esperou mais: fica com o time A.
        assert.deepEqual((await service.draft(ANA)).players, { A: BRUNO, B: ANA });
        assert.equal((await service.queue(CAIO)).status, 'searching');
    });

    it('quem fechou a tela não é pareado: o bilhete dele para de dar sinal de vida', async () => {
        const { clock, service } = setup();

        await service.enter(ANA);
        // A tela da Ana some: ninguém pergunta pela fila por ela.
        clock.now += 12_000;

        assert.equal((await service.enter(BRUNO)).status, 'searching');

        // Se ela voltar a perguntar, o bilhete volta a valer.
        assert.equal((await service.queue(ANA)).status, 'drafting');
    });

    it('quem sai da fila não é pareado, e pode voltar depois', async () => {
        const { service } = setup();

        await service.enter(ANA);

        assert.deepEqual(await service.leave(ANA), IDLE);
        assert.equal((await service.enter(BRUNO)).status, 'searching');
        assert.equal((await service.enter(ANA)).status, 'drafting');
    });

    it('os dois perguntando ao mesmo tempo não criam duas seleções', async () => {
        const { clock, store, service } = setup();

        // Longe demais para parear na entrada: os dois ficam na fila.
        store.setRating(BRUNO, 450);
        await service.enter(ANA);
        await service.enter(BRUNO);
        clock.now += 9_000;
        await Promise.all([service.queue(ANA), service.queue(BRUNO)]);
        clock.now += 9_000;
        await Promise.all([service.queue(ANA), service.queue(BRUNO)]);
        clock.now += 3_000;

        const [ana, bruno] = await Promise.all([service.queue(ANA), service.queue(BRUNO)]);
        const settled = [ana, bruno].every((queue) => queue.status === 'drafting') ? [ana, bruno] : [await service.queue(ANA), await service.queue(BRUNO)];

        assert.deepEqual(settled.map((queue) => queue.status), ['drafting', 'drafting']);
        assert.ok(settled[0]?.draftId);
        assert.equal(settled[0]?.draftId, settled[1]?.draftId);
    });

    it('com uma ranqueada em andamento (ou a seleção dela), o jogador não entra em outra fila; quando ela acaba, fica livre', async () => {
        const context = setup();
        const draftId = await pair(context);

        await assert.rejects(
            context.service.enter(BRUNO),
            (error: unknown) => error instanceof RankedError && error.code === 'ALREADY_IN_RANKED_BATTLE' && error.data.draftId === draftId,
        );
        assert.equal((await context.service.leave(BRUNO)).status, 'drafting', 'sair da fila não desfaz a seleção');

        const battleId = await draftThrough(context);

        await assert.rejects(
            context.service.enter(ANA),
            (error: unknown) => error instanceof RankedError && error.code === 'ALREADY_IN_RANKED_BATTLE' && error.data.battleId === battleId,
        );
        // Sair da fila não desfaz a partida.
        assert.equal((await context.service.leave(ANA)).status, 'matched');

        await context.battles.surrender(ANA, battleId);

        assert.equal((await context.service.queue(ANA)).status, 'idle');
        assert.equal((await context.service.enter(ANA)).status, 'searching');
    });

    it('uma reserva de pareamento que ficou pela metade vence, e o bilhete volta para a fila', async () => {
        const { clock, store, service } = setup();
        const entered = await service.enter(ANA);

        assert.equal(entered.status, 'searching');

        const ticket = await store.findTicket(ANA);

        assert.ok(ticket && (await store.claim(ticket.id)));
        // Reservado, mas quem reservou caiu antes de criar a partida.
        assert.equal((await store.findTicket(ANA))?.status, 'matching');

        clock.now += 11_000;

        assert.equal((await service.queue(ANA)).status, 'searching');
        assert.equal((await service.enter(BRUNO)).status, 'drafting');
    });
});

describe('ranqueada: seleção de personagens', () => {
    it('a ordem: um banimento de cada (A e depois B) e as escolhas A, B, B, A, A, B, B, A, A, B', () => {
        assert.deepEqual(
            DRAFT_ORDER.map((step) => `${step.kind === 'ban' ? 'ban' : 'pick'}-${step.team}`),
            ['ban-A', 'ban-B', 'pick-A', 'pick-B', 'pick-B', 'pick-A', 'pick-A', 'pick-B', 'pick-B', 'pick-A', 'pick-A', 'pick-B'],
        );
        assert.equal(DRAFT_TURN_MS, 30_000);
    });

    it('cada um vê o seu lado, de quem é a vez, o tempo e, só na própria vez, o que pode escolher', async () => {
        const context = setup();

        await pair(context);

        const ana = await context.service.draft(ANA);
        const bruno = await context.service.draft(BRUNO);

        assert.deepEqual([ana.you, bruno.you], ['A', 'B']);
        assert.deepEqual(ana.players, { A: ANA, B: BRUNO });
        assert.deepEqual(ana.current, { index: 0, team: 'A', kind: 'ban', timeLeftMs: DRAFT_TURN_MS });
        assert.equal(ana.choices.length, context.battles.listCharacters().length);
        assert.deepEqual(bruno.choices, []);

        await rejectsWith(context.service.draftAction(BRUNO, 'barbaro'), 'NOT_YOUR_DRAFT_TURN');
    });

    it('banido não pode ser escolhido nem banido de novo; o mesmo personagem pode estar nos dois times, mas não duas vezes no mesmo', async () => {
        const context = setup();

        await pair(context);
        await context.service.draftAction(ANA, 'vampiro');

        await rejectsWith(context.service.draftAction(BRUNO, 'vampiro'), 'INVALID_DRAFT_CHOICE');
        await context.service.draftAction(BRUNO, 'driade');

        await rejectsWith(context.service.draftAction(ANA, 'vampiro'), 'INVALID_DRAFT_CHOICE');
        await rejectsWith(context.service.draftAction(ANA, 'dragao'), 'INVALID_DRAFT_CHOICE');
        await context.service.draftAction(ANA, 'barbaro');

        // O Bruno também pode levar o Bárbaro; e escolhe duas vezes seguidas.
        await context.service.draftAction(BRUNO, 'barbaro');
        await rejectsWith(context.service.draftAction(BRUNO, 'barbaro'), 'INVALID_DRAFT_CHOICE');

        const view = await context.service.draftAction(BRUNO, 'cavaleiro');

        assert.deepEqual(view.banned, ['vampiro', 'driade']);
        assert.deepEqual(view.teams, { A: ['barbaro'], B: ['barbaro', 'cavaleiro'] });
        assert.deepEqual(view.current?.team, 'A');
        assert.ok(!view.choices.includes('vampiro'));
    });

    it('quando o tempo do passo acaba, o jogo escolhe por quem estava na vez, um passo por prazo vencido', async () => {
        const context = setup();

        await pair(context);
        context.clock.now += DRAFT_TURN_MS - 1;
        assert.equal((await context.service.draft(BRUNO)).actions.length, 0, 'ainda dentro do prazo');

        // Passaram três prazos inteiros sem ninguém jogar: os dois banimentos e a primeira escolha da Ana.
        context.clock.now += 1 + 2 * DRAFT_TURN_MS;

        const view = await context.service.draft(BRUNO);

        assert.deepEqual(view.actions.map((action) => [action.team, action.kind, action.auto]), [
            ['A', 'ban', true],
            ['B', 'ban', true],
            ['A', 'pick', true],
        ]);
        // O sorteio em 0 pega a primeira opção que vale: o banido não volta, nem o já escolhido.
        assert.equal(new Set(view.actions.map((action) => action.characterId)).size, 3);
        assert.equal(view.current?.team, 'B');
        assert.equal(view.current?.timeLeftMs, DRAFT_TURN_MS);
    });

    it('a seleção inteira por tempo esgotado ainda cria a partida', async () => {
        const context = setup();

        await pair(context);
        context.clock.now += DRAFT_ORDER.length * DRAFT_TURN_MS;

        const view = await context.service.draft(ANA);

        assert.equal(view.status, 'done');
        assert.ok(view.battleId);
        assert.equal(view.teams.A.length, 5);
        assert.equal(view.teams.B.length, 5);
        assert.equal((await context.battles.get(BRUNO, view.battleId)).ranked, true);
    });

    it('fora de uma seleção, não há o que consultar nem escolher', async () => {
        const { service } = setup();

        await rejectsWith(service.draft(ANA), 'NOT_IN_DRAFT');
        await rejectsWith(service.draftAction(ANA, 'barbaro'), 'NOT_IN_DRAFT');
    });
});

describe('ranqueada: resultado', () => {
    it('quem vence ganha pontos e quem perde não fica com menos de zero; o placar dos dois anda', async () => {
        const context = setup();
        const battleId = await match(context);
        const ended = await context.battles.surrender(BRUNO, battleId);

        // Os dois tinham zero: +16 para a Ana; o Bruno perderia 12, mas não tem de onde tirar.
        assert.equal(ended.battle.ratingChange, 0, 'a resposta de quem perdeu já traz a variação dele');
        assert.equal((await context.battles.get(ANA, battleId)).ratingChange, 16);

        const ana = await context.service.profile(ANA);
        const bruno = await context.service.profile(BRUNO);

        assert.deepEqual([ana.points, ana.rank, ana.wins, ana.losses], [16, 'bronze', 1, 0]);
        assert.deepEqual([bruno.points, bruno.rank, bruno.wins, bruno.losses], [0, 'bronze', 0, 1]);
    });

    it('a derrota custa pontos a quem tem, e pode derrubar de rank', async () => {
        const context = setup();

        context.store.setRating(ANA, 104);
        context.store.setRating(BRUNO, 96);

        const battleId = await match(context);

        await context.battles.surrender(ANA, battleId);

        const ana = await context.service.profile(ANA);
        const bruno = await context.service.profile(BRUNO);

        // Quase iguais (8 pontos de diferença): o Bruno, um pouco atrás, ganha 17; a Ana perde 13.
        assert.deepEqual([ana.points, ana.rank], [91, 'bronze']);
        assert.deepEqual([bruno.points, bruno.rank, bruno.next], [113, 'silver', { rank: 'gold', at: 200 }]);
        assert.deepEqual((await context.battles.list(ANA)).map((item) => [item.ranked, item.ratingChange]), [[true, -13]]);
        assert.deepEqual((await context.battles.list(BRUNO)).map((item) => [item.ranked, item.ratingChange]), [[true, 17]]);
    });

    it('vitória por tempo esgotado também vale pontos', async () => {
        const context = setup();
        const battleId = await match(context);
        const waiting = (await context.battles.get(ANA, battleId)).availableActions.length === 0 ? ANA : BRUNO;

        context.clock.now += RANKED_TURN_LIMIT_MS;

        const claimed = await context.battles.claimTimeout(waiting, battleId);

        assert.deepEqual([claimed.battle.status, claimed.battle.state.timedOut, claimed.battle.ratingChange], ['finished', true, 16]);
        assert.equal((await context.service.profile(waiting)).wins, 1);
    });

    it('o resultado de uma partida é lançado uma vez só', async () => {
        const context = setup();
        const battleId = await match(context);

        await context.battles.surrender(BRUNO, battleId);

        const finished = await context.battleStore.findById(battleId);

        assert.ok(finished);
        await context.service.settle(finished);
        await context.service.settle(finished);

        assert.deepEqual([(await context.service.profile(ANA)).points, (await context.service.profile(ANA)).wins], [16, 1]);
    });

    it('batalha que não é ranqueada não mexe nos pontos', async () => {
        const context = setup();
        const id = await context.battles.createVersus({ hostId: ANA, hostTeam: ANA_TEAM, guestId: BRUNO, guestTeam: BRUNO_TEAM });
        const ended = await context.battles.surrender(BRUNO, id);

        assert.deepEqual([ended.battle.ranked, ended.battle.ratingChange], [false, null]);
        assert.deepEqual([(await context.service.profile(ANA)).points, (await context.service.profile(ANA)).wins], [0, 0]);
    });
});
