// Regressions from the review of the replay core (docs/v2/REPLAY.md): a first checkpoint with `covers`, a record kept
// aside staying read-only, a repair only on the reader's say, Re-read / reconcile / rewind starting from the chain,
// claims already held, stripped metadata, ids that stay with a line, and a command that does not scan the chat.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { isMetaSpan } from '../../src/v2/replay.js';
import { Q1, Q2, claimKey, guarded, harness } from './helpers/guarded.js';

// SillyTavern moves away from a swipe by copying `extra` into that swipe's own slot first.
function newSwipe(message, text) {
    message.swipe_info[message.swipe_id] = { ...message.swipe_info[message.swipe_id], extra: structuredClone(message.extra) };
    message.swipes.push(text);
    message.swipe_info.push({ extra: structuredClone(message.extra) });
    message.swipe_id = message.swipes.length - 1;
    message.mes = text;
}
function showSwipe(message, swipe) {
    message.swipe_info[message.swipe_id] = { ...message.swipe_info[message.swipe_id], extra: structuredClone(message.extra) };
    message.swipe_id = swipe;
    message.extra = structuredClone(message.swipe_info[swipe].extra);
    message.mes = message.swipes[swipe];
}

const SMALL = { checkpointEvery: 3, checkpointBytes: 1 << 30 };
const clone = value => JSON.parse(JSON.stringify(value));

test('a story whose first replies are gone and unseen is not adopted or reset by itself: read-only, and the reader chooses', () => {
    const h = harness([guarded()], SMALL);
    for (let i = 1; i <= 8; i++) {
        h.send(`u${i}`, `r${i}`);
        assert.equal(h.command('gt.hit', { actor: `ac_${String(i).padStart(8, '0')}`, amount: 1 }).ok, true);
    }
    const cps = h.chat.map((message, i) => (message.extra.storySuite?.checkpoint && message.extra.storySuite.covers ? i : -1)).filter(i => i > 0);
    assert.ok(cps.length >= 1);
    h.chat.splice(0, cps[0]);                 // everything before the first such reply is deleted
    const saved = clone(h.chat);
    const hits = saved.reduce((sum, message) => sum + (message.extra?.storySuite?.receipts ?? []).filter(receipt => receipt.type === 'gt.hit').length, 0);
    // The same session saw the replies, so the story goes on from what they ended with.
    h.store.rebuild();
    h.store.ensureInitial(h.registry.initialState());
    assert.equal(Object.keys(h.gt().lost).length, 8);
    // A new session never saw them: the earliest checkpoint left cannot be checked, so nothing is adopted and nothing reset.
    const open = () => {
        const b = harness([guarded()], SMALL);
        b.chat.splice(0, b.chat.length, ...clone(saved));
        b.store.rebuild();
        return b;
    };
    const b = open();
    const before = JSON.stringify(b.chat);
    const notes = b.store.ensureInitial(b.registry.initialState());
    assert.equal(notes.length, 1);
    assert.match(notes[0], /the saved history as it is/);
    assert.equal(b.store.readOnly().kind, 'unresolved');
    assert.deepEqual(b.store.head(), b.registry.initialState(), 'an empty working story');
    assert.deepEqual(b.store.ensureInitial(b.registry.initialState()), [], 'told once');
    assert.equal(JSON.stringify(b.chat), before, 'nothing was written');
    assert.equal(b.command('gt.hit', { actor: 'ac_00000099', amount: 1 }).ok, false, 'a click is refused');
    assert.throws(() => b.store.keepEarliest({ confirmed: false }), /confirmation/);
    assert.throws(() => b.store.startOver({ confirmed: false }), /confirmation/);
    assert.equal(JSON.stringify(b.chat), before);
    // Keep the earliest saved point: it is trusted as the start of the story, with what the deleted replies left in it.
    b.store.keepEarliest({ confirmed: true });
    assert.equal(b.store.readOnly(), null);
    assert.equal(Object.keys(b.gt().lost).length, 8, 'the story state from the earliest saved point');
    assert.equal(b.chat[0].extra.storySuite.covers, undefined);
    assert.equal(b.command('gt.hit', { actor: 'ac_00000099', amount: 1 }).ok, true);
    // Or start over: the story's numbers begin again and what is left of the replies replays on top.
    const c = open();
    c.store.ensureInitial(c.registry.initialState());
    c.store.startOver({ confirmed: true });
    assert.equal(c.store.readOnly(), null);
    assert.equal(Object.keys(c.gt().lost).length, hits, 'only what the replies that are left did');
    assert.deepEqual(c.problems(), []);
});

