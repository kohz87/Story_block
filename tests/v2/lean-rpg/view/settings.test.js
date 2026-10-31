// Settings → RPG (src/v2/lean-rpg/view/settings.js and settings-data.js): the page in the settings window, Rolls, Difficulty with the
// Custom numbers and the live odds, the Combat rules text saved through the real host, the roll planner's note and prompt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setupDom } from '../../view/mounts/helpers.js';
import { CORE_FEATURE } from '../../../../src/v2/features.js';
import { CUSTOM_SETTING, DIFFICULTY_SETTING, NOTE_SETTING, PRECALL_HEAD, PRESETS, STANDARD } from '../../../../src/v2/lean-rpg/index.js';
import { LEAN_RPG_TEMPLATES } from '../../../../src/v2/lean-rpg/templates.js';
import { renderRpgSettings, rollsOf, rpgSection } from '../../../../src/v2/lean-rpg/view/settings.js';
import { COMBAT_DEFAULT, COMBAT_MAX, combatBlock, combatTemplate, customOf, oddsView, plannerPrompt, withPrompt } from '../../../../src/v2/lean-rpg/view/settings-data.js';
import { reload } from '../../data-modules/helpers.js';
import { begin, fieldsOf, makeBlocks, page, settle } from './page.js';
import { characterDefinition, fakeState, foesDefinition, roleOf, skillsDefinition } from './helpers.js';

const MOD = 'story-block';
const rail = doc => doc.querySelectorAll('.ss-settings .ss-tabs-label').map(node => node.textContent);
const combat = () => structuredClone(LEAN_RPG_TEMPLATES.find(entry => entry.name === 'Combat rules').definition);
const promptOf = host => combatBlock(host.head(), {})?.prompt;

// The page, opened on its section, with Wessel (STR 12, Soul Class I, Adept) made from the real templates.
async function open(t, { blocks = true, rules = false, wrap = null } = {}) {
    const ctx = await page(t, { feature: true, persona: 'Wessel', wrap });
    await begin(ctx.host);
    if (blocks) await makeBlocks(ctx.host, { who: 'Wessel', character: { str: 12, soul: 1 }, skills: { skill1: 'Iron Breath', stat1: 'str', rank1: 1 } });
    if (rules) assert.equal((await ctx.host.sdk.command('dm.define', { definition: combat() })).ok, true);
    const win = ctx.ui.openSettings();
    win.select('rpg');
    await settle();
    const root = ctx.doc.querySelector('[data-ss-section="rpg"]');
    const card = name => root.querySelector(`[data-card="${name}"]`);
    return { ...ctx, win, root, card, stored: () => ctx.host.settings(MOD) };
}
const oddsText = card => card.querySelector('.rpg-odds-legend').textContent;
const typeInto = (node, value, event = 'change') => { node.value = value; node.dispatch(event); };

test('the page is its own rail entry after Features, with five cards in order and the words of the mockup', async t => {
    const { doc, root, card } = await open(t);
    assert.deepEqual(rail(doc).slice(0, 3), ['Look', 'Features', 'RPG']);
    assert.equal(root.querySelector('.ss-settings-page-sub').textContent, 'How the dice work, and what the narrator and the roll planner are told.');
    assert.deepEqual(root.querySelectorAll('.rpg-set-title').map(node => node.textContent), ['Rolls', 'Difficulty', 'What the narrator is told about combat', 'Roll planner', 'Companions who join']);
    assert.deepEqual(card('rolls').querySelectorAll('.rpg-chip').map(node => node.textContent), ['Automatic', 'Off']);
    assert.match(card('rolls').textContent, /Automatic: before each reply a short AI call plans the actions and code rolls the dice\. Off: no dice; the story decides\./);
    assert.deepEqual(card('difficulty').querySelectorAll('.rpg-chip').map(node => node.textContent), ['Gentle', 'Standard', 'Harsh', 'Custom']);
    assert.equal(card('difficulty').querySelector('[aria-pressed="true"]').textContent, 'Standard', 'Standard until the reader says otherwise');
    assert.equal(card('difficulty').querySelectorAll('.rpg-set-nums').length, 0, 'the numbers are for Custom');
    assert.match(card('difficulty').textContent, /Changes count from the next reply; rolls already made keep the numbers they were rolled with, and a Re-read keeps them too\./);
    assert.match(card('planner').textContent, /Your own instructions for the short AI call that picks who acts, with what, against whom\. They are added after its fixed part\./);
});

