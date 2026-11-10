// One narrator check line: "? check Name | skill or stat | difficulty | die" parsed and checked against a reply's party and dice.
// Pure: names and aliases match a whole folded name only; a refused line carries one short reason and is never rolled.

import { LIMITS, STATS } from '../names.js';
import { fold } from '../read.js';

const LINE = /^\s*\?\s*check(?:\s+|$)(.*)$/iu;
const DIE = /^\d+$/u;

const refusal = reason => ({ ok: false, reason });
const clean = value => String(value ?? '').replace(/\s+/gu, ' ').trim();
const difficultyOf = value => clean(value).toLowerCase().replace(/[-_]+/gu, ' ').replace(/\s+/gu, ' ');

/** Parse one line into { name, what, difficulty, die }, or a refusal. Syntax only; the party and dice are checked by validateCheck. */
export function parseCheckLine(line) {
    const match = LINE.exec(String(line ?? ''));
    if (!match) return refusal('not a check line');
    const parts = match[1].split('|').map(clean);
    if (parts.length !== 4 || parts.some(part => !part)) return refusal('needs four parts');
    const [name, what, difficulty, dieText] = parts;
    if (!DIE.test(dieText)) return refusal('die is not a whole number');
    const die = Number(dieText);
    if (!Number.isSafeInteger(die)) return refusal('die is not a whole number');
    return { ok: true, name, what, difficulty: difficultyOf(difficulty), die };
}

/** The member a whole name or alias names, case-insensitively, or null. */
export function memberNamed(party, name) {
    const wanted = fold(clean(name));
    if (!wanted) return null;
    return (Array.isArray(party) ? party : []).find(member => fold(member?.name) === wanted
        || (Array.isArray(member?.aliases) && member.aliases.some(alias => fold(alias) === wanted))) ?? null;
}

/**
 * Validate a parsed check against { party, offeredDice, usedDice }.
 * → { ok, member, skill, stat, what, difficulty, dc, die, used } or { ok: false, reason }.
 */
export function validateCheck(parsed, { party = [], offeredDice = [], usedDice = [] } = {}) {
    if (!parsed || parsed.ok !== true) return parsed?.ok === false ? parsed : refusal('not a check line');
    if ((Array.isArray(usedDice) ? usedDice : []).length >= 3) return refusal('more than 3');

    const difficulty = difficultyOf(parsed.difficulty);
    if (!Object.hasOwn(LIMITS.dc, difficulty)) return refusal('unknown difficulty');

    const member = memberNamed(party, parsed.name);
    if (!member) return refusal('unknown person');

    const what = clean(parsed.what);
    const skill = (Array.isArray(member.skills) ? member.skills : []).find(entry => fold(entry?.name) === fold(what)) ?? null;
    const plain = skill ? null : what.toLowerCase();
    const skillStat = skill ? clean(skill.stat).toLowerCase() : null;
    if (skill && !STATS.includes(skillStat)) return refusal('unknown skill or stat');
    const stat = skill ? skillStat : (STATS.includes(plain) ? plain : null);
    if (!skill && !stat) return refusal('unknown skill or stat');

    const used = Array.isArray(usedDice) ? usedDice : [];
    const offered = Array.isArray(offeredDice) ? offeredDice : [];
    const die = parsed.die;
    if (!offered.includes(die)) return refusal('die not offered');
    if (used.filter(value => value === die).length >= offered.filter(value => value === die).length) return refusal('die reused');
    if (die !== offered[used.length]) return refusal('out of order');

    return { ok: true, member, skill, stat, what: skill?.name ?? stat.toUpperCase(), difficulty, dc: LIMITS.dc[difficulty], die, used: used.length };
}
