// sdk.preflight (docs/v2/LIFECYCLE.md): what the chat holds for a module, read
// before the module registers, with nothing written. One test per kind of store, then the shape,
// the peers, the inputs and the proof that it writes nothing.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createHost } from '../../testkit/index.js';
import { INIT_PREFIX, createRegistry } from '../../src/v2/registry.js';
import { PREFLIGHT_CLASSES, createSdk, preflight } from '../../src/v2/sdk.js';

const PEER = 'story-director';
const DOMAINS = ['party', 'effects', 'creation', 'gear', 'combat', 'bestiary', 'trade', 'craft', 'rules', 'progress', 'training', 'death'];
const RB = { module: 'sample-module', domains: DOMAINS, peers: [PEER], rulesVersion: 2 };
const unversioned = { module: 'sample-module', domains: DOMAINS, peers: [PEER] };
const mark = (rulesVersion, rulesHash = 'h-1') => ({ rulesVersion, rulesHash });

// A chat as a seed module left it: its domains' initial slices, one reply saved.
async function chatWith(domains) {
    const seeded = await createHost({ modules: [{ id: 'seed', domains: Object.fromEntries(Object.entries(domains).map(([name, slice]) => [name, { initial: () => slice }])) }] });
    await seeded.send('Hi.', 'Hello.');
    const chat = structuredClone(seeded.ctx.chat);
    seeded.close();
    return chat;
}
const carrierOf = chat => chat.find(message => message?.extra?.storySuite);
const open = async (chat, options = {}) => createHost({ st: { chat }, ...options });
// The host sets a chat up when it opens it (and starts a damaged record over), so damage is done to the
// open chat afterwards, to the record as a new object: `change(record)` edits a copy, or returns what replaces it.
const damage = (chat, change) => {
    const message = carrierOf(chat);
    const copy = structuredClone(message.extra.storySuite);
    message.extra.storySuite = change(copy) ?? copy;
};
const read = async (chat, options = RB, after = null) => {
    const host = await open(chat);
    if (after) { after(host.ctx.chat); host.store.rebuild(); }
    const out = host.sdk.preflight(options);
    host.close();
    return out;
};

test('the shape: hostApi, deferredDomains, hostVersion, storeVersion, classification, domains, rulesVersion, rulesHash, peers, restore', async () => {
    const host = await createHost();
    const out = host.sdk.preflight(RB);
    assert.deepEqual(Object.keys(out), ['hostApi', 'deferredDomains', 'hostVersion', 'storeVersion', 'classification', 'domains', 'rulesVersion', 'rulesHash', 'peers', 'restore']);
    assert.deepEqual(out, {
        hostApi: 2, deferredDomains: true, hostVersion: '2.7.1', storeVersion: 2, classification: 'empty', domains: [], rulesVersion: null, rulesHash: null,
        peers: [{ module: PEER, version: null, enabled: false }], restore: 'idle',
    });
    assert.ok(PREFLIGHT_CLASSES.includes(out.classification));
    host.close();
});

test('empty: a chat with no story yet, and a chat with a story that holds none of the module\'s domains', async () => {
    const none = await createHost({ st: { chat: [] } });
    assert.deepEqual({ ...none.sdk.preflight(RB), peers: undefined }, {
        hostApi: 2, deferredDomains: true, hostVersion: '2.7.1', storeVersion: null, classification: 'empty', domains: [], rulesVersion: null, rulesHash: null, peers: undefined, restore: 'idle',
    });
    none.close();
    const other = await read(await chatWith({ elsewhere: { n: 1 } }));
    assert.equal(other.classification, 'empty');
    assert.equal(other.storeVersion, 2);
    assert.deepEqual(other.domains, []);
});

