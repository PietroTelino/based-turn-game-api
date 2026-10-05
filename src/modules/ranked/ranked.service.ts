import type { BattleService } from '../battles/battle.service';
import type { BattleRecord } from '../battles/battle.types';
import { RankedError } from './ranked.errors';
import { nextRankOf, rankFloorOf, rankOf, ratingChange, searchWindow } from './ranked.rules';
import type { QueueView, RankedProfile, RankedStore, RankedTicket } from './ranked.types';

/**
 * Bilhete que ficou este tempo sem a tela perguntar pela fila é de quem fechou
 * a página: ninguém é pareado com ele. A tela pergunta a cada segundo e meio.
 */
const STALE_AFTER_MS = 10_000;
/** Uma reserva de pareamento dura um instante. Se passou disto, quem reservou caiu no meio: o bilhete volta à fila. */
const STUCK_AFTER_MS = 10_000;
/** Quantos bilhetes a fila olha de cada vez para achar um adversário. */
const CANDIDATE_LIMIT = 50;

/** O que a ranqueada usa do serviço de batalhas. */
type Battles = Pick<BattleService, 'createVersus' | 'validateTeam' | 'isInProgress'>;

const IDLE: QueueView = { status: 'idle', battleId: null, waitedSeconds: 0, team: null };

/**
 * Partidas ranqueadas: a fila com pareamento automático e os pontos.
 *
 * 1. O jogador escolhe o time e entra na fila (`enter`). O bilhete dele guarda
 *    o time e os pontos que ele tinha ao entrar.
 * 2. Enquanto espera, a tela pergunta pela fila (`queue`). Cada pergunta
 *    renova o bilhete e tenta parear: procura, entre quem também está
 *    esperando, o jogador com os pontos mais próximos. Quanto mais tempo de
 *    espera, maior a diferença de pontos aceita (ranked.rules.ts).
 * 3. Achou: a batalha é criada (BattleService, marcada como ranqueada) e os
 *    dois bilhetes passam a apontar para ela. A tela de cada um descobre na
 *    pergunta seguinte e vai para a batalha.
 * 4. Quando a batalha acaba, o serviço de batalhas avisa (`settle`) e os
 *    pontos dos dois são lançados.
 *
 * Não há conexão aberta com o servidor nem tarefa rodando sozinha: tudo
 * acontece nas requisições dos próprios jogadores, como nas salas.
 */
export class RankedService {
    private now: () => Date;

    constructor(
        private store: RankedStore,
        private battles: Battles,
        /** Os testes trocam o relógio; o jogo usa o de verdade. */
        options: { now?: () => Date } = {},
    ) {
        this.now = options.now ?? (() => new Date());
    }

    /** Os pontos, o rank e a situação na fila de quem pediu. */
    async profile(userId: string): Promise<RankedProfile> {
        const standing = await this.store.findStanding(userId);

        if (!standing) {
            throw new RankedError('PLAYER_NOT_FOUND', 404, 'ranked.playerNotFound');
        }

        return {
            points: standing.rating,
            rank: rankOf(standing.rating),
            rankFloor: rankFloorOf(standing.rating),
            next: nextRankOf(standing.rating),
            wins: standing.wins,
            losses: standing.losses,
            queue: await this.queue(userId),
        };
    }

    /** Entra na fila com o time escolhido. Se já houver alguém compatível esperando, a partida começa aqui. */
    async enter(userId: string, team: string[]): Promise<QueueView> {
        // Lança BattleError (INVALID_TEAM, UNKNOWN_CHARACTER) se o time não serve.
        this.battles.validateTeam(team);

        const standing = await this.store.findStanding(userId);

        if (!standing) {
            throw new RankedError('PLAYER_NOT_FOUND', 404, 'ranked.playerNotFound');
        }

        // Quem tem uma ranqueada em andamento termina (ou desiste dela) antes de
        // procurar outra: senão bastaria abandonar a partida perdida.
        const current = await this.store.findTicket(userId);

        if (current?.status === 'matched' && current.battleId && (await this.battles.isInProgress(current.battleId))) {
            throw new RankedError('ALREADY_IN_RANKED_BATTLE', 409, 'ranked.alreadyInBattle', { battleId: current.battleId });
        }

        const ticket = await this.store.enqueue(userId, team, standing.rating, this.now());

        await this.tryMatch(ticket);

        return this.queue(userId);
    }

