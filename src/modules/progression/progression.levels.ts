/**
 * Nível de conta e passe da temporada.
 *
 * Toda partida (fora o treino) dá experiência, ganhando ou perdendo. A
 * experiência total define o nível; cada nível novo paga ouro, e a cada 5
 * níveis vêm diamantes. Os títulos marcam alguns níveis.
 *
 * O passe acompanha a temporada ranqueada (um mês, UTC): a experiência ganha
 * no mês sobe os degraus do passe. A trilha gratuita é de todos; a premium é
 * comprada com diamantes e só dá recursos (nada que dê vantagem na batalha).
 */

/** Experiência de uma partida terminada. */
export function battleXp(input: { won: boolean; versus: boolean; ranked: boolean }): number {
    return (input.won ? 100 : 40) + (input.versus ? 25 : 0) + (input.ranked ? 25 : 0);
}

export const MAX_LEVEL = 100;

/** Quanta experiência o nível `level` pede para chegar ao seguinte. */
export function xpToNext(level: number): number {
    return 100 + 50 * (level - 1);
}

/** O nível de quem tem `xp` de experiência, e quanto falta para o próximo. */
export function levelOf(xp: number): { level: number; xpIntoLevel: number; xpForNext: number } {
    let level = 1;
    let rest = Math.max(0, xp);

    while (level < MAX_LEVEL && rest >= xpToNext(level)) {
        rest -= xpToNext(level);
        level += 1;
    }

    return { level, xpIntoLevel: rest, xpForNext: level < MAX_LEVEL ? xpToNext(level) : 0 };
}

/** O que alcançar o nível `level` paga. */
export function levelReward(level: number): { gold: number; diamonds: number } {
    return { gold: 50 * level, diamonds: level % 5 === 0 ? 10 : 0 };
}

/** Os títulos, pelo nível em que são ganhos (o mostrado é o mais alto alcançado). */
export const LEVEL_TITLES: readonly { level: number; id: string }[] = [
    { level: 1, id: 'recruta' },
    { level: 5, id: 'aventureiro' },
    { level: 10, id: 'veterano' },
    { level: 20, id: 'heroi' },
    { level: 30, id: 'campeao' },
    { level: 50, id: 'lenda' },
];

export function titleOf(level: number): string {
    return [...LEVEL_TITLES].reverse().find((title) => level >= title.level)!.id;
}

/** O passe da temporada. */
export const PASS_TIERS = 30;
export const PASS_XP_PER_TIER = 300;
export const PASS_PRICE_DIAMONDS = 250;

export function passReward(tier: number, track: 'free' | 'premium'): { gold: number; diamonds: number } {
    return track === 'free'
        ? { gold: 100, diamonds: tier % 5 === 0 ? 10 : 0 }
        : { gold: 250, diamonds: tier % 3 === 0 ? 15 : 0 };
}
