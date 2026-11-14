import type { SkillElement } from '../types';

/**
 * Os eventos semanais: toda semana (de segunda a domingo, UTC) vale um, em
 * rodízio. O evento dá um bônus de dano às habilidades de um elemento, em
 * todas as batalhas criadas na semana, e multiplica o ouro de um modo de jogo.
 */
export type EventMode = 'tower' | 'campaign' | 'pvp' | 'quick' | 'all';

export interface WeeklyEvent {
    id: string;
    element: SkillElement;
    /** Quanto o dano do elemento aumenta (0,2 = +20%). */
    bonus: number;
    /** O modo em que o ouro das batalhas é multiplicado. */
    goldMode: EventMode;
    goldMultiplier: number;
}

export const WEEKLY_EVENTS: readonly WeeklyEvent[] = [
    { id: 'gelo', element: 'ice', bonus: 0.2, goldMode: 'tower', goldMultiplier: 2 },
    { id: 'fogo', element: 'fire', bonus: 0.2, goldMode: 'campaign', goldMultiplier: 2 },
    { id: 'sombras', element: 'shadow', bonus: 0.2, goldMode: 'pvp', goldMultiplier: 2 },
    { id: 'luz', element: 'light', bonus: 0.2, goldMode: 'quick', goldMultiplier: 2 },
    { id: 'natureza', element: 'nature', bonus: 0.2, goldMode: 'all', goldMultiplier: 1.5 },
];

const DAY_MS = 86_400_000;

/** A segunda-feira (UTC) da semana de `date`. */
export function weekStart(date: Date): Date {
    const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

    return new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY_MS);
}

/** A semana como texto: "W2026-11-09" (a segunda-feira). É a mesma chave das missões semanais. */
export function weekKey(date: Date): string {
    return `W${weekStart(date).toISOString().slice(0, 10)}`;
}

/** O evento da semana de `date`. */
export function eventOf(date: Date): WeeklyEvent & { week: string; endsAt: Date } {
    const start = weekStart(date);
    const index = Math.floor(start.getTime() / DAY_MS / 7);
    const event = WEEKLY_EVENTS[((index % WEEKLY_EVENTS.length) + WEEKLY_EVENTS.length) % WEEKLY_EVENTS.length]!;

    return { ...event, week: weekKey(date), endsAt: new Date(start.getTime() + 7 * DAY_MS) };
}
