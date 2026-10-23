// The Modules section (src/v2/view/settings/modules.js, UI stage step 3f): a card per installed module on the form engine (name,
// version, what it does, the line to its features, its own panels, its settings by group), and a small Versions card at the end.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { setupDom } from '../view/mounts/helpers.js';
import { createRegistry } from '../../../src/v2/registry.js';
import { createSettings } from '../../../src/v2/sdk.js';
import { VERSIONS_FOLD, featuresFoldOf } from '../../../src/v2/host-ui.js';
import { FOLD_ABOVE, KNOWN_DESCRIPTIONS, MODULES_TEXT, moduleSchema } from '../../../src/v2/view/settings/modules.js';
import { openSettingsWindow } from '../../../src/v2/view/settings/window.js';

const field = (type, label, extra = {}) => ({ type, label, ...extra });
// A module with eight settings in three groups (written as "Group: Name" labels), a description and a version.
const big = () => ({
    id: 'big', name: 'Big Module', version: '1.2.0', description: 'Does many things, one group at a time.',
    features: [{ id: 'big.one', label: 'One', default: true }, { id: 'big.two', label: 'Two', default: false }, { id: 'big.three', label: 'Three', default: false }],
    settings: {
        defaults: { a1: true, a2: 3, b1: 'x', b2: 'y', b3: 2, c1: false, c2: 'z', c3: 4 },
        schema: {
            a1: field('bool', 'Alpha: First'), a2: field('int', 'Alpha: Second', { min: 1, max: 9 }),
            b1: field('text', 'Beta: Third'), b2: field('text', 'Beta: Fourth'), b3: field('int', 'Beta: Fifth', { min: 1, max: 9 }),
            c1: field('bool', 'Gamma: Sixth'), c2: field('text', 'Gamma: Seventh'), c3: field('int', 'Gamma: Eighth', { min: 1, max: 9 }),
        },
    },
});
// A module with two settings in two groups.
const small = () => ({
    id: 'small', name: 'Small Module', version: '0.3.0',
    settings: { defaults: { s1: true, s2: 'q' }, schema: { s1: field('bool', 'Look: Shiny'), s2: field('text', 'Sound: Name') } },
});
// A module with a panel of its own (a title and a render function), and one fold of its own.
const panelled = (log = []) => ({
    id: 'panelled', name: 'Panelled', version: '2.0.0',
    features: [{ id: 'panelled.show', label: 'Show the panel', default: true }],
    settings: {
        section: 'Panelled log',
        defaults: { n: 1 },
        schema: { n: field('int', 'Lines', { min: 1, max: 9 }) },
        render: Object.assign((el, api) => { log.push(api.get('n')); el.textContent = `Panel with ${api.get('n')} line(s)`; }, { feature: 'panelled.show' }),
        folds: [{ id: 'tools', title: 'Tools', hint: 'a fold of its own', render(el, api) { el.textContent = `Tools for ${api.get('n')}`; } }],
    },
});
const bare = () => ({ id: 'bare', name: 'Bare' });

async function open(modules = [big(), small(), panelled(), bare()], options = {}) {
    const doc = setupDom();
    const host = await createHost({ modules, ...(options.host ?? {}) });
    const win = openSettingsWindow({ registry: host.registry, settings: host.settings, features: host.features, doc, sdk: host.sdk, openState: new Map(), ...(options.window ?? {}) });
    win.select('modules');
    const page = win.root.querySelectorAll('.ss-settings-page').find(node => node.dataset.ssSection === 'modules');
    return { doc, host, win, root: win.root, page };
}
const cardOf = (page, id) => page.querySelectorAll('.ss-module-card').find(node => node.dataset.module === id);
const rows = card => card.querySelectorAll('.ss-field').map(node => node.dataset.field);
const titles = card => card.querySelectorAll('.ss-section-title').map(node => node.textContent).filter(Boolean);
const search = (root, text) => {
    const input = root.querySelector('.ss-search-input');
    input.value = text;
    input.dispatch('input');
};

