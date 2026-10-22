// The settings window (UI stage, steps 3a and 3b; src/v2/view/settings/): the frame (title, search and rail in the side,
// Close, pages), the sections and where today's folds go, keyboard and focus, opening on a fold, search across the
// sections, and the map of section bodies that steps 3c–3g replace one by one (Look and Features already are the form engine's). Drawn on the repo's fake DOM through a whole testkit host.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { setupDom } from '../view/mounts/helpers.js';
import { DIAGNOSTICS_FOLD, FEATURES_FOLD, OPEN_CLASS, PACKS_FOLD, SETTINGS_TEXT, TABS_FOLD, VERSIONS_FOLD, featuresFoldOf } from '../../../src/v2/host-ui.js';
import { FORM_TEXT } from '../../../src/v2/view/form/schema.js';
import { SECTION_BODIES, createLegacySettings } from '../../../src/v2/view/settings/bodies.js';
import { filterPane } from '../../../src/v2/view/settings/search.js';
import { DEFAULT_SECTION, LOOK_KEYS, SECTION_IDS, SETTINGS_SECTIONS, WINDOW_TEXT, opensByDefault, routeOf } from '../../../src/v2/view/settings/sections.js';
import { openSettingsWindow } from '../../../src/v2/view/settings/window.js';

const texts = (root, selector) => root.querySelectorAll(selector).map(node => node.textContent);

const loot = () => ({
    id: 'loot',
    name: 'Loot',
    features: [
        { id: 'loot.picker', label: 'Loot picker', describe: 'Pick what to keep after a fight.' },
        { id: 'loot.weight', label: 'Weight', describe: 'Items weigh something.', default: false },
    ],
});
// A module with settings in two groups, a field that says how many silver a penny is worth, and a list.
const rpg = () => ({
    id: 'rpg-battle',
    name: 'RPG Battle',
    settings: {
        defaults: { hardMode: false, level: 5, title: 'Hero' },
        schema: {
            hardMode: { type: 'bool', label: 'Hard mode', help: 'Foes hit harder.' },
            level: { type: 'int', min: 1, max: 30, label: 'Starting level' },
            title: { type: 'text', label: 'Trade: Shop title' },
        },
    },
});

// The reader's tab order (ui-host.js tabsControl) as the Tabs fold reads it.
const tabsControl = () => ({
    rows: () => [{ id: 'story-block/home', title: 'Home', icon: 'fa-house', where: ['screen'], fixed: true, hidden: false }, { id: 'story-block/scene', title: 'Scene', icon: 'fa-map', where: ['tab'], hidden: false }],
    move() {}, setHidden() {}, reset() {}, isDefault: () => true,
});

async function open(options = {}) {
    const doc = setupDom();
    const host = await createHost({ modules: [loot(), rpg()], ...(options.host ?? {}) });
    const win = openSettingsWindow({ registry: host.registry, settings: host.settings, features: host.features, doc, sdk: host.sdk, tabs: tabsControl(), openState: new Map(), ...(options.window ?? {}) });
    return { doc, host, win, root: win.root };
}
const page = (root, id) => root.querySelectorAll('.ss-settings-page').find(node => node.dataset.ssSection === id);
const foldsOf = (root, id) => page(root, id).querySelectorAll('details.story-suite-fold').map(node => node.dataset.fold);
const foldAt = (root, key) => root.querySelectorAll('details.story-suite-fold, details.story-suite-subfold').find(node => node.dataset.fold === key);
const railItems = root => root.querySelectorAll('.ss-tabs-item');
const shownPages = root => root.querySelectorAll('.ss-settings-page').filter(node => !node.hidden).map(node => node.dataset.ssSection);
const search = (root, text) => {
    const input = root.querySelector('.ss-search-input');
    input.value = text;
    input.dispatch('input');
};
const status = root => root.querySelector('.ss-settings-status');

test('the sections, in the concept\'s order, each with an icon, a title and a line under it', () => {
    assert.deepEqual(SECTION_IDS, ['look', 'features', 'money', 'assist', 'tabs', 'modules', 'diagnostics']);
    assert.deepEqual(SETTINGS_SECTIONS.map(section => section.label), ['Look', 'Features', 'Money', 'Assist', 'Tabs & Packs', 'Modules', 'Diagnostics']);
    assert.equal(DEFAULT_SECTION, 'features', 'opens on Features though Look is first in the rail');
    for (const section of SETTINGS_SECTIONS) {
        assert.match(section.icon, /^fa-[a-z-]+$/);
        assert.ok(section.title && section.sub.length > 10, section.id);
    }
    assert.deepEqual(Object.keys(SECTION_BODIES), SECTION_IDS, 'a body for each section');
});

