// The [Rolls] cue (SPEC_RPG_v1 §4.5.3 step 5): what the narrator is told under [Happened], and what a refused action
// says. Short lines, one per roll; the numbers are always "the party member's total vs the foe's (or the difficulty)".
// Model-facing text, kept to the cue budget (names.js LIMITS.cueTokens).
import { BATTLE_MARKER, LIMITS } from './names.js';

export const OUTCOME_WORD = Object.freeze({ success: 'SUCCESS', cost: 'SUCCESS AT A COST', fail: 'FAIL' });

/** Tokens as the prompt budget counts them (§5): about four characters each. */
export const cueTokens = text => Math.ceil(String(text ?? '').length / 4);

const numbers = line => `(${line.pc.total} vs ${line.kind === 'check' ? line.dc : line.foe.total})`;

// Names are cut at this many characters only as the last way to fit the cue (shape 3 below).
const NAME_CUT = 20;
const cut = (text, max) => (max && text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * One roll as one line: "Wessel → Sluice Rat A (Iron Breath): SUCCESS (26 vs 16)". `compact`: a check without its skill and stat;
 * `names`: the longest a name may be (0: as written).
 */
export function lineText(line, { compact = false, names = 0 } = {}) {
    const word = OUTCOME_WORD[line.outcome];
    const who = cut(line.pc.who, names);
    if (line.kind === 'check') {
        if (compact) return `${who} — ${line.difficulty} check: ${word} ${numbers(line)}`;
        return `${who} — ${cut(line.skill ?? line.pc.stat.toUpperCase(), names)} (${line.pc.stat.toUpperCase()}), ${line.difficulty}: ${word} ${numbers(line)}`;
    }
    if (line.kind === 'foe') return `${cut(line.foe.name, names)} attacks ${who}: ${word} for ${who} ${numbers(line)}`;
    return `${who} → ${cut(line.foe.name, names)}${line.skill ? ` (${cut(line.skill, names)})` : ''}: ${word} ${numbers(line)}`;
}

const STOP_POINTS = 'Stop earlier at the first stop point (a foe falls, flees or yields; anyone on your side is Down or Badly wounded; new foes arrive).';

// A refusal in fewer words: without its bracketed reason, and cut.
const shortRefusal = text => cut(String(text).replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim(), 70);

/**
 * The cue for `rounds` (the first `count` of them) and the checks: `{ checks: [line], rounds: [{ n, decisive, lines }],
 * refused: [text], decisive }`. `decisive`: whether the last round told is the one that settles the fight. `shape` (0 to 3)
 * is how much it is shortened to fit the budget: 0 as written; 1 checks without their skill and refusals without their
 * reasons; 2 the refusals as one count; 3 names cut as well.
 */
export function cueText({ checks, rounds, refused, decisive }, shape = 0) {
    const fight = rounds.length > 0;
    const head = fight
        ? `[Rolls] Code rolled these. Tell them in this order and as given, and never invent a roll; write ${BATTLE_MARKER} on its own line where the fight is told.`
        : '[Rolls] Code rolled these. Tell them as given, and never invent a roll.';
    const options = { compact: shape >= 1, names: shape >= 3 ? NAME_CUT : 0 };
    const lines = [head];
    for (const line of checks) lines.push(lineText(line, options));
    for (const round of rounds) for (const line of round.lines) lines.push(`Round ${round.n}: ${lineText(line, options)}`);
    if (shape >= 2 && refused.length) lines.push(`${refused.length} more ${refused.length === 1 ? 'action was' : 'actions were'} not rolled as planned.`);
    else for (const text of refused) lines.push(shape >= 1 ? shortRefusal(text) : text);
    if (fight) lines.push(`Round ${rounds.at(-1).n} is ${decisive ? 'decisive' : 'the last rolled'}: stop there at the latest. ${STOP_POINTS}`);
    return lines.join('\n');
}

export const NO_ROLLS_LINE = 'No rolls this reply: keep the fight undecided, one exchange, nobody goes Down.';

/**
 * The cue that fits the budget, by shortening (SPEC_RPG_v1 §4.5.3): all of `parts.rounds`, then fewer (never fewer than one);
 * if one round is still too long, the checks and refusals in fewer words, then the refusals as a count, then the names cut.
 * → { count, shape, text } (`count` rounds told; the last shape is used even when nothing fits, which only a plan of
 * unusually long names could come to, and those are cut there).
 */
export function fitCue(parts, budget = LIMITS.cueTokens) {
    const total = parts.rounds.length;
    let last = null;
    for (let shape = 0; shape <= 3; shape += 1) {
        for (let count = total; count >= Math.min(1, total); count -= 1) {
            const told = { ...parts, rounds: parts.rounds.slice(0, count), decisive: parts.decisive && count === total };
            last = { count, shape, text: cueText(told, shape) };
            if (cueTokens(last.text) <= budget) return last;
        }
    }
    return last;
}