test('a card per installed module, by id, with its name, version, what it does and nothing it does not have', async () => {
    const { page, host } = await open();
    assert.deepEqual(page.querySelectorAll('.ss-module-card').map(node => node.dataset.module), ['bare', 'big', 'panelled', 'small', 'story-block']);
    const card = cardOf(page, 'big');
    assert.equal(card.querySelector('.ss-section-title').textContent, 'Big Module');
    assert.equal(card.querySelector('.ss-section-hint').textContent, 'v1.2.0');
    assert.equal(card.querySelector('.ss-module-description').textContent, 'Does many things, one group at a time.');
    // A module with no settings and no features is still a card (its name and nothing else).
    const empty = cardOf(page, 'bare');
    assert.equal(empty.querySelector('.ss-section-title').textContent, 'Bare');
    assert.equal(empty.querySelector('.ss-section-hint'), null, 'no version said');
    assert.equal(empty.querySelector('.ss-module-description'), null);
    assert.equal(empty.querySelectorAll('.ss-field').length, 0);
    assert.equal(empty.querySelector('.ss-module-features').hidden, true, 'no features, no line');
    assert.equal(page.querySelectorAll('details.story-suite-fold').length, 0, 'no old folds');
    // One of Story Suite's own that says nothing gets its line from the host; its own words win when it has them.
    assert.equal(cardOf(page, 'story-block').querySelector('.ss-module-description').textContent, KNOWN_DESCRIPTIONS['story-block']);
    assert.equal(card.querySelector('.ss-module-description').textContent, 'Does many things, one group at a time.');
    host.close();
});

test('the Features line says how many are on and goes to that module\'s group on the Features page', async () => {
    const { page, win, host, doc, root } = await open();
    const link = cardOf(page, 'big').querySelector('.ss-module-features');
    assert.equal(link.hidden, false);
    assert.equal(link.textContent, 'Features: 1 of 3 on — change');
    assert.equal(link.tagName, 'BUTTON');
    link.click();
    assert.equal(win.section(), 'features');
    const group = root.querySelectorAll('.ss-features-group').find(node => node.dataset.fold === featuresFoldOf('big'));
    assert.ok(group && doc.activeElement === group.querySelector('summary'));
    assert.equal(group.open, true, 'the group is opened');
    // A switch there changes the count here.
    host.features.set('big.two', true);
    win.refresh();
    assert.equal(cardOf(page, 'big').querySelector('.ss-module-features').textContent, 'Features: 2 of 3 on — change');
    host.close();
});

test('settings are the form engine\'s, a group each as a sub-section, written through the same store', async () => {
    const { page, host } = await open();
    const card = cardOf(page, 'small');
    assert.deepEqual(rows(card), ['s1', 's2']);
    assert.deepEqual(titles(card).slice(1), ['Look', 'Sound'], 'the groups are sub-sections under the module\'s name');
    assert.equal(card.querySelectorAll('details').length, 0, 'few settings: nothing folded');
    const text = card.querySelector('.ss-field[data-field="s2"] input');
    text.value = 'Bell';
    text.dispatch('change');
    assert.equal(host.settings('small').s2, 'Bell');
    const sw = card.querySelector('.ss-field[data-field="s1"] [role="switch"]');
    sw.click();
    assert.equal(host.settings('small').s1, false);
    host.close();
});

test('a module with many settings folds its groups, the first open; a fold id opens one; the reader\'s choice is kept', async () => {
    const { page, win, host, doc } = await open();
    const card = cardOf(page, 'big');
    assert.ok(rows(card).length > FOLD_ABOVE);
    const folds = card.querySelectorAll('details.ss-section');
    assert.deepEqual(folds.map(node => node.dataset.fold), ['big::group:Alpha', 'big::group:Beta', 'big::group:Gamma']);
    assert.deepEqual(folds.map(node => node.open), [true, false, false], 'the first one open');
    assert.deepEqual(folds.map(node => node.querySelector('summary .ss-section-title').textContent), ['Alpha', 'Beta', 'Gamma']);
    // A fold id opens its group (and the page), the summary focused.
    win.select('look');
    const nodes = () => cardOf(page, 'big').querySelectorAll('details.ss-section');
    assert.equal(win.root.querySelector('.ss-settings-page:not([hidden])').dataset.ssSection, 'look');
    const reopened = openSettingsWindow({ registry: host.registry, settings: host.settings, features: host.features, doc, sdk: host.sdk, openState: new Map(), fold: 'big::group:Gamma' });
    const gamma = reopened.root.querySelectorAll('details.ss-section').find(node => node.dataset.fold === 'big::group:Gamma');
    assert.equal(reopened.section(), 'modules');
    assert.equal(gamma.open, true);
    assert.ok(doc.activeElement === gamma.querySelector('summary'));
    reopened.close();
    void nodes;
    host.close();
});

test('folded groups: a search opens the groups that match and the reader\'s own choice comes back; the state lives in the window\'s openState', async () => {
    const state = new Map();
    const { page, root, host } = await open(undefined, { window: { openState: state } });
    const card = () => cardOf(page, 'big');
    const opened = () => card().querySelectorAll('details.ss-section').map(node => node.open);
    assert.deepEqual(opened(), [true, false, false]);
    // The reader opens Beta.
    const beta = card().querySelectorAll('details.ss-section')[1];
    beta.open = true;
    beta.dispatch('toggle');
    assert.equal(state.get('big::group:Beta'), true);
    search(root, 'eighth');
    assert.deepEqual(card().querySelectorAll('details.ss-section').map(node => node.hidden), [true, true, false], 'only the group with the match');
    assert.equal(card().querySelectorAll('details.ss-section')[2].open, true, 'opened for the search');
    search(root, '');
    assert.deepEqual(opened(), [true, true, false], 'as the reader left them');
    host.close();
});

