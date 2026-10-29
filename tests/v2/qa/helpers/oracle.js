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
// inventory's own validator must then accept the block (B3-8); a moved `qty` that comes to exactly 0
// removes the thing that holds it (r2-3); a remove of an object key already gone does nothing, unless it
// is a counted take (`was`); a list append (`/-`) lands at the end.
// Two more from SPEC §2.2 the oracle lacked until fix-fuzz150 (the 150-step fuzz found the store right):
// a counted remove (`was` at `count`, a stack a reply emptied) of a thing that now holds another number
// takes `was` from it and the rest stays; rule (c), a replace of an object key inside a domain that is
// not there, in an object that is, is an add. Inside a scratch field, a list is applied as written.
// A replayed block is checked by the validator of every domain it touches, not the inventory's alone
// (SPEC §2.2 "Replayed blocks are checked", as the host does in runtime.js): a block that brings a
// problem its state did not have is skipped. So `+ present Fenna`, `- present Fenna`, `+ present Fenna`
// with the middle reply deleted keeps Fenna once: the last append would list her twice, which the
// scene's validator refuses, and that block is skipped.
// A reader's loot take is a guarded block (docs/v2/REPLAY.md; inventory.js lootTakeGuard): it applies, with its claim,
// only while the reply's offer it took from is in the state before it and lays out at least what it took, and its claim
// is free. A guarded block of any other kind does not apply here (the QA chats make none).

import assert from 'node:assert/strict';
import { readRecord } from '../../../../src/v2/persist.js';
import { createStore } from '../../../../src/v2/store.js';
import { validateInventory } from '../../../../src/v2/domains/inventory.js';
import { validateScene } from '../../../../src/v2/domains/scene.js';
import { probeModule } from './probe-module.js';

const isCarrier = message => Boolean(message) && typeof message === 'object' && !message.is_user;

export const carriers = chat => chat.map((message, index) => (isCarrier(message) ? index : -1)).filter(index => index >= 0);

const unescape = segment => segment.replace(/~1/g, '/').replace(/~0/g, '~');

/** Strict JSON Patch on a deep copy; throws when a path does not fit. Counts with `was` move (above). */
// The inventory's scratch fields (its domain's `scratch`): the tally, the loot on offer, the condition events;
// and the scene's weather (one record a later reply writes whole, MODULES §F120).
const SCRATCH = ['/domains/inventory/perReply', '/domains/inventory/loot', '/domains/inventory/condLog', '/domains/scene/weather'];
const at = (root, keys) => keys.reduce((node, key) => (node !== null && typeof node === 'object' && Object.hasOwn(node, key) ? node[key] : undefined), root);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// The validators of the domains the QA chats hold (Story Block's core two and the probe's), by domain name.
const VALIDATORS = Object.freeze({ inventory: validateInventory, scene: validateScene, probe: probeModule().domains.probe.validate });
/** The problems of the named domains in `state` (a domain the state lacks has none). */
export function validateDomains(state, names) {
    return names.flatMap(name => {
        const fn = VALIDATORS[name];
        const slice = state?.domains?.[name];
        return typeof fn === 'function' && slice !== undefined ? fn(slice).map(problem => `${name}: ${problem}`) : [];
    });
}

