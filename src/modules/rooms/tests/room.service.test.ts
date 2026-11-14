import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BattleService } from '../../battles/battle.service';
import { InMemoryBattleStore } from '../../battles/tests/in-memory-store';
import { DRAFT_ORDER, DRAFT_TURN_MS } from '../../ranked/ranked.draft';
import { RankedError } from '../../ranked/ranked.errors';
import type { RankedErrorCode } from '../../ranked/ranked.errors';
import { RankedService } from '../../ranked/ranked.service';
import { InMemoryRankedStore } from '../../ranked/tests/in-memory-ranked-store';
import { RoomError } from '../room.errors';
import type { RoomErrorCode } from '../room.errors';
import { RoomService } from '../room.service';
import { InMemoryRoomStore } from './in-memory-room-store';

const ANA = 'ana-id';
const BRUNO = 'bruno-id';
const CAIO = 'caio-id';

const ANA_TEAM = ['barbaro', 'criomante', 'guardiao', 'sacerdote', 'arqueiro'];
const BRUNO_TEAM = ['cavaleiro', 'ladino', 'vampiro', 'driade', 'banshee'];

/**
 * Salas, seleção e batalhas em memória, com os serviços de verdade ligados
 * como no jogo. O relógio só anda quando o teste manda.
 */
function setup() {
    const clock = { now: new Date('2026-10-03T12:00:00Z').getTime() };
    const now = () => new Date(clock.now);
    const battleStore = new InMemoryBattleStore(now);
    const battles = new BattleService(battleStore, () => 0, { now });
    const ranked = new RankedService(new InMemoryRankedStore(battleStore, [ANA, BRUNO, CAIO], now), battles, { now, random: () => 0 });
    const rooms = new InMemoryRoomStore({ [ANA]: 'Ana', [BRUNO]: 'Bruno', [CAIO]: 'Caio' });
    const codes = ['SALA01', 'SALA02', 'SALA03', 'SALA04'];
    const service = new RoomService(rooms, ranked, { now, newCode: () => codes.shift() ?? 'ACABOU' });

    return { clock, battleStore, battles, rooms, service };
}

function rejectsWith(promise: Promise<unknown>, code: RoomErrorCode): Promise<void> {
    return assert.rejects(promise, (error: unknown) => error instanceof RoomError && error.code === code, code);
}

function rejectsWithRanked(promise: Promise<unknown>, code: RankedErrorCode): Promise<void> {
    return assert.rejects(promise, (error: unknown) => error instanceof RankedError && error.code === code, code);
}

/** A Ana cria a sala e o Bruno entra. */
async function roomWithTwo() {
    const context = setup();
    const { code } = await context.service.create(ANA);

    await context.service.join(BRUNO, code);

    return { ...context, code };
}

/** Joga a seleção inteira: a Ana bane o Necromante, o Bruno o Druida, e cada um escolhe o seu time, na ordem. */
async function draftThrough(service: RoomService, code: string) {
    const bans = { A: 'necromante', B: 'druida' };
    const teams = { A: ANA_TEAM, B: BRUNO_TEAM };
    const used = { A: 0, B: 0 };
    let last = await service.get(ANA, code);

    for (const step of DRAFT_ORDER) {
        const player = step.team === 'A' ? ANA : BRUNO;
        const characterId = step.kind === 'ban' ? bans[step.team] : teams[step.team][used[step.team]++]!;

        last = await service.draftAction(player, code, characterId);
    }

    return last;
}

