// A permanently blocked branch's way out (timeline/coordinator-rebuild.js): rebuild(module) refuses unless the block
// is permanent, reads the last 40 replies by default (or the whole chat), closes the pending selection as rebuilt,
// drops the module's selected checkpoint, lowers the barrier, and records the exact Problem.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createArchive } from '../../src/v2/timeline/archive.js';
import {
    createRebuild, readPlan, rebuildMessage, replyNumberAt, REBUILD_DEFAULT_REPLIES, REBUILD_READ_ALL, REBUILD_READ_LAST,
} from '../../src/v2/timeline/coordinator-rebuild.js';

const MOD = 'npc-state-delta';
const OTHER = 'other-native';
const hash = char => char.repeat(64);
const target = (module, checkpoint, char) => ({ module, checkpoint, hash: hash(char), schema: 1 });

function harness({ blocked = null, call = null, fallbackEmpty = null, release = null, chat = null, seed = true } = {}) {
    const meta = {};
    const archive = createArchive({ metadata: () => meta });
    if (seed) {
        archive.add({
            id: 'hs_select01', kind: 'selection', phase: 'prepared',
            desired: { [MOD]: target(MOD, 'ck_old', 'a'), [OTHER]: target(OTHER, 'ck_other', 'c') },
            slots: { [MOD]: { prepared: 'pr_old' }, [OTHER]: { prepared: 'pr_other' } },
        });
        archive.select({ [MOD]: target(MOD, 'ck_old', 'a'), [OTHER]: target(OTHER, 'ck_other', 'c') });
    }
    const state = { block: blocked, notes: [], clears: 0 };
    const block = {
        current: () => state.block,
        clear: () => { state.clears += 1; state.block = null; },
        note: (module, failure) => {
            state.notes.push([module, failure]);
            state.block = { reason: failure.message, code: failure.code, blockedBy: { module, code: failure.code } };
            return failure;
        },
    };
    const calls = [];
    const problems = [];
    const barriers = [];
    const releases = [];
    const points = [];
    let durables = 0;
    const s = { barrierOwner: 'chat', barrierEarly: false };
    const pending = { call: null };
    const deps = {
        archive,
        block,
        participants: { get: module => (module === MOD ? { schema: 1, rebuild() {} } : null) },
        callParticipant: async (module, name, input) => {
            calls.push({ module, name, input, selectionAtCall: Object.keys(archive.selection()) });
            if (pending.call) return pending.call(module, name, input, archive);
            return call ? call(module, name, input, archive) : { ok: true };
        },
        durable: async () => { durables += 1; },
        headNow: () => ({ boundary: { index: 4 } }),
        here: () => {},
        point: async phase => { points.push(phase); },
        release: async id => { releases.push(id); return release ? release(id) : { ok: true }; },
        barrier: (stateName, reason) => barriers.push([stateName, reason]),
        raise: reason => barriers.push(['pending', reason]),
        problem: entry => problems.push(entry),
        chat: chat ?? (() => [{ is_user: true }, {}, { is_user: true }, {}, {}]),
        fallbackEmpty: fallbackEmpty ?? (() => true),
    };
    return { meta, archive, state, block, calls, problems, barriers, releases, points, s, pending, deps, rebuild: createRebuild(s, deps).rebuild,
        durables: () => durables };
}

const permanent = (code = 'SNAPSHOT_UNAVAILABLE', module = MOD) => ({ reason: 'missing', code, blockedBy: { module, code } });

test('readPlan: last 40 by default, the whole chat on request, anything else INVALID', () => {
    assert.deepEqual(readPlan(), { ok: true, read: REBUILD_READ_LAST, replies: REBUILD_DEFAULT_REPLIES });
    assert.deepEqual(readPlan({}), { ok: true, read: REBUILD_READ_LAST, replies: 40 });
    assert.deepEqual(readPlan({ read: REBUILD_READ_ALL }), { ok: true, read: REBUILD_READ_ALL, replies: null });
    assert.equal(readPlan({ read: 'everything' }).code, 'INVALID');
    assert.equal(readPlan({ read: REBUILD_READ_LAST, extra: 1 }).code, 'INVALID');
    assert.equal(readPlan(null).code, 'INVALID');
});

