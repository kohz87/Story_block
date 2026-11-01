// Which screens sit in the bar and which are under More (view/tab-order.js isInBar / setNavInBar, view/screen-bar.js, mounts/screen.js,
// host-ui.js createTabHost): Home, Inventory, Quests, World and Map by default, with the RPG's Party and, while a fight is on, Fight;
// every other screen under More, on a wide screen too (the wide row then ends with More). The reader's choice per screen wins and is
// kept with the order and the hidden ones; those older choices work as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BAR, HOME_ID, inDefaultBar } from '../../../src/v2/view/screens.js';
import { isDefaultChoice, isInBar, moveNav, readTabChoice, setNavHidden, setNavInBar, createTabOrderStore } from '../../../src/v2/view/tab-order.js';
import { createScreenBar, pinAlerts, splitItems } from '../../../src/v2/view/screen-bar.js';
import { createScreenMount } from '../../../src/v2/view/mounts/screen.js';
import { createScreens } from '../../../src/v2/view/screens.js';
import { createTabHost } from '../../../src/v2/host-ui.js';
import { fakeRenderer, setupDom, stateWith } from './mounts/helpers.js';
import { installDom, host } from './widgets/fake-dom.js';
import { installFakeDom } from '../../ui-fake-dom.js';

const ids = nodes => nodes.map(node => node.getAttribute('data-id'));

test('by default the bar holds Home, Inventory, Quests, World, Map and the RPG\'s Party and Fight; every other screen is under More', () => {
    assert.deepEqual([...DEFAULT_BAR], [HOME_ID, 'story-block/inventory', 'story-director/quests', 'story-director/world', 'story-director/map', 'story-block/party', 'story-block/fight']);
    for (const id of DEFAULT_BAR) assert.equal(isInBar({}, id), true, id);
    for (const id of ['story-director/chronicle', 'story-director/director', 'npc-state-delta/cast', 'story-block/scene', 'story-block/block/ledger', 'ersveil-fame', 'rpg-battle/crafting', 'rpg-battle/trade']) {
        assert.equal(isInBar({}, id), false, `${id} is under More`);
    }
    assert.equal(inDefaultBar('rpg-battle/party'), true, 'a Party or a Fight from another module is one by the last part of its id, as DEFAULT_ORDER places them');
    assert.equal(inDefaultBar('rpg-battle/fight'), true);
});

test('the reader\'s choice wins: a screen put in the bar, one put under More; Home cannot leave the bar', () => {
    let choice = setNavInBar(null, 'story-director/chronicle', true);
    assert.equal(isInBar(choice, 'story-director/chronicle'), true);
    choice = setNavInBar(choice, 'story-director/map', false);
    assert.equal(isInBar(choice, 'story-director/map'), false);
    assert.deepEqual(choice, { order: [], hidden: [], shown: [], inBar: ['story-director/chronicle'], underMore: ['story-director/map'] });
    assert.deepEqual(setNavInBar(choice, HOME_ID, false), choice, 'Home stays in the bar');
    assert.equal(isInBar(choice, HOME_ID), true);
    // Back to the default place: the choice forgets it (the default can change later), and nothing is left over.
    choice = setNavInBar(setNavInBar(choice, 'story-director/chronicle', false), 'story-director/map', true);
    assert.deepEqual(choice, { order: [], hidden: [], shown: [] });
    assert.equal(isDefaultChoice(choice), true);
    assert.equal(isDefaultChoice({ inBar: ['x/y'] }), false, 'a place the reader chose is a change');
});

