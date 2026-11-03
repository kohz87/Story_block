// A fight opened by the pre-call (stage 47): the planner may list foes that are not on the Foes block yet (`foe <name> | new |
// count: n | class: X`) when the reader's message starts a fight against them. Code checks each one (vetOpen) and, only
// when the plan is rolled, fills a free foe slot through the block's own `set-slot-N` kind (openFoes), as part of the
// `rpg.resolve` step on the reply, so a swipe plans again, a Re-read keeps it, deleting the reply takes it back and a
// rebuild, the live state and a reload agree. The accepted foes travel in the plan as `plan.open`:
//     open: [{ name, count (1–12), class (1–9) }]
// Pure except openFoes, which writes the domain it is given (the transaction's draft, or a copy to look ahead).
import { createEvaluation } from '../data-modules/interpreter.js';
import { CLASS_NAMES, FOE_SLOTS } from './names.js';
import { fold, readSheet } from './read.js';

export const OPEN_MAX_COUNT = 12;
export const OPEN_MAX_NAME = 40;
const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on']);

const oneLine = value => String(value ?? '').replace(/\s+/gu, ' ').trim();

// A word as compared: lower case, a plural -s ignored.
const stem = word => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word);
const wordsOf = text => String(text ?? '').normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(stem);

/** The distinctive words of a foe's name: not an article or a small joining word. */
export const distinctiveWords = name => wordsOf(name).filter(word => !STOP.has(word));

/** Whether at least one distinctive word of `name` appears, as a whole word, in any of `texts` (the reader's message, the shown text before). */
export function isNamedIn(name, texts) {
    const wanted = distinctiveWords(name);
    if (!wanted.length) return false;
    const seen = new Set(texts.flatMap(wordsOf));
    return wanted.some(word => seen.has(word));
}

const classOf = value => {
    const word = oneLine(value).replace(/^class\s*/iu, '').toUpperCase();
    if (/^\d+$/u.test(word)) return Number(word);
    const at = CLASS_NAMES.indexOf(word);
    return at >= 0 ? at + 1 : null;
};

/**
 * The foes a pre-call asked for as new, held to the rules: `requested` = [{ name, count?, class? }] (text as written), `sheet` = readSheet, `texts` = the
 * reader's latest message and the shown text of the reply before. → { open: [{ name, count, class }], refused: [{ name, why }] }.
 * A name must share a distinctive word with the texts (never invented); one already on the sheet, or asked twice, is not new; the count is
 * held to 1–12 (none: 1); the class to at most the party's highest Soul Class + 1 (and 9) and at least I (none: I).
 */
export function vetOpen(requested, sheet, texts) {
    const open = [], refused = [];
    const top = Math.max(1, ...(sheet?.characters ?? []).map(entry => (Number.isInteger(entry.soul) ? entry.soul : 1)));
    const cap = Math.min(CLASS_NAMES.length, top + 1);
    const known = new Set((sheet?.foes ?? []).filter(foe => foe.filled).map(foe => fold(foe.name)));
    for (const entry of requested ?? []) {
        const name = oneLine(entry?.name).slice(0, OPEN_MAX_NAME).trim();
        if (!name) continue;
        const key = fold(name);
        if (known.has(key)) continue;
        if (!isNamedIn(name, texts)) { refused.push({ name, why: 'not named' }); continue; }
        known.add(key);
        const count = Number.parseInt(oneLine(entry.count), 10);
        const given = classOf(entry.class);
        open.push({ name, count: Number.isInteger(count) ? Math.max(1, Math.min(OPEN_MAX_COUNT, count)) : 1, class: Math.max(1, Math.min(cap, given ?? 1)) });
    }
    return { open: open.slice(0, FOE_SLOTS), refused };
}

/** Whether `open` is a list the plan may carry (plan.js validatePlan asks). */
export function openErrors(open) {
    if (!Array.isArray(open)) return ['open must be a list.'];
    const errors = [];
    if (open.length > FOE_SLOTS) errors.push(`open may hold at most ${FOE_SLOTS} entries.`);
    open.forEach((entry, n) => {
        const where = `open ${n + 1}`;
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) { errors.push(`${where} must be an object.`); return; }
        for (const key of Object.keys(entry)) if (!['name', 'count', 'class'].includes(key)) errors.push(`${where} has "${key}", which a plan does not use.`);
        if (typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > OPEN_MAX_NAME) errors.push(`${where} needs a name (text, at most ${OPEN_MAX_NAME} characters).`);
        if (!Number.isInteger(entry.count) || entry.count < 1 || entry.count > OPEN_MAX_COUNT) errors.push(`${where} count must be a whole number from 1 to ${OPEN_MAX_COUNT}.`);
        if (!Number.isInteger(entry.class) || entry.class < 1 || entry.class > CLASS_NAMES.length) errors.push(`${where} class must be a whole number from 1 to ${CLASS_NAMES.length}.`);
    });
    return errors;
}

/**
 * Fills a free slot (count 0) of the Foes blocks in `domain` (the data-module domain) for each entry of `open`, in order, through the block's
 * own `set-slot-N` kind (its effects, run by the block interpreter); a block with no such kind (a bare sheet) has the same four fields set, the
 * health full. An entry whose name is on a filled slot already, or that finds no free slot, is passed over. The domain is changed in place.
 * → [{ slot, module, name, count, class }] the slots filled (the sheet's slot numbers).
 */
export function openFoes(domain, open) {
    const placed = [];
    for (const entry of open ?? []) {
        const sheet = readSheet({ domains: { dataModules: domain } });
        if (sheet.foes.some(foe => foe.filled && fold(foe.name) === fold(entry.name))) continue;
        const free = sheet.foes.find(foe => foe.count === 0);
        if (!free) continue;
        const n = ((free.slot - 1) % FOE_SLOTS) + 1;
        const pin = domain.pins?.[domain.active?.[free.module]?.hash];
        const definition = pin?.definition;
        const instance = domain.instances?.[free.module]?.chat;
        if (!instance?.fields) continue;
        const kind = definition?.kinds?.[`set-slot-${n}`];
        if (kind?.effects && definition.state) {
            const evaluation = createEvaluation(definition, instance, { inputs: {}, source: {}, cursor: null, subject: 'chat' });
            evaluation.effects(kind.effects, { arg: { name: entry.name, count: entry.count, class: entry.class } });
            evaluation.rules();
            evaluation.finish();
        } else Object.assign(instance.fields, { [`foe${n}`]: entry.name, [`count${n}`]: entry.count, [`class${n}`]: entry.class, [`hurt${n}`]: 5 });
        placed.push({ slot: free.slot, module: free.module, name: entry.name, count: entry.count, class: entry.class });
    }
    return placed;
}
