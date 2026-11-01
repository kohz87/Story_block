// "How much to track" on the Features page (src/v2/view/form/presets.js and features.js): three radio tiles over the module groups,
// the selected one derived from the switches (none: "Custom"), a pick that sets the switches through the store and says once that
// the fixed prompt changed, each tile's token number from the static text built for that preset, the search that hides it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../../../ui-fake-dom.js';
import { createHost } from '../../../../testkit/index.js';
import { renderFeaturesForm } from '../../../../src/v2/view/form/features.js';
import { PRESET_TEXT } from '../../../../src/v2/view/form/presets.js';
import { CORE_FEATURE, PROMPT_HINT } from '../../../../src/v2/features.js';
import { estimateTokens, staticTextWith } from '../../../../src/v2/prompt.js';

const doc = installFakeDom();

const tiles = form => form.el.querySelectorAll('.ss-preset-tile');
const checked = form => tiles(form).filter(tile => tile.getAttribute('aria-checked') === 'true').map(tile => tile.dataset.preset);
const tag = form => form.el.querySelector('.ss-preset-state').textContent;
const said = form => form.el.querySelector('.ss-preset-said').textContent;
const pick = (form, name) => tiles(form).find(tile => tile.dataset.preset === name).click();

async function page(options = {}) {
    const host = await createHost(options.host);
    const changes = [];
    const form = renderFeaturesForm(null, {
        features: host.features, doc, fold: { state: new Map() }, onChange: change => changes.push(change),
        staticText: switches => staticTextWith(host.registry, switches), ...options.form,
    });
    return { host, form, changes };
}

test('the group: a title, a radio group of Lean / Standard / Full with the brief\'s texts, the note, then "Fine-tune" over the module groups', async () => {
    const { host, form } = await page();
    const root = form.el;
    const block = root.querySelector('.ss-preset');
    assert.equal(block.tagName, 'SECTION');
    assert.equal(block.querySelector('.ss-preset-title').textContent, 'How much to track');
    assert.equal(block.getAttribute('aria-labelledby'), block.querySelector('.ss-preset-title').id);
    const group = block.querySelector('[role="radiogroup"]');
    assert.ok(group);
    assert.equal(group.getAttribute('aria-labelledby'), block.querySelector('.ss-preset-title').id);
    assert.deepEqual(tiles(form).map(tile => [tile.getAttribute('role'), tile.dataset.preset, tile.querySelector('.ss-preset-name').textContent]), [
        ['radio', 'lean', 'Lean'], ['radio', 'standard', 'Standard'], ['radio', 'full', 'Full'],
    ]);
    assert.deepEqual(tiles(form).map(tile => tile.querySelector('.ss-preset-about').textContent), [
        'Inventory, money, place, people, quests and time. No world-building threads or travel.',
        'Today\'s defaults.',
        'Standard plus Choices, Inner chatter and a check roll before each reply.',
    ]);
    assert.equal(block.querySelector('.ss-preset-note').textContent, 'Change any switch below and this shows Custom. Your saved story is never deleted.');
    assert.equal(group.getAttribute('aria-describedby'), block.querySelector('.ss-preset-note').id);
    // Order in the page: the picker, the small label, then the groups.
    const kids = root.children;
    assert.ok(kids.indexOf(block) < kids.indexOf(root.querySelector('.ss-preset-fine')) && kids.indexOf(root.querySelector('.ss-preset-fine')) < kids.indexOf(root.querySelector('.ss-features-group')));
    assert.equal(root.querySelector('.ss-preset-fine').textContent, 'Fine-tune');
    assert.equal(PRESET_TEXT.fine, 'Fine-tune');
    // The tiles are named by their name and described by what they track and what they weigh.
    const [lean] = tiles(form);
    assert.equal(lean.getAttribute('aria-labelledby'), lean.querySelector('.ss-preset-name').id);
    assert.deepEqual(lean.getAttribute('aria-describedby').split(' ').map(id => root.querySelectorAll('span').find(node => node.id === id)?.className), ['ss-preset-about', 'ss-preset-size']);
    host.close();
});

