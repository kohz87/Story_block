// Old stores, old packs and modules that never use the timeline behave as they did (docs/v2/TIMELINE.md "What it does not touch").
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { rulesModule } from './helpers/timeline.js';

const reply = (text, lines = []) => (lines.length ? `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
const KEYS = ['ops', 'receipts', 'narrated', 'rev', 'sid', 'source', 'spans', 'swipe', 'v', 'mark'];

// A chat that uses the host the ordinary way: replies, clicks, a swipe, a middle delete, a Re-read.
async function ordinary(t, options = {}) {
    const host = await createHost({ modules: [rulesModule()], ...options });
    t.after(() => host.close());
    await host.send('One.', reply('A.', ['+ coin 10', '+ item Torch | qty: 2']));
    await host.sdk.command('tl.xp', { amount: 5 });
    await host.send('Two.', reply('B.', ['+ coin 5', '~ place Bluewatch | kind: settlement']));
    await host.sdk.command('tl.hurt', { amount: 3 });
    await host.send('Three.', reply('C.', ['- coin 3']));
    await host.swipe(reply('C2.', ['+ coin 1']));
    await host.sdk.reread(host.ctx.chat.length - 1);
    await host.st.deleteMessage(2);
    return host;
}

test('a chat that never uses the timeline has no savepoints domain, no archive and no record of it anywhere', async t => {
    const host = await ordinary(t);
    assert.equal(Object.hasOwn(host.head().domains, 'savepoints'), false);
    assert.equal(host.ctx.chatMetadata.storySuite?.timeline, undefined);
    assert.equal(host.registry.restore().state, 'idle');
    const types = host.ctx.chat.flatMap(message => message.extra?.storySuite?.receipts ?? []).map(receipt => receipt.type);
    assert.equal(types.some(type => type.startsWith('savepoint.')), false);
    // The guard check of the host (the epoch and rules hash) has nothing to compare: any epoch is as good as any.
    assert.equal(host.head().domains.rules.rulesVersion, 2);
    for (const message of host.ctx.chat) {
        const record = message.extra?.storySuite;
        if (!record) continue;
        assert.equal(Object.keys(record).every(key => [...KEYS, 'checkpoint', 'covers', 'coverHash', 'guardEnv'].includes(key)), true, Object.keys(record).join());
        for (const span of record.spans) assert.equal(Object.hasOwn(span, 'guard') && span.guard?.owner === 'story-block', false);
    }
});

test('reading the timeline writes nothing: head, list, status, history and recover leave the chat as it was', async t => {
    const host = await ordinary(t);
    await host.store.flush();
    const before = JSON.stringify([host.ctx.chat, host.ctx.chatMetadata]);
    const saves = host.st.saves.length;
    assert.equal((await host.sdk.timeline.head()).ok, true);
    assert.deepEqual((await host.sdk.timeline.list()).points, []);
    assert.deepEqual(await host.sdk.timeline.status(), { ok: true, state: 'idle', return: null, participants: [] });
    assert.equal((await host.sdk.timeline.history({})).ok, true);
    assert.deepEqual(await host.timeline.host.recover(), { ok: true, state: 'idle', return: null });
    assert.deepEqual(host.sdk.query('savepoint.list', {}), []);
    await host.turn.onChatChanged();
    assert.equal(JSON.stringify([host.ctx.chat, host.ctx.chatMetadata]), before);
    assert.equal(host.store.dirty(), false);
    assert.equal(host.st.saves.length, saves, 'no save was made for it');
});

test('a guard of any epoch is stored while no save point exists; once the timeline has an epoch the guards must be in it', async t => {
    const host = await createHost({ modules: [rulesModule()] });
    t.after(() => host.close());
    await host.send('Go.', reply('A.'));
    assert.equal((await host.sdk.command('tl.guarded', { epoch: 'ep_k3f9a2qz' })).ok, true);
    assert.equal((await host.sdk.command('tl.guarded', { epoch: 'ep_00000001' })).ok, true);
    await host.sdk.timeline.make({ kind: 'manual' });
    assert.equal((await host.sdk.command('tl.guarded', { epoch: 'ep_00000001' })).ok, false, 'the timeline has its epoch now');
    assert.equal((await host.sdk.command('tl.guarded', { epoch: 'ep_00000000' })).ok, true);
    // The earlier blocks (stored before the timeline had an epoch) still replay.
    host.store.rebuild();
    assert.deepEqual(host.store.problems(), []);
    assert.equal(host.head().domains.progress.xp, 3);
});

test('the module list gains the two save-point commands and one query, and nothing else', async t => {
    const host = await createHost({ core: true, modules: [] });
    t.after(() => host.close());
    const core = host.sdk.modules().find(module => module.id === 'story-block');
    assert.equal(core.commands.includes('savepoint.make'), true);
    assert.equal(core.commands.includes('savepoint.restore'), true);
    assert.deepEqual([...core.domains].sort(), ['inventory', 'scene'], 'the core module declares the same two domains');
    assert.equal(host.registry.domainOwner('savepoints'), null);
    assert.equal(host.registry.isInternal('savepoint.restore'), true);
    assert.equal(host.registry.isInternal('savepoint.make'), false);
    // Declared but not advertised as buttons: the public sdk refuses the internal one and makes the other itself.
    assert.equal((await host.sdk.command('savepoint.restore', {})).code, 'REFUSED');
});

test('a module with no participant and no timeline calls is untouched: its domains, commands and replay are what they were', async t => {
    const host = await ordinary(t);
    const seen = JSON.parse(JSON.stringify(host.head()));
    host.store.rebuild();
    assert.deepEqual(JSON.parse(JSON.stringify(host.head())), seen);
    assert.deepEqual(host.timeline.host.participants(), []);
    assert.deepEqual(host.store.problems(), []);
});

test('a guarded chat that never uses the timeline keeps its checkpoint metadata: the host\'s own replay hook is no owner in guardEnv', async t => {
    const host = await createHost({ modules: [rulesModule()] });
    t.after(() => host.close());
    await host.send('Go.', reply('A.'));
    assert.equal((await host.sdk.command('tl.guarded', { epoch: 'ep_00000001' })).ok, true);
    for (let n = 0; n < 105; n += 1) await host.send('Go.', reply(`Reply ${n}.`, ['+ coin 1']));
    const marks = host.ctx.chat.map(message => message.extra?.storySuite).filter(record => record?.checkpoint).map(record => record.guardEnv).filter(mark => mark !== undefined);
    assert.equal(marks.length >= 1, true, 'the chat has a checkpoint over a guarded block');
    assert.deepEqual([...new Set(marks)], ['tl-rules@0.0.1'], 'only the module that guards is an owner');
    assert.deepEqual(host.store.problems(), []);
});