describe('RoomService: criar e entrar', () => {
    it('quem cria vira anfitrião de uma sala vazia, com um código para passar adiante', async () => {
        const { service } = setup();
        const room = await service.create(ANA);

        assert.deepEqual(
            { code: room.code, status: room.status, role: room.role, opponent: room.opponent, draft: room.draft, battleId: room.battleId },
            { code: 'SALA01', status: 'waiting', role: 'host', opponent: null, draft: null, battleId: null },
        );
    });

    it('o outro jogador entra pelo código, do jeito que digitar, e cada um passa a ver o nome do outro', async () => {
        const { service } = setup();
        const { code } = await service.create(ANA);
        const joined = await service.join(BRUNO, '  sala01 ');
        const host = await service.get(ANA, code);

        assert.deepEqual([joined.role, joined.status, joined.opponent], ['guest', 'selecting', { name: 'Ana' }]);
        assert.deepEqual([host.role, host.status, host.opponent], ['host', 'selecting', { name: 'Bruno' }]);
    });

    it('a sala é só dos dois: um terceiro não entra nem consegue olhar', async () => {
        const { service } = setup();
        const { code } = await service.create(ANA);

        await rejectsWith(service.get(BRUNO, code), 'ROOM_NOT_FOUND');
        await service.join(BRUNO, code);
        await rejectsWith(service.join(CAIO, code), 'ROOM_FULL');
        await rejectsWith(service.get(CAIO, code), 'ROOM_NOT_FOUND');
        await rejectsWith(service.join(CAIO, 'NAOEXISTE'), 'ROOM_NOT_FOUND');
    });

    it('dois tentando entrar ao mesmo tempo: só um consegue', async () => {
        const { service } = setup();
        const { code } = await service.create(ANA);
        const results = await Promise.allSettled([service.join(BRUNO, code), service.join(CAIO, code)]);

        assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
    });

    it('quem já está na sala e entra de novo pelo código só recebe a sala de volta', async () => {
        const { service, code } = await roomWithTwo();

        assert.equal((await service.join(ANA, code)).role, 'host');
        assert.equal((await service.join(BRUNO, code)).role, 'guest');
    });

    it('a lista mostra as salas esperando alguém, menos a do próprio jogador, as cheias e as antigas', async () => {
        const { service, clock } = setup();

        await service.create(ANA);
        await service.create(BRUNO);

        assert.deepEqual((await service.listOpen(CAIO)).map((r) => r.hostName).sort(), ['Ana', 'Bruno']);
        assert.deepEqual((await service.listOpen(ANA)).map((r) => r.hostName), ['Bruno'], 'a própria sala não aparece');

        await service.join(CAIO, 'SALA01');
        assert.deepEqual((await service.listOpen(CAIO)).map((r) => r.hostName), ['Bruno'], 'sala cheia sai da lista');

        // A sala em memória marca a criação no relógio de verdade.
        clock.now = Date.now() + 31 * 60 * 1000;
        assert.deepEqual(await service.listOpen(CAIO), [], 'sala esquecida aberta sai da lista depois de meia hora');
    });

    it('criar outra sala fecha a anterior do mesmo anfitrião', async () => {
        const { service } = setup();
        const first = await service.create(ANA);

        await service.join(BRUNO, first.code);

        const second = await service.create(ANA);

        assert.notEqual(second.code, first.code);
        assert.equal((await service.get(BRUNO, first.code)).status, 'closed', 'o convidado da sala antiga fica sabendo');
        await rejectsWith(service.join(CAIO, first.code), 'ROOM_CLOSED');
    });
});

