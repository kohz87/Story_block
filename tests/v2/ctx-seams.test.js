// ctx.cursor() and ctx.epoch, the two host facts a command reads about where its block is (docs/v2/REPLAY.md): the cursor names the
// block by what it is (the reply's pair, its operation, its rank among the reply's blocks of that operation: no counter, no process history),
// so a replay, a Re-read, a block planned again and a swipe all agree with what the store stamps; op and rev are where it sits now. The
// epoch is the savepoints domain's when there is one, else the genesis epoch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { GENESIS_EPOCH, blockIdOf, epochOf, hashJson, isMetaSpan } from '../../src/v2/replay.js';
import { readRecord } from '../../src/v2/persist.js';

const reply = (text, lines = []) => (lines.length ? `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
const OWNER = 'cs-seams';

// A module that reads both facts in a guarded click (cs.mark) and in a guarded story line (! mark Word), and keeps what it read.
function seams() {
    const mark = (ctx, id) => {
        const cursor = ctx.cursor();
        const epoch = ctx.epoch;
        ctx.draft('cs').marks[id] = { cursor, epoch };
        ctx.replayGuard({ owner: OWNER, version: 2, epoch, rulesHash: null, inputHash: ctx.hash({ id }), predicate: { kind: 'mark', id } });
        return { summary: `Marked ${id}.`, narrate: false };
    };
    return {
        id: OWNER, name: 'Seams', version: '0.0.1',
        domains: { cs: { initial: () => ({ marks: {} }) } },
        commands: { 'cs.mark': (ctx, { id }) => mark(ctx, id), 'cs.peek': ctx => { ctx.draft('cs').marks.peek = { cursor: ctx.cursor(), epoch: ctx.epoch }; return { summary: 'Peeked.', narrate: false }; } },
        capture: { kinds: { mark: { grammar: '! mark Word' } }, apply: (ctx, line) => mark(ctx, line.name) },
        hooks: { replayGuard: () => ({ ok: true }) },
    };
}

async function started(t) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ modules: [seams()] });
    t.after(() => host.close());
    return host;
}
const marks = host => host.head().domains.cs.marks;
// Every guarded block of the chat's records: [{ index, span }].
const blocks = host => host.ctx.chat.flatMap((message, index) => {
    const record = readRecord(message);
    return (record?.spans ?? []).filter(isMetaSpan).map(span => ({ index, span }));
});
const boundaryOf = (host, id) => blocks(host).find(each => each.span.operation.payload?.id === id || each.span.operation.payload?.name === id || each.span.operation.payload?.raw?.includes(id)).span.boundaries[0].cursor;
const ident = cursor => ({ sid: cursor.sid, swipeKey: cursor.swipeKey, block: cursor.block });
const click = async (host, id) => {
    const done = await host.sdk.command('cs.mark', { id });
    assert.equal(done.ok, true, done.message);
};

test('a click reads the cursor its block is stored at: the block\'s first boundary, with the reply\'s canonical pair', async t => {
    const host = await started(t);
    await host.send('Go.', reply('A.'));
    await click(host, 'one');
    await click(host, 'two');
    for (const id of ['one', 'two']) {
        assert.deepEqual(marks(host)[id].cursor, boundaryOf(host, id), id);
    }
    const [one, two] = [marks(host).one.cursor, marks(host).two.cursor];
    assert.equal(one.sid, two.sid);
    assert.equal(one.swipeKey, two.swipeKey);
    assert.notEqual(one.block, two.block);
    assert.equal(two.op > one.op, true, 'the second block starts after the first one\'s changes');
    assert.equal(two.rev, one.rev + 1);
    assert.match(one.sid, /^sr_/);
    assert.match(one.swipeKey, /^sw_/);
    assert.match(one.block, /^bl_/);
});

test('on replay the cursor stands: a rebuild and a reload give the state and the boundaries the click read', async t => {
    const host = await started(t);
    await host.send('Go.', reply('A.', ['! mark line']));
    await click(host, 'one');
    const before = JSON.stringify(marks(host));
    host.store.rebuild();
    assert.equal(JSON.stringify(marks(host)), before, 'a rebuild');
    assert.deepEqual(marks(host).one.cursor, boundaryOf(host, 'one'));
    assert.deepEqual(marks(host).line.cursor, boundaryOf(host, 'line'));
    const image = { chat: JSON.parse(JSON.stringify(host.ctx.chat)), metadata: JSON.parse(JSON.stringify(host.ctx.chatMetadata)) };
    const again = await createHost({ modules: [seams()], st: { chat: image.chat } });
    t.after(() => again.close());
    again.ctx.chatMetadata = image.metadata;
    await again.turn.onChatChanged();
    assert.equal(JSON.stringify(marks(again)), before, 'a reload');
    assert.equal(again.store.problems().length, 0);
});

test('a story line reads the cursor it is stored at, live and when the reply is read again', async t => {
    const host = await started(t);
    await host.send('Go.', reply('A.', ['! mark one', '! mark two']));
    const live = clone(marks(host));
    assert.deepEqual(live.one.cursor, boundaryOf(host, 'one'));
    assert.deepEqual(live.two.cursor, boundaryOf(host, 'two'));
    assert.equal(live.two.cursor.op > live.one.cursor.op, true);
    // Read again, nothing changed: the same lines, the same blocks, the same cursors.
    const at = host.ctx.chat.length - 1;
    assert.equal((await host.sdk.reread(at)).ok, true);
    assert.deepEqual(clone(marks(host)), live);
    assert.deepEqual(marks(host).one.cursor, boundaryOf(host, 'one'));
    // A line added before them moves them, and what they read is where they are stored now.
    host.ctx.chat[at].mes = reply('A.', ['! mark first', '! mark one', '! mark two']);
    host.ctx.chat[at].swipes[host.ctx.chat[at].swipe_id] = host.ctx.chat[at].mes;
    assert.equal((await host.sdk.reread(at)).ok, true);
    for (const id of ['first', 'one', 'two']) assert.deepEqual(marks(host)[id].cursor, boundaryOf(host, id), id);
    assert.equal(marks(host).one.cursor.block, live.one.cursor.block, 'the same line is the same block, however far it has moved');
    assert.equal(marks(host).one.cursor.op > live.one.cursor.op, true, 'it starts after one more block now');
    assert.equal(host.store.problems().length, 0);
});

test('after a swipe the cursor is the swipe\'s own: the same sid, the swipe\'s key; the first swipe has its own back when shown again', async t => {
    const host = await started(t);
    await host.send('Go.', reply('A.', ['! mark one']));
    const first = clone(marks(host).one.cursor);
    await host.swipe(reply('B.', ['! mark one']));
    const second = clone(marks(host).one.cursor);
    assert.equal(second.sid, first.sid, 'the logical message is the same');
    assert.notEqual(second.swipeKey, first.swipeKey, 'the swipe is another');
    assert.deepEqual(second, boundaryOf(host, 'one'));
    const at = host.ctx.chat.length - 1;
    await host.st.swipeTo(at, 0);
    assert.deepEqual(marks(host).one.cursor, first);
    assert.deepEqual(marks(host).one.cursor, boundaryOf(host, 'one'));
});

test('the epoch is the genesis epoch until the savepoints domain exists, then that domain\'s; a replay gives the same', async t => {
    const host = await started(t);
    await host.send('Go.', reply('A.'));
    assert.equal(epochOf(host.head()), GENESIS_EPOCH);
    await click(host, 'before');
    assert.equal(marks(host).before.epoch, 'ep_00000000');
    // The first save point makes the domain (simulated here by a module that owns it, as E6a's host will); its epoch takes over.
    await host.sdk.registerModule({ id: 'cs-sim', name: 'Simulated save points', version: '0.0.1', domains: { savepoints: { initial: () => ({ epoch: 'ep_00000007' }) } } });
    assert.equal(host.head().domains.savepoints.epoch, 'ep_00000007');
    await click(host, 'after');
    assert.equal(marks(host).after.epoch, 'ep_00000007');
    assert.equal(marks(host).before.epoch, 'ep_00000000', 'what was read before stays');
    host.store.rebuild();
    assert.deepEqual([marks(host).before.epoch, marks(host).after.epoch], ['ep_00000000', 'ep_00000007']);
    assert.equal(epochOf({ domains: { savepoints: { epoch: '' } } }), GENESIS_EPOCH);
    assert.equal(epochOf({ domains: { savepoints: 5 } }), GENESIS_EPOCH);
    assert.equal(epochOf(null), GENESIS_EPOCH);
});

test('a block that is not the one its command\'s cursor named is not stored', async t => {
    const host = await started(t);
    await host.send('Go.', reply('A.'));
    const result = host.bus.run('cs.mark', { id: 'x' }, { cause: 'ui' });
    assert.equal(result.ok, true, result.message);
    assert.equal(typeof result.block.cursor.block, 'string');
    const wrong = { ...result.block, cursor: { ...result.block.cursor, block: 'bl_00000000' } };
    assert.throws(() => host.store.append({ ops: result.ops, receipt: result.receipt, block: wrong }), /not the one the cursor/);
    host.store.append({ ops: result.ops, receipt: result.receipt, block: result.block });
    assert.deepEqual(marks(host).x.cursor, boundaryOf(host, 'x'));
});

test('a block is named by what it is: the hash of the reply\'s pair, its operation and its rank among the reply\'s blocks of that operation', async t => {
    const host = await started(t);
    await host.send('Go.', reply('A.'));
    await click(host, 'one');
    await click(host, 'one');
    await click(host, 'two');
    const [first, again, other] = blocks(host).map(each => each.span);
    const key = id => hashJson({ type: 'cs.mark', line: { id } });
    const pair = { sid: first.boundaries[0].cursor.sid, swipeKey: first.boundaries[0].cursor.swipeKey };
    assert.equal(first.id, blockIdOf({ ...pair, key: key('one'), rank: 0 }));
    assert.equal(again.id, blockIdOf({ ...pair, key: key('one'), rank: 1 }), 'the same click again is the next of its kind');
    assert.equal(other.id, blockIdOf({ ...pair, key: key('two'), rank: 0 }));
    assert.equal(marks(host).one.cursor.block, again.id, 'the mark the second click kept is its own block');
});

test('the block of a line is the same after it is removed and added again, after a reload and a Re-read', async t => {
    const host = await started(t);
    await host.send('Go.', reply('A.', ['! mark one']));
    const at = host.ctx.chat.length - 1;
    const id = marks(host).one.cursor.block;
    const edit = lines => {
        host.ctx.chat[at].mes = reply('A.', lines);
        host.ctx.chat[at].swipes[host.ctx.chat[at].swipe_id] = host.ctx.chat[at].mes;
    };
    edit([]);
    assert.equal((await host.sdk.reread(at)).ok, true);
    assert.equal(marks(host).one, undefined, 'the line is gone');
    edit(['! mark one']);
    assert.equal((await host.sdk.reread(at)).ok, true);
    assert.equal(marks(host).one.cursor.block, id, 'back, as the same block');
    const image = { chat: JSON.parse(JSON.stringify(host.ctx.chat)), metadata: JSON.parse(JSON.stringify(host.ctx.chatMetadata)) };
    const again = await createHost({ modules: [seams()], st: { chat: image.chat } });
    t.after(() => again.close());
    again.ctx.chatMetadata = image.metadata;
    await again.turn.onChatChanged();
    assert.equal((await again.sdk.reread(again.ctx.chat.length - 1)).ok, true);
    assert.equal(marks(again).one.cursor.block, id, 'and after a reload and a Re-read');
    assert.deepEqual(marks(again).one.cursor, boundaryOf(again, 'one'));
});

test('a Re-read moves a kept block: a saved cursor still names it by { sid, swipeKey, block }, and op and rev are where it sits now', async t => {
    const host = await started(t);
    await host.send('Go.', reply('A.', ['! mark one']));
    await click(host, 'kept');
    const saved = clone(marks(host).kept.cursor);
    const at = host.ctx.chat.length - 1;
    host.ctx.chat[at].mes = reply('A.', ['! mark first', '! mark one']);
    host.ctx.chat[at].swipes[host.ctx.chat[at].swipe_id] = host.ctx.chat[at].mes;
    assert.equal((await host.sdk.reread(at)).ok, true);
    const now = boundaryOf(host, 'kept');
    assert.deepEqual(ident(now), ident(saved), 'it is the same block');
    assert.notEqual(now.op, saved.op, 'which has moved');
    assert.deepEqual(marks(host).kept.cursor, saved, 'what it read is what it read');
});

test('a block planned again for its own reply is told by the id it has: ctx.cursor works for the step a Re-read or a reconcile runs again', async t => {
    const host = await started(t);
    await host.send('Go.', reply('A.'));
    await click(host, 'one');
    await click(host, 'two');
    const at = host.ctx.chat.length - 1;
    const stored = blocks(host).find(each => each.span.operation.payload.id === 'two').span;
    const again = host.bus.run('cs.mark', { id: 'two' }, { cause: 'system', reply: { index: at, sid: host.store.carrierSid(at), ordinal: stored.source.ordinal } });
    assert.equal(again.ok, true, again.message);
    assert.equal(again.block.id, stored.id, 'the id it has');
    assert.deepEqual(ident(again.state.domains.cs.marks.two.cursor), ident(stored.boundaries[0].cursor));
    assert.equal(again.state.domains.cs.marks.two.cursor.op, stored.boundaries[0].cursor.op, 'and where it sits now');
});

test('a command that reads its cursor makes a guarded block, or fails: no id is handed out that is never stored', async t => {
    const host = await started(t);
    await host.send('Go.', reply('A.'));
    const peek = await host.sdk.command('cs.peek', {});
    assert.equal(peek.ok, false);
    assert.match(peek.message, /made no guarded block/);
    assert.equal(marks(host).peek, undefined);
});

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}
