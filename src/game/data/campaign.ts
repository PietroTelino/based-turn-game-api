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
    /** O chefe da fase: entra no lugar do personagem na posição `slot` do time inimigo (data/bosses.ts). */
    boss?: { slot: number; id: string };
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
    {
        // As sentinelas do lago: o Cavaleiro segura a linha, o gelo prende e o Sacerdote cura.
        stage: 3,
        key: 'lago',
        arena: 'lago-gelado',
        enemyTeam: ['cavaleiro', 'criomante', 'arqueiro', 'sacerdote', 'druida'],
    },
    {
        // A ordem que guarda a muralha: armaduras pesadas, luz e julgamento.
        stage: 4,
        key: 'ordem',
        arena: 'muralha',
        enemyTeam: ['paladino', 'inquisidora', 'cavaleiro', 'arqueiro', 'sacerdote'],
    },
    {
        // O bosque enfurecido: veneno, raízes, cura da natureza e asas.
        stage: 5,
        key: 'bosque',
        arena: 'floresta',
        enemyTeam: ['driade', 'druida', 'guardiao', 'xama', 'harpia'],
    },
    {
        // Os mortos da nevasca: gelo, mortos que voltam, maldição e dreno de vida.
        stage: 6,
        key: 'nevasca',
        arena: 'lago-gelado',
        enemyTeam: ['criomante', 'necromante', 'banshee', 'vampiro', 'ladino'],
        boss: { slot: 1, id: 'rei-lich' },
    },
    {
        // O torneio dos duelistas: só lâminas, com o Bardo empurrando o ritmo.
        stage: 7,
        key: 'torneio',
        arena: 'muralha',
        enemyTeam: ['espadachim', 'barbaro', 'ladino', 'bardo', 'inquisidora'],
    },
    {
        // O covil dos encantos: sono, voo e sangue.
        stage: 8,
        key: 'covil',
        arena: 'floresta',
        enemyTeam: ['sucubo', 'harpia', 'bardo', 'vampiro', 'druida'],
    },
    {
        // O conclave dos magos: fogo e gelo em área, sustentados por cura.
        stage: 9,
        key: 'conclave',
        arena: 'lago-gelado',
        enemyTeam: ['piromante', 'criomante', 'xama', 'bardo', 'sacerdote'],
    },
    {
        // A cruzada: linha de frente que não cai e cura sem parar.
        stage: 10,
        key: 'cruzada',
        arena: 'muralha',
        enemyTeam: ['paladino', 'inquisidora', 'guardiao', 'barbaro', 'sacerdote'],
    },
    {
        // O coração da floresta sombria: a noite inteira de volta, mais forte.
        stage: 11,
        key: 'coracao',
        arena: 'floresta',
        enemyTeam: ['necromante', 'banshee', 'sucubo', 'vampiro', 'driade'],
    },
    {
        // O trono de gelo: o último time, o melhor de cada lado.
        stage: 12,
        key: 'trono',
        arena: 'lago-gelado',
        enemyTeam: ['paladino', 'criomante', 'necromante', 'bardo', 'espadachim'],
        boss: { slot: 1, id: 'rainha-do-gelo' },
    },
];

export function getCampaignStage(stage: number): CampaignStage | undefined {
    return CAMPAIGN.find((item) => item.stage === stage);
}
