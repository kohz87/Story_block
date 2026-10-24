// The second review of the replay core (docs/v2/REPLAY.md): checkpoints that carry guarded blocks hold only under the
// owners they were made with, one classifier for guarded blocks, guarded validators that fail closed, boundaries that follow
// what a reconcile stages, records that are not ours never written over, an archive of deleted ids, revs that stay in
// order across replies, and one head per delete.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { isMetaSpan } from '../../src/v2/replay.js';
import { Q1, Q2, guarded, harness } from './helpers/guarded.js';

const SMALL = { checkpointEvery: 3, checkpointBytes: 1 << 30 };
const clone = value => JSON.parse(JSON.stringify(value));
const questId = n => `th_${n.toString(36).padStart(8, '0')}`;

// Nine replies, each with a guarded one-command quest (a coin each), checkpoints every three replies.
function paid(options = SMALL, modules = [guarded()]) {
    const h = harness(modules, options);
    for (let n = 1; n <= 9; n++) {
        h.send(`u${n}`, `r${n}`);
        assert.equal(h.command('gt.quick', { id: questId(n) }).ok, true);
    }
    return h;
}
const reopen = (h, modules, options = SMALL) => {
    const other = harness(modules, options);
    other.chat.splice(0, other.chat.length, ...clone(h.chat));
    other.store.rebuild();
    return other;
};

test('a checkpoint over guarded blocks holds only under the owners it was made with: an absent owner is asked, not skipped', () => {
    const h = paid();
    assert.equal(h.gt().coin, 9);
    const newest = h.chat.findLast(message => message.extra?.storySuite?.checkpoint && message.extra.storySuite.covers).extra.storySuite;
    assert.equal(typeof newest.guardEnv, 'string', 'the checkpoint remembers the owners');
    // Same owners: the checkpoint is trusted (a replay starts from it).
    assert.equal(reopen(h, [guarded()]).gt().coin, 9);
    // The owner is not there (no hook): every covered payout is asked and stays off, whatever a checkpoint says.
    const g = guarded();
    const absent = reopen(h, [{ ...g, hooks: {} }]);
    assert.equal(absent.gt().coin, 0);
    assert.ok(absent.problems().length >= 9);
    assert.ok(absent.problems().every(problem => problem.code === 'REPLAY_PREREQUISITE'));
    // A new version of the owner (its guard may answer otherwise): asked again, and it throws, so nothing is paid.
    const throwing = guarded({ mode: { value: 'throw' } });
    assert.equal(reopen(h, [{ ...throwing, version: '0.0.2' }]).gt().coin, 0);
    // Back to the first owners: paid again, once.
    assert.equal(reopen(h, [guarded()]).gt().coin, 9);
});

test('a readiness change drops the checkpoints made under other owners, finds guarded blocks before the checkpoint, then the head is read', () => {
    const h = paid();
    assert.equal(h.gt().coin, 9);
    h.registry.setEnabled('zz-guarded', false, 'off for the test');
    assert.equal(h.store.lifecycleChanged(), true, 'guarded blocks are found even though a checkpoint hides them from a replay');
    assert.equal(h.gt().coin, 0);
    h.registry.setEnabled('zz-guarded', true);
    assert.equal(h.store.lifecycleChanged(), true);
    assert.equal(h.gt().coin, 9, 'asked again, once');
    assert.deepEqual(h.problems(), []);
    // A chat with no guarded block has nothing to find.
    const plain = harness([guarded()], SMALL);
    plain.send();
    plain.command('gt.hit', { actor: 'ac_00000001', amount: 1 });
    assert.equal(plain.store.lifecycleChanged(), false);
});

test('a module cannot make a block guarded by what it puts in its own data.v2; the host marks it, and a stripped span is damaged for every path', async t => {
    const own = {
        id: 'zz-own', name: 'Own', version: '0.0.1',
        domains: { own: { initial: () => ({ n: 0 }) } },
        commands: {
            'own.bump'(ctx) {
                ctx.draft('own').n += 1;
                return { summary: 'bumped', narrate: false, data: { v2: { source: { sid: 'sr_aaaaaaaa' }, guard: { owner: 'zz-own' } } } };
            },
        },
    };
    const h = harness([own]);
    h.send();
    assert.equal(h.command('own.bump').ok, true);
    const record = h.record(h.chat.length - 1);
    assert.equal(record.receipts[0].guarded, undefined, 'the host did not mark it');
    h.store.rebuild();
    assert.equal(h.store.head().domains.own.n, 1, 'a legacy block, applied as ever');
    assert.deepEqual(h.problems(), []);
    // A guarded block's receipt carries the host's mark.
    const g = harness([guarded()]);
    g.send();
    g.command('gt.quick', { id: Q1 });
    const rc = g.record(g.chat.length - 1).receipts[0];
    assert.equal(rc.guarded, true);
    // Strip its span: the Re-read path does not take it for a legacy block, nor does replay.
    const host = await createHost({ modules: [guarded()], core: false });
    t.after(() => host.close());
    await host.send('Go.', 'Dawn.');
    await host.bus.command('gt.quick', { id: Q1 }, { cause: 'ui' });
    const at = host.ctx.chat.length - 1;
    const stripped = host.ctx.chat[at].extra.storySuite;
    stripped.spans = stripped.spans.map(span => ({ n: span.n, story: span.story }));
    host.store.rebuild();
    assert.equal(host.head().domains.gt.coin, 0, 'replay: off');
    assert.equal(host.store.problems().at(-1).code, 'REPLAY_PREREQUISITE');
    const reread = await host.turn.reread(at);
    assert.equal(reread.ok, true, reread.message);
    assert.equal(host.head().domains.gt.coin, 0, 'Re-read: still off, not healed into a legacy block');
    assert.deepEqual(host.ctx.chat[at].extra.storySuite.spans.filter(span => span.n).map(span => Object.keys(span).sort().join()), ['n,story']);
});

