import { prisma } from '../../prisma';
import type { Prisma, RankedDraft as DraftRow, RankedTicket as TicketRow } from '../../generated/prisma/client';
import type { DraftAction } from './ranked.draft';
import type { DraftChange, DraftStatus, RankedDraft, RankedResult, RankedSettlement, RankedStanding, RankedStore, RankedTicket, TicketStatus } from './ranked.types';
import type { RankId } from './ranked.rules';
import type { SeasonResult } from './ranked.season';

function toTicket(row: TicketRow): RankedTicket {
    return {
        id: row.id,
        userId: row.userId,
        rating: row.rating,
        status: row.status as TicketStatus,
        draftId: row.draftId,
        battleId: row.battleId,
        queuedAt: row.queuedAt,
        lastSeenAt: row.lastSeenAt,
        updatedAt: row.updatedAt,
    };
}

function toDraft(row: DraftRow): RankedDraft {
    return {
        id: row.id,
        hostId: row.hostId,
        guestId: row.guestId,
        ranked: row.ranked,
        // A coluna é Json: o Prisma devolve a lista como foi gravada.
        actions: row.actions as unknown as DraftAction[],
        status: row.status as DraftStatus,
        battleId: row.battleId,
        turnStartedAt: row.turnStartedAt,
        version: row.version,
        createdAt: row.createdAt,
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
            select: { rating: true, rankedWins: true, rankedLosses: true, rankedSeason: true },
        });

        return user ? { rating: user.rating, wins: user.rankedWins, losses: user.rankedLosses, season: user.rankedSeason } : null;
    }

    async rollSeason(userId: string, from: string | null, to: string, next: { rating: number; wins: number; losses: number }, result: SeasonResult | null): Promise<boolean> {
        return prisma.$transaction(async (tx) => {
            const { count } = await tx.user.updateMany({
                where: { id: userId, rankedSeason: from },
                data: { rankedSeason: to, rating: next.rating, rankedWins: next.wins, rankedLosses: next.losses },
            });

            if (count === 0) return false;

            if (result) {
                const created = await tx.rankedSeasonResult.createMany({ data: [{ userId, ...result }], skipDuplicates: true });

                if (created.count) {
                    await tx.user.update({ where: { id: userId }, data: { gold: { increment: result.gold }, diamonds: { increment: result.diamonds } } });
                }
            }

            return true;
        });
    }

    async lastSeasonResult(userId: string): Promise<SeasonResult | null> {
        const row = await prisma.rankedSeasonResult.findFirst({ where: { userId }, orderBy: { season: 'desc' } });

        return row ? { season: row.season, rating: row.rating, rank: row.rank as RankId, wins: row.wins, losses: row.losses, gold: row.gold, diamonds: row.diamonds } : null;
    }

    async leaderboard(season: string, limit: number) {
        const rows = await prisma.user.findMany({
            where: { rankedSeason: season, deletedAt: null, OR: [{ rankedWins: { gt: 0 } }, { rankedLosses: { gt: 0 } }] },
            orderBy: [{ rating: 'desc' }, { rankedWins: 'desc' }, { name: 'asc' }],
            take: limit,
            select: { id: true, name: true, rating: true, rankedWins: true, rankedLosses: true },
        });

        return rows.map((row) => ({ userId: row.id, name: row.name, rating: row.rating, wins: row.rankedWins, losses: row.rankedLosses }));
    }

    async countAbove(season: string, rating: number): Promise<number> {
        return prisma.user.count({
            where: { rankedSeason: season, deletedAt: null, rating: { gt: rating }, OR: [{ rankedWins: { gt: 0 } }, { rankedLosses: { gt: 0 } }] },
        });
    }

    async findTicket(userId: string): Promise<RankedTicket | null> {
        const row = await prisma.rankedTicket.findUnique({ where: { userId } });

        return row ? toTicket(row) : null;
    }

    async enqueue(userId: string, rating: number, now: Date): Promise<RankedTicket> {
        // O time é montado depois, na seleção de personagens: a coluna `team` (de antes dela) fica vazia.
        const fresh = { team: [], rating, status: 'searching', draftId: null, battleId: null, queuedAt: now, lastSeenAt: now };
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

    async setMatched(ticketIds: string[], draftId: string): Promise<void> {
        await prisma.rankedTicket.updateMany({
            where: { id: { in: ticketIds }, status: 'matching' },
            data: { status: 'matched', draftId, battleId: null },
        });
    }

    async createDraft(hostId: string, guestId: string, now: Date, ranked = true): Promise<RankedDraft> {
        const row = await prisma.rankedDraft.create({ data: { hostId, guestId, ranked, actions: [], turnStartedAt: now } });

        return toDraft(row);
    }

    async findDraft(id: string): Promise<RankedDraft | null> {
        const row = await prisma.rankedDraft.findUnique({ where: { id } });

        return row ? toDraft(row) : null;
    }

    async saveDraft(id: string, expectedVersion: number, change: DraftChange): Promise<RankedDraft | null> {
        // O "where" com a versão é a trava: se outra requisição gravou antes, count é 0.
        const { count } = await prisma.rankedDraft.updateMany({
            where: { id, version: expectedVersion },
            data: {
                ...(change.actions && { actions: change.actions as unknown as Prisma.InputJsonValue }),
                ...(change.status && { status: change.status }),
                ...(change.battleId !== undefined && { battleId: change.battleId }),
                ...(change.turnStartedAt && { turnStartedAt: change.turnStartedAt }),
                version: { increment: 1 },
            },
        });

        return count === 1 ? this.findDraft(id) : null;
    }

    async findNames(userIds: string[]): Promise<Record<string, string>> {
        const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });

        return Object.fromEntries(users.map((user) => [user.id, user.name]));
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
