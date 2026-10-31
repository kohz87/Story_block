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
    const host = await createHost({ callModel });
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
