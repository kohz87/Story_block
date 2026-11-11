// The prefix memo, on a fake store state: its spine run, exact key, one-record fast path, bounded LRU, deep
// freezing, and every reason it must replay instead (guards, checkpoints, a staged Re-read or an applying write).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readRecord } from '../../src/v2/persist.js';
import { hashJson } from '../../src/v2/replay.js';
import { hasMeta } from '../../src/v2/store/digest.js';
import { createPrefixMemo, PREFIX_MEMO_MAX } from '../../src/v2/store/prefix-memo.js';
import { createStore } from '../../src/v2/store.js';

const state = (n, seen = []) => ({ v: 2, meta: { rev: n }, domains: { test: { n, seen } } });
const user = text => ({ is_user: true, mes: text, extra: {} });

function reply(sid, count = 1, extra = {}) {
    const ops = Array.from({ length: count }, (_, at) => ({ op: 'replace', path: `/domains/test/${at}`, value: at }));
    return {
        is_user: false, mes: `reply ${sid}`, swipe_id: 0,
        extra: { storySuite: {
            v: 2, sid, ops, receipts: [], narrated: [], spans: [],
            source: { logical: sid, swipeKey: `sw_${sid}`, evidence: `ev_${sid}` }, ...extra,
        } },
    };
}

const applyRecord = (current, record) => {
    const prior = current?.domains?.test ?? { n: 0, seen: [] };
    return state(prior.n + record.ops.length, [...prior.seen, record.sid]);
};

function setup({ guardSeen = false, found = null } = {}) {
    const s = {
        prefixes: new Map(), guardSeen, applying: null, staged: null,
        counts: { replays: 0, recordsRead: 0, lineScans: 0, witnessMisses: 0, prefixHits: 0, prefixSteps: 0, prefixReplays: 0 },
    };
    const env = { features: 'feat=1', mark: 'guard-1', marked: false, chatId: 'chat-a' };
    const calls = { replay: 0, step: 0, chain: 0, spine: 0 };
    const replay = (arr, index) => {
        calls.replay++;
        if (found !== null && index >= found) s.replanFrom = Math.min(s.replanFrom, found);   // (a guarded step with a replan at `found`)
        let current = null;
        for (let i = 0; i <= index; i++) {
            const record = readRecord(arr[i]);
            if (!record) continue;
            if (record.checkpoint) current = structuredClone(record.checkpoint);
            current = applyRecord(current, record);
        }
        return { state: current };
    };
    const replayRecord = (current, record) => {
        calls.step++;
        return applyRecord(current, record);
    };
    const chain = (arr, index) => {
        calls.chain++;
        return { history: arr.slice(0, index + 1).some(message => hasMeta(readRecord(message))) };
    };
    const spineStep = (previous, record, message, first) => {
        calls.spine++;
        return hashJson({ previous, ops: record.ops, spans: record.spans, source: record.source, sid: record.sid,
            text: message.mes, swipe: message.swipe_id, first, checkpoint: first ? record.checkpoint ?? null : null });
    };
    const memo = createPrefixMemo(s, {
        chain, chatId: () => env.chatId, markNow: () => env.mark, marked: () => env.marked,
        replay, replayEnv: () => env.features, replayRecord, spineStep,
    });
    return { s, env, calls, memo };
}

test('prefix memo: spineRun hashes each record carrier once and leaves users and recordless carriers empty', () => {
    const { memo, calls } = setup();
    const arr = [user('hello'), reply('a'), { is_user: false, mes: 'not read yet', extra: {} }, reply('b')];
    const run = memo.spineRun(arr);
    assert.equal(run.length, arr.length);
    assert.equal(run[0], undefined);
    assert.equal(typeof run[1], 'string');
    assert.equal(run[2], undefined);
    assert.equal(typeof run[3], 'string');
    assert.equal(calls.spine, 2);
});

test('prefix memo: the key is the spine hash through the carrier plus Features, guard mark, marked and chat id', () => {
    const { s, memo } = setup({ guardSeen: true });
    const arr = [reply('a')];
    const run = memo.spineRun(arr);
    memo.stateAfterPrefix(arr, 0, run);
    assert.equal(s.prefixes.size, 1);
    const key = [...s.prefixes.keys()][0];
    assert.deepEqual(JSON.parse(key), [run[0], 'feat=1', 'guard-1', 'false', 'chat-a']);
});

