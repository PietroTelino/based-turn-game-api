import type { AiDifficulty } from '../../game';

/**
 * O conteúdo da progressão: personagens iniciais, conquistas, preços da loja e
 * o ouro de cada batalha. Para equilibrar o jogo, é só mexer aqui.
 */

/** Personagens que todo jogador já tem desde o começo. */
export const STARTER_CHARACTERS = ['piromante', 'cavaleiro', 'sacerdote', 'barbaro', 'criomante', 'arqueiro'] as const;

/** O que se conta para saber o progresso de uma conquista. */
export type AchievementMetric =
    | { kind: 'wins' } // vitórias em qualquer partida (fora o treino)
    | { kind: 'played' } // partidas terminadas (fora o treino)
    | { kind: 'winsHard' } // vitórias contra a IA no difícil
    | { kind: 'campaign' } // maior fase da campanha vencida
    | { kind: 'campaignHard' } // maior fase da campanha vencida no difícil
    | { kind: 'pvpWins' } // vitórias contra outros jogadores (salas e ranqueada)
    | { kind: 'rankedWins' } // vitórias na ranqueada
    | { kind: 'characterWins'; characterId: string }; // vitórias levando este personagem

export interface AchievementReward {
    gold?: number;
    diamonds?: number;
    /** Personagem desbloqueado. Se o jogador já tiver comprado, recebe `refund` de ouro no lugar. */
    character?: string;
}

export interface Achievement {
    id: string;
    metric: AchievementMetric;
    goal: number;
    reward: AchievementReward;
}

/** Ouro devolvido quando a conquista dá um personagem que o jogador já tem. */
export const CHARACTER_REFUND_GOLD = 300;

export const ACHIEVEMENTS: Achievement[] = [
    { id: 'primeira-vitoria', metric: { kind: 'wins' }, goal: 1, reward: { gold: 100 } },
    { id: 'aquecendo', metric: { kind: 'played' }, goal: 10, reward: { gold: 150 } },
    { id: 'cinco-vitorias', metric: { kind: 'wins' }, goal: 5, reward: { gold: 50, character: 'ladino' } },
    { id: 'quinze-vitorias', metric: { kind: 'wins' }, goal: 15, reward: { gold: 100, character: 'bardo' } },
    { id: 'quarenta-vitorias', metric: { kind: 'wins' }, goal: 40, reward: { gold: 200, character: 'guardiao' } },
    { id: 'cem-vitorias', metric: { kind: 'wins' }, goal: 100, reward: { gold: 500, diamonds: 20 } },
    { id: 'desafio-aceito', metric: { kind: 'winsHard' }, goal: 1, reward: { gold: 100, character: 'inquisidora' } },
    { id: 'mestre-do-dificil', metric: { kind: 'winsHard' }, goal: 10, reward: { gold: 200, character: 'vampiro' } },
    { id: 'campanha-1', metric: { kind: 'campaign' }, goal: 1, reward: { gold: 100, character: 'driade' } },
    { id: 'campanha-3', metric: { kind: 'campaign' }, goal: 3, reward: { gold: 150, character: 'paladino' } },
    { id: 'campanha-completa', metric: { kind: 'campaign' }, goal: 12, reward: { gold: 300, character: 'necromante' } },
    { id: 'campanha-lendaria', metric: { kind: 'campaignHard' }, goal: 12, reward: { gold: 500, diamonds: 25 } },
    { id: 'primeiro-duelo', metric: { kind: 'pvpWins' }, goal: 1, reward: { gold: 100, character: 'harpia' } },
    { id: 'duelista', metric: { kind: 'pvpWins' }, goal: 10, reward: { gold: 200, character: 'sucubo' } },
    { id: 'estreia-ranqueada', metric: { kind: 'rankedWins' }, goal: 1, reward: { gold: 150, character: 'espadachim' } },
    { id: 'escalada', metric: { kind: 'rankedWins' }, goal: 10, reward: { gold: 300, character: 'banshee' } },
    { id: 'senhor-do-gelo', metric: { kind: 'characterWins', characterId: 'criomante' }, goal: 10, reward: { gold: 100, character: 'xama' } },
    { id: 'voz-da-cura', metric: { kind: 'characterWins', characterId: 'sacerdote' }, goal: 10, reward: { gold: 100, character: 'druida' } },
];

/** Preços da loja, por faixa: quanto mais difícil a conquista que o libera, mais caro. */
const TIERS = {
    1: { gold: 600, diamonds: 30 },
    2: { gold: 1200, diamonds: 60 },
    3: { gold: 2500, diamonds: 120 },
} as const;

const TIER_OF: Record<string, keyof typeof TIERS> = {
    ladino: 1, driade: 1, harpia: 1, inquisidora: 1,
    bardo: 2, paladino: 2, espadachim: 2, xama: 2, druida: 2,
    guardiao: 3, vampiro: 3, necromante: 3, sucubo: 3, banshee: 3,
};

export function priceOf(characterId: string): { gold: number; diamonds: number } | null {
    const tier = TIER_OF[characterId];

    return tier ? TIERS[tier] : null;
}

/** Ouro de uma batalha terminada, para um jogador. O treino não paga nada. */
export function battleGold(input: { won: boolean; versus: boolean; ranked: boolean; difficulty: AiDifficulty | null; campaign: boolean }): number {
    if (!input.won) return 10;
    if (input.ranked) return 60;
    if (input.versus) return 50;

    const base = input.difficulty === 'hard' ? 60 : input.difficulty === 'easy' ? 25 : 40;

    return input.campaign ? Math.round(base * 1.5) : base;
}
