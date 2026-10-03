import { Router } from 'express';
import { authMiddleware } from '../auth/auth.middleware';
import { RoomController } from './room.controller';
import type { RoomService } from './room.service';

/**
 * Recebe o serviço pronto, como as rotas de batalha: os testes montam estas
 * mesmas rotas com as salas guardadas em memória.
 */
export function createRoomsRouter(service: RoomService): Router {
    const roomsRouter = Router();
    const controller = new RoomController(service);

    roomsRouter.use(authMiddleware);

    roomsRouter.get('/', controller.list);
    roomsRouter.post('/', controller.create);
    roomsRouter.get('/:code', controller.getByCode);
    roomsRouter.post('/:code/join', controller.join);
    roomsRouter.post('/:code/ready', controller.ready);
    roomsRouter.post('/:code/unready', controller.unready);
    roomsRouter.post('/:code/leave', controller.leave);

    return roomsRouter;
}
