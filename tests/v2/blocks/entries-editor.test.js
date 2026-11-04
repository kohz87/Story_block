// The block editor with the List of entries type: starters, the Layout and why, card roles, status colours, Show in tab, the live preview, and the stored
// block (builder, editable hash, templates, export). The editor is drawn on its own here; the data side is in tests/v2/data-modules/entries.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderBlockEditor } from '../../../src/v2/screens/blocks-editor.js';
import { buildBlock, blockDraft, editableBlockDraft, blockKindCount } from '../../../src/v2/data-modules/block-builder.js';
import { BLOCK_STARTERS } from '../../../src/v2/data-modules/block-starters.js';
import { layoutShape, cardRoles } from '../../../src/v2/data-modules/block-layout.js';
import { createBlockTemplates, exportBlockPack } from '../../../src/v2/data-modules/block-templates.js';
import { validatePack } from '../../../src/v2/packs/validate.js';
import { STRINGS } from '../../../src/v2/strings.js';
import { setupDom } from '../view/mounts/helpers.js';

const S = STRINGS.blocks;
const newDraft = () => ({ name: '', fields: [], functions: [], prompt: '', show: { tab: true, card: false, tabName: '', icon: 'ph-bookmark-simple' } });
const starter = id => BLOCK_STARTERS.find(item => item.id === id);

function editor(t, { draft = newDraft(), starters = true, tabs = [], renderPreview = null, confirm = () => true } = {}) {
    const doc = setupDom();
    doc.defaultView = { confirm };
    const root = doc.createElement('div'); doc.body.appendChild(root);
    const saved = [];
    const handle = renderBlockEditor(root, { draft, starters, tabs, renderPreview, used: [], onCancel() {}, onSave: async definition => { saved.push(definition); return { ok: true }; } });
    t.after(() => handle.destroy());
    const all = label => root.querySelectorAll(`[aria-label="${label}"]`);
    const buttonOf = text => root.querySelectorAll('button').find(node => node.textContent === text || node.querySelector?.('b')?.textContent === text);
    const set = (node, value) => { node.value = value; node.dispatch('change'); };
    const text = selector => root.querySelectorAll(selector).map(node => node.textContent);
    const save = async () => { buttonOf(S.save).click(); await new Promise(resolve => setImmediate(resolve)); return saved.at(-1); };
    return { root, draft, saved, all, buttonOf, set, text, save, handle };
}

test('New block offers the starters and Quest log fills the form: a list of entries, the cards layout and the card roles', async t => {
    const e = editor(t);
    assert.deepEqual(e.root.querySelectorAll('.ss-block-starter').map(node => node.querySelector('b').textContent), ['Empty', 'Quest log', 'Reputation by place', 'Membership card']);
    assert.equal(e.root.querySelector('.ss-block-starter-on').querySelector('b').textContent, 'Empty');
    e.buttonOf('Quest log').click();
    assert.equal(e.draft.name, 'Quest log');
    assert.equal(e.root.querySelector('.ss-block-starter-on').querySelector('b').textContent, 'Quest log');
    assert.match(e.text('.ss-block-starters p').join(' '), /Filled: 1 field, the List of cards layout, and the card roles\. Change any of it before you save\./);
    assert.deepEqual(e.draft.fields[0].of.map(part => part.name), ['Title', 'Description', 'Step', 'Status', 'Giver', 'Reward']);
    assert.deepEqual(e.draft.fields[0].of[3].values, ['active', 'done', 'failed']);
    assert.equal(e.root.querySelector('.ss-block-layout .ss-chip-on').textContent, S.layoutCards);
    const definition = await e.save();
    assert.equal(definition.layout, 'cards');
    assert.deepEqual(definition.roles, { field: 'quests', title: 'title', status: 'status', step: 'step' });
    assert.equal(definition.state.quests.type, 'entries');
    assert.equal(definition.show.tabName, 'Quests');
    assert.deepEqual(Object.keys(definition.kinds), ['add-quests', 'set-quests', 'drop-quests']);
    assert.equal(definition.tones, undefined, 'tones are stored only where the author changed them');
});

