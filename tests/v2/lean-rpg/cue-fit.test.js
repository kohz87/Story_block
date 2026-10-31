// Fix round 4, B4: the [Rolls] cue is held to its token cap by shortening and is never dropped from the prompt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hostAvailable } from '../../../testkit/index.js';
import { LIMITS, prepare, readSheet, rollPrepared } from '../../../src/v2/lean-rpg/index.js';
import { cueTokens } from '../../../src/v2/lean-rpg/cue.js';
import { assemble } from '../../../src/v2/prompt.js';
import { character, foeBlock, rollReceipt, setup, sheetDomain, skillBlock, tailOf } from './helpers.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;

const NAMES = ['Wessel the Patient of the Long Drain', 'Ren Ashmantle of the Deep Culvert Guild', 'Odalys Brightwater of Saltmere Quay'].map(name => name.slice(0, 40));
const FOES = ['Sluice Rat Warren Elder of the Low Pipe', 'Gutter Serpent of the Black Overflow Run'].map(name => name.slice(0, 40));

test('B4: three characters and two foes with long names, Notes per reply at 100: the [Rolls] cue still reaches the narrator', { skip }, async () => {
    const blocks = {};
    NAMES.forEach((who, n) => { blocks[`pc${n}`] = { role: 'character', fields: character(who, { str: 14 }) }; });
    blocks.foes = { role: 'foes', fields: foeBlock([[FOES[0], 2, 1, 5], [FOES[1], 1, 1, 5]]) };
    const answer = [
        'pace: careful',
        ...NAMES.map(who => `act ${who} | stat: STR | target: ${FOES[0]}`),
        `foe ${FOES[0]} | target: ${NAMES[0]} | defend: AGI`,
        `foe ${FOES[1]} | target: ${NAMES[1]} | defend: AGI`,
    ].join('\n');
    const { host } = await setup({ blocks, answers: [answer] });
    host.settings.set(null, 'tailBudget', 100);
    const { request } = await host.send('We all strike at once.', 'The rats scatter.');
    const receipt = rollReceipt(host, 2);
    assert.ok(receipt, 'the roll is saved');
    assert.ok(receipt.summary.length > 400, `a long cue (${receipt.summary.length} characters)`);
    const tail = tailOf(request);
    assert.ok(tail.includes('[Rolls]'), 'the cue is in the request');
    for (const who of NAMES) assert.ok(tail.includes(who.slice(0, 20)), `${who} is told`);
    host.close();
});

test('B4: a pinned cue stays when the tail is over its budget, and ordinary notes go before it', () => {
    const registry = {
        contexts: () => [{ moduleId: 'a', name: 'A', domains: [], kinds: [], budget: 0, tail: () => ({ lines: ['note one', 'note two'], optional: ['optional note'] }) }],
    };
    const cue = '[Happened]\n[Rolls] Code rolled these. Tell them as given.\nWessel → Rat: SUCCESS (20 vs 10)';
    const out = assemble({ registry, view: {}, cues: { a: [{ text: cue, keep: true }] }, settings: { tailBudget: 5 } });
    assert.ok(out.tailText.includes('[Rolls] Code rolled these'));
    assert.ok(!out.tailText.includes('note one') && !out.tailText.includes('optional note'));
    const plain = assemble({ registry, view: {}, cues: { a: [cue] }, settings: { tailBudget: 5 } });
    assert.ok(!plain.tailText.includes('[Rolls]'), 'an ordinary cue is still dropped when over the budget');
});

// A sheet with six characters, four foes and every skill's mana Empty, rolled with scripted dice.
function maxPlan() {
    const blocks = {};
    for (let n = 0; n < 6; n += 1) {
        const who = `Hero${n}-${'x'.repeat(30)}`;
        blocks[`pc${n}`] = { role: 'character', fields: character(who, { mana: 0 }) };
        blocks[`sk${n}`] = { role: 'skills', fields: skillBlock(who, [['Arcane Surge of Great Moment', 2, 'int', 'mana']]) };
    }
    blocks.foes = { role: 'foes', fields: foeBlock([0, 1, 2, 3].map(n => [`Foe${n}-${'y'.repeat(30)}`, 2, 5, 5])) };
    const sheet = readSheet({ domains: { dataModules: sheetDomain(blocks) } });
    const who = n => sheet.characters[n].who, foe = n => sheet.foes[n].name;
    const plan = {
        pace: 'all',
        acts: [0, 1, 2, 3, 4, 5].map(n => ({ who: who(n), skill: 'Arcane Surge of Great Moment', target: foe(n % 4) })),
        foes: [0, 1, 2, 3].map(n => ({ slot: n + 1, target: who(n), defend: 'agi' })),
        checks: [0, 1, 2, 3].map(n => ({ who: who(n), skill: 'Arcane Surge of Great Moment', difficulty: 'very hard' })),
    };
    return { sheet, plan };
}

test('B4: the largest valid plan (six acts, four foes, four checks with an Empty skill) stays within the 600-token cue cap', () => {
    const { sheet, plan } = maxPlan();
    const prepared = prepare(plan, sheet);
    assert.equal(prepared.acts.length, 6);
    assert.equal(prepared.checks.length, 4);
    assert.ok(prepared.refused.length >= 4, 'the Empty skill is said');
    // Dice that never end the fight early, so as many rounds as the pace gives are drawn.
    for (const dice of [() => 10, (() => { let n = 0; return () => 8 + (n++ % 5); })()]) {
        const rolled = rollPrepared(plan, prepared, dice);
        assert.ok(cueTokens(rolled.text) <= LIMITS.cueTokens, `${cueTokens(rolled.text)} tokens`);
        assert.ok(rolled.rounds.length >= 1, 'at least one round is told');
        assert.ok(rolled.text.startsWith('[Rolls]'));
        assert.equal(rolled.checks.length, 4, 'every check is still told');
    }
});

test('B4: shortening goes by fewer rounds first, then compact checks and refusals, and a small plan is left whole', () => {
    const { sheet, plan } = maxPlan();
    const small = { pace: 'normal', acts: plan.acts.slice(0, 1), foes: [], checks: [] };
    const prepared = prepare(small, sheet);
    const rolled = rollPrepared(small, prepared, () => 10);
    assert.ok(rolled.text.includes('Arcane Surge of Great Moment'), 'not shortened when it fits');
    assert.equal(rolled.rounds.length, 5);
});
