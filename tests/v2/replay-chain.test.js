// Checkpoint chains, Re-read and the suffix reconciler (docs/v2/REPLAY.md, contract §6 and §10 E, row 3):
// no checkpoint is trusted past the first window that fails; a Re-read replays what it keeps as a rebuild
// does and plans guarded system steps again, removing the old ops and claims as the new ones go in; every
// reset is absolute, so a reply deleted before it never turns it into a negative change.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { isMetaSpan } from '../../src/v2/replay.js';
import { EPOCH, Q1, claimKey, guarded, harness } from './helpers/guarded.js';

const SMALL = { checkpointEvery: 3, checkpointBytes: 1 << 30 };

// `n` replies each with one hit of 1 on ann; returns the harness and the reply indexes.
function hits(n, options = SMALL) {
    const h = harness([guarded()], options);
    const at = [];
    for (let i = 1; i <= n; i++) {
        at.push(h.send(`Turn ${i}.`, `Reply ${i}.`));
        assert.equal(h.command('gt.hit', { actor: 'ann', amount: 1 }).ok, true);
    }
    return { h, at };
}
const checkpoints = (h, at) => at.filter(i => h.record(i).checkpoint && h.record(i).covers);
const lost = h => h.gt().lost.ann ?? 0;

test('delete between three checkpoints: nothing past the gap is trusted, the replay starts from the checkpoint before it', () => {
    const { h, at } = hits(12);
    const cps = checkpoints(h, at);
    assert.ok(cps.length >= 3, `three checkpoints to put the gap between (${cps.length})`);
    const [first, second] = cps;
    assert.equal(lost(h), 12);
    // Without a gap the newest checkpoint is what a replay starts from.
    const newest = h.record(cps.at(-1)).checkpoint.domains.gt.lost;
    newest.ann += 100;
    h.store.rebuild();
    assert.equal(lost(h), 112, 'a window that holds is trusted');
    newest.ann -= 100;
    // A reply between the first and the second checkpoint is deleted.
    const gap = at.find(i => i > first && i < second);
    assert.ok(gap !== undefined);
    h.chat.splice(gap - 1, 2);
    // The checkpoints after the gap now hold states that are not true; none of them may be used.
    for (const cp of cps.slice(1)) h.record(cp - 2).checkpoint.domains.gt.lost.ann = 777;
    h.store.rebuild();
    assert.equal(lost(h), 11, 'replayed from the first checkpoint through everything after the gap');
    assert.deepEqual(h.problems(), []);
    // A checkpoint with no `covers` (older records) after the gap cannot be told apart, so it is not trusted either.
    const legacy = h.chat.findLast(message => message.extra?.storySuite?.checkpoint && message.extra.storySuite.covers);
    delete legacy.extra.storySuite.covers;
    h.store.rebuild();
    assert.equal(lost(h), 11, 'a checkpoint without covers after a gap is passed over');
    // A new reply writes a checkpoint when one is due; made over the records as they stand, it holds again.
    for (let i = 0; i < 4; i++) {
        h.send();
        h.command('gt.hit', { actor: 'ann', amount: 1 });
    }
    const fresh = h.chat.findLast(message => message.extra?.storySuite?.checkpoint && message.extra.storySuite.covers);
    assert.notEqual(fresh, legacy);
    fresh.extra.storySuite.checkpoint.domains.gt.lost.ann += 1000;
    h.store.rebuild();
    assert.equal(lost(h) >= 1000, true, 'a checkpoint made after the gap is trusted');
});

test('with no checkpoint that holds there is no state to start from; the latest one is not taken on trust', () => {
    const { h, at } = hits(8);
    assert.equal(checkpoints(h, at).length >= 2, true);
    const newest = checkpoints(h, at).at(-1);
    h.record(newest).checkpoint.domains.gt.lost.ann = 999;
    // The first reply (it holds the chat's first checkpoint) is deleted.
    h.chat.splice(0, 1);
    h.store.rebuild();
    assert.equal(h.store.head(), null, 'the old fallback to the latest checkpoint is gone');
    // The chat starts again from the state the deleted replies ended with, as ensureInitial gives it.
    h.store.ensureInitial(h.registry.initialState());
    assert.equal(lost(h), 8 - 0, 'every hit is replayed, none comes from the unchecked checkpoint');
});

