// The catch-up callbacks of a timeline participant (progress, skip, rebuild: timeline/participants.js) and the host's use of them: a rebuild
// that answers at once and reads on, the settled journal after it, the progress the banner reads, Skip, and the banner's catch-up states
// (screens/rebuild-banner.js, mockup sections B and D).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { nativeModule, rulesModule, clone, NATIVE } from './helpers/timeline.js';
import { createParticipants } from '../../src/v2/timeline/participants.js';
import { createRebuildBannerWidget, REBUILD_TEXT } from '../../src/v2/screens/rebuild-banner.js';
import { setupDom } from './view/mounts/helpers.js';

const spec = extra => ({ module: 'npc-state-delta', schema: 1, checkpoint() {}, prepare() {}, activate() {}, abort() {}, status() {}, ...extra });
const idle = { active: false, done: 0, total: 0, older: 0, from: null, reason: '' };

test('register keeps rebuild, progress and skip, and refuses one that is not a function', () => {
    const table = createParticipants();
    assert.equal(table.register(spec({ rebuild() {}, progress() {}, skip() {} })).ok, true);
    const kept = table.get('npc-state-delta');
    for (const name of ['rebuild', 'progress', 'skip']) assert.equal(typeof kept[name], 'function', name);
    for (const name of ['rebuild', 'progress', 'skip']) {
        const bad = createParticipants().register(spec({ [name]: 'no' }));
        assert.equal(bad.code, 'INVALID', name);
        assert.match(bad.message, new RegExp(name));
    }
    assert.equal(createParticipants().register(spec({})).ok, true, 'all three stay optional');
});

test('progress is read at once: a bare status is kept whole, anything else is nothing', () => {
    const answers = [
        { ...idle, active: true, done: 2, total: 12, older: 20, from: 17, reason: 'fallback', outcome: null },
        Promise.resolve(idle), 'x', null, { done: 1 }, { ...idle, done: -3, total: 'many', from: 'x', outcome: 7 },
    ];
    let next = 0;
    const table = createParticipants();
    table.register(spec({ progress: () => answers[next] }));
    const read = index => { next = index; return table.progress('npc-state-delta'); };
    assert.deepEqual(read(0), { module: 'npc-state-delta', active: true, done: 2, total: 12, older: 20, from: 17, reason: 'fallback', outcome: null, message: '' });
    for (const index of [1, 2, 3, 4]) assert.equal(read(index), null, `answer ${index}`);
    assert.deepEqual(read(5), { module: 'npc-state-delta', active: false, done: 0, total: 0, older: 0, from: null, reason: '', outcome: null, message: '' });
    const throwing = createParticipants();
    throwing.register(spec({ progress: () => { throw new Error('boom'); } }));
    assert.equal(throwing.progress('npc-state-delta'), null);
    assert.equal(createParticipants().progress('nobody'), null);
    const none = createParticipants();
    none.register(spec({}));
    assert.equal(none.progress('npc-state-delta'), null, 'no progress callback');
});

test('skip answers while a rebuild is still in flight, and a failure comes back as the common envelope', async () => {
    const table = createParticipants();
    let release;
    table.register(spec({
        rebuild: () => new Promise(resolve => { release = resolve; }),
        skip: async () => ({ ok: true, active: true }),
    }));
    const running = table.call('npc-state-delta', 'rebuild', { replies: 40 });
    await Promise.resolve();
    assert.deepEqual(await table.skip('npc-state-delta'), { ok: true }, 'not queued behind the rebuild call');
    release({ ok: true, started: true });
    assert.equal((await running).started, true);
    const failing = createParticipants();
    failing.register(spec({ skip: async () => ({ ok: false, code: 'REFUSED', message: 'no' }) }));
    assert.deepEqual(await failing.skip('npc-state-delta'), { ok: false, code: 'REFUSED', message: 'no' });
    const throwing = createParticipants();
    throwing.register(spec({ skip: () => { throw new Error('boom'); } }));
    assert.equal((await throwing.skip('npc-state-delta')).code, 'FAILED');
    assert.equal((await createParticipants().skip('nobody')).code, 'UNSUPPORTED');
});

