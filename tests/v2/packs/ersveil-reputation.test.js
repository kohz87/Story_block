// Ersveil's Standing, Fame and Guild are sections of one Reputation tab (BLOCKS-UI), and the layouts change nothing the story is told.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setupDom } from '../view/mounts/helpers.js';
import { world, pin, success } from '../data-modules/helpers.js';
import { mergeTabs } from '../../../src/v2/view/tab-merge.js';
import { grammarFor, summaryOf } from '../../../src/v2/data-modules/part.js';
import { renderLayout } from '../../../src/v2/layout/render.js';
import { editableLayout } from '../../../src/v2/data-modules/editable-layout.js';
import { createFieldsWidgets } from '../../../src/v2/screens/block-fields.js';
import { FIELDS_WIDGET } from '../../../src/v2/data-modules/fields-widget.js';

const ersveil = () => JSON.parse(readFileSync(new URL('../../../examples/packs/ersveil/pack.json', import.meta.url), 'utf8'));
const MODULES = ['standing', 'fame', 'guild-membership'];
async function pinned(t, only = MODULES, input = ersveil()) {
    const host = await world(t, input);
    for (const slug of only) {
        const offer = host.sdk.query('dataModules.offers').find(row => row.module === `pack.ersveil/${slug}`);
        success(await host.sdk.command('dm.pin', { module: offer.module, hash: offer.hash, packHash: offer.packHash }));
    }
    return host;
}

test('the pack names one tab for its three screens, and the host draws them as sections of it in the pack\'s order', async t => {
    const host = await pinned(t);
    const screens = host.sdk.query('dataModules.presentation', { kind: 'screens' });
    assert.deepEqual(screens.map(screen => screen.tab), ['reputation', 'reputation', 'reputation']);
    const merged = mergeTabs(screens);
    assert.equal(merged.length, 1, 'three screens, one tab');
    assert.equal(merged[0].id, 'story-block/tab/reputation');
    assert.equal(merged[0].title, 'Reputation');
    const sections = merged[0].layout.root.children;
    assert.deepEqual(sections.map(node => node.props.module.split('/')[1]), ['guild-membership', 'standing', 'fame'], 'Guild, Standing, Fame');
    assert.equal(sections.every(node => node.type === FIELDS_WIDGET), true, 'each section draws its own header');
    assert.deepEqual(merged[0].mounts, ['tab']);
});

test('a module that is not pinned is simply not a section', async t => {
    const host = await pinned(t, ['standing', 'guild-membership']);
    const merged = mergeTabs(host.sdk.query('dataModules.presentation', { kind: 'screens' }));
    assert.deepEqual(merged[0].layout.root.children.map(node => node.props.module.split('/')[1]), ['guild-membership', 'standing']);
});

test('Standing, Fame and Guild draw as a record card and maps of numbers with their own names', async t => {
    const doc = setupDom();
    const host = await pinned(t);
    await host.send('Begin.', 'Opening.');
    const set = async (module, field, value, key) => success(await host.sdk.command('dm.set', { module: `pack.ersveil/${module}`, field, value, ...(key ? { key } : {}) }));
    await set('standing', 'standing', 12, 'highmark'); await set('standing', 'standing', -20, 'hand'); await set('fame', 'fame', 18, 'bluewatch');
    await set('guild-membership', 'registered', true);
    const merged = mergeTabs(host.sdk.query('dataModules.presentation', { kind: 'screens' }))[0];
    const el = doc.createElement('div');
    const api = { query: host.sdk.query, command: host.sdk.command };
    const widgets = createFieldsWidgets();
    const handles = merged.layout.root.children.map(node => { const slot = doc.createElement('div'); el.appendChild(slot); return widgets[FIELDS_WIDGET].render(slot, node.props, api); });
    t.after(() => handles.forEach(handle => handle.destroy()));
    assert.deepEqual(el.querySelectorAll('.ss-section-label').map(node => node.textContent), ['Adventurer Guild', 'Standing with the powers', 'Fame by region']);
    assert.deepEqual(el.querySelectorAll('.ss-b-recsec .ss-b-line dt').map(node => node.textContent), ['Rank', 'Standing', 'Dues'], 'three tiles, no Years as a member');
    assert.equal(el.querySelectorAll('.ss-b-recsec .ss-b-card.ss-rm-tiles').length, 1);
    assert.deepEqual(el.querySelectorAll('.ss-b-recsec .ss-b-line dd').map(node => node.textContent), ['F', 'probation', '50 c / year'], 'the rank letter, a plain word, the dues with their unit');
    assert.equal(el.querySelectorAll('.ss-b-recsec .ss-rm-badge').length, 1, 'the rank is a letter badge');
    assert.equal(el.querySelectorAll('.ss-b-recsec .ss-b-chip, .ss-b-recsec .ss-pill').length, 0, 'no pill or chip in a tile');
    assert.equal(el.querySelectorAll('.ss-b-recsec .ss-rm-warn').length, 1, 'probation reads amber');
    assert.equal(el.querySelectorAll('.ss-b-recsec .ss-w-editable-pencil').length, 0, 'a tile has no pencil');
    const maps = el.querySelectorAll('.ss-b-map');
    assert.deepEqual(maps[0].querySelectorAll('.ss-b-box > .ss-b-list > .ss-b-row .ss-b-name').map(node => node.textContent), ['Highmark', 'Hand of Oblivion'], 'highest first, by the pack\'s own names');
    assert.equal(maps[0].querySelector('summary').textContent, 'Not known yet (8)');
    assert.equal(maps[1].querySelector('.ss-b-sub').textContent, '1 of 16 known');
    assert.equal(maps.length, 2, 'no Court favour map');
});

