export type RoomErrorCode = 'ROOM_NOT_FOUND' | 'ROOM_FULL' | 'ROOM_CLOSED' | 'ROOM_NOT_DRAFTING' | 'INVALID_ROOM_REQUEST';

/**
 * Erros do módulo de salas. `messageKey` é a chave de tradução em
 * locales/<idioma>/translation.json. Escolha inválida na seleção não é erro
 * daqui: quem confere é a seleção da ranqueada, e o erro é o RankedError dela.
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
