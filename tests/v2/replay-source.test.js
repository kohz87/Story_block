// The carrier source map and what survives trimming (docs/v2/REPLAY.md, contract §4 and §10 E, row 2):
// guards, results and seeds stay on the blocks past 200 carriers; the canonical pair (sr_/sw_) of a message
// and swipe is stable over index shifts, edits and reloads; the shipped sw_<12 hex> ids are not rewritten.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { RECORD_ID } from '../../src/v2/check.js';
import { newRecordId, readRecord, trimReceipts } from '../../src/v2/persist.js';
import { deriveId, isMetaSpan } from '../../src/v2/replay.js';
import { EPOCH, Q1, guarded, harness } from './helpers/guarded.js';
import { deleteSwipe, newSwipe, reply, showSwipe, user } from './helpers/store-chat.js';

const questId = n => `th_${n.toString(36).padStart(8, '0')}`;

test('trimReceipts drops display data but keeps data.v2, and says nothing changed when only that is left', () => {
    const v2 = { schema: 2, epoch: EPOCH, guard: { owner: 'zz-guarded' }, result: { paid: 7 } };
    const message = reply();
    message.extra.storySuite = {
        v: 2, sid: 'sw_a', ops: [], narrated: [], spans: [],
        receipts: [
            { id: 'rc_00000001', seed: 5, data: { v2, shown: 'x' } },
            { id: 'rc_00000002', seed: 6, data: { shown: 'y' } },
            { id: 'rc_00000003', seed: 7, data: { v2 } },
            { id: 'rc_00000004', seed: 8 },
        ],
    };
    assert.equal(trimReceipts(message), true);
    const receipts = readRecord(message).receipts;
    assert.deepEqual(receipts, [
        { id: 'rc_00000001', seed: 5, data: { v2 } },
        { id: 'rc_00000002', seed: 6 },
        { id: 'rc_00000003', seed: 7, data: { v2 } },
        { id: 'rc_00000004', seed: 8 },
    ]);
    assert.equal(trimReceipts(message), false, 'trimmed once is trimmed');
    const lone = reply();
    lone.extra.storySuite = { v: 2, sid: 'sw_b', ops: [], narrated: [], spans: [], receipts: [{ id: 'rc_00000009', data: { v2 } }] };
    assert.equal(trimReceipts(lone), false, 'nothing but data.v2: nothing to drop');
});

test('past 200 carriers the receipts lose their display data, but results, guards and seeds stay and a reload replays the same', async t => {
    const host = await createHost({ modules: [guarded()], core: false });
    t.after(() => host.close());
    for (let n = 1; n <= 206; n++) {
        await host.send(`Turn ${n}.`, `Reply ${n}.`);
        const result = await host.bus.command('gt.quick', { id: questId(n) }, { cause: 'ui' });
        assert.equal(result.ok, true, result.message);
        await host.bus.command('gt.hit', { actor: 'ann', amount: 1 }, { cause: 'ui' });
    }
    host.store.rebuild();
    const first = host.ctx.chat.findIndex(message => message.extra?.storySuite?.receipts?.some(receipt => receipt.type === 'gt.quick'));
    const old = readRecord(host.ctx.chat[first]);
    const quick = old.receipts.find(receipt => receipt.type === 'gt.quick');
    const hit = old.receipts.find(receipt => receipt.type === 'gt.hit');
    assert.deepEqual(Object.keys(quick.data), ['v2'], 'the guard, source and result are kept');
    assert.equal(quick.data.v2.guard.owner, 'zz-guarded');
    assert.deepEqual(quick.data.v2.result, { id: questId(1) });
    assert.equal(Number.isInteger(quick.seed), true, 'the seed stays');
    assert.equal(Object.hasOwn(hit, 'data'), false, 'display data of a receipt without data.v2 goes, as before');
    // The block itself holds the guard and the result, whatever happened to the receipt.
    const span = old.spans.find(isMetaSpan);
    assert.equal(span.guard.owner, 'zz-guarded');
    assert.deepEqual(span.result, { id: questId(1) });
    assert.deepEqual(span.operation, { type: 'gt.quick', payload: { id: questId(1) } });
    // The newest reply still has its display data.
    const newest = readRecord(host.ctx.chat.at(-1));
    assert.ok(newest.receipts.every(receipt => Object.hasOwn(receipt, 'data')));
    // A reload of the saved chat: every payout is still there, nothing is skipped.
    const live = JSON.stringify(host.head());
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(JSON.stringify(host.head()), live);
    assert.equal(host.head().domains.gt.coin, 206);
    assert.deepEqual(host.store.problems(), []);
});

