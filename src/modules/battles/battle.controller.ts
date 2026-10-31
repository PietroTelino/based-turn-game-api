import { Request, Response } from 'express';
import { AI_DIFFICULTIES, GameRuleError } from '../../game';
import type { AiDifficulty, BattleAction } from '../../game';
import { BattleError } from './battle.errors';
import type { BattleService } from './battle.service';

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isDifficulty(value: unknown): value is AiDifficulty {
    return typeof value === 'string' && (AI_DIFFICULTIES as readonly string[]).includes(value);
}

export class BattleController {
    constructor(private service: BattleService) {}

    listCharacters = async (_req: Request, res: Response) => {
        return res.json(this.service.listCharacters());
    };

    /** GET /campaign — as fases da campanha, com o que o jogador já abriu e venceu. */
    campaign = async (req: Request, res: Response) => {
        try {
            if (!req.user) {
                return res.status(401).json({ message: req.t('auth.notAuthenticated') });
            }

            return res.json(await this.service.campaign(req.user.id));
        } catch (error) {
            return this.handleError(req, res, error);
        }
    };

    list = async (req: Request, res: Response) => {
        try {
            if (!req.user) {
                return res.status(401).json({ message: req.t('auth.notAuthenticated') });
            }

            return res.json(await this.service.list(req.user.id));
        } catch (error) {
            return this.handleError(req, res, error);
        }
    };

    create = async (req: Request, res: Response) => {
        try {
            if (!req.user) {
                return res.status(401).json({ message: req.t('auth.notAuthenticated') });
            }

            const { team, enemyTeam, training, difficulty, campaignStage } = req.body ?? {};

            if (!isStringArray(team) || (enemyTeam !== undefined && !isStringArray(enemyTeam))) {
                throw new BattleError('INVALID_TEAM', 400, 'battle.teamRequired');
            }

            if (difficulty !== undefined && !isDifficulty(difficulty)) {
                throw new BattleError('INVALID_DIFFICULTY', 400, 'battle.invalidDifficulty');
            }

            if (campaignStage !== undefined && !Number.isInteger(campaignStage)) {
                throw new BattleError('UNKNOWN_STAGE', 400, 'battle.unknownStage', { stage: String(campaignStage) });
            }

            const result = await this.service.create(req.user.id, {
                team,
                ...(enemyTeam !== undefined && { enemyTeam }),
                // Só `true` liga o treino; qualquer outra coisa é batalha normal.
                ...(training === true && { training: true }),
                ...(difficulty !== undefined && { difficulty }),
                ...(campaignStage !== undefined && { campaignStage: campaignStage as number }),
            });

            return res.status(201).json(result);
        } catch (error) {
            return this.handleError(req, res, error);
        }
    };

    getById = async (req: Request, res: Response) => {
        try {
            if (!req.user) {
                return res.status(401).json({ message: req.t('auth.notAuthenticated') });
            }

            return res.json(await this.service.get(req.user.id, String(req.params.id)));
        } catch (error) {
            return this.handleError(req, res, error);
        }
    };

    /** GET /:id/events?after=N — o que aconteceu depois dos N primeiros eventos. */
    events = async (req: Request, res: Response) => {
        try {
            if (!req.user) {
                return res.status(401).json({ message: req.t('auth.notAuthenticated') });
            }

            const after = Number(req.query.after ?? 0);

            return res.json(await this.service.events(req.user.id, String(req.params.id), Number.isInteger(after) && after > 0 ? after : 0));
        } catch (error) {
            return this.handleError(req, res, error);
        }
    };

    act = async (req: Request, res: Response) => {
        try {
            if (!req.user) {
                return res.status(401).json({ message: req.t('auth.notAuthenticated') });
            }

            const { unitId, skillId, targetId } = req.body ?? {};
            const hasTarget = targetId !== undefined && targetId !== null;

            if (typeof unitId !== 'string' || typeof skillId !== 'string' || (hasTarget && typeof targetId !== 'string')) {
                throw new BattleError('INVALID_ACTION', 400, 'battle.invalidAction');
            }

            const action: BattleAction = { unitId, skillId, ...(hasTarget && { targetId }) };

            return res.json(await this.service.act(req.user.id, String(req.params.id), action));
        } catch (error) {
            return this.handleError(req, res, error);
        }
    };

    /** GET /:id/replay — a batalha encerrada do começo ao fim, para assistir de novo. */
    replay = async (req: Request, res: Response) => {
        try {
            if (!req.user) {
                return res.status(401).json({ message: req.t('auth.notAuthenticated') });
            }

            return res.json(await this.service.replay(req.user.id, String(req.params.id)));
        } catch (error) {
            return this.handleError(req, res, error);
        }
    };

    /** POST /:id/timeout — partida ranqueada: o adversário passou do prazo e quem espera pede a vitória. */
    timeout = async (req: Request, res: Response) => {
        try {
            if (!req.user) {
                return res.status(401).json({ message: req.t('auth.notAuthenticated') });
            }

            return res.json(await this.service.claimTimeout(req.user.id, String(req.params.id)));
        } catch (error) {
            return this.handleError(req, res, error);
        }
    };

    surrender = async (req: Request, res: Response) => {
        try {
            if (!req.user) {
                return res.status(401).json({ message: req.t('auth.notAuthenticated') });
            }

            return res.json(await this.service.surrender(req.user.id, String(req.params.id)));
        } catch (error) {
            return this.handleError(req, res, error);
        }
    };

    private handleError(req: Request, res: Response, error: unknown) {
        // Regra do jogo quebrada: "não é sua vez", "sem energia"...
        if (error instanceof GameRuleError) {
            const status = error.code === 'BATTLE_OVER' ? 409 : 400;

            return res.status(status).json({ code: error.code, message: req.t(`battle.rules.${error.code}`) });
        }

        if (error instanceof BattleError) {
            return res.status(error.status).json({ code: error.code, message: req.t(error.messageKey, error.params) });
        }

        console.error(error);

        return res.status(500).json({ message: req.t('battle.errorUnexpected') });
    }
}
