// A native mutation journaled when the page closed, whose participant has no record of it on the next start (its own record of the
// preparation is gone): recovery lets the change go, the barrier comes down, the reader is told in one line, and the story goes on. A
// native event (a confirmed death) is never let go that way: it stays held as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { crash } from '../../src/v2/timeline/index.js';
import { NATIVE, NPC, clone, nativeModule, reload, rulesModule, track } from './helpers/timeline.js';

const LINE = /^A change Test native was making when the page closed could not be finished; the story goes on from its current state\.$/;

async function closedAfterJournal(t, run) {
    const native = nativeModule();
    const state = { disk: null, image: null };
    const hook = { at: async at => { if (at === 'native.journaled' && !state.image) { state.image = clone(state.disk.image); throw crash(); } } };
    const host = await createHost({ modules: [rulesModule(), native.def], timelineFaults: hook });
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    state.disk = track(host);
    await assert.rejects(run(host, native), error => error.message.includes('simulated crash'));
    assert.ok(state.image, 'the page closed after the journal');
    return { native, image: state.image };
}

const mutate = async (host, native) => {
    const head = await host.sdk.timeline.head();
    return native.native.handle.nativeMutation({
        participant: NATIVE, source: host.store.sourceAt(host.store.headIndex()), expectedHead: head.headHash,
        prepare: async () => {
            const before = native.native.checkpoint();
            const next = clone(native.native.store);
            next.dossiers.tavi.trust = 9;
            const after = native.native.keep(next);
            native.native.prepared.pr_manual001 = { checkpoint: after.checkpoint };
            return { before: { module: NATIVE, ...before, schema: 1 }, after: { module: NATIVE, ...after, schema: 1 }, prepared: 'pr_manual001' };
        },
    });
};

test('a journaled native mutation the participant has no record of is let go on recovery: barrier down, one line told, the next reply goes on', async t => {
    const { native, image } = await closedAfterJournal(t, mutate);
    delete native.native.prepared.pr_manual001;   // the participant's own record of the preparation is gone
    const again = await reload(createHost, image, [rulesModule(), native.def]);
    t.after(() => again.close());
    assert.equal(again.registry.restore().state, 'idle', 'the barrier is down');
    assert.equal((await again.sdk.timeline.status()).state, 'idle');
    assert.equal((await again.sdk.timeline.head()).ok, true);
    const entry = again.timeline.host.journal().find(item => item.kind === 'native-mutation');
    assert.equal(entry.phase, 'aborted');
    assert.match(entry.why, /has no record of the change/);
    const told = again.turn.problems().filter(item => item.code === 'NATIVE_ABORTED');
    assert.equal(told.length, 1, 'one Problems line');
    assert.match(told[0].message, LINE);
    assert.equal(told[0].module, NATIVE);
    assert.equal(again.st.notices.filter(notice => LINE.test(notice.reason)).length, 1, 'and one toast');
    assert.equal(native.native.store.dossiers.tavi.trust, 3, 'nothing was switched');
    // The story goes on: a reply is generated and captured, and the participant can publish again.
    const generated = await again.st.generate('normal', { reply: 'The gate.' });
    assert.notEqual(generated.aborted, true);
    assert.equal(again.registry.restore().state, 'idle');
    const head = await again.sdk.timeline.head();
    assert.equal(head.ok, true);
    const published = await native.native.handle.nativeMutation({
        participant: NATIVE, source: again.store.sourceAt(again.store.headIndex()), expectedHead: head.headHash,
        prepare: async () => {
            const before = native.native.checkpoint();
            const after = native.native.keep({ ...clone(native.native.store), dossiers: { tavi: { trust: 9 } } });
            native.native.prepared.pr_manual002 = { checkpoint: after.checkpoint };
            return { before: { module: NATIVE, ...before, schema: 1 }, after: { module: NATIVE, ...after, schema: 1 }, prepared: 'pr_manual002' };
        },
    });
    assert.equal(published.ok, true, published.message);
    assert.equal(native.native.store.dossiers.tavi.trust, 9);
    assert.equal(again.registry.restore().state, 'idle');
    // A later start finds nothing to recover and tells nothing again.
    const third = await reload(createHost, { chat: clone(again.ctx.chat), metadata: clone(again.ctx.chatMetadata) }, [rulesModule(), native.def]);
    t.after(() => third.close());
    assert.equal(third.registry.restore().state, 'idle');
    assert.equal(third.turn.problems().filter(item => item.code === 'NATIVE_ABORTED').length, 0);
});

test('a journaled native mutation the participant still has is finished forward, as before (nothing told)', async t => {
    const { native, image } = await closedAfterJournal(t, mutate);
    const again = await reload(createHost, image, [rulesModule(), native.def]);
    t.after(() => again.close());
    assert.equal(again.registry.restore().state, 'idle');
    assert.deepEqual(again.timeline.host.journal().filter(item => item.kind === 'native-mutation').map(item => item.phase), ['done']);
    assert.equal(native.native.store.dossiers.tavi.trust, 9);
    assert.equal(again.turn.problems().filter(item => item.code === 'NATIVE_ABORTED').length, 0);
});

test('a journaled native event whose participant answers NOT_FOUND is not let go: it stays held as it is today', async t => {
    const { native, image } = await closedAfterJournal(t, async host => {
        const head = await host.sdk.timeline.head();
        return host.timeline.host.nativeEvent({ event: 'ev_death001', participant: NATIVE, kind: 'confirmed-death', npc: NPC, expectedHead: head.headHash });
    });
    const original = native.def.participant.applyEvent;
    native.def.participant.applyEvent = () => ({ ok: false, code: 'NOT_FOUND', message: 'nothing known of that event (test)' });
    t.after(() => { native.def.participant.applyEvent = original; });
    const again = await reload(createHost, image, [rulesModule(), native.def]);
    t.after(() => again.close());
    assert.equal(again.registry.restore().state, 'pending', 'still held');
    const entry = again.timeline.host.journal().find(item => item.kind === 'native-event');
    assert.equal(entry.phase, 'prepared');
    const recovered = await again.timeline.host.recover();
    assert.equal(recovered.ok, false);
    assert.equal(recovered.code, 'NOT_FOUND');
    assert.equal(again.registry.restore().state, 'pending');
    assert.equal(again.turn.problems().filter(item => item.code === 'NATIVE_ABORTED').length, 0);
    assert.equal(again.st.notices.some(notice => LINE.test(notice.reason)), false);
});
