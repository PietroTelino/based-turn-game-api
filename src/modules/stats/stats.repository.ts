import { prisma } from '../../prisma';
import type { CharacterCount, StatsStore } from './stats.types';

export class StatsRepository implements StatsStore {
    async countPicks(userId?: string): Promise<CharacterCount[]> {
        const rows = await prisma.battlePick.groupBy({
            by: ['characterId'],
            ...(userId !== undefined && { where: { userId } }),
            _count: { _all: true },
        });

        return rows.map((row) => ({ characterId: row.characterId, picks: row._count._all }));
    }
}
