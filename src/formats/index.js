// Format registry. Every format module exports the same interface (see
// docs/ARCHITECTURE.md): id, empty, isEmpty, parse, serialize, diff, rules, skeleton.

import * as rows from './rows.js';
import * as fields from './fields.js';
import * as text from './text.js';

export const FORMAT_MODULES = { rows, fields, text };

/** The format module for a block definition (falls back to free text). */
export function formatFor(def) {
    return FORMAT_MODULES[def?.format] ?? text;
}
