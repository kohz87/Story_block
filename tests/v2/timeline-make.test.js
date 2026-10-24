// The timeline: head, make, list, forget, and the public savepoint.make adapter (docs/v2/TIMELINE.md, contract §8).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { crash } from '../../src/v2/timeline/index.js';
import { isMetaSpan } from '../../src/v2/replay.js';
import { RECORD_ID } from '../../src/v2/check.js';
import { NATIVE, nativeModule, rulesModule } from './helpers/timeline.js';

const reply = (text, lines = []) => (lines.length ? `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);

async function started(t, options = {}) {
    const native = nativeModule();
    const host = await createHost({ modules: [rulesModule(), native.def], ...options });
    t.after(() => host.close());
    await host.send('Hello.', reply('The road.', ['+ coin 30']));
    return { host, native };
}
const headCarrier = host => host.ctx.chat.at(-1);
const spans = host => headCarrier(host).extra.storySuite.spans;

test('head: the committed head is a hash, a cursor, the epoch and the prefix hash; it changes when the story does', async t => {
    const { host } = await started(t);
    const first = await host.sdk.timeline.head();
    assert.equal(first.ok, true);
    assert.match(first.headHash, /^[0-9a-f]{64}$/);
    assert.match(first.prefixHash, /^[0-9a-f]{64}$/);
    assert.equal(first.epoch, 'ep_00000000');
    assert.match(first.cursor.sid, /^sr_[0-9a-z]{8}$/);
    assert.match(first.cursor.swipeKey, /^sw_[0-9a-z]{8}$/);
    assert.match(first.cursor.block, RECORD_ID);
    assert.deepEqual(Object.keys(first).sort(), ['cursor', 'epoch', 'headHash', 'ok', 'prefixHash']);
    assert.equal((await host.sdk.timeline.head()).headHash, first.headHash, 'reading it changes nothing');
    await host.sdk.command('tl.xp', { amount: 1 });
    const second = await host.sdk.timeline.head();
    assert.notEqual(second.headHash, first.headHash);
    assert.equal(second.cursor.rev, first.cursor.rev + 1);
    assert.equal(second.cursor.op, first.cursor.op + 2, 'the cursor counts the ops before it on the reply');
});

test('head is the boundary the next block starts at: the make block\'s span carries exactly it', async t => {
    const { host } = await started(t);
    const before = await host.sdk.timeline.head();
    const made = await host.sdk.timeline.make({ kind: 'manual', name: 'Here' });
    assert.equal(made.ok, true, made.message);
    const span = spans(host).findLast(isMetaSpan);
    const { cursor, prefixHash } = span.boundaries[0];
    assert.deepEqual({ ...cursor, block: null }, { ...before.cursor, block: null });
    assert.equal(prefixHash, before.prefixHash);
    assert.deepEqual(made.snapshot.target, cursor, 'the snapshot\'s target is where its block starts');
    assert.equal(made.snapshot.lineage, prefixHash);
    assert.equal(made.snapshot.eligibleFrom.block, span.id);
});

test('make: a manual save point is a descriptor in the story and its bytes are in the archive', async t => {
    const { host, native } = await started(t);
    await host.sdk.command('tl.time', { minutes: 1500 });
    const made = await host.sdk.timeline.make({ kind: 'manual', name: 'Before the cave' });
    assert.equal(made.ok, true, made.message);
    const point = made.snapshot;
    assert.match(point.id, RECORD_ID);
    assert.equal(point.kind, 'manual');
    assert.equal(point.name, 'Before the cave');
    assert.equal(point.label, 'Before the cave');
    assert.equal(point.epoch, 'ep_00000000');
    assert.equal(point.minute, 1500);
    assert.equal(point.day, 1);
    assert.equal(point.available, true);
    assert.deepEqual(point.participants, [{ module: NATIVE, checkpoint: point.participants[0].checkpoint, hash: point.participants[0].hash, schema: 1 }]);
    assert.equal(native.native.calls.filter(call => call.name === 'checkpoint').length, 1);
    assert.equal(native.native.calls[0].input.headHash.length, 64);
    // In the story: a savepoints domain nobody registered (the host's own), made by this first save.
    assert.deepEqual(Object.keys(host.head().domains.savepoints).sort(), ['dayStarts', 'epoch', 'points', 'previousDay', 'returns', 'ruleSettings', 'schema']);
    assert.deepEqual(host.head().domains.savepoints.points[point.id], point);
    assert.equal(host.registry.domainOwner('savepoints'), null, 'no module owns it, so no module can draft it');
    // In the archive: the payload, by its hash, with every domain of the story as it was.
    const payload = host.ctx.chatMetadata.storySuite.timeline.payloads[point.payloadHash].payload;
    assert.equal(payload.schema, 2);
    assert.equal(payload.domains.director.time.minutes, 1500);
    assert.equal(payload.domains.savepoints, undefined, 'capture precedes the descriptor: the first save holds no savepoints');
    assert.deepEqual(payload.participants, point.participants);
    assert.equal(host.ctx.chatMetadata.storySuite.timeline.snapshots[point.id].descriptor.id, point.id);
    assert.deepEqual(host.store.problems(), []);
});

test('make: the public command is an async adapter that answers the receipt envelope of §3', async t => {
    const { host } = await started(t);
    const seen = [];
    host.sdk.on('committed', ({ receipt }) => seen.push(receipt));
    const result = await host.sdk.command('savepoint.make', { name: 'Camp' });
    assert.equal(result.ok, true, result.message);
    const { receipt } = result;
    assert.deepEqual(Object.keys(receipt).sort(), ['cause', 'data', 'guarded', 'id', 'module', 'narrate', 'rev', 'seed', 'summary', 'type']);
    assert.equal(receipt.type, 'savepoint.make');
    assert.equal(receipt.module, 'story-block');
    assert.equal(receipt.cause, 'ui');
    assert.equal(receipt.narrate, false);
    assert.equal(receipt.data.v2.schema, 2);
    const id = Object.keys(host.head().domains.savepoints.points)[0];
    assert.deepEqual(receipt.data.v2.result, { snapshot: id });
    assert.equal(receipt.data.v2.guard.owner, 'story-block');
    assert.equal(receipt.data.v2.epoch, 'ep_00000000');
    assert.deepEqual(seen.map(each => each.id), [receipt.id], 'the committed event is told once');
    assert.equal(headCarrier(host).extra.storySuite.receipts.at(-1).id, receipt.id);
    // No name: the default.
    const plain = await host.sdk.command('savepoint.make', {});
    assert.equal(host.head().domains.savepoints.points[plain.receipt.data.v2.result.snapshot].name, 'Save point');
    // Anything but { name? } is INVALID, a long or odd name too.
    assert.equal((await host.sdk.command('savepoint.make', { name: 'x', kind: 'initial' })).code, 'INVALID');
    assert.equal((await host.sdk.command('savepoint.make', { name: 'x'.repeat(81) })).code, 'INVALID');
    assert.equal((await host.sdk.command('savepoint.make', { name: ' padded ' })).code, 'INVALID');
    assert.equal((await host.sdk.command('savepoint.make', { name: 'line\nbreak' })).code, 'INVALID');
});

test('make: straight at the command bus it is REFUSED, whoever asks; it cannot be previewed either', async t => {
    const { host } = await started(t);
    for (const cause of ['ui', 'story', 'system']) {
        const result = host.bus.command('savepoint.make', { name: 'Sneaky' }, { cause });
        assert.equal(result.ok, false);
        assert.equal(result.code, 'REFUSED', cause);
    }
    assert.equal((await host.sdk.preview('savepoint.make', { name: 'Sneaky' })).code, 'REFUSED');
    assert.equal(host.head().domains.savepoints, undefined, 'nothing was made');
    // A module's own command cannot call it either: the handler refuses, and the command fails with it.
    const rival = { id: 'rival', name: 'Rival', version: '1.0.0', domains: { rv: { initial: () => ({}) } }, commands: { 'rival.save'(ctx) { return ctx.call('savepoint.make', {}); } } };
    await host.sdk.registerModule(rival);
    assert.equal((await host.sdk.command('rival.save', {})).code, 'REFUSED');
});

test('make: only the host makes an initial or a day-start save point; a reader\'s is a manual one', async t => {
    const { host } = await started(t);
    for (const input of [{ kind: 'initial' }, { kind: 'day-start', day: 3 }]) {
        const refused = await host.sdk.timeline.make(input);
        assert.equal(refused.code, 'REFUSED', input.kind);
    }
    const initial = await host.timeline.host.make({ kind: 'initial' });
    assert.equal(initial.ok, true, initial.message);
    assert.equal(initial.snapshot.name, 'Start');
    assert.equal((await host.timeline.host.make({ kind: 'initial' })).code, 'CONFLICT', 'one initial save point');
    const day = await host.timeline.host.make({ kind: 'day-start', day: 3 });
    assert.equal(day.ok, true, day.message);
    assert.equal(day.snapshot.day, 3);
    assert.equal(day.snapshot.minute, 3 * 1440);
    assert.equal(day.snapshot.name, 'Day 3');
    const next = await host.timeline.host.make({ kind: 'day-start', day: 4 });
    const domain = host.head().domains.savepoints;
    assert.deepEqual(domain.dayStarts, { 3: day.snapshot.id, 4: next.snapshot.id });
    assert.equal(domain.previousDay, day.snapshot.id, 'the start of the day before the newest one');
    assert.equal((await host.timeline.host.make({ kind: 'day-start', day: 4 })).code, 'CONFLICT');
    assert.equal((await host.timeline.host.make({ kind: 'day-start' })).code, 'INVALID', 'a day start names its day');
    assert.equal((await host.timeline.host.make({ kind: 'manual', day: 2 })).code, 'INVALID', 'only a day start has a day');
    assert.equal((await host.timeline.host.make({ kind: 'nope' })).code, 'INVALID');
    assert.equal((await host.timeline.host.make({ kind: 'manual', surprise: 1 })).code, 'INVALID');
    assert.equal((await host.timeline.host.make(null)).code, 'INVALID');
    // The receipts say who made them.
    const causes = headCarrier(host).extra.storySuite.receipts.filter(receipt => receipt.type === 'savepoint.make').map(receipt => receipt.cause);
    assert.deepEqual(causes, ['system', 'system', 'system']);
});

test('make: ten manual save points succeed and the eleventh is LIMITED; forgetting one makes room', async t => {
    const { host } = await started(t);
    const ids = [];
    for (let n = 1; n <= 10; n += 1) {
        const made = await host.sdk.timeline.make({ kind: 'manual', name: `Save ${n}` });
        assert.equal(made.ok, true, `${n}: ${made.message}`);
        ids.push(made.snapshot.id);
    }
    const eleventh = await host.sdk.timeline.make({ kind: 'manual', name: 'One too many' });
    assert.equal(eleventh.code, 'LIMITED');
    assert.equal((await host.sdk.command('savepoint.make', { name: 'Also too many' })).code, 'LIMITED');
    assert.equal(Object.keys(host.head().domains.savepoints.points).length, 10);
    // The anchors the host makes do not count against the readers' ten.
    assert.equal((await host.timeline.host.make({ kind: 'initial' })).ok, true);
    assert.deepEqual(await host.sdk.timeline.forget({ snapshot: ids[0] }), { ok: true, forgotten: ids[0] });
    assert.equal((await host.sdk.timeline.make({ kind: 'manual', name: 'Room again' })).ok, true);
});

test('list: the eligible points in target order, with their bytes checked; status is idle', async t => {
    const { host } = await started(t);
    const a = (await host.sdk.timeline.make({ kind: 'manual', name: 'A' })).snapshot;
    await host.sdk.command('tl.xp', { amount: 5 });
    const b = (await host.sdk.timeline.make({ kind: 'manual', name: 'B' })).snapshot;
    await host.send('Next.', reply('More.'));
    const c = (await host.sdk.timeline.make({ kind: 'manual', name: 'C' })).snapshot;
    const listed = await host.sdk.timeline.list();
    assert.equal(listed.ok, true);
    assert.deepEqual(listed.points.map(point => point.name), ['A', 'B', 'C']);
    assert.deepEqual(listed.points.map(point => point.id), [a.id, b.id, c.id]);
    assert.deepEqual(host.sdk.query('savepoint.list', {}).map(point => point.id), [a.id, b.id, c.id], 'the query answers the same');
    assert.deepEqual(await host.sdk.timeline.status(), { ok: true, state: 'idle', return: null, participants: [] });
    // Bytes that are gone show as unavailable; the point stays listed.
    delete host.ctx.chatMetadata.storySuite.timeline.payloads[b.payloadHash];
    const after = (await host.sdk.timeline.list()).points;
    assert.deepEqual(after.map(point => point.available), [true, false, true]);
});

test('list: a save point belongs to the line of history it was made on: a swipe, a delete and an unseen swipe take it away and bring it back', async t => {
    const { host } = await started(t);
    await host.send('Second.', reply('Two.'));
    const made = (await host.sdk.timeline.make({ kind: 'manual', name: 'On two' })).snapshot;
    assert.deepEqual((await host.sdk.timeline.list()).points.map(point => point.id), [made.id]);
    // Swiping the reply it was made on: the new swipe has no such save point.
    await host.swipe(reply('Two, again.'));
    assert.deepEqual((await host.sdk.timeline.list()).points, []);
    assert.equal((await host.sdk.timeline.make({ kind: 'manual', name: 'On two again' })).ok, true);
    // Showing the first swipe again brings it back (its bytes were kept).
    const index = host.ctx.chat.length - 1;
    await host.st.swipeTo(index, 0);
    assert.deepEqual((await host.sdk.timeline.list()).points.map(point => point.id), [made.id]);
    assert.equal((await host.sdk.timeline.list()).points[0].available, true);
    // Deleting the reply takes it away.
    await host.st.deleteMessage(index);
    assert.deepEqual((await host.sdk.timeline.list()).points, []);
    assert.deepEqual(host.store.problems(), []);
});

test('forget: a manual point goes from the line of history; unknown is NOT_FOUND, an anchor is REFUSED, the bytes stay', async t => {
    const { host } = await started(t);
    const manual = (await host.sdk.timeline.make({ kind: 'manual', name: 'Keep?' })).snapshot;
    const anchor = (await host.timeline.host.make({ kind: 'initial' })).snapshot;
    assert.equal((await host.sdk.timeline.forget({ snapshot: 'sn_nothing0' })).code, 'NOT_FOUND');
    assert.equal((await host.sdk.timeline.forget({ snapshot: anchor.id })).code, 'REFUSED');
    assert.equal((await host.sdk.timeline.forget({})).code, 'INVALID');
    assert.equal((await host.sdk.timeline.forget({ snapshot: manual.id, extra: 1 })).code, 'INVALID');
    const done = await host.sdk.timeline.forget({ snapshot: manual.id });
    assert.deepEqual(done, { ok: true, forgotten: manual.id });
    assert.deepEqual((await host.sdk.timeline.list()).points.map(point => point.id), [anchor.id]);
    assert.equal(host.timeline.host.journal().length >= 2, true);
    assert.equal(host.ctx.chatMetadata.storySuite.timeline.payloads[manual.payloadHash] !== undefined, true, 'forgetting retracts eligibility, never bytes');
    assert.equal((await host.sdk.timeline.forget({ snapshot: manual.id })).code, 'NOT_FOUND', 'twice');
    // It is carrier-bound: swiping the reply that forgot it brings the point back.
    await host.swipe(reply('Elsewhere.'));
    assert.equal((await host.sdk.timeline.list()).points.length, 0, 'the point itself was made on the swiped reply');
});

test('make: a story that moves while the participants answer is STALE; nothing is stored and the bytes stay as a cache', async t => {
    let moves = 1;
    const host = await createHost({
        modules: [rulesModule()],
        // The reader acts between the checkpoints and the commit (once).
        timelineFaults: { at: async phase => { if (phase === 'make.archived' && moves-- > 0) await host.sdk.command('tl.xp', { amount: 9 }); } },
    });
    t.after(() => host.close());
    await host.send('Hello.', reply('The road.'));
    const result = await host.sdk.command('savepoint.make', { name: 'Too late' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'STALE');
    assert.equal(host.head().domains.savepoints, undefined, 'no descriptor');
    const archive = host.ctx.chatMetadata.storySuite.timeline;
    assert.equal(Object.keys(archive.payloads).length, 1, 'the bytes stay, unreferenced');
    assert.equal(Object.values(archive.journal).at(-1).phase, 'discarded');
    assert.deepEqual(host.sdk.query('savepoint.list', {}), []);
    // Asked again, with nothing in the way, it works.
    const again = await host.sdk.command('savepoint.make', { name: 'In time' });
    assert.equal(again.ok, true, again.message);
    assert.equal(Object.keys(host.head().domains.savepoints.points).length, 1);
});

test('make: a participant that cannot checkpoint holds the save (SNAPSHOT_UNAVAILABLE) and leaves nothing', async t => {
    const { host, native } = await started(t);
    native.native.fail.add('checkpoint');
    const result = await host.sdk.timeline.make({ kind: 'manual', name: 'No' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'SNAPSHOT_UNAVAILABLE');
    assert.match(result.message, /tl-native/);
    assert.equal(host.head().domains.savepoints, undefined);
    assert.equal(host.timeline.host.journal().at(-1).phase, 'aborted');
    native.native.fail.clear();
    assert.equal((await host.sdk.timeline.make({ kind: 'manual', name: 'Yes' })).ok, true);
});

test('make: a target cursor that is not the head is STALE; the head\'s own is fine', async t => {
    const { host } = await started(t);
    const head = await host.sdk.timeline.head();
    await host.sdk.command('tl.xp', { amount: 1 });
    assert.equal((await host.sdk.timeline.make({ kind: 'manual', target: head.cursor })).code, 'STALE');
    const now = await host.sdk.timeline.head();
    assert.equal((await host.sdk.timeline.make({ kind: 'manual', target: now.cursor })).ok, true);
    assert.equal((await host.sdk.timeline.make({ kind: 'manual', target: { sid: 1 } })).code, 'INVALID');
});

test('make while a restore is pending is RESTORE_PENDING, and the head says so too', async t => {
    const { host } = await started(t);
    host.registry.setRestore('pending', 'Restoring.');
    assert.equal((await host.sdk.timeline.head()).code, 'RESTORE_PENDING');
    assert.equal((await host.sdk.timeline.make({ kind: 'manual' })).code, 'RESTORE_PENDING');
    assert.equal((await host.sdk.timeline.forget({ snapshot: 'sn_nothing0' })).code, 'RESTORE_PENDING');
    host.registry.setRestore('idle');
    assert.equal((await host.sdk.timeline.head()).ok, true);
});

test('a crash while a save point is made is the fault hook\'s to simulate: it passes through every catch', async t => {
    const host = await createHost({
        modules: [rulesModule()],
        timelineFaults: { at: phase => { if (phase === 'make.archived') throw crash(); } },
    });
    t.after(() => host.close());
    await host.send('Hello.', reply('The road.'));
    await assert.rejects(host.sdk.timeline.make({ kind: 'manual' }), error => error.message.includes('simulated crash'));
});

test('the history method: ids and text of the messages, in order, the reader\'s own with projection-only ids', async t => {
    const { host } = await started(t);
    const history = await host.sdk.timeline.history({});
    assert.equal(history.ok, true);
    assert.equal(history.messages.length, host.ctx.chat.length);
    assert.deepEqual(history.messages.map(message => message.text), host.ctx.chat.map(message => message.mes));
    assert.deepEqual(history.messages.map(message => message.active), host.ctx.chat.map(() => true));
    assert.match(history.messages[1].sid, /^msg_[0-9a-z]{8}$/, 'the reader\'s message has no carrier id');
    assert.match(history.messages[2].sid, /^sr_[0-9a-z]{8}$/);
    assert.match(history.messages[2].swipeKey, /^sw_[0-9a-z]{8}$/);
    assert.deepEqual(history.faded, []);
    const head = await host.sdk.timeline.head();
    assert.equal((await host.sdk.timeline.history({ through: head.cursor })).messages.length, history.messages.length);
    assert.equal((await host.sdk.timeline.history({ through: { sid: 'sr_nothing0' } })).code, 'NOT_FOUND');
    assert.equal((await host.sdk.timeline.history({ through: 5 })).code, 'INVALID');
    assert.equal((await host.sdk.timeline.history({ surprise: 1 })).code, 'INVALID');
});