test('older choices (order, hidden, shown) read the same, keep working, and are kept when a place is chosen; moving and hiding keep the places', () => {
    const old = { order: ['story-director/director', 'story-block/inventory'], hidden: ['story-block/scene'], shown: [] };
    assert.deepEqual(readTabChoice(old), old, 'no new keys appear on a choice that has none');
    assert.equal(isInBar(old, 'story-director/director'), false, 'an order alone does not move a screen into the bar');
    let choice = setNavInBar(old, 'story-director/director', true);
    assert.deepEqual(choice, { ...old, inBar: ['story-director/director'] });
    choice = setNavHidden(choice, 'story-block/inventory', true);
    assert.deepEqual(choice.inBar, ['story-director/director'], 'hiding keeps the places');
    choice = moveNav(choice, ['story-director/director', 'story-block/inventory', 'story-director/quests'], 'story-director/quests', -1);
    assert.deepEqual(choice.inBar, ['story-director/director'], 'moving keeps the places');
    assert.deepEqual(choice.hidden, ['story-block/scene', 'story-block/inventory']);
});

test('a choice is read safely: strings only, no repeats, no Home, an id in both lists is in the bar, bounded', () => {
    const clean = readTabChoice({ inBar: ['a/b', 'a/b', 4, HOME_ID, '', 'c/d'], underMore: ['c/d', 'e/f', null], order: [], hidden: [] });
    assert.deepEqual(clean.inBar, ['a/b', 'c/d']);
    assert.deepEqual(clean.underMore, ['e/f']);
    assert.deepEqual(readTabChoice({ inBar: 'x', underMore: { y: 1 } }), { order: [], hidden: [], shown: [] });
    assert.equal(readTabChoice({ inBar: Array.from({ length: 500 }, (_, at) => `a/${at}`) }).inBar.length, 200);
});

test('the places are stored per reader with the rest of the choice, saved, and forgotten by reset', () => {
    const settings = {};
    let saves = 0;
    const store = createTabOrderStore({ extensionSettings: settings, saveSettingsDebounced: () => { saves += 1; } });
    store.set(setNavInBar(store.choice(), 'story-director/chronicle', true));
    assert.deepEqual(settings.storySuite.tabs.inBar, ['story-director/chronicle']);
    assert.equal(saves, 1);
    assert.equal(isInBar(store.choice(), 'story-director/chronicle'), true);
    store.reset();
    assert.equal(settings.storySuite.tabs, undefined);
    assert.equal(isInBar(store.choice(), 'story-director/chronicle'), false);
});

// ---- the bar -----------------------------------------------------------------------------------------------------------------

const ITEMS = [
    { id: 'story-block/home', label: 'Home', icon: 'fa-house' },
    { id: 'story-block/inventory', label: 'Inventory', icon: 'fa-bag-shopping' },
    { id: 'story-director/quests', label: 'Quests', icon: 'fa-scroll' },
    { id: 'story-director/world', label: 'World', icon: 'fa-globe' },
    { id: 'story-director/map', label: 'Map', icon: 'fa-map' },
    { id: 'story-director/chronicle', label: 'Chronicle', icon: 'fa-book', moreOnly: true },
    { id: 'story-director/director', label: 'Director', icon: 'fa-film', moreOnly: true },
];

function bar({ items = ITEMS, row = false, current = null } = {}) {
    const doc = installDom();
    const root = host(doc);
    const chosen = [];
    const handle = createScreenBar(doc, root, { label: 'Screens', onSelect: id => chosen.push(id) });
    handle.update({ items, current, row });
    return { doc, root, handle, chosen,
        slots: () => [...root.querySelectorAll('.ss-screenbar-item')].filter(node => !node.classList.contains('ss-screenbar-more')),
        more: () => root.querySelector('.ss-screenbar-more'), tiles: () => root.querySelectorAll('.ss-screenbar-tile'), sheet: () => root.querySelector('.ss-screenbar-sheet') };
}

test('the wide row: the screens in the bar, then More while something is under it; More opens the sheet with the rest', () => {
    const { slots, more, tiles, sheet, handle, chosen } = bar({ row: true });
    assert.deepEqual(ids(slots()), ITEMS.slice(0, 5).map(item => item.id), 'the five in the bar');
    assert.equal(more().hidden, false, 'More is drawn on a wide screen too');
    assert.equal(handle.openMore(), true);
    assert.equal(sheet().hidden, false);
    assert.deepEqual(ids(tiles()), ['story-director/chronicle', 'story-director/director']);
    tiles()[1].click();
    assert.deepEqual(chosen, ['story-director/director']);
    assert.equal(sheet().hidden, true);
});

