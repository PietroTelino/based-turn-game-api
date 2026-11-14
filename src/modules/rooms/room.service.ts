import { randomInt } from 'node:crypto';
import type { RankedService } from '../ranked/ranked.service';
import type { DraftView } from '../ranked/ranked.types';
import { RoomError } from './room.errors';
import type { OpenRoomView, RoomRecord, RoomRole, RoomStore, RoomView } from './room.types';

/** Sem 0/O, 1/I/L: o código é ditado ou digitado de um jogador para o outro. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const CODE_ATTEMPTS = 8;

const LIST_LIMIT = 30;
/** Sala que ninguém entrou sai da lista depois deste tempo. */
const LIST_MAX_AGE_MS = 30 * 60 * 1000;

/** O que o serviço de salas usa da seleção de personagens (a mesma da ranqueada). */
type Drafts = Pick<RankedService, 'startCasualDraft' | 'draftById' | 'draftActionById'>;

function generateCode(): string {
    let code = '';

    for (let i = 0; i < CODE_LENGTH; i++) {
        code += CODE_ALPHABET.charAt(randomInt(CODE_ALPHABET.length));
    }

    return code;
}

/** Aceita o código como a pessoa digitar: minúsculas e espaços em volta não importam. */
function normalizeCode(code: string): string {
    return code.trim().toUpperCase();
}

/**
 * Salas do multiplayer: onde dois jogadores se encontram antes da batalha.
 *
 * 1. Um jogador cria a sala e recebe um código.
 * 2. O outro entra, pelo código ou pela lista de salas abertas.
 * 3. Ao entrar, começa a seleção de personagens dos dois, a mesma da
 *    ranqueada (RankedService): banimentos e escolhas alternados, com prazo
 *    em cada passo. Só que a partida que sai dela não vale pontos.
 * 4. Quando a seleção acaba, a batalha existe e a sala passa a apontar para ela.
 *
 * A tela pergunta pela sala (`get`) e recebe junto a seleção; é essa consulta
 * que também aplica as escolhas por tempo esgotado.
 */
export class RoomService {
    private now: () => Date;
    private newCode: () => string;

    constructor(
        private store: RoomStore,
        private drafts: Drafts,
        /** Os testes trocam o relógio e o gerador de códigos; o jogo usa os de verdade. */
        options: { now?: () => Date; newCode?: () => string } = {},
    ) {
        this.now = options.now ?? (() => new Date());
        this.newCode = options.newCode ?? generateCode;
    }

    async create(userId: string): Promise<RoomView> {
        // Uma sala aberta por jogador: a anterior, se ainda não começou, é fechada.
        await this.store.closeOpenByHost(userId);

        for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
            const room = await this.store.create(userId, this.newCode());

            if (room) {
                return toView(room, 'host', null);
            }
        }

