// The public sdk (docs/v2/SPEC.md §3.1, §6) over the testkit's store and bus stand-ins.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { HOST_SETTINGS_DEFAULTS, createEvents, createSdk, createSettings, makeView, missingModules, newId } from '../../src/v2/sdk.js';
import { createRegistry } from '../../src/v2/registry.js';

function counter() {
    return {
        id: 'counter',
        name: 'Counter',
        version: '2.0.0-alpha.1',
        domains: { tally: { initial: () => ({ n: 0 }), validate: slice => (slice.n > 3 ? ['The tally stops at 3.'] : []) } },
        commands: {
            'tally.add'(ctx, { by = 1 } = {}) {
                ctx.draft('tally').n += by;
                return { summary: `The tally is now ${ctx.read('tally').n}.`, data: { by } };
            },
            'tally.steal'(ctx) { ctx.draft('other').x = 1; return {}; },
        },
        queries: { 'tally.value': state => ({ n: state.domains.tally.n }) },
        settings: { defaults: { step: 1, label: 'Tally' } },
        tabs: [{ id: 'tally', title: 'Tally', render: () => {} }],
        capture: { kinds: { tally: { grammar: '+ tally Name' } }, apply: () => ({}) },
    };
}

test('ready resolves to the sdk once the host is up', async () => {
    const registry = createRegistry();
    const { sdk, markReady } = createSdk({ store: {}, bus: {}, registry, settings: () => ({}) });
    let resolved = null;
    sdk.ready.then(value => { resolved = value; });
    await Promise.resolve();
    assert.equal(resolved, null);
    markReady();
    assert.equal(await sdk.ready, sdk);
    assert.ok(Object.isFrozen(sdk));
    const host = await createHost({ fakes: true, core: false });
    assert.equal(await host.sdk.ready, host.sdk);
    host.close();
});

test('command commits, emits committed, and rejections come back as { ok: false, code, message }', async () => {
    const host = await createHost({ fakes: true, core: false, modules: [counter()] });
    const seen = [];
    host.sdk.on('committed', ({ receipt }) => seen.push(receipt.type));
    const done = await host.sdk.command('tally.add', { by: 2 });
    assert.equal(done.ok, true);
    assert.equal(done.receipt.cause, 'ui');
    assert.equal(done.receipt.module, 'counter');
    assert.equal(host.sdk.query('tally.value').n, 2);
    const system = await host.sdk.command('tally.add', {}, { cause: 'system' });
    assert.equal(system.receipt.cause, 'system');
    const over = await host.sdk.command('tally.add', { by: 5 });
    assert.deepEqual({ ok: over.ok, code: over.code }, { ok: false, code: 'INVALID' });
    assert.equal(host.sdk.query('tally.value').n, 3, 'nothing of a rejected command is kept');
    assert.equal((await host.sdk.command('tally.steal')).code, 'NOT_OWNER');
    assert.equal((await host.sdk.command('nope.nothing')).code, 'UNKNOWN_COMMAND');
    assert.deepEqual(seen, ['tally.add', 'tally.add']);
    host.close();
});

test('preview runs on a copy; commit applies exactly it, or STALE when the head moved', async () => {
    const host = await createHost({ fakes: true, core: false, modules: [counter()] });
    const preview = await host.sdk.preview('tally.add', { by: 1 });
    assert.equal(preview.ok, true);
    assert.equal(host.sdk.query('tally.value').n, 0, 'nothing saved by a preview');
    const committed = [];
    host.sdk.on('committed', ({ receipt }) => committed.push(receipt.id));
    const result = await host.sdk.commit(preview.token);
    assert.equal(result.ok, true);
    assert.deepEqual(committed, [result.receipt.id]);
    assert.equal(host.sdk.query('tally.value').n, 1);
    const stale = await host.sdk.preview('tally.add', { by: 1 });
    await host.sdk.command('tally.add', { by: 1 });
    assert.equal((await host.sdk.commit(stale.token)).code, 'STALE');
    host.close();
});

test('query answers plain copies; an unknown query is a clear error', async () => {
    const host = await createHost({ fakes: true, core: false, modules: [counter()] });
    const answer = host.sdk.query('tally.value');
    answer.n = 99;
    assert.equal(host.sdk.query('tally.value').n, 0);
    assert.throws(() => host.sdk.query('party.actors'), /no module answers the query "party.actors"/);
    host.close();
});

