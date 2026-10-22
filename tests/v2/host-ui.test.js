// The settings overlay host and the tab host (docs/v2/SPEC.md §6) on the repo's fake DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../ui-fake-dom.js';
import { createRegistry } from '../../src/v2/registry.js';
import { createSettings } from '../../src/v2/sdk.js';
import { readFileSync } from 'node:fs';
import { FEATURES_FOLD, OPEN_CLASS, PACKS_FOLD, SETTINGS_TEXT, SUB_FOLD, createTabHost, emptyValue, featuresFoldOf, groupFields, linesToList, listTextFields, listToLines, openSettingsOverlay, promptSize, readInt, renderSettingsHost } from '../../src/v2/host-ui.js';
import { createCoreModule } from '../../src/v2/domains/index.js';
import { packsFor } from '../../src/v2/runtime.js';
import { estimateTokens } from '../../src/v2/prompt.js';
import { createPacksHintWidget } from '../../src/v2/screens/packs-hint.js';
import { STRINGS } from '../../src/v2/strings.js';

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
    assert.deepEqual(root.querySelectorAll('details.story-suite-fold').map(fold => fold.dataset.fold), ['story-suite', 'aaa', 'rpg-battle', 'story-suite-versions'], 'Versions last');
    assert.deepEqual(root.querySelectorAll('details.story-suite-fold > summary b').map(node => node.textContent), ['Story Suite', 'AAA', 'RPG Battle', 'Versions']);
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

test('a section given as a title and render(el, api) is drawn the same way, under that title', () => {
    const { registry, settings, es } = setup({ id: 'rb', name: 'RPG Battle', settings: { section: 'Combat', defaults: { speed: 2 }, render(el, api) { el.textContent = `Speed ${api.get('speed')}`; api.set('speed', 3); } } });
    const root = doc.createElement('div');
    renderSettingsHost(root, { registry, settings, doc });
    const fold = root.querySelectorAll('details.story-suite-fold')[1];
    assert.deepEqual(fold.querySelectorAll(':scope > summary > *').map(node => node.textContent), ['RPG Battle', 'Combat']);
    assert.deepEqual(fold.querySelectorAll('.story-suite-subfold > summary b').map(node => node.textContent), ['Combat'], 'the panel in a sub-fold under that title');
    assert.equal(fold.querySelector('.story-suite-section').textContent, 'Speed 2');
    assert.equal(es.storySuite.modules.rb.speed, 3);
});

test('refresh redraws and keeps the open folds open', () => {
    const { registry, settings } = setup(rpg());
    const root = doc.createElement('div');
    const host = renderSettingsHost(root, { registry, settings, doc });
    root.querySelectorAll('details.story-suite-fold')[1].open = true;
    settings.set('rpg-battle', 'title', 'Changed');
    host.refresh();
    const folds = root.querySelectorAll('details.story-suite-fold');
    assert.deepEqual(folds.map(fold => fold.open), [false, true, false]);
    assert.equal(row(root, 'rpg-battle', 'title').querySelector('input').value, 'Changed');
});

