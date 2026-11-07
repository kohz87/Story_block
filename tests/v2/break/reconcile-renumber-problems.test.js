// Break finding S137: a reconcile that takes a guarded block back renumbers the Problems its
// record keeps, but walkSuffix compared the old broken block by its old number. When the same
// record also had a guarded block whose guard failed, the two numbers collided and the legacy
// Problem disappeared from the head and from every checkpoint written after it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Q1, guarded, harness } from '../helpers/guarded.js';

const EVERY = { checkpointEvery: 3, checkpointBytes: 1 << 30 };
const NONE = { checkpointEvery: 100000, checkpointBytes: 1 << 30 };
const clone = value => JSON.parse(JSON.stringify(value));
const list = store => store.problems().map(problem => [problem.index, problem.block, problem.code ?? null]);

// The chat as a store with no checkpoints reads it: the same records, from the first.
function uncheckpointed(chat) {
    const h = harness([guarded()], NONE);
    const copy = clone(chat);
    copy.forEach((message, at) => {
        const record = message.extra?.storySuite;
        if (!record) return;
        if (at > 0) delete record.checkpoint;      // (the first record is the story's base: it keeps its state)
        delete record.covers;
        delete record.coverHash;
        delete record.prefix;
        delete record.carried;
    });
    h.chat.splice(0, h.chat.length, ...copy);
    h.store.rebuild();
    return h;
}

function reloaded(chat) {
    const h = harness([guarded()], EVERY);
    h.chat.splice(0, h.chat.length, ...clone(chat));
    h.store.rebuild();
    return h;
}

test('reconcile renumbers a kept broken block before the guard of a later block fails', () => {
    const h = harness([guarded()], EVERY);
    // The recover below is planned while ann has lost 5; making that hit 0 later leaves the
    // guarded block stored but off on replay, which is the REPLAY_PREREQUISITE Problem.
    h.send('One.', 'Ann is hit.');
    h.command('gt.hit', { actor: 'ann', amount: 5 });
    const first = h.chat.length - 1;

    const carrier = h.send('Two.', 'The attempt, a missing path and a recovery.');
    h.command('gt.attempt', { id: Q1 }, 'system');
    // A legacy block between the replanned step and the guarded recover: its path does not exist,
    // so it is skipped with a Problem that has no code.
    const record = clone(h.record(carrier));
    const afterAttempt = record.spans[0].n;
    record.ops.splice(afterAttempt, 0, { op: 'replace', path: '/domains/gt/quests/th_questfiv/instance', value: 1 });
    record.spans.splice(1, 0, { n: 1, story: false });
    h.chat[carrier].extra.storySuite = record;
    h.command('gt.recover', { actor: 'ann' });

    // A checkpoint carrier after it, so the Problems have to ride along from there.
    const later = h.send('Three.', 'The clock.');
    h.command('gt.tick', { minutes: 0 });
    assert.ok(h.record(later).checkpoint, 'a checkpoint after the carrier');

    // The recover's guard no longer holds. The head knows both Problems, with the legacy one at block 1.
    const firstRecord = clone(h.record(first));
    const hit = firstRecord.ops.find(op => op.path === '/domains/gt/lost/ann');
    hit.value = 0;
    h.chat[first].extra.storySuite = firstRecord;
    h.store.rebuild();

    h.store.reconcile(carrier, { rerun: () => ({ ok: false, code: 'NO_LONGER_DONE', message: 'gone' }) });

    const expected = [[carrier, 0, null], [carrier, 1, 'REPLAY_PREREQUISITE']];
    assert.deepEqual(list(h.store), expected);
    assert.deepEqual(list(uncheckpointed(h.chat).store), expected, 'the same list as a replay with no checkpoints');

    const carried = h.record(later).carried ?? [];
    assert.deepEqual(carried.map(entry => [entry.sid, entry.block, entry.code ?? null]), [
        [h.record(carrier).sid, 0, null],
        [h.record(carrier).sid, 1, 'REPLAY_PREREQUISITE'],
    ], 'the later checkpoint carries the null-coded Problem at block 0');

    assert.deepEqual(list(reloaded(h.chat).store), expected, 'and the same after a reload');
});