test('a guarded block must leave every domain it touches valid outright: an error that was already there is not forgiven', () => {
    const fresh = harness([guarded()], SMALL);
    fresh.send('u', 'r');
    assert.equal(fresh.command('gt.quick', { id: Q2 }).ok, true);
    assert.equal(fresh.gt().coin, 1);
    // The same stored block over a state whose coin is already below zero (what a legacy replay tolerates).
    const broken = harness([guarded()], SMALL);
    broken.chat.splice(0, broken.chat.length, ...clone(fresh.chat));
    broken.chat[0].extra.storySuite.checkpoint.domains.gt.coin = -10;
    broken.store.rebuild();
    assert.equal(broken.gt().coin, -10, 'the payout did not make it -9');
    assert.ok(broken.problems().some(problem => problem.code === 'REPLAY_PREREQUISITE' && /leave the story invalid/.test(problem.why)));
    assert.equal(broken.store.head().meta.claims[`gt:ep_00000001:quest:${Q2}:1:settled`], undefined, 'and its claim is not held');
});

test('boundaries of steps planned again follow what a reconcile stages: no stale prefix hash on a later step', async t => {
    const host = await createHost({ modules: [guarded()], core: false });
    t.after(() => host.close());
    await host.send('Go.', 'Dawn.\n\n<Changes>\n! tick 90\n</Changes>');
    await host.send('On.', 'Noon.');
    await host.bus.command('gt.attempt', { id: Q1 }, { cause: 'system' });
    await host.send('Later.', 'Evening.');
    await host.bus.command('gt.attempt', { id: Q2 }, { cause: 'system' });
    assert.deepEqual(host.store.boundaryProblems(), []);
    // The reply that set the clock is deleted: both steps are planned again (the second after the first).
    await host.st.deleteMessage(1);
    await host.st.deleteMessage(1);
    assert.deepEqual(host.head().domains.gt.credits, { [Q1]: 0, [Q2]: 0 });
    assert.deepEqual(host.store.boundaryProblems(), [], 'every recorded prefix hash is what the chat now gives');
});

test('revs stay in order across replies after a step is planned again', async t => {
    const host = await createHost({ modules: [guarded()], core: false });
    t.after(() => host.close());
    await host.send('Go.', 'Dawn.\n\n<Changes>\n! tick 30\n</Changes>');
    const first = host.ctx.chat.length - 1;
    await host.send('On.', 'Noon.');
    await host.bus.command('gt.attempt', { id: Q1 }, { cause: 'system' });
    await host.send('Later.', 'Evening.');
    await host.bus.command('gt.hit', { actor: 'ac_00000001', amount: 1 }, { cause: 'ui' });
    await host.bus.command('gt.hit', { actor: 'ac_00000001', amount: 1 }, { cause: 'ui' });
    // Three lines instead of one before the step: it is planned again at a higher rev than the replies after it hold.
    host.ctx.chat[first].mes = 'Dawn.\n\n<Changes>\n! tick 30\n! tick 31\n! tick 32\n</Changes>';
    host.ctx.chat[first].swipes[0] = host.ctx.chat[first].mes;
    const done = await host.turn.reread(first);
    assert.equal(done.ok, true, done.message);
    const revs = [];
    for (const message of host.ctx.chat) for (const op of message.extra?.storySuite?.ops ?? []) if (op.path === '/meta/rev') revs.push(op.value);
    assert.deepEqual(revs, [...revs].sort((a, b) => a - b));
    assert.equal(new Set(revs).size, revs.length, 'no two receipts share a rev');
    const receiptRevs = host.ctx.chat.flatMap(message => (message.extra?.storySuite?.receipts ?? []).map(receipt => receipt.rev));
    assert.equal(new Set(receiptRevs).size, receiptRevs.length);
    assert.equal(host.head().meta.rev, revs.at(-1));
    const live = JSON.stringify(host.head());
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(JSON.stringify(host.head()), live);
});

