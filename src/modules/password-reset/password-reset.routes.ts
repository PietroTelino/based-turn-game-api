import { Router } from 'express';
import { PasswordResetController } from './password-reset.controller';

export const passwordResetRouter = Router();
const controller = new PasswordResetController();

passwordResetRouter.post('/request', controller.request);
passwordResetRouter.post('/confirm', controller.confirm);