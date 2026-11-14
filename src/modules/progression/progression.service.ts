import { CAMPAIGN, dailyChallenge, eventOf, towerFloor } from '../../game';
import type { EventMode } from '../../game';
import { seasonEnd, seasonOf } from '../ranked/ranked.season';
import { PASS_PRICE_DIAMONDS, PASS_TIERS, PASS_XP_PER_TIER, battleXp, levelOf, levelReward, passReward, titleOf } from './progression.levels';
import type { BattleRecord } from '../battles/battle.types';
import { ACHIEVEMENTS, CHARACTER_REFUND_GOLD, STARTER_CHARACTERS, battleGold, priceOf } from './progression.catalog';
import type { Achievement, AchievementMetric, AchievementReward } from './progression.catalog';
import {
    DAILY_MISSIONS,
    LOGIN_REWARDS,
    nextLoginDay,
    STARS_BY_DIFFICULTY,
    STAR_CHESTS,
    WEEKLY_MISSIONS,
    dailyPeriod,
    missionProgress,
    missionsFor,
    weeklyPeriod,
} from './progression.missions';
import type { Mission, MissionBattle, Period } from './progression.missions';

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

/** Uma batalha terminada como a guarda o banco, para as missões (os papéis saem dos personagens). */
export type FinishedBattle = Omit<MissionBattle, 'roles'> & { characterIds: string[]; finishedAt: Date };

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
    payBattle(battleId: string, userId: string, gold: number, xp: number): Promise<boolean>;
    setBattleAchievements(battleId: string, userId: string, achievements: string[]): Promise<void>;
    battleReward(battleId: string, userId: string): Promise<{ gold: number; xp: number; achievements: string[] } | null>;
    /** A experiência total do jogador. */
    userXp(userId: string): Promise<number>;
    /** A experiência que o jogador ganhou em batalhas desde `since` (o passe da temporada). */
    xpSince(userId: string, since: Date): Promise<number>;
    /** Compra com diamantes algo que vale uma vez só (o passe premium): grava a chave e debita juntos. */
    buyWithDiamonds(userId: string, key: string, price: number): Promise<'ok' | 'owned' | 'insufficient'>;
    /** As batalhas que o jogador terminou desde `since` (fora o treino). */
    finishedSince(userId: string, since: Date): Promise<FinishedBattle[]>;
    /** As fases da campanha vencidas, com o nível de cada vitória. */
    campaignClears(userId: string): Promise<{ stage: number; difficulty: string }[]>;
    /** Das chaves pedidas, as que o jogador já resgatou. */
    claimed(userId: string, keys: string[]): Promise<string[]>;
    /** Resgata uma recompensa uma vez só: grava a chave e paga juntos. `false` se já tinha resgatado. */
    claim(userId: string, key: string, gold: number, diamonds: number): Promise<boolean>;
    /** Em que dia da sequência de login o jogador está e o último dia em que resgatou. */
    loginState(userId: string): Promise<{ streak: number; lastDay: string | null }>;
    /** Grava o login de hoje e paga, só se o último dia ainda for `expectedLastDay`. Devolve se gravou. */
    saveLogin(userId: string, expectedLastDay: string | null, streak: number, today: string, gold: number, diamonds: number): Promise<boolean>;
}

