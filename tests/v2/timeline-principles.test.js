// The timeline's rules as principles, each tested over every place it applies (docs/v2/TIMELINE.md):
//  1. one helper makes things durable: a save that fails at any write position is never reported as a success, never lets a
//     native change get ahead of its journal, and never announces a block the chat file does not have;
//  2. an operation is bound to the chat it began in: when another chat is open it answers STALE and touches nothing there;
//  3. the host's savepoints are reserved as a branch: the domain, anything below it, and anything that holds it (/domains, the root);
//  4. the participants are looked at again in the section that commits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { crash } from '../../src/v2/timeline/index.js';
import { definitionWarnings } from '../../src/v2/registry.js';
import { BATCH, DEATH, NATIVE, NPC, clone, nativeModule, reload, rulesModule, seal, track } from './helpers/timeline.js';

const reply = (text, lines = []) => (lines.length ? `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
const cmd = async (host, type, payload = {}) => assert.equal((await host.sdk.command(type, payload)).ok, true, type);

// A story with a save and a dead timeline on top of it; `disk` is what the last save wrote; `flushes` counts the timeline's flushes
// and fails the one numbered `failing` (1 based). `told` lists the savepoint receipts announced, each with whether the file had it.
const mocked = new WeakSet();
async function world(t, { failing = 0, scenario = null, wrap = null, more = false, onFail = null } = {}) {
    if (!mocked.has(t)) {
        mocked.add(t);
        t.mock.timers.enable({ apis: ['setTimeout'] });
        t.mock.method(console, 'warn', () => {});
    }
    const native = nativeModule();
    const w = { native, breaches: [] };
    if (scenario) watch(w, scenario);
    if (wrap) wrap(native);
    const hook = { at: async phase => { await hook.on?.(phase); } };
    const host = await createHost({ modules: [rulesModule(), native.def], timelineFaults: hook });
    t.after(() => host.close());
    await host.send('Go.', reply('A.', ['+ coin 10']));
    await cmd(host, 'tl.xp', { amount: 40 });
    const saved = (await host.sdk.timeline.make({ kind: 'manual', name: 'Save' })).snapshot;
    // (`more`: the work after the save is on a reply of its own, which a test can delete)
    if (more) await host.send('More.', reply('B.'));
    const disk = track(host);
    w.disk = disk;
    await cmd(host, 'tl.xp', { amount: 100 });
    native.native.edit(state => { state.dossiers.tavi.trust = 99; });
    await seal(host);
    const counter = { n: 0, failing, failed: false };
    const flush = host.store.flush.bind(host.store);
    host.store.flush = async (...args) => {
        counter.n += 1;
        if (counter.n === counter.failing) {
            counter.failed = true;
            await onFail?.(host);
            throw new Error('the disk is full (test)');
        }
        return flush(...args);
    };
    const told = [];
    host.events.on('committed', ({ receipt }) => told.push({
        type: receipt.type, id: receipt.id, onDisk: JSON.stringify(disk.image.chat).includes(receipt.id),
        present: host.store.receipts().some(each => each.receipt.id === receipt.id),
    }));
    return Object.assign(w, { host, hook, saved, disk, counter, told, modules: () => [rulesModule(), native.def] });
}
const journalOf = disk => Object.values(disk.image.metadata.storySuite?.timeline?.journal ?? {});
const diskHas = (disk, type) => JSON.stringify(disk.image.chat).includes(`"type":"${type}"`);

// ---- 1. durability, at every write position ------------------------------------------------------------------------------

// What each kind of operation does, and what the file must hold once it is told done.
const SCENARIOS = {
    'a save point': {
        run: ({ host }) => host.sdk.command('savepoint.make', { name: 'Sweep' }),
        done: ({ disk }) => diskHas(disk, 'savepoint.make') && journalOf(disk).some(entry => entry.kind === 'make' && entry.phase === 'committed'),
    },
    'a restore': {
        run: async ({ host, saved }) => {
            const head = await host.sdk.timeline.head();
            const prepared = await host.timeline.host.prepare({ snapshot: saved.id, deathEvents: DEATH, batchResult: BATCH, expectedHead: head.headHash });
            if (!prepared.ok) return prepared;
            return host.timeline.host.activate({ prepared: prepared.prepared, expectedHead: head.headHash });
        },
        done: ({ disk }) => diskHas(disk, 'savepoint.complete') && journalOf(disk).some(entry => entry.kind === 'restore' && entry.phase === 'complete'),
    },
    'a native event': {
        run: async ({ host }) => {
            const head = await host.sdk.timeline.head();
            return host.timeline.host.nativeEvent({ event: 'ev_sweep0001', participant: NATIVE, kind: 'confirmed-death', npc: NPC, expectedHead: head.headHash });
        },
        done: ({ disk }) => journalOf(disk).some(entry => entry.kind === 'native-event' && entry.phase === 'done'),
    },
    'a native mutation': {
        run: async ({ host, native }) => {
            const head = await host.sdk.timeline.head();
            return native.native.handle.nativeMutation({
                participant: NATIVE, source: host.store.sourceAt(host.store.headIndex()), expectedHead: head.headHash,
                prepare: async () => {
                    const before = native.native.checkpoint();
                    const next = clone(native.native.store);
                    next.dossiers.tavi.trust = 7;
                    const after = native.native.keep(next);
                    native.native.prepared.pr_sweep0001 = { checkpoint: after.checkpoint };
                    return { before: { module: NATIVE, ...before, schema: 1 }, after: { module: NATIVE, ...after, schema: 1 }, prepared: 'pr_sweep0001' };
                },
            });
        },
        done: ({ disk }) => journalOf(disk).some(entry => entry.kind === 'native-mutation' && entry.phase === 'done'),
    },
};

// The participant is never asked to change before the file has the journal (or the restore) that says it should.
function watch(w, scenario) {
    const { native } = w;
    const wrap = (name, ok) => {
        const real = native.def.participant[name];
        native.def.participant[name] = input => {
            if (!ok(input)) w.breaches.push(`${name} before its journal was saved`);
            return real(input);
        };
    };
    if (scenario === 'a native event') wrap('applyEvent', input => journalOf(w.disk).some(entry => entry.kind === 'native-event' && entry.event === input.event));
    if (scenario === 'a native mutation') wrap('activate', input => journalOf(w.disk).some(entry => entry.kind === 'native-mutation' && entry.preparedId === input.prepared));
    if (scenario === 'a restore') wrap('activate', () => diskHas(w.disk, 'savepoint.restore'));
}

for (const [name, scenario] of Object.entries(SCENARIOS)) {
    test(`${name}: a save that fails at any of its write positions is never told as done, announces nothing the file lacks, and the journal leads the participant`, async t => {
        // How many flushes it makes when nothing fails.
        const dry = await world(t, { scenario: name });
        const clean = await scenario.run(dry);
        assert.equal(clean.ok, true, clean.message);
        assert.equal(scenario.done(dry), true, 'told done, and the file has it');
        assert.deepEqual(dry.breaches, []);
        const total = dry.counter.n;
        assert.equal(total >= 2, true, `${name} writes at several positions (${total})`);
        for (let at = 1; at <= total; at++) {
            const w = await world(t, { failing: at, scenario: name });
            const result = await scenario.run(w);
            assert.equal(w.counter.failed, true, `flush ${at} was reached`);
            if (result.ok) assert.equal(scenario.done(w), true, `flush ${at} failed, and the operation said ok but the file does not have it`);
            assert.deepEqual(w.breaches, [], `flush ${at}: a participant changed ahead of its journal`);
            for (const each of w.told) assert.equal(each.onDisk, true, `flush ${at}: ${each.type} was announced before the file had it`);
            // Nothing is left that a restart or a retry cannot finish: with the disk back, recovery settles it.
            const again = await w.host.timeline.recover();
            assert.equal(again.ok, true, `flush ${at}: ${again.message}`);
            assert.equal((await w.host.sdk.timeline.status()).state, 'idle', `flush ${at}`);
            assert.equal(w.host.registry.restore().state, 'idle', `flush ${at}`);
            for (const each of w.told) assert.equal(each.onDisk, true, `flush ${at}: ${each.type} was announced before the file had it`);
        }
    });
}

test('a native event whose journal could not be saved: the retry saves the journal before the participant changes, so a crash inside applyEvent leaves it behind', async t => {
    let crashing = false;
    const w = await world(t, { failing: 1, wrap: native => {
        const real = native.def.participant.applyEvent;
        native.def.participant.applyEvent = args => { const answer = real(args); if (crashing) throw crash(); return answer; };
    } });
    const { host, native, hook, disk } = w;
    const head = await host.sdk.timeline.head();
    const input = { event: 'ev_crash0001', participant: NATIVE, kind: 'confirmed-death', npc: NPC, expectedHead: head.headHash };
    const first = await host.timeline.host.nativeEvent(input);
    assert.equal(first.ok, false);
    assert.equal(first.code, 'FAILED');
    assert.equal(native.native.calls.some(call => call.name === 'applyEvent'), false);
    crashing = true;
    void hook;
    await assert.rejects(host.timeline.host.nativeEvent(input), error => error.message.includes('simulated crash'));
    assert.equal(native.native.store.applied.includes('ev_crash0001'), true, 'the participant changed');
    assert.equal(journalOf(disk).some(entry => entry.kind === 'native-event' && entry.event === 'ev_crash0001'), true, 'and the file has the journal of it');
    crashing = false;
    const again = await reload(createHost, clone(disk.image), w.modules());
    t.after(() => again.close());
    assert.equal(again.registry.restore().state, 'idle');
    assert.equal((await again.sdk.timeline.status()).state, 'idle');
    assert.equal(again.timeline.host.journal().find(entry => entry.kind === 'native-event').phase, 'done');
});

test('the last save of a native change failing is a failure, not a success, and the same event is not acknowledged until the file has it', async t => {
    const dry = await world(t);
    const probe = SCENARIOS['a native event'];
    assert.equal((await probe.run(dry)).ok, true);
    const w = await world(t, { failing: dry.counter.n });
    const result = await probe.run(w);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'FAILED');
    assert.equal(w.native.native.store.applied.includes('ev_sweep0001'), true, 'the participant did change');
    w.counter.failing = 0;
    const head = await w.host.sdk.timeline.head();
    void head;
    const retried = await w.host.timeline.host.nativeEvent({ event: 'ev_sweep0001', participant: NATIVE, kind: 'confirmed-death', npc: NPC, expectedHead: (await w.host.sdk.timeline.head()).headHash });
    assert.equal(retried.ok, true, retried.message);
    assert.equal(probe.done(w), true, 'acknowledged once saved');
});

test('savepoint.complete is announced after the file has it, and not at all while the save fails', async t => {
    const dry = await world(t);
    assert.equal((await SCENARIOS['a restore'].run(dry)).ok, true);
    const w = await world(t, { failing: dry.counter.n });
    const result = await SCENARIOS['a restore'].run(w);
    assert.equal(result.ok, false);
    assert.equal(w.told.some(each => each.type === 'savepoint.complete'), false, 'not announced');
    w.counter.failing = 0;
    const done = await w.host.timeline.recover();
    assert.equal(done.ok, true);
    const completes = w.told.filter(each => each.type === 'savepoint.complete');
    assert.deepEqual(completes.map(each => each.onDisk), [true]);
});

// ---- 2. an operation is bound to the chat it began in -------------------------------------------------------------------------

const MAKE_PHASES = ['make.reserved', 'make.checkpoint:tl-native', 'make.checkpointed', 'make.archived', 'make.committed'];
const RESTORE_PHASES = [
    'prepare.journaled', 'prepare.participant:tl-native', 'activate.checked', 'activate.committed',
    'activate.participant:tl-native:before', 'activate.participant:tl-native:acked', 'activate.acked',
];
const NATIVE_PHASES = ['native.prepared', 'native.journaled'];

async function switching(t, phase, scenario) {
    const w = await world(t);
    const original = w.host.ctx.chatMetadata;
    const other = { storySuite: {} };
    w.hook.on = at => { if (at === phase) w.host.ctx.chatMetadata = other; };
    const result = await SCENARIOS[scenario].run(w);
    w.host.ctx.chatMetadata = original;
    return { w, result, other };
}

for (const [scenario, phases] of [['a save point', MAKE_PHASES], ['a restore', RESTORE_PHASES], ['a native mutation', NATIVE_PHASES]]) {
    for (const phase of phases) {
        test(`another chat opened at ${phase}: ${scenario} answers STALE and writes nothing to the chat that is open`, async t => {
            const { result, other } = await switching(t, phase, scenario);
            assert.equal(result.ok, false, 'the work of the chat that was left is not told as done');
            assert.equal(result.code, 'STALE', result.message);
            assert.deepEqual(other, { storySuite: {} }, 'the chat that was opened has no archive, no journal, nothing');
        });
    }
}

test('another chat opened at make.archived: no archive is made in it and the left chat keeps an unsettled entry for its own recovery', async t => {
    const { w, result, other } = await switching(t, 'make.archived', 'a save point');
    assert.equal(result.code, 'STALE');
    assert.equal(other.storySuite.timeline, undefined);
    assert.equal(journalOf({ image: { metadata: w.host.ctx.chatMetadata } }).some(entry => entry.kind === 'make' && entry.phase === 'archived'), true);
    assert.equal(w.host.registry.restore().state, 'idle', 'no barrier is left up for the chat that is open');
    // The left chat's own recovery settles it when it is opened again.
    assert.equal((await w.host.timeline.recover()).ok, true);
    assert.equal(journalOf({ image: { metadata: w.host.ctx.chatMetadata } }).some(entry => entry.kind === 'make' && entry.phase === 'archived'), false);
});

// ---- 3. the host's savepoints are reserved as a branch ----------------------------------------------------------------------

const RESERVED = ['', '/domains', '/domains/savepoints', '/domains/savepoints/epoch', '/domains/savepoints/returns/rt_forged01'];

test('a block that is not the host\'s cannot write the savepoints, nor anything that holds them, whatever the op or which end of it names the path', async t => {
    const w = await world(t);
    const { host } = w;
    const rev = host.head().meta.rev + 1;
    const receipt = { id: 'rc_forged001', type: 'x.forge', module: 'rival', cause: 'system', seed: 1, summary: 'x', narrate: false, data: {}, rev };
    const forged = { savepoints: { schema: 2, epoch: 'ep_forged01', points: {}, dayStarts: {}, previousDay: null, returns: { rt_forged01: { id: 'rt_forged01' } }, ruleSettings: {} } };
    const make = (op, path) => ({ op, path, ...(op === 'move' || op === 'copy' ? { from: path } : { value: path === '' ? { domains: forged } : path === '/domains' ? forged : 1 }) });
    const epoch = host.head().domains.savepoints.epoch;
    const attempts = [];
    for (const path of RESERVED) for (const op of ['add', 'replace', 'remove', 'move', 'copy']) attempts.push(make(op, path));
    // (a move or a copy whose far end is elsewhere and whose near end is reserved, and the other way)
    for (const op of ['move', 'copy']) for (const path of RESERVED) {
        attempts.push({ op, from: path, path: '/domains/elsewhere' });
        attempts.push({ op, from: '/domains/elsewhere', path });
    }
    for (const op of attempts) {
        assert.throws(() => host.store.append({ ops: [op, { op: 'replace', path: '/meta/rev', value: rev }], receipt }), /host's own/, JSON.stringify(op));
        const block = { module: 'rival', source: host.store.sourceAt(host.store.headIndex()), guard: null, operation: { type: 'savepoint.make', payload: {} }, recorded: null, result: {} };
        assert.throws(() => host.store.append({ ops: [op, { op: 'replace', path: '/meta/rev', value: rev }], receipt, block }), /host's own/, JSON.stringify(op));
    }
    assert.equal(host.head().domains.savepoints.epoch, epoch, 'the epoch is the one it was');
    assert.equal(Object.keys(host.head().domains.savepoints.returns ?? {}).includes('rt_forged01'), false);
    // An ordinary domain is still an ordinary write.
    assert.doesNotThrow(() => host.store.append({ ops: [{ op: 'add', path: '/domains/elsewhere', value: { x: 1 } }, { op: 'replace', path: '/meta/rev', value: rev }], receipt }));
});

test('forged savepoints in a stored record do not survive a rebuild: the block is off with a Problem, whichever way it writes them', async t => {
    for (const path of RESERVED.filter(each => each !== '' && each !== '/domains/savepoints/epoch')) {
        const w = await world(t);
        const { host } = w;
        await host.send('More.', reply('B.'));
        const before = clone(host.head().domains.savepoints);
        const record = host.ctx.chat.at(-1).extra.storySuite;
        const value = path === '/domains' ? { savepoints: { ...before, epoch: 'ep_forged01', returns: { rt_forged01: { id: 'rt_forged01', status: 'complete' } } } } : { id: 'rt_forged01' };
        record.ops.push({ op: path === '/domains/savepoints' ? 'replace' : 'add', path, value: path === '/domains/savepoints' ? { ...before, epoch: 'ep_forged01' } : value });
        host.store.rebuild();
        assert.equal(host.head().domains.savepoints.epoch, before.epoch, `${path}: the forged epoch is not there`);
        assert.equal(JSON.stringify(host.head().domains.savepoints).includes('rt_forged01'), false, `${path}: nor the forged return`);
        assert.equal(host.store.problems().some(problem => /host's savepoints/.test(problem.why)), true, `${path}: and it is reported`);
    }
});

test('the root and /domains in a stored record are the same: a legacy block that replaces them is reported and not applied', async t => {
    const w = await world(t);
    const { host } = w;
    await host.send('More.', reply('B.'));
    const before = clone(host.head().domains.savepoints);
    for (const op of [{ op: 'replace', path: '', value: { domains: { savepoints: { epoch: 'ep_forged01' } }, meta: { rev: 99 } } }, { op: 'remove', path: '/domains' }]) {
        const record = host.ctx.chat.at(-1).extra.storySuite;
        const saved = clone(record.ops);
        record.ops.push(op);
        host.store.rebuild();
        assert.deepEqual(host.head().domains.savepoints, before, JSON.stringify(op));
        assert.equal(host.store.problems().length > 0, true, JSON.stringify(op));
        record.ops.splice(0, record.ops.length, ...saved);
        host.store.rebuild();
    }
});

// ---- 4. the participants, looked at again where the commit is ------------------------------------------------------------------

const broken = () => ({ id: 'tl-broken', name: 'Broken', version: '1.0.0', participant: { schema: 1, checkpoint() {} } });

test('a participant that fails to register after the restore was prepared holds the activation: nothing is installed, the preparation is aborted', async t => {
    const w = await world(t);
    const { host, native, hook, saved } = w;
    const head = await host.sdk.timeline.head();
    const prepared = await host.timeline.host.prepare({ snapshot: saved.id, deathEvents: DEATH, batchResult: BATCH, expectedHead: head.headHash });
    assert.equal(prepared.ok, true, prepared.message);
    hook.on = async phase => { if (phase === 'activate.checked') await host.sdk.registerModule(broken()); };
    const result = await host.timeline.host.activate({ prepared: prepared.prepared, expectedHead: head.headHash });
    assert.equal(result.code, 'SNAPSHOT_UNAVAILABLE');
    assert.match(result.message, /tl-broken/);
    assert.equal(host.head().domains.progress.xp, 140, 'nothing was restored');
    assert.equal(native.native.calls.some(call => call.name === 'activate'), false);
    assert.equal(host.timeline.host.journal().find(entry => entry.id === prepared.prepared).phase, 'aborted');
    assert.equal(host.registry.restore().state, 'idle');
});

test('a participant registered after the restore was prepared is a participant the save never held: the activation is refused', async t => {
    const w = await world(t);
    const { host, native, hook, saved } = w;
    const head = await host.sdk.timeline.head();
    const prepared = await host.timeline.host.prepare({ snapshot: saved.id, deathEvents: DEATH, batchResult: BATCH, expectedHead: head.headHash });
    assert.equal(prepared.ok, true, prepared.message);
    hook.on = async phase => {
        if (phase !== 'activate.checked') return;
        const late = nativeModule({ id: 'tl-late' });
        late.def.domains = {};
        await host.sdk.registerModule(late.def);
    };
    const result = await host.timeline.host.activate({ prepared: prepared.prepared, expectedHead: head.headHash });
    assert.equal(result.code, 'SNAPSHOT_UNAVAILABLE');
    assert.match(result.message, /tl-late/);
    assert.equal(host.head().domains.progress.xp, 140);
    assert.equal(native.native.calls.some(call => call.name === 'activate'), false);
});

test('a participant that registers, or fails to, while a save point is made holds the commit: the descriptor would leave it out', async t => {
    for (const [name, def] of [['a participant that fails to register', broken()], ['a participant that registers', (() => { const late = nativeModule({ id: 'tl-late' }); late.def.domains = {}; return late.def; })()]]) {
        const w = await world(t);
        const { host, hook } = w;
        const before = Object.keys(host.head().domains.savepoints.points).length;
        hook.on = async phase => { if (phase === 'make.archived') await host.sdk.registerModule(def); };
        const result = await host.sdk.timeline.make({ kind: 'manual', name: 'Left out' });
        hook.on = null;
        assert.equal(result.code, 'SNAPSHOT_UNAVAILABLE', name);
        assert.equal(Object.keys(host.head().domains.savepoints.points).length, before, `${name}: no descriptor was stored`);
    }
});

test('a native event whose participant answers another schema than it registered is not journaled', async t => {
    let skew = false;
    const w = await world(t, { wrap: native => {
        const real = native.def.participant.checkpoint;
        native.def.participant.checkpoint = input => ({ ...real(input), schema: skew ? 9 : 1 });
    } });
    const { host } = w;
    skew = true;
    const head = await host.sdk.timeline.head();
    const result = await host.timeline.host.nativeEvent({ event: 'ev_schema001', participant: NATIVE, kind: 'confirmed-death', npc: NPC, expectedHead: head.headHash });
    assert.equal(result.code, 'SNAPSHOT_UNAVAILABLE');
    assert.equal(host.timeline.host.journal().some(entry => entry.kind === 'native-event'), false);
});

// ---- registration -------------------------------------------------------------------------------------------------------------

test('settings.rules is a settings field this Story Block knows: registering it warns of nothing', () => {
    assert.deepEqual(definitionWarnings({ id: 'x', settings: { rules: ['difficulty'], defaults: {} } }).filter(line => /rules/.test(line)), []);
    assert.match(definitionWarnings({ id: 'x', settings: { panel: () => {} } }).join(), /"settings.panel" is not a settings field/);
});

// ---- 5. in-memory state belongs to one chat ------------------------------------------------------------------------------------

// Another chat (its own host, its own file), ready to be opened on `host`, and the way back.
async function otherChat(t) {
    const b = await createHost({ modules: [rulesModule(), nativeModule().def] });
    t.after(() => b.close());
    await b.send('Hi.', reply('Over there.', ['+ coin 1']));
    return { chat: [...b.ctx.chat], metadata: b.ctx.chatMetadata, snapshot: clone(b.ctx.chatMetadata) };
}
async function open(host, to) {
    const left = { chat: [...host.ctx.chat], metadata: host.ctx.chatMetadata };
    host.ctx.chat.splice(0, host.ctx.chat.length, ...to.chat);
    host.ctx.chatMetadata = to.metadata;
    await host.turn.onChatChanged();
    return left;
}
const announced = w => w.told.map(each => each.id);

for (const [name, scenario] of Object.entries(SCENARIOS)) {
    test(`${name}: after a save failed at any position, opening another chat announces nothing of the first and leaves it no barrier; the first chat's own recovery settles it`, async t => {
        const dry = await world(t, { scenario: name, more: true });
        assert.equal((await scenario.run(dry)).ok, true);
        const total = dry.counter.n;
        const there = await otherChat(t);
        for (let at = 1; at <= total; at++) {
            const w = await world(t, { failing: at, scenario: name, more: true });
            await scenario.run(w);
            assert.equal(w.counter.failed, true);
            const left = await open(w.host, there);
            const before = announced(w).length;
            const made = await w.host.sdk.timeline.make({ kind: 'manual', name: 'In the other chat' });
            assert.equal(made.ok, true, `flush ${at}: the other chat is not held by the first one's barrier (${made.code} ${made.message})`);
            assert.equal(w.host.registry.restore().state, 'idle', `flush ${at}`);
            const inB = new Set(w.host.store.receipts().map(each => each.receipt.id));
            for (const each of w.told.slice(before)) assert.equal(inB.has(each.id), true, `flush ${at}: ${each.type} is not in the chat that was announced to`);
            // The way back: the chat that was left finds its own journal and settles it.
            await open(w.host, left);
            assert.equal(w.host.registry.restore().state, 'idle', `flush ${at}: back in the first chat`);
            assert.equal((await w.host.sdk.timeline.status()).state, 'idle', `flush ${at}: back in the first chat`);
            for (const each of w.told) assert.equal(each.present && each.onDisk, true, `flush ${at}: ${each.type} announced without the file and the chat having it`);
        }
    });

    test(`${name}: after a save failed at any position, deleting the reply that holds the work announces nothing the chat no longer has, and recovery leaves no barrier`, async t => {
        const dry = await world(t, { scenario: name, more: true });
        assert.equal((await scenario.run(dry)).ok, true);
        const total = dry.counter.n;
        for (let at = 1; at <= total; at++) {
            const w = await world(t, { failing: at, scenario: name, more: true });
            await scenario.run(w);
            assert.equal(w.counter.failed, true);
            const before = announced(w).length;
            await w.host.st.deleteMessage(w.host.ctx.chat.length - 1);
            assert.equal((await w.host.timeline.recover()).ok, true, `flush ${at}`);
            const made = await w.host.sdk.timeline.make({ kind: 'manual', name: 'After the delete' });
            assert.equal(made.ok, true, `flush ${at}: ${made.code} ${made.message}`);
            assert.equal(w.host.registry.restore().state, 'idle', `flush ${at}`);
            for (const each of w.told.slice(before)) assert.equal(each.present && each.onDisk, true, `flush ${at}: ${each.type} was announced though the chat no longer has it`);
        }
    });

    test(`${name}: a save that is refused because the chat was left meanwhile is STALE, not a failed save, and drops the barrier`, async t => {
        const dry = await world(t, { scenario: name, more: true });
        assert.equal((await scenario.run(dry)).ok, true);
        const total = dry.counter.n;
        const there = await otherChat(t);
        for (let at = 1; at <= total; at++) {
            const w = await world(t, { failing: at, scenario: name, more: true, onFail: host => open(host, there) });
            const result = await scenario.run(w);
            assert.equal(result.ok, false, `flush ${at}`);
            assert.equal(result.code, 'STALE', `flush ${at}: ${result.code} ${result.message}`);
            assert.equal(w.host.registry.restore().state, 'idle', `flush ${at}: no barrier on the chat that is open`);
            assert.deepEqual(w.host.ctx.chatMetadata.storySuite?.timeline, there.snapshot.storySuite?.timeline, `flush ${at}: no timeline written to the chat that is open`);
            there.metadata = clone(there.snapshot);
            await open(w.host, { chat: there.chat, metadata: there.metadata });
        }
    });
}

