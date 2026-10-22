// The reader's tab order on the page (ui-host.js, host-ui.js): Settings → Story Suite → Tabs lists every
// tab and screen of every installed module once, with Up / Down / Shown and Reset to default; one saved
// list orders both the Story panel's tab strip and the game view's navigation; hidden ones leave both and
// stay in Settings; Home is first and always shown; it works with any subset of modules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeContext } from '../../../testkit/fake-st.js';
import { createRuntime } from '../../../src/v2/runtime.js';
import { mountUi } from '../../../src/v2/ui-host.js';
import { TABS_FOLD } from '../../../src/v2/host-ui.js';
import { setupDom } from '../view/mounts/helpers.js';

const screen = (id, title, mounts = ['tab', 'screen'], extra = {}) => ({ id, title, icon: 'fa-star', mounts, template: `<p>${title}</p>`, ...extra });
// Stand-ins for the three modules, with their real ids (and Dossiers' old `order: 35` from when it was Cast, and
// its own module tab, still under the id `cast`).
const MODULES = Object.freeze({
    'rpg-battle': () => ({
        id: 'rpg-battle', name: 'RPG Battle',
        screens: [screen('rpg-battle/trade', 'Trade'), screen('rpg-battle/fight', 'Fight'), screen('rpg-battle/party', 'Party'), screen('rpg-battle/crafting', 'Crafting')],
    }),
    'story-director': () => ({
        id: 'story-director', name: 'Story Director',
        screens: [screen('story-director/director', 'Director'), screen('story-director/world', 'World'), screen('story-director/map', 'Map'),
            screen('story-director/quests', 'Quests'), screen('story-director/chronicle', 'Chronicle')],
    }),
    'npc-state-delta': () => ({
        id: 'npc-state-delta', name: 'NPC State Delta',
        screens: [screen('npc-state-delta/cast', 'Dossiers', ['screen'], { order: 35 })],
        tabs: [{ id: 'cast', title: 'Dossiers', icon: 'fa-address-book', render: el => { el.textContent = 'dossiers'; } }],
    }),
});
const ALL_MODULES = Object.keys(MODULES);

async function setup(modules = ALL_MODULES, extensionSettings = {}) {
    const doc = setupDom();
    const st = createFakeContext({ extensionSettings });
    let ui = null;
    const runtime = createRuntime({ ctx: st.ctx, onRegister: () => ui?.syncScreens() });
    ui = mountUi({ runtime, ctx: st.ctx, doc });
    runtime.markReady();
    for (const id of modules) await runtime.sdk.registerModule(MODULES[id]());
    ui.syncScreens();
    return { doc, st, ui, runtime };
}

const stripIds = doc => doc.querySelectorAll('.story-suite-tab').map(node => node.textContent);
const navIds = doc => doc.querySelectorAll('.ss-gameview-navitem').map(node => node.getAttribute('data-ss-target'));
const rows = doc => doc.querySelectorAll('.story-suite-taborder-row');
const rowIds = doc => rows(doc).map(node => node.dataset.tabId);
const row = (doc, id) => rows(doc).find(node => node.dataset.tabId === id);
const saved = st => st.ctx.extensionSettings.storySuite?.tabs;

// With Story Director's World installed, Scene is hidden by default (World → Now shows the same): listed in
// Settings → Tabs (DEFAULT_ROWS), not in the strip or the game view (DEFAULT_TABS, DEFAULT_NAV).
const DEFAULT_TABS = ['Party', 'Inventory', 'Quests', 'World', 'Map', 'Fight', 'Crafting', 'Trade', 'Chronicle', 'Director', 'Dossiers'];
const DEFAULT_ROWS = ['story-block/home', 'rpg-battle/party', 'story-block/inventory', 'story-director/quests', 'story-director/world', 'story-director/map',
    'rpg-battle/fight', 'rpg-battle/crafting', 'rpg-battle/trade', 'story-block/scene', 'story-director/chronicle', 'story-director/director', 'npc-state-delta/cast'];
