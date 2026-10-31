// The block builder, the editor, the block card and the template chooser with the RPG's additions: names for numbers, hidden
// fields, a role, cards and reply-end functions, and the "RPG" templates under the chooser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { mountUi } from '../../../src/v2/ui-host.js';
import { buildBlock, blockDraft, blockKindCount, editableBlockDraft, parseNames } from '../../../src/v2/data-modules/block-builder.js';
import { createBlockWidgets } from '../../../src/v2/screens/blocks.js';
import { STRINGS, fill } from '../../../src/v2/strings.js';
import { LEAN_RPG_FEATURE } from '../../../src/v2/lean-rpg/index.js';
import { setupDom } from '../view/mounts/helpers.js';
import { success } from '../data-modules/helpers.js';

const S = STRINGS.blocks;
const P = S.page;
const settle = () => new Promise(resolve => setImmediate(resolve));
const button = (root, text) => root.querySelectorAll('button').find(node => node.textContent === text);
const input = (root, name) => root.querySelector(`[aria-label="${name}"]`);
// Settings → Blocks: the window opened on that page (the pane is found again each time, the window being drawn once).
const blocksPage = ui => {
    const win = ui.openSettings();
    win.select('blocks');
    return () => win.root.querySelector('[data-ss-section="blocks"]');
};

async function page(t) {
    const doc = setupDom(), form = doc.createElement('div'); form.id = 'send_form'; doc.body.appendChild(form);
    doc.defaultView = { confirm: () => true };
    const host = await createHost(), ui = mountUi({ runtime: host, ctx: host.ctx, doc });
    t.after(() => { ui.destroy(); host.close(); });
    await host.send('Begin.', 'Opening.');
    return { doc, host, ui };
}

const draft = () => ({ name: 'Gauge', role: 'character', fields: [
    { name: 'Level', type: 'number', min: 1, max: 9, default: 1, names: '1 = I\n2 = II\n 3: III' },
    { name: 'Strain', type: 'number', min: 0, max: 5, default: 0 },
    { name: 'Latch', type: 'choice', values: ['open', 'shut'], default: 'open', prompt: false },
], prompt: '', show: { tab: true, card: false, tabName: 'Gauge', icon: 'ph-star' }, functions: [
    { type: 'button', name: 'Rest', effects: [{ field: 'strain', op: 'set', value: 0 }] },
    { type: 'rule', name: 'Strained', when: { field: 'strain', op: 'ge', value: 5 }, effects: [{ field: 'latch', op: 'set', value: 'shut' }] },
    { type: 'reply-end', name: 'Settle', when: { field: 'strain', op: 'ge', value: 3 }, effects: [{ field: 'level', op: 'add', value: 1 }] },
    { type: 'card', name: 'Strained out', when: { field: 'strain', op: 'ge', value: 4 }, tone: 'warn', title: 'Strained', text: 'Take a rest.', button: 'Rest' },
] });

test('the builder writes names, a hidden field, a role, a card and a reply-end function, and reads them back', () => {
    const built = buildBlock(draft());
    assert.equal(built.ok, true, JSON.stringify(built.errors));
    const { definition } = built;
    assert.equal(definition.role, 'character');
    assert.deepEqual(definition.state.level.names, { 1: 'I', 2: 'II', 3: 'III' });
    assert.equal(definition.state.latch.prompt, false);
    assert.equal(Object.hasOwn(definition.kinds, 'set-latch'), false, 'the story cannot set a hidden field');
    assert.ok(Object.hasOwn(definition.kinds, 'set-level') && Object.hasOwn(definition.kinds, 'set-strain'));
    assert.deepEqual(definition.cards, [{ id: 'strained-out', when: ['ge', ['get', ['strain']], 4], tone: 'warn', title: 'Strained', text: 'Take a rest.', button: 'button-rest' }]);
    assert.deepEqual(definition.replyEnd.map(entry => entry.id), ['settle']);
    assert.equal(blockKindCount(draft()), 3, 'two fields and a button: a hidden field uses no kind');
    // reopened, it is the same block
    const again = buildBlock(blockDraft(built.checked));
    assert.equal(again.ok, true, JSON.stringify(again.errors));
    assert.deepEqual(again.checked, built.checked);
    assert.deepEqual(editableBlockDraft(built.checked)?.fields[0].names, { 1: 'I', 2: 'II', 3: 'III' }, 'the form can edit it faithfully');
    // a block with none of the new keys gains none
    const plain = buildBlock({ name: 'Plain', fields: [{ name: 'Mood', type: 'text', max: 20, default: '' }], functions: [], prompt: '', show: { tab: true, card: false, tabName: 'Plain', icon: 'ph-star' } });
    for (const key of ['role', 'cards', 'replyEnd']) assert.equal(Object.hasOwn(plain.definition, key), false, key);
    assert.equal(Object.hasOwn(plain.definition.state.mood, 'names'), false);
});

