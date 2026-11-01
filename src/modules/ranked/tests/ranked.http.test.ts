import '../../battles/tests/setup-env';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../../config/env';
import { i18next, middleware } from '../../../config/i18n';
import { createBattlesRouter } from '../../battles/battle.routes';
import { BattleService } from '../../battles/battle.service';
import { InMemoryBattleStore } from '../../battles/tests/in-memory-store';
import { createStatsRouter } from '../../stats/stats.routes';
import { StatsService } from '../../stats/stats.service';
import { InMemoryStatsStore } from '../../stats/tests/in-memory-stats-store';
import { DRAFT_ORDER } from '../ranked.draft';
import { createRankedRouter } from '../ranked.routes';
import { RankedService } from '../ranked.service';
import { InMemoryRankedStore } from './in-memory-ranked-store';

const ANA = '11111111-1111-4111-8111-111111111111';
const BRUNO = '22222222-2222-4222-8222-222222222222';
const CAIO = '33333333-3333-4333-8333-333333333333';

/**
 * Sobe as rotas de verdade da ranqueada, das batalhas e das estatísticas
 * (Express, autenticação por JWT, traduções, controllers e serviços) numa
 * porta livre, ligadas como em src/routes/index.ts. Só o banco é trocado por
 * memória.
 */
describe('rotas /api/ranked, replay e estatísticas', () => {
    let server: Server;
    let baseUrl: string;

    const tokenFor = (userId: string) => jwt.sign({ sub: userId, role: 'user' }, env.jwtSecret);
    const ana = tokenFor(ANA);
    const bruno = tokenFor(BRUNO);
    const caio = tokenFor(CAIO);

    async function call(method: string, path: string, options: { token?: string; body?: unknown; lang?: string } = {}) {
        const response = await fetch(`${baseUrl}${path}`, {
            method,
            headers: {
                'content-type': 'application/json',
                'accept-language': options.lang ?? 'pt-BR',
                ...(options.token && { authorization: `Bearer ${options.token}` }),
            },
            ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
        });

        return { status: response.status, body: (await response.json()) as any };
    }

    before(async () => {
        if (!i18next.isInitialized) {
            await new Promise<void>((resolve) => i18next.on('initialized', () => resolve()));
        }

        const battleStore = new InMemoryBattleStore();
        const battles = new BattleService(battleStore, () => 0);
        const ranked = new RankedService(new InMemoryRankedStore(battleStore, [ANA, BRUNO, CAIO]), battles);

        battles.onFinished((battle) => ranked.settle(battle));

        const app = express();

        app.use(middleware.handle(i18next));
        app.use(express.json());
        app.use('/api/battles', createBattlesRouter(battles));
        app.use('/api/ranked', createRankedRouter(ranked));
        app.use('/api/stats', createStatsRouter(new StatsService(new InMemoryStatsStore(battleStore), 5)));

        server = app.listen(0);
        await once(server, 'listening');
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    });

    after(async () => {
        server.close();
        await once(server, 'close');
    });

    it('exigem login', async () => {
        assert.equal((await call('GET', '/ranked')).status, 401);
        assert.equal((await call('POST', '/ranked/queue')).status, 401);
        assert.equal((await call('GET', '/ranked/draft')).status, 401);
        assert.equal((await call('GET', '/stats/characters')).status, 401);
    });

    it('GET /ranked: quem nunca jogou é Bronze, sem pontos, fora da fila', async () => {
        const { status, body } = await call('GET', '/ranked', { token: caio });

        assert.equal(status, 200);
        assert.deepEqual(body, {
            points: 0,
            rank: 'bronze',
            rankFloor: 0,
            next: { rank: 'silver', at: 100 },
            wins: 0,
            losses: 0,
            queue: { status: 'idle', draftId: null, battleId: null, waitedSeconds: 0 },
        });
    });

    it('fora de uma seleção, /ranked/draft responde 404', async () => {
        const seen = await call('GET', '/ranked/draft', { token: caio });

        assert.deepEqual([seen.status, seen.body.code], [404, 'NOT_IN_DRAFT']);
    });

    it('DELETE /ranked/queue tira o jogador da fila', async () => {
        const entered = await call('POST', '/ranked/queue', { token: caio });
        const left = await call('DELETE', '/ranked/queue', { token: caio });

        assert.deepEqual([entered.status, entered.body.status], [200, 'searching']);
        assert.deepEqual([left.status, left.body.status], [200, 'idle']);
        assert.equal((await call('GET', '/ranked/queue', { token: caio })).body.status, 'idle');
    });

    it('fluxo completo: fila, seleção de personagens, partida, pontos, replay e estatísticas', async () => {
        // A Ana entra e espera; o Bruno entra e os dois vão para a seleção.
        const waiting = await call('POST', '/ranked/queue', { token: ana });
        const paired = await call('POST', '/ranked/queue', { token: bruno });
        const seenByAna = await call('GET', '/ranked/queue', { token: ana });

        assert.equal(waiting.body.status, 'searching');
        assert.deepEqual([paired.status, paired.body.status], [200, 'drafting']);
        assert.deepEqual([seenByAna.body.status, seenByAna.body.draftId], ['drafting', paired.body.draftId]);

        // Na seleção, só quem está na vez joga, e o personagem precisa valer.
        const wrongTurn = await call('POST', '/ranked/draft', { token: bruno, body: { characterId: 'barbaro' } });
        const noCharacter = await call('POST', '/ranked/draft', { token: ana, body: {} });

        assert.deepEqual([wrongTurn.status, wrongTurn.body.code], [409, 'NOT_YOUR_DRAFT_TURN']);
        assert.deepEqual([noCharacter.status, noCharacter.body.code], [400, 'INVALID_RANKED_REQUEST']);

        const teams = { A: ['barbaro', 'criomante', 'guardiao', 'sacerdote', 'arqueiro'], B: ['cavaleiro', 'ladino', 'vampiro', 'driade', 'banshee'] };
        const bans = { A: 'necromante', B: 'druida' };
        const used = { A: 0, B: 0 };
        let last: any = null;

        for (const step of DRAFT_ORDER) {
            const characterId = step.kind === 'ban' ? bans[step.team] : teams[step.team][used[step.team]++];
            const response = await call('POST', '/ranked/draft', { token: step.team === 'A' ? ana : bruno, body: { characterId } });

            assert.equal(response.status, 200, `${step.team} ${step.kind} ${characterId}`);
            last = response.body;
        }

        const banned = await call('GET', '/ranked/draft', { token: bruno });
        const battleId: string = last.battleId;

        assert.deepEqual([last.status, last.banned, last.teams], ['done', ['necromante', 'druida'], teams]);
        assert.equal(banned.body.battleId, battleId);
        assert.deepEqual((await call('GET', '/ranked/queue', { token: ana })).body, { status: 'matched', draftId: null, battleId, waitedSeconds: 0 });

        // A partida é ranqueada, tem prazo, e só os dois a enxergam.
        const asAna = await call('GET', `/battles/${battleId}`, { token: ana });

        assert.deepEqual([asAna.body.mode, asAna.body.ranked, asAna.body.playerTeam, asAna.body.ratingChange], ['pvp', true, 'A', null]);
        assert.ok(asAna.body.turnTimeLeftMs > 0);
        assert.equal((await call('GET', `/battles/${battleId}`, { token: caio })).status, 404);

        // Com a partida em andamento: não dá para entrar em outra fila, ver o replay nem pedir a vitória antes do prazo.
        const again = await call('POST', '/ranked/queue', { token: ana });
        const againEnglish = await call('POST', '/ranked/queue', { token: ana, lang: 'en' });
        const early = await call('GET', `/battles/${battleId}/replay`, { token: ana });
        const active = asAna.body.state.units.find((unit: any) => unit.id === asAna.body.state.activeUnitId);
        const [onTurn, waitingPlayer] = active.team === 'A' ? [ana, bruno] : [bruno, ana];
        const tooEarly = await call('POST', `/battles/${battleId}/timeout`, { token: waitingPlayer });
        const ownTurn = await call('POST', `/battles/${battleId}/timeout`, { token: onTurn });

        assert.deepEqual([again.status, again.body.code, again.body.battleId], [409, 'ALREADY_IN_RANKED_BATTLE', battleId]);
        assert.match(again.body.message, /partida ranqueada em andamento/);
        assert.match(againEnglish.body.message, /ranked match in progress/);
        assert.deepEqual([early.status, early.body.code], [409, 'REPLAY_UNAVAILABLE']);
        assert.deepEqual([tooEarly.status, tooEarly.body.code], [409, 'TIMEOUT_TOO_EARLY']);
        assert.deepEqual([ownTurn.status, ownTurn.body.code], [409, 'TIMEOUT_NOT_ALLOWED']);

        // O Bruno desiste: a Ana vence e os pontos são lançados.
        const quit = await call('POST', `/battles/${battleId}/surrender`, { token: bruno });

        assert.deepEqual([quit.body.battle.status, quit.body.battle.winner, quit.body.battle.ratingChange], ['finished', 'A', 0]);

        const anaProfile = await call('GET', '/ranked', { token: ana });
        const brunoProfile = await call('GET', '/ranked', { token: bruno });

        assert.deepEqual([anaProfile.body.points, anaProfile.body.wins, anaProfile.body.queue.status], [16, 1, 'idle']);
        assert.deepEqual([brunoProfile.body.points, brunoProfile.body.losses], [0, 1]);

        // O histórico de cada um mostra a partida do seu lado, com os pontos e o replay.
        const history = await call('GET', '/battles', { token: ana });

        assert.deepEqual(
            history.body.map((item: any) => [item.id, item.mode, item.ranked, item.ratingChange, item.hasReplay]),
            [[battleId, 'pvp', true, 16, true]],
        );

        // O replay: o começo, todos os eventos e o fim. O terceiro jogador não vê.
        const replay = await call('GET', `/battles/${battleId}/replay`, { token: bruno });

        assert.equal(replay.status, 200);
        assert.deepEqual([replay.body.battle.status, replay.body.battle.playerTeam], ['finished', 'B']);
        assert.deepEqual([replay.body.initial.turn, replay.body.initial.winner], [1, null]);
        assert.ok(!('rngState' in replay.body.initial));
        assert.deepEqual([replay.body.events[0].type, replay.body.events[replay.body.events.length - 1].type], ['turn_started', 'battle_ended']);
        assert.equal((await call('GET', `/battles/${battleId}/replay`, { token: caio })).status, 404);

        // As estatísticas: cada um vê os seus e a soma de todos, sem id de ninguém.
        const stats = await call('GET', '/stats/characters', { token: ana });

        assert.equal(stats.status, 200);
        assert.equal(stats.body.mine.teams, 1);
        assert.deepEqual(stats.body.mine.characters.map((item: any) => item.characterId).sort(), [...teams.A].sort());
        assert.equal(stats.body.global.teams, 2);
        assert.ok(![ANA, BRUNO, CAIO].some((id) => JSON.stringify(stats.body).includes(id)));
    });
});
