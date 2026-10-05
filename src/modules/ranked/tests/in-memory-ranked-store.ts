import { randomUUID } from 'node:crypto';
import type { InMemoryBattleStore } from '../../battles/tests/in-memory-store';
import type { RankedResult, RankedSettlement, RankedStanding, RankedStore, RankedTicket } from '../ranked.types';

/**
 * Faz o papel do banco nos testes: os bilhetes da fila num Map e os pontos de
 * cada jogador noutro (a tabela de usuários). O resultado de uma partida é
 * marcado na batalha, então ele recebe o "banco" de batalhas em memória.
 */
export class InMemoryRankedStore implements RankedStore {
    private tickets = new Map<string, RankedTicket>();
    private standings = new Map<string, RankedStanding>();

    constructor(
        private battles: InMemoryBattleStore,
        /** Os jogadores que existem. Quem não está aqui "não foi encontrado". */
        players: string[] = [],
        private now: () => Date = () => new Date(),
    ) {
        for (const id of players) this.standings.set(id, { rating: 0, wins: 0, losses: 0 });
    }

    /** Só para os testes: define os pontos de um jogador. */
    setRating(userId: string, rating: number): void {
        this.standings.set(userId, { ...(this.standings.get(userId) ?? { wins: 0, losses: 0 }), rating });
    }

    private update(id: string, when: (ticket: RankedTicket) => boolean, change: Partial<RankedTicket>): boolean {
        const ticket = this.tickets.get(id);

        if (!ticket || !when(ticket)) {
            return false;
        }

        this.tickets.set(id, { ...ticket, ...change, updatedAt: this.now() });

        return true;
    }

    async findStanding(userId: string): Promise<RankedStanding | null> {
        const standing = this.standings.get(userId);

        return standing ? { ...standing } : null;
    }

    async findTicket(userId: string): Promise<RankedTicket | null> {
        const ticket = [...this.tickets.values()].find((item) => item.userId === userId);

        return ticket ? { ...ticket, team: [...ticket.team] } : null;
    }

    async enqueue(userId: string, team: string[], rating: number, now: Date): Promise<RankedTicket> {
        const existing = [...this.tickets.values()].find((item) => item.userId === userId);
        const ticket: RankedTicket = {
            id: existing?.id ?? randomUUID(),
            userId,
            team: [...team],
            rating,
            status: 'searching',
            battleId: null,
            queuedAt: now,
            lastSeenAt: now,
            updatedAt: now,
        };

        this.tickets.set(ticket.id, ticket);

        return { ...ticket, team: [...team] };
    }

    async touch(ticketId: string, now: Date): Promise<void> {
        this.update(ticketId, () => true, { lastSeenAt: now });
    }

    async findSearching(seenSince: Date, limit: number): Promise<RankedTicket[]> {
        return [...this.tickets.values()]
            .filter((ticket) => ticket.status === 'searching' && ticket.lastSeenAt.getTime() >= seenSince.getTime())
            .sort((a, b) => a.queuedAt.getTime() - b.queuedAt.getTime())
            .slice(0, limit)
            .map((ticket) => ({ ...ticket, team: [...ticket.team] }));
    }

    async claim(ticketId: string): Promise<boolean> {
        return this.update(ticketId, (ticket) => ticket.status === 'searching', { status: 'matching' });
    }

    async release(ticketId: string): Promise<void> {
        this.update(ticketId, (ticket) => ticket.status === 'matching', { status: 'searching' });
    }

    async setMatched(ticketIds: string[], battleId: string): Promise<void> {
        for (const id of ticketIds) {
            this.update(id, (ticket) => ticket.status === 'matching', { status: 'matched', battleId });
        }
    }

    async cancel(userId: string): Promise<boolean> {
        const ticket = [...this.tickets.values()].find((item) => item.userId === userId);

        return ticket ? this.update(ticket.id, (item) => item.status === 'searching', { status: 'cancelled' }) : false;
    }

    async settle(result: RankedResult, change: (winnerPoints: number, loserPoints: number) => { gain: number; loss: number }): Promise<RankedSettlement | null> {
        const battle = await this.battles.findById(result.battleId);
        const winner = this.standings.get(result.winnerId);
        const loser = this.standings.get(result.loserId);

        if (!battle || !battle.ranked || battle.ratingDeltaA !== null || !winner || !loser) {
            return null;
        }

        const { gain, loss } = change(winner.rating, loser.rating);
        // Ninguém fica com menos de zero: a derrota custa no máximo o que o jogador tem.
        const lost = Math.min(loss, loser.rating);
        const settlement: RankedSettlement = {
            winner: { before: winner.rating, after: winner.rating + gain },
            loser: { before: loser.rating, after: loser.rating - lost },
        };

        this.battles.patch(result.battleId, result.winnerTeam === 'A' ? { ratingDeltaA: gain, ratingDeltaB: 0 - lost } : { ratingDeltaA: 0 - lost, ratingDeltaB: gain });
        this.standings.set(result.winnerId, { ...winner, rating: settlement.winner.after, wins: winner.wins + 1 });
        this.standings.set(result.loserId, { ...loser, rating: settlement.loser.after, losses: loser.losses + 1 });

        return settlement;
    }
}
