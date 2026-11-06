// Holds the reader's unsent board choices in chat metadata, never as game-state changes.
// The reply's resolver records the setup and choices; after capture only a fresh segment remains here.
// The opening carrier and attempt fix the seed, so a narrated swipe keeps the dice.

import { readSheet } from '../read.js';
import { fightSeed } from './dice.js';
import { boardWitness, equipmentForBoard, playBoard } from './engine.js';
import { boardFlags } from './overrides.js';
import { orderOf } from '../resolve.js';

const KEY = 'rpgFightBoard', ATTEMPTS = 'rpgFightAttempts', LAST = 'rpgFightLast';
const LINKS = 'rpgFightLinks';
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
        setup: { seed, offset: 0, rules: structuredClone(rules), flags: boardFlags(state), weapons: structuredClone(weapons), wearVersion: 1, ...(gear ? { gear: structuredClone(gear) } : {}) }, exchanges: [] };
    const preview = playBoard(state, session.setup, []);
    if (preview.error) return preview;
    meta[KEY] = session;
    return { session, preview };
}

/** Try an exchange without writing the sheet; rejected choices do not enter the session. */
export function stageExchange(meta, state, actions) {
    const session = boardSession(meta);
    if (!session) return { error: 'Open a fight first.' };
    if (session.exchanges.length && (!session.setup.witness || session.setup.witness.offset !== session.setup.offset)) return { error: 'This older fight cannot be checked. Discard it and start the fight again.' };
    const exchanges = [...session.exchanges, { actions: structuredClone(actions) }];
    const setup = { ...session.setup, witness: session.setup.witness ?? { offset: session.setup.offset, hash: boardWitness(state, session.setup) } };
    const preview = playBoard(state, setup, exchanges);
    if (preview.error) return preview;
    session.setup = setup;
    session.exchanges = exchanges;
    return { session, preview };
}

// The old view imports this until its undo control is removed by its owner.
export const undoExchange = undefined;

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
    return structuredClone({ id: session.id, anchor: session.anchor, groups: session.groups, setup: session.setup, exchanges: session.exchanges });
}

/** A segment belongs to the reply which opened it, even if earlier messages move. */
export const boardKey = board => `b:${encodeURIComponent(board.id)}:${encodeURIComponent(board.anchor)}:${board.setup.offset}`;

/** A previous swipe's own receipt is the authority for that reply's fight. */
export function priorBoard(message) {
    const records = [message?.extra?.storySuite, ...(Array.isArray(message?.swipe_info) ? message.swipe_info.map(info => info?.extra?.storySuite) : [])];
    for (const record of records) for (const receipt of record?.receipts ?? []) {
        const payload = receipt?.type === 'rpg.resolve' ? receipt.replan?.payload : null;
        if (object(payload?.board)) return structuredClone(payload);
    }
    return null;
}

/** The cache also covers a regenerate that removed its old reply before generation began. */
export const lastBoard = (meta, anchor, legacyKey, message = null) => {
    const saved = meta?.[LAST];
    const linked = object(message?.extra?.[LINKS]) && message.extra[LINKS][saved?.key] === true;
    return saved?.board && (linked || saved.board.anchor === anchor || (!saved.board.anchor && saved.key === legacyKey)) ? structuredClone(saved) : null;
};

/** Link the user's message to its reply's board key for regenerate after a middle delete. */
export function linkBoard(message, key) {
    if (!object(message) || typeof key !== 'string') return;
    if (!object(message.extra)) message.extra = {};
    if (!object(message.extra[LINKS])) message.extra[LINKS] = {};
    message.extra[LINKS][key] = true;
}

/** Once captured, an unfinished fight starts a new segment. */
export function receiveBoard(meta, payload, result, sid, receiptId = null, state = null, query = null) {
    if (!object(meta) || !object(payload?.board) || !object(result) || typeof sid !== 'string' || !sid) return false;
    meta[LAST] = structuredClone(payload);
    const board = payload.board;
    if (result.stop !== 'open') { delete meta[KEY]; return true; }
    const current = boardSession(meta), nextOffset = board.setup.offset + board.exchanges.length;
    if (current?.id === board.id && current.setup?.seed === board.setup.seed && current.setup.offset === nextOffset
        && current.base?.offset === board.setup.offset && (!current.carriedKey || current.carriedKey === payload.key)
        && JSON.stringify(current.setup.order ?? []) === JSON.stringify(result.order ?? [])) {
        current.anchor = sid;
        delete current.setup.invalidated;
        if (typeof receiptId === 'string') current.carried = receiptId;
        current.carriedKey = payload.key;
        return true;
    }
    const base = { offset: board.setup.offset, order: structuredClone(board.setup.order ?? null) };
    const setup = { ...structuredClone(board.setup), offset: nextOffset, order: structuredClone(result.order ?? []) };
    delete setup.witness;
    if (setup.wearVersion === 1 && setup.gear && state) Object.assign(setup, equipmentForBoard(state, setup.gear, query));
    meta[KEY] = { id: board.id, origin: board.id.split(':')[0], anchor: sid, groups: structuredClone(board.groups),
        setup, exchanges: [], carriedKey: payload.key, ...(typeof receiptId === 'string' ? { carried: receiptId } : {}), base };
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
    if (alive) { delete session.setup.invalidated; return session; }
    if (session.exchanges.length) {
        session.setup.invalidated = true;
        return session;
    }
    const base = object(session.base) ? session.base : { offset: 0, order: null };
    session.setup = { ...session.setup, offset: Number.isSafeInteger(base.offset) ? base.offset : 0 };
    if (orderOf(base.order)) session.setup.order = structuredClone(base.order); else delete session.setup.order;
    delete session.setup.witness;
    // (Reader choices staged after the take-back are kept: they now roll from the segment's first die.)
    delete session.carried;
    delete session.carriedKey;
    delete session.base;
    return session;
}
