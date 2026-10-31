import type { ArenaId } from '../types';

/**
 * Uma fase da campanha: contra quem se luta e onde. O nome e a história de
 * cada fase ficam na tela (traduzidos), pela `key`.
 */
export interface CampaignStage {
    /** O número da fase, a partir de 1. A fase N só abre depois de vencer a N-1. */
    stage: number;
    /** O nome da fase nas traduções da tela. */
    key: string;
    arena: ArenaId;
    /** Os personagens do time inimigo, na ordem. */
    enemyTeam: string[];
}

/**
 * A campanha, em ordem. Vencer uma fase em qualquer nível de dificuldade abre
 * a seguinte.
 */
export const CAMPAIGN: readonly CampaignStage[] = [
    {
        // Um bando de saqueadores fecha a estrada da muralha: guerreiros, sem quem cure.
        stage: 1,
        key: 'muralha',
        arena: 'muralha',
        enemyTeam: ['barbaro', 'ladino', 'espadachim', 'arqueiro', 'xama'],
    },
    {
        // Na floresta, as criaturas da noite: sono, maldição, dreno de vida e mortos que voltam.
        stage: 2,
        key: 'floresta',
        arena: 'floresta',
        enemyTeam: ['sucubo', 'vampiro', 'necromante', 'banshee', 'harpia'],
    },
];

export function getCampaignStage(stage: number): CampaignStage | undefined {
    return CAMPAIGN.find((item) => item.stage === stage);
}
