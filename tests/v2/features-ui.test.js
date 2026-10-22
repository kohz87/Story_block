// Features in the page (MODULES §F100): the settings overlay's Features (one fold with a filter and a
// sub-fold per module, a line in each module's fold going there, the prompt hint), and the page following a switch: a module's
// screens, tabs and widgets hidden, Story Block's status strip and cards under replies.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { makeMessage } from '../ui-fake-dom.js';
import { setupDom } from './view/mounts/helpers.js';
import { FEATURES_FOLD, FEATURE_TEXT, PACKS_FOLD, VERSIONS_FOLD, featureInputId, featuresFoldOf, renderSettingsHost } from '../../src/v2/host-ui.js';
import { openSettingsWindow as openSettingsOverlay } from '../../src/v2/view/settings/window.js';
import { CORE_FEATURE, PROMPT_HINT } from '../../src/v2/features.js';
import { hudOn, mountUi } from '../../src/v2/ui-host.js';
import { CHANGES_CARD_SCREEN_ID } from '../../src/v2/screens/index.js';

const texts = (root, selector) => root.querySelectorAll(selector).map(node => node.textContent);

// Two features: one that changes the static prompt (it owns a kind), one that owns screens, a tab and a widget.
const loot = () => ({
    id: 'loot',
    name: 'Loot',
    features: [
        { id: 'loot.picker', label: 'Loot picker', describe: 'Pick what to keep after a fight.' },
        { id: 'loot.weight', label: 'Weight', describe: 'Items weigh something.', default: false },
    ],
    capture: { kinds: { weight: { grammar: '~ weight Item | kg: 1', feature: 'loot.weight' } }, apply: () => ({ summary: 'ok', narrate: false }) },
    screens: [
        { id: 'loot/picker', title: 'Picker', mounts: ['tab', 'hud'], template: '<p class="picker">pick</p>', feature: 'loot.picker' },
        { id: 'loot/bag', title: 'Bag', mounts: ['tab'], template: '<p class="bag">bag</p>' },
    ],
    tabs: [{ id: 'loot-code', title: 'Loot code', render: el => { el.textContent = 'code'; }, feature: 'loot.picker' }],
    widgets: { 'loot.gem': { render: el => { el.textContent = 'gem'; }, feature: 'loot.picker' } },
});
// A module with settings and no features: its fold has no Features subsection.
const plain = () => ({ id: 'plain', name: 'Plain', settings: { defaults: { on: true }, schema: { on: { type: 'bool', label: 'On' } } } });

async function overlay(options = {}) {
    const doc = setupDom();
    const host = await createHost({ modules: [loot(), plain()], ...options });
    const root = doc.createElement('div');
    doc.body.appendChild(root);
    const view = renderSettingsHost(root, { registry: host.registry, settings: host.settings, features: host.features, doc, sdk: host.sdk });
    return { doc, host, root, view };
}

const foldOf = (root, key) => root.querySelectorAll('details.story-suite-fold').find(node => node.dataset.fold === key);
const rowsOf = node => node.querySelectorAll('.story-suite-feature');

const subOf = (root, moduleId) => root.querySelectorAll('details.story-suite-subfold').find(node => node.dataset.fold === featuresFoldOf(moduleId));
const subsOf = node => node.querySelectorAll('details.story-suite-subfold');
const countOn = (host, moduleId) => {
    const own = host.features.list().filter(feature => feature.moduleId === moduleId);
    return { on: own.filter(feature => feature.on === true && feature.available !== false).length, n: own.length };
};

