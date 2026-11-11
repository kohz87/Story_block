// Inventory actions keep their accessible disclosure behavior without a battle module.
import test from 'node:test';
import assert from 'node:assert/strict';
import { inventoryScreen } from '../../../src/v2/screens/index.js';
import { core, foldButtons, foldOf, openFold, queries, renderSkip, settle, show, stocked, text } from './helpers.js';
import { gearHost } from '../helpers/gear-ui-state.js';
import { createInventoryGridWidget, createInventoryViewWidget, INVENTORY_GRID_WIDGET, INVENTORY_VIEW_WIDGET } from '../../../src/v2/screens/inventory-add.js';

const skip = renderSkip;
function world() {
    const module = core();
    const state = stocked(module);
    const query = queries(module, state);
    return { state, ...show(inventoryScreen, { state, query, draft: {} }) };
}
const trigger = (el, stack, kind) => foldButtons(el, stack).find(node => node.getAttribute('value') === kind);

test('equipment can be managed alone and no battle widget or member picker is mounted', { skip }, () => {
    const { el, view } = world();
    assert.deepEqual(view.warnings, []);
    const item = el.querySelectorAll('.item').find(row => row.querySelector('.name').textContent === 'Iron Sword');
    assert.ok(item.querySelector('[data-command="inventory.equip"]'));
    assert.equal(item.querySelector('[value="equipOn"]'), null);
    assert.deepEqual(el.querySelectorAll('ss-widget').map(node => node.getAttribute('name')), [INVENTORY_VIEW_WIDGET], 'only the List | Grid switch is mounted');
    assert.ok(el.querySelector('option[value="equipment"]'));
});

test('the Drop disclosure opens, closes on Escape and restores focus', { skip }, () => {
    const { el, doc } = world();
    const drop = trigger(el, 'it_sword001', 'drop');
    assert.equal(drop.getAttribute('aria-expanded'), 'false');
    drop.click();
    assert.equal(trigger(el, 'it_sword001', 'drop').getAttribute('aria-expanded'), 'true');
    const panel = foldOf(el, 'it_sword001');
    assert.ok(panel);
    const cancel = panel.querySelector('.fold-cancel');
    cancel.focus();
    cancel.dispatch('keydown', { key: 'Escape' });
    assert.equal(foldOf(el, 'it_sword001'), null);
    assert.equal(doc.activeElement, trigger(el, 'it_sword001', 'drop'));
});

test('Cancel closes the Drop disclosure and leaves actions in reading order', { skip }, () => {
    const { el, doc } = world();
    openFold(el, 'it_sword001', 'drop');
    const item = el.querySelectorAll('.item').find(row => row.querySelector('.name').textContent === 'Iron Sword');
    const buttons = item.querySelectorAll('button');
    assert.ok(buttons.some(node => /Drop/.test(text(node))));
    for (const node of buttons) assert.equal(node.getAttribute('tabindex'), null);
    const cancel = foldOf(el, 'it_sword001').querySelector('.fold-cancel');
    cancel.focus();
    cancel.click();
    assert.equal(foldOf(el, 'it_sword001'), null);
    assert.equal(doc.activeElement, trigger(el, 'it_sword001', 'drop'));
});

// ---- Grid view (default) and List view ----
const memory = () => { const map = new Map(); return { map, getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) }; };
const broken = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); }, removeItem() { throw new Error('no'); } };
const gridWidgets = (store, chat = 'chat-1', fallback = 'grid') => ({
    [INVENTORY_VIEW_WIDGET]: createInventoryViewWidget({ storage: store, fallback }),
    [INVENTORY_GRID_WIDGET]: createInventoryGridWidget({ chatKey: () => chat, storage: store }),
});
const settle2 = async () => { await settle(); await settle(); };
const tiles = el => el.querySelectorAll('.tile');
const tileOf = (el, name) => tiles(el).find(node => node.querySelector('.nm').textContent === name);
const viewButton = (el, label) => el.querySelectorAll('.inv-view button').find(node => text(node) === label);
async function gridWorld(t, { store = memory(), chat = 'chat-1', gear = true, extra = [] } = {}) {
    const host = await gearHost(t, { gear, extra });
    const run = (draft = {}) => show(inventoryScreen, { state: host.head(), query: host.sdk.query, draft, widgets: gridWidgets(store, chat), command: (type, payload, opts) => host.sdk.command(type, payload, opts) });
    return { host, store, run };
}

test('Inventory: Grid is the default view; List is the old rows', { skip }, async t => {
    const { run } = await gridWorld(t);
    const { el } = run();
    await settle2();
    assert.equal(viewButton(el, 'Grid').getAttribute('aria-pressed'), 'true');
    assert.ok(tiles(el).length > 0);
    assert.equal(el.querySelectorAll('li.item').filter(row => row.querySelector('.name')).length, 0, 'no list rows in Grid');
});