test('starters are not offered when editing, and a starter asks before it replaces fields', async t => {
    const none = editor(t, { starters: false });
    assert.equal(none.root.querySelector('.ss-block-starters'), null);
    let asked = 0;
    const e = editor(t, { confirm: () => { asked++; return false; } });
    e.buttonOf('Quest log').click();
    assert.equal(asked, 0, 'an empty form is filled without asking');
    e.buttonOf('Reputation by place').click();
    assert.equal(asked, 1);
    assert.equal(e.draft.fields[0].type, 'entries', 'refused: the fields stay');
    e.buttonOf('Empty').click();
    assert.equal(asked, 2);
    assert.equal(e.draft.fields.length, 1);
});

test('the layout is preselected from the shape, says why, and a layout that does not fit is off with its reason', async t => {
    const e = editor(t);
    assert.ok(e.buttonOf(S.layoutCards).disabled && e.buttonOf(S.layoutBars).disabled && e.buttonOf(S.layoutFields).disabled, 'an empty form has all three off');
    assert.equal(e.text('.ss-block-layout-why')[0], S.layoutEmpty);
    e.buttonOf('Reputation by place').click();
    assert.equal(e.root.querySelector('.ss-block-layout .ss-chip-on').textContent, S.layoutBars);
    assert.equal(e.buttonOf(S.layoutCards).disabled, true);
    assert.equal(e.buttonOf(S.layoutBars).disabled, false);
    assert.match(e.text('.ss-block-layout-why')[0], /^Set by the Reputation by place starter\. All 4 of your fields are numbers with a range\.$/);
    assert.match(e.text('.ss-block-layout-reason').join('|'), /List of cards: A list of cards needs a List of entries field with a text part/);
    e.buttonOf('Quest log').click();
    assert.equal(e.buttonOf(S.layoutBars).disabled, true);
    assert.match(e.text('.ss-block-layout-reason').join('|'), /Numbers with bars: Bars need every field to be a number; not a number: Quests\./);
    e.buttonOf('Membership card').click();
    assert.equal(e.root.querySelector('.ss-block-layout .ss-chip-on').textContent, S.layoutFields);
    assert.match(e.text('.ss-block-layout-why')[0], /Your block holds one record: 5 different fields\.$/);
    // Card of fields always fits; choosing a chip sticks and says so.
    e.buttonOf(S.layoutFields).click();
    assert.match(e.text('.ss-block-layout-why')[0], /^Chosen by you\. /);
});

test('a layout that stops fitting falls back to the one the shape suggests, with one line, and Save still works', async t => {
    const e = editor(t);
    e.buttonOf('Reputation by place').click();
    e.buttonOf(S.addField).click();
    e.set(e.all(S.fieldTypeLabel).at(-1), 'text');
    assert.equal(e.draft.layout, 'fields', 'the numbers now share the form with a text');
    assert.equal(e.root.querySelector('.ss-block-layout .ss-chip-on').textContent, S.layoutFields);
    assert.equal(e.text('.ss-block-layout-why')[0], 'Your block changed shape, so the layout is now Card of fields.');
    const definition = await e.save();
    assert.equal(definition.layout, 'fields');
    assert.equal(definition.roles, undefined);
});

