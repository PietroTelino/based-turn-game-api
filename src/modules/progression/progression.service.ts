import type { BattleRecord } from '../battles/battle.types';
import { ACHIEVEMENTS, CHARACTER_REFUND_GOLD, STARTER_CHARACTERS, battleGold, priceOf } from './progression.catalog';
import type { Achievement, AchievementMetric, AchievementReward } from './progression.catalog';

export type Currency = 'gold' | 'diamonds';

/** Os números de onde sai o progresso das conquistas. */
export interface Metrics {
    wins: number;
    played: number;
    winsHard: number;
    campaign: number;
    campaignHard: number;
    pvpWins: number;
    rankedWins: number;
    characterWins: Record<string, number>;
}

export interface ProgressionStore {
    wallet(userId: string): Promise<{ gold: number; diamonds: number }>;
    unlocked(userId: string): Promise<string[]>;
    completed(userId: string): Promise<{ achievementId: string; completedAt: Date }[]>;
    metrics(userId: string, characterIds: string[]): Promise<Metrics>;
    /** Grava a conquista e entrega a recompensa, tudo junto. `false` se ela já estava completa. */
    complete(userId: string, achievement: Achievement, refundGold: number): Promise<boolean>;
    /** Compra: debita e desbloqueia juntos. */
    purchase(userId: string, characterId: string, currency: Currency, price: number): Promise<'ok' | 'owned' | 'insufficient'>;
    addFunds(userId: string, gold: number, diamonds: number): Promise<void>;
    unlock(userId: string, characterId: string, source: string): Promise<void>;
    /** Paga o ouro da batalha uma vez só. `false` se já tinha pago. */
    payBattle(battleId: string, userId: string, gold: number): Promise<boolean>;
    setBattleAchievements(battleId: string, userId: string, achievements: string[]): Promise<void>;
    battleReward(battleId: string, userId: string): Promise<{ gold: number; achievements: string[] } | null>;
}

export class ProgressionError extends Error {
    constructor(
        readonly code: 'UNKNOWN_CHARACTER' | 'NOT_FOR_SALE' | 'ALREADY_OWNED' | 'INSUFFICIENT_FUNDS' | 'CHARACTER_LOCKED' | 'INVALID_AMOUNT',
        readonly status: number,
        readonly messageKey: string,
        readonly params: Record<string, string> = {},
    ) {
        super(messageKey);
    }
}

export interface AchievementView {
    id: string;
    metric: AchievementMetric['kind'];
    characterId: string | null;
    goal: number;
    progress: number;
    completed: boolean;
    completedAt: Date | null;
    reward: AchievementReward;
}

export interface ProgressionView {
    gold: number;
    diamonds: number;
    starters: string[];
    owned: string[];
    achievements: AchievementView[];
    shop: { characterId: string; gold: number; diamonds: number; owned: boolean; achievementId: string | null }[];
}

const metricValue = (metrics: Metrics, metric: AchievementMetric) => (metric.kind === 'characterWins' ? (metrics.characterWins[metric.characterId] ?? 0) : metrics[metric.kind]);

/**
 * Progressão do jogador: ouro e diamantes, personagens desbloqueados,
 * conquistas e a loja. As conquistas são conferidas quando uma batalha
 * acaba e quando a tela pede o progresso (assim quem já jogava antes delas
 * existirem recebe o que já tinha feito).
 */
export class ProgressionService {
    constructor(
        private store: ProgressionStore,
        private characterIds: () => string[],
    ) {}

    async owned(userId: string): Promise<string[]> {
        return [...new Set([...STARTER_CHARACTERS, ...(await this.store.unlocked(userId))])];
    }

    /** O primeiro personagem do time que o jogador ainda não tem, ou `null`. */
    async lockedOf(userId: string, team: string[]): Promise<string | null> {
        const owned = new Set(await this.owned(userId));

        return team.find((id) => !owned.has(id) && this.characterIds().includes(id)) ?? null;
    }

