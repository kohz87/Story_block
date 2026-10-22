// The features form (src/v2/view/form/features.js, UI stage step 3b): one group of switch tiles per module with "N of M on",
// written through the feature store, with the search, the focus to a group, and the states a feature can be in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../../../ui-fake-dom.js';
import { featureGroups, renderFeaturesForm } from '../../../../src/v2/view/form/features.js';
import { FORM_TEXT } from '../../../../src/v2/view/form/schema.js';
import { PROMPT_HINT } from '../../../../src/v2/features.js';

const doc = installFakeDom();

// A feature store as features.js gives it: list() and set(id, on); `needs` met or not decides `available`.
function store(initial) {
    const list = initial.map(feature => ({ moduleName: feature.moduleId, on: false, available: true, describe: '', ...feature }));
    const calls = [];
    return {
        list: () => list.map(feature => ({ ...feature })),
        set(id, on) {
            const feature = list.find(item => item.id === id);
            calls.push([id, on]);
            if (!feature) return undefined;
            feature.on = Boolean(on);
            return feature.on;
        },
        calls,
        raw: list,
    };
}
const FEATURES = () => [
    { id: 'rb.wear', moduleId: 'rb', moduleName: 'RPG Battle', label: 'Gear wear', describe: 'Equipment wears in fights.', on: true, prompt: true },
    { id: 'rb.craft', moduleId: 'rb', moduleName: 'RPG Battle', label: 'Crafting', describe: 'Recipes and orders.', on: false },
    { id: 'sd.clock', moduleId: 'sd', moduleName: 'Story Director', label: 'Story clock', describe: 'Time passes with the story.', on: true },
    { id: 'nsd.drift', moduleId: 'nsd', moduleName: 'NPC State Delta', label: 'Meters drift', describe: 'Needs a clock.', on: false, available: false, why: 'Needs Story Director\'s clock.' },
];
const texts = (root, selector) => root.querySelectorAll(selector).map(node => node.textContent);
const tile = (form, id) => form.field(id).tile;

test('groups: one per module, by name, with "N of M on"; the group key is the Features fold\'s sub-fold key', () => {
    const form = renderFeaturesForm(null, { features: store(FEATURES()), doc });
    assert.deepEqual(texts(form.el, '.ss-section-title'), ['NPC State Delta', 'RPG Battle', 'Story Director']);
    assert.deepEqual(texts(form.el, '.ss-section-hint'), ['0 of 1 on', '1 of 2 on', '1 of 1 on'], 'an unavailable feature is not on');
    assert.deepEqual(form.el.querySelectorAll('.ss-features-group').map(node => node.dataset.fold), ['story-suite-features::nsd', 'story-suite-features::rb', 'story-suite-features::sd']);
    assert.deepEqual(form.keys(), ['nsd.drift', 'rb.wear', 'rb.craft', 'sd.clock']);
    assert.deepEqual(featureGroups(FEATURES()).map(group => group.moduleId), ['nsd', 'rb', 'sd']);
    assert.deepEqual(featureGroups(null), []);
    // Every group is a labelled section (an h4 under the page's h3) and the tiles are in a grid inside it.
    const group = form.group('rb');
    assert.equal(group.tagName, 'SECTION');
    assert.equal(group.getAttribute('aria-labelledby'), group.querySelector('.ss-section-title').id);
    assert.equal(group.querySelector('.ss-section-title').tagName, 'H4');
    assert.ok(group.querySelector('.ss-features-grid .ss-feature'));
});

test('a tile: the name labels its switch, the description and the prompt note describe it; an unavailable feature is off and disabled with its reason', () => {
    const form = renderFeaturesForm(null, { features: store(FEATURES()), doc });
    const wear = tile(form, 'rb.wear');
    const name = wear.querySelector('.ss-feature-name');
    const sw = wear.querySelector('.ss-switch');
    assert.equal(name.tagName, 'LABEL');
    assert.equal(name.textContent, 'Gear wear');
    assert.equal(name.getAttribute('for'), sw.id);
    assert.equal(sw.getAttribute('aria-labelledby'), name.id);
    assert.equal(sw.getAttribute('role'), 'switch');
    assert.equal(sw.getAttribute('aria-checked'), 'true');
    assert.deepEqual(texts(wear, 'small'), ['Equipment wears in fights.', PROMPT_HINT]);
    assert.deepEqual(sw.getAttribute('aria-describedby').split(' ').map(id => wear.querySelectorAll('small').find(node => node.id === id)?.textContent), ['Equipment wears in fights.', PROMPT_HINT]);
    assert.equal(tile(form, 'rb.craft').querySelector('.ss-feature-cost'), null, 'no note for a feature that leaves the fixed prompt alone');
    const drift = tile(form, 'nsd.drift');
    assert.ok(drift.classList.contains('ss-feature-unavailable'));
    assert.equal(drift.querySelector('.ss-switch').getAttribute('aria-checked'), 'false');
    assert.equal(drift.querySelector('.ss-switch').disabled, true);
    assert.equal(drift.querySelector('.ss-feature-why').textContent, 'Needs Story Director\'s clock.');
    // A click on it does nothing.
    const features = store(FEATURES());
    const again = renderFeaturesForm(null, { features, doc });
    again.field('nsd.drift').tile.querySelector('.ss-switch').click();
    assert.deepEqual(features.calls, []);
});

