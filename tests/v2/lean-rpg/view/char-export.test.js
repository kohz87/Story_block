// Export / Import a character on the real page: the Export button on each Party card and its dialog, the file it saves, the Import row on the
// New character wizard's Who step, what an import fills (and does not), Create adding the things and the money in one reply that one swipe
// takes back, what cannot be added being named, the RPG off having none of it, and the dialogs being opaque.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHAR_FILE, parseCharacterFile } from '../../../../src/v2/lean-rpg/charfile.js';
import { STATS } from '../../../../src/v2/lean-rpg/index.js';
import { EXPORT_SCREEN_ID, EXPORT_WIDGET } from '../../../../src/v2/lean-rpg/view/export.js';
import { WIZARD_SCREEN_ID } from '../../../../src/v2/lean-rpg/view/wizard.js';
import { reload } from '../../data-modules/helpers.js';
import { begin, fieldsOf, makeBlocks, page, party, settle } from './page.js';
import { characterDefinition, skillsDefinition } from './helpers.js';

const goTo = async (dialog, step) => { dialog.goTo(['who', 'stats', 'skills', 'review'].indexOf(step)); await settle(); return dialog.root.querySelector('.ss-w-rpg-wizard'); };
const wizardOf = dialog => dialog.root.querySelector('.ss-w-rpg-wizard');
const exportOf = dialog => dialog.root.querySelector('.ss-w-rpg-export');
const type = (node, value) => { node.value = value; node.dispatch('input'); };
const click = (root, text) => root.querySelectorAll('button').find(node => node.textContent === text)?.click();
const file = (name, text) => ({ name, size: text.length, text: async () => text });

// What the saved-file download does on the fake page: every Blob it was given and the name it was saved as.
function captureSaves(ctx) {
    const saves = [];
    ctx.doc.defaultView.Blob = class { constructor(parts, options) { this.text = parts.join(''); this.type = options.type; } };
    ctx.doc.defaultView.URL = { createObjectURL: blob => { saves.push({ blob }); return 'blob:test'; }, revokeObjectURL() {} };
    const create = ctx.doc.createElement;
    ctx.doc.createElement = tag => {
        const node = create(tag);
        if (tag === 'a') node.addEventListener('click', () => { saves.at(-1).name = node.download; });
        return node;
    };
    return saves;
}

const WESSEL = { str: 14, vit: 12, agi: 11, dex: 10, int: 8, luk: 9, cha: 10, points: 3, soul: 2, xp: 40, health: 3, mana: 2, stamina: 1, about: 'A drill-yard washout from Bluewatch.' };
const WESSEL_SKILLS = { skill1: 'Iron Breath', about1: 'Steadies the lungs in a long fight.', stat1: 'vit', uses1: 'stamina', rank1: 2, practice1: 55,
    skill2: 'Short blade', about2: 'Quick cuts at close range.', stat2: 'agi', uses2: 'stamina', rank2: 0, practice2: 10 };

// A story with Wessel (you, with skills, a bedroll, a coat, two torches and a purse) and, when asked, Ren (a companion).
async function story(t, { companion = false, purse = 50, things = true } = {}) {
    const ctx = await page(t, { persona: 'Wessel' });
    await begin(ctx.host);
    await makeBlocks(ctx.host, { who: 'Wessel', character: WESSEL, skills: WESSEL_SKILLS });
    if (companion) await makeBlocks(ctx.host, { who: 'Ren' });
    if (things) {
        for (const payload of [{ name: 'Bedroll', qty: 1 }, { name: 'Oilskin Coat', qty: 1, note: 'waxed, a little too big', kind: 'equipment', rarity: 'uncommon' }, { name: 'Torch', qty: 2 }]) {
            const added = await ctx.host.sdk.command('inventory.add', payload);
            assert.equal(added.ok, true, added.message);
        }
    }
    if (purse) assert.equal((await ctx.host.sdk.command('wallet.set', { amount: purse })).ok, true);
    await settle();
    return ctx;
}
async function exportDialog(ctx, who = 'Wessel') {
    ctx.ui.mounts.screen.open('story-block/party');
    await settle();
    party(ctx.doc).querySelector(`.rpg-card[data-character="${who}"] .rpg-export-open`).click();
    await settle();
    return ctx.ui.mounts.dialog.current();
}
async function saveFrom(ctx, who = 'Wessel') {
    const saves = captureSaves(ctx);
    const dialog = await exportDialog(ctx, who);
    exportOf(dialog).querySelector('.rpg-exp-save').click();
    await settle();
    assert.equal(saves.length, 1, 'one file saved');
    return { text: saves[0].blob.text, name: saves[0].name, type: saves[0].blob.type, dialog };
}
async function wizardWith(ctx, { empty = false } = {}) {
    ctx.ui.mounts.screen.open('story-block/party');
    await settle();
    party(ctx.doc).querySelector(empty ? '.rpg-create' : '.rpg-new').click();
    await settle();
    return ctx.ui.mounts.dialog.current();
}
async function importInto(dialog, text, name = 'wessel.character.json') {
    const input = wizardOf(dialog).querySelector('.rpg-import-file');
    input.files = [file(name, text)];
    input.dispatch('change');
    await settle();
}
const names = host => Object.keys(host.head().domains.dataModules?.active ?? {}).sort();
const carried = host => host.sdk.query('inventory.items', {}).map(item => `${item.name}${item.qty === 1 ? '' : ` ×${item.qty}`}`).sort();
const purseOf = host => host.sdk.query('inventory.wallet', { owner: 'party' }).coin ?? 0;
const receiptTypes = host => host.ctx.chat.flatMap(message => message.extra?.storySuite?.receipts ?? []).map(receipt => receipt.type);

// ---- Export ------------------------------------------------------------------------------------------------------------------------

test('Export is on every Party card, after Spend points and Skills, and opens a dialog named for the character', async t => {
    const ctx = await story(t, { companion: true });
    ctx.ui.mounts.screen.open('story-block/party');
    await settle();
    const cards = party(ctx.doc).querySelectorAll('.rpg-card');
    assert.equal(cards.length, 2);
    for (const card of cards) {
        const labels = card.querySelectorAll('.rpg-card-actions button').map(node => node.textContent);
        assert.equal(labels.at(-1), 'Export', 'Export closes the row');
        assert.ok(labels.length >= 2, 'beside the card\'s other buttons');
        assert.equal(card.querySelector('.rpg-export-open').getAttribute('aria-label'), `Export ${card.getAttribute('data-character')}`);
    }
    assert.deepEqual(party(ctx.doc).querySelector('.rpg-card[data-character="Wessel"] .rpg-card-actions').querySelectorAll('button').map(node => node.textContent), ['Spend points', 'Skills', 'Export']);
    const dialog = await exportDialog(ctx);
    assert.equal(dialog.screenId, EXPORT_SCREEN_ID);
    assert.equal(dialog.root.querySelector('.ss-dialog-title').textContent, 'Export Wessel');
    assert.equal(dialog.root.getAttribute('aria-label'), 'Export Wessel');
    assert.ok(exportOf(dialog));
    dialog.close();
    assert.equal(ctx.ui.mounts.dialog.current(), null);
});