test('an old chat\'s checkpoints without covers are trusted as ever until a window fails', () => {
    const { h, at } = hits(9);
    for (const cp of checkpoints(h, at)) delete h.record(cp).covers;
    const newest = [...at].reverse().find(i => h.record(i).checkpoint && i !== 0);
    h.record(newest).checkpoint.domains.gt.lost.ann += 50;
    h.store.rebuild();
    assert.equal(lost(h) >= 50, true);
});

test('a Re-read replays the blocks it keeps as a rebuild does: a remove of a key an old story line added is passed over', async t => {
    const host = await createHost({ modules: [guarded()], core: false });
    t.after(() => host.close());
    await host.send('Go.', `Dawn.\n\n<Changes>\n! offer ${Q1}\n</Changes>`);
    const at = host.ctx.chat.length - 1;
    assert.equal((await host.bus.command('gt.withdraw', { id: Q1 }, { cause: 'ui' })).ok, true);
    assert.deepEqual(host.head().domains.gt.quests, {});
    // The story no longer offers the quest; the reader's click that took it back has nothing to take.
    host.ctx.chat[at].mes = 'Dawn.\n\n<Changes>\n! tick 5\n</Changes>';
    host.ctx.chat[at].swipes[0] = host.ctx.chat[at].mes;
    const result = await host.turn.reread(at);
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(host.head().domains.gt.quests, {});
    assert.equal(host.head().domains.gt.minutes, 5);
    assert.deepEqual(host.store.problems(), []);
});

test('change the clock before a zero-credit attempt: the attempt is planned again with its saved draw, the old one gone', async t => {
    const host = await createHost({ modules: [guarded()], core: false });
    t.after(() => host.close());
    await host.send('Go.', 'Dawn.\n\n<Changes>\n! tick 30\n</Changes>');
    const early = host.ctx.chat.length - 1;
    await host.send('On.', 'Noon.');
    const later = host.ctx.chat.length - 1;
    const first = await host.bus.command('gt.attempt', { id: Q1 }, { cause: 'system' });
    assert.equal(first.ok, true, first.message);
    const gt = () => host.head().domains.gt;
    assert.deepEqual([gt().attempts[Q1], gt().credits[Q1]], [1, 0], 'a paid attempt with no credit still counts');
    const before = host.ctx.chat[later].extra.storySuite;
    const span = before.spans.find(isMetaSpan);
    assert.equal(span.replan.type, 'gt.attempt');
    assert.equal(span.replan.seed, first.receipt.seed);
    const die = span.result.die;
    // A delete between them takes the attempt off (its guard says the clock changed) rather than choosing for it.
    // The reader edits the earlier reply instead, and Re-reads it.
    host.ctx.chat[early].mes = 'Dawn.\n\n<Changes>\n! tick 90\n</Changes>';
    host.ctx.chat[early].swipes[0] = host.ctx.chat[early].mes;
    const result = await host.turn.reread(early);
    assert.equal(result.ok, true, result.message);
    assert.equal(gt().minutes, 90);
    assert.deepEqual([gt().attempts[Q1], gt().credits[Q1]], [1, 1], 'one attempt, now with its credit; the old one is not counted as well');
    const after = host.ctx.chat[later].extra.storySuite;
    const again = after.spans.find(isMetaSpan);
    assert.equal(again.id, span.id, 'the same block');
    assert.deepEqual(again.source, span.source);
    assert.equal(again.result.die, die, 'the saved draw is reused, nothing is rolled again');
    assert.equal(again.result.credit, 1);
    assert.equal(again.guard.predicate.minutes, 90);
    assert.equal(again.recorded.minutes, 90);
    assert.equal(after.ops.filter(op => op.path === `/domains/gt/attempts/${Q1}`).length, 1, 'the old ops are not kept beside the new');
    assert.equal(after.receipts.length, 1);
    assert.equal(after.receipts[0].id, before.receipts[0].id);
    assert.equal(after.receipts[0].seed, before.receipts[0].seed);
    assert.deepEqual(host.store.problems(), []);
    // And back: the attempt becomes a zero-credit one again.
    host.ctx.chat[early].mes = 'Dawn.\n\n<Changes>\n! tick 20\n</Changes>';
    host.ctx.chat[early].swipes[0] = host.ctx.chat[early].mes;
    assert.equal((await host.turn.reread(early)).ok, true);
    assert.deepEqual([gt().attempts[Q1], gt().credits[Q1]], [1, 0]);
    // A rebuild from the saved chat says the same.
    const live = JSON.stringify(host.head());
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(JSON.stringify(host.head()), live);
});

