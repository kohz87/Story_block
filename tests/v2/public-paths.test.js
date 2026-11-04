// Public paths from modules (src/v2/public-paths.js, sdk.registerPublicPaths, docs/v2/PUBLIC-API.md "Paths from modules"): get, paths, the macro,
// hidden values, read-only frozen copies, one owner per prefix, our own roots, change events, unregister.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, hostAvailable } from '../../testkit/index.js';
import { createPublicApi } from '../../src/v2/public-api.js';
import { createPublicPaths, OWN_ROOTS } from '../../src/v2/public-paths.js';
import { createEvents } from '../../src/v2/sdk.js';
import { macroText } from '../../src/v2/sb-macro.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const settle = () => new Promise(resolve => setTimeout(resolve, 20));
const reply = (...lines) => `The tide turns.\n<Changes>\n${lines.join('\n')}\n</Changes>`;

// A module with a few NPC-like values that tests can change.
function meters() {
    const data = { 'mira vale': { trust: 40, affection: 10, secret: 99, mood: 'wary' }, 'mr. fox': { trust: 5 } };
    const hiddenKeys = new Set(['secret']);
    const paths = () => Object.entries(data).flatMap(([name, row]) => Object.keys(row).map(key => `npc.${name}.${key}`));
    const split = path => {
        const rest = path.slice(4).toLowerCase();
        const name = Object.keys(data).filter(candidate => rest.startsWith(`${candidate}.`)).sort((a, b) => b.length - a.length)[0];
        return name ? [name, rest.slice(name.length + 1)] : [null, null];
    };
    return {
        data,
        def: {
            owner: 'npc-state-delta', prefix: 'npc', paths,
            get: path => { const [name, key] = split(path); return name ? data[name][key] : undefined; },
            hidden: path => hiddenKeys.has(split(path)[1]),
        },
    };
}

test('get and paths include a module prefix; hidden paths are left out; names with dots are matched whole', { skip }, async t => {
    const host = await createHost();
    t.after(() => host.close());
    const m = meters();
    const off = host.sdk.registerPublicPaths(m.def);
    assert.equal(host.api.get('npc.mira vale.trust'), 40);
    assert.equal(host.api.get('NPC.Mira Vale.Trust'), 40);
    assert.equal(host.api.get('npc.mr. fox.trust'), 5);
    assert.equal(host.api.get('npc.mira vale.mood'), 'wary');
    assert.equal(host.api.get('npc.nobody.trust'), undefined);
    assert.ok(host.api.paths().includes('npc.mira vale.trust'));
    assert.ok(host.api.paths().includes('npc.mr. fox.trust'));
    assert.equal(typeof off, 'function');
});

test('a hidden path reads as undefined and is not listed', { skip }, async t => {
    const host = await createHost();
    t.after(() => host.close());
    const m = meters();
    host.sdk.registerPublicPaths(m.def);
    assert.equal(host.api.get('npc.mira vale.secret'), undefined);
    assert.ok(!host.api.paths().some(path => path.endsWith('.secret')));
    assert.equal(host.api.get('npc.mira vale.affection'), 10);
});

test('{{sb::…}} reads module paths and honours the fallback for a hidden one', { skip }, async t => {
    const host = await createHost();
    t.after(() => host.close());
    host.sdk.registerPublicPaths(meters().def);
    assert.equal(macroText(host.api, 'npc.mira vale.trust'), '40');
    assert.equal(macroText(host.api, 'npc.mira vale.mood'), 'wary');
    assert.equal(macroText(host.api, 'npc.mira vale.secret|hidden'), 'hidden');
    assert.equal(macroText(host.api, 'npc.nobody.trust|none'), 'none');
});

