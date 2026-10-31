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
import { createTutorialRouter } from '../tutorial.routes';
import { TutorialService } from '../tutorial.service';
import { InMemoryTutorialStore } from './in-memory-tutorial-store';

const PLAYER = '11111111-1111-4111-8111-111111111111';

function setup() {
    const battleStore = new InMemoryBattleStore();
    const battles = new BattleService(battleStore, () => 0, { teamSize: 1 });
    const tutorial = new TutorialService(new InMemoryTutorialStore(), () => new Date('2026-10-31T12:00:00Z'));

    battles.onFinished((record) => tutorial.onBattleFinished(record));

    return { battleStore, battles, tutorial };
}

describe('TutorialService', () => {
    it('ninguém começa com o tutorial feito', async () => {
        const { tutorial } = setup();

        assert.deepEqual(await tutorial.status(PLAYER), { completed: false, completedAt: null });
    });

    it('terminar a batalha de treino, com vitória ou derrota, marca o tutorial como feito', async () => {
        for (const winner of ['A', 'B'] as const) {
            const { battleStore, battles, tutorial } = setup();
            const { battle } = await battles.create(PLAYER, { team: ['barbaro'], enemyTeam: ['cavaleiro'], training: true });
            const record = (await battleStore.findById(battle.id))!;

            await tutorial.onBattleFinished({ ...record, status: 'finished', winner, state: { ...record.state, winner } });

            assert.equal(await tutorial.isCompleted(PLAYER), true, `vencedor ${winner}`);
            assert.deepEqual((await tutorial.status(PLAYER)).completedAt, new Date('2026-10-31T12:00:00Z'));
        }
    });

    it('desistir do treino não conta, e terminar uma batalha comum também não', async () => {
        const { battles, tutorial } = setup();
        const training = await battles.create(PLAYER, { team: ['barbaro'], enemyTeam: ['cavaleiro'], training: true });

        // A desistência passa pelo BattleService de verdade, que avisa o ouvinte.
        await battles.surrender(PLAYER, training.battle.id);
        assert.equal(await tutorial.isCompleted(PLAYER), false);

        const normal = await battles.create(PLAYER, { team: ['barbaro'], enemyTeam: ['cavaleiro'] });

        await battles.surrender(PLAYER, normal.battle.id);
        assert.equal(await tutorial.isCompleted(PLAYER), false);
    });
});

/** As rotas de verdade (Express, JWT, traduções) com a trava do tutorial, como em src/routes/index.ts. */
describe('trava do tutorial nas rotas', () => {
    let server: Server;
    let baseUrl: string;
    let context: ReturnType<typeof setup>;

    const token = jwt.sign({ sub: PLAYER, role: 'user' }, env.jwtSecret);

    async function call(method: string, path: string, body?: unknown) {
        const response = await fetch(`${baseUrl}${path}`, {
            method,
            headers: { 'content-type': 'application/json', 'accept-language': 'pt-BR', authorization: `Bearer ${token}` },
            ...(body !== undefined && { body: JSON.stringify(body) }),
        });

        return { status: response.status, body: (await response.json()) as any };
    }

    before(async () => {
        if (!i18next.isInitialized) {
            await new Promise<void>((resolve) => i18next.on('initialized', () => resolve()));
        }

        context = setup();

        const app = express();

        app.use(middleware.handle(i18next));
        app.use(express.json());
        app.use('/api/tutorial', createTutorialRouter(context.tutorial));
        app.use('/api/battles', createBattlesRouter(context.battles, context.tutorial.guard((req) => req.body?.training === true)));

        server = app.listen(0);
        await once(server, 'listening');
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    });

    after(async () => {
        server.close();
        await once(server, 'close');
    });

    it('sem o tutorial, só a batalha de treino pode ser criada; depois dele, todas', async () => {
        const before = await call('GET', '/tutorial');
        const blocked = await call('POST', '/battles', { team: ['barbaro'] });
        const training = await call('POST', '/battles', { team: ['barbaro'], enemyTeam: ['cavaleiro'], training: true });

        assert.deepEqual(before.body, { completed: false, completedAt: null });
        assert.equal(blocked.status, 403);
        assert.equal(blocked.body.code, 'TUTORIAL_REQUIRED');
        assert.match(blocked.body.message, /tutorial/);
        assert.equal(training.status, 201);

        await context.tutorial.onBattleFinished({
            ...(await context.battleStore.findById(training.body.battle.id))!,
            status: 'finished',
            winner: 'A',
        });

        const now = await call('GET', '/tutorial');
        const allowed = await call('POST', '/battles', { team: ['barbaro'] });

        assert.equal(now.body.completed, true);
        assert.equal(allowed.status, 201);
    });

    it('as consultas continuam liberadas: catálogo e lista de batalhas', async () => {
        assert.equal((await call('GET', '/battles/characters')).status, 200);
        assert.equal((await call('GET', '/battles')).status, 200);
    });
});
