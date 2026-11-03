// Stage 51: an `rpg.resolve` receipt stores no copy of the cue text. The cue is built again from the recorded roll wherever it is told or shown,
// byte for byte what the roll made; a receipt stored before still carries its text and reads unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hostAvailable } from '../../../testkit/index.js';
import { PRESETS, RESOLVE, STANDARD_FORMULA, DICE_VERSION, FLOW_VERSION, prepare, readSheet, resolve, rollPrepared } from '../../../src/v2/lean-rpg/index.js';
import { cueOfResult, receiptCue } from '../../../src/v2/lean-rpg/cue.js';
import { fieldMax, positionalDice } from '../../../src/v2/lean-rpg/resolve.js';
import { hashJson } from '../../../src/v2/replay.js';
import { rng, roll } from '../../../src/v2/rng.js';
import { assemble } from '../../../src/v2/prompt.js';
import { receiptView } from '../../../src/v2/inspect.js';
import { character, foeBlock, rollReceipt, setup, sheetDomain, skillBlock, tailOf } from './helpers.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;

const party = () => ({
    wessel: { role: 'character', fields: character('Wessel') },
    'wessel-skills': { role: 'skills', fields: skillBlock('Wessel', [['Iron Breath', 1, 'str'], ['Spark', 0, 'int', 'mana']]) },
    ren: { role: 'character', fields: character('Ren', { str: 8, int: 16 }) },
    'ren-skills': { role: 'skills', fields: skillBlock('Ren', [['Spark', 0, 'int', 'mana']]) },
    foes: { role: 'foes', fields: foeBlock([['Sluice Rats', 6, 1, 5], ['Gutter Serpent', 1, 1, 5]]) },
});
const longParty = () => {
    const blocks = {};
    for (let n = 0; n < 6; n += 1) {
        const who = `Hero${n}-${'x'.repeat(30)}`;
        blocks[`pc${n}`] = { role: 'character', fields: character(who, { mana: n % 2 ? 0 : 4 }) };
        blocks[`sk${n}`] = { role: 'skills', fields: skillBlock(who, [['Arcane Surge of Great Moment', 2, 'int', 'mana']]) };
    }
    blocks.foes = { role: 'foes', fields: foeBlock([0, 1, 2, 3].map(n => [`Foe${n}-${'y'.repeat(30)}`, 2, 5, 5])) };
    return blocks;
};

const SMALL = { pace: 'all', acts: [{ who: 'Wessel', skill: 'Iron Breath', stat: 'str', target: 'Sluice Rats' }, { who: 'Ren', skill: 'Spark', stat: 'int', target: 'Gutter Serpent' }],
    foes: [{ slot: 1, target: 'Wessel', defend: 'agi' }, { slot: 2, target: 'Ren', defend: 'agi' }], checks: [{ who: 'Ren', stat: 'dex', difficulty: 'hard' }] };
const REFUSING = { ...SMALL, acts: [...SMALL.acts, { who: 'Nobody', stat: 'str', target: 'Sluice Rats' }, { who: 'Wessel', skill: 'Fire Storm', target: 'Gutter Serpent' }] };
const longPlan = blocks => {
    const sheet = readSheet({ domains: { dataModules: sheetDomain(blocks) } });
    return { pace: 'all', acts: sheet.characters.map(c => ({ who: c.who, skill: 'Arcane Surge of Great Moment', target: sheet.foes[0].name })),
        foes: sheet.foes.slice(0, 4).map((f, n) => ({ slot: n + 1, target: sheet.characters[n].who, defend: 'agi' })),
        checks: sheet.characters.slice(0, 4).map(c => ({ who: c.who, skill: 'Arcane Surge of Great Moment', difficulty: 'very hard' })) };
};

// resolve() on a fake command context with the seed given; the cue it would have told is made the old way, by rolling the same dice again.
function run({ blocks, plan, rules, dice, flow, seed }) {
    const domain = sheetDomain(blocks);
    const random = rng(seed);
    const ctx = { cause: 'system', caller: null, module: 'story-block', epoch: 1, source: {}, fail: (code, message) => { throw new Error(`${code}: ${message}`); },
        read: () => domain, draft: () => structuredClone(domain), claim: () => true, rng: random, roll: expression => roll(random, expression), hash: hashJson, replayGuard() {} };
    const payload = { key: '1-abc', plan, rules, ...(dice ? { dice: DICE_VERSION } : {}), ...(flow ? { flow: FLOW_VERSION } : {}) };
    const out = resolve(ctx, payload);
    // The same dice, drawn again from the same seed: the cue as the roll itself wrote it.
    const again = rng(seed), standard = rules.formula === 'standard';
    const flowAsked = flow && (dice || standard) ? FLOW_VERSION : 1;
    const source = dice || standard ? positionalDice(Math.floor(again() * 4294967296) >>> 0) : () => roll(again, 'd20').total;
    const sheet = readSheet({ domains: { dataModules: domain } });
    const made = rollPrepared(plan, prepare(plan, sheet, rules, { maxOf: fieldMax(domain), flow: flowAsked }), source, rules, { earlier: !dice && !standard, flow: flowAsked });
    return { out, text: made.text, result: out.data.v2.result, shape: out.data.v2.shape };
}

