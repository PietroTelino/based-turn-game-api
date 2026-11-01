import { Request, Response } from 'express';
import { BattleError } from '../battles/battle.errors';
import { RankedError } from './ranked.errors';
import type { RankedService } from './ranked.service';

export class RankedController {
    constructor(private service: RankedService) {}

    /** GET / — os pontos, o rank e a situação na fila de quem pediu. */
    profile = async (req: Request, res: Response) => {
        try {
            if (!req.user) {
                return res.status(401).json({ message: req.t('auth.notAuthenticated') });
            }

            return res.json(await this.service.profile(req.user.id));
        } catch (error) {
            return this.handleError(req, res, error);
        }
    };

    /** POST /queue — entra na fila. O time é montado depois, na seleção de personagens. */
    enter = async (req: Request, res: Response) => {
        try {
            if (!req.user) {
                return res.status(401).json({ message: req.t('auth.notAuthenticated') });
            }

            return res.json(await this.service.enter(req.user.id));
        } catch (error) {
            return this.handleError(req, res, error);
        }
    };

    /** GET /queue — como o jogador está na fila. É a consulta que a tela repete enquanto procura. */
    queue = async (req: Request, res: Response) => {
        try {
            if (!req.user) {
                return res.status(401).json({ message: req.t('auth.notAuthenticated') });
            }

            return res.json(await this.service.queue(req.user.id));
        } catch (error) {
            return this.handleError(req, res, error);
        }
    };

    /** GET /draft — a seleção de personagens de quem pediu. É a consulta que a tela repete durante a seleção. */
    draft = async (req: Request, res: Response) => {
        try {
            if (!req.user) {
                return res.status(401).json({ message: req.t('auth.notAuthenticated') });
            }

            return res.json(await this.service.draft(req.user.id));
        } catch (error) {
            return this.handleError(req, res, error);
        }
    };

    /** POST /draft { characterId } — bane ou escolhe no passo da vez. */
    draftAction = async (req: Request, res: Response) => {
        try {
            if (!req.user) {
                return res.status(401).json({ message: req.t('auth.notAuthenticated') });
            }

            const { characterId } = req.body ?? {};

            if (typeof characterId !== 'string') {
                throw new RankedError('INVALID_RANKED_REQUEST', 400, 'ranked.draft.characterRequired');
            }

            return res.json(await this.service.draftAction(req.user.id, characterId));
        } catch (error) {
            return this.handleError(req, res, error);
        }
    };

    /** DELETE /queue — sai da fila. */
    leave = async (req: Request, res: Response) => {
        try {
            if (!req.user) {
                return res.status(401).json({ message: req.t('auth.notAuthenticated') });
            }

            return res.json(await this.service.leave(req.user.id));
        } catch (error) {
            return this.handleError(req, res, error);
        }
    };

    private handleError(req: Request, res: Response, error: unknown) {
        if (error instanceof RankedError) {
            return res.status(error.status).json({ code: error.code, message: req.t(error.messageKey), ...error.data });
        }

        // Time inválido: quem confere é o módulo de batalhas.
        if (error instanceof BattleError) {
            return res.status(error.status).json({ code: error.code, message: req.t(error.messageKey, error.params) });
        }

        console.error(error);

        return res.status(500).json({ message: req.t('ranked.errorUnexpected') });
    }
}
