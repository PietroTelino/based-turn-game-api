import { prisma } from '../../prisma';
import type { Room } from '../../generated/prisma/client';
import type { RoomRecord, RoomRole, RoomStatus, RoomStore } from './room.types';

/** Junto com a sala vêm os nomes dos dois jogadores, para mostrar na tela. */
const WITH_NAMES = {
    host: { select: { name: true } },
    guest: { select: { name: true } },
} as const;

type RoomRow = Room & { host: { name: string }; guest: { name: string } | null };

/** Estados em que a batalha ainda não começou e a sala aceita mudanças. */
const OPEN_STATUSES = ['waiting', 'selecting'];

function toRecord(row: RoomRow): RoomRecord {
    return {
        id: row.id,
        code: row.code,
        status: row.status as RoomStatus,
        hostId: row.hostId,
        hostName: row.host.name,
        guestId: row.guestId,
        guestName: row.guest?.name ?? null,
        // As colunas são Json: o Prisma devolve a lista de ids como foi gravada.
        hostTeam: row.hostTeam as string[] | null,
        guestTeam: row.guestTeam as string[] | null,
        hostReady: row.hostReady,
        guestReady: row.guestReady,
        battleId: row.battleId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

/**
 * Todas as mudanças usam updateMany com a condição no "where": é a trava. Se
 * duas requisições chegarem juntas, só a primeira encontra a linha no estado
 * esperado; a outra não altera nada (count 0).
 */
export class RoomRepository implements RoomStore {
    async create(hostId: string, code: string): Promise<RoomRecord | null> {
        // O código é único no banco. Conferir antes evita o erro na maioria dos
        // casos; se duas salas pedirem o mesmo código no mesmo instante, a
        // segunda falha no create e a requisição responde erro.
        if (await prisma.room.findUnique({ where: { code }, select: { id: true } })) {
            return null;
        }

        const row = await prisma.room.create({ data: { hostId, code }, include: WITH_NAMES });

        return toRecord(row);
    }

    async findByCode(code: string): Promise<RoomRecord | null> {
        const row = await prisma.room.findUnique({ where: { code }, include: WITH_NAMES });

        return row ? toRecord(row) : null;
    }

    async findWaiting(since: Date, limit: number): Promise<RoomRecord[]> {
        const rows = await prisma.room.findMany({
            where: { status: 'waiting', createdAt: { gte: since } },
            orderBy: { createdAt: 'desc' },
            take: limit,
            include: WITH_NAMES,
        });

        return rows.map(toRecord);
    }

    async closeOpenByHost(hostId: string): Promise<void> {
        await prisma.room.updateMany({
            where: { hostId, status: { in: OPEN_STATUSES } },
            data: { status: 'closed' },
        });
    }

    async join(id: string, guestId: string): Promise<boolean> {
        const { count } = await prisma.room.updateMany({
            where: { id, status: 'waiting', guestId: null },
            data: { guestId, guestReady: false, status: 'selecting' },
        });

        return count === 1;
    }

    async removeGuest(id: string, guestId: string): Promise<void> {
        await prisma.room.updateMany({
            where: { id, guestId, status: 'selecting' },
            data: { guestId: null, guestReady: false, status: 'waiting' },
        });
    }

    async setReady(id: string, role: RoomRole, team: string[]): Promise<boolean> {
        const { count } = await prisma.room.updateMany({
            where: { id, status: { in: OPEN_STATUSES } },
            data: role === 'host' ? { hostTeam: team, hostReady: true } : { guestTeam: team, guestReady: true },
        });

        return count === 1;
    }

    async clearReady(id: string, role: RoomRole): Promise<boolean> {
        const { count } = await prisma.room.updateMany({
            where: { id, status: { in: OPEN_STATUSES } },
            data: role === 'host' ? { hostReady: false } : { guestReady: false },
        });

        return count === 1;
    }

    async claimStart(id: string): Promise<boolean> {
        const { count } = await prisma.room.updateMany({
            where: { id, status: 'selecting', hostReady: true, guestReady: true },
            data: { status: 'starting' },
        });

        return count === 1;
    }

    async releaseStart(id: string): Promise<void> {
        await prisma.room.updateMany({
            where: { id, status: 'starting' },
            data: { status: 'selecting', hostReady: false, guestReady: false },
        });
    }

    async setStarted(id: string, battleId: string): Promise<void> {
        await prisma.room.updateMany({
            where: { id, status: 'starting' },
            data: { status: 'started', battleId },
        });
    }

    async close(id: string): Promise<void> {
        await prisma.room.updateMany({
            where: { id, status: { in: OPEN_STATUSES } },
            data: { status: 'closed' },
        });
    }
}
