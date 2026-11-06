// Failure details for the QA replay oracle: name the first differing JSON path and optionally
// save the exact synthetic chat, states and action trace for a later investigation.

import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const object = value => value !== null && typeof value === 'object';
const pointer = key => String(key).replace(/~/g, '~0').replace(/\//g, '~1');
const display = value => {
    const text = JSON.stringify(value);
    return text === undefined ? '<missing>' : text.length > 400 ? `${text.slice(0, 400)}…` : text;
};

/** First difference between plain JSON values, including missing keys and array entries. */
export function firstDifference(live, rebuilt, path = '') {
    if (Object.is(live, rebuilt)) return null;
    if (object(live) && object(rebuilt) && Array.isArray(live) === Array.isArray(rebuilt)) {
        const keys = [...new Set([...Object.keys(live), ...Object.keys(rebuilt)])].sort();
        for (const key of keys) {
            const next = `${path}/${pointer(key)}`;
            const hasLive = Object.hasOwn(live, key), hasRebuilt = Object.hasOwn(rebuilt, key);
            if (!hasLive || !hasRebuilt) {
                return { path: next, live: display(hasLive ? live[key] : undefined), rebuilt: display(hasRebuilt ? rebuilt[key] : undefined) };
            }
            const found = firstDifference(live[key], rebuilt[key], next);
            if (found) return found;
        }
        if (Array.isArray(live) && live.length !== rebuilt.length) {
            return { path: `${path}/length`, live: display(live.length), rebuilt: display(rebuilt.length) };
        }
        return null;
    }
    return { path: path || '/', live: display(live), rebuilt: display(rebuilt) };
}

/** A concise failure message; FUZZ_DUMP_DIR may point to an existing directory for a full JSON dump. */
export function replayFailure({ label, index, live, rebuilt, chat, skipped, trace = [], dumpDir = process.env.FUZZ_DUMP_DIR }) {
    const difference = firstDifference(live, rebuilt);
    const summary = difference
        ? `${difference.path}: live=${difference.live}, rebuilt=${difference.rebuilt}`
        : 'values differ in their non-JSON shape';
    let dump = 'Set FUZZ_DUMP_DIR to an existing directory to save the chat and states.';
    if (dumpDir) {
        try {
            const path = join(mkdtempSync(join(dumpDir, 'state-fuzz-')), 'mismatch.json');
            writeFileSync(path, JSON.stringify({ label, index, live, rebuilt, chat, skipped, trace }, null, 2));
            dump = `Full replay dump: ${path}`;
        } catch (error) {
            dump = `Could not save replay dump: ${error.message}`;
        }
    }
    return `${label}: state at carrier ${index} equals a rebuild from scratch; first difference ${summary}\nRecent actions: ${JSON.stringify(trace.slice(-8))}\n${dump}`;
}
