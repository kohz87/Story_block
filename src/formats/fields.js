// Fields: a fixed list of labelled values (HP, Gold, Status, Skills…), one
// `Label: value` line per field, in definition order.
//
// The reader is forgiving because models are not tidy. They bold labels, put a
// list marker in front, squeeze several fields onto one line with ` | ` (the
// Megumin Suite habit), add a change note after a number, wrap a long text onto
// the next line, and sometimes copy the skeleton's [placeholders] instead of
// filling them in. All of that reads; what is written back (serialize) is the
// one canonical shape, so the state injected next turn is clean.
//
// State: { entries: [{ label, type, raw, value, max?, items?, unknown? }] }
// - defined fields first, in definition order, then labels the definition does
//   not have (type 'text', unknown: true) in the order the model wrote them;
// - `raw` is the value text as written (change notes included);
// - `value` is a number (meter/number), a string (text), or for a list the items
//   joined with ", " (so "present" means the same thing for every type);
//   null when the value is a placeholder or cannot be read;
// - `max` for meters, `items` (string[]) for lists.
//
// An entry whose value is null is kept, so the card can show that the model
// wrote the field but gave it no value, but it does not count as present: a body
// needs at least one defined field with a real value to be valid.
//
// Round-trip: parse(serialize(state)) gives back an equal state for every state
// serialize itself produced. For a state parsed from a model reply, everything
// but `raw` survives; `raw` becomes canonical (change notes and unreadable or
// placeholder text are not state, so they are not written back).

import { escapeBody, unescapeBody } from './escape.js';

export const id = 'fields';