// ---- 6. the line of work is chat-bound too ---------------------------------------------------------------------------------------

const tick = () => new Promise(resolve => setImmediate(resolve));
const until = async check => { for (let i = 0; i < 200 && !check(); i++) await tick(); return check(); };
// Holds the first arrival at `phase` until `release()`.
function hold(w, phase) {
    let release;
    const held = new Promise(resolve => { release = resolve; });
    let used = false;
    w.hook.on = async at => { if (at === phase && !used) { used = true; await held; } };
    return { release, reached: () => used };
}
const HOLD_AT = { 'a save point': 'make.checkpointed', 'a restore': 'prepare.participant:tl-native', 'a native event': 'native.journaled', 'a native mutation': 'native.prepared' };

test('a save queued in a chat that is left is STALE when its turn comes: it does not run in the chat that is open', async t => {
    const w = await world(t);
    const there = await otherChat(t);
    const gate = hold(w, 'make.checkpointed');
    const first = w.host.sdk.timeline.make({ kind: 'manual', name: 'A first' });
    await until(gate.reached);
    const queued = [w.host.sdk.timeline.make({ kind: 'manual', name: 'A queued' }), w.host.sdk.command('savepoint.make', { name: 'A queued too' })];
    const left = await open(w.host, there);
    gate.release();
    for (const result of [await first, ...await Promise.all(queued)]) {
        assert.equal(result.ok, false);
        assert.equal(result.code, 'STALE', result.message);
    }
    assert.equal(w.host.head().domains.savepoints, undefined, 'nothing was made in the chat that is open');
    assert.equal(w.host.ctx.chatMetadata.storySuite?.timeline, undefined);
    // The chat that was left still works when it is open again.
    await open(w.host, left);
    assert.equal((await w.host.sdk.timeline.make({ kind: 'manual', name: 'Back' })).ok, true);
});

