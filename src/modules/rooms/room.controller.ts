import { Request, Response } from 'express';
import { BattleError } from '../battles/battle.errors';
import { RoomError } from './room.errors';
import type { RoomService } from './room.service';

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export class RoomController {
    constructor(private service: RoomService) {}

    /** GET / — salas abertas, esperando alguém entrar. */
    list = async (req: Request, res: Response) => {
        try {
            if (!req.user) {
                return res.status(401).json({ message: req.t('auth.notAuthenticated') });
            }

            return res.json(await this.service.listOpen(req.user.id));
        } catch (error) {
            return this.handleError(req, res, error);
        }
    };

    /** POST / — cria uma sala; quem cria é o anfitrião. */
    create = async (req: Request, res: Response) => {
        try {
            if (!req.user) {
                return res.status(401).json({ message: req.t('auth.notAuthenticated') });
            }

            return res.status(201).json(await this.service.create(req.user.id));
        } catch (error) {
            return this.handleError(req, res, error);
        }
    };

    /** GET /:code — a sala, vista por quem pediu. É a consulta que a tela repete enquanto espera. */
    getByCode = async (req: Request, res: Response) => {
        try {
            if (!req.user) {
                return res.status(401).json({ message: req.t('auth.notAuthenticated') });
            }

            return res.json(await this.service.get(req.user.id, String(req.params.code)));
        } catch (error) {
            return this.handleError(req, res, error);
        }
    };

    /** POST /:code/join — entra na sala como convidado. */
    join = async (req: Request, res: Response) => {
        try {
            if (!req.user) {
                return res.status(401).json({ message: req.t('auth.notAuthenticated') });
            }

            return res.json(await this.service.join(req.user.id, String(req.params.code)));
        } catch (error) {
            return this.handleError(req, res, error);
        }
    };

    /** POST /:code/ready { team } — confirma o time e avisa que está pronto. */
    ready = async (req: Request, res: Response) => {
        try {
            if (!req.user) {
                return res.status(401).json({ message: req.t('auth.notAuthenticated') });
            }

            const { team } = req.body ?? {};

            if (!isStringArray(team)) {
                throw new RoomError('INVALID_ROOM_REQUEST', 400, 'battle.teamRequired');
            }

            return res.json(await this.service.ready(req.user.id, String(req.params.code), team));
        } catch (error) {
            return this.handleError(req, res, error);
        }
    };

    /** POST /:code/unready — volta atrás para trocar o time. */
    unready = async (req: Request, res: Response) => {
        try {
            if (!req.user) {
                return res.status(401).json({ message: req.t('auth.notAuthenticated') });
            }

            return res.json(await this.service.unready(req.user.id, String(req.params.code)));
        } catch (error) {
            return this.handleError(req, res, error);
        }
    };

    /** POST /:code/leave — sai da sala antes de a batalha começar. */
    leave = async (req: Request, res: Response) => {
        try {
            if (!req.user) {
                return res.status(401).json({ message: req.t('auth.notAuthenticated') });
            }

            await this.service.leave(req.user.id, String(req.params.code));

            return res.status(204).send();
        } catch (error) {
            return this.handleError(req, res, error);
        }
    };

    private handleError(req: Request, res: Response, error: unknown) {
        if (error instanceof RoomError) {
            return res.status(error.status).json({ code: error.code, message: req.t(error.messageKey) });
        }

        // Time inválido: quem confere é o módulo de batalhas.
        if (error instanceof BattleError) {
            return res.status(error.status).json({ code: error.code, message: req.t(error.messageKey, error.params) });
        }

        console.error(error);

        return res.status(500).json({ message: req.t('room.errorUnexpected') });
    }
}
