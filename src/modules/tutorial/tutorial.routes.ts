import { Router } from 'express';
import { authMiddleware } from '../auth/auth.middleware';
import type { TutorialService } from './tutorial.service';

/** GET /api/tutorial: se o jogador já fez o tutorial (enquanto não fez, as outras partidas ficam travadas). */
export function createTutorialRouter(service: TutorialService): Router {
    const tutorialRouter = Router();

    tutorialRouter.use(authMiddleware);

    tutorialRouter.get('/', async (req, res) => {
        try {
            if (!req.user) {
                return res.status(401).json({ message: req.t('auth.notAuthenticated') });
            }

            return res.json(await service.status(req.user.id));
        } catch (error) {
            console.error(error);

            return res.status(500).json({ message: req.t('tutorial.errorUnexpected') });
        }
    });

    return tutorialRouter;
}
