// RPG fix round 5, rolls and views side (review 158), on the whole host (core module, blocks made from the stock templates, the RPG on).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, hostAvailable } from '../../../testkit/index.js';
import { LEAN_RPG_TEMPLATES } from '../../../src/v2/lean-rpg/templates.js';
import { reply, success } from '../data-modules/helpers.js';
import { CUSTOM_SETTING, DIFFICULTY_SETTING, LIMITS } from '../../../src/v2/lean-rpg/index.js';
import { cueText, cueTokens, shortNames } from '../../../src/v2/lean-rpg/cue.js';
import { character, foeBlock, rollReceipt, setup } from './helpers.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;

const template = name => structuredClone(LEAN_RPG_TEMPLATES.find(entry => entry.name === name).definition);

async function game(t, { answers = ['act Wessel | stat: STR | target: Rat'], who = ['Wessel'], foes = [['Rat', 1]], hide = [] } = {}) {
    const asked = [];
    const callModel = async prompt => { asked.push(prompt); return answers.length > 1 ? answers.shift() : answers[0]; };
    const host = await createHost({ callModel, settings: { modules: { 'story-block': { rpgFormula: 'classic' } } } });
    t.after(() => host.close());
    host.features.set('story-block.rpg', true);
    await host.send('Begin.', 'Opening.');
    for (const [n, name] of who.entries()) {
        const character = template('Character');
        character.slug = `pc${n}`; character.name = name; character.state.who.default = name;
        success(await host.sdk.command('dm.define', { definition: character }));
    }
    const block = template('Foes');
    foes.forEach(([name, count], n) => { block.state[`foe${n + 1}`].default = name; block.state[`count${n + 1}`].default = count; });
    // a hidden field can only be changed by a button, so a pack that hides one has no kind that writes it
    if (hide.length) { block.kinds = {}; for (const key of hide) block.state[key].prompt = false; }
    success(await host.sdk.command('dm.define', { definition: block }));
    return { host, asked };
}

// --- B1: a hidden field never reaches the planner, the plan, the cue or the narrator ---------------------------------------

test('B1: a foe whose name is prompt: false is "Foe 1" to the planner, the plan, the cue and the narrator', { skip }, async t => {
    const SECRET = 'SECRET BARON';
    // the planner is told the name is not there, answers with the slot; and a planner that guesses the name rolls nothing
    const { host, asked } = await game(t, { foes: [[SECRET, 1]], hide: ['foe1'], answers: [`act Wessel | stat: STR | target: ${SECRET}`, 'act Wessel | stat: STR | target: 1'] });
    await host.send('I strike.', 'The first reply.');
    assert.ok(!asked.some(prompt => prompt.includes(SECRET)), 'the planner prompt does not hold the name');
    assert.match(asked[0], /1\. Foe 1 /, 'the slot stands in for it');
    assert.ok(!host.ctx.chat.at(-1).extra.storySuite.receipts.some(receipt => receipt.type === 'rpg.resolve'), 'a guess at the hidden name rolls nothing');
    const sent = await host.send('I strike again.', 'The second reply.');
    const receipt = host.ctx.chat.at(-1).extra.storySuite.receipts.find(entry => entry.type === 'rpg.resolve');
    assert.ok(receipt, 'the slot rolls');
    assert.ok(!JSON.stringify(receipt).includes(SECRET), 'the saved roll has no name');
    assert.match(receipt.summary, /Wessel → Foe 1/);
    assert.ok(!JSON.stringify(sent.request).includes(SECRET), 'nor the narrator\'s request');
    assert.ok(!asked.some(prompt => prompt.includes(SECRET)));
});

