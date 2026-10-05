import { Request, Response } from 'express';
import type { StatsService } from './stats.service';

export class StatsController {
    constructor(private service: StatsService) {}

    /** GET /characters — os personagens mais usados: pelo próprio jogador e no jogo todo. */
    characters = async (req: Request, res: Response) => {
        try {
            if (!req.user) {
                return res.status(401).json({ message: req.t('auth.notAuthenticated') });
            }

            return res.json(await this.service.characters(req.user.id));
        } catch (error) {
            console.error(error);

            return res.status(500).json({ message: req.t('stats.errorUnexpected') });
        }
    };
}