test('a chat opened with an unfinished journal is barred at once, even while another chat\'s work holds the line; its recovery runs in its turn', async t => {
    const w = await world(t, { failing: 1, scenario: 'a native event' });
    const there = await otherChat(t);
    const failed = await SCENARIOS['a native event'].run(w);
    assert.equal(failed.code, 'FAILED');
    assert.equal(w.host.registry.restore().state, 'pending');
    const left = await open(w.host, there);
    assert.equal(w.host.registry.restore().state, 'idle', 'the other chat is not held by the first one\'s barrier');
    const gate = hold(w, 'make.checkpointed');
    const inB = w.host.sdk.timeline.make({ kind: 'manual', name: 'B holds the line' });
    await until(gate.reached);
    const reopening = open(w.host, left);
    assert.equal(await until(() => w.host.registry.restore().state === 'pending'), true, 'barred from the moment it is open');
    const xp = await w.host.sdk.command('tl.xp', { amount: 1 });
    assert.equal(xp.ok, false, 'no command goes through while its recovery waits');
    assert.equal(w.host.head().domains.progress.xp, 140);
    gate.release();
    assert.equal((await inB).code, 'STALE', 'B\'s work, with the chat gone');
    await reopening;
    assert.equal(w.host.registry.restore().state, 'idle');
    assert.equal((await w.host.sdk.timeline.status()).state, 'idle');
    assert.equal(w.host.timeline.host.journal().find(entry => entry.kind === 'native-event').phase, 'done', 'its own recovery finished it');
    assert.equal((await w.host.sdk.command('tl.xp', { amount: 1 })).ok, true);
});