test('current: the rules slice carries the generation asked for; other slices are not asked', async () => {
    const out = await read(await chatWith({ rules: { ...mark(2), classes: [] }, party: { actors: {} }, effects: { list: {} } }));
    assert.equal(out.classification, 'current');
    assert.deepEqual([out.domains, out.rulesVersion, out.rulesHash], [['party', 'effects', 'rules'], 2, 'h-1']);
    // Slices that repeat the mark agree with it.
    assert.equal((await read(await chatWith({ rules: { ...mark(2) }, party: { ...mark(2) }, combat: { ...mark(2) } }))).classification, 'current');
    // No generation asked: the rules slice's mark is read the same way.
    const unasked = await read(await chatWith({ rules: { ...mark(2) }, party: { actors: {} } }), unversioned);
    assert.deepEqual([unasked.classification, unasked.rulesVersion], ['current', 2]);
    // A module with no rules domain has no mark to look for: its slices are current.
    const plain = await read(await chatWith({ craft: { n: 1 } }), { module: 'someone-else', domains: ['craft'] });
    assert.deepEqual([plain.classification, plain.domains, plain.rulesVersion], ['current', ['craft'], null]);
});

test('legacy: the old party with no marked rules slice is legacy, never current and never empty', async () => {
    const old = await read(await chatWith({ party: { actors: { hero: { hp: 3 } } }, combat: { offers: {} } }));
    assert.equal(old.classification, 'legacy');
    assert.deepEqual([old.domains, old.rulesVersion, old.rulesHash], [['party', 'combat'], null, null]);
    // Asking for no generation changes nothing: unmarked slices are legacy.
    assert.equal((await read(await chatWith({ party: { actors: {} } }), unversioned)).classification, 'legacy');
    // A marked party is not a marked rules slice; a rules slice with no mark is none.
    assert.equal((await read(await chatWith({ party: { ...mark(2), actors: {} } }))).classification, 'legacy');
    assert.equal((await read(await chatWith({ rules: { classes: [] }, party: {} }))).classification, 'legacy');
    // An older generation in the rules slice.
    const older = await read(await chatWith({ rules: { ...mark(1) }, party: { actors: {} } }));
    assert.deepEqual([older.classification, older.rulesVersion], ['legacy', 1]);
});

test('mixed: another slice carries a mark that disagrees with the rules slice', async () => {
    const stale = await read(await chatWith({ rules: { ...mark(2) }, party: { ...mark(1) } }));
    assert.deepEqual([stale.classification, stale.rulesVersion], ['mixed', 2]);
    const twoHashes = await read(await chatWith({ rules: { ...mark(2, 'h-1') }, effects: { ...mark(2, 'h-2') } }));
    assert.deepEqual([twoHashes.classification, twoHashes.rulesHash], ['mixed', 'h-1']);
    const above = await read(await chatWith({ rules: { ...mark(2) }, party: { ...mark(3) } }));
    assert.equal(above.classification, 'mixed');
    assert.equal((await read(await chatWith({ rules: { ...mark(1) }, party: { ...mark(2) } }), unversioned)).classification, 'mixed', 'also with no generation asked');
});

test('future: the rules mark above the one asked, and a newer store record', async () => {
    const rules = await read(await chatWith({ rules: { ...mark(3) }, party: { actors: {} } }));
    assert.deepEqual([rules.classification, rules.rulesVersion], ['future', 3]);
    const chat = await chatWith({ rules: { ...mark(2) }, party: { actors: {} } });
    const store = await read(chat, RB, open => damage(open, record => { record.v = 3; }));
    assert.deepEqual([store.classification, store.storeVersion], ['future', 3]);
});