test('a stored sw_<12 hex> id keeps its bytes and maps stably to a canonical sr_/sw_/ev_ pair; no regex is widened', () => {
    assert.match(newRecordId(), /^sw_[0-9a-f]{12}$/, 'new records keep the shipped storage format');
    assert.equal(RECORD_ID.source, '^[a-z][a-z0-9]*_[0-9a-z]{8}$');
    assert.equal(RECORD_ID.test('sw_0123456789ab'), false, 'a stored id is a storage key, not a record id');
    const h = harness();
    const at = h.send();
    h.command('gt.hit', { actor: 'ann', amount: 1 });
    const record = h.record(at);
    assert.equal(record.sid, 'sw_000000000002', 'the stored id is untouched');
    const pair = { sid: record.source.logical, swipeKey: record.source.swipeKey, evidence: record.source.evidence };
    assert.match(pair.sid, /^sr_[0-9a-z]{8}$/);
    assert.match(pair.swipeKey, /^sw_[0-9a-z]{8}$/);
    assert.match(pair.evidence, /^ev_[0-9a-z]{8}$/);
    for (const id of Object.values(pair)) assert.ok(RECORD_ID.test(id), id);
    assert.notEqual(pair.swipeKey, record.sid.slice(0, 11), 'not a truncation of the stored id');
    // The same stored id gives the same pair anywhere (a second chat, a rebuild, a copy of the chat).
    const other = harness();
    const there = other.send();
    other.command('gt.hit', { actor: 'ann', amount: 1 });
    assert.deepEqual(other.record(there).source, record.source);
    h.store.rebuild();
    assert.deepEqual(h.store.sourceAt(at), { ...pair, ordinal: 0 });
    const copy = harness();
    copy.chat.splice(0, copy.chat.length, ...JSON.parse(JSON.stringify(h.chat)));
    copy.store.rebuild();
    assert.deepEqual(copy.store.sourceAt(at), { ...pair, ordinal: 0 });
    assert.equal(copy.record(at).sid, record.sid);
    // A record stored before the map existed has no entry: it is worked out the same, and saved with its next write.
    const entry = structuredClone(record.source);
    delete h.record(at).source;
    assert.deepEqual(h.store.sourceAt(at), { ...pair, ordinal: 0 });
    h.command('gt.hit', { actor: 'ann', amount: 1 });
    assert.deepEqual(h.record(at).source, entry);
    assert.equal(h.record(at).sid, 'sw_000000000002');
});

test('a derived id steps past one another record already holds, and never past what is free', () => {
    const free = deriveId('sw', 'sw_000000000001');
    assert.equal(deriveId('sw', 'sw_000000000001'), free);
    const next = deriveId('sw', 'sw_000000000001', new Set([free]));
    assert.notEqual(next, free);
    assert.match(next, /^sw_[0-9a-z]{8}$/);
    assert.equal(deriveId('sw', 'sw_000000000001', new Set([next])), free);
});

