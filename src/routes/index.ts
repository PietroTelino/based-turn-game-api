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
import { createRankedRouter } from '../modules/ranked/ranked.routes';
import { RankedRepository } from '../modules/ranked/ranked.repository';
import { RankedService } from '../modules/ranked/ranked.service';
import { createStatsRouter } from '../modules/stats/stats.routes';
import { StatsRepository } from '../modules/stats/stats.repository';
import { StatsService } from '../modules/stats/stats.service';
import { createTutorialRouter } from '../modules/tutorial/tutorial.routes';
import { TutorialRepository } from '../modules/tutorial/tutorial.repository';
import { TutorialService } from '../modules/tutorial/tutorial.service';
import { prisma } from '../prisma';

export const router = Router();

// Usada pelo deploy para saber se a API subiu e se ela alcança o banco.
router.get('/health', async (_req, res) => {
    try {
        await prisma.$queryRaw`SELECT 1`;
        res.json({ status: 'ok' });
    } catch {
        res.status(503).json({ status: 'unavailable' });
    }
});

router.use('/auth', authRouter);
router.use('/users', usersRouter);
router.use('/password-reset', passwordResetRouter);
router.use('/sessions', sessionsRouter);
router.use('/audit', auditRouter);
// As salas do multiplayer e a fila ranqueada criam batalhas, por isso os três módulos usam o mesmo serviço.
const battleService = new BattleService(new BattleRepository());
const rankedService = new RankedService(new RankedRepository(), battleService);
const tutorialService = new TutorialService(new TutorialRepository());

// Quando uma batalha acaba, a ranqueada lança os pontos (só faz algo se a partida for ranqueada)
// e a batalha de treino terminada marca o tutorial como feito.
battleService.onFinished((battle) => rankedService.settle(battle));
battleService.onFinished((battle) => tutorialService.onBattleFinished(battle));

// O tutorial é obrigatório: sem ele, não dá para começar nenhuma partida além da de treino.
const tutorialGuard = tutorialService.guard();

router.use('/tutorial', createTutorialRouter(tutorialService));
router.use('/battles', createBattlesRouter(battleService, tutorialService.guard((req) => req.body?.training === true)));
router.use('/rooms', createRoomsRouter(new RoomService(new RoomRepository(), battleService), tutorialGuard));
router.use('/ranked', createRankedRouter(rankedService, tutorialGuard));
router.use('/stats', createStatsRouter(new StatsService(new StatsRepository())));
