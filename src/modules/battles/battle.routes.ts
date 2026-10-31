import { Router } from 'express';
import type { RequestHandler } from 'express';
import { authMiddleware } from '../auth/auth.middleware';
import { BattleController } from './battle.controller';
import type { BattleService } from './battle.service';

/**
 * Recebe o serviço pronto em vez de criá-lo aqui. Assim os testes montam as
 * mesmas rotas com um repositório em memória (ver src/routes/index.ts para a
 * montagem de verdade, com o Prisma).
 *
 * `guard`, quando vem, trava a criação de batalhas (a trava do tutorial
 * obrigatório: ela mesma deixa passar a batalha de treino).
 */
export function createBattlesRouter(service: BattleService, guard?: RequestHandler): Router {
    const battlesRouter = Router();
    const controller = new BattleController(service);

    battlesRouter.use(authMiddleware);

    battlesRouter.get('/characters', controller.listCharacters);
    battlesRouter.get('/', controller.list);
    // Antes de '/:id', senão "campaign" seria lido como o id de uma batalha.
    battlesRouter.get('/campaign', controller.campaign);
    battlesRouter.post('/', ...(guard ? [guard] : []), controller.create);
    battlesRouter.get('/:id', controller.getById);
    battlesRouter.get('/:id/events', controller.events);
    battlesRouter.get('/:id/replay', controller.replay);
    battlesRouter.post('/:id/actions', controller.act);
    battlesRouter.post('/:id/surrender', controller.surrender);
    battlesRouter.post('/:id/timeout', controller.timeout);

    return battlesRouter;
}
