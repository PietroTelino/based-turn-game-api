import { randomUUID } from 'node:crypto';
import type { BattleState } from '../../../game';
import type { BattleRecord, BattleSnapshot, BattleStore, BattleSummary } from '../battle.types';

/** Faz o mesmo papel do banco nos testes: guarda as batalhas num Map. */
export class InMemoryBattleStore implements BattleStore {
    private rows = new Map<string, BattleRecord>();

    async create(userId: string, snapshot: BattleSnapshot): Promise<BattleRecord> {
        const now = new Date();
        const record: BattleRecord = { ...copy(snapshot), id: randomUUID(), userId, createdAt: now, updatedAt: now };

        this.rows.set(record.id, record);

        return copy(record);
    }

    async findById(id: string): Promise<BattleRecord | null> {
        const record = this.rows.get(id);

        return record ? copy(record) : null;
    }

    async findManyByUser(userId: string, limit: number): Promise<BattleSummary[]> {
        return [...this.rows.values()]
            .filter((record) => record.userId === userId)
            .reverse()
            .slice(0, limit)
            .map(({ state: _state, ...summary }) => summary);
    }

    async saveIfTurn(id: string, expectedTurn: number, snapshot: BattleSnapshot): Promise<BattleRecord | null> {
        const current = this.rows.get(id);

        if (!current || current.turn !== expectedTurn) {
            return null;
        }

        const updated: BattleRecord = { ...current, ...copy(snapshot), updatedAt: new Date() };

        this.rows.set(id, updated);

        return copy(updated);
    }
}

/** Copia como o banco faria: o estado passa por JSON, igual a uma coluna Json. */
function copy<T extends { state: BattleState }>(value: T): T {
    return { ...value, state: JSON.parse(JSON.stringify(value.state)) as BattleState };
}
