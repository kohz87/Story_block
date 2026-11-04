// How a block draws its values by their shape (BLOCKS-UI): quest cards, a map of numbers, a record of fields, and an entries field read through roles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { createBlockWidgets, BLOCK_WIDGET } from '../../../src/v2/screens/blocks.js';
import { createFieldsWidgets } from '../../../src/v2/screens/block-fields.js';
import { FIELDS_WIDGET } from '../../../src/v2/data-modules/fields-widget.js';
import { setupDom } from '../view/mounts/helpers.js';
import { success } from '../data-modules/helpers.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const classes = node => node.className.split(/\s+/);
const has = (node, name) => classes(node).includes(name);

async function world(t) {
    const doc = setupDom();
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Begin.', 'Opening.');
    return { doc, host, api: { query: (name, args) => host.sdk.query(name, args), command: (type, payload) => host.sdk.command(type, payload) } };
}
const define = async (host, definition) => { success(await host.sdk.command('dm.define', { definition })); return `pack.chat/${definition.slug}`; };
const set = async (host, module, field, value, key) => success(await host.sdk.command('dm.set', { module, field, value, ...(key ? { key } : {}) }));
const render = (doc, api, module) => {
    const el = doc.createElement('div');
    const view = createBlockWidgets({}).widgets[BLOCK_WIDGET].render(el, { module }, api);
    return { el, view };
};
const mapDefinition = (min = 0, max = 100) => ({ slug: 'fame', name: 'Fame', schema: 1, stateVersion: 1, scope: 'chat', kinds: {}, show: { tab: true, card: false, tabName: 'Fame', icon: 'ph-bookmark-simple' },
    state: { fame: { type: 'map', label: 'Fame by region', keys: ['north', 'south', 'east', 'west', 'old-town'], values: { type: 'int', min, max, default: 0 } } } });

test('a map of numbers has a header, rows highest first with a value and a bar, and the rest under Not known yet (n)', async t => {
    const { doc, host, api } = await world(t);
    const module = await define(host, mapDefinition());
    await set(host, module, 'fame', 4, 'south'); await set(host, module, 'fame', 18, 'west'); await set(host, module, 'fame', 9, 'north');
    const { el, view } = render(doc, api, module);
    t.after(() => view.destroy());
    assert.equal(el.querySelector('.ss-section-label').textContent, 'Fame by region');
    assert.equal(el.querySelector('.ss-b-sub').textContent, '3 of 5 known');
    const shown = el.querySelectorAll('.ss-b-box > .ss-b-list > .ss-b-row');
    assert.deepEqual(shown.map(row => row.querySelector('.ss-b-name').textContent), ['West', 'North', 'South'], 'sorted by value, the highest first');
    assert.deepEqual(shown.map(row => row.querySelector('.ss-b-val').textContent), ['18', '9', '4']);
    assert.equal(shown.every(row => row.querySelectorAll('.ss-bar-track').length === 1), true, 'a bar in each row');
    assert.equal(shown[0].querySelector('.ss-bar-track').styleProps['--ss-fill'], '0.18', 'filled to the value');
    const fold = el.querySelector('details.ss-b-fold');
    assert.equal(fold.querySelector('summary').textContent, 'Not known yet (2)');
    assert.deepEqual(fold.querySelectorAll('.ss-b-name').map(node => node.textContent), ['East', 'Old town']);
    assert.equal(el.querySelectorAll('.ss-w-editable-pencil').length, 5, 'one pencil for every key, known or not, one in each row');
    assert.equal(shown.every(row => row.querySelectorAll('.ss-w-editable-pencil').length === 1), true);
});

test('a map that runs below zero draws its bar from a centre line, with signed values', async t => {
    const { doc, host, api } = await world(t);
    const module = await define(host, mapDefinition(-100, 100));
    await set(host, module, 'fame', 12, 'north'); await set(host, module, 'fame', -20, 'east');
    const { el, view } = render(doc, api, module);
    t.after(() => view.destroy());
    const rows = el.querySelectorAll('.ss-b-box > .ss-b-list > .ss-b-row');
    assert.deepEqual(rows.map(row => row.querySelector('.ss-b-val').textContent), ['+12', '-20']);
    assert.equal(rows.every(row => row.querySelectorAll('.ss-b-mid').length === 1), true);
    assert.equal(has(rows[1].querySelector('.ss-bar-fill'), 'ss-b-neg'), true, 'a negative value grows to the left');
    assert.equal(rows[0].querySelector('.ss-bar-fill').style.width, '6%');
});

