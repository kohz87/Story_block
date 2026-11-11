// Inventory actions keep their accessible disclosure behavior without a battle module.
import test from 'node:test';
import assert from 'node:assert/strict';
import { inventoryScreen } from '../../../src/v2/screens/index.js';
import { core, foldButtons, foldOf, openFold, queries, renderSkip, settle, show, stocked, text } from './helpers.js';
import { readFileSync } from 'node:fs';
import { stackOf } from '../../../src/v2/view/modal-stack.js';
import { gearHost } from '../helpers/gear-ui-state.js';
import { createInventoryGridWidget, createInventoryViewWidget, INVENTORY_GRID_WIDGET, INVENTORY_VIEW_WIDGET } from '../../../src/v2/screens/inventory-add.js';
import { cssOf } from '../helpers/css-parts.js';

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
const sheetOf = doc => doc.body.querySelector('.inv-sheet');
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
    const folds = el.querySelectorAll('.worn-wearer > .fold-head');
    // The List's CSS hides every `.worn-who` that holds no `.item` row: a Grid fold must not carry that class, or Grid shows no worn gear.
    assert.equal(el.querySelectorAll('.worn-who').length, 0, 'no Grid fold uses the class the List CSS hides');
    assert.equal(el.querySelectorAll('.worn-wearer .tile').length, 5, 'the worn pieces are tiles inside the wearer\'s fold');
    assert.deepEqual(folds.map(node => text(node.querySelector('.fold-label'))), ['You · 5 pieces']);
    folds[0].click();
    assert.equal(el.querySelector('.worn-wearer > .fold-head').getAttribute('aria-expanded'), 'false');
    assert.equal(el.querySelectorAll('.fold-head').find(node => node.getAttribute('data-fold') === 'cat-goods').getAttribute('aria-expanded'), 'true', 'the other folds are not touched');
});

test('Inventory Grid, gear on: a tile opens the sheet with the row\'s actions and no Give; Equip from it sends the row\'s command', { skip }, async t => {
    const { run } = await gridWorld(t, { extra: ['+ item Grey Hood | slot: head'] });
    const { el, calls, doc } = run();
    await settle2();
    tileOf(el, 'Grey Hood').click();
    const sheet = sheetOf(doc);
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
    assert.equal(sheetOf(doc), null, 'the sheet closed');
});

test('Inventory Grid: Escape closes the sheet and the focus goes back to the tile', { skip }, async t => {
    const { run } = await gridWorld(t);
    const { el, doc } = run();
    await settle2();
    const tile = tiles(el)[0];
    tile.click();
    assert.ok(sheetOf(doc));
    sheetOf(doc).parentNode.dispatch('keydown', { key: 'Escape' });
    assert.equal(sheetOf(doc), null);
    assert.equal(doc.activeElement, tile);
});

test('Inventory Grid: the sheet is a layer on the body, not inside the screen; Escape in it does not reach the game view; Edit\'s Escape neither', { skip }, async t => {
    const { run } = await gridWorld(t);
    const { el, doc } = run();
    await settle2();
    // a game view under it: a layer of the same stack, as mounts/screen.js pushes one
    let gameEscapes = 0;
    const game = doc.createElement('div');
    doc.body.append(game);
    stackOf(doc).push({ name: 'game', root: game, onEscape: () => { gameEscapes += 1; return true; } });
    tiles(el)[0].click();
    const sheet = sheetOf(doc);
    assert.equal(sheet.closest('.inv'), null, 'not inside the screen');
    assert.equal(el.querySelector('.inv-sheet'), null);
    assert.equal(sheet.parentNode.parentNode, doc.body, 'its layer is on the body');
    assert.ok(sheet.parentNode.className.includes('ss-dialog-backdrop'), 'the app\'s dialog layer');
    assert.equal(stackOf(doc).top().root, sheet, 'the top layer of the host stack');
    const event = sheet.querySelector('button').dispatch('keydown', { key: 'Escape' });
    assert.equal(event.stopped, true, 'stopped at the sheet');
    assert.equal(gameEscapes, 0, 'the game view did not get the key');
    assert.equal(sheetOf(doc), null);
    // Edit: a key inside the form
    tiles(el)[0].click();
    [...sheetOf(doc).querySelectorAll('.sheet-act > button')].find(node => text(node) === 'Edit').click();
    const field = sheetOf(doc).querySelector('input');
    assert.ok(field, 'the Edit form is in the sheet');
    field.dispatch('keydown', { key: 'Escape' });
    assert.equal(gameEscapes, 0, 'Escape in the Edit form does not reach the game view');
    assert.equal(sheetOf(doc), null, 'and closes the sheet');
    stackOf(doc).pop(stackOf(doc).top());
});