    async view(userId: string): Promise<ProgressionView> {
        await this.checkAchievements(userId);

        const [wallet, owned, done, metrics] = await Promise.all([this.store.wallet(userId), this.owned(userId), this.store.completed(userId), this.metrics(userId)]);
        const doneAt = new Map(done.map((item) => [item.achievementId, item.completedAt]));

        return {
            ...wallet,
            starters: [...STARTER_CHARACTERS],
            owned,
            achievements: ACHIEVEMENTS.map((a) => ({
                id: a.id,
                metric: a.metric.kind,
                characterId: a.metric.kind === 'characterWins' ? a.metric.characterId : null,
                goal: a.goal,
                progress: Math.min(a.goal, metricValue(metrics, a.metric)),
                completed: doneAt.has(a.id),
                completedAt: doneAt.get(a.id) ?? null,
                reward: a.reward,
            })),
            shop: this.characterIds()
                .filter((id) => priceOf(id))
                .map((id) => ({ characterId: id, ...priceOf(id)!, owned: owned.includes(id), achievementId: ACHIEVEMENTS.find((a) => a.reward.character === id)?.id ?? null })),
        };
    }

    async buy(userId: string, characterId: string, currency: Currency): Promise<ProgressionView> {
        if (!this.characterIds().includes(characterId)) throw new ProgressionError('UNKNOWN_CHARACTER', 400, 'progression.unknownCharacter', { id: characterId });

        const price = priceOf(characterId);

        if (!price) throw new ProgressionError('NOT_FOR_SALE', 400, 'progression.notForSale');

        const result = await this.store.purchase(userId, characterId, currency, price[currency]);

        if (result === 'owned') throw new ProgressionError('ALREADY_OWNED', 409, 'progression.alreadyOwned');
        if (result === 'insufficient') throw new ProgressionError('INSUFFICIENT_FUNDS', 402, `progression.insufficient.${currency}`);

        return this.view(userId);
    }

    /** O administrador dá (ou tira, com negativo) ouro e diamantes. */
    async grant(userId: string, gold: number, diamonds: number): Promise<void> {
        if (!Number.isInteger(gold) || !Number.isInteger(diamonds)) throw new ProgressionError('INVALID_AMOUNT', 400, 'progression.invalidAmount');

        await this.store.addFunds(userId, gold, diamonds);
    }

    async battleReward(battleId: string, userId: string) {
        return this.store.battleReward(battleId, userId);
    }

    /** Ouvinte do fim das batalhas: paga o ouro de cada jogador e confere as conquistas. */
    async onBattleFinished(battle: BattleRecord): Promise<void> {
        const versus = battle.opponentId !== null;

        // O treino (sem nível e sem adversário) não dá nada.
        if (!versus && battle.difficulty === null) return;

        const players: [string, 'A' | 'B'][] = [[battle.userId, 'A']];

        if (battle.opponentId) players.push([battle.opponentId, 'B']);

        for (const [userId, team] of players) {
            const gold = battleGold({ won: battle.winner === team, versus, ranked: battle.ranked, difficulty: battle.difficulty, campaign: battle.campaignStage !== null });

            if (await this.store.payBattle(battle.id, userId, gold)) {
                const achieved = await this.checkAchievements(userId);

                if (achieved.length) await this.store.setBattleAchievements(battle.id, userId, achieved);
            }
        }
    }

    /** Completa (e paga) as conquistas que o jogador já alcançou. Devolve as novas. */
    private async checkAchievements(userId: string): Promise<string[]> {
        const done = new Set((await this.store.completed(userId)).map((item) => item.achievementId));
        const pending = ACHIEVEMENTS.filter((a) => !done.has(a.id));

        if (!pending.length) return [];

        const metrics = await this.metrics(userId);
        const owned = new Set(await this.owned(userId));
        const fresh: string[] = [];

        for (const achievement of pending) {
            if (metricValue(metrics, achievement.metric) < achievement.goal) continue;

            const refund = achievement.reward.character && owned.has(achievement.reward.character) ? CHARACTER_REFUND_GOLD : 0;

            if (await this.store.complete(userId, achievement, refund)) fresh.push(achievement.id);
        }

        return fresh;
    }

    private metrics(userId: string): Promise<Metrics> {
        const ids = ACHIEVEMENTS.flatMap((a) => (a.metric.kind === 'characterWins' ? [a.metric.characterId] : []));

        return this.store.metrics(userId, ids);
    }
}