test('the builder says where a name, a card or a role is wrong', () => {
    const bad = change => { const d = draft(); change(d); return buildBlock(d); };
    assert.equal(bad(d => { d.fields[0].names = 'one = I'; }).errors[0].path, 'fields.0.names');
    assert.equal(bad(d => { d.fields[0].names = '1 = I\n1 = again'; }).errors[0].path, 'fields.0.names');
    assert.match(bad(d => { d.fields[0].names = '10 = ten'; }).errors[0].path, /names/, 'a name outside the range');
    assert.equal(bad(d => { d.functions[3].button = 'Missing'; }).errors[0].path, 'functions.3.button');
    assert.equal(bad(d => { d.functions[3].when = { field: 'nothing', op: 'eq', value: 1 }; }).errors[0].path, 'functions.3.when');
    assert.equal(bad(d => { d.functions[3].title = ''; }).ok, false);
    assert.equal(bad(d => { d.functions[2].effects = []; }).errors[0].path, 'functions.2.effects');
    assert.match(bad(d => { d.role = 'boss'; }).errors[0].path, /role$/);
    assert.deepEqual(parseNames('1 = I\n\n2: II'), { 1: 'I', 2: 'II' });
    assert.equal(parseNames('1 I'), null);
    assert.deepEqual(parseNames(''), {});
});

test('a definition written by hand is opened read-only with a plain note; the form edits only what it can write back', async t => {
    const written = JSON.parse(JSON.stringify(buildBlock(draft()).definition));
    written.kinds.practice = { op: '+', labels: { by: { type: 'int', min: 1, max: 9 } }, effects: [{ op: 'add', path: ['level'], value: ['arg', 'by'], bounds: 'clamp' }] };
    assert.equal(editableBlockDraft(written), null, 'a hand-made kind is more than the form writes');
    const hand = JSON.parse(JSON.stringify(buildBlock(draft()).definition));
    hand.replyEnd[0].when = true;
    hand.replyEnd[0].type = 'reply-end';
    assert.equal(editableBlockDraft(hand), null);
    const { host, ui } = await page(t);
    success(await host.sdk.command('dm.define', { definition: written }));
    const screen = blocksPage(ui);
    input(screen(), fill(P.editFor, { name: 'Gauge' })).click();
    assert.equal(screen().querySelector('.ss-block-editor'), null);
    assert.match(screen().textContent, /Made from a template: edit its fields here, its rules in the pack file\./);
    // a block with no role keeps the older sentence
    const other = JSON.parse(JSON.stringify(written));
    other.slug = 'other'; other.name = 'Other'; delete other.role; other.kinds.practice.effects.push({ op: 'set', path: ['strain'], value: 0 });
    success(await host.sdk.command('dm.define', { definition: other }));
    await settle();
    input(screen(), fill(P.editFor, { name: 'Other' })).click();
    assert.match(screen().textContent, /details the editor cannot change safely/);
});

