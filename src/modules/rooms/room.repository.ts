import { prisma } from '../../prisma';
import type { Room } from '../../generated/prisma/client';
import type { RoomRecord, RoomStatus, RoomStore } from './room.types';

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
        draftId: row.draftId,
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
            data: { guestId, draftId: null, status: 'selecting' },
        });

        return count === 1;
    }

    async setDraft(id: string, guestId: string, draftId: string): Promise<boolean> {
        const { count } = await prisma.room.updateMany({
            where: { id, guestId, status: 'selecting', draftId: null },
            data: { draftId },
        });

        return count === 1;
    }

    async removeGuest(id: string, guestId: string): Promise<void> {
        await prisma.room.updateMany({
            where: { id, guestId, status: 'selecting' },
            data: { guestId: null, draftId: null, status: 'waiting' },
        });
    }

    async setStarted(id: string, battleId: string): Promise<void> {
        await prisma.room.updateMany({
            where: { id, status: { in: ['selecting', 'starting'] } },
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
