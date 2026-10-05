import { Request, Response } from 'express';
import { BattleError } from '../battles/battle.errors';
import { RankedError } from './ranked.errors';
import type { RankedService } from './ranked.service';

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

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

    /** POST /queue { team } — entra na fila com o time escolhido. */
    enter = async (req: Request, res: Response) => {
        try {
            if (!req.user) {
                return res.status(401).json({ message: req.t('auth.notAuthenticated') });
            }

            const { team } = req.body ?? {};

            if (!isStringArray(team)) {
                throw new RankedError('INVALID_RANKED_REQUEST', 400, 'battle.teamRequired');
            }

            return res.json(await this.service.enter(req.user.id, team));
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