test('read-only stays read-only: replies, clicks and reloads write nothing next to a record kept aside', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ modules: [guarded()], core: false });
    t.after(() => host.close());
    await host.send('a', 'One.');
    const chat = structuredClone(host.ctx.chat);
    const FUTURE = { v: 3, sid: 'sw_future00001', checkpoint: { v: 3 }, ops: [{ op: 'x' }], receipts: [], narrated: [], rev: 9 };
    chat[0].extra.storySuite = structuredClone(FUTURE);
    chat[0].swipe_info[0].extra.storySuite = structuredClone(FUTURE);
    await host.st.loadChat(chat);
    const first = JSON.stringify(host.ctx.chat[0]);
    const records = () => host.ctx.chat.map(message => message.extra?.storySuite?.v);
    const before = records();
    await host.send('go', 'He walks.\n\n<Changes>\n! tick 5\n</Changes>');
    assert.equal(host.store.readOnly().kind, 'future', 'after the first reply');
    assert.equal((await host.bus.command('gt.hit', { actor: 'ac_00000001', amount: 1 }, { cause: 'ui' })).ok, false, 'a click is refused');
    await host.send('go', 'He walks on.\n\n<Changes>\n! tick 6\n</Changes>');
    assert.equal(host.store.readOnly().kind, 'future', 'after the second');
    assert.equal(host.head().domains.gt.minutes, 0, 'an empty story');
    assert.equal(JSON.stringify(host.ctx.chat[0]), first, 'the first record, byte for byte');
    assert.deepEqual(records().slice(0, before.length), before, 'no record was written on any reply');
    assert.equal(host.ctx.chat.slice(before.length).every(message => message.extra?.storySuite === undefined), true);
    await host.st.loadChat(structuredClone(host.ctx.chat));
    assert.equal(host.store.readOnly().kind, 'future', 'after a reload');
    assert.equal(host.store.dirty(), false);
});

test('a damaged first record is started over only when the reader says so, and the damaged one is kept beside it', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ modules: [guarded()], core: false });
    t.after(() => host.close());
    await host.send('a', 'One.\n\n<Changes>\n! tick 5\n</Changes>');
    await host.store.flush();
    const chat = structuredClone(host.ctx.chat);
    for (const extra of [chat[0].extra, chat[0].swipe_info[0].extra]) if (extra.storySuite) extra.storySuite.checkpoint = { v: 2 };
    const damaged = structuredClone(chat[0].extra.storySuite);
    await host.st.loadChat(chat);
    assert.equal(host.store.readOnly().kind, 'damaged');
    const problem = host.turn.problems().find(item => item.code === 'DAMAGED');
    assert.deepEqual(problem.actions.map(item => item.id), ['start-over']);
    assert.match(problem.actions[0].label, /Start this chat's story state over/);
    assert.match(problem.actions[0].confirm, /Start over\?$/);
    assert.deepEqual(host.turn.repairActions(), problem.actions);
    // Nothing happens by itself, and not without the reader's confirmation.
    assert.equal((await host.turn.repair('start-over')).ok, false);
    assert.equal((await host.turn.repair('start-over', { confirmed: false })).ok, false);
    assert.equal((await host.turn.repair('nope', { confirmed: true })).ok, false);
    assert.equal(host.store.readOnly().kind, 'damaged');
    assert.deepEqual(host.ctx.chat[0].extra.storySuite, damaged);
    // The reader confirms.
    const done = await host.turn.repair('start-over', { confirmed: true });
    assert.equal(done.ok, true, done.message);
    assert.equal(host.store.readOnly(), null);
    assert.deepEqual(host.ctx.chat[0].extra.storySuiteAside, [{ kind: 'damaged', record: damaged }], 'kept beside the new record');
    assert.equal(host.ctx.chat[0].extra.storySuite.v, 2);
    assert.equal(host.head().domains.gt.minutes, 5, 'the reply after it replays on top');
    assert.equal((await host.bus.command('gt.hit', { actor: 'ac_00000001', amount: 1 }, { cause: 'ui' })).ok, true);
    assert.deepEqual(host.turn.repairActions(), []);
});