test('search: a module\'s name shows all its settings; a setting shows only its own; cards and Versions with no match are out', async () => {
    const { page, root, host } = await open();
    search(root, 'small module');
    assert.equal(cardOf(page, 'small').hidden, false);
    assert.equal(cardOf(page, 'big').hidden, true);
    assert.deepEqual(rows(cardOf(page, 'small')).length, 2);
    assert.equal(page.querySelector('.ss-versions-card').hidden, true);
    search(root, 'shiny');
    assert.equal(cardOf(page, 'small').hidden, false);
    assert.deepEqual(cardOf(page, 'small').querySelectorAll('.ss-field').filter(node => !node.hidden).map(node => node.dataset.field), ['s1']);
    search(root, 'versions');
    assert.equal(page.querySelector('.ss-versions-card').hidden, false);
    search(root, '');
    assert.ok(page.querySelectorAll('.ss-module-card').every(node => !node.hidden));
    host.close();
});

test('a module\'s own panel and own fold are embedded in its card, drawn by the module; a panel under a feature that is off is not shown', async () => {
    const log = [];
    const { page, win, host } = await open([panelled(log)]);
    const card = cardOf(page, 'panelled');
    const panel = card.querySelector('.ss-module-panel');
    assert.ok(panel);
    assert.equal(panel.querySelector('.story-suite-section-title').textContent, 'Panelled log');
    assert.equal(panel.querySelector('.story-suite-section').textContent, 'Panel with 1 line(s)');
    const tools = card.querySelector('.ss-module-own');
    assert.equal(tools.dataset.fold, 'panelled/tools');
    assert.equal(tools.querySelector('.ss-section-title').textContent, 'Tools');
    assert.equal(tools.querySelector('.ss-section-body').textContent, 'Tools for 1');
    // The panel gets the module's settings API: a change made in its form shows the next time it is drawn.
    card.querySelector('.ss-field[data-field="n"] input').value = '4';
    card.querySelector('.ss-field[data-field="n"] input').dispatch('change');
    win.refresh();
    assert.equal(cardOf(page, 'panelled').querySelector('.story-suite-section').textContent, 'Panel with 4 line(s)');
    // Under a feature that is off the panel is not shown; on again, it is drawn again.
    host.features.set('panelled.show', false);
    win.refresh();
    assert.equal(cardOf(page, 'panelled').querySelector('.ss-module-panel').hidden, true);
    host.features.set('panelled.show', true);
    win.refresh();
    assert.equal(cardOf(page, 'panelled').querySelector('.ss-module-panel').hidden, false);
    host.close();
});

