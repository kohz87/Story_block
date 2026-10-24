// The restore protocol: prepare, activate, abort; the host block that installs a save absolutely (docs/v2/TIMELINE.md, contract §8).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { hashJson } from '../../src/v2/replay.js';
import { director, T1, T2 } from './helpers/evidence.js';
import { BATCH, DEATH, NATIVE, clone, nativeModule, restore, rulesModule, slice } from './helpers/timeline.js';

const reply = (text, lines = []) => (lines.length ? `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
const cmd = (host, type, payload = {}) => host.sdk.command(type, payload).then(result => {
    assert.equal(result.ok, true, `${type}: ${result.message}`);
    return result;
});

// A story with a bit of everything on it, a manual save, and then more of the same: the dead timeline.
async function story(t, { extra = [], options = {} } = {}) {
    const native = nativeModule();
    const host = await createHost({ modules: [rulesModule(), native.def, director(), ...extra], ...options });
    t.after(() => host.close());
    await host.send('Hello.', reply('The road.', ['+ coin 30', '+ item Torch | qty: 2', '~ place Bluewatch | kind: settlement', '+ present Tavi']));
    await cmd(host, 'tl.time', { minutes: 600 });
    await cmd(host, 'tl.xp', { amount: 40 });
    await cmd(host, 'tl.hurt', { amount: 4 });
    await cmd(host, 'tl.equip', { slot: 'hand', item: 'Sword' });
    await cmd(host, 'tl.fight', { id: 'fi_first001', round: 1 });
    await cmd(host, 'tl.train', { session: 'tr_one00001', paid: 10 });
    await cmd(host, 'tl.meter', { npc: 'tavi', value: 3 });
    await cmd(host, 'tl.claim', { key: 'early' });
    await cmd(host, 'sd.accept', { thread: T1, selection: 'Yes' });
    const saved = (await host.sdk.timeline.make({ kind: 'manual', name: 'Before the cave' })).snapshot;
    const atSave = slice(host.head());
    const proofsAtSave = host.sdk.query('story.evidence', {}).map(proof => proof.id);
    // The dead timeline: everything moves on.
    await host.send('Onward.', reply('The cave.', ['+ coin 50', '- item Torch | qty: 1', '+ item Rope', '~ place Cave | kind: dungeon', '- present Tavi', '+ present Orrin']));
    await cmd(host, 'tl.time', { minutes: 900 });
    await cmd(host, 'tl.xp', { amount: 100 });
    await cmd(host, 'tl.hurt', { amount: 15 });
    await cmd(host, 'tl.unequip', { slot: 'hand' });
    await cmd(host, 'tl.equip', { slot: 'head', item: 'Helm' });
    await cmd(host, 'tl.fight', { id: 'fi_second01', round: 4 });
    await cmd(host, 'tl.train', { session: 'tr_two00001', paid: 25 });
    await cmd(host, 'tl.meter', { npc: 'tavi', value: 5 });
    await cmd(host, 'tl.meter', { npc: 'orrin', value: 2 });
    await cmd(host, 'tl.claim', { key: 'late' });
    await cmd(host, 'sd.accept', { thread: T2, selection: 'Later' });
    native.native.edit(state => { state.dossiers.tavi.trust = 99; state.dossiers.orrin = { trust: 1 }; });
    return { host, native, saved, atSave, proofsAtSave };
}

test('absolute restore: time, wallet, pools, XP, gear, combat, training and npc go back to the save, whatever came after', async t => {
    const { host, native, saved, atSave } = await story(t);
    const dead = slice(host.head());
    assert.notDeepEqual(dead, atSave, 'the story really moved');
    const revBefore = host.head().meta.rev;
    const { prepared, activated } = await restore(host, saved.id);
    assert.equal(prepared.ok, true, prepared.message);
    assert.deepEqual(activated, { ok: true, return: prepared.return, status: 'complete' });
    const now = host.head();
    // Each captured slice, one by one, so a failure says which.
    for (const name of ['director', 'party', 'progress', 'gear', 'combat', 'training', 'npc', 'rules', 'inventory', 'scene', 'sdt', 'nat']) {
        assert.deepEqual(clone(now.domains[name]), atSave.domains[name], `${name} is as it was saved`);
    }
    assert.equal(now.domains.director.time.minutes, 600);
    assert.equal(now.domains.inventory.wallets.party.coin, 30, 'the wallet');
    assert.deepEqual(now.domains.party.pools, { hp: 16, mp: 5, sp: 10 }, 'the pools');
    assert.equal(now.domains.progress.xp, 40, 'XP');
    assert.deepEqual(now.domains.gear.equipped, { hand: 'Sword' }, 'gear');
    assert.deepEqual(now.domains.combat.fight, { id: 'fi_first001', round: 1 }, 'combat');
    assert.deepEqual(now.domains.training, { session: { id: 'tr_one00001', minutes: 60 }, paid: 10 }, 'training: the running session, paid once');
    assert.deepEqual(now.domains.npc.meters, { tavi: 3 }, 'npc');
    assert.deepEqual(slice(now), atSave, 'and nothing else of the story is left over');
    // The host's counters go on: the revision is never restored.
    assert.equal(now.meta.rev > revBefore, true);
    // The native participant is on the saved checkpoint with its dossiers.
    assert.deepEqual(native.native.store, { dossiers: { tavi: { trust: 3 } }, applied: [] });
    assert.equal(native.native.active, saved.participants[0].checkpoint);
    // A rebuild from the chat agrees with what the store holds.
    host.store.rebuild();
    assert.deepEqual(clone(host.head()), clone(now));
    assert.deepEqual(host.store.problems(), []);
});

test('the restore installs the savepoints in a new epoch: earlier points stay, later ones go, the return is recorded', async t => {
    const { host, saved } = await story(t);
    const early = (await host.timeline.host.make({ kind: 'initial' })).snapshot;
    // (made after the save in time, so it is on the dead timeline only)
    const before = host.head().domains.savepoints;
    assert.equal(Object.keys(before.points).length, 2);
    const { prepared } = await restore(host, saved.id);
    const domain = host.head().domains.savepoints;
    assert.notEqual(domain.epoch, 'ep_00000000');
    assert.match(domain.epoch, /^ep_[0-9a-z]{8}$/);
    assert.deepEqual(Object.keys(domain.points), [saved.id], 'the save it restored to stays; the one made after it is faded away');
    assert.equal(domain.points[early.id], undefined);
    assert.deepEqual(domain.points[saved.id], saved, 'the descriptor is the archived one');
    const record = domain.returns[prepared.return];
    assert.equal(record.status, 'complete');
    assert.deepEqual(record.deathEvents, DEATH);
    assert.deepEqual(record.batchResult, BATCH);
    assert.equal(record.snapshot, saved.id);
    assert.deepEqual(record.target, saved.target);
    assert.equal(record.oldEpoch, 'ep_00000000');
    assert.equal(record.newEpoch, domain.epoch);
    assert.deepEqual(record.faded, { after: saved.target, through: record.restoreAt }, 'the faded interval is (target, restore]');
    assert.equal(record.memory, 'deja-vu');
    assert.match(record.cue, /^cu_[0-9a-z]{8}$/);
    // The restore block starts where the head was, and the receipt says what happened.
    const carrier = host.ctx.chat.at(-1).extra.storySuite;
    const receipt = carrier.receipts.find(each => each.type === 'savepoint.restore');
    assert.equal(receipt.cause, 'system');
    assert.deepEqual(receipt.data.v2.result, { return: prepared.return, status: 'committed' });
    const span = carrier.spans.find(each => each.id === record.restoreAt.block);
    assert.deepEqual(span.boundaries[0].cursor, record.restoreAt);
    assert.equal(span.operation.type, 'savepoint.restore');
    assert.deepEqual(span.operation.payload, { snapshot: saved.id, deathEvent: DEATH[0], prepared: prepared.prepared });
    assert.equal(span.guard.owner, 'story-block');
    assert.equal(carrier.receipts.at(-1).type, 'savepoint.complete');
    // A second death can use the same save: it is still eligible, in the new epoch.
    await cmd(host, 'tl.xp', { amount: 7 });
    const again = await restore(host, saved.id, { batch: { id: 'br_batch002', hash: 'c'.repeat(64) }, events: ['ev_death002'] });
    assert.equal(again.activated.status, 'complete', again.prepared.message);
    const twice = host.head().domains.savepoints;
    assert.equal(Object.keys(twice.returns).length, 2, 'both returns are kept: the audit');
    assert.notEqual(twice.epoch, domain.epoch);
    assert.equal(host.head().domains.progress.xp, 40);
    assert.deepEqual(host.store.problems(), []);
});

test('story claims go back to the saved set and the proof of the faded story is no longer active', async t => {
    const { host, saved, proofsAtSave } = await story(t);
    assert.deepEqual(Object.keys(host.head().meta.claims).sort().filter(key => ['early', 'late'].includes(key)), ['early', 'late']);
    const shown = host.sdk.query('story.evidence', {}).map(proof => proof.id);
    assert.equal(shown.length, proofsAtSave.length + 1, 'the late acceptance is active on the dead timeline');
    await restore(host, saved.id);
    const meta = host.head().meta;
    assert.equal(Object.hasOwn(meta.claims, 'early'), true);
    assert.equal(Object.hasOwn(meta.claims, 'late'), false);
    assert.deepEqual(host.sdk.query('story.evidence', {}).map(proof => proof.id), proofsAtSave, 'the proof the dead timeline gave is not active; the earlier proof is');
    assert.equal(Object.keys(meta.proofs).length, proofsAtSave.length);
    // The claim may be taken again on the restored timeline.
    assert.equal((await host.sdk.command('tl.claim', { key: 'late' })).ok, true);
});

test('a restore is the same after a rebuild and after a reload from the chat file', async t => {
    const { host, saved } = await story(t);
    await restore(host, saved.id);
    await cmd(host, 'tl.xp', { amount: 1 });
    const live = clone(host.head());
    host.store.rebuild();
    assert.deepEqual(clone(host.head()), live);
    const fresh = await createHost({ modules: [rulesModule(), nativeModule().def, director()], st: { chat: clone(host.ctx.chat) } });
    t.after(() => fresh.close());
    assert.deepEqual(clone(fresh.head()), live, 'a new store over a copy of the chat');
    assert.deepEqual(fresh.store.problems(), []);
});

test('an unauthorized or forged token is refused: no capability, a copy of it, a command, an asserted token', async t => {
    const { host, saved } = await story(t);
    const rival = { id: 'rival', name: 'Rival', version: '1.0.0', commands: { 'rival.restore'(ctx, payload) { return ctx.call('savepoint.restore', payload); } } };
    await host.sdk.registerModule(rival);
    const head = await host.sdk.timeline.head();
    const input = { snapshot: saved.id, deathEvents: DEATH, batchResult: BATCH, expectedHead: head.headHash };
    const before = clone(host.head());
    const real = host.timeline.capability;
    const forgeries = [undefined, null, {}, { capability: {} }, { capability: null }, { ...real }, { capability: { ...real } }, Object.freeze({ timeline: 'story-block' }), 'story-block', true, { capability: real.timeline }];
    for (const forged of forgeries) {
        for (const [method, args] of [['prepare', input], ['activate', { prepared: 'pp_forged001', expectedHead: head.headHash }], ['abort', { prepared: 'pp_forged001' }], ['nativeEvent', {}], ['registerParticipant', {}]]) {
            const result = await host.sdk.timeline[method](args, forged);
            assert.equal(result.ok, false, `${method} with ${JSON.stringify(forged)}`);
            assert.equal(result.code, 'REFUSED', `${method} with ${JSON.stringify(forged)}`);
        }
        assert.equal((await host.sdk.timeline.recover(forged)).code, 'REFUSED');
    }
    assert.equal((await host.sdk.timeline.nativeMutation({})).code, 'REFUSED', 'only the participant\'s own handle makes a native mutation');
    // The public methods that need no authority do not carry any: a make of another kind is refused.
    assert.equal((await host.sdk.timeline.make({ kind: 'initial' }, { capability: {} })).code, 'REFUSED');
    // savepoint.restore is no command: not from the page (internal), not from any cause, not from a module.
    for (const cause of ['ui', 'story', 'system']) {
        const result = host.bus.command('savepoint.restore', { snapshot: saved.id, deathEvent: DEATH[0], prepared: 'pp_forged001' }, { cause });
        assert.equal(result.code, 'REFUSED', cause);
    }
    assert.equal((await host.sdk.command('savepoint.restore', { snapshot: saved.id, deathEvent: DEATH[0], prepared: 'pp_forged001' })).code, 'REFUSED');
    assert.equal(host.bus.command('rival.restore', { snapshot: saved.id, deathEvent: DEATH[0], prepared: 'pp_forged001' }, { cause: 'system' }).code, 'REFUSED');
    // A token read out of the archive is no better: the real prepared token, asked for without the capability.
    const prepared = await host.timeline.host.prepare(input);
    assert.equal(prepared.ok, true, prepared.message);
    assert.equal((await host.sdk.timeline.activate({ prepared: prepared.prepared, expectedHead: head.headHash })).code, 'REFUSED');
    assert.equal((await host.sdk.timeline.activate({ prepared: prepared.prepared, expectedHead: head.headHash }, { capability: { ...real } })).code, 'REFUSED');
    assert.equal(host.bus.command('savepoint.restore', { snapshot: saved.id, deathEvent: DEATH[0], prepared: prepared.prepared }, { cause: 'system' }).code, 'REFUSED');
    assert.equal(host.ctx.chatMetadata.storySuite.timeline.journal[prepared.prepared].phase, 'prepared', 'none of it touched the prepared restore');
    // An unknown token with the real capability is NOT_FOUND; a malformed one is INVALID.
    assert.equal((await host.timeline.host.activate({ prepared: 'pp_unknown01', expectedHead: head.headHash })).code, 'NOT_FOUND');
    assert.equal((await host.timeline.host.activate({ prepared: 3, expectedHead: head.headHash })).code, 'INVALID');
    assert.equal((await host.timeline.host.activate({ prepared: prepared.prepared })).code, 'INVALID');
    assert.equal((await host.timeline.host.abort({ prepared: 'pp_unknown01' })).code, 'NOT_FOUND');
    assert.deepEqual(clone(host.head()), before, 'the story did not move');
    // A save point cannot be read as a token either: the journal entry of a make is no restore.
    const makeEntry = host.timeline.host.journal().find(entry => entry.kind === 'make');
    assert.equal((await host.timeline.host.activate({ prepared: makeEntry.id, expectedHead: head.headHash })).code, 'NOT_FOUND');
});

test('prepare: shape, then the head (STALE), the point (NOT_FOUND), the batch (CONFLICT); an identical retry returns the original', async t => {
    const { host, saved } = await story(t);
    const head = await host.sdk.timeline.head();
    const good = { snapshot: saved.id, deathEvents: DEATH, batchResult: BATCH, expectedHead: head.headHash };
    const bad = async patch => (await host.timeline.host.prepare({ ...good, ...patch })).code;
    assert.equal(await bad({ snapshot: undefined }), 'INVALID');
    assert.equal(await bad({ deathEvents: [] }), 'INVALID');
    assert.equal(await bad({ deathEvents: ['a', 'a'] }), 'INVALID');
    assert.equal(await bad({ batchResult: { id: 'nope', hash: BATCH.hash } }), 'INVALID');
    assert.equal(await bad({ batchResult: { id: BATCH.id } }), 'INVALID');
    assert.equal(await bad({ expectedHead: 'abc' }), 'INVALID');
    assert.equal(await bad({ surprise: true }), 'INVALID');
    assert.equal(await bad({ snapshot: 'sn_nothing0' }), 'NOT_FOUND');
    assert.equal(await bad({ expectedHead: 'f'.repeat(64) }), 'STALE');
    const first = await host.timeline.host.prepare(good);
    assert.equal(first.ok, true, first.message);
    assert.match(first.prepared, /^pp_[0-9a-z]{8}$/);
    assert.match(first.return, /^rt_[0-9a-z]{8}$/);
    assert.match(first.manifestHash, /^[0-9a-f]{64}$/);
    assert.deepEqual(await host.timeline.host.prepare(good), first, 'the same prepare again is the same answer');
    assert.equal(await bad({ batchResult: { id: BATCH.id, hash: 'd'.repeat(64) } }), 'CONFLICT', 'the same batch with another hash');
    assert.equal(await bad({ snapshot: saved.id, deathEvents: ['ev_other0001'] }), 'CONFLICT', 'the same batch with other deaths');
    // Preparing changed nothing the reader sees, and the head is the same.
    assert.equal((await host.sdk.timeline.head()).headHash, head.headHash);
    assert.deepEqual(host.sdk.query('savepoint.list', {}).map(point => point.id), [saved.id]);
});

test('prepare writes the durable record: the manifest, the pinned batch result and the story as it was', async t => {
    const { host, native, saved } = await story(t);
    const dead = slice(host.head());
    const head = await host.sdk.timeline.head();
    const prepared = await host.timeline.host.prepare({ snapshot: saved.id, deathEvents: DEATH, batchResult: BATCH, expectedHead: head.headHash });
    const entry = host.timeline.host.journal().find(each => each.id === prepared.prepared);
    assert.equal(entry.phase, 'prepared');
    assert.equal(entry.manifestHash, prepared.manifestHash);
    assert.equal(hashJson(entry.manifest), prepared.manifestHash);
    assert.equal(entry.manifest.snapshot, saved.id);
    assert.equal(entry.manifest.payloadHash, saved.payloadHash);
    assert.deepEqual(entry.manifest.participants, saved.participants);
    assert.deepEqual(Object.keys(entry.manifest.domains).sort(), Object.keys(host.head().domains).sort(), 'every domain is listed');
    assert.equal(entry.manifest.domains.party.source, 'saved');
    assert.equal(entry.manifest.domains.savepoints.source, 'host');
    assert.equal(entry.participants[NATIVE].prepared !== null, true);
    assert.equal(native.native.calls.some(call => call.name === 'prepare'), true);
    assert.equal(native.native.calls.some(call => call.name === 'activate'), false, 'nothing is switched yet');
    assert.deepEqual(native.native.store.dossiers.tavi, { trust: 99 }, 'the reader still sees the dead timeline');
    assert.deepEqual(slice(host.head()), dead);
    // The pin: the batch result, the prepared manifest, and the story the restore will replace.
    const pin = host.timeline.host.pin(BATCH.id);
    assert.equal(pin.hash, BATCH.hash);
    assert.equal(pin.return, prepared.return);
    assert.equal(pin.prepared, prepared.prepared);
    assert.equal(pin.manifestHash, prepared.manifestHash);
    assert.deepEqual(pin.deathEvents, DEATH);
    assert.equal(pin.preRestore.payload.domains.progress.xp, 140, 'the death domain as it stood when the batch was sealed');
    await host.timeline.host.activate({ prepared: prepared.prepared, expectedHead: head.headHash });
    assert.equal(host.head().domains.progress.xp, 40);
    const kept = host.timeline.host.pin(BATCH.id);
    assert.equal(kept.preRestore.payload.domains.progress.xp, 140, 'after the restore the original result is still retrievable');
    assert.equal(kept.preRestore.payload.domains.npc.meters.tavi, 8);
    assert.equal(host.timeline.host.pin('br_nothing01'), null);
});

test('a stale head is STALE: at prepare, at activate (the preparation is aborted), and a make in between moves it', async t => {
    const { host, native, saved } = await story(t);
    const head = await host.sdk.timeline.head();
    const input = { snapshot: saved.id, deathEvents: DEATH, batchResult: BATCH, expectedHead: head.headHash };
    const prepared = await host.timeline.host.prepare(input);
    assert.equal(prepared.ok, true);
    await cmd(host, 'tl.xp', { amount: 1 });
    const stale = await host.timeline.host.activate({ prepared: prepared.prepared, expectedHead: head.headHash });
    assert.equal(stale.code, 'STALE');
    assert.equal(host.timeline.host.journal().find(each => each.id === prepared.prepared).phase, 'aborted');
    assert.equal(native.native.calls.some(call => call.name === 'abort'), true, 'the participant was told to release its precommit work');
    assert.equal(host.head().domains.progress.xp, 141, 'nothing was restored');
    assert.equal((await host.timeline.host.activate({ prepared: prepared.prepared, expectedHead: head.headHash })).code, 'REFUSED', 'an aborted token is dead');
    // A stale prepare is not prepared at all.
    assert.equal((await host.timeline.host.prepare(input)).code, 'STALE');
    // The right head again: the same batch can be prepared anew (the aborted attempt does not hold it).
    const fresh = await host.sdk.timeline.head();
    const again = await host.timeline.host.prepare({ ...input, expectedHead: fresh.headHash });
    assert.equal(again.ok, true, again.message);
    assert.notEqual(again.prepared, prepared.prepared);
    // activate's own expectedHead must be the one that was prepared.
    assert.equal((await host.timeline.host.activate({ prepared: again.prepared, expectedHead: head.headHash })).code, 'STALE');
    assert.equal(host.head().domains.progress.xp, 141);
    // A make between prepare and activate moves the head.
    const third = await host.timeline.host.prepare({ ...input, expectedHead: (await host.sdk.timeline.head()).headHash });
    await host.sdk.timeline.make({ kind: 'manual', name: 'Between' });
    assert.equal((await host.timeline.host.activate({ prepared: third.prepared, expectedHead: third.ok ? (await host.sdk.timeline.head()).headHash : '' })).code, 'STALE');
});

test('missing native bytes give SNAPSHOT_UNAVAILABLE: the archive\'s, a participant\'s, a missing or changed participant', async t => {
    const { host, native, saved } = await story(t);
    const attempt = async () => {
        const head = await host.sdk.timeline.head();
        return host.timeline.host.prepare({ snapshot: saved.id, deathEvents: DEATH, batchResult: BATCH, expectedHead: head.headHash });
    };
    const before = slice(host.head());
    // The participant's checkpoint bytes are gone: the participant says so, nothing is restored, the others are released.
    native.native.missing.add(saved.participants[0].checkpoint);
    const gone = await attempt();
    assert.equal(gone.code, 'SNAPSHOT_UNAVAILABLE');
    assert.match(gone.message, /tl-native/);
    native.native.missing.clear();
    assert.equal(host.timeline.host.journal().findLast(entry => entry.kind === 'restore').phase, 'aborted');
    // The archived payload is gone, or was changed.
    const archive = host.ctx.chatMetadata.storySuite.timeline;
    const bytes = archive.payloads[saved.payloadHash];
    delete archive.payloads[saved.payloadHash];
    assert.equal((await attempt()).code, 'SNAPSHOT_UNAVAILABLE');
    archive.payloads[saved.payloadHash] = bytes;
    bytes.payload.domains.progress.xp = 1000000;
    const tampered = await attempt();
    assert.equal(tampered.code, 'SNAPSHOT_UNAVAILABLE', 'bytes that do not hash to the descriptor\'s payloadHash are not bytes');
    bytes.payload.domains.progress.xp = 40;
    // A participant the save held is not registered (a host without the module) or reads another schema.
    const lonely = await createHost({ modules: [rulesModule(), director()], st: { chat: clone(host.ctx.chat) } });
    t.after(() => lonely.close());
    lonely.ctx.chatMetadata = clone(host.ctx.chatMetadata);
    await lonely.turn.onChatChanged();
    const alone = await lonely.sdk.timeline.head();
    const lack = await lonely.timeline.host.prepare({ snapshot: saved.id, deathEvents: DEATH, batchResult: BATCH, expectedHead: alone.headHash });
    assert.equal(lack.code, 'SNAPSHOT_UNAVAILABLE');
    assert.match(lack.message, /tl-native.*not registered/);
    const other = nativeModule();
    other.def.participant.schema = 2;
    const odd = await createHost({ modules: [rulesModule(), other.def, director()], st: { chat: clone(host.ctx.chat) } });
    t.after(() => odd.close());
    odd.ctx.chatMetadata = clone(host.ctx.chatMetadata);
    await odd.turn.onChatChanged();
    const misread = await odd.timeline.host.prepare({ snapshot: saved.id, deathEvents: DEATH, batchResult: BATCH, expectedHead: (await odd.sdk.timeline.head()).headHash });
    assert.equal(misread.code, 'SNAPSHOT_UNAVAILABLE');
    assert.match(misread.message, /schema/);
    // A participant that arrived after the save has native state the save never held.
    const late = nativeModule({ id: 'tl-late' });
    late.def.domains = {};
    await host.sdk.registerModule(late.def);
    const extra = await attempt();
    assert.equal(extra.code, 'SNAPSHOT_UNAVAILABLE');
    assert.match(extra.message, /tl-late/);
    assert.deepEqual(slice(host.head()), before, 'in every case the story stayed where it was');
    assert.equal(host.registry.restore().state, 'idle');
});

test('bytes that vanish between prepare and activate abort the restore (SNAPSHOT_UNAVAILABLE)', async t => {
    const { host, saved } = await story(t);
    const head = await host.sdk.timeline.head();
    const prepared = await host.timeline.host.prepare({ snapshot: saved.id, deathEvents: DEATH, batchResult: BATCH, expectedHead: head.headHash });
    delete host.ctx.chatMetadata.storySuite.timeline.payloads[saved.payloadHash];
    const result = await host.timeline.host.activate({ prepared: prepared.prepared, expectedHead: head.headHash });
    assert.equal(result.code, 'SNAPSHOT_UNAVAILABLE');
    assert.equal(host.head().domains.progress.xp, 140);
    assert.equal(host.timeline.host.journal().find(each => each.id === prepared.prepared).phase, 'aborted');
});

test('abort: before the commit it releases everything and is idempotent; after the commit it is REFUSED', async t => {
    const { host, native, saved } = await story(t);
    const head = await host.sdk.timeline.head();
    const prepared = await host.timeline.host.prepare({ snapshot: saved.id, deathEvents: DEATH, batchResult: BATCH, expectedHead: head.headHash });
    assert.deepEqual(await host.timeline.host.abort({ prepared: prepared.prepared }), { ok: true, status: 'aborted' });
    assert.deepEqual(await host.timeline.host.abort({ prepared: prepared.prepared }), { ok: true, status: 'aborted' }, 'again');
    assert.equal(native.native.calls.filter(call => call.name === 'abort').length, 1);
    assert.equal((await host.timeline.host.abort({})).code, 'INVALID');
    assert.equal((await host.timeline.host.activate({ prepared: prepared.prepared, expectedHead: head.headHash })).code, 'REFUSED');
    assert.equal(host.head().domains.progress.xp, 140);
    // Prepared anew, activated: abort is too late.
    const again = await host.timeline.host.prepare({ snapshot: saved.id, deathEvents: DEATH, batchResult: BATCH, expectedHead: head.headHash });
    const done = await host.timeline.host.activate({ prepared: again.prepared, expectedHead: head.headHash });
    assert.equal(done.status, 'complete');
    assert.equal((await host.timeline.host.abort({ prepared: again.prepared })).code, 'REFUSED');
    // Activating a completed restore again answers what it did and does nothing.
    const calls = native.native.calls.length;
    assert.deepEqual(await host.timeline.host.activate({ prepared: again.prepared, expectedHead: head.headHash }), done);
    assert.equal(native.native.calls.length, calls);
    assert.equal(Object.keys(host.head().domains.savepoints.returns).length, 1);
});

test('participants that cannot switch leave the restore committed and the barrier up; a retry or recover completes it', async t => {
    const { host, native, saved, atSave } = await story(t);
    const head = await host.sdk.timeline.head();
    const prepared = await host.timeline.host.prepare({ snapshot: saved.id, deathEvents: DEATH, batchResult: BATCH, expectedHead: head.headHash });
    native.native.fail.add('activate');
    const pending = await host.timeline.host.activate({ prepared: prepared.prepared, expectedHead: head.headHash });
    assert.deepEqual(pending, { ok: true, return: prepared.return, status: 'participants-pending' });
    // The story is restored; everything else waits for the participant.
    assert.equal(host.registry.restore().state, 'pending');
    assert.equal(host.head().domains.progress.xp, 40, 'the story is restored (when every module is asked: after the barrier)');
    assert.deepEqual(host.sdk.modules().map(module => module.status), ['restore-pending', 'restore-pending', 'restore-pending', 'restore-pending']);
    assert.equal((await host.sdk.timeline.head()).code, 'RESTORE_PENDING');
    assert.deepEqual(await host.sdk.timeline.status(), { ok: true, state: 'pending', return: prepared.return, participants: [] });
    assert.equal((await host.sdk.command('tl.xp', { amount: 1 })).code, 'RESTORE_PENDING');
    assert.equal((await host.sdk.timeline.make({ kind: 'manual' })).code, 'RESTORE_PENDING');
    assert.equal((await host.timeline.host.prepare({ snapshot: saved.id, deathEvents: ['ev_other0001'], batchResult: { id: 'br_batch009', hash: 'e'.repeat(64) }, expectedHead: head.headHash })).code, 'RESTORE_PENDING');
    assert.equal(host.ctx.chat.at(-1).extra.storySuite.receipts.at(-1).type, 'savepoint.restore', 'not complete yet');
    assert.equal(host.timeline.host.journal().find(each => each.id === prepared.prepared).phase, 'participants-pending');
    // The participant is back: a retry finishes it, once.
    native.native.fail.clear();
    const done = await host.timeline.host.activate({ prepared: prepared.prepared, expectedHead: head.headHash });
    assert.deepEqual(done, { ok: true, return: prepared.return, status: 'complete' });
    assert.equal(host.registry.restore().state, 'idle');
    assert.deepEqual(slice(host.head()), atSave);
    assert.equal((await host.sdk.command('tl.xp', { amount: 1 })).ok, true, 'the story goes on');
    assert.equal(host.sdk.modules().every(module => module.status === 'ready'), true);
    assert.deepEqual(native.native.store.dossiers, { tavi: { trust: 3 } });
    assert.equal(host.head().domains.savepoints.returns[prepared.return].status, 'complete');
    assert.equal(native.native.calls.filter(call => call.name === 'activate' && !call.fail).length >= 2, true);
});

test('recover finishes a restore whose participants were pending, and aborts a prepare nobody activated', async t => {
    const { host, native, saved } = await story(t);
    const head = await host.sdk.timeline.head();
    const prepared = await host.timeline.host.prepare({ snapshot: saved.id, deathEvents: DEATH, batchResult: BATCH, expectedHead: head.headHash });
    native.native.fail.add('activate');
    await host.timeline.host.activate({ prepared: prepared.prepared, expectedHead: head.headHash });
    native.native.fail.clear();
    assert.deepEqual(await host.timeline.host.recover(), { ok: true, state: 'idle', return: null });
    assert.equal(host.registry.restore().state, 'idle');
    assert.equal(host.head().domains.savepoints.returns[prepared.return].status, 'complete');
    assert.deepEqual(native.native.store.dossiers, { tavi: { trust: 3 } });
    // recover with nothing to do does nothing.
    const writes = host.ctx.chat.map(message => JSON.stringify(message.extra?.storySuite ?? null));
    assert.deepEqual(await host.timeline.host.recover(), { ok: true, state: 'idle', return: null });
    assert.deepEqual(host.ctx.chat.map(message => JSON.stringify(message.extra?.storySuite ?? null)), writes);
});

test('modules with guarded blocks in the story: the barrier turns them off while it is up, the restore and the return stand when it drops', async t => {
    const native = nativeModule();
    const host = await createHost({ modules: [rulesModule(), native.def] });
    t.after(() => host.close());
    await host.send('Go.', reply('A.', ['+ coin 10']));
    // A guarded block of another module before the save (its epoch: the timeline has none yet, so any will do) and one after it.
    await cmd(host, 'tl.guarded', { epoch: 'ep_00000000' });
    const saved = (await host.sdk.timeline.make({ kind: 'manual', name: 'After the guard' })).snapshot;
    const atSave = slice(host.head());
    await host.send('Go.', reply('B.', ['+ coin 5']));
    await cmd(host, 'tl.guarded', { epoch: 'ep_00000000' });
    assert.equal(host.head().domains.progress.xp, 2);
    const head = await host.sdk.timeline.head();
    const prepared = await host.timeline.host.prepare({ snapshot: saved.id, deathEvents: DEATH, batchResult: BATCH, expectedHead: head.headHash });
    assert.equal(prepared.ok, true, prepared.message);
    native.native.fail.add('activate');
    const pending = await host.timeline.host.activate({ prepared: prepared.prepared, expectedHead: head.headHash });
    assert.equal(pending.status, 'participants-pending');
    assert.equal(host.registry.restore().state, 'pending');
    // With the barrier up, the module is held and its guarded blocks are not asked: the head is not whole, and nothing reads it.
    assert.equal((await host.sdk.timeline.head()).code, 'RESTORE_PENDING');
    // Recovery within the run goes by the journal, not by the head the barrier has made partial.
    native.native.fail.clear();
    assert.deepEqual(await host.timeline.host.recover(), { ok: true, state: 'idle', return: null });
    assert.equal(host.registry.restore().state, 'idle');
    assert.deepEqual(slice(host.head()), atSave, 'the guarded block before the save is back with the module');
    assert.equal(host.head().domains.progress.xp, 1);
    assert.equal(host.head().domains.savepoints.returns[prepared.return].status, 'complete');
    assert.deepEqual(host.store.problems(), []);
    host.store.rebuild();
    assert.deepEqual(slice(host.head()), atSave);
    assert.deepEqual(host.store.problems(), []);
});

test('the host\'s blocks are told like any commit: the restore, the completion, a forgotten point', async t => {
    const { host, saved } = await story(t);
    const told = [];
    host.sdk.on('committed', ({ receipt }) => told.push(receipt.type));
    const other = (await host.sdk.timeline.make({ kind: 'manual', name: 'Another' })).snapshot;
    assert.equal((await host.sdk.timeline.forget({ snapshot: other.id })).ok, true);
    assert.equal((await restore(host, saved.id)).activated.status, 'complete');
    assert.deepEqual(told, ['savepoint.make', 'savepoint.forget', 'savepoint.restore', 'savepoint.complete']);
});
