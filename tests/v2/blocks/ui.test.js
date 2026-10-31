import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { mountUi } from '../../../src/v2/ui-host.js';
import { buildBlock } from '../../../src/v2/data-modules/block-builder.js';
import { STRINGS, fill } from '../../../src/v2/strings.js';
import { setupDom } from '../view/mounts/helpers.js';

const S = STRINGS.blocks;
const P = S.page;
const settle = () => new Promise(resolve => setImmediate(resolve));
const button = (root, text) => root.querySelectorAll('button').find(node => node.textContent === text);
const input = (root, name) => root.querySelector(`[aria-label="${name}"]`);

// Settings → Blocks: the window opened on that page. `screen()` is the page's pane (the window is drawn again each time it is opened).
const blocksPage = ui => {
    const win = ui.openSettings();
    win.select('blocks');
    return () => win.root.querySelector('[data-ss-section="blocks"]');
};
const rowOf = (screen, name) => screen.querySelectorAll('.ss-blockrow').find(node => node.querySelector('.ss-blockrow-name').textContent === name);
const gameTabs = doc => doc.querySelectorAll('.ss-gameview [data-id]').map(node => node.getAttribute('data-id'));

async function page(t) {
    const doc = setupDom(), form = doc.createElement('div'); form.id = 'send_form'; doc.body.appendChild(form);
    doc.defaultView = { confirm: () => true };
    const host = await createHost(), ui = mountUi({ runtime: host, ctx: host.ctx, doc });
    t.after(() => { ui.destroy(); host.close(); });
    await host.send('Begin.', 'Opening.');
    return { doc, host, ui };
}

test('the Blocks page creates a block with an editable field, a tab and a Home card', async t => {
    const { doc, host, ui } = await page(t);
    assert.equal(ui.screens.resolve('story-block/blocks'), null, 'the game view has no Blocks tab');
    const screen = blocksPage(ui);
    assert.match(screen().textContent, /No blocks in this story yet/);
    button(screen(), S.newBlock).click();
    input(screen(), S.name).value = 'Camp Notes';
    input(screen(), S.tabName).value = 'Notes';
    button(screen(), S.both).click();
    button(screen(), S.addField).click();
    const field = input(screen(), S.fieldNameLabel);
    field.value = 'Mood'; field.dispatch('change');
    input(screen(), S.defaultValue).value = 'calm';
    button(screen(), S.save).click();
    await settle(); await settle();
    assert.deepEqual(host.sdk.query('dataModules.view', { module: 'pack.chat/camp-notes' }).chat, { mood: 'calm' });
    const tab = ui.screens.resolve('story-block/block/camp-notes');
    assert.equal(tab.screen.title, 'Notes');
    assert.equal(tab.screen.icon, 'ph-bookmark-simple');
    assert.ok(rowOf(screen(), 'Camp Notes'), 'listed in Settings → Blocks');
    assert.equal(screen().querySelector('.ss-block-card'), null, 'the page lists blocks; the cards are on their tabs and Home');
    ui.openSettings().close();
    ui.mounts.screen.open('story-block/home');
    assert.equal(doc.querySelector('.ss-gameview [data-id="story-block/blocks"]'), null, 'no Blocks tab or tile');
    assert.ok(doc.querySelector('.ss-gameview .ss-screenbar-tile[data-id="story-block/block/camp-notes"]'));
    assert.match(doc.querySelector('.ss-gameview [data-ss-screen="story-block/home"]').textContent, /Camp Notes/);
    assert.equal(ui.mounts.screen.open('story-block/block/camp-notes'), true);
    assert.match(doc.querySelector('.ss-gameview [data-ss-screen="story-block/block/camp-notes"]').textContent, /Mood/);
    await host.swipe('A different opening.');
    assert.equal(ui.screens.resolve('story-block/block/camp-notes'), null);
});

