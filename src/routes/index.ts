import { Router } from 'express';
import { authRouter } from '../modules/auth/auth.routes';
import { usersRouter } from '../modules/users/users.routes';
import { passwordResetRouter } from '../modules/password-reset/password-reset.routes';
import { sessionsRouter } from '../modules/users/sessions/sessions.routes';
import { auditRouter } from '../modules/audit/audit.roles';
import { createBattlesRouter } from '../modules/battles/battle.routes';
import { BattleRepository } from '../modules/battles/battle.repository';
import { BattleService } from '../modules/battles/battle.service';

export const router = Router();

router.use('/auth', authRouter);
router.use('/users', usersRouter);
router.use('/password-reset', passwordResetRouter);
router.use('/sessions', sessionsRouter);
router.use('/audit', auditRouter);
router.use('/battles', createBattlesRouter(new BattleService(new BattleRepository())));