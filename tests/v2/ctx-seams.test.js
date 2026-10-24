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
        domains: { cs: { initial: () => ({ marks: {}, steps: {}, lines: {}, ons: {} }) } },
        commands: {
            'cs.mark': (ctx, { id }) => mark(ctx, id),
            // A click that stands on a line's block: it holds only while that block is there.
            'cs.on'(ctx, { block }) {
                if (!Object.hasOwn(ctx.read('cs').lines, block)) ctx.fail('NOT_FOUND', 'That line is not there.');
                ctx.draft('cs').ons[block] = true;
                ctx.replayGuard({ owner: OWNER, version: 2, epoch: ctx.epoch, rulesHash: null, inputHash: ctx.hash({ block }), predicate: { kind: 'on', block } });
                return { summary: 'On.', narrate: false };
            },
            // A planned-again step that keeps the cursor it read, under the block's own id.
            'cs.step'(ctx) {
                const cursor = ctx.cursor();
                ctx.draft('cs').steps[cursor.block] = cursor;
                ctx.replayGuard({ owner: OWNER, version: 2, epoch: ctx.epoch, rulesHash: null, inputHash: ctx.hash({ step: 'x' }), predicate: { kind: 'step' } });
                return { summary: 'Step.', narrate: false, replan: true };
            }, 'cs.peek': ctx => { ctx.draft('cs').marks.peek = { cursor: ctx.cursor(), epoch: ctx.epoch }; return { summary: 'Peeked.', narrate: false }; } },
        capture: {
            kinds: { mark: { grammar: '! mark Word' }, note: { grammar: '! note Word' } },
            apply(ctx, line) {
                if (line.kind !== 'note') return mark(ctx, line.name);
                // A line kept under the block's own id, so two identical lines are two entries.
                const cursor = ctx.cursor();
                ctx.draft('cs').lines[cursor.block] = cursor;
                ctx.replayGuard({ owner: OWNER, version: 2, epoch: ctx.epoch, rulesHash: null, inputHash: ctx.hash({ note: line.name }), predicate: { kind: 'note' } });
                return { summary: `Noted ${line.name}.`, narrate: false };
            },
        },
        hooks: {
            replayGuard: ({ state }, { guard }) => (guard.predicate.kind === 'on' && !Object.hasOwn(state.domains.cs.lines, guard.predicate.block) ? { ok: false, reason: 'the line it stands on is gone' } : { ok: true }),
            // `steps.n` identical steps, asked for after every reply's lines (planned again by a Re-read).
            afterCapture: () => ({ commands: Array.from({ length: steps.n }, () => ({ type: 'cs.step', payload: {} })) }),
        },
    };
}
const steps = { n: 0 };

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

test('the block of a line that stays is the same block after a Re-read, a reload and another Re-read; one removed and added again is a new block', async t => {
    const host = await started(t);
    await host.send('Go.', reply('A.', ['! mark one']));
    const at = host.ctx.chat.length - 1;
    const id = marks(host).one.cursor.block;
    const edit = lines => {
        host.ctx.chat[at].mes = reply('A.', lines);
        host.ctx.chat[at].swipes[host.ctx.chat[at].swipe_id] = host.ctx.chat[at].mes;
    };
    for (let n = 0; n < 2; n += 1) {
        assert.equal((await host.sdk.reread(at)).ok, true);
        assert.equal(marks(host).one.cursor.block, id, `Re-read ${n + 1} of the same text`);
    }
    const image = { chat: JSON.parse(JSON.stringify(host.ctx.chat)), metadata: JSON.parse(JSON.stringify(host.ctx.chatMetadata)) };
    const again = await createHost({ modules: [seams()], st: { chat: image.chat } });
    t.after(() => again.close());
    again.ctx.chatMetadata = image.metadata;
    await again.turn.onChatChanged();
    assert.equal((await again.sdk.reread(again.ctx.chat.length - 1)).ok, true);
    assert.equal(marks(again).one.cursor.block, id, 'after a reload and a Re-read');
    assert.deepEqual(marks(again).one.cursor, boundaryOf(again, 'one'));
    // A line that goes and comes back is another block: the reply never hands the first one's occurrence out again.
    edit([]);
    assert.equal((await host.sdk.reread(at)).ok, true);
    assert.equal(marks(host).one, undefined);
    edit(['! mark one']);
    assert.equal((await host.sdk.reread(at)).ok, true);
    assert.notEqual(marks(host).one.cursor.block, id);
    assert.deepEqual(marks(host).one.cursor, boundaryOf(host, 'one'));
});