test('Inventory Grid: closing the sheet after a redraw puts the focus on the redrawn tile; a redraw keeps the focus on its tile', { skip }, async t => {
    const { run } = await gridWorld(t);
    const { el, doc } = run();
    await settle2();
    const first = tiles(el)[0];
    const stack = first.getAttribute('data-stack');
    first.click();
    // the screen draws again under the open sheet (a fold of another section is pressed): every tile is a new node
    const other = el.querySelectorAll('.fold-head').find(node => !first.closest('section').querySelector('.fold-head').getAttribute('data-fold').includes(node.getAttribute('data-fold')));
    other.click();
    const redrawn = tiles(el).find(node => node.getAttribute('data-stack') === stack);
    assert.notEqual(redrawn, first, 'the tile is a new node');
    sheetOf(doc).parentNode.dispatch('keydown', { key: 'Escape' });
    assert.equal(doc.activeElement, redrawn, 'the focus is on the redrawn tile, not a detached one or the body');
    redrawn.click();
    sheetOf(doc).querySelector('.sheet-close').click();
    assert.equal(doc.activeElement.getAttribute('data-stack'), stack);
    // a redraw with the focus on a tile keeps it on that stack's tile
    const now = tiles(el).find(node => node.getAttribute('data-stack') === stack);
    now.focus();
    const find = el.querySelector('input.find');
    find.value = now.querySelector('.nm').textContent.slice(0, 2);
    find.dispatch('input');
    await settle2();
    assert.notEqual(tiles(el).find(node => node.getAttribute('data-stack') === stack), now, 'drawn again');
    assert.equal(doc.activeElement.getAttribute('data-stack'), stack, 'a redraw keeps the focus on the tile of the same stack');
});

test('Inventory Grid, gear off: Equip from the sheet sends inventory.equip, as the row does', { skip }, async () => {
    const module = core();
    const state = stocked(module);
    const { el, calls, doc } = show(inventoryScreen, { state, query: queries(module, state), draft: {}, widgets: gridWidgets(memory()) });
    await settle2();
    tileOf(el, 'Iron Sword').click();
    doc.body.querySelectorAll('.sheet-act > button').find(node => text(node) === 'Equip').click();
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

test('the inventory sheet\'s style sheet is imported by size.css and its rules are not in mounts.css', () => {
    const read = name => readFileSync(new URL(`../../../src/v2/view/${name}`, import.meta.url), 'utf8');
    assert.match(read('size.css'), /^@import url\('\.\/inv-sheet\.css'\);$/m);
    assert.match(read('inv-sheet.css'), /\.ss-dialog\.inv-sheet/);
    assert.match(read('inv-sheet.css'), /@supports[^{]*rgb\(from[^{]*\{\s*\.ss-dialog\.inv-sheet \{ background-color: var\(--ss-sheet-floor, rgb\(from var\(--ss-surface\) r g b \/ 1\)\)/, 'an opaque floor under non-Glass styles');
    assert.doesNotMatch(cssOf('mounts'), /inv-sheet/);
});

test('Inventory Grid: the focus survives the screen building the widget again (tab and game-view mounts); a gone item hands it to the next tile', { skip }, async t => {
    const { run } = await gridWorld(t);
    const { doc } = run();
    await settle2();
    const widget = createInventoryGridWidget({ chatKey: () => 'rebuild' });
    const item = (stack, name) => ({ stack, name, kind: 'goods', qty: 1, rarity: '', note: '' });
    const all = [item('s1', 'Aa'), item('s2', 'Bb'), item('s3', 'Cc')];
    const mount = items => {
        const host = doc.createElement('div');
        doc.body.append(host);
        const view = widget.render(host, { items, counts: {}, users: {} }, { command: () => {} });
        return { host, view };
    };
    const tileOf = (host, stack) => host.querySelector(`[data-stack="${stack}"]`);
    // Drop: the sheet closes, the screen is built again without the item: the focus goes to the next tile
    let now = mount(all);
    tileOf(now.host, 's2').click();
    [...sheetOf(doc).querySelectorAll('.sheet-act > button')].find(node => text(node) === 'Drop').click();
    now.view.destroy();
    now.host.remove();
    now = mount(all.filter(one => one.stack !== 's2'));
    assert.equal(doc.activeElement, tileOf(now.host, 's3'), 'the next tile, not the body');
    // the last item gone: the one before it
    tileOf(now.host, 's3').click();
    sheetOf(doc).querySelector('.sheet-close').click();
    now.view.destroy();
    now.host.remove();
    now = mount([all[0]]);
    assert.equal(doc.activeElement, tileOf(now.host, 's1'), 'the same tile when the item is still there, else its neighbour');
    // the item stays (Edit save): the same tile
    tileOf(now.host, 's1').click();
    sheetOf(doc).querySelector('.sheet-close').click();
    now.view.destroy();
    now.host.remove();
    doc.activeElement?.blur?.();
    now = mount(all);
    assert.equal(doc.activeElement, tileOf(now.host, 's1'));
    // focus somewhere else is left alone
    const other = doc.createElement('button');
    doc.body.append(other);
    tileOf(now.host, 's1').click();
    sheetOf(doc).querySelector('.sheet-close').click();
    now.view.destroy();
    now.host.remove();
    other.focus();
    mount(all);
    assert.equal(doc.activeElement, other, 'a focus on something else stays');
});

test('Inventory Grid: a focus carried from one chat\'s sheet is not taken by another chat\'s grid', { skip }, async t => {
    const { run } = await gridWorld(t);
    const { doc } = run();
    await settle2();
    let chat = 'one';
    const widget = createInventoryGridWidget({ chatKey: () => chat });
    const items = [{ stack: 's1', name: 'Aa', kind: 'goods', qty: 1, rarity: '', note: '' }];
    const mount = () => {
        const host = doc.createElement('div');
        doc.body.append(host);
        return { host, view: widget.render(host, { items, counts: {}, users: {} }, { command: () => {} }) };
    };
    const first = mount();
    first.host.querySelector('[data-stack="s1"]').click();
    sheetOf(doc).querySelector('.sheet-close').click();
    first.view.destroy();
    first.host.remove();
    doc.activeElement?.blur?.();
    chat = 'two';
    mount();
    assert.equal(doc.activeElement === doc.body || doc.activeElement === null, true, 'another chat keeps the focus where it was (on the body)');
});
