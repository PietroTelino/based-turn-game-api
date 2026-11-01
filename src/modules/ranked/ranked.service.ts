import type { TeamId } from '../../game';
import type { BattleService } from '../battles/battle.service';
import type { BattleRecord } from '../battles/battle.types';
import { DRAFT_ORDER, DRAFT_TURN_MS, bannedOf, choicesOf, currentStep, refusalOf, teamOf } from './ranked.draft';
import type { DraftAction } from './ranked.draft';
import { RankedError } from './ranked.errors';
import { nextRankOf, rankFloorOf, rankOf, ratingChange, searchWindow } from './ranked.rules';
import type { DraftView, QueueView, RankedDraft, RankedProfile, RankedStore, RankedTicket } from './ranked.types';

/**
 * Bilhete que ficou este tempo sem a tela perguntar pela fila é de quem fechou
 * a página: ninguém é pareado com ele. A tela pergunta a cada segundo e meio.
 */
const STALE_AFTER_MS = 10_000;
/** Uma reserva de pareamento dura um instante. Se passou disto, quem reservou caiu no meio: o bilhete volta à fila. */
const STUCK_AFTER_MS = 10_000;
/** Quantos bilhetes a fila olha de cada vez para achar um adversário. */
const CANDIDATE_LIMIT = 50;

/** Uma seleção que ficou em "starting" mais que isto foi largada no meio por quem criava a partida: outra requisição termina o serviço. */
const STARTING_STUCK_MS = 10_000;

/** O que a ranqueada usa do serviço de batalhas. */
type Battles = Pick<BattleService, 'createVersus' | 'isInProgress' | 'listCharacters'>;

const IDLE: QueueView = { status: 'idle', draftId: null, battleId: null, waitedSeconds: 0 };