export function strictApply(state, ops) {
    let root = structuredClone(state);
    // The domains the block touches (any op under /domains/<name>), checked after it as the host does.
    const touched = new Set();
    for (const op of ops) {
        const name = typeof op?.path === 'string' && /^\/domains\/[^/]/.test(op.path) ? unescape(op.path.split('/')[2]) : null;
        if (name !== null) touched.add(name);
    }
    const startProblems = new Set(validateDomains(root, [...touched]));
    for (const original of ops) {
        let op = original;
        // The inventory's per-reply tally (scratch): a drop of something already gone is passed over;
        // anything else is put in place, making the objects on the way.
        // A list inside one (an append `/-`, a position) is not fitted: it applies as written below.
        const inList = keys => keys.at(-1) === '-' || keys.slice(0, -1).some((_, n) => Array.isArray(at(root, keys.slice(0, n + 1))));
        if (typeof op?.path === 'string' && SCRATCH.some(root => op.path.startsWith(`${root}/`)) && !inList(op.path.slice(1).split('/').map(unescape))) {
            const keys = op.path.slice(1).split('/').map(unescape);
            if (op.op === 'remove') {
                if (at(root, keys) === undefined) continue;
            } else {
                let node = root;
                for (const key of keys.slice(0, -1)) {
                    if (!record(node[key])) node[key] = {};
                    node = node[key];
                }
                node[keys.at(-1)] = structuredClone(op.value);
                continue;
            }
        }
        // Replayed, a remove of an object key that is not there does nothing (unless it is a counted take).
        if (op?.op === 'remove' && typeof op.was !== 'number' && typeof op.path === 'string' && op.path.startsWith('/')) {
            const keys = op.path.slice(1).split('/').map(unescape);
            let node = root;
            let gone = false;
            for (const key of keys) {
                if (!record(node)) break;
                if (!Object.hasOwn(node, key)) { gone = true; break; }
                node = node[key];
            }
            if (gone) continue;
        }
        // A counted remove (a stack a reply emptied: `was` at `count`) of a thing that now holds another
        // number takes `was` from it instead; the rest stays (less than `was` goes below zero, refused below).
        if (op?.op === 'remove' && typeof op.was === 'number' && typeof op.count === 'string' && op.count.startsWith('/') && typeof op.path === 'string') {
            const now = at(root, `${op.path}${op.count}`.slice(1).split('/').map(unescape));
            if (typeof now === 'number' && now !== op.was) op = { op: 'replace', path: `${op.path}${op.count}`, value: now - op.was };
        }
        // Rule (c): a replace (not counted) of an object key inside a domain that is not there, in an object
        // that is, is an add (only a deleted reply had added the key).
        if (op?.op === 'replace' && typeof op.was !== 'number' && typeof op.path === 'string' && op.path.startsWith('/domains/')) {
            const keys = op.path.slice(1).split('/').map(unescape);
            const parent = at(root, keys.slice(0, -1));
            if (keys.length >= 3 && record(parent) && !Object.hasOwn(parent, keys.at(-1))) op = { op: 'add', path: op.path, value: op.value };
        }
        if (op?.op === 'replace' && typeof op.was === 'number' && typeof op.value === 'number') {
            const keys = op.path.slice(1).split('/').map(unescape);
            const now = at(root, keys);
            // A count whose holder is gone counts from 0 (a holder that is only that count, a wallet, made again).
            if (now === undefined && record(at(root, keys.slice(0, -1)))) {
                op = { op: 'add', path: op.path, value: op.value - op.was };
            } else if (now === undefined && at(root, keys.slice(0, -1)) === undefined && record(at(root, keys.slice(0, -2)))
                && Object.values(at(root, keys.slice(0, -2))).every(other => record(other) && Object.keys(other).every(field => field === keys.at(-1)))) {
                op = { op: 'add', path: op.path.replace(/\/[^/]*$/, ''), value: { [keys.at(-1)]: op.value - op.was } };
            } else if (typeof now === 'number' && now !== op.was) {
                op = { ...op, value: now + op.value - op.was };
                // A moved `qty` at exactly 0 removes the thing holding it (r2-3: no stack is kept at 0).
                if (op.value === 0 && keys.length > 3 && keys[keys.length - 1] === 'qty') op = { op: 'remove', path: op.path.replace(/\/[^/]*$/, '') };
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
    // A replayed block may not leave a domain it touches with a problem it did not have before (r2-14).
    // (A moved count is always under /domains/inventory, so the inventory is among them then.)
    if (validateDomains(root, [...touched]).some(problem => !startProblems.has(problem))) {
        throw new Error('the changes break a domain they touch');
    }
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

// A record's blocks with their spans ([{ ops, span }]); one block with no span when the spans do not add up.
function spannedBlocks(record) {
    const spans = Array.isArray(record.spans) ? record.spans : null;
    const total = spans ? spans.reduce((sum, span) => sum + (Number.isInteger(span?.n) && span.n >= 0 ? span.n : NaN), 0) : NaN;
    if (total !== record.ops.length) return record.ops.length ? [{ ops: record.ops, span: null }] : [];
    const out = [];
    let at = 0;
    for (const span of spans) {
        if (span.n) out.push({ ops: record.ops.slice(at, at + span.n), span });
        at += span.n;
    }
    return out;
}

/** A record's ops as its stored blocks (`spans`), or one block when the spans do not add up. */
export function blocksOf(record) {
    return spannedBlocks(record).map(entry => entry.ops);
}

/** Whether a guarded block may apply on `state` (the state before it): a loot take whose offer still holds what it took (above). */
export function guardHolds(state, guard) {
    const predicate = guard?.predicate;
    if (predicate?.kind !== 'loot.take') return false;
    const offer = at(state, ['domains', 'inventory', 'loot', String(predicate.sid)]);
    if (!record(offer) || (offer.claim || `loot:${predicate.sid}`) !== predicate.claim) return false;
    if (Object.hasOwn(state?.meta?.claims ?? {}, predicate.claim)) return false;
    const things = Object.values(record(offer.items) ? offer.items : {});
    const fold = name => String(name).trim().replace(/\s+/g, ' ').toLowerCase();
    const items = predicate.items.every(want => things.some(item => item.coin === undefined && fold(item.name) === fold(want.name) && item.qty >= want.qty));
    const purse = things.find(item => item.coin !== undefined)?.coin ?? 0;
    return items && purse >= predicate.coin;
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
        spannedBlocks(record).forEach(({ ops, span }, block) => {
            try {
                if (span?.id && span.guard && !guardHolds(state, span.guard)) throw new Error('its guard does not hold');
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
        // With the validators the host passes (runtime.js): a replay that moves counts, or any replayed block, is checked by them.
        const validate = (state, names) => validateDomains(state, names);
        // And the inventory's per-reply tally and the scene's weather as the scratch they are declared to be (ops.js).
        const scratch = name => (name === 'inventory' ? ['perReply', 'loot', 'condLog'] : name === 'scene' ? ['weather'] : []);
        const fresh = createStore({ chat: () => structuredClone(chat), save: async () => {}, validate, scratch });
        fresh.attachGuard((state, { guard }) => (guardHolds(state, guard) ? { ok: true } : { ok: false, reason: 'its guard does not hold' }));
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