test('card roles are three selects over the list\'s parts; a rename follows; None sticks; the story\'s unknown status is neutral', async t => {
    const e = editor(t);
    e.buttonOf('Quest log').click();
    assert.deepEqual(['Title', 'Status', 'Step'].map(label => e.all(label).length > 0), [true, true, true]);
    assert.match(e.text('.ss-block-roles small').join(' '), /Also on the card: Description under the title, and Giver, Reward in a small line\./);
    // Step -> None
    e.set(e.all(S.roleStep)[0], '');
    assert.equal(e.draft.roles.step, '');
    assert.match(e.text('.ss-block-roles small').join(' '), /Description under the title, and Step, Giver, Reward in a small line/);
    // rename the Title part: the role follows its key
    e.set(e.all(S.partName)[0], 'Quest name');
    assert.equal(e.draft.roles.title, 'questname');
    // a status colour, only where it differs from the default; an added value stays neutral
    e.set(e.all('active')[0], 'neutral');
    e.set(e.all(S.choices).at(0), 'active, done, failed, on hold');
    e.all(S.choices)[0].dispatch('change');
    const definition = await e.save();
    assert.deepEqual(definition.roles, { field: 'quests', title: 'questname', status: 'status' });
    assert.deepEqual(definition.tones, { active: 'neutral' });
    assert.deepEqual(definition.state.quests.of.status.values, ['active', 'done', 'failed', 'on hold']);
});

test('removing the part a role names guesses another one and says so; a block with two lists lets the author choose', async t => {
    const e = editor(t);
    e.buttonOf('Quest log').click();
    e.buttonOf(S.remove).click();
    assert.equal(e.draft.fields[0].of.length, 5);
    assert.equal(e.draft.roles.title, 'description', 'the first text part now');
    assert.equal(cardRoles({ ...e.draft, roles: { ...e.draft.roles, title: 'title' } }).guessed, true);
    assert.match(e.text('.ss-block-roles small').join(' '), new RegExp(S.rolesGuessed.replace('.', '\\.')));
});

test('Show in tab lists the tabs this chat has; a tab joined hides the name and icons and asks for a section heading', async t => {
    const tabs = [{ id: 'reputation', title: 'Reputation' }];
    const e = editor(t, { tabs });
    e.buttonOf('Quest log').click();
    assert.ok(e.all(S.showInTab)[0]);
    assert.ok(e.all(S.tabName)[0], 'its own tab by default: tab name and icons');
    e.set(e.all(S.showInTab)[0], 'reputation');
    assert.equal(e.all(S.tabName).length, 0);
    assert.ok(e.all(S.showHeading)[0]);
    assert.equal(e.root.querySelectorAll('.ss-block-icons').length, 0);
    assert.match(e.text('.ss-block-preview small').join(' '), /Drawn as a section of the Reputation tab\./);
    const definition = await e.save();
    assert.equal(definition.show.into, 'reputation');
    assert.equal(definition.show.tabName, 'Quests');
    // with no tab to join, the select is not drawn; with Card on Home it is off with its reason
    const alone = editor(t);
    assert.equal(alone.all(S.showInTab).length, 0);
    const card = editor(t, { tabs });
    card.buttonOf(S.card).click();
    assert.equal(card.all(S.showInTab)[0].disabled, true);
    assert.match(card.text('.ss-block-show small').join(' '), new RegExp(S.showNeedsTab));
});

test('the preview is drawn under the layout, redraws with a role or a colour, and hands the host\'s drawer the built definition', async t => {
    const calls = [];
    const e = editor(t, { renderPreview: (parent, info) => { calls.push(info); return { destroy() {} }; } });
    assert.match(e.text('.ss-block-preview-body').join(' '), /Nothing to preview until the block has fields/);
    e.buttonOf('Quest log').click();
    const last = calls.at(-1);
    assert.equal(last.layout, 'cards');
    assert.equal(last.definition.roles.title, 'title');
    assert.equal(last.values.quests.length, 2);
    assert.deepEqual(last.values.quests.map(entry => entry.status), ['active', 'done'], 'the second example is finished, so the fold has something');
    const before = calls.length;
    e.set(e.all(S.roleStep)[0], '');
    assert.ok(calls.length > before);
    assert.equal(calls.at(-1).definition.roles.step, undefined);
    assert.match(e.text('.ss-block-preview small').join(' '), /Drawn in its own tab "Quests"\./);
    // the preview is a child of the form, right after the layout section (so that it can stay in view below the fields above it)
    const form = e.root.querySelector('.ss-block-editor'), layout = e.root.querySelector('.ss-block-layout');
    assert.equal(form.children[form.children.indexOf(layout) + 1].className.includes('ss-block-preview'), true);
});

