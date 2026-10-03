/**
 * waiting   — só o anfitrião está na sala, esperando alguém entrar.
 * selecting — os dois estão na sala, escolhendo os times.
 * starting  — os dois avisaram que estão prontos; a batalha está sendo criada.
 * started   — a batalha existe (`battleId`).
 * closed    — o anfitrião saiu antes de a batalha começar.
 */
export type RoomStatus = 'waiting' | 'selecting' | 'starting' | 'started' | 'closed';

/** Quem criou a sala é o anfitrião (time A na batalha); quem entrou é o convidado (time B). */
export type RoomRole = 'host' | 'guest';

/** Uma sala como está guardada no banco, já com os nomes dos dois jogadores. */
export interface RoomRecord {
    id: string;
    /** Código curto que os jogadores passam um para o outro para entrar (ex.: "K7QF2M"). */
    code: string;
    status: RoomStatus;
    hostId: string;
    hostName: string;
    guestId: string | null;
    guestName: string | null;
    /** O time que cada um confirmou. Só vale enquanto o "pronto" correspondente for verdadeiro. */
    hostTeam: string[] | null;
    guestTeam: string[] | null;
    hostReady: boolean;
    guestReady: boolean;
    battleId: string | null;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Onde as salas ficam guardadas. O serviço só conhece esta interface: em
 * produção ela é o Prisma (room.repository.ts), nos testes é um objeto em
 * memória. As operações que dizem "só se..." precisam ser atômicas: é nelas
 * que duas requisições simultâneas se decidem.
 */
export interface RoomStore {
    /** Cria a sala. Devolve null se o código já existe (o serviço tenta outro). */
    create(hostId: string, code: string): Promise<RoomRecord | null>;
    findByCode(code: string): Promise<RoomRecord | null>;
    /** Salas esperando alguém entrar, criadas depois de `since`, da mais nova para a mais antiga. */
    findWaiting(since: Date, limit: number): Promise<RoomRecord[]>;
    /** Fecha as salas deste anfitrião que ainda não começaram. */
    closeOpenByHost(hostId: string): Promise<void>;
    /** O convidado entra, só se a sala estiver esperando e vazia. Devolve se entrou. */
    join(id: string, guestId: string): Promise<boolean>;
    /** O convidado sai e a sala volta a esperar, só se a batalha ainda não começou. */
    removeGuest(id: string, guestId: string): Promise<void>;
    /** Guarda o time e marca o jogador como pronto, só se a batalha ainda não começou. Devolve se gravou. */
    setReady(id: string, role: RoomRole, team: string[]): Promise<boolean>;
    /** Desmarca o pronto, só se a batalha ainda não começou. Devolve se gravou. */
    clearReady(id: string, role: RoomRole): Promise<boolean>;
    /** Passa a sala para "starting", só se os dois estiverem prontos. Só uma requisição consegue. */
    claimStart(id: string): Promise<boolean>;
    /** Desfaz o claimStart quando a criação da batalha falha: a sala volta a "selecting". */
    releaseStart(id: string): Promise<void>;
    setStarted(id: string, battleId: string): Promise<void>;
    /** Fecha a sala, só se a batalha ainda não começou. */
    close(id: string): Promise<void>;
}

/** A sala como um dos dois jogadores a enxerga. O time do outro nunca aparece aqui. */
export interface RoomView {
    code: string;
    status: RoomStatus;
    role: RoomRole;
    you: {
        ready: boolean;
        /** O time confirmado, enquanto estiver pronto. */
        team: string[] | null;
    };
    /** Do outro jogador só se sabe o nome e se ele já está pronto. `null` enquanto ninguém entrou. */
    opponent: { name: string; ready: boolean } | null;
    /** Preenchido quando a batalha começa: é para lá que a tela vai. */
    battleId: string | null;
    createdAt: Date;
}

/** Uma sala na lista de salas abertas. */
export interface OpenRoomView {
    code: string;
    hostName: string;
    createdAt: Date;
}
