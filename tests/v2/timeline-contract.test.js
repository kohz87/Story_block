import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { createTimelinePart } from '../../src/v2/timeline/part.js';
import { clockModule } from './helpers/clock.js';
import { nativeModule } from './helpers/timeline.js';

const ready = answer => answer !== null && typeof answer === 'object' && answer.api === 2
    && ['snapshots', 'retainedChatRestore', 'participantsReady'].every(key => answer[key] === true);
// Contract §2 assigns these public-query probes to the RB bootstrap. This fixture exercises that
// consumer boundary without adding a new host registration signature or changing legacy RB.
function activate(query) {
    let answer;
    try { answer = query('savepoint.contract', {}); } catch { return { ok: false, code: 'DEPENDENCY_UNAVAILABLE' }; }
    return ready(answer) ? { ok: true } : { ok: false, code: 'DEPENDENCY_UNAVAILABLE' };
}

test('savepoint.contract is a read-only, closed boolean capability projection', async t => {
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Go.', 'Ready.');
    const before = JSON.stringify([host.ctx.chat, host.ctx.chatMetadata]);
    assert.deepEqual(host.sdk.query('savepoint.contract', {}), { api: 2, snapshots: true, retainedChatRestore: true, participantsReady: true });
    assert.equal(JSON.stringify([host.ctx.chat, host.ctx.chatMetadata]), before);
    assert.equal(activate(host.sdk.query).ok, true);
    const noHost = createTimelinePart();
    assert.deepEqual(noHost.queries['savepoint.contract'](), { api: 2, snapshots: false, retainedChatRestore: false, participantsReady: false });
});

for (const mode of ['missing', 'malformed', 'off', 'ready']) test(`capability ${mode} gates the RB bootstrap while independent SB/SD/NSD commands remain usable`, async t => {
    const native = nativeModule();
    const host = await createHost({ modules: [clockModule(), native.def] });
    t.after(() => host.close());
    await host.send('Go.', 'Independent.');
    const answer = mode === 'missing' ? undefined : mode === 'malformed' ? { api: 2, snapshots: 'yes', retainedChatRestore: true, participantsReady: true }
        : mode === 'off' ? { api: 2, snapshots: false, retainedChatRestore: true, participantsReady: true } : host.sdk.query('savepoint.contract', {});
    assert.equal(activate(() => { if (mode === 'missing') throw new Error('missing query'); return answer; }).ok, mode === 'ready');
    assert.equal((await host.sdk.command('director.seed', { minute: 12 })).ok, true);
    await host.send('Continue.', 'Independent.\n<Changes>\n+ coin 1\n</Changes>');
    assert.equal(host.head().domains.inventory.wallets.party.coin, 1);
    assert.equal(host.sdk.modules().find(x => x.id === native.def.id).status, 'ready');
});

test('installed native participants must register, including NSD with optional features off', async t => {
    for (const participant of [undefined, { schema: 1 }]) {
        const host = await createHost({ modules: [{ id: 'npc-state-delta', name: 'Installed NSD', version: '1.2.20', ...(participant ? { participant } : {}) }] });
        t.after(() => host.close());
        await host.send('Go.', 'Waiting for native support.');
        assert.equal(host.sdk.query('savepoint.contract', {}).participantsReady, false);
        assert.equal(host.sdk.modules().find(x => x.id === 'story-block').status, 'ready');
    }
});

test('retained-chat readiness waits for logical marker payloads; a restore barrier clears participant readiness', async t => {
    const host = await createHost({ modules: [clockModule()] });
    t.after(() => host.close());
    await host.send('Go.', 'Clock.');
    assert.equal(host.bus.command('director.advance', { minutes: 60 }, { cause: 'system' }).ok, true);
    assert.equal(host.sdk.query('savepoint.contract', {}).retainedChatRestore, false);
    assert.equal((await host.timeline.host.recover()).ok, true);
    assert.equal(host.sdk.query('savepoint.contract', {}).retainedChatRestore, true);
    host.registry.setRestore('pending', 'Testing participant barrier');
    assert.equal(host.sdk.query('savepoint.contract', {}).participantsReady, false);
});

test('capability readiness holds while participant checkpoint I/O is in flight and clears after it settles', async t => {
    const native = nativeModule();
    let release;
    const checkpoint = native.def.participant.checkpoint;
    native.def.participant.checkpoint = input => new Promise(resolve => { release = () => resolve(checkpoint(input)); });
    const host = await createHost({ modules: [native.def] });
    t.after(() => host.close());
    await host.send('Go.', 'Here.');
    const pending = host.sdk.timeline.make({ kind: 'manual' });
    for (let pass = 0; pass < 20 && !release; pass++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(typeof release, 'function');
    assert.equal(host.sdk.query('savepoint.contract', {}).participantsReady, false);
    release();
    assert.equal((await pending).ok, true);
    assert.equal(host.sdk.query('savepoint.contract', {}).participantsReady, true);
});

for (const answer of [null, undefined, {}, {api: 3, snapshots: true, retainedChatRestore: true, participantsReady: true},
    ...['snapshots','retainedChatRestore','participantsReady'].map(key => ({api: 2, snapshots: true, retainedChatRestore: true, participantsReady: true, [key]: false}))]) {
    test(`consumer refuses malformed or unavailable contract: ${JSON.stringify(answer)}`, () => {
        assert.deepEqual(activate(() => answer), {ok: false, code: 'DEPENDENCY_UNAVAILABLE'});
    });
}