test('without a host drawer the preview sketches cards with their chips, bars, and lines', async t => {
    const e = editor(t);
    e.buttonOf('Quest log').click();
    assert.equal(e.root.querySelectorAll('.ss-block-sketch-card').length, 2);
    assert.match(e.text('.ss-block-sketch-fold summary')[0], /Finished \(1\)/);
    assert.equal(e.root.querySelectorAll('.ss-block-tone-done').length >= 1, true);
    e.buttonOf('Reputation by place').click();
    assert.equal(e.root.querySelectorAll('.ss-block-sketch-bar').length, 4);
    e.buttonOf('Membership card').click();
    assert.equal(e.root.querySelectorAll('.ss-block-sketch-line').length, 5);
});

test('a List of entries field is edited with its parts: add, remove, at most eight, and a plain error beside a bad part', async t => {
    const e = editor(t);
    e.set(e.all(S.name)[0], 'Journal');
    e.buttonOf(S.addField).click();
    e.set(e.all(S.fieldTypeLabel)[0], 'entries');
    assert.equal(e.draft.fields[0].type, 'entries');
    assert.equal(e.draft.fields[0].of.length, 1);
    assert.equal(blockKindCount(e.draft), 3, 'a list uses three lines');
    for (let n = 0; n < 7; n++) e.buttonOf(S.addPart).click();
    assert.equal(e.draft.fields[0].of.length, 8);
    assert.equal(e.buttonOf(S.addPart).disabled, true);
    // two parts that read as the same word cannot be told apart by a story line
    e.set(e.all(S.partName)[1], 'Title');
    buttonSave(e);
    assert.match(e.text('.ss-block-part [role="alert"]').join('|'), /one lowercase word/);
    assert.equal(e.saved.length, 0);
});
function buttonSave(e) { e.buttonOf(S.save).click(); }

test('the stored block: builder, draft and editable hash agree for entries, layout, roles, tones and show.into', () => {
    const draft = starter('quest-log').draft();
    draft.tones = { done: 'neutral', failed: 'active' };
    draft.show.into = 'goals';
    const built = buildBlock(draft);
    assert.equal(built.ok, true, JSON.stringify(built.errors));
    assert.deepEqual(built.definition.tones, { done: 'neutral', failed: 'active' });
    assert.equal(built.definition.show.into, 'goals');
    assert.equal(built.definition.state.quests.max, 30);
    const back = editableBlockDraft(built.checked);
    assert.ok(back, 'the editor can open the block it wrote');
    assert.deepEqual(back.roles, draft.roles);
    assert.deepEqual(back.tones, draft.tones);
    assert.equal(back.layout, 'cards');
    assert.equal(back.show.into, 'goals');
    assert.deepEqual(buildBlock(back).checked, built.checked, 'draft -> block -> draft -> block gives the same block');
    // joining a tab needs a tab of its own
    const card = starter('quest-log').draft();
    card.show = { tab: false, card: true, tabName: 'Q', icon: 'ph-star', into: 'goals' };
    assert.equal(buildBlock(card).definition.show.into, undefined);
});

test('the builder refuses a role that names a missing part or one of the wrong kind, with the form\'s own words', () => {
    const bad = change => {
        const draft = starter('quest-log').draft();
        change(draft);
        const built = buildBlock(draft);
        assert.equal(built.ok, false);
        return built.errors[0];
    };
    assert.match(bad(d => { d.roles.title = 'status'; }).message, /part of the entry of the right kind/);
    assert.match(bad(d => { d.roles.step = 'nope'; }).message, /part of the entry of the right kind/);
    assert.match(bad(d => { d.layout = 'bars'; }).message, /every field to be a number/);
    assert.match(bad(d => { d.fields[0].of.push({ name: 'At', type: 'text', max: 5, default: '' }); }).message, /word|part/i);
    assert.match(bad(d => { d.fields[0].of = []; }).message, /1 to 8 parts/);
    assert.match(bad(d => { d.fields[0].max = 80; }).message, /1 to 50/);
});

