// Settings → Blocks (view/settings/blocks.js, screens/blocks.js `page`): the blocks of the open story, one row each with Show as, Edit and a
// more menu; Hidden (no tab and no card, the block still works); no Blocks tab in the game view; a story must be open.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { mountUi } from '../../../src/v2/ui-host.js';
import { buildBlock } from '../../../src/v2/data-modules/block-builder.js';
import { validateDataModules } from '../../../src/v2/data-modules/check.js';
import { STRINGS, fill } from '../../../src/v2/strings.js';
import { LEAN_RPG_FEATURE } from '../../../src/v2/lean-rpg/index.js';
import { setupDom } from '../view/mounts/helpers.js';

const S = STRINGS.blocks;
const P = S.page;
const settle = () => new Promise(resolve => setImmediate(resolve));
const button = (root, text) => root.querySelectorAll('button').find(node => node.textContent === text);
const input = (root, name) => root.querySelector(`[aria-label="${name}"]`);

async function page(t, { confirmAnswer = true } = {}) {
    const doc = setupDom(), form = doc.createElement('div'); form.id = 'send_form'; doc.body.appendChild(form);
    doc.defaultView = { confirm: () => confirmAnswer };
    const host = await createHost(), ui = mountUi({ runtime: host, ctx: host.ctx, doc });
    t.after(() => { ui.destroy(); host.close(); });
    await host.send('Begin.', 'Opening.');
    return { doc, host, ui };
}
const open = ui => {
    const win = ui.openSettings();
    win.select('blocks');
    return { win, screen: () => win.root.querySelector('[data-ss-section="blocks"]') };
};
const rowOf = (screen, name) => screen.querySelectorAll('.ss-blockrow').find(node => node.querySelector('.ss-blockrow-name').textContent === name);
const define = async (host, spec) => {
    const built = buildBlock({ prompt: '', functions: [], ...spec });
    assert.equal(built.ok, true, JSON.stringify(built.errors));
    assert.equal((await host.sdk.command('dm.define', { definition: built.definition })).ok, true);
};
const ledger = { name: 'Ledger', fields: [{ name: 'Coin', type: 'number', min: 0, max: 99, default: 3 }, { name: 'Note', type: 'text', max: 40, default: '' }],
    functions: [{ type: 'button', name: 'Spend', effects: [{ field: 'coin', op: 'add', value: -1 }] }, { type: 'rule', name: 'Broke', when: { field: 'coin', op: 'le', value: 0 }, effects: [{ field: 'note', op: 'set', value: 'broke' }] }],
    show: { tab: true, card: false, tabName: 'Ledger', icon: 'ph-scroll' } };
const weather = { name: 'Weather journal', fields: [{ name: 'Sky', type: 'text', max: 40, default: 'clear' }],
    show: { tab: false, card: true, tabName: 'Weather', icon: 'ph-sparkle' } };
const select = (screen, name) => input(screen, fill(P.showAsFor, { name }));
const tabIds = ui => ui.screens.list('screen').map(entry => entry.id);

test('the page lists this story\'s blocks: the count line, and a words line for each with its fields, buttons, rules and where it shows', async t => {
    const { host, ui } = await page(t);
    const { screen } = open(ui);
    assert.match(screen().textContent, /No blocks in this story yet/);
    assert.equal(screen().querySelector('.ss-blocks-count'), null);
    assert.ok(button(screen(), S.newBlock) && button(screen(), P.fromTemplate));
    await define(host, ledger);
    await define(host, weather);
    await settle();
    assert.equal(screen().querySelector('.ss-blocks-count').textContent, '2 blocks in this story · 1 tab, 1 card');
    assert.equal(screen().querySelector('.ss-blockrows').children.length, 2);
    assert.equal(rowOf(screen(), 'Ledger').querySelector('.ss-blockrow-meta').textContent, '2 fields · 1 button · 1 rule · tab "Ledger", icon scroll');
    assert.equal(rowOf(screen(), 'Weather journal').querySelector('.ss-blockrow-meta').textContent, '1 field · on Home');
    assert.equal(select(screen(), 'Ledger').value, 'tab');
    assert.equal(select(screen(), 'Weather journal').value, 'card');
    assert.deepEqual(select(screen(), 'Ledger').children.map(node => node.textContent), ['Its own tab', 'A card on Home', 'Both', 'Hidden']);
    assert.match(screen().textContent, /Block templates you save are in Tabs & Packs/);
    assert.deepEqual(ui.tabs.rows().filter(row => /blocks$/.test(row.id)), [], 'no Blocks tab among the tabs');
});

