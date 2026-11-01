import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { PLAYER_TEAM } from '../battles/battle.service';
import type { BattleRecord } from '../battles/battle.types';

/** Onde fica guardado quando cada jogador terminou o tutorial. */
export interface TutorialStore {
    /** Quando o jogador terminou o tutorial, ou `null` se ainda não terminou. */
    completedAt(userId: string): Promise<Date | null>;
    /** Marca o tutorial como feito. Se já estava, não muda a data. */
    markCompleted(userId: string, at: Date): Promise<void>;
}

/** O que a tela recebe de GET /api/tutorial. */
export interface TutorialStatus {
    completed: boolean;
    completedAt: Date | null;
}

/**
 * O tutorial é obrigatório: enquanto o jogador não termina a batalha de
 * treino, ele não pode começar nenhuma outra partida (rápida, campanha, sala
 * ou ranqueada). A batalha de treino só conta quando o jogador vence: quem
 * perde ou desiste refaz o tutorial.
 */
export class TutorialService {
    constructor(
        private store: TutorialStore,
        private now: () => Date = () => new Date(),
    ) {}

    async status(userId: string): Promise<TutorialStatus> {
        const completedAt = await this.store.completedAt(userId);

        return { completed: completedAt !== null, completedAt };
    }

    async isCompleted(userId: string): Promise<boolean> {
        return (await this.store.completedAt(userId)) !== null;
    }

    /**
     * Ouvinte do fim das batalhas (BattleService.onFinished): a batalha de
     * treino que o jogador venceu marca o tutorial como feito. O jogador é
     * sempre o time A (PLAYER_TEAM); a vitória por desistência da IA não
     * existe, porque a IA nunca desiste.
     */
    async onBattleFinished(record: BattleRecord): Promise<void> {
        if (record.state.training && record.winner === PLAYER_TEAM) {
            await this.store.markCompleted(record.userId, this.now());
        }
    }

    /**
     * Trava de rota: responde 403 com TUTORIAL_REQUIRED a quem ainda não fez
     * o tutorial. `skip` deixa passar algumas requisições da mesma rota (a
     * criação da própria batalha de treino).
     */
    guard(skip: (req: Request) => boolean = () => false): RequestHandler {
        return async (req: Request, res: Response, next: NextFunction) => {
            try {
                if (!req.user || skip(req) || (await this.isCompleted(req.user.id))) {
                    return next();
                }

                return res.status(403).json({ code: 'TUTORIAL_REQUIRED', message: req.t('tutorial.required') });
            } catch (error) {
                return next(error);
            }
        };
    }
}
