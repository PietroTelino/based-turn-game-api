import { randomUUID } from 'node:crypto';
import type { RoomRecord, RoomStore } from '../room.types';

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
            draftId: null,
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
            draftId: null,
            status: 'selecting',
        });
    }

    async setDraft(id: string, guestId: string, draftId: string): Promise<boolean> {
        return this.update(id, (room) => room.status === 'selecting' && room.guestId === guestId && room.draftId === null, { draftId });
    }

    async removeGuest(id: string, guestId: string): Promise<void> {
        this.update(id, (room) => room.status === 'selecting' && room.guestId === guestId, {
            guestId: null,
            guestName: null,
            draftId: null,
            status: 'waiting',
        });
    }

    async setStarted(id: string, battleId: string): Promise<void> {
        this.update(id, (room) => room.status === 'selecting' || room.status === 'starting', { status: 'started', battleId });
    }

    async close(id: string): Promise<void> {
        this.update(id, (room) => room.status === 'waiting' || room.status === 'selecting', { status: 'closed' });
    }
}
