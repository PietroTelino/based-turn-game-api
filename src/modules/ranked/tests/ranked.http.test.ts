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
 * memória, e os times são de um personagem, para as batalhas serem curtas.
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
        const battles = new BattleService(battleStore, () => 0, { teamSize: 1 });
        const ranked = new RankedService(new InMemoryRankedStore(battleStore, [ANA, BRUNO, CAIO]), battles);

        battles.onFinished((battle) => ranked.settle(battle));

        const app = express();

        app.use(middleware.handle(i18next));
        app.use(express.json());
        app.use('/api/battles', createBattlesRouter(battles));
        app.use('/api/ranked', createRankedRouter(ranked));
        app.use('/api/stats', createStatsRouter(new StatsService(new InMemoryStatsStore(battleStore), 1)));

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
        assert.equal((await call('POST', '/ranked/queue', { body: { team: ['barbaro'] } })).status, 401);
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
            queue: { status: 'idle', battleId: null, waitedSeconds: 0, team: null },
        });
    });

    it('POST /ranked/queue pede o time, e o time precisa ser válido', async () => {
        const noTeam = await call('POST', '/ranked/queue', { token: caio, body: {} });
        const unknown = await call('POST', '/ranked/queue', { token: caio, body: { team: ['dragao'] } });

        assert.deepEqual([noTeam.status, noTeam.body.code], [400, 'INVALID_RANKED_REQUEST']);
        assert.deepEqual([unknown.status, unknown.body.code], [400, 'UNKNOWN_CHARACTER']);
    });

    it('DELETE /ranked/queue tira o jogador da fila', async () => {
        const entered = await call('POST', '/ranked/queue', { token: caio, body: { team: ['piromante'] } });
        const left = await call('DELETE', '/ranked/queue', { token: caio });

        assert.deepEqual([entered.status, entered.body.status, entered.body.team], [200, 'searching', ['piromante']]);
        assert.deepEqual([left.status, left.body.status], [200, 'idle']);
        assert.equal((await call('GET', '/ranked/queue', { token: caio })).body.status, 'idle');
    });

    it('fluxo completo: fila, pareamento, partida, pontos, replay e estatísticas', async () => {
        // A Ana entra e espera; o Bruno entra e os dois são pareados.
        const waiting = await call('POST', '/ranked/queue', { token: ana, body: { team: ['barbaro'] } });
        const matched = await call('POST', '/ranked/queue', { token: bruno, body: { team: ['cavaleiro'] } });
        const seenByAna = await call('GET', '/ranked/queue', { token: ana });
        const battleId: string = matched.body.battleId;

        assert.equal(waiting.body.status, 'searching');
        assert.deepEqual([matched.status, matched.body.status], [200, 'matched']);
        assert.deepEqual([seenByAna.body.status, seenByAna.body.battleId], ['matched', battleId]);

        // A partida é ranqueada, tem prazo, e só os dois a enxergam.
        const asAna = await call('GET', `/battles/${battleId}`, { token: ana });

        assert.deepEqual([asAna.body.mode, asAna.body.ranked, asAna.body.playerTeam, asAna.body.ratingChange], ['pvp', true, 'A', null]);
        assert.ok(asAna.body.turnTimeLeftMs > 0);
        assert.equal((await call('GET', `/battles/${battleId}`, { token: caio })).status, 404);

        // Com a partida em andamento: não dá para entrar em outra fila, ver o replay nem pedir a vitória antes do prazo.
        const again = await call('POST', '/ranked/queue', { token: ana, body: { team: ['barbaro'] } });
        const againEnglish = await call('POST', '/ranked/queue', { token: ana, body: { team: ['barbaro'] }, lang: 'en' });
        const early = await call('GET', `/battles/${battleId}/replay`, { token: ana });
        // O Bárbaro da Ana é mais veloz: a vez é dela, e quem espera é o Bruno.
        const tooEarly = await call('POST', `/battles/${battleId}/timeout`, { token: bruno });
        const ownTurn = await call('POST', `/battles/${battleId}/timeout`, { token: ana });

        assert.deepEqual([again.status, again.body.code, again.body.battleId], [409, 'ALREADY_IN_RANKED_BATTLE', battleId]);
        assert.match(again.body.message, /partida ranqueada em andamento/);
        assert.match(againEnglish.body.message, /ranked match in progress/);
        assert.deepEqual([early.status, early.body.code], [409, 'REPLAY_UNAVAILABLE']);
        assert.deepEqual([tooEarly.status, tooEarly.body.code], [409, 'TIMEOUT_TOO_EARLY']);
        assert.deepEqual([ownTurn.status, ownTurn.body.code], [409, 'TIMEOUT_NOT_ALLOWED']);

        // A Ana joga e o Bruno desiste: a Ana vence e os pontos são lançados.
        await call('POST', `/battles/${battleId}/actions`, { token: ana, body: { unitId: 'A1', skillId: 'barbaro.machadada', targetId: 'B1' } });

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
        assert.deepEqual(stats.body.mine, { teams: 1, characters: [{ characterId: 'barbaro', picks: 1, share: 1 }] });
        assert.deepEqual(stats.body.global.characters.map((item: any) => item.characterId), ['barbaro', 'cavaleiro']);
        assert.ok(![ANA, BRUNO, CAIO].some((id) => JSON.stringify(stats.body).includes(id)));
    });
});
