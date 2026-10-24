// Small shared pieces of the timeline package (docs/v2/TIMELINE.md): the failure envelope of contract §3,
// ids, and the marker a test's simulated crash carries.

import { newId } from '../commands.js';

/** The host's own module id (its blocks are stamped with it). */
export const HOST = 'story-block';

export const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

/** The ErrorCode union of contract §3 the timeline answers with. */
export const CODES = Object.freeze(['INVALID', 'REFUSED', 'NOT_FOUND', 'NOT_ENOUGH', 'CLAIMED', 'STALE', 'FEATURE_OFF', 'LIMITED', 'FAILED',
    'NOT_OWNER', 'UNSUPPORTED', 'UNKNOWN_COMMAND', 'DEPENDENCY_UNAVAILABLE', 'CLOCK_UNSET', 'RULES_MISMATCH', 'CONFLICT',
    'SNAPSHOT_UNAVAILABLE', 'RESTORE_PENDING', 'REPLAY_PREREQUISITE']);

/** `{ ok: false, code, message }`. */
export const fail = (code, message) => ({ ok: false, code, message });

/** A fresh `<prefix>_<8 base36>` id from the host's crypto source. */
export const makeId = prefix => newId(prefix);

// A simulated crash (tests): the process is gone, so nothing the timeline would do on the way out may run. The
// timeline rethrows it from every place it would otherwise catch an error.
const CRASH = Symbol.for('story-block.timeline.crash');
/** An error that stands for the process dying at a phase. */
export function crash(message = 'The process stopped here (simulated crash).') {
    const error = new Error(message);
    error[CRASH] = true;
    return error;
}
export const crashing = error => Boolean(error) && error[CRASH] === true;

/** The code of a failure envelope or thrown error the timeline may pass on: a known code, else FAILED. */
export const codeOf = value => (typeof value === 'string' && CODES.includes(value) ? value : 'FAILED');