export class ProgressionError extends Error {
    constructor(
        readonly code:
            | 'UNKNOWN_CHARACTER'
            | 'NOT_FOR_SALE'
            | 'ALREADY_OWNED'
            | 'INSUFFICIENT_FUNDS'
            | 'CHARACTER_LOCKED'
            | 'INVALID_AMOUNT'
            | 'UNKNOWN_REWARD'
            | 'NOT_COMPLETED'
            | 'ALREADY_CLAIMED',
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

export interface MissionView {
    id: string;
    metric: Mission['metric']['kind'];
    /** Nas missões de categoria: qual (mage, support...). */
    role: string | null;
    goal: number;
    progress: number;
    reward: { gold: number; diamonds: number };
    claimed: boolean;
}

export interface StarsView {
    total: number;
    max: number;
    /** Estrelas de cada fase, pelo número da fase. */
    byStage: Record<number, number>;
    chests: { at: number; gold: number; diamonds: number; claimed: boolean }[];
}

export interface ProgressionView {
    gold: number;
    diamonds: number;
    starters: string[];
    owned: string[];
    achievements: AchievementView[];
    shop: { characterId: string; gold: number; diamonds: number; owned: boolean; achievementId: string | null }[];
    missions: { daily: MissionView[]; weekly: MissionView[]; dailyResetsAt: Date; weeklyResetsAt: Date };
    stars: StarsView;
    login: LoginView;
    level: LevelView;
    event: EventView;
    pass: PassView;
}

/** O nível de conta. */
export interface LevelView {
    level: number;
    xp: number;
    xpIntoLevel: number;
    /** Quanto o nível atual pede para chegar ao próximo (0 no nível máximo). */
    xpForNext: number;
    title: string;
}

/** O evento da semana. */
export interface EventView {
    id: string;
    element: string;
    bonus: number;
    goldMode: EventMode;
    goldMultiplier: number;
    endsAt: Date;
}

/** O passe da temporada (mês). */
export interface PassView {
    season: string;
    endsAt: Date;
    xp: number;
    /** Quantos degraus o jogador já alcançou. */
    tier: number;
    xpPerTier: number;
    premium: boolean;
    price: number;
    tiers: { tier: number; free: { gold: number; diamonds: number }; premium: { gold: number; diamonds: number }; freeClaimed: boolean; premiumClaimed: boolean }[];
}

/** O prêmio do login diário: a sequência de 7 dias e onde o jogador está nela. */
export interface LoginView {
    /** O dia da sequência de hoje (1 a 7): o já resgatado, ou o que será resgatado. */
    day: number;
    claimedToday: boolean;
    rewards: { gold: number; diamonds: number }[];
    /** Quando o dia vira (meia-noite UTC). */
    resetsAt: Date;
}

/** O que o jogador pede para resgatar. */
export type ClaimTarget =
    | { type: 'daily' | 'weekly'; id: string }
    | { type: 'chest'; at: number }
    | { type: 'pass'; tier: number; track: 'free' | 'premium' }
    | { type: 'raid' };

/** Como está o chefe semanal para o jogador (quem responde é o módulo de batalhas). */
export type RaidStatus = (userId: string) => Promise<{ week: string; defeated: boolean; damage: number; reward: { gold: number; diamonds: number } }>;

const passKey = (season: string, track: 'free' | 'premium', tier: number) => `passe:${season}:${track}:${tier}`;
const premiumKey = (season: string) => `passe:${season}:premium`;

/** O modo de jogo da batalha, para o ouro do evento da semana. */
function modeOf(battle: BattleRecord): EventMode | null {
    if (battle.opponentId) return 'pvp';
    if (battle.towerFloor) return 'tower';
    if (battle.campaignStage !== null) return 'campaign';
    if (battle.challengeDay || battle.raidWeek) return null;

    return 'quick';
}

const metricValue = (metrics: Metrics, metric: AchievementMetric) => (metric.kind === 'characterWins' ? (metrics.characterWins[metric.characterId] ?? 0) : metrics[metric.kind]);

const missionKey = (period: Period, mission: Mission) => `${period.key}:${mission.id}`;
const chestKey = (at: number) => `estrelas:${at}`;

/**
 * Progressão do jogador: ouro e diamantes, personagens desbloqueados,
 * conquistas, missões, estrelas da campanha e a loja. As conquistas são
 * conferidas quando uma batalha acaba e quando a tela pede o progresso
 * (assim quem já jogava antes delas existirem recebe o que já tinha feito).
 */
export class ProgressionService {
    private now: () => Date;
    private roleOf: (characterId: string) => string | undefined;
    private raidStatus: RaidStatus | null;

    constructor(
        private store: ProgressionStore,
        private characterIds: () => string[],
        options: { now?: () => Date; roleOf?: (characterId: string) => string | undefined; raidStatus?: RaidStatus } = {},
    ) {
        this.now = options.now ?? (() => new Date());
        this.roleOf = options.roleOf ?? (() => undefined);
        this.raidStatus = options.raidStatus ?? null;
    }

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

        const [wallet, owned, done, metrics, missions, stars, login, level, pass] = await Promise.all([
            this.store.wallet(userId),
            this.owned(userId),
            this.store.completed(userId),
            this.metrics(userId),
            this.missions(userId),
            this.stars(userId),
            this.login(userId),
            this.level(userId),
            this.pass(userId),
        ]);
        const event = eventOf(this.now());
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
            missions,
            stars,
            login,
            level,
            event: { id: event.id, element: event.element, bonus: event.bonus, goldMode: event.goldMode, goldMultiplier: event.goldMultiplier, endsAt: event.endsAt },
            pass,
        };
    }

