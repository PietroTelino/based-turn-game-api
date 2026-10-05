import type { BattleState } from '../../game';
import type { BattlePick } from '../battles/battle.types';

/** Personagens que mudaram de id depois de batalhas já gravadas. */
const RENAMED: Record<string, string> = { clerigo: 'sacerdote' };

/**
 * Os personagens que cada jogador levou para uma batalha, lidos do estado
 * gravado. Serve para preencher as estatísticas das batalhas criadas antes
 * de a tabela de escolhas existir (ver backfill.ts); as novas já gravam as
 * escolhas ao serem criadas.
 *
 * - O time B só conta quando é de um jogador (`opponentId`): o da IA é sorteado.
 * - A batalha de treino não conta: o time do tutorial é sempre o mesmo.
 * - Uma unidade erguida como invocação (o Guerreiro Esqueleto) não diz mais
 *   quem ela era, então fica de fora: a batalha entra com um personagem a menos.
 */
export function picksFromState(battle: { userId: string; opponentId: string | null; state: BattleState }): BattlePick[] {
    if (battle.state.training) {
        return [];
    }

    const picks: BattlePick[] = [];

    for (const unit of battle.state.units ?? []) {
        const userId = unit.team === 'A' ? battle.userId : battle.opponentId;

        if (userId === null || unit.summoned) continue;

        picks.push({ userId, characterId: RENAMED[unit.characterId] ?? unit.characterId });
    }

    return picks;
}