test('replyNumberAt counts story replies through the boundary; a position is the fallback', () => {
    const messages = [{ is_user: true }, {}, { is_user: true }, {}, {}];
    assert.equal(replyNumberAt({ index: 4 }, messages), 3);
    assert.equal(replyNumberAt({ index: 2 }, messages), 1);
    assert.equal(replyNumberAt({ index: 2 }, []), 3);
    assert.equal(replyNumberAt({}, messages), null);
    assert.equal(rebuildMessage(3), 'dossiers rebuilt from the chat at reply 3');
});

test('rebuild refuses without a permanent block, with the wrong module, or for a transient cause; nothing is written', async () => {
    for (const blocked of [null, permanent('FAILED'), permanent('SNAPSHOT_UNAVAILABLE', OTHER)]) {
        const h = harness({ blocked, seed: false });
        const answer = await h.rebuild(MOD);
        assert.equal(answer.code, 'REFUSED');
        assert.equal(h.meta.storySuite, undefined, 'a refusal creates no archive');
        assert.equal(h.calls.length, 0);
    }
    const h = harness({ blocked: permanent('SNAPSHOT_UNAVAILABLE'), seed: false });
    assert.equal((await h.rebuild('')).code, 'INVALID');
    assert.equal((await h.rebuild(MOD, { read: 'everything' })).code, 'INVALID');
    assert.equal(h.meta.storySuite, undefined);
});

test('a permanent CONFLICT or DEPENDENCY_UNAVAILABLE is rebuildable; a non-empty fallback chain is not', async () => {
    for (const code of ['CONFLICT', 'DEPENDENCY_UNAVAILABLE']) {
        const h = harness({ blocked: permanent(code) });
        assert.equal((await h.rebuild(MOD)).ok, true, code);
    }
    const h = harness({ blocked: permanent('SNAPSHOT_UNAVAILABLE'), fallbackEmpty: () => false, seed: false });
    assert.equal((await h.rebuild(MOD)).code, 'REFUSED');
    assert.equal(h.meta.storySuite, undefined);
});

test('rebuild preserves the pending selection when support or fallback confirmation is missing', async () => {
    for (const missing of ['callback', 'fallback', 'unknown-fallback']) {
        const h = harness({ blocked: permanent() });
        if (missing === 'callback') h.deps.participants = { get: () => ({ schema: 1 }) };
        if (missing === 'fallback') h.deps.fallbackEmpty = null;
        if (missing === 'unknown-fallback') h.deps.fallbackEmpty = () => undefined;
        const before = JSON.stringify(h.meta);
        const answer = await createRebuild(h.s, h.deps).rebuild(MOD);
        assert.equal(answer.code, missing === 'callback' ? 'UNSUPPORTED' : 'REFUSED');
        assert.equal(JSON.stringify(h.meta), before, 'the journal and selected checkpoints are unchanged');
        assert.equal(h.calls.length, 0);
        assert.equal(h.barriers.length, 0);
    }
});

