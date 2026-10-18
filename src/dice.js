// Dice: rolled by the extension, not by the model.
//
// A language model is a poor random number generator, and once it has read the scene it is
// choosing rather than rolling. So the extension rolls before the prompt is built, hands the
// numbers over through {{rolls}}, stamps them onto the block when the reply arrives
// (`<Dice rolls="12, 5, 19">`, inside the hidden envelope, so every swipe keeps its own),
// and checks the model used them as given. Ported from Megumin Suite (GPL-3.0): the roll
// line format, the rejection-sampled die and the verdict rules are its.

import { DIE_SIDES, MAX_ROLLS } from './schema.js';

export { DIE_SIDES, MAX_ROLLS };

/** `count` fair rolls of a `sides`-sided die (rejection sampling: no modulo bias). */
export function rollDice(count, sides = 20, random = null) {
    const n = Math.max(0, Math.min(MAX_ROLLS, Number.parseInt(count, 10) || 0));
    const faces = DIE_SIDES.includes(Number(sides)) ? Number(sides) : 20;
    const limit = Math.floor(0x100000000 / faces) * faces;
    const draw = random ?? (() => {
        const cryptoRef = globalThis.crypto;
        if (cryptoRef?.getRandomValues) return cryptoRef.getRandomValues(new Uint32Array(1))[0];
        // No crypto: still random, just not cryptographically so. A die only has to resist
        // the model's preferences, not an attacker.
        return Math.floor(Math.random() * 0x100000000);
    });
    const out = [];
    for (let guard = 0; out.length < n && guard < 1000; guard++) {
        const value = draw();
        if (value >= limit) continue;
        out.push((value % faces) + 1);
    }
    while (out.length < n) out.push(1 + Math.floor(Math.random() * faces));
    return out;
}

export function formatRolls(rolls) {
    return Array.isArray(rolls) && rolls.length ? rolls.join(', ') : 'none';
}

/**
 * The rolls as {{rolls}} hands them to the model (0.9.6): each tied to its attempt, "Roll 1 = 2 ·
 * Roll 2 = 13 · Roll 3 = 18 (the first attempt takes Roll 1, the next Roll 2, whatever they say)".
 * A plain list read as a pool to pick from: a model skipped a 2 against DC 10 and took the 13.
 */
export function promptRolls(rolls) {
    if (!Array.isArray(rolls) || !rolls.length) return 'none';
    const list = rolls.map((roll, index) => `Roll ${index + 1} = ${roll}`).join(' · ');
    return rolls.length === 1
        ? `${list} (the attempt takes it, whatever it says)`
        : `${list} (the first attempt takes Roll 1, the next Roll 2, and so on, whatever they say)`;
}

function openTagPattern(tag) {
    return new RegExp(`<${tag}(\\s[^>]*)?>`, 'gi');
}

function lastOpenTag(text, tag) {
    let found = null;
    for (const match of String(text ?? '').matchAll(openTagPattern(tag))) found = match;
    return found;
}

/**
 * Record the rolls that were handed over on the newest copy of the block in `text`, so the
 * check can run on that message later (and on every swipe separately). No copy: unchanged.
 */
export function stampRolls(text, def, rolls) {
    const source = String(text ?? '');
    if (!def?.tag || !Array.isArray(rolls) || !rolls.length) return source;
    const match = lastOpenTag(source, def.tag);
    if (!match) return source;
    const attrs = String(match[1] ?? '').replace(/\s+rolls\s*=\s*("[^"]*"|'[^']*'|\S+)/i, '');
    const tag = `<${def.tag}${attrs} rolls="${rolls.join(', ')}">`;
    return `${source.slice(0, match.index)}${tag}${source.slice(match.index + match[0].length)}`;
}

/** The rolls stamped on the newest copy of the block in `text`, or null. */
export function readRolls(text, def) {
    if (!def?.tag) return null;
    const match = lastOpenTag(text, def.tag);
    const attr = /\brolls\s*=\s*"([^"]*)"/i.exec(match?.[1] ?? '');
    if (!attr) return null;
    const rolls = attr[1].split(',').map(part => Number.parseInt(part, 10)).filter(Number.isFinite);
    return rolls.length ? rolls : null;
}

// `🎲 attempt — d20+N vs DC → roll+N = total · verdict`, written loosely: the die emoji,
// dashes, arrows and the "= total" part are all optional, and the die may be any dN.
const DICE_LINE = /^(?:[-*•]\s*)?(?:🎲\s*)?(.*?)\s*[—–-]+\s*d(\d{1,3})\s*([+-]\s*\d+)?\s*vs\.?\s*(?:DC\s*)?(\d{1,3})\s*(?:→|->|=>|:)\s*(\d{1,3})\s*(?:[+-]\s*\d+)?\s*(?:=\s*(-?\d{1,3}))?\s*(?:[·•|,;:]\s*(.*))?$/i;

