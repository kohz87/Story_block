// The settings overlay host and the tab host (docs/v2/SPEC.md §6) on the repo's fake DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../ui-fake-dom.js';
import { createRegistry } from '../../src/v2/registry.js';
import { createSettings } from '../../src/v2/sdk.js';
import { OPEN_CLASS, createTabHost, emptyValue, openSettingsOverlay, readInt, renderSettingsHost } from '../../src/v2/host-ui.js';

const doc = installFakeDom();

function setup(...defs) {
    const registry = createRegistry();
    for (const def of defs) registry.register(def);
    const es = {};
    let saves = 0;
    const settings = createSettings({ root: () => es, registry, save: () => { saves += 1; } });
    return { registry, es, settings, saves: () => saves };
}

const rpg = () => ({
    id: 'rpg-battle',
    name: 'RPG Battle',
    settings: {
        defaults: { hardMode: false, level: 5, pace: 'normal', title: 'Hero', coins: [{ name: 'silver', rate: 10 }] },
        schema: {
            hardMode: { type: 'bool', label: 'Hard mode', help: 'Foes hit harder.' },
            level: { type: 'int', min: 1, max: 30 },
            pace: ['slow', 'normal', { value: 'fast', label: 'Fast!' }],
            title: 'text',
            coins: { type: 'list', of: { name: 'text', rate: { type: 'int', min: 1 } } },
        },
    },
});
const row = (root, module, key) => root.querySelectorAll('details.story-suite-fold')
    .find(fold => fold.dataset.fold === module).querySelector(`.story-suite-row[data-field="${key}"]`);
const change = node => node.dispatch('change');

test('a fold per module with settings, after the host\'s own; fields render with their stored values', () => {
    const { registry, settings } = setup(rpg(), { id: 'quiet-mod' }, { id: 'aaa', name: 'AAA', settings: { schema: { on: 'bool' } } });
    const root = doc.createElement('div');
    renderSettingsHost(root, { registry, settings, doc });
    assert.deepEqual(root.querySelectorAll('details.story-suite-fold').map(fold => fold.dataset.fold), ['story-suite', 'aaa', 'rpg-battle']);
    assert.deepEqual(root.querySelectorAll('details.story-suite-fold summary b').map(node => node.textContent), ['Story Suite', 'AAA', 'RPG Battle']);
    const hard = row(root, 'rpg-battle', 'hardMode');
    assert.equal(hard.querySelector('b').textContent, 'Hard mode');
    assert.equal(hard.querySelector('small').textContent, 'Foes hit harder.');
    assert.equal(hard.querySelector('input').type, 'checkbox');
    assert.equal(hard.querySelector('input').checked, false);
    assert.equal(row(root, 'rpg-battle', 'level').querySelector('b').textContent, 'Level');
    assert.equal(row(root, 'rpg-battle', 'level').querySelector('input').value, '5');
    assert.equal(row(root, 'rpg-battle', 'level').querySelector('input').min, '1');
    const pace = row(root, 'rpg-battle', 'pace').querySelector('select');
    assert.deepEqual(pace.querySelectorAll('option').map(node => [node.value, node.textContent]), [['slow', 'slow'], ['normal', 'normal'], ['fast', 'Fast!']]);
    assert.equal(pace.value, 'normal');
    assert.equal(row(root, 'rpg-battle', 'title').querySelector('input').value, 'Hero');
    assert.equal(row(root, 'story-suite', 'tailBudget').querySelector('input').value, '1500');
});

test('changes are stored under extension_settings.storySuite.modules[id], ints kept whole and in range', () => {
    const { registry, settings, es, saves } = setup(rpg());
    const root = doc.createElement('div');
    renderSettingsHost(root, { registry, settings, doc });
    const hard = row(root, 'rpg-battle', 'hardMode').querySelector('input');
    hard.checked = true;
    change(hard);
    const level = row(root, 'rpg-battle', 'level').querySelector('input');
    level.value = '99';
    change(level);
    assert.equal(level.value, '30', 'kept inside max');
    level.value = 'many';
    change(level);
    assert.equal(level.value, '30', 'not a number: the stored value is shown again');
    const pace = row(root, 'rpg-battle', 'pace').querySelector('select');
    pace.value = 'fast';
    change(pace);
    const title = row(root, 'rpg-battle', 'title').querySelector('input');
    title.value = 'Wanderer';
    change(title);
    const budget = row(root, 'story-suite', 'tailBudget').querySelector('input');
    budget.value = '800.4';
    change(budget);
    assert.deepEqual(es.storySuite.modules['rpg-battle'], { hardMode: true, level: 30, pace: 'fast', title: 'Wanderer' });
    assert.deepEqual(es.storySuite.host, { tailBudget: 800 });
    assert.equal(saves(), 5);
});

test('a list of {…}: a row per item, Add and Remove', () => {
    const { registry, settings, es } = setup(rpg());
    const root = doc.createElement('div');
    renderSettingsHost(root, { registry, settings, doc });
    const list = row(root, 'rpg-battle', 'coins');
    const items = () => list.querySelectorAll('.story-suite-list-item');
    assert.equal(items().length, 1);
    assert.equal(items()[0].querySelector('[data-field="name"] input').value, 'silver');
    list.querySelector('.story-suite-list-add').click();
    assert.equal(items().length, 2);
    assert.deepEqual(es.storySuite.modules['rpg-battle'].coins, [{ name: 'silver', rate: 10 }, { name: '', rate: 1 }]);
    const name = items()[1].querySelector('[data-field="name"] input');
    name.value = 'gold';
    change(name);
    assert.deepEqual(es.storySuite.modules['rpg-battle'].coins[1], { name: 'gold', rate: 1 });
    items()[0].querySelector('.story-suite-list-remove').click();
    assert.deepEqual(es.storySuite.modules['rpg-battle'].coins, [{ name: 'gold', rate: 1 }]);
    assert.equal(items().length, 1);
});