test('the overlay: Features has a sub-fold per module ("N of M on"); a module\'s fold has one line going there, no switches', async () => {
    const { root, host } = await overlay();
    const folds = root.querySelectorAll('details.story-suite-fold').map(node => node.dataset.fold);
    assert.deepEqual(folds, [PACKS_FOLD, FEATURES_FOLD, 'plain', 'story-block', 'story-suite-versions'], 'Packs, Features, then the modules with settings by id (Loot has only features: no fold of its own), then Versions');
    const overview = foldOf(root, FEATURES_FOLD);
    assert.equal(overview.querySelector('summary b').textContent, FEATURE_TEXT.title);
    assert.deepEqual(subsOf(overview).map(node => node.dataset.fold), [featuresFoldOf('loot'), featuresFoldOf('story-block')]);
    assert.deepEqual(subsOf(overview).map(node => node.querySelector('summary b').textContent), ['Loot', 'Story Block']);
    const sb = countOn(host, 'story-block');
    assert.deepEqual(subsOf(overview).map(node => node.querySelector('summary small').textContent), ['1 of 2 on', `${sb.on} of ${sb.n} on`]);
    assert.deepEqual(subsOf(overview).map(node => node.open), [false, false], 'several modules: closed until opened');
    assert.deepEqual(rowsOf(overview).map(row => row.dataset.feature), ['loot.picker', 'loot.weight', ...host.registry.features().filter(f => f.moduleId === 'story-block').map(f => f.id)]);
    const [picker, weight] = rowsOf(subOf(root, 'loot'));
    assert.equal(picker.querySelector('b').textContent, 'Loot picker');
    assert.deepEqual(texts(picker, 'small'), ['Pick what to keep after a fight.']);
    assert.equal(picker.querySelector('input').checked, true);
    assert.equal(picker.querySelector('input').getAttribute('role'), 'switch');
    // A feature that changes the static prompt says so.
    assert.deepEqual(texts(weight, 'small'), ['Items weigh something.', PROMPT_HINT]);
    assert.equal(PROMPT_HINT, 'Changes the fixed prompt once (one slower reply).');
    assert.equal(weight.querySelector('input').checked, false);
    assert.deepEqual(texts(subOf(root, 'story-block'), '.story-suite-feature > span > b'), ['Status strip', 'Cards under replies', 'Roll checks before the reply', 'Safety net: read changes the reply forgot', 'State inspector', 'Save points', 'Choices', 'Inner chatter', 'Weather', 'Pick what you take', 'Encumbered']);
    // A module's fold: no switches, one line saying how many are on; it opens Features at that module.
    const sbFold = foldOf(root, 'story-block');
    assert.equal(sbFold.querySelector('.story-suite-feature'), null);
    assert.equal(sbFold.querySelector('.story-suite-features'), null);
    assert.ok(!subsOf(sbFold).some(node => node.querySelector('summary b').textContent === FEATURE_TEXT.title), 'no Features sub-fold in it');
    const link = sbFold.querySelector('.story-suite-fold-body > .story-suite-feature-line > .story-suite-feature-link');
    assert.equal(link.tagName, 'BUTTON');
    assert.equal(link.type, 'button');
    assert.equal(link.textContent, `Features: ${sb.on} of ${sb.n} on — change`);
    assert.equal(link.getAttribute('aria-label'), `Features of Story Block: ${sb.on} of ${sb.n} on. Change them in the Features fold.`);
    assert.equal(sbFold.querySelector('.story-suite-fold-body').children[0].className, 'story-suite-feature-line', 'first in the fold');
    // No features, no line.
    assert.equal(foldOf(root, 'plain').querySelector('.story-suite-feature-line'), null);
    link.click();
    assert.equal(overview.open, true);
    assert.equal(subOf(root, 'story-block').open, true);
    assert.ok(root.ownerDocument.activeElement === subOf(root, 'story-block').querySelector('summary'), 'the focus on that module\'s sub-fold');
    host.close();
});

test('the overlay: a switch stores the reader\'s choice; the module\'s line and the sub-fold\'s count follow it', async () => {
    const { root, host, view } = await overlay({ modules: [loot(), plain(), { ...plain(), id: 'plain2', name: 'Plain two', features: [{ id: 'plain2.x', label: 'X' }] }] });
    // A switch redraws the overlay, so the rows are looked up again after each change.
    const input = () => rowsOf(subOf(root, 'loot')).find(row => row.dataset.feature === 'loot.weight').querySelector('input');
    input().checked = true;
    input().dispatch('change');
    assert.equal(host.sdk.feature('loot.weight'), true);
    assert.equal(host.ctx.extensionSettings.storySuite.features['loot.weight'], true);
    assert.equal(input().checked, true);
    assert.equal(input().getAttribute('aria-checked'), 'true');
    assert.equal(subOf(root, 'loot').querySelector('summary small').textContent, '2 of 2 on');
    assert.equal(foldOf(root, 'plain2').querySelector('.story-suite-feature-link').textContent, 'Features: 1 of 1 on — change');
    rowsOf(subOf(root, 'plain2'))[0].querySelector('input').checked = false;
    rowsOf(subOf(root, 'plain2'))[0].querySelector('input').dispatch('change');
    assert.equal(foldOf(root, 'plain2').querySelector('.story-suite-feature-link').textContent, 'Features: 0 of 1 on — change');
    input().checked = false;
    input().dispatch('change');
    assert.equal(host.sdk.feature('loot.weight'), false);
    // A redraw shows what is stored, and keeps the open folds open.
    subOf(root, 'loot').open = true;
    view.refresh();
    assert.equal(subOf(root, 'loot').open, true);
    assert.equal(input().checked, false);
    host.close();
});

