/**
 * Amigos: pedidos de amizade, a lista de amigos (com a batalha em que cada um
 * está, para assistir) e os convites para a sala.
 *
 * 1. Um jogador procura o outro pelo nome e manda o pedido.
 * 2. O outro aceita (ou recusa). Se os dois pedirem um ao outro, vale como aceito.
 * 3. Amigos podem se convidar para a sala de batalha e assistir às partidas um do outro.
 *
 * Não há conexão aberta: a tela pergunta pela lista de tempos em tempos, e é
 * assim que o convite aparece para quem foi convidado.
 */

export type FriendshipStatus = 'pending' | 'accepted';

export interface FriendLink {
    id: string;
    requesterId: string;
    addresseeId: string;
    status: FriendshipStatus;
}

export interface PlayerRef {
    id: string;
    name: string;
}

export interface InviteRecord {
    id: string;
    roomCode: string;
    from: PlayerRef;
    createdAt: Date;
}

export interface FriendsStore {
    findUser(id: string): Promise<PlayerRef | null>;
    /** Jogadores (sem contas apagadas) cujo nome contém `query`, sem diferenciar maiúsculas. */
    searchUsers(query: string, excludeId: string, limit: number): Promise<PlayerRef[]>;
    /** A amizade entre os dois, em qualquer direção. */
    findLink(a: string, b: string): Promise<FriendLink | null>;
    findLinkById(id: string): Promise<FriendLink | null>;
    createRequest(requesterId: string, addresseeId: string): Promise<FriendLink>;
    accept(id: string): Promise<void>;
    remove(id: string): Promise<void>;
    /** Todas as amizades e pedidos do jogador, com o outro lado de cada um. */
    listLinks(userId: string): Promise<(FriendLink & { other: PlayerRef })[]>;
    /** A batalha em andamento de cada jogador da lista (o treino não conta). */
    liveBattles(userIds: string[]): Promise<Record<string, string>>;
    /** A sala pelo código. */
    findRoom(code: string): Promise<{ id: string; hostId: string; status: string } | null>;
    /** Cria (ou renova) o convite. */
    upsertInvite(roomId: string, fromId: string, toId: string): Promise<void>;
    /** Convites para salas que ainda esperam alguém, feitos depois de `since`. */
    invitesFor(userId: string, since: Date): Promise<InviteRecord[]>;
    /** Apaga o convite, só se for para `toId`. */
    deleteInvite(id: string, toId: string): Promise<void>;
}

export class FriendsError extends Error {
    constructor(
        readonly code: 'USER_NOT_FOUND' | 'SELF_FRIEND' | 'ALREADY_FRIENDS' | 'ALREADY_REQUESTED' | 'REQUEST_NOT_FOUND' | 'NOT_FRIENDS' | 'ROOM_NOT_FOUND' | 'ROOM_NOT_WAITING',
        readonly status: number,
        readonly messageKey: string,
    ) {
        super(messageKey);
    }
}

export interface FriendsView {
    friends: (PlayerRef & { battleId: string | null })[];
    /** Pedidos que o jogador recebeu e ainda não respondeu. */
    incoming: { requestId: string; user: PlayerRef }[];
    /** Pedidos que o jogador mandou e o outro ainda não respondeu. */
    outgoing: { requestId: string; user: PlayerRef }[];
    invites: InviteRecord[];
}

/** Convite mais velho que isto sai da lista (a sala provavelmente foi esquecida). */
const INVITE_MAX_AGE_MS = 30 * 60 * 1000;
const SEARCH_LIMIT = 10;

export class FriendsService {
    private now: () => Date;

    constructor(
        private store: FriendsStore,
        options: { now?: () => Date } = {},
    ) {
        this.now = options.now ?? (() => new Date());
    }

