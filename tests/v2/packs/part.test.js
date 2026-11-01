// The packs part as Story Block's core module merges it (MODULES §A): its shape, its
// queries and hooks as another part reaches them, and the live binding to SillyTavern.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPacksPart, part as livePart, packs as livePacks, resolveItem as liveResolve, startState as liveStart } from '../../../src/v2/packs/index.js';
import { slugify } from '../../../src/v2/packs/validate.js';
import { foldKey } from '../../../src/text.js';
import { fakeCtx } from './helpers/fake-ctx.js';
import { fakeSettings } from './helpers/fake-settings.js';
import { installFakeSillyTavern } from './helpers/fake-st.js';
import { itemsPack, pack, sampleText } from './helpers/fixtures.js';

test('the part has the MODULES §A shape and no domain, command or prompt text of its own', () => {
    const { part } = createPacksPart({ settings: fakeSettings() });
    assert.deepEqual(Object.keys(part), ['domains', 'commands', 'queries', 'kinds', 'context', 'hooks', 'settings', 'tabs']);
    assert.deepEqual(part.domains, {});
    assert.deepEqual(part.commands, {});
    assert.deepEqual(part.kinds, {});
    assert.deepEqual(part.tabs, []);
    assert.deepEqual(Object.keys(part.queries), ['packs.list', 'packs.content', 'packs.item', 'packs.itemDefs', 'packs.start', 'packs.calendar', 'packs.weather', 'packs.youRank', 'packs.crafts', 'packs.economy', 'packs.markets', 'packs.portrait']);
    assert.deepEqual(Object.keys(part.hooks), ['item.resolve', 'start']);
    assert.equal(part.context.static(), '', 'the static prompt stays byte-identical whatever is installed');
    assert.deepEqual(part.context.tail({}), { lines: [], optional: [] });
    assert.equal(part.context.budget, 0);
    assert.equal(part.settings.section, 'Packs');
    assert.equal(typeof part.settings.render, 'function');
});

test('queries answer from the enabled packs, whatever the state', async () => {
    const settings = fakeSettings();
    const { part, packs } = createPacksPart({ settings });
    await packs.install(sampleText);
    const ctx = fakeCtx({ queries: part.queries });
    assert.deepEqual(ctx.query('packs.list').map(entry => entry.id), ['riverside-starter']);
    assert.equal(ctx.query('packs.content', { kind: 'items' }).length, 4);
    assert.deepEqual(ctx.query('packs.content', { kind: 'events', pack: 'nobody' }), []);
    assert.deepEqual(ctx.query('packs.content'), [], 'no kind, nothing');
    assert.equal(ctx.query('packs.item', { name: 'trout' }).id, 'pack.riverside-starter/moonveil-trout');
    assert.equal(ctx.query('packs.item'), null);
    assert.equal(ctx.query('packs.start').scene.place.name, 'Bluewatch Village');
    assert.equal(part.hooks['item.resolve']('Willow Rod').id, 'pack.riverside-starter/willow-rod');
    assert.equal(part.hooks.start().inventory.money, 50);
    await packs.setEnabled('riverside-starter', false);
    assert.deepEqual(ctx.query('packs.content', { kind: 'items' }), []);
    assert.equal(part.hooks['item.resolve']('Willow Rod'), null);
    assert.equal(ctx.query('packs.start').scene.place, null);
    assert.equal(ctx.query('packs.list')[0].enabled, false, 'still listed');
});

// How inventory capture is expected to use the hook (SB-domains wires the real one):
// its own aliases first, then packs, then a new story def.
function captureItem(state, name, ctx) {
    const inventory = state.domains.inventory;
    const known = inventory.aliases[foldKey(name)];
    if (known) return inventory.defs[known];
    const def = ctx.query('packs.item', { name }) ?? { id: `story/${slugify(name)}`, name, kind: 'goods', rarity: 'common', value: 0 };
    inventory.defs[def.id] ??= def;
    inventory.aliases[foldKey(name)] = def.id;
    return def;
}

