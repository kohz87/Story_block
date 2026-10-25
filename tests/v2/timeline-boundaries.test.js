import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { clockModule, paidTraining } from './helpers/clock.js';
import { hashJson } from '../../src/v2/replay.js';
import { nativeModule, sealerModule, restore, clone, reload } from './helpers/timeline.js';

const advance = (host, minutes, rest = {}) => host.bus.command('director.advance', { minutes, ...rest }, { cause: 'system' });
async function start(t, options = {}) {
    const host = await createHost({ modules: [clockModule(options), paidTraining(), sealerModule()] });
    t.after(() => host.close());
    await host.send('Start.', 'Before midnight.');
    return host;
}

test('midnight/multiday anchors capture staged fees, running training and each exact logical clock, not sorted final diffs', async t => {
    const marked = [];
    const host = await start(t, { marked });
    const result = await host.bus.command('training.start', { minutes: 3000 }, { cause: 'system' });
    assert.equal(result.ok, true, result.message);
    assert.equal(marked.length, 3);
    assert.deepEqual((await host.sdk.timeline.list()).points, [], 'nothing is eligible before async publication');
    assert.equal((await host.timeline.host.recover()).ok, true);
    const points = (await host.sdk.timeline.list()).points;
    assert.deepEqual(points.map(p => p.minute), [1440, 2880, 4320]);
    assert.deepEqual(points.map(p => p.target), marked.map(m => m.cursor));
    for (const point of points) {
        const payload = host.timeline.archive.payload(point.payloadHash).payload;
        assert.equal(payload.domains.director.time.minutes, point.minute);
        assert.deepEqual(payload.domains.training, { fee: 20, session: { status: 'running', paid: true } });
        assert.equal(payload.domains.director.expired, point.day);
    }
    assert.equal(host.head().domains.savepoints.previousDay, points[1].id);
    const restored = await restore(host, points[1].id);
    assert.equal(restored.activated.status, 'complete');
    assert.equal(host.head().domains.director.time.minutes, 2880);
    assert.equal(host.head().domains.training.fee, 20);
    assert.equal(host.head().domains.training.session.status, 'running');
    assert.equal(host.head().domains.savepoints.dayStarts['1'], points[0].id);
});

test('failed roots and guards publish no markers; guard queries are declared and prefix-only', async t => {
    const host = await start(t);
    assert.equal((await advance(host, 60, { fail: true })).code, 'REFUSED');
    assert.deepEqual(host.store.timelineMarkers(), []);
    assert.equal(host.ctx.chatMetadata.storySuite?.timeline, undefined);
    assert.equal((await advance(host, 60)).ok, true);
    assert.equal((await host.timeline.host.recover()).ok, true);
    const before = clone(host.head());
    host.store.rebuild();
    assert.deepEqual(clone(host.head()), before);
    const other = await start(t, { leak: true });
    assert.equal((await advance(other, 60)).ok, false, 'a guard cannot query undeclared clock state');
    assert.deepEqual(other.store.timelineMarkers(), []);
});

test('only trusted SD clock commands can mark the next crossed midnight with their actual source', async t => {
    const host = await start(t);
    assert.equal((await host.sdk.command('director.advance', { minutes: 60 })).code, 'REFUSED');
    assert.equal((await advance(host, 60, { source: { sid: 'sr_00000001' } })).code, 'REFUSED');
    const bad = clockModule();
    bad.commands['director.advance'] = ctx => { ctx.draft('director').time.minutes = 2880; ctx.clockBoundary({ minute: 2880, source: ctx.source }); return {}; };
    const wrong = await createHost({ modules: [bad] });
    t.after(() => wrong.close());
    await wrong.send('Start.', 'Here.');
    assert.equal((await advance(wrong, 1500)).code, 'INVALID');
});

test('Re-read removing time, swipe, delete and reload retract automatic anchors without inventing earlier days', async t => {
    const host = await start(t);
    await host.send('Next.', 'Clock reply.');
    const at = host.ctx.chat.length - 1;
    assert.equal((await advance(host, 60)).ok, true);
    await host.timeline.host.recover();
    const image = { chat: clone(host.ctx.chat), metadata: clone(host.ctx.chatMetadata) };
    const fresh = await reload(createHost, image, [clockModule(), paidTraining(), sealerModule()]);
    t.after(() => fresh.close());
    assert.equal((await fresh.sdk.timeline.list()).points.length, 1);
    await host.swipe('No time passed.');
    assert.equal((await host.sdk.timeline.list()).points.length, 0);
    await host.st.swipeTo(at, 0);
    assert.equal((await host.sdk.timeline.list()).points.length, 1);
    await host.st.deleteMessage(at);
    assert.equal((await host.sdk.timeline.list()).points.length, 0);
});

