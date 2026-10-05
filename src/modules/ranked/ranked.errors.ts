export type RankedErrorCode = 'INVALID_RANKED_REQUEST' | 'ALREADY_IN_RANKED_BATTLE' | 'PLAYER_NOT_FOUND';

/**
 * Erros do módulo da ranqueada. `messageKey` é a chave de tradução em
 * locales/<idioma>/translation.json. Time inválido não é erro daqui: quem
 * confere o time é o módulo de batalhas, e o erro é o BattleError dele.
 */
export class RankedError extends Error {
    constructor(
        readonly code: RankedErrorCode,
        readonly status: number,
        readonly messageKey: string,
        /** Vai junto na resposta de erro (o id da partida em andamento, por exemplo). */
        readonly data: Record<string, string> = {},
    ) {
        super(messageKey);
        this.name = 'RankedError';
    }
}