test('the editor offers Names for a number, keeps what a block already has, and saves it', async t => {
    const { doc, host, ui } = await page(t);
    let screen = blocksPage(ui);
    button(screen(), S.newBlock).click();
    input(screen(), S.name).value = 'Gauge';
    button(screen(), S.addField).click();
    assert.equal(input(screen(), S.names), null, 'only a number has names');
    const type = input(screen(), S.fieldTypeLabel);
    type.value = 'number'; type.dispatch('change');
    input(screen(), S.min).value = '0';
    input(screen(), S.max).value = '3';
    input(screen(), S.defaultValue).value = '0';
    input(screen(), S.names).value = '0 = Low\n1 = Mid\n2 = High\n3 = Full';
    button(screen(), S.save).click();
    await settle(); await settle();
    const definition = host.sdk.query('dataModules.setup').find(row => row.module === 'pack.chat/gauge').pinnedDefinition;
    assert.deepEqual(definition.state['field-1'].names, { 0: 'Low', 1: 'Mid', 2: 'High', 3: 'Full' });
    assert.deepEqual(host.sdk.query('dataModules.view', { module: 'pack.chat/gauge' }).chat, { 'field-1': 0 }, 'the value is the number');
    // the block's tab shows the name; a full set of names is a choice
    ui.openSettings().close();
    ui.mounts.screen.open('story-block/block/gauge');
    const tab = () => doc.querySelector('.ss-gameview [data-ss-screen="story-block/block/gauge"]');
    const card = () => tab().querySelector('.ss-block-card');
    assert.equal(card().querySelector('.ss-block-value-shown').textContent, 'Low');
    card().querySelector('.ss-w-editable-pencil').click();
    const select = card().querySelector('.ss-w-editable-form select');
    assert.ok(select, 'a choice of the names');
    assert.deepEqual(select.children.map(option => option.textContent), ['Low', 'Mid', 'High', 'Full']);
    select.value = '2';
    card().querySelector('.ss-w-editable-save').click();
    await settle(); await settle();
    assert.equal(host.sdk.query('dataModules.view', { module: 'pack.chat/gauge' }).chat['field-1'], 2, 'stored as the number');
    assert.equal(host.ctx.chat.at(-1).extra.storySuite.receipts.at(-1).summary, 'You set Gauge: Field 1 Low → High.');
    assert.equal(card().querySelector('.ss-block-value-shown').textContent, 'High');
    // opened again, the names are still there and can be changed
    input(tab(), S.menu).click();
    button(tab(), S.editFields).click();
    screen = () => doc.querySelector('.story-suite-overlay [data-ss-section="blocks"]');
    assert.equal(input(screen(), S.names).value, '0 = Low\n1 = Mid\n2 = High\n3 = Full');
    input(screen(), S.names).value = '0 = Low\n1 = Mid\n2 = High\n9 = Beyond';
    button(screen(), S.save).click();
    await settle();
    assert.ok(screen().querySelector('.ss-block-editor'), 'a name outside the range is refused beside its box');
    assert.match(input(screen(), S.names).closest('.ss-block-control').querySelector('[role="alert"]').textContent, /whole values inside its range/);
});

test('a number with names for only some values is typed and shown by its name where it has one', async t => {
    const { doc, host, ui } = await page(t);
    const built = buildBlock({ name: 'Marks', fields: [{ name: 'Score', type: 'number', min: 0, max: 100, default: 0, names: '100 = Perfect' }], functions: [], prompt: '',
        show: { tab: true, card: false, tabName: 'Marks', icon: 'ph-star' } });
    success(await host.sdk.command('dm.define', { definition: built.definition }));
    ui.mounts.screen.open('story-block/block/marks');
    const screen = () => doc.querySelector('.ss-gameview [data-ss-screen="story-block/block/marks"]');
    assert.equal(screen().querySelector('.ss-block-value-shown').textContent, '0');
    screen().querySelector('.ss-w-editable-pencil').click();
    screen().querySelector('.ss-w-editable-form input').value = '100';
    screen().querySelector('.ss-w-editable-save').click();
    await settle(); await settle();
    assert.equal(screen().querySelector('.ss-block-value-shown').textContent, 'Perfect');
    assert.equal(host.sdk.query('dataModules.view', { module: 'pack.chat/marks' }).chat.score, 100);
});

