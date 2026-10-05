export type BattleErrorCode =
    | 'BATTLE_NOT_FOUND'
    | 'INVALID_TEAM'
    | 'UNKNOWN_CHARACTER'
    | 'INVALID_ACTION'
    | 'NOT_YOUR_UNIT'
    | 'BATTLE_CONFLICT'
    | 'REPLAY_UNAVAILABLE'
    | 'TIMEOUT_NOT_ALLOWED'
    | 'TIMEOUT_TOO_EARLY';

/**
 * Erros do módulo de batalhas que não são regra do jogo (esses são GameRuleError).
 * `messageKey` é a chave de tradução em locales/<idioma>/translation.json.
 */
export class BattleError extends Error {
    constructor(
        readonly code: BattleErrorCode,
        readonly status: number,
        readonly messageKey: string,
        readonly params: Record<string, string> = {},
    ) {
        super(messageKey);
        this.name = 'BattleError';
    }
}