test('the wide row with nothing under More has no More (as before); a screen under More that is current shows in More\'s slot', () => {
    const none = bar({ row: true, items: ITEMS.map(({ moreOnly, ...item }) => item) });
    assert.equal(none.more().hidden, true);
    assert.equal(none.handle.openMore(), false);
    assert.equal(none.slots().length, ITEMS.length);
    const held = bar({ row: true, current: 'story-director/director' });
    assert.equal(held.more().getAttribute('aria-current'), 'page');
    assert.equal(held.more().querySelector('.ss-screenbar-label').textContent, 'Director');
});

test('a phone: the first four in the bar, then More; what is under More, and the bar\'s overflow, are in the sheet in the reader\'s order', () => {
    const { slots, more, tiles } = bar();
    assert.deepEqual(ids(slots()), ITEMS.slice(0, 4).map(item => item.id));
    assert.equal(more().hidden, false);
    assert.deepEqual(ids(tiles()), ['story-director/map', 'story-director/chronicle', 'story-director/director']);
    assert.deepEqual(splitItems(ITEMS).pinned.length, 4);
});

test('a screen under More does not take a slot, wherever it sits in the reader\'s order', () => {
    const items = [ITEMS[0], ITEMS[5], ...ITEMS.slice(1, 5), ITEMS[6]];
    const phone = bar({ items });
    assert.deepEqual(ids(phone.slots()), ['story-block/home', 'story-block/inventory', 'story-director/quests', 'story-director/world']);
    const wide = bar({ items, row: true });
    assert.deepEqual(ids(wide.slots()), ['story-block/home', 'story-block/inventory', 'story-director/quests', 'story-director/world', 'story-director/map']);
});

test('an alert pins only among the screens in the bar; one under More keeps its own place in the list', () => {
    const items = [...ITEMS.slice(0, 5), { ...ITEMS[5], alert: true }];
    assert.equal(pinAlerts(items), items, 'an alerting screen under More is not pinned');
    const inBar = ITEMS.map(item => ({ ...item, moreOnly: false }));
    inBar[4] = { ...inBar[4], alert: true };
    const pinned = pinAlerts(inBar, 4);
    assert.deepEqual(pinned.map(item => item.id).slice(0, 4), ['story-block/home', 'story-block/inventory', 'story-director/quests', 'story-director/map'], 'the alert takes the last slot');
    const mixed = [ITEMS[0], ITEMS[5], ITEMS[1], ITEMS[2], { ...ITEMS[3], alert: true }, ITEMS[4]];
    const out = pinAlerts(mixed, 4);
    assert.equal(out[1].id, 'story-director/chronicle', 'the screen under More stays where it was');
    assert.deepEqual(splitItems(out, 4).pinned.map(item => item.id), ['story-block/home', 'story-block/inventory', 'story-director/quests', 'story-director/world']);
});

// ---- the game view and the Story panel's strip ---------------------------------------------------------------------------------