test('damaged: data that cannot be read is damaged, never empty', async () => {
    const chat = await chatWith({ rules: { ...mark(2) }, party: { actors: {} } });
    for (const [name, change] of [
        ['a record that is not an object', () => 'garbage'],
        ['a record with no list of changes', record => { delete record.ops; }],
        ['a checkpoint that is not a state', record => { record.checkpoint = 'oops'; }],
        ['an old record version', record => { record.v = 1; }],
        ['a record version that is not a number', record => { record.v = '2'; }],
    ]) {
        const out = await read(structuredClone(chat), RB, open => damage(open, change));
        assert.equal(out.classification, 'damaged', name);
    }
    // A slice that is not an object, and a rules mark that is not a mark (in the state the record starts from).
    const seeded = await chatWith({ rules: { ...mark(2) }, party: { actors: {} } });
    for (const [name, slice] of [
        ['a slice that is a number', 5],
        ['a slice that is a list', []],
        ['a generation that is text', { rulesVersion: '2', actors: {} }],
        ['a generation of zero', { rulesVersion: 0, actors: {} }],
        ['a hash that is a number', { rulesVersion: 2, rulesHash: 7, actors: {} }],
        ['a hash that is empty', { rulesVersion: 2, rulesHash: '', actors: {} }],
        ['a hash with no generation', { rulesHash: 'h-1' }],
    ]) {
        const out = await read(structuredClone(seeded), RB, open => damage(open, record => { record.checkpoint.domains.rules = slice; }));
        assert.equal(out.classification, 'damaged', name);
    }
});

test('damaged: a chat the sdk cannot read at all', () => {
    const registry = createRegistry({ hostVersion: '2.0.0-beta.2' });
    const run = (chat, store = { head: () => null }) => preflight({ store, registry, chat }, RB).classification;
    assert.equal(run(() => { throw new Error('gone'); }), 'damaged');
    assert.equal(run(() => 'a string'), 'damaged');
    assert.equal(run(() => ({ length: 1 })), 'damaged');
    assert.equal(run(() => [], { head: () => { throw new Error('replay failed'); } }), 'damaged');
    assert.equal(run(() => [], { head: () => 'not a state' }), 'damaged');
    assert.equal(run(() => [], { head: () => ({ v: 2, domains: 4 }) }), 'damaged');
    assert.equal(run(() => [{ is_user: false, get extra() { throw new Error('locked'); } }]), 'damaged');
    // The state itself, whatever the records say: a slice that is not an object, a mark that is not a mark.
    for (const rules of [5, [], 'x', { rulesVersion: '2' }, { rulesVersion: 0 }, { rulesVersion: 2, rulesHash: 7 }, { rulesVersion: 2, rulesHash: '' }, { rulesHash: 'h' }]) {
        assert.equal(run(() => [], { head: () => ({ v: 2, domains: { rules } }) }), 'damaged', JSON.stringify(rules));
    }
    assert.equal(run(() => [], { head: () => ({ v: 2, domains: { party: 5 } }) }), 'damaged', 'a slice that is not an object');
    assert.equal(run(() => [], { head: () => ({ v: 2, domains: { rules: { rulesVersion: 2, rulesHash: 'h' } } }) }), 'current');
    // Nothing stored at all is empty.
    assert.equal(run(() => []), 'empty');
    assert.equal(run(() => undefined), 'empty');
    assert.equal(run(() => [{ is_user: false, mes: 'Hello.' }, { is_user: true, mes: 'Hi.' }]), 'empty');
});

test('damaged: records that exist but do not replay into a state are damaged, not empty', async () => {
    const chat = await chatWith({ party: { ...mark(2), actors: {} } });
    // The record keeps v: 2 and its lists, but the host cannot put a state together from it.
    const out = await read(chat, RB, open => damage(open, record => { record.checkpoint = { v: 2, meta: 'x', domains: 'x' }; }));
    assert.equal(out.classification, 'damaged');
});

