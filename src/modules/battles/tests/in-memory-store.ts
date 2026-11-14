import { randomUUID } from 'node:crypto';
import type { BattleEvent, BattleState } from '../../../game';
import type { BattlePick, BattleRecord, BattleSnapshot, BattleStore, BattleSummaryRow, CampaignWin, NewBattle } from '../battle.types';

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
            difficulty: extra.difficulty ?? null,
            campaignStage: extra.campaignStage ?? null,
            towerFloor: extra.towerFloor ?? null,
            challengeDay: extra.challengeDay ?? null,
            raidWeek: extra.raidWeek ?? null,
            raidDamage: null,
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

    async setRaidDamage(id: string, damage: number) {
        this.patch(id, { raidDamage: damage });
    }

    async findRaidDamage(week: string) {
        const sum = new Map<string, number>();

        for (const record of this.rows.values()) {
            if (record.raidWeek === week && record.raidDamage) sum.set(record.userId, (sum.get(record.userId) ?? 0) + record.raidDamage);
        }

        return [...sum].map(([userId, damage]) => ({ userId, name: userId, damage })).sort((a, b) => b.damage - a.damage);
    }

    async countRaidAttempts(userId: string, week: string, since: Date) {
        return [...this.rows.values()].filter((r) => r.userId === userId && r.raidWeek === week && r.createdAt >= since).length;
    }

    async findChallengeResults(day: string) {
        const best = new Map<string, number>();

        for (const record of this.rows.values()) {
            if (record.challengeDay !== day || record.opponentId !== null || record.status !== 'finished' || record.winner !== 'A') continue;

            best.set(record.userId, Math.min(best.get(record.userId) ?? Infinity, record.turn));
        }

        return [...best].map(([userId, turns]) => ({ userId, name: userId, turns })).sort((a, b) => a.turns - b.turns || a.userId.localeCompare(b.userId));
    }

    async findTowerBest(userId: string): Promise<number> {
        let best = 0;

        for (const record of this.rows.values()) {
            if (record.userId === userId && record.towerFloor !== null && record.status === 'finished' && record.winner === 'A') {
                best = Math.max(best, record.towerFloor);
            }
        }

        return best;
    }

    async findCampaignWins(userId: string): Promise<CampaignWin[]> {
        const wins = new Map<string, CampaignWin>();

        for (const record of this.rows.values()) {
            if (record.userId !== userId || record.opponentId !== null || record.campaignStage === null) continue;
            if (record.status !== 'finished' || record.winner !== 'A') continue;

            const win = { stage: record.campaignStage, difficulty: record.difficulty ?? 'normal' };

            wins.set(`${win.stage}:${win.difficulty}`, win);
        }

        return [...wins.values()];
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