test('the overlay: the sub-folds go by module name, A to Z, whatever the ids', async () => {
    const zed = { id: 'aaa-zed', name: 'Zed', features: [{ id: 'aaa-zed.one', label: 'One' }] };
    const able = { id: 'zzz-able', name: 'able', features: [{ id: 'zzz-able.one', label: 'One' }] };
    const { root, host } = await overlay({ modules: [zed, loot(), able] });
    assert.deepEqual(subsOf(foldOf(root, FEATURES_FOLD)).map(node => node.querySelector('summary b').textContent), ['able', 'Loot', 'Story Block', 'Zed']);
    host.close();
});

test('the overlay: the filter finds features by name or description across modules, and keeps the folds as they were', async () => {
    const { root, host } = await overlay();
    const box = () => foldOf(root, FEATURES_FOLD).querySelector('.story-suite-feature-filter input');
    const shown = () => rowsOf(foldOf(root, FEATURES_FOLD)).filter(row => !row.hidden).map(row => row.dataset.feature);
    const type = text => { box().value = text; box().dispatch('input'); };
    // Labelled, the first thing after the help line.
    const label = foldOf(root, FEATURES_FOLD).querySelector('.story-suite-feature-filter');
    assert.equal(label.tagName, 'LABEL');
    assert.equal(label.getAttribute('for'), box().id);
    assert.equal(label.querySelector('b').textContent, 'Find a feature');
    assert.equal(box().type, 'search');
    subOf(root, 'story-block').open = true;
    type('WEIGH');
    assert.deepEqual(shown(), ['loot.weight'], 'by name, any case');
    assert.equal(subOf(root, 'story-block').hidden, true, 'a module with no match is hidden');
    assert.equal(subOf(root, 'loot').hidden, false);
    assert.equal(subOf(root, 'loot').open, true, 'one with a match opens');
    type('after a fight');
    assert.deepEqual(shown(), ['loot.picker'], 'by description');
    type('strip');
    assert.deepEqual(shown(), [CORE_FEATURE.hud], 'across modules');
    assert.equal(subOf(root, 'loot').hidden, true);
    // Kept across a redraw (a switch redraws everything).
    rowsOf(subOf(root, 'story-block')).find(row => row.dataset.feature === CORE_FEATURE.hud).querySelector('input').checked = false;
    rowsOf(subOf(root, 'story-block')).find(row => row.dataset.feature === CORE_FEATURE.hud).querySelector('input').dispatch('change');
    assert.equal(box().value, 'strip');
    assert.deepEqual(shown(), [CORE_FEATURE.hud]);
    type('nothing like this');
    assert.deepEqual(shown(), []);
    assert.equal(foldOf(root, FEATURES_FOLD).querySelector('.story-suite-feature-none').textContent, 'No feature matches "nothing like this".');
    assert.equal(foldOf(root, FEATURES_FOLD).querySelector('.story-suite-feature-none').hidden, false);
    // Cleared: every row back, each sub-fold open or closed as the reader left it.
    type('');
    assert.equal(shown().length, host.features.list().length);
    assert.deepEqual([subOf(root, 'loot').open, subOf(root, 'story-block').open], [false, true]);
    assert.equal(foldOf(root, FEATURES_FOLD).querySelector('.story-suite-feature-none').hidden, true);
    // A module's line clears a filter that hides its module.
    type('weigh');
    foldOf(root, 'story-block').querySelector('.story-suite-feature-link').click();
    assert.equal(box().value, '');
    assert.equal(subOf(root, 'story-block').hidden, false);
    assert.equal(subOf(root, 'story-block').open, true);
    host.close();
});