test('values are frozen plain copies; the module cannot be written through them; bad values read as undefined', { skip }, async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    const inner = { list: [1, 2], nested: { a: 1 } };
    host.sdk.registerPublicPaths({
        owner: 'm', prefix: 'mod', paths: () => ['mod.obj', 'mod.fn', 'mod.nan', 'mod.boom'],
        get: path => ({ 'mod.obj': inner, 'mod.fn': () => 1, 'mod.nan': NaN })[path] ?? (() => { throw new Error('x'); })(),
        hidden: () => false,
    });
    const value = host.api.get('mod.obj');
    assert.deepEqual(value, { list: [1, 2], nested: { a: 1 } });
    assert.ok(Object.isFrozen(value) && Object.isFrozen(value.list));
    assert.notEqual(value, inner);
    assert.equal(Object.isFrozen(inner), false);
    assert.equal(host.api.get('mod.fn'), undefined);
    assert.equal(host.api.get('mod.nan'), undefined);
    assert.equal(host.api.get('mod.boom'), undefined);
    assert.ok(Object.isFrozen(host.api.paths()));
});

test('a module that throws in paths() or hidden() is read as having nothing', { skip }, async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    host.sdk.registerPublicPaths({ owner: 'a', prefix: 'aa', paths: () => { throw new Error('no'); }, get: () => 1, hidden: () => false });
    host.sdk.registerPublicPaths({ owner: 'b', prefix: 'bb', paths: () => ['bb.x'], get: () => 1, hidden: () => { throw new Error('no'); } });
    assert.equal(host.api.get('bb.x'), undefined);
    assert.ok(!host.api.paths().some(path => path.startsWith('aa.') || path.startsWith('bb.')));
});

test('one owner per prefix; Story Block\'s own roots and bad prefixes are refused; the same owner may register again', { skip }, async t => {
    const host = await createHost();
    t.after(() => host.close());
    const base = { paths: () => [], get: () => undefined, hidden: () => false };
    for (const prefix of OWN_ROOTS) assert.throws(() => host.sdk.registerPublicPaths({ ...base, owner: 'x', prefix }), /own paths/);
    for (const prefix of ['', 'a.b', 'Npc', 'x y', 5, undefined]) assert.throws(() => host.sdk.registerPublicPaths({ ...base, owner: 'x', prefix }), /prefix/);
    assert.throws(() => host.sdk.registerPublicPaths({ ...base, prefix: 'okay' }), /owner/);
    assert.throws(() => host.sdk.registerPublicPaths({ ...base, owner: 'x', prefix: 'okay', get: null }), /functions/);
    assert.throws(() => host.sdk.registerPublicPaths(null), /needs/);
    const first = host.sdk.registerPublicPaths({ ...base, owner: 'one', prefix: 'okay' });
    assert.throws(() => host.sdk.registerPublicPaths({ ...base, owner: 'two', prefix: 'okay' }), /belongs to "one"/);
    const again = host.sdk.registerPublicPaths({ ...base, owner: 'one', prefix: 'okay', get: () => 7, paths: () => ['okay.x'] });
    assert.equal(host.api.get('okay.x'), 7);
    first();   // the replaced registration cannot take the new one out
    assert.equal(host.api.get('okay.x'), 7);
    again();
    assert.equal(host.api.get('okay.x'), undefined);
    host.sdk.registerPublicPaths({ ...base, owner: 'two', prefix: 'okay' });   // free again
});

test('unregister takes the paths out; a module cannot shadow our paths through get', { skip }, async t => {
    const host = await createHost();
    t.after(() => host.close());
    const off = host.sdk.registerPublicPaths(meters().def);
    assert.equal(host.api.get('npc.mira vale.trust'), 40);
    off();
    off();
    assert.equal(host.api.get('npc.mira vale.trust'), undefined);
    assert.ok(!host.api.paths().some(path => path.startsWith('npc.')));
    await host.send('Go.', reply('+ coin 5'));
    assert.equal(host.api.get('money'), 5);
});

