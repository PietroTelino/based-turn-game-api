import { randomUUID } from 'node:crypto';
import type { BattleEvent, BattleState } from '../../../game';
import type { BattlePick, BattleRecord, BattleSnapshot, BattleStore, BattleSummaryRow, NewBattle } from '../battle.types';

/** Um personagem escolhido, como fica na tabela de escolhas. */
export interface StoredPick extends BattlePick {
    battleId: string;
}

/**
 * Faz o mesmo papel do banco nos testes: guarda as batalhas num Map. `now` é o
 * relógio (os testes de prazo trocam). `picks` e `initialStates` ficam à vista
 * porque outros "bancos" em memória (estatísticas, ranqueada) leem daqui, como
 * no banco de verdade as tabelas se enxergam.
 */
export class InMemoryBattleStore implements BattleStore {
    private rows = new Map<string, BattleRecord>();
    picks: StoredPick[] = [];
    initialStates = new Map<string, BattleState>();

    constructor(private now: () => Date = () => new Date()) {}

    async create(userId: string, snapshot: BattleSnapshot, extra: NewBattle): Promise<BattleRecord> {
        const now = this.now();
        const record: BattleRecord = {
            ...copy(snapshot),
            id: randomUUID(),
            userId,
            opponentId: extra.opponentId ?? null,
            events: asJson(extra.events),
            hasReplay: true,
            ranked: extra.ranked === true,
            ratingDeltaA: null,
            ratingDeltaB: null,
            createdAt: now,
            updatedAt: now,
        };

        this.rows.set(record.id, record);
        this.initialStates.set(record.id, asJson(extra.initialState));
        this.picks.push(...extra.picks.map((pick) => ({ ...pick, battleId: record.id })));

        return copy(record);
    }

    async findById(id: string): Promise<BattleRecord | null> {
        const record = this.rows.get(id);

        return record ? copy(record) : null;
    }

    async findInitialState(id: string): Promise<BattleState | null> {
        const state = this.initialStates.get(id);

        return state ? asJson(state) : null;
    }

    async findManyByUser(userId: string, limit: number): Promise<BattleSummaryRow[]> {
        return [...this.rows.values()]
            .filter((record) => record.userId === userId || record.opponentId === userId)
            .reverse()
            .slice(0, limit)
            .map(({ state: _state, events: _events, ...summary }) => summary);
    }

    async saveIfStep(id: string, expectedStep: number, snapshot: BattleSnapshot, events: BattleEvent[]): Promise<BattleRecord | null> {
        const current = this.rows.get(id);

        if (!current || current.step !== expectedStep || current.status !== 'in_progress') {
            return null;
        }

        const updated: BattleRecord = {
            ...current,
            ...copy(snapshot),
            events: asJson(events),
            updatedAt: this.now(),
        };

        this.rows.set(id, updated);

        return copy(updated);
    }

    /** Só para os testes e para a ranqueada em memória: mexe direto numa batalha guardada. */
    patch(id: string, change: Partial<BattleRecord>): void {
        const current = this.rows.get(id);

        if (current) this.rows.set(id, { ...current, ...change });
    }
}

function asJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

/** Copia como o banco faria: o estado e o histórico passam por JSON, igual a uma coluna Json. */
function copy<T extends { state: BattleState; events?: BattleEvent[] }>(value: T): T {
    return { ...value, state: asJson(value.state), ...(value.events && { events: asJson(value.events) }) };
}
