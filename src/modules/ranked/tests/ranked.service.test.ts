import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BattleError } from '../../battles/battle.errors';
import { BattleService, RANKED_TURN_LIMIT_MS } from '../../battles/battle.service';
import { InMemoryBattleStore } from '../../battles/tests/in-memory-store';
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
const CAIO_TEAM = ['piromante', 'espadachim', 'druida', 'necromante', 'vampiro'];

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
    const service = new RankedService(store, battles, { now });

    battles.onFinished((battle) => service.settle(battle));

    return { clock, battleStore, battles, store, service };
}

function rejectsWith(promise: Promise<unknown>, code: RankedErrorCode): Promise<void> {
    return assert.rejects(promise, (error: unknown) => error instanceof RankedError && error.code === code, code);
}

/** Ana e Bruno entram na fila e são pareados. Devolve o id da partida. */
async function match(context: ReturnType<typeof setup>): Promise<string> {
    await context.service.enter(ANA, ANA_TEAM);
    // O Bruno chega um segundo depois: quem esperou mais (a Ana) fica com o time A.
    context.clock.now += 1_000;

    const queue = await context.service.enter(BRUNO, BRUNO_TEAM);

    assert.ok(queue.battleId);

    return queue.battleId;
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
            queue: { status: 'idle', battleId: null, waitedSeconds: 0, team: null },
        });
        await rejectsWith(service.profile('ninguem'), 'PLAYER_NOT_FOUND');
    });
});