test('the settings window opened at a module\'s old "<id>::features" shows the Features page with that module\'s group focused', async () => {
    const doc = setupDom();
    const host = await createHost({ modules: [loot(), plain()] });
    const overlayApi = openSettingsOverlay({ registry: host.registry, settings: host.settings, features: host.features, doc, openState: new Map(), fold: 'loot::features' });
    assert.equal(overlayApi.section(), 'features');
    const group = overlayApi.root.querySelectorAll('.ss-features-group').find(node => node.dataset.fold === featuresFoldOf('loot'));
    assert.ok(group, 'Loot\'s group of tiles');
    assert.ok(doc.activeElement === group.querySelector('.ss-section-title'));
    overlayApi.close();
    host.close();
});

test('the overlay without a feature store shows no Features (an older caller)', async () => {
    const doc = setupDom();
    const host = await createHost({ modules: [loot(), plain()] });
    const root = doc.createElement('div');
    renderSettingsHost(root, { registry: host.registry, settings: host.settings, doc });
    assert.equal(root.querySelector('.story-suite-feature'), null);
    assert.deepEqual(root.querySelectorAll('details.story-suite-fold').map(node => node.dataset.fold), [PACKS_FOLD, 'plain', 'story-block', 'story-suite-versions']);
    host.close();
});

// ---------------------------------------------------------------------------------------------------
// The page

async function page(options = {}) {
    const doc = setupDom();
    const form = doc.createElement('div');
    form.id = 'send_form';
    doc.body.appendChild(form);
    const drawerHost = doc.createElement('div');
    drawerHost.id = 'extensions_settings';
    doc.body.appendChild(drawerHost);
    const host = await createHost({ modules: [loot()], ...options });
    const runtime = { registry: host.registry, store: host.store, sdk: host.sdk, settings: host.settings, events: host.events, turn: host.turn, features: host.features };
    const ui = mountUi({ runtime, ctx: host.ctx, doc, version: '2.0.0-test' });
    const draw = () => {
        for (const old of doc.querySelectorAll('.mes')) old.remove();
        host.ctx.chat.forEach((message, index) => makeMessage(doc, index));
    };
    return { doc, host, ui, draw };
}

test('the page: a feature\'s screens, tabs and widgets go when it is turned off and come back when it is on', async () => {
    const { doc, host, ui } = await page();
    ui.openPanel();
    const panel = doc.querySelector('#story_suite_v2_panel');
    const labels = () => texts(panel, '.story-suite-tab-label');
    assert.ok(labels().includes('Picker') && labels().includes('Loot code') && labels().includes('Bag'), labels().join(', '));
    assert.ok(doc.querySelector('.ss-hud .picker'), 'the picker in the status strip');
    assert.ok(ui.screens.resolve('loot/picker'));

    host.features.set('loot.picker', false);
    assert.ok(!labels().includes('Picker') && !labels().includes('Loot code') && labels().includes('Bag'), labels().join(', '));
    assert.equal(doc.querySelector('.ss-hud .picker'), null);
    assert.equal(ui.screens.resolve('loot/picker'), null);
    assert.deepEqual(ui.screens.list('tab').map(entry => entry.id).filter(id => id.startsWith('loot/')), ['loot/bag']);
    // A pack's or the reader's version of an off screen is hidden all the same.
    ui.screens.choose('loot/picker', { id: 'loot/picker', title: 'Mine', mounts: ['tab'], template: '<p>mine</p>' });
    ui.refresh();
    assert.ok(!labels().includes('Mine'));

    host.features.set('loot.picker', true);
    assert.ok(labels().includes('Mine') && labels().includes('Loot code'), labels().join(', '));
    host.close();
});