test('story:changed lists a module meter that moved during the reply, and one that moved on its own (changed())', { skip }, async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    const m = meters();
    const off = host.sdk.registerPublicPaths(m.def);
    const seen = [];
    host.api.on('story:changed', payload => seen.push(payload));
    // The module's value moves while the reply is being read, then the reply lands.
    m.data['mira vale'].trust = 55;
    await host.send('Go.', reply('+ coin 5'));
    await settle();
    assert.equal(seen.length, 1);
    const trust = seen[0].changes.find(change => change.path === 'npc.mira vale.trust');
    assert.deepEqual(trust, { path: 'npc.mira vale.trust', from: 40, to: 55 });
    assert.ok(seen[0].changes.some(change => change.path === 'money'));
    // A hidden value moving is never told.
    m.data['mira vale'].secret = 1;
    m.data['mira vale'].affection = 12;
    off.changed();
    await settle();
    assert.equal(seen.length, 2);
    assert.deepEqual(seen[1].changes, [{ path: 'npc.mira vale.affection', from: 10, to: 12 }]);
    assert.equal(seen[1].index, host.store.headIndex());
    // Nothing moved: nothing told.
    off.changed();
    await settle();
    assert.equal(seen.length, 2);
    // A new NPC appearing is a change from null.
    m.data.newcomer = { trust: 3 };
    off.changed();
    await settle();
    assert.deepEqual(seen[2].changes, [{ path: 'npc.newcomer.trust', from: null, to: 3 }]);
    // Registering and unregistering are not changes.
    const before = seen.length;
    off();
    await settle();
    assert.equal(seen.length, before);
});

test('a reply that changes nothing public in a module says nothing about it', { skip }, async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    host.sdk.registerPublicPaths(meters().def);
    const seen = [];
    host.api.on('story:changed', payload => seen.push(payload));
    await host.send('Go.', 'Nothing happens.');
    await settle();
    assert.equal(seen.length, 0);
});

test('an older host without the hook: createPublicApi works with no registry at all', () => {
    const events = createEvents();
    const api = createPublicApi({ version: '1', state: () => null, ask: () => null, events });
    assert.equal(api.get('npc.mira.trust'), undefined);
    assert.deepEqual([...api.paths()], []);
});

test('createPublicPaths on its own: prefixes, owns, leaves skip hidden and undefined', () => {
    const registry = createPublicPaths({ log: () => {} });
    const m = meters();
    registry.register(m.def);
    assert.deepEqual(registry.prefixes(), ['npc']);
    assert.equal(registry.owns('npc.x'), true);
    assert.equal(registry.owns('scene.place'), false);
    const leaves = registry.leaves();
    assert.equal(leaves.get('npc.mira vale.trust'), 40);
    assert.equal(leaves.has('npc.mira vale.secret'), false);
});

test('values() is used for the diff when the module gives it (one call, hidden and foreign paths dropped); a bad values() falls back to paths and get', () => {
    const calls = { get: 0, values: 0 };
    const registry = createPublicPaths({ log: () => {} });
    registry.register({
        owner: 'm', prefix: 'mm', paths: () => ['mm.a', 'mm.b'], get: path => { calls.get += 1; return path === 'mm.a' ? 1 : 2; }, hidden: path => path === 'mm.h',
        values: () => { calls.values += 1; return { 'mm.a': 1, 'mm.b': 2, 'mm.h': 3, 'other.x': 4, 'mm.bad': () => 1 }; },
    });
    assert.deepEqual([...registry.leaves()], [['mm.a', 1], ['mm.b', 2]]);
    assert.deepEqual(calls, { get: 0, values: 1 });
    const broken = createPublicPaths({ log: () => {} });
    broken.register({ owner: 'm', prefix: 'mm', paths: () => ['mm.a'], get: () => 5, values: () => { throw new Error('no'); } });
    assert.deepEqual([...broken.leaves()], [['mm.a', 5]]);
    assert.throws(() => createPublicPaths().register({ owner: 'm', prefix: 'mm', paths: () => [], get: () => 1, values: 3 }), /values/);
});