test('B1: a hidden skill name, stat and who are not offered by the sheet; the death flag still counts', { skip }, async t => {
    const { readSheet } = await import('../../../src/v2/lean-rpg/index.js');
    const { host } = await game(t);
    const hero = template('Character');
    hero.slug = 'shy'; hero.name = 'Shy hero'; hero.state.who.default = 'Secret Name'; hero.state.who.prompt = false;
    hero.state.str.prompt = false;
    success(await host.sdk.command('dm.define', { definition: hero }));
    const sheet = readSheet(host.head());
    const shy = sheet.characters.find(entry => entry.module === 'pack.chat/shy');
    assert.equal(shy.who, 'Shy hero', 'the block\'s own name stands in for a hidden Who');
    assert.equal(shy.stats.str, 10, 'a hidden stat still counts for the dice (review 160)');
    assert.ok(shy.hidden.includes('str'), 'and is listed as hidden');
    const { sheetText } = await import('../../../src/v2/lean-rpg/precall.js');
    const line = sheetText(sheet).split('\n').find(text => text.startsWith('Shy hero'));
    assert.ok(line && !/STR/.test(line), `a hidden stat is not offered to the planner: ${line}`);
    assert.equal(sheet.characters.find(entry => entry.who === 'Wessel').stats.str, 10, 'the others are untouched');
});

// --- review 160: hidden numbers still count for the rules ---------------------------------------------------------------

test('review 160 a: a hidden health of 0 is still Down and a hidden Soul Class still counts; neither is written for the planner', { skip }, async t => {
    const { readSheet } = await import('../../../src/v2/lean-rpg/index.js');
    const { sheetText } = await import('../../../src/v2/lean-rpg/precall.js');
    const { host, asked } = await game(t, { who: [] });
    const hero = template('Character');
    hero.slug = 'wessel'; hero.name = 'Wessel'; hero.state.who.default = 'Wessel'; hero.kinds = {};
    hero.state.health.default = 0; hero.state.health.prompt = false;
    hero.state.soul.default = 5; hero.state.soul.prompt = false;
    success(await host.sdk.command('dm.define', { definition: hero }));
    const sheet = readSheet(host.head());
    const wessel = sheet.characters.find(entry => entry.who === 'Wessel');
    assert.deepEqual([wessel.health, wessel.soul], [0, 5], 'the rules read the real values');
    const text = sheetText(sheet);
    assert.ok(!/Health|class V|DOWN/.test(text.split('\n').find(line => line.startsWith('Wessel'))), text);
    await host.send('I strike.', 'The rat bites.');
    const roll = host.ctx.chat.at(-1).extra.storySuite.receipts.find(receipt => receipt.type === 'rpg.resolve');
    const acted = (roll?.data?.v2?.result?.rounds ?? []).flatMap(round => round.lines).some(line => line.kind === 'act' && line.pc?.who === 'Wessel');
    assert.equal(acted, false, 'a Down character does not act, hidden health or not');
    assert.ok(asked.length >= 1);
});

test('review 160 b: a hidden foe count of 0 is still an empty slot', { skip }, async t => {
    const { readSheet } = await import('../../../src/v2/lean-rpg/index.js');
    const { host } = await game(t, { foes: [['Rat', 0]], hide: ['count1'] });
    const sheet = readSheet(host.head());
    assert.equal(sheet.foes[0].filled, false, 'count 0 is empty even when the count is hidden');
    await host.send('I strike.', 'Nothing there.');
    const roll = host.ctx.chat.at(-1).extra.storySuite.receipts.find(receipt => receipt.type === 'rpg.resolve');
    const rolled = (roll?.data?.v2?.result?.rounds ?? []).flatMap(round => round.lines).some(line => line.foe?.name === 'Rat');
    assert.equal(rolled, false, 'no roll against an empty slot');
});

// --- review 163: a skill's hidden stat or resource still counts for the rules and is not named ------------------------------

async function sneak(t, { hide, mana = 4 }) {
    const { host, asked } = await game(t, { who: [], foes: [['Rat', 0]], answers: ['check Wessel | skill: Silent Trick | difficulty: normal'] });
    const hero = template('Character');
    hero.slug = 'wessel'; hero.name = 'Wessel'; hero.state.who.default = 'Wessel';
    hero.state.str.default = 17; hero.state.dex.default = 8; hero.state.mana.default = mana;
    success(await host.sdk.command('dm.define', { definition: hero }));
    const skills = template('Skills');
    skills.slug = 'wessel-skills'; skills.state.who.default = 'Wessel'; skills.kinds = {};
    skills.state.skill1.default = 'Silent Trick'; skills.state.stat1.default = 'dex'; skills.state.uses1.default = 'mana';
    skills.state[hide].prompt = false;
    success(await host.sdk.command('dm.define', { definition: skills }));
    const sent = await host.send('I slip past.', 'He slips past.');
    const roll = host.ctx.chat.at(-1).extra.storySuite.receipts.find(receipt => receipt.type === 'rpg.resolve');
    return { host, sent, roll, asked, line: roll?.data?.v2?.result?.checks?.[0] };
}