test('a delete of the reply that set the clock plans the attempt again by itself, once, in the same save window', async t => {
    const host = await createHost({ modules: [guarded()], core: false });
    t.after(() => host.close());
    await host.send('Go.', 'Dawn.\n\n<Changes>\n! tick 90\n</Changes>');
    await host.send('On.', 'Noon.');
    const later = host.ctx.chat.length - 1;
    await host.bus.command('gt.attempt', { id: Q1 }, { cause: 'system' });
    const gt = () => host.head().domains.gt;
    assert.deepEqual([gt().attempts[Q1], gt().credits[Q1]], [1, 1]);
    assert.equal(host.store.replansFrom() !== null, true, 'a guarded step with a replan is known');
    const seed = host.ctx.chat[later].extra.storySuite.receipts[0].seed;
    await host.store.flush();
    await host.st.deleteMessage(later - 1);
    await host.st.deleteMessage(later - 2);
    // The guard would say the clock changed; the step was planned again on the clock as it is: a zero-credit attempt.
    assert.deepEqual([gt().attempts[Q1], gt().credits[Q1]], [1, 0]);
    assert.deepEqual(host.store.problems(), []);
    const index = host.ctx.chat.findIndex(message => message.extra?.storySuite?.spans?.some(isMetaSpan));
    assert.equal(host.ctx.chat[index].extra.storySuite.receipts[0].seed, seed, 'with the same seed');
    assert.equal(host.store.dirty(), true, 'written in the same save window');
    const told = host.turn.problems().find(problem => problem.code === 'REPLANNED');
    assert.match(told.message, /1 planned again/);
    // Planned again to what it is: nothing changes and nothing is written.
    const rerun = (state, receipt, info) => host.bus.run(info.replan.type, info.replan.payload, {
        cause: 'system', state, seed: info.replan.seed,
        reply: { index: info.index, sid: host.store.carrierSid(info.index), ordinal: info.span.source.ordinal },
    });
    const bytes = JSON.stringify(host.ctx.chat);
    assert.deepEqual(host.store.reconcile(index, { rerun }), { changed: false, planned: 0, removed: 0 });
    assert.equal(JSON.stringify(host.ctx.chat), bytes);
    assert.deepEqual(host.store.reconcile(index, {}), { changed: false, planned: 0, removed: 0 });
    // Another delete (nothing before the step changed): no new notice and no write.
    const count = host.turn.problems().filter(problem => problem.code === 'REPLANNED').length;
    await host.send('Again.', 'Evening.');
    await host.st.deleteMessage(host.ctx.chat.length - 1);
    await host.st.deleteMessage(host.ctx.chat.length - 1);
    assert.equal(host.turn.problems().filter(problem => problem.code === 'REPLANNED').length, count);
});

test('a chat with no guarded step to plan again is not reconciled at all', async t => {
    const host = await createHost({ modules: [guarded()], core: false });
    t.after(() => host.close());
    await host.send('Go.', 'Dawn.\n\n<Changes>\n! tick 90\n</Changes>');
    await host.bus.command('gt.hit', { actor: 'ann', amount: 1 }, { cause: 'ui' });
    assert.equal(host.store.replansFrom(), null);
    const spy = [];
    const original = host.store.reconcile;
    host.store.reconcile = (...args) => { spy.push(args); return original(...args); };
    await host.send('On.', 'Noon.');
    await host.st.deleteMessage(host.ctx.chat.length - 1);
    await host.st.deleteMessage(host.ctx.chat.length - 1);
    assert.equal(spy.length, 0);
});

