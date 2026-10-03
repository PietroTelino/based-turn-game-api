import './setup-env';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../../config/env';
import { i18next, middleware } from '../../../config/i18n';
import { CHARACTERS } from '../../../game';
import { createBattlesRouter } from '../battle.routes';
import { BattleService } from '../battle.service';
import { InMemoryBattleStore } from './in-memory-store';

/**
 * Sobe as rotas de verdade (Express, autenticação por JWT, traduções,
 * controller e serviço) numa porta livre. Só o banco é trocado por memória.
 */
describe('rotas /api/battles', () => {
    let server: Server;
    let baseUrl: string;

    const tokenFor = (userId: string) => jwt.sign({ sub: userId, role: 'user' }, env.jwtSecret);
    const player = tokenFor('11111111-1111-4111-8111-111111111111');
    const otherPlayer = tokenFor('22222222-2222-4222-8222-222222222222');

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

        const app = express();

        app.use(middleware.handle(i18next));
        app.use(express.json());
        app.use('/api/battles', createBattlesRouter(new BattleService(new InMemoryBattleStore(), () => 0, { teamSize: 1 })));

        server = app.listen(0);
        await once(server, 'listening');
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/battles`;
    });

    after(async () => {
        server.close();
        await once(server, 'close');
    });

    it('exige login', async () => {
        const { status } = await call('GET', '/characters');

        assert.equal(status, 401);
    });

    it('GET /characters devolve o catálogo', async () => {
        const { status, body } = await call('GET', '/characters', { token: player });

        assert.equal(status, 200);
        assert.equal(body.length, CHARACTERS.length);
        assert.deepEqual(Object.keys(body[0]).sort(), ['id', 'name', 'role', 'skills', 'stats']);
    });

    it('fluxo completo: criar, buscar, jogar e listar', async () => {
        const created = await call('POST', '/', {
            token: player,
            body: { team: ['barbaro'], enemyTeam: ['cavaleiro'] },
        });

        assert.equal(created.status, 201);
        assert.equal(created.body.battle.status, 'in_progress');
        assert.equal(created.body.battle.state.activeUnitId, 'A1');
        assert.equal('rngState' in created.body.battle.state, false);
        assert.ok(Array.isArray(created.body.events));

        const id: string = created.body.battle.id;
        const fetched = await call('GET', `/${id}`, { token: player });

        assert.equal(fetched.status, 200);
        assert.deepEqual(fetched.body, created.body.battle);

        const played = await call('POST', `/${id}/actions`, {
            token: player,
            body: { unitId: 'A1', skillId: 'barbaro.machadada', targetId: 'B1' },
        });

        assert.equal(played.status, 200);
        assert.ok(played.body.battle.state.turn > created.body.battle.state.turn);
        assert.ok(played.body.events.some((e: any) => e.type === 'damage' && e.targetId === 'B1'));

        const list = await call('GET', '/', { token: player });

        assert.equal(list.status, 200);
        assert.deepEqual(list.body.map((b: any) => b.id), [id]);
    });

    it('POST / com training: true cria a batalha de treino; qualquer outro valor, uma batalha comum', async () => {
        const training = await call('POST', '/', { token: player, body: { team: ['barbaro'], enemyTeam: ['cavaleiro'], training: true } });
        const notBoolean = await call('POST', '/', { token: player, body: { team: ['barbaro'], enemyTeam: ['cavaleiro'], training: 'sim' } });

        assert.equal(training.status, 201);
        assert.equal(training.body.battle.state.training, true);
        assert.equal(notBoolean.status, 201);
        assert.equal(notBoolean.body.battle.state.training, undefined);
    });

    it('POST /:id/surrender encerra a batalha como derrota', async () => {
        const created = await call('POST', '/', { token: player, body: { team: ['barbaro'], enemyTeam: ['cavaleiro'] } });
        const id: string = created.body.battle.id;

        const denied = await call('POST', `/${id}/surrender`, { token: otherPlayer });
        const surrendered = await call('POST', `/${id}/surrender`, { token: player });
        const again = await call('POST', `/${id}/surrender`, { token: player });
        const fetched = await call('GET', `/${id}`, { token: player });

        assert.equal(denied.status, 404);
        assert.equal(surrendered.status, 200);
        assert.equal(surrendered.body.battle.status, 'finished');
        assert.equal(surrendered.body.battle.winner, 'B');
        assert.equal(surrendered.body.battle.state.surrenderedBy, 'A');
        assert.deepEqual(surrendered.body.events.map((e: any) => e.type), ['surrendered', 'battle_ended']);
        assert.deepEqual([again.status, again.body.code], [409, 'BATTLE_OVER']);
        assert.equal(fetched.body.status, 'finished');
    });

    it('batalha de outro jogador e id inválido respondem 404', async () => {
        const created = await call('POST', '/', { token: player, body: { team: ['piromante'] } });
        const id: string = created.body.battle.id;

        assert.equal((await call('GET', `/${id}`, { token: otherPlayer })).status, 404);
        assert.equal((await call('GET', '/nao-e-uuid', { token: player })).status, 404);
        assert.equal(
            (await call('POST', `/${id}/actions`, { token: otherPlayer, body: { unitId: 'A1', skillId: 'x' } })).status,
            404,
        );
    });

    it('corpo inválido responde 400 com código e mensagem', async () => {
        const noTeam = await call('POST', '/', { token: player, body: {} });
        const unknown = await call('POST', '/', { token: player, body: { team: ['dragao'] } });
        // O serviço deste teste exige times de 1 (no jogo são 5): dois personagens é o tamanho errado.
        const wrongSize = await call('POST', '/', { token: player, body: { team: ['barbaro', 'cavaleiro'] } });
        const created = await call('POST', '/', { token: player, body: { team: ['barbaro'], enemyTeam: ['cavaleiro'] } });
        const noSkill = await call('POST', `/${created.body.battle.id}/actions`, { token: player, body: { unitId: 'A1' } });

        assert.deepEqual([noTeam.status, noTeam.body.code], [400, 'INVALID_TEAM']);
        assert.deepEqual([wrongSize.status, wrongSize.body.code], [400, 'INVALID_TEAM']);
        assert.match(wrongSize.body.message, /exatamente 1 /, 'a mensagem diz o tamanho obrigatório');
        assert.deepEqual(unknown.body, { code: 'UNKNOWN_CHARACTER', message: 'Personagem desconhecido: dragao' });
        assert.deepEqual([noSkill.status, noSkill.body.code], [400, 'INVALID_ACTION']);
    });

    it('regra do jogo quebrada responde 400 com a mensagem no idioma pedido', async () => {
        const created = await call('POST', '/', { token: player, body: { team: ['barbaro'], enemyTeam: ['cavaleiro'] } });
        const path = `/${created.body.battle.id}/actions`;
        const body = { unitId: 'A1', skillId: 'barbaro.machadada' };

        const portuguese = await call('POST', path, { token: player, body });
        const english = await call('POST', path, { token: player, body, lang: 'en' });
        const enemyUnit = await call('POST', path, {
            token: player,
            body: { unitId: 'B1', skillId: 'cavaleiro.corte', targetId: 'A1' },
        });

        assert.equal(portuguese.status, 400);
        assert.deepEqual(portuguese.body, { code: 'TARGET_REQUIRED', message: 'Escolha um alvo' });
        assert.deepEqual(english.body, { code: 'TARGET_REQUIRED', message: 'Choose a target' });
        assert.deepEqual([enemyUnit.status, enemyUnit.body.code], [403, 'NOT_YOUR_UNIT']);
    });
});