const CASES = [
    ['Classic, dice by position, the flow of stage 49', { blocks: party(), plan: SMALL, rules: PRESETS.standard, dice: true, flow: true }],
    ['Classic, dice by position, the earlier stop', { blocks: party(), plan: SMALL, rules: PRESETS.standard, dice: true, flow: false }],
    ['Classic, the earliest dice', { blocks: party(), plan: SMALL, rules: PRESETS.standard, dice: false, flow: false }],
    ['Classic with refusals', { blocks: party(), plan: REFUSING, rules: PRESETS.standard, dice: true, flow: true }],
    ['Standard', { blocks: party(), plan: SMALL, rules: STANDARD_FORMULA, dice: true, flow: true }],
    ['Standard with refusals', { blocks: party(), plan: REFUSING, rules: STANDARD_FORMULA, dice: true, flow: true }],
    ['Classic, long names (the cue is shortened)', { blocks: longParty(), plan: longPlan(longParty()), rules: PRESETS.standard, dice: true, flow: true }],
    ['Standard, long names (the cue is shortened)', { blocks: longParty(), plan: longPlan(longParty()), rules: STANDARD_FORMULA, dice: true, flow: true }],
];

for (const [name, setupOf] of CASES) {
    test(`the cue is rebuilt byte for byte from the record, and the receipt keeps no text: ${name}`, () => {
        let shapes = new Set();
        for (let seed = 1; seed <= 60; seed += 1) {
            const { out, text, result, shape } = run({ ...setupOf, seed });
            assert.equal('shape' in result, false, `seed ${seed}: the shape is kept beside the record, not in it`);
            assert.equal(out.summary, '', `seed ${seed}: the receipt keeps no cue text`);
            assert.equal(cueOfResult(result, shape), text, `seed ${seed}: the cue is what the roll made`);
            assert.equal(receiptCue({ type: RESOLVE, summary: out.summary, data: { v2: { result, shape } } }), text);
            shapes.add(shape ?? 0);
        }
        if (/long names/.test(name)) assert.ok([...shapes].some(shape => shape > 0), 'a shortened cue is among them');
    });
}

test('a receipt stored before still carries its text and is read unchanged; a text that does not match the record wins', () => {
    const { text, result } = run({ ...CASES[0][1], seed: 5 });
    const old = { type: RESOLVE, summary: text, data: { v2: { result } } };
    assert.equal(receiptCue(old), text);
    assert.equal(receiptCue({ ...old, summary: 'Own words.' }), 'Own words.');
    assert.equal(receiptCue({ type: 'scene.set', summary: 'Moved.', data: {} }), 'Moved.');
    assert.equal(receiptCue({ type: 'scene.set', summary: '', data: {} }), '');
    assert.equal(receiptCue({ type: RESOLVE, summary: '', data: { v2: { result: { v: 1 } } } }), '', 'a damaged record gives no text');
    assert.equal(receiptCue(null), '');
});

test('[Happened] and the Inspector tell the rebuilt cue of a roll that stores none, and the old text as it was', () => {
    const { text, result } = run({ ...CASES[4][1], seed: 9 });
    const registry = { contexts: () => [] };
    const slim = { id: 'rc1', type: RESOLVE, narrate: true, summary: '', data: { v2: { result } } };
    const old = { id: 'rc2', type: RESOLVE, narrate: true, summary: text, data: { v2: { result } } };
    const told = receipt => assemble({ registry, view: {}, untold: [receipt], settings: { tailBudget: 5000 } }).tailText;
    assert.equal(told(slim), told(old));
    assert.ok(told(slim).startsWith('[Happened]'));
    assert.ok(told(slim).includes('Round 1:'));
    assert.equal(receiptView(slim).summary, receiptView(old).summary);
});

test('a fight through the real turn: the stored receipt has no text, the cue in the request is the rebuilt one, and a Re-read, a rebuild and a reload agree', { skip }, async () => {
    for (const formula of ['classic', 'standard']) {
        const { host } = await setup({ settings: { rpgFormula: formula } });
        const { request } = await host.send('I hit the lead rat.', 'The rats scatter.');
        const receipt = rollReceipt(host, 2);
        assert.equal(receipt.summary, '', `${formula}: no cue text stored`);
        const cue = cueOfResult(receipt.data.v2.result, receipt.data.v2.shape);
        assert.ok(cue.startsWith('[Rolls]'));
        assert.ok(tailOf(request).includes(cue), `${formula}: the cue told is the cue rebuilt, whole`);
        const record = host.ctx.chat[2].extra.storySuite;
        assert.ok(!JSON.stringify(record).includes('[Rolls] Code rolled these'), `${formula}: the record holds no copy of the cue`);

        const reread = await host.turn.reread(2);
        assert.equal(reread.ok, true);
        assert.equal(receiptCue(rollReceipt(host, 2)), cue, 'a Re-read keeps the dice and the cue');
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live);
        await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
        assert.equal(JSON.stringify(host.head()), live);
        assert.deepEqual(host.store.problems(), []);
        host.close();
    }
});