test('the dialog says what is saved: the character always, the things and the money as options, and what is not saved', async t => {
    const ctx = await story(t);
    const dialog = await exportDialog(ctx);
    const root = exportOf(dialog);
    assert.match(root.textContent, /Saves a file you can import when you make a character in another chat\. The name and who they are stay in this chat\./);
    const option = key => root.querySelector(`[data-option="${key}"]`);
    assert.match(option('character').textContent, /Character/);
    assert.match(option('character').textContent, /Soul Class II · 3 points to spend/);
    assert.match(option('character').textContent, /STR 14 · VIT 12 · AGI 11 · DEX 10 · INT 8 · LUK 9 · CHA 10/);
    assert.match(option('character').textContent, /Skills: Iron Breath \(Expert\) · Short blade \(Novice\)/);
    const always = option('character').querySelector('input');
    assert.deepEqual([always.checked, always.disabled], [true, true], 'the character is always saved');
    assert.match(option('inventory').textContent, /Inventory · 3 things/);
    assert.match(option('inventory').textContent, /Oilskin Coat \(waxed, a little too big\) · Bedroll · Torch ×2/);
    assert.equal(option('inventory').querySelector('input').checked, true, 'on');
    assert.match(option('money').textContent, /Money · 50 gold/);
    assert.match(option('money').textContent, /Kept as its value, so another game's coins show it in their own words\./);
    assert.equal(option('money').querySelector('input').checked, true, 'on');
    assert.equal(root.querySelector('.rpg-exp-notsaved').textContent, 'Not saved: the name, who they are, XP, Health, Mana and Stamina (a new character starts full), skill practice, and anything about the story.');
    assert.equal(root.querySelector('.rpg-exp-save .rpg-exp-file').textContent, 'wessel.character.json');
    assert.deepEqual(root.querySelectorAll('.rpg-exp-actions button').map(node => node.textContent), ['Cancel', 'Save' + 'wessel.character.json']);
    click(root, 'Cancel');
    assert.equal(ctx.ui.mounts.dialog.current(), null, 'Cancel closes it and saves nothing');
});

test('Save writes <name>.character.json with the character, the things and the money, and only those', async t => {
    const ctx = await story(t);
    const saved = await saveFrom(ctx);
    assert.equal(saved.name, 'wessel.character.json');
    assert.equal(saved.type, 'application/json;charset=utf-8');
    assert.equal(ctx.ui.mounts.dialog.current(), null, 'saved: the dialog closes');
    const data = JSON.parse(saved.text);
    assert.deepEqual(Object.keys(data), [CHAR_FILE, 'soul', 'points', 'stats', 'skills', 'items', 'money']);
    assert.deepEqual([data[CHAR_FILE], data.soul, data.points, data.money], [1, 2, 3, 50]);
    assert.deepEqual(data.stats, { str: 14, vit: 12, agi: 11, dex: 10, int: 8, luk: 9, cha: 10 });
    assert.deepEqual(data.skills, [
        { name: 'Iron Breath', about: 'Steadies the lungs in a long fight.', stat: 'vit', uses: 'stamina', rank: 2 },
        { name: 'Short blade', about: 'Quick cuts at close range.', stat: 'agi', uses: 'stamina', rank: 0 },
    ]);
    assert.deepEqual(data.items, [
        { name: 'Oilskin Coat', qty: 1, note: 'waxed, a little too big', kind: 'equipment', rarity: 'uncommon' },
        { name: 'Bedroll', qty: 1, kind: 'goods', rarity: 'common' },
        { name: 'Torch', qty: 2, kind: 'goods', rarity: 'common' },
    ], 'names, counts, notes, kind and rarity, in the order the Inventory tab lists them (equipment first)');
    // Nothing of the rest: not the name or who they are, XP, Health/Mana/Stamina, or practice, anywhere in the text.
    for (const word of ['Bluewatch', '"who"', '"about": "A drill', '"xp"', 'health', 'practice', 'stamina": 1', '"name": "Wessel"']) assert.ok(!saved.text.includes(word), word);
    assert.equal(parseCharacterFile(saved.text).ok, true, 'Import reads what Export wrote');
});

test('with the options off the file has neither the things nor the money, and an empty bag or purse leaves them off by itself', async t => {
    const ctx = await story(t);
    const saves = captureSaves(ctx);
    const dialog = await exportDialog(ctx);
    for (const key of ['inventory', 'money']) {
        const box = exportOf(dialog).querySelector(`[data-option="${key}"] input`);
        box.checked = false;
        box.dispatch('change');
    }
    assert.equal(exportOf(dialog).querySelector('[data-option="inventory"] input').checked, false, 'it stays off when the dialog is drawn again');
    exportOf(dialog).querySelector('.rpg-exp-save').click();
    await settle();
    const data = JSON.parse(saves[0].blob.text);
    assert.deepEqual(Object.keys(data), [CHAR_FILE, 'soul', 'points', 'stats', 'skills']);

    const bare = await story(t, { things: false, purse: 0 });
    const empty = await exportDialog(bare);
    const root = exportOf(empty);
    assert.match(root.querySelector('[data-option="inventory"]').textContent, /Inventory · nothing carried/);
    assert.match(root.querySelector('[data-option="money"]').textContent, /Money · nothing in the purse/);
    assert.deepEqual([root.querySelector('[data-option="inventory"] input').disabled, root.querySelector('[data-option="money"] input').disabled], [true, true]);
    const more = captureSaves(bare);
    root.querySelector('.rpg-exp-save').click();
    await settle();
    assert.deepEqual(Object.keys(JSON.parse(more[0].blob.text)), [CHAR_FILE, 'soul', 'points', 'stats', 'skills']);
});

test('money only on your own card: a companion\'s dialog has the character and its things, never the purse', async t => {
    const ctx = await story(t, { companion: true });
    const dialog = await exportDialog(ctx, 'Ren');
    const root = exportOf(dialog);
    assert.equal(dialog.root.querySelector('.ss-dialog-title').textContent, 'Export Ren');
    assert.ok(root.querySelector('[data-option="character"]'));
    assert.ok(root.querySelector('[data-option="inventory"]'));
    assert.equal(root.querySelector('[data-option="money"]'), null);
    // Nobody but the party's bag holds things here, so Ren carries nothing; the bag is Wessel's.
    assert.match(root.querySelector('[data-option="inventory"]').textContent, /Inventory · nothing carried/);
    const saves = captureSaves(ctx);
    root.querySelector('.rpg-exp-save').click();
    await settle();
    const data = JSON.parse(saves[0].blob.text);
    assert.equal(saves[0].name, 'ren.character.json');
    assert.equal(Object.hasOwn(data, 'money'), false);
    assert.equal(Object.hasOwn(data, 'items'), false);
    assert.deepEqual(data.skills, [], 'Ren has no skills yet');
    assert.deepEqual([data.soul, data.points], [1, 0]);
});

// A stand-in for a party module: it lists the party's people, so the inventory knows who can hold things.
const PARTY_STUB = actors => ({ id: 'party-stub', version: '1.0.0', queries: { 'party.actors': () => actors } });
const REN = { id: 'ac_ren00001', name: 'Ren' };

test('a companion with a party actor of the same name carries what that actor holds, and a You also carries the bag', async t => {
    const ctx = await page(t, { persona: 'Wessel', modules: [PARTY_STUB([REN])] });
    await begin(ctx.host);
    await makeBlocks(ctx.host, { who: 'Wessel', character: WESSEL, skills: WESSEL_SKILLS });
    await makeBlocks(ctx.host, { who: 'Ren' });
    for (const payload of [{ name: 'Bedroll', qty: 1 }, { name: 'Whistle', qty: 1, note: 'tin', owner: REN.id }, { name: 'Rope', qty: 3, owner: REN.id }]) {
        const added = await ctx.host.sdk.command('inventory.add', payload);
        assert.equal(added.ok, true, added.message);
    }
    await settle();
    const ren = await exportDialog(ctx, 'Ren');
    assert.match(exportOf(ren).querySelector('[data-option="inventory"]').textContent, /Inventory · 2 things/);
    assert.match(exportOf(ren).querySelector('[data-option="inventory"]').textContent, /Rope ×3 · Whistle \(tin\)/);
    assert.ok(!exportOf(ren).querySelector('[data-option="inventory"]').textContent.includes('Bedroll'), 'the party\'s bag is not Ren\'s');
    ren.close();
    const wessel = await exportDialog(ctx, 'Wessel');
    assert.match(exportOf(wessel).querySelector('[data-option="inventory"]').textContent, /Inventory · 1 thing\s*Bedroll/);
    assert.ok(!exportOf(wessel).querySelector('[data-option="inventory"]').textContent.includes('Whistle'));
});

// ---- Import (the New character wizard) ----------------------------------------------------------------------------------------------

// A saved Wessel, written the way Export writes it, to import into another chat.
const SAVED = JSON.stringify({
    [CHAR_FILE]: 1, soul: 2, points: 3, stats: { str: 14, vit: 12, agi: 11, dex: 10, int: 8, luk: 9, cha: 10 },
    skills: [{ name: 'Iron Breath', about: 'Steadies the lungs in a long fight.', stat: 'vit', uses: 'stamina', rank: 2 }, { name: 'Short blade', about: 'Quick cuts at close range.', stat: 'agi', uses: 'stamina', rank: 0 }],
    items: [{ name: 'Oilskin Coat', qty: 1, note: 'waxed, a little too big', kind: 'equipment', rarity: 'uncommon' }, { name: 'Bedroll', qty: 1 }, { name: 'Torch', qty: 2 }], money: 50,
});
const without = (...keys) => JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(SAVED)).filter(([key]) => !keys.includes(key))));

