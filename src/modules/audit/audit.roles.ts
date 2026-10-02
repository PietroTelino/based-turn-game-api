import { Router } from 'express';
import { AuditController } from './audit.controller';
import { authMiddleware, authorizeRoles } from '../auth/auth.middleware';

export const auditRouter = Router();
const controller = new AuditController();

auditRouter.get('/me', authMiddleware, controller.getMyAudits);
auditRouter.get('/', authMiddleware, authorizeRoles('administrator', 'god'), controller.list);
auditRouter.get('/:id', authMiddleware, authorizeRoles('administrator', 'god'), controller.getById);