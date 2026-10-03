import { Router } from 'express';
import { authRouter } from '../modules/auth/auth.routes';
import { usersRouter } from '../modules/users/users.routes';
import { passwordResetRouter } from '../modules/password-reset/password-reset.routes';
import { sessionsRouter } from '../modules/users/sessions/sessions.routes';
import { auditRouter } from '../modules/audit/audit.roles';
import { createBattlesRouter } from '../modules/battles/battle.routes';
import { BattleRepository } from '../modules/battles/battle.repository';
import { BattleService } from '../modules/battles/battle.service';
import { createRoomsRouter } from '../modules/rooms/room.routes';
import { RoomRepository } from '../modules/rooms/room.repository';
import { RoomService } from '../modules/rooms/room.service';

export const router = Router();

router.use('/auth', authRouter);
router.use('/users', usersRouter);
router.use('/password-reset', passwordResetRouter);
router.use('/sessions', sessionsRouter);
router.use('/audit', auditRouter);
// As salas do multiplayer criam batalhas, por isso os dois módulos usam o mesmo serviço.
const battleService = new BattleService(new BattleRepository());

router.use('/battles', createBattlesRouter(battleService));
router.use('/rooms', createRoomsRouter(new RoomService(new RoomRepository(), battleService)));