test('an afterCapture step keeps its block through Re-reads and a reload (it neither drifts nor takes another\'s identity)', async t => {
    const host = await started(t);
    steps.n = 1;
    t.after(() => { steps.n = 0; });
    await host.send('Go.', reply('A.', ['! mark line']));
    const at = host.ctx.chat.length - 1;
    const ids = () => Object.keys(host.head().domains.cs.steps).sort();
    const first = ids();
    assert.equal(first.length, 1);
    for (let n = 0; n < 3; n += 1) {
        assert.equal((await host.sdk.reread(at)).ok, true);
        assert.deepEqual(ids(), first, `Re-read ${n + 1}`);
    }
    const image = { chat: JSON.parse(JSON.stringify(host.ctx.chat)), metadata: JSON.parse(JSON.stringify(host.ctx.chatMetadata)) };
    const again = await createHost({ modules: [seams()], st: { chat: image.chat } });
    t.after(() => again.close());
    again.ctx.chatMetadata = image.metadata;
    await again.turn.onChatChanged();
    assert.equal((await again.sdk.reread(again.ctx.chat.length - 1)).ok, true);
    assert.deepEqual(Object.keys(again.head().domains.cs.steps).sort(), first, 'after a reload and a Re-read');
    assert.equal(again.store.problems().filter(problem => problem.code !== 'REPLANNED').length, 0);
});

test('two identical afterCapture steps are two blocks, with two ids that stay put through Re-reads and a reload', async t => {
    const host = await started(t);
    steps.n = 2;
    t.after(() => { steps.n = 0; });
    await host.send('Go.', reply('A.', ['! mark line']));
    const at = host.ctx.chat.length - 1;
    const ids = () => Object.keys(host.head().domains.cs.steps).sort();
    const first = ids();
    assert.equal(new Set(first).size, 2, 'two blocks, not one');
    for (let n = 0; n < 3; n += 1) {
        assert.equal((await host.sdk.reread(at)).ok, true);
        assert.deepEqual(ids(), first, `Re-read ${n + 1}`);
    }
    for (const [block, cursor] of Object.entries(host.head().domains.cs.steps)) assert.equal(cursor.block, block);
    const image = { chat: JSON.parse(JSON.stringify(host.ctx.chat)), metadata: JSON.parse(JSON.stringify(host.ctx.chatMetadata)) };
    const again = await createHost({ modules: [seams()], st: { chat: image.chat } });
    t.after(() => again.close());
    again.ctx.chatMetadata = image.metadata;
    await again.turn.onChatChanged();
    assert.equal((await again.sdk.reread(again.ctx.chat.length - 1)).ok, true);
    assert.deepEqual(Object.keys(again.head().domains.cs.steps).sort(), first);
    assert.deepEqual(again.store.problems().filter(problem => problem.code !== 'REPLANNED'), []);
});