describe('ranqueada: fila e pareamento', () => {
    it('sozinho na fila, o jogador fica procurando, e o tempo de espera conta', async () => {
        const { clock, service } = setup();
        const entered = await service.enter(ANA, ANA_TEAM);

        assert.deepEqual(entered, { status: 'searching', battleId: null, waitedSeconds: 0, team: ANA_TEAM });

        clock.now += 7_500;

        assert.equal((await service.queue(ANA)).waitedSeconds, 7);
    });

    it('quando o segundo entra, os dois são pareados numa partida ranqueada, cada um com o seu time', async () => {
        const context = setup();
        const battleId = await match(context);
        const ana = await context.service.queue(ANA);
        const asAna = await context.battles.get(ANA, battleId);
        const asBruno = await context.battles.get(BRUNO, battleId);

        assert.deepEqual(ana, { status: 'matched', battleId, waitedSeconds: 0, team: null }, 'a Ana descobre na consulta seguinte');
        assert.deepEqual([asAna.mode, asAna.ranked, asAna.status], ['pvp', true, 'in_progress']);
        // Quem esperou mais fica com o time A.
        assert.deepEqual([asAna.playerTeam, asBruno.playerTeam], ['A', 'B']);
        assert.deepEqual(asAna.state.units.filter((unit) => unit.team === 'A').map((unit) => unit.characterId), ANA_TEAM);
        assert.deepEqual(asAna.state.units.filter((unit) => unit.team === 'B').map((unit) => unit.characterId), BRUNO_TEAM);
        assert.equal(asAna.turnTimeLeftMs, RANKED_TURN_LIMIT_MS);
    });

    it('o time precisa ser válido, e o jogador precisa existir', async () => {
        const { service } = setup();

        await assert.rejects(service.enter(ANA, ['barbaro']), (error: unknown) => error instanceof BattleError && error.code === 'INVALID_TEAM');
        await assert.rejects(service.enter(ANA, [...ANA_TEAM.slice(0, 4), 'dragao']), (error: unknown) => error instanceof BattleError && error.code === 'UNKNOWN_CHARACTER');
        await rejectsWith(service.enter('ninguem', ANA_TEAM), 'PLAYER_NOT_FOUND');
    });

    it('ninguém é pareado consigo mesmo: entrar de novo só troca o time e recomeça a espera', async () => {
        const { clock, battleStore, service } = setup();

        await service.enter(ANA, ANA_TEAM);
        clock.now += 30_000;

        const again = await service.enter(ANA, BRUNO_TEAM);

        assert.deepEqual(again, { status: 'searching', battleId: null, waitedSeconds: 0, team: BRUNO_TEAM });
        assert.deepEqual(await battleStore.findManyByUser(ANA, 10), []);
    });

    it('com pontos muito diferentes, a fila espera: só pareia quando o tempo abre a busca', async () => {
        const { clock, store, service } = setup();

        store.setRating(BRUNO, 450);
        await service.enter(ANA, ANA_TEAM);

        assert.equal((await service.enter(BRUNO, BRUNO_TEAM)).status, 'searching', '450 pontos de diferença: longe demais para começar');

        // As telas dos dois seguem perguntando; aos 15s a busca abre para 400 pontos, e ainda não chega.
        for (let waited = 0; waited < 15_000; waited += 1_500) {
            clock.now += 1_500;
            assert.equal((await service.queue(ANA)).status, 'searching');
            assert.equal((await service.queue(BRUNO)).status, 'searching');
        }

        clock.now += 5_000;

        assert.equal((await service.queue(ANA)).status, 'matched', 'depois de 20s, aceita qualquer um');
        assert.equal((await service.queue(BRUNO)).status, 'matched');
    });

    it('entre vários na fila, escolhe quem tem os pontos mais próximos', async () => {
        const { clock, battles, store, service } = setup();

        store.setRating(ANA, 120);
        store.setRating(BRUNO, 60);
        store.setRating(CAIO, 400);
        // O Caio e o Bruno estão longe demais um do outro (340 pontos) para se parearem ao entrar.
        await service.enter(CAIO, CAIO_TEAM);
        clock.now += 1_000;
        await service.enter(BRUNO, BRUNO_TEAM);
        clock.now += 1_000;

        const ana = await service.enter(ANA, ANA_TEAM);

        assert.ok(ana.battleId);
        // A Ana pareou com o Bruno (60 pontos de diferença), não com o Caio (280), que chegou antes.
        assert.equal((await battles.get(BRUNO, ana.battleId)).ranked, true);
        assert.equal((await service.queue(CAIO)).status, 'searching');
    });

    it('quem fechou a tela não é pareado: o bilhete dele para de dar sinal de vida', async () => {
        const { clock, service } = setup();

        await service.enter(ANA, ANA_TEAM);
        // A tela da Ana some: ninguém pergunta pela fila por ela.
        clock.now += 12_000;

        assert.equal((await service.enter(BRUNO, BRUNO_TEAM)).status, 'searching');

        // Se ela voltar a perguntar, o bilhete volta a valer.
        assert.equal((await service.queue(ANA)).status, 'matched');
    });

    it('quem sai da fila não é pareado, e pode voltar depois', async () => {
        const { service } = setup();

        await service.enter(ANA, ANA_TEAM);

        assert.deepEqual(await service.leave(ANA), { status: 'idle', battleId: null, waitedSeconds: 0, team: null });
        assert.equal((await service.enter(BRUNO, BRUNO_TEAM)).status, 'searching');
        assert.equal((await service.enter(ANA, ANA_TEAM)).status, 'matched');
    });

    it('os dois perguntando ao mesmo tempo não criam duas partidas', async () => {
        const { clock, battleStore, store, service } = setup();

        // Longe demais para parear na entrada: os dois ficam na fila.
        store.setRating(BRUNO, 450);
        await service.enter(ANA, ANA_TEAM);
        await service.enter(BRUNO, BRUNO_TEAM);
        clock.now += 9_000;
        await Promise.all([service.queue(ANA), service.queue(BRUNO)]);
        clock.now += 9_000;
        await Promise.all([service.queue(ANA), service.queue(BRUNO)]);
        clock.now += 3_000;

        const [ana, bruno] = await Promise.all([service.queue(ANA), service.queue(BRUNO)]);
        const settled = [ana, bruno].every((queue) => queue.status === 'matched') ? [ana, bruno] : [await service.queue(ANA), await service.queue(BRUNO)];

        assert.deepEqual(settled.map((queue) => queue.status), ['matched', 'matched']);
        assert.equal(settled[0]?.battleId, settled[1]?.battleId);
        assert.equal((await battleStore.findManyByUser(ANA, 10)).length, 1);
    });

    it('com uma ranqueada em andamento, o jogador não entra em outra fila; quando ela acaba, fica livre', async () => {
        const context = setup();
        const battleId = await match(context);

        await assert.rejects(
            context.service.enter(ANA, ANA_TEAM),
            (error: unknown) => error instanceof RankedError && error.code === 'ALREADY_IN_RANKED_BATTLE' && error.data.battleId === battleId,
        );
        // Sair da fila não desfaz a partida.
        assert.equal((await context.service.leave(ANA)).status, 'matched');

        await context.battles.surrender(ANA, battleId);

        assert.equal((await context.service.queue(ANA)).status, 'idle');
        assert.equal((await context.service.enter(ANA, ANA_TEAM)).status, 'searching');
    });

    it('uma reserva de pareamento que ficou pela metade vence, e o bilhete volta para a fila', async () => {
        const { clock, store, service } = setup();
        const entered = await service.enter(ANA, ANA_TEAM);

        assert.equal(entered.status, 'searching');

        const ticket = await store.findTicket(ANA);

        assert.ok(ticket && (await store.claim(ticket.id)));
        // Reservado, mas quem reservou caiu antes de criar a partida.
        assert.equal((await store.findTicket(ANA))?.status, 'matching');

        clock.now += 11_000;

        assert.equal((await service.queue(ANA)).status, 'searching');
        assert.equal((await service.enter(BRUNO, BRUNO_TEAM)).status, 'matched');
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
