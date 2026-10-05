import { prisma } from '../../prisma';
import type { RankedTicket as TicketRow } from '../../generated/prisma/client';
import type { RankedResult, RankedSettlement, RankedStanding, RankedStore, RankedTicket, TicketStatus } from './ranked.types';

function toTicket(row: TicketRow): RankedTicket {
    return {
        id: row.id,
        userId: row.userId,
        // A coluna é Json: o Prisma devolve a lista de ids como foi gravada.
        team: row.team as string[],
        rating: row.rating,
        status: row.status as TicketStatus,
        battleId: row.battleId,
        queuedAt: row.queuedAt,
        lastSeenAt: row.lastSeenAt,
        updatedAt: row.updatedAt,
    };
}

/**
 * As mudanças de estado dos bilhetes usam updateMany com a condição no
 * "where", como nas salas: é a trava. Se duas requisições chegarem juntas, só
 * a primeira encontra a linha no estado esperado; a outra não altera nada.
 */
export class RankedRepository implements RankedStore {
    async findStanding(userId: string): Promise<RankedStanding | null> {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { rating: true, rankedWins: true, rankedLosses: true },
        });

        return user ? { rating: user.rating, wins: user.rankedWins, losses: user.rankedLosses } : null;
    }

    async findTicket(userId: string): Promise<RankedTicket | null> {
        const row = await prisma.rankedTicket.findUnique({ where: { userId } });

        return row ? toTicket(row) : null;
    }

    async enqueue(userId: string, team: string[], rating: number, now: Date): Promise<RankedTicket> {
        const fresh = { team, rating, status: 'searching', battleId: null, queuedAt: now, lastSeenAt: now };
        // Um bilhete por jogador (userId é único): entrar de novo reaproveita o mesmo.
        const row = await prisma.rankedTicket.upsert({
            where: { userId },
            create: { userId, ...fresh },
            update: fresh,
        });

        return toTicket(row);
    }

    async touch(ticketId: string, now: Date): Promise<void> {
        await prisma.rankedTicket.updateMany({ where: { id: ticketId }, data: { lastSeenAt: now } });
    }

    async findSearching(seenSince: Date, limit: number): Promise<RankedTicket[]> {
        const rows = await prisma.rankedTicket.findMany({
            where: { status: 'searching', lastSeenAt: { gte: seenSince } },
            orderBy: { queuedAt: 'asc' },
            take: limit,
        });

        return rows.map(toTicket);
    }

    async claim(ticketId: string): Promise<boolean> {
        const { count } = await prisma.rankedTicket.updateMany({
            where: { id: ticketId, status: 'searching' },
            data: { status: 'matching' },
        });

        return count === 1;
    }

    async release(ticketId: string): Promise<void> {
        await prisma.rankedTicket.updateMany({
            where: { id: ticketId, status: 'matching' },
            data: { status: 'searching' },
        });
    }

    async setMatched(ticketIds: string[], battleId: string): Promise<void> {
        await prisma.rankedTicket.updateMany({
            where: { id: { in: ticketIds }, status: 'matching' },
            data: { status: 'matched', battleId },
        });
    }

    async cancel(userId: string): Promise<boolean> {
        const { count } = await prisma.rankedTicket.updateMany({
            where: { userId, status: 'searching' },
            data: { status: 'cancelled' },
        });

        return count === 1;
    }

    async settle(result: RankedResult, change: (winnerPoints: number, loserPoints: number) => { gain: number; loss: number }): Promise<RankedSettlement | null> {
        // Tudo numa transação: ou o resultado é lançado inteiro (a marca na
        // batalha e os pontos dos dois), ou nada muda.
        return prisma.$transaction(async (tx) => {
            const [winner, loser] = await Promise.all([
                tx.user.findUnique({ where: { id: result.winnerId }, select: { rating: true } }),
                tx.user.findUnique({ where: { id: result.loserId }, select: { rating: true } }),
            ]);

            if (!winner || !loser) {
                return null;
            }

            const { gain, loss } = change(winner.rating, loser.rating);
            // Ninguém fica com menos de zero: a derrota custa no máximo o que o jogador tem.
            const lost = Math.min(loss, loser.rating);

            // A trava: só marca a batalha que é ranqueada e ainda não tem o
            // resultado lançado. Se outra requisição chegou antes, count é 0.
            const { count } = await tx.battle.updateMany({
                where: { id: result.battleId, ranked: true, ratingDeltaA: null },
                data: result.winnerTeam === 'A' ? { ratingDeltaA: gain, ratingDeltaB: 0 - lost } : { ratingDeltaA: 0 - lost, ratingDeltaB: gain },
            });

            if (count === 0) {
                return null;
            }

            await tx.user.update({ where: { id: result.winnerId }, data: { rating: { increment: gain }, rankedWins: { increment: 1 } } });
            await tx.user.update({ where: { id: result.loserId }, data: { rating: { decrement: lost }, rankedLosses: { increment: 1 } } });

            return {
                winner: { before: winner.rating, after: winner.rating + gain },
                loser: { before: loser.rating, after: loser.rating - lost },
            };
        });
    }
}