    /**
     * Como o jogador está na fila. É a consulta que a tela repete enquanto
     * procura: cada uma renova o bilhete e tenta parear de novo.
     */
    async queue(userId: string): Promise<QueueView> {
        let ticket = await this.store.findTicket(userId);

        if (ticket?.status === 'matching' && this.now().getTime() - ticket.updatedAt.getTime() > STUCK_AFTER_MS) {
            await this.store.release(ticket.id);
            ticket = await this.store.findTicket(userId);
        }

        if (ticket?.status === 'searching') {
            await this.store.touch(ticket.id, this.now());
            await this.tryMatch(ticket);
            ticket = await this.store.findTicket(userId);
        }

        if (!ticket || ticket.status === 'cancelled') {
            return IDLE;
        }

        if (ticket.status === 'matched') {
            // Partida que já acabou não prende ninguém: o jogador está livre para procurar outra.
            const playing = ticket.battleId !== null && (await this.battles.isInProgress(ticket.battleId));

            return playing ? { status: 'matched', battleId: ticket.battleId, waitedSeconds: 0, team: null } : IDLE;
        }

        return {
            status: 'searching',
            battleId: null,
            waitedSeconds: Math.max(0, Math.floor((this.now().getTime() - ticket.queuedAt.getTime()) / 1000)),
            team: ticket.team,
        };
    }

    /** Sai da fila. Quem já foi pareado não sai: a partida existe. */
    async leave(userId: string): Promise<QueueView> {
        await this.store.cancel(userId);

        return this.queue(userId);
    }

    /**
     * Lança os pontos de uma partida ranqueada que acabou. Quem chama é o
     * serviço de batalhas, uma vez, quando grava o fim da batalha. Desistência
     * e tempo esgotado contam como derrota de quem saiu.
     */
    async settle(battle: BattleRecord): Promise<void> {
        if (!battle.ranked || battle.opponentId === null || battle.winner === null) {
            return;
        }

        const winnerId = battle.winner === 'A' ? battle.userId : battle.opponentId;
        const loserId = battle.winner === 'A' ? battle.opponentId : battle.userId;

        await this.store.settle({ battleId: battle.id, winnerId, loserId, winnerTeam: battle.winner }, ratingChange);
    }

    /** Procura um adversário para `mine` entre quem está na fila. Se achar e conseguir reservar os dois, cria a partida. */
    private async tryMatch(mine: RankedTicket): Promise<void> {
        const now = this.now().getTime();
        const waiting = await this.store.findSearching(new Date(now - STALE_AFTER_MS), CANDIDATE_LIMIT);
        const myWait = now - mine.queuedAt.getTime();

        const opponent = waiting
            .filter((other) => other.userId !== mine.userId)
            // Vale a janela de quem espera há mais tempo: é ele que a fila precisa atender.
            .filter((other) => Math.abs(other.rating - mine.rating) <= searchWindow(Math.max(myWait, now - other.queuedAt.getTime())))
            // O de pontos mais próximos; no empate, quem chegou primeiro.
            .sort((a, b) => Math.abs(a.rating - mine.rating) - Math.abs(b.rating - mine.rating) || a.queuedAt.getTime() - b.queuedAt.getTime())[0];

        if (!opponent) {
            return;
        }

        // Dois pareamentos podem querer os mesmos bilhetes no mesmo instante.
        // Reservar sempre na mesma ordem (pelo id) garante que só um consegue
        // o primeiro, e o outro desiste sem ter segurado nada.
        const [first, second] = mine.id < opponent.id ? [mine, opponent] : [opponent, mine];

        if (!(await this.store.claim(first.id))) {
            return;
        }

        if (!(await this.store.claim(second.id))) {
            await this.store.release(first.id);

            return;
        }

        try {
            // Quem esperou mais fica com o time A.
            const [host, guest] = mine.queuedAt.getTime() <= opponent.queuedAt.getTime() ? [mine, opponent] : [opponent, mine];
            const battleId = await this.battles.createVersus({
                hostId: host.userId,
                hostTeam: host.team,
                guestId: guest.userId,
                guestTeam: guest.team,
                ranked: true,
            });

            await this.store.setMatched([mine.id, opponent.id], battleId);
        } catch (error) {
            // Sem isto os dois ficariam presos em "matching" até a reserva vencer.
            await this.store.release(first.id);
            await this.store.release(second.id);
            throw error;
        }
    }
}