const LABELS = {
    success: 'success',
    cost: 'success, at a cost',
    fail: 'fail',
    crit: 'critical success',
    critfail: 'critical fail',
};

function plain(text) {
    return String(text ?? '').replace(/\*\*|__|`/g, '').replace(/^\*|\*$/g, '').trim();
}

// The verdict the model wrote, else the same reading the rules give the model.
function outcomeOf(verdict, roll, sides, total, dc) {
    const words = String(verdict ?? '').toLowerCase();
    if (sides === 20 && roll === 20) return 'crit';
    if (sides === 20 && roll === 1) return 'critfail';
    if (/cost|complicat|\bbut\b|however/.test(words)) return 'cost';
    if (/fail|miss|\bno\b/.test(words)) return 'fail';
    if (/succe|pass|works|\byes\b/.test(words)) return 'success';
    if (total >= dc) return 'success';
    return total >= dc - 2 ? 'cost' : 'fail';
}

// What the handed die gives for a roll line: its modifier and DC, read by the rules (no verdict words).
function dieSaid(roll, die) {
    const value = Math.max(1, Math.min(roll.sides, Number(die) || 1));
    const total = value + roll.mod;
    const outcome = outcomeOf('', value, roll.sides, total, roll.dc);
    return { roll: value, total, outcome, label: LABELS[outcome] };
}

function parseLine(line) {
    const match = DICE_LINE.exec(line);
    if (!match) return null;
    const sides = Number.parseInt(match[2], 10);
    const mod = match[3] ? Number.parseInt(match[3].replace(/\s+/g, ''), 10) : 0;
    const dc = Number.parseInt(match[4], 10);
    const roll = Number.parseInt(match[5], 10);
    const total = match[6] !== undefined ? Number.parseInt(match[6], 10) : roll + mod;
    if (!DIE_SIDES.includes(sides) || roll < 1 || roll > sides || Math.abs(mod) > 20 || dc < 1 || dc > 200) return null;
    const outcome = outcomeOf(match[7], roll, sides, total, dc);
    const verdict = plain(match[7]) || LABELS[outcome];
    // "fail, the screen wakes at full brightness": the pill shows the outcome, the rest is a note.
    const tail = verdict.replace(/^\s*(critical\s+)?(success|fail(?:ure)?|pass|miss)\b[\s,;:.—–-]*/i, '').trim();
    const note = tail && tail.toLowerCase() !== 'at a cost' && verdict.toLowerCase() !== LABELS[outcome] ? tail : '';
    return { attempt: plain(match[1]), sides, roll, mod, dc, total, outcome, label: LABELS[outcome], verdict, note, sumOk: total === roll + mod };
}

/**
 * The roll lines of a Dice block: { rolls } or null. Every non-empty line has to be a roll
 * line, as in Megumin: a board that drew two of four rolls would hide the other two.
 */
export function parseDice(text) {
    const lines = String(text ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (!lines.length || lines.length > 8) return null;
    const rolls = [];
    for (const line of lines) {
        const roll = parseLine(line);
        if (!roll) return null;
        rolls.push(roll);
    }
    return { rolls };
}

/**
 * Did the model use the dice it was handed? Rolls must come from `handed` in order, one per
 * attempt, never invented or reused, and each sum must add up. Returns
 * { checked, ok, problems: [{ index, kind: 'invented'|'order'|'sum', text, expected? }] };
 * `checked` is false when nothing was handed (an older reply, or rolls turned off). A roll that
 * is not the one handed for its place carries `expected` (0.9.6): what that die gives with the
 * same modifier and DC, read by the rules alone — { roll, total, outcome, label }.
 */
export function checkRolls(parsed, handed) {
    if (!parsed || !Array.isArray(handed) || !handed.length) return { checked: false, ok: true, problems: [] };
    const problems = [];
    parsed.rolls.forEach((roll, index) => {
        if (!roll.sumOk) {
            const sum = roll.mod ? `${roll.roll}${roll.mod > 0 ? '+' : '−'}${Math.abs(roll.mod)}` : `${roll.roll}`;
            problems.push({ index, kind: 'sum', text: `${sum} is not ${roll.total}` });
        }
        if (index >= handed.length) problems.push({ index, kind: 'invented', text: `roll ${index + 1} was not handed over (only ${handed.length} ${handed.length === 1 ? 'was' : 'were'})` });
        else if (handed[index] !== roll.roll) {
            const kind = handed.includes(roll.roll) ? 'order' : 'invented';
            problems.push({ index, kind, text: kind === 'order' ? `${roll.roll} was used out of order (expected ${handed[index]})` : `${roll.roll} is not one of the rolls handed over`, expected: dieSaid(roll, handed[index]) });
        }
    });
    return { checked: true, ok: problems.length === 0, problems };
}
