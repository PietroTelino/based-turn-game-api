import { Router } from 'express';
import type { Request, Response } from 'express';
import { authMiddleware } from '../auth/auth.middleware';
import { FriendsError } from './friends.service';
import type { FriendsService } from './friends.service';

/**
 * GET    /api/friends                 amigos (com a batalha em andamento), pedidos e convites
 * GET    /api/friends/search?q=       procura jogadores pelo nome
 * GET    /api/friends/invites         só os convites para sala (a consulta que a tela repete)
 * POST   /api/friends                 { userId }: manda o pedido (ou aceita, se o outro já pediu)
 * POST   /api/friends/:requestId/accept
 * DELETE /api/friends/:userId         desfaz a amizade, recusa ou cancela o pedido
 * POST   /api/friends/invites         { code, userId }: convida o amigo para a sala
 * DELETE /api/friends/invites/:id     dispensa o convite
 */
export function createFriendsRouter(service: FriendsService): Router {
    const router = Router();

    router.use(authMiddleware);

    const handle = (fn: (req: Request) => Promise<unknown>, status = 200) => async (req: Request, res: Response) => {
        try {
            if (!req.user) return res.status(401).json({ message: req.t('auth.notAuthenticated') });

            const result = await fn(req);

            return result === undefined ? res.status(204).send() : res.status(status).json(result);
        } catch (error) {
            if (error instanceof FriendsError) return res.status(error.status).json({ code: error.code, message: req.t(error.messageKey) });

            console.error(error);

            return res.status(500).json({ message: req.t('friends.errorUnexpected') });
        }
    };

    router.get('/', handle((req) => service.list(req.user!.id)));
    router.get('/search', handle((req) => service.search(req.user!.id, String(req.query.q ?? ''))));
    router.get('/invites', handle((req) => service.invites(req.user!.id)));
    router.post('/', handle((req) => service.request(req.user!.id, String(req.body?.userId ?? ''))));
    router.post('/invites', handle((req) => service.invite(req.user!.id, String(req.body?.code ?? ''), String(req.body?.userId ?? ''))));
    router.delete('/invites/:id', handle((req) => service.dismissInvite(req.user!.id, String(req.params.id))));
    router.post('/:requestId/accept', handle((req) => service.accept(req.user!.id, String(req.params.requestId))));
    router.delete('/:userId', handle((req) => service.remove(req.user!.id, String(req.params.userId))));

    return router;
}
