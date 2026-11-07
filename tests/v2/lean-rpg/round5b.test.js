import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, hostAvailable } from '../../../testkit/index.js';
import { CORE_FEATURE } from '../../../src/v2/features.js';
import { DIFFICULTY_SETTING, LEAN_RPG_FEATURE, LIMITS, STANDARD_SETTING, createLeanRpgPart } from '../../../src/v2/lean-rpg/index.js';
import { cueTokens, shortNames } from '../../../src/v2/lean-rpg/cue.js';
import { legacyPlanner } from './legacy-planner.js';
import { OWNER, cueOf, character, fakeModel, foeBlock, rollReceipt, setup, sheetDomain, skillBlock } from './helpers.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;

// A host with the sheet written straight into the data-module state (the blocks as helpers.js makes them) and the scripted stand-in for the retired planner
// making the records. `hidden`: { slug: [field, …] } are the fields the block's definition hides from the story (`prompt: false`); `names`: a block's own name.
async function game(t, { answers = ['act Wessel | stat: STR | target: Rat'], who = ['Wessel'], foes = [['Rat', 1]], extra = {}, hidden = {}, names = {}, settings = {} } = {}) {
    const blocks = {};
    who.forEach((name, n) => { blocks[`pc${n}`] = { role: 'character', fields: character(name, { str: 10, agi: 10, health: 5 }) }; });
    if (foes) blocks.foes = { role: 'foes', fields: foeBlock(foes.map(([name, count]) => [name, count, 1, 5])) };
    Object.assign(blocks, extra);
    const callModel = fakeModel(...answers);
    let host = null;
    const part = createLeanRpgPart({ chat: () => host.ctx.chat, metadata: () => host.ctx.chatMetadata ?? null, moduleId: OWNER });
    part.hooks.beforeGenerate = legacyPlanner(part, { callModel, chat: () => host.ctx.chat, metadata: () => host.ctx.chatMetadata ?? null, moduleId: OWNER });
    const initial = () => {
        const domain = sheetDomain(blocks);
        for (const pin of Object.values(domain.pins)) {
            const slug = pin.definition.slug;
            if (names[slug]) pin.definition.name = names[slug];
            if (hidden[slug]) pin.definition.state = Object.fromEntries(hidden[slug].map(key => [key, { type: 'text', prompt: false }]));
        }
        return domain;
    };
    const module = { id: OWNER, name: 'Story Block (RPG test)', version: '0.0.1',
        features: [{ id: LEAN_RPG_FEATURE, label: 'RPG', describe: 'Test.', default: false }, { id: CORE_FEATURE.fightBoard, label: 'Fight board', describe: 'Test.', default: false }],
        domains: { dataModules: { initial } }, commands: { ...part.commands }, queries: { ...part.queries }, hooks: { ...part.hooks, replayGuard: part.guard }, settings: { defaults: { ...part.settings.defaults } } };
    host = await createHost({ core: false, modules: [module], settings: { modules: { [OWNER]: { ...settings } } } });
    t.after(() => host.close());
    host.features.set(CORE_FEATURE.fightBoard, false);
    host.features.set(LEAN_RPG_FEATURE, false);
    await host.send('Begin.', 'Opening.');
    host.features.set(LEAN_RPG_FEATURE, true);
    return { host, callModel };
}
const rollOf = host => host.ctx.chat.at(-1).extra.storySuite.receipts.find(receipt => receipt.type === 'rpg.resolve');

// --- B1: a hidden field never reaches the plan, the cue or the narrator ---------------------------------------------------

test('B1: a foe whose name is prompt: false is "Foe 1" to the plan, the cue and the narrator', { skip }, async t => {
    const SECRET = 'SECRET BARON';
    // a plan that guesses the hidden name rolls nothing; the slot rolls
    const { host } = await game(t, { foes: [[SECRET, 1]], hidden: { foes: ['foe1'] }, answers: [`act Wessel | stat: STR | target: ${SECRET}`, 'act Wessel | stat: STR | target: 1'] });
    await host.send('I strike.', 'The first reply.');
    assert.ok(!rollOf(host), 'a guess at the hidden name rolls nothing');
    const sent = await host.send('I strike again.', 'The second reply.');
    const receipt = rollOf(host);
    assert.ok(receipt, 'the slot rolls');
    assert.ok(!JSON.stringify(receipt).includes(SECRET), 'the saved roll has no name');
    assert.match(cueOf(receipt), /Wessel → Foe 1/);
    assert.ok(!JSON.stringify(sent.request).includes(SECRET), 'nor the narrator\'s request');
});