        throw new Error('Não foi possível gerar um código de sala livre');
    }

    /** Salas esperando alguém entrar, fora a do próprio jogador. */
    async listOpen(userId: string): Promise<OpenRoomView[]> {
        const since = new Date(this.now().getTime() - LIST_MAX_AGE_MS);
        const rooms = await this.store.findWaiting(since, LIST_LIMIT);

        return rooms
            .filter((room) => room.hostId !== userId)
            .map((room) => ({ code: room.code, hostName: room.hostName, createdAt: room.createdAt }));
    }

    /** A sala e, durante a seleção, a seleção posta em dia. É a consulta que a tela repete. */
    async get(userId: string, code: string): Promise<RoomView> {
        const { room, role } = await this.findForMember(userId, code);

        return this.view(room, role, userId);
    }

    async join(userId: string, code: string): Promise<RoomView> {
        const room = await this.store.findByCode(normalizeCode(code));

        if (!room) {
            throw new RoomError('ROOM_NOT_FOUND', 404, 'room.notFound');
        }

        // Quem já está na sala (recarregou a página, voltou pelo código) só recebe a sala de volta.
        const role = roleOf(room, userId);

        if (role) {
            return this.view(room, role, userId);
        }

        if (room.status === 'closed') {
            throw new RoomError('ROOM_CLOSED', 409, 'room.closed');
        }

        // join é atômico: se dois chegarem juntos, só um entra.
        if (room.status !== 'waiting' || !(await this.store.join(room.id, userId))) {
            throw new RoomError('ROOM_FULL', 409, 'room.full');
        }

        return this.get(userId, room.code);
    }

    /** Bane ou escolhe `characterId` no passo da vez da seleção da sala. */
    async draftAction(userId: string, code: string, characterId: string): Promise<RoomView> {
        const { room, role } = await this.findForMember(userId, code);
        const current = await this.ensureDraft(room);

        if (current.status !== 'selecting' || !current.draftId) {
            throw new RoomError(current.status === 'waiting' ? 'ROOM_NOT_DRAFTING' : 'ROOM_CLOSED', 409, current.status === 'waiting' ? 'room.notDrafting' : 'room.closed');
        }

        // Lança RankedError (NOT_YOUR_DRAFT_TURN, INVALID_DRAFT_CHOICE...) se a escolha não vale.
        const draft = await this.drafts.draftActionById(userId, current.draftId, characterId);

        return toView(await this.startIfDone(current, draft), role, draft);
    }

    /**
     * Sair da sala antes de a batalha começar: se for o anfitrião, a sala
     * fecha; se for o convidado, ela volta a esperar outro (e a seleção dele
     * fica para trás). Depois que a batalha começou, sair da sala não muda nada.
     */
    async leave(userId: string, code: string): Promise<void> {
        const { room, role } = await this.findForMember(userId, code);

        if (role === 'host') {
            await this.store.close(room.id);
        } else {
            await this.store.removeGuest(room.id, userId);
        }
    }

    /** A sala como `role` a enxerga, com a seleção em dia. */
    private async view(room: RoomRecord, role: RoomRole, userId: string): Promise<RoomView> {
        const current = await this.ensureDraft(room);

        if (current.status !== 'selecting' || !current.draftId) {
            return toView(current, role, null);
        }

        const draft = await this.drafts.draftById(userId, current.draftId);

        return toView(await this.startIfDone(current, draft), role, draft);
    }

    /**
     * Os dois estão na sala e a seleção ainda não existe: cria. Normalmente
     * acontece logo depois do join; aqui também, caso a criação tenha falhado.
     */
    private async ensureDraft(room: RoomRecord): Promise<RoomRecord> {
        if (room.status !== 'selecting' || !room.guestId || room.draftId) {
            return room;
        }

        const draftId = await this.drafts.startCasualDraft(room.hostId, room.guestId);

        if (await this.store.setDraft(room.id, room.guestId, draftId)) {
            return { ...room, draftId };
        }

        // Outra requisição ligou uma seleção antes (ou o convidado saiu): vale o que está gravado.
        return (await this.store.findByCode(room.code)) ?? room;
    }

    /** A seleção acabou e criou a batalha: a sala passa a apontar para ela. */
    private async startIfDone(room: RoomRecord, draft: DraftView): Promise<RoomRecord> {
        if (!draft.battleId) {
            return room;
        }

        await this.store.setStarted(room.id, draft.battleId);

        return { ...room, status: 'started', battleId: draft.battleId };
    }

    /** Busca a sala e garante que quem pediu está nela. */
    private async findForMember(userId: string, code: string): Promise<{ room: RoomRecord; role: RoomRole }> {
        const room = await this.store.findByCode(normalizeCode(code));
        const role = room ? roleOf(room, userId) : null;

        // Sala dos outros responde igual a sala inexistente.
        if (!room || !role) {
            throw new RoomError('ROOM_NOT_FOUND', 404, 'room.notFound');
        }

        return { room, role };
    }
}

function roleOf(room: RoomRecord, userId: string): RoomRole | null {
    if (room.hostId === userId) return 'host';
    if (room.guestId === userId) return 'guest';

    return null;
}

function toView(room: RoomRecord, role: RoomRole, draft: DraftView | null): RoomView {
    const opponentName = role === 'host' ? room.guestName : room.hostName;

    return {
        code: room.code,
        status: room.status,
        role,
        opponent: opponentName === null ? null : { name: opponentName },
        // Depois que a batalha começa a tela vai para ela: a seleção não precisa mais vir.
        draft: room.status === 'selecting' ? draft : null,
        battleId: room.battleId,
        createdAt: room.createdAt,
    };
}
