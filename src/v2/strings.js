// Every text Story Block's v2 screens and page furniture show the reader, in one place (MODULES §F56):
// English for now, kept together so a translation later is one file. Code refers to a text by its key
// (`STRINGS.bar.story`); a text with holes names them in braces (`'{n} more'`) and is filled with `fill`.
//
// * `fill(text, values)`: plain text (textContent, summaries). A hole without a value stays as written.
// * `html(text, values)`: for screen templates. The text is HTML-escaped first, then the holes are filled
//   with the values as they are, so a hole can take a template binding (`{{ it.qty }}`).
// * `jsonText(text)`: a text inside a JSON string in a template attribute (`data-props='{"label":"…"}'`).
//
// Existing messages written by the runtime and other parts stay with their owners; inline-edit messages are below.

import { MESSAGE_STRINGS } from './strings/messages.js';
import { PAGE_STRINGS } from './strings/page.js';
import { SCREEN_STRINGS } from './strings/screens.js';

function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const item of Object.values(value)) deepFreeze(item);
    }
    return value;
}

export const STRINGS = deepFreeze({
    ...MESSAGE_STRINGS,
    ...PAGE_STRINGS,
    ...SCREEN_STRINGS,
});

const HOLE = /\{(\w+)\}/g;

/** `text` with each `{name}` replaced by `values[name]` (a hole without a value stays as written). */
export function fill(text, values = {}) {
    return String(text ?? '').replace(HOLE, (hole, name) => (Object.hasOwn(values, name) && values[name] !== undefined && values[name] !== null ? String(values[name]) : hole));
}

/** What a reader sees when a command was refused: a full reply budget or a chat that holds as many block versions as it can, in plain words (`pinsFull` words the second), else the refusal's own sentence (or `fallback`). */
export function refusalText(result, fallback = '', { pinsFull = STRINGS.editMessages.pinsFull } = {}) {
    if (result?.code === 'DM_BUDGET') return /Retained pin budget exhausted/.test(String(result.message ?? '')) ? pinsFull : STRINGS.editMessages.replyFull;
    return result?.message || fallback;
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' };

/** `text` escaped for HTML (text and quoted attributes). */
export const escapeHtml = text => String(text ?? '').replace(/[&<>"']/g, char => ESCAPES[char]);

/**
 * For screen templates: `text` HTML-escaped, then its holes filled with `values` as they are (template
 * bindings such as `{{ it.qty }}`, or markup the caller wrote).
 */
export function html(text, values = {}) {
    return fill(escapeHtml(text), values);
}

/** `text` as the inside of a JSON string, escaped for an HTML attribute (a widget's `data-props`). */
export const jsonText = text => escapeHtml(JSON.stringify(String(text ?? '')).slice(1, -1));
