// The head-selection fallback wired into finishSelection (B group spec 3a): a selected checkpoint that is gone walks to the nearest
// earlier one that holds, says so once, and is settled; a reader's restore and a save point stay exact.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHost } from '../../testkit/index.js';
import { nativeModule, rulesModule, clone, reload, restore, NATIVE } from './helpers/timeline.js';
import { createParticipants } from '../../src/v2/timeline/participants.js';
import { fellNotice } from '../../src/v2/timeline/selection-fallback.js';

// Two native changes, then the reply the second one stood on is deleted: the head needs the checkpoint of the first (`after`),
// and the one before any change is the nearest earlier point.
async function setup(t, { customize = null, guarded = false } = {}) {
    const native = nativeModule();
    customize?.(native);
    const modules = [rulesModule(), native.def];
    const host = await createHost({ modules });
    t.after(() => host.close());
    await host.send('Begin.', 'Start.');
    const point = (await host.sdk.timeline.make({ kind: 'manual' })).snapshot;
    const change = async trust => {
        const head = await host.sdk.timeline.head();
        let made = null;
        await native.native.handle.nativeMutation({ participant: NATIVE, source: head.source, expectedHead: head.headHash, prepare: async () => {
            const before = native.native.checkpoint();
            const next = clone(native.native.store);
            next.dossiers.tavi.trust = trust;
            made = native.native.keep(next);
            native.native.prepared[`pr_m${trust}`] = { checkpoint: made.checkpoint };
            return { before: { module: NATIVE, ...before, schema: 1 }, after: { module: NATIVE, ...made, schema: 1 }, prepared: `pr_m${trust}` };
        } });
        return made;
    };
    await host.send('Next.', 'First change.');
    if (guarded) assert.equal((await host.sdk.command('tl.guarded', { epoch: 'ep_00000000' })).ok, true);
    const after = await change(9);
    await host.send('Again.', 'Second change.');
    const afterSecond = await change(12);
    await host.send('Die.', 'Death.');
    return { host, native: native.native, modules, after, afterSecond, change, point };
}
const selections = host => host.timeline.host.journal().filter(entry => entry.kind === 'selection');
const told = host => host.turn.problems(NATIVE).filter(item => item.code === 'SELECTION_FELL');

test('a gone selected checkpoint falls to the nearest earlier one, once, and is settled', async t => {
    const { host, native, after } = await setup(t);
    native.missing.add(after.checkpoint);
    await host.st.deleteMessage(6);
    const status = await host.sdk.timeline.status();
    assert.equal(status.state, 'idle');
    assert.equal(native.store.dossiers.tavi.trust, 3, 'the participant stands on the earlier point');
    const done = selections(host).filter(entry => entry.fell);
    assert.equal(done.length, 1);
    assert.equal(done[0].phase, 'complete');
    assert.equal(done[0].fell.module, NATIVE);
    assert.equal(done[0].fell.from.checkpoint, after.checkpoint);
    assert.notEqual(done[0].fell.to.checkpoint, after.checkpoint);
    assert.equal(told(host).length, 1);
    assert.match(told(host)[0].message, /^Test native were restored to the nearest saved point \((reply \d+|the start of the chat)\)\. (\d+ later changes? (is|are)|Later changes are) being read again from the chat\.$/);
    // looking again plans nothing new: no second selection, no second notice
    const count = selections(host).length;
    await host.sdk.timeline.status();
    await host.sdk.timeline.head();
    assert.equal(selections(host).length, count);
    assert.equal(told(host).length, 1);
});

test('the notice uses the approved wording', () => {
    assert.equal(fellNotice('Dossiers', { index: 18, replies: 3 }), 'Dossiers were restored to the nearest saved point (reply 18). 3 later changes are being read again from the chat.');
    assert.equal(fellNotice('Dossiers', { index: 18, replies: 1 }), 'Dossiers were restored to the nearest saved point (reply 18). 1 later change is being read again from the chat.');
    assert.match(fellNotice('Dossiers', { index: null, replies: null }), /the start of the chat/);
});

