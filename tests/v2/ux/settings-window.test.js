// The settings window (UI stage, step 3a; src/v2/view/settings/): the frame (header, rail, pages), the sections and
// where today's folds go, keyboard and focus, opening on a fold, search across the sections, and the map of section
// bodies that steps 3b–3g replace one by one. Drawn on the repo's fake DOM through a whole testkit host.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { setupDom } from '../view/mounts/helpers.js';
import { DIAGNOSTICS_FOLD, FEATURES_FOLD, OPEN_CLASS, PACKS_FOLD, SETTINGS_TEXT, TABS_FOLD, VERSIONS_FOLD, featuresFoldOf } from '../../../src/v2/host-ui.js';
import { FORM_TEXT } from '../../../src/v2/view/form/schema.js';
import { SECTION_BODIES, createLegacySettings } from '../../../src/v2/view/settings/bodies.js';
import { filterPane } from '../../../src/v2/view/settings/search.js';
import { SECTION_IDS, SETTINGS_SECTIONS, WINDOW_TEXT, opensByDefault, routeOf } from '../../../src/v2/view/settings/sections.js';
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
    assert.deepEqual(SECTION_IDS, ['features', 'money', 'assist', 'tabs', 'modules', 'diagnostics']);
    assert.deepEqual(SETTINGS_SECTIONS.map(section => section.label), ['Features', 'Money', 'Assist', 'Tabs & Packs', 'Modules', 'Diagnostics']);
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
    assert.equal(opensByDefault(FEATURES_FOLD), true);
    assert.equal(opensByDefault('story-block::group:General'), true);
    assert.equal(opensByDefault('rpg-battle'), false);
});

test('the frame: a dialog with a header (title, search, Close), a rail and one page per section, each labelled by its heading', async () => {
    const { doc, root, win, host } = await open();
    assert.equal(root.id, 'story_suite_v2_overlay');
    assert.ok(root.classList.contains('story-suite-overlay'), 'a Story Suite root, so the tokens reach it');
    assert.ok(doc.body.classList.contains(OPEN_CLASS));
    const frame = root.querySelector('.ss-settings');
    assert.equal(frame.getAttribute('role'), 'dialog');
    assert.equal(frame.getAttribute('aria-modal'), 'true');
    assert.equal(frame.getAttribute('aria-labelledby'), 'story_suite_v2_overlay_title');
    assert.equal(root.querySelector('#story_suite_v2_overlay_title').textContent, WINDOW_TEXT.title);
    const head = root.querySelector('.ss-settings-head');
    assert.deepEqual(head.children.map(node => node.tagName), ['H2', 'DIV', 'BUTTON']);
    assert.equal(head.querySelector('.ss-search').getAttribute('role'), 'search');
    assert.equal(head.querySelector('label').textContent, WINDOW_TEXT.searchLabel);
    assert.equal(head.querySelector('.ss-search-input').placeholder, WINDOW_TEXT.searchPlaceholder);
    const close = root.querySelector('.ss-settings-close');
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
    // The rail: the tabs block, a nav of buttons; only the first page shows.
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
    assert.deepEqual(items().map(node => node.getAttribute('aria-current')), ['page', null, null, null, null, null]);
    assert.deepEqual(items().map(node => node.getAttribute('tabindex')), ['0', '-1', '-1', '-1', '-1', '-1'], 'roving tabindex');
    assert.ok(doc.activeElement === items()[0], 'the window opens with the focus on the rail');
    // Arrow keys move the focus (and the Tab stop), not the choice.
    items()[0].dispatch('keydown', { key: 'ArrowDown' });
    assert.ok(doc.activeElement === items()[1]);
    assert.equal(items()[1].getAttribute('tabindex'), '0');
    assert.equal(items()[0].getAttribute('tabindex'), '-1');
    assert.deepEqual(shownPages(root), ['features']);
    items()[1].dispatch('keydown', { key: 'End' });
    assert.ok(doc.activeElement === items()[5]);
    items()[5].dispatch('keydown', { key: 'ArrowRight' });
    assert.ok(doc.activeElement === items()[0], 'wraps');
    // Choosing: the page, aria-current and the stop follow.
    items()[3].focus();
    items()[3].click();
    assert.deepEqual(shownPages(root), ['tabs']);
    assert.equal(win.section(), 'tabs');
    assert.deepEqual(items().map(node => node.getAttribute('aria-current')), [null, null, null, 'page', null, null]);
    assert.equal(items()[3].getAttribute('tabindex'), '0');
    assert.equal(win.select('nonsense'), 'features', 'an unknown section is the first');
    host.close();
});