test('a future-version record offers no repair: it says to update Story Block', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ modules: [guarded()], core: false });
    t.after(() => host.close());
    await host.send('a', 'One.');
    const chat = structuredClone(host.ctx.chat);
    chat[0].extra.storySuite = { v: 3, sid: 'sw_future00001', ops: [], receipts: [], narrated: [] };
    await host.st.loadChat(chat);
    assert.deepEqual(host.turn.repairActions(), []);
    const problem = host.turn.problems().find(item => item.code === 'DAMAGED');
    assert.match(problem.message, /Update Story Block/);
    assert.equal(problem.actions, undefined);
    const refused = await host.turn.repair('start-over', { confirmed: true });
    assert.equal(refused.ok, false);
    assert.match(refused.message, /update Story Block/);
    assert.deepEqual(host.ctx.chat[0].extra.storySuite, { v: 3, sid: 'sw_future00001', ops: [], receipts: [], narrated: [] });
});

// A chat with a clock set on reply 1 and a zero-or-more credit attempt on reply 5, checkpoints every three replies.
function ticked() {
    const h = harness([guarded()], SMALL);
    const at = [];
    for (let i = 1; i <= 6; i++) {
        at.push(h.send(`u${i}`, `r${i}`));
        if (i === 1) h.command('gt.tick', { minutes: 90 });
        if (i === 5) h.command('gt.attempt', { id: Q1 }, 'system');
    }
    return { h, at };
}
const planAgain = h => (state, receipt, info) => h.bus.run(info.replan.type, info.replan.payload, {
    cause: 'system', state, seed: info.replan.seed,
    reply: { index: info.index, sid: h.store.carrierSid(info.index), ordinal: info.span.source.ordinal },
});
const fresh = (chat, options = SMALL) => {
    const h = harness([guarded()], options);
    h.chat.splice(0, h.chat.length, ...clone(chat));
    h.store.rebuild();
    return h;
};

test('reconcile starts from the chain, not from a checkpoint that does not hold: its result equals a fresh replay', () => {
    const { h, at } = ticked();
    h.chat.splice(at[0] - 1, 2);              // the reply that set the clock is deleted
    h.store.rebuild();
    const checkpoint = h.chat.findIndex((message, i) => i > 0 && message.extra?.storySuite?.checkpoint);
    assert.ok(checkpoint > 0);
    h.store.reconcile(checkpoint, { rerun: planAgain(h) });
    const live = h.gt();
    const again = fresh(h.chat).gt();
    assert.deepEqual([live.minutes, live.credits, live.attempts], [again.minutes, again.credits, again.attempts]);
    assert.equal(live.minutes, 0, 'the deleted clock is not in it');
});

test('a rewind that takes nothing back leaves the story as a reload has it (no checkpoint of a deleted reply)', () => {
    const h = harness([guarded()], SMALL);
    const at = [];
    for (let i = 1; i <= 6; i++) {
        at.push(h.send(`u${i}`, `r${i}`));
        h.command('gt.hit', { actor: `ac_${String(i).padStart(8, '0')}`, amount: 1 });
    }
    h.chat.splice(at[4] - 1, 2);
    h.store.rebuild();
    h.store.truncate(h.store.headIndex(), h.store.head().meta.rev + 5);
    const live = Object.keys(h.gt().lost);
    assert.deepEqual(live, Object.keys(fresh(h.chat).gt().lost));
    assert.equal(live.length, 5);
});

test('a claim that is already held is never paid twice: the later twin of a settlement stays off', () => {
    const h = harness([guarded()], SMALL);
    const r1 = h.send('u1', 'a');
    h.command('gt.offer', { id: Q1, instance: 1 });
    h.command('gt.prove', { id: Q1 });
    h.send('u2', 'b');
    assert.equal(h.command('gt.settle', { id: Q1, instance: 1, reward: 6 }).ok, true);
    newSwipe(h.chat[r1], 'a again');           // a regeneration without the offer
    h.store.rebuild();
    assert.equal(h.gt().coin, 0);
    h.send('u3', 'c');
    h.command('gt.offer', { id: Q1, instance: 1 });
    h.command('gt.prove', { id: Q1 });
    assert.equal(h.command('gt.settle', { id: Q1, instance: 1, reward: 6 }).ok, true, 'the retry');
    assert.equal(h.gt().coin, 6);
    showSwipe(h.chat[r1], 0);                  // the first offer and the first settlement wake up
    h.store.rebuild();
    assert.equal(h.gt().coin, 6, 'paid once, not twice');
    assert.equal(Object.keys(h.store.head().meta.claims).filter(key => key === claimKey(Q1, 1)).length, 1);
    assert.ok(h.problems().some(problem => problem.code === 'REPLAY_PREREQUISITE' && /claim already held/.test(problem.why)));
    assert.equal(fresh(h.chat).gt().coin, 6);
});

