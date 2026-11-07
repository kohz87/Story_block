// The prefix memo, on a fake store state: its spine run, exact key, one-record fast path, bounded LRU, deep
// freezing, and every reason it must replay instead (guards, checkpoints, a staged Re-read or an applying write).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readRecord } from '../../src/v2/persist.js';
import { hashJson } from '../../src/v2/replay.js';
import { hasMeta } from '../../src/v2/store/digest.js';
import { createPrefixMemo, PREFIX_MEMO_MAX } from '../../src/v2/store/prefix-memo.js';

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

function setup({ guardSeen = false } = {}) {
    const s = {
        prefixes: new Map(), guardSeen, applying: null, staged: null,
        counts: { replays: 0, recordsRead: 0, lineScans: 0, witnessMisses: 0, prefixHits: 0, prefixSteps: 0, prefixReplays: 0 },
    };
    const env = { features: 'feat=1', mark: 'guard-1', marked: false, chatId: 'chat-a' };
    const calls = { replay: 0, step: 0, chain: 0, spine: 0 };
    const replay = (arr, index) => {
        calls.replay++;
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
