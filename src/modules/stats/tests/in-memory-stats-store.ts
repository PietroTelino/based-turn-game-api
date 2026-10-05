import type { InMemoryBattleStore } from '../../battles/tests/in-memory-store';
import type { CharacterCount, StatsStore } from '../stats.types';

/** Lê as escolhas do "banco" de batalhas em memória, como o repositório de verdade lê a tabela battle_picks. */
export class InMemoryStatsStore implements StatsStore {
    constructor(private battles: InMemoryBattleStore) {}

    async countPicks(userId?: string): Promise<CharacterCount[]> {
        const counts = new Map<string, number>();

        for (const pick of this.battles.picks) {
            if (userId !== undefined && pick.userId !== userId) continue;

            counts.set(pick.characterId, (counts.get(pick.characterId) ?? 0) + 1);
        }

        return [...counts].map(([characterId, picks]) => ({ characterId, picks }));
    }
}