/**
 * Partidas ranqueadas: a fila com pareamento automático, a seleção de
 * personagens e os pontos.
 *
 * 1. O jogador entra na fila (`enter`), sem time: o time é montado depois,
 *    à vista do adversário. O bilhete guarda os pontos que ele tinha ao entrar.
 * 2. Enquanto espera, a tela pergunta pela fila (`queue`). Cada pergunta
 *    renova o bilhete e tenta parear: procura, entre quem também está
 *    esperando, o jogador com os pontos mais próximos. Quanto mais tempo de
 *    espera, maior a diferença de pontos aceita (ranked.rules.ts).
 * 3. Achou: começa a seleção de personagens dos dois (ranked.draft.ts), e os
 *    bilhetes passam a apontar para ela. Cada tela pergunta pela seleção
 *    (`draft`) e manda os banimentos e escolhas (`draftAction`). Quem deixa o
 *    tempo do passo acabar recebe uma escolha ao acaso.
 * 4. Quando a seleção acaba, a batalha é criada (BattleService, marcada como
 *    ranqueada) com os dois times, e as telas vão para ela.
 * 5. Quando a batalha acaba, o serviço de batalhas avisa (`settle`) e os
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
        /** Os testes trocam o relógio e o sorteio das escolhas por tempo esgotado; o jogo usa os de verdade. */
        options: { now?: () => Date; random?: () => number } = {},
    ) {
        this.now = options.now ?? (() => new Date());
        this.random = options.random ?? Math.random;
    }

    private random: () => number;

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

    /** Entra na fila. Se já houver alguém compatível esperando, a seleção de personagens começa aqui. */
    async enter(userId: string): Promise<QueueView> {
        const standing = await this.store.findStanding(userId);

        if (!standing) {
            throw new RankedError('PLAYER_NOT_FOUND', 404, 'ranked.playerNotFound');
        }

        // Quem tem uma ranqueada em andamento (ou a seleção dela) termina antes de
        // procurar outra: senão bastaria abandonar a partida perdida.
        const current = await this.queue(userId);

        if (current.status === 'matched' || current.status === 'drafting') {
            throw new RankedError('ALREADY_IN_RANKED_BATTLE', 409, 'ranked.alreadyInBattle', {
                ...(current.battleId && { battleId: current.battleId }),
                ...(current.draftId && { draftId: current.draftId }),
            });
        }

        const ticket = await this.store.enqueue(userId, standing.rating, this.now());

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
            const draft = ticket.draftId ? await this.store.findDraft(ticket.draftId) : null;

            if (draft && draft.status !== 'done') {
                return { status: 'drafting', draftId: draft.id, battleId: null, waitedSeconds: 0 };
            }

            // Partida que já acabou não prende ninguém: o jogador está livre para procurar outra.
            const battleId = draft ? draft.battleId : ticket.battleId;
            const playing = battleId !== null && (await this.battles.isInProgress(battleId));

            return playing ? { status: 'matched', draftId: null, battleId, waitedSeconds: 0 } : IDLE;
        }

        return {
            status: 'searching',
            draftId: null,
            battleId: null,
            waitedSeconds: Math.max(0, Math.floor((this.now().getTime() - ticket.queuedAt.getTime()) / 1000)),
        };
    }

    /**
     * A seleção de personagens de quem pediu, como ele a enxerga. É a consulta
     * que a tela repete durante a seleção: ela também aplica as escolhas por
     * tempo esgotado e, no fim, cria a partida.
     */
    async draft(userId: string): Promise<DraftView> {
        const draft = await this.settleDraft(await this.findMyDraft(userId));

        return this.toDraftView(draft, userId);
    }

    /** Bane ou escolhe `characterId` no passo da vez, que precisa ser de quem pediu. */
    async draftAction(userId: string, characterId: string): Promise<DraftView> {
        // Primeiro o que o relógio já decidiu: o passo pode ter passado por tempo esgotado.
        const draft = await this.settleDraft(await this.findMyDraft(userId));
        const step = currentStep(draft.actions);

        if (draft.status !== 'drafting' || !step || step.team !== this.teamIn(draft, userId)) {
            throw new RankedError('NOT_YOUR_DRAFT_TURN', 409, 'ranked.draft.notYourTurn');
        }

        const refusal = refusalOf(draft.actions, characterId, this.characterIds());

        if (refusal) {
            throw new RankedError('INVALID_DRAFT_CHOICE', 400, `ranked.draft.${refusal}`);
        }

        const actions: DraftAction[] = [...draft.actions, { team: step.team, kind: step.kind, characterId, auto: false }];
        const saved = await this.store.saveDraft(draft.id, draft.version, {
            actions,
            turnStartedAt: this.now(),
            ...(currentStep(actions) === null && { status: 'starting' as const }),
        });

        if (!saved) {
            throw new RankedError('DRAFT_CONFLICT', 409, 'ranked.draft.conflict');
        }

        return this.toDraftView(await this.settleDraft(saved, true), userId);
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
            // Quem esperou mais fica com o time A: bane e escolhe primeiro.
            const [host, guest] = mine.queuedAt.getTime() <= opponent.queuedAt.getTime() ? [mine, opponent] : [opponent, mine];
            const draft = await this.store.createDraft(host.userId, guest.userId, this.now());

            await this.store.setMatched([mine.id, opponent.id], draft.id);
        } catch (error) {
            // Sem isto os dois ficariam presos em "matching" até a reserva vencer.
            await this.store.release(first.id);
            await this.store.release(second.id);
            throw error;
        }
    }

    /** A seleção em que o jogador está agora. NOT_IN_DRAFT se ele não foi pareado. */
    private async findMyDraft(userId: string): Promise<RankedDraft> {
        const ticket = await this.store.findTicket(userId);
        const draft = ticket?.status === 'matched' && ticket.draftId ? await this.store.findDraft(ticket.draftId) : null;

        if (!draft) {
            throw new RankedError('NOT_IN_DRAFT', 404, 'ranked.draft.notFound');
        }

        return draft;
    }

    /**
     * Põe a seleção em dia: aplica as escolhas por tempo esgotado (um passo
     * por prazo vencido, mesmo que ninguém tenha perguntado na hora) e, se ela
     * acabou, cria a partida. `claimed`: quem chama acabou de gravar o
     * "starting" e já é o dono da criação da partida.
     */
    private async settleDraft(draft: RankedDraft, claimed = false): Promise<RankedDraft> {
        let current = draft;

        if (current.status === 'drafting') {
            const now = this.now().getTime();
            const actions = [...current.actions];
            let started = current.turnStartedAt.getTime();
            const ids = this.characterIds();

            for (let step = currentStep(actions); step && now >= started + DRAFT_TURN_MS; step = currentStep(actions)) {
                const choices = choicesOf(actions, ids);
                const characterId = choices[Math.floor(this.random() * choices.length)] ?? choices[0];

                if (!characterId) break;

                actions.push({ team: step.team, kind: step.kind, characterId, auto: true });
                started += DRAFT_TURN_MS;
            }

            if (actions.length === current.actions.length) {
                return current;
            }

            const finished = currentStep(actions) === null;
            const saved = await this.store.saveDraft(current.id, current.version, {
                actions,
                turnStartedAt: new Date(started),
                ...(finished && { status: 'starting' as const }),
            });

            // Outra requisição pôs em dia antes: vale o que ela gravou.
            if (!saved) {
                return this.reload(current.id);
            }

            current = saved;
            claimed = finished;
        }

        if (current.status === 'starting') {
            if (!claimed) {
                // A criação da partida ficou pela metade (quem criava caiu): esta requisição assume.
                if (this.now().getTime() - current.updatedAt.getTime() < STARTING_STUCK_MS) {
                    return current;
                }

                const retaken = await this.store.saveDraft(current.id, current.version, { status: 'starting' });

                if (!retaken) {
                    return this.reload(current.id);
                }

                current = retaken;
            }

            const battleId = await this.battles.createVersus({
                hostId: current.hostId,
                hostTeam: teamOf(current.actions, 'A'),
                guestId: current.guestId,
                guestTeam: teamOf(current.actions, 'B'),
                ranked: true,
            });

            return (await this.store.saveDraft(current.id, current.version, { status: 'done', battleId })) ?? this.reload(current.id);
        }

        return current;
    }

    private async reload(draftId: string): Promise<RankedDraft> {
        const draft = await this.store.findDraft(draftId);

        if (!draft) {
            throw new RankedError('NOT_IN_DRAFT', 404, 'ranked.draft.notFound');
        }

        return draft;
    }

    private teamIn(draft: RankedDraft, userId: string): TeamId {
        return draft.hostId === userId ? 'A' : 'B';
    }

    private characterIds(): string[] {
        return this.battles.listCharacters().map((character) => character.id);
    }

    private async toDraftView(draft: RankedDraft, userId: string): Promise<DraftView> {
        const you = this.teamIn(draft, userId);
        const step = draft.status === 'drafting' ? currentStep(draft.actions) : null;
        const names = await this.store.findNames([draft.hostId, draft.guestId]);

        return {
            id: draft.id,
            status: draft.status,
            you,
            players: { A: names[draft.hostId] ?? '', B: names[draft.guestId] ?? '' },
            order: [...DRAFT_ORDER],
            actions: draft.actions,
            current: step
                ? {
                      index: step.index,
                      team: step.team,
                      kind: step.kind,
                      timeLeftMs: Math.max(0, draft.turnStartedAt.getTime() + DRAFT_TURN_MS - this.now().getTime()),
                  }
                : null,
            banned: bannedOf(draft.actions),
            teams: { A: teamOf(draft.actions, 'A'), B: teamOf(draft.actions, 'B') },
            choices: step && step.team === you ? choicesOf(draft.actions, this.characterIds()) : [],
            battleId: draft.battleId,
        };
    }
}