test('templates keep the new keys and open in the editor; an export of them asks for Story Block 2.22', async () => {
    const built = buildBlock(starter('quest-log').draft());
    const settings = {}, templates = createBlockTemplates({ read: () => settings });
    assert.equal((await templates.put(built.checked)).ok, true);
    const [saved] = templates.list();
    assert.equal(saved.definition.layout, 'cards');
    assert.deepEqual(saved.definition.roles, built.checked.roles);
    assert.ok(editableBlockDraft(saved.definition), 'a saved template opens as a form');
    const exported = exportBlockPack(built.checked);
    assert.equal(exported.ok, true, JSON.stringify(exported.errors));
    assert.equal(exported.pack.requires.storyBlock, '^2.22.0');
    assert.equal(validatePack(exported.text, { hostVersion: '2.22.0' }).ok, true);
    assert.equal(validatePack(exported.text).ok, false, 'an older Story Block refuses it by its version');
    // a block with none of the new keys keeps the old requirement
    const plain = buildBlock({ name: 'Notes', fields: [{ name: 'Mood', type: 'text', max: 30, default: 'calm' }], functions: [], prompt: '', show: { tab: true, card: false, tabName: 'Notes', icon: 'ph-star' } });
    assert.equal(exportBlockPack(plain.checked).pack.requires.storyBlock, '^2');
});

test('an old block opens as it was; saving it gives it the layout its shape suggests, and its lines are the same', async t => {
    const old = buildBlock({ name: 'Mood', fields: [{ name: 'Calm', type: 'number', min: 0, max: 5, default: 1 }, { name: 'Fear', type: 'number', min: 0, max: 5, default: 0 }],
        functions: [], prompt: 'How the party feels.', show: { tab: true, card: false, tabName: 'Mood', icon: 'ph-heart' } });
    assert.equal(old.definition.layout, undefined);
    const draft = editableBlockDraft(old.checked);
    const e = editor(t, { draft, starters: false });
    assert.equal(e.root.querySelector('.ss-block-layout .ss-chip-on').textContent, S.layoutBars, 'preselected from the shape');
    assert.equal(draft.layout, undefined, 'nothing is stored until Save');
    const definition = await e.save();
    assert.equal(definition.layout, 'bars');
    assert.deepEqual(definition.kinds, old.definition.kinds);
    assert.deepEqual(definition.state, old.definition.state);
});

test('layoutShape names the right suggestion for each shape', () => {
    assert.equal(layoutShape(newDraft()).suggested, null);
    assert.equal(layoutShape(starter('quest-log').draft()).suggested, 'cards');
    assert.equal(layoutShape(starter('reputation').draft()).suggested, 'bars');
    assert.equal(layoutShape(starter('membership').draft()).suggested, 'fields');
    const onlyNumbers = layoutShape({ fields: [{ name: 'A', type: 'entries', of: [{ key: 'n', name: 'N', type: 'number' }] }] });
    assert.equal(onlyNumbers.fits.cards.ok, false, 'a list needs a text part for the card title');
    assert.equal(onlyNumbers.suggested, 'fields');
});

// --- the whole host: define, story lines, redefine, the tab as plain rows, Show as ---
import { createHost } from '../../../testkit/index.js';
import { mountUi } from '../../../src/v2/ui-host.js';
import { dataModuleDefaults, validateDataMigration, validateDataModules } from '../../../src/v2/data-modules/check.js';

async function hostWith(t, draft = starter('quest-log').draft()) {
    const doc = setupDom(), form = doc.createElement('div'); form.id = 'send_form'; doc.body.appendChild(form);
    doc.defaultView = { confirm: () => true };
    const host = await createHost(), ui = mountUi({ runtime: host, ctx: host.ctx, doc });
    t.after(() => { ui.destroy(); host.close(); });
    await host.send('Begin.', 'Opening.');
    const built = buildBlock(draft);
    assert.equal(built.ok, true, JSON.stringify(built.errors));
    const defined = await host.sdk.command('dm.define', { definition: built.definition });
    assert.equal(defined.ok, true, JSON.stringify(defined));
    return { doc, host, ui, built };
}
const reply = (...lines) => `The story.\n<Changes>\n${lines.join('\n')}\n</Changes>`;