test('Rolls: Automatic or Off, through the existing setting', async t => {
    const { card, stored, root } = await open(t);
    assert.equal(rollsOf(() => stored()), 'automatic');
    card('rolls').querySelector('.rpg-chip[data-value="off"]').click();
    await settle();
    assert.equal(stored().rpgRolls, 'off');
    assert.equal(root.querySelector('[data-card="rolls"] [aria-pressed="true"]').textContent, 'Off');
    root.querySelector('[data-card="rolls"] .rpg-chip[data-value="automatic"]').click();
    assert.equal(stored().rpgRolls, 'automatic');
});

test('Companions who join: Ask by default, then Automatically or Off, through the rpgJoin setting', async t => {
    const { card, stored, root } = await open(t);
    assert.deepEqual(card('join').querySelectorAll('.rpg-chip').map(node => node.textContent), ['Ask', 'Automatically', 'Off']);
    assert.equal(card('join').querySelector('[aria-pressed="true"]').textContent, 'Ask', 'the default');
    assert.equal(stored().rpgJoin, undefined, 'nothing is stored until the reader chooses');
    assert.match(card('join').textContent, /When the story says someone joins the party for good, the RPG can make their character\./);
    card('join').querySelector('.rpg-chip[data-value="auto"]').click();
    assert.equal(stored().rpgJoin, 'auto');
    assert.equal(root.querySelector('[data-card="join"] [aria-pressed="true"]').textContent, 'Automatically');
    root.querySelector('[data-card="join"] .rpg-chip[data-value="off"]').click();
    assert.equal(stored().rpgJoin, 'off');
    root.querySelector('[data-card="join"] .rpg-chip[data-value="ask"]').click();
    assert.equal(root.querySelector('[data-card="join"] [aria-pressed="true"]').textContent, 'Ask');
});

test('Difficulty: a preset is one tap and the odds follow it live; the others are compared on a line', async t => {
    const { root, card, stored } = await open(t);
    assert.equal(card('difficulty').querySelector('.rpg-odds-title').textContent, 'Wessel (STR 12, Soul Class I, Adept) against a Class I foe');
    assert.equal(oddsText(card('difficulty')), 'Success 61%At a cost 8%Fail 31%');
    assert.equal(card('difficulty').querySelector('.rpg-odds-bar').getAttribute('aria-label'), 'Success 61%, at a cost 8%, fail 31%');
    assert.deepEqual(['success', 'cost', 'fail'].map(kind => card('difficulty').querySelector(`.rpg-odds-bar .rpg-odds-${kind}`).style.getPropertyValue('--rpg-odds')), ['61', '8', '31']);
    assert.equal(card('difficulty').querySelector('.rpg-odds-compare').textContent, 'For comparison, same fight: Gentle 69 / 10 / 22 · Harsh 52 / 5 / 43.');
    card('difficulty').querySelector('.rpg-chip[data-value="gentle"]').click();
    assert.equal(stored()[DIFFICULTY_SETTING], 'gentle');
    assert.equal(oddsText(root.querySelector('[data-card="difficulty"]')), 'Success 69%At a cost 10%Fail 22%');
    assert.equal(root.querySelector('.rpg-odds-compare').textContent, 'For comparison, same fight: Standard 61 / 8 / 31 · Harsh 52 / 5 / 43.');
    root.querySelector('[data-card="difficulty"] .rpg-chip[data-value="harsh"]').click();
    assert.equal(oddsText(root.querySelector('[data-card="difficulty"]')), 'Success 52%At a cost 5%Fail 43%');
    assert.equal(root.querySelector('[data-card="difficulty"] [aria-pressed="true"]').textContent, 'Harsh');
});

