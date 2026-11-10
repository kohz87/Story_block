// Settings → RPG (src/v2/lean-rpg/view/settings.js and settings-data.js): the page in the settings window, Rolls, Difficulty with the
// Custom numbers and the live odds, the Combat rules text saved through the real host.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setupDom } from '../../view/mounts/helpers.js';
import { CORE_FEATURE } from '../../../../src/v2/features.js';
import { DIFFICULTY_SETTING, STANDARD, STANDARD_PRESETS, STANDARD_SETTING } from '../../../../src/v2/lean-rpg/index.js';
import { STANDARD_TEMPLATES } from '../../../../src/v2/lean-rpg/templates.js';
import { renderRpgSettings, rollsOf, rpgSection } from '../../../../src/v2/lean-rpg/view/settings.js';
import { COMBAT_DEFAULT, COMBAT_MAX, combatBlock, combatTemplate, customOf, oddsView, withPrompt } from '../../../../src/v2/lean-rpg/view/settings-data.js';
import { reload } from '../../data-modules/helpers.js';
import { begin, fieldsOf, makeBlocks, page, settle } from './page.js';
import { characterDefinition, fakeState, foesDefinition, roleOf, skillsDefinition } from './helpers.js';

const MOD = 'story-block';
const rail = doc => doc.querySelectorAll('.ss-settings .ss-tabs-label').map(node => node.textContent);
const combat = () => structuredClone(STANDARD_TEMPLATES.find(entry => entry.name === 'Combat rules').definition);
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

test('the page is its own rail entry after Features, with its cards in order and the words of the mockup', async t => {
    const { doc, root, card } = await open(t);
    assert.deepEqual(rail(doc).slice(0, 3), ['Look', 'Features', 'RPG']);
    assert.equal(root.querySelector('.ss-settings-page-sub').textContent, 'How the dice work, and what the narrator is told.');
    assert.deepEqual(root.querySelectorAll('.rpg-set-title').map(node => node.textContent), ['Stat formula', 'Levels and practice', 'Gear in fights', 'Rolls', 'Difficulty', 'What the narrator is told about combat', 'Companions who join']);
    assert.match(card('formula').textContent, /New character bars: Health 2 × \(4 \+ VIT\/5\)/);
    assert.match(card('formula').textContent, /Earlier characters keep Health 4 \+ VIT\/5/);
    assert.deepEqual(card('rolls').querySelectorAll('.rpg-chip').map(node => node.textContent), ['Automatic', 'Off']);
    assert.match(card('rolls').textContent, /Automatic: code rolls the dice for the fights you play on the fight board\. Off: no dice; the story decides\./);
    assert.equal(card('checks').querySelector('b').textContent, 'Story checks');
    assert.equal(card('checks').querySelector('.rpg-set-help').textContent, 'Rolls for attempts outside a fight, before the reply. Off: the narrator decides them, as now.');
    assert.deepEqual(card('difficulty').querySelectorAll('.rpg-chip').map(node => node.textContent), ['Gentle', 'Standard', 'Harsh', 'Custom']);
    assert.equal(card('difficulty').querySelector('[aria-pressed="true"]').textContent, 'Standard', 'Standard until the reader says otherwise');
    assert.equal(card('difficulty').querySelectorAll('.rpg-set-nums').length, 0, 'the numbers are for Custom');
    assert.match(card('difficulty').textContent, /Changes count from the next reply; rolls already made keep the numbers they were rolled with, and a Re-read keeps them too\./);
});