test('prefix memo: a hit is the same deep-frozen state, and a new reply steps only its own record', () => {
    const { s, calls, memo } = setup();
    const arr = [reply('a'), reply('b')];
    const first = memo.stateAfterPrefix(arr, 0);
    assert.equal(Object.isFrozen(first) && Object.isFrozen(first.domains.test), true);
    const again = memo.stateAfterPrefix(arr, 0);
    assert.equal(again, first);
    assert.equal(calls.replay, 1);
    assert.equal(calls.step, 0);
    assert.equal(s.counts.prefixHits, 1);
    const next = memo.stateAfterPrefix(arr, 1);
    assert.deepEqual(next.domains.test, { n: 2, seen: ['a', 'b'] });
    assert.equal(calls.replay, 1);
    assert.equal(calls.step, 1);
    assert.equal(s.counts.prefixSteps, 1);
});

test('prefix memo: a spine run made once can be shared without walking the carriers again', () => {
    const { calls, memo } = setup();
    const arr = [reply('a'), reply('b')];
    const run = memo.spineRun(arr);
    assert.equal(calls.spine, 2);
    memo.stateAfterPrefix(arr, 0, run);
    memo.stateAfterPrefix(arr, 1, run);
    assert.equal(calls.spine, 2);
});

test('prefix memo: a swipe or edit of reply k keeps older prefixes and changes k and later ones', () => {
    const { calls, memo } = setup();
    const arr = [reply('a'), reply('b'), reply('c')];
    for (let i = 0; i < arr.length; i++) memo.stateAfterPrefix(arr, i);
    const old = memo.stateAfterPrefix(arr, 2);
    arr[1].swipe_id = 1;
    arr[1].mes = 'edited reply b';
    arr[1].extra.storySuite = { ...arr[1].extra.storySuite, ops: [...arr[1].extra.storySuite.ops, { op: 'remove', path: '/domains/test/x' }] };
    assert.equal(memo.stateAfterPrefix(arr, 0).domains.test.n, 1, 'reply a is still a hit');
    memo.stateAfterPrefix(arr, 1);
    const changed = memo.stateAfterPrefix(arr, 2);
    assert.notEqual(changed.domains.test.n, old.domains.test.n);
    assert.deepEqual(changed.domains.test.seen, ['a', 'b', 'c']);
    assert.equal(calls.replay, 1, 'only the first warm-up replayed');
    assert.equal(calls.step, 4, 'b and c were stepped again after the change');
});

test('prefix memo: a middle delete never serves a state from before the delete', () => {
    const { memo } = setup();
    const arr = [reply('a'), reply('b'), reply('c')];
    for (let i = 0; i < arr.length; i++) memo.stateAfterPrefix(arr, i);
    assert.equal(memo.stateAfterPrefix(arr, 2).domains.test.n, 3);
    arr.splice(1, 1);
    const after = memo.stateAfterPrefix(arr, 1);
    assert.deepEqual(after.domains.test, { n: 2, seen: ['a', 'c'] });
    assert.equal(memo.stateAfterPrefix(arr, 0).domains.test.n, 1, 'the prefix before the delete still hits');
});

test('prefix memo: Features, a seen guard mark, marked and the chat each key their own state', () => {
    const { s, env, calls, memo } = setup();
    const arr = [reply('a')];
    memo.stateAfterPrefix(arr, 0);
    env.mark = 'ignored-before-guards';
    memo.stateAfterPrefix(arr, 0);
    assert.equal(calls.replay, 1, 'the guard mark is not read until a guard was seen');
    env.features = 'feat=2';
    memo.stateAfterPrefix(arr, 0);
    env.marked = true;
    memo.stateAfterPrefix(arr, 0);
    env.chatId = 'chat-b';
    memo.stateAfterPrefix(arr, 0);
    assert.equal(calls.replay, 4);
    s.guardSeen = true;
    env.mark = 'guard-2';
    memo.stateAfterPrefix(arr, 0);
    env.mark = 'guard-3';
    memo.stateAfterPrefix(arr, 0);
    assert.equal(calls.replay, 6);
});