test('Not known yet keeps its open state across a redraw, and a changed value moves a row into the list', async t => {
    const { doc, host, api } = await world(t);
    const module = await define(host, mapDefinition());
    const { el, view } = render(doc, api, module);
    t.after(() => view.destroy());
    assert.equal(el.querySelectorAll('.ss-b-box > .ss-b-list > .ss-b-row').length, 0, 'nothing known yet');
    assert.equal(el.querySelector('summary').textContent, 'Not known yet (5)');
    const fold = el.querySelector('details.ss-b-fold');
    fold.open = true;
    fold.dispatch('toggle');
    await set(host, module, 'fame', 7, 'east');
    view.update({ module });
    await settle();
    assert.equal(el.querySelectorAll('.ss-b-box > .ss-b-list > .ss-b-row').length, 1);
    assert.equal(el.querySelector('details.ss-b-fold').hasAttribute('open'), true, 'still open');
});

// An entries field is BLOCKEDIT's (a list of records the block keeps): the card reads it through the block's roles. Fixtures are written in the contract's shape.
const entriesFixture = (layout = 'cards', roles = { field: 'quests', title: 'title', status: 'status', step: 'step' }) => ({
    id: 'pack.chat/log', pack: 'chat', slug: 'log', name: 'Quest log', scope: 'chat', kinds: {}, show: { tab: true, card: false, tabName: 'Log', icon: 'ph-star' },
    layout, roles, tones: { open: 'active', won: 'done', lost: 'failed' },
    state: { quests: { type: 'entries', label: 'Quests', max: 30, default: [], of: { title: { type: 'text', max: 60 }, about: { type: 'text', max: 200 }, step: { type: 'text', max: 80 },
        status: { type: 'enum', values: ['open', 'won', 'lost'] }, reward: { type: 'int', min: 0, max: 100 } } } } });
const entryValues = () => [{ title: 'Find the ledger', about: 'Before the audit.', step: 'Ask the porter', status: 'open', reward: 20 },
    { title: 'Carry the letter', about: 'To the Guild.', step: 'Delivered', status: 'won', reward: 40 }, { title: 'Save the boat', about: 'Too late.', step: 'Sunk', status: 'lost', reward: 0 }];
const stub = (definition, values) => ({ query: name => (name === 'dataModules.setup' ? [{ module: definition.id, packId: 'chat', pinned: true, pinnedDefinition: definition }]
    : name === 'dataModules.view' ? { chat: values } : null), command: async () => ({ ok: true }) });

test('an entries field with layout cards is drawn as the same cards, its roles naming title, status and step, its tones the colours', async t => {
    const { doc } = await world(t);
    const definition = entriesFixture();
    const { el, view } = render(doc, stub(definition, { quests: entryValues() }), definition.id);
    t.after(() => view.destroy());
    const cards = el.querySelectorAll('.ss-b-quest');
    assert.equal(cards.length, 3);
    assert.deepEqual(el.querySelectorAll('.ss-section-label').map(node => node.textContent), ['Active (1)']);
    assert.equal(el.querySelector('summary').textContent, 'Finished (2)');
    assert.equal(cards[0].querySelector('.ss-b-qt').textContent, 'Find the ledger');
    assert.equal(cards[0].querySelector('.ss-b-q2').textContent, 'Before the audit.', 'the first text sub-field the roles do not use is the description');
    assert.equal(cards[0].querySelector('.ss-b-step').textContent, 'Ask the porter');
    assert.ok(has(cards[1].querySelector('.ss-b-chip'), 'ss-l-tone-good'), 'won is done');
    assert.ok(has(cards[2].querySelector('.ss-b-chip'), 'ss-l-tone-bad'), 'lost is failed');
});