test('a module\'s custom section gets its element and a settings api; one that throws shows a line instead', () => {
    let api = null;
    const { registry, settings, es } = setup(
        { id: 'custom', name: 'Custom', settings: { defaults: { colour: 'blue' }, section(el, given) { api = given; el.textContent = `Colour: ${given.get('colour')}`; } } },
        { id: 'broken', name: 'Broken', settings: { section() { throw new Error('no panel'); } } },
    );
    const root = doc.createElement('div');
    renderSettingsHost(root, { registry, settings, doc, sdk: { marker: true } });
    const section = root.querySelectorAll('.story-suite-section');
    assert.equal(section[1].textContent, 'Colour: blue');
    assert.equal(section[0].textContent, 'This part of Broken\'s settings could not be shown: no panel');
    api.set('colour', 'red');
    assert.equal(es.storySuite.modules.custom.colour, 'red');
    assert.deepEqual(api.values(), { colour: 'red' });
    assert.deepEqual(api.sdk, { marker: true });
});

test('refresh redraws and keeps the open folds open', () => {
    const { registry, settings } = setup(rpg());
    const root = doc.createElement('div');
    const host = renderSettingsHost(root, { registry, settings, doc });
    root.querySelectorAll('details.story-suite-fold')[1].open = true;
    settings.set('rpg-battle', 'title', 'Changed');
    host.refresh();
    const folds = root.querySelectorAll('details.story-suite-fold');
    assert.deepEqual(folds.map(fold => fold.open), [false, true]);
    assert.equal(row(root, 'rpg-battle', 'title').querySelector('input').value, 'Changed');
});

test('the overlay opens on the body, marks it, and closes', () => {
    const { registry, settings } = setup(rpg());
    const overlay = openSettingsOverlay({ registry, settings, doc });
    assert.ok(doc.body.classList.contains(OPEN_CLASS));
    assert.equal(doc.querySelectorAll('#story_suite_v2_overlay').length, 1);
    assert.equal(overlay.root.querySelectorAll('details.story-suite-fold').length, 2);
    const again = openSettingsOverlay({ registry, settings, doc });
    assert.equal(doc.querySelectorAll('#story_suite_v2_overlay').length, 1, 'opening again replaces it');
    again.root.querySelector('.story-suite-close').click();
    assert.equal(doc.querySelectorAll('#story_suite_v2_overlay').length, 0);
    assert.ok(!doc.body.classList.contains(OPEN_CLASS));
});

test('the tab host: a button per module tab in module-id order, the chosen one rendered from the view', () => {
    const calls = [];
    const tab = (id, title, icon) => ({ id, title, icon, render(el, view, api) { calls.push([id, view.state.n, api.name]); el.textContent = `${title}: ${view.state.n}`; } });
    const { registry } = setup(
        { id: 'zeta', tabs: [tab('z1', 'Zeta', 'fa-z')] },
        { id: 'alpha', tabs: [tab('a1', 'Alpha One', 'fa-a'), tab('a2', 'Alpha <b>Two</b>')] },
        { id: 'broken', tabs: [{ id: 'b1', title: 'Broken', render() { throw new Error('bad tab'); } }] },
    );
    let n = 1;
    const root = doc.createElement('div');
    const host = createTabHost(root, { registry, view: () => ({ state: { n } }), api: { name: 'sdk' }, doc });
    const buttons = () => root.querySelectorAll('.story-suite-tab');
    assert.deepEqual(buttons().map(node => node.dataset.tabId), ['a1', 'a2', 'b1', 'z1']);
    assert.deepEqual(buttons().map(node => node.textContent), ['Alpha One', 'Alpha <b>Two</b>', 'Broken', 'Zeta']);
    assert.equal(buttons()[0].querySelector('i').className, 'fa-solid fa-a');
    assert.equal(host.active(), 'a1');
    assert.equal(root.querySelector('.story-suite-pane').textContent, 'Alpha One: 1');
    assert.deepEqual(buttons().map(node => node.classList.contains('active')), [true, false, false, false]);
    buttons()[3].click();
    assert.equal(host.active(), 'z1');
    assert.equal(root.querySelector('.story-suite-pane').textContent, 'Zeta: 1');
    n = 2;
    host.refresh();
    assert.equal(root.querySelector('.story-suite-pane').textContent, 'Zeta: 2');
    assert.deepEqual(calls.at(-1), ['z1', 2, 'sdk']);
    host.select('b1');
    assert.equal(root.querySelector('.story-suite-pane').textContent, 'Broken could not be shown: bad tab');
    // No tabs at all: a quiet line.
    const empty = doc.createElement('div');
    createTabHost(empty, { registry: createRegistry(), view: () => ({}), doc });
    assert.equal(empty.querySelector('.story-suite-pane').textContent, 'No module has a tab yet.');
});

test('field helpers', () => {
    assert.equal(emptyValue('bool'), false);
    assert.equal(emptyValue({ type: 'int', min: 3 }), 3);
    assert.equal(emptyValue(['a', 'b']), 'a');
    assert.deepEqual(emptyValue({ type: 'list', of: { a: 'text' } }), []);
    assert.equal(emptyValue('text'), '');
    assert.equal(readInt(' 7 ', {}), 7);
    assert.equal(readInt('2.6', { max: 2 }), 2);
    assert.equal(readInt('-4', { min: 0 }), 0);
    assert.equal(readInt('', {}), null);
    assert.equal(readInt('x', {}), null);
});