test('Custom: six fields with their ranges, started from the numbers in force; typed numbers are held to range and move the odds live', async t => {
    const { root, card, stored } = await open(t);
    card('difficulty').querySelector('.rpg-chip[data-value="harsh"]').click();
    root.querySelector('[data-card="difficulty"] .rpg-chip[data-value="custom"]').click();
    assert.equal(stored()[DIFFICULTY_SETTING], 'custom');
    assert.deepEqual(stored()[CUSTOM_SETTING], PRESETS.harsh, 'a first switch to Custom starts where the reader was');
    const grid = root.querySelector('.rpg-set-nums');
    assert.deepEqual(grid.querySelectorAll('.rpg-set-num > span').map(node => node.textContent),
        ['Foe\'s base', 'Soul Class adds', 'Stat adds', '"At a cost" when short by', 'Decisive at a margin of', 'Most exchanges per reply']);
    assert.deepEqual(grid.querySelectorAll('small').map(node => node.textContent), ['Gentle 3 · Standard 5 · Harsh 7', 'per class, both sides', 'rounded down', '0 turns it off', 'or a natural 1 or 20', '1 to 8']);
    const input = key => root.querySelector(`[data-rule="${key}"]`);
    assert.deepEqual(['foeBase', 'costMargin', 'decisiveMargin', 'roundCap'].map(key => [input(key).getAttribute('min'), input(key).getAttribute('max')]), [['0', '15'], ['0', '5'], ['4', '15'], ['1', '8']]);
    assert.deepEqual(input('classWeight').querySelectorAll('option').map(node => node.textContent), ['×1', '×2', '×3']);
    assert.deepEqual(input('statDivisor').querySelectorAll('option').map(node => node.textContent), ['half the stat', 'a third of the stat']);
    assert.equal(oddsText(root), 'Success 52%At a cost 5%Fail 43%', 'Harsh\'s numbers, so Harsh\'s odds');
    typeInto(input('foeBase'), '3');
    typeInto(input('costMargin'), '3');
    assert.deepEqual(stored()[CUSTOM_SETTING], { ...PRESETS.gentle }, 'foe base 3 and a window of 3 are Gentle');
    assert.equal(oddsText(root), 'Success 69%At a cost 10%Fail 22%', 'the odds follow at once, with no redraw of the box');
    typeInto(input('foeBase'), '40');
    assert.equal(stored()[CUSTOM_SETTING].foeBase, 15, 'held to its range');
    assert.equal(input('foeBase').value, '15');
    typeInto(input('roundCap'), '0');
    assert.equal(stored()[CUSTOM_SETTING].roundCap, 1);
    typeInto(input('decisiveMargin'), '2');
    assert.equal(stored()[CUSTOM_SETTING].decisiveMargin, 4);
    typeInto(input('costMargin'), 'many');
    assert.equal(stored()[CUSTOM_SETTING].costMargin, 3, 'not a number: put back');
    assert.equal(input('costMargin').value, '3');
    input('statDivisor').value = '3';
    input('statDivisor').dispatch('change');
    input('classWeight').value = '3';
    input('classWeight').dispatch('change');
    assert.deepEqual([stored()[CUSTOM_SETTING].statDivisor, stored()[CUSTOM_SETTING].classWeight], [3, 3]);
    // Wessel: a third of 12 is 4, a Soul Class of I is 3, Adept 1: +8 against 15 + 3 = 18 at the foe's base of 15.
    assert.equal(root.querySelector('.rpg-odds-title').textContent.includes('Wessel'), true);
    // The numbers that roll are these, held to range, whatever was typed.
    assert.deepEqual(Object.keys(stored()[CUSTOM_SETTING]), ['foeBase', 'classWeight', 'statDivisor', 'costMargin', 'decisiveMargin', 'roundCap']);
});