test('review 163 a: a skill whose stat is hidden rolls with that stat and the cue does not name it', { skip }, async t => {
    const { sent, roll, asked, line } = await sneak(t, { hide: 'stat1' });
    assert.ok(roll && line, 'the check is rolled');
    assert.deepEqual([line.skill, line.pc.stat, line.pc.statBonus], ['Silent Trick', 'dex', 4], 'the rules use the hidden DEX 8, not STR 17');
    const request = JSON.stringify(sent.request);
    assert.match(request, /Wessel — Silent Trick, normal: /, 'the cue names the skill');
    assert.ok(!/\(DEX\)|Silent Trick \([^)]*dex/i.test(request), 'and not its hidden stat');
    assert.ok(!/\(DEX\)/.test(roll.summary ?? ''), 'nor does the saved summary');
    assert.ok(asked.some(prompt => prompt.includes('Silent Trick (Novice, mana)')), 'the planner sees the skill without its stat');
});

test('review 163 b: a skill whose resource is hidden and Empty is refused without naming the resource', { skip }, async t => {
    const { sent, roll, line } = await sneak(t, { hide: 'uses1', mana: 0 });
    assert.ok(roll && line, 'the check is still rolled, untrained');
    assert.deepEqual([line.skill, line.pc.stat, line.pc.rank], [null, 'dex', 0], 'with the skill\'s DEX and without the skill');
    const request = JSON.stringify(sent.request);
    assert.match(request, /cannot use Silent Trick/, 'the refusal is told');
    assert.ok(!/Mana Empty|\(Mana/.test(request), 'without the hidden resource');
    assert.ok(!/Mana Empty/.test(JSON.stringify(roll)), 'nor in the saved roll');
});

test('review 163 c: an untrained check on a hidden best stat neither names it nor says it is the best', { skip }, async t => {
    const { host } = await game(t, { who: [], foes: [['Rat', 0]], answers: ['check Wessel | skill: Lockpicking | difficulty: normal'] });
    const hero = template('Character');
    hero.slug = 'wessel'; hero.name = 'Wessel'; hero.state.who.default = 'Wessel'; hero.kinds = {};
    hero.state.str.default = 17; hero.state.str.prompt = false;
    success(await host.sdk.command('dm.define', { definition: hero }));
    const sent = await host.send('I pick the lock.', 'It opens.');
    const line = host.ctx.chat.at(-1).extra.storySuite.receipts.find(receipt => receipt.type === 'rpg.resolve')?.data?.v2?.result?.checks?.[0];
    assert.deepEqual([line?.pc.stat, line?.pc.statBonus], ['str', 8], 'the rules use the hidden STR 17');
    const request = JSON.stringify(sent.request);
    assert.match(request, /Wessel — check, normal: /);
    assert.match(request, /rolled untrained with their best stat/);
    assert.ok(!/STR/.test(request), 'STR is not named anywhere the narrator reads');
});

// --- review 164: whether a stat is hidden never changes the dice, the witness or the rounds told; a refusal never names it --

test('review 164 a: the witness of a roll on a hidden skill stat has no visibility flag', { skip }, async t => {
    const { prepare, readSheet } = await import('../../../src/v2/lean-rpg/index.js');
    const { host } = await sneak(t, { hide: 'stat1' });
    const prepared = prepare({ checks: [{ who: 'Wessel', skill: 'Silent Trick', difficulty: 'normal' }] }, readSheet(host.head()));
    assert.equal(prepared.checks[0].pc.statHidden, true, 'the cue is told the stat is hidden');
    assert.equal('statHidden' in prepared.witness.checks[0].pc, false, 'the witness holds the sheet numbers only');
    assert.equal(prepared.witness.checks[0].pc.stat, 'dex');
});

test('review 164 b: a hidden stat never changes how many rounds or which shape the cue fits', { skip }, async t => {
    const { fitCue } = await import('../../../src/v2/lean-rpg/cue.js');
    const { line } = await sneak(t, { hide: 'stat1' });
    assert.equal(line?.pc.statHidden, true);
    const plainLine = { ...line, pc: { ...line.pc } };
    delete plainLine.pc.statHidden;
    const parts = one => ({ checks: [one, one, one, one], rounds: [1, 2, 3, 4, 5, 6].map(n => ({ n, decisive: false, lines: [one, one] })), refused: [], decisive: false });
    const differ = [];
    for (let budget = 40; budget <= 400; budget += 1) {
        const hidden = fitCue(parts(line), budget), shown = fitCue(parts(plainLine), budget);
        if (hidden.count !== shown.count || hidden.shape !== shown.shape) differ.push(budget);
        assert.ok(!/\(DEX\)/.test(hidden.text), 'the text sent still leaves the stat out');
        assert.ok(cueTokens(hidden.text) <= cueTokens(shown.text));
    }
    assert.deepEqual(differ, [], 'the same rounds and shape at every budget');
});

test('review 164 c: a check whose hidden skill stat is missing from the sheet is refused without naming it', { skip }, async t => {
    const { host } = await game(t, { who: [], foes: [['Rat', 0]], answers: ['check Wessel | skill: Silent Trick | difficulty: normal\ncheck Wessel | stat: STR | difficulty: normal'] });
    const hero = template('Character');
    hero.slug = 'wessel'; hero.name = 'Wessel'; hero.state.who.default = 'Wessel'; hero.kinds = {}; hero.cards = []; delete hero.state.dex;
    success(await host.sdk.command('dm.define', { definition: hero }));
    const skills = template('Skills');
    skills.slug = 'wessel-skills'; skills.state.who.default = 'Wessel'; skills.kinds = {};
    skills.state.skill1.default = 'Silent Trick'; skills.state.stat1.default = 'dex'; skills.state.stat1.prompt = false;
    success(await host.sdk.command('dm.define', { definition: skills }));
    const sent = await host.send('I attempt both.', 'A reply.');
    const roll = host.ctx.chat.at(-1).extra.storySuite.receipts.find(receipt => receipt.type === 'rpg.resolve');
    assert.match(roll.summary, /Silent Trick: not rolled \(Wessel lacks the skill's stat\)/);
    assert.ok(!/DEX/.test(JSON.stringify(sent.request)), 'DEX is not named anywhere the narrator reads');
});

// --- review 166: a refusal said without a hidden stat or resource never changes how many rounds are told ----------------

test('review 166: hidden refusal wordings are measured as the shown ones, and never longer', { skip }, async t => {
    const { prepare, readSheet } = await import('../../../src/v2/lean-rpg/index.js');
    const { fitCue } = await import('../../../src/v2/lean-rpg/cue.js');
    const plan = { acts: [], foes: [], checks: ['Silent Trick', 'Spark', 'Lockpicking'].map(skill => ({ who: 'Wessel', skill, difficulty: 'normal' })) };
    const sheetOf = async hide => {
        const { host } = await game(t, { who: [], foes: [['Rat', 0]] });
        const hero = template('Character');
        hero.slug = 'wessel'; hero.name = 'Wessel'; hero.state.who.default = 'Wessel'; hero.kinds = {}; hero.cards = [];
        delete hero.state.dex; hero.state.str.default = 17; hero.state.mana.default = 0; if (hide) hero.state.str.prompt = false;
        success(await host.sdk.command('dm.define', { definition: hero }));
        const skills = template('Skills');
        skills.slug = 'wessel-skills'; skills.state.who.default = 'Wessel'; skills.kinds = {};
        skills.state.skill1.default = 'Silent Trick'; skills.state.stat1.default = 'dex';
        skills.state.skill2.default = 'Spark'; skills.state.stat2.default = 'int'; skills.state.uses2.default = 'mana';
        if (hide) { skills.state.stat1.prompt = false; skills.state.uses2.prompt = false; }
        success(await host.sdk.command('dm.define', { definition: skills }));
        return prepare(plan, readSheet(host.head()));
    };
    const shown = await sheetOf(false), hidden = await sheetOf(true);
    const texts = prepared => prepared.refused.map(entry => entry.text);
    assert.equal(hidden.refused.length, 3, texts(hidden).join(' | '));
    assert.ok(!/DEX|STR|Mana/.test(texts(hidden).join(' ')), texts(hidden).join(' | '));
    assert.deepEqual(hidden.plainRefused, texts(shown), 'measured as the shown wording');
    for (const [n, text] of texts(hidden).entries()) assert.ok(text.length <= texts(shown)[n].length, `${text} is not longer than ${texts(shown)[n]}`);
    assert.ok(!JSON.stringify(hidden.witness).includes('DEX'), 'the plain wording is never saved');
    // the same rounds and shape at every budget, hidden or shown
    const line = { kind: 'check', skill: 'Sneak', difficulty: 'normal', dc: 12, outcome: 'success', pc: { who: 'Wessel', stat: 'str', die: 10, total: 18, statBonus: 8, classBonus: 0, classValue: 1, rank: 0, edge: 0 } };
    const parts = prepared => ({ checks: [line], rounds: [1, 2, 3, 4, 5, 6].map(n => ({ n, decisive: false, lines: [line, line] })), refused: texts(prepared), plainRefused: prepared.plainRefused, decisive: false });
    const differ = [];
    for (let budget = 40; budget <= 500; budget += 1) {
        const a = fitCue(parts(hidden), budget), b = fitCue(parts(shown), budget);
        if (a.count !== b.count || a.shape !== b.shape) differ.push(budget);
        assert.ok(cueTokens(a.text) <= cueTokens(b.text));
    }
    assert.deepEqual(differ, []);
});

// --- B7: the used plan is let go whatever the switch says now ---------------------------------------------------------------

test('B7: turning the RPG off while the reply is generated still clears the used plan', { skip }, async t => {
    const { host } = await game(t);
    const original = host.st.interceptor;
    host.st.interceptor = async (...args) => {
        await original(...args);
        assert.ok(host.ctx.chatMetadata?.rpgPlan, 'the plan is held while the reply is on its way');
        host.features.set('story-block.rpg', false);
    };
    await host.send('I strike.', 'He is hit.');
    assert.ok(host.ctx.chat.at(-1).extra.storySuite.receipts.some(receipt => receipt.type === 'rpg.resolve'), 'the rolls were made');
    assert.equal(host.ctx.chatMetadata?.rpgPlan, undefined, 'nothing of the plan is kept');
});

// --- B4 and B5: a cue of long names ---------------------------------------------------------------------------------------

// Six characters and four foes with long names that differ only at the end, and ten rolls and four refusals to tell (review 158).
const PCS = Array.from({ length: 6 }, (_, n) => `${'Captain Rare Long Common Name '.padEnd(54, 'x')}pc${n}`);
const FOES = Array.from({ length: 4 }, (_, n) => `${'Mysterious Dangerous Long Foe '.padEnd(54, 'y')}foe${n}`);
const LONG_ANSWER = [
    'pace: all',
    ...PCS.map((_, n) => `act pc${n} | stat: str | target: ${n % 4 + 1}`),
    ...FOES.map((_, n) => `foe ${n + 1} | target: pc${n} | defend: agi`),
    ...PCS.slice(0, 4).map((_, n) => `check pc${n} | skill: Phantom | stat: str | difficulty: very hard`),
].join('\n');
const longBlocks = () => {
    const blocks = {};
    PCS.forEach((who, n) => { blocks[`pc${n}`] = { role: 'character', fields: character(who, { str: 10, agi: 10, health: 5 }) }; });
    blocks.foes = { role: 'foes', fields: foeBlock(FOES.map(name => [name, 1, 1, 5])) };
    return blocks;
};
const custom = { foeBase: 5, classWeight: 2, statDivisor: 2, costMargin: 2, decisiveMargin: 15, roundCap: 5 };
// The roll's seed is fixed (the dice come from it), so the fight goes the same way every time.
async function longGame(options, seed = 12) {
    const real = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
    globalThis.crypto.getRandomValues = array => (array instanceof Uint32Array ? array.fill(seed) : real(array));
    try {
        const game = await setup({ blocks: longBlocks(), answers: [LONG_ANSWER], settings: { [DIFFICULTY_SETTING]: 'custom', [CUSTOM_SETTING]: custom }, ...options });
        await game.host.send('We all go at once.', 'The fight is on.');
        return game;
    } finally { globalThis.crypto.getRandomValues = real; }
}
const partsOf = result => ({ checks: result.checks, rounds: result.rounds, refused: result.refused.map(entry => entry.text), decisive: result.rounds.length > 0 && result.rounds.at(-1).decisive });

test('B5: cut names stay different: six characters and four foes each keep what tells them apart in the cue the narrator gets', { skip }, async () => {
    const { host } = await longGame({});
    const receipt = rollReceipt(host, 2);
    assert.ok(receipt, 'rolled');
    assert.ok(cueTokens(receipt.summary) <= LIMITS.cueTokens, 'and it fits');
    const told = receipt.summary.split('\n').filter(line => line.startsWith('Round') || line.includes('check'));
    for (const tag of ['pc0', 'pc1', 'pc2', 'pc3', 'foe0', 'foe1', 'foe2', 'foe3']) assert.ok(told.some(line => line.includes(tag)), `${tag} can be told apart in the cue`);
    assert.ok(!/Captain Rare Long C…\s/.test(receipt.summary), 'not the same cut for everyone');
    host.close();
});

test('B5: shortNames gives every different name a different shown form, and leaves a name no cut can separate as written', () => {
    const names = [...PCS, ...FOES, 'Wessel'];
    const map = shortNames(names);
    assert.equal(new Set(map.values()).size, names.length, 'all different');
    assert.equal(map.get('Wessel'), 'Wessel', 'a short name is left alone');
    for (const [name, shown] of map) assert.ok(shown.length <= 20 || shown === name, `${shown} is short`);
    // names that differ in the middle only, under the same head and tail, cannot be cut apart: kept whole
    const middle = ['Sir Aldous the Brave of the Northern Marches', 'Sir Aldous the Bold of the Northern Marches'].map(name => name.padEnd(46, '.'));
    const kept = shortNames(middle);
    assert.equal(new Set(kept.values()).size, 2);
    // an ordinary long name is still cut at its head
    assert.equal(shortNames(['Gutter Serpent of the Black Overflow Run', 'Wessel']).get('Gutter Serpent of the Black Overflow Run'), 'Gutter Serpent of t…');
});

test('B4: a roll with no dice version is fitted as it was, so a Re-read tells the rounds and stop it told; one with the version is shortened', { skip }, async () => {
    const earlier = await longGame({ earlier: true });
    const receipt = rollReceipt(earlier.host, 2);
    const result = receipt.data.v2.result;
    const payload = earlier.host.ctx.chat[2].extra.storySuite.spans.find(span => span.operation?.type === 'rpg.resolve').operation.payload;
    assert.ok(!('dice' in payload), 'no dice version in the payload');
    assert.equal(result.stop, 'budget');
    assert.equal(result.rounds.length, 1, 'the one round the earlier rule kept');
    assert.equal(receipt.summary, cueText(partsOf(result), 0), 'told as written, not shortened');
    const before = JSON.stringify(result);
    success(await earlier.host.sdk.reread(2));
    assert.equal(JSON.stringify(rollReceipt(earlier.host, 2).data.v2.result), before, 'a Re-read changes nothing');
    earlier.host.close();
    // the same fight rolled now is shortened to fit, and tells more
    const now = await longGame({});
    const fresh = rollReceipt(now.host, 2);
    assert.ok(cueTokens(fresh.summary) <= LIMITS.cueTokens);
    assert.ok(fresh.data.v2.result.rounds.length >= 1);
    assert.notEqual(fresh.summary, cueText(partsOf(fresh.data.v2.result), 0), 'shortened');
    now.host.close();
});
