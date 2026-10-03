import { randomInt } from 'node:crypto';
import type { BattleService } from '../battles/battle.service';
import { RoomError } from './room.errors';
import type { OpenRoomView, RoomRecord, RoomRole, RoomStore, RoomView } from './room.types';

/** Sem 0/O, 1/I/L: o código é ditado ou digitado de um jogador para o outro. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const CODE_ATTEMPTS = 8;

const LIST_LIMIT = 30;
/** Sala que ninguém entrou sai da lista depois deste tempo. */
const LIST_MAX_AGE_MS = 30 * 60 * 1000;

/** O que o serviço de salas usa do serviço de batalhas. */
type Battles = Pick<BattleService, 'createVersus' | 'validateTeam'>;

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
 * 3. Cada um escolhe o time na própria tela e avisa que está pronto. O time
 *    fica guardado aqui, mas o outro só fica sabendo que o jogador está
 *    pronto, nunca o que ele escolheu.
 * 4. Quando os dois estão prontos, a batalha é criada (BattleService) e a sala
 *    passa a apontar para ela.
 */
export class RoomService {
    private now: () => Date;
    private newCode: () => string;

    constructor(
        private store: RoomStore,
        private battles: Battles,
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
                return toView(room, 'host');
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

    async get(userId: string, code: string): Promise<RoomView> {
        const { room, role } = await this.findForMember(userId, code);

        return toView(room, role);
    }

    async join(userId: string, code: string): Promise<RoomView> {
        const room = await this.store.findByCode(normalizeCode(code));

        if (!room) {
            throw new RoomError('ROOM_NOT_FOUND', 404, 'room.notFound');
        }

        // Quem já está na sala (recarregou a página, voltou pelo código) só recebe a sala de volta.
        const role = roleOf(room, userId);

        if (role) {
            return toView(room, role);
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

    /**
     * O jogador confirma o time e avisa que está pronto. Se o outro já estava
     * pronto, a batalha começa aqui.
     */
    async ready(userId: string, code: string, team: string[]): Promise<RoomView> {
        const { room, role } = await this.findForMember(userId, code);

        // Lança BattleError (INVALID_TEAM, UNKNOWN_CHARACTER) se o time não serve.
        this.battles.validateTeam(team);

        if (!(await this.store.setReady(room.id, role, team))) {
            throw new RoomError('ROOM_CLOSED', 409, 'room.closed');
        }

        await this.startIfBothReady(room.code);

        return this.get(userId, room.code);
    }

    /** O jogador volta atrás para trocar o time. Depois que a batalha começa, não dá mais. */
    async unready(userId: string, code: string): Promise<RoomView> {
        const { room, role } = await this.findForMember(userId, code);

        if (!(await this.store.clearReady(room.id, role))) {
            throw new RoomError('ROOM_CLOSED', 409, 'room.closed');
        }

        return this.get(userId, room.code);
    }

    /**
     * Sair da sala antes de a batalha começar: se for o anfitrião, a sala
     * fecha; se for o convidado, ela volta a esperar outro. Depois que a
     * batalha começou, sair da sala não muda nada.
     */
    async leave(userId: string, code: string): Promise<void> {
        const { room, role } = await this.findForMember(userId, code);

        if (role === 'host') {
            await this.store.close(room.id);
        } else {
            await this.store.removeGuest(room.id, userId);
        }
    }

    private async startIfBothReady(code: string): Promise<void> {
        const room = await this.store.findByCode(code);

        if (!room || !room.guestId || !room.hostReady || !room.guestReady || !room.hostTeam || !room.guestTeam) {
            return;
        }

        // Os dois "pronto" podem chegar ao mesmo tempo: só quem consegue o
        // claimStart cria a batalha, para não nascerem duas.
        if (!(await this.store.claimStart(room.id))) {
            return;
        }

        try {
            const battleId = await this.battles.createVersus({
                hostId: room.hostId,
                hostTeam: room.hostTeam,
                guestId: room.guestId,
                guestTeam: room.guestTeam,
            });

            await this.store.setStarted(room.id, battleId);
        } catch (error) {
            // Sem isto a sala ficaria presa em "starting" para sempre.
            await this.store.releaseStart(room.id);
            throw error;
        }
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

/** A sala como `role` a enxerga: o próprio time, e do outro só o nome e o "pronto". */
function toView(room: RoomRecord, role: RoomRole): RoomView {
    const isHost = role === 'host';
    const ready = isHost ? room.hostReady : room.guestReady;
    const team = isHost ? room.hostTeam : room.guestTeam;
    const opponentName = isHost ? room.guestName : room.hostName;

    return {
        code: room.code,
        status: room.status,
        role,
        you: { ready, team: ready ? team : null },
        opponent: opponentName === null ? null : { name: opponentName, ready: isHost ? room.guestReady : room.hostReady },
        battleId: room.battleId,
        createdAt: room.createdAt,
    };
}
