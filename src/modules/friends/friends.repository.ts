import { prisma } from '../../prisma';
import type { FriendLink, FriendshipStatus, FriendsStore, InviteRecord, PlayerRef } from './friends.service';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toLink(row: { id: string; requesterId: string; addresseeId: string; status: string }): FriendLink {
    return { id: row.id, requesterId: row.requesterId, addresseeId: row.addresseeId, status: row.status as FriendshipStatus };
}

export class FriendsRepository implements FriendsStore {
    async findUser(id: string): Promise<PlayerRef | null> {
        if (!UUID_PATTERN.test(id)) return null;

        return prisma.user.findFirst({ where: { id, deletedAt: null }, select: { id: true, name: true } });
    }

    async searchUsers(query: string, excludeId: string, limit: number): Promise<PlayerRef[]> {
        return prisma.user.findMany({
            where: { id: { not: excludeId }, deletedAt: null, inactivatedAt: null, name: { contains: query, mode: 'insensitive' } },
            orderBy: { name: 'asc' },
            take: limit,
            select: { id: true, name: true },
        });
    }

    async findLink(a: string, b: string): Promise<FriendLink | null> {
        if (!UUID_PATTERN.test(a) || !UUID_PATTERN.test(b)) return null;

        const row = await prisma.friendship.findFirst({
            where: { OR: [{ requesterId: a, addresseeId: b }, { requesterId: b, addresseeId: a }] },
        });

        return row ? toLink(row) : null;
    }

    async findLinkById(id: string): Promise<FriendLink | null> {
        if (!UUID_PATTERN.test(id)) return null;

        const row = await prisma.friendship.findUnique({ where: { id } });

        return row ? toLink(row) : null;
    }

    async createRequest(requesterId: string, addresseeId: string): Promise<FriendLink> {
        return toLink(await prisma.friendship.create({ data: { requesterId, addresseeId } }));
    }

    async accept(id: string): Promise<void> {
        await prisma.friendship.update({ where: { id }, data: { status: 'accepted' } });
    }

    async remove(id: string): Promise<void> {
        await prisma.friendship.deleteMany({ where: { id } });
    }

    async listLinks(userId: string) {
        const rows = await prisma.friendship.findMany({
            where: { OR: [{ requesterId: userId }, { addresseeId: userId }] },
            include: { requester: { select: { id: true, name: true, deletedAt: true } }, addressee: { select: { id: true, name: true, deletedAt: true } } },
        });

        return rows
            .map((row) => ({ ...toLink(row), other: row.requesterId === userId ? row.addressee : row.requester }))
            .filter((row) => row.other.deletedAt === null)
            .map(({ other, ...link }) => ({ ...link, other: { id: other.id, name: other.name } }));
    }

    async liveBattles(userIds: string[]): Promise<Record<string, string>> {
        if (!userIds.length) return {};

        const rows = await prisma.battle.findMany({
            where: {
                status: 'in_progress',
                OR: [{ userId: { in: userIds } }, { opponentId: { in: userIds } }],
                // O treino não tem nível nem adversário.
                AND: [{ OR: [{ difficulty: { not: null } }, { opponentId: { not: null } }] }],
            },
            orderBy: { createdAt: 'desc' },
            select: { id: true, userId: true, opponentId: true },
        });
        const live: Record<string, string> = {};

        for (const row of rows) {
            for (const id of [row.userId, row.opponentId]) {
                if (id && userIds.includes(id) && !live[id]) live[id] = row.id;
            }
        }

        return live;
    }

    async findRoom(code: string) {
        return prisma.room.findUnique({ where: { code }, select: { id: true, hostId: true, status: true } });
    }

    async upsertInvite(roomId: string, fromId: string, toId: string): Promise<void> {
        await prisma.roomInvite.upsert({
            where: { roomId_toId: { roomId, toId } },
            create: { roomId, fromId, toId },
            update: { createdAt: new Date() },
        });
    }

    async invitesFor(userId: string, since: Date): Promise<InviteRecord[]> {
        const rows = await prisma.roomInvite.findMany({
            where: { toId: userId, createdAt: { gte: since }, room: { status: 'waiting' } },
            orderBy: { createdAt: 'desc' },
            include: { room: { select: { code: true } }, from: { select: { id: true, name: true } } },
        });

        return rows.map((row) => ({ id: row.id, roomCode: row.room.code, from: row.from, createdAt: row.createdAt }));
    }

    async deleteInvite(id: string, toId: string): Promise<void> {
        if (!UUID_PATTERN.test(id)) return;

        await prisma.roomInvite.deleteMany({ where: { id, toId } });
    }
}