// Another chat that has Wessel already, so the import makes a companion (Ren).
async function newcomer(t, options = {}) {
    const ctx = await page(t, { persona: 'Wessel', ...options });
    await begin(ctx.host);
    await makeBlocks(ctx.host, { who: 'Wessel' });
    await settle();
    return ctx;
}
const companion = async (dialog, name = 'Ren', about = 'A ferry hand from Low Quay.') => {
    click(wizardOf(dialog), 'A companion');
    type(wizardOf(dialog).querySelector('[data-wiz="name"]'), name);
    type(wizardOf(dialog).querySelector('[data-wiz="about"]'), about);
};

test('the RPG off: no Export button, no Import row, no dialogs of either', async t => {
    const off = await page(t, { feature: false, persona: 'Wessel' });
    await begin(off.host);
    await settle();
    assert.equal(off.loads.length, 0, 'the RPG screens were never loaded');
    assert.equal(off.ui.screens.resolve(EXPORT_SCREEN_ID), null);
    assert.equal(off.ui.screens.resolve(WIZARD_SCREEN_ID), null);
    assert.equal(off.doc.querySelector('.rpg-export-open'), null);
    assert.equal(off.doc.querySelector('.rpg-import'), null);
    // On: the screens are there; off again: they go.
    const ctx = await story(t);
    assert.ok(ctx.ui.screens.resolve(EXPORT_SCREEN_ID));
    ctx.ui.mounts.screen.open('story-block/party');
    await settle();
    assert.equal(party(ctx.doc).querySelectorAll('.rpg-export-open').length, 1);
    ctx.ui.mounts.screen.close?.();
    ctx.host.features.set('story-block.rpg', false);
    await settle();
    assert.equal(ctx.ui.screens.resolve(EXPORT_SCREEN_ID), null, 'switched off: the Export dialog is gone');
    assert.equal(ctx.ui.screens.resolve(WIZARD_SCREEN_ID), null);
    assert.equal(ctx.doc.querySelector('.rpg-export-open'), null);
    assert.equal(ctx.ui.mounts.dialog.current(), null);
    assert.equal(EXPORT_WIDGET, 'rpg.export');
});

test('the Who step starts with "Start from a saved character" and an Import file button, before the name', async t => {
    const ctx = await page(t, { persona: 'Wessel' });
    await begin(ctx.host);
    const dialog = await wizardWith(ctx, { empty: true });
    const who = wizardOf(dialog);
    const row = who.querySelector('.rpg-import');
    assert.ok(row);
    assert.equal(row.querySelector('.rpg-import-text').textContent, 'Start from a saved character: its stats, unspent points, Soul Class, skills, inventory and money.');
    assert.equal(row.querySelector('button').textContent, 'Import file…');
    assert.equal(row.querySelector('input').getAttribute('type'), 'file');
    assert.equal(row.querySelector('input').getAttribute('accept'), '.json,application/json');
    assert.equal(who.querySelector('.rpg-wiz-body').children[0], row, 'first on the step');
    let opened = 0;
    row.querySelector('input').click = () => { opened += 1; };
    row.querySelector('button').click();
    assert.equal(opened, 1, 'the button opens the file picker');
    for (const step of ['stats', 'skills', 'review']) assert.equal((await goTo(dialog, step)).querySelector('.rpg-import'), null, `not on ${step}`);
    dialog.close();
});