    /** Compra o passe premium da temporada atual. */
    async buyPass(userId: string): Promise<ProgressionView> {
        const result = await this.store.buyWithDiamonds(userId, premiumKey(seasonOf(this.now())), PASS_PRICE_DIAMONDS);

        if (result === 'owned') throw new ProgressionError('ALREADY_OWNED', 409, 'progression.passOwned');
        if (result === 'insufficient') throw new ProgressionError('INSUFFICIENT_FUNDS', 402, 'progression.insufficient.diamonds');

        return this.view(userId);
    }

    private async level(userId: string): Promise<LevelView> {
        const xp = await this.store.userXp(userId);
        const info = levelOf(xp);

        return { ...info, xp, title: titleOf(info.level) };
    }

    private async pass(userId: string): Promise<PassView> {
        const now = this.now();
        const season = seasonOf(now);
        const start = new Date(Date.parse(`${season}-01T00:00:00Z`));
        const xp = await this.store.xpSince(userId, start);
        const keys = [premiumKey(season)];

        for (let tier = 1; tier <= PASS_TIERS; tier++) keys.push(passKey(season, 'free', tier), passKey(season, 'premium', tier));

        const claimed = new Set(await this.store.claimed(userId, keys));

        return {
            season,
            endsAt: seasonEnd(now),
            xp,
            tier: Math.min(PASS_TIERS, Math.floor(xp / PASS_XP_PER_TIER)),
            xpPerTier: PASS_XP_PER_TIER,
            premium: claimed.has(premiumKey(season)),
            price: PASS_PRICE_DIAMONDS,
            tiers: Array.from({ length: PASS_TIERS }, (_, index) => {
                const tier = index + 1;

                return {
                    tier,
                    free: passReward(tier, 'free'),
                    premium: passReward(tier, 'premium'),
                    freeClaimed: claimed.has(passKey(season, 'free', tier)),
                    premiumClaimed: claimed.has(passKey(season, 'premium', tier)),
                };
            }),
        };
    }

    /** Resgata o prêmio do login de hoje (o próximo dia da sequência). */
    async claimLogin(userId: string): Promise<ProgressionView> {
        const { today, yesterday } = this.days();
        const state = await this.store.loginState(userId);

        if (state.lastDay === today) throw new ProgressionError('ALREADY_CLAIMED', 409, 'progression.alreadyClaimed');

        const day = nextLoginDay(state.streak, state.lastDay, yesterday);
        const reward = LOGIN_REWARDS[day - 1]!;

        // Duas requisições juntas: só a primeira grava (a outra encontra o dia já mudado).
        if (!(await this.store.saveLogin(userId, state.lastDay, day, today, reward.gold, reward.diamonds))) {
            throw new ProgressionError('ALREADY_CLAIMED', 409, 'progression.alreadyClaimed');
        }

        return this.view(userId);
    }