test('swipes of one message share the canonical sid and each has a swipe key of its own', () => {
    const h = harness();
    const at = h.send();
    h.command('gt.hit', { actor: 'ann', amount: 1 });
    const message = h.chat[at];
    const first = { ...h.record(at).source };
    // SillyTavern's new swipe copies the record; the copy is not the new swipe's own.
    newSwipe(message, 'Another try.');
    const copied = h.store.sourceAt(at);
    assert.equal(copied.sid, first.logical, 'the same logical message');
    assert.notEqual(copied.swipeKey, first.swipeKey, 'a new swipe, a new key');
    assert.notEqual(copied.evidence, first.evidence);
    h.command('gt.hit', { actor: 'ann', amount: 2 });
    const second = h.record(at).source;
    assert.equal(second.logical, first.logical);
    assert.deepEqual({ swipeKey: second.swipeKey, evidence: second.evidence }, { swipeKey: copied.swipeKey, evidence: copied.evidence }, 'what was said before the write is what was written');
    newSwipe(message, 'And another.');
    h.command('gt.hit', { actor: 'ann', amount: 3 });
    const third = h.record(at).source;
    assert.equal(third.logical, first.logical);
    assert.equal(new Set([first.swipeKey, second.swipeKey, third.swipeKey]).size, 3);
    // Showing the first swipe again gives its own pair back.
    showSwipe(message, 0);
    h.store.rebuild();
    assert.deepEqual(h.store.sourceAt(at), { sid: first.logical, swipeKey: first.swipeKey, evidence: first.evidence, ordinal: 0 });
});

test('a deleted earlier swipe shifts the index but not the identity', () => {
    const h = harness();
    const at = h.send();
    h.command('gt.hit', { actor: 'ann', amount: 1 });
    const message = h.chat[at];
    newSwipe(message, 'Second.');
    h.command('gt.hit', { actor: 'ann', amount: 2 });
    newSwipe(message, 'Third.');
    h.command('gt.hit', { actor: 'ann', amount: 3 });
    const before = h.store.sourceAt(at);
    const stored = h.record(at);
    assert.equal(stored.swipe, 2);
    // The reader deletes swipe 0: the third swipe becomes swipe 1 and stays shown.
    message.swipes.splice(0, 1);
    message.swipe_info.splice(0, 1);
    message.swipe_id = 1;
    h.store.rebuild();
    const after = h.store.sourceAt(at);
    assert.equal(h.record(at).swipe, 1, 'the index moved');
    assert.deepEqual(after, before, 'the identity did not');
    assert.equal(h.record(at).sid, stored.sid, 'nor did the stored key');
    // And the swipe that became first keeps its own pair too.
    showSwipe(message, 0);
    h.store.rebuild();
    assert.equal(h.store.sourceAt(at).sid, before.sid);
    assert.notEqual(h.store.sourceAt(at).swipeKey, before.swipeKey);
    deleteSwipe(message, 0);
    h.store.rebuild();
    assert.deepEqual(h.store.sourceAt(at), before);
});

test('an edited reply keeps its pair but not its payload hash; a checkpoint over it is no longer trusted', () => {
    const h = harness([guarded()], { checkpointEvery: 3, checkpointBytes: 1 << 30 });
    const indexes = [];
    for (let n = 1; n <= 9; n++) {
        indexes.push(h.send(`Turn ${n}.`, `Reply ${n}.`));
        assert.equal(h.command('gt.quick', { id: questId(n) }).ok, true);
    }
    // The newest checkpoint is the one a replay starts from. It covers the replies since the one before it,
    // some with guarded blocks, so it carries a hash of what it covers.
    const newest = [...indexes].reverse().find(at => h.record(at).checkpoint && h.record(at).covers);
    const checkpoint = h.record(newest);
    assert.ok(checkpoint.coverHash, 'a checkpoint over guarded blocks carries a hash of what it covers');
    const edited = indexes.find(at => checkpoint.covers.includes(h.record(at).sid) && h.record(at).spans.some(isMetaSpan));
    assert.ok(edited !== undefined && edited < newest);
    const span = h.spans(edited).find(isMetaSpan);
    const pair = h.store.sourceAt(edited);
    assert.equal(span.boundaries[0].payloadHash, h.store.payloadHashAt(edited));
    // Give that checkpoint a state that is not the true one: while what it covers is as it was, it is trusted.
    checkpoint.checkpoint.domains.gt.coin += 500;
    h.store.rebuild();
    assert.equal(h.gt().coin >= 500, true);
    // The covered reply is edited (same record id, same swipe): its pair stays, the hash of its text does not.
    h.chat[edited].mes = 'Reply, but different.';
    h.chat[edited].swipes[0] = h.chat[edited].mes;
    assert.deepEqual(h.store.sourceAt(edited), pair);
    assert.notEqual(h.store.payloadHashAt(edited), span.boundaries[0].payloadHash);
    h.store.rebuild();
    assert.equal(h.gt().coin, 9, 'the checkpoint over it is passed over; replay starts from one that holds');
    assert.deepEqual(h.problems(), []);
    // The block itself still stands: an edit makes its evidence stale, it does not by itself take a block back.
    assert.equal(h.gt().quests[questId(2)].state, 'done');
    // Without guarded blocks in a window nothing is added to `covers`: the shipped checkpoints are as they were.
    const plain = harness([guarded()], { checkpointEvery: 3, checkpointBytes: 1 << 30 });
    for (let n = 1; n <= 9; n++) {
        plain.send();
        plain.command('gt.hit', { actor: 'ann', amount: 1 });
    }
    const made = plain.chat.map(message => message.extra?.storySuite).filter(record => record?.checkpoint && record.covers);
    assert.ok(made.length >= 2);
    assert.ok(made.every(record => !Object.hasOwn(record, 'coverHash')));
});

