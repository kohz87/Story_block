// The plan (SPEC_RPG §2 A2): what the pre-call answers, as plain data the roll reads.
//
//   { pace: 'careful' | 'normal' | 'all',
//     acts:   [{ who, skill?, uses?, stat, target, edge?, why? }],   a party member's action against a foe
//     foes:   [{ slot, target, defend } | { slot, hold: true }],     what a foe slot does (a number 1–4)
//     checks: [{ who, skill?, uses?, stat, difficulty }] }          a roll outside a fight
//
// `validatePlan` is the one place its shape is checked (the pieces never trust a plan without it); `parsePlanAnswer`
// reads the pre-call's fixed answer lines into a plan against the sheet, dropping what it cannot place. A plan is
// held for the next generation only, in chat metadata (not game state), and the hold is cleared when it is used.
import { FOE_SLOTS, FORMULA, LIMITS, PACE, STATS } from './names.js';
import { matchCharacter, matchFoe } from './read.js';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const TEXT = 60;
const DIFFICULTIES = Object.freeze(Object.keys(LIMITS.dc));
const USES = Object.freeze(['mana', 'stamina']);

const oneLine = (value, max = TEXT) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** The shape of a plan: { ok, errors } (plain sentences). */
export function validatePlan(plan) {
    const errors = [];
    if (!isObject(plan)) return { ok: false, errors: ['A plan must be an object.'] };
    if (!Object.hasOwn(PACE, plan.pace)) errors.push('pace must be careful, normal or all.');
    const lists = [['acts', LIMITS.acts], ['foes', LIMITS.foes], ['checks', LIMITS.checks]];
    for (const [key, max] of lists) {
        if (plan[key] === undefined) continue;
        if (!Array.isArray(plan[key])) { errors.push(`${key} must be a list.`); continue; }
        if (plan[key].length > max) errors.push(`${key} may hold at most ${max} entries.`);
    }
    const text = (entry, key, where, required = true) => {
        const value = entry[key];
        if (value === undefined && !required) return;
        if (typeof value !== 'string' || !value.trim() || value.length > TEXT) errors.push(`${where} needs ${key} (text, at most ${TEXT} characters).`);
    };
    const stat = (entry, key, where) => { if (!STATS.includes(entry[key])) errors.push(`${where} needs ${key} to be one of ${STATS.join(', ')}.`); };
    const known = (entry, allowed, where) => {
        for (const key of Object.keys(entry)) if (!allowed.includes(key)) errors.push(`${where} has "${key}", which a plan does not use.`);
    };
    (Array.isArray(plan.acts) ? plan.acts : []).forEach((act, n) => {
        const where = `act ${n + 1}`;
        if (!isObject(act)) { errors.push(`${where} must be an object.`); return; }
        known(act, ['who', 'skill', 'uses', 'stat', 'target', 'edge', 'why'], where);
        text(act, 'who', where); text(act, 'skill', where, false); text(act, 'target', where); text(act, 'why', where, false);
        stat(act, 'stat', where);
        if (act.uses !== undefined && !USES.includes(act.uses)) errors.push(`${where} uses must be mana or stamina.`);
        if (act.edge !== undefined && !(Number.isInteger(act.edge) && Math.abs(act.edge) <= FORMULA.edgeMax)) errors.push(`${where} edge must be a whole number from -${FORMULA.edgeMax} to ${FORMULA.edgeMax}.`);
    });
    (Array.isArray(plan.foes) ? plan.foes : []).forEach((foe, n) => {
        const where = `foe ${n + 1}`;
        if (!isObject(foe)) { errors.push(`${where} must be an object.`); return; }
        if (!Number.isInteger(foe.slot) || foe.slot < 1 || foe.slot > FOE_SLOTS) errors.push(`${where} needs a slot from 1 to ${FOE_SLOTS}.`);
        if (foe.hold !== undefined) {
            known(foe, ['slot', 'hold'], where);
            if (foe.hold !== true) errors.push(`${where} hold must be true.`);
            return;
        }
        known(foe, ['slot', 'target', 'defend'], where);
        text(foe, 'target', where);
        stat(foe, 'defend', where);
    });
    (Array.isArray(plan.checks) ? plan.checks : []).forEach((check, n) => {
        const where = `check ${n + 1}`;
        if (!isObject(check)) { errors.push(`${where} must be an object.`); return; }
        known(check, ['who', 'skill', 'uses', 'stat', 'difficulty'], where);
        text(check, 'who', where); text(check, 'skill', where, false);
        stat(check, 'stat', where);
        if (!DIFFICULTIES.includes(check.difficulty)) errors.push(`${where} needs difficulty to be one of ${DIFFICULTIES.join(', ')}.`);
        if (check.uses !== undefined && !USES.includes(check.uses)) errors.push(`${where} uses must be mana or stamina.`);
    });
    return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
}