test('a guarded block that has lost its span metadata is damaged, not legacy: the receipt says it was guarded', () => {
    const build = () => {
        const h = harness([guarded()]);
        const clock = h.send('u', 'clock');
        h.command('gt.tick', { minutes: 90 });
        h.send('u2', 'later');
        h.command('gt.attempt', { id: Q1 }, 'system');
        h.chat.splice(clock - 1, 2);           // the clock is back at 0: the guard must say no
        return h;
    };
    const intact = build();
    intact.store.rebuild();
    const expected = JSON.stringify([intact.gt().credits, intact.gt().attempts]);
    assert.equal(expected, '[{},{}]', 'the control: the guard says no');
    const strips = {
        'span ids stripped': record => { for (const span of record.spans) delete span.id; },
        'spans reduced to { n, story }': record => { record.spans = record.spans.map(span => ({ n: span.n, story: span.story })); },
        'spans deleted': record => { delete record.spans; },
        'a span count that does not add up': record => { record.spans[0].n += 1; },
        'the record source removed': record => { delete record.source; },
        'the record source emptied': record => { record.source = {}; },
        'the guard removed from the span': record => { for (const span of record.spans) if (isMetaSpan(span)) span.guard = null; },
    };
    for (const [label, strip] of Object.entries(strips)) {
        const h = build();
        const chat = clone(h.chat);
        strip(chat.at(-1).extra.storySuite);
        const other = harness([guarded()]);
        other.chat.splice(0, other.chat.length, ...chat);
        other.store.rebuild();
        assert.equal(JSON.stringify([other.gt().credits, other.gt().attempts]), expected, label);
        assert.ok(other.problems().some(problem => problem.code === 'REPLAY_PREREQUISITE'), label);
    }
});

test('a Re-read of an unchanged guarded story line keeps its block id; a changed line gets another', async t => {
    const host = await createHost({ modules: [guarded()], core: false });
    t.after(() => host.close());
    const text = lines => `Dawn.\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
    await host.send('Go.', text([`! quick ${Q1}`, `! quick ${Q2}`]));
    const at = host.ctx.chat.length - 1;
    const ids = () => host.ctx.chat[at].extra.storySuite.spans.filter(isMetaSpan).map(span => span.id);
    const first = ids();
    assert.equal(new Set(first).size, 2);
    const result = await host.turn.reread(at);
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(ids(), first, 'the same lines, the same ids');
    host.ctx.chat[at].mes = text([`! quick ${Q2}`]);
    host.ctx.chat[at].swipes[0] = host.ctx.chat[at].mes;
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.deepEqual(ids(), [first[1]], 'a line kept keeps its id');
});

test('a command does not read the whole chat: the cost of a reply does not grow with the chat', () => {
    const h = harness([guarded()]);
    for (let i = 0; i < 400; i++) {
        h.send(`u${i}`, `r${i}`);
        if (i % 50 === 0) h.command('gt.hit', { actor: 'ac_00000001', amount: 1 });
    }
    // Count what is read of the other messages while one more reply gets its first record.
    let reads = 0;
    const watch = message => new Proxy(message, { get(target, key, receiver) { if (key === 'extra' || key === 'swipe_info') reads += 1; return Reflect.get(target, key, receiver); } });
    for (let i = 1; i < h.chat.length; i++) h.chat[i] = watch(h.chat[i]);
    h.send('last', 'last');
    h.chat[h.chat.length - 1] = h.chat.at(-1);
    reads = 0;
    assert.equal(h.command('gt.hit', { actor: 'ac_00000001', amount: 1 }).ok, true);
    assert.ok(reads < 2000, `reads of the other messages: ${reads}`);
});
