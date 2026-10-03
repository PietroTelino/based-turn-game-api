/**
 * Batalha de demonstração no terminal: IA contra IA.
 *
 *   npm run battle:demo            (semente 1)
 *   npm run battle:demo -- 42      (outra semente = outra batalha)
 *
 * Repare que este arquivo só usa createBattle, applyAction e os eventos.
 * A tela do React vai fazer exatamente o mesmo, trocando console.log por animação.
 */
import { chooseAction } from './ai';
import { getCharacter } from './data/characters';
import { applyAction, createBattle, getUnit } from './engine';
import type { BattleEvent, BattleState, StatusKind } from './types';

const MAX_TURNS = 500;

const STATUS_NAMES: Record<StatusKind, string> = {
    stun: 'atordoamento',
    burn: 'queimadura',
    poison: 'veneno',
    shield: 'escudo',
    atk_up: 'ataque aumentado',
    atk_down: 'ataque reduzido',
    def_up: 'defesa aumentada',
    def_down: 'defesa reduzida',
    speed_up: 'velocidade aumentada',
    speed_down: 'velocidade reduzida',
};

function describe(state: BattleState, event: BattleEvent): string | null {
    const label = (unitId: string) => {
        const unit = getUnit(state, unitId);
        return `${unit.name} (${unit.team})`;
    };

    switch (event.type) {
        case 'turn_started':
            return `\n===== Turno ${event.turn} | energia de cada time: ${event.energy}${event.fury > 0 ? ` | fúria: dano +${Math.round(event.fury * 100)}%` : ''} | ordem: ${event.order.map(label).join(' > ')}`;

        case 'order_changed':
            return `  a ordem do turno mudou: ${event.order.map(label).join(' > ')}`;

        case 'unit_activated':
            return `\nVez de ${label(event.unitId)}`;

        case 'skill_used': {
            const skill = getUnit(state, event.unitId).skills.find((s) => s.id === event.skillId);
            const cost = skill && skill.energyCost > 0 ? ` (-${skill.energyCost} de energia)` : '';
            return `  usa ${skill?.name ?? event.skillId}${cost}`;
        }

        case 'damage': {
            const target = getUnit(state, event.targetId);
            const crit = event.critical ? ' CRÍTICO!' : '';
            const shield = event.absorbed > 0 ? ` (escudo absorveu ${event.absorbed})` : '';
            return `    ${label(event.targetId)} leva ${event.amount} de dano${crit}${shield} [${event.hp}/${target.stats.maxHp}]`;
        }

        case 'status_applied':
            return `    ${label(event.targetId)} recebe ${STATUS_NAMES[event.status]} por ${event.turns} turno(s)`;

        case 'status_damage': {
            const target = getUnit(state, event.targetId);
            return `  ${label(event.targetId)} sofre ${event.amount} de ${STATUS_NAMES[event.status]} [${event.hp}/${target.stats.maxHp}]`;
        }

        case 'status_expired':
            return `    ${STATUS_NAMES[event.status]} de ${label(event.unitId)} acabou`;

        case 'unit_skipped':
            return `  ${label(event.unitId)} está atordoado e perde a vez`;

        case 'passive_triggered': {
            const passive = getUnit(state, event.unitId).passives?.find((p) => p.id === event.passiveId);
            return `  passiva de ${label(event.unitId)}: ${passive?.name ?? event.passiveId}`;
        }

        case 'energy_gained':
            return `    o time ${event.team} recupera ${event.amount} de energia (agora tem ${event.energy})`;

        case 'surrendered':
            return `\nO time ${event.team} desistiu.`;

        // Evento técnico (a lista completa de status): não precisa aparecer no terminal.
        case 'statuses_changed':
            return null;

        case 'heal': {
            const target = getUnit(state, event.targetId);
            return `    ${label(event.targetId)} recupera ${event.amount} de vida [${event.hp}/${target.stats.maxHp}]`;
        }

        case 'unit_defeated':
            return `    ${label(event.unitId)} foi derrotado!`;

        case 'battle_ended':
            return `\nFim da batalha: vitória do time ${event.winner}!`;
    }
}

function main(): void {
    const seed = Number(process.argv[2] ?? 1);

    let { state, events } = createBattle({
        teamA: [getCharacter('piromante'), getCharacter('cavaleiro'), getCharacter('clerigo')],
        teamB: [getCharacter('barbaro'), getCharacter('criomante'), getCharacter('guardiao')],
        seed,
    });

    console.log(`Time A: ${state.units.filter((u) => u.team === 'A').map((u) => u.name).join(', ')}`);
    console.log(`Time B: ${state.units.filter((u) => u.team === 'B').map((u) => u.name).join(', ')}`);
    console.log(`Semente: ${seed}`);

    while (true) {
        for (const event of events) {
            const line = describe(state, event);

            if (line !== null) console.log(line);
        }

        if (state.winner !== null) {
            break;
        }

        if (state.turn >= MAX_TURNS) {
            console.log(`\nA batalha passou de ${MAX_TURNS} turnos sem vencedor.`);
            break;
        }

        ({ state, events } = applyAction(state, chooseAction(state)));
    }
}

main();
