import { Router } from 'express';
import type { RequestHandler } from 'express';
import { authMiddleware } from '../auth/auth.middleware';
import { RoomController } from './room.controller';
import type { RoomService } from './room.service';

/**
 * Recebe o serviço pronto, como as rotas de batalha: os testes montam estas
 * mesmas rotas com as salas guardadas em memória.
 *
 * `guard`, quando vem, trava criar e entrar em salas (a trava do tutorial obrigatório).
 */
export function createRoomsRouter(service: RoomService, guard?: RequestHandler): Router {
    const guarded = guard ? [guard] : [];
    const roomsRouter = Router();
    const controller = new RoomController(service);

    roomsRouter.use(authMiddleware);

    roomsRouter.get('/', controller.list);
    roomsRouter.post('/', ...guarded, controller.create);
    roomsRouter.get('/:code', controller.getByCode);
    roomsRouter.post('/:code/join', ...guarded, controller.join);
    roomsRouter.post('/:code/ready', controller.ready);
    roomsRouter.post('/:code/unready', controller.unready);
    roomsRouter.post('/:code/leave', controller.leave);

    return roomsRouter;
}