    async list(userId: string): Promise<FriendsView> {
        const links = await this.store.listLinks(userId);
        const friends = links.filter((link) => link.status === 'accepted').map((link) => link.other);
        const live = await this.store.liveBattles(friends.map((friend) => friend.id));

        return {
            friends: friends.map((friend) => ({ ...friend, battleId: live[friend.id] ?? null })).sort((a, b) => a.name.localeCompare(b.name)),
            incoming: links.filter((l) => l.status === 'pending' && l.addresseeId === userId).map((l) => ({ requestId: l.id, user: l.other })),
            outgoing: links.filter((l) => l.status === 'pending' && l.requesterId === userId).map((l) => ({ requestId: l.id, user: l.other })),
            invites: await this.invites(userId),
        };
    }

    /** Os convites para sala que o jogador recebeu. É a consulta que a tela repete. */
    async invites(userId: string): Promise<InviteRecord[]> {
        return this.store.invitesFor(userId, new Date(this.now().getTime() - INVITE_MAX_AGE_MS));
    }

    async search(userId: string, query: string): Promise<(PlayerRef & { status: 'none' | 'friend' | 'incoming' | 'outgoing' })[]> {
        const text = query.trim();

        if (text.length < 2) return [];

        const users = await this.store.searchUsers(text, userId, SEARCH_LIMIT);
        const links = await this.store.listLinks(userId);

        return users.map((user) => {
            const link = links.find((item) => item.other.id === user.id);
            const status = !link ? 'none' : link.status === 'accepted' ? 'friend' : link.requesterId === userId ? 'outgoing' : 'incoming';

            return { ...user, status };
        });
    }

    /** Manda o pedido. Se o outro já tinha pedido, a amizade é aceita aqui. */
    async request(userId: string, targetId: string): Promise<FriendsView> {
        if (userId === targetId) throw new FriendsError('SELF_FRIEND', 400, 'friends.self');
        if (!(await this.store.findUser(targetId))) throw new FriendsError('USER_NOT_FOUND', 404, 'friends.userNotFound');

        const link = await this.store.findLink(userId, targetId);

        if (link?.status === 'accepted') throw new FriendsError('ALREADY_FRIENDS', 409, 'friends.already');
        if (link && link.requesterId === userId) throw new FriendsError('ALREADY_REQUESTED', 409, 'friends.alreadyRequested');

        if (link) {
            await this.store.accept(link.id);
        } else {
            await this.store.createRequest(userId, targetId);
        }

        return this.list(userId);
    }

    async accept(userId: string, requestId: string): Promise<FriendsView> {
        const link = await this.store.findLinkById(requestId);

        if (!link || link.status !== 'pending' || link.addresseeId !== userId) throw new FriendsError('REQUEST_NOT_FOUND', 404, 'friends.requestNotFound');

        await this.store.accept(link.id);

        return this.list(userId);
    }

    /** Desfaz a amizade, recusa o pedido recebido ou cancela o pedido mandado. */
    async remove(userId: string, otherId: string): Promise<FriendsView> {
        const link = await this.store.findLink(userId, otherId);

        if (link) await this.store.remove(link.id);

        return this.list(userId);
    }

    async areFriends(a: string, b: string): Promise<boolean> {
        return (await this.store.findLink(a, b))?.status === 'accepted';
    }

    /** Quem pode assistir à batalha: amigo de algum dos jogadores. */
    async canWatch(viewerId: string, playerIds: string[]): Promise<boolean> {
        for (const playerId of playerIds) {
            if (playerId !== viewerId && (await this.areFriends(viewerId, playerId))) return true;
        }

        return false;
    }

    /** O anfitrião convida um amigo para a sala dele, enquanto ela espera alguém entrar. */
    async invite(userId: string, code: string, friendId: string): Promise<void> {
        const room = await this.store.findRoom(code.trim().toUpperCase());

        if (!room || room.hostId !== userId) throw new FriendsError('ROOM_NOT_FOUND', 404, 'friends.roomNotFound');
        if (room.status !== 'waiting') throw new FriendsError('ROOM_NOT_WAITING', 409, 'friends.roomNotWaiting');
        if (!(await this.areFriends(userId, friendId))) throw new FriendsError('NOT_FRIENDS', 403, 'friends.notFriends');

        await this.store.upsertInvite(room.id, userId, friendId);
    }

    async dismissInvite(userId: string, inviteId: string): Promise<void> {
        await this.store.deleteInvite(inviteId, userId);
    }
}