test('a switch writes through the store, shows what the store says, updates the count and tells onChange; a refused one goes back', () => {
    const features = store(FEATURES());
    const changes = [];
    const form = renderFeaturesForm(null, { features, doc, onChange: change => changes.push(change) });
    const sw = tile(form, 'rb.craft').querySelector('.ss-switch');
    sw.click();
    assert.deepEqual(features.calls, [['rb.craft', true]]);
    assert.equal(sw.getAttribute('aria-checked'), 'true');
    assert.ok(sw.classList.contains('ss-switch-on'));
    assert.deepEqual(changes, [{ id: 'rb.craft', on: true }]);
    assert.equal(form.group('rb').querySelector('.ss-section-hint').textContent, '2 of 2 on');
    // Off again.
    sw.click();
    assert.equal(sw.getAttribute('aria-checked'), 'false');
    assert.equal(form.group('rb').querySelector('.ss-section-hint').textContent, '1 of 2 on');
    // The store does not know the feature (a module went): nothing stored, onChange not told, the switch back as the store has it.
    features.raw.splice(features.raw.findIndex(feature => feature.id === 'sd.clock'), 1);
    const orphan = tile(form, 'sd.clock').querySelector('.ss-switch');
    const count = changes.length;
    orphan.click();
    assert.equal(changes.length, count);
    assert.ok(!form.field('sd.clock'), 'drawn again without it');
});

test('refresh reads the store again: a switch flipped elsewhere shows in the same element (the focus stays); a feature that came or went redraws', () => {
    const features = store(FEATURES());
    const form = renderFeaturesForm(null, { features, doc });
    const sw = tile(form, 'sd.clock').querySelector('.ss-switch');
    sw.focus();
    features.raw.find(feature => feature.id === 'sd.clock').on = false;
    form.refresh();
    assert.equal(tile(form, 'sd.clock').querySelector('.ss-switch'), sw, 'the same switch');
    assert.equal(sw.getAttribute('aria-checked'), 'false');
    assert.equal(form.group('sd').querySelector('.ss-section-hint').textContent, '0 of 1 on');
    assert.ok(doc.activeElement === sw);
    // A module's features gone: its group is gone, the focus stays on a switch that is still there.
    features.raw.push({ id: 'new.one', moduleId: 'new', moduleName: 'New', label: 'One', describe: '', on: true, available: true });
    form.refresh();
    assert.ok(form.group('new'));
    assert.deepEqual(texts(form.el, '.ss-section-title'), ['New', 'NPC State Delta', 'RPG Battle', 'Story Director']);
    const other = tile(form, 'rb.wear').querySelector('.ss-switch');
    other.focus();
    features.raw.splice(features.raw.findIndex(feature => feature.id === 'new.one'), 1);
    form.refresh();
    assert.equal(form.group('new'), undefined);
    assert.ok(doc.activeElement === tile(form, 'rb.wear').querySelector('.ss-switch'), 'the focus came back to the same feature\'s new switch');
});

test('search: name, description, module and id, every word; groups with no match are left out; the count is returned', () => {
    const form = renderFeaturesForm(null, { features: store(FEATURES()), doc });
    const shown = () => form.el.querySelectorAll('.ss-feature').filter(node => !node.hidden).map(node => node.dataset.feature);
    assert.equal(form.filter(''), 4);
    assert.equal(form.filter('gear'), 1);
    assert.deepEqual(shown(), ['rb.wear']);
    assert.equal(form.group('sd').hidden, true);
    assert.equal(form.group('rb').hidden, false);
    assert.equal(form.filter('rpg battle'), 2, 'by the module\'s name');
    assert.equal(form.filter('RECIPES orders'), 1, 'any case, any order');
    assert.equal(form.filter('sd.clock'), 1, 'by id');
    assert.equal(form.filter('story clock time'), 1);
    assert.equal(form.filter('zzz'), 0);
    const empty = form.el.querySelector('.ss-form-empty');
    assert.equal(empty.hidden, false);
    assert.equal(empty.textContent, 'No settings match "zzz".');
    assert.equal(form.filter(''), 4);
    assert.equal(empty.hidden, true);
    assert.equal(form.el.querySelectorAll('.ss-features-group').filter(node => node.hidden).length, 0);
    // The search survives a refresh.
    form.filter('gear');
    form.refresh();
    assert.deepEqual(shown(), ['rb.wear']);
});

test('focusGroup puts the focus on the module\'s heading; false for a module that is not there or is searched out', () => {
    const form = renderFeaturesForm(null, { features: store(FEATURES()), doc });
    assert.equal(form.focusGroup('sd'), true);
    assert.ok(doc.activeElement === form.group('sd').querySelector('.ss-section-title'));
    assert.equal(form.group('sd').querySelector('.ss-section-title').getAttribute('tabindex'), '-1', 'reachable by script, not a Tab stop');
    assert.equal(form.focusGroup('nope'), false);
    form.filter('gear');
    assert.equal(form.focusGroup('sd'), false);
});

test('disabled: every switch is locked; no store: nothing yet', () => {
    const features = store(FEATURES());
    const form = renderFeaturesForm(null, { features, doc, disabled: true });
    assert.ok(form.el.querySelectorAll('.ss-switch').every(sw => sw.disabled));
    form.setDisabled(false);
    assert.deepEqual(form.el.querySelectorAll('.ss-switch').map(sw => sw.disabled), [true, false, false, false], 'only the unavailable one stays locked');
    const none = renderFeaturesForm(null, { doc });
    assert.deepEqual(none.keys(), []);
    assert.equal(none.el.querySelector('.ss-form-empty').textContent, FORM_TEXT.noRows);
    assert.equal(none.filter('x'), 0);
    const broken = renderFeaturesForm(null, { features: { list() { throw new Error('boom'); }, set() {} }, doc });
    assert.deepEqual(broken.keys(), [], 'a store that throws shows nothing, not an error');
});

test('destroy removes it from its parent', () => {
    const parent = doc.createElement('div');
    const form = renderFeaturesForm(parent, { features: store(FEATURES()), doc });
    assert.equal(parent.children.length, 1);
    form.destroy();
    assert.equal(parent.children.length, 0);
});