test('selected: derived from the switches (Standard on a fresh story), one Tab stop; Custom when none matches, and back when one does', async () => {
    const { host, form } = await page();
    assert.deepEqual(checked(form), ['standard']);
    assert.equal(tag(form), '', 'no Custom tag while a tile is selected');
    assert.deepEqual(tiles(form).map(tile => tile.getAttribute('tabindex')), ['-1', '0', '-1'], 'one Tab stop: the selected tile');
    // A switch flipped on the page: nothing matches now.
    form.field(CORE_FEATURE.weather).tile.querySelector('.ss-switch').click();
    assert.deepEqual(checked(form), []);
    assert.equal(tag(form), 'Custom');
    assert.deepEqual(tiles(form).map(tile => tile.getAttribute('tabindex')), ['0', '-1', '-1'], 'still one Tab stop: the first tile');
    // And back to what Standard says.
    form.field(CORE_FEATURE.weather).tile.querySelector('.ss-switch').click();
    assert.deepEqual(checked(form), ['standard']);
    assert.equal(tag(form), '');
    // Flipped elsewhere (the store, not the page) and the page reads it again.
    host.features.set(CORE_FEATURE.choices, true);
    form.refresh();
    assert.deepEqual(checked(form), []);
    assert.equal(tag(form), 'Custom');
    // A switch outside the presets (the status strip) does not make it Custom.
    host.features.set(CORE_FEATURE.choices, false);
    host.features.set(CORE_FEATURE.hud, false);
    form.refresh();
    assert.deepEqual(checked(form), ['standard']);
    host.close();
});

test('picking: sets the switches through the store, redraws them, tells the change, says the one-slower-reply note once; presets:false stays', async () => {
    const { host, form, changes } = await page({ host: { settings: { features: { [CORE_FEATURE.extractor]: true } } } });
    const switchOf = id => form.field(id).handle.get();
    pick(form, 'lean');
    assert.deepEqual(checked(form), ['lean']);
    assert.deepEqual([CORE_FEATURE.weather, CORE_FEATURE.you, CORE_FEATURE.mounts, 'story-block.loot', CORE_FEATURE.choices, CORE_FEATURE.chatter].map(switchOf), [false, false, false, false, false, false]);
    assert.equal(host.sdk.feature(CORE_FEATURE.weather), false, 'stored through the feature store, not only drawn');
    assert.equal(switchOf(CORE_FEATURE.extractor), true, 'presets:false: left as the reader set it');
    assert.equal(switchOf(CORE_FEATURE.hud), true);
    assert.deepEqual(changes.map(change => change.id).sort(), [CORE_FEATURE.weather, CORE_FEATURE.you, CORE_FEATURE.mounts, 'story-block.loot'].sort(), 'each switch that moved, told as any switch is');
    assert.equal(said(form), PROMPT_HINT, 'the fixed prompt changed: the usual note, once');
    assert.equal(form.el.querySelectorAll('.ss-preset-said').length, 1);

    pick(form, 'full');
    assert.deepEqual(checked(form), ['full']);
    assert.deepEqual([CORE_FEATURE.weather, CORE_FEATURE.choices, CORE_FEATURE.chatter].map(switchOf), [true, true, true]);
    assert.equal(said(form), PROMPT_HINT);
    // The group counts follow the switches.
    assert.match(form.group('story-block').querySelector('.ss-section-hint').textContent, /^\d+ of 14 on$/);

    // Picking the preset that already holds changes nothing and clears the note.
    changes.length = 0;
    pick(form, 'full');
    assert.deepEqual(changes, []);
    assert.equal(said(form), '');
    // The note goes with the next switch the reader flips by hand (it has its own hint).
    pick(form, 'standard');
    assert.equal(said(form), PROMPT_HINT);
    form.field(CORE_FEATURE.weather).tile.querySelector('.ss-switch').click();
    assert.equal(said(form), '');
    host.close();
});

test('from Custom, picking Standard turns the odd switch back and says the fixed prompt changed', async () => {
    const { host, form } = await page({ host: { settings: { features: { [CORE_FEATURE.weather]: false } } } });
    // Weather is off here, so Standard (weather on) is not what holds: Lean is not either (look and the rest are on).
    assert.deepEqual(checked(form), []);
    pick(form, 'standard');
    assert.deepEqual(checked(form), ['standard']);
    assert.equal(said(form), PROMPT_HINT, 'weather owns a grammar line: it is the fixed prompt');
    host.close();
});

test('keys: arrows, Home and End move the focus between the tiles; only Space, Enter or a click picks', async () => {
    const { host, form } = await page();
    const all = tiles(form);
    all[1].focus();
    let event = all[1].dispatch('keydown', { key: 'ArrowRight' });
    assert.ok(event.defaultPrevented);
    assert.equal(doc.activeElement, all[2]);
    all[2].dispatch('keydown', { key: 'ArrowRight' });
    assert.equal(doc.activeElement, all[0], 'wraps');
    all[0].dispatch('keydown', { key: 'ArrowLeft' });
    assert.equal(doc.activeElement, all[2]);
    all[2].dispatch('keydown', { key: 'Home' });
    assert.equal(doc.activeElement, all[0]);
    all[0].dispatch('keydown', { key: 'End' });
    assert.equal(doc.activeElement, all[2]);
    event = all[2].dispatch('keydown', { key: 'a' });
    assert.equal(event.defaultPrevented, false);
    assert.deepEqual(checked(form), ['standard'], 'moving the focus changed no switch');
    assert.equal(host.sdk.feature(CORE_FEATURE.weather), true);
    host.close();
});

