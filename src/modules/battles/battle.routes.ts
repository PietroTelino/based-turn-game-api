import { Router } from 'express';
import { authMiddleware } from '../auth/auth.middleware';
import { BattleController } from './battle.controller';
import type { BattleService } from './battle.service';

/**
 * Recebe o serviço pronto em vez de criá-lo aqui. Assim os testes montam as
 * mesmas rotas com um repositório em memória (ver src/routes/index.ts para a
 * montagem de verdade, com o Prisma).
 */
export function createBattlesRouter(service: BattleService): Router {
    const battlesRouter = Router();
    const controller = new BattleController(service);

    battlesRouter.use(authMiddleware);

    battlesRouter.get('/characters', controller.listCharacters);
    battlesRouter.get('/', controller.list);
    battlesRouter.post('/', controller.create);
    battlesRouter.get('/:id', controller.getById);
    battlesRouter.post('/:id/actions', controller.act);
    battlesRouter.post('/:id/surrender', controller.surrender);

    return battlesRouter;
}
