// An independent oracle for SPEC §2.2: the state at carrier N rebuilt from scratch out of the chat
// alone (latest checkpoint at or before N, then every carrier's ops), with its own strict JSON Patch
// (RFC 6902 add / replace / remove) instead of src/v2/ops.js. A block of ops (the record's `spans`,
// one per stored receipt) that does not apply is skipped alone, its /meta/rev still counted, as the
// store does with a hand-edited chat or a deleted middle reply; a record whose spans do not add up is
// one block. Which swipe's record counts is the store's documented rule (persist.js readRecord), so
// that one function is shared.
// Two rules from the break round, written here on their own: a checkpoint whose `covers` (the record
// IDs since the checkpoint before it) no longer matches the chat is passed over (B2-4); an op with a
// numeric `was` on a number that now stands elsewhere adds its change (value − was) instead, and the
// inventory's own validator must then accept the block (B3-8).

import assert from 'node:assert/strict';
import { readRecord } from '../../../../src/v2/persist.js';
import { createStore } from '../../../../src/v2/store.js';
import { validateInventory } from '../../../../src/v2/domains/inventory.js';

const isCarrier = message => Boolean(message) && typeof message === 'object' && !message.is_user;

export const carriers = chat => chat.map((message, index) => (isCarrier(message) ? index : -1)).filter(index => index >= 0);

const unescape = segment => segment.replace(/~1/g, '/').replace(/~0/g, '~');

/** Strict JSON Patch on a deep copy; throws when a path does not fit. Counts with `was` move (above). */
export function strictApply(state, ops) {
    let root = structuredClone(state);
    let moved = false;
    for (const original of ops) {
        let op = original;
        if (op?.op === 'replace' && typeof op.was === 'number' && typeof op.value === 'number') {
            const keys = op.path.slice(1).split('/').map(unescape);
            let now = root;
            for (const key of keys) now = now !== null && typeof now === 'object' && Object.hasOwn(now, key) ? now[key] : undefined;
            if (typeof now === 'number' && now !== op.was) {
                op = { ...op, value: now + op.value - op.was };
                moved = true;
            }
        }
        if (!op || !['add', 'replace', 'remove'].includes(op.op)) throw new Error(`bad op ${op?.op}`);
        if (op.path === '') {
            if (op.op === 'remove') throw new Error('cannot remove the root');
            root = structuredClone(op.value);
            continue;
        }
        if (!op.path.startsWith('/')) throw new Error(`bad path ${op.path}`);
        const keys = op.path.slice(1).split('/').map(unescape);
        const last = keys.pop();
        let target = root;
        for (const key of keys) {
            if (target === null || typeof target !== 'object' || !Object.hasOwn(target, key)) throw new Error(`no ${op.path}`);
            target = target[key];
        }
        if (target === null || typeof target !== 'object') throw new Error(`no container at ${op.path}`);
        if (Array.isArray(target)) {
            const index = last === '-' ? target.length : Number(last);
            if (!Number.isInteger(index) || index < 0) throw new Error(`bad index ${op.path}`);
            if (op.op === 'add') {
                if (index > target.length) throw new Error(`index past end ${op.path}`);
                target.splice(index, 0, structuredClone(op.value));
            } else {
                if (index >= target.length) throw new Error(`no ${op.path}`);
                if (op.op === 'replace') target[index] = structuredClone(op.value);
                else target.splice(index, 1);
            }
        } else if (op.op === 'add') {
            target[last] = structuredClone(op.value);
        } else {
            if (!Object.hasOwn(target, last)) throw new Error(`no ${op.path}`);
            if (op.op === 'replace') target[last] = structuredClone(op.value);
            else delete target[last];
        }
    }
    if (moved && root?.domains?.inventory && validateInventory(root.domains.inventory).length) throw new Error('moved counts break the inventory');
    return root;
}

// The checkpoint carrier to start from for `upTo`: the last one whose `covers` matches the record IDs
// since the one before it (none: trusted), else the latest one.
function startOf(chat, upTo) {
    let from = -1;
    let latest = -1;
    let since = [];
    for (let i = 0; i <= Math.min(upTo, chat.length - 1); i++) {
        if (!isCarrier(chat[i])) continue;
        const record = readRecord(chat[i]);
        if (!record) continue;
        if (record.checkpoint) {
            latest = i;
            const covers = record.covers;
            if (!Array.isArray(covers) || (from >= 0 && JSON.stringify(covers) === JSON.stringify(since))) {
                from = i;
                since = [];
            }
        }
        since.push(record.sid);
    }
    return from >= 0 ? from : latest;
}