test('every candidate gone leaves the original block, with no fallback recorded', async t => {
    const { host, native } = await setup(t);
    for (const id of Object.keys(native.checkpoints)) native.missing.add(id);
    await host.st.deleteMessage(6);
    const status = await host.sdk.timeline.status();
    assert.equal(status.state, 'pending');
    assert.equal(status.code, 'SNAPSHOT_UNAVAILABLE');
    assert.equal(selections(host).filter(entry => entry.fell).length, 0);
    assert.equal(told(host).length, 0);
});

test('a transient prepare failure is retried, not walked past', async t => {
    const { host, native } = await setup(t);
    native.fail.add('prepare');
    await host.st.deleteMessage(6);
    const status = await host.sdk.timeline.status();
    assert.equal(status.state, 'pending');
    assert.equal(status.blockedBy.code, 'FAILED');
    assert.equal(selections(host).filter(entry => entry.fell).length, 0);
});

test('a participant verify is asked before prepare, and an unverified point is never prepared', async t => {
    const log = [];
    const { host, native, after } = await setup(t, { customize: native => {
        native.def.participant.verify = input => { log.push(['verify', input.checkpoint]); return { ok: true }; };
        const prepare = native.def.participant.prepare;
        native.def.participant.prepare = input => { log.push(['prepare', input.checkpoint]); return prepare(input); };
    } });
    native.missing.add(after.checkpoint);
    log.length = 0;
    await host.st.deleteMessage(6);
    assert.equal((await host.sdk.timeline.status()).state, 'idle');
    const names = log.map(item => item[0]);
    assert.deepEqual(names.slice(0, 3), ['prepare', 'verify', 'prepare'], 'the head is prepared first, then verify, then the verified point');
    assert.equal(log[1][1], log[2][1]);
});

test('a participant verify that refuses every point leaves the block and prepares nothing else', async t => {
    const log = [];
    const { host, native, after } = await setup(t, { customize: native => {
        native.def.participant.verify = () => ({ ok: false, code: 'SNAPSHOT_UNAVAILABLE', message: 'no bytes' });
        const prepare = native.def.participant.prepare;
        native.def.participant.prepare = input => { log.push(input.checkpoint); return prepare(input); };
    } });
    native.missing.add(after.checkpoint);
    log.length = 0;
    await host.st.deleteMessage(6);
    assert.equal((await host.sdk.timeline.status()).state, 'pending');
    assert.deepEqual(log, [after.checkpoint], 'only the original head was prepared');
});

test('a temporary verify failure holds the selection for retry', async t => {
    const log = [];
    const { host, native, after } = await setup(t, { customize: native => {
        native.def.participant.verify = input => { log.push(input.checkpoint); return { ok: false, code: 'STALE', message: 'busy' }; };
    } });
    native.missing.add(after.checkpoint);
    await host.st.deleteMessage(6);
    const status = await host.sdk.timeline.status();
    assert.equal(status.state, 'pending');
    assert.equal(status.blockedBy.code, 'STALE');
    assert.equal(log.length, 1);
    assert.equal(selections(host).some(entry => entry.fell), false);
});

test('a fallback is not announced before activation succeeds, even across a retry', async t => {
    const { host, native, after } = await setup(t);
    native.missing.add(after.checkpoint);
    native.fail.add('activate');
    await host.st.deleteMessage(6);
    assert.equal((await host.sdk.timeline.status()).state, 'pending');
    assert.equal(told(host).length, 0);
    native.fail.delete('activate');
    assert.equal((await host.timeline.host.recover()).state, 'idle');
    assert.equal(told(host).length, 1);
    assert.equal(told(host)[0].quiet, true);
});

