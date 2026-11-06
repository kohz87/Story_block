// Makes the narrator's settled account from the board's recorded lines.
// Every outcome and every bar movement is included, even in a long fight; one line is told as one
// [Happened] cue and is never cut. It reads the result only, so the preview and the receipt agree.

import { STAGES, stageWord } from '../names.js';

const clean = value => String(value ?? '').replace(/\s+/gu, ' ').trim();
const word = (damage, resource = false) => {
    const kind = resource ? (/:(mana|stamina)$/u.exec(damage.id)?.[1] ?? 'stamina') : 'health';
    return `${clean(damage.name)} ${kind} ${stageWord(STAGES[kind], damage.from, damage.size)} → ${stageWord(STAGES[kind], damage.to, damage.size)}`;
};

function lineNote(line) {
    const who = clean(line.pc?.who), foe = clean(line.foe?.name), skill = line.skill ? ` (${clean(line.skill)})` : '';
    const action = line.flee ? `${who} flees from ${foe}` : line.kind === 'foe' ? `${foe} attacks ${who}${skill}` : `${who} attacks ${foe}${skill}`;
    const result = line.outcome === 'cost' ? 'success at a cost' : line.outcome;
    const changes = [line.damage ? word(line.damage) : '', line.cost ? word(line.cost, true) : ''].filter(Boolean);
    return `${action}: ${result}${line.decisive ? ', decisive' : ''}${changes.length ? `; ${changes.join('; ')}` : ''}`;
}

/** A compact but complete list of settled outcomes and changes, followed by the fight's status. */
export function settledNote(result) {
    const lines = ['Tell these settled fight results before the reader’s action; do not reroll them.'];
    for (const line of result.opening ?? []) lines.push(`Opening: ${lineNote(line)}.`);
    for (const round of result.rounds ?? []) lines.push(`Exchange ${round.n}: ${round.lines.map(lineNote).join(' | ') || 'No one acted'}.`);
    const end = { won: 'The fight is won. Code gives the party its XP.', lost: 'The fight is lost.', fled: 'The party fled.', open: 'The fight is still open.' };
    lines.push(end[result.stop] ?? 'The fight is still open.');
    return lines.join(' | ');
}