// A chat blocked for good: every native checkpoint is gone and the reply they stood on was deleted.
async function blockedHost(t, { rebuild, progress, skip }) {
    const native = nativeModule();
    Object.assign(native.def.participant, { rebuild, progress, skip });
    const host = await createHost({ modules: [rulesModule(), native.def] });
    t.after(() => host.close());
    await host.send('Begin.', 'Start.');
    await host.sdk.timeline.make({ kind: 'manual' });
    await host.send('Next.', 'Before death.');
    const head = await host.sdk.timeline.head();
    await native.native.handle.nativeMutation({ participant: NATIVE, source: head.source, expectedHead: head.headHash, prepare: async () => {
        const before = native.native.checkpoint();
        const next = clone(native.native.store);
        next.dossiers.tavi.trust = 9;
        const after = native.native.keep(next);
        native.native.prepared.pr_mutation = { checkpoint: after.checkpoint };
        return { before: { module: NATIVE, ...before, schema: 1 }, after: { module: NATIVE, ...after, schema: 1 }, prepared: 'pr_mutation' };
    } });
    await host.send('Die.', 'Death.');
    for (const id of Object.keys(native.native.checkpoints)) native.native.missing.add(id);
    await host.st.deleteMessage(4);
    return { host, native: native.native };
}

test('a rebuild that reads on: the journal settles, the new publication is accepted, progress and Skip go through the host', async t => {
    const seen = [];
    let state = { ...idle };
    const calls = { skip: 0 };
    const { host, native } = await blockedHost(t, {
        rebuild: input => { seen.push(input); state = { ...idle, active: true, total: 40, older: 0, reason: 'rebuild' }; return { ok: true, started: true }; },
        progress: () => state,
        skip: () => { calls.skip += 1; state = { ...state, active: false, outcome: 'skipped' }; return { ok: true }; },
    });
    assert.equal(host.timeline.blocked().blockedBy.code, 'SNAPSHOT_UNAVAILABLE');
    assert.equal(host.timeline.host.progress(), null, 'idle and no outcome: nothing to show');
    const done = await host.timeline.host.rebuild(NATIVE, { read: 'last-40' });
    assert.equal(done.ok, true, done.message);
    assert.equal(done.started, true);
    assert.equal(seen[0].replies, 40);
    assert.equal(host.timeline.blocked(), null);
    assert.equal(host.timeline.pending(), false, 'the rebuilt selection is settled, not outstanding');
    assert.equal(host.timeline.needsRecovery(), false);
    assert.equal(host.registry.restore().state, 'idle');
    assert.deepEqual(host.timeline.host.progress(), { module: NATIVE, active: true, done: 0, total: 40, older: 0, from: null, reason: 'rebuild', outcome: null, message: '' });
    // the participant installs and publishes at the end: one native change, accepted
    const head = await host.sdk.timeline.head();
    const published = await native.handle.nativeMutation({ participant: NATIVE, source: head.source, expectedHead: head.headHash, prepare: async () => {
        const before = native.checkpoint();
        const next = clone(native.store);
        next.dossiers.tavi.trust = 5;
        const after = native.keep(next);
        native.prepared.pr_after = { checkpoint: after.checkpoint };
        return { before: { module: NATIVE, ...before, schema: 1 }, after: { module: NATIVE, ...after, schema: 1 }, prepared: 'pr_after' };
    } });
    assert.equal(published.ok, true, published.message);
    assert.equal(host.timeline.pending(), false);
    assert.equal(host.timeline.blocked(), null);
    assert.deepEqual(await host.timeline.host.skip(NATIVE), { ok: true });
    assert.equal(calls.skip, 1);
    assert.equal(host.timeline.host.progress().outcome, 'skipped');
    const again = await host.timeline.host.rebuild(NATIVE, { read: 'all' });
    assert.equal(again.ok, false, 'no longer blocked: nothing to rebuild');
});

