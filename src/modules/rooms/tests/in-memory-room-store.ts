import { randomUUID } from 'node:crypto';
import type { RoomRecord, RoomRole, RoomStore } from '../room.types';

/**
 * Faz o papel do banco nos testes: guarda as salas num Map. `names` faz o
 * papel da tabela de usuários (id -> nome).
 */
export class InMemoryRoomStore implements RoomStore {
    private rows = new Map<string, RoomRecord>();

    constructor(private names: Record<string, string> = {}) {}

    private nameOf(userId: string): string {
        return this.names[userId] ?? userId;
    }

    private update(id: string, when: (room: RoomRecord) => boolean, change: Partial<RoomRecord>): boolean {
        const room = this.rows.get(id);

        if (!room || !when(room)) {
            return false;
        }

        this.rows.set(id, { ...room, ...change, updatedAt: new Date() });

        return true;
    }

    async create(hostId: string, code: string): Promise<RoomRecord | null> {
        if ([...this.rows.values()].some((room) => room.code === code)) {
            return null;
        }

        const now = new Date();
        const room: RoomRecord = {
            id: randomUUID(),
            code,
            status: 'waiting',
            hostId,
            hostName: this.nameOf(hostId),
            guestId: null,
            guestName: null,
            hostTeam: null,
            guestTeam: null,
            hostReady: false,
            guestReady: false,
            battleId: null,
            createdAt: now,
            updatedAt: now,
        };

        this.rows.set(room.id, room);

        return structuredClone(room);
    }

    async findByCode(code: string): Promise<RoomRecord | null> {
        const room = [...this.rows.values()].find((candidate) => candidate.code === code);

        return room ? structuredClone(room) : null;
    }

    async findWaiting(since: Date, limit: number): Promise<RoomRecord[]> {
        return [...this.rows.values()]
            .filter((room) => room.status === 'waiting' && room.createdAt >= since)
            .reverse()
            .slice(0, limit)
            .map((room) => structuredClone(room));
    }

    async closeOpenByHost(hostId: string): Promise<void> {
        for (const room of this.rows.values()) {
            if (room.hostId === hostId) {
                await this.close(room.id);
            }
        }
    }

    async join(id: string, guestId: string): Promise<boolean> {
        return this.update(id, (room) => room.status === 'waiting' && room.guestId === null, {
            guestId,
            guestName: this.nameOf(guestId),
            guestReady: false,
            status: 'selecting',
        });
    }

    async removeGuest(id: string, guestId: string): Promise<void> {
        this.update(id, (room) => room.status === 'selecting' && room.guestId === guestId, {
            guestId: null,
            guestName: null,
            guestReady: false,
            status: 'waiting',
        });
    }

    async setReady(id: string, role: RoomRole, team: string[]): Promise<boolean> {
        return this.update(
            id,
            (room) => room.status === 'waiting' || room.status === 'selecting',
            role === 'host' ? { hostTeam: [...team], hostReady: true } : { guestTeam: [...team], guestReady: true },
        );
    }

    async clearReady(id: string, role: RoomRole): Promise<boolean> {
        return this.update(
            id,
            (room) => room.status === 'waiting' || room.status === 'selecting',
            role === 'host' ? { hostReady: false } : { guestReady: false },
        );
    }

    async claimStart(id: string): Promise<boolean> {
        return this.update(id, (room) => room.status === 'selecting' && room.hostReady && room.guestReady, { status: 'starting' });
    }

    async releaseStart(id: string): Promise<void> {
        this.update(id, (room) => room.status === 'starting', { status: 'selecting', hostReady: false, guestReady: false });
    }

    async setStarted(id: string, battleId: string): Promise<void> {
        this.update(id, (room) => room.status === 'starting', { status: 'started', battleId });
    }

    async close(id: string): Promise<void> {
        this.update(id, (room) => room.status === 'waiting' || room.status === 'selecting', { status: 'closed' });
    }
}