test('Story checks has a visible switch, on by default, which saves both choices', async t => {
    const { card, stored, root } = await open(t);
    const toggle = () => root.querySelector('[data-card="checks"] [role="switch"]');
    assert.equal(toggle().getAttribute('aria-label'), 'Story checks');
    assert.equal(toggle().getAttribute('aria-checked'), 'true');
    toggle().click();
    await settle();
    assert.equal(stored().rpgChecks, false);
    assert.equal(toggle().getAttribute('aria-checked'), 'false');
    toggle().click();
    await settle();
    assert.equal(stored().rpgChecks, true);
    assert.equal(toggle().getAttribute('aria-checked'), 'true');
    assert.ok(card('checks').textContent.includes('Story checks'));
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

test('Fight board uses the same feature switch as Features', async t => {
    const { host, card, root } = await open(t);
    assert.equal(host.registry.featureOn(CORE_FEATURE.fightBoard), true);
    assert.ok(card('rolls').querySelector('[data-card="board"]'), 'the switch is beside Rolls');
    card('board').querySelector('[role="switch"]').click();
    assert.equal(host.registry.featureOn(CORE_FEATURE.fightBoard), false);
    assert.equal(root.querySelector('[data-card="board"] [role="switch"]').getAttribute('aria-checked'), 'false');
    root.querySelector('[data-card="board"] [role="switch"]').click();
    assert.equal(host.registry.featureOn(CORE_FEATURE.fightBoard), true);
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
    assert.equal(card('difficulty').querySelector('.rpg-odds-title').textContent, 'Wessel (STR 12 with DEX 5, Soul Class I, Adept) against a Class I foe');
    assert.equal(oddsText(card('difficulty')), 'Success 69%At a cost 7%Fail 25%');
    assert.equal(card('difficulty').querySelector('.rpg-odds-bar').getAttribute('aria-label'), 'Success 69%, at a cost 7%, fail 25%');
    assert.deepEqual(['success', 'cost', 'fail'].map(kind => card('difficulty').querySelector(`.rpg-odds-bar .rpg-odds-${kind}`).style.getPropertyValue('--rpg-odds')), ['69', '7', '25']);
    assert.equal(card('difficulty').querySelector('.rpg-odds-compare').textContent, 'For comparison, same fight: Gentle 76 / 6 / 19 · Harsh 61 / 8 / 31.');
    card('difficulty').querySelector('.rpg-chip[data-value="gentle"]').click();
    assert.equal(stored()[DIFFICULTY_SETTING], 'gentle');
    assert.equal(oddsText(root.querySelector('[data-card="difficulty"]')), 'Success 76%At a cost 6%Fail 19%');
    assert.equal(root.querySelector('.rpg-odds-compare').textContent, 'For comparison, same fight: Standard 69 / 7 / 25 · Harsh 61 / 8 / 31.');
    root.querySelector('[data-card="difficulty"] .rpg-chip[data-value="harsh"]').click();
    assert.equal(oddsText(root.querySelector('[data-card="difficulty"]')), 'Success 61%At a cost 8%Fail 31%');
    assert.equal(root.querySelector('[data-card="difficulty"] [aria-pressed="true"]').textContent, 'Harsh');
});

test('Custom: thirteen fields with their ranges, started from the numbers in force; typed numbers are held to range and move the odds live', async t => {
    const { root, card, stored } = await open(t);
    card('difficulty').querySelector('.rpg-chip[data-value="harsh"]').click();
    root.querySelector('[data-card="difficulty"] .rpg-chip[data-value="custom"]').click();
    assert.equal(stored()[DIFFICULTY_SETTING], 'custom');
    assert.deepEqual(stored()[STANDARD_SETTING], STANDARD_PRESETS.harsh, 'a first switch to Custom starts where the reader was');
    const grid = card('difficulty').querySelector('.rpg-set-nums');
    assert.deepEqual(grid.querySelectorAll('.rpg-set-num > span').map(node => node.textContent),
        ['Foe\'s base', 'Foe adds per class', 'Level divisor', '"At a cost" when short by', 'Decisive at a margin of', 'Most exchanges per reply', 'Quick start at a lead of',
            'Stats start at', 'Points to spend at creation', 'Lowest stat at creation', 'Highest stat at creation', 'Points per Soul Class rise', 'Highest a stat can be']);
    assert.deepEqual(grid.querySelectorAll('small').slice(0, 3).map(node => node.textContent), ['Gentle 2 · Standard 4 · Harsh 6', '1 to 5', 'a roll adds level ÷ this (3 to 8, 5 unset), both sides']);
    const input = key => root.querySelector(`[data-rule="${key}"]`);
    assert.deepEqual(['foeBase', 'costMargin', 'decisiveMargin', 'roundCap'].map(key => [input(key).getAttribute('min'), input(key).getAttribute('max')]), [['0', '15'], ['0', '5'], ['4', '15'], ['1', '8']]);
    assert.deepEqual(input('levelDivisor').querySelectorAll('option').map(node => node.textContent), ['÷3', '÷4', '÷5', '÷6', '÷7', '÷8']);
    assert.equal(input('levelDivisor').value, '5', 'the divisor starts at 5');
    assert.equal(input('classWeight'), null, 'no Soul Class weight row: it is not Standard\'s');
    assert.equal(input('statDivisor'), null, 'no stat divisor row: Classic is gone');
    assert.equal(oddsText(root), 'Success 61%At a cost 8%Fail 31%', 'Harsh\'s numbers, so Harsh\'s odds');
    typeInto(input('foeBase'), '2');
    assert.deepEqual(stored()[STANDARD_SETTING], { ...STANDARD_PRESETS.gentle }, 'foe base 2 is Gentle');
    assert.equal(oddsText(root), 'Success 76%At a cost 6%Fail 19%', 'the odds follow at once, with no redraw of the box');
    typeInto(input('foeBase'), '40');
    assert.equal(stored()[STANDARD_SETTING].foeBase, 15, 'held to its range');
    assert.equal(input('foeBase').value, '15');
    typeInto(input('roundCap'), '0');
    assert.equal(stored()[STANDARD_SETTING].roundCap, 1);
    typeInto(input('decisiveMargin'), '2');
    assert.equal(stored()[STANDARD_SETTING].decisiveMargin, 4);
    typeInto(input('costMargin'), '3');
    typeInto(input('costMargin'), 'many');
    assert.equal(stored()[STANDARD_SETTING].costMargin, 3, 'not a number: put back');
    assert.equal(input('costMargin').value, '3');
    input('levelDivisor').value = '3';
    input('levelDivisor').dispatch('change');
    assert.equal(stored()[STANDARD_SETTING].levelDivisor, 3, 'the divisor is written to rpgStandard.levelDivisor');
    assert.equal(root.querySelector('.rpg-odds-title').textContent.includes('Wessel'), true);
    // The numbers that roll are these, held to range, whatever was typed.
    assert.deepEqual(Object.keys(stored()[STANDARD_SETTING]), [...Object.keys(STANDARD_PRESETS.gentle), 'levelDivisor']);
});

test('the odds are for the persona\'s own character, else the first Character block; no character, no odds', async t => {
    const ctx = await open(t, { blocks: false });
    assert.equal(ctx.card('difficulty').querySelector('.rpg-odds').hidden, true, 'no character yet');
    assert.equal(ctx.card('difficulty').querySelector('.rpg-odds-compare').hidden, true);
    // A character appears while the page is open: the odds follow the story.
    await makeBlocks(ctx.host, { who: 'Wessel', character: { str: 12, soul: 1 }, skills: { skill1: 'Iron Breath', stat1: 'str', rank1: 1 } });
    await settle();
    assert.equal(oddsText(ctx.root.querySelector('[data-card="difficulty"]')), 'Success 69%At a cost 7%Fail 25%');
    // The odds also follow the sheet: a Soul Class of II against a Class II foe.
    const set = await ctx.host.sdk.command('dm.set', { module: 'pack.chat/wessel', field: 'soul', value: 2 });
    assert.equal(set.ok, true);
    await settle();
    assert.match(ctx.root.querySelector('.rpg-odds-title').textContent, /Soul Class II, Adept\) against a Class II foe/);
});

test('Combat: the chat\'s Combat rules text is edited here and saved as an edit of that block; it reaches the narrator and survives a rebuild and a reload', async t => {
    const { host, root, card, win } = await open(t, { rules: true });
    host.features.set(CORE_FEATURE.fightBoard, false);
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
    // The narrator reads it in the prompt of a reply with a fight (lean prompt, 3 Nov: a quiet reply leaves the combat text out; lean-rpg/read.js isQuiet).
    const { request: quiet } = await host.send('I draw.', 'Steel rings.');
    assert.ok(!quiet.chat.some(message => message.content?.includes('Fights are short and cruel.')), 'a quiet reply does not carry it');
    assert.equal((await host.sdk.command('dm.define', { definition: structuredClone(STANDARD_TEMPLATES.find(entry => entry.name === 'Foes').definition) })).ok, true);
    await host.send('A hound leaps.', `The hound leaps.\n<Changes>\n+ dm foes — it attacks | kind: set-slot-1 | name: Silt Hound | count: 1 | level: 5\n</Changes>`);
    const { request } = await host.send('I strike.', 'Steel rings.');
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

test('searching finds the page by what it says; the page is hidden when nothing matches or the feature is off', async t => {
    const { host, root, win } = await open(t);
    const body = renderRpgSettings(root.parentNode, { settings: host.settings, doc: root.ownerDocument, headState: () => host.head(), readerName: () => 'Wessel', roleOf });
    assert.equal(body.filter('harsh'), 1, 'Difficulty');
    assert.equal(body.filter('planner'), 0, 'the roll planner is gone');
    assert.equal(body.filter('combat rules'), 1);
    assert.equal(body.filter('gentle harsh'), 1);
    assert.equal(body.filter('automatic'), 2, 'Rolls, and Companions who join (Automatically)');
    assert.equal(body.filter('story checks'), 1, 'Rolls includes the Story checks switch');
    assert.equal(body.filter('companions'), 1);
    assert.equal(body.filter('nothing like it'), 0);
    assert.equal(body.el.querySelectorAll('.rpg-set-card').filter(node => !node.hidden).length, 0);
    assert.equal(body.filter(''), 6);
    assert.equal(body.filter('xp rate'), 1, 'Levels and practice');
    assert.equal(body.filter('level cap'), 1);
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
    assert.equal(combatTemplate(STANDARD_TEMPLATES).role, 'rules');
});

test('settings-data: customOf keeps the stored numbers, else the numbers in force', () => {
    assert.deepEqual(customOf({}), STANDARD);
    assert.deepEqual(customOf({ [DIFFICULTY_SETTING]: 'harsh' }), STANDARD_PRESETS.harsh);
    assert.deepEqual(customOf({ [DIFFICULTY_SETTING]: 'harsh', [STANDARD_SETTING]: { foeBase: 12 } }), { ...STANDARD, foeBase: 12 });
    assert.deepEqual(customOf({ [DIFFICULTY_SETTING]: 'custom' }), STANDARD);
});

test('settings-data: the odds view for a state with and without a character', () => {
    const wessel = { definition: { ...characterDefinition('wessel', 'Wessel'), role: 'character' }, fields: { who: 'Wessel', str: 12, soul: 1 } };
    const skills = { definition: { ...skillsDefinition('wessel-skills', 'Wessel'), role: 'skills' }, fields: { who: 'Wessel', skill1: 'Iron Breath', rank1: 1 } };
    const view = oddsView(fakeState([wessel, skills]), 'Wessel', STANDARD);
    assert.equal(view.label, 'Wessel (STR 12 with DEX 10, Level 1, Adept) against a Level 1 foe');
    assert.deepEqual(view.now, { success: 69, cost: 7, fail: 25 });
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

test('Levels and practice holds Practice per skill use: a whole number from 1 to 5 (3 unset), typed numbers held to range, saved as a setting for later rolls', async t => {
    const { card, stored } = await open(t);
    assert.equal(card('rolls').querySelector('[data-setting="rpgPracticePerUse"]'), null, 'moved out of the Rolls card');
    const input = card('levels').querySelector('[data-setting="rpgPracticePerUse"]');
    assert.equal(input.value, '3');
    assert.equal(input.getAttribute('min'), '1');
    assert.equal(input.getAttribute('max'), '5');
    assert.match(card('levels').textContent, /Practice per skill use/);
    for (const [typed, kept] of [['1', 1], ['5', 5], ['9', 5], ['0', 1], ['4.4', 4]]) {
        typeInto(input, typed);
        assert.equal(stored().rpgPracticePerUse, kept, typed);
        assert.equal(input.value, String(kept));
    }
    typeInto(input, 'abc');
    assert.equal(stored().rpgPracticePerUse, 4, 'not a number: put back');
});

test('Levels and practice: Level cap 1 to 99 (99 unset), Practice, and XP rate 50 to 300 % in steps of 25 (100 unset), each held to its range and saved', async t => {
    const { card, stored } = await open(t);
    const box = card('levels');
    assert.deepEqual(box.querySelectorAll('.rpg-set-num > span').map(node => node.textContent), ['Level cap', 'Practice per skill use', 'XP rate']);
    const cap = box.querySelector('[data-setting="rpgLevelCap"]'), rate = box.querySelector('[data-setting="rpgXpRate"]');
    assert.deepEqual([cap.value, cap.getAttribute('min'), cap.getAttribute('max')], ['99', '1', '99']);
    assert.deepEqual([rate.value, rate.getAttribute('min'), rate.getAttribute('max'), rate.getAttribute('step')], ['100', '50', '300', '25']);
    assert.match(box.textContent, /1 to 99, default 99\. A story or a pack can set its own cap\. 100 XP per level\./);
    assert.match(box.textContent, /1 to 5, default 3\./);
    assert.match(box.textContent, /50 to 300 %, in steps of 25, default 100\./);
    for (const [typed, kept] of [['40', 40], ['1', 1], ['150', 99], ['0', 1], ['12.4', 12]]) {
        typeInto(cap, typed);
        assert.equal(stored().rpgLevelCap, kept, `cap ${typed}`);
        assert.equal(cap.value, String(kept));
    }
    typeInto(cap, 'abc');
    assert.equal(stored().rpgLevelCap, 12, 'not a number: put back');
    for (const [typed, kept] of [['150', 150], ['10', 50], ['999', 300], ['130', 125], ['137', 125], ['138', 150]]) {
        typeInto(rate, typed);
        assert.equal(stored().rpgXpRate, kept, `rate ${typed}`);
        assert.equal(rate.value, String(kept));
    }
    typeInto(rate, '');
    assert.equal(stored().rpgXpRate, 150, 'empty: put back');
});

test('the roll table and the tiles say level: level ÷ 5 in every row, "1 per 3 levels", "4 + level ÷ 5"', async t => {
    const { card, root } = await open(t);
    assert.equal(root.querySelector('[data-card="formula"] .rpg-chip'), null, 'Standard is the only formula: no chips');
    const rows = root.querySelector('[data-card="formula"]').querySelectorAll('.rpg-formula-table tr').map(row => row.textContent);
    assert.ok(rows.length >= 6 && rows.every(row => /level ÷ 5/.test(row)), rows.join(' | '));
    assert.match(rows.find(row => row.startsWith('Turn order')), /d20 \+ level ÷ 5 \+ AGI\/2.*foes the same with their own level/);
    assert.deepEqual(root.querySelector('[data-card="formula"]').querySelectorAll('.rpg-formula-num').slice(2).map(node => node.textContent), ['1 per 3 levelsStat points', '4 + level ÷ 5Foe\'s base']);
    assert.doesNotMatch(root.querySelector('[data-card="formula"]').textContent, /Soul/i);
});

test('F15: the Level cap is one row in Settings: the RPG page draws it, the Modules page does not draw the module schema\'s copy', async t => {
    const { doc, win, root } = await open(t);
    const rows = node => node.querySelectorAll('*').filter(item => item.children.length === 0 && item.textContent.trim() === 'Level cap');
    assert.equal(rows(root).length, 1, 'the RPG page: one Level cap row');
    win.select('modules');
    await settle();
    assert.equal(rows(doc).filter(node => !root.contains(node)).length, 0, 'the Modules page has none');
});
