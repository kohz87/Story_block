// E6b review fix 2: the barrier comes down, and the modules are told they are ready, in exactly one place, and only after the
// publication is durable and head selection has been reconciled to a fixed point. A change that finishes after the reply it
// stood on is gone does not announce readiness on the wrong native state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHost } from '../../testkit/index.js';
import { nativeModule, rulesModule, pause, clone, reload, NATIVE, NPC } from './helpers/timeline.js';
import { hashJson } from '../../src/v2/replay.js';

// A world with one native change possible: trust 3 -> 9 (or a confirmed death) on the head reply. `observed` records what a
// listener and a public query see every time the modules are announced ready.
async function world(t, { gateOn = 'activate', alternate = false } = {}) {
    const native = nativeModule();
    native.def.queries['nat.trust'] = () => native.native.store.dossiers.tavi.trust;
    native.def.queries['nat.applied'] = () => [...native.native.store.applied];
    const gate = pause(native.def.participant, gateOn);
    const modules = [rulesModule(), native.def];
    const host = await createHost({ modules });
    t.after(() => host.close());
    await host.send('Begin.', 'Start.');
    await host.send('Next.', 'Before the change.');
    const last = host.ctx.chat.length - 1;
    if (alternate) {
        await host.swipe('Another ending.');
        await host.st.swipeTo(last, 0);
    }
    const observed = [];
    host.events.on('modules', ({ changes }) => {
        if (!changes.some(change => change.status === 'ready')) return;
        observed.push({ state: host.registry.restore().state, trust: host.sdk.query('nat.trust', {}), applied: host.sdk.query('nat.applied', {}), live: native.native.store.dossiers.tavi.trust });
    });
    const mutate = async () => {
        const head = await host.sdk.timeline.head();
        return native.native.handle.nativeMutation({ participant: NATIVE, source: head.source, expectedHead: head.headHash, prepare: async () => {
            const before = native.native.checkpoint();
            const next = clone(native.native.store);
            next.dossiers.tavi.trust = 9;
            const after = native.native.keep(next);
            native.native.prepared.pr_mutation = { checkpoint: after.checkpoint };
            return { before: { module: NATIVE, ...before, schema: 1 }, after: { module: NATIVE, ...after, schema: 1 }, prepared: 'pr_mutation' };
        } });
    };
    const event = async () => {
        const head = await host.sdk.timeline.head();
        return host.timeline.host.nativeEvent({ event: 'ev_release001', participant: NATIVE, kind: 'confirmed-death', npc: NPC, expectedHead: head.headHash });
    };
    return { host, native: native.native, gate, modules, last, observed, mutate, event };
}

const settledOn = (host, native, trust, applied) => {
    assert.equal(host.registry.restore().state, 'idle');
    assert.equal(native.store.dossiers.tavi.trust, trust);
    assert.deepEqual(native.store.applied, applied);
};

for (const [kind, gateOn] of [['change', 'activate'], ['event', 'applyEvent']]) for (const action of ['delete', 'swipe']) {
    test(`a native ${kind} finishing after its reply was ${action === 'delete' ? 'deleted' : 'swiped away'} announces readiness only on the selected head's native state`, async t => {
        const w = await world(t, { gateOn, alternate: action === 'swipe' });
        w.gate.arm();
        const running = kind === 'change' ? w.mutate() : w.event();
        await w.gate.entered;
        assert.equal(w.host.registry.restore().state, 'pending');
        if (action === 'delete') await w.host.st.deleteMessage(w.last);
        else await w.host.st.swipeTo(w.last, 1);
        w.gate.release();
        const done = await running;
        assert.equal(done.ok, true, done.message);
        // the reply the change stood on is gone: the native state is what the selected head holds
        settledOn(w.host, w.native, 3, []);
        assert.ok(w.observed.length >= 1, 'readiness was announced');
        assert.deepEqual(w.observed.filter(each => each.state !== 'idle' || each.trust !== 3 || each.applied.length !== 0 || each.live !== 3), [], 'never ready on the wrong native state');
        assert.equal((await w.host.sdk.timeline.head()).ok, true, 'a head request is not RESTORE_PENDING');
        assert.equal((await w.host.timeline.host.recover()).state, 'idle');
        assert.equal((await w.host.sdk.timeline.status()).participants[0].hash, hashJson(w.native.store));
        // a rebuild and a start again from the chat file agree
        const state = clone(w.host.head());
        w.host.store.rebuild();
        assert.deepEqual(clone(w.host.head()), state);
        const fresh = await reload(createHost, { chat: clone(w.host.ctx.chat), metadata: clone(w.host.ctx.chatMetadata) }, w.modules);
        t.after(() => fresh.close());
        assert.equal(fresh.registry.restore().state, 'idle');
        assert.equal((await fresh.sdk.timeline.status()).participants[0].hash, hashJson(w.native.store));
    });
}

