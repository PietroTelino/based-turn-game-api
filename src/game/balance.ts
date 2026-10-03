/**
 * Relatório de balanceamento: IA contra IA.
 *
 *   npm run battle:balance
 *
 * Rode depois de mexer em personagens ou constantes. Se um personagem vence
 * muito mais (ou muito menos) que 50% das batalhas, ou se as batalhas ficaram
 * longas demais, os números precisam de ajuste.
 *
 * Com poucos personagens ele simula todos os confrontos possíveis. Quando
 * são muitos (com 12 personagens há 48 mil pares de times), sorteia uma
 * amostra de MAX_BATTLES confrontos. O sorteio usa uma semente fixa, então o
 * relatório é sempre o mesmo para os mesmos números.
 */
import { chooseAction } from './ai';
import { CHARACTERS } from './data/characters';
import { applyAction, createBattle } from './engine';
import type { CharacterDefinition, TeamId } from './types';

const TEAM_SIZE = 3;
const SEEDS = [1, 2, 3];
const TURN_LIMIT = 200;
/** Acima disto o relatório sorteia uma amostra em vez de simular tudo. */
const MAX_BATTLES = 6000;

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

/** Gerador simples com semente fixa, só para escolher a amostra. */
function createSampler(seed: number): () => number {
    let state = seed >>> 0;

    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;

        return state / 0x100000000;
    };
}

/** Os confrontos a simular: todos, ou uma amostra quando são demais. */
function pickMatchups(teams: CharacterDefinition[][]): [CharacterDefinition[], CharacterDefinition[], number][] {
    const matchups: [CharacterDefinition[], CharacterDefinition[], number][] = [];

    if (teams.length * teams.length * SEEDS.length <= MAX_BATTLES) {
        for (const teamA of teams) {
            for (const teamB of teams) {
                for (const seed of SEEDS) matchups.push([teamA, teamB, seed]);
            }
        }

        return matchups;
    }

    const random = createSampler(2026);
    const pick = () => teams[Math.floor(random() * teams.length)] ?? [];

    for (let i = 0; i < MAX_BATTLES; i++) {
        matchups.push([pick(), pick(), i + 1]);
    }

    return matchups;
}

function main(): void {
    const teams = combinations<CharacterDefinition>(CHARACTERS, TEAM_SIZE);
    const matchups = pickMatchups(teams);
    const record = new Map<string, { wins: number; battles: number }>();
    const teamWins: Record<TeamId, number> = { A: 0, B: 0 };

    let battles = 0;
    let unfinished = 0;
    let totalTurns = 0;
    let longest = 0;

    for (const [teamA, teamB, seed] of matchups) {
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

    const possible = teams.length * teams.length * SEEDS.length;

    console.log(`Batalhas simuladas: ${battles} de ${possible} possíveis (times de ${TEAM_SIZE})`);
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
