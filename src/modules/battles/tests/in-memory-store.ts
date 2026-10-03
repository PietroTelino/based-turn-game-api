import { randomUUID } from 'node:crypto';
import type { BattleEvent, BattleState } from '../../../game';
import type { BattleRecord, BattleSnapshot, BattleStore, BattleSummaryRow } from '../battle.types';

/** Faz o mesmo papel do banco nos testes: guarda as batalhas num Map. */
export class InMemoryBattleStore implements BattleStore {
    private rows = new Map<string, BattleRecord>();

    async create(userId: string, snapshot: BattleSnapshot, versus?: { opponentId: string; events: BattleEvent[] }): Promise<BattleRecord> {
        const now = new Date();
        const record: BattleRecord = {
            ...copy(snapshot),
            id: randomUUID(),
            userId,
            opponentId: versus?.opponentId ?? null,
            events: asJson(versus?.events ?? []),
            createdAt: now,
            updatedAt: now,
        };

        this.rows.set(record.id, record);

        return copy(record);
    }

    async findById(id: string): Promise<BattleRecord | null> {
        const record = this.rows.get(id);

        return record ? copy(record) : null;
    }

    async findManyByUser(userId: string, limit: number): Promise<BattleSummaryRow[]> {
        return [...this.rows.values()]
            .filter((record) => record.userId === userId || record.opponentId === userId)
            .reverse()
            .slice(0, limit)
            .map(({ state: _state, events: _events, ...summary }) => summary);
    }

    async saveIfStep(id: string, expectedStep: number, snapshot: BattleSnapshot, events?: BattleEvent[]): Promise<BattleRecord | null> {
        const current = this.rows.get(id);

        if (!current || current.step !== expectedStep || current.status !== 'in_progress') {
            return null;
        }

        const updated: BattleRecord = {
            ...current,
            ...copy(snapshot),
            ...(events && { events: asJson(events) }),
            updatedAt: new Date(),
        };

        this.rows.set(id, updated);

        return copy(updated);
    }
}

function asJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

/** Copia como o banco faria: o estado e o histórico passam por JSON, igual a uma coluna Json. */
function copy<T extends { state: BattleState; events?: BattleEvent[] }>(value: T): T {
    return { ...value, state: asJson(value.state), ...(value.events && { events: asJson(value.events) }) };
}