test('a panel that throws says so in its place and the rest of the card still draws', async () => {
    const broken = { id: 'broken', name: 'Broken', settings: { section: 'Broken', defaults: { k: 1 }, schema: { k: field('int', 'K', { min: 1, max: 5 }) }, render() { throw new Error('no panel'); } } };
    const { page, host } = await open([broken]);
    const card = cardOf(page, 'broken');
    assert.match(card.querySelector('.story-suite-section').textContent, /^This part of Broken's settings could not be shown: no panel$/);
    assert.equal(card.querySelectorAll('.ss-field').length, 1);
    host.close();
});

test('Story Block\'s card has what the other pages do not: no money, no Assist, no Packs; its Events stay in Diagnostics', async () => {
    const { page, host } = await open([]);
    const core = cardOf(page, 'story-block');
    assert.ok(core, 'a card');
    assert.equal(core.querySelector('.story-suite-section'), null, 'its Assist panel is the Assist page\'s');
    assert.equal(core.querySelector('.ss-packs-import'), null, 'its Packs are the Tabs & Packs page\'s');
    assert.equal(core.querySelector('.ss-events'), null, 'its Events are in Diagnostics');
    for (const key of ['coins', 'currency', 'assistProfile', 'storyCoinPerReply']) assert.equal(core.querySelector(`.ss-field[data-field="${key}"]`), null, key);
    const split = moduleSchema('story-block', { coins: field('text', 'General thing'), a: { type: 'bool', label: 'Inner chatter: On' }, b: { type: 'bool', label: 'Assist: Safety net', group: 'Assist' } });
    assert.deepEqual(Object.keys(split.schema), ['a'], 'the General and Assist groups go to their pages');
    assert.deepEqual(split.groups, ['Inner chatter']);
    host.close();
});

test('Versions: a small card at the end with Story Block and each module; what is out of step is said there and in its heading', async () => {
    const { page, host } = await open([small()]);
    const card = page.querySelector('.ss-versions-card');
    assert.equal(card.dataset.fold, VERSIONS_FOLD);
    assert.equal(card.querySelector('.ss-section-title').textContent, MODULES_TEXT.versionsTitle);
    assert.equal(card.querySelector('.ss-section-hint').textContent, MODULES_TEXT.inStep);
    assert.deepEqual(card.querySelectorAll('.story-suite-compat-row').map(node => node.dataset.module).sort(), ['small', 'story-block']);
    assert.equal(page.querySelectorAll('.ss-section').filter(node => node.dataset.fold).at(-1), card, 'the last card');
    assert.equal(card.classList.contains('ss-versions-warn'), false);
    host.close();
    // A module made for another Story Block is refused and shown as out of step.
    const doc = setupDom();
    const registry = createRegistry({ hostVersion: '2.0.0', warn: () => {} });
    registry.register(small());
    assert.throws(() => registry.register({ id: 'future', name: 'Future', version: '9.0.0', requires: { storyBlock: '^9' } }));
    const settings = createSettings({ root: () => ({}), registry, save: () => {} });
    const win = openSettingsWindow({ registry, settings, doc, openState: new Map() });
    win.select('modules');
    const warn = win.root.querySelector('.ss-versions-card');
    assert.equal(warn.classList.contains('ss-versions-warn'), true);
    assert.equal(warn.querySelector('.ss-section-hint').textContent, '1 out of step');
    assert.ok(warn.querySelectorAll('.story-suite-compat-row').some(node => node.dataset.module === 'future' && node.dataset.state === 'refused'));
    win.close();
});

test('a module whose settings are placed in Diagnostics has its card here without them', async () => {
    const probe = { id: 'probe', name: 'Probe', version: '1.0.0', settings: { place: 'diagnostics', section: 'Probe log', defaults: { n: 1 }, schema: { n: field('int', 'Lines', { min: 1, max: 9 }) }, render(el) { el.textContent = 'raw'; } } };
    const { page, root, host } = await open([probe]);
    const card = cardOf(page, 'probe');
    assert.ok(card);
    assert.equal(card.querySelectorAll('.ss-field').length, 0);
    assert.equal(card.querySelector('.ss-module-panel'), null);
    void root;
    host.close();
});

// ---- the cards fold (phone hotfix)
test('each card is a fold with a chevron, folded by default; a toggle is kept in the window\'s state, a fold id opens the card', async () => {
    const state = new Map();
    const { page, win } = await open(undefined, { window: { openState: state } });
    const cards = page.querySelectorAll('.ss-module-card');
    assert.ok(cards.length >= 4);
    for (const card of cards) {
        assert.equal(card.tagName, 'DETAILS', card.dataset.module);
        assert.equal(card.open, false, `${card.dataset.module} is folded`);
        assert.ok(card.classList.contains('ss-section-fold'));
        assert.ok(card.querySelector('summary'));
    }
    const big = cardOf(page, 'big');
    big.open = true;
    big.dispatch('toggle');
    assert.equal(state.get('big'), true);
    assert.ok(big.classList.contains('ss-section-fold-open'));
    win.select('features');
    win.select('modules');
    assert.equal(cardOf(page, 'big').open, true, 'kept across leaving the page');
    big.open = false;
    big.dispatch('toggle');
    assert.equal(state.get('big'), false);
});

test('cards: a search opens the cards with a match without remembering it, and the reader\'s choice comes back when it ends', async () => {
    const state = new Map([['big', true]]);
    const { page, root } = await open(undefined, { window: { openState: state } });
    assert.equal(cardOf(page, 'big').open, true);
    assert.equal(cardOf(page, 'small').open, false);
    search(root, 'shiny');
    assert.equal(cardOf(page, 'small').hidden, false);
    assert.equal(cardOf(page, 'small').open, true, 'opened by the match');
    // The browser's toggle for that opening comes later and is not the reader's choice.
    cardOf(page, 'small').dispatch('toggle');
    assert.equal(state.has('small'), false);
    search(root, '');
    assert.equal(cardOf(page, 'small').open, false, 'the reader\'s choice is back');
    assert.equal(cardOf(page, 'big').open, true, 'and the one they opened stays');
    cardOf(page, 'small').dispatch('toggle');
    assert.equal(state.get('small'), false);
});

test('opening the window at a module\'s fold id opens that card (and only it)', async () => {
    const { page } = await open(undefined, { window: { fold: 'small' } });
    assert.equal(cardOf(page, 'small').open, true);
    assert.equal(cardOf(page, 'big').open, false);
});