test('today\'s folds go to the section they belong to', () => {
    assert.equal(routeOf({ type: 'features' }), 'features');
    assert.equal(routeOf({ type: 'host' }), 'tabs');
    assert.equal(routeOf({ type: 'own-fold', moduleId: 'story-block' }), 'tabs', 'Packs');
    assert.equal(routeOf({ type: 'own-fold', moduleId: 'other' }), 'modules');
    assert.equal(routeOf({ type: 'group', moduleId: 'story-block', group: 'General' }), 'money');
    assert.equal(routeOf({ type: 'group', moduleId: 'story-block', group: 'Assist' }), 'assist');
    assert.equal(routeOf({ type: 'group', moduleId: 'story-block', group: 'Inner chatter' }), 'modules');
    assert.equal(routeOf({ type: 'panel', moduleId: 'story-block' }), 'assist');
    assert.equal(routeOf({ type: 'group', moduleId: 'rpg-battle', group: 'General' }), 'modules', 'only Story Block\'s own General group is Money');
    assert.equal(routeOf({ type: 'panel', moduleId: 'rpg-battle' }), 'modules');
    assert.equal(routeOf({ type: 'module', moduleId: 'rpg-battle' }), 'modules');
    assert.equal(routeOf({ type: 'diagnostics' }), 'diagnostics');
    assert.equal(routeOf({ type: 'versions' }), 'modules');
    assert.equal(routeOf(null), 'modules');
    assert.equal(opensByDefault(FEATURES_FOLD), false, 'Features is not a fold any more');
    assert.equal(opensByDefault('story-block::group:General'), true);
    assert.equal(opensByDefault('rpg-battle'), false);
});

test('the frame: a dialog with the title, the search and the rail in its side, Close at its top right and one page per section, each labelled by its heading', async () => {
    const { doc, root, win, host } = await open();
    assert.equal(root.id, 'story_suite_v2_overlay');
    assert.ok(root.classList.contains('story-suite-overlay'), 'a Story Suite root, so the tokens reach it');
    assert.ok(doc.body.classList.contains(OPEN_CLASS));
    const frame = root.querySelector('.ss-settings');
    assert.equal(frame.getAttribute('role'), 'dialog');
    assert.equal(frame.getAttribute('aria-modal'), 'true');
    assert.equal(frame.getAttribute('aria-labelledby'), 'story_suite_v2_overlay_title');
    assert.equal(root.querySelector('#story_suite_v2_overlay_title').textContent, WINDOW_TEXT.title);
    // Close first (it sits at the window's top right on every width), then the side (the title, the search under it, the
    // rail), then the page. The concept's layout: the search is in the rail under the title.
    assert.deepEqual(frame.children.map(node => node.className), ['ss-settings-close story-suite-close', 'ss-settings-side', 'ss-settings-content']);
    const side = root.querySelector('.ss-settings-side');
    assert.deepEqual(side.children.map(node => node.className), ['ss-settings-title', 'ss-search ss-settings-search', 'ss-settings-rail']);
    assert.equal(side.children[1].getAttribute('role'), 'search');
    assert.equal(side.querySelector('label').textContent, WINDOW_TEXT.searchLabel);
    assert.equal(side.querySelector('.ss-search-input').placeholder, WINDOW_TEXT.searchPlaceholder);
    const close = root.querySelector('.ss-settings-close');
    assert.equal(close.tagName, 'BUTTON');
    assert.equal(close.getAttribute('aria-label'), WINDOW_TEXT.close);
    assert.ok(close.classList.contains('story-suite-close'));
    // One page per section, in the rail's order, each a labelled region named by its heading.
    const pages = root.querySelectorAll('.ss-settings-page');
    assert.deepEqual(pages.map(node => node.dataset.ssSection), SECTION_IDS);
    for (const node of pages) {
        assert.equal(node.tagName, 'SECTION');
        const heading = root.querySelectorAll('h3').find(h => h.id === node.getAttribute('aria-labelledby'));
        assert.ok(heading, `${node.dataset.ssSection} has its heading`);
        assert.equal(heading.textContent, SETTINGS_SECTIONS.find(section => section.id === node.dataset.ssSection).title);
    }
    // The rail: the tabs block, a nav of buttons; only the default page (Features, though Look is first) shows.
    const nav = root.querySelector('.ss-settings-rail nav');
    assert.equal(nav.getAttribute('aria-label'), WINDOW_TEXT.railLabel);
    assert.deepEqual(texts(nav, '.ss-tabs-label'), SETTINGS_SECTIONS.map(section => section.label));
    assert.deepEqual(shownPages(root), ['features']);
    assert.equal(win.section(), 'features');
    close.click();
    assert.equal(doc.querySelector('#story_suite_v2_overlay'), null);
    assert.ok(!doc.body.classList.contains(OPEN_CLASS));
    assert.equal(win.isOpen(), false);
    host.close();
});