test('the whole-chat choice reaches the participant as replies: null', async t => {
    const seen = [];
    const { host } = await blockedHost(t, { rebuild: input => { seen.push(input); return { ok: true, started: false }; }, progress: () => idle, skip: () => ({ ok: true }) });
    const done = await host.timeline.host.rebuild(NATIVE, { read: 'all' });
    assert.equal(done.ok, true, done.message);
    assert.equal(done.started, false);
    assert.equal(seen[0].replies, null);
    assert.equal(seen[0].read, 'all');
});

// ---- the banner ----

const text = node => node.textContent.replace(/\s+/g, ' ').trim();
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function mount(options) {
    const doc = setupDom();
    const host = doc.createElement('div');
    doc.body.append(host);
    const polls = [];
    const every = (fn, ms) => { const poll = { fn, ms, stopped: false }; polls.push(poll); return () => { poll.stopped = true; }; };
    const widget = createRebuildBannerWidget({ every, ...options });
    const handle = widget.render(host, {}, {});
    return { host, handle, polls };
}
const reading = (extra = {}) => ({ module: NATIVE, active: true, done: 2, total: 12, older: 0, from: 17, reason: 'fallback', outcome: null, message: '', ...extra });

test('catch-up banner: title, restored-to reply, bold progress, the muted line and Skip; polled only while it reads', async () => {
    let info = reading();
    const { host, polls, handle } = mount({ catchUp: () => info, replyOf: index => index + 1 });
    await tick();
    const banner = host.querySelector('.rebuild-catching');
    assert.ok(banner.querySelector('.spin'));
    assert.equal(text(banner.querySelector('.rebuild-title')), 'Dossiers are catching up');
    assert.equal(text(banner.querySelector('.rebuild-body')), 'They were restored to reply 18. Reading the replies since then: reply 3 of 12.');
    assert.equal(text(banner.querySelector('.rebuild-body b')), 'reply 3 of 12');
    assert.equal(text(banner.querySelector('.rebuild-muted')), 'Sending waits until this finishes. About one model call per reply.');
    assert.equal(text(banner.querySelector('.rebuild-skip')), 'Skip');
    assert.equal(polls.length, 1);
    info = reading({ done: 3 });
    polls[0].fn();
    await tick();
    assert.equal(text(host.querySelector('.rebuild-body b')), 'reply 4 of 12');
    info = { ...info, active: false, outcome: 'done' };
    polls[0].fn();
    await tick();
    assert.equal(polls[0].stopped, true, 'the poll ends with the reading');
    handle.destroy();
});

test('Skip asks first: Keep reading comes first and changes nothing; Skip calls skip(module) with the range from the numbers', async () => {
    const skipped = [];
    const { host } = mount({ catchUp: () => reading({ done: 2, total: 12, from: 17 }), skip: async module => { skipped.push(module); return { ok: true }; }, replyOf: index => index + 1 });
    await tick();
    host.querySelector('.rebuild-skip').click();
    await tick();
    const dialog = host.querySelector('.rebuild-skip-dialog');
    assert.equal(text(dialog.querySelector('h4')), 'Skip the catch-up?');
    assert.equal(text(dialog.querySelector('p')), "The dossiers stay as they were at reply 18. Replies 19 to 30 are marked as read and won't be read for the dossiers. Your story and Story Block are not changed.");
    const buttons = [...dialog.querySelectorAll('button')];
    assert.deepEqual(buttons.map(text), ['Keep reading', 'Skip']);
    buttons[0].click();
    await tick();
    assert.deepEqual(skipped, []);
    assert.ok(host.querySelector('.rebuild-catching'), 'back to the banner');
    host.querySelector('.rebuild-skip').click();
    await tick();
    host.querySelector('.rebuild-skip-confirm').click();
    await tick();
    assert.deepEqual(skipped, [NATIVE]);
});