test('what the story is told is the same with or without the screens: the static lines and the tail do not move', async t => {
    const plain = ersveil();
    for (const module of plain.content.dataModules) { delete module.screens; }
    const withScreens = await pinned(t), without = await pinned(t, MODULES, plain);
    assert.equal(grammarFor(withScreens.head()), grammarFor(without.head()), 'the static data-module lines');
    for (const slug of MODULES) assert.equal(summaryOf(withScreens.head(), `pack.ersveil/${slug}`), summaryOf(without.head(), `pack.ersveil/${slug}`), slug);
    assert.ok(grammarFor(withScreens.head()).length > 0);
});

test('a meter with no maximum takes its field\'s own, and a bare number shows its value, not a dash', async t => {
    const doc = setupDom();
    const definition = { id: 'pack.x/f', scope: 'chat', state: { fame: { type: 'map', keys: ['a'], values: { type: 'int', min: 0, max: 100, default: 0 } }, hp: { type: 'int', min: 0, max: 20, default: 5 } } };
    const bind = path => ({ query: 'dataModules.view', args: { module: 'pack.x/f' }, path });
    const layout = { root: { type: 'col', children: [{ type: 'meter', label: 'A', bind: bind('chat.fame.a') }, { type: 'meter', label: 'HP', bind: bind('chat.hp') }] } };
    const edited = editableLayout(layout, definition);
    const meters = edited.root.children.map(row => row.children[0]);
    assert.deepEqual(meters.map(meter => meter.max), [100, 20], 'the field\'s own bounds');
    const query = (name, args) => ({ chat: { fame: { a: 18 }, hp: 7 } });
    const el = doc.createElement('div');
    renderLayout(el, { id: 'x', root: layout.root }, { query });
    assert.deepEqual(el.querySelectorAll('.ss-l-meter-num').map(node => node.textContent), ['18', '7'], 'no maximum: the value alone');
    const second = doc.createElement('div');
    renderLayout(second, { id: 'y', root: edited.root }, { query });
    assert.deepEqual(second.querySelectorAll('.ss-l-meter-num').map(node => node.textContent), ['18 / 100', '7 / 20']);
});

test('in the host the three screens are one tab, Reputation, and none of them a tab of its own', async t => {
    const { mountUi } = await import('../../../src/v2/ui-host.js');
    const { createHost } = await import('../../../testkit/index.js');
    const doc = setupDom(), form = doc.createElement('div'); form.id = 'send_form'; doc.body.appendChild(form);
    doc.defaultView = { confirm: () => true };
    const host = await createHost(), ui = mountUi({ runtime: host, ctx: host.ctx, doc });
    t.after(() => { ui.destroy(); host.close(); });
    success(await host.packs.packs.install(ersveil()));
    await host.send('Begin.', 'Opening.');
    for (const slug of MODULES) {
        const offer = host.sdk.query('dataModules.offers').find(row => row.module === `pack.ersveil/${slug}`);
        success(await host.sdk.command('dm.pin', { module: offer.module, hash: offer.hash, packHash: offer.packHash }));
    }
    ui.syncScreens();
    const tabs = ui.screens.list('tab').map(entry => entry.id);
    assert.ok(tabs.includes('story-block/tab/reputation'));
    for (const id of ['ersveil-standing', 'ersveil-fame', 'ersveil-guild-membership']) assert.equal(tabs.includes(id), false, id);
    assert.equal(ui.screens.resolve('story-block/tab/reputation').screen.title, 'Reputation');
});

// The Guild rank in the player's look follows the guild-membership module (the owner's Ersveil chat, 12 Nov): the narrator wrote
// "~ you rank: Registered" / "~ you rank: F" while the clerk had only asked for the fee and the module still said registered false.
const block = lines => `Story.\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
test('a ~ you rank line that contradicts the Guild module is refused with a Problem; the other parts stay', async t => {
    const host = await pinned(t);
    await host.send('Begin.', 'Opening.');
    for (const claim of ['Registered', 'F']) {
        await host.send('Go on.', block([`~ you rank: ${claim} | wearing: a grey coat`]));
        const you = host.sdk.query('scene.you');
        assert.equal(you.wearing, 'a grey coat', `${claim}: the other part is kept`);
        assert.equal(you.rank, 'Unregistered', `${claim}: shown as the module says`);
    }
    await host.send('Say so.', block(['~ you rank: unregistered']));
    assert.equal(host.sdk.query('scene.you').rank, 'unregistered', 'a line that agrees is stored as written');
});

test('once the module says registered, the letter must match it', async t => {
    const host = await pinned(t);
    await host.send('Begin.', 'Opening.');
    success(await host.sdk.command('dm.set', { module: 'pack.ersveil/guild-membership', field: 'registered', value: true }));
    await host.send('Pay.', block(['~ you rank: E-rank | wearing: coat']));
    assert.equal(host.sdk.query('scene.you').rank, 'Guild F', 'a different letter is refused; the module\'s letter shows');
    await host.send('Sign.', block(['~ you rank: F-rank, Adventurer Guild']));
    assert.equal(host.sdk.query('scene.you').rank, 'F-rank, Adventurer Guild');
});