test('the rail: aria-current on the chosen section, one Tab stop, arrow keys move along it, a click or Enter shows the page', async () => {
    const { root, win, host, doc } = await open();
    const items = () => railItems(root);
    assert.equal(items().length, 7);
    assert.deepEqual(items().map(node => node.getAttribute('aria-current')), [null, 'page', null, null, null, null, null]);
    assert.deepEqual(items().map(node => node.getAttribute('tabindex')), ['-1', '0', '-1', '-1', '-1', '-1', '-1'], 'roving tabindex');
    assert.ok(doc.activeElement === items()[1], 'the window opens with the focus on the rail\'s chosen item');
    // Arrow keys move the focus (and the Tab stop), not the choice.
    items()[1].dispatch('keydown', { key: 'ArrowDown' });
    assert.ok(doc.activeElement === items()[2]);
    assert.equal(items()[2].getAttribute('tabindex'), '0');
    assert.equal(items()[1].getAttribute('tabindex'), '-1');
    assert.deepEqual(shownPages(root), ['features']);
    items()[2].dispatch('keydown', { key: 'End' });
    assert.ok(doc.activeElement === items()[6]);
    items()[6].dispatch('keydown', { key: 'ArrowRight' });
    assert.ok(doc.activeElement === items()[0], 'wraps to Look, the first');
    // Choosing: the page, aria-current and the stop follow.
    items()[4].focus();
    items()[4].click();
    assert.deepEqual(shownPages(root), ['tabs']);
    assert.equal(win.section(), 'tabs');
    assert.deepEqual(items().map(node => node.getAttribute('aria-current')), [null, null, null, null, 'page', null, null]);
    assert.equal(items()[4].getAttribute('tabindex'), '0');
    items()[0].focus();
    items()[0].click();
    assert.deepEqual(shownPages(root), ['look'], 'Look, first in the rail, is a page like the others');
    assert.equal(win.select('nonsense'), 'features', 'an unknown section is the default one');
    host.close();
});

test('each section holds what it should: Look and Features are the form engine\'s; Tabs & Packs, Modules (with Versions) and Diagnostics hold folds; Money and Assist are Story Block\'s own', async () => {
    const { root, host } = await open();
    assert.deepEqual(foldsOf(root, 'look'), [], 'no folds: the form engine');
    assert.deepEqual(foldsOf(root, 'features'), [], 'no folds: the form engine');
    assert.equal(root.querySelector('details[data-fold="story-suite-features"]'), null, 'the old Features fold is gone');
    assert.ok(page(root, 'features').querySelector('.ss-features-group'));
    assert.deepEqual(foldsOf(root, 'tabs'), ['story-suite', PACKS_FOLD]);
    assert.ok(foldAt(root, TABS_FOLD) && page(root, 'tabs').contains(foldAt(root, TABS_FOLD)), 'Tabs under Story Suite\'s fold, on the Tabs & Packs page');
    assert.deepEqual(foldsOf(root, 'modules'), ['rpg-battle', 'story-block', VERSIONS_FOLD]);
    assert.deepEqual(foldsOf(root, 'diagnostics'), [DIAGNOSTICS_FOLD]);
    assert.deepEqual(foldsOf(root, 'money'), [], 'its parts are sub-folds of Story Block\'s, not folds');
    assert.deepEqual(page(root, 'money').querySelectorAll('details').map(node => node.dataset.fold), ['story-block::group:General']);
    assert.deepEqual(page(root, 'assist').querySelectorAll('details').map(node => node.dataset.fold), ['story-block::group:Assist']);
    assert.ok(page(root, 'assist').querySelector('.story-suite-section .ss-assist'), 'the Assist panel');
    // What is left of Story Block's fold stays in Modules, with the line to its features.
    const kept = foldAt(root, 'story-block');
    assert.ok(page(root, 'modules').contains(kept));
    assert.ok(kept.querySelector('.story-suite-feature-link'));
    assert.equal(kept.querySelector('.story-suite-section'), null);
    assert.equal(kept.querySelector('[data-field="currency"]'), null);
    // A group of Story Block's own starts open; the rest as the reader left them.
    assert.equal(foldAt(root, 'story-block::group:General').open, true);
    assert.equal(foldAt(root, 'rpg-battle').open, false);
    assert.equal(foldAt(root, DIAGNOSTICS_FOLD).open, false);
    // Every settings row is on exactly one page.
    const rows = root.querySelectorAll('.story-suite-row[data-field]');
    assert.ok(rows.length > 10);
    assert.equal(page(root, 'money').querySelectorAll('.story-suite-row').length > 3, true);
    host.close();
});

test('the Features line in a module\'s fold goes to that module\'s group on the Features page, even from another one', async () => {
    const { root, win, host, doc } = await open();
    win.select('modules');
    assert.deepEqual(shownPages(root), ['modules']);
    const link = foldAt(root, 'story-block').querySelector('.story-suite-feature-link');
    link.click();
    assert.deepEqual(shownPages(root), ['features']);
    const group = page(root, 'features').querySelectorAll('.ss-features-group').find(node => node.dataset.fold === featuresFoldOf('story-block'));
    assert.ok(group);
    assert.ok(doc.activeElement === group.querySelector('.ss-section-title'), 'the focus on that module\'s heading');
    host.close();
});