/** Whether a plan has anything to roll. */
export const planIsEmpty = plan => !(plan?.acts?.length || plan?.checks?.length || plan?.foes?.some(foe => !foe.hold));

// ---- the pre-call's answer ---------------------------------------------------------------------------------------

const BULLET = /^[\s>*•\-–—\d.)]+(?=[A-Za-z])/;
const NONE = /^\W*(?:none|no rolls?)\b/i;

// "act Wessel | skill: Iron Breath | stat: STR | target: Sluice Rat A | edge: +2 ambush" → { head: 'act', name: 'Wessel', labels: { skill, stat, … } }
function lineOf(raw) {
    const text = String(raw).replace(/\*\*|`/g, '').replace(BULLET, '').trim();
    const [first, ...rest] = text.split('|');
    const word = /^(pace|act|foe|check)\b\s*:?\s*(.*)$/i.exec(first.trim());
    if (!word) return null;
    const head = word[1].toLowerCase();
    const labels = {};
    for (const part of rest) {
        const at = part.indexOf(':');
        if (at < 0) { if (/^\s*hold\s*$/i.test(part)) labels.hold = true; continue; }
        labels[part.slice(0, at).trim().toLowerCase()] = part.slice(at + 1).trim();
    }
    if (head === 'foe' && /\bhold\s*$/i.test(word[2])) return { head, name: word[2].replace(/\s*[,—-]?\s*\bhold\s*$/i, '').trim(), labels: { ...labels, hold: true } };
    return { head, name: word[2].trim(), labels };
}

const statOf = value => {
    const word = String(value ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');
    return STATS.includes(word) ? word : STATS.find(stat => word.startsWith(stat)) ?? null;
};

// "+2 ambush from the drain lip" → { edge: 2, why: 'ambush from the drain lip' }; a bare reason is no edge.
function edgeOf(value) {
    const match = /^\s*([+-]?\d+)\s*(.*)$/.exec(String(value ?? ''));
    if (!match) return {};
    const edge = Math.max(-FORMULA.edgeMax, Math.min(FORMULA.edgeMax, Number(match[1])));
    const why = oneLine(match[2]);
    return { ...(edge ? { edge } : {}), ...(why && edge ? { why } : {}) };
}

const difficultyOf = value => {
    const word = String(value ?? '').trim().toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ');
    if (DIFFICULTIES.includes(word)) return word;
    return word === 'veryhard' || word === 'very-hard' ? 'very hard' : null;
};

const usesOf = value => {
    const word = String(value ?? '').trim().toLowerCase();
    return USES.find(use => word.startsWith(use)) ?? null;
};

/**
 * The pre-call's answer read against the sheet: { plan } (at least one thing to roll), { none: true } (the model said
 * no rolls, or nothing it said could be placed) or { error } (a plain sentence) for an answer with no line in it.
 * A line that names someone or a foe the sheet does not have, a stat that is not one of the seven, or a difficulty
 * that is not a word is dropped by itself; the rest stands. `dropped` counts them.
 */
export function parsePlanAnswer(answer, sheet) {
    const text = String(answer ?? '').trim();
    if (!text) return { error: 'the answer was empty' };
    const plan = { pace: 'normal', acts: [], foes: [], checks: [] };
    let read = 0;
    let dropped = 0;
    let none = false;
    for (const raw of text.split(/\r?\n/)) {
        const line = lineOf(raw);
        if (!line) {
            if (!read && !none && NONE.test(raw.replace(/\*\*|`/g, '').trim())) none = true;
            continue;
        }
        read += 1;
        const { head, name, labels } = line;
        if (head === 'pace') {
            const pace = String(name).toLowerCase().match(/careful|normal|all/)?.[0];
            if (pace) plan.pace = pace; else dropped += 1;
        } else if (head === 'act') {
            const who = matchCharacter(sheet, name);
            const stat = statOf(labels.stat);
            const target = matchFoe(sheet, labels.target);
            if (!who || !stat || !target || plan.acts.length >= LIMITS.acts) { dropped += 1; continue; }
            const skill = oneLine(labels.skill);
            const uses = usesOf(labels.uses);
            plan.acts.push({ who: who.who, ...(skill && !/^(none|no|-|—)$/i.test(skill) ? { skill } : {}), ...(uses ? { uses } : {}), stat, target: target.name, ...edgeOf(labels.edge) });
        } else if (head === 'foe') {
            const foe = matchFoe(sheet, name);
            if (!foe || plan.foes.some(entry => entry.slot === foe.slot) || plan.foes.length >= LIMITS.foes) { dropped += 1; continue; }
            if (labels.hold) { plan.foes.push({ slot: foe.slot, hold: true }); continue; }
            const target = matchCharacter(sheet, labels.target);
            const defend = statOf(labels.defend) ?? 'agi';
            if (!target) { dropped += 1; continue; }
            plan.foes.push({ slot: foe.slot, target: target.who, defend });
        } else if (head === 'check') {
            const who = matchCharacter(sheet, name);
            const stat = statOf(labels.stat);
            const difficulty = difficultyOf(labels.difficulty ?? labels.dc);
            if (!who || !stat || !difficulty || plan.checks.length >= LIMITS.checks) { dropped += 1; continue; }
            const skill = oneLine(labels.skill);
            const uses = usesOf(labels.uses);
            plan.checks.push({ who: who.who, ...(skill && !/^(none|no|-|—)$/i.test(skill) ? { skill } : {}), ...(uses ? { uses } : {}), stat, difficulty });
        }
    }
    if (none && !read) return { none: true };
    if (!read && !none) return { error: `"${oneLine(text, 80)}" has no pace, act, foe or check line and is not "none"` };
    if (!validatePlan(plan).ok) return { error: validatePlan(plan).errors[0] };
    if (planIsEmpty(plan)) return { none: true, dropped };
    return { plan, dropped };
}

