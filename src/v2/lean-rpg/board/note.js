// Makes the narrator's settled account from the board's recorded lines.
// Every outcome and every bar movement is included, even in a long fight; one line is told as one
// [Happened] cue and is never cut. It reads the result only, so the preview and the receipt agree.

import { STAGES, stageWord } from '../names.js';

const clean = value => String(value ?? '').replace(/\s+/gu, ' ').trim();
export const barMovement = (damage, resource = false) => {
    const kind = resource ? (/:(mana|stamina)$/u.exec(damage.id)?.[1] ?? 'stamina') : 'health';
    return `${clean(damage.name)} ${kind} ${stageWord(STAGES[kind], damage.from, damage.size)} → ${stageWord(STAGES[kind], damage.to, damage.size)}`;
};

function lineNote(line) {
    const who = clean(line.pc?.who), foe = clean(line.foe?.name), skill = line.skill ? ` (${clean(line.skill)})` : '';
    const action = line.flee ? `${who} flees from ${foe}` : line.kind === 'foe' ? `${foe} attacks ${who}` : `${who} attacks ${foe}${skill}`;
    const result = line.outcome === 'cost' ? 'success at a cost' : line.outcome;
    const verdict = line.kind === 'foe' ? `${who}'s defence${skill}: ${result}` : result;
    const changes = [line.damage ? barMovement(line.damage) : '', line.cost ? barMovement(line.cost, true) : ''].filter(Boolean);
    return `${action}: ${verdict}${line.decisive ? ', decisive' : ''}${changes.length ? `; ${changes.join('; ')}` : ''}`;
}

/** A compact but complete list of settled outcomes and changes, followed by the fight's status. */
export function settledNote(result) {
    const lines = ['Tell these settled fight results before the reader’s action; do not reroll them.'];
    for (const line of result.opening ?? []) lines.push(`Opening: ${lineNote(line)}.`);
    const wear = Array.isArray(result.wear) ? result.wear : [], included = new Set();
    const wearNote = event => `${clean(event.who)}'s ${clean(event.item)} condition: ${clean(event.from)} → ${clean(event.to)}`;
    for (const round of result.rounds ?? []) {
        const changes = wear.flatMap((event, index) => {
            if (event.n !== round.n) return [];
            included.add(index);
            return [wearNote(event)];
        });
        lines.push(`Exchange ${round.n}: ${[...round.lines.map(lineNote), ...changes].join(' | ') || 'No one acted'}.`);
    }
    wear.forEach((event, index) => { if (!included.has(index)) lines.push(`Exchange ${event.n}: ${wearNote(event)}.`); });
    const end = { won: 'The fight is won. Code gives the party its XP.', lost: 'The fight is lost.', fled: 'The party fled.', open: 'The fight is still open.' };
    lines.push(end[result.stop] ?? 'The fight is still open.');
    return lines.join(' | ');
}