test('works for a registered module (its own domains) and for a module that names its domains and peers', async () => {
    const chat = await chatWith({ rules: { ...mark(2) }, party: { actors: {} }, craft: { n: 1 }, unrelated: { n: 1 } });
    const host = await open(chat);
    // Not registered and not known: no domains, so nothing of it is stored.
    assert.equal(host.sdk.preflight({ module: 'someone-else', rulesVersion: 2 }).classification, 'empty');
    // Named by the caller.
    const named = host.sdk.preflight({ module: 'someone-else', rulesVersion: 2, domains: ['party', 'craft', 'rules'], peers: [PEER, 'a-mod'] });
    assert.deepEqual([named.classification, named.domains], ['current', ['party', 'craft', 'rules']]);
    assert.deepEqual(named.peers.map(peer => peer.module), [PEER, 'a-mod']);
    // Registered: its definition's domains, its requires.peers.
    await host.sdk.registerModule({ id: 'someone-else', version: '1.0.0', requires: { peers: { 'a-mod': '^1' } }, domains: { craft: { initial: () => ({ n: 0 }) }, rules: { initial: () => ({}) } } });
    const own = host.sdk.preflight({ module: 'someone-else', rulesVersion: 2 });
    assert.deepEqual([own.classification, own.domains, own.peers], ['current', ['craft', 'rules'], [{ module: 'a-mod', version: null, enabled: false }]]);
    host.close();
});

test('peers: version and whether each is enabled; restore is the barrier\'s state', async () => {
    const host = await createHost({ modules: [{ id: PEER, name: 'Story Director', version: '2.0.0-beta.2' }] });
    assert.deepEqual(host.sdk.preflight(RB).peers, [{ module: PEER, version: '2.0.0-beta.2', enabled: true }]);
    host.registry.setEnabled(PEER, false);
    assert.deepEqual(host.sdk.preflight(RB).peers, [{ module: PEER, version: '2.0.0-beta.2', enabled: false }]);
    host.registry.setRestore('pending', 'x');
    assert.equal(host.sdk.preflight(RB).restore, 'pending');
    host.registry.setRestore('failed', 'y');
    assert.equal(host.sdk.preflight(RB).restore, 'failed');
    host.registry.setRestore('idle');
    assert.equal(host.sdk.preflight(RB).restore, 'idle');
    host.close();
});

test('the inputs are checked: a bad call throws, it does not say empty', async () => {
    const host = await createHost();
    for (const bad of [undefined, null, 'sample-module', {}, { module: '' }, { module: 'Bad Id' }, { module: 7 }]) {
        assert.throws(() => host.sdk.preflight(bad), TypeError, JSON.stringify(bad));
    }
    for (const rulesVersion of [0, -1, 1.5, '2', NaN]) assert.throws(() => host.sdk.preflight({ module: 'sample-module', rulesVersion }), TypeError, String(rulesVersion));
    // A list that is given is a list of valid names: nothing is dropped quietly, which would read as empty.
    for (const domains of ['party', {}, 5, ['Party'], ['bad name'], ['party', 7], [null], ['a/b']]) assert.throws(() => host.sdk.preflight({ module: 'zzz', domains }), TypeError, JSON.stringify(domains));
    for (const peers of ['story-director', {}, 5, ['Story Director'], [3], ['']]) assert.throws(() => host.sdk.preflight({ module: 'zzz', peers }), TypeError, JSON.stringify(peers));
    assert.doesNotThrow(() => host.sdk.preflight({ module: 'zzz', domains: [], peers: [] }));
    assert.doesNotThrow(() => host.sdk.preflight({ module: 'zzz', domains: null, peers: undefined }));
    assert.doesNotThrow(() => host.sdk.preflight({ module: 'sample-module', rulesVersion: null }));
    assert.doesNotThrow(() => host.sdk.preflight(unversioned));
    host.close();
});

test('available before registration, and before the host is marked ready', () => {
    const registry = createRegistry({ hostVersion: '2.0.0-beta.2' });
    const { sdk } = createSdk({ store: { head: () => null, headIndex: () => -1 }, bus: {}, registry, settings: () => ({}) });
    assert.equal(typeof sdk.preflight, 'function');
    assert.equal(sdk.preflight(RB).classification, 'empty');
    assert.equal(registry.has('sample-module'), false);
});