for (const [name, scenario] of Object.entries(SCENARIOS)) {
    const settles = async (w, left) => {
        await open(w.host, left);
        assert.equal((await w.host.timeline.recover()).ok, true);
        assert.equal(w.host.registry.restore().state, 'idle');
        assert.equal((await w.host.sdk.timeline.status()).state, 'idle');
        assert.equal(w.host.timeline.host.journal().every(entry => ['committed', 'discarded', 'aborted', 'complete', 'done', 'retracted'].includes(entry.phase)), true, 'nothing is left unfinished');
        for (const each of w.told) assert.equal(each.present && each.onDisk, true, `${each.type} announced without the file and the chat having it`);
    };

    test(`${name}: held in a chat, work queued behind it, the chat left, released: everything is STALE, nothing runs in the other chat, and the first chat recovers when reopened`, async t => {
        const w = await world(t, { scenario: name });
        const there = await otherChat(t);
        const gate = hold(w, HOLD_AT[name]);
        const running = scenario.run(w);
        await until(gate.reached);
        const queued = w.host.sdk.timeline.make({ kind: 'manual', name: 'Queued' });
        const left = await open(w.host, there);
        gate.release();
        const result = await running;
        assert.equal(result.ok, false, name);
        assert.equal(result.code, 'STALE', `${result.code} ${result.message}`);
        assert.equal((await queued).code, 'STALE');
        assert.equal(w.host.registry.restore().state, 'idle', 'no barrier on the chat that is open');
        assert.equal(w.host.ctx.chatMetadata.storySuite?.timeline, undefined, 'nothing written to the chat that is open');
        await settles(w, left);
    });

    test(`${name}: held in a chat, the chat left, work of the other chat queued behind it, released: the other chat's work runs in the other chat only`, async t => {
        const w = await world(t, { scenario: name });
        const there = await otherChat(t);
        const gate = hold(w, HOLD_AT[name]);
        const running = scenario.run(w);
        await until(gate.reached);
        const left = await open(w.host, there);
        const inB = w.host.sdk.timeline.make({ kind: 'manual', name: 'B made' });
        gate.release();
        assert.equal((await running).code, 'STALE');
        const made = await inB;
        assert.equal(made.ok, true, made.message);
        assert.deepEqual(Object.values(w.host.head().domains.savepoints.points).map(point => point.name), ['B made']);
        await settles(w, left);
    });

    test(`${name}: held in a chat, the chat left and opened again before the release: the work is still that chat's and finishes, or is STALE; nothing is lost or doubled`, async t => {
        const w = await world(t, { scenario: name });
        const there = await otherChat(t);
        const gate = hold(w, HOLD_AT[name]);
        const running = scenario.run(w);
        await until(gate.reached);
        const left = await open(w.host, there);
        const back = open(w.host, left);
        gate.release();
        const result = await running;
        await back;
        assert.equal(result.ok || result.code === 'STALE', true, `${result.code} ${result.message}`);
        assert.equal(w.breaches.length, 0);
        await settles(w, left);
        const entries = w.host.timeline.host.journal();
        assert.equal(entries.filter(entry => entry.kind === 'native-event').length <= 1, true, 'the event was not delivered twice');
    });
}

