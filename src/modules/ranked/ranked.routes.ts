import { Router } from 'express';
import type { RequestHandler } from 'express';
import { authMiddleware } from '../auth/auth.middleware';
import { RankedController } from './ranked.controller';
import type { RankedService } from './ranked.service';

/**
 * Recebe o serviço pronto, como as rotas de batalha e de salas: os testes
 * montam estas mesmas rotas com a fila guardada em memória.
 *
 * `guard`, quando vem, trava a entrada na fila (a trava do tutorial obrigatório).
 */
export function createRankedRouter(service: RankedService, guard?: RequestHandler): Router {
    const rankedRouter = Router();
    const controller = new RankedController(service);

    rankedRouter.use(authMiddleware);

    rankedRouter.get('/', controller.profile);
    rankedRouter.get('/queue', controller.queue);
    rankedRouter.post('/queue', ...(guard ? [guard] : []), controller.enter);
    rankedRouter.delete('/queue', controller.leave);

    return rankedRouter;
}
