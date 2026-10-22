// The installed list in extension_settings.storySuite.packs: install, update, on/off,
// remove, and nothing saved when a pack is refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInstalled } from '../../../src/v2/packs/installed.js';
import { resolveItemIn, contentOf } from '../../../src/v2/packs/content.js';
import { fakeSettings } from './helpers/fake-settings.js';
import { itemsPack, pack, sample, sampleText } from './helpers/fixtures.js';

const setup = (options = {}, initial = {}) => {
    const settings = fakeSettings(initial);
    return { settings, installed: createInstalled({ settings, ...options }) };
};

test('installing keeps the pack as given, under its id, switched on', async () => {
    const { settings, installed } = setup();
    const result = await installed.install(sampleText, { source: 'file', origin: 'riverside.json' });
    assert.deepEqual(result, { ok: true, id: 'riverside-starter', name: 'Riverside Starter', action: 'installed' });
    assert.equal(settings.saves, 1);
    const [stored] = settings.root.packs;
    assert.deepEqual({ ...stored, pack: undefined }, { id: 'riverside-starter', version: '1.0.0', enabled: true, source: 'file', origin: 'riverside.json', pack: undefined });
    assert.deepEqual(stored.pack, sample(), 'the raw pack, not the normalized form');
    assert.deepEqual(installed.list(), [{
        id: 'riverside-starter', version: '1.0.0', name: 'Riverside Starter', author: 'Story Suite examples',
        description: sample().description, enabled: true, source: 'file', origin: 'riverside.json',
        counts: { items: 4, creatures: 1, shops: 1, recipes: 1, events: 2, quests: 0, races: 1, talents: 1 }, hasStart: true, extras: ['a money word', 'a theme'], missing: [], problem: '',
    }]);
    assert.equal(installed.packs()[0].content.items.length, 4);
});

test('a refused pack saves nothing and leaves the list as it was', async () => {
    const { settings, installed } = setup();
    await installed.install(pack({ id: 'first' }));
    const before = structuredClone(settings.root);
    for (const bad of ['{ nope', pack({ id: 'Bad Id' }), pack({ id: 'first', version: 'x' }), pack({ id: 'evil', name: '<script>' }), pack({ requires: { storyBlock: '^9' } })]) {
        const result = await installed.install(bad);
        assert.equal(result.ok, false);
        assert.ok(result.errors.length);
    }
    assert.deepEqual(settings.root, before);
    assert.equal(settings.saves, 1);
});

test('the same id updates in place, keeps its switch; the same pack again changes nothing', async () => {
    const { settings, installed } = setup();
    await installed.install(pack({ id: 'a' }));
    await installed.install(pack({ id: 'b', name: 'B one' }));
    await installed.install(pack({ id: 'c' }));
    await installed.setEnabled('b', false);
    const saves = settings.saves;
    assert.equal((await installed.install(pack({ id: 'b', name: 'B one' }))).action, 'unchanged');
    assert.equal(settings.saves, saves);
    const updated = await installed.install(pack({ id: 'b', version: '1.1.0', name: 'B two' }), { source: 'lorebook', origin: 'lorebook:x#1' });
    assert.equal(updated.action, 'updated');
    assert.deepEqual(installed.list().map(entry => [entry.id, entry.version, entry.name, entry.enabled, entry.source]), [
        ['a', '1.0.0', 'a', true, 'file'], ['b', '1.1.0', 'B two', false, 'lorebook'], ['c', '1.0.0', 'c', true, 'file'],
    ]);
});

test('switching a pack off takes its content and items out of every lookup', async () => {
    const { installed } = setup();
    await installed.install(itemsPack('alpha', [{ name: 'Rope', value: 3 }]));
    await installed.install(itemsPack('beta', [{ name: 'Rope', value: 9 }, { name: 'Tar' }]));
    const lookup = name => resolveItemIn(installed.packs(), name)?.id ?? null;
    assert.equal(lookup('rope'), 'pack.alpha/rope');
    assert.equal(contentOf(installed.packs(), 'items').length, 3);
    assert.equal(await installed.setEnabled('alpha', false), true);
    assert.equal(lookup('rope'), 'pack.beta/rope', 'the next pack now answers');
    assert.deepEqual(contentOf(installed.packs(), 'items').map(item => item.id), ['pack.beta/rope', 'pack.beta/tar']);
    await installed.setEnabled('beta', false);
    assert.equal(lookup('rope'), null);
    assert.deepEqual(contentOf(installed.packs(), 'items'), []);
    await installed.setEnabled('alpha', true);
    assert.equal(lookup('pack.beta/tar'), null, 'a full ID of a switched-off pack is not found');
    assert.equal(lookup('rope'), 'pack.alpha/rope');
    assert.equal(await installed.setEnabled('nobody', true), false);
});

