// Which screens sit in the bar and which are under More (view/tab-order.js isInBar / setNavInBar, view/screen-bar.js, mounts/screen.js,
// host-ui.js createTabHost): the screens that say `bar: true` on their own registration (Story Block's Home and Inventory; the fixtures
// below stand for another module's Quests, World and Map), with the RPG's Party and, while a fight is on, Fight;
// every other screen under More, on a wide screen too (the wide row then ends with More). Story Block names no other module's id for it. The reader's choice per screen wins and is
// kept with the order and the hidden ones; those older choices work as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HOME_ID, inDefaultBar, validateScreen } from '../../../src/v2/view/screens.js';
import { homeScreen, inventoryScreen } from '../../../src/v2/screens/index.js';
import { isDefaultChoice, isInBar, moveNav, readTabChoice, setNavHidden, setNavInBar, createTabOrderStore } from '../../../src/v2/view/tab-order.js';
import { createScreenBar, pinAlerts, slotsForWidth, splitItems } from '../../../src/v2/view/screen-bar.js';
import { createScreenMount } from '../../../src/v2/view/mounts/screen.js';
import { createScreens } from '../../../src/v2/view/screens.js';
import { createTabHost } from '../../../src/v2/host-ui.js';
import { fakeRenderer, setupDom, stateWith } from './mounts/helpers.js';
import { installDom, host } from './widgets/fake-dom.js';
import { installFakeDom } from '../../ui-fake-dom.js';

const ids = nodes => nodes.map(node => node.getAttribute('data-id'));

// What the fixtures declare: a module's own screens, three of them with `bar: true`.
const DECLARED = new Set(['example-module/quests', 'example-module/world', 'example-module/map']);
const declared = id => DECLARED.has(id) || id === HOME_ID || id === 'story-block/inventory';
const inBarNow = (choice, id) => isInBar(choice, id, declared(id));

test('by default the bar holds the screens that say `bar: true` and the RPG\'s Party and Fight; every other screen is under More', () => {
    // Story Block's own Home and Inventory carry the flag; Scene and the rest do not.
    assert.equal(homeScreen.bar, true);
    assert.equal(inventoryScreen.bar, true);
    for (const id of [HOME_ID, 'story-block/inventory', 'example-module/quests', 'example-module/world', 'example-module/map', 'story-block/party', 'story-block/fight']) {
        assert.equal(inBarNow({}, id), true, id);
    }
    for (const id of ['example-module/chronicle', 'example-module/director', 'npc-state-delta/cast', 'story-block/scene', 'story-block/block/ledger', 'ersveil-fame', 'rpg-battle/crafting', 'rpg-battle/trade']) {
        assert.equal(inBarNow({}, id), false, `${id} is under More`);
    }
    assert.equal(inDefaultBar('rpg-battle/party'), true, 'a Party or a Fight from another module is one by the last part of its id, as DEFAULT_ORDER places them');
    assert.equal(inDefaultBar('rpg-battle/fight'), true);
    // With no flag a screen of any module is under More, whatever its id; the flag is what puts it in the bar.
    assert.equal(inDefaultBar('some-module/quests'), false);
    assert.equal(inDefaultBar('some-module/quests', true), true);
    assert.equal(isInBar({}, 'some-module/quests'), false);
    assert.equal(isInBar({}, 'some-module/quests', true), true);
});

test('`bar` is checked like the other screen keys: true or false; a screen that says anything else is skipped; a host that does not know the key ignores it', () => {
    const base = { id: 'example-module/quests', title: 'Quests', mounts: ['screen'], template: '<p>x</p>' };
    assert.deepEqual(validateScreen({ ...base, bar: true }), []);
    assert.deepEqual(validateScreen({ ...base, bar: false }), []);
    assert.deepEqual(validateScreen(base), [], 'optional');
    assert.match(validateScreen({ ...base, bar: 'yes' }).join(' '), /bar must be true or false/);
    const screens = createScreens({ reader: () => ({}), saveReader: () => {} });
    screens.addModule('example-module', [{ ...base, bar: true }, { ...base, id: 'example-module/map', bar: 'yes' }, { ...base, id: 'example-module/world' }]);
    assert.equal(screens.declaredBar('example-module/quests'), true);
    assert.equal(screens.declaredBar('example-module/world'), false);
    assert.equal(screens.declaredBar('example-module/map'), false, 'a screen with a bad value is skipped, so it declares nothing');
    assert.equal(screens.declaredBar('example-module/gone'), false);
    // The reader's or a pack's restyle of a screen that leaves `bar` out keeps what the module declared.
    screens.setPack('pack.one', [{ id: 'example-module/quests', title: 'Quests', mounts: ['screen'], template: '<p>pack</p>' }]);
    assert.equal(screens.declaredBar('example-module/quests'), true);
    screens.setPack('pack.one', [{ id: 'example-module/quests', title: 'Quests', mounts: ['screen'], template: '<p>pack</p>', bar: false }]);
    assert.equal(screens.declaredBar('example-module/quests'), false, 'a definition that says so itself decides');
});

