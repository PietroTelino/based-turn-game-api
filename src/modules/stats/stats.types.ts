/** Quantas vezes um personagem foi escolhido. */
export interface CharacterCount {
    characterId: string;
    picks: number;
}

/**
 * Onde as escolhas de personagens ficam guardadas (a tabela battle_picks, que
 * o módulo de batalhas preenche ao criar cada batalha). Em produção é o Prisma
 * (stats.repository.ts); nos testes, um objeto em memória.
 */
export interface StatsStore {
    /** Quantas vezes cada personagem foi escolhido: por um jogador, ou por todos quando `userId` não é informado. */
    countPicks(userId?: string): Promise<CharacterCount[]>;
}

/** Um personagem numa lista de mais usados. */
export interface CharacterUsage {
    characterId: string;
    /** Em quantos times o personagem entrou. */
    picks: number;
    /** A fração dos times em que ele entrou (0.4 = 40% dos times). */
    share: number;
}

/** Uma lista de personagens mais usados, do mais para o menos usado. */
export interface UsageRanking {
    /** Quantos times foram montados no total (um por jogador por batalha). */
    teams: number;
    characters: CharacterUsage[];
}

export interface CharacterStats {
    /** Os personagens que o próprio jogador mais usou. */
    mine: UsageRanking;
    /** Os mais usados do jogo todo. São só as contagens: nenhum jogador é identificado. */
    global: UsageRanking;
}