test('a button, field pencil, template save and deletion work from a block card', async t => {
    const { doc, host, ui } = await page(t);
    const draft = { name: 'Notes', fields: [{ name: 'Mood', type: 'text', max: 30, default: 'calm' }], prompt: '',
        show: { tab: true, card: true, tabName: 'Notes', icon: 'ph-star' }, functions: [
            { type: 'button', name: 'Rest', effects: [{ field: 'mood', op: 'set', value: 'rested' }] },
        ] };
    const made = buildBlock(draft);
    assert.equal(made.ok, true, JSON.stringify(made.errors));
    assert.equal((await host.sdk.command('dm.define', { definition: made.definition })).ok, true);
    ui.mounts.screen.open('story-block/block/notes');
    const screen = () => doc.querySelector('.ss-gameview [data-ss-screen="story-block/block/notes"]');
    button(screen(), 'Rest').click();
    await settle(); await settle();
    assert.equal(host.sdk.query('dataModules.view', { module: 'pack.chat/notes' }).chat.mood, 'rested');
    const pencil = screen().querySelector('.ss-w-editable-pencil');
    pencil.click();
    screen().querySelector('.ss-w-editable-form input').value = 'wary';
    screen().querySelector('.ss-w-editable-save').click();
    await settle(); await settle();
    assert.equal(host.sdk.query('dataModules.view', { module: 'pack.chat/notes' }).chat.mood, 'wary');
    assert.equal(doc.activeElement?.getAttribute('aria-label'), 'Edit Mood');
    input(screen(), S.menu).click();
    button(screen(), S.saveTemplate).click();
    await settle();
    assert.equal(host.ctx.extensionSettings.storySuite.blockTemplates[0].name, 'Notes');
    const settings = blocksPage(ui);
    button(settings(), P.fromTemplate).click();
    const template = settings().querySelectorAll('button').find(node => node.textContent.includes('Notes · 1 fields, 1 buttons'));
    assert.ok(template); template.click();
    button(settings(), S.save).click();
    await settle(); await settle();
    assert.equal(host.sdk.query('dataModules.view', { module: 'pack.chat/notes-2' }).chat.mood, 'calm', 'templates do not save current values');
    ui.openSettings();
    const remove = doc.querySelector(`[aria-label="${S.deleteTemplate}: Notes"]`);
    assert.ok(remove); remove.click();
    await settle();
    assert.deepEqual(host.ctx.extensionSettings.storySuite.blockTemplates, []);
});

test('the editor disables timers without Story Director and counts purpose text by code point', async t => {
    const { ui } = await page(t);
    const screen = blocksPage(ui);
    button(screen(), S.newBlock).click();
    assert.equal(button(screen(), S.addTimer).disabled, true);
    assert.match(screen().textContent, /Timers need Story Director/);
    const purpose = input(screen(), S.purpose);
    purpose.value = '😀'.repeat(1201);
    purpose.dispatch('input');
    assert.equal([...purpose.value].length, 1200);
    assert.match(screen().textContent, /1200 of 1200 characters/);
    purpose.dispatch('keydown', { key: 'Escape' });
    assert.match(screen().textContent, /No blocks in this story yet/);
});

test('the editor keeps typed values on refresh and updates the complete static count', async t => {
    const { host, ui } = await page(t);
    const screen = blocksPage(ui);
    button(screen(), S.newBlock).click();
    input(screen(), S.name).value = 'Journal';
    button(screen(), S.addField).click();
    const count = () => Number(screen().querySelector('.ss-block-static-count').textContent.match(/^\d+/)[0]);
    const before = count();
    const purpose = input(screen(), S.purpose);
    purpose.value = 'Keep track'; purpose.dispatch('input');
    assert.equal(count(), before + 11, 'the purpose and its separating newline are counted');
    assert.ok(button(screen(), S.ownTab).classList.contains('ss-chip-on'));
    input(screen(), S.defaultValue).value = 'unfinished';
    await host.send('Wait.', 'A new reply.');
    assert.equal(input(screen(), S.defaultValue).value, 'unfinished');
    assert.equal(input(screen(), S.purpose).value, 'Keep track');
    button(screen(), S.save).click();
    await settle(); await settle();
    assert.equal(host.sdk.query('dataModules.view', { module: 'pack.chat/journal' }).chat['field-1'], 'unfinished');
    assert.equal(ui.screens.resolve('story-block/block/journal').screen.title, 'Journal');
});

test('an unfinished block draft closes when another chat opens', async t => {
    const { host, ui } = await page(t);
    const screen = blocksPage(ui);
    button(screen(), S.newBlock).click();
    input(screen(), S.name).value = 'Old chat draft';
    await host.st.loadChat([], 'another-chat');
    assert.equal(screen().querySelector('.ss-block-editor'), null);
    assert.match(screen().textContent, /No blocks in this story yet/);
});

test('the template chooser returns keyboard focus when cancelled with Escape', async t => {
    const { doc, ui } = await page(t);
    const screen = blocksPage(ui);
    button(screen(), P.fromTemplate).click();
    assert.match(screen().querySelector('.ss-block-chooser').textContent, /No templates yet/);
    const start = screen().querySelector('.ss-block-chooser button');
    assert.equal(doc.activeElement, start);
    start.dispatch('keydown', { key: 'Escape' });
    assert.equal(screen().querySelector('.ss-block-chooser'), null);
    assert.equal(doc.activeElement, button(screen(), P.fromTemplate));
    assert.ok(ui.openSettings().isOpen(), 'Escape in the chooser closes the chooser only');
});