test('the odds are for the persona\'s own character, else the first Character block; no character, no odds', async t => {
    const ctx = await open(t, { blocks: false });
    assert.equal(ctx.card('difficulty').querySelector('.rpg-odds').hidden, true, 'no character yet');
    assert.equal(ctx.card('difficulty').querySelector('.rpg-odds-compare').hidden, true);
    // A character appears while the page is open: the odds follow the story.
    await makeBlocks(ctx.host, { who: 'Wessel', character: { str: 12, soul: 1 }, skills: { skill1: 'Iron Breath', stat1: 'str', rank1: 1 } });
    await settle();
    assert.equal(oddsText(ctx.root.querySelector('[data-card="difficulty"]')), 'Success 61%At a cost 8%Fail 31%');
    // The odds also follow the sheet: a Soul Class of II against a Class II foe.
    const set = await ctx.host.sdk.command('dm.set', { module: 'pack.chat/wessel', field: 'soul', value: 2 });
    assert.equal(set.ok, true);
    await settle();
    assert.match(ctx.root.querySelector('.rpg-odds-title').textContent, /Soul Class II, Adept\) against a Class II foe/);
});

test('Combat: the chat\'s Combat rules text is edited here and saved as an edit of that block; it reaches the narrator and survives a rebuild and a reload', async t => {
    const { host, root, card, win } = await open(t, { rules: true });
    const area = card('combat').querySelector('textarea');
    assert.equal(area.value, COMBAT_DEFAULT, 'the block\'s own text');
    assert.equal(card('combat').querySelector('.rpg-set-count').textContent, `${[...COMBAT_DEFAULT].length} / 1200`);
    assert.match(card('combat').textContent, /The Combat rules block of this chat\. Each chat can have its own; new chats start from the default\./);
    const hashBefore = host.head().domains.dataModules.active['pack.chat/combat-rules'].hash;
    const text = '[COMBAT SYSTEM] Fights are short and cruel. {{user}} loses against odds.';
    typeInto(area, text);
    await settle();
    assert.equal(promptOf(host), text);
    const active = host.head().domains.dataModules.active['pack.chat/combat-rules'];
    assert.notEqual(active.hash, hashBefore, 'a new definition hash');
    assert.ok(active.generation > 1, 'a new generation of the block');
    assert.equal(root.querySelector('.rpg-set-status').textContent, 'Saved on the latest reply: swipe or delete that reply to take it back.');
    const head = host.store.headIndex();
    const receipts = host.ctx.chat[head].extra.storySuite.receipts.filter(receipt => receipt.type === 'dm.redefine');
    assert.equal(receipts.length, 1, 'one recorded edit on the latest reply');
    assert.equal(receipts[0].summary, 'You changed Combat rules.');
    // The narrator reads it in the next reply's prompt.
    const { request } = await host.send('I draw.', 'Steel rings.');
    assert.ok(request.chat.some(message => message.content?.includes('Fights are short and cruel.')), 'in the prompt');
    assert.ok(!request.chat.some(message => message.content?.includes('No Plot Armor')), 'and the old text is gone');
    await reload(host);
    assert.equal(promptOf(host), text);
    win.close();
});

test('Combat: an edit rides on the latest reply, so deleting that reply takes it back', async t => {
    const { host, card } = await open(t, { rules: true });
    await host.send('Go on.', 'A later reply, so the block itself is older than the edit.');
    typeInto(card('combat').querySelector('textarea'), 'Only this.');
    await settle();
    assert.equal(promptOf(host), 'Only this.');
    await host.st.deleteMessage(host.store.headIndex());
    assert.equal(promptOf(host), COMBAT_DEFAULT);
});