test('the reader\'s choice wins: a screen put in the bar, one put under More; Home cannot leave the bar', () => {
    let choice = setNavInBar(null, 'example-module/chronicle', true);
    assert.equal(isInBar(choice, 'example-module/chronicle'), true);
    choice = setNavInBar(choice, 'example-module/map', false, true);
    assert.equal(isInBar(choice, 'example-module/map', true), false);
    assert.deepEqual(choice, { order: [], hidden: [], shown: [], inBar: ['example-module/chronicle'], underMore: ['example-module/map'] });
    assert.deepEqual(setNavInBar(choice, HOME_ID, false), choice, 'Home stays in the bar');
    assert.equal(inBarNow(choice, HOME_ID), true);
    // Back to the default place: the choice forgets it (the default can change later), and nothing is left over.
    choice = setNavInBar(setNavInBar(choice, 'example-module/chronicle', false), 'example-module/map', true, true);
    assert.deepEqual(choice, { order: [], hidden: [], shown: [] });
    assert.equal(isDefaultChoice(choice), true);
    assert.equal(isDefaultChoice({ inBar: ['x/y'] }), false, 'a place the reader chose is a change');
});

test('older choices (order, hidden, shown) read the same, keep working, and are kept when a place is chosen; moving and hiding keep the places', () => {
    const old = { order: ['example-module/director', 'story-block/inventory'], hidden: ['story-block/scene'], shown: [] };
    assert.deepEqual(readTabChoice(old), old, 'no new keys appear on a choice that has none');
    assert.equal(isInBar(old, 'example-module/director'), false, 'an order alone does not move a screen into the bar');
    let choice = setNavInBar(old, 'example-module/director', true);
    assert.deepEqual(choice, { ...old, inBar: ['example-module/director'] });
    choice = setNavHidden(choice, 'story-block/inventory', true);
    assert.deepEqual(choice.inBar, ['example-module/director'], 'hiding keeps the places');
    choice = moveNav(choice, ['example-module/director', 'story-block/inventory', 'example-module/quests'], 'example-module/quests', -1);
    assert.deepEqual(choice.inBar, ['example-module/director'], 'moving keeps the places');
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
    store.set(setNavInBar(store.choice(), 'example-module/chronicle', true));
    assert.deepEqual(settings.storySuite.tabs.inBar, ['example-module/chronicle']);
    assert.equal(saves, 1);
    assert.equal(isInBar(store.choice(), 'example-module/chronicle'), true);
    store.reset();
    assert.equal(settings.storySuite.tabs, undefined);
    assert.equal(isInBar(store.choice(), 'example-module/chronicle'), false);
});

// ---- the bar -----------------------------------------------------------------------------------------------------------------

const ITEMS = [
    { id: 'story-block/home', label: 'Home', icon: 'fa-house' },
    { id: 'story-block/inventory', label: 'Inventory', icon: 'fa-bag-shopping' },
    { id: 'example-module/quests', label: 'Quests', icon: 'fa-scroll' },
    { id: 'example-module/world', label: 'World', icon: 'fa-globe' },
    { id: 'example-module/map', label: 'Map', icon: 'fa-map' },
    { id: 'example-module/chronicle', label: 'Chronicle', icon: 'fa-book', moreOnly: true },
    { id: 'example-module/director', label: 'Director', icon: 'fa-film', moreOnly: true },
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
    assert.deepEqual(ids(tiles()), ['example-module/chronicle', 'example-module/director']);
    tiles()[1].click();
    assert.deepEqual(chosen, ['example-module/director']);
    assert.equal(sheet().hidden, true);
});