test('on: committed, head and turn; an unknown event is refused; a failing listener does not stop the others', () => {
    const events = createEvents();
    const got = [];
    const off = events.on('turn', value => got.push(['a', value]));
    events.on('turn', () => { throw new Error('listener bug'); });
    events.on('turn', value => got.push(['c', value]));
    const warn = console.warn;
    console.warn = () => {};
    try { events.emit('turn', 1); } finally { console.warn = warn; }
    off();
    events.emit('turn', 2);
    assert.deepEqual(got, [['a', 1], ['c', 1], ['c', 2]]);
    assert.throws(() => events.on('saved', () => {}), /there is no "saved" event/);
    assert.throws(() => events.on('head'), /needs a function/);
});

test('id(prefix): the prefix, an underscore and 8 base36 characters', () => {
    const ids = new Set();
    for (let i = 0; i < 500; i += 1) {
        const id = newId('it');
        assert.match(id, /^it_[0-9a-z]{8}$/);
        ids.add(id);
    }
    assert.equal(ids.size, 500);
    assert.throws(() => newId('It'), /lowercase letters and digits/);
    assert.throws(() => newId(''), /lowercase/);
});

test('settings: module values over defaults under extension_settings.storySuite.modules[id]; the host\'s own', () => {
    const registry = createRegistry();
    registry.register(counter());
    const es = {};
    let saves = 0;
    const settings = createSettings({ root: () => es, registry, save: () => { saves += 1; } });
    assert.deepEqual(settings('counter'), { step: 1, label: 'Tally' });
    assert.deepEqual(settings(), { ...HOST_SETTINGS_DEFAULTS });
    settings.set('counter', 'step', 5);
    settings.set(null, 'tailBudget', 900);
    assert.deepEqual(es.storySuite, { modules: { counter: { step: 5 } }, host: { tailBudget: 900 } });
    assert.deepEqual(settings('counter'), { step: 5, label: 'Tally' });
    assert.equal(settings().tailBudget, 900);
    assert.equal(saves, 2);
    // A copy: changing it changes nothing stored.
    settings('counter').step = 7;
    assert.equal(es.storySuite.modules.counter.step, 5);
    assert.deepEqual(settings('unknown'), {});
    // No extension_settings yet: defaults, nothing thrown.
    assert.deepEqual(createSettings({ root: () => null, registry })('counter'), { step: 1, label: 'Tally' });
});

test('modules() describes each module; settings(id) and view() read through the host', async () => {
    const host = await createHost({ fakes: true, core: false, modules: [counter()] });
    assert.deepEqual(host.sdk.modules(), [{
        id: 'counter', name: 'Counter', version: '2.0.0-alpha.1', domains: ['tally'], commands: ['tally.add', 'tally.steal'], kinds: ['tally'], tabs: ['tally'],
    }]);
    assert.equal(host.sdk.settings('counter').step, 1);
    const view = host.sdk.view();
    assert.ok(Object.isFrozen(view.state));
    assert.deepEqual(view.query('tally.value'), { n: 0 });
    assert.deepEqual(view.chat, { length: 1, lastUser: '' });
    assert.equal(typeof host.sdk.id, 'function');
    host.close();
});

test('a module registered mid-chat gets its initial state from a system receipt on the head carrier', async () => {
    const host = await createHost({ fakes: true, core: false });
    await host.send('Hi.', 'Hello.');
    assert.deepEqual(host.head().domains, {});
    const committed = [];
    host.sdk.on('committed', ({ receipt }) => committed.push(receipt));
    await host.sdk.registerModule(counter());
    assert.deepEqual(host.head().domains.tally, { n: 0 });
    assert.equal(committed.length, 1);
    assert.deepEqual({ type: committed[0].type, cause: committed[0].cause, narrate: committed[0].narrate }, { type: 'module.init.counter', cause: 'system', narrate: false });
    assert.deepEqual(host.ctx.chat[2].extra.storySuite.receipts.map(receipt => receipt.type), ['module.init.counter']);
    assert.deepEqual(missingModules(host.registry, host.head()), []);
    // A clash is thrown at the module's author, as register() does.
    await assert.rejects(host.sdk.registerModule(counter()), /already registered/);
    host.close();
});

test('makeView: the frozen head, a query on it, settings and the chat\'s length and last user text', () => {
    const registry = createRegistry();
    registry.register(counter());
    const state = Object.freeze(registry.initialState());
    const view = makeView({ store: { head: () => state }, registry, settings: () => ({}), chat: [{ is_user: true, mes: 'one' }, { is_user: false, mes: 'x' }, { is_user: true, mes: 'two' }] });
    assert.equal(view.state, state);
    assert.deepEqual(view.chat, { length: 3, lastUser: 'two' });
    assert.ok(Object.isFrozen(view));
    assert.deepEqual(view.query('tally.value'), { n: 0 });
});