const DEFAULT_NAV = DEFAULT_ROWS.filter(id => id !== 'story-block/scene');

test('the default order: Home, Party, Inventory, Quests, World, Map, Fight, Crafting, Trade, (Scene), Chronicle, Director, Dossiers last', async t => {
    t.mock.method(console, 'warn', () => {});
    const { doc, ui } = await setup();
    ui.openPanel();
    assert.deepEqual(stripIds(doc), DEFAULT_TABS, 'the Story panel (Dossiers is NPC State Delta\'s own tab, id `cast`)');
    ui.mounts.screen.open();
    assert.deepEqual(navIds(doc), DEFAULT_NAV, 'the game view');
    ui.mounts.screen.close();
});

test('Settings → Story Suite → Tabs lists each tab once with where it shows; Home is fixed', async t => {
    t.mock.method(console, 'warn', () => {});
    const { doc, ui } = await setup();
    ui.openSettings({ fold: TABS_FOLD });
    const fold = doc.querySelectorAll('details.story-suite-subfold').find(node => node.dataset.fold === TABS_FOLD);
    assert.ok(fold, 'the Tabs group');
    assert.equal(fold.open, true, 'opened by name');
    assert.equal(fold.closest('details.story-suite-fold').dataset.fold, 'story-suite', 'inside Story Suite\'s own settings');
    assert.deepEqual(rowIds(doc), DEFAULT_ROWS);
    assert.match(row(doc, 'story-block/scene').textContent, /hidden/, 'Scene is listed, hidden by default with World there');
    const home = row(doc, 'story-block/home');
    assert.equal(home.querySelector('.story-suite-taborder-up').disabled, true);
    assert.equal(home.querySelector('.story-suite-taborder-down').disabled, true);
    assert.equal(home.querySelector('input').disabled, true, 'Home cannot be hidden');
    assert.equal(home.querySelector('input').checked, true);
    assert.match(row(doc, 'npc-state-delta/cast').textContent, /Story panel and game view/, 'the Dossiers tab and the Dossiers screen are one row');
    assert.match(row(doc, 'story-block/home').textContent, /game view/);
    const party = row(doc, 'rpg-battle/party');
    assert.equal(party.querySelector('.story-suite-taborder-up').disabled, true, 'the first after Home cannot go up');
    assert.equal(row(doc, 'npc-state-delta/cast').querySelector('.story-suite-taborder-down').disabled, true, 'the last (Dossiers) cannot go down');
    // Real buttons with names, for the keyboard and screen readers.
    const down = party.querySelector('.story-suite-taborder-down');
    assert.equal(down.tagName.toLowerCase(), 'button');
    assert.equal(down.type, 'button');
    assert.equal(down.getAttribute('aria-label'), 'Move Party down');
    assert.equal(doc.querySelector('.story-suite-taborder-reset').disabled, true, 'nothing to reset yet');
});