test('a native change whose reply is still there is announced ready on the change', async t => {
    const w = await world(t);
    w.gate.arm();
    const running = w.mutate();
    await w.gate.entered;
    w.gate.release();
    assert.equal((await running).ok, true);
    settledOn(w.host, w.native, 9, []);
    assert.deepEqual(w.observed.filter(each => each.trust !== 9 || each.state !== 'idle'), []);
    assert.ok(w.observed.length >= 1);
});

test('a head change while another operation is in flight does not wait for the next look: the barrier goes up at once and the operation ends by reconciling', async t => {
    const w = await world(t, { gateOn: 'checkpoint' });
    // one change on the line first, so that deleting its reply moves the selected checkpoint
    assert.equal((await w.mutate()).ok, true);
    const mutated = w.host.ctx.chat.length - 1;
    w.observed.length = 0;
    w.gate.arm();
    const making = w.host.sdk.timeline.make({ kind: 'manual' });
    await w.gate.entered;
    assert.equal(w.host.registry.restore().state, 'idle', 'nothing is wrong while the head is what it was');
    await w.host.st.deleteMessage(mutated);
    assert.equal(w.host.registry.restore().state, 'pending', 'selection checks are not suppressed while an operation runs');
    assert.equal(w.native.store.dossiers.tavi.trust, 9, 'the participant has not been switched yet');
    w.gate.release();
    const made = await making;
    assert.equal(made.ok, false);
    assert.equal(made.code, 'STALE');
    settledOn(w.host, w.native, 3, []);
    assert.deepEqual(w.observed.filter(each => each.trust !== 3), [], 'nothing was announced ready on the change that was cut off');
});

test('the barrier comes down in one place, and no code path reads the story with the barrier lowered except the one whole-story read', async () => {
    const coordinator = await readFile(new URL('../../src/v2/timeline/coordinator.js', import.meta.url), 'utf8');
    const lowers = coordinator.match(/barrier\(\s*'idle'/g) ?? [];
    assert.equal(lowers.length, 1, 'one site lowers the barrier and announces readiness');
    const lowering = coordinator.indexOf("barrier('idle'");
    const owner = coordinator.slice(coordinator.lastIndexOf('function ', lowering), lowering);
    assert.match(owner, /function lowerWhenSettled\(/);
    // it asks for the fixed point itself: nothing outstanding, selection reconciled
    assert.match(coordinator.slice(coordinator.indexOf('function lowerWhenSettled('), lowering), /pendingEntry\(settling\)[\s\S]*selectionNeeded\(\)/);
    // the only temporary lowering is the unannounced whole-story read, and it does not announce
    assert.equal((coordinator.match(/setRestore\(\s*'idle'/g) ?? []).length, 1);
    assert.equal((coordinator.match(/function withWholePrefixes\(/g) ?? []).length, 1);
    assert.equal(coordinator.includes('function wholeStory('), false, 'one whole-story read');
    // the old direct lowering is gone
    assert.equal((coordinator.match(/\blower\(/g) ?? []).length, 0);
    // settle asks whether selection is needed whether or not an operation runs
    const settle = coordinator.slice(coordinator.indexOf('function settle()'), coordinator.indexOf('// A clean-up after a failure'));
    assert.equal(/runningIn\(/.test(settle), false);
    assert.match(settle, /selectionNeeded\(\)/);
});