// ---- 7. recovery never lets the host look ready on a story its native state has not caught up with -----------------------------

test('while a chat recovers, no listener sees the host ready and acts on a restored story with the native state not yet restored', async t => {
    // A module whose command depends on the native state: it records the dossier's trust.
    let trust = null;
    const trustModule = { id: 'tl-trust', name: 'Trust', version: '0.0.1', domains: { trustxp: { initial: () => ({ granted: null }), absent: () => ({ granted: null }) } }, commands: {
        'tl.trustxp'(ctx) {
            ctx.draft('trustxp').granted = trust();
            return { summary: 'Trust paid out.', narrate: false };
        },
    } };
    const w = await world(t, { wrap: native => { trust = () => native.native.store.dossiers.tavi.trust; } });
    // (the module has to be there from the start: register it, then rebuild the world's host on it)
    await w.host.sdk.registerModule(trustModule);
    const there = await otherChat(t);
    const head = await w.host.sdk.timeline.head();
    const prepared = await w.host.timeline.host.prepare({ snapshot: w.saved.id, deathEvents: DEATH, batchResult: BATCH, expectedHead: head.headHash });
    assert.equal(prepared.ok, true, prepared.message);
    w.native.native.fail.add('activate');
    const pending = await w.host.timeline.host.activate({ prepared: prepared.prepared, expectedHead: head.headHash });
    assert.equal(pending.status, 'participants-pending');
    assert.equal(w.host.head().domains.progress.xp, 40, 'the story is restored');
    assert.equal(w.native.native.store.dossiers.tavi.trust, 99, 'the participant is not');
    w.native.native.fail.delete('activate');
    // Every time the host is told the modules are ready, a command that reads the native state is issued at once (synchronously, as a
    // listener would), and what the story and the participant stood at when the host announced it is kept.
    const heard = [];
    const issued = [];
    let listening = false;
    w.host.events.on('modules', ({ changes }) => {
        if (listening && w.host.registry.restore().state === 'idle' && changes.some(change => change.status === 'ready')) {
            heard.push({ xp: w.host.head().domains.progress?.xp, trust: w.native.native.store.dossiers.tavi.trust });
            issued.push(w.host.sdk.command('tl.trustxp', {}));
        }
    });
    const left = await open(w.host, there);
    listening = true;
    await open(w.host, left);
    await Promise.all(issued);
    assert.equal(heard.length >= 1, true, 'the host was announced ready');
    assert.deepEqual(heard.filter(each => each.xp === 40 && each.trust === 99), [], 'never announced ready on the restored story with the dead timeline\'s native state');
    assert.equal(w.native.native.store.dossiers.tavi.trust, 3);
    assert.equal(w.host.registry.restore().state, 'idle');
    const granted = w.host.head().domains.trustxp?.granted ?? null;
    assert.equal(granted === null || granted === 3, true, `trust paid out against ${granted}`);
    assert.equal(w.host.store.problems().length, 0);
});

