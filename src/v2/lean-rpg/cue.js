// The [Rolls] cue (SPEC_RPG_v1 §4.5.3 step 5): what the narrator is told under [Happened], and what a refused action
// says. Short lines, one per roll; the numbers are always "the party member's total vs the foe's (or the difficulty)".
// Model-facing text, kept to the cue budget (names.js LIMITS.cueTokens).
import { BATTLE_MARKER, LIMITS } from './names.js';

export const OUTCOME_WORD = Object.freeze({ success: 'SUCCESS', cost: 'SUCCESS AT A COST', fail: 'FAIL' });

/** Tokens as the prompt budget counts them (§5): about four characters each. */
export const cueTokens = text => Math.ceil(String(text ?? '').length / 4);

const numbers = line => `(${line.pc.total} vs ${line.kind === 'check' ? line.dc : line.foe.total})`;
const skillOf = line => (line.skill ? ` (${line.skill})` : '');

/** One roll as one line: "Wessel → Sluice Rat A (Iron Breath): SUCCESS (26 vs 16)". */
export function lineText(line) {
    const word = OUTCOME_WORD[line.outcome];
    if (line.kind === 'check') return `${line.pc.who} — ${line.skill ?? line.pc.stat.toUpperCase()} (${line.pc.stat.toUpperCase()}), ${line.difficulty}: ${word} ${numbers(line)}`;
    if (line.kind === 'foe') return `${line.foe.name} attacks ${line.pc.who}: ${word} for ${line.pc.who} ${numbers(line)}`;
    return `${line.pc.who} → ${line.foe.name}${skillOf(line)}: ${word} ${numbers(line)}`;
}

const STOP_POINTS = 'Stop earlier at the first stop point (a foe falls, flees or yields; anyone on your side is Down or Badly wounded; new foes arrive).';

/**
 * The cue for `rounds` (the first `count` of them) and the checks: `{ checks: [line], rounds: [{ n, decisive, lines }],
 * refused: [text], decisive }`. `decisive`: whether the last round told is the one that settles the fight.
 */
export function cueText({ checks, rounds, refused, decisive }) {
    const fight = rounds.length > 0;
    const head = fight
        ? `[Rolls] Code rolled these. Tell them in this order and as given, and never invent a roll; write ${BATTLE_MARKER} on its own line where the fight is told.`
        : '[Rolls] Code rolled these. Tell them as given, and never invent a roll.';
    const lines = [head];
    for (const line of checks) lines.push(lineText(line));
    for (const round of rounds) for (const line of round.lines) lines.push(`Round ${round.n}: ${lineText(line)}`);
    for (const text of refused) lines.push(text);
    if (fight) lines.push(`Round ${rounds.at(-1).n} is ${decisive ? 'decisive' : 'the last rolled'}: stop there at the latest. ${STOP_POINTS}`);
    return lines.join('\n');
}

export const NO_ROLLS_LINE = 'No rolls this reply: keep the fight undecided, one exchange, nobody goes Down.';

/** How many rounds fit the cue budget: all of `rounds`, or fewer (never fewer than one). */
export function roundsThatFit(parts, budget = LIMITS.cueTokens) {
    let count = parts.rounds.length;
    while (count > 1 && cueTokens(cueText({ ...parts, rounds: parts.rounds.slice(0, count), decisive: parts.decisive && count === parts.rounds.length })) > budget) count -= 1;
    return count;
}
