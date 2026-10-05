import { prisma } from '../../prisma';
import type { Battle, Prisma } from '../../generated/prisma/client';
import type { BattleEvent, BattleState, TeamId } from '../../game';
import type { BattleRecord, BattleSnapshot, BattleStatus, BattleStore, BattleSummaryRow, NewBattle } from './battle.types';

/** Tudo menos os estados e o histórico, que são grandes e a listagem não usa. */
const SUMMARY_FIELDS = {
    id: true,
    userId: true,
    opponentId: true,
    status: true,
    winner: true,
    turn: true,
    step: true,
    hasReplay: true,
    ranked: true,
    ratingDeltaA: true,
    ratingDeltaB: true,
    createdAt: true,
    updatedAt: true,
    finishedAt: true,
} as const;

/** A batalha inteira menos o estado inicial, que só o replay usa. */
const RECORD_FIELDS = { ...SUMMARY_FIELDS, state: true, events: true } as const;

type SummaryRow = Omit<Battle, 'state' | 'events' | 'initialState'>;
type RecordRow = Omit<Battle, 'initialState'>;

function toSummary(row: SummaryRow): BattleSummaryRow {
    return {
        id: row.id,
        userId: row.userId,
        opponentId: row.opponentId,
        status: row.status as BattleStatus,
        winner: row.winner as TeamId | null,
        turn: row.turn,
        step: row.step,
        hasReplay: row.hasReplay,
        ranked: row.ranked,
        ratingDeltaA: row.ratingDeltaA,
        ratingDeltaB: row.ratingDeltaB,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        finishedAt: row.finishedAt,
    };
}

function toRecord(row: RecordRow): BattleRecord {
    // As colunas são Json: o Prisma devolve objetos comuns, que são exatamente
    // o BattleState e a lista de eventos.
    return {
        ...toSummary(row),
        state: row.state as unknown as BattleState,
        events: (row.events ?? []) as unknown as BattleEvent[],
    };
}

function toJson(value: unknown): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
}

function toData(snapshot: BattleSnapshot) {
    return {
        status: snapshot.status,
        winner: snapshot.winner,
        turn: snapshot.turn,
        step: snapshot.step,
        state: toJson(snapshot.state),
        finishedAt: snapshot.finishedAt,
    };
}

export class BattleRepository implements BattleStore {
    async create(userId: string, snapshot: BattleSnapshot, extra: NewBattle): Promise<BattleRecord> {
        const row = await prisma.battle.create({
            data: {
                userId,
                ...toData(snapshot),
                ...(extra.opponentId !== undefined && { opponentId: extra.opponentId }),
                events: toJson(extra.events),
                initialState: toJson(extra.initialState),
                hasReplay: true,
                ranked: extra.ranked === true,
                // Os personagens escolhidos entram junto com a batalha, na mesma gravação.
                picks: { create: extra.picks.map((pick) => ({ userId: pick.userId, characterId: pick.characterId })) },
            },
            select: RECORD_FIELDS,
        });

        return toRecord(row);
    }

    async findById(id: string): Promise<BattleRecord | null> {
        const row = await prisma.battle.findUnique({ where: { id }, select: RECORD_FIELDS });

        return row ? toRecord(row) : null;
    }

    async findInitialState(id: string): Promise<BattleState | null> {
        const row = await prisma.battle.findUnique({ where: { id }, select: { initialState: true } });

        return (row?.initialState ?? null) as unknown as BattleState | null;
    }

    async findManyByUser(userId: string, limit: number): Promise<BattleSummaryRow[]> {
        const rows = await prisma.battle.findMany({
            where: { OR: [{ userId }, { opponentId: userId }] },
            orderBy: { createdAt: 'desc' },
            take: limit,
            select: SUMMARY_FIELDS,
        });

        return rows.map(toSummary);
    }

    async saveIfStep(id: string, expectedStep: number, snapshot: BattleSnapshot, events: BattleEvent[]): Promise<BattleRecord | null> {
        // O "where" é a trava: se duas requisições chegarem juntas, só a
        // primeira encontra a linha ainda na vez esperada. E uma batalha
        // terminada (por desistência, por exemplo) nunca é regravada.
        const { count } = await prisma.battle.updateMany({
            where: { id, step: expectedStep, status: 'in_progress' },
            data: { ...toData(snapshot), events: toJson(events) },
        });

        if (count === 0) {
            return null;
        }

        return this.findById(id);
    }
}