test('Show as moves a block between its own tab, a Home card, both and Hidden; Hidden keeps it working for the story', async t => {
    const { doc, host, ui } = await page(t);
    await define(host, ledger);
    const { screen } = open(ui);
    const choose = async value => { const box = select(screen(), 'Ledger'); box.value = value; box.dispatch('change'); await settle(); await settle(); };
    assert.ok(tabIds(ui).includes('story-block/block/ledger'));
    await choose('both');
    assert.ok(tabIds(ui).includes('story-block/block/ledger'));
    assert.match(screen().querySelector('.ss-block-status').textContent, /Ledger is now shown as: Both/);
    assert.equal(select(screen(), 'Ledger').value, 'both');
    assert.equal(screen().querySelector('.ss-blocks-count').textContent, '1 block in this story · 1 tab, 1 card');
    await choose('card');
    assert.ok(!tabIds(ui).includes('story-block/block/ledger'), 'the tab goes');
    assert.equal(rowOf(screen(), 'Ledger').querySelector('.ss-blockrow-meta').textContent, '2 fields · 1 button · 1 rule · on Home');
    ui.openSettings().close();
    ui.mounts.screen.open('story-block/home');
    assert.match(doc.querySelector('.ss-gameview [data-ss-screen="story-block/home"]').textContent, /Ledger/, 'a card on Home');
    const again = open(ui);
    const hide = async value => { const box = select(again.screen(), 'Ledger'); box.value = value; box.dispatch('change'); await settle(); await settle(); };
    await hide('hidden');
    assert.equal(select(again.screen(), 'Ledger').value, 'hidden');
    assert.equal(again.screen().querySelector('.ss-blocks-count').textContent, '1 block in this story · none shown');
    assert.equal(rowOf(again.screen(), 'Ledger').querySelector('.ss-blockrow-meta').textContent, '2 fields · 1 button · 1 rule · hidden');
    assert.ok(!tabIds(ui).includes('story-block/block/ledger'), 'no tab');
    again.win.close();
    ui.mounts.screen.open('story-block/home');
    assert.doesNotMatch(doc.querySelector('.ss-gameview [data-ss-screen="story-block/home"]').textContent, /Ledger/, 'no card');
    // Still a block of the story: pinned, its fields set, its button pressed, its lines in the prompt's rules for the story.
    const row = host.sdk.query('dataModules.setup').find(entry => entry.module === 'pack.chat/ledger');
    assert.equal(row.pinned, true);
    assert.deepEqual(row.pinnedDefinition.show, { tab: false, card: false, tabName: 'Ledger', icon: 'ph-scroll' }, 'the name and icon are kept for when it shows again');
    assert.equal((await host.sdk.command('dm.act', { module: 'pack.chat/ledger', kind: 'button-spend' })).ok, true);
    assert.equal(host.sdk.query('dataModules.view', { module: 'pack.chat/ledger' }).chat.coin, 2);
    // and it can show again
    const back = open(ui);
    const box = select(back.screen(), 'Ledger'); box.value = 'tab'; box.dispatch('change'); await settle(); await settle();
    assert.ok(tabIds(ui).includes('story-block/block/ledger'));
    assert.equal(host.sdk.query('dataModules.view', { module: 'pack.chat/ledger' }).chat.coin, 2, 'its values stay');
});

test('the editor\'s Show as has Hidden too, and a block made hidden is listed with no tab and no card', async t => {
    const { host, ui } = await page(t);
    const { screen } = open(ui);
    button(screen(), S.newBlock).click();
    input(screen(), S.name).value = 'Quiet';
    button(screen(), S.addField).click();
    const chip = button(screen(), S.hidden);
    assert.ok(chip, 'a Hidden choice');
    chip.click();
    assert.equal(button(screen(), S.hidden).getAttribute('aria-pressed'), 'true');
    assert.equal(button(screen(), S.ownTab).getAttribute('aria-pressed'), 'false');
    button(screen(), S.save).click();
    await settle(); await settle();
    assert.equal(select(screen(), 'Quiet').value, 'hidden');
    assert.ok(!tabIds(ui).includes('story-block/block/quiet'));
    assert.deepEqual(host.sdk.query('dataModules.setup')[0].pinnedDefinition.show.tab, false);
    // editing it again shows Hidden chosen
    input(screen(), fill(P.editFor, { name: 'Quiet' })).click();
    assert.equal(button(screen(), S.hidden).getAttribute('aria-pressed'), 'true');
});

test('the checker takes a show with neither tab nor card, and still refuses a malformed one', () => {
    const definition = show => ({ slug: 'plain', name: 'Plain', schema: 1, stateVersion: 1, scope: 'chat', state: { mood: { type: 'text', max: 20, default: '' } }, kinds: {}, show });
    const check = show => validateDataModules([definition(show)], { packId: 'chat', capabilities: ['data-modules-v1'] });
    assert.equal(check({ tab: false, card: false, tabName: 'Plain', icon: 'ph-star' }).ok, true);
    assert.equal(check({ tab: false, card: false, tabName: '', icon: 'ph-star' }).ok, false);
    assert.equal(check({ tab: false, card: 'no', tabName: 'Plain', icon: 'ph-star' }).ok, false);
    assert.equal(check({ tab: false, card: false, tabName: 'Plain', icon: 'not-an-icon' }).ok, false);
});