test('two identical clicks keep their own ids when a Re-read puts a line before them: an untouched duplicate keeps the occurrence it was stored with', async t => {
    const host = await started(t);
    await host.send('Go.', reply('A.', ['! mark line']));
    await click(host, 'dup');
    await click(host, 'dup');
    const spans = () => blocks(host).map(each => each.span).filter(span => span.operation.payload.id === 'dup');
    const [first, second] = spans().map(span => span.id);
    assert.notEqual(first, second);
    const at = host.ctx.chat.length - 1;
    host.ctx.chat[at].mes = reply('A.', ['! mark before', '! mark line']);
    host.ctx.chat[at].swipes[host.ctx.chat[at].swipe_id] = host.ctx.chat[at].mes;
    assert.equal((await host.sdk.reread(at)).ok, true);
    assert.deepEqual(spans().map(span => span.id), [first, second]);
    assert.deepEqual(spans().map(span => span.occurrence), [0, 1], 'each keeps the number it was given');
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

test('during a Re-read an afterCapture step reads the op its own stamped boundary has, as a story line does', async t => {
    const host = await started(t);
    steps.n = 2;
    t.after(() => { steps.n = 0; });
    await host.send('Go.', reply('A.', ['! mark line']));
    await click(host, 'kept');
    await click(host, 'kept2');
    const at = host.ctx.chat.length - 1;
    for (let n = 0; n < 2; n += 1) {
        assert.equal((await host.sdk.reread(at)).ok, true);
        const stepBlocks = blocks(host).map(each => each.span).filter(span => span.operation.type === 'cs.step');
        assert.equal(stepBlocks.length, 2);
        for (const span of stepBlocks) {
            const read = host.head().domains.cs.steps[span.id];
            assert.deepEqual(read, span.boundaries[0].cursor, `Re-read ${n + 1}: what the step read is where its block starts`);
        }
        assert.notEqual(stepBlocks[0].boundaries[0].cursor.op, stepBlocks[1].boundaries[0].cursor.op);
    }
    const line = blocks(host).map(each => each.span).find(span => span.operation.payload.raw?.includes('line') || span.operation.payload.name === 'line');
    assert.deepEqual(host.head().domains.cs.marks.line.cursor, line.boundaries[0].cursor);
});

test('delete the first of two identical lines and read the reply again: the survivor is a fresh block, the click on the first is hidden with a Problem, also after a rebuild', async t => {
    const host = await started(t);
    await host.send('Go.', reply('A.', ['! note dup', '! note dup']));
    const at = host.ctx.chat.length - 1;
    const lines = () => host.head().domains.cs.lines;
    const [first, second] = Object.keys(lines()).sort((a, b) => lines()[a].op - lines()[b].op);
    assert.notEqual(first, second);
    const done = await host.sdk.command('cs.on', { block: first });
    assert.equal(done.ok, true, done.message);
    assert.equal(host.head().domains.cs.ons[first], true);
    host.ctx.chat[at].mes = reply('A.', ['! note dup']);
    host.ctx.chat[at].swipes[host.ctx.chat[at].swipe_id] = host.ctx.chat[at].mes;
    assert.equal((await host.sdk.reread(at)).ok, true);
    const survivor = Object.keys(lines());
    assert.equal(survivor.length, 1);
    assert.equal(survivor.includes(first) || survivor.includes(second), false, 'neither old block id');
    // The cursor it read is the stored block, and the stored occurrence is the one its id is made of.
    const span = blocks(host).map(each => each.span).find(each => each.id === survivor[0]);
    assert.deepEqual(lines()[survivor[0]], span.boundaries[0].cursor);
    assert.equal(span.occurrence >= 2, true, 'a number nobody had used');
    assert.equal(span.id, blockIdOf({ sid: span.boundaries[0].cursor.sid, swipeKey: span.boundaries[0].cursor.swipeKey, key: hashJson({ type: span.operation.type, line: span.operation.payload.raw ?? span.operation.payload }), rank: span.occurrence }));
    // The click stood on the first: it is hidden, with a Problem, now and after a rebuild.
    const hidden = () => host.head().domains.cs.ons[first] === undefined;
    assert.equal(hidden(), true, 'the click is hidden');
    assert.equal(host.store.problems().some(problem => problem.code === 'REPLAY_PREREQUISITE' && /line it stands on is gone/.test(problem.why)), true);
    host.store.rebuild();
    assert.equal(hidden(), true, 'and after a rebuild');
    assert.equal(host.store.problems().some(problem => problem.code === 'REPLAY_PREREQUISITE' && /line it stands on is gone/.test(problem.why)), true);
    assert.deepEqual(Object.keys(lines()), survivor);
});