test('Combat: Reset to the default puts the template\'s text back; an unchanged or too long text is not saved', async t => {
    const { host, root, card } = await open(t, { rules: true });
    typeInto(card('combat').querySelector('textarea'), 'Short.');
    await settle();
    assert.equal(promptOf(host), 'Short.');
    root.querySelector('[data-act="combat-reset"]').click();
    await settle();
    assert.equal(promptOf(host), COMBAT_DEFAULT, 'the template\'s text, as a block keeps it');
    assert.equal(root.querySelector('[data-field="combat"]').value, COMBAT_DEFAULT);
    const generation = () => host.head().domains.dataModules.active['pack.chat/combat-rules'].generation;
    const was = generation();
    typeInto(root.querySelector('[data-field="combat"]'), COMBAT_DEFAULT);
    await settle();
    assert.equal(generation(), was, 'the same text is no edit');
    const area = root.querySelector('[data-field="combat"]');
    typeInto(area, 'x'.repeat(COMBAT_MAX + 1), 'input');
    assert.equal(root.querySelector('[data-card="combat"] .rpg-set-count').textContent, `${COMBAT_MAX + 1} / 1200`);
    assert.ok(root.querySelector('[data-card="combat"] .rpg-set-count').classList.contains('rpg-over'));
    area.dispatch('change');
    await settle();
    assert.equal(generation(), was, 'too long: nothing is saved');
    assert.equal(root.querySelector('.rpg-set-status').textContent, 'That is more than 1200 characters; shorten it to save.');
    assert.equal(promptOf(host), COMBAT_DEFAULT);
    typeInto(area, 'x'.repeat(COMBAT_MAX));
    await settle();
    assert.equal([...promptOf(host)].length, COMBAT_MAX, 'exactly the limit is fine');
});

test('Combat: with no Combat rules block the page says so and offers to add one', async t => {
    const { host, root, card } = await open(t);
    assert.match(card('combat').querySelector('.rpg-combat-none').textContent, /This chat has no Combat rules block/);
    assert.equal(card('combat').querySelector('textarea'), null);
    root.querySelector('[data-act="combat-add"]').click();
    await settle();
    assert.equal(promptOf(host), COMBAT_DEFAULT, 'the template\'s block was made');
    const fresh = root.querySelector('[data-card="combat"]');
    assert.equal(fresh.querySelector('textarea').value, COMBAT_DEFAULT, 'and the page shows its text');
});

test('Roll planner: the note is kept as it is typed, counted to 400, and the read-only prompt is the real one for this chat', async t => {
    const { host, root, card, stored } = await open(t);
    const area = card('planner').querySelector('textarea');
    assert.equal(area.getAttribute('maxlength'), '400');
    assert.equal(card('planner').querySelector('.rpg-set-count').textContent, '0 / 400');
    const pre = () => root.querySelector('[data-card="planner"] .rpg-set-pre');
    assert.ok(pre().textContent.startsWith(PRECALL_HEAD), 'the fixed part first');
    assert.ok(!pre().textContent.includes('Reader\'s instructions'), 'no note yet');
    assert.match(pre().textContent, /Party:\nWessel \(class I\): STR 12/, 'the real party of this chat');
    typeInto(area, 'Companions play it safe unless I say otherwise.', 'input');
    assert.equal(stored()[NOTE_SETTING], 'Companions play it safe unless I say otherwise.');
    assert.equal(root.querySelector('[data-card="planner"] .rpg-set-count').textContent, '47 / 400');
    assert.ok(pre().textContent.includes(`${PRECALL_HEAD}\n\nReader's instructions: Companions play it safe unless I say otherwise.\n\nParty:`));
    assert.match(card('planner').textContent, /The format stays fixed so the dice can be read; that is why this part can be seen but not changed\./);
    assert.equal(root.querySelector('[data-card="planner"] .rpg-set-pre').parentNode.tagName, 'DETAILS');
    assert.equal(root.querySelector('[data-card="planner"] summary').textContent, 'Show the planner\'s full prompt (read-only)');
    // The prompt is the one the model gets (precall.js): same builder, same note.
    const sent = plannerPrompt(host.head(), 'Companions play it safe unless I say otherwise.');
    assert.equal(pre().textContent, sent);
    assert.equal(root.querySelector('[data-card="planner"] textarea').getAttribute('readonly'), null, 'the note is editable');
    assert.equal(pre().getAttribute('contenteditable'), null, 'the prompt is not');
});

