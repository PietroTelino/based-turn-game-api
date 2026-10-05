import type { RankId } from './ranked.rules';

/**
 * searching — na fila, esperando um adversário.
 * matching  — reservado por um pareamento em andamento (dura um instante).
 * matched   — pareado: `battleId` é a partida.
 * cancelled — o jogador saiu da fila.
 */
export type TicketStatus = 'searching' | 'matching' | 'matched' | 'cancelled';

/** O bilhete de um jogador na fila da ranqueada. Cada jogador tem no máximo um. */
export interface RankedTicket {
    id: string;
    userId: string;
    /** O time com que ele entrou na fila. */
    team: string[];
    /** Os pontos dele quando entrou: a fila procura alguém com pontos parecidos. */
    rating: number;
    status: TicketStatus;
    battleId: string | null;
    /** Quando entrou na fila. */
    queuedAt: Date;
    /** A última vez que a tela dele perguntou pela fila. Quem para de perguntar saiu. */
    lastSeenAt: Date;
    updatedAt: Date;
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
    enqueue(userId: string, team: string[], rating: number, now: Date): Promise<RankedTicket>;
    /** Registra que a tela do jogador perguntou pela fila agora. */
    touch(ticketId: string, now: Date): Promise<void>;
    /** Quem está procurando partida e deu sinal de vida depois de `seenSince`, do que espera há mais tempo para o mais recente. */
    findSearching(seenSince: Date, limit: number): Promise<RankedTicket[]>;
    /** Reserva o bilhete para um pareamento, só se ele ainda estiver procurando. Só uma requisição consegue. */
    claim(ticketId: string): Promise<boolean>;
    /** Desfaz a reserva: o bilhete volta a procurar. */
    release(ticketId: string): Promise<void>;
    /** Os bilhetes reservados passam a apontar para a partida criada. */
    setMatched(ticketIds: string[], battleId: string): Promise<void>;
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
    /** idle: fora da fila | searching: procurando adversário | matched: tem uma partida ranqueada em andamento */
    status: 'idle' | 'searching' | 'matched';
    /** A partida, quando há uma em andamento. */
    battleId: string | null;
    /** Há quanto tempo está procurando, em segundos. */
    waitedSeconds: number;
    /** O time com que entrou na fila, enquanto procura. */
    team: string[] | null;
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
