import type { TeamId } from '../../game';
import type { DraftAction, DraftKind, DraftStep } from './ranked.draft';
import type { RankId } from './ranked.rules';

/**
 * searching — na fila, esperando um adversário.
 * matching  — reservado por um pareamento em andamento (dura um instante).
 * matched   — pareado: `draftId` é a seleção de personagens (e, depois dela, a partida).
 * cancelled — o jogador saiu da fila.
 */
export type TicketStatus = 'searching' | 'matching' | 'matched' | 'cancelled';

/** O bilhete de um jogador na fila da ranqueada. Cada jogador tem no máximo um. */
export interface RankedTicket {
    id: string;
    userId: string;
    /** Os pontos dele quando entrou: a fila procura alguém com pontos parecidos. */
    rating: number;
    status: TicketStatus;
    /** Pareado: a seleção de personagens dos dois. */
    draftId: string | null;
    /** A partida dos bilhetes de antes da seleção de personagens (os novos guardam a partida na seleção). */
    battleId: string | null;
    /** Quando entrou na fila. */
    queuedAt: Date;
    /** A última vez que a tela dele perguntou pela fila. Quem para de perguntar saiu. */
    lastSeenAt: Date;
    updatedAt: Date;
}

/**
 * drafting — os dois estão banindo e escolhendo.
 * starting — a seleção acabou e a partida está sendo criada (dura um instante).
 * done     — a partida existe: `battleId`.
 */
export type DraftStatus = 'drafting' | 'starting' | 'done';

/** A seleção de personagens de uma partida ranqueada (veja ranked.draft.ts). */
export interface RankedDraft {
    id: string;
    /** Quem fica com o time A e começa banindo e escolhendo. */
    hostId: string;
    guestId: string;
    /** O que já foi feito, na ordem de DRAFT_ORDER. */
    actions: DraftAction[];
    status: DraftStatus;
    battleId: string | null;
    /** Quando começou o passo da vez: o prazo dele acaba DRAFT_TURN_MS depois. */
    turnStartedAt: Date;
    /** Sobe a cada gravação: é a trava contra duas requisições ao mesmo tempo. */
    version: number;
    createdAt: Date;
    updatedAt: Date;
}

/** O que muda numa seleção a cada gravação. */
export type DraftChange = Partial<Pick<RankedDraft, 'actions' | 'status' | 'battleId' | 'turnStartedAt'>>;

/** A seleção como um dos jogadores a enxerga. */
export interface DraftView {
    id: string;
    status: DraftStatus;
    /** O time de quem pediu. */
    you: TeamId;
    /** O nome de quem está em cada time. */
    players: Record<TeamId, string>;
    /** A ordem completa dos passos. */
    order: DraftStep[];
    actions: DraftAction[];
    /** O passo da vez e quanto tempo ainda resta nele. `null` quando a seleção acabou. */
    current: { index: number; team: TeamId; kind: DraftKind; timeLeftMs: number } | null;
    banned: string[];
    teams: Record<TeamId, string[]>;
    /** Na vez de quem pediu: os personagens que valem agora. Vazio na vez do outro. */
    choices: string[];
    /** A partida, quando a seleção acaba. */
    battleId: string | null;
}

/** Os pontos e o placar de um jogador na ranqueada. */
export interface RankedStanding {
    rating: number;
    wins: number;
    losses: number;
}

/** O resultado de uma partida ranqueada, pronto para ser lançado. */
export interface RankedResult {
    battleId: string;
    winnerId: string;
    loserId: string;
    /** O time (A ou B) de quem venceu, para saber em que coluna da batalha vai cada variação. */
    winnerTeam: 'A' | 'B';
}

/** O que mudou para cada jogador quando o resultado foi lançado. */
export interface RankedSettlement {
    winner: { before: number; after: number };
    loser: { before: number; after: number };
}

/**
 * Onde a fila e os pontos ficam guardados. O serviço só conhece esta
 * interface: em produção ela é o Prisma (ranked.repository.ts), nos testes é
 * um objeto em memória. As operações que dizem "só se..." precisam ser
 * atômicas: é nelas que duas requisições simultâneas se decidem.
 */
export interface RankedStore {
    /** `null` se o jogador não existe. */
    findStanding(userId: string): Promise<RankedStanding | null>;
    findTicket(userId: string): Promise<RankedTicket | null>;
    /** Põe o jogador na fila: cria o bilhete dele ou reaproveita o que já existe. */
    enqueue(userId: string, rating: number, now: Date): Promise<RankedTicket>;
    /** Registra que a tela do jogador perguntou pela fila agora. */
    touch(ticketId: string, now: Date): Promise<void>;
    /** Quem está procurando partida e deu sinal de vida depois de `seenSince`, do que espera há mais tempo para o mais recente. */
    findSearching(seenSince: Date, limit: number): Promise<RankedTicket[]>;
    /** Reserva o bilhete para um pareamento, só se ele ainda estiver procurando. Só uma requisição consegue. */
    claim(ticketId: string): Promise<boolean>;
    /** Desfaz a reserva: o bilhete volta a procurar. */
    release(ticketId: string): Promise<void>;
    /** Os bilhetes reservados passam a apontar para a seleção de personagens criada para eles. */
    setMatched(ticketIds: string[], draftId: string): Promise<void>;
    /** Cria a seleção de personagens de dois jogadores pareados. `hostId` é o time A, que começa. */
    createDraft(hostId: string, guestId: string, now: Date): Promise<RankedDraft>;
    findDraft(id: string): Promise<RankedDraft | null>;
    /**
     * Grava a seleção só se ela ainda estiver na versão esperada (a trava contra
     * duas requisições ao mesmo tempo) e sobe a versão. Devolve null se outra
     * gravou antes.
     */
    saveDraft(id: string, expectedVersion: number, change: DraftChange): Promise<RankedDraft | null>;
    /** O nome de cada jogador, para a tela da seleção mostrar contra quem é. */
    findNames(userIds: string[]): Promise<Record<string, string>>;
    /** O jogador sai da fila, só se ainda estiver procurando. Devolve se saiu. */
    cancel(userId: string): Promise<boolean>;
    /**
     * Lança o resultado de uma partida: marca na batalha quantos pontos cada
     * lado ganhou ou perdeu e atualiza os pontos e o placar dos dois, tudo de
     * uma vez. `change` recebe os pontos atuais dos dois e diz quanto vale a
     * partida. Só lança uma vez por batalha: se já foi lançado, devolve null.
     */
    settle(result: RankedResult, change: (winnerPoints: number, loserPoints: number) => { gain: number; loss: number }): Promise<RankedSettlement | null>;
}

/** Como o jogador está na fila agora. */
export interface QueueView {
    /**
     * idle: fora da fila | searching: procurando adversário | drafting: pareado,
     * escolhendo os personagens | matched: tem uma partida ranqueada em andamento
     */
    status: 'idle' | 'searching' | 'drafting' | 'matched';
    /** A seleção de personagens, enquanto ela acontece. */
    draftId: string | null;
    /** A partida, quando há uma em andamento. */
    battleId: string | null;
    /** Há quanto tempo está procurando, em segundos. */
    waitedSeconds: number;
}

/** A ranqueada como o jogador a enxerga: os pontos, o rank e a fila. */
export interface RankedProfile {
    points: number;
    rank: RankId;
    /** Onde o rank atual começa: a barra de progresso vai daqui até `next.at`. */
    rankFloor: number;
    /** O próximo rank e quantos pontos ele pede. `null` para quem já está no mais alto. */
    next: { rank: RankId; at: number } | null;
    wins: number;
    losses: number;
    queue: QueueView;
}