test('the default reads 40; the callback sees the fresh journal entry and the selected checkpoint is already dropped', async () => {
    const seen = [];
    const h = harness({ blocked: permanent(), call: (module, name, input, archive) => {
        seen.push({ module, name, input, selection: archive.selection() });
        archive.select({ ...archive.selection(), [module]: target(module, 'ck_new', 'b') });
        return { ok: true };
    } });
    const answer = await h.rebuild(MOD);
    assert.deepEqual(answer, { ok: true, module: MOD, reply: 3, read: REBUILD_READ_LAST, replies: 40, rebuilt: 'hs_select01', started: false });
    assert.deepEqual(h.calls[0].input, { return: 'hs_select01', read: REBUILD_READ_LAST, replies: 40 });
    assert.equal(h.calls[0].name, 'rebuild');
    assert.equal(h.calls[0].module, MOD);
    assert.deepEqual(h.calls[0].selectionAtCall, [OTHER], 'the module selection is dropped before the callback');
    const entry = h.archive.get('hs_select01');
    assert.equal(entry.phase, 'rebuilt');
    assert.deepEqual(entry.slots[MOD], { rebuilt: true });
    assert.deepEqual(entry.slots[OTHER], { prepared: 'pr_other' }, 'another module slot is kept');
    assert.ok(h.archive.selection()[MOD], 'the participant republished its own selection');
    assert.deepEqual(h.archive.selection()[OTHER], target(OTHER, 'ck_other', 'c'));
    assert.deepEqual(h.barriers[0], ['idle', ''], 'the barrier is lowered for the participant callback');
    assert.deepEqual(h.releases, ['hs_select01']);
    assert.deepEqual(h.problems, [{ module: MOD, code: 'REBUILT', message: 'dossiers rebuilt from the chat at reply 3' }]);
    assert.equal(h.s.barrierOwner, null);
    assert.ok(h.state.clears > 0);
});

test('the whole-chat choice sends read all and no reply cap', async () => {
    const h = harness({ blocked: permanent() });
    const answer = await h.rebuild(MOD, { read: REBUILD_READ_ALL });
    assert.equal(answer.read, REBUILD_READ_ALL);
    assert.equal(answer.replies, null);
    assert.deepEqual(h.calls[0].input, { return: 'hs_select01', read: REBUILD_READ_ALL, replies: null });
});

test('without a pending selection the rebuild keeps a closed entry with the rebuilt slot', async () => {
    const h = harness({ blocked: permanent(), seed: false });
    const answer = await h.rebuild(MOD);
    assert.equal(answer.ok, true);
    const entry = h.archive.get(answer.rebuilt);
    assert.equal(entry.kind, 'selection');
    assert.equal(entry.phase, 'rebuilt');
    assert.deepEqual(entry.slots[MOD], { rebuilt: true });
    assert.deepEqual(h.calls[0].input.return, answer.rebuilt);
});

test('a failed callback leaves a permanent block and the same words for the banner; a second call is refused once it succeeds', async () => {
    const h = harness({ blocked: permanent(), call: () => ({ ok: false, code: 'FAILED', message: 'the scan failed' }) });
    const failed = await h.rebuild(MOD);
    assert.equal(failed.code, 'FAILED');
    assert.equal(h.state.block.blockedBy.code, 'SNAPSHOT_UNAVAILABLE', 'the original permanent cause is kept');
    assert.match(h.state.notes[0][1].message, /scan failed/);
    assert.equal(h.problems.length, 0, 'a failed rebuild records no success');
    const again = await harness({ blocked: permanent() });
    assert.equal((await again.rebuild(MOD)).ok, true);
    const after = JSON.stringify(again.meta);
    assert.equal((await again.rebuild(MOD)).code, 'REFUSED');
    assert.equal(JSON.stringify(again.meta), after, 'a repeat refusal changes no bytes');
});

test('the rebuilt journal replays: the entry stays rebuilt and the participant selection is the one it published', async () => {
    const h = harness({ blocked: permanent(), call: (module, name, input, archive) => {
        archive.select({ ...archive.selection(), [module]: target(module, 'ck_new', 'b') });
        return { ok: true };
    } });
    assert.equal((await h.rebuild(MOD)).ok, true);
    const image = structuredClone(h.meta);
    const reloaded = createArchive({ metadata: () => image });
    assert.equal(reloaded.get('hs_select01').phase, 'rebuilt');
    assert.deepEqual(reloaded.selection()[MOD], target(MOD, 'ck_new', 'b'));
    assert.deepEqual(reloaded.selection()[OTHER], target(OTHER, 'ck_other', 'c'));
    const before = JSON.stringify(image);
    const fresh = harness({ blocked: null, seed: false });
    assert.equal((await fresh.rebuild(MOD)).code, 'REFUSED');
    assert.equal(JSON.stringify(image), before, 'an old or settled chat is byte-identical after a refusal');
});