test('a switch stores the choice, tells the other pages, and keeps the reader where they are', async () => {
    const { root, win, host } = await open();
    win.select('features');
    const input = () => root.querySelectorAll('.ss-feature').find(row => row.dataset.feature === 'loot.weight').querySelector('.ss-switch');
    assert.equal(input().getAttribute('aria-checked'), 'false');
    input().click();
    assert.equal(host.sdk.feature('loot.weight'), true);
    assert.equal(host.ctx.extensionSettings.storySuite.features['loot.weight'], true, 'the reader\'s store, as before');
    assert.equal(input().getAttribute('aria-checked'), 'true', 'drawn from the store');
    assert.deepEqual(shownPages(root), ['features']);
    assert.equal(win.section(), 'features');
    // Another page: a redraw from outside (a feature switched elsewhere) keeps it.
    win.select('modules');
    win.refresh();
    assert.deepEqual(shownPages(root), ['modules']);
    host.close();
});

test('opened at a fold: that fold\'s page shows, the fold is open and its summary has the focus', async () => {
    const cases = [
        [PACKS_FOLD, 'tabs'],
        [TABS_FOLD, 'tabs'],
        [FEATURES_FOLD, 'features'],
        [featuresFoldOf('loot'), 'features'],
        ['loot::features', 'features'],
        [featuresFoldOf('story-block'), 'features'],
        ['rpg-battle', 'modules'],
        ['rpg-battle::group:Trade', 'modules'],
        ['story-block::group:General', 'money'],
        ['story-block::group:Assist', 'assist'],
        ['story-block/events', 'diagnostics'],
        [VERSIONS_FOLD, 'modules'],
    ];
    for (const [fold, section] of cases) {
        const { root, win, host, doc } = await open({ window: { fold } });
        const wanted = fold.endsWith('::features') ? featuresFoldOf(fold.slice(0, -'::features'.length)) : fold;
        assert.equal(win.section(), section, fold);
        assert.deepEqual(shownPages(root), [section], fold);
        if (section === 'features') {
            // A module's features are a group of tiles, not a fold: its heading has the focus (the whole page: the first group's).
            const group = page(root, 'features').querySelectorAll('.ss-features-group').find(node => node.dataset.fold === (wanted === FEATURES_FOLD ? page(root, 'features').querySelector('.ss-features-group').dataset.fold : wanted));
            assert.ok(group, `${fold} is drawn`);
            assert.ok(doc.activeElement === group.querySelector('.ss-section-title'), `${fold} has the focus`);
            win.close();
            host.close();
            continue;
        }
        const node = foldAt(root, wanted);
        assert.ok(node, `${fold} is drawn`);
        assert.equal(node.open, true, `${fold} is open`);
        assert.ok(doc.activeElement === node.querySelector('summary'), `${fold} has the focus`);
        if (fold === 'story-block/events') assert.equal(foldAt(root, DIAGNOSTICS_FOLD).open, true, 'Diagnostics opens for it');
        if (fold.includes('::group:')) assert.equal(foldAt(root, fold.split('::')[0])?.open ?? true, true, 'its module\'s fold opens too');
        win.close();
        host.close();
    }
    // A fold that is not there: the default page, the focus on the rail.
    const { root, win, host, doc } = await open({ window: { fold: 'nowhere' } });
    assert.equal(win.section(), 'features');
    assert.ok(doc.activeElement === railItems(root)[1]);
    host.close();
});