test('removing a pack', async () => {
    const { settings, installed } = setup();
    await installed.install(pack({ id: 'a' }));
    await installed.install(pack({ id: 'b' }));
    assert.equal(await installed.remove('a'), true);
    assert.deepEqual(installed.list().map(entry => entry.id), ['b']);
    assert.equal(await installed.remove('a'), false);
    assert.equal(settings.saves, 3);
});

test('a stored pack is checked again on read; one that fails is listed with its problem', () => {
    const tampered = pack({ id: 'tampered', content: { items: [{ name: 'Rope', note: '<script>x</script>' }] } });
    const { installed } = setup({}, { packs: [
        { id: 'tampered', version: '1.0.0', enabled: true, source: 'file', origin: '', pack: tampered },
        { id: 'empty', version: '1.0.0', enabled: true },
        'junk',
        { id: 'fine', version: '1.0.0', source: 'odd', pack: pack({ id: 'fine', content: { items: [{ name: 'Tar' }] } }) },
    ] });
    const list = installed.list();
    assert.deepEqual(list.map(entry => entry.id), ['tampered', 'empty', 'fine']);
    assert.match(list[0].problem, /HTML tag/);
    assert.match(list[1].problem, /missing/);
    assert.equal(list[2].problem, '');
    assert.equal(list[2].source, 'file');
    assert.deepEqual(installed.packs().map(entry => entry.id), ['fine']);
});

test('a missing settings list is created; non-list values are replaced', () => {
    const { settings, installed } = setup({}, { packs: 'oops', modules: { x: 1 } });
    assert.deepEqual(installed.list(), []);
    assert.deepEqual(settings.root, { packs: [], modules: { x: 1 } });
    assert.throws(() => createInstalled({}), /settings/);
});

test('limits on how many packs and how much data are installed', async () => {
    const { installed } = setup({ limits: { ...(await import('../../../src/v2/packs/limits.js')).LIMITS, installed: 2, installedBytes: 400 } });
    assert.equal((await installed.install(pack({ id: 'a' }))).ok, true);
    assert.equal((await installed.install(pack({ id: 'b' }))).ok, true);
    const third = await installed.install(pack({ id: 'c' }));
    assert.equal(third.errors[0].code, 'TOO_MANY');
    assert.equal((await installed.install(pack({ id: 'b', version: '1.0.1' }))).action, 'updated', 'an update is not one more');
    const big = await installed.install(pack({ id: 'b', version: '1.0.2', description: 'd'.repeat(300) }));
    assert.equal(big.errors[0].code, 'TOO_LARGE');
});

test('capabilities: refused at install when known missing, reported live afterwards', async () => {
    let have = ['inventory', 'scene'];
    const { installed } = setup({ capabilities: () => have });
    const needsParty = pack({ id: 'battle', requires: { storyBlock: '^2', capabilities: ['party'] } });
    assert.equal((await installed.install(needsParty)).errors[0].code, 'MISSING_CAPABILITY');
    have = ['inventory', 'scene', 'party'];
    assert.equal((await installed.install(needsParty)).ok, true);
    have = ['inventory'];
    assert.deepEqual(installed.list()[0].missing, ['party'], 'RPG Battle switched off later');
    assert.equal(installed.packs().length, 1, 'its content is still offered');
});

test('the host version decides requires.storyBlock', async () => {
    let version = '2.0.0-alpha.1';
    const { installed } = setup({ hostVersion: () => version });
    const needs21 = pack({ requires: { storyBlock: '^2.1' } });
    assert.equal((await installed.install(needs21)).errors[0].code, 'HOST_VERSION');
    version = '2.1.0';
    assert.equal((await installed.install(needs21)).ok, true);
});

test('listeners hear every change', async () => {
    const { installed } = setup();
    let heard = 0;
    const stop = installed.subscribe(() => { heard += 1; });
    await installed.install(pack());
    await installed.setEnabled('mini', false);
    await installed.setEnabled('mini', false);
    await installed.remove('mini');
    stop();
    await installed.install(pack());
    assert.equal(heard, 3, 'a switch to the same value is no change');
});
