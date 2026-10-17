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

export function rules() {
    return 'Write the block as plain text lines. No markdown headings.';
}

export function skeleton() {
    return '[text]';
}