test('Re-read and Continue regenerate markers in order; removed time retires anchors and native scans see active history', async t => {
    const host = await start(t);
    await host.send('Wait.', 'Midnight.\n<Changes>\n~ time 60\n</Changes>');
    const index = host.ctx.chat.length - 1;
    const points = (await host.sdk.timeline.list()).points;
    assert.equal(points.length, 1);
    const marker = clone(host.store.timelineMarkers()[0]);
    assert.equal((await host.sdk.reread(index)).ok, true);
    assert.equal(host.store.timelineMarkers()[0].cursor.block, marker.cursor.block);
    assert.equal((await host.sdk.timeline.list()).points[0].id, points[0].id);
    await host.cont(' Dawn.');
    assert.equal((await host.sdk.timeline.list()).points.length, 1);
    await host.st.editMessage(index, 'No clock change.');
    assert.equal((await host.sdk.reread(index)).ok, true);
    assert.equal(host.store.timelineMarkers().length, 0);
    assert.equal((await host.sdk.timeline.list()).points.length, 0);
    assert.equal(host.head().domains.director.time.minutes, 1410);
    assert.equal(host.store.problems().some(p => p.code === 'REPLAY_PREREQUISITE'), true);
});

test('a marker selects the native prefix at the logical boundary, even when publication follows a later native mutation', async t => {
    const native = nativeModule();
    const host = await createHost({ modules: [clockModule(), native.def] });
    t.after(() => host.close());
    await host.send('Go.', 'Before midnight.');
    assert.equal((await advance(host, 60)).ok, true);
    const before = hashJson(native.native.store);
    const head = await host.sdk.timeline.head();
    const mutated = await native.native.handle.nativeMutation({ participant: native.def.id, source: head.source, expectedHead: head.headHash,
        prepare: async () => {
            const prior = native.native.checkpoint();
            const next = clone(native.native.store);
            next.dossiers.tavi.trust = 99;
            const after = native.native.keep(next);
            native.native.prepared.pr_later001 = { checkpoint: after.checkpoint };
            return { before: { module: native.def.id, schema: 1, ...prior }, after: { module: native.def.id, schema: 1, ...after }, prepared: 'pr_later001' };
        },
    });
    assert.equal(mutated.ok, true, mutated.message);
    assert.equal((await host.timeline.host.recover()).ok, true);
    const point = (await host.sdk.timeline.list()).points[0];
    assert.equal(point.participants[0].hash, before);
    assert.equal(native.native.store.dossiers.tavi.trust, 99);
    const replay = clone(host.head());
    host.store.rebuild();
    assert.deepEqual(clone(host.head()), replay);
});

test('clock marker identity, snapshot capture, validation and durability each have one source', async () => {
    const { readFile } = await import('node:fs/promises');
    const commands = await readFile(new URL('../../src/v2/commands.js', import.meta.url), 'utf8');
    const boundary = await readFile(new URL('../../src/v2/timeline/boundary.js', import.meta.url), 'utf8');
    const coordinator = await readFile(new URL('../../src/v2/timeline/coordinator.js', import.meta.url), 'utf8');
    assert.equal((commands.match(/clockBoundary\(input\)/g) ?? []).length, 1);
    assert.equal((commands.match(/`clock:\$\{root.block\}/g) ?? []).length, 1);
    assert.match(commands, /const root = cursorOf\(tx\)/);
    assert.equal((boundary.match(/function markerProblem\(/g) ?? []).length, 1);
    assert.equal((coordinator.match(/await store\.flush\(/g) ?? []).length, 1);
});

test('a changed prefix retires its old marker and dependent day anchor instead of rebinding them', async t => {
    const host = await start(t);
    await host.send('First.', 'Fee.\n<Changes>\n+ coin 2\n</Changes>');
    const earlier = host.ctx.chat.length - 1;
    await host.send('Wait.', 'Midnight.\n<Changes>\n~ time 60\n</Changes>');
    const point = (await host.sdk.timeline.list()).points[0];
    await host.st.editMessage(earlier, 'Other fee.\n<Changes>\n+ coin 8\n</Changes>');
    assert.equal((await host.sdk.reread(earlier)).ok, true);
    assert.equal((await host.timeline.host.recover()).ok, true);
    assert.equal((await host.sdk.timeline.list()).points.length, 0);
    assert.equal((await host.sdk.reread(host.ctx.chat.length - 1)).ok, true);
    const points = (await host.sdk.timeline.list()).points;
    assert.equal(points.some(p => p.id === point.id), false);
    assert.equal(points.length, 1);
    assert.notEqual(points[0].target.block, point.target.block);
    assert.equal(host.store.problems().some(p => p.code === 'REPLAY_PREREQUISITE'), true);
});