    private async login(userId: string): Promise<LoginView> {
        const { today, yesterday, tomorrow } = this.days();
        const state = await this.store.loginState(userId);
        const claimedToday = state.lastDay === today;

        return {
            day: claimedToday ? state.streak : nextLoginDay(state.streak, state.lastDay, yesterday),
            claimedToday,
            rewards: [...LOGIN_REWARDS],
            resetsAt: tomorrow,
        };
    }

    /** Hoje, ontem e o começo de amanhã, em UTC. */
    private days() {
        const start = dailyPeriod(this.now()).start;
        const key = (date: Date) => date.toISOString().slice(0, 10);

        return { today: key(start), yesterday: key(new Date(start.getTime() - 86_400_000)), tomorrow: new Date(start.getTime() + 86_400_000) };
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

    /** Resgata a recompensa de uma missão completa ou de um baú de estrelas aberto. */
    async claim(userId: string, target: ClaimTarget): Promise<ProgressionView> {
        let key: string;
        let reward: { gold: number; diamonds: number };

        if (target.type === 'pass') {
            const pass = await this.pass(userId);

            if (!Number.isInteger(target.tier) || target.tier < 1 || target.tier > PASS_TIERS) throw new ProgressionError('UNKNOWN_REWARD', 400, 'progression.unknownReward');
            if (target.tier > pass.tier) throw new ProgressionError('NOT_COMPLETED', 409, 'progression.notCompleted');
            if (target.track === 'premium' && !pass.premium) throw new ProgressionError('NOT_COMPLETED', 409, 'progression.passNeeded');

            key = passKey(pass.season, target.track, target.tier);
            reward = passReward(target.tier, target.track);
        } else if (target.type === 'raid') {
            const raid = this.raidStatus ? await this.raidStatus(userId) : null;

            if (!raid || !raid.defeated || raid.damage <= 0) throw new ProgressionError('NOT_COMPLETED', 409, 'progression.notCompleted');

            key = `chefe:${raid.week}`;
            reward = raid.reward;
        } else if (target.type === 'chest') {
            const chest = STAR_CHESTS.find((item) => item.at === target.at);

            if (!chest) throw new ProgressionError('UNKNOWN_REWARD', 400, 'progression.unknownReward');
            if ((await this.stars(userId)).total < chest.at) throw new ProgressionError('NOT_COMPLETED', 409, 'progression.notCompleted');

            key = chestKey(chest.at);
            reward = chest;
        } else {
            const period = target.type === 'daily' ? dailyPeriod(this.now()) : weeklyPeriod(this.now());
            const mission = missionsFor(userId, period, target.type === 'daily' ? DAILY_MISSIONS : WEEKLY_MISSIONS).find((item) => item.id === target.id);

            if (!mission) throw new ProgressionError('UNKNOWN_REWARD', 400, 'progression.unknownReward');

            const battles = await this.battlesIn(userId, period);

            if (missionProgress(mission, battles) < mission.goal) throw new ProgressionError('NOT_COMPLETED', 409, 'progression.notCompleted');

            key = missionKey(period, mission);
            reward = { gold: mission.reward.gold, diamonds: mission.reward.diamonds ?? 0 };
        }

        if (!(await this.store.claim(userId, key, reward.gold, reward.diamonds))) {
            throw new ProgressionError('ALREADY_CLAIMED', 409, 'progression.alreadyClaimed');
        }

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
            const won = battle.winner === team;
            let gold = battleGold({ won, versus, ranked: battle.ranked, difficulty: battle.difficulty, campaign: battle.campaignStage !== null });
            const xp = battleXp({ won, versus, ranked: battle.ranked });

            // O evento da semana em que a batalha começou multiplica o ouro do modo dele.
            const event = eventOf(battle.createdAt);
            const mode = modeOf(battle);

            if (mode && (event.goldMode === 'all' || event.goldMode === mode)) gold = Math.round(gold * event.goldMultiplier);

            // Andar da torre vencido: o prêmio do andar, uma vez só (os diamantes vão pelo resgate; o ouro, junto com o da batalha).
            if (won && battle.towerFloor) {
                const { reward } = towerFloor(battle.towerFloor, this.characterIds());

                if (await this.store.claim(userId, `torre:${battle.towerFloor}`, 0, reward.diamonds)) gold += reward.gold;
            }

            // Desafio do dia vencido: o prêmio do desafio, só na primeira vitória do dia.
            if (won && battle.challengeDay) {
                const { reward } = dailyChallenge(battle.challengeDay, this.characterIds());

                if (await this.store.claim(userId, `desafio:${battle.challengeDay}`, 0, reward.diamonds)) gold += reward.gold;
            }

            const xpBefore = await this.store.userXp(userId);

            if (await this.store.payBattle(battle.id, userId, gold, xp)) {
                // Cada nível novo paga o prêmio dele (uma vez só, pela chave).
                const from = levelOf(xpBefore).level;
                const to = levelOf(xpBefore + xp).level;

                for (let level = from + 1; level <= to; level++) {
                    const reward = levelReward(level);

                    await this.store.claim(userId, `nivel:${level}`, reward.gold, reward.diamonds);
                }

                const achieved = await this.checkAchievements(userId);

                if (achieved.length) await this.store.setBattleAchievements(battle.id, userId, achieved);
            }
        }
    }