test('the editor shows a card and a reply-end function, keeps them on save, and follows a button that is renamed', async t => {
    const { doc, host, ui } = await page(t);
    const built = buildBlock(draft());
    success(await host.sdk.command('dm.define', { definition: built.definition }));
    const screen = blocksPage(ui);
    input(screen(), fill(P.editFor, { name: 'Gauge' })).click();
    const pills = screen().querySelectorAll('.ss-block-function .ss-pill').map(node => node.textContent);
    assert.deepEqual(pills, [S.button, S.rule, S.replyEnd, S.card]);
    assert.equal(input(screen(), S.cardTitleLabel).value, 'Strained');
    assert.equal(input(screen(), S.cardButtonLabel).value, 'Rest');
    // renaming the button keeps the card's button
    const names = screen().querySelectorAll(`[aria-label="${S.functionName}"]`);
    names[0].value = 'Recover'; names[0].dispatch('change');
    button(screen(), S.save).click();
    await settle(); await settle();
    const definition = host.sdk.query('dataModules.setup').find(row => row.module === 'pack.chat/gauge').pinnedDefinition;
    assert.equal(definition.cards[0].button, 'button-recover');
    assert.equal(definition.role, 'character');
    assert.equal(definition.state.latch.prompt, false);
    assert.deepEqual(definition.replyEnd.map(entry => entry.id), ['settle']);
    assert.ok(editableBlockDraft(definition), 'and the form can still reopen it');
});

const heroTemplate = () => ({ name: 'Hero', definition: { slug: 'hero', name: 'Hero', schema: 1, stateVersion: 1, scope: 'chat', role: 'character',
    state: { health: { type: 'int', min: 0, max: 5, default: 5, names: { 0: 'Down', 5: 'Unhurt' } }, down: { type: 'bool', default: false, prompt: false } },
    kinds: { 'set-health': { op: '~', labels: { to: { type: 'int', min: 0, max: 5 } }, effects: [{ op: 'set', path: ['health'], value: ['arg', 'to'] }] } },
    replyEnd: [{ when: true, effects: [{ op: 'set', path: ['down'], value: ['eq', ['get', ['health']], 0] }] }],
    show: { tab: true, card: false, tabName: 'Hero', icon: 'ph-heart' }, prompt: '' } });

function widgetPage(t, { on = true, templates = [heroTemplate()] } = {}) {
    const doc = setupDom();
    const rows = [], calls = [];
    const api = {
        query: name => (name === 'dataModules.setup' ? rows : null),
        command: async (type, payload) => {
            calls.push({ type, payload });
            const definition = payload.definition;
            rows.push({ pinned: true, packId: 'chat', module: `pack.chat/${definition.slug}`, pinnedDefinition: { ...definition, id: `pack.chat/${definition.slug}`, pack: 'chat' }, subjects: ['chat'], actors: [] });
            return { ok: true };
        },
    };
    let loads = 0;
    const blocks = createBlockWidgets({ templates: { list: () => [], put: async () => ({ ok: true }) }, leanRpgOn: () => on, loadRpgTemplates: async () => { loads++; return templates; } });
    const el = doc.createElement('div'); doc.body.appendChild(el);
    const handle = blocks.page({ doc, parent: el, api });
    t.after(() => handle?.destroy?.());
    return { doc, el, rows, calls, loads: () => loads };
}

test('with the feature on, the chooser lists the RPG templates under their own heading and makes the block as written', async t => {
    const { el, rows, calls, loads } = widgetPage(t);
    button(el, P.fromTemplate).click();
    await settle(); await settle();
    assert.equal(loads(), 1);
    assert.equal(el.querySelector('.ss-block-chooser-heading').textContent, S.leanRpg);
    const names = el.querySelector('.ss-block-chooser').querySelectorAll('button').map(node => node.textContent);
    assert.deepEqual(names, ['Hero · 2 fields, 0 buttons, 0 rules, 0 timers', S.cancel], 'the template sits before Cancel, under its heading');
    button(el, 'Hero · 2 fields, 0 buttons, 0 rules, 0 timers').click();
    await settle(); await settle();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].type, 'dm.define');
    assert.equal(calls[0].payload.definition.slug, 'hero');
    assert.equal(calls[0].payload.definition.name, 'Hero');
    assert.equal(calls[0].payload.definition.role, 'character');
    assert.equal(Object.hasOwn(calls[0].payload.definition, 'id'), false);
    assert.match(el.textContent, /Added Hero\./);
    assert.equal(el.querySelector('.ss-block-chooser'), null, 'back to the list');
    // a second one gets a name and an identifier of its own
    button(el, P.fromTemplate).click();
    await settle();
    button(el, 'Hero · 2 fields, 0 buttons, 0 rules, 0 timers').click();
    await settle(); await settle();
    assert.equal(calls[1].payload.definition.slug, 'hero-2');
    assert.equal(calls[1].payload.definition.name, 'Hero 2');
    assert.equal(calls[1].payload.definition.show.tabName, 'Hero 2');
    assert.equal(rows.length, 2);
    // and the real engine takes what the chooser sent
    const host = await createHost(); t.after(() => host.close());
    await host.send('Begin.', 'Opening.');
    success(await host.sdk.command('dm.define', { definition: calls[0].payload.definition }));
    success(await host.sdk.command('dm.define', { definition: calls[1].payload.definition }));
});