test('the first field validation message appears beside its invalid control', async t => {
    const { ui } = await page(t);
    const screen = blocksPage(ui);
    button(screen(), S.newBlock).click();
    input(screen(), S.name).value = 'Gauge';
    button(screen(), S.addField).click();
    const type = input(screen(), S.fieldTypeLabel);
    type.value = 'number'; type.dispatch('change');
    input(screen(), S.max).value = '10';
    const value = input(screen(), S.defaultValue);
    value.value = '20';
    button(screen(), S.save).click();
    assert.match(value.closest('.ss-block-control').querySelector('[role="alert"]').textContent, /default.*bounds/i);
    assert.ok(screen().querySelector('.ss-block-editor'));
});

test('editing a tab can move its block to Home and removes the old tab', async t => {
    const { doc, host, ui } = await page(t);
    const built = buildBlock({ name: 'Journey', fields: [{ name: 'Mood', type: 'text', max: 30, default: 'calm' }], functions: [], prompt: '',
        show: { tab: true, card: false, tabName: 'Journey', icon: 'ph-star' } });
    assert.equal((await host.sdk.command('dm.define', { definition: built.definition })).ok, true);
    ui.mounts.screen.open('story-block/block/journey');
    let current = () => doc.querySelector('.ss-gameview [data-ss-screen="story-block/block/journey"]');
    input(current(), S.menu).click();
    button(current(), S.editFields).click();
    current = () => doc.querySelector('.story-suite-overlay [data-ss-section="blocks"]');
    assert.ok(current().querySelector('.ss-block-editor'), 'the card\'s Edit fields opens the editor in Settings → Blocks');
    button(current(), S.card).click();
    button(current(), S.save).click();
    await settle(); await settle();
    assert.equal(ui.screens.resolve('story-block/block/journey'), null);
    ui.openSettings().close();
    ui.mounts.screen.open('story-block/home');
    assert.match(doc.querySelector('.ss-gameview [data-ss-screen="story-block/home"]').textContent, /Journey/);
});

test('the form refuses a definition it cannot reproduce without losing behavior', async t => {
    const { host, ui } = await page(t);
    const built = buildBlock({ name: 'Special', fields: [{ name: 'Mood', type: 'text', max: 30, default: 'calm' }], functions: [], prompt: '',
        show: { tab: true, card: false, tabName: 'Special', icon: 'ph-star' } });
    built.definition.kinds['set-mood'].effects.push({ op: 'set', path: ['mood'], value: 'wary' });
    assert.equal((await host.sdk.command('dm.define', { definition: built.definition })).ok, true);
    const screen = blocksPage(ui)();
    input(screen, fill(P.editFor, { name: 'Special' })).click();
    assert.match(screen.textContent, /cannot change safely/);
    assert.equal(screen.querySelector('.ss-block-editor'), null);
    assert.equal(host.sdk.query('dataModules.setup')[0].pinnedDefinition.kinds['set-mood'].effects.length, 2);
});

test('reader text in a block is drawn as text', async t => {
    const { doc, host, ui } = await page(t);
    const built = buildBlock({ name: '<img src=x>', fields: [{ name: '<b>Mood</b>', type: 'text', max: 40, default: '<b>bad</b>' }], functions: [], prompt: '',
        show: { tab: true, card: false, tabName: 'Notes', icon: 'ph-star' } });
    assert.equal(built.ok, true, JSON.stringify(built.errors));
    assert.equal((await host.sdk.command('dm.define', { definition: built.definition })).ok, true);
    const list = blocksPage(ui)();
    assert.match(list.textContent, /<img src=x>/);
    assert.equal(list.querySelector('img'), null);
    ui.openSettings().close();
    ui.mounts.screen.open('story-block/block/img-src-x');
    const screen = doc.querySelector('.ss-gameview [data-ss-screen="story-block/block/img-src-x"]');
    assert.match(screen.textContent, /<img src=x>/);
    assert.match(screen.textContent, /<b>bad<\/b>/);
    assert.equal(screen.querySelector('img'), null);
    assert.equal(screen.querySelector('b'), null);
});