test('prefix memo: guarded chats take the full replay, in the record or earlier in its history', () => {
    const { s, calls, memo } = setup();
    const guarded = reply('g', 1, { spans: [{ id: 'bl_guarded', n: 1, story: false }] });
    const afterGuard = [guarded, reply('a')];
    memo.stateAfterPrefix(afterGuard, 0);
    memo.stateAfterPrefix(afterGuard, 1);
    assert.equal(calls.step, 0);
    assert.equal(calls.replay, 2);
    assert.equal(s.counts.prefixSteps, 0);
    const ownGuard = [reply('a'), guarded];
    memo.stateAfterPrefix(ownGuard, 0);
    memo.stateAfterPrefix(ownGuard, 1);
    assert.equal(calls.step, 0);
    assert.equal(calls.replay, 4);
});

test('prefix memo: a checkpoint on the new record uses the full replay', () => {
    const { s, calls, memo } = setup();
    const arr = [reply('a'), reply('b', 1, { checkpoint: state(1, ['a']) })];
    memo.stateAfterPrefix(arr, 0);
    const after = memo.stateAfterPrefix(arr, 1);
    assert.deepEqual(after.domains.test, { n: 2, seen: ['a', 'b'] });
    assert.equal(calls.step, 0);
    assert.equal(calls.replay, 2);
    assert.equal(s.counts.prefixReplays, 2);
});

test('prefix memo: every later checkpoint and its trust fields change this and later keys', () => {
    const { memo } = setup();
    const checkpoint = { checkpoint: state(1, ['a']), prefix: 'prior', covers: ['a'], coverHash: 'window', guardEnv: 'owners' };
    const arr = [reply('a'), reply('b', 1, checkpoint), reply('c')];
    const original = memo.spineRun(arr);
    for (const [field, value] of Object.entries({ checkpoint: state(9, ['changed']), prefix: 'other', covers: ['other'], coverHash: 'other', guardEnv: 'other' })) {
        arr[1].extra.storySuite = { ...arr[1].extra.storySuite, ...checkpoint, [field]: value };
        const changed = memo.spineRun(arr);
        assert.equal(changed[0], original[0], `${field}: the earlier prefix stays the same`);
        assert.notEqual(changed[1], original[1], `${field}: the checkpoint prefix changes`);
        assert.notEqual(changed[2], original[2], `${field}: later prefixes change too`);
    }
});

test('prefix memo: a changed checkpoint and its trust gate are reflected by real replay', () => {
    const arr = [reply('a'), reply('b'), reply('c')];
    // Let the store make its own checkpoint and trust fields, then change only those fields on a replacement record.
    for (const message of arr) delete message.extra.storySuite;
    let id = 0;
    const store = createStore({ chat: () => arr, save: async () => {}, checkpointEvery: 1,
        recordId: () => `sw_${String(++id).padStart(8, '0')}` });
    store.ensureInitial(state(1));
    store.setNarrated(1, []);
    store.setNarrated(2, []);
    const saved = arr[1].extra.storySuite;
    assert.ok(saved.checkpoint && saved.prefix);
    assert.equal(store.before(2).domains.test.n, 1);
    const changed = { ...saved, checkpoint: state(17) };
    arr[1].extra.storySuite = changed;
    assert.equal(store.before(2).domains.test.n, 17, 'the changed saved state is trusted');
    arr[1].extra.storySuite = { ...changed, prefix: 'wrong' };
    assert.equal(store.before(2).domains.test.n, 1, 'a failed prefix gate starts at the earlier checkpoint');
    arr[1].extra.storySuite = { ...changed, covers: ['wrong'] };
    assert.equal(store.before(2).domains.test.n, 1, 'a failed covers gate starts at the earlier checkpoint');
    arr[1].extra.storySuite = changed;
    assert.equal(store.before(2).domains.test.n, 17, 'restoring the trusted checkpoint restores its state');

    const source = store.sourceAt(2);
    const cursor = { sid: source.sid, swipeKey: source.swipeKey, op: 0 };
    const warm = store.prefixWitness(cursor);
    assert.equal(warm.state.domains.test.n, 17);
    const before = store.work();
    assert.deepEqual(store.witnessFresh(cursor), warm);
    const after = store.work();
    assert.equal(after.replays, before.replays + 1, 'a fresh witness replays its base');
    assert.equal(after.prefixHits, before.prefixHits, 'a fresh witness does not consult the prefix cache');
});