test('searching finds the page by what it says; the page is hidden when nothing matches or the feature is off', async t => {
    const { host, root, win } = await open(t);
    const body = renderRpgSettings(root.parentNode, { settings: host.settings, doc: root.ownerDocument, headState: () => host.head(), readerName: () => 'Wessel', roleOf });
    assert.equal(body.filter('harsh'), 1, 'Difficulty');
    assert.equal(body.filter('planner'), 1);
    assert.equal(body.filter('combat rules'), 1);
    assert.equal(body.filter('gentle harsh'), 1);
    assert.equal(body.filter('automatic'), 2, 'Rolls, and Companions who join (Automatically)');
    assert.equal(body.filter('companions'), 1);
    assert.equal(body.filter('nothing like it'), 0);
    assert.equal(body.el.querySelectorAll('.rpg-set-card').filter(node => !node.hidden).length, 0);
    assert.equal(body.filter(''), 5);
    body.destroy();
    host.features.set(CORE_FEATURE.leanRpg, false);
    await settle();
    assert.equal(win.section(), 'features');
    assert.ok(!rail(root.ownerDocument).includes('RPG'));
});

test('the section record: its place, its words, and hidden with the feature', () => {
    const on = { value: true };
    const section = rpgSection({ featureOn: () => on.value });
    assert.deepEqual([section.id, section.label, section.title, section.after, section.icon], ['rpg', 'RPG', 'RPG', 'features', 'fa-dice-d20']);
    assert.equal(section.visible(), true);
    on.value = false;
    assert.equal(section.visible(), false);
    assert.equal(typeof section.body, 'function');
});

test('names from the story are text in the odds line and the prompt, never markup', async t => {
    const MARK = '<img src=x onerror="globalThis.pwned=1"><b>bold</b>';
    const state = fakeState([
        { definition: { ...characterDefinition('wessel', MARK), role: 'character' }, fields: { who: MARK, str: 12 } },
        { definition: { ...skillsDefinition('wessel-skills', MARK), role: 'skills' }, fields: { who: MARK, skill1: MARK, rank1: 1 } },
        { definition: { ...foesDefinition(), role: 'foes' }, fields: { foe1: MARK, count1: 2 } },
    ]);
    const doc = setupDom(), pane = doc.createElement('div');
    doc.body.appendChild(pane);
    const settings = Object.assign(() => ({}), { set: () => '' });
    const body = renderRpgSettings(pane, { settings, doc, headState: () => state, readerName: () => MARK, roleOf });
    assert.ok(pane.textContent.includes(MARK), 'shown as text');
    assert.equal(pane.querySelectorAll('img, script, iframe, style, a').length, 0);
    assert.equal(globalThis.pwned, undefined);
    body.destroy();
    void t;
});

// ---- the pure parts ---------------------------------------------------------------------------------------------------------------

test('settings-data: the Combat block is the first block with the role rules; withPrompt changes only the prompt', async t => {
    const { host } = await open(t, { rules: true });
    const block = combatBlock(host.head());
    assert.equal(block.module, 'pack.chat/combat-rules');
    assert.equal(block.prompt, COMBAT_DEFAULT, 'the template\'s text as a block keeps it: one line');
    assert.ok([...COMBAT_DEFAULT].length <= COMBAT_MAX);
    const before = JSON.stringify(block.definition);
    const next = withPrompt(block.definition, 'New.');
    assert.equal(JSON.stringify(block.definition), before, 'the pinned definition is not touched');
    assert.equal(next.prompt, 'New.');
    assert.ok(!('id' in next) && !('pack' in next), 'a definition sent to redefine has neither');
    const { prompt: _a, ...rest } = next, { prompt: _b, id: _i, pack: _p, ...kept } = block.definition;
    assert.deepEqual(rest, kept);
    assert.equal(combatBlock(fakeState([]), { roleOf }), null);
    assert.equal(combatTemplate([]), null);
    assert.equal(combatTemplate(LEAN_RPG_TEMPLATES).role, 'rules');
});