// `- `, `* `, `• `, `+ `, `1. ` in front of a line. A marker needs the space
// after it, so `**HP**:` is bold, not a bullet.
const LIST_MARKER = /^(?:[-*•+]|\d{1,2}[.)])\s+/;
// `Label: value`, with optional bold/italic around the label or the colon:
// `HP: 80`, `**HP**: 80`, `**HP:** 80`, `*HP*: 80`. The label run is bounded and
// cannot hold a colon, so it can only end at the first colon.
const SLOT = /^([*_]{0,2})\s*([^:*\n|]{1,48}?)\s*[*_]{0,2}\s*:\s*[*_]{0,2}\s*(.*)$/;
// A leading emoji on a label (`❤️ HP:`) is decoration, not part of the name.
const LEADING_EMOJI = /^[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}\s]+/u;
// What a label the definition does not have must look like to be taken as one.
// Without a shape check every sentence with a colon in it ("At dusk he said:
// run") would become a field; short, letter-led and at most four words keeps
// most of those as text.
const UNKNOWN_LABEL = /^\p{L}[\p{L}\p{N} '’&/().-]{0,27}$/u;
const MAX_LABEL_WORDS = 4;
// Code fences and rules are markdown furniture, never a value.
const FURNITURE = /^(?:`{3,}.*|-{3,}|\*{3,}|_{3,})$/;
// A list the model says is empty.
const EMPTY_LIST = /^(?:nothing|none|empty|n\/?a|-|–|—)\.?$/i;
// Placeholder words a text/list value may be left as: the generic ones the
// skeleton uses when a field has no hint.
const GENERIC_PLACEHOLDERS = new Set(['value', 'text', 'number', 'comma separated', 'list', '...', '…']);
// A plain number inside brackets, `[80]`: a real answer the model bracketed
// because the skeleton it imitates is bracketed. Anything else in brackets in a
// number slot (`[0-100]`, `[number]`) is the skeleton itself.
const BRACKETED_NUMBER = /\[\s*(-?\d[\d,]*(?:\.\d+)?)\s*\]/g;
const PLAIN_NUMBER = /^\s*-?\d[\d,]*(?:\.\d+)?\s*$/;
const NUMBER = /(^|[^\d.,])(\d{1,3}(?:,\d{3})+(?!\d)|\d+)(\.\d+)?/;

const isNumeric = type => type === 'meter' || type === 'number';
const keyOf = label => String(label ?? '').replace(LEADING_EMOJI, '').replace(/\s+/g, ' ').trim().toLowerCase();

function fieldList(def) {
    return (Array.isArray(def?.fields) ? def.fields : []).filter(field => field && keyOf(field.label));
}

function fieldFor(def, label) {
    const key = keyOf(label);
    return fieldList(def).find(field => keyOf(field.label) === key) ?? null;
}

function entriesOf(state) {
    return (Array.isArray(state?.entries) ? state.entries : []).filter(entry => entry && keyOf(entry.label));
}

const firstLine = text => String(text ?? '').split('\n')[0].trim();
const formatNumber = number => String(number);

// The first number in `text`: `120`, `1,200`, `-5`, `2.5`. A minus counts only
// at the start or after a space or bracket, so `1-2` reads as 1, not 1 and -2.
function readNumber(text) {
    const source = String(text ?? '');
    const match = source.match(NUMBER);
    if (!match) return null;
    const before = source.slice(0, match.index + match[1].length);
    const negative = match[1] === '-' && /(^|[\s([])-$/.test(before);
    const value = Number.parseFloat(match[2].replace(/,/g, '') + (match[3] ?? ''));
    if (!Number.isFinite(value)) return null;
    return negative ? -value : value;
}

// A meter/number value the model left as the skeleton's placeholder, or as "?".
function isNumericPlaceholder(text) {
    const line = firstLine(text);
    if (line === '?') return true;
    if (!line.startsWith('[')) return false;
    const close = line.indexOf(']');
    const inner = close === -1 ? line.slice(1) : line.slice(1, close);
    return !PLAIN_NUMBER.test(inner);
}

// A text/list value that is only a placeholder. Brackets alone do not decide
// it: models bracket real answers too (Megumin Suite learned this the hard way),
// so only "?" or the exact placeholder the skeleton shows for this field counts.
function isTextPlaceholder(text, field) {
    const value = String(text ?? '').trim();
    if (value === '?') return true;
    const match = value.match(/^\[([^\]]*)\]$/);
    if (!match) return false;
    const inner = match[1].replace(/\s+/g, ' ').trim().toLowerCase();
    if (!inner || GENERIC_PLACEHOLDERS.has(inner)) return true;
    return Boolean(field?.hint) && inner === String(field.hint).replace(/\s+/g, ' ').trim().toLowerCase();
}

// The part of a number line before a change note: `80/100 (+5 drank potion)`.
const beforeNote = line => line.replace(BRACKETED_NUMBER, '$1').split('(')[0];

function readMeter(raw, field) {
    const fallbackMax = Number.isFinite(field?.max) && field.max > 0 ? field.max : 100;
    if (isNumericPlaceholder(raw)) return { value: null, max: fallbackMax };
    const head = beforeNote(firstLine(raw));
    const slash = head.match(/(?:\/|\bof\b)\s*(\d[\d,]*(?:\.\d+)?)/i);
    const parsedMax = slash ? Number.parseFloat(slash[1].replace(/,/g, '')) : NaN;
    return { value: readNumber(head), max: parsedMax > 0 ? parsedMax : fallbackMax };
}

function readNumberValue(raw) {
    if (isNumericPlaceholder(raw)) return null;
    return readNumber(beforeNote(firstLine(raw)));
}

function cleanItem(item) {
    return item.trim().replace(LIST_MARKER, '').replace(/^[*_]{1,2}|[*_]{1,2}$/g, '').trim();
}

// List items, or null when the list is a placeholder. Items are split on commas
// and on line breaks, so a bulleted list under the label reads too.
function readList(raw, field) {
    if (isTextPlaceholder(raw, field)) return null;
    if (EMPTY_LIST.test(raw.trim())) return [];
    return raw.split(/[,\n]/).map(cleanItem).filter(item => item && !EMPTY_LIST.test(item));
}

// One `Label: value` slot in `text`, or null when `text` does not start with one.
function readSlot(text, byKey) {
    let line = String(text ?? '').trim();
    const bulleted = LIST_MARKER.test(line);
    line = line.replace(LIST_MARKER, '');
    const match = line.match(SLOT);
    if (!match) return null;
    const label = match[2].replace(LEADING_EMOJI, '').replace(/^[_\s]+|[_\s]+$/g, '').replace(/\s+/g, ' ');
    if (!label) return null;
    const key = label.toLowerCase();
    const field = byKey.get(key) ?? null;
    if (!field && (!UNKNOWN_LABEL.test(label) || label.split(' ').length > MAX_LABEL_WORDS)) return null;
    let value = match[3].trim();
    // `**HP: 80/100**` — the closing bold landed on the value.
    if (match[1]) value = value.replace(/\s*[*_]{1,2}$/, '');
    return { label: field ? field.label : label, key, field, value, bulleted };
}

// Several fields on one line: `HP: 80/100 | Stamina: 60/100 | Gold: 120`. A pipe
// splits only where a defined label follows it, so `Status: tired | hungry`
// stays one text value. An undefined label after a pipe splits too, but only
// after a meter or number, whose value cannot sensibly hold a pipe.
function splitSegments(line, byKey) {
    if (!line.includes('|')) return [line];
    const segments = [];
    let start = 0;
    let current = readSlot(line, byKey);
    for (let at = line.indexOf('|'); at !== -1; at = line.indexOf('|', at + 1)) {
        const next = readSlot(line.slice(at + 1), byKey);
        if (!next) continue;
        if (!next.field && !isNumeric(current?.field?.type)) continue;
        segments.push(line.slice(start, at));
        start = at + 1;
        current = next;
    }
    segments.push(line.slice(start));
    return segments.map(segment => segment.trim()).filter(Boolean);
}

function buildEntry(hit) {
    const raw = hit.lines.join('\n').trim();
    // A label with nothing after it (and nothing on the lines below) was not
    // written: leaving it out beats storing an empty value.
    if (!raw) return null;
    const { label, field } = hit;
    const type = field ? field.type : 'text';
    if (type === 'meter') {
        const { value, max } = readMeter(raw, field);
        return { label, type, raw, value, max };
    }
    if (type === 'number') return { label, type, raw, value: readNumberValue(raw) };
    if (type === 'list') {
        const items = readList(raw, field);
        return { label, type, raw, value: items ? items.join(', ') : null, items: items ?? [] };
    }
    const entry = { label, type: 'text', raw, value: isTextPlaceholder(raw, field) ? null : raw };
    if (!field) entry.unknown = true;
    return entry;
}

export function empty() {
    return { entries: [] };
}

export function isEmpty(state) {
    return !entriesOf(state).some(entry => entry.value !== null && entry.value !== undefined);
}

export function parse(body, def) {
    try {
        return parseBody(body, def);
    } catch {
        // Never throw into the receive path; a body this broken is just invalid.
        return { ok: false, error: 'The block could not be read.' };
    }
}

function parseBody(body, def) {
    const fields = fieldList(def);
    if (!fields.length) return { ok: false, error: 'This block has no fields defined.' };
    const byKey = new Map(fields.map(field => [keyOf(field.label), field]));
    const text = unescapeBody(String(body ?? ''), def?.tag).replace(/\r\n?/g, '\n');

    // key -> { label, field, type, lines }. A label written twice: the later one
    // wins (it is usually the model correcting itself), keeping the first's place.
    const found = new Map();
    let last = null;
    for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();
        if (!line || FURNITURE.test(line)) continue;
        for (const segment of splitSegments(line, byKey)) {
            const slot = readSlot(segment, byKey);
            // `- Swordsmanship: adept` under `Skills:` is an item, not a new field.
            const listItem = slot && !slot.field && slot.bulleted && last?.type === 'list';
            if (slot && !listItem) {
                last = { label: slot.label, field: slot.field, type: slot.field?.type ?? 'text', lines: slot.value ? [slot.value] : [] };
                found.set(slot.key, last);
            } else if (last && !isNumeric(last.type)) {
                // A line without a label continues a text or list value. Under a
                // meter or number it has nowhere to go and is dropped, as is prose
                // before the first label.
                last.lines.push(segment);
            }
        }
    }

    const entries = [];
    for (const field of fields) {
        const hit = found.get(keyOf(field.label));
        const entry = hit && buildEntry(hit);
        if (entry) entries.push(entry);
    }
    for (const hit of found.values()) {
        const entry = !hit.field && buildEntry(hit);
        if (entry) entries.push(entry);
    }

    const defined = entries.filter(entry => !entry.unknown);
    if (!defined.length) {
        const sample = fields.slice(0, 3).map(field => field.label).join(', ');
        return { ok: false, error: `No known field found (expected lines like "${fields[0].label}: …" for ${sample}).` };
    }
    if (!defined.some(entry => entry.value !== null)) {
        return { ok: false, error: 'No field has a value (only placeholders or unreadable values).' };
    }
    return { ok: true, state: { entries } };
}

// The canonical value text for an entry: what serialize writes and what diff
// shows. Notes are dropped; a value that is null is written as "?".
function display(entry, def) {
    if (entry.value === null || entry.value === undefined) return '?';
    if (entry.type === 'meter') {
        const max = entry.max ?? fieldFor(def, entry.label)?.max ?? 100;
        return `${formatNumber(entry.value)}/${formatNumber(max)}`;
    }
    if (entry.type === 'number') return formatNumber(entry.value);
    if (entry.type === 'list') {
        const items = Array.isArray(entry.items) ? entry.items : [];
        return items.length ? items.join(', ') : 'none';
    }
    return String(entry.value).trim();
}

export function serialize(state, def) {
    const lines = entriesOf(state).map(entry => `${entry.label}: ${display(entry, def)}`);
    return escapeBody(lines.join('\n'), def?.tag);
}

// Unknown entries are left out: models invent and drop extra labels from one
// reply to the next, and reporting each of those would bury the real changes.
// A null value counts as absent, so a field that fell back to a placeholder
// shows as removed and one that got its value back shows as added.
export function diff(previous, next, def) {
    const present = state => new Map(entriesOf(state)
        .filter(entry => !entry.unknown && entry.value !== null && entry.value !== undefined)
        .map(entry => [keyOf(entry.label), entry]));
    const before = present(previous);
    const after = present(next);
    const changes = [];
    for (const [key, entry] of after) {
        const to = display(entry, def);
        const old = before.get(key);
        if (!old) changes.push({ type: 'added', label: entry.label, to });
        else {
            const from = display(old, def);
            if (from !== to) changes.push({ type: 'changed', label: entry.label, from, to });
        }
    }
    for (const [key, entry] of before) {
        if (!after.has(key)) changes.push({ type: 'removed', label: entry.label, from: display(entry, def) });
    }
    return changes;
}

// The skeleton line for one field, as Megumin Suite writes its stat spec.
function spec(field) {
    switch (field.type) {
        case 'meter': {
            const max = field.max || 100;
            return `${field.label}: [0-${max}]/${max}`;
        }
        case 'number': return `${field.label}: [number]`;
        case 'list': return `${field.label}: [${field.hint || 'comma separated'}]`;
        default: return `${field.label}: [${field.hint || 'value'}]`;
    }
}

const EXPLAIN = {
    meter: field => ` (current/${field.max || 100})`,
    number: () => ' (a number)',
    list: () => ' (comma separated; "none" when empty)',
    text: () => ' (short text)',
};

export function rules(def) {
    const fields = fieldList(def);
    if (!fields.length) return 'This block has no fields.';
    return [
        'One "Label: value" line per field, in exactly this order, replacing each [placeholder] with the real value:',
        ...fields.map(field => `- ${spec(field)}${(EXPLAIN[field.type] ?? EXPLAIN.text)(field)}`),
        'Carry every value forward from the current state unless something in this reply changed it. Never invent values the story has not given. No other labels and no other lines.',
    ].join('\n');
}

export function skeleton(def) {
    return escapeBody(fieldList(def).map(spec).join('\n'), def?.tag);
}
