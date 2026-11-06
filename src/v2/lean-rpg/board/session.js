// Holds the reader's unsent board choices in chat metadata, never as game-state changes.
// The reply's resolver records the setup and choices; after capture only a fresh segment remains here.
// The opening carrier and attempt fix the seed, so undo and a narrated swipe keep the dice.

import { readSheet } from '../read.js';
import { fightSeed } from './dice.js';
import { playBoard } from './engine.js';
import { boardFlags } from './overrides.js';

const KEY = 'rpgFightBoard', ATTEMPTS = 'rpgFightAttempts', LAST = 'rpgFightLast';
const object = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const boardSession = meta => (object(meta?.[KEY]) ? meta[KEY] : null);

/** Open on a carrier: its ID and discard count determine the fight's seed. */
export function openBoard(meta, state, { sid, rules, gear = null, weapons = {} } = {}) {
    if (!object(meta) || typeof sid !== 'string' || !sid) return { error: 'There is no reply to open a fight from.' };
    const sheet = readSheet(state), groups = sheet.foes.filter(foe => foe.filled && foe.hurt > 0).map(foe => foe.slot);
    if (!sheet.characters.some(actor => actor.alive !== false && actor.health !== 0) || !groups.length) return { error: 'There is no fight to open.' };
    const attempt = Number.isSafeInteger(meta[ATTEMPTS]?.[sid]) ? meta[ATTEMPTS][sid] : 0;
    const seed = fightSeed(sid, attempt);
    const session = { id: `${sid}:${attempt}`, origin: sid, anchor: sid, groups,
        setup: { seed, offset: 0, rules: structuredClone(rules), flags: boardFlags(state), weapons: structuredClone(weapons), ...(gear ? { gear: structuredClone(gear) } : {}) }, exchanges: [] };
    const preview = playBoard(state, session.setup, []);
    if (preview.error) return preview;
    meta[KEY] = session;
    return { session, preview };
}

/** Try an exchange without writing the sheet; rejected choices do not enter the session. */
export function stageExchange(meta, state, actions) {
    const session = boardSession(meta);
    if (!session) return { error: 'Open a fight first.' };
    const exchanges = [...session.exchanges, { actions: structuredClone(actions) }];
    const preview = playBoard(state, session.setup, exchanges);
    if (preview.error) return preview;
    session.exchanges = exchanges;
    return { session, preview };
}

/** Undo only choices that have not been carried by a reply. */
export function undoExchange(meta, state) {
    const session = boardSession(meta);
    if (!session || !session.exchanges.length) return { error: 'There is no exchange to undo.' };
    session.exchanges = session.exchanges.slice(0, -1);
    return { session, preview: playBoard(state, session.setup, session.exchanges) };
}

/** Discard changes the next opening's seed; no staged rolls were written to the sheet. */
export function discardBoard(meta) {
    const session = boardSession(meta);
    if (!session) return false;
    if (!object(meta[ATTEMPTS])) meta[ATTEMPTS] = {};
    meta[ATTEMPTS][session.origin] = (Number.isSafeInteger(meta[ATTEMPTS][session.origin]) ? meta[ATTEMPTS][session.origin] : 0) + 1;
    delete meta[KEY];
    return true;
}

/** The exact data the reply must keep; none of the session's view state goes with it. */
export function boardPayload(session) {
    return structuredClone({ id: session.id, groups: session.groups, setup: session.setup, exchanges: session.exchanges });
}

/** A previous swipe's own receipt is the authority for that reply's fight. */
export function priorBoard(message, key) {
    const records = [message?.extra?.storySuite, ...(Array.isArray(message?.swipe_info) ? message.swipe_info.map(info => info?.extra?.storySuite) : [])];
    for (const record of records) for (const receipt of record?.receipts ?? []) {
        const payload = receipt?.type === 'rpg.resolve' ? receipt.replan?.payload : null;
        if (payload?.key === key && object(payload.board)) return structuredClone(payload);
    }
    return null;
}

/** The cache also covers a regenerate that removed its old reply before generation began. */
export const lastBoard = (meta, key) => (meta?.[LAST]?.key === key ? structuredClone(meta[LAST]) : null);

/** Once captured, the carried exchanges cannot be undone; an unfinished fight starts a new segment. */
export function receiveBoard(meta, payload, result, sid, receiptId = null) {
    if (!object(meta) || !object(payload?.board) || !object(result) || typeof sid !== 'string' || !sid) return false;
    meta[LAST] = structuredClone(payload);
    const board = payload.board;
    if (result.stop !== 'open') { delete meta[KEY]; return true; }
    const base = { offset: board.setup.offset, order: structuredClone(board.setup.order ?? null) };
    meta[KEY] = { id: board.id, origin: board.id.split(':')[0], anchor: sid, groups: structuredClone(board.groups),
        setup: { ...structuredClone(board.setup), offset: board.setup.offset + board.exchanges.length, order: structuredClone(result.order ?? []) }, exchanges: [],
        ...(typeof receiptId === 'string' ? { carried: receiptId } : {}), base };
    return true;
}

/**
 * A rewind or delete can take back the receipt that carried the current segment. The chat metadata then
 * still holds that segment's offset; put it back to where the segment began so the same dice are played.
 * `hasReceipt(id)` answers whether that receipt is still in the current timeline.
 */
export function reconcileBoard(meta, hasReceipt) {
    const session = boardSession(meta);
    if (!session || typeof session.carried !== 'string' || typeof hasReceipt !== 'function') return session;
    let alive = false;
    try { alive = hasReceipt(session.carried) === true; } catch { alive = true; }
    if (alive) return session;
    const base = object(session.base) ? session.base : { offset: 0, order: null };
    session.setup = { ...session.setup, offset: Number.isSafeInteger(base.offset) ? base.offset : 0 };
    if (object(base.order)) session.setup.order = structuredClone(base.order); else delete session.setup.order;
    // (Reader choices staged after the take-back are kept: they now roll from the segment's first die.)
    delete session.carried;
    delete session.base;
    return session;
}