test('Up / Down: one saved order moves the tab strip and the game view together; the focus stays on the button', async t => {
    t.mock.method(console, 'warn', () => {});
    const { doc, st, ui } = await setup();
    ui.openPanel();
    ui.mounts.screen.open();
    ui.openSettings({ fold: TABS_FOLD });
    row(doc, 'rpg-battle/party').querySelector('.story-suite-taborder-down').click();
    row(doc, 'rpg-battle/party').querySelector('.story-suite-taborder-down').click();
    // The focus followed Party's Down button through both redraws.
    assert.equal(doc.activeElement, row(doc, 'rpg-battle/party').querySelector('.story-suite-taborder-down'));
    row(doc, 'story-director/director').querySelector('.story-suite-taborder-up').click();
    const want = ['Inventory', 'Quests', 'Party', 'World', 'Map', 'Fight', 'Crafting', 'Trade', 'Director', 'Chronicle', 'Dossiers'];
    assert.deepEqual(stripIds(doc), want, 'the strip follows at once');
    assert.deepEqual(navIds(doc), ['story-block/home', 'story-block/inventory', 'story-director/quests', 'rpg-battle/party', 'story-director/world', 'story-director/map',
        'rpg-battle/fight', 'rpg-battle/crafting', 'rpg-battle/trade', 'story-director/director', 'story-director/chronicle', 'npc-state-delta/cast']);
    assert.deepEqual(saved(st).order, rowIds(doc).slice(1), 'stored as an ordered list of ids (Home is not stored)');
    assert.match(doc.querySelector('.story-suite-taborder-status').textContent, /Director moved up/);
    assert.equal(doc.querySelector('.story-suite-taborder-reset').disabled, false);
    // Moving to the top: Up is then disabled, so the focus goes to the same row's Down.
    for (let i = 0; i < 3; i += 1) row(doc, 'rpg-battle/party').querySelector('.story-suite-taborder-up').click();
    assert.equal(rowIds(doc)[1], 'rpg-battle/party');
    assert.equal(doc.activeElement, row(doc, 'rpg-battle/party').querySelector('.story-suite-taborder-down'));
});

test('Shown: a hidden tab leaves the strip and the game view, stays in Settings, still opens by name; shown again', async t => {
    t.mock.method(console, 'warn', () => {});
    const { doc, st, ui } = await setup();
    ui.openPanel();
    ui.mounts.screen.open();
    ui.openSettings({ fold: TABS_FOLD });
    const check = () => row(doc, 'rpg-battle/fight').querySelector('input');
    check().checked = false;
    check().dispatch('change');
    assert.deepEqual(saved(st).hidden, ['rpg-battle/fight']);
    assert.ok(!stripIds(doc).includes('Fight'));
    assert.ok(!navIds(doc).includes('rpg-battle/fight'));
    assert.ok(row(doc, 'rpg-battle/fight').classList.contains('story-suite-taborder-hidden'), 'listed, marked hidden');
    assert.match(row(doc, 'rpg-battle/fight').textContent, /hidden/);
    assert.equal(doc.activeElement, check(), 'the focus stays on the switch');
    // A fight starting opens its screen by name even while it is out of the navigation.
    assert.equal(ui.mounts.screen.open('rpg-battle/fight'), true);
    assert.equal(ui.mounts.screen.current(), 'rpg-battle/fight');
    // Dossiers hidden: both its panel tab (NPC State Delta's own) and its screen go.
    const cast = row(doc, 'npc-state-delta/cast').querySelector('input');
    cast.checked = false;
    cast.dispatch('change');
    assert.ok(!stripIds(doc).includes('Dossiers'));
    assert.ok(!navIds(doc).includes('npc-state-delta/cast'));
    // Shown again.
    check().checked = true;
    check().dispatch('change');
    assert.ok(stripIds(doc).includes('Fight'));
    assert.deepEqual(saved(st).hidden, ['npc-state-delta/cast']);
});

test('Reset to default: the default order, everything shown, nothing stored', async t => {
    t.mock.method(console, 'warn', () => {});
    const { doc, st, ui } = await setup(ALL_MODULES, { storySuite: { tabs: { order: ['story-director/director', 'rpg-battle/trade'], hidden: ['story-block/scene'] } } });
    ui.openPanel();
    assert.deepEqual(stripIds(doc).slice(0, 2), ['Director', 'Trade'], 'a saved order is read at start');
    assert.ok(!stripIds(doc).includes('Scene'));
    ui.openSettings({ fold: TABS_FOLD });
    const reset = doc.querySelector('.story-suite-taborder-reset');
    reset.click();
    assert.equal(saved(st), undefined);
    assert.deepEqual(stripIds(doc), DEFAULT_TABS);
    assert.deepEqual(rowIds(doc), DEFAULT_ROWS);
    assert.equal(doc.querySelector('.story-suite-taborder-reset').disabled, true);
    assert.equal(doc.activeElement, doc.querySelector('.story-suite-taborder-reset'));
});