test('B1: a hidden skill name, stat and who are not offered by the sheet; the death flag still counts', { skip }, async t => {
    const { readSheet } = await import('../../../src/v2/lean-rpg/index.js');
    const { host } = await game(t, { extra: { shy: { role: 'character', fields: character('Secret Name', { str: 10 }) } }, hidden: { shy: ['who', 'str'] }, names: { shy: 'Shy hero' } });
    const sheet = readSheet(host.head());
    const shy = sheet.characters.find(entry => entry.module === 'pack.chat/shy');
    assert.equal(shy.who, 'Shy hero', 'the block\'s own name stands in for a hidden Who');
    assert.equal(shy.stats.str, 10, 'a hidden stat still counts for the dice (review 160)');
    assert.ok(shy.hidden.includes('str'), 'and is listed as hidden');
    assert.equal(sheet.characters.find(entry => entry.who === 'Wessel').stats.str, 10, 'the others are untouched');
});

// --- review 160: hidden numbers still count for the rules ---------------------------------------------------------------

test('review 160 a: a hidden health of 0 is still Down and a hidden Level still counts', { skip }, async t => {
    const { readSheet } = await import('../../../src/v2/lean-rpg/index.js');
    const down = await game(t, { who: [], extra: { wessel: { role: 'character', fields: character('Wessel', { health: 0, level: 25 }) } }, hidden: { wessel: ['health', 'level'] } });
    const sheet = readSheet(down.host.head());
    const wessel = sheet.characters.find(entry => entry.who === 'Wessel');
    assert.deepEqual([wessel.health, wessel.level], [0, 25], 'the rules read the real values');
    await down.host.send('I strike.', 'The rat bites.');
    const roll = rollOf(down.host);
    const acted = (roll?.data?.v2?.result?.rounds ?? []).flatMap(round => round.lines).some(line => line.kind === 'act' && line.pc?.who === 'Wessel');
    assert.equal(acted, false, 'a Down character does not act, hidden health or not');
});

test('review 160 b: a hidden foe count of 0 is still an empty slot', { skip }, async t => {
    const { readSheet } = await import('../../../src/v2/lean-rpg/index.js');
    const { host } = await game(t, { foes: [['Rat', 0]], hidden: { foes: ['count1'] } });
    const sheet = readSheet(host.head());
    assert.equal(sheet.foes[0].filled, false, 'count 0 is empty even when the count is hidden');
    await host.send('I strike.', 'Nothing there.');
    const rolled = (rollOf(host)?.data?.v2?.result?.rounds ?? []).flatMap(round => round.lines).some(line => line.foe?.name === 'Rat');
    assert.equal(rolled, false, 'no roll against an empty slot');
});

// --- review 163: a skill's hidden stat or resource still counts for the rules and is not named ------------------------------

async function sneak(t, { hide, mana = 4 }) {
    const { host } = await game(t, { who: [], foes: [['Rat', 0]], answers: ['check Wessel | skill: Silent Trick | difficulty: normal'],
        extra: { wessel: { role: 'character', fields: character('Wessel', { str: 17, dex: 8, mana }) }, 'wessel-skills': { role: 'skills', fields: skillBlock('Wessel', [['Silent Trick', 0, 'dex', 'mana']]) } },
        hidden: { 'wessel-skills': [hide] } });
    const sent = await host.send('I slip past.', 'He slips past.');
    const roll = rollOf(host);
    return { host, sent, roll, line: roll?.data?.v2?.result?.checks?.[0] };
}

test('review 163 a: a skill whose stat is hidden rolls with that stat and the cue does not name it', { skip }, async t => {
    const { sent, roll, line } = await sneak(t, { hide: 'stat1' });
    assert.ok(roll && line, 'the check is rolled');
    assert.deepEqual([line.skill, line.pc.stat], ['Silent Trick', 'dex'], 'the rules use the hidden DEX 8, not STR 17');
    const request = JSON.stringify(sent.request);
    assert.match(request, /Wessel — Silent Trick, normal: /, 'the cue names the skill');
    assert.ok(!/\(DEX\)|Silent Trick \([^)]*dex/i.test(request), 'and not its hidden stat');
    assert.ok(!/\(DEX\)/.test(cueOf(roll)), 'nor does the saved summary');
});

