import { Router } from 'express';
import { UserController } from './user.controller';
import { authMiddleware, authorizeRoles } from '../auth/auth.middleware';

export const usersRouter = Router();
const controller = new UserController();

// Self register
usersRouter.post('/', controller.register);

usersRouter.use(authMiddleware);

// List and view
usersRouter.get('/', authorizeRoles('administrator', 'god'), controller.list);
usersRouter.get('/deleted-users', authorizeRoles('administrator', 'god'), controller.listDeleted);
usersRouter.get('/:id', authorizeRoles('administrator', 'god'), controller.getById);

// Admin create
usersRouter.post('/create', authorizeRoles('administrator', 'god'), controller.create);

// Me
usersRouter.patch('/me/preferences', authorizeRoles('user', 'administrator', 'god'), controller.updateMyPreferences);
usersRouter.patch('/me/password', authorizeRoles('user', 'administrator', 'god'), controller.changeMyPassword);

// Delete and restore
usersRouter.delete('/me/delete', authorizeRoles('user', 'administrator', 'god'), controller.selfDelete);
usersRouter.delete('/:id', authorizeRoles('administrator', 'god'), controller.delete);
usersRouter.patch('/:id/restore', authorizeRoles('administrator', 'god'), controller.restoreUser);
usersRouter.delete('/:id/hard', authorizeRoles('god'), controller.hardDelete);

// Admin update
usersRouter.post('/:id/reset-password', authorizeRoles('administrator', 'god'), controller.adminResetPassword);
usersRouter.put('/:id', authorizeRoles('administrator', 'god'), controller.update);

// Inactivate and reactivate
usersRouter.patch('/:id/inactivate', authorizeRoles('administrator', 'god'), controller.inactivateUser);
usersRouter.patch('/:id/reactivate', authorizeRoles('administrator', 'god'), controller.reactivateUser);