test('a good file fills the stats, the unspent points, the Soul Class and the skills; the name, You or a companion and who they are stay', async t => {
    const ctx = await newcomer(t);
    const dialog = await wizardWith(ctx);
    await companion(dialog);
    await importInto(dialog, SAVED);
    const who = wizardOf(dialog);
    assert.deepEqual([who.querySelector('[data-wiz="name"]').value, who.querySelector('[data-wiz="about"]').value], ['Ren', 'A ferry hand from Low Quay.'], 'name and who they are are not touched');
    assert.deepEqual(who.querySelectorAll('.rpg-wiz-seg button').map(node => node.getAttribute('aria-pressed')), ['false', 'true'], 'still a companion');
    assert.equal(who.querySelector('.rpg-import'), null, 'the row gives way to the note');
    const done = who.querySelector('[data-wiz="import-done"]');
    assert.equal(done.textContent, 'Imported from wessel.character.json: stats, 3 unspent points, Soul Class II and 2 skills. When you press Create it also adds 3 things to the party\'s bag and 50 gold to the purse. Give the character a name and who they are below.Undo import');
    assert.equal(done.getAttribute('role'), 'status');
    assert.equal(who.querySelector('.rpg-wiz-sum .rpg-wiz-sub').textContent, 'Companion · Soul Class II');
    assert.equal(who.querySelector('.rpg-wiz-push').textContent, 'Points left: 3');
    assert.match(who.querySelector('.rpg-wiz-sum').textContent, /STR 14 · VIT 12 · AGI 11 · DEX 10 · INT 8 · LUK 9 · CHA 10/);
    assert.match(who.querySelector('.rpg-wiz-sum').textContent, /Iron Breath \(Expert\), Short blade \(Novice\)/);
    assert.match(who.textContent, /Starts at Soul Class II \(imported\) with 0 XP\. Health, Mana and Stamina start full\./);

    // The Stats step: the file's stats, the file's points to spend, the usual limits.
    const stats = await goTo(dialog, 'stats');
    const field = stat => stats.querySelector(`.rpg-stat-step[data-stat="${stat}"]`);
    assert.equal(stats.querySelector('.rpg-wiz-push').textContent, 'Points left: 3');
    assert.deepEqual(STATS.map(stat => Number(field(stat).querySelector('input').value)), [14, 12, 11, 10, 8, 9, 10]);
    assert.match(stats.textContent, /These are the saved character's stats\. Spend the 3 points from the file/);
    const inc = (stat, n = 1) => { for (let at = 0; at < n; at += 1) wizardOf(dialog).querySelector(`.rpg-stat-step[data-stat="${stat}"] .ss-w-stepper-inc`).click(); };
    inc('int', 3);
    assert.equal(wizardOf(dialog).querySelector('.rpg-wiz-push').textContent, 'Points left: 0');
    assert.equal(wizardOf(dialog).querySelector('.rpg-stat-step[data-stat="luk"] .ss-w-stepper-inc').disabled, true, 'no points left');
    click(wizardOf(dialog), 'Reset');
    assert.equal(wizardOf(dialog).querySelector('.rpg-wiz-push').textContent, 'Points left: 3', 'Reset goes back to the file\'s stats');
    assert.deepEqual(STATS.map(stat => Number(wizardOf(dialog).querySelector(`.rpg-stat-step[data-stat="${stat}"] input`).value)), [14, 12, 11, 10, 8, 9, 10]);

    // The Skills step: the file's skills, their ranks shown and not typeable, the rest editable.
    const skills = await goTo(dialog, 'skills');
    const rows = skills.querySelectorAll('.rpg-wiz-row[data-skill]');
    assert.deepEqual(rows.map(row => row.querySelector('[data-field="name"]').value), ['Iron Breath', 'Short blade']);
    assert.deepEqual(rows.map(row => row.querySelector('[data-field="stat"]').value), ['vit', 'agi']);
    const rank = row => row.querySelector('[data-field="start"]');
    assert.deepEqual(rows.map(row => [rank(row).value, rank(row).disabled]), [['2', true], ['0', true]]);
    assert.deepEqual(rank(rows[0]).querySelectorAll('option').map(node => node.textContent), ['Novice', 'Adept', 'Expert', 'Master']);
    assert.match(skills.textContent, /Ranks come from the saved file/);
    type(rows[0].querySelector('[data-field="name"]'), 'Iron Lung');
    assert.match(wizardOf(dialog).querySelector('.rpg-wiz-sum').textContent, /Iron Lung \(Expert\), Short blade \(Novice\)/, 'a skill can be renamed, its rank stays');
    click(wizardOf(dialog), '+ Add a skill');
    const added = wizardOf(dialog).querySelectorAll('.rpg-wiz-row[data-skill]')[2];
    assert.deepEqual([Boolean(added.querySelector('[data-field="start"]').disabled), added.querySelector('[data-field="start"]').querySelectorAll('option').length], [false, 2], 'a new skill follows the usual rules');
    dialog.close();
});

test('stats the file put above 15 or below 8 stay where they were; the rest keep the usual 8 to 15', async t => {
    const ctx = await newcomer(t);
    const dialog = await wizardWith(ctx);
    const saved = JSON.parse(SAVED);
    saved.stats = { ...saved.stats, str: 18, cha: 3 };
    await importInto(dialog, JSON.stringify(saved));
    const stats = await goTo(dialog, 'stats');
    const step = (stat, dir) => wizardOf(dialog).querySelector(`.rpg-stat-step[data-stat="${stat}"] .ss-w-stepper-${dir}`);
    assert.equal(stats.querySelector('.rpg-stat-step[data-stat="str"] input').value, '18');
    assert.deepEqual([step('str', 'inc').disabled, step('str', 'dec').disabled], [true, false], 'STR 18 can go down, not further up');
    assert.deepEqual([step('cha', 'dec').disabled, step('cha', 'inc').disabled], [true, false], 'CHA 3 can come up (to 15), not further down');
    for (let n = 0; n < 4; n += 1) step('str', 'dec').click();
    assert.equal(wizardOf(dialog).querySelector('.rpg-wiz-push').textContent, 'Points left: 7', 'STR 14 frees four');
    assert.equal(step('str', 'dec').disabled, false, 'down to 8');
    dialog.close();
});

test('Undo import puts the wizard back as it was before, and Import file is offered again', async t => {
    const ctx = await newcomer(t);
    const dialog = await wizardWith(ctx);
    await companion(dialog);
    await goTo(dialog, 'stats');
    wizardOf(dialog).querySelector('.rpg-stat-step[data-stat="str"] .ss-w-stepper-inc').click();
    wizardOf(dialog).querySelector('.rpg-stat-step[data-stat="str"] .ss-w-stepper-inc').click();
    await goTo(dialog, 'who');
    await importInto(dialog, SAVED);
    assert.equal(wizardOf(dialog).querySelector('.rpg-wiz-push').textContent, 'Points left: 3');
    click(wizardOf(dialog), 'Undo import');
    const who = wizardOf(dialog);
    assert.ok(who.querySelector('.rpg-import'), 'Import file is back');
    assert.equal(who.querySelector('[data-wiz="import-done"]'), null);
    assert.equal(who.querySelector('.rpg-wiz-push').textContent, 'Points left: 4', 'the two points spent before the import are back as they were');
    assert.match(who.querySelector('.rpg-wiz-sum').textContent, /STR 12 · VIT 10/);
    assert.equal(who.querySelector('.rpg-wiz-sub').textContent, 'Companion · Soul Class I');
    assert.equal(who.querySelector('[data-wiz="name"]').value, 'Ren');
    const skills = await goTo(dialog, 'skills');
    assert.equal(skills.querySelectorAll('.rpg-wiz-row[data-skill]').length, 0, 'the imported skills are gone');
    const review = await goTo(dialog, 'review');
    assert.equal(review.querySelector('[data-review="import-also"]'), null, 'and nothing more will be added');
    // And a file can be imported again.
    await goTo(dialog, 'who');
    await importInto(dialog, SAVED);
    assert.ok(wizardOf(dialog).querySelector('[data-wiz="import-done"]'));
    dialog.close();
});

test('a bad file is refused in plain words and the wizard is left exactly as it was', async t => {
    const ctx = await newcomer(t);
    const dialog = await wizardWith(ctx);
    await companion(dialog);
    const before = wizardOf(dialog).querySelector('.rpg-wiz-sum').textContent;
    const bad = [
        ['notes.txt', 'just some words', /not a saved character: the file could not be read\./],
        ['pack.json', JSON.stringify({ id: 'a-pack' }), /not a saved character file\./],
        ['future.json', JSON.stringify({ ...JSON.parse(SAVED), [CHAR_FILE]: 2 }), /newer version/],
        ['stat.json', JSON.stringify({ ...JSON.parse(SAVED), stats: { ...JSON.parse(SAVED).stats, luk: 99 } }), /no valid LUK \(1 to 20\)/],
        ['money.json', JSON.stringify({ ...JSON.parse(SAVED), money: -1 }), /money in the file is not a whole number/],
        ['empty.json', '', /file is empty/],
    ];
    for (const [name, text, pattern] of bad) {
        await importInto(dialog, text, name);
        const alert = wizardOf(dialog).querySelector('.rpg-import-error');
        assert.match(alert?.textContent ?? '', pattern, name);
        assert.equal(alert.getAttribute('role'), 'alert');
        assert.equal(wizardOf(dialog).querySelector('[data-wiz="import-done"]'), null, name);
        assert.equal(wizardOf(dialog).querySelector('.rpg-wiz-sum').textContent, before, `${name}: nothing was filled`);
        assert.equal(wizardOf(dialog).querySelector('[data-wiz="name"]').value, 'Ren');
    }
    // A file too big is not even read; one that cannot be read says so.
    let read = false;
    const input = wizardOf(dialog).querySelector('.rpg-import-file');
    input.files = [{ name: 'big.json', size: 70000, text: async () => { read = true; return SAVED; } }];
    input.dispatch('change');
    await settle();
    assert.equal(read, false);
    assert.match(wizardOf(dialog).querySelector('.rpg-import-error').textContent, /too big/);
    const gone = wizardOf(dialog).querySelector('.rpg-import-file');
    gone.files = [{ name: 'gone.json', size: 4, text: async () => { throw new Error('gone'); } }];
    gone.dispatch('change');
    await settle();
    assert.equal(wizardOf(dialog).querySelector('.rpg-import-error').textContent, 'gone.json could not be read.');
    const none = wizardOf(dialog).querySelector('.rpg-import-file');
    none.files = [];
    none.dispatch('change');
    await settle();
    assert.equal(wizardOf(dialog).querySelector('.rpg-wiz-sum').textContent, before);
    // A good file after the bad ones works, and the old error is gone.
    await importInto(dialog, SAVED);
    assert.equal(wizardOf(dialog).querySelector('.rpg-import-error'), null);
    assert.ok(wizardOf(dialog).querySelector('[data-wiz="import-done"]'));
    dialog.close();
});

test('a file with no things or money says nothing about them; one with them says so on the Review', async t => {
    const ctx = await newcomer(t);
    let dialog = await wizardWith(ctx);
    await companion(dialog);
    await importInto(dialog, without('items', 'money'));
    assert.equal(wizardOf(dialog).querySelector('[data-wiz="import-done"]').textContent, 'Imported from wessel.character.json: stats, 3 unspent points, Soul Class II and 2 skills. Give the character a name and who they are below.Undo import');
    let review = await goTo(dialog, 'review');
    assert.equal(review.querySelector('[data-review="import-also"]'), null);
    assert.match(review.textContent, /Starts at Soul Class II \(imported\), 0 XP, full Health, Mana and Stamina\./);
    assert.match(review.textContent, /Iron Breath · VIT · Stamina · starts at Expert/);
    assert.match(review.textContent, /3 unspent points go to Spend points on the Party tab\./);
    dialog.close();

    dialog = await wizardWith(ctx);
    await companion(dialog);
    await importInto(dialog, without('money'));
    assert.match(wizardOf(dialog).querySelector('[data-wiz="import-done"]').textContent, /When you press Create it also adds 3 things to the party's bag\./);
    dialog.close();

    dialog = await wizardWith(ctx);
    await companion(dialog);
    await importInto(dialog, SAVED);
    review = await goTo(dialog, 'review');
    assert.equal(review.querySelector('[data-review="import-also"]').textContent, 'Also adds: 3 things to the party\'s bag · 50 gold to the purse. One swipe of this reply takes it all back.');
    assert.match(review.querySelector('[data-review="also"]').textContent, /^Also adds: Combat rules, Foes\.$|^Also adds: /, 'the blocks line is the one it always was');
    dialog.close();
    // A purse of 0 and no things in the file: nothing to add, nothing said.
    dialog = await wizardWith(ctx);
    await companion(dialog);
    await importInto(dialog, JSON.stringify({ ...JSON.parse(SAVED), items: [], money: 0 }));
    assert.equal((await goTo(dialog, 'review')).querySelector('[data-review="import-also"]'), null);
    dialog.close();
});

test('the money is told in this chat\'s coins, and the file keeps only its value', async t => {
    const first = await story(t, { purse: 0 });
    first.host.settings.set('story-block', 'coins', [{ name: 'copper', value: 1 }, { name: 'silver', value: 10 }]);
    await first.host.sdk.command('wallet.set', { amount: 50 });
    await settle();
    const dialog = await exportDialog(first);
    assert.match(exportOf(dialog).querySelector('[data-option="money"]').textContent, /Money · 5 silver/);
    dialog.close();
    const saved = await saveFrom(first);
    assert.equal(JSON.parse(saved.text).money, 50, 'the value in the smallest unit, not a coin word');

    const other = await newcomer(t);
    other.host.settings.set('story-block', 'currency', 'crown');
    other.host.settings.set('story-block', 'currencyPlural', 'crowns');
    const wizard = await wizardWith(other);
    await companion(wizard);
    await importInto(wizard, saved.text);
    assert.match(wizardOf(wizard).querySelector('[data-wiz="import-done"]').textContent, /adds 3 things to the party's bag and 50 crowns to the purse/, 'another game\'s words for the same value');
    wizard.close();

    const silver = await newcomer(t);
    silver.host.settings.set('story-block', 'coins', [{ name: 'copper', value: 1 }, { name: 'silver', value: 10 }]);
    const w2 = await wizardWith(silver);
    await companion(w2);
    await importInto(w2, saved.text);
    assert.match(wizardOf(w2).querySelector('[data-wiz="import-done"]').textContent, /adds 3 things to the party's bag and 5 silver to the purse/);
    w2.close();
});

// ---- Create with an import ----------------------------------------------------------------------------------------------------------

async function createRen(ctx, text = SAVED) {
    const dialog = await wizardWith(ctx);
    await companion(dialog);
    await importInto(dialog, text);
    const review = await goTo(dialog, 'review');
    review.querySelector('.rpg-wiz-create').click();
    await settle();
    return dialog;
}

test('Create makes the Character and Skills blocks from the file, adds the things and the money, all in one reply, and one swipe takes it all back', async t => {
    const ctx = await newcomer(t);
    assert.equal((await ctx.host.sdk.command('wallet.set', { amount: 20 })).ok, true);
    const blocksBefore = names(ctx.host);
    const receiptsBefore = receiptTypes(ctx.host).length;
    await createRen(ctx);
    assert.equal(ctx.ui.mounts.dialog.current(), null, 'everything fit: the dialog closes');
    const made = receiptTypes(ctx.host).slice(receiptsBefore);
    assert.deepEqual(made, ['dm.define', 'dm.define', 'dm.define', 'dm.define', 'inventory.add', 'inventory.add', 'inventory.add', 'wallet.set'], 'blocks, then the things, then the purse: no dm.set');
    assert.deepEqual(names(ctx.host), [...blocksBefore, 'pack.chat/combat-rules', 'pack.chat/foes', 'pack.chat/ren', 'pack.chat/ren-skills'].sort());

    const ren = fieldsOf(ctx.host, 'pack.chat/ren'), skills = fieldsOf(ctx.host, 'pack.chat/ren-skills');
    assert.deepEqual([ren.who, ren.about, ren.soul, ren.points, ren.xp, ren.health, ren.mana, ren.stamina, ren.alive], ['Ren', 'A ferry hand from Low Quay.', 2, 3, 0, 5, 4, 4, true],
        'the file\'s Soul Class and points; the reader\'s name and who they are; XP 0 and full bars');
    assert.deepEqual(STATS.map(stat => ren[stat]), [14, 12, 11, 10, 8, 9, 10]);
    assert.deepEqual([skills.who, skills.skill1, skills.about1, skills.stat1, skills.uses1, skills.rank1, skills.practice1, skills.skill2, skills.rank2, skills.skill3], ['Ren', 'Iron Breath', 'Steadies the lungs in a long fight.', 'vit', 'stamina', 2, 0, 'Short blade', 0, '']);
    assert.deepEqual(carried(ctx.host), ['Bedroll', 'Oilskin Coat', 'Torch ×2']);
    const coat = ctx.host.sdk.query('inventory.items', {}).find(item => item.name === 'Oilskin Coat');
    assert.deepEqual([coat.note, coat.kind, coat.rarity, coat.owner, coat.equipped], ['waxed, a little too big', 'equipment', 'uncommon', 'party', null], 'the note, kind and rarity the file kept');
    assert.equal(purseOf(ctx.host), 70, 'the file\'s 50 on top of the 20 already there');

    // The Party tab shows Ren with the imported sheet.
    const card = party(ctx.doc).querySelector('.rpg-card[data-character="Ren"]');
    assert.match(card.textContent, /Iron Breath \(Expert\) · Short blade \(Novice\)/);
    assert.match(card.textContent, /3 points to spend/);

    await reload(ctx.host);
    assert.deepEqual([carried(ctx.host), purseOf(ctx.host)], [['Bedroll', 'Oilskin Coat', 'Torch ×2'], 70], 'reload = live');
    ctx.host.store.rebuild();
    assert.deepEqual([carried(ctx.host), purseOf(ctx.host), names(ctx.host).includes('pack.chat/ren')], [['Bedroll', 'Oilskin Coat', 'Torch ×2'], 70, true], 'rebuild = live');

    await ctx.host.swipe('Another opening.');
    assert.deepEqual(names(ctx.host), [], 'one swipe: the blocks go with the reply');
    assert.deepEqual(carried(ctx.host), [], 'and the things');
    assert.equal(purseOf(ctx.host), 0, 'and the money (the 20 before came from the same reply)');
});

test('the things and the money are the same reply\'s changes as the blocks: a swipe of a later reply leaves them', async t => {
    const ctx = await newcomer(t);
    await ctx.host.send('On.', 'A second reply.');
    await createRen(ctx);
    assert.deepEqual([carried(ctx.host).length, purseOf(ctx.host)], [3, 50]);
    await ctx.host.swipe('A different second reply.');
    assert.deepEqual([names(ctx.host).includes('pack.chat/ren'), carried(ctx.host).length, purseOf(ctx.host)], [false, 0, 0], 'all of it was on the head reply');
});

test('a You takes the things to the bag, a companion with a party actor to that actor', async t => {
    const ctx = await page(t, { persona: 'Wessel', modules: [PARTY_STUB([REN])] });
    await begin(ctx.host);
    let dialog = await wizardWith(ctx, { empty: true });
    await importInto(dialog, SAVED);
    await goTo(dialog, 'review');
    wizardOf(dialog).querySelector('.rpg-wiz-create').click();
    await settle();
    assert.deepEqual([...new Set(ctx.host.sdk.query('inventory.items', {}).map(item => item.owner))], ['party'], 'a You: the party\'s bag');
    assert.equal(fieldsOf(ctx.host, 'pack.chat/wessel').soul, 2);
    dialog = await wizardWith(ctx);
    await companion(dialog, 'Ren');
    await importInto(dialog, without('money'));
    await goTo(dialog, 'review');
    wizardOf(dialog).querySelector('.rpg-wiz-create').click();
    await settle();
    assert.deepEqual(ctx.host.sdk.query('inventory.items', { owner: REN.id }).map(item => item.name).sort(), ['Bedroll', 'Oilskin Coat', 'Torch'], 'Ren has an actor: the things are theirs');
    assert.equal(ctx.host.sdk.query('inventory.items', { owner: 'party' }).length, 3, 'and the bag still has Wessel\'s');
});

test('what cannot be added is named in the window, the character is still made, and the rest is added', async t => {
    const wrap = async (type, payload, options, run) => {
        if (type === 'inventory.add' && payload.name === 'Torch') return { ok: false, code: 'REFUSED', message: 'The party cannot carry that much.' };
        if (type === 'wallet.set') return { ok: false, code: 'REFUSED', message: 'The purse is closed today.' };
        return run(type, payload, options);
    };
    const ctx = await newcomer(t, { wrap });
    await createRen(ctx);
    const open = ctx.ui.mounts.dialog.current();
    assert.ok(open, 'the window stays to say what was not added');
    assert.equal(open.root.querySelector('.rpg-wiz-status').textContent, 'Ren is in the party. Not added: Torch ×2 (The party cannot carry that much.); the money (The purse is closed today.).');
    assert.ok(names(ctx.host).includes('pack.chat/ren') && names(ctx.host).includes('pack.chat/ren-skills'), 'the character is made');
    assert.deepEqual(carried(ctx.host), ['Bedroll', 'Oilskin Coat'], 'the rest was added');
    assert.equal(purseOf(ctx.host), 0);
    click(open.root, 'Done');
    assert.equal(ctx.ui.mounts.dialog.current(), null);
});

test('a thing that is refused and blocks with no room are named together in the one window, and the character is still made', async t => {
    // No room for the Combat rules and Foes blocks (eight own blocks at most) and a refused thing.
    const wrap = async (type, payload, options, run) => (type === 'inventory.add' && payload.name === 'Bedroll' ? { ok: false, message: 'You cannot carry the Bedroll.' } : run(type, payload, options));
    const ctx = await page(t, { persona: 'Wessel', wrap });
    await begin(ctx.host);
    for (const who of ['Wessel', 'Tamsin', 'Mira']) await makeBlocks(ctx.host, { who });
    await settle();
    await createRen(ctx, without('money'));
    const text = ctx.ui.mounts.dialog.current().root.querySelector('.rpg-wiz-status').textContent;
    assert.match(text, /^Ren is in the party\. Not added: Combat rules, Foes\. .*Also not added: Bedroll \(You cannot carry the Bedroll\.\)\.$/);
    assert.ok(names(ctx.host).includes('pack.chat/ren'));
    assert.deepEqual(carried(ctx.host), ['Oilskin Coat', 'Torch ×2']);
});

test('if the character cannot be made nothing of the file is added, and the import is still there to try again', async t => {
    const wrap = async (type, payload, options, run) => (type === 'dm.define' && payload.definition.slug === 'ren' ? { ok: false, message: 'No characters today.' } : run(type, payload, options));
    const ctx = await newcomer(t, { wrap });
    const before = names(ctx.host);
    const dialog = await createRen(ctx);
    assert.deepEqual(carried(ctx.host), []);
    assert.equal(purseOf(ctx.host), 0);
    assert.deepEqual(names(ctx.host), before);
    assert.match(wizardOf(ctx.ui.mounts.dialog.current()).querySelector('.rpg-wiz-status').textContent, /Could not make the character/);
    const again = await goTo(dialog, 'who');
    assert.ok(again.querySelector('[data-wiz="import-done"]'), 'still imported');
    dialog.close();
});

test('an import closed without Create leaves nothing behind: the next wizard starts clean', async t => {
    const ctx = await newcomer(t);
    let dialog = await wizardWith(ctx);
    await importInto(dialog, SAVED);
    dialog.close();
    dialog = await wizardWith(ctx);
    assert.ok(wizardOf(dialog).querySelector('.rpg-import'), 'the row is back');
    assert.equal(wizardOf(dialog).querySelector('.rpg-wiz-push').textContent, 'Points left: 6');
    assert.deepEqual([carried(ctx.host), purseOf(ctx.host)], [[], 0]);
    dialog.close();
});

test('a file read after the window closed changes nothing', async t => {
    const ctx = await newcomer(t);
    const dialog = await wizardWith(ctx);
    const input = wizardOf(dialog).querySelector('.rpg-import-file');
    let release;
    input.files = [{ name: 'slow.json', size: 10, text: () => new Promise(resolve => { release = () => resolve(SAVED); }) }];
    input.dispatch('change');
    dialog.close();
    release();
    await settle();
    const next = await wizardWith(ctx);
    assert.ok(wizardOf(next).querySelector('.rpg-import'), 'the late file was dropped');
    next.close();
});

// ---- the inventory's reader add takes a kind and a rarity for a new item ----------------------------------------------------------------

test('inventory.add with a kind and rarity: a new item has them, one the chat already knows keeps its own, a bad one is refused', async t => {
    const ctx = await page(t, { persona: 'Wessel' });
    await begin(ctx.host);
    const add = payload => ctx.host.sdk.command('inventory.add', payload);
    const row = name => ctx.host.sdk.query('inventory.items', {}).find(item => item.name === name);
    assert.equal((await add({ name: 'Warding Knife', kind: 'equipment', rarity: 'rare' })).ok, true);
    assert.deepEqual([row('Warding Knife').kind, row('Warding Knife').rarity], ['equipment', 'rare']);
    assert.equal((await add({ name: 'Plain Cord' })).ok, true);
    assert.deepEqual([row('Plain Cord').kind, row('Plain Cord').rarity], ['goods', 'common'], 'without them it is as it always was');
    assert.equal((await add({ name: 'plain cord', qty: 2, kind: 'quest', rarity: 'legendary' })).ok, true);
    const cords = ctx.host.sdk.query('inventory.items', {}).filter(item => item.name === 'Plain Cord');
    assert.deepEqual([cords.map(item => item.qty), cords[0].kind, cords[0].rarity], [[3], 'goods', 'common'], 'a known item is not changed by a file');
    const kind = await add({ name: 'Odd Thing', kind: 'relic' });
    assert.deepEqual([kind.ok, kind.code], [false, 'INVALID']);
    assert.match(kind.message, /The kind of an item is one of goods, material, consumable, equipment, quest, money\./);
    const rarity = await add({ name: 'Odd Thing', rarity: 'mythic' });
    assert.deepEqual([rarity.ok, rarity.code], [false, 'INVALID']);
    assert.equal(row('Odd Thing'), undefined, 'nothing was made');
    // Equipment never stacks, whatever the count.
    assert.equal((await add({ name: 'Spare Boot', qty: 2, kind: 'equipment' })).ok, true);
    assert.equal(ctx.host.sdk.query('inventory.items', {}).filter(item => item.name === 'Spare Boot').length, 2);
    await reload(ctx.host);
    assert.deepEqual([row('Warding Knife').kind, row('Warding Knife').rarity], ['equipment', 'rare'], 'reload = live');
});

// ---- the dialogs are opaque -----------------------------------------------------------------------------------------------------------

test('the RPG\'s dialogs are opaque: the party cards behind the New character window must not show through it', () => {
    const css = readFileSync(new URL('../../../../src/v2/lean-rpg/view/lean-rpg.css', import.meta.url), 'utf8');
    const rule = /\.ss-dialog:has\(([^)]*)\) \{([^}]*)\}/.exec(css);
    assert.ok(rule, 'a rule for the dialogs that hold the RPG widgets');
    for (const widget of ['.ss-w-rpg-wizard', '.ss-w-rpg-export', '.ss-w-rpg-hold']) assert.ok(rule[1].includes(widget), `${widget} dialogs`);
    const body = rule[2];
    assert.match(body, /background-color: var\(--ss-sheet-floor, var\(--ss-surface\)\);/, 'an opaque floor under the glass tint');
    assert.match(body, /background-image: linear-gradient\(var\(--ss-sheet-bg, var\(--ss-surface\)\), var\(--ss-sheet-bg, var\(--ss-surface\)\)\);/, 'the glass tint laid over it');
    assert.match(body, /backdrop-filter: none;/);
    assert.doesNotMatch(body, /transparent|rgba|opacity/, 'nothing in it lets the page through');
    // The floor is the one the Game view's own window uses, so the dialog and its surroundings agree.
    assert.match(readFileSync(new URL('../../../../src/v2/view/mounts.css', import.meta.url), 'utf8'), /background-color: var\(--ss-sheet-floor, var\(--ss-surface\)\);/);
    // The widgets named are the ones the dialogs really draw.
    assert.equal(EXPORT_WIDGET.replace('.', '-'), 'rpg-export');
});

// ---- a skill with no stat of its own is never given one ---------------------------------------------------------------------------------

// A Skills block as old chats have it: names, ranks and practice, and no stat, resource or "what it does" fields.
async function oldSkillsBlock(host, who = 'Wessel') {
    const defs = [characterDefinition('wessel', who), skillsDefinition('wessel-skills', who)].map(definition => ({ ...definition, role: definition.slug.endsWith('skills') ? 'skills' : 'character' }));
    defs[0].state.soul = { ...defs[0].state.soul };
    for (const definition of defs) {
        const { state, ...rest } = definition;
        const plain = Object.fromEntries(Object.entries(state).map(([key, { names, ...field }]) => [key, field]));
        const made = await host.sdk.command('dm.define', { definition: { ...rest, state: plain } });
        assert.equal(made.ok, true, `${definition.slug}: ${made.message}`);
    }
    for (const [field, value] of [['skill1', 'Iron Breath'], ['rank1', 2]]) assert.equal((await host.sdk.command('dm.set', { module: 'pack.chat/wessel-skills', field, value })).ok, true);
}

test('a skill whose block has no stat is exported without one: the key is left out, never guessed', async t => {
    const ctx = await page(t, { persona: 'Wessel' });
    await begin(ctx.host);
    await oldSkillsBlock(ctx.host);
    await settle();
    const saved = await saveFrom(ctx);
    const data = JSON.parse(saved.text);
    assert.equal(data.skills.length, 1);
    assert.deepEqual(Object.keys(data.skills[0]), ['name', 'about', 'uses', 'rank'], 'no stat key');
    assert.equal(data.skills[0].name, 'Iron Breath');
    assert.equal(parseCharacterFile(saved.text).ok, true, 'and it reads back');
});

test('the Review asks for the stat of an imported skill that has none, like the missing "what it does" line, and Create waits', async t => {
    const ctx = await newcomer(t);
    const saved = JSON.parse(SAVED);
    delete saved.skills[0].stat;
    saved.skills[1].stat = null;
    saved.skills[0].about = '';
    const dialog = await wizardWith(ctx);
    await companion(dialog);
    await importInto(dialog, JSON.stringify(saved));
    const skills = await goTo(dialog, 'skills');
    const rows = skills.querySelectorAll('.rpg-wiz-row[data-skill]');
    assert.deepEqual(rows.map(row => row.querySelector('[data-field="stat"]').value), ['', ''], 'an empty Stat, not STR');
    assert.deepEqual(rows[0].querySelector('[data-field="stat"]').querySelectorAll('option').map(node => node.textContent), ['—', 'STR', 'VIT', 'AGI', 'DEX', 'INT', 'LUK', 'CHA']);
    let review = await goTo(dialog, 'review');
    assert.deepEqual(review.querySelectorAll('.rpg-wiz-problems li').map(node => node.textContent),
        ['Fix this first:', 'Iron Breath needs a line about what it does.', 'Iron Breath needs a stat.', 'Short blade needs a stat.']);
    assert.equal(review.querySelector('.rpg-wiz-create').disabled, true);
    // Picking the stats (and writing the line) lets Create go; what was picked is what is made.
    await goTo(dialog, 'skills');
    const row = n => wizardOf(dialog).querySelectorAll('.rpg-wiz-row[data-skill]')[n];
    type(row(0).querySelector('[data-field="about"]'), 'Steadies the lungs.');
    for (const [n, stat] of [[0, 'vit'], [1, 'agi']]) { row(n).querySelector('[data-field="stat"]').value = stat; row(n).querySelector('[data-field="stat"]').dispatch('change'); }
    review = await goTo(dialog, 'review');
    assert.ok(wizardOf(dialog).querySelector('.rpg-wiz-problems').hidden);
    review.querySelector('.rpg-wiz-create').click();
    await settle();
    const made = fieldsOf(ctx.host, 'pack.chat/ren-skills');
    assert.deepEqual([made.stat1, made.stat2, made.rank1], ['vit', 'agi', 2]);
});

// ---- where the things will go is said plainly -------------------------------------------------------------------------------------------

test('the things "to the party\'s bag" for a You and for a companion with no party actor; "carried by <name>" only when an actor of that name holds them', async t => {
    // A You: the bag.
    const you = await page(t, { persona: 'Wessel' });
    await begin(you.host);
    let dialog = await wizardWith(you, { empty: true });
    await importInto(dialog, SAVED);
    assert.match(wizardOf(dialog).querySelector('[data-wiz="import-done"]').textContent, /also adds 3 things to the party's bag and 50 gold to the purse\./);
    let review = await goTo(dialog, 'review');
    assert.equal(review.querySelector('[data-review="import-also"]').textContent, 'Also adds: 3 things to the party\'s bag · 50 gold to the purse. One swipe of this reply takes it all back.');
    assert.ok(!review.textContent.includes('carried by'));
    dialog.close();

    // A companion and no party actor: still the bag.
    const none = await newcomer(t);
    dialog = await wizardWith(none);
    await companion(dialog, 'Ren');
    await importInto(dialog, SAVED);
    review = await goTo(dialog, 'review');
    assert.match(review.querySelector('[data-review="import-also"]').textContent, /^Also adds: 3 things to the party's bag · /);
    assert.ok(!(await goTo(dialog, 'who')).textContent.includes('carried by'));
    dialog.close();

    // A companion with a party actor of that name: carried by them (the name is read as it is typed).
    const actors = await page(t, { persona: 'Wessel', modules: [PARTY_STUB([REN])] });
    await begin(actors.host);
    await makeBlocks(actors.host, { who: 'Wessel' });
    await settle();
    dialog = await wizardWith(actors);
    await companion(dialog, 'Ren');
    await importInto(dialog, SAVED);
    assert.match(wizardOf(dialog).querySelector('[data-wiz="import-done"]').textContent, /also adds 3 things carried by Ren and 50 gold to the purse\./);
    review = await goTo(dialog, 'review');
    assert.equal(review.querySelector('[data-review="import-also"]').textContent, 'Also adds: 3 things carried by Ren · 50 gold to the purse. One swipe of this reply takes it all back.');
    // Another name: no actor, so the bag.
    await goTo(dialog, 'who');
    type(wizardOf(dialog).querySelector('[data-wiz="name"]'), 'Brae');
    assert.match((await goTo(dialog, 'review')).querySelector('[data-review="import-also"]').textContent, /^Also adds: 3 things to the party's bag · /);
    dialog.close();
});

// ---- templates do not silently replace imported skills ------------------------------------------------------------------------------------

test('after an import a skill template asks first: Keep leaves the imported skills, Replace puts the template in; with no imported skills it just goes in', async t => {
    const ctx = await newcomer(t);
    const dialog = await wizardWith(ctx);
    await companion(dialog);
    await importInto(dialog, SAVED);
    const rows = () => wizardOf(dialog).querySelectorAll('.rpg-wiz-row[data-skill]').map(row => row.querySelector('[data-field="name"]').value);
    const cards = () => wizardOf(dialog).querySelectorAll('.rpg-wiz-card');
    await goTo(dialog, 'skills');
    assert.equal(wizardOf(dialog).querySelector('[data-wiz="replace"]'), null, 'nothing asked until a template is picked');
    cards()[0].click();
    const ask = wizardOf(dialog).querySelector('[data-wiz="replace"]');
    assert.equal(ask.querySelector('.rpg-wiz-replace-text').textContent, 'Replace the imported skills? Their ranks will be lost.');
    assert.deepEqual(ask.querySelectorAll('button').map(node => node.textContent), ['Replace', 'Keep']);
    assert.deepEqual(rows(), ['Iron Breath', 'Short blade'], 'nothing changed yet');
    click(ask, 'Keep');
    assert.equal(wizardOf(dialog).querySelector('[data-wiz="replace"]'), null);
    assert.deepEqual(rows(), ['Iron Breath', 'Short blade'], 'Keep leaves them');
    assert.match(wizardOf(dialog).querySelector('.rpg-wiz-sum').textContent, /Iron Breath \(Expert\)/, 'ranks and all');
    assert.deepEqual(cards().map(card => card.getAttribute('aria-pressed')), ['false', 'false', 'false', 'false', 'false']);
    cards()[2].click();
    click(wizardOf(dialog).querySelector('[data-wiz="replace"]'), 'Replace');
    assert.deepEqual(rows(), ['Spark', 'Ward', 'Lore'], 'Replace puts the template in');
    assert.equal(wizardOf(dialog).querySelector('[data-wiz="replace"]'), null);
    assert.equal(wizardOf(dialog).querySelector('.rpg-wiz-row[data-skill] [data-field="start"]').disabled, undefined, 'new skills are the usual ones again');
    // With no imported skills left a template goes in without a question.
    cards()[0].click();
    assert.equal(wizardOf(dialog).querySelector('[data-wiz="replace"]'), null);
    assert.deepEqual(rows(), ['Short blade', 'Iron Breath', 'Shield work']);
    dialog.close();

    // A question left open is dropped once the imported skills are gone (Undo import).
    const again = await wizardWith(ctx);
    await companion(again, 'Brae');
    await importInto(again, SAVED);
    await goTo(again, 'skills');
    wizardOf(again).querySelectorAll('.rpg-wiz-card')[0].click();
    await goTo(again, 'who');
    click(wizardOf(again), 'Undo import');
    await goTo(again, 'skills');
    assert.equal(wizardOf(again).querySelector('[data-wiz="replace"]'), null);
    again.close();
});

test('the money in the note and the Review is "to the purse", in the wallet\'s own words with thousands separators', async t => {
    const ctx = await newcomer(t);
    const dialog = await wizardWith(ctx);
    await companion(dialog);
    await importInto(dialog, JSON.stringify({ ...JSON.parse(SAVED), money: 10_000_000 }));
    assert.match(wizardOf(dialog).querySelector('[data-wiz="import-done"]').textContent, /adds 3 things to the party's bag and 10,000,000 gold to the purse\. Give/);
    assert.ok(!wizardOf(dialog).querySelector('[data-wiz="import-done"]').textContent.includes('this chat'));
    const review = await goTo(dialog, 'review');
    assert.equal(review.querySelector('[data-review="import-also"]').textContent, 'Also adds: 3 things to the party\'s bag · 10,000,000 gold to the purse. One swipe of this reply takes it all back.');
    dialog.close();
    // Mixed coins: each long number gets its separators, short ones are left alone.
    const coins = await newcomer(t);
    coins.host.settings.set('story-block', 'coins', [{ name: 'copper', value: 1 }, { name: 'silver', value: 10 }, { name: 'gold', value: 100 }]);
    const w = await wizardWith(coins);
    await companion(w);
    await importInto(w, JSON.stringify({ ...JSON.parse(SAVED), money: 123_456_705 }));
    assert.match(wizardOf(w).querySelector('[data-wiz="import-done"]').textContent, /and 1,234,567 gold 5 copper to the purse\./);
    w.close();
    // The Export dialog words it the same way.
    const first = await story(t, { purse: 12_345_678 });
    const exp = await exportDialog(first);
    assert.match(exportOf(exp).querySelector('[data-option="money"]').textContent, /Money · 12,345,678 gold/);
});