test('review 163 b: a skill whose resource is hidden and Empty is refused without naming the resource', { skip }, async t => {
    const { sent, roll, line } = await sneak(t, { hide: 'uses1', mana: 0 });
    assert.ok(roll && line, 'the check is still rolled, untrained');
    assert.deepEqual([line.skill, line.pc.rank], [null, 0], 'without the skill');
    const request = JSON.stringify(sent.request);
    assert.match(request, /cannot use Silent Trick/, 'the refusal is told');
    assert.ok(!/Mana Empty|\(Mana/.test(request), 'without the hidden resource');
    assert.ok(!/Mana Empty/.test(JSON.stringify(roll)), 'nor in the saved roll');
});

test('review 163 c: an untrained check on a hidden best stat does not name it', { skip }, async t => {
    const { host } = await game(t, { who: [], foes: [['Rat', 0]], answers: ['check Wessel | skill: Lockpicking | difficulty: normal'],
        extra: { wessel: { role: 'character', fields: character('Wessel', { str: 17 }) } }, hidden: { wessel: ['str'] } });
    const sent = await host.send('I pick the lock.', 'It opens.');
    const line = rollOf(host)?.data?.v2?.result?.checks?.[0];
    assert.equal(line?.pc.stat, 'str', 'the rules use the hidden STR 17');
    const request = JSON.stringify(sent.request);
    assert.match(request, /Wessel — check, normal: /);
    assert.match(request, /has no skill called Lockpicking: rolled untrained/);
    assert.ok(!/STR/.test(request), 'STR is not named anywhere the narrator reads');
});

// --- review 164: whether a stat is hidden never changes the dice, the witness or the rounds told; a refusal never names it --

test('review 164 a: the witness of a roll on a hidden skill stat has no visibility flag', { skip }, async t => {
    const { prepare, readSheet } = await import('../../../src/v2/lean-rpg/index.js');
    const { host } = await sneak(t, { hide: 'stat1' });
    const prepared = prepare({ formula: 'standard', checks: [{ who: 'Wessel', skill: 'Silent Trick', difficulty: 'normal' }] }, readSheet(host.head()));
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
    const { host } = await game(t, { who: [], foes: [['Rat', 0]], answers: ['check Wessel | skill: Silent Trick | difficulty: normal\ncheck Ren | stat: STR | difficulty: normal'],
        extra: { wessel: { role: 'character', fields: (({ luk: _, ...rest }) => rest)(character('Wessel')) }, 'wessel-skills': { role: 'skills', fields: skillBlock('Wessel', [['Silent Trick', 0, 'luk']]) }, ren: { role: 'character', fields: character('Ren') } },
        hidden: { 'wessel-skills': ['stat1'] } });
    const sent = await host.send('I sneak and attempt both.', 'A reply.');
    assert.match(cueOf(rollOf(host)), /Silent Trick: not rolled \(Wessel lacks the skill's stat\)/);
    assert.ok(!/LUK/.test(JSON.stringify(sent.request)), 'LUK is not named anywhere the narrator reads');
});

// --- review 166: a refusal said without a hidden stat or resource never changes how many rounds are told ----------------

test('review 166: hidden refusal wordings are measured as the shown ones, and never longer', { skip }, async t => {
    const { prepare, readSheet } = await import('../../../src/v2/lean-rpg/index.js');
    const { fitCue } = await import('../../../src/v2/lean-rpg/cue.js');
    const plan = { formula: 'standard', acts: [], foes: [], checks: ['Silent Trick', 'Spark'].map(skill => ({ who: 'Wessel', skill, difficulty: 'normal' })) };
    const sheetOf = async hide => {
        const { luk: _, ...fields } = character('Wessel', { str: 17, mana: 0 });
        const { host } = await game(t, { who: [], foes: [['Rat', 0]], extra: { wessel: { role: 'character', fields }, 'wessel-skills': { role: 'skills', fields: skillBlock('Wessel', [['Silent Trick', 0, 'luk'], ['Spark', 0, 'int', 'mana']]) } },
            hidden: hide ? { wessel: ['str'], 'wessel-skills': ['stat1', 'uses2'] } : {} });
        return prepare(plan, readSheet(host.head()));
    };
    const shown = await sheetOf(false), hidden = await sheetOf(true);
    const texts = prepared => prepared.refused.map(entry => entry.text);
    assert.equal(hidden.refused.length, 2, texts(hidden).join(' | '));
    assert.ok(!/LUK|Mana/.test(texts(hidden).join(' ')), texts(hidden).join(' | '));
    assert.deepEqual(hidden.plainRefused, texts(shown), 'measured as the shown wording');
    for (const [n, text] of texts(hidden).entries()) assert.ok(text.length <= texts(shown)[n].length, `${text} is not longer than ${texts(shown)[n]}`);
    assert.ok(!JSON.stringify(hidden.witness).includes('LUK'), 'the plain wording is never saved');
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

// --- B5: a cue of long names ---------------------------------------------------------------------------------------

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
        const game = await setup({ blocks: longBlocks(), answers: [LONG_ANSWER], settings: { [DIFFICULTY_SETTING]: 'custom', [STANDARD_SETTING]: custom }, ...options });
        await game.host.send('We all go at once.', 'The fight is on.');
        return game;
    } finally { globalThis.crypto.getRandomValues = real; }
}

test('B5: cut names stay different: six characters and four foes each keep what tells them apart in the cue the narrator gets', { skip }, async () => {
    const { host } = await longGame({});
    const receipt = rollReceipt(host, 2);
    assert.ok(receipt, 'rolled');
    assert.ok(cueTokens(cueOf(receipt)) <= LIMITS.cueTokens, 'and it fits');
    const told = cueOf(receipt).split('\n').filter(line => line.startsWith('Round') || line.includes('check'));
    for (const tag of ['pc0', 'pc1', 'pc2', 'pc3', 'foe0', 'foe1', 'foe2', 'foe3']) assert.ok(told.some(line => line.includes(tag)), `${tag} can be told apart in the cue`);
    assert.ok(!/Captain Rare Long C…\s/.test(cueOf(receipt)), 'not the same cut for everyone');
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