test('the token numbers: each tile says what the fixed prompt weighs under it, from the static text built for that preset, nothing switched', async () => {
    const { host, form } = await page();
    const sizes = () => tiles(form).map(tile => tile.querySelector('.ss-preset-size'));
    const list = host.features.list();
    const expected = Object.fromEntries(['lean', 'standard', 'full'].map(name => {
        const switches = new Map(list.filter(feature => feature.presets !== false && feature.available !== false).map(feature => [feature.id, name === 'standard' ? feature.default : (feature.presets?.[name] ?? feature.default)]));
        return [name, estimateTokens(staticTextWith(host.registry, switches))];
    }));
    assert.ok(expected.lean < expected.standard && expected.standard < expected.full, JSON.stringify(expected));
    assert.deepEqual(sizes().map(size => size.hidden), [false, false, false]);
    assert.deepEqual(sizes().map(size => size.textContent), ['lean', 'standard', 'full'].map(name => `≈ ${expected[name].toLocaleString('en-US')} tokens of rules each reply`));
    // Counting changed nothing.
    assert.equal(host.sdk.feature(CORE_FEATURE.weather), true);
    assert.equal(host.sdk.feature(CORE_FEATURE.choices), false);
    // Picking Full does not change the numbers of the tiles: they are what each preset weighs, not what is on now.
    pick(form, 'full');
    assert.deepEqual(sizes().map(size => size.textContent), ['lean', 'standard', 'full'].map(name => `≈ ${expected[name].toLocaleString('en-US')} tokens of rules each reply`));
    host.close();
});

test('the token numbers: the tokenizer\'s own count replaces the estimate when it answers; a number that cannot be counted is left out', async () => {
    const counted = [];
    const { host, form } = await page({ form: { countTokens: async text => { counted.push(text); return text.length; } } });
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(counted.length, 3, 'once for each distinct text');
    assert.deepEqual(tiles(form).map(tile => tile.querySelector('.ss-preset-num').textContent), counted.map(text => `≈ ${text.length.toLocaleString('en-US')}`));
    host.close();

    // No way to build the text: no number, no empty promise on the tile.
    const bare = await page({ form: { staticText: () => null } });
    assert.deepEqual(tiles(bare.form).map(tile => tile.querySelector('.ss-preset-size').hidden), [true, true, true]);
    assert.deepEqual(tiles(bare.form).map(tile => tile.querySelector('.ss-preset-size').textContent), ['', '', '']);
    bare.host.close();
    const none = renderFeaturesForm(null, { features: (await page()).host.features, doc });
    assert.deepEqual(tiles(none).map(tile => tile.querySelector('.ss-preset-size').hidden), [true, true, true], 'no staticText option: the number is left out');
});

test('the search hides the picker (it counts tiles of switches), the end of it brings it back; disabled locks the tiles; no features: no picker', async () => {
    const { host, form } = await page();
    const block = form.el.querySelector('.ss-preset');
    const fine = form.el.querySelector('.ss-preset-fine');
    assert.equal(block.hidden, false);
    form.filter('weather');
    assert.equal(block.hidden, true);
    assert.equal(fine.hidden, true);
    form.filter('');
    assert.equal(block.hidden, false);
    assert.equal(fine.hidden, false);
    form.setDisabled(true);
    assert.ok(tiles(form).every(tile => tile.disabled));
    pick(form, 'lean');
    assert.deepEqual(checked(form), ['standard'], 'a disabled form picks nothing');
    form.setDisabled(false);
    assert.ok(tiles(form).every(tile => !tile.disabled));
    host.close();
    const empty = renderFeaturesForm(null, { features: null, doc });
    assert.equal(empty.el.querySelector('.ss-preset').hidden, true);
    assert.equal(empty.el.querySelector('.ss-preset-fine').hidden, true);
});

test('modules without `presets` keys follow their default in all three presets: the picker leaves their switches where they are', async () => {
    const plain = { id: 'plainmod', name: 'Plain', version: '0.0.1', features: [{ id: 'plainmod.x', label: 'X', default: true }, { id: 'plainmod.y', label: 'Y', default: false }] };
    const { host, form } = await page({ host: { modules: [plain] } });
    assert.deepEqual(checked(form), ['standard']);
    for (const name of ['lean', 'full', 'standard']) {
        pick(form, name);
        assert.deepEqual([form.field('plainmod.x').handle.get(), form.field('plainmod.y').handle.get()], [true, false], name);
        assert.deepEqual(checked(form), [name]);
    }
    host.close();
});