test('settings-data: customOf keeps the stored numbers, else the numbers in force', () => {
    assert.deepEqual(customOf({}), STANDARD);
    assert.deepEqual(customOf({ [DIFFICULTY_SETTING]: 'harsh' }), PRESETS.harsh);
    assert.deepEqual(customOf({ [DIFFICULTY_SETTING]: 'harsh', [CUSTOM_SETTING]: { foeBase: 12 } }), { ...STANDARD, foeBase: 12 });
    assert.deepEqual(customOf({ [DIFFICULTY_SETTING]: 'custom' }), STANDARD);
});

test('settings-data: the odds view for a state with and without a character', () => {
    const wessel = { definition: { ...characterDefinition('wessel', 'Wessel'), role: 'character' }, fields: { who: 'Wessel', str: 12, soul: 1 } };
    const skills = { definition: { ...skillsDefinition('wessel-skills', 'Wessel'), role: 'skills' }, fields: { who: 'Wessel', skill1: 'Iron Breath', rank1: 1 } };
    const view = oddsView(fakeState([wessel, skills]), 'Wessel', STANDARD);
    assert.equal(view.label, 'Wessel (STR 12, Soul Class I, Adept) against a Class I foe');
    assert.deepEqual(view.now, { success: 61, cost: 8, fail: 31 });
    assert.deepEqual(view.compare.map(item => item.name), ['gentle', 'harsh']);
    assert.deepEqual(oddsView(fakeState([wessel, skills]), 'Wessel', { ...STANDARD, foeBase: 9 }).compare.map(item => item.name), ['gentle', 'standard', 'harsh'], 'Custom: all three');
    assert.equal(oddsView(fakeState([]), 'Wessel', STANDARD), null);
});