test('prefix memo: a head replay does not hide reconciliation discovered in an earlier prefix', () => {
    const arr = [reply('a', 0, { checkpoint: state(0) }), reply('b'), reply('c')];
    arr[1].extra.storySuite = { ...arr[1].extra.storySuite,
        ops: [{ op: 'replace', path: '/meta/rev', value: 0 }], spans: [{ n: 1, story: false }] };
    delete arr[2].extra.storySuite;
    let id = 0;
    const store = createStore({ chat: () => arr, save: async () => {}, checkpointEvery: 1,
        recordId: () => `sw_${String(++id).padStart(8, '0')}` });
    store.before(2);
    assert.equal(store.replansFrom(), 1, 'the earlier replay finds a repeated revision');
    store.setNarrated(2, []);
    assert.ok(arr[2].extra.storySuite.checkpoint);
    arr[2].extra.storySuite = { ...arr[2].extra.storySuite };
    store.head();
    assert.equal(store.replansFrom(), null, 'the head now replays from the later checkpoint');
    store.before(2);
    assert.equal(store.replansFrom(), 1, 'the earlier prefix is replayed after the head reset');
});

test('prefix memo: the cap evicts the oldest, and an evicted state is replayed again', () => {
    const { s, calls, memo } = setup();
    const arr = Array.from({ length: PREFIX_MEMO_MAX + 1 }, (_, at) => reply(`r${at}`));
    for (let i = 0; i < arr.length; i++) memo.stateAfterPrefix(arr, i);
    assert.equal(s.prefixes.size, PREFIX_MEMO_MAX);
    assert.equal(calls.replay, 1);
    memo.stateAfterPrefix(arr, 0);
    assert.equal(calls.replay, 2, 'the first entry was the one evicted');
});

test('prefix memo: a staged Re-read or an applying write bypasses the cache', () => {
    const { s, calls, memo } = setup();
    const arr = [reply('a')];
    const first = memo.stateAfterPrefix(arr, 0);
    s.applying = { list: [], index: 0 };
    assert.deepEqual(memo.stateAfterPrefix(arr, 0), first);
    assert.equal(calls.replay, 2);
    assert.equal(s.prefixes.size, 1, 'the bypass does not store anything');
    s.applying = null;
    s.staged = new Map();
    memo.stateAfterPrefix(arr, 0);
    assert.equal(calls.replay, 3);
});

test('prefix memo: a recordless carrier has the state of the record before it', () => {
    const { memo } = setup();
    const arr = [reply('a'), { is_user: false, mes: 'not read yet', extra: {} }];
    assert.deepEqual(memo.stateAfterPrefix(arr, 1).domains.test, { n: 1, seen: ['a'] });
});

test('witness memo: a hit by the witness\'s own prefix lowers replanFrom again, as the replay it skips would', () => {
    const arr = [reply('a', 0, { checkpoint: state(0) }), reply('b'), reply('c')];
    arr[1].extra.storySuite = { ...arr[1].extra.storySuite,
        ops: [{ op: 'replace', path: '/meta/rev', value: 0 }], spans: [{ n: 1, story: false }] };
    delete arr[2].extra.storySuite;
    let id = 0;
    const store = createStore({ chat: () => arr, save: async () => {}, checkpointEvery: 1,
        recordId: () => `sw_${String(++id).padStart(8, '0')}` });
    store.setNarrated(2, []);
    store.head();
    const source = store.sourceAt(1);
    const cursor = { sid: source.sid, swipeKey: source.swipeKey, op: 1 };
    const first = store.prefixWitness(cursor);
    assert.ok(first, 'the witness is there');
    assert.equal(store.replansFrom(), 1, 'the replay found the repeated revision');
    arr[2].extra.storySuite = { ...arr[2].extra.storySuite };   // (a new record object after it: the generation is dropped, the prefix is the same)
    store.head();
    assert.equal(store.replansFrom(), null, 'the head replay reset it');
    const misses = store.work().witnessMisses;
    assert.deepEqual(store.prefixWitness(cursor), first);
    assert.equal(store.work().witnessMisses, misses, 'the answer came from its own prefix');
    assert.equal(store.replansFrom(), 1, 'and the hit lowered replanFrom as the replay would have');
});