describe('RoomService: a seleção de personagens', () => {
    it('quando o convidado entra começa a seleção, a mesma da ranqueada: o anfitrião é o time A e bane primeiro', async () => {
        const { service, code } = await roomWithTwo();
        const host = await service.get(ANA, code);
        const guest = await service.get(BRUNO, code);

        assert.ok(host.draft && guest.draft);
        assert.equal(host.draft.id, guest.draft.id, 'os dois estão na mesma seleção');
        assert.deepEqual([host.draft.you, guest.draft.you], ['A', 'B']);
        // (os nomes vêm da tabela de usuários; a fila em memória devolve os ids)
        assert.deepEqual(host.draft.players, { A: ANA, B: BRUNO });
        assert.deepEqual(host.draft.current && [host.draft.current.team, host.draft.current.kind], ['A', 'ban']);
        assert.ok(host.draft.choices.length > 0, 'na vez da Ana, ela recebe o que pode banir');
        assert.deepEqual(guest.draft.choices, [], 'fora da vez, nada');
    });

    it('a sala que espera alguém não tem seleção', async () => {
        const { service } = setup();
        const { code } = await service.create(ANA);

        assert.equal((await service.get(ANA, code)).draft, null);
        await rejectsWith(service.draftAction(ANA, code, 'barbaro'), 'ROOM_NOT_DRAFTING');
    });

    it('cada um só joga na sua vez, e o banido não pode ser escolhido', async () => {
        const { service, code } = await roomWithTwo();

        await rejectsWithRanked(service.draftAction(BRUNO, code, 'necromante'), 'NOT_YOUR_DRAFT_TURN');

        const banned = await service.draftAction(ANA, code, 'necromante');

        assert.deepEqual(banned.draft?.banned, ['necromante']);
        await service.draftAction(BRUNO, code, 'druida');
        await rejectsWithRanked(service.draftAction(ANA, code, 'druida'), 'INVALID_DRAFT_CHOICE');
    });

    it('no fim da seleção a batalha começa, casual (sem pontos), com os times escolhidos', async () => {
        const { service, battles, battleStore, code } = await roomWithTwo();
        const last = await draftThrough(service, code);

        assert.equal(last.status, 'started');
        assert.ok(last.battleId);
        assert.equal(last.draft, null);
        assert.equal((await service.get(BRUNO, code)).battleId, last.battleId, 'os dois recebem a mesma batalha');

        const asHost = await battles.get(ANA, last.battleId);
        const idsOf = (team: string) => asHost.state.units.filter((u) => u.team === team).map((u) => u.characterId);

        assert.deepEqual([asHost.mode, asHost.playerTeam, (await battles.get(BRUNO, last.battleId)).playerTeam], ['pvp', 'A', 'B']);
        assert.deepEqual(idsOf('A').sort(), [...ANA_TEAM].sort());
        assert.deepEqual(idsOf('B').sort(), [...BRUNO_TEAM].sort());
        assert.equal((await battleStore.findById(last.battleId))?.ranked, false, 'partida de sala não vale pontos');
    });

    it('quem deixa o tempo acabar recebe uma escolha ao acaso, quando alguém pergunta pela sala', async () => {
        const { service, clock, code } = await roomWithTwo();

        clock.now += DRAFT_TURN_MS + 1;

        const view = await service.get(BRUNO, code);

        assert.equal(view.draft?.actions.length, 1);
        assert.equal(view.draft?.actions[0]?.auto, true);
        assert.deepEqual(view.draft?.current && [view.draft.current.team, view.draft.current.kind], ['B', 'ban']);
    });

    it('o convidado sai no meio da seleção: a sala volta a esperar e quem entrar começa uma seleção nova', async () => {
        const { service, code } = await roomWithTwo();
        const before = (await service.draftAction(ANA, code, 'necromante')).draft?.id;

        await service.leave(BRUNO, code);

        const host = await service.get(ANA, code);

        assert.deepEqual([host.status, host.opponent, host.draft], ['waiting', null, null]);
        await rejectsWith(service.get(BRUNO, code), 'ROOM_NOT_FOUND');

        const newcomer = await service.join(CAIO, code);

        assert.ok(newcomer.draft);
        assert.notEqual(newcomer.draft.id, before);
        assert.deepEqual(newcomer.draft.actions, [], 'nada do Bruno fica para trás');
    });

    it('o anfitrião sai e a sala fecha para os dois', async () => {
        const { service, code } = await roomWithTwo();

        await service.leave(ANA, code);

        const guest = await service.get(BRUNO, code);

        assert.deepEqual([guest.status, guest.draft], ['closed', null]);
        await rejectsWith(service.draftAction(BRUNO, code, 'necromante'), 'ROOM_CLOSED');
    });

    it('sair da sala depois que a batalha começou não desfaz nada', async () => {
        const { service, code } = await roomWithTwo();

        await draftThrough(service, code);
        await service.leave(ANA, code);
        await service.leave(BRUNO, code);

        const room = await service.get(BRUNO, code);

        assert.equal(room.status, 'started');
        assert.ok(room.battleId);
    });
});