test('a journal that holds two unfinished changes (damaged: the API refuses a second) keeps the chat barred and announces nothing ready', async t => {
    const w = await world(t);
    const there = await otherChat(t);
    for (const n of [1, 2]) {
        w.host.timeline.archive.add({ id: `nm_inject0${n}`, kind: 'native-event', phase: 'prepared', session: 'ss_oldrun01', participant: NATIVE, event: `ev_inject0${n}`,
            eventKind: 'confirmed-death', nativeKey: 'tavi', npc: NPC, expectedHead: 'a'.repeat(64), before: { module: NATIVE, checkpoint: 'ck_00000001', hash: 'b'.repeat(64), schema: 1 }, after: null,
            boundary: { cursor: { sid: 'sr_00000001', swipeKey: 'sw_00000001', block: 'bl_00000001', op: 0, rev: 1 }, prefixHash: 'c'.repeat(64) } });
    }
    const left = await open(w.host, there);
    const heard = [];
    w.host.events.on('modules', ({ changes }) => { if (changes.some(change => change.status === 'ready')) heard.push(w.host.registry.restore().state); });
    await open(w.host, left);
    assert.equal(w.host.registry.restore().state, 'pending', 'held');
    assert.deepEqual(heard, [], 'never announced ready');
    assert.equal((await w.host.sdk.command('tl.xp', { amount: 1 })).ok, false, 'commands stay barred');
    const result = await w.host.timeline.recover();
    assert.equal(result.ok, false);
    assert.match(result.message, /2 unfinished changes/);
    assert.equal(w.native.native.calls.some(call => call.name === 'applyEvent'), false, 'the participant was not asked to change');
});