test('prefix memo: a checkpoint\'s proof owners are part of the spine run (an owned-only change gives another key)', () => {
    const { memo } = setup();
    const make = owned => [reply('a'), reply('b', 1, { checkpoint: state(1), ...(owned ? { owned } : {}) }), reply('c')];
    const base = memo.spineRun(make(null));
    const one = memo.spineRun(make({ ev_x: 'a' }));
    const two = memo.spineRun(make({ ev_x: 'b' }));
    assert.equal(base[0], one[0], 'before the checkpoint nothing moved');
    for (const at of [1, 2]) { assert.notEqual(base[at], one[at]); assert.notEqual(one[at], two[at]); }
    assert.equal(JSON.stringify(memo.spineRun(make({ ev_x: 'a' }))), JSON.stringify(one), 'the same owners give the same run');
});

test('prefix memo: a state stepped or hit on a shared base lowers replanFrom as the replay that made it did', () => {
    const { s, memo } = setup({ found: 1 });
    s.replanFrom = Infinity;
    const arr = [reply('a'), reply('b'), reply('c'), reply('d'), reply('e')];
    arr[1].extra.storySuite.checkpoint = state(1);      // (the replay of carrier 1 starts here and finds the point)
    const run = memo.spineRun(arr);
    memo.stateAfterPrefix(arr, 1, run);
    assert.equal(s.replanFrom, 1, 'the replay found it');
    s.replanFrom = Infinity;                           // (a head replay resets it)
    memo.stateAfterPrefix(arr, 1, run);
    assert.equal(s.replanFrom, 1, 'a hit lowers it again');
    s.replanFrom = Infinity;
    memo.stateAfterPrefix(arr, 3, run);                // (carriers 2 and 3 are stepped from the cached carrier 1: no replay of their own)
    assert.equal(s.replanFrom, 1, 'a step from a shared base inherits it');
    s.replanFrom = Infinity;
    memo.stateAfterPrefix(arr, 4, run);
    assert.equal(s.replanFrom, 1, 'and so does the next step');
    s.replanFrom = 0;
    memo.stateAfterPrefix(arr, 3, run);
    assert.equal(s.replanFrom, 0, 'a lower point already there stays');
});

test('witness memo: replacing the guard checker clears the answers kept by prefix', () => {
    const arr = [reply('a', 0, { checkpoint: state(0) }), reply('b'), reply('c')];
    let id = 0;
    const store = createStore({ chat: () => arr, save: async () => {}, checkpointEvery: 1, recordId: () => `sw_${String(++id).padStart(8, '0')}` });
    store.head();
    const source = store.sourceAt(1);
    const cursor = { sid: source.sid, swipeKey: source.swipeKey, op: 0 };
    assert.ok(store.prefixWitness(cursor));
    const misses = () => store.work().witnessMisses;
    const before = misses();
    store.rebuild();
    store.prefixWitness(cursor);
    assert.equal(misses(), before, 'a rebuild alone keeps it (found by its prefix)');
    store.attachGuard(() => ({ ok: true }), () => 'same');
    store.prefixWitness(cursor);
    assert.equal(misses(), before + 1, 'a new checker under the same mark works it out again');
});

test('witness memo: the answers kept by prefix stop at the cap, the oldest first', () => {
    const arr = [reply('a', 0, { checkpoint: state(0) }), reply('b'), reply('c'), reply('d'), reply('e'), reply('f')];
    let id = 0;
    const store = createStore({ chat: () => arr, save: async () => {}, checkpointEvery: 1, witnessPrefixMax: 2, recordId: () => `sw_${String(++id).padStart(8, '0')}` });
    store.head();
    const cursors = [1, 2, 3, 4, 5].map(i => { const source = store.sourceAt(i); return { sid: source.sid, swipeKey: source.swipeKey, op: 0 }; });
    const walk = () => { const before = store.work().witnessMisses; for (const cursor of cursors) store.prefixWitness(cursor); return store.work().witnessMisses - before; };
    assert.equal(walk(), 5);
    store.rebuild();                                    // (the generation goes; only the answers kept by prefix are left)
    const asked = list => { const before = store.work().witnessMisses; for (const cursor of list) store.prefixWitness(cursor); return store.work().witnessMisses - before; };
    assert.equal(asked(cursors.slice(3)), 0, 'the two newest are found');
    assert.equal(asked(cursors.slice(0, 1)), 1, 'the oldest was evicted');
});