test('the overlay opens on the body, marks it, and closes', () => {
    const { registry, settings } = setup(rpg());
    const overlay = openSettingsOverlay({ registry, settings, doc });
    assert.ok(doc.body.classList.contains(OPEN_CLASS));
    assert.equal(doc.querySelectorAll('#story_suite_v2_overlay').length, 1);
    assert.equal(overlay.root.querySelectorAll('details.story-suite-fold').length, 3);
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

// ---- the settings layout after the first live test (folds, groups, lists, Packs, prompt size) ----------

const topFolds = root => root.children.filter(node => node.classList.contains('story-suite-fold'));
const subFolds = fold => fold.querySelector('.story-suite-fold-body').children.filter(node => node.classList.contains('story-suite-subfold'));
const foldAt = (root, key) => root.querySelectorAll('details.story-suite-fold, details.story-suite-subfold').find(node => node.dataset.fold === key);

// Story Director's settings as its module.js flattens them (labels "Calendar: …"), plus a `group` field.
const director = () => ({
    id: 'story-director',
    name: 'Story Director',
    settings: {
        defaults: { 'tracker.calendar.months': [{ name: 'January', days: 31 }, { name: 'February', days: 28 }] },
        schema: {
            'tracker.calendar.preset': { type: 'choice', label: 'Calendar: Calendar', options: ['pack', 'gregorian'] },
            'tracker.calendar.era': { type: 'text', label: 'Calendar: Era (written before the year)' },
            'tracker.calendar.months': { type: 'list', label: 'Calendar: Months', of: { name: { type: 'text', label: 'Name' }, days: { type: 'int', label: 'Days', min: 1, max: 400 } } },
            'tracker.dormantReplies': { type: 'int', label: 'Quiet after replies', min: 1, max: 500 },
            'quests.offerCooldown': { type: 'int', label: 'Replies between offers', group: 'Quests' },
            'money.scale': { type: 'text', label: 'Money scale (0: the pack\'s)' },
        },
    },
});

test('folds: the top folds are the root\'s own children, each a summary and a body; sub-folds are another class', () => {
    const { registry, settings } = setup(rpg(), director());
    const root = doc.createElement('div');
    renderSettingsHost(root, { registry, settings, doc });
    assert.ok(root.classList.contains('story-suite-folds'));
    assert.deepEqual(topFolds(root).map(node => node.dataset.fold), ['story-suite', 'rpg-battle', 'story-director', 'story-suite-versions']);
    for (const fold of topFolds(root)) {
        assert.equal(fold.tagName, 'DETAILS');
        assert.deepEqual(fold.children.map(node => node.tagName), ['SUMMARY', 'DIV'], 'a summary row, then the body');
        assert.equal(fold.open, false, 'closed until the reader opens one');
    }
    // Opening one changes nothing about the others (the squashed-bars bug was CSS; the DOM stays flat).
    topFolds(root)[2].open = true;
    assert.deepEqual(topFolds(root).map(node => node.children.length), [2, 2, 2, 2]);
    assert.equal(root.querySelectorAll('details.story-suite-fold').length, 4, 'sub-folds are not .story-suite-fold');
    assert.ok(root.querySelectorAll('details.story-suite-subfold').length > 0);
});

test('folds: host.css gives them a summary row with a chevron, no fixed heights, and a scrolling overlay', () => {
    const css = readFileSync(new URL('../../src/v2/view/host.css', import.meta.url), 'utf8');
    const rule = selector => {
        const at = css.indexOf(`${selector} {`);
        assert.ok(at >= 0, `${selector} has a rule`);
        return css.slice(at, css.indexOf('}', at));
    };
    assert.match(rule('.story-suite-folds > *'), /flex: none/, 'a closed fold never shrinks');
    assert.match(css, /\.story-suite-fold > summary, \.story-suite-subfold > summary \{[^}]*min-height: 44px/);
    assert.match(css, /summary::before, \.story-suite-subfold > summary::before \{[^}]*border-right/, 'the chevron');
    assert.match(css, /\[open\] > summary::before[^{]*\{ transform: rotate\(45deg\); \}/);
    const scroll = rule('.story-suite-scroll');
    assert.match(scroll, /overflow-y: auto/);
    assert.match(scroll, /min-height: 0/);
    assert.match(rule('.story-suite-overlay .story-suite-panel'), /max-width: 760px/);
    assert.match(rule('.story-suite-overlay'), /height: 100dvh/);
    // No fixed heights or negative margins on any settings fold or row.
    const settingsCss = css.slice(css.indexOf('/* ---- the settings overlay'), css.indexOf('.story-suite-drawer-buttons'));
    assert.doesNotMatch(settingsCss, /margin[^;]*:\s*-\d/);
    const heights = [...settingsCss.matchAll(/(?<![-\w])height:\s*(\d+px)/g)].map(match => match[1]);
    assert.deepEqual([...new Set(heights)].sort(), ['32px', '7px', '8px'], 'fixed heights only on the chevron, the × and the meter; folds and rows have none');
    // On a phone the rows stack.
    assert.match(css, /@media \(max-width: 560px\) \{\s*\.story-suite-row \{ grid-template-columns: minmax\(0, 1fr\);/);
});

test('groups: a field\'s `group`, else its label\'s "X: …" prefix, else General; in the order they first appear', () => {
    const groups = groupFields(director().settings.schema);
    assert.deepEqual(groups.map(group => group.name), ['Calendar', SETTINGS_TEXT.general, 'Quests']);
    assert.deepEqual(groups[0].fields.map(({ field }) => field.label), ['Calendar', 'Era (written before the year)', 'Months'], 'the prefix comes off the label');
    assert.deepEqual(groups[1].fields.map(({ key }) => key), ['tracker.dormantReplies', 'money.scale'], 'a colon inside brackets is no prefix');
    assert.equal(groups[1].fields[1].field.label, 'Money scale (0: the pack\'s)');
    assert.deepEqual(groupFields({ a: { type: 'int', label: 'Pace: Speed', group: 'Pace' }, b: { type: 'bool', label: 'Hard: mode', group: 'Pace' }, c: 'text' }),
        [{ name: 'Pace', fields: [{ key: 'a', field: { type: 'int', label: 'Speed', group: 'Pace' } }, { key: 'b', field: { type: 'bool', label: 'Hard: mode', group: 'Pace' } }] }, { name: 'General', fields: [{ key: 'c', field: 'text' }] }],
        'a group\'s own name comes off its labels; another prefix stays');

    const { registry, settings } = setup(director());
    const root = doc.createElement('div');
    renderSettingsHost(root, { registry, settings, doc });
    const fold = foldAt(root, 'story-director');
    assert.deepEqual(subFolds(fold).map(node => node.dataset.fold), ['story-director::group:Calendar', 'story-director::group:General', 'story-director::group:Quests']);
    assert.deepEqual(subFolds(fold).map(node => node.querySelector('summary b').textContent), ['Calendar', 'General', 'Quests']);
    assert.deepEqual(subFolds(fold).map(node => node.querySelector('summary small').textContent), ['3 settings', '2 settings', '1 setting']);
    assert.deepEqual(subFolds(fold).map(node => node.open), [false, false, false], 'several groups: all closed');
    const calendar = subFolds(fold)[0];
    assert.deepEqual(calendar.querySelectorAll('.story-suite-row > span > b').map(node => node.textContent), ['Calendar', 'Era (written before the year)', 'Months']);
    // The stored keys are the schema's, whatever the label shows.
    const era = calendar.querySelector('.story-suite-row[data-field="tracker.calendar.era"] input');
    era.value = 'AE';
    change(era);
    assert.equal(settings('story-director')['tracker.calendar.era'], 'AE');
    // One group alone (and no features): it opens with its module.
    const single = setup(rpg());
    const only = doc.createElement('div');
    renderSettingsHost(only, { registry: single.registry, settings: single.settings, doc });
    assert.deepEqual(subFolds(foldAt(only, 'rpg-battle')).map(node => [node.dataset.fold, node.open]), [[`rpg-battle${SUB_FOLD}group:General`, true]]);
});

test('labels left, controls right: each row is a label tied to its control; a list\'s group is named by its label', () => {
    const { registry, settings } = setup(director());
    const root = doc.createElement('div');
    renderSettingsHost(root, { registry, settings, doc });
    for (const row of root.querySelectorAll('.story-suite-row').filter(node => node.dataset.type !== 'list')) {
        assert.equal(row.tagName, 'LABEL');
        assert.equal(row.getAttribute('for'), row.querySelector('input, select, textarea').id);
    }
    const months = root.querySelector('.story-suite-row[data-field="tracker.calendar.months"]');
    assert.equal(months.dataset.type, 'list');
    const list = months.querySelector('.story-suite-list');
    assert.equal(list.getAttribute('role'), 'group');
    assert.equal(root.querySelectorAll(`#${list.getAttribute('aria-labelledby')}`)[0].textContent, 'Months');
});

test('a list is compact: one line per item with its fields inline, a small × named for the item, Add at the end', () => {
    const { registry, settings } = setup(director());
    const root = doc.createElement('div');
    doc.body.appendChild(root);
    renderSettingsHost(root, { registry, settings, doc });
    const list = root.querySelector('.story-suite-row[data-field="tracker.calendar.months"] .story-suite-list');
    const items = () => list.querySelectorAll('.story-suite-list-item');
    assert.deepEqual(list.children.map(node => node.className.split(' ').at(-1)), ['story-suite-list-head', 'story-suite-list-item', 'story-suite-list-item', 'story-suite-list-foot']);
    assert.deepEqual(list.querySelector('.story-suite-list-foot').children.map(node => node.className.split(' ').at(-1)), ['story-suite-list-add', 'story-suite-list-toggle'], 'Add, then Edit as text');
    assert.deepEqual(list.querySelectorAll('.story-suite-list-head .story-suite-list-cell').map(node => node.textContent), ['Name', 'Days']);
    assert.equal(list.querySelector('.story-suite-list-head').getAttribute('aria-hidden'), 'true');
    const [first] = items();
    // [January ] [31] × — no rows, labels or Remove words inside an item.
    assert.deepEqual(first.children.map(node => node.className), ['story-suite-list-cell', 'story-suite-list-cell', 'menu_button story-suite-list-remove']);
    assert.equal(first.querySelector('.story-suite-row'), null);
    assert.deepEqual(first.querySelectorAll('input').map(input => [input.value, input.type, input.getAttribute('aria-label')]), [['January', 'text', 'Name, item 1'], ['31', 'number', 'Days, item 1']]);
    const remove = first.querySelector('.story-suite-list-remove');
    assert.equal(remove.tagName, 'BUTTON');
    assert.equal(remove.type, 'button');
    assert.equal(remove.getAttribute('aria-label'), 'Remove January');
    assert.equal(remove.textContent, '×');
    const add = list.querySelector('.story-suite-list-add');
    assert.equal(add.textContent, 'Add');
    assert.equal(add.getAttribute('aria-label'), 'Add to Months', 'its name starts with what it says');
    // Add: a new empty line, the focus in its first field.
    add.click();
    assert.equal(items().length, 3);
    assert.deepEqual(settings('story-director')['tracker.calendar.months'], [{ name: 'January', days: 31 }, { name: 'February', days: 28 }, { name: '', days: 1 }]);
    assert.ok(doc.activeElement === items()[2].querySelector('input'));
    assert.equal(items()[2].querySelector('.story-suite-list-remove').getAttribute('aria-label'), 'Remove item 3');
    const name = items()[2].querySelector('[data-field="name"] input');
    name.value = 'March';
    change(name);
    const days = items()[2].querySelector('[data-field="days"] input');
    days.value = '31';
    change(days);
    assert.deepEqual(settings('story-director')['tracker.calendar.months'][2], { name: 'March', days: 31 });
    // Remove: that line goes, the focus moves to the next ×, then to Add when none is left after it.
    items()[0].querySelector('.story-suite-list-remove').click();
    assert.deepEqual(settings('story-director')['tracker.calendar.months'].map(month => month.name), ['February', 'March']);
    assert.ok(doc.activeElement === items()[0].querySelector('.story-suite-list-remove'));
    items()[1].querySelector('.story-suite-list-remove').click();
    items()[0].querySelector('.story-suite-list-remove').click();
    assert.deepEqual(settings('story-director')['tracker.calendar.months'], []);
    assert.ok(doc.activeElement === list.querySelector('.story-suite-list-add'));
    assert.equal(list.querySelector('.story-suite-list-head'), null, 'no heads over an empty list');
    root.remove();
});

test('Packs: its own fold second, after Story Suite, titled Packs with "import a pack", even with no pack installed', () => {
    const ctx = { extensionSettings: {} };
    const core = createCoreModule({ packs: packsFor(ctx) });
    const { registry: reg, settings } = setup(core, director(), rpg());
    const root = doc.createElement('div');
    renderSettingsHost(root, { registry: reg, settings, doc });
    assert.deepEqual(topFolds(root).map(node => node.dataset.fold), ['story-suite', PACKS_FOLD, 'rpg-battle', 'story-block', 'story-director', 'story-suite-versions']);
    const packs = foldAt(root, PACKS_FOLD);
    assert.deepEqual(packs.querySelectorAll(':scope > summary > *').map(node => node.textContent), ['Packs', 'import a pack']);
    assert.equal(packs.querySelector('.ss-packs-import').textContent.trim(), 'Import pack file');
    assert.equal(packs.querySelector('.ss-packs-empty').textContent, 'No packs installed.');
    assert.equal(foldAt(root, 'story-block').querySelector('.ss-packs-import'), null, 'not drawn twice: Story Block\'s own fold keeps Events and Assist');
    assert.ok(foldAt(root, 'story-block').querySelectorAll('.story-suite-subsection > h4').map(node => node.textContent).includes('Events'));
    // Any subset of modules: without Story Block's core there is no Packs fold, and nothing breaks.
    const alone = setup(director());
    const bare = doc.createElement('div');
    renderSettingsHost(bare, { registry: alone.registry, settings: alone.settings, doc });
    assert.deepEqual(topFolds(bare).map(node => node.dataset.fold), ['story-suite', 'story-director', 'story-suite-versions']);
    // A module's own fold is checked when it registers.
    const bad = createRegistry();
    assert.throws(() => bad.register({ id: 'odd', settings: { folds: [{ id: 'X Y', title: '', render: 'no' }] } }), /settings fold 1 has no usable id/);
});

test('prompt size: per module and in all, against the tail budget, "about N tokens" at four characters a token', () => {
    const parts = [
        { module: 'story-suite', place: 'static', text: 'x'.repeat(400) },
        { module: 'rpg-battle', place: 'static', text: 'y'.repeat(80) },
        { module: 'story-suite', place: 'tail', text: '[Happened]\nA wolf ran off.' },
        { module: 'rpg-battle', place: 'tail', text: 'z'.repeat(203) },
    ];
    let calls = 0;
    const { registry, settings } = setup(rpg());
    settings.set(null, 'tailBudget', 900);
    const root = doc.createElement('div');
    renderSettingsHost(root, { registry, settings, doc, promptParts: () => { calls += 1; return parts; } });
    const size = foldAt(root, 'story-suite').querySelector('.story-suite-size');
    assert.equal(size.dataset.exact, 'false');
    const sums = () => size.querySelectorAll('.story-suite-size-sum > li').map(li => li.querySelector('b').textContent);
    const stat = estimateTokens(`${'x'.repeat(400)}\n\n${'y'.repeat(80)}`);
    const tail = estimateTokens(`[Happened]\nA wolf ran off.\n${'z'.repeat(203)}`);
    assert.deepEqual(sums(), [`about ${stat} tokens`, `about ${tail} tokens of 900`, `about ${stat + tail} tokens`]);
    assert.equal(size.querySelector('meter').max, 900);
    assert.equal(size.querySelector('meter').value, tail);
    assert.deepEqual(size.querySelectorAll('tbody tr').map(tr => [tr.querySelector('th').textContent, ...tr.querySelectorAll('td').map(td => td.textContent)]),
        [['Story Suite', '100', String(estimateTokens('[Happened]\nA wolf ran off.'))], ['RPG Battle', '20', '51']]);
    assert.match(size.querySelector('.story-suite-size-how').textContent, /four characters a token/);
    // The budget follows the setting at once.
    const budget = root.querySelector('.story-suite-row[data-field="tailBudget"] input');
    budget.value = '1200';
    change(budget);
    assert.equal(sums()[1], `about ${tail} tokens of 1,200`);
    assert.equal(calls, 2, 'built again on demand, nothing kept or sent');
    // promptSize alone, and no chat (nothing to build): a line instead of numbers.
    assert.deepEqual(promptSize(parts, { budget: 5 }), { modules: [{ id: 'story-suite', name: 'story-suite', static: 100, tail: estimateTokens('[Happened]\nA wolf ran off.') }, { id: 'rpg-battle', name: 'rpg-battle', static: 20, tail: 51 }], static: stat, tail, total: stat + tail, budget: 5 });
    const none = doc.createElement('div');
    renderSettingsHost(none, { registry, settings, doc, promptParts: () => { throw new Error('no chat'); } });
    assert.equal(none.querySelector('.story-suite-size p').textContent, SETTINGS_TEXT.size.none);
    const old = doc.createElement('div');
    renderSettingsHost(old, { registry, settings, doc });
    assert.equal(old.querySelector('.story-suite-size'), null, 'no prompt source, no block (an older caller)');
});

test('prompt size: SillyTavern\'s tokenizer when the context has one ("N tokens"); a feature switch counts again', async () => {
    const loot = { id: 'loot', name: 'Loot', features: [{ id: 'loot.weight', label: 'Weight', default: false }] };
    const { registry, settings } = setup(loot);
    const stored = {};
    const features = {
        list: () => [{ id: 'loot.weight', moduleId: 'loot', moduleName: 'Loot', label: 'Weight', on: stored['loot.weight'] === true }],
        set: (id, on) => { stored[id] = on; },
    };
    const tail = () => (stored['loot.weight'] ? 'heavy pack weighs 20' : 'light');
    const counted = [];
    const countTokens = async text => { counted.push(text); return text.split(/\s+/).filter(Boolean).length; };
    const root = doc.createElement('div');
    renderSettingsHost(root, { registry, settings, doc, features, countTokens, promptParts: () => [{ module: 'story-suite', place: 'static', text: 'one two three' }, { module: 'loot', place: 'tail', text: tail() }] });
    const size = () => root.querySelector('.story-suite-size');
    assert.equal(size().dataset.exact, 'false', 'the estimate first');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(size().dataset.exact, 'true');
    const sums = () => size().querySelectorAll('.story-suite-size-sum > li b').map(node => node.textContent);
    assert.deepEqual(sums(), ['3 tokens', '1 tokens of 1,500', '4 tokens']);
    assert.match(size().querySelector('.story-suite-size-how').textContent, /SillyTavern's tokenizer/);
    // The feature flips: everything is drawn again and counted again.
    const input = root.querySelectorAll('.story-suite-feature input').find(node => node.id.includes('overview'));
    input.checked = true;
    input.dispatch('change');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(sums(), ['3 tokens', '4 tokens of 1,500', '7 tokens']);
    assert.ok(counted.includes('heavy pack weighs 20'));
    // A tokenizer that fails leaves the estimate.
    const broken = doc.createElement('div');
    renderSettingsHost(broken, { registry, settings, doc, countTokens: async () => { throw new Error('no tokenizer'); }, promptParts: () => [{ module: 'story-suite', place: 'static', text: 'abcdefgh' }] });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(broken.querySelector('.story-suite-size').dataset.exact, 'false');
    assert.equal(broken.querySelector('.story-suite-size-sum b').textContent, 'about 2 tokens');
});

test('open folds stay open across a redraw, sub-folds too; a closed default-open one stays closed', () => {
    const loot = { id: 'loot', name: 'Loot', features: [{ id: 'loot.weight', label: 'Weight' }], settings: { schema: { a: { type: 'int', label: 'Bag: Size' }, b: { type: 'int', label: 'Shop: Mark-up' } } } };
    const { registry, settings } = setup(loot, director());
    const features = { list: () => [{ id: 'loot.weight', moduleId: 'loot', moduleName: 'Loot', label: 'Weight', on: true }], set() {} };
    const root = doc.createElement('div');
    const host = renderSettingsHost(root, { registry, settings, doc, features });
    const key = part => `loot${SUB_FOLD}${part}`;
    assert.equal(foldAt(root, featuresFoldOf('loot')).open, true, 'the only module with features: its sub-fold of Features opens by default');
    assert.equal(foldAt(root, key('group:Bag')).open, false);
    foldAt(root, 'loot').open = true;
    foldAt(root, featuresFoldOf('loot')).open = false;
    foldAt(root, key('group:Shop')).open = true;
    foldAt(root, 'story-director::group:Calendar').open = true;
    host.refresh();
    assert.deepEqual(['loot', featuresFoldOf('loot'), key('group:Bag'), key('group:Shop'), 'story-director', 'story-director::group:Calendar'].map(fold => foldAt(root, fold).open), [true, false, false, true, false, true]);
    // A real browser's toggle event is remembered too (the overlay reopened keeps it).
    const shop = foldAt(root, key('group:Shop'));
    shop.open = false;
    shop.dispatch('toggle');
    const state = new Map();
    const again = doc.createElement('div');
    renderSettingsHost(again, { registry, settings, doc, features, openState: state });
    foldAt(again, key('group:Bag')).open = true;
    foldAt(again, key('group:Bag')).dispatch('toggle');
    assert.equal(state.get(key('group:Bag')), true);
    const third = doc.createElement('div');
    renderSettingsHost(third, { registry, settings, doc, features, openState: state });
    assert.equal(foldAt(third, key('group:Bag')).open, true, 'another render with the same state');
});

test('the overlay: a header and one scrolling area; Escape closes it and the focus goes back; it can open at a fold', () => {
    const ctx = { extensionSettings: {} };
    const { registry, settings } = setup(createCoreModule({ packs: packsFor(ctx) }), rpg());
    const opener = doc.createElement('button');
    doc.body.appendChild(opener);
    opener.focus();
    // The document's own listeners (the fake one has none): the overlay's focus guard goes there.
    const listeners = [];
    doc.addEventListener = (type, fn) => listeners.push({ type, fn });
    doc.removeEventListener = (type, fn) => { const at = listeners.findIndex(entry => entry.type === type && entry.fn === fn); if (at >= 0) listeners.splice(at, 1); };
    const overlay = openSettingsOverlay({ registry, settings, doc, openState: new Map() });
    assert.equal(overlay.root.getAttribute('aria-modal'), 'true');
    assert.equal(overlay.root.getAttribute('aria-labelledby'), 'story_suite_v2_overlay_title');
    assert.deepEqual(overlay.root.children.map(node => node.className), ['story-suite-overlay-header', 'story-suite-scroll']);
    assert.equal(overlay.root.querySelector('.story-suite-scroll > .story-suite-panel').classList.contains('story-suite-folds'), true);
    assert.ok(doc.activeElement === overlay.root.querySelector('.story-suite-close'), 'the focus starts in the dialog');
    // The page behind cannot take the focus while it is open.
    opener.focus();
    for (const entry of listeners.filter(item => item.type === 'focusin')) entry.fn({ target: opener });
    assert.ok(doc.activeElement === overlay.root.querySelector('.story-suite-close'));
    overlay.root.querySelector('.story-suite-panel').dispatch('keydown', { key: 'Escape' });
    assert.equal(doc.querySelectorAll('#story_suite_v2_overlay').length, 0);
    assert.equal(overlay.isOpen(), false);
    assert.ok(doc.activeElement === opener, 'back where it was');
    // Opened at the Packs fold (Home's "Import a pack"): that fold open, its summary focused.
    const atPacks = openSettingsOverlay({ registry, settings, doc, fold: PACKS_FOLD, openState: new Map() });
    const packs = foldAt(atPacks.root, PACKS_FOLD);
    assert.equal(packs.open, true);
    assert.equal(foldAt(atPacks.root, 'rpg-battle').open, false);
    assert.ok(doc.activeElement === packs.querySelector('summary'));
    // Opening again closes the first one (one overlay, one focus guard).
    const second = openSettingsOverlay({ registry, settings, doc, openState: new Map() });
    assert.equal(atPacks.isOpen(), false);
    assert.equal(doc.querySelectorAll('#story_suite_v2_overlay').length, 1);
    second.close();
    assert.equal(listeners.length, 0, 'every overlay took its focus guard with it');
    opener.remove();
    delete doc.addEventListener;
    delete doc.removeEventListener;
});

test('Home\'s "Import a pack": shown while no pack is installed, opens the settings at Packs, gone with a pack', () => {
    let packs = [];
    let listener = null;
    let opened = 0;
    const widget = createPacksHintWidget({ list: () => packs, subscribe: fn => { listener = fn; return () => { listener = null; }; }, open: () => { opened += 1; } });
    const host = doc.createElement('div');
    const handle = widget.render(host, {}, {});
    const go = host.querySelector('button.sb-packs-import');
    assert.equal(go.textContent, STRINGS.packsHint.import);
    assert.equal(go.type, 'button');
    assert.equal(host.querySelector('.packs-hint').getAttribute('aria-label'), 'Packs');
    go.click();
    assert.equal(opened, 1);
    packs = [{ id: 'ersveil' }];
    listener();
    assert.equal(host.children.length, 0, 'a pack installed: nothing');
    handle.destroy();
    assert.equal(listener, null, 'its listener goes with it');
    // A Story Block that cannot tell (no list): nothing either.
    const unknown = doc.createElement('div');
    createPacksHintWidget({ list: () => null }).render(unknown, {}, {});
    assert.equal(unknown.children.length, 0);
});

test('a real browser\'s querySelectorAll gives a NodeList (no find, no at): the switch, Add and opening at a fold still work', () => {
    const proto = Object.getPrototypeOf(doc.createElement('div'));
    const plain = proto.querySelectorAll;
    // A NodeList: indexable and iterable, with forEach and item, but none of an Array's other methods.
    proto.querySelectorAll = function (selector) {
        const found = plain.call(this, selector);
        const list = { length: found.length, item: at => found[at] ?? null, forEach: fn => found.forEach(fn), [Symbol.iterator]: () => found[Symbol.iterator]() };
        found.forEach((node, at) => { list[at] = node; });
        return list;
    };
    const find = (root, selector, test) => [...root.querySelectorAll(selector)].find(test);
    try {
        const loot = { id: 'loot', name: 'Loot', features: [{ id: 'loot.weight', label: 'Weight' }] };
        const { registry, settings } = setup(loot, director());
        const stored = {};
        const features = { list: () => [{ id: 'loot.weight', moduleId: 'loot', moduleName: 'Loot', label: 'Weight', on: stored['loot.weight'] !== false }], set: (id, on) => { stored[id] = on; } };
        const root = doc.createElement('div');
        doc.body.appendChild(root);
        renderSettingsHost(root, { registry, settings, doc, features });
        const input = find(root, '.story-suite-feature input', node => node.id.includes('overview'));
        input.checked = false;
        input.dispatch('change');
        assert.equal(stored['loot.weight'], false);
        assert.ok(doc.activeElement === find(root, '.story-suite-feature input', node => node.id === input.id), 'the switch keeps the focus');
        find(root, '.story-suite-list-add', () => true).click();
        assert.equal(settings('story-director')['tracker.calendar.months'].length, 3);
        root.remove();
        const overlay = openSettingsOverlay({ registry, settings, doc, features, fold: 'story-director', openState: new Map() });
        assert.ok(doc.activeElement === find(overlay.root, 'details.story-suite-fold', node => node.dataset.fold === 'story-director').querySelector('summary'));
        overlay.close();
    } finally {
        proto.querySelectorAll = plain;
    }
});

// ---- a list's text form (one item per line, fields split by ":") ------------------------------------

const MONTHS = { type: 'list', label: 'Months', of: { name: { type: 'text', label: 'Name' }, days: { type: 'int', label: 'Days', min: 1, max: 400 } } };

test('text form: written one item per line as "Name: Days", read back the same, any number of lines', () => {
    assert.deepEqual(listTextFields(MONTHS).map(([key]) => key), ['name', 'days']);
    assert.equal(listTextFields({ type: 'list', of: { name: 'text', on: 'bool' } }), null, 'a switch in it: rows only');
    assert.equal(listTextFields({ type: 'list', of: { pace: ['slow', 'fast'] } }), null, 'a choice in it: rows only');
    assert.equal(listTextFields({ type: 'int' }), null);
    const months = [{ name: 'Frostmoon', days: 30 }, { name: 'Thaw', days: 28 }];
    assert.equal(listToLines(MONTHS, months), 'Frostmoon: 30\nThaw: 28');
    assert.deepEqual(linesToList(MONTHS, listToLines(MONTHS, months)), { ok: true, items: months });
    // Spaces, blank lines and Windows line ends do not matter; a sign is fine.
    assert.deepEqual(linesToList(MONTHS, '  Frostmoon :30 \r\n\r\n\nThaw:+28\n'), { ok: true, items: months });
    // Any count: none, one, thirteen, the most a list holds.
    assert.deepEqual(linesToList(MONTHS, ''), { ok: true, items: [] });
    assert.deepEqual(linesToList(MONTHS, 'Only: 365').items, [{ name: 'Only', days: 365 }]);
    const thirteen = Array.from({ length: 13 }, (_, at) => ({ name: `Moon ${at + 1}`, days: 28 }));
    assert.deepEqual(linesToList(MONTHS, listToLines(MONTHS, thirteen)).items, thirteen);
    const most = Array.from({ length: 100 }, (_, at) => `M${at}: 10`).join('\n');
    assert.equal(linesToList(MONTHS, most).items.length, 100);
    assert.deepEqual(linesToList(MONTHS, `${most}\nOne more: 10`), { ok: false, line: 101, text: 'One more: 10', error: 'a list holds at most 100 lines.' });
    // A name with colons in it: the list has one text field, so the extra colons are the name's.
    assert.deepEqual(linesToList(MONTHS, 'Day: of Ash: 30').items, [{ name: 'Day: of Ash', days: 30 }]);
    assert.deepEqual(linesToList(MONTHS, listToLines(MONTHS, [{ name: 'Day: of Ash', days: 30 }])).items, [{ name: 'Day: of Ash', days: 30 }]);
    // A line break inside a stored name never makes two lines.
    assert.equal(listToLines(MONTHS, [{ name: 'Two\nlines', days: 3 }]), 'Two lines: 3');
    // A one-field list: the whole line is the value.
    assert.deepEqual(linesToList({ type: 'list', of: { word: 'text' } }, 'a: b\nc').items, [{ word: 'a: b' }, { word: 'c' }]);
});

test('text form: a line that does not read is refused, named by its number and text, with why', () => {
    const bad = (text, line, why) => assert.deepEqual(linesToList(MONTHS, text), { ok: false, line, text: text.split('\n')[line - 1].trim(), error: why });
    bad('Frostmoon: 30\nThaw: 0', 2, 'Days must be at least 1.');
    bad('Frostmoon: -5', 1, 'Days must be at least 1.');
    bad('Frostmoon: 401', 1, 'Days must be at most 400.');
    bad('Frostmoon: thirty', 1, 'Days is not a whole number.');
    bad('Frostmoon: 30.5', 1, 'Days is not a whole number.');
    bad('Frostmoon:', 1, 'Days is not a whole number.');
    bad('A: 1\n\nFrostmoon', 3, 'it needs Name: Days.');
    // Two text fields: extra colons cannot be placed.
    const pairs = { type: 'list', of: { a: { type: 'text', label: 'A' }, b: { type: 'text', label: 'B' } } };
    assert.deepEqual(linesToList(pairs, 'x: y: z'), { ok: false, line: 1, text: 'x: y: z', error: 'it has more than 2 parts split by ":".' });
});

// Story Director's months with `form: 'lines'`, as its schema sets it.
const linesDirector = () => {
    const def = director();
    def.settings.schema['tracker.calendar.months'] = { ...def.settings.schema['tracker.calendar.months'], form: 'lines' };
    return def;
};

test('text form in the settings: `form: \'lines\'` starts as a textarea; it stores on change, refuses a bad line and keeps the list', () => {
    const { registry, settings } = setup(linesDirector());
    const root = doc.createElement('div');
    doc.body.appendChild(root);
    const openState = new Map();
    const host = renderSettingsHost(root, { registry, settings, doc, openState });
    const list = () => root.querySelector('.story-suite-row[data-field="tracker.calendar.months"] .story-suite-list');
    const area = () => list().querySelector('textarea.story-suite-list-text');
    assert.equal(list().dataset.form, 'lines');
    assert.equal(list().querySelector('.story-suite-list-item'), null, 'no rows');
    assert.equal(area().value, 'January: 31\nFebruary: 28');
    // Labelled by the field's label, described by its format.
    const labelId = area().getAttribute('aria-labelledby');
    assert.equal(root.querySelectorAll(`#${labelId}`)[0].textContent, 'Months');
    const help = list().querySelector('.story-suite-list-help');
    assert.equal(area().getAttribute('aria-describedby'), help.id);
    assert.equal(help.textContent, 'One per line, as Name: Days. Any number of lines, up to 100.');
    // Thirteen months of a fantasy calendar.
    const thirteen = Array.from({ length: 13 }, (_, at) => `Moon ${at + 1}: ${at === 12 ? 1 : 28}`).join('\n');
    area().value = `${thirteen}\n`;
    change(area());
    const stored = settings('story-director')['tracker.calendar.months'];
    assert.equal(stored.length, 13);
    assert.deepEqual(stored.at(-1), { name: 'Moon 13', days: 1 });
    assert.equal(area().value, thirteen, 'written back tidy');
    // A bad line: refused with its number, the stored list unchanged, the text left for fixing.
    area().value = 'Frostmoon: 30\nThaw: 0';
    change(area());
    const error = list().querySelector('.story-suite-list-error');
    assert.equal(error.hidden, false);
    assert.equal(error.getAttribute('role'), 'alert');
    assert.equal(error.textContent, 'Line 2 ("Thaw: 0"): Days must be at least 1. The list is kept as it was until every line reads.');
    assert.equal(area().getAttribute('aria-invalid'), 'true');
    assert.equal(area().getAttribute('aria-describedby'), `${help.id} ${error.id}`);
    assert.equal(settings('story-director')['tracker.calendar.months'].length, 13, 'the old value is kept');
    assert.equal(area().value, 'Frostmoon: 30\nThaw: 0');
    // Edit as rows refuses to leave while a line does not read.
    list().querySelector('.story-suite-list-toggle').click();
    assert.equal(list().dataset.form, 'lines');
    assert.ok(doc.activeElement === area());
    area().value = 'Frostmoon: 30\nThaw: 29';
    change(area());
    assert.equal(error.hidden, true);
    assert.equal(area().getAttribute('aria-invalid'), null);
    assert.deepEqual(settings('story-director')['tracker.calendar.months'], [{ name: 'Frostmoon', days: 30 }, { name: 'Thaw', days: 29 }]);
    // Negative and non-number days too.
    for (const line of ['Thaw: -3', 'Thaw: many']) {
        area().value = line;
        change(area());
        assert.equal(list().querySelector('.story-suite-list-error').hidden, false, line);
        assert.equal(settings('story-director')['tracker.calendar.months'].length, 2, line);
    }
    area().value = 'Frostmoon: 30\nThaw: 29';
    change(area());
    // Edit as rows: the rows of what was stored, the toggle keeps the focus; the choice outlives a redraw.
    const toText = list().querySelector('.story-suite-list-toggle');
    assert.equal(toText.textContent, 'Edit as rows');
    assert.equal(toText.getAttribute('aria-label'), 'Edit Months as rows');
    toText.click();
    assert.equal(list().dataset.form, 'rows');
    assert.deepEqual(list().querySelectorAll('.story-suite-list-item [data-field="name"] input').map(input => input.value), ['Frostmoon', 'Thaw']);
    assert.ok(doc.activeElement === list().querySelector('.story-suite-list-toggle'));
    assert.equal(list().querySelector('.story-suite-list-toggle').textContent, 'Edit as text');
    host.refresh();
    assert.equal(list().dataset.form, 'rows', 'kept across a redraw');
    list().querySelector('.story-suite-list-toggle').click();
    assert.equal(area().value, 'Frostmoon: 30\nThaw: 29');
    root.remove();
});

test('text form: every list of text and whole numbers has the toggle; others and an unknown `form` keep their rows', () => {
    const odd = {
        id: 'odd', name: 'Odd',
        settings: {
            defaults: { words: [{ word: 'a' }], mixed: [{ name: 'x', on: true }], later: [{ name: 'y', n: 2 }] },
            schema: {
                words: { type: 'list', label: 'Words', of: { word: 'text' } },
                mixed: { type: 'list', label: 'Mixed', of: { name: 'text', on: 'bool' } },
                later: { type: 'list', label: 'Later', form: 'cards', of: { name: 'text', n: 'int' } },
            },
        },
    };
    const { registry, settings } = setup(odd);
    const root = doc.createElement('div');
    renderSettingsHost(root, { registry, settings, doc });
    const list = key => root.querySelector(`.story-suite-row[data-field="${key}"] .story-suite-list`);
    assert.equal(list('mixed').querySelector('.story-suite-list-toggle'), null, 'a switch in it: no text form');
    assert.equal(list('later').dataset.form, 'rows', 'a `form` this Story Block does not know is ignored');
    assert.ok(list('later').querySelector('.story-suite-list-toggle'));
    list('words').querySelector('.story-suite-list-toggle').click();
    const area = list('words').querySelector('textarea');
    area.value = 'one\ntwo: three\n\nfour';
    change(area);
    assert.deepEqual(settings('odd').words, [{ word: 'one' }, { word: 'two: three' }, { word: 'four' }]);
    // The rows' own Add still works after going back.
    list('words').querySelector('.story-suite-list-toggle').click();
    list('words').querySelector('.story-suite-list-add').click();
    assert.equal(settings('odd').words.length, 4);
});