test('a record that is not ours is never written over: not a damaged later reply, not an older one, not a newer one', () => {
    const h = harness([guarded()]);
    h.send();
    h.command('gt.hit', { actor: 'ac_00000001', amount: 1 });
    for (const [label, record] of [
        ['damaged', { v: 2, sid: 'sw_damaged0001', ops: 'x', receipts: [], narrated: [] }],
        ['older', { v: 1, state: { gold: 5 } }],
        ['newer', { v: 3, sid: 'sw_future00001', ops: [], receipts: [], narrated: [] }],
    ]) {
        const at = h.send(`u-${label}`, `r-${label}`);
        h.chat[at].extra.storySuite = structuredClone(record);
        const before = JSON.stringify(h.chat[at].extra);
        const result = h.command('gt.hit', { actor: 'ac_00000001', amount: 1 });
        assert.equal(result.ok, false, label);
        assert.match(result.message, /kept as it is and not written over/, label);
        assert.throws(() => h.store.setNarrated(at, []), /not written over/, label);
        assert.equal(JSON.stringify(h.chat[at].extra), before, `${label}: the record is as it was`);
        delete h.chat[at].extra.storySuite;
        assert.equal(h.command('gt.hit', { actor: 'ac_00000001', amount: 1 }).ok, true, `${label}: absent is writable`);
    }
});

test('deleted source ids are archived in the chat metadata: kept through a rebuild and a reload, never handed out again', () => {
    const metadata = {};
    const h = harness([guarded()], { metadata: () => metadata });
    const at = [];
    for (let n = 1; n <= 3; n++) {
        at.push(h.send(`u${n}`, `r${n}`));
        h.command('gt.hit', { actor: 'ac_00000001', amount: 1 });
    }
    const gone = h.record(at[1]).source;
    const kept = h.record(at[2]).source;
    h.store.rebuild();
    assert.deepEqual(h.store.archiveList(), []);
    h.chat.splice(at[1] - 1, 2);
    h.store.rebuild();
    for (const id of [gone.logical, gone.swipeKey, gone.evidence]) {
        assert.equal(h.store.archived(id), true, id);
        assert.ok(metadata.storySuite.sourceArchive.deleted.includes(id), `${id} is in the chat metadata`);
    }
    for (const id of [kept.logical, kept.swipeKey, kept.evidence]) assert.equal(h.store.archived(id), false, id);
    // (it is in the metadata SillyTavern saves with the chat after the delete; it is no change to save on its own)
    // A reload: another store over the saved chat and metadata still has them.
    const saved = clone(h.chat);
    const reloaded = harness([guarded()], { metadata: () => metadata });
    reloaded.chat.splice(0, reloaded.chat.length, ...saved);
    reloaded.store.rebuild();
    assert.equal(reloaded.store.archived(gone.swipeKey), true);
    // A record written now is never given one of them (its derivation steps past an archived id).
    const next = reloaded.send('u4', 'r4');
    reloaded.command('gt.hit', { actor: 'ac_00000001', amount: 1 });
    const fresh = reloaded.record(next).source;
    assert.equal(reloaded.store.archived(fresh.swipeKey), false);
    // Deleting a swipe archives its own keys, not the message's canonical sid.
    assert.equal(reloaded.store.archived(fresh.logical), false);
    const stored = JSON.stringify(metadata);
    assert.doesNotMatch(stored, new RegExp(kept.swipeKey));
});

test('one head is published for a delete, after the steps that follow it were planned again', async t => {
    const host = await createHost({ modules: [guarded()], core: false });
    t.after(() => host.close());
    await host.send('Go.', 'Dawn.\n\n<Changes>\n! tick 90\n</Changes>');
    await host.send('On.', 'Noon.');
    await host.bus.command('gt.attempt', { id: Q1 }, { cause: 'system' });
    assert.equal(host.head().domains.gt.credits[Q1], 1);
    const seen = [];
    host.sdk.on('head', () => seen.push(host.head().domains.gt.credits[Q1]));
    await host.st.deleteMessage(2);          // the reply that set the clock
    assert.deepEqual(seen, [0], 'one head, already reconciled (never an intermediate one with the attempt off or paid on a stale clock)');
    await host.st.deleteMessage(1);          // its user message
    assert.deepEqual(seen, [0, 0]);
    assert.deepEqual(host.store.problems(), []);
});

test('a stripped step keeps its fate through a reload, and guarded blocks stay in a chat of plain commands (the span test helper)', () => {
    const h = paid();
    for (const span of h.chat.flatMap(message => message.extra?.storySuite?.spans ?? [])) if (isMetaSpan(span)) assert.equal(span.operation.type, 'gt.quick');
});