test('each section holds the folds it should: Features, Tabs & Packs, Modules (with Versions), Diagnostics; Money and Assist are Story Block\'s own', async () => {
    const { root, host } = await open();
    assert.deepEqual(foldsOf(root, 'features'), [FEATURES_FOLD]);
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
    // A fold that is the whole page, or a group of Story Block's own, starts open; the rest as the reader left them.
    assert.equal(foldAt(root, FEATURES_FOLD).open, true);
    assert.equal(foldAt(root, 'story-block::group:General').open, true);
    assert.equal(foldAt(root, 'rpg-battle').open, false);
    assert.equal(foldAt(root, DIAGNOSTICS_FOLD).open, false);
    // Every settings row is on exactly one page.
    const rows = root.querySelectorAll('.story-suite-row[data-field]');
    assert.ok(rows.length > 10);
    assert.equal(page(root, 'money').querySelectorAll('.story-suite-row').length > 3, true);
    host.close();
});

test('the Features line in a module\'s fold goes to the Features page, even from another one', async () => {
    const { root, win, host, doc } = await open();
    win.select('modules');
    assert.deepEqual(shownPages(root), ['modules']);
    const link = foldAt(root, 'story-block').querySelector('.story-suite-feature-link');
    link.click();
    assert.deepEqual(shownPages(root), ['features']);
    assert.equal(foldAt(root, featuresFoldOf('story-block')).open, true);
    assert.ok(doc.activeElement === foldAt(root, featuresFoldOf('story-block')).querySelector('summary'));
    host.close();
});

test('a switch redraws every page and keeps the reader where they are', async () => {
    const { root, win, host } = await open();
    win.select('features');
    const input = () => root.querySelectorAll('.story-suite-feature').find(row => row.dataset.feature === 'loot.weight').querySelector('input');
    input().checked = true;
    input().dispatch('change');
    assert.equal(host.sdk.feature('loot.weight'), true);
    assert.equal(input().checked, true, 'drawn again from the store');
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
        const node = foldAt(root, wanted);
        assert.ok(node, `${fold} is drawn`);
        assert.equal(win.section(), section, fold);
        assert.deepEqual(shownPages(root), [section], fold);
        assert.equal(node.open, true, `${fold} is open`);
        assert.ok(doc.activeElement === node.querySelector('summary'), `${fold} has the focus`);
        if (fold === 'story-block/events') assert.equal(foldAt(root, DIAGNOSTICS_FOLD).open, true, 'Diagnostics opens for it');
        if (fold.includes('::group:')) assert.equal(foldAt(root, fold.split('::')[0])?.open ?? true, true, 'its module\'s fold opens too');
        win.close();
        host.close();
    }
    // A fold that is not there: the first page, the focus on the rail.
    const { root, win, host, doc } = await open({ window: { fold: 'nowhere' } });
    assert.equal(win.section(), 'features');
    assert.ok(doc.activeElement === railItems(root)[0]);
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
    assert.equal(root.querySelectorAll('.story-suite-feature').filter(row => !row.hidden).map(row => row.dataset.feature).join(), 'loot.weight');
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
    railItems(root)[4].click();
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
    assert.equal(railItems(root)[1].querySelector('.ss-tabs-count').textContent, '4', 'its count');
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