test('the wide row with nothing under More has no More (as before); a screen under More that is current shows in More\'s slot', () => {
    const none = bar({ row: true, items: ITEMS.map(({ moreOnly, ...item }) => item) });
    assert.equal(none.more().hidden, true);
    assert.equal(none.handle.openMore(), false);
    assert.equal(none.slots().length, ITEMS.length);
    const held = bar({ row: true, current: 'example-module/director' });
    assert.equal(held.more().getAttribute('aria-current'), 'page');
    assert.equal(held.more().querySelector('.ss-screenbar-label').textContent, 'Director');
});

test('a phone: the first four in the bar, then More; what is under More, and the bar\'s overflow, are in the sheet in the reader\'s order', () => {
    const { slots, more, tiles } = bar();
    assert.deepEqual(ids(slots()), ITEMS.slice(0, 4).map(item => item.id));
    assert.equal(more().hidden, false);
    assert.deepEqual(ids(tiles()), ['example-module/map', 'example-module/chronicle', 'example-module/director']);
    assert.deepEqual(splitItems(ITEMS).pinned.length, 4);
});

test('a screen under More does not take a slot, wherever it sits in the reader\'s order', () => {
    const items = [ITEMS[0], ITEMS[5], ...ITEMS.slice(1, 5), ITEMS[6]];
    const phone = bar({ items });
    assert.deepEqual(ids(phone.slots()), ['story-block/home', 'story-block/inventory', 'example-module/quests', 'example-module/world']);
    const wide = bar({ items, row: true });
    assert.deepEqual(ids(wide.slots()), ['story-block/home', 'story-block/inventory', 'example-module/quests', 'example-module/world', 'example-module/map']);
});

test('an alert pins only among the screens in the bar; one under More keeps its own place in the list', () => {
    const items = [...ITEMS.slice(0, 5), { ...ITEMS[5], alert: true }];
    assert.equal(pinAlerts(items), items, 'an alerting screen under More is not pinned');
    const inBar = ITEMS.map(item => ({ ...item, moreOnly: false }));
    inBar[4] = { ...inBar[4], alert: true };
    const pinned = pinAlerts(inBar, 4);
    assert.deepEqual(pinned.map(item => item.id).slice(0, 4), ['story-block/home', 'story-block/inventory', 'example-module/quests', 'example-module/map'], 'the alert takes the last slot');
    const mixed = [ITEMS[0], ITEMS[5], ITEMS[1], ITEMS[2], { ...ITEMS[3], alert: true }, ITEMS[4]];
    const out = pinAlerts(mixed, 4);
    assert.equal(out[1].id, 'example-module/chronicle', 'the screen under More stays where it was');
    assert.deepEqual(splitItems(out, 4).pinned.map(item => item.id), ['story-block/home', 'story-block/inventory', 'example-module/quests', 'example-module/world']);
});

// ---- the game view and the Story panel's strip ---------------------------------------------------------------------------------

function gameView({ inBar, wide = true }) {
    const doc = setupDom();
    doc.defaultView = { matchMedia: () => ({ matches: !wide, addEventListener() {}, removeEventListener() {} }) };
    const screens = createScreens({ reader: () => ({}), saveReader: () => {} });
    const make = (id, title) => ({ id, title, icon: 'fa-star', mounts: ['screen'], template: `<p>${title}</p>`, ...(declared(id) ? { bar: true } : {}) });
    screens.addModule('story-block', [make('story-block/home', 'Home'), make('story-block/inventory', 'Inventory'), make('story-block/scene', 'Scene')]);
    screens.addModule('example-module', [make('example-module/quests', 'Quests'), make('example-module/world', 'World'), make('example-module/map', 'Map'),
        make('example-module/chronicle', 'Chronicle'), make('example-module/director', 'Director')]);
    const mount = createScreenMount({ screens: { ...screens, list: m => screens.list(m) }, render: fakeRenderer(), head: () => stateWith(1), query: () => null, api: {},
        ...(inBar ? { inBar } : {}), document: doc, container: () => doc.body });
    mount.open('story-block/home');
    const nav = () => doc.querySelector('.ss-gameview');
    return { doc, mount, slots: () => ids([...nav().querySelectorAll('.ss-screenbar-item[data-id]')]), tiles: () => ids([...nav().querySelectorAll('.ss-screenbar-tile[data-id]')]), more: () => nav().querySelector('.ss-screenbar-more') };
}