function gameView({ inBar, wide = true }) {
    const doc = setupDom();
    doc.defaultView = { matchMedia: () => ({ matches: !wide, addEventListener() {}, removeEventListener() {} }) };
    const screens = createScreens({ reader: () => ({}), saveReader: () => {} });
    const make = (id, title) => ({ id, title, icon: 'fa-star', mounts: ['screen'], template: `<p>${title}</p>` });
    screens.addModule('story-block', [make('story-block/home', 'Home'), make('story-block/inventory', 'Inventory'), make('story-block/scene', 'Scene')]);
    screens.addModule('story-director', [make('story-director/quests', 'Quests'), make('story-director/world', 'World'), make('story-director/map', 'Map'),
        make('story-director/chronicle', 'Chronicle'), make('story-director/director', 'Director')]);
    const mount = createScreenMount({ screens: { ...screens, list: m => screens.list(m) }, render: fakeRenderer(), head: () => stateWith(1), query: () => null, api: {},
        ...(inBar ? { inBar } : {}), document: doc, container: () => doc.body });
    mount.open('story-block/home');
    const nav = () => doc.querySelector('.ss-gameview');
    return { doc, mount, slots: () => ids([...nav().querySelectorAll('.ss-screenbar-item[data-id]')]), tiles: () => ids([...nav().querySelectorAll('.ss-screenbar-tile[data-id]')]), more: () => nav().querySelector('.ss-screenbar-more') };
}

test('the game view on a wide screen: the screens in the bar in a row, then More with the others', () => {
    const view = gameView({ inBar: id => isInBar({}, id) });
    assert.deepEqual(view.slots(), ['story-block/home', 'story-block/inventory', 'story-director/quests', 'story-director/world', 'story-director/map']);
    assert.equal(view.more().hidden, false);
    assert.equal(view.mount.openMore(), true);
    assert.deepEqual(view.tiles().sort(), ['story-block/scene', 'story-director/chronicle', 'story-director/director'].sort());
    view.mount.close();
});

test('the reader\'s place for a screen moves it: Chronicle into the bar, Map under More', () => {
    const choice = setNavInBar(setNavInBar(null, 'story-director/chronicle', true), 'story-director/map', false);
    const view = gameView({ inBar: id => isInBar(choice, id) });
    assert.deepEqual(view.slots(), ['story-block/home', 'story-block/inventory', 'story-director/quests', 'story-director/world', 'story-director/chronicle']);
    view.mount.openMore();
    assert.ok(view.tiles().includes('story-director/map'));
    view.mount.close();
});

test('with no `inBar` (a host that does not choose) every screen is in the bar, as before', () => {
    const view = gameView({ inBar: null });
    assert.equal(view.slots().length, 8);
    assert.equal(view.more().hidden, true);
    view.mount.close();
});

test('the Story panel\'s strip follows the same places (a slot only for the screens in the bar)', () => {
    const doc = installFakeDom();
    const root = doc.createElement('div');
    doc.body.appendChild(root);
    const make = (id, title) => ({ id, title, icon: 'fa-star', moduleId: 'story-block', render(el) { el.textContent = title; } });
    const tabs = [make('inventory', 'Inventory'), make('quests', 'Quests'), make('chronicle', 'Chronicle'), make('director', 'Director')];
    const key = tab => `${tab.moduleId}/${tab.id}`;
    // the default places: Inventory is in the bar, the others (here under Story Block's own ids) are under More
    createTabHost(root, { registry: { tabs: () => tabs }, view: () => ({}), api: null, doc, inBar: tab => isInBar({}, key(tab)) });
    const slotIds = () => root.querySelectorAll('.story-suite-tab').filter(node => !node.classList.contains('ss-screenbar-more') && !node.classList.contains('ss-screenbar-tile')).map(node => node.getAttribute('data-tab-id'));
    assert.deepEqual(slotIds(), ['inventory']);
    assert.deepEqual(root.querySelectorAll('.ss-screenbar-tile').map(node => node.getAttribute('data-tab-id')), ['quests', 'chronicle', 'director']);
    const chosen = { inBar: ['story-block/director'] };
    const second = doc.createElement('div');
    doc.body.appendChild(second);
    createTabHost(second, { registry: { tabs: () => tabs }, view: () => ({}), api: null, doc, inBar: tab => isInBar(chosen, key(tab)) });
    assert.deepEqual(second.querySelectorAll('.ss-screenbar-item').filter(node => !node.classList.contains('ss-screenbar-more')).map(node => node.getAttribute('data-tab-id')), ['inventory', 'director']);
});
