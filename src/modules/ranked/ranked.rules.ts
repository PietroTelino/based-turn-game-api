/**
 * As regras da ranqueada que não dependem de banco: os ranks, quantos pontos
 * uma partida vale e com quem a fila pode parear um jogador.
 */

/** Do mais baixo para o mais alto. `min` é quantos pontos o jogador precisa ter para estar no rank. */
export const RANKS = [
    { id: 'bronze', min: 0 },
    { id: 'silver', min: 100 },
    { id: 'gold', min: 200 },
    { id: 'platinum', min: 300 },
    { id: 'diamond', min: 400 },
    { id: 'legendary', min: 500 },
] as const;

export type RankId = (typeof RANKS)[number]['id'];

/** Todo jogador começa aqui: Bronze, sem pontos. */
export const STARTING_POINTS = 0;

/** O rank de quem tem `points` pontos: o mais alto cujo mínimo ele já alcançou. */
export function rankOf(points: number): RankId {
    let current: RankId = RANKS[0].id;

    for (const rank of RANKS) {
        if (points >= rank.min) current = rank.id;
    }

    return current;
}

/** O rank seguinte ao de `points` e quantos pontos ele pede. `null` para quem já é Lendário. */
export function nextRankOf(points: number): { rank: RankId; at: number } | null {
    const next = RANKS.find((rank) => rank.min > points);

    return next ? { rank: next.id, at: next.min } : null;
}

/** O mínimo de pontos do rank em que `points` está (onde a barra de progresso começa). */
export function rankFloorOf(points: number): number {
    return RANKS.find((rank) => rank.id === rankOf(points))?.min ?? 0;
}

/**
 * Quantos pontos uma partida vale, para quem venceu e para quem perdeu.
 *
 * A conta parte da chance que o vencedor tinha de ganhar, pela diferença de
 * pontos (a mesma curva do Elo, com 200 pontos de escala: 100 pontos de
 * vantagem dão 76% de chance). Ganhar de alguém mais forte vale mais; ganhar
 * de alguém mais fraco vale menos, e perder para ele custa mais.
 *
 * Entre dois jogadores iguais são +16 para quem vence e -12 para quem perde.
 * A vitória vale um pouco mais que a derrota custa, de propósito: quem joga
 * sobe aos poucos mesmo ganhando só metade das partidas. Ninguém fica com
 * menos de zero (quem aplica esse piso é quem lança o resultado).
 */
export function ratingChange(winnerPoints: number, loserPoints: number): { gain: number; loss: number } {
    const winnerChance = 1 / (1 + 10 ** ((loserPoints - winnerPoints) / RATING_SCALE));
    const surprise = 1 - winnerChance;

    return {
        gain: clamp(Math.round(MAX_GAIN * surprise), MIN_GAIN, MAX_GAIN),
        loss: clamp(Math.round(MAX_LOSS * surprise), MIN_LOSS, MAX_LOSS),
    };
}

const RATING_SCALE = 200;
const MAX_GAIN = 32;
const MIN_GAIN = 6;
const MAX_LOSS = 24;
const MIN_LOSS = 4;

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

/**
 * Até quantos pontos de diferença a fila aceita entre dois jogadores, conforme
 * o tempo que um deles já esperou. Começa em um rank de distância e abre 100
 * pontos a cada 5 segundos; depois de 20 segundos, aceita qualquer um, para
 * ninguém ficar esperando para sempre quando há pouca gente na fila.
 */
export function searchWindow(waitedMs: number): number {
    if (waitedMs >= ANYONE_AFTER_MS) return Number.POSITIVE_INFINITY;

    return 100 + 100 * Math.floor(Math.max(0, waitedMs) / WIDEN_EVERY_MS);
}

const WIDEN_EVERY_MS = 5_000;
const ANYONE_AFTER_MS = 20_000;