test('the game view on a wide screen: the screens in the bar in a row, then More with the others', () => {
    const view = gameView({ inBar: id => inBarNow({}, id) });
    assert.deepEqual(view.slots(), ['story-block/home', 'story-block/inventory', 'example-module/quests', 'example-module/world', 'example-module/map']);
    assert.equal(view.more().hidden, false);
    assert.equal(view.mount.openMore(), true);
    assert.deepEqual(view.tiles().sort(), ['story-block/scene', 'example-module/chronicle', 'example-module/director'].sort());
    view.mount.close();
});

test('the reader\'s place for a screen moves it: Chronicle into the bar, Map under More', () => {
    const choice = setNavInBar(setNavInBar(null, 'example-module/chronicle', true), 'example-module/map', false, true);
    const view = gameView({ inBar: id => inBarNow(choice, id) });
    assert.deepEqual(view.slots(), ['story-block/home', 'story-block/inventory', 'example-module/quests', 'example-module/world', 'example-module/chronicle']);
    view.mount.openMore();
    assert.ok(view.tiles().includes('example-module/map'));
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
    // the default places: Inventory says `bar: true`, the others (here under Story Block's own ids) are under More
    createTabHost(root, { registry: { tabs: () => tabs }, view: () => ({}), api: null, doc, inBar: tab => isInBar({}, key(tab), tab.id === 'inventory') });
    const slotIds = () => root.querySelectorAll('.story-suite-tab').filter(node => !node.classList.contains('ss-screenbar-more') && !node.classList.contains('ss-screenbar-tile')).map(node => node.getAttribute('data-tab-id'));
    assert.deepEqual(slotIds(), ['inventory']);
    assert.deepEqual(root.querySelectorAll('.ss-screenbar-tile').map(node => node.getAttribute('data-tab-id')), ['quests', 'chronicle', 'director']);
    const chosen = { inBar: ['story-block/director'] };
    const second = doc.createElement('div');
    doc.body.appendChild(second);
    createTabHost(second, { registry: { tabs: () => tabs }, view: () => ({}), api: null, doc, inBar: tab => isInBar(chosen, key(tab), tab.id === 'inventory') });
    assert.deepEqual(second.querySelectorAll('.ss-screenbar-item').filter(node => !node.classList.contains('ss-screenbar-more')).map(node => node.getAttribute('data-tab-id')), ['inventory', 'director']);
});

// ---- the Story panel's strip: the same places, within its slots ----------------------------------------------------------------

const PANEL_TABS = ['home', 'inventory', 'quests', 'world', 'map', 'chronicle', 'director'].map(id => ({ id, title: id[0].toUpperCase() + id.slice(1), icon: 'fa-star', moduleId: 'example-module', render(el) { el.textContent = id; } }));
function strip({ chosen = {}, room, tabs = PANEL_TABS, inBar = tab => isInBar(chosen, `example-module/${tab.id}`, ['home', 'inventory', 'quests', 'world', 'map'].includes(tab.id)) } = {}) {
    const doc = installFakeDom();
    const root = doc.createElement('div');
    doc.body.appendChild(root);
    const host = createTabHost(root, { registry: { tabs: () => tabs }, view: () => ({}), api: null, doc, inBar, ...(room ? { slots: room } : {}) });
    const slots = () => root.querySelectorAll('.story-suite-tab').filter(node => !node.classList.contains('ss-screenbar-more') && !node.classList.contains('ss-screenbar-tile')).map(node => node.getAttribute('data-tab-id'));
    const tiles = () => root.querySelectorAll('.ss-screenbar-tile').map(node => node.getAttribute('data-tab-id'));
    return { doc, root, host, slots, tiles, nav: () => root.querySelector('.ss-screenbar') };
}

