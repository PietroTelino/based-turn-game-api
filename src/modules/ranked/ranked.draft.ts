import type { TeamId } from '../../game';

/**
 * A seleção de personagens da ranqueada (o "draft"): depois do pareamento, os
 * dois jogadores montam os times à vista um do outro, um passo de cada vez.
 *
 * 1. Cada um bane um personagem (primeiro o time A, depois o B). O banido não
 *    pode ser escolhido por ninguém.
 * 2. Depois escolhem alternando, na ordem A, B, B, A, A, B, B, A, A, B: quem
 *    começa tem a primeira escolha, mas o outro responde com duas.
 *
 * Os dois times podem ter o mesmo personagem; dentro de um time, não repete.
 * Cada passo tem DRAFT_TURN_MS: se o tempo acaba, o jogo escolhe ao acaso
 * pelo jogador. Este arquivo só tem as regras; quem guarda e cronometra é o
 * RankedService.
 */

/** Quanto tempo cada jogador tem em cada passo. */
export const DRAFT_TURN_MS = 30_000;

export type DraftKind = 'ban' | 'pick';

/** Um passo da seleção: de quem é a vez e o que ele faz. */
export interface DraftStep {
    team: TeamId;
    kind: DraftKind;
}

/** A ordem completa: dois banimentos e dez escolhas. */
export const DRAFT_ORDER: readonly DraftStep[] = [
    { team: 'A', kind: 'ban' },
    { team: 'B', kind: 'ban' },
    ...(['A', 'B', 'B', 'A', 'A', 'B', 'B', 'A', 'A', 'B'] as const).map((team) => ({ team, kind: 'pick' as const })),
];

/** O que foi feito num passo. `auto`: o tempo acabou e o jogo escolheu pelo jogador. */
export interface DraftAction {
    team: TeamId;
    kind: DraftKind;
    characterId: string;
    auto: boolean;
}

/** Por que uma escolha não vale (é a chave da mensagem em ranked.draft.*). */
export type DraftRefusal = 'unknownCharacter' | 'banned' | 'alreadyBanned' | 'alreadyPicked';

/** O passo da vez, ou `null` quando a seleção acabou. */
export function currentStep(actions: readonly DraftAction[]): (DraftStep & { index: number }) | null {
    const step = DRAFT_ORDER[actions.length];

    return step ? { ...step, index: actions.length } : null;
}

/** Os personagens banidos, na ordem. */
export function bannedOf(actions: readonly DraftAction[]): string[] {
    return actions.filter((action) => action.kind === 'ban').map((action) => action.characterId);
}

/** O time escolhido até agora, na ordem das escolhas (é a ordem em que entram em campo). */
export function teamOf(actions: readonly DraftAction[], team: TeamId): string[] {
    return actions.filter((action) => action.kind === 'pick' && action.team === team).map((action) => action.characterId);
}

/** `null` se `characterId` vale no passo da vez; senão, o motivo. */
export function refusalOf(actions: readonly DraftAction[], characterId: string, allIds: readonly string[]): DraftRefusal | null {
    const step = currentStep(actions);

    if (!allIds.includes(characterId)) return 'unknownCharacter';
    if (!step) return null;

    const banned = bannedOf(actions);

    if (step.kind === 'ban') {
        return banned.includes(characterId) ? 'alreadyBanned' : null;
    }

    if (banned.includes(characterId)) return 'banned';
    if (teamOf(actions, step.team).includes(characterId)) return 'alreadyPicked';

    return null;
}

/** As escolhas que valem no passo da vez (vazio quando a seleção acabou). */
export function choicesOf(actions: readonly DraftAction[], allIds: readonly string[]): string[] {
    return currentStep(actions) ? allIds.filter((id) => refusalOf(actions, id, allIds) === null) : [];
}