// ---- 8. at most one change is outstanding in a chat, and the barrier holds until every one has settled ---------------------------

const PENDING_EVENT = { event: 'ev_pending001', participant: NATIVE, kind: 'confirmed-death', npc: NPC };

// A restore prepared, and then a native event that is left outstanding (its journal could not be saved, or its participant failed).
async function interleaved(t, how) {
    const w = await world(t, { scenario: 'a native event' });
    const head = await w.host.sdk.timeline.head();
    const prepared = await w.host.timeline.host.prepare({ snapshot: w.saved.id, deathEvents: DEATH, batchResult: BATCH, expectedHead: head.headHash });
    assert.equal(prepared.ok, true, prepared.message);
    const input = { ...PENDING_EVENT, expectedHead: head.headHash };
    if (how === 'journal') {
        w.counter.n = 0;
        w.counter.failing = 1;
    } else {
        w.native.native.fail.add('applyEvent');
    }
    const event = await w.host.timeline.host.nativeEvent(input);
    assert.equal(event.ok, false, 'the event is left outstanding');
    w.counter.failing = 0;
    const heard = [];
    w.host.events.on('modules', ({ changes }) => { if (changes.some(change => change.status === 'ready')) heard.push(w.host.registry.restore().state); });
    return { w, head, prepared, input, heard, activate: () => w.host.timeline.host.activate({ prepared: prepared.prepared, expectedHead: head.headHash }) };
}