test('item resolution order seen from inventory capture: inventory, packs, story', async () => {
    const { part, packs } = createPacksPart({ settings: fakeSettings() });
    await packs.install(itemsPack('alpha', [{ name: 'Rope', value: 3 }, { name: 'Lantern', value: 40 }]));
    await packs.install(itemsPack('beta', [{ name: 'Rope', value: 9 }, { name: 'Tar', value: 1 }]));
    const state = { v: 2, meta: { rev: 0, claims: {} }, domains: { inventory: { defs: { 'story/lantern': { id: 'story/lantern', name: 'Lantern', value: 0 } }, stacks: {}, wallets: {}, aliases: { lantern: 'story/lantern' } } } };
    const ctx = fakeCtx({ state, queries: part.queries });
    assert.equal(captureItem(state, 'Lantern', ctx).id, 'story/lantern', 'a def the chat already has wins over a pack');
    assert.equal(captureItem(state, 'Rope', ctx).id, 'pack.alpha/rope', 'then the first enabled pack');
    assert.equal(captureItem(state, 'Tar', ctx).value, 1);
    assert.equal(captureItem(state, 'Moonveil Trout', ctx).id, 'story/moonveil-trout', 'then a story def');
    await packs.setEnabled('alpha', false);
    assert.equal(captureItem(state, 'Rope', ctx).id, 'pack.alpha/rope', 'once captured, the chat keeps its copy');
    assert.equal(state.domains.inventory.defs['pack.alpha/rope'].value, 3);
});

test('the settings panel renderer binds to the part\'s own list', async () => {
    const { installFakeDom } = await import('../../ui-fake-dom.js');
    const doc = installFakeDom();
    const { part, packs } = createPacksPart({ settings: fakeSettings() });
    await packs.install(pack({ id: 'shown', name: 'Shown Pack' }));
    const root = doc.createElement('div');
    const notes = [];
    part.settings.render(root, { notify: text => notes.push(text) });
    assert.equal(root.querySelector('.ss-packs-row').dataset.packId, 'shown');
    part.settings.render(doc.createElement('div'), undefined);
});

test('the live part reads and saves extension_settings.storySuite.packs through SillyTavern', async () => {
    assert.ok(livePart.queries['packs.list']);
    const st = installFakeSillyTavern();
    try {
        assert.deepEqual(livePacks.list(), []);
        assert.deepEqual(st.ctx.extensionSettings.storySuite, { packs: [] });
        const result = await livePacks.install(sampleText, { origin: 'riverside.json' });
        assert.equal(result.ok, true);
        assert.equal(st.calls.saves, 1, 'saved with saveSettingsDebounced');
        assert.equal(st.ctx.extensionSettings.storySuite.packs[0].id, 'riverside-starter');
        assert.equal(liveResolve('Hemp Line').id, 'pack.riverside-starter/hemp-line');
        assert.equal(liveStart().inventory.items.length, 3);
        st.ctx.extensionSettings.storySuite = 'broken';
        assert.deepEqual(livePacks.list(), [], 'a broken settings value starts over');
    } finally {
        st.uninstall();
    }
    assert.deepEqual(livePacks.list(), [], 'without SillyTavern the list is in memory only');
});

test('the live part checks capabilities against the running sdk', async () => {
    const st = installFakeSillyTavern();
    globalThis.StoryBlock = { sdk: { version: '2.0.0-alpha.2', modules: () => [{ id: 'story-block', domains: { scene: {}, inventory: {} } }, { id: 'rpg-battle', domains: { party: {} }, capabilities: ['combat'] }] } };
    try {
        const needs = list => pack({ id: 'needs', requires: { storyBlock: '^2', capabilities: list } });
        assert.equal((await livePacks.install(needs(['party', 'combat', 'rpg-battle', 'inventory']))).ok, true);
        assert.equal((await livePacks.install(needs(['director']))).errors[0].code, 'MISSING_CAPABILITY');
        globalThis.StoryBlock.sdk.version = '3.0.0';
        assert.equal((await livePacks.install(pack({ id: 'old' }))).errors[0].code, 'HOST_VERSION');
    } finally {
        delete globalThis.StoryBlock;
        st.uninstall();
    }
});