test('a read-only story record is not reconciled either', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ modules: [guarded()], core: false });
    t.after(() => host.close());
    await host.send('Go.', 'Dawn.');
    const chat = structuredClone(host.ctx.chat);
    chat[0].extra.storySuite = { v: 3, sid: 'sw_future00001', ops: [], receipts: [], narrated: [] };
    await host.st.loadChat(chat);
    assert.equal(host.store.readOnly().kind, 'future');
    assert.equal(host.store.replansFrom(), null);
});

test('a step that cannot be asked again is kept exactly as it was (its guard decides); only NO_LONGER_DONE takes a block back', () => {
    const h = harness([guarded()]);
    const clock = h.send('u', 'clock');
    h.command('gt.tick', { minutes: 90 });
    const later = h.send('u', 'later');
    h.command('gt.collect', { id: Q1 }, 'system');
    let where = later;
    const record = () => JSON.stringify(h.record(where));
    const stored = record();
    assert.equal(h.gt().coin, 3);
    const unaskable = {
        'the command is gone': () => ({ ok: false, code: 'UNKNOWN_COMMAND', message: 'dormant' }),
        'the owner is held back': () => ({ ok: false, code: 'DEPENDENCY_UNAVAILABLE', message: 'not ready' }),
        'a refusal': () => ({ ok: false, code: 'REFUSED', message: 'no' }),
        'a throw': () => { throw new Error('boom'); },
        'nothing': () => undefined,
    };
    // The clock is still where the step was planned: the guard holds, so the block stays as it is, applied.
    for (const [label, rerun] of Object.entries(unaskable)) {
        assert.equal(h.store.reconcile(clock, { rerun }).changed, false, label);
        assert.equal(record(), stored, `${label}: block, claim, draw and receipt untouched`);
        assert.equal(h.gt().coin, 3, label);
    }
    // The reply that set the clock is deleted: the guard fails, so the block is off, and still untouched.
    h.chat.splice(clock - 1, 2);
    where = later - 2;
    h.store.rebuild();
    const first = h.chat.findIndex(message => message.extra?.storySuite?.ops?.length);
    assert.equal(h.gt().coin, 0);
    for (const [label, rerun] of Object.entries(unaskable)) {
        assert.equal(h.store.reconcile(first, { rerun }).changed, false, label);
        assert.equal(record(), stored, `${label}: untouched`);
        assert.equal(h.gt().coin, 0, `${label}: off`);
        assert.equal(h.store.problems().at(-1).code, 'REPLAY_PREREQUISITE', label);
    }
    // The owner says it is no longer done: the block goes with its claim and receipt.
    const done = h.store.reconcile(first, { rerun: () => ({ ok: false, code: 'NO_LONGER_DONE', message: 'gone' }) });
    assert.deepEqual(done, { changed: true, planned: 0, removed: 1 });
    const after = h.record(first);
    assert.deepEqual([after.ops.length, after.receipts.length, after.spans.filter(isMetaSpan).length], [0, 0, 0]);
    assert.equal(h.store.head().meta.claims[`gt:${EPOCH}:collect:${Q1}`], undefined);
    assert.deepEqual(h.problems(), []);
});

