import { ARENAS } from '../constants';
import type { AiDifficulty, ArenaId } from '../types';
import { TOWER_MODIFIERS } from './tower';

/**
 * O desafio diário: uma batalha igual para todos os jogadores no mesmo dia
 * (UTC). Tudo sai da data: o time inimigo, o cenário e dois modificadores da
 * torre. A IA joga no difícil. O jogador monta o próprio time; o placar do
 * dia é de quem venceu em menos turnos.
 */
export interface DailyChallenge {
    /** O dia, "2026-11-14". */
    day: string;
    enemyTeam: string[];
    arena: ArenaId;
    difficulty: AiDifficulty;
    /** Ids de TOWER_MODIFIERS. */
    modifiers: string[];
    /** Quanto a vida e o ataque dos inimigos crescem. */
    scale: number;
    /** O que a primeira vitória do dia paga. */
    reward: { gold: number; diamonds: number };
}

const TEAM = 5;

/** O dia como número (dias desde 1970), para a semente. */
function dayNumber(day: string): number {
    return Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
}

export function dailyChallenge(day: string, characterIds: readonly string[]): DailyChallenge {
    let state = (dayNumber(day) * 2654435761 + 97) >>> 0;
    const next = () => {
        state = (state * 1664525 + 1013904223) >>> 0;

        return state / 0x100000000;
    };
    const pool = [...characterIds];
    const enemyTeam: string[] = [];

    while (enemyTeam.length < Math.min(TEAM, pool.length)) {
        enemyTeam.push(pool.splice(Math.floor(next() * pool.length), 1)[0]!);
    }

    const mods = [...TOWER_MODIFIERS];
    const modifiers = [0, 1].map(() => mods.splice(Math.floor(next() * mods.length), 1)[0]!.id);

    return {
        day,
        enemyTeam,
        arena: ARENAS[Math.floor(next() * ARENAS.length)]!,
        difficulty: 'hard',
        modifiers,
        scale: 1.1,
        reward: { gold: 150, diamonds: 5 },
    };
}