test('Escape closes the window and the focus goes back; Tab stays inside; the page behind cannot take the focus', async () => {
    const doc = setupDom();
    const opener = doc.createElement('button');
    doc.body.appendChild(opener);
    opener.focus();
    const host = await createHost({ modules: [loot(), rpg()] });
    const closed = [];
    const win = openSettingsWindow({ registry: host.registry, settings: host.settings, features: host.features, doc, sdk: host.sdk, openState: new Map(), onClose: () => closed.push(true) });
    const frame = win.window;
    const reachable = () => {
        const out = [];
        const walk = node => {
            if (node.hidden) return;
            if (['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName) && node.getAttribute('tabindex') !== '-1' && !node.disabled) out.push(node);
            if (node.tagName === 'SUMMARY') out.push(node);
            if (node.tagName === 'DETAILS' && !node.open) { node.children.filter(child => child.tagName === 'SUMMARY').forEach(walk); return; }
            node.children.forEach(walk);
        };
        walk(frame);
        return out;
    };
    const stops = reachable();
    assert.ok(stops.length > 4);
    // Tab on the last stop wraps to the first, Shift+Tab on the first to the last.
    stops.at(-1).focus();
    const forward = frame.dispatch('keydown', { key: 'Tab' });
    assert.equal(forward.defaultPrevented, true);
    assert.ok(win.window.contains(doc.activeElement));
    assert.ok(doc.activeElement === stops[0], 'wrapped to the first');
    stops[0].focus();
    const back = stops[0].dispatch('keydown', { key: 'Tab', shiftKey: true });
    assert.equal(back.defaultPrevented, true);
    assert.ok(doc.activeElement === stops.at(-1), 'wrapped to the last');
    // A Tab in the middle is left to the browser.
    stops[1].focus();
    assert.equal(stops[1].dispatch('keydown', { key: 'Tab' }).defaultPrevented, false);
    // Escape.
    const escape = frame.dispatch('keydown', { key: 'Escape' });
    assert.equal(escape.defaultPrevented, true);
    assert.equal(win.isOpen(), false);
    assert.equal(doc.querySelector('#story_suite_v2_overlay'), null);
    assert.deepEqual(closed, [true]);
    assert.ok(doc.activeElement === opener, 'back where it was');
    host.close();
});

test('a click on the dimmed page beside the window closes it; a drag that starts inside does not', async () => {
    const { root, win, host } = await open();
    root.dispatch('mousedown');
    root.querySelector('.ss-settings-content').dispatch('click');
    assert.equal(win.isOpen(), true, 'a click inside the window');
    root.querySelector('.ss-settings-content').dispatch('mousedown');
    root.dispatch('click');
    assert.equal(win.isOpen(), true, 'pressed inside, released outside: a text selection');
    root.dispatch('mousedown');
    root.dispatch('click');
    assert.equal(win.isOpen(), false);
    host.close();
});

test('opening it again closes the one there; the focus guard goes with each window', async () => {
    const doc = setupDom();
    const host = await createHost({ modules: [loot(), rpg()] });
    const options = { registry: host.registry, settings: host.settings, features: host.features, doc, sdk: host.sdk, openState: new Map() };
    const first = openSettingsWindow(options);
    const second = openSettingsWindow(options);
    assert.equal(first.isOpen(), false);
    assert.equal(doc.querySelectorAll('#story_suite_v2_overlay').length, 1);
    assert.equal(doc.listeners.filter(entry => entry.type === 'focusin').length, 1);
    second.close();
    assert.equal(doc.listeners.filter(entry => entry.type === 'focusin').length, 0);
    host.close();
});

// ---- search

test('search: typing filters every section at once, shows only the pages with matches, counts them for the rail and a live region', async () => {
    const { root, host } = await open();
    const live = status(root);
    assert.equal(live.getAttribute('role'), 'status');
    assert.equal(live.getAttribute('aria-live'), 'polite');
    assert.equal(live.hidden, true);
    search(root, 'coin');
    assert.ok(shownPages(root).includes('money'), 'the Money page');
    assert.ok(shownPages(root).length > 1 || shownPages(root)[0] === 'money');
    assert.equal(live.hidden, false);
    const n = Number(/^(\d+) settings shown$/.exec(live.textContent)?.[1]);
    assert.ok(n > 1, live.textContent);
    // The rail says how many each page has, and a page with none is left out.
    const counts = Object.fromEntries(railItems(root).map(node => [node.getAttribute('data-id'), node.querySelector('.ss-tabs-count')?.textContent ?? '']));
    assert.equal(Object.values(counts).filter(Boolean).map(Number).reduce((a, b) => a + b, 0), n, 'the pages\' counts add up to what is said');
    assert.deepEqual(shownPages(root), Object.keys(counts).filter(id => counts[id]), 'a page with no match is not shown');
    assert.equal(root.querySelector('.ss-form-empty').hidden, true);
    // On the Money page only the matching rows show.
    const rows = page(root, 'money').querySelectorAll('.story-suite-row[data-field]');
    const visible = rows.filter(row => !row.hidden).map(row => row.dataset.field);
    assert.ok(visible.includes('coins') && visible.includes('coinDisplay'));
    assert.ok(!visible.includes('currencyShort'), 'its label has no "coin" in it');
    // Clearing shows the chosen page again.
    root.querySelector('.ss-search-clear').click();
    assert.deepEqual(shownPages(root), ['features']);
    assert.equal(live.hidden, true);
    assert.equal(railItems(root).filter(node => node.querySelector('.ss-tabs-count')).length, 0);
    assert.equal(page(root, 'money').querySelectorAll('.story-suite-row[data-field]').filter(row => row.hidden).length, 0, 'every row shows again');
    host.close();
});

test('search words: one match says "1 setting shown", none says so with the text, and the rows, features and panels are all found', async () => {
    const { root, host } = await open();
    const live = status(root);
    search(root, 'hard mode');
    assert.equal(live.textContent, FORM_TEXT.shownOne);
    assert.deepEqual(shownPages(root), ['modules']);
    assert.equal(foldAt(root, 'rpg-battle').open, true, 'opened for the search');
    assert.equal(foldAt(root, 'story-block').hidden, true, 'a fold with no match is out');
    search(root, 'xyzzy nothing');
    assert.equal(live.textContent, '');
    const empty = root.querySelector('.ss-form-empty');
    assert.equal(empty.hidden, false);
    assert.equal(empty.textContent, 'No settings match "xyzzy nothing".');
    assert.deepEqual(shownPages(root), []);
    // A feature by what it says; a panel by its name; a module's settings by the module's name.
    search(root, 'items weigh');
    assert.deepEqual(shownPages(root), ['features']);
    assert.equal(live.textContent, FORM_TEXT.shownOne);
    assert.equal(root.querySelectorAll('.ss-feature').filter(row => !row.hidden).map(row => row.dataset.feature).join(), 'loot.weight');
    search(root, 'packs');
    assert.ok(shownPages(root).includes('tabs'), 'the Packs fold, found by its name');
    assert.equal(foldAt(root, PACKS_FOLD).hidden, false);
    assert.equal(foldAt(root, 'story-suite').hidden, true);
    search(root, 'rpg battle');
    assert.deepEqual(shownPages(root), ['modules']);
    assert.equal(page(root, 'modules').querySelectorAll('.story-suite-row[data-field]').filter(row => !row.hidden).length, 3, 'its three settings');
    // What it says finds it ("money" → the Money page's "Money one reply may give"), not the section's own name.
    search(root, 'money');
    assert.ok(shownPages(root).includes('money'));
    assert.equal(page(root, 'money').querySelectorAll('.story-suite-row[data-field]').filter(row => !row.hidden).map(row => row.dataset.field).join(), 'storyCoinPerReply,economyScale');
    // Words are all needed, in any order, any case.
    search(root, 'SHOP trade');
    assert.deepEqual(page(root, 'modules').querySelectorAll('.story-suite-row[data-field]').filter(row => !row.hidden).map(row => row.dataset.field), ['title']);
    host.close();
});

test('search: a fold opened for it goes back as the reader left it; the window opened again starts without the search', async () => {
    const { root, win, host } = await open();
    const closedFold = foldAt(root, 'rpg-battle');
    assert.equal(closedFold.open, false);
    search(root, 'hard');
    assert.equal(closedFold.open, true);
    assert.equal(closedFold.dataset.filtered, 'true');
    search(root, '');
    assert.equal(closedFold.open, false, 'closed again');
    assert.equal(closedFold.dataset.filtered, undefined);
    // A fold the reader had open stays open.
    closedFold.open = true;
    search(root, 'hard');
    search(root, '');
    assert.equal(closedFold.open, true);
    // A redraw while searching keeps the search (a feature switched on elsewhere).
    search(root, 'hard');
    win.refresh();
    assert.deepEqual(shownPages(root), ['modules']);
    assert.equal(status(root).textContent, FORM_TEXT.shownOne);
    host.close();
});

test('Escape in the search box empties it first; choosing a section ends the search; Escape then closes the window', async () => {
    const { root, win, host } = await open();
    const input = root.querySelector('.ss-search-input');
    search(root, 'coin');
    input.focus();
    const first = input.dispatch('keydown', { key: 'Escape' });
    assert.equal(first.defaultPrevented, true);
    assert.equal(input.value, '');
    assert.equal(win.isOpen(), true, 'the first Escape only cleared the box');
    assert.deepEqual(shownPages(root), ['features']);
    search(root, 'coin');
    railItems(root)[5].click();
    assert.equal(input.value, '', 'the search ended');
    assert.deepEqual(shownPages(root), ['modules']);
    assert.equal(status(root).hidden, true);
    input.dispatch('keydown', { key: 'Escape' });
    assert.equal(win.isOpen(), false, 'the second one closes it');
    host.close();
});

test('search takes the Features line into account: it opens its page from another one', async () => {
    const { root, win, host } = await open();
    win.select('modules');
    search(root, 'story block');
    const link = root.querySelectorAll('.story-suite-feature-link').find(node => !node.hidden);
    assert.ok(link);
    link.click();
    assert.equal(root.querySelector('.ss-search-input').value, '', 'going to Features ends the search');
    assert.deepEqual(shownPages(root), ['features']);
    host.close();
});

// ---- the bodies

test('a section can take another body: it gets its own pane, the shared host does not draw there, and its filter is used', async () => {
    const calls = [];
    const bodies = {
        ...SECTION_BODIES,
        money: (pane, ctx) => {
            const own = ctx.doc.createElement('p');
            own.className = 'own-money';
            own.textContent = `Money body for ${ctx.label}`;
            pane.appendChild(own);
            return {
                filter: text => { calls.push(['filter', text]); return text.includes('coin') ? 4 : 0; },
                refresh: () => calls.push(['refresh']),
                destroy: () => calls.push(['destroy']),
            };
        },
    };
    const { root, win, host } = await open({ window: { bodies } });
    assert.equal(page(root, 'money').querySelector('.own-money').textContent, 'Money body for Money');
    assert.equal(page(root, 'money').querySelectorAll('details').length, 0, 'the shared host drew nothing there');
    assert.deepEqual(page(root, 'assist').querySelectorAll('details').map(node => node.dataset.fold), ['story-block::group:Assist'], 'the rest are as before');
    assert.equal(root.querySelector('details[data-fold="story-block::group:General"]'), null);
    search(root, 'coin');
    assert.ok(calls.some(call => call[0] === 'filter' && call[1] === 'coin'));
    assert.equal(page(root, 'money').hidden, false);
    assert.equal(railItems(root)[2].querySelector('.ss-tabs-count').textContent, '4', 'its count');
    assert.equal(Number(/\d+/.exec(status(root).textContent)[0]) >= 4, true);
    win.refresh();
    assert.ok(calls.some(call => call[0] === 'refresh'));
    win.close();
    assert.ok(calls.some(call => call[0] === 'destroy'));
    host.close();
});

test('a body that is missing leaves that section\'s page empty, and a body that counts nothing is left out of a search', async () => {
    const bodies = { ...SECTION_BODIES, assist: undefined, diagnostics: () => ({}) };
    const { root, host } = await open({ window: { bodies } });
    assert.equal(page(root, 'assist').querySelectorAll('.ss-settings-pane > *').length, 0);
    search(root, 'report');
    assert.ok(!shownPages(root).includes('diagnostics'));
    host.close();
});

test('filterPane on its own: matches, covered panels and the count', async () => {
    const doc = setupDom();
    const pane = doc.createElement('div');
    const mk = (tag, className) => { const node = doc.createElement(tag); node.className = className; return node; };
    const outer = mk('details', 'story-suite-fold');
    outer.dataset.fold = 'outer';
    const body = mk('div', 'story-suite-fold-body');
    const rowA = mk('div', 'story-suite-row');
    const rowB = mk('div', 'story-suite-row');
    const panelFold = mk('details', 'story-suite-subfold');
    panelFold.dataset.fold = 'panel';
    const inner = mk('div', 'inner');
    panelFold.appendChild(inner);
    body.append(rowA, rowB, panelFold);
    outer.appendChild(body);
    pane.appendChild(outer);
    const entries = [
        { kind: 'row', key: 'alpha', field: { label: 'Alpha', help: 'first' }, group: 'G', node: rowA },
        { kind: 'row', key: 'beta', field: { label: 'Beta', help: 'second' }, group: 'G', node: rowB },
        { kind: 'panel', key: 'panel', field: { label: 'Panel', help: 'things' }, group: 'G', node: panelFold },
        { kind: 'row', key: 'gamma', field: { label: 'Gamma', help: '' }, group: 'G', node: inner },
    ];
    const state = new Map();
    assert.equal(filterPane({ pane, entries, text: '', openState: state }), 4, 'no search: every entry');
    assert.equal(filterPane({ pane, entries, text: 'alpha', openState: state }), 1);
    assert.deepEqual([rowA.hidden, rowB.hidden, panelFold.hidden, outer.hidden, outer.open], [false, true, true, false, true]);
    // A panel that matches shows whole, and counts once, not for what is inside.
    assert.equal(filterPane({ pane, entries, text: 'panel', openState: state }), 1);
    assert.deepEqual([rowA.hidden, panelFold.hidden, inner.hidden], [true, false, false]);
    // A match inside a panel that does not match shows the panel.
    assert.equal(filterPane({ pane, entries, text: 'gamma', openState: state }), 1);
    assert.deepEqual([panelFold.hidden, inner.hidden], [false, false]);
    assert.equal(filterPane({ pane, entries, text: 'zzz', openState: state }), 0);
    assert.equal(outer.hidden, true);
    // An entry no longer in the pane (replaced by a redraw) is ignored.
    assert.equal(filterPane({ pane, entries: [...entries, { kind: 'row', key: 'alpha', field: { label: 'Alpha' }, group: '', node: doc.createElement('div') }], text: 'alpha', openState: state }), 1);
    assert.equal(outer.open, true);
    filterPane({ pane, entries, text: '', openState: state });
    assert.equal(outer.open, false);
    assert.equal(outer.hidden, false);
});

test('createLegacySettings: nothing attached draws nothing; refresh and refreshSize before start do nothing', () => {
    const legacy = createLegacySettings({});
    legacy.start({});
    assert.equal(legacy.refresh(), undefined);
    assert.equal(legacy.refreshSize(), undefined);
    const body = legacy.attach('features', {}, { label: 'Features', openState: new Map() });
    assert.equal(body.filter('x'), 0, 'not started: no matches');
});

test('the old host text is still where it was: the window adds none to SETTINGS_TEXT', () => {
    assert.equal(SETTINGS_TEXT.general, 'General');
    assert.equal(WINDOW_TEXT.title, 'Story Suite');
});

// ---- Look and Features (step 3b)

test('Look: Panel style, Glass strength and Font come from the host schema, are written to the host settings and applied through the theme; the Story Suite fold keeps the rest', async () => {
    const applied = [];
    const { root, host } = await open({ window: { theme: { apply: () => applied.push(host.settings().panelStyle) } } });
    const look = page(root, 'look');
    assert.deepEqual(look.querySelectorAll('.ss-field').map(row => row.dataset.field), LOOK_KEYS);
    assert.deepEqual(texts(look, '.ss-field-label'), ['Panel style', 'Glass strength (%)', 'Font']);
    assert.equal(look.querySelectorAll('details').length, 0, 'no folds');
    // The Story Suite fold under Tabs & Packs has the budgets, not the look.
    const hostFold = foldAt(root, 'story-suite');
    assert.deepEqual(hostFold.querySelectorAll('.story-suite-row[data-field]').map(row => row.dataset.field), ['tailBudget', 'contextShare', 'maxChangeLines', 'callQueue']);
    assert.ok(page(root, 'tabs').contains(hostFold));
    // A choice goes through the settings store (the host's own, `settings.set(null, key, value)`) and the look follows at once.
    const select = look.querySelector('.ss-field[data-field="panelStyle"] select');
    select.value = 'solid';
    select.dispatch('change');
    assert.equal(host.settings().panelStyle, 'solid');
    assert.deepEqual(applied, ['solid']);
    const slider = look.querySelector('.ss-field[data-field="glassStrength"] input');
    slider.value = '70';
    slider.dispatch('change');
    assert.equal(host.settings().glassStrength, 70);
    assert.equal(applied.length, 2);
    const font = look.querySelector('.ss-field[data-field="font"] select');
    font.value = 'theme';
    font.dispatch('change');
    assert.equal(host.settings().font, 'theme');
    host.close();
});

test('Look is searched with the rest: "glass" finds its rows and says how many', async () => {
    const { root, host } = await open();
    search(root, 'glass');
    assert.ok(shownPages(root).includes('look'));
    assert.deepEqual(page(root, 'look').querySelectorAll('.ss-field').filter(row => !row.hidden).map(row => row.dataset.field), ['panelStyle', 'glassStrength']);
    assert.equal(railItems(root)[0].querySelector('.ss-tabs-count').textContent, '2');
    search(root, 'font');
    assert.deepEqual(page(root, 'look').querySelectorAll('.ss-field').filter(row => !row.hidden).map(row => row.dataset.field), ['font']);
    search(root, '');
    assert.equal(page(root, 'look').querySelectorAll('.ss-field').filter(row => row.hidden).length, 0);
    host.close();
});

test('Features: a group of switch tiles per module, "N of M on", the same store as before; a switch redraws the other pages', async () => {
    const { root, host, win } = await open();
    const features = page(root, 'features');
    const groups = features.querySelectorAll('.ss-features-group');
    const names = groups.map(node => node.querySelector('.ss-section-title').textContent);
    assert.deepEqual(names, ['Loot', 'RPG Battle', 'Story Block'].filter(name => names.includes(name)), 'by name');
    assert.ok(names.includes('Loot') && names.includes('Story Block'));
    const loot = groups.find(node => node.dataset.module === 'loot');
    assert.equal(loot.dataset.fold, featuresFoldOf('loot'));
    assert.equal(loot.querySelector('.ss-section-hint').textContent, '1 of 2 on');
    assert.deepEqual(loot.querySelectorAll('.ss-feature').map(node => node.dataset.feature), ['loot.picker', 'loot.weight']);
    const weight = loot.querySelectorAll('.ss-feature')[1];
    assert.equal(weight.querySelector('.ss-feature-name').textContent, 'Weight');
    assert.equal(weight.querySelector('.ss-switch').getAttribute('role'), 'switch');
    // Switching it stores the reader's choice, the count follows, and the line in the module's fold (Modules) says so too.
    const link = () => foldAt(root, 'story-block').querySelector('.story-suite-feature-link').textContent;
    const before = link();
    const sb = host.features.list().filter(feature => feature.moduleId === 'story-block');
    const off = sb.find(feature => feature.on === false && feature.available !== false);
    const tile = features.querySelectorAll('.ss-feature').find(node => node.dataset.feature === off.id);
    tile.querySelector('.ss-switch').click();
    assert.equal(host.sdk.feature(off.id), true);
    assert.equal(host.ctx.extensionSettings.storySuite.features[off.id], true);
    assert.equal(features.querySelectorAll('.ss-features-group').find(node => node.dataset.module === 'story-block').querySelector('.ss-section-hint').textContent, `${sb.filter(feature => feature.on).length + 1} of ${sb.length} on`);
    assert.notEqual(link(), before, 'the other page drew it again');
    assert.equal(win.section(), 'features');
    host.close();
});

test('Features: searched with the rest; a feature found by its description or its module', async () => {
    const { root, host } = await open();
    search(root, 'items weigh');
    assert.deepEqual(shownPages(root), ['features']);
    assert.deepEqual(page(root, 'features').querySelectorAll('.ss-feature').filter(node => !node.hidden).map(node => node.dataset.feature), ['loot.weight']);
    assert.equal(status(root).textContent, FORM_TEXT.shownOne);
    assert.equal(page(root, 'features').querySelectorAll('.ss-features-group').filter(node => !node.hidden).length, 1, 'the groups with no match are left out');
    search(root, 'story block');
    assert.deepEqual(page(root, 'features').querySelectorAll('.ss-feature').filter(node => !node.hidden).map(node => node.dataset.feature), host.features.list().filter(feature => feature.moduleId === 'story-block').map(feature => feature.id), 'by the module\'s name');
    host.close();
});