test('a Re-read whose new story leaves a later guarded click without its target keeps it stored and inactive; it wakes when the target is back', async t => {
    const host = await createHost({ modules: [guarded()], core: false });
    t.after(() => host.close());
    await host.send('Go.', `Dawn.\n\n<Changes>\n! offer ${Q1}\n</Changes>`);
    const offer = host.ctx.chat.length - 1;
    await host.send('On.', 'Noon.');
    const click = host.ctx.chat.length - 1;
    assert.equal((await host.bus.command('gt.prove', { id: Q1 }, { cause: 'ui' })).ok, true);
    assert.equal((await host.bus.command('gt.settle', { id: Q1, instance: 1, reward: 6 }, { cause: 'ui' })).ok, true);
    const gt = () => host.head().domains.gt;
    assert.equal(gt().coin, 6);
    const story = host.ctx.chat[offer].mes;
    // The story no longer offers it.
    host.ctx.chat[offer].mes = 'Dawn.\n\n<Changes>\n! tick 5\n</Changes>';
    host.ctx.chat[offer].swipes[0] = host.ctx.chat[offer].mes;
    const gone = await host.turn.reread(offer);
    assert.equal(gone.ok, true, gone.message);
    assert.equal(gt().coin, 0, 'no payout');
    assert.equal(gt().quests[Q1], undefined);
    assert.equal(host.head().meta.claims[claimKey(Q1, 1)], undefined, 'no claim');
    const stored = host.ctx.chat[click].extra.storySuite;
    assert.ok(stored.ops.some(op => op.path === `/meta/claims/${claimKey(Q1, 1)}`), 'the click stays stored');
    assert.equal(host.store.problems().filter(problem => problem.code === 'REPLAY_PREREQUISITE').length, 1);
    // The story offers it again: the click is asked again and holds.
    host.ctx.chat[offer].mes = story;
    host.ctx.chat[offer].swipes[0] = story;
    const back = await host.turn.reread(offer);
    assert.equal(back.ok, true, back.message);
    assert.equal(gt().coin, 6);
    assert.equal(gt().quests[Q1].state, 'done');
    assert.deepEqual(host.store.problems(), []);
});

test('a replacement system step claims once: the old ops and claim are removed as the new ones go in, or all go together', async t => {
    const host = await createHost({ modules: [guarded()], core: false });
    t.after(() => host.close());
    await host.send('Go.', 'Dawn.\n\n<Changes>\n! tick 30\n</Changes>');
    const early = host.ctx.chat.length - 1;
    await host.send('On.', 'Noon.');
    const later = host.ctx.chat.length - 1;
    const key = `gt:${EPOCH}:collect:${Q1}`;
    assert.equal((await host.bus.command('gt.collect', { id: Q1 }, { cause: 'system' })).ok, true);
    const gt = () => host.head().domains.gt;
    const claimOps = () => host.ctx.chat[later].extra.storySuite.ops.filter(op => op.path === `/meta/claims/${key}`);
    assert.equal(gt().coin, 3);
    assert.equal(claimOps().length, 1);
    const set = async minutes => {
        host.ctx.chat[early].mes = `Dawn.\n\n<Changes>\n! tick ${minutes}\n</Changes>`;
        host.ctx.chat[early].swipes[0] = host.ctx.chat[early].mes;
        return host.turn.reread(early);
    };
    // The clock moves, the step is planned again: paid once, claimed once, one block.
    assert.equal((await set(45)).ok, true);
    assert.equal(gt().coin, 3, 'not 6');
    assert.deepEqual(Object.keys(host.head().meta.claims).filter(each => each === key), [key]);
    assert.equal(claimOps().length, 1);
    const record = host.ctx.chat[later].extra.storySuite;
    assert.equal(record.spans.filter(isMetaSpan).length, 1);
    assert.deepEqual(record.spans.find(isMetaSpan).claims, [key]);
    assert.equal(record.receipts.length, 1);
    assert.equal(record.spans.find(isMetaSpan).guard.predicate.minutes, 45);
    // The clock is too early for the step now: it is not done any more, and its payout, claim and receipt all go.
    assert.equal((await set(5)).ok, true);
    assert.equal(gt().coin, 0);
    assert.equal(host.head().meta.claims[key], undefined);
    const emptied = host.ctx.chat[later].extra.storySuite;
    assert.equal(emptied.spans.filter(isMetaSpan).length, 0);
    assert.equal(emptied.ops.length, 0);
    assert.deepEqual(emptied.receipts, []);
    assert.deepEqual(host.store.problems(), []);
});

