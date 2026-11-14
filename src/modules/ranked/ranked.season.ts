import type { RankId } from './ranked.rules';

/**
 * As temporadas da ranqueada: uma por mês (UTC). Quando a temporada vira, o
 * jogador recebe a recompensa do rank em que terminou, os pontos caem pela
 * metade e o placar (vitórias e derrotas) zera.
 *
 * A virada não depende de tarefa agendada: acontece na primeira vez que o
 * jogador mexe na ranqueada depois da troca de mês (ver RankedService).
 */

/** A temporada de uma data: "2026-11". */
export function seasonOf(date: Date): string {
    return date.toISOString().slice(0, 7);
}

/** Quando a temporada de `date` acaba (o começo do mês seguinte, em UTC). */
export function seasonEnd(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

/** Os pontos com que o jogador começa a temporada nova. */
export function softReset(points: number): number {
    return Math.floor(points / 2);
}

/** O que o rank final da temporada paga. */
export const SEASON_REWARDS: Record<RankId, { gold: number; diamonds: number }> = {
    bronze: { gold: 100, diamonds: 0 },
    silver: { gold: 200, diamonds: 0 },
    gold: { gold: 300, diamonds: 5 },
    platinum: { gold: 400, diamonds: 10 },
    diamond: { gold: 600, diamonds: 20 },
    legendary: { gold: 1000, diamonds: 40 },
};

/** Como o jogador terminou uma temporada. */
export interface SeasonResult {
    season: string;
    rating: number;
    rank: RankId;
    wins: number;
    losses: number;
    gold: number;
    diamonds: number;
}

/** Uma linha do placar de líderes. */
export interface LeaderboardEntry {
    position: number;
    userId: string;
    name: string;
    points: number;
    rank: RankId;
    wins: number;
    losses: number;
}

export interface LeaderboardView {
    season: string;
    endsAt: Date;
    entries: LeaderboardEntry[];
    /** A posição de quem pediu, se ele jogou na temporada. */
    you: { position: number; points: number } | null;
}