test('a block made from the Quest log starter takes the story\'s lines and its tab lists the entries as quest cards (pinned change, INT-222: the starter has roles, so BLOCKS draws cards, not plain rows)', async t => {
    const { doc, host, ui } = await hostWith(t);
    await host.send('Help.', reply('+ dm quest-log — asked | kind: add-quests | title: Find the key | step: Ask the smith | giver: Widow Hale',
        '+ dm quest-log — second | kind: add-quests | title: Warn the mill'));
    await host.send('Go.', reply('~ dm quest-log — talked | kind: set-quests | at: 1 | status: done'));
    const quests = host.sdk.query('dataModules.view', { module: 'pack.chat/quest-log' }).chat.quests;
    assert.deepEqual(quests.map(entry => [entry.title, entry.status, entry.giver]), [['Find the key', 'done', 'Widow Hale'], ['Warn the mill', 'active', '']]);
    assert.equal(ui.mounts.screen.open('story-block/block/quest-log'), true);
    const tab = doc.querySelector('.ss-gameview [data-ss-screen="story-block/block/quest-log"]').textContent;
    assert.match(tab, /Active \(1\)/);
    assert.match(tab, /Finished \(1\)/);
    assert.match(tab, /Find the key/);
    assert.match(tab, /Warn the mill/);
});

test('saving the block again keeps its entries; a change of type drops them; a block that joins a tab keeps doing so when Show as changes', async t => {
    const { host, built } = await hostWith(t);
    await host.send('Help.', reply('+ dm quest-log — asked | kind: add-quests | title: Find the key'));
    const again = buildBlock({ ...blockDraft(built.checked), slug: 'quest-log', show: { ...built.definition.show, into: 'reputation' } });
    assert.equal(again.ok, true, JSON.stringify(again.errors));
    assert.equal((await host.sdk.command('dm.redefine', { module: 'pack.chat/quest-log', definition: again.definition })).ok, true);
    assert.deepEqual(host.sdk.query('dataModules.view', { module: 'pack.chat/quest-log' }).chat.quests.map(entry => entry.title), ['Find the key']);
    const flat = buildBlock({ name: 'Quest log', slug: 'quest-log', fields: [{ key: 'quests', name: 'Quests', type: 'text', max: 20, default: '' }], functions: [], prompt: '',
        show: built.definition.show });
    assert.equal((await host.sdk.command('dm.redefine', { module: 'pack.chat/quest-log', definition: flat.definition })).ok, true);
    assert.equal(host.sdk.query('dataModules.view', { module: 'pack.chat/quest-log' }).chat.quests, '', 'a different type starts again at its default');
});

test('a migration may add a List of entries field; it starts empty', () => {
    const base = { name: 'Notes', fields: [{ name: 'Mood', type: 'text', max: 30, default: 'calm' }], functions: [], prompt: '', show: { tab: true, card: false, tabName: 'Notes', icon: 'ph-star' } };
    const one = buildBlock(base);
    const field = { type: 'entries', max: 5, of: { title: { type: 'text', max: 20, default: '' } } };
    const next = JSON.parse(JSON.stringify(one.definition));
    next.stateVersion = 2; next.state.log = field; next.migrations = [{ from: 1, to: 2, add: { log: field } }];
    const options = { packId: 'chat', capabilities: ['data-modules-v1'] };
    const target = validateDataModules([next], options), old = validateDataModules([one.definition], options);
    assert.equal(target.ok, true, JSON.stringify(target.errors));
    assert.equal(validateDataMigration(old.definitions[0], target.definitions[0]).ok, true);
    assert.deepEqual(dataModuleDefaults(target.definitions[0].state).log, []);
});
