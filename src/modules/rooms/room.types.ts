import type { DraftView } from '../ranked/ranked.types';

/**
 * waiting   — só o anfitrião está na sala, esperando alguém entrar.
 * selecting — os dois estão na sala, banindo e escolhendo os personagens (a seleção, como na ranqueada).
 * starting  — (salas antigas, de antes da seleção) a batalha estava sendo criada.
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
    /** A seleção de personagens dos dois. Nasce quando o convidado entra; some se ele sair. */
    draftId: string | null;
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
    /** Liga a seleção à sala, só se este convidado ainda estiver nela e ela ainda não tiver seleção. Devolve se gravou. */
    setDraft(id: string, guestId: string, draftId: string): Promise<boolean>;
    /** O convidado sai e a sala volta a esperar (sem a seleção dele), só se a batalha ainda não começou. */
    removeGuest(id: string, guestId: string): Promise<void>;
    /** A seleção acabou e a batalha existe. */
    setStarted(id: string, battleId: string): Promise<void>;
    /** Fecha a sala, só se a batalha ainda não começou. */
    close(id: string): Promise<void>;
}

/** A sala como um dos dois jogadores a enxerga. */
export interface RoomView {
    code: string;
    status: RoomStatus;
    role: RoomRole;
    /** Do outro jogador, o nome. `null` enquanto ninguém entrou. */
    opponent: { name: string } | null;
    /** A seleção de personagens, enquanto ela acontece (status "selecting"). */
    draft: DraftView | null;
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
