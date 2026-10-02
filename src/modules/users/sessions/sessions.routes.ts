import { Router } from 'express';
import { authMiddleware } from '../../auth/auth.middleware';
import { SessionController } from './sessions.controller';

export const sessionsRouter = Router();
const controller = new SessionController();

sessionsRouter.use(authMiddleware);

sessionsRouter.get('/me', controller.listMySessions);
sessionsRouter.delete('/me/:sessionId', controller.logoutSession);