/** A record's ops as its stored blocks (`spans`), or one block when the spans do not add up. */
export function blocksOf(record) {
    const spans = Array.isArray(record.spans) ? record.spans : null;
    const total = spans ? spans.reduce((sum, span) => sum + (Number.isInteger(span?.n) && span.n >= 0 ? span.n : NaN), 0) : NaN;
    if (total !== record.ops.length) return record.ops.length ? [record.ops] : [];
    const out = [];
    let at = 0;
    for (const span of spans) {
        if (span.n) out.push(record.ops.slice(at, at + span.n));
        at += span.n;
    }
    return out;
}

/** { state, skipped: [{ index, block, revs }] } at carrier `upTo`, rebuilt from the chat alone; state null without a checkpoint. */
export function rebuildAt(chat, upTo) {
    const from = startOf(chat, upTo);
    if (from < 0) return { state: null, skipped: [] };
    let state = structuredClone(readRecord(chat[from]).checkpoint);
    const skipped = [];
    for (let i = from; i <= upTo && i < chat.length; i++) {
        const record = readRecord(chat[i]);
        if (!record) continue;
        blocksOf(record).forEach((ops, block) => {
            try {
                state = strictApply(state, ops);
            } catch {
                const revs = ops.filter(op => op.path === '/meta/rev').map(op => op.value);
                skipped.push({ index: i, block, revs });
                if (revs.length && revs.at(-1) > state.meta.rev) state.meta.rev = revs.at(-1);
            }
        });
    }
    return { state, skipped };
}

/** The records on the current line of history, oldest first: [{ index, record }]. */
export function lineRecords(chat) {
    return carriers(chat).map(index => ({ index, record: readRecord(chat[index]) })).filter(entry => entry.record);
}

const plain = value => (value === null || value === undefined ? value : JSON.parse(JSON.stringify(value)));

/**
 * Every state invariant at once, against the host (createHost). `label` says which step this is.
 * - the store's state at every carrier equals the oracle's rebuild from scratch (and a brand-new
 *   store over a copy of the chat agrees, so no cache can hide a difference);
 * - a narrated receipt is told at most once on this line, never before it happened, and the
 *   store's untold list is exactly the ones nobody told;
 * - no receipt id appears twice on the line.
 */
export function checkInvariants(host, label) {
    const chat = host.ctx.chat;
    const store = host.store;
    const indexes = carriers(chat);
    for (const index of indexes) {
        const expected = rebuildAt(chat, index).state;
        assert.deepEqual(plain(store.at(index)), plain(expected), `${label}: state at carrier ${index} equals a rebuild from scratch`);
    }
    const headIndex = indexes.at(-1) ?? -1;
    assert.equal(store.headIndex(), headIndex, `${label}: head index`);
    if (headIndex >= 0) {
        // With the validators the host passes (runtime.js): a replay that moves counts is checked by them.
        const validate = (state, names) => (names.includes('inventory') ? validateInventory(state.domains.inventory) : []);
        const fresh = createStore({ chat: () => structuredClone(chat), save: async () => {}, validate });
        assert.deepEqual(plain(fresh.head()), plain(store.head()), `${label}: a new store over a copy of the chat agrees with the cached head`);
    }

    const records = lineRecords(chat);
    const owner = new Map();
    for (const { index, record } of records) {
        for (const receipt of record.receipts) {
            assert.ok(!owner.has(receipt.id), `${label}: receipt ${receipt.id} is stored twice on this line (carriers ${owner.get(receipt.id)?.index} and ${index})`);
            owner.set(receipt.id, { index, receipt });
        }
    }
    const tellers = new Map();
    for (const { index, record } of records) {
        for (const id of record.narrated) {
            if (!tellers.has(id)) tellers.set(id, []);
            tellers.get(id).push(index);
        }
    }
    const untoldExpected = [];
    for (const [id, { index, receipt }] of owner) {
        if (receipt.narrate !== true) continue;
        const told = tellers.get(id) ?? [];
        assert.ok(told.length <= 1, `${label}: receipt ${id} ("${receipt.summary}") is told ${told.length} times on this line (carriers ${told.join(', ')})`);
        if (told.length) assert.ok(told[0] >= index, `${label}: receipt ${id} on carrier ${index} is told by an earlier carrier ${told[0]}`);
        else untoldExpected.push(id);
    }
    assert.deepEqual(store.untold().map(receipt => receipt.id), untoldExpected, `${label}: untold receipts are exactly the ones nobody told, oldest first`);
    return { records, owner, tellers };
}