test('Inventory: switching to List is remembered on this device; storage that throws falls back to Grid', { skip }, async t => {
    const { run, store } = await gridWorld(t);
    const first = run();
    await settle2();
    viewButton(first.el, 'List').click();
    await settle2();
    assert.equal(tiles(first.el).length, 0);
    assert.ok(first.el.querySelectorAll('li.item .name').length > 0, 'the list rows are back');
    assert.equal(store.map.get('story-block.inventoryView'), 'list');
    const again = run();
    await settle2();
    assert.equal(tiles(again.el).length, 0, 'the next visit opens List');
    const failing = (await gridWorld(t, { store: broken })).run();
    await settle2();
    assert.ok(tiles(failing.el).length > 0, 'a failing read still draws Grid');
});

test('Inventory Grid: a category fold closes and stays closed when the screen is drawn again', { skip }, async t => {
    const { run } = await gridWorld(t);
    const first = run();
    await settle2();
    const head = first.el.querySelectorAll('.fold-head').find(node => node.getAttribute('data-fold') === 'cat-goods');
    assert.equal(head.getAttribute('aria-expanded'), 'true');
    head.click();
    const closed = first.el.querySelectorAll('.fold-head').find(node => node.getAttribute('data-fold') === 'cat-goods');
    assert.equal(closed.getAttribute('aria-expanded'), 'false');
    const body = first.el.querySelector(`#${closed.getAttribute('aria-controls')}`);
    assert.equal(body.hidden, true);
    const again = run();
    await settle2();
    assert.equal(again.el.querySelectorAll('.fold-head').find(node => node.getAttribute('data-fold') === 'cat-goods').getAttribute('aria-expanded'), 'false');
});

test('Inventory Grid, gear on: Worn has one fold per wearer with its count, each its own', { skip }, async t => {
    const { run } = await gridWorld(t);
    const { el } = run();
    await settle2();
    const folds = el.querySelectorAll('.worn-who > .fold-head');
    assert.deepEqual(folds.map(node => text(node.querySelector('.fold-label'))), ['You · 5 pieces']);
    folds[0].click();
    assert.equal(el.querySelector('.worn-who > .fold-head').getAttribute('aria-expanded'), 'false');
    assert.equal(el.querySelectorAll('.fold-head').find(node => node.getAttribute('data-fold') === 'cat-goods').getAttribute('aria-expanded'), 'true', 'the other folds are not touched');
});

test('Inventory Grid, gear on: a tile opens the sheet with the row\'s actions and no Give; Equip from it sends the row\'s command', { skip }, async t => {
    const { run } = await gridWorld(t, { extra: ['+ item Grey Hood | slot: head'] });
    const { el, calls } = run();
    await settle2();
    tileOf(el, 'Grey Hood').click();
    const sheet = el.querySelector('.sheet');
    const labels = sheet.querySelectorAll('.sheet-act > button').map(node => text(node));
    assert.deepEqual(labels, ['Equip', 'Drop', 'Edit']);
    assert.ok(!labels.some(label => /give|repair|mend/i.test(label)));
    sheet.querySelectorAll('.sheet-act > button').find(node => text(node) === 'Equip').click();
    const who = sheet.querySelectorAll('.sheet-choices button').find(node => text(node) === 'You');
    who.click();
    await settle2();
    assert.equal(calls[0][0], 'item.equip');
    assert.equal(calls[0][1].owner.length > 0, true);
    assert.equal(calls[0][1].transfer, true);
    assert.equal(el.querySelector('.sheet'), null, 'the sheet closed');
});

test('Inventory Grid: Escape closes the sheet and the focus goes back to the tile', { skip }, async t => {
    const { run } = await gridWorld(t);
    const { el, doc } = run();
    await settle2();
    const tile = tiles(el)[0];
    tile.click();
    assert.ok(el.querySelector('.sheet'));
    el.querySelector('.sheet-layer').dispatch('keydown', { key: 'Escape' });
    assert.equal(el.querySelector('.sheet'), null);
    assert.equal(doc.activeElement, tile);
});

test('Inventory Grid, gear off: Equip from the sheet sends inventory.equip, as the row does', { skip }, async () => {
    const module = core();
    const state = stocked(module);
    const { el, calls } = show(inventoryScreen, { state, query: queries(module, state), draft: {}, widgets: gridWidgets(memory()) });
    await settle2();
    tileOf(el, 'Iron Sword').click();
    el.querySelectorAll('.sheet-act > button').find(node => text(node) === 'Equip').click();
    await settle2();
    assert.deepEqual(calls[0].slice(0, 2), ['inventory.equip', { stack: 'it_sword001' }]);
});

test('Inventory Grid: a storage that throws on every call still draws the folds', { skip }, async t => {
    const { run } = await gridWorld(t, { store: broken });
    const { el } = run();
    await settle2();
    const head = el.querySelector('.fold-head');
    head.click();
    assert.ok(el.querySelector('.fold-head'), 'drawn again');
    assert.equal(el.querySelector('.fold-head').getAttribute('aria-expanded'), 'false', 'the choice lasts this page');
});