test('with the feature off, the templates are not even read', async t => {
    const { el, loads } = widgetPage(t, { on: false });
    button(el, P.fromTemplate).click();
    await settle(); await settle();
    assert.equal(loads(), 0);
    assert.equal(el.querySelector('.ss-block-chooser-heading'), null);
});

test('a refused template says why and stays in the chooser; the list may be empty', async t => {
    const empty = widgetPage(t, { templates: [] });
    button(empty.el, P.fromTemplate).click();
    await settle(); await settle();
    assert.equal(empty.el.querySelector('.ss-block-chooser-heading'), null, 'no heading for no templates');
    const { el } = widgetPage(t);
    button(el, P.fromTemplate).click();
    await settle(); await settle();
    const refusing = createBlockWidgets({ templates: { list: () => [] }, leanRpgOn: () => true, loadRpgTemplates: async () => [heroTemplate()] });
    const doc = setupDom(), host = doc.createElement('div'); doc.body.appendChild(host);
    const api = { query: () => [], command: async () => ({ ok: false, message: 'This chat can have at most 8 blocks.' }) };
    const handle = refusing.page({ doc, parent: host, api });
    t.after(() => handle?.destroy?.());
    button(host, P.fromTemplate).click();
    await settle(); await settle();
    button(host, 'Hero · 2 fields, 0 buttons, 0 rules, 0 timers').click();
    await settle(); await settle();
    assert.match(host.textContent, /at most 8 blocks/);
    assert.ok(host.querySelector('.ss-block-chooser'));
});

test('the real chooser reads the real list only once the feature is on', async t => {
    const { doc, host, ui } = await page(t);
    let screen = blocksPage(ui);
    button(screen(), P.fromTemplate).click();
    assert.equal(screen().querySelector('.ss-block-chooser-heading'), null, 'off by default');
    button(screen(), S.cancel).click();
    host.features.set(LEAN_RPG_FEATURE, true);
    await settle(); await settle();
    // (the settings window is opened again, on the same page, with the RPG page in its rail)
    screen = () => doc.querySelector('.story-suite-overlay [data-ss-section="blocks"]');
    button(screen(), P.fromTemplate).click();
    await settle(); await settle();
    assert.ok(screen().querySelector('.ss-block-chooser'));
});

test('the chooser counts in the singular for one and the plural for the rest ("1 button", never "1 buttons")', async t => {
    const one = { name: 'One', definition: { slug: 'one', name: 'One', schema: 1, stateVersion: 1, scope: 'chat', state: { n: { type: 'int', min: 0, max: 5, default: 0 } },
        kinds: { go: { op: '~', ui: { label: 'Go' }, effects: [] } }, rules: [{ id: 'r', when: true, effects: [] }], timers: [{ id: 't', every: 5, effects: [] }] } };
    const many = { name: 'Many', definition: { slug: 'many', name: 'Many', schema: 1, stateVersion: 1, scope: 'chat', state: { a: { type: 'int', min: 0, max: 5, default: 0 }, b: { type: 'int', min: 0, max: 5, default: 0 } },
        kinds: { x: { op: '~', ui: { label: 'X' }, effects: [] }, y: { op: '~', ui: { label: 'Y' }, effects: [] } }, rules: [], timers: [] } };
    const { el } = widgetPage(t, { templates: [one, many] });
    button(el, P.fromTemplate).click();
    await settle(); await settle();
    const names = el.querySelector('.ss-block-chooser').querySelectorAll('button').map(node => node.textContent);
    assert.deepEqual(names, ['One · 1 field, 1 button, 1 rule, 1 timer', 'Many · 2 fields, 2 buttons, 0 rules, 0 timers', S.cancel]);
});
