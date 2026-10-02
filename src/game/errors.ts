/**
 * Erros de regra do jogo ("não é sua vez", "sem energia"...).
 *
 * O código é o que importa: na etapa das rotas ele vira uma chave de tradução
 * (ex.: game.errors.NOT_YOUR_TURN) e um status 400/409, do mesmo jeito que o
 * resto da API já faz com req.t().
 */
export type GameRuleErrorCode =
    | 'INVALID_SETUP'
    | 'BATTLE_OVER'
    | 'UNIT_NOT_FOUND'
    | 'NOT_YOUR_TURN'
    | 'SKILL_NOT_FOUND'
    | 'NOT_ENOUGH_ENERGY'
    | 'TARGET_REQUIRED'
    | 'INVALID_TARGET';

export class GameRuleError extends Error {
    readonly code: GameRuleErrorCode;

    constructor(code: GameRuleErrorCode, message?: string) {
        super(message ?? code);
        this.name = 'GameRuleError';
        this.code = code;
    }
}
