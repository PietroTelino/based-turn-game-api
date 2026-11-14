/**
 * Missões diárias e semanais, e os baús de estrelas da campanha.
 *
 * Todo dia (e toda semana, a partir de segunda) cada jogador recebe 3
 * missões sorteadas da lista. O sorteio usa o id do jogador e o período como
 * semente, então a lista do dia não muda ao recarregar a página e não precisa
 * ficar guardada. O progresso sai das batalhas terminadas no período. A
 * recompensa é resgatada pelo jogador (UserClaim, uma vez só por período).
 *
 * Os períodos são em UTC: o dia vira à meia-noite UTC (21h em Brasília).
 */

export type MissionKind =
    | { kind: 'play' }
    | { kind: 'win' }
    | { kind: 'winRole'; role: string }
    | { kind: 'winHard' }
    | { kind: 'winCampaign' }
    | { kind: 'winTower' }
    | { kind: 'playVersus' }
    | { kind: 'winVersus' }
    | { kind: 'playRanked' };

export interface Mission {
    id: string;
    goal: number;
    metric: MissionKind;
    reward: { gold: number; diamonds?: number };
}

/** O que importa de uma batalha terminada para as missões. */
export interface MissionBattle {
    won: boolean;
    versus: boolean;
    ranked: boolean;
    difficulty: string | null;
    campaign: boolean;
    tower: boolean;
    /** As categorias dos personagens do jogador nessa batalha. */
    roles: string[];
}

export const DAILY_MISSIONS: readonly Mission[] = [
    { id: 'jogar-3', goal: 3, metric: { kind: 'play' }, reward: { gold: 60 } },
    { id: 'vencer-2', goal: 2, metric: { kind: 'win' }, reward: { gold: 80 } },
    { id: 'vencer-mago', goal: 1, metric: { kind: 'winRole', role: 'mage' }, reward: { gold: 70 } },
    { id: 'vencer-suporte', goal: 1, metric: { kind: 'winRole', role: 'support' }, reward: { gold: 70 } },
    { id: 'vencer-tanque', goal: 1, metric: { kind: 'winRole', role: 'tank' }, reward: { gold: 70 } },
    { id: 'vencer-assassino', goal: 1, metric: { kind: 'winRole', role: 'assassin' }, reward: { gold: 70 } },
    { id: 'vencer-campanha', goal: 1, metric: { kind: 'winCampaign' }, reward: { gold: 80 } },
    { id: 'vencer-torre', goal: 1, metric: { kind: 'winTower' }, reward: { gold: 90 } },
    { id: 'jogar-pvp', goal: 1, metric: { kind: 'playVersus' }, reward: { gold: 90 } },
];

export const WEEKLY_MISSIONS: readonly Mission[] = [
    { id: 'vencer-10', goal: 10, metric: { kind: 'win' }, reward: { gold: 300 } },
    { id: 'jogar-15', goal: 15, metric: { kind: 'play' }, reward: { gold: 250 } },
    { id: 'dificil-3', goal: 3, metric: { kind: 'winHard' }, reward: { gold: 350, diamonds: 5 } },
    { id: 'pvp-3', goal: 3, metric: { kind: 'winVersus' }, reward: { gold: 400, diamonds: 5 } },
    { id: 'ranqueada-5', goal: 5, metric: { kind: 'playRanked' }, reward: { gold: 350 } },
    { id: 'torre-3', goal: 3, metric: { kind: 'winTower' }, reward: { gold: 350 } },
    { id: 'campanha-5', goal: 5, metric: { kind: 'winCampaign' }, reward: { gold: 300 } },
];

export const MISSIONS_PER_PERIOD = 3;

/** Os baús de estrelas: quantas estrelas abrem cada um e o que tem dentro. */
export const STAR_CHESTS: readonly { at: number; gold: number; diamonds: number }[] = [
    { at: 10, gold: 200, diamonds: 0 },
    { at: 20, gold: 400, diamonds: 0 },
    { at: 30, gold: 600, diamonds: 10 },
    { at: 36, gold: 1000, diamonds: 30 },
];

/** O prêmio de cada dia da sequência de login (do 1º ao 7º). Depois do 7º, recomeça no 1º. */
export const LOGIN_REWARDS: readonly { gold: number; diamonds: number }[] = [
    { gold: 50, diamonds: 0 },
    { gold: 75, diamonds: 0 },
    { gold: 100, diamonds: 0 },
    { gold: 125, diamonds: 0 },
    { gold: 150, diamonds: 0 },
    { gold: 200, diamonds: 0 },
    { gold: 300, diamonds: 10 },
];

/**
 * O dia da sequência que o jogador resgata hoje: o seguinte ao último, se o
 * último foi ontem; senão (pulou um dia, ou nunca resgatou), o 1º.
 */
export function nextLoginDay(streak: number, lastDay: string | null, yesterday: string): number {
    return lastDay === yesterday ? (streak % LOGIN_REWARDS.length) + 1 : 1;
}

/** Estrelas de uma fase vencida: fácil 1, normal 2, difícil 3 (vale a melhor). */
export const STARS_BY_DIFFICULTY: Record<string, number> = { easy: 1, normal: 2, hard: 3 };

export interface Period {
    /** Parte da chave do resgate: "D2026-11-14" ou "W2026-11-09" (a segunda-feira da semana). */
    key: string;
    start: Date;
    end: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

export function dailyPeriod(now: Date): Period {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    return { key: `D${isoDay(start)}`, start, end: new Date(start.getTime() + DAY_MS) };
}

export function weeklyPeriod(now: Date): Period {
    const day = dailyPeriod(now).start;
    // getUTCDay: domingo 0 ... sábado 6. A semana começa na segunda.
    const start = new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY_MS);

    return { key: `W${isoDay(start)}`, start, end: new Date(start.getTime() + 7 * DAY_MS) };
}

/** Um número a partir do texto, sempre o mesmo para o mesmo texto. */
function hash(text: string): number {
    let value = 2166136261;

    for (let i = 0; i < text.length; i++) {
        value ^= text.charCodeAt(i);
        value = Math.imul(value, 16777619) >>> 0;
    }

    return value;
}

/** As missões do jogador no período: MISSIONS_PER_PERIOD da lista, sorteadas com semente fixa. */
export function missionsFor(userId: string, period: Period, pool: readonly Mission[]): Mission[] {
    let state = hash(`${userId}:${period.key}`);
    const rest = [...pool];
    const picked: Mission[] = [];

    while (picked.length < MISSIONS_PER_PERIOD && rest.length) {
        state = (state * 1664525 + 1013904223) >>> 0;
        picked.push(rest.splice(state % rest.length, 1)[0]!);
    }

    return picked;
}

/** Quanto das batalhas conta para a missão. */
export function missionProgress(mission: Mission, battles: MissionBattle[]): number {
    const metric = mission.metric;
    const count = (test: (battle: MissionBattle) => boolean) => battles.filter(test).length;

    switch (metric.kind) {
        case 'play':
            return battles.length;
        case 'win':
            return count((b) => b.won);
        case 'winRole':
            return count((b) => b.won && b.roles.includes(metric.role));
        case 'winHard':
            return count((b) => b.won && !b.versus && b.difficulty === 'hard');
        case 'winCampaign':
            return count((b) => b.won && b.campaign);
        case 'winTower':
            return count((b) => b.won && b.tower);
        case 'playVersus':
            return count((b) => b.versus);
        case 'winVersus':
            return count((b) => b.won && b.versus);
        case 'playRanked':
            return count((b) => b.ranked);
    }
}