test('the payload hash is of the reply up to its Changes block: the block and its hidden comment do not move it, markup in the prose does', async t => {
    const host = await createHost({ modules: [guarded()], core: false });
    t.after(() => host.close());
    await host.send('Go.', '<div class="hp">HP 10</div>\nThe road.\n\n<Changes>\n! tick 5\n</Changes>');
    const at = host.ctx.chat.length - 1;
    const hash = host.store.payloadHashAt(at);
    assert.match(host.ctx.chat[at].mes, /STORY_SUITE_V2/, 'the block is hidden now');
    host.ctx.chat[at].mes = '<div class="hp">HP 10</div>\nThe road.\n\n<!-- STORY_SUITE_V2\n<Changes>\n! tick 6\n</Changes>\n-->';
    assert.equal(host.store.payloadHashAt(at), hash, 'only what comes before the block is the evidence text');
    host.ctx.chat[at].mes = '<div class="hp">HP 9</div>\nThe road.\n\n<!-- STORY_SUITE_V2\n<Changes>\n! tick 6\n</Changes>\n-->';
    assert.notEqual(host.store.payloadHashAt(at), hash, 'a status panel at the start is part of the text');
    host.ctx.chat[at].mes = '<div class="hp">HP 10</div>\nThe road goes on.';
    assert.notEqual(host.store.payloadHashAt(at), hash);
    assert.equal(host.store.sourceAt(at).sid, host.store.sourceAt(at).sid);
});

test('the guard hook is given the hash saved with the block and the one of the reply now', async t => {
    const asked = [];
    const host = await createHost({ modules: [guarded({ asked })], core: false });
    t.after(() => host.close());
    await host.send('Go.', 'The road.');
    await host.bus.command('gt.quick', { id: Q1 }, { cause: 'ui' });
    const at = host.ctx.chat.length - 1;
    const saved = host.store.payloadHashAt(at);
    asked.length = 0;
    host.store.rebuild();
    host.head();
    assert.deepEqual(asked.at(-1).payload, { saved, current: saved });
    host.ctx.chat[at].mes = 'The road, but edited.';
    host.store.rebuild();
    host.head();
    assert.deepEqual(asked.at(-1).payload, { saved, current: host.store.payloadHashAt(at) });
    assert.notEqual(saved, host.store.payloadHashAt(at));
});

test('user messages and unknown indexes have no Source', () => {
    const h = harness();
    h.send();
    assert.equal(h.store.sourceAt(h.chat.length - 2), null);
    assert.equal(h.store.sourceAt(99), null);
    assert.equal(h.store.sourceAt(-1), null);
    void user;
});