test('read-only: for every kind of store nothing is written, set up, repaired or saved', async () => {
    const stores = {
        current: await chatWith({ rules: { ...mark(2) }, party: { actors: {} } }),
        legacy: await chatWith({ party: { actors: { hero: { hp: 3 } } } }),
        mixed: await chatWith({ rules: { ...mark(2) }, party: { ...mark(1), actors: {} } }),
        future: await chatWith({ rules: { ...mark(3) }, party: { actors: {} } }),
        empty: await chatWith({ elsewhere: {} }),
    };
    stores.damaged = await chatWith({ rules: { ...mark(2) }, party: { actors: {} } });
    // A chat that has replies but no story record yet (set up only on the first turn).
    stores.fresh = [{ name: 'Narrator', is_user: false, mes: 'A new tale.', swipes: ['A new tale.'], swipe_id: 0, swipe_info: [{ extra: {} }], extra: {} }];

    const after = { damaged: open => damage(open, record => { record.checkpoint = 'oops'; }) };
    for (const [kind, chat] of Object.entries(stores)) {
        const host = await open(structuredClone(chat));
        if (after[kind]) { after[kind](host.ctx.chat); host.store.rebuild(); }
        const saves = [];
        const saveChat = host.ctx.saveChat;
        host.ctx.saveChat = (...args) => { saves.push(args); return saveChat?.apply(host.ctx, args); };
        const before = JSON.stringify({ chat: host.ctx.chat, meta: host.ctx.chatMetadata, settings: host.ctx.extensionSettings });
        const receipts = host.sdk.receipts().length;
        const dirty = host.store.dirty();
        const out = host.sdk.preflight(RB);
        assert.ok(PREFLIGHT_CLASSES.includes(out.classification), kind);
        await new Promise(resolve => setTimeout(resolve, 5));
        assert.equal(JSON.stringify({ chat: host.ctx.chat, meta: host.ctx.chatMetadata, settings: host.ctx.extensionSettings }), before, `${kind}: the chat, its metadata and the settings are as they were`);
        assert.equal(host.sdk.receipts().length, receipts, `${kind}: no receipt`);
        assert.equal(host.store.dirty(), dirty, `${kind}: nothing marked unsaved`);
        assert.deepEqual(saves, [], `${kind}: no save`);
        host.close();
    }
    assert.deepEqual(Object.fromEntries(await Promise.all(Object.entries(stores).map(async ([kind, chat]) => [kind, (await read(structuredClone(chat), RB, after[kind])).classification]))),
        { current: 'current', legacy: 'legacy', mixed: 'mixed', future: 'future', empty: 'empty', damaged: 'damaged', fresh: 'empty' });
});

test('an old party is untouched before registration, and registering a ready module afterwards does not reset it', async () => {
    const chat = await chatWith({ party: { actors: { hero: { hp: 3 } }, order: ['hero'] } });
    const host = await open(chat);
    const before = structuredClone(host.head().domains.party);
    assert.equal(host.sdk.preflight(RB).classification, 'legacy');
    assert.deepEqual(host.head().domains.party, before);

    // The module registers (its peer is there): it sets up the slices the chat lacks and leaves the party.
    await host.sdk.registerModule({ id: PEER, name: 'Story Director', version: '2.0.0-beta.2' });
    await host.sdk.registerModule({
        id: 'sample-module', name: 'Sample module', version: '2.0.0-beta.2', requires: { peers: { [PEER]: '^2' } },
        domains: { party: { initial: () => ({ actors: {} }) }, effects: { initial: () => ({ list: {} }) }, rules: { initial: () => ({ ...mark(2), classes: [] }) } },
    });
    assert.deepEqual(host.head().domains.party, before, 'the old party is as it was');
    assert.ok(host.head().domains.effects, 'the missing slices are added');
    const init = host.sdk.receipts().map(entry => entry.receipt).filter(receipt => receipt.type === `${INIT_PREFIX}sample-module`);
    assert.deepEqual(init.map(receipt => receipt.data.domains), [['effects', 'rules']]);
    // The host does not stop it: the module asks first (above) and does not register on a legacy chat. Once its
    // rules slice is there the chat reads as current.
    assert.equal(host.sdk.preflight(RB).classification, 'current');
    host.close();
});
