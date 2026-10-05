import { Router } from 'express';
import { authMiddleware } from '../auth/auth.middleware';
import { StatsController } from './stats.controller';
import type { StatsService } from './stats.service';

/** Recebe o serviço pronto, como as outras rotas do jogo, para os testes usarem as escolhas guardadas em memória. */
export function createStatsRouter(service: StatsService): Router {
    const statsRouter = Router();
    const controller = new StatsController(service);

    statsRouter.use(authMiddleware);

    statsRouter.get('/characters', controller.characters);

    return statsRouter;
}