// ---- the held plan ----------------------------------------------------------------------------------------------

const HOLD = 'leanRpgPlan';

/**
 * The plan held for the next generation: { put(chat, key, plan | null), peek(chat, key) → { plan } | null, clear() } (a held
 * `null` plan is the model's "no rolls"). It lives
 * in the chat's metadata (`metadata()` → the object, or null: then in memory), never in game state. It is there only
 * to spare a retried interceptor a second model call: every new generation clears it first, so a swipe plans anew. A
 * plan held for another chat or another message is not given.
 */
export function createPlanHold({ metadata = () => null } = {}) {
    let memory = null;
    const store = () => {
        let meta = null;
        try { meta = metadata(); } catch { meta = null; }
        return isObject(meta) ? meta : null;
    };
    const read = () => { const meta = store(); return meta ? meta[HOLD] ?? null : memory; };
    const write = value => {
        const meta = store();
        if (!meta) { memory = value; return; }
        if (value === null) delete meta[HOLD]; else meta[HOLD] = value;
    };
    return {
        put(chat, key, plan) { write({ chat: String(chat ?? ''), key: String(key), plan }); },
        peek(chat, key) {
            const held = read();
            const fits = isObject(held) && held.chat === String(chat ?? '') && held.key === String(key) && (held.plan === null || validatePlan(held.plan).ok);
            return fits ? { plan: held.plan } : null;
        },
        clear() { if (read() !== null) write(null); },
    };
}