test('list values appear as chips and remain editable', async t => {
    const { doc, host, ui } = await page(t);
    const built = buildBlock({ name: 'Contacts', fields: [{ name: 'People', type: 'list', default: 'Mara; Teo' }], functions: [], prompt: '',
        show: { tab: true, card: false, tabName: 'Contacts', icon: 'ph-star' } });
    assert.equal((await host.sdk.command('dm.define', { definition: built.definition })).ok, true);
    ui.mounts.screen.open('story-block/block/contacts');
    const screen = () => doc.querySelector('.ss-gameview [data-ss-screen="story-block/block/contacts"]');
    assert.deepEqual(screen().querySelectorAll('.ss-w-editable-value-list .ss-chip').map(node => node.textContent), ['Mara', 'Teo']);
    screen().querySelector('.ss-w-editable-pencil').click();
    screen().querySelector('.ss-w-editable-form input').value = 'Ren';
    screen().querySelector('.ss-w-editable-save').click();
    await settle(); await settle();
    assert.equal(host.sdk.query('dataModules.view', { module: 'pack.chat/contacts' }).chat.people, 'Mara; Teo; Ren');
    assert.deepEqual(screen().querySelectorAll('.ss-w-editable-value-list .ss-chip').map(node => node.textContent), ['Mara', 'Teo', 'Ren']);
});

test('number and choice fields show a meter and a choice pill', async t => {
    const { doc, host, ui } = await page(t);
    const built = buildBlock({ name: 'Status', fields: [
        { name: 'Fatigue', type: 'number', min: 0, max: 10, default: 6 },
        { name: 'Mood', type: 'choice', values: ['calm', 'wary'], default: 'wary' },
    ], functions: [], prompt: '', show: { tab: true, card: false, tabName: 'Status', icon: 'ph-star' } });
    assert.equal((await host.sdk.command('dm.define', { definition: built.definition })).ok, true);
    ui.mounts.screen.open('story-block/block/status');
    const screen = doc.querySelector('.ss-gameview [data-ss-screen="story-block/block/status"]');
    const meter = screen.querySelector('.ss-w-editable-meter');
    assert.equal(meter.getAttribute('aria-valuenow'), '6');
    assert.equal(meter.getAttribute('aria-valuemax'), '10');
    assert.equal(screen.querySelector('.ss-w-editable-value .ss-pill').textContent, 'wary');
});

test('a block button can be pressed from its tab and its Home card on separate replies', async t => {
    const { doc, host, ui } = await page(t);
    const built = buildBlock({ name: 'Camp', fields: [{ name: 'Rest', type: 'number', min: 0, max: 10, default: 0 }], prompt: '',
        show: { tab: true, card: true, tabName: 'Camp', icon: 'ph-star' }, functions: [
            { type: 'button', name: 'Breathe', effects: [{ field: 'rest', op: 'add', value: 1 }] },
        ] });
    assert.equal((await host.sdk.command('dm.define', { definition: built.definition })).ok, true);
    ui.mounts.screen.open('story-block/block/camp');
    button(doc.querySelector('.ss-gameview [data-ss-screen="story-block/block/camp"]'), 'Breathe').click();
    await settle(); await settle();
    assert.equal(host.sdk.query('dataModules.view', { module: 'pack.chat/camp' }).chat.rest, 1);
    await host.send('Again.', 'A quiet hour.');
    ui.mounts.screen.open('story-block/home');
    button(doc.querySelector('.ss-gameview [data-ss-screen="story-block/home"]'), 'Breathe').click();
    await settle(); await settle();
    assert.equal(host.sdk.query('dataModules.view', { module: 'pack.chat/camp' }).chat.rest, 2);
});

test('the block menu exports a checked pack through the shared download helper', async t => {
    const { doc, host, ui } = await page(t), blobs = [], filenames = [];
    doc.defaultView.Blob = class { constructor(parts, options) { this.parts = parts; this.type = options.type; } };
    doc.defaultView.URL = { createObjectURL: blob => { blobs.push(blob); return 'blob:test'; }, revokeObjectURL() {} };
    const create = doc.createElement;
    doc.createElement = tag => {
        const node = create(tag);
        if (tag === 'a') node.addEventListener('click', () => filenames.push(node.download));
        return node;
    };
    const built = buildBlock({ name: 'Pack notes', fields: [{ name: 'Mood', type: 'text', max: 30, default: 'calm' }], functions: [], prompt: '',
        show: { tab: true, card: false, tabName: 'Notes', icon: 'ph-star' } });
    assert.equal((await host.sdk.command('dm.define', { definition: built.definition })).ok, true);
    const screen = blocksPage(ui)();
    input(screen, fill(P.menuFor, { name: 'Pack notes' })).click();
    button(screen, S.exportPack).click();
    assert.deepEqual(filenames, ['pack-notes.pack.json']);
    assert.equal(blobs[0].type, 'application/json;charset=utf-8');
    assert.equal(JSON.parse(blobs[0].parts[0]).content.dataModules[0].state.mood.default, 'calm');
});
