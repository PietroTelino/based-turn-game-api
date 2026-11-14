import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { FriendsService } from '../friends.service';
import type { FriendLink, FriendsStore, InviteRecord, PlayerRef } from '../friends.service';

const USERS: PlayerRef[] = [
    { id: 'ana', name: 'Ana' },
    { id: 'bruno', name: 'Bruno' },
    { id: 'caio', name: 'Caio' },
];

/** Faz o papel do banco: amizades, salas, convites e batalhas em andamento. */
class MemoryFriends implements FriendsStore {
    links: FriendLink[] = [];
    rooms = [{ id: 'r1', code: 'SALA01', hostId: 'ana', status: 'waiting' }];
    invites: (InviteRecord & { toId: string; roomId: string })[] = [];
    live: Record<string, string> = {};

    async findUser(id: string) { return USERS.find((user) => user.id === id) ?? null; }
    async searchUsers(query: string, excludeId: string) { return USERS.filter((u) => u.id !== excludeId && u.name.toLowerCase().includes(query.toLowerCase())); }
    async findLink(a: string, b: string) { return this.links.find((l) => (l.requesterId === a && l.addresseeId === b) || (l.requesterId === b && l.addresseeId === a)) ?? null; }
    async findLinkById(id: string) { return this.links.find((l) => l.id === id) ?? null; }
    async createRequest(requesterId: string, addresseeId: string) {
        const link: FriendLink = { id: randomUUID(), requesterId, addresseeId, status: 'pending' };
        this.links.push(link);
        return link;
    }
    async accept(id: string) { this.links.find((l) => l.id === id)!.status = 'accepted'; }
    async remove(id: string) { this.links = this.links.filter((l) => l.id !== id); }
    async listLinks(userId: string) {
        return this.links
            .filter((l) => l.requesterId === userId || l.addresseeId === userId)
            .map((l) => ({ ...l, other: USERS.find((u) => u.id === (l.requesterId === userId ? l.addresseeId : l.requesterId))! }));
    }
    async liveBattles(ids: string[]) { return Object.fromEntries(Object.entries(this.live).filter(([id]) => ids.includes(id))); }
    async findRoom(code: string) { return this.rooms.find((room) => room.code === code) ?? null; }
    async upsertInvite(roomId: string, fromId: string, toId: string) {
        const room = this.rooms.find((r) => r.id === roomId)!;
        this.invites = this.invites.filter((i) => !(i.roomId === roomId && i.toId === toId));
        this.invites.push({ id: randomUUID(), roomId, roomCode: room.code, toId, from: USERS.find((u) => u.id === fromId)!, createdAt: new Date() });
    }
    async invitesFor(userId: string, since: Date) {
        return this.invites
            .filter((i) => i.toId === userId && i.createdAt >= since && this.rooms.find((r) => r.id === i.roomId)?.status === 'waiting')
            .map(({ toId: _to, roomId: _room, ...invite }) => invite);
    }
    async deleteInvite(id: string, toId: string) { this.invites = this.invites.filter((i) => !(i.id === id && i.toId === toId)); }
}

function setup() {
    const store = new MemoryFriends();

    return { store, service: new FriendsService(store) };
}

describe('FriendsService', () => {
    it('pedido, aceite e a lista dos dois lados', async () => {
        const { service } = setup();

        const sent = await service.request('ana', 'bruno');

        assert.deepEqual(sent.outgoing.map((r) => r.user.name), ['Bruno']);

        const received = await service.list('bruno');

        assert.equal(received.incoming.length, 1);
        await service.accept('bruno', received.incoming[0]!.requestId);

        assert.deepEqual((await service.list('ana')).friends.map((f) => f.name), ['Bruno']);
        assert.deepEqual((await service.list('bruno')).friends.map((f) => f.name), ['Ana']);
        assert.equal(await service.areFriends('ana', 'bruno'), true);
    });

    it('pedidos cruzados viram amizade; repetir ou pedir a si mesmo é recusado', async () => {
        const { service } = setup();

        await service.request('ana', 'caio');
        await assert.rejects(service.request('ana', 'caio'), /alreadyRequested/);
        await service.request('caio', 'ana');
        assert.equal(await service.areFriends('ana', 'caio'), true);
        await assert.rejects(service.request('ana', 'caio'), /friends.already/);
        await assert.rejects(service.request('ana', 'ana'), /self/);
        await assert.rejects(service.request('ana', 'ninguem'), /userNotFound/);
    });

    it('a busca diz a situação de cada jogador encontrado', async () => {
        const { service } = setup();

        await service.request('ana', 'bruno');

        assert.deepEqual(
            (await service.search('ana', 'a')).map((u) => [u.name, u.status]),
            [],
            'menos de 2 letras não busca',
        );
        assert.deepEqual((await service.search('ana', 'br')).map((u) => [u.name, u.status]), [['Bruno', 'outgoing']]);
        assert.deepEqual((await service.search('bruno', 'an')).map((u) => [u.name, u.status]), [['Ana', 'incoming']]);
    });

    it('só amigos convidam para a sala e assistem às batalhas', async () => {
        const { store, service } = setup();

        await assert.rejects(service.invite('ana', 'SALA01', 'bruno'), /notFriends/);

        await service.request('ana', 'bruno');
        await service.request('bruno', 'ana');
        await service.invite('ana', 'sala01', 'bruno');

        const invites = await service.invites('bruno');

        assert.deepEqual(invites.map((i) => [i.roomCode, i.from.name]), [['SALA01', 'Ana']]);
        await assert.rejects(service.invite('bruno', 'SALA01', 'ana'), /roomNotFound/, 'só o anfitrião convida');

        // A sala começou: o convite some.
        store.rooms[0]!.status = 'selecting';
        assert.deepEqual(await service.invites('bruno'), []);
        await assert.rejects(service.invite('ana', 'SALA01', 'bruno'), /roomNotWaiting/);

        store.live = { bruno: 'batalha-1' };
        assert.equal((await service.list('ana')).friends[0]?.battleId, 'batalha-1');
        assert.equal(await service.canWatch('ana', ['bruno', 'caio']), true);
        assert.equal(await service.canWatch('caio', ['ana', 'bruno']), false);
    });

    it('desfazer a amizade tira dos dois lados', async () => {
        const { service } = setup();

        await service.request('ana', 'bruno');
        await service.request('bruno', 'ana');
        await service.remove('bruno', 'ana');

        assert.deepEqual((await service.list('ana')).friends, []);
    });
});
