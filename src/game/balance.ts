/**
 * Relatório de balanceamento: IA contra IA em todas as combinações de times.
 *
 *   npm run battle:balance
 *
 * Rode depois de mexer em personagens ou constantes. Se um personagem vence
 * muito mais (ou muito menos) que 50% das batalhas, ou se as batalhas ficaram
 * longas demais, os números precisam de ajuste.
 */
import { chooseAction } from './ai';
import { CHARACTERS } from './data/characters';
import { applyAction, createBattle } from './engine';
import type { CharacterDefinition, TeamId } from './types';

const TEAM_SIZE = 3;
const SEEDS = [1, 2, 3];
const TURN_LIMIT = 200;

/** Todas as formas de escolher `size` itens de uma lista, sem repetir. */
function combinations<T>(items: T[], size: number): T[][] {
    if (size === 0) return [[]];

    const [first, ...rest] = items;

    if (first === undefined) return [];

    return [
        ...combinations(rest, size - 1).map((combo) => [first, ...combo]),
        ...combinations(rest, size),
    ];
}

function main(): void {
    const teams = combinations<CharacterDefinition>(CHARACTERS, TEAM_SIZE);
    const record = new Map<string, { wins: number; battles: number }>();
    const teamWins: Record<TeamId, number> = { A: 0, B: 0 };

    let battles = 0;
    let unfinished = 0;
    let totalTurns = 0;
    let longest = 0;

    for (const teamA of teams) {
        for (const teamB of teams) {
            for (const seed of SEEDS) {
                let { state } = createBattle({ teamA, teamB, seed });

                while (state.winner === null && state.turn < TURN_LIMIT) {
                    state = applyAction(state, chooseAction(state)).state;
                }

                battles += 1;
                totalTurns += state.turn;
                longest = Math.max(longest, state.turn);

                if (state.winner === null) {
                    unfinished += 1;
                    continue;
                }

                teamWins[state.winner] += 1;

                for (const unit of state.units) {
                    const entry = record.get(unit.characterId) ?? { wins: 0, battles: 0 };

                    entry.battles += 1;
                    entry.wins += unit.team === state.winner ? 1 : 0;
                    record.set(unit.characterId, entry);
                }
            }
        }
    }

    console.log(`Batalhas simuladas: ${battles} (times de ${TEAM_SIZE})`);
    console.log(`Duração média: ${Math.round(totalTurns / battles)} turnos | mais longa: ${longest} turnos`);
    console.log(`Sem vencedor em ${TURN_LIMIT} turnos: ${unfinished}`);
    console.log(`Vitórias do time A: ${teamWins.A} | time B: ${teamWins.B}`);
    console.log('\nTaxa de vitória por personagem:');

    for (const character of CHARACTERS) {
        const entry = record.get(character.id) ?? { wins: 0, battles: 0 };
        const rate = entry.battles === 0 ? 0 : (100 * entry.wins) / entry.battles;

        console.log(`  ${character.name.padEnd(10)} ${rate.toFixed(1)}%`);
    }
}

main();
