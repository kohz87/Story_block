// Free text: the body is kept as written. Nothing to validate beyond "not empty",
// and nothing structured to compare, so there is no diff.

import { escapeBody, unescapeBody } from './escape.js';

export const id = 'text';

export function empty() {
    return { text: '' };
}

export function isEmpty(state) {
    return !String(state?.text ?? '').trim();
}

export function parse(body, def) {
    const text = unescapeBody(String(body ?? ''), def?.tag).replace(/\r\n?/g, '\n').trim();
    if (!text) return { ok: false, error: 'The block is empty.' };
    return { ok: true, state: { text } };
}

export function serialize(state, def) {
    return escapeBody(String(state?.text ?? '').trim(), def?.tag);
}

export function diff() {
    return [];
}

export function rules(def) {
    if (def?.layout) {
        return 'Follow the layout shown under "Write it exactly like this": keep every label, symbol and line in its place, replace each [placeholder] with the real value, repeat a part only where the layout says to, and leave out lines that do not apply. No other headings.';
    }
    return 'Write the block as plain text lines. No markdown headings.';
}

export function skeleton(def) {
    return def?.layout ? escapeBody(def.layout, def.tag) : '[text]';
}