test('the page: a widget whose feature is off draws nothing, not a "no widget" error', async () => {
    const bag = { id: 'loot/bag', title: 'Bag', mounts: ['tab'], template: '<p class="bag"><ss-widget name="loot.gem"></ss-widget></p>' };
    const { doc, host, ui } = await page({ modules: [{ ...loot(), screens: [bag] }] });
    ui.openPanel();
    const pane = () => {
        doc.querySelectorAll('.story-suite-tab').find(node => node.dataset.tabId === 'loot/bag').click();
        return doc.querySelector('.story-suite-pane');
    };
    assert.ok(pane().textContent.includes('gem'), 'drawn while on');
    host.features.set('loot.picker', false);
    const off = pane();
    assert.ok(off.querySelector('.bag'));
    assert.ok(!/no widget/i.test(off.textContent), off.textContent);
    assert.ok(!off.textContent.includes('gem'));
    host.features.set('loot.picker', true);
    assert.ok(pane().textContent.includes('gem'), 'back on');
    host.close();
});

test('the page: the status strip is Story Block\'s feature; the drawer switch and the feature are one choice', async () => {
    const { doc, host, ui } = await page();
    assert.ok(doc.querySelector('.ss-hud'));
    host.features.set(CORE_FEATURE.hud, false);
    assert.equal(doc.querySelector('.ss-hud'), null, 'the feature hides it');
    assert.equal(doc.querySelector('.story-suite-hud-toggle input').checked, false, 'the drawer switch follows');
    assert.equal(ui.hudOn(), false);
    ui.setHud(true);
    assert.ok(doc.querySelector('.ss-hud'));
    assert.equal(host.sdk.feature(CORE_FEATURE.hud), true);
    assert.equal(host.ctx.extensionSettings.storySuite.features[CORE_FEATURE.hud], true);
    assert.equal(host.ctx.extensionSettings.storySuite.hud, true, 'the old switch kept in step');
    // The feature's choice wins over the old switch; without one the old switch counts.
    assert.equal(hudOn({ storySuite: { hud: false, features: { [CORE_FEATURE.hud]: true } } }), true);
    assert.equal(hudOn({ storySuite: { hud: false } }), false);
    host.close();
});

test('the page: with the cards feature off no card is drawn under a reply; on again they come back', async () => {
    const { doc, host, ui, draw } = await page();
    await host.send('hi', 'You find a rope.\n<Changes>\n+ item Rope | qty: 1\n</Changes>');
    draw();
    ui.mounts.card.refresh(2, { force: true });
    const card = () => doc.querySelector(`.mes[mesid="2"] [data-ss-card="${CHANGES_CARD_SCREEN_ID}"]`);
    assert.ok(card(), 'on by default');
    host.features.set(CORE_FEATURE.cards, false);
    assert.equal(card(), null);
    ui.mounts.card.refresh(2, { force: true });
    assert.equal(card(), null, 'stays off');
    host.features.set(CORE_FEATURE.cards, true);
    ui.mounts.card.refresh(2, { force: true });
    assert.ok(card());
    host.close();
});

test('the page: the settings window opened from the bar has the Features, as switch tiles', async () => {
    const { doc, host } = await page();
    doc.querySelector('.story-suite-bar-settings').click();
    const overlayRoot = doc.querySelector('#story_suite_v2_overlay');
    assert.ok(overlayRoot.querySelectorAll('.ss-features-group').some(node => node.dataset.fold === featuresFoldOf('loot')));
    assert.equal(overlayRoot.querySelector('details[data-fold="story-suite-features"]'), null, 'no Features fold any more');
    host.close();
});

test('the overlay: each switch has an id of its own (place + the whole feature id), and its row labels it', async () => {
    const { root, host } = await overlay();
    const rows = root.querySelectorAll('.story-suite-feature');
    const ids = rows.map(row => row.querySelector('input').id);
    assert.equal(new Set(ids).size, ids.length);
    for (const row of rows) assert.equal(row.getAttribute('for'), row.querySelector('input').id);
    assert.equal(featureInputId('overview', 'a.b_c') === featureInputId('overview', 'a.b.c'), false);
    assert.ok(ids.includes(featureInputId('overview', 'loot.weight')));
    assert.ok(!ids.some(id => id.includes('_module_')), 'drawn once, in the Features fold');
    host.close();
});