test('entries as bars give a row and bar for each entry, and as fields a small card each; no layout is a plain line', async t => {
    const { doc } = await world(t);
    const bars = entriesFixture('bars', { field: 'quests', title: 'title', status: 'reward' });
    const first = render(doc, stub(bars, { quests: entryValues() }), bars.id);
    t.after(() => first.view.destroy());
    assert.deepEqual(first.el.querySelectorAll('.ss-b-row .ss-b-name').map(node => node.textContent), ['Find the ledger', 'Carry the letter', 'Save the boat']);
    assert.deepEqual(first.el.querySelectorAll('.ss-b-row .ss-b-val').map(node => node.textContent), ['20', '40', '0']);
    assert.equal(first.el.querySelectorAll('.ss-bar-track').length, 3);
    const fields = entriesFixture('fields');
    const second = render(doc, stub(fields, { quests: entryValues() }), fields.id);
    t.after(() => second.view.destroy());
    assert.equal(second.el.querySelectorAll('.ss-b-rec').length, 3);
    assert.deepEqual(second.el.querySelectorAll('.ss-b-rec')[0].querySelectorAll('dt').map(node => node.textContent), ['About', 'Step', 'Status', 'Reward']);
    const bare = entriesFixture(undefined);
    delete bare.layout; delete bare.roles;
    const third = render(doc, stub(bare, { quests: entryValues() }), bare.id);
    t.after(() => third.view.destroy());
    assert.equal(third.el.querySelectorAll('.ss-b-quest').length, 0);
    assert.match(third.el.querySelector('.ss-block-value-shown').textContent, /Find the ledger/);
});

test('a data module screen draws its own fields as a map of numbers or a record card (story-block.fields)', async t => {
    const { doc, host, api } = await world(t);
    const module = await define(host, { slug: 'guild', name: 'Guild membership', schema: 1, stateVersion: 1, scope: 'chat', kinds: {}, show: { tab: true, card: false, tabName: 'Guild', icon: 'ph-star' },
        state: { letter: { type: 'enum', values: ['F', 'E'], default: 'F' }, standing: { type: 'enum', values: ['probation', 'good'], default: 'probation' }, dues: { type: 'int', min: 0, max: 500, default: 50 },
            hidden: { type: 'int', min: 0, max: 2, default: 0 }, wendhild: { type: 'int', min: 0, max: 100, default: 40 }, corvin: { type: 'int', min: 0, max: 100, default: 35 } } });
    const widget = createFieldsWidgets()[FIELDS_WIDGET];
    const card = doc.createElement('div');
    const view = widget.render(card, { module, as: 'record', fields: ['letter', 'standing', 'dues'], title: 'Adventurer Guild', labels: { dues: 'Yearly dues' }, units: { dues: 'copper' },
        tones: { standing: { probation: 'warn' } } }, api);
    t.after(() => view.destroy());
    assert.equal(card.querySelector('.ss-section-label').textContent, 'Adventurer Guild');
    const lines = card.querySelectorAll('.ss-b-line');
    assert.deepEqual(lines.map(line => line.querySelector('dt').textContent), ['Letter', 'Standing', 'Yearly dues'], 'only the fields it lists');
    assert.equal(lines[2].querySelectorAll('dd')[0].textContent, '50 copper');
    assert.ok(has(lines[1].querySelector('.ss-b-chip'), 'ss-l-tone-warn'), 'a choice with tones is a chip');
    assert.equal(lines[0].querySelectorAll('.ss-pill').length, 1, 'a choice without is a pill');
    assert.equal(card.querySelectorAll('.ss-w-editable-pencil').length, 3);
    const court = doc.createElement('div');
    const second = widget.render(court, { module, as: 'map', fields: ['wendhild', 'corvin'], title: 'Court favour', names: { corvin: 'Prince Corvin' } }, api);
    t.after(() => second.destroy());
    assert.deepEqual(court.querySelectorAll('.ss-b-name').map(node => node.textContent), ['Wendhild', 'Prince Corvin'], 'default values are listed: they are the defaults, so folded under Not known yet');
});

