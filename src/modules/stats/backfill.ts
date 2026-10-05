/**
 * Preenche as estatísticas de personagens mais usados com as batalhas que já
 * existiam antes de a tabela de escolhas ser criada.
 *
 *   npm run stats:backfill
 *
 * Pode rodar mais de uma vez: batalha que já tem escolhas gravadas é pulada.
 * As batalhas novas não precisam disto (gravam as escolhas ao serem criadas).
 */
import { prisma } from '../../prisma';
import type { BattleState } from '../../game';
import { picksFromState } from './picks-from-state';

const PAGE_SIZE = 100;

async function main() {
    let cursor: string | undefined;
    let battles = 0;
    let picks = 0;

    for (;;) {
        const page = await prisma.battle.findMany({
            orderBy: { id: 'asc' },
            take: PAGE_SIZE,
            ...(cursor !== undefined && { cursor: { id: cursor }, skip: 1 }),
            select: { id: true, userId: true, opponentId: true, state: true, _count: { select: { picks: true } } },
        });

        if (page.length === 0) break;

        for (const battle of page) {
            if (battle._count.picks > 0) continue;

            const found = picksFromState({ userId: battle.userId, opponentId: battle.opponentId, state: battle.state as unknown as BattleState });

            if (found.length === 0) continue;

            await prisma.battlePick.createMany({ data: found.map((pick) => ({ battleId: battle.id, userId: pick.userId, characterId: pick.characterId })) });
            battles += 1;
            picks += found.length;
        }

        cursor = page[page.length - 1]?.id;
    }

    console.log(`Estatísticas preenchidas: ${picks} escolhas de ${battles} batalhas antigas.`);
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