test('Dossiers is last by default; an order saved when it was Cast, in its old place, keeps that place', async t => {
    t.mock.method(console, 'warn', () => {});
    // The whole default order of the beta, Cast before Scene, as Settings → Tabs saved it after one move.
    const old = ['rpg-battle/party', 'story-block/inventory', 'story-director/quests', 'story-director/world', 'story-director/map',
        'rpg-battle/fight', 'rpg-battle/crafting', 'rpg-battle/trade', 'npc-state-delta/cast', 'story-block/scene', 'story-director/chronicle', 'story-director/director'];
    const { doc, st, ui } = await setup(ALL_MODULES, { storySuite: { tabs: { order: old } } });
    ui.openPanel();
    assert.deepEqual(stripIds(doc), ['Party', 'Inventory', 'Quests', 'World', 'Map', 'Fight', 'Crafting', 'Trade', 'Dossiers', 'Scene', 'Chronicle', 'Director'],
        'the saved place wins, under its new name');
    assert.deepEqual(saved(st).order, old, 'nothing is rewritten');
    ui.destroy();
    // A shorter saved order that does not name it: Dossiers follows in default order, i.e. at the end.
    const short = await setup(ALL_MODULES, { storySuite: { tabs: { order: ['story-director/director', 'rpg-battle/trade'] } } });
    short.ui.openPanel();
    assert.equal(stripIds(short.doc).at(-1), 'Dossiers');
});

test('Scene is hidden by default with Story Director\'s World; shown without it; the reader shows it again; a saved choice wins', async t => {
    t.mock.method(console, 'warn', () => {});
    // With Story Director: listed in Settings, not in the strip or the game view; still opens by name.
    const { doc, st, ui } = await setup();
    ui.openPanel();
    ui.mounts.screen.open();
    assert.ok(!stripIds(doc).includes('Scene'));
    assert.ok(!navIds(doc).includes('story-block/scene'));
    assert.equal(ui.mounts.screen.open('story-block/scene'), true);
    ui.openSettings({ fold: TABS_FOLD });
    const check = () => row(doc, 'story-block/scene').querySelector('input');
    assert.equal(check().checked, false);
    assert.equal(doc.querySelector('.story-suite-taborder-reset').disabled, true, 'that is the default: nothing to reset');
    // Shown again: in both, and kept as the reader's (`shown`).
    check().checked = true;
    check().dispatch('change');
    assert.ok(stripIds(doc).includes('Scene'));
    assert.ok(navIds(doc).includes('story-block/scene'));
    assert.deepEqual(saved(st).shown, ['story-block/scene']);
    // Moving another tab keeps it shown.
    row(doc, 'rpg-battle/party').querySelector('.story-suite-taborder-down').click();
    assert.ok(stripIds(doc).includes('Scene'));
    // Reset to default hides it again.
    doc.querySelector('.story-suite-taborder-reset').click();
    assert.ok(!stripIds(doc).includes('Scene'));
    ui.destroy();
    // Without Story Director: Scene shows as before.
    const alone = await setup(['rpg-battle', 'npc-state-delta']);
    alone.ui.openPanel();
    assert.ok(stripIds(alone.doc).includes('Scene'));
    alone.ui.destroy();
    // A saved order that shows Scene (from before, when it was in view): it stays; a saved hidden still hides it.
    const old = await setup(ALL_MODULES, { storySuite: { tabs: { order: ['story-block/scene', 'rpg-battle/party'], hidden: [] } } });
    old.ui.openPanel();
    assert.equal(stripIds(old.doc)[0], 'Scene');
    old.ui.destroy();
    const hid = await setup(['rpg-battle', 'npc-state-delta'], { storySuite: { tabs: { order: [], hidden: ['story-block/scene'] } } });
    hid.ui.openPanel();
    assert.ok(!stripIds(hid.doc).includes('Scene'), 'hidden by the reader, also without Story Director');
});