test('the ⋯ menu saves a template and removes a block after asking; a refusal to remove changes nothing', async t => {
    const { host, ui } = await page(t, { confirmAnswer: false });
    await define(host, ledger);
    const { screen } = open(ui);
    const menu = () => input(screen(), fill(P.menuFor, { name: 'Ledger' }));
    menu().click();
    assert.deepEqual(rowOf(screen(), 'Ledger').querySelectorAll('.ss-block-menu button').map(node => node.textContent), [S.saveTemplate, S.exportPack, S.removeBlock]);
    button(screen(), S.saveTemplate).click();
    await settle();
    assert.equal(host.ctx.extensionSettings.storySuite.blockTemplates[0].name, 'Ledger');
    assert.match(screen().querySelector('.ss-block-status').textContent, /Template saved/);
    menu().click();
    button(screen(), S.removeBlock).click();
    await settle();
    assert.ok(rowOf(screen(), 'Ledger'), 'the question was refused: nothing removed');
    const sure = await page(t, { confirmAnswer: true });
    await define(sure.host, ledger);
    const again = open(sure.ui);
    input(again.screen(), fill(P.menuFor, { name: 'Ledger' })).click();
    button(again.screen(), S.removeBlock).click();
    await settle(); await settle();
    assert.equal(rowOf(again.screen(), 'Ledger'), undefined);
    assert.match(again.screen().textContent, /Removed Ledger/);
    assert.match(again.screen().textContent, /No blocks in this story yet/);
    assert.ok(!tabIds(sure.ui).includes('story-block/block/ledger'));
});

test('with no chat open the page says that blocks belong to a story, and offers nothing to make', async t => {
    const { host, ui } = await page(t);
    await define(host, ledger);
    host.ctx.chatId = '';
    const { screen } = open(ui);
    assert.equal(screen().textContent.includes(P.noChat), true);
    assert.equal(screen().querySelectorAll('button').length, 0);
    assert.equal(screen().querySelector('.ss-blockrow'), null);
});

test('search finds the page by a block\'s name or where it shows, and leaves the others out', async t => {
    const { host, ui } = await page(t);
    await define(host, ledger);
    await define(host, weather);
    const { win, screen } = open(ui);
    const search = text => { const box = win.root.querySelector('.ss-search-input'); box.value = text; box.dispatch('input'); };
    search('weather');
    assert.equal(win.root.querySelector('[data-ss-section="blocks"]').hidden, false);
    assert.equal(rowOf(screen(), 'Weather journal').hidden, false);
    assert.equal(rowOf(screen(), 'Ledger').hidden, true);
    search('on home');
    assert.equal(rowOf(screen(), 'Weather journal').hidden, false);
    assert.equal(rowOf(screen(), 'Ledger').hidden, true);
    search('zzzz');
    assert.equal(win.root.querySelector('[data-ss-section="blocks"]').hidden, true);
    search('');
    assert.equal(rowOf(screen(), 'Ledger').hidden, false);
});

test('an RPG block shows its RPG place and cannot be moved while the RPG is on; with it off the choice is the same as any block\'s', async t => {
    const { host, ui } = await page(t);
    await define(host, { name: 'Wessel', role: 'character', fields: [{ name: 'Health', type: 'number', min: 0, max: 5, default: 5 }],
        show: { tab: true, card: false, tabName: 'Wessel', icon: 'ph-heart' } });
    let { screen } = open(ui);
    assert.equal(rowOf(screen(), 'Wessel').querySelector('.ss-blockrow-role').textContent, 'RPG · Character');
    assert.equal(select(screen(), 'Wessel').disabled, false, 'the RPG is off: it is an ordinary block with a tab');
    assert.equal(screen().querySelector('.ss-blocks-count').textContent, '1 block in this story · 1 tab');
    host.features.set(LEAN_RPG_FEATURE, true);
    await settle(); await settle();
    screen = () => ui.openSettings().root.querySelector('[data-ss-section="blocks"]');
    assert.equal(select(screen(), 'Wessel').disabled, true);
    assert.equal(select(screen(), 'Wessel').children.map(node => node.textContent).join(), 'Party tab (RPG)');
    assert.equal(screen().querySelector('.ss-blocks-count').textContent, '1 block in this story · none shown');
});

test('Escape closes an open ⋯ menu first and leaves the settings window open', async t => {
    const { host, ui } = await page(t);
    await define(host, ledger);
    const { win, screen } = open(ui);
    const toggle = () => input(screen(), fill(P.menuFor, { name: 'Ledger' }));
    toggle().click();
    assert.equal(toggle().getAttribute('aria-expanded'), 'true');
    toggle().dispatch('keydown', { key: 'Escape' });
    assert.equal(toggle().getAttribute('aria-expanded'), 'false');
    assert.equal(win.isOpen(), true);
});