for (const how of ['journal', 'participant']) {
    test(`a prepared restore is not activated while a native event is outstanding (${how} failed): RESTORE_PENDING, the barrier holds, nothing is announced ready`, async t => {
        const { w, activate, heard, prepared } = await interleaved(t, how);
        const refused = await activate();
        assert.equal(refused.ok, false);
        assert.equal(refused.code, 'RESTORE_PENDING');
        assert.equal(w.host.registry.restore().state, 'pending', 'still barred');
        assert.deepEqual(heard, [], 'never announced ready');
        assert.equal((await w.host.sdk.timeline.status()).state, 'pending');
        assert.equal((await w.host.sdk.command('tl.xp', { amount: 7 })).ok, false, 'no command goes through');
        assert.equal(w.host.head().domains.progress.xp, 140, 'the story is not restored');
        assert.equal(w.host.timeline.host.journal().find(entry => entry.id === prepared.prepared).phase, 'prepared', 'the restore stays prepared');
        assert.equal(w.host.timeline.host.journal().filter(entry => (entry.kind === 'restore' && ['committed', 'participants-pending', 'acked'].includes(entry.phase)) || (entry.kind === 'native-event' && entry.phase === 'prepared')).length, 1, 'one outstanding change');
    });

    test(`recovery route (${how} failed): retrying the identical event settles it; the restore, prepared on the head before it, is then STALE and is prepared again`, async t => {
        const { w, activate, input, prepared } = await interleaved(t, how);
        assert.equal((await activate()).code, 'RESTORE_PENDING');
        w.native.native.fail.delete('applyEvent');
        const again = await w.host.timeline.host.nativeEvent(input);
        assert.equal(again.ok, true, again.message);
        assert.equal(w.host.registry.restore().state, 'idle');
        assert.equal((await w.host.sdk.timeline.status()).state, 'idle');
        // The native change is part of the head: the restore prepared before it no longer stands.
        const stale = await activate();
        assert.equal(stale.code, 'STALE');
        assert.equal(w.host.timeline.host.journal().find(entry => entry.id === prepared.prepared).phase, 'aborted');
        const head = await w.host.sdk.timeline.head();
        const fresh = await w.host.timeline.host.prepare({ snapshot: w.saved.id, deathEvents: DEATH, batchResult: BATCH, expectedHead: head.headHash });
        assert.equal(fresh.ok, true, fresh.message);
        const done = await w.host.timeline.host.activate({ prepared: fresh.prepared, expectedHead: head.headHash });
        assert.equal(done.status, 'complete');
        assert.equal(w.host.head().domains.progress.xp, 40);
    });
}

test('recovery route after a restart: the outstanding event is finished when the chat opens and the prepared restore beside it is aborted', async t => {
    const { w, activate, prepared } = await interleaved(t, 'participant');
    assert.equal((await activate()).code, 'RESTORE_PENDING');
    w.native.native.fail.delete('applyEvent');
    const again = await reload(createHost, clone(w.disk.image), w.modules());
    t.after(() => again.close());
    assert.equal(again.registry.restore().state, 'idle');
    assert.equal((await again.sdk.timeline.status()).state, 'idle');
    const entries = again.timeline.host.journal();
    assert.equal(entries.find(entry => entry.kind === 'native-event').phase, 'done');
    assert.equal(entries.find(entry => entry.id === prepared.prepared).phase, 'aborted');
    assert.equal(w.native.native.store.applied.includes(PENDING_EVENT.event), true, 'the participant has the event');
    assert.equal((await again.sdk.command('tl.xp', { amount: 7 })).ok, true);
});

// ---- 9. a participant's native change between its checkpoint and the commit ------------------------------------------------------

test('a participant whose state changed after its checkpoint holds the commit of a save point: STALE, nothing written, nothing announced; the retry works', async t => {
    const { hashJson } = await import('../../src/v2/replay.js');
    const w = await world(t, { wrap: native => {
        native.def.participant.current = ({ hash }) => ({ ok: true, current: hashJson(native.native.store) === hash });
    } });
    const before = Object.keys(w.host.head().domains.savepoints.points).length;
    const told = w.told.length;
    w.hook.on = phase => { if (phase === 'make.archived') w.native.native.edit(state => { state.dossiers.tavi.trust = 55; }); };
    const made = await w.host.sdk.timeline.make({ kind: 'manual', name: 'Raced' });
    assert.equal(made.ok, false);
    assert.equal(made.code, 'STALE');
    assert.match(made.message, /tl-native changed its state/);
    assert.equal(Object.keys(w.host.head().domains.savepoints.points).length, before, 'no descriptor');
    assert.equal(w.told.length, told, 'nothing announced');
    assert.equal(w.host.timeline.host.journal().filter(entry => entry.kind === 'make').at(-1).phase, 'discarded');
    // The state stays as it is now and the retry hands over that state.
    w.hook.on = null;
    const again = await w.host.sdk.timeline.make({ kind: 'manual', name: 'Retried' });
    assert.equal(again.ok, true, again.message);
    assert.equal(again.snapshot.participants[0].hash, hashJson(w.native.native.store));
});

test('a probe that throws, answers a promise or answers something else fails closed; a participant without a probe keeps today\'s behaviour', async t => {
    for (const answer of [() => { throw new Error('boom'); }, () => Promise.resolve({ ok: true, current: true }), () => true, () => ({ ok: false }), () => ({ ok: true }), () => undefined]) {
        const w = await world(t, { wrap: native => { native.def.participant.current = answer; } });
        const made = await w.host.sdk.timeline.make({ kind: 'manual', name: 'Probed' });
        assert.equal(made.code, 'STALE', String(answer));
    }
    const w = await world(t);
    w.hook.on = phase => { if (phase === 'make.archived') w.native.native.edit(state => { state.dossiers.tavi.trust = 55; }); };
    assert.equal((await w.host.sdk.timeline.make({ kind: 'manual', name: 'No probe' })).ok, true, 'no probe: the head hash alone, as before');
    const bad = await w.host.timeline.host.registerParticipant({ module: 'tl-bad', schema: 1, current: 'yes', ...Object.fromEntries(['checkpoint', 'prepare', 'activate', 'abort', 'status'].map(name => [name, () => ({ ok: true })])) });
    assert.equal(bad.code, 'INVALID');
});