test('a completed fallback replays and reloads without changing its journal', async t => {
    const { host, native, modules, after } = await setup(t);
    native.missing.add(after.checkpoint);
    await host.st.deleteMessage(6);
    const state = clone(host.head());
    const image = { chat: clone(host.ctx.chat), metadata: clone(host.ctx.chatMetadata) };
    const journal = JSON.stringify(image.metadata.storySuite.timeline.journal);
    host.store.rebuild();
    assert.deepEqual(clone(host.head()), state);
    const fresh = await reload(createHost, image, modules);
    t.after(() => fresh.close());
    assert.equal((await fresh.timeline.host.recover()).state, 'idle');
    assert.deepEqual(clone(fresh.head()), state);
    assert.equal(JSON.stringify(fresh.ctx.chatMetadata.storySuite.timeline.journal), journal);
    assert.equal((await fresh.sdk.timeline.status()).participants[0].hash, selections(host).findLast(entry => entry.fell).fell.to.hash);
});

test('a 2.23 chat with a native journal opens without rewriting the chat or its archive', async t => {
    // This fixture was written by the 2.23.0 origin/main implementation, before fallback existed.
    const image = JSON.parse(await readFile(new URL('./fixtures/timeline-2.23-native.json', import.meta.url), 'utf8'));
    const beforeChat = JSON.stringify(image.chat);
    const beforeArchive = JSON.stringify(image.metadata.storySuite.timeline);
    const native = nativeModule();
    const host = await reload(createHost, image, [rulesModule(), native.def]);
    t.after(() => host.close());
    assert.equal((await host.timeline.host.recover()).state, 'idle');
    assert.equal(JSON.stringify(host.ctx.chat), beforeChat);
    assert.equal(JSON.stringify(host.ctx.chatMetadata.storySuite.timeline), beforeArchive);
});

test('a fallback after a guarded story block uses the whole replayed prefix', async t => {
    const { host, native, after, afterSecond, change } = await setup(t, { guarded: true });
    const removed = host.ctx.chat.length - 1;
    await change(15);
    await host.send('Further.', 'Fourth.');
    native.missing.add(afterSecond.checkpoint);
    await host.st.deleteMessage(removed);
    assert.equal((await host.sdk.timeline.status()).state, 'idle');
    assert.equal(native.store.dossiers.tavi.trust, 9);
    const fell = selections(host).findLast(entry => entry.fell).fell;
    assert.equal(fell.to.checkpoint, after.checkpoint);
    const mapping = host.timeline.archive.prefixes(NATIVE).find(item => item.after.checkpoint === after.checkpoint);
    const index = host.store.prefixWitness(mapping.boundary.cursor).index;
    const expected = host.ctx.chat.filter((message, at) => at > index && !message.is_user && !message.is_system).length;
    assert.equal(fell.replies, expected, 'reader messages are not counted as later replies');
});

test('a reader restore refuses its missing checkpoint instead of falling back', async t => {
    const { host, native, point } = await setup(t);
    native.missing.add(point.participants.find(item => item.module === NATIVE).checkpoint);
    const before = native.store.dossiers.tavi.trust;
    const result = await restore(host, point.id);
    assert.equal(result.prepared.code, 'SNAPSHOT_UNAVAILABLE');
    assert.equal(native.store.dossiers.tavi.trust, before);
    assert.equal(selections(host).some(entry => entry.fell), false);
});

test('register refuses a verify that is not a function and keeps a function', () => {
    const base = { module: 'm-one', schema: 1, checkpoint() {}, prepare() {}, activate() {}, abort() {}, status() {} };
    const registry = createParticipants();
    assert.equal(registry.register({ ...base, verify: 3 }).code, 'INVALID');
    assert.equal(registry.register({ ...base, verify() {} }).ok, true);
    assert.equal(typeof registry.get('m-one').verify, 'function');
});

test('only the head selection falls back: restore and save points never import the fallback', async () => {
    for (const file of ['coordinator-restore.js', 'coordinator-prepare.js']) {
        const source = await readFile(new URL(`../../src/v2/timeline/${file}`, import.meta.url), 'utf8');
        assert.doesNotMatch(source, /selection-fallback|fallBack|walkSelectionFallback/);
    }
});
