import { TEAM_SIZE } from '../battles/battle.service';
import type { CharacterCount, CharacterStats, StatsStore, UsageRanking } from './stats.types';

/**
 * Estatísticas de uso dos personagens: os que o jogador mais leva para as
 * batalhas e os mais usados do jogo todo.
 *
 * Contam os times montados por jogadores, contra a IA ou contra outro
 * jogador. O time sorteado para a IA e a batalha de treino do tutorial não
 * entram (não são escolha de ninguém). A lista do jogo todo é só a soma das
 * escolhas de todos: não diz quem escolheu o quê.
 */
export class StatsService {
    constructor(
        private store: StatsStore,
        /** Quantos personagens tem um time. Só os testes trocam. */
        private teamSize: number = TEAM_SIZE,
    ) {}

    async characters(userId: string): Promise<CharacterStats> {
        const [mine, global] = await Promise.all([this.store.countPicks(userId), this.store.countPicks()]);

        return { mine: this.toRanking(mine), global: this.toRanking(global) };
    }

    private toRanking(counts: CharacterCount[]): UsageRanking {
        const total = counts.reduce((sum, item) => sum + item.picks, 0);
        // Cada time tem `teamSize` personagens diferentes, então o total de
        // escolhas dividido por isso é o número de times montados.
        const teams = Math.ceil(total / this.teamSize);

        return {
            teams,
            characters: counts
                .filter((item) => item.picks > 0)
                // Do mais usado para o menos; no empate, em ordem alfabética, para a lista não mudar de ordem à toa.
                .sort((a, b) => b.picks - a.picks || a.characterId.localeCompare(b.characterId))
                .map((item) => ({ characterId: item.characterId, picks: item.picks, share: teams === 0 ? 0 : Math.min(1, item.picks / teams) })),
        };
    }
}
