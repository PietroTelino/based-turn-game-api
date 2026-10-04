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
import { createRoomsRouter } from '../room.routes';
import { RoomService } from '../room.service';
import { InMemoryRoomStore } from './in-memory-room-store';

const ANA_ID = '11111111-1111-4111-8111-111111111111';
const BRUNO_ID = '22222222-2222-4222-8222-222222222222';
const CAIO_ID = '33333333-3333-4333-8333-333333333333';

const ANA_TEAM = ['barbaro', 'criomante', 'guardiao', 'sacerdote', 'arqueiro'];
const BRUNO_TEAM = ['cavaleiro', 'ladino', 'vampiro', 'driade', 'banshee'];

/**
 * Sobe as rotas de salas e de batalhas de verdade (Express, autenticação por
 * JWT, traduções, controllers e serviços) numa porta livre, ligadas uma à
 * outra como em src/routes/index.ts. Só o banco é trocado por memória.
 */
describe('rotas /api/rooms', () => {
    let server: Server;
    let baseUrl: string;

    const tokenFor = (userId: string) => jwt.sign({ sub: userId, role: 'user' }, env.jwtSecret);
    const ana = tokenFor(ANA_ID);
    const bruno = tokenFor(BRUNO_ID);
    const caio = tokenFor(CAIO_ID);

    async function call(method: string, path: string, options: { token?: string; body?: unknown } = {}) {
        const response = await fetch(`${baseUrl}${path}`, {
            method,
            headers: {
                'content-type': 'application/json',
                'accept-language': 'pt-BR',
                ...(options.token && { authorization: `Bearer ${options.token}` }),
            },
            ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
        });
        const text = await response.text();

        return { status: response.status, body: (text ? JSON.parse(text) : null) as any };
    }

    before(async () => {
        if (!i18next.isInitialized) {
            await new Promise<void>((resolve) => i18next.on('initialized', () => resolve()));
        }

        const battles = new BattleService(new InMemoryBattleStore(), () => 0);
        const rooms = new RoomService(new InMemoryRoomStore({ [ANA_ID]: 'Ana', [BRUNO_ID]: 'Bruno', [CAIO_ID]: 'Caio' }), battles);
        const app = express();

        app.use(middleware.handle(i18next));
        app.use(express.json());
        app.use('/api/battles', createBattlesRouter(battles));
        app.use('/api/rooms', createRoomsRouter(rooms));

        server = app.listen(0);
        await once(server, 'listening');
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    });

    after(async () => {
        server.close();
        await once(server, 'close');
    });

    it('exige login', async () => {
        assert.equal((await call('GET', '/rooms')).status, 401);
        assert.equal((await call('POST', '/rooms')).status, 401);
    });

    it('fluxo completo: criar, entrar, ficar pronto dos dois lados e jogar a batalha', async () => {
        const created = await call('POST', '/rooms', { token: ana });

        assert.equal(created.status, 201);
        assert.match(created.body.code, /^[A-Z2-9]{6}$/);
        assert.deepEqual([created.body.status, created.body.role, created.body.opponent], ['waiting', 'host', null]);

        const code: string = created.body.code;
        const listed = await call('GET', '/rooms', { token: bruno });

        assert.deepEqual(listed.body.map((r: any) => [r.code, r.hostName]), [[code, 'Ana']]);
        assert.deepEqual((await call('GET', '/rooms', { token: ana })).body, [], 'a própria sala não entra na lista');

        const joined = await call('POST', `/rooms/${code.toLowerCase()}/join`, { token: bruno });

        assert.equal(joined.status, 200);
        assert.deepEqual([joined.body.role, joined.body.status, joined.body.opponent.name], ['guest', 'selecting', 'Ana']);

        const anaReady = await call('POST', `/rooms/${code}/ready`, { token: ana, body: { team: ANA_TEAM } });
        const seenByBruno = await call('GET', `/rooms/${code}`, { token: bruno });

        assert.deepEqual(anaReady.body.you, { ready: true, team: ANA_TEAM });
        assert.deepEqual(seenByBruno.body.opponent, { name: 'Ana', ready: true });
        assert.ok(!ANA_TEAM.some((id) => JSON.stringify(seenByBruno.body).includes(id)), 'o time da Ana não vaza para o Bruno');

        const brunoReady = await call('POST', `/rooms/${code}/ready`, { token: bruno, body: { team: BRUNO_TEAM } });
        const battleId: string = brunoReady.body.battleId;

        assert.equal(brunoReady.body.status, 'started');
        assert.equal((await call('GET', `/rooms/${code}`, { token: ana })).body.battleId, battleId);

        // A batalha é a mesma para os dois, cada um do seu lado.
        const asAna = await call('GET', `/battles/${battleId}`, { token: ana });
        const asBruno = await call('GET', `/battles/${battleId}/events?after=0`, { token: bruno });

        assert.deepEqual([asAna.body.mode, asAna.body.playerTeam, asBruno.body.battle.playerTeam], ['pvp', 'A', 'B']);
        assert.deepEqual(asBruno.body.events.map((e: any) => e.type), ['turn_started', 'unit_activated']);
        assert.equal((await call('GET', `/battles/${battleId}`, { token: caio })).status, 404);

        // Joga quem está na vez; o outro vê a jogada pedindo o que veio depois do que já viu.
        const active: string = asAna.body.state.activeUnitId;
        const mover = active.startsWith('A') ? { token: ana, view: asAna.body } : { token: bruno, view: asBruno.body.battle };
        const watcher = active.startsWith('A') ? bruno : ana;
        const action = mover.view.availableActions[0];
        const target = mover.view.state.units.find((u: any) => u.team !== mover.view.playerTeam);
        const played = await call('POST', `/battles/${battleId}/actions`, {
            token: mover.token,
            body: { unitId: active, skillId: action.skill.id, targetId: target.id },
        });
        const watched = await call('GET', `/battles/${battleId}/events?after=2`, { token: watcher });

        assert.equal(played.status, 200);
        assert.deepEqual(watched.body.events, played.body.events);
        assert.equal(watched.body.battle.cursor, played.body.battle.cursor);

        // As duas listas de batalhas mostram a partida, cada uma com o lado certo.
        assert.deepEqual((await call('GET', '/battles', { token: ana })).body.map((b: any) => [b.id, b.mode, b.playerTeam]), [[battleId, 'pvp', 'A']]);
        assert.deepEqual((await call('GET', '/battles', { token: bruno })).body.map((b: any) => [b.id, b.mode, b.playerTeam]), [[battleId, 'pvp', 'B']]);
    });

    it('erros respondem com código e mensagem traduzida', async () => {
        const { body: room } = await call('POST', '/rooms', { token: ana });
        const missing = await call('POST', '/rooms/XXXXXX/join', { token: bruno });
        const outsider = await call('GET', `/rooms/${room.code}`, { token: bruno });

        await call('POST', `/rooms/${room.code}/join`, { token: bruno });

        const full = await call('POST', `/rooms/${room.code}/join`, { token: caio });
        const noTeam = await call('POST', `/rooms/${room.code}/ready`, { token: ana, body: {} });
        const shortTeam = await call('POST', `/rooms/${room.code}/ready`, { token: ana, body: { team: ['barbaro'] } });

        assert.deepEqual([missing.status, missing.body], [404, { code: 'ROOM_NOT_FOUND', message: 'Sala não encontrada' }]);
        assert.deepEqual([outsider.status, outsider.body.code], [404, 'ROOM_NOT_FOUND']);
        assert.deepEqual([full.status, full.body], [409, { code: 'ROOM_FULL', message: 'Essa sala já está cheia' }]);
        assert.deepEqual([noTeam.status, noTeam.body.code], [400, 'INVALID_ROOM_REQUEST']);
        assert.deepEqual([shortTeam.status, shortTeam.body.code], [400, 'INVALID_TEAM']);
        assert.match(shortTeam.body.message, /exatamente 5 /);
    });

    it('sair: o convidado libera a vaga, o anfitrião fecha a sala', async () => {
        const { body: room } = await call('POST', '/rooms', { token: ana });

        await call('POST', `/rooms/${room.code}/join`, { token: bruno });

        const left = await call('POST', `/rooms/${room.code}/leave`, { token: bruno });

        assert.equal(left.status, 204);
        assert.equal((await call('GET', `/rooms/${room.code}`, { token: ana })).body.status, 'waiting');

        await call('POST', `/rooms/${room.code}/join`, { token: caio });
        await call('POST', `/rooms/${room.code}/leave`, { token: ana });

        const closed = await call('GET', `/rooms/${room.code}`, { token: caio });
        const late = await call('POST', `/rooms/${room.code}/ready`, { token: caio, body: { team: BRUNO_TEAM } });

        assert.equal(closed.body.status, 'closed');
        assert.deepEqual([late.status, late.body], [409, { code: 'ROOM_CLOSED', message: 'Essa sala não está mais aberta' }]);
    });
});
