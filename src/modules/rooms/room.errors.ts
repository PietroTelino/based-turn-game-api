export type RoomErrorCode = 'ROOM_NOT_FOUND' | 'ROOM_FULL' | 'ROOM_CLOSED' | 'INVALID_ROOM_REQUEST';

/**
 * Erros do módulo de salas. `messageKey` é a chave de tradução em
 * locales/<idioma>/translation.json. Time inválido não é erro daqui: quem
 * confere o time é o módulo de batalhas, e o erro é o BattleError dele.
 */
export class RoomError extends Error {
    constructor(
        readonly code: RoomErrorCode,
        readonly status: number,
        readonly messageKey: string,
    ) {
        super(messageKey);
        this.name = 'RoomError';
    }
}