test('full recovery never heals by a negative change: a reset is absolute, so the reply it undid may be deleted', () => {
    const h = harness([guarded()]);
    h.send();
    h.command('gt.hit', { actor: 'ann', amount: 10 });
    const first = h.chat.length - 1;
    h.send();
    h.command('gt.hit', { actor: 'ann', amount: 4 });
    h.send();
    assert.equal(h.command('gt.reset', { actor: 'ann' }).ok, true);
    const reset = h.store.opsAt(h.chat.length - 1).find(op => op.path === '/domains/gt/lost/ann');
    assert.deepEqual(reset, { op: 'replace', path: '/domains/gt/lost/ann', value: 0 }, 'written as a set: no `was`');
    assert.equal(lost(h), 0);
    // The reply with the first hit is deleted before the reset: lost 14 became 4, and the reset still sets 0.
    h.chat.splice(first - 1, 2);
    h.store.rebuild();
    assert.equal(lost(h), 0, 'not -10');
    assert.deepEqual(h.problems(), []);
    // The same reset written as a change (what ctx.absolute is there to prevent) would have gone to -10: the
    // domain refuses that block, so the state is never below zero either way.
    const plain = harness([guarded()]);
    plain.send();
    plain.command('gt.hit', { actor: 'ann', amount: 10 });
    const hit = plain.chat.length - 1;
    plain.send();
    plain.command('gt.hit', { actor: 'ann', amount: 4 });
    plain.send();
    plain.command('gt.recoverDelta', { actor: 'ann' });
    const delta = plain.store.opsAt(plain.chat.length - 1).find(op => op.path === '/domains/gt/lost/ann');
    assert.equal(delta.was, 14, 'a change remembers what it replaced');
    plain.chat.splice(hit - 1, 2);
    plain.store.rebuild();
    assert.equal(plain.problems().length, 1);
    assert.equal(plain.gt().lost.ann, 4, 'refused whole, not applied as -10');
});

test('a guarded recovery whose hit is deleted stays off; it does not heal anything', () => {
    const h = harness([guarded()]);
    h.send();
    h.command('gt.hit', { actor: 'ann', amount: 10 });
    const hit = h.chat.length - 1;
    h.send();
    assert.equal(h.command('gt.recover', { actor: 'ann' }).ok, true);
    assert.equal(lost(h), 0);
    h.chat.splice(hit - 1, 2);
    h.store.rebuild();
    assert.equal(lost(h), 0);
    assert.equal(h.gt().lost.ann, undefined, 'no -10 and no phantom 0 either');
    assert.equal(h.problems().length, 1);
    assert.equal(h.problems()[0].code, 'REPLAY_PREREQUISITE');
});

test('an absolute reset of a count written as removing it sets it too (ctx.absolute on a stack-like count)', () => {
    // A count whose path is declared a counter and that is removed outright when reset keeps no `was` either.
    const resetter = {
        id: 'zz-reset', name: 'Reset', version: '0.0.1',
        domains: { pile: { initial: () => ({ stacks: {} }), counters: ['stacks/*/qty'] } },
        commands: {
            'pile.add'(ctx, { key, qty }) {
                const pile = ctx.draft('pile');
                pile.stacks[key] = { qty: (pile.stacks[key]?.qty ?? 0) + qty };
                return { summary: 'added', narrate: false };
            },
            'pile.clear'(ctx, { key }) {
                ctx.absolute('pile', `/stacks/${key}/qty`);
                delete ctx.draft('pile').stacks[key];
                return { summary: 'cleared', narrate: false };
            },
        },
    };
    const h = harness([resetter]);
    h.send();
    h.command('pile.add', { key: 'rope', qty: 3 });
    h.send();
    h.command('pile.add', { key: 'rope', qty: 2 });
    h.send();
    assert.equal(h.command('pile.clear', { key: 'rope' }).ok, true);
    const remove = h.store.opsAt(h.chat.length - 1).find(op => op.op === 'remove');
    assert.deepEqual(remove, { op: 'remove', path: '/domains/pile/stacks/rope' }, 'no `was`, no `count`');
    assert.deepEqual(h.store.head().domains.pile.stacks, {});
});