    /** As missões do dia e da semana, com o progresso e se já foram resgatadas. */
    private async missions(userId: string): Promise<ProgressionView['missions']> {
        const now = this.now();
        const day = dailyPeriod(now);
        const week = weeklyPeriod(now);
        const daily = missionsFor(userId, day, DAILY_MISSIONS);
        const weekly = missionsFor(userId, week, WEEKLY_MISSIONS);
        // A semana contém o dia: uma busca só, filtrada para o dia depois.
        const weekBattles = await this.battlesIn(userId, week);
        const dayBattles = weekBattles.filter((battle) => battle.finishedAt >= day.start);
        const claimed = new Set(await this.store.claimed(userId, [...daily.map((m) => missionKey(day, m)), ...weekly.map((m) => missionKey(week, m))]));
        const toView = (period: Period, battles: MissionBattle[]) => (mission: Mission): MissionView => ({
            id: mission.id,
            metric: mission.metric.kind,
            role: mission.metric.kind === 'winRole' ? mission.metric.role : null,
            goal: mission.goal,
            progress: Math.min(mission.goal, missionProgress(mission, battles)),
            reward: { gold: mission.reward.gold, diamonds: mission.reward.diamonds ?? 0 },
            claimed: claimed.has(missionKey(period, mission)),
        });

        return {
            daily: daily.map(toView(day, dayBattles)),
            weekly: weekly.map(toView(week, weekBattles)),
            dailyResetsAt: day.end,
            weeklyResetsAt: week.end,
        };
    }

    private async battlesIn(userId: string, period: Period): Promise<(MissionBattle & { finishedAt: Date })[]> {
        const rows = await this.store.finishedSince(userId, period.start);

        return rows.map(({ characterIds, ...battle }) => ({
            ...battle,
            roles: [...new Set(characterIds.map((id) => this.roleOf(id)).filter((role): role is string => !!role))],
        }));
    }

    /** As estrelas da campanha: por fase (a melhor vitória) e os baús. */
    private async stars(userId: string): Promise<StarsView> {
        const clears = await this.store.campaignClears(userId);
        const byStage: Record<number, number> = {};

        for (const clear of clears) {
            byStage[clear.stage] = Math.max(byStage[clear.stage] ?? 0, STARS_BY_DIFFICULTY[clear.difficulty] ?? 1);
        }

        const total = Object.values(byStage).reduce((sum, stars) => sum + stars, 0);
        const claimed = new Set(await this.store.claimed(userId, STAR_CHESTS.map((chest) => chestKey(chest.at))));

        return {
            total,
            max: CAMPAIGN.length * 3,
            byStage,
            chests: STAR_CHESTS.map((chest) => ({ ...chest, claimed: claimed.has(chestKey(chest.at)) })),
        };
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