test('any subset of modules; ids of modules not installed are ignored and kept; a module installed later goes at the end', async t => {
    t.mock.method(console, 'warn', () => {});
    for (let mask = 0; mask < 8; mask += 1) {
        const installed = ALL_MODULES.filter((_, at) => mask & (1 << at));
        const { doc, ui } = await setup(installed);
        ui.openSettings({ fold: TABS_FOLD });
        const want = DEFAULT_ROWS.filter(id => id.startsWith('story-block/') || installed.some(module => id.startsWith(`${module}/`)));
        assert.deepEqual(rowIds(doc), want, `with ${installed.join(', ') || 'Story Block alone'}`);
        ui.openPanel();
        // Scene is in the strip unless Story Director (its World) is installed.
        const strip = want.slice(1).filter(id => id !== 'story-block/scene' || !installed.includes('story-director'));
        assert.deepEqual(stripIds(doc), strip.map(id => row(doc, id).querySelector('b').textContent), 'the strip agrees');
        // Moving the last one up works whatever is installed.
        const last = want.at(-1);
        row(doc, last).querySelector('.story-suite-taborder-up').click();
        assert.equal(rowIds(doc).at(-2), last);
        ui.destroy();
    }
    // A saved order naming Fight and Party, with RPG Battle not installed: passed over, kept in the file.
    const { doc, st, ui, runtime } = await setup(['story-director'], { storySuite: { tabs: { order: ['rpg-battle/fight', 'story-director/map', 'rpg-battle/party', 'story-block/scene'] } } });
    ui.openSettings({ fold: TABS_FOLD });
    assert.deepEqual(rowIds(doc).slice(0, 3), ['story-block/home', 'story-director/map', 'story-block/scene']);
    row(doc, 'story-block/scene').querySelector('.story-suite-taborder-up').click();
    assert.deepEqual(saved(st).order.slice(0, 4), ['rpg-battle/fight', 'story-block/scene', 'rpg-battle/party', 'story-director/map'], 'kept in their slots, for when it comes back');
    // RPG Battle installed now: Fight and Party take the places the reader gave them before; Trade and
    // Crafting (never placed) go at the end, in default order.
    await runtime.sdk.registerModule(MODULES['rpg-battle']());
    ui.syncScreens();
    ui.openSettings({ fold: TABS_FOLD });
    const now = rowIds(doc);
    assert.deepEqual(now.slice(-2), ['rpg-battle/crafting', 'rpg-battle/trade']);
    assert.deepEqual(now.slice(0, 5), ['story-block/home', 'rpg-battle/fight', 'story-block/scene', 'rpg-battle/party', 'story-director/map']);
});

test('Enter on Up or Down stays with the button (SillyTavern\'s page-wide Enter handler would click it a second time)', async t => {
    t.mock.method(console, 'warn', () => {});
    const { doc, ui } = await setup();
    ui.openSettings({ fold: TABS_FOLD });
    const seen = [];
    // Where SillyTavern listens (keyboard.js: document, bubbling): the overlay's root stands in for it here.
    doc.querySelector('#story_suite_v2_overlay').addEventListener('keydown', event => seen.push(event.key));
    const up = row(doc, 'rpg-battle/fight').querySelector('.story-suite-taborder-up');
    assert.equal(up.dispatch('keydown', { key: 'Enter' }).stopped, true);
    up.dispatch('keydown', { key: 'ArrowDown' });
    row(doc, 'rpg-battle/fight').querySelector('input').dispatch('keydown', { key: 'Enter' });
    assert.deepEqual(seen, ['ArrowDown', 'Enter'], 'only a button\'s Enter is kept back; other keys and other controls pass');
});
