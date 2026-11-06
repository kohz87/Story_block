// Keeps a failed board capture attached to the reply's stable record ID.
// Markers are add-only; the reply's recorded prelude shows when capture succeeded.
// The turn restores the small capture session after a reload or swipe.

import { readRecord } from '../persist.js';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const boardStep = current => current?.prechecks?.find(step => step?.type === 'rpg.resolve' && step.payload?.board);

export function heldForSid(meta, sid, receipts = []) {
    const held = typeof sid === 'string' ? meta?.rpgFightHeld?.[sid] : null;
    const step = boardStep(held?.current);
    if (!object(held) || !step) return null;
    const done = receipts.some(receipt => receipt?.type === 'rpg.resolve' && receipt.beforeGenerate === true
        && receipt.replan?.payload?.key === step.payload.key && receipt.replan?.payload?.board?.id === step.payload.board.id);
    return done ? null : held;
}

export function heldForMessage(meta, message) {
    if (!object(meta?.rpgFightHeld)) return null;
    const record = readRecord(message);
    return record ? heldForSid(meta, record.sid, record.receipts) : null;
}

export function rememberHeld(meta, sid, current, staged) {
    if (!object(meta) || typeof sid !== 'string' || !sid || !boardStep(current)) return false;
    if (!object(meta.rpgFightHeld)) meta.rpgFightHeld = {};
    if (!Object.hasOwn(meta.rpgFightHeld, sid)) {
        meta.rpgFightHeld[sid] = { current: structuredClone({ type: current.type, prechecks: current.prechecks,
            base: current.base, untold: current.untold, stopped: current.stopped === true }), staged };
    }
    return true;
}

export function discardHeld(meta, sid) {
    if (!object(meta) || typeof sid !== 'string' || !meta.rpgFightHeld?.[sid]) return;
    if (!object(meta.rpgFightHeldDiscarded)) meta.rpgFightHeldDiscarded = {};
    if (!Object.hasOwn(meta.rpgFightHeldDiscarded, sid)) meta.rpgFightHeldDiscarded[sid] = true;
}