test('the page: a dialog for a screen whose feature is off does not open, and an open one closes when it goes off', async () => {
    const wizard = { ...loot(), screens: [{ id: 'loot/pick', title: 'Pick', mounts: ['dialog'], template: '<p class="pick">pick</p>', feature: 'loot.picker' }] };
    const { doc, host, ui } = await page({ modules: [wizard] });
    // sdk.dialog.open goes to this mount (ui-host's setDialog).
    const open = id => ui.mounts.dialog.open(id);
    const handle = open('loot/pick');
    assert.ok(handle && doc.querySelector('.ss-dialog .pick'));
    host.features.set('loot.picker', false);
    assert.equal(doc.querySelector('.ss-dialog'), null, 'closed with its feature');
    assert.equal(handle.isOpen(), false);
    assert.equal(open('loot/pick'), null, 'nothing opens');
    assert.equal(doc.querySelector('.ss-dialog'), null);
    assert.equal(open('nobody/has-this'), null, 'nor for an id no one has');
    host.features.set('loot.picker', true);
    assert.ok(open('loot/pick'));
    host.close();
});

test('the overlay: a settings field or panel of a feature that is off is not drawn, its value kept; a switch redraws at once', async () => {
    const doc = setupDom();
    const panel = Object.assign(el => { el.textContent = 'Digest panel'; }, { feature: 'dig.digest' });
    const dig = {
        id: 'dig', name: 'Dig',
        features: [{ id: 'dig.digest', label: 'Digest' }],
        settings: {
            defaults: { keep: 3, colour: 'red' },
            schema: { keep: { type: 'int', label: 'Digest: days kept', min: 1, max: 9, feature: 'dig.digest' }, colour: { type: 'text', label: 'Colour' } },
            section: panel,
        },
    };
    const host = await createHost({ modules: [dig] });
    host.settings.set('dig', 'keep', 5);
    const root = doc.createElement('div');
    doc.body.appendChild(root);
    renderSettingsHost(root, { registry: host.registry, settings: host.settings, features: host.features, doc, sdk: host.sdk });
    assert.ok(root.textContent.includes('days kept') && root.textContent.includes('Digest panel'));
    foldOf(root, 'dig').open = true;
    const input = rowsOf(subOf(root, 'dig'))[0].querySelector('input');
    input.checked = false;
    input.dispatch('change');
    assert.ok(!root.textContent.includes('days kept') && !root.textContent.includes('Digest panel'), 'gone at once');
    assert.ok(root.textContent.includes('Colour'));
    assert.equal(foldOf(root, 'dig').open, true, 'the fold stays open');
    assert.equal(host.settings('dig').keep, 5, 'the value is kept');
    rowsOf(subOf(root, 'dig'))[0].querySelector('input').checked = true;
    rowsOf(subOf(root, 'dig'))[0].querySelector('input').dispatch('change');
    assert.ok(root.textContent.includes('days kept'));
    // A field naming a feature the module does not have is refused like any other `feature`.
    assert.throws(() => host.registry.register({ id: 'odd', settings: { schema: { x: { type: 'bool', feature: 'odd.nope' } } } }), /the settings field "x" names the feature "odd\.nope"/);
    host.close();
});

test('the overlay: a feature whose needs are not met is drawn off and disabled, with its reason', async () => {
    const { root, host } = await overlay({ settings: { features: { [CORE_FEATURE.preroll]: true } } });
    const rows = root.querySelectorAll('.story-suite-feature').filter(row => row.dataset.feature === CORE_FEATURE.preroll);
    assert.equal(rows.length, 1, 'drawn once, in the Features fold');
    for (const row of rows) {
        const input = row.querySelector('input');
        assert.equal(input.disabled, true);
        assert.equal(input.checked, false);
        assert.ok(texts(row, 'small').includes('Needs a module that keeps checks, like RPG Battle.'));
    }
    host.close();
});

test('the overlay: a feature switch redraws everything, the Versions fold included', async () => {
    const { root, host } = await overlay();
    assert.ok(foldOf(root, VERSIONS_FOLD), 'drawn');
    foldOf(root, VERSIONS_FOLD).open = true;
    const input = rowsOf(subOf(root, 'loot'))[1].querySelector('input');
    input.checked = true;
    input.dispatch('change');
    assert.ok(foldOf(root, VERSIONS_FOLD), 'still there after the redraw');
    assert.equal(foldOf(root, VERSIONS_FOLD).open, true, 'and still open');
    assert.equal(root.querySelectorAll('details.story-suite-fold').at(-1).dataset.fold, VERSIONS_FOLD, 'last, where #105 put it');
    host.close();
});