test('a long gap says so: the last 40 of 60, and the 20 older replies are marked as read; Skip counts all 60', async () => {
    const { host } = mount({ catchUp: () => reading({ done: 26, total: 40, older: 20, from: 17 }), replyOf: index => index + 1 });
    await tick();
    assert.equal(text(host.querySelector('.rebuild-body')), 'Reading the last 40 of 60 missed replies: reply 27 of 40.');
    assert.equal(text(host.querySelector('.rebuild-muted')), 'The 20 older replies are marked as read.');
    host.querySelector('.rebuild-skip').click();
    await tick();
    assert.match(text(host.querySelector('.rebuild-skip-dialog p')), /Replies 19 to 78 are marked as read/);
});

test('the notes: done (N replies read), stopped (the chat changed), stopped otherwise, a skip says it was skipped; each can be dismissed', async () => {
    // a view that never saw the catch-up reading shows no note for it
    const ended = { ...reading({ total: 40 }), active: false, outcome: 'done' };
    assert.equal(mount({ catchUp: () => ended }).host.children.length, 0);
    // a view that watches it end
    async function watch(outcome, total = 40) {
        let live = reading({ total });
        const view = mount({ catchUp: () => live });
        await tick();
        live = { ...live, active: false, outcome };
        view.polls[0].fn();
        await tick();
        return view;
    }
    const finished = await watch('done');
    assert.equal(text(finished.host.querySelector('.rebuild-note-text')), '✓ Dossiers caught up (40 replies read). Sending is back on.');
    assert.equal(finished.host.querySelector('.rebuild-banner'), null, 'the banner is gone');
    finished.host.querySelector('.rebuild-dismiss').click();
    await tick();
    assert.equal(finished.host.children.length, 0);
    const stale = await watch('stale');
    assert.equal(text(stale.host.querySelector('.rebuild-note-text')), 'ⓘ The catch-up stopped (the chat changed). Your dossiers are as they were before it; it will try again when you open this chat.');
    assert.equal(text((await watch('failed')).host.querySelector('.rebuild-note-text')), REBUILD_TEXT.stoppedOther);
    assert.equal(text((await watch('skipped')).host.querySelector('.rebuild-note-text')), '✓ Catch-up skipped. The dossiers stay as they were restored.');
});

test('a rebuild that reads on shows the working banner with the real count, then the done note; no Skip', async () => {
    let info = { ...reading({ reason: 'rebuild', total: 40, done: 11, from: null }), active: false };
    let finish;
    const { host, polls } = mount({
        blocked: () => ({ reason: 'missing', code: 'SNAPSHOT_UNAVAILABLE', blockedBy: { module: NATIVE, code: 'SNAPSHOT_UNAVAILABLE' } }),
        catchUp: () => info,
        rebuild: () => new Promise(resolve => { finish = resolve; }),
    });
    await tick();
    host.querySelector('.rebuild-start').click();
    host.querySelector('.rebuild-confirm').click();
    await tick();
    info = { ...info, active: true };
    finish({ ok: true, started: true });
    await tick();
    const working = host.querySelector('.rebuild-working');
    assert.ok(working);
    assert.equal(text(host.querySelector('.rebuild-title')), REBUILD_TEXT.workingTitle);
    assert.equal(text(host.querySelector('.rebuild-progress')), 'Reading reply 12 of 40. Replies resume when it finishes.');
    assert.equal(host.querySelector('.rebuild-skip'), null);
    assert.equal(polls.length, 1);
    info = { ...info, active: false, done: 40, outcome: 'done' };
    polls[0].fn();
    await tick();
    assert.equal(text(host.querySelector('.rebuild-note-text')), REBUILD_TEXT.doneLast);
});

test('a rebuild whose participant has no progress ends with the plain done note', async () => {
    let finish;
    const { host } = mount({
        blocked: () => ({ reason: 'missing', code: 'SNAPSHOT_UNAVAILABLE', blockedBy: { module: NATIVE, code: 'SNAPSHOT_UNAVAILABLE' } }),
        rebuild: () => new Promise(resolve => { finish = resolve; }),
    });
    await tick();
    host.querySelector('.rebuild-start').click();
    host.querySelector('.rebuild-confirm').click();
    await tick();
    finish({ ok: true, started: true });
    await tick();
    assert.equal(text(host.querySelector('.rebuild-note-text')), REBUILD_TEXT.doneLast);
});