test('the Story panel\'s strip: the screens in the bar take the slots in the reader\'s order; more in the bar than there are slots, the rest go under More', () => {
    // four slots (a phone, or a narrow panel): the first four in the bar; the fifth in the bar is under More with the others
    const narrow = strip();
    assert.deepEqual(narrow.slots(), ['home', 'inventory', 'quests', 'world']);
    assert.deepEqual(narrow.tiles(), ['map', 'chronicle', 'director']);
    assert.equal(narrow.nav().style.getPropertyValue('grid-template-columns'), '', 'the five columns stay');
    // a screen the reader put in the bar comes after the others in their order: it takes a slot only when there is one
    const chosen = { inBar: ['example-module/chronicle'] };
    assert.deepEqual(strip({ chosen }).slots(), ['home', 'inventory', 'quests', 'world']);
    assert.deepEqual(strip({ chosen }).tiles(), ['map', 'chronicle', 'director']);
    // five slots (the side sheet, wide enough): all five defaults, and the reader's one under More until its order puts it in the five
    const wide = strip({ chosen, room: () => 5 });
    assert.deepEqual(wide.slots(), ['home', 'inventory', 'quests', 'world', 'map']);
    assert.deepEqual(wide.tiles(), ['chronicle', 'director']);
    assert.equal(wide.nav().style.getPropertyValue('grid-template-columns'), 'repeat(6, minmax(0, 1fr))', 'a column for each slot and More');
    assert.equal(wide.nav().querySelector('.ss-screenbar-more').style.getPropertyValue('grid-column'), '6', 'More in the last of them (the stylesheet puts it in the fifth)');
    // the reader's order decides who gets the slots: Chronicle moved up takes one, the last in the bar goes under More
    const moved = [PANEL_TABS[0], PANEL_TABS[5], ...PANEL_TABS.filter(tab => !['home', 'chronicle'].includes(tab.id))];
    const ordered = strip({ chosen, room: () => 5, tabs: moved });
    assert.deepEqual(ordered.slots(), ['home', 'chronicle', 'inventory', 'quests', 'world']);
    assert.deepEqual(ordered.tiles(), ['map', 'director']);
    // a screen put under More takes no slot, wherever it sits
    const under = strip({ chosen: { underMore: ['example-module/inventory'] }, room: () => 5 });
    assert.deepEqual(under.slots(), ['home', 'quests', 'world', 'map']);
    assert.ok(under.tiles().includes('inventory'));
    assert.equal(under.nav().style.getPropertyValue('grid-template-columns'), '', 'four slots and More: the pill\'s five columns, no empty column');
    assert.equal(under.nav().querySelector('.ss-screenbar-more').style.getPropertyValue('grid-column'), '');
});

test('the Story panel\'s strip is laid out again when the window changes size (the open tab is not redrawn)', () => {
    let room = 4;
    const doc = installFakeDom();
    const listeners = new Map();
    doc.defaultView = { addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) };
    const root = doc.createElement('div');
    doc.body.appendChild(root);
    let draws = 0;
    const tabs = PANEL_TABS.map(tab => ({ ...tab, render(el) { draws += 1; el.textContent = tab.id; } }));
    const inBar = tab => ['home', 'inventory', 'quests', 'world', 'map'].includes(tab.id);
    const host = createTabHost(root, { registry: { tabs: () => tabs }, view: () => ({}), api: null, doc, inBar, slots: () => room });
    const slots = () => root.querySelectorAll('.story-suite-tab').filter(node => !node.classList.contains('ss-screenbar-more') && !node.classList.contains('ss-screenbar-tile')).map(node => node.getAttribute('data-tab-id'));
    assert.equal(slots().length, 4);
    room = 5;
    listeners.get('resize')();
    assert.equal(slots().length, 5);
    assert.equal(draws, 1, 'the pane was drawn once');
    host.destroy();
    assert.equal(listeners.has('resize'), false, 'the listener goes with the host');
});

test('the slots the Story panel has: four on a phone or a narrow panel, five on a side sheet with room (about 60px a slot), never more than six', () => {
    assert.equal(slotsForWidth(420, { wide: true }), 5);
    assert.equal(slotsForWidth(398, { wide: true }), 5);
    assert.equal(slotsForWidth(397, { wide: true }), 4);
    assert.equal(slotsForWidth(300, { wide: true }), 4);
    assert.equal(slotsForWidth(420, { wide: false }), 4, 'a bottom sheet keeps the pill\'s four');
    assert.equal(slotsForWidth(900, { wide: true }), 6);
    assert.equal(slotsForWidth(0, { wide: true }), 4);
    assert.equal(slotsForWidth(undefined, { wide: true }), 4);
    assert.equal(slotsForWidth(NaN, { wide: true }), 4);
});
