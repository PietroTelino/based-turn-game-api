/**
 * Gerador de números aleatórios com semente (algoritmo mulberry32).
 *
 * Por que não usar Math.random()? Porque o motor precisa ser previsível:
 * mesma semente + mesmas ações = mesma batalha. Isso permite testar, repetir
 * uma partida (replay) e impede que o resultado dependa de onde o código roda.
 *
 * O "estado" é só um número inteiro, guardado dentro do BattleState.
 */
export function nextRandom(rngState: number): { value: number; rngState: number } {
    const next = (rngState + 0x6d2b79f5) >>> 0;

    let t = next;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    const value = ((t ^ (t >>> 14)) >>> 0) / 0x100000000;

    return { value, rngState: next };
}