test('a block that says show.into is a section of that tab beside the pack screens that name it, not a tab of its own', async t => {
    const { mountUi } = await import('../../../src/v2/ui-host.js');
    const doc = setupDom(), form = doc.createElement('div'); form.id = 'send_form'; doc.body.appendChild(form);
    doc.defaultView = { confirm: () => true };
    const host = await createHost(), ui = mountUi({ runtime: host, ctx: host.ctx, doc });
    t.after(() => { ui.destroy(); host.close(); });
    await host.send('Begin.', 'Opening.');
    const module = await define(host, { ...mapDefinition(), slug: 'standing2', name: 'Standing', show: { tab: true, card: false, tabName: 'Standing', icon: 'ph-star', into: 'reputation' } });
    ui.syncScreens();
    const tabs = ui.screens.list('tab').map(entry => entry.id);
    assert.ok(tabs.includes('story-block/tab/reputation'), tabs.join());
    assert.equal(tabs.includes('story-block/block/standing2'), false, 'no tab of its own');
    const entry = ui.screens.resolve('story-block/tab/reputation');
    assert.equal(entry.screen.title, 'Standing', 'with no other title given, the block\'s name');
    assert.deepEqual(entry.screen.layout.root.children.map(node => node.type), ['story-block.block']);
    assert.equal(entry.screen.layout.root.children[0].props.module, module);
    const plain = await define(host, { ...mapDefinition(), slug: 'alone', name: 'Alone', show: { tab: true, card: false, tabName: 'Alone', icon: 'ph-star' } });
    ui.syncScreens();
    assert.ok(ui.screens.resolve('story-block/block/alone')?.screen, `a block without into keeps its tab (${plain})`);
});

test('the editor preview draws entries in a layout with no editors (renderPreview)', async t => {
    const { renderBlockPreview } = await import('../../../src/v2/screens/block-layouts.js');
    const { doc } = await world(t);
    const definition = entriesFixture();
    const parent = doc.createElement('div');
    const handle = renderBlockPreview(parent, { definition, values: { quests: entryValues() }, layout: 'cards' });
    t.after(() => handle.destroy());
    assert.equal(parent.querySelectorAll('.ss-b-quest').length, 3);
    assert.equal(parent.querySelectorAll('.ss-w-editable-pencil').length, 0);
    const bars = doc.createElement('div');
    renderBlockPreview(bars, { definition: entriesFixture('bars', { field: 'quests', title: 'title', status: 'reward' }), values: { quests: entryValues() }, layout: 'bars' });
    assert.equal(bars.querySelectorAll('.ss-b-row').length, 3);
});

test('a long description is clamped (data-open false) with a More that opens it and a Less that closes it; a short one has no More', async t => {
    const { doc } = await world(t);
    const definition = entriesFixture();
    const list = entryValues(); list[0].about = 'The clerk swears the ledger vanished the night before the audit. '.repeat(3);
    const { el, view } = render(doc, stub(definition, { quests: list }), definition.id);
    t.after(() => view.destroy());
    const [open, won] = el.querySelectorAll('.ss-b-quest');
    const text = open.querySelector('.ss-b-q2'), more = open.querySelector('.ss-b-more');
    assert.equal(text.getAttribute('data-open'), 'false');
    assert.equal(more.hidden, false);
    more.click();
    assert.equal(text.getAttribute('data-open'), 'true');
    assert.equal(more.textContent, 'Less');
    assert.equal(more.getAttribute('aria-expanded'), 'true');
    assert.equal(won.querySelector('.ss-b-more').hidden, true);
});

test('a block with plain fields keeps its plain rows', async t => {
    const { doc, host, api } = await world(t);
    const plain = await define(host, { slug: 'plain', name: 'Plain', schema: 1, stateVersion: 1, scope: 'chat', kinds: {}, show: { tab: true, card: false, tabName: 'Plain', icon: 'ph-bookmark-simple' },
        state: { a: { type: 'text', max: 40, default: 'x' }, b: { type: 'int', min: 0, max: 5, default: 2 } } });
    const { el, view } = render(doc, api, plain);
    t.after(() => view.destroy());
    assert.equal(el.querySelectorAll('.ss-block-value').length, 2);
    assert.equal(el.querySelectorAll('.ss-b-quest').length, 0);
});
