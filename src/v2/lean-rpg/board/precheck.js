// The foe pre-check: a short, pure reading of the reader's typed attack before a reply is generated. It asks for the
// enemy groups the message attacks, reads the answer as JSON, and holds those groups to the Foes block's rules. It
// plans no dice and writes nothing; the caller records accepted groups as an opening and the board plays it.
import { FOE_SLOTS } from '../names.js';
import { OPEN_MAX_NAME } from '../open.js';
import { FOE_LEVEL, foeLevelCap, partyLevels } from '../foes.js';

/** The pre-check's own bounds before a caller narrows them with `limits`. */
export const PRECHECK_LIMITS = Object.freeze({ groups: FOE_SLOTS, count: 999, name: OPEN_MAX_NAME });

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on']);
const WHOLE = /\d+(?:\.\d+)?/u;
const ATTACK = /\b(?:attack(?:s|ed|ing)?|strik(?:e|es|ing)|struck|stab(?:s|bed|bing)?|slash(?:es|ed|ing)?|swing(?:s|ing)?|swung|hit(?:s|ting)?|punch(?:es|ed|ing)?|kick(?:s|ed|ing)?|shoot(?:s|ing)?|shot|fight(?:s|ing)?|fought|battl(?:e|es|ing)|ambush(?:es|ed|ing)?|kill(?:s|ed|ing)?|slay(?:s|ing)?|grappl(?:e|es|ing)|tackl(?:e|es|ing)|lunge(?:s|d)?|thrust(?:s|ing)?|cut(?:s|ting)?|slic(?:e|es|ing)|cleav(?:e|es|ing)|hack(?:s|ed|ing)?|fire(?:s|d|ing)?|engag(?:e|es|ed|ing)|assault(?:s|ed|ing)?|charg(?:e|es|ed|ing)|pounc(?:e|es|ed|ing)|jump(?:s|ed|ing)?|leap(?:s|ed|ing)?|leapt|fall(?:s|ing)?\s+upon|fell\s+upon)\b/iu;
const UNCERTAIN = /\b(?:not|never|no|avoid|avoidance|instead|if|unless|whether|would|could|might|maybe|consider|discuss|ask|tell|say|says|said|warn|threaten|talk|speak|don't|dont|won't|wont|cannot|can't|cant)\b/iu;

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const oneLine = value => String(value ?? '').replace(/\s+/gu, ' ').trim();
const wordsOf = text => String(text ?? '').normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const IRREGULAR = new Map([['children', 'child'], ['feet', 'foot'], ['geese', 'goose'], ['men', 'man'], ['mice', 'mouse'],
    ['people', 'person'], ['teeth', 'tooth'], ['women', 'woman'], ['wolves', 'wolf']]);

// One word as compared: a plural -s, -es or -ies is read as its singular. The same word still has to occur whole.
function singular(word) {
    if (IRREGULAR.has(word)) return IRREGULAR.get(word);
    if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
    if (word.length > 4 && /(?:ches|shes|sses|xes|zes)$/u.test(word)) return word.slice(0, -2);
    return word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word;
}

const nameKey = text => wordsOf(text).map(singular).filter(word => !STOP.has(word)).join('\u0000');
const distinctiveWords = text => wordsOf(text).map(singular).filter(word => !STOP.has(word));

/** Whether every distinctive word of `name` (plurals are fine) appears whole in `message`. */
export function namedInMessage(name, message) {
    const wanted = distinctiveWords(name);
    if (!wanted.length) return false;
    const seen = new Set(wordsOf(message).map(singular));
    return wanted.every(word => seen.has(word));
}

/** Whether the reader's message types an explicit attack, using the board's attack words without needing a known foe. */
export function looksLikeAttack(message) {
    const text = String(message ?? '').replace(/[“"][^”"]*[”"]/gu, ' ');
    return text.split(/[.!?;\n]|\b(?:and|then|but)\b/iu).some(clause => {
        if (UNCERTAIN.test(clause)) return false;
        const action = ATTACK.exec(clause);
        if (!action) return false;
        const before = clause.slice(0, action.index).trim();
        return !before || /(?:^|\b(?:as|when|while|once)\s+)(?:i|we)(?:\s+(?:will|try to|attempt to))?$/iu.test(before);
    });
}

function partyLine(sheet, roster) {
    const levels = new Map((sheet?.characters ?? []).filter(entry => entry?.who).map(entry => [nameKey(entry.who), entry.level]));
    const actors = Array.isArray(roster) ? roster : Array.isArray(roster?.actors) ? roster.actors : [];
    const people = actors.filter(entry => oneLine(entry?.name)).map(entry => ({
        name: oneLine(entry.name), level: entry.character?.level ?? entry.level ?? levels.get(nameKey(entry.name)),
    }));
    const fallback = (sheet?.characters ?? []).filter(entry => entry?.who).map(entry => ({ name: entry.who, level: entry.level }));
    return (people.length ? people : fallback).map(person => `${person.name}${Number.isInteger(person.level) ? ` (level ${person.level})` : ''}`).join(', ');
}

/**
 * The short Assist prompt: the reader's message, the foes already on the sheet, and the party. It asks only for JSON
 * groups: `{"groups":[{"name":"...","count":1,"level":2}]}` (`level` optional). Dice, actions and outcomes are not asked.
 */
export function precheckPrompt({ message = '', sheet = null, roster = null } = {}) {
    const text = oneLine(message).slice(0, 1200);
    const foes = [...new Set((sheet?.foes ?? []).map(foe => oneLine(foe?.name)).filter(Boolean))];
    const party = partyLine(sheet, roster);
    return [
        'Read the reader\'s message and list only the enemy groups it attacks that are not already on the Foes block.',
        'Do not choose later actions, turns or outcomes.',
        '',
        'Reader\'s message:',
        text,
        '',
        `Foes already on the Foes block: ${foes.length ? foes.join(', ') : 'none'}`,
        `Party: ${party || 'none'}`,
        '',
        'Rules:',
        '- List only enemies the reader explicitly attacks. Ignore allies, bystanders and groups already on the sheet.',
        `- Give each group a short natural name (at most ${PRECHECK_LIMITS.name} characters), using the message's words.`,
        `- count is the whole number of foes in that group, from 1 to ${PRECHECK_LIMITS.count}. Resolve amounts: "six" = 6, "a dozen" = 12, "4 scores" = 80. If unclear, use 1.`,
        '- level is optional. Give a whole level only when the message makes it clear; otherwise leave the key out.',
        '',
        'Reply with JSON only, in this shape:',
        '{"groups":[{"name":"...","count":1}]}',
    ].join('\n');
}

function balanced(text, start) {
    const pairs = { '{': '}', '[': ']' };
    const stack = [pairs[text[start]]];
    let quoted = false, escaped = false;
    for (let at = start + 1; at < text.length; at += 1) {
        const char = text[at];
        if (quoted) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') quoted = false;
            continue;
        }
        if (char === '"') { quoted = true; continue; }
        if (pairs[char]) { stack.push(pairs[char]); continue; }
        if (char !== stack.at(-1)) continue;
        stack.pop();
        if (!stack.length) return text.slice(start, at + 1);
    }
    return null;
}

/** The groups in an answer, from JSON alone or JSON inside prose or a code fence; null when no groups can be read. */
export function parsePrecheck(text) {
    const source = String(text ?? '');
    for (let at = 0; at < source.length; at += 1) {
        if (!'[{'.includes(source[at])) continue;
        const json = balanced(source, at);
        if (!json) continue;
        let value;
        try { value = JSON.parse(json); } catch { continue; }
        if (Array.isArray(value)) return value;
        if (isObject(value) && Array.isArray(value.groups)) return value.groups;
    }
    return null;
}

const limitOf = (limits, keys, fallback, low = 1) => {
    for (const key of keys) {
        const value = limits?.[key];
        if (Number.isInteger(value) && value >= low) return value;
    }
    return fallback;
};

const NUMBER_WORDS = new Map([['one', 1], ['two', 2], ['three', 3], ['four', 4], ['five', 5], ['six', 6],
    ['seven', 7], ['eight', 8], ['nine', 9], ['ten', 10], ['eleven', 11], ['twelve', 12]]);
const UNITS = new Map([['dozen', 12], ['score', 20], ['hundred', 100], ['thousand', 1000]]);

function countOf(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
    const text = oneLine(value).toLowerCase().replace(/,/gu, '');
    if (!text) return null;
    const match = /^(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(dozen|score|hundred|thousand)s?$/u.exec(text);
    if (match) {
        const amount = /^\d+$/u.test(match[1]) ? Number(match[1]) : match[1] === 'a' || match[1] === 'an' ? 1 : NUMBER_WORDS.get(match[1]);
        return amount * UNITS.get(match[2]);
    }
    const plain = WHOLE.exec(text);
    return plain && plain.index === 0 ? Math.trunc(Number(plain[0])) : null;
}

function levelOf(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
    const text = oneLine(value).replace(/^(?:level|lv\.?)\s*/iu, '');
    return /^\d+$/u.test(text) ? Number(text) : null;
}

/**
 * Vets parsed groups for an opening. `limits` may narrow `{ groups, count, name, levelMin, levelMax }`; its defaults are
 * `PRECHECK_LIMITS` and the Foes rules. A level, when given, is held to 1..99 and to one band above the party's highest.
 * → `[{ name, count, level? }]`, in the exact form `openFoes` takes; an omitted level remains omitted for resolve to draw.
 */
export function vetGroups(groups, { message = '', sheet = null, limits = null } = {}) {
    if (!Array.isArray(groups)) return [];
    const maxGroups = limitOf(limits, ['groups', 'maxGroups'], PRECHECK_LIMITS.groups);
    const maxCount = limitOf(limits, ['count', 'maxCount'], PRECHECK_LIMITS.count);
    const maxName = limitOf(limits, ['name', 'maxName'], PRECHECK_LIMITS.name);
    const levelMin = limitOf(limits, ['levelMin', 'minLevel', 'min'], FOE_LEVEL.min);
    const levelMax = Math.min(FOE_LEVEL.max, limitOf(limits, ['levelMax', 'maxLevel', 'max'], FOE_LEVEL.max));
    const cap = Math.max(levelMin, Math.min(levelMax, foeLevelCap(partyLevels(sheet))));
    const known = new Set((sheet?.foes ?? []).map(foe => oneLine(foe?.name)).filter(Boolean).map(nameKey));
    const seen = new Set();
    const accepted = [];
    for (const group of groups) {
        if (accepted.length >= maxGroups) break;
        if (!isObject(group)) continue;
        const name = oneLine(group.name).slice(0, maxName).trim();
        const key = nameKey(name);
        if (!name || !key || known.has(key) || seen.has(key) || !namedInMessage(name, message)) continue;
        seen.add(key);
        const rawCount = countOf(group.count);
        const count = Math.max(1, Math.min(maxCount, Number.isInteger(rawCount) ? rawCount : 1));
        const rawLevel = levelOf(group.level);
        const level = Number.isInteger(rawLevel) ? Math.max(levelMin, Math.min(cap, rawLevel)) : null;
        accepted.push({ name, count, ...(level === null ? {} : { level }) });
    }
    return accepted;
}