test('the page\'s stylesheet: the odds bar is solid, three tones; the numbers wrap to two columns on a phone; theme tokens only', () => {
    const css = readFileSync(new URL('../../../../src/v2/lean-rpg/view/lean-rpg.css', import.meta.url), 'utf8');
    assert.match(css, /\.rpg-set-nums \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
    assert.match(css, /@media \(max-width: 600px\) \{ \.rpg-set-nums \{ grid-template-columns: 1fr 1fr; \} \}/);
    assert.match(css, /\.rpg-odds-success \{ background: var\(--ss-good\)/);
    assert.match(css, /\.rpg-odds-cost \{ background: var\(--ss-warn\)/);
    assert.match(css, /\.rpg-odds-fail \{ background: var\(--ss-bad\)/);
});

test('B17 (views): a refused save because the chat holds as many block versions as it can is said in plain words, and Reset still works', async t => {
    let refuse = true;
    const wrap = (type, payload, options, run) => (refuse && type === 'dm.redefine' && payload.definition.prompt !== COMBAT_DEFAULT
        ? { ok: false, code: 'DM_BUDGET', message: 'Combat rules: Retained pin budget exhausted; nothing applied.' }
        : run(type, payload, options));
    const { host, root, card } = await open(t, { rules: true, wrap });
    typeInto(card('combat').querySelector('textarea'), 'A new text.');
    await settle();
    assert.equal(root.querySelector('.rpg-set-status').textContent, 'This chat has kept as many block versions as it can. Reset to the default, or try again after your next message.');
    assert.equal(promptOf(host), COMBAT_DEFAULT, 'nothing changed');
    // The words are the helper's, so the other screens say it too (the wizard's Create, a block edit).
    const { refusalText } = await import('../../../../src/v2/strings.js');
    assert.equal(refusalText({ ok: false, code: 'DM_BUDGET', message: 'x: Retained pin budget exhausted; nothing applied.' }), 'This chat has kept as many block versions as it can. Try again after your next message.');
    assert.match(refusalText({ ok: false, code: 'DM_BUDGET', message: 'Data module reply budget exhausted.' }), /^This reply already holds as many changes/);
    // Reset to the default is the text already pinned, and goes through.
    refuse = false;
    typeInto(card('combat').querySelector('textarea'), 'Another.');
    await settle();
    assert.equal(promptOf(host), 'Another.');
});

test('F1: text typed in the Combat box is saved when the settings window is closed with the box still holding it (no change event comes)', async t => {
    const { host, card, win } = await open(t, { rules: true });
    const area = card('combat').querySelector('textarea');
    typeInto(area, 'Typed, then Escape.', 'input');
    assert.equal(promptOf(host), COMBAT_DEFAULT, 'nothing saved yet: only typed');
    win.close();
    await settle();
    assert.equal(promptOf(host), 'Typed, then Escape.');
    assert.equal(host.ctx.chat[host.store.headIndex()].extra.storySuite.receipts.filter(receipt => receipt.type === 'dm.redefine').length, 1, 'one edit');
});

test('F1: the page going out of sight saves what is typed, once; leaving the box after that does not save it again', async t => {
    const { host, doc, card, root } = await open(t, { rules: true });
    const area = card('combat').querySelector('textarea');
    typeInto(area, 'Typed, then the tab is hidden.', 'input');
    doc.visibilityState = 'hidden';
    const hide = doc.listeners.filter(entry => entry.type === 'visibilitychange');
    assert.ok(hide.length >= 1, 'the page listens');
    for (const entry of hide) entry.fn();
    area.dispatch('focusout');
    area.dispatch('change');
    await settle();
    assert.equal(promptOf(host), 'Typed, then the tab is hidden.');
    assert.equal(host.ctx.chat[host.store.headIndex()].extra.storySuite.receipts.filter(receipt => receipt.type === 'dm.redefine').length, 1, 'saved once, not once per event');
    assert.ok(root);
});

// Fix round 5, B8: the Combat text's saves are serialised, and the last action the reader took is the one that is kept.
test('B8: Reset clicked while the first Combat save is still running is saved after it, and the default wins', async t => {
    const slow = { on: true };
    const wrap = async (type, payload, options, run) => {
        // the host holds a save before it answers (the SDK can wait on one before it applies it), so the page does not know yet
        if (type === 'dm.redefine' && slow.on) await new Promise(resolve => setTimeout(resolve, 150));
        return run(type, payload, options);
    };
    const { host, root, card } = await open(t, { rules: true, wrap });
    const area = card('combat').querySelector('textarea');
    area.value = 'Unsaved edit';
    area.dispatch('focusout');
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(promptOf(host), COMBAT_DEFAULT, 'the first save is still waiting');
    root.querySelector('[data-act="combat-reset"]').click();
    await new Promise(resolve => setTimeout(resolve, 600));
    await settle();
    assert.equal(promptOf(host), COMBAT_DEFAULT, 'the default is what the story holds');
    assert.equal(root.querySelector('[data-field="combat"]').value, COMBAT_DEFAULT, 'and what the box shows');
    const head = host.store.headIndex();
    assert.equal(host.ctx.chat[head].extra.storySuite.receipts.filter(receipt => receipt.type === 'dm.redefine').length, 2, 'two saves, one after the other');
    // and the other way round: the same text asked twice while it is being saved is saved once
    const again = root.querySelector('[data-field="combat"]');
    again.value = 'Second edit';
    again.dispatch('focusout');
    again.dispatch('change');
    await new Promise(resolve => setTimeout(resolve, 600));
    await settle();
    assert.equal(promptOf(host), 'Second edit');
    assert.equal(host.ctx.chat[head].extra.storySuite.receipts.filter(receipt => receipt.type === 'dm.redefine').length, 3);
});
