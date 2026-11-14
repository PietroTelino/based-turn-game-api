import { Router } from 'express';
import type { Request, Response } from 'express';
import { authMiddleware, authorizeRoles } from '../auth/auth.middleware';
import { ProgressionError } from './progression.service';
import type { ProgressionService } from './progression.service';

/**
 * GET  /api/progression                     ouro, diamantes, personagens, conquistas e a loja
 * POST /api/progression/shop                { characterId, currency: "gold" | "diamonds" }: compra um personagem
 * GET  /api/progression/battles/:id         o que o jogador ganhou naquela batalha
 * POST /api/progression/users/:id/grant     { gold, diamonds } (administrador): dá ou tira recursos
 */
export function createProgressionRouter(service: ProgressionService): Router {
    const router = Router();

    router.use(authMiddleware);

    const handle = (fn: (req: Request) => Promise<unknown>) => async (req: Request, res: Response) => {
        try {
            if (!req.user) return res.status(401).json({ message: req.t('auth.notAuthenticated') });

            return res.json(await fn(req));
        } catch (error) {
            if (error instanceof ProgressionError) return res.status(error.status).json({ code: error.code, message: req.t(error.messageKey, error.params) });

            console.error(error);

            return res.status(500).json({ message: req.t('progression.errorUnexpected') });
        }
    };

    router.get('/', handle((req) => service.view(req.user!.id)));
    router.post('/shop', handle((req) => service.buy(req.user!.id, String(req.body?.characterId ?? ''), req.body?.currency === 'diamonds' ? 'diamonds' : 'gold')));
    router.get(
        '/battles/:id',
        handle(async (req) => {
            const id = String(req.params.id);

            return (/^[0-9a-f-]{36}$/i.test(id) && (await service.battleReward(id, req.user!.id))) || { gold: 0, achievements: [] };
        }),
    );
    router.post(
        '/users/:id/grant',
        authorizeRoles('administrator', 'god'),
        handle(async (req) => {
            await service.grant(String(req.params.id), Number(req.body?.gold ?? 0), Number(req.body?.diamonds ?? 0));

            return { ok: true };
        }),
    );

    return router;
}
