// A Standard roll through the real turn (docs/v2/REPLAY.md): the preview is what is stored, the bars it moved are written to the sheet, a
// Re-read, a rebuild and a reload give the same story, a swipe rolls again, the fight keeps its turn order from reply to reply, and a past
// roll keeps the formula and numbers it was made with whatever the settings say now.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hostAvailable } from '../../../testkit/index.js';
import { RESOLVE, ROLLS_QUERY, STANDARD_FORMULA, STANDARD_PRESETS, PRESETS, FORMULA_SETTING, DIFFICULTY_SETTING } from '../../../src/v2/lean-rpg/index.js';
import { OWNER, character, foeBlock, rollReceipt, setup, skillBlock, tailOf } from './helpers.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;

const blocks = (over = {}) => ({
    wessel: { role: 'character', fields: character('Wessel', { health: 6, str: 10, vit: 10, agi: 10, dex: 6, int: 5, luk: 9, soul: 2 }) },
    'wessel-skills': { role: 'skills', fields: skillBlock('Wessel', [['Iron Breath', 2, 'str']]) },
    foes: { role: 'foes', fields: foeBlock([['Sluice Rats', 6, 2, 5]]) },
    ...over,
});
const ANSWER = ['pace: all', 'act Wessel | skill: Iron Breath | type: physical | target: Sluice Rats', 'foe Sluice Rats | target: Wessel'].join('\n');
const fieldsOf = (host, slug) => host.head().domains.dataModules.instances[`pack.chat/${slug}`].chat.fields;
const resultOf = (host, index) => rollReceipt(host, index).data.v2.result;

function same(host, label = 'a rebuild') {
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, `${label} gives the live story`);
}
async function reloads(host) {
    const live = JSON.stringify(host.head());
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(JSON.stringify(host.head()), live, 'a reload gives the live story');
    assert.deepEqual(host.store.problems(), []);
}

test('a Standard roll: the payload carries the formula and numbers, the narrator is told the rolls, and the bars they moved are on the sheet', { skip }, async () => {
    const { host } = await setup({ blocks: blocks(), answers: [ANSWER], settings: { [FORMULA_SETTING]: 'standard' } });
    const { request } = await host.send('I hit the lead rat.', 'The rats scatter.');
    const receipt = rollReceipt(host, 2), result = resultOf(host, 2);
    assert.deepEqual(result.rules, STANDARD_FORMULA);
    assert.equal(receipt.replan.payload.rules.formula, 'standard');
    assert.equal(receipt.replan.payload.plan.formula, 'standard');
    assert.ok(tailOf(request).includes(receipt.summary), 'the cue told is the cue stored');
    assert.match(receipt.summary, /already moved the Health bars/);
    // The sheet holds exactly what the told lines did.
    const lines = [...result.opening, ...result.rounds.flatMap(round => round.lines)];
    const took = (id) => lines.filter(line => line.damage?.id === id);
    const last = id => took(id).at(-1)?.damage.to;
    assert.equal(fieldsOf(host, 'foes').hurt1, last('f:1') ?? 5);
    assert.equal(fieldsOf(host, 'wessel').health, last('c:wessel') ?? 6);
    for (const hurt of result.hurts) assert.equal(fieldsOf(host, hurt.module.split('/')[1])[hurt.field], hurt.to);
    assert.equal(result.order.length, 2);
    assert.deepEqual(host.sdk.query(ROLLS_QUERY, { index: 2 }).result.order, result.order);
    same(host);
    await reloads(host);
    host.close();
});

test('a Re-read keeps the dice, the order and the bars; a swipe rolls anew and puts the bars back first; a delete takes the rolls and their bars away', { skip }, async () => {
    const { host, callModel } = await setup({ blocks: blocks(), answers: [ANSWER], settings: { [FORMULA_SETTING]: 'standard' } });
    await host.send('I hit the lead rat.', 'The rats scatter.');
    const first = rollReceipt(host, 2), kept = JSON.stringify(first.data.v2.result), bars = JSON.stringify([fieldsOf(host, 'foes').hurt1, fieldsOf(host, 'wessel').health]);
    const head = JSON.stringify(host.head());
    assert.equal((await host.turn.reread(2)).ok, true);
    assert.equal(JSON.stringify(rollReceipt(host, 2).data.v2.result), kept);
    assert.equal(JSON.stringify([fieldsOf(host, 'foes').hurt1, fieldsOf(host, 'wessel').health]), bars);
    assert.equal(JSON.stringify(host.head()), head);
    assert.equal(callModel.calls.length, 1);

    const seeds = new Set([first.seed]);
    for (let n = 0; n < 4; n += 1) {
        await host.swipe(`Another telling ${n}.`);
        seeds.add(rollReceipt(host, 2).seed);
        // Whatever the new dice did, the bars are the sheet's own start plus only this roll's hits.
        const result = resultOf(host, 2);
        const expected = (id, start) => result.hurts.find(hurt => hurt.id === id)?.to ?? start;
        assert.equal(fieldsOf(host, 'foes').hurt1, expected('f:1', 5));
        assert.equal(fieldsOf(host, 'wessel').health, expected('c:wessel', 6));
    }
    assert.equal(seeds.size, 5);
    same(host);
    await reloads(host);
    await host.st.deleteMessage(2);
    assert.equal(fieldsOf(host, 'foes').hurt1, 5, 'the foe is back to full');
    assert.equal(fieldsOf(host, 'wessel').health, 6);
    host.close();
});

test('the turn order is rolled at the start of a fight and kept by the next replies; a swipe of the first reply rolls it again, a swipe of a later one keeps it', { skip }, async () => {
    // Plenty of health on both sides so the fight goes on; the planner asks for one careful exchange each time.
    const long = blocks({ foes: { role: 'foes', fields: foeBlock([['Sluice Rats', 6, 6, 8]]) }, wessel: { role: 'character', fields: character('Wessel', { health: 8, str: 10, vit: 20, agi: 10, dex: 6, soul: 2 }) } });
    const answer = ['pace: careful', 'act Wessel | skill: Iron Breath | type: physical | target: Sluice Rats', 'foe Sluice Rats | target: Wessel'].join('\n');
    const { host } = await setup({ blocks: long, answers: [answer], settings: { [FORMULA_SETTING]: 'standard' } });
    await host.send('I hit the rat.', 'One.');
    // A swipe of the reply that began the fight rolls the order again (new dice for everyone).
    const seenTotals = new Set([JSON.stringify(resultOf(host, 2).order.map(entry => entry.total))]);
    for (let n = 0; n < 6; n += 1) { await host.swipe(`One, again ${n}.`); seenTotals.add(JSON.stringify(resultOf(host, 2).order.map(entry => entry.total))); }
    assert.ok(seenTotals.size > 1, 'the order is rolled again by a swipe');
    const order = resultOf(host, 2).order;
    assert.ok(order.every(entry => entry.fresh));
    await host.send('I hit again.', 'Two.');
    const second = rollReceipt(host, 4);
    assert.deepEqual(second.replan.payload.order.map(entry => entry.id), order.map(entry => entry.id), 'the order goes on in the payload');
    assert.deepEqual(resultOf(host, 4).order.map(entry => [entry.id, entry.total]), order.map(entry => [entry.id, entry.total]));
    assert.ok(resultOf(host, 4).order.every(entry => entry.fresh === false));
    assert.deepEqual(resultOf(host, 4).quickStart, []);
    // The span's guard hashes the order it was given, so a damaged one is refused.
    const span = host.ctx.chat[4].extra.storySuite.spans.find(entry => entry.guard?.predicate?.kind === RESOLVE);
    assert.ok(span.guard.predicate.order, 'the order is in the guard');
    assert.deepEqual(span.recorded.order, second.replan.payload.order);
    // A Re-read of the second reply keeps it; a swipe of the second keeps the first reply's order.
    assert.equal((await host.turn.reread(4)).ok, true);
    assert.deepEqual(resultOf(host, 4).order.map(entry => entry.id), order.map(entry => entry.id));
    await host.swipe('Two, again.');
    assert.deepEqual(resultOf(host, 4).order.map(entry => [entry.id, entry.total]), order.map(entry => [entry.id, entry.total]), 'the order the fight began with');
    same(host);
    await reloads(host);
    assert.deepEqual(host.store.problems(), []);
    host.close();
});

test('REPLAY RULE: a Standard roll keeps its formula and numbers when the settings change to another preset or to Classic; a new roll takes the settings of its moment', { skip }, async () => {
    const { host } = await setup({ blocks: blocks(), answers: [ANSWER], settings: { [FORMULA_SETTING]: 'standard', [DIFFICULTY_SETTING]: 'harsh' } });
    await host.send('First.', 'One.');
    const kept = JSON.stringify(resultOf(host, 2));
    assert.deepEqual(resultOf(host, 2).rules, STANDARD_PRESETS.harsh);
    host.settings.set(OWNER, FORMULA_SETTING, 'classic');
    host.settings.set(OWNER, DIFFICULTY_SETTING, 'gentle');
    assert.equal((await host.turn.reread(2)).ok, true);
    assert.equal(JSON.stringify(resultOf(host, 2)), kept, 'a Re-read under Classic keeps the Standard roll');
    same(host);
    await reloads(host);
    assert.equal(JSON.stringify(resultOf(host, 2)), kept);
    // The next roll is a Classic one: the old planner prompt, no formula key, no typed lines, and no bars moved by code.
    const classic = ['act Wessel | skill: Iron Breath | stat: STR | target: Sluice Rats', 'foe Sluice Rats | target: Wessel | defend: AGI'].join('\n');
    const { host: second, callModel } = await setup({ blocks: blocks(), answers: [classic], settings: { [FORMULA_SETTING]: 'classic' } });
    await second.send('First.', 'One.');
    const result = resultOf(second, 2);
    assert.deepEqual(result.rules, PRESETS.standard);
    assert.equal('formula' in result.rules, false);
    for (const key of ['order', 'quickStart', 'opening', 'idle', 'hurts']) assert.equal(key in result, false, key);
    assert.equal(fieldsOf(second, 'foes').hurt1, 5, 'Classic leaves the bars to the narrator');
    assert.doesNotMatch(callModel.calls[0].prompt, /type: physical\|magic/);
    assert.equal(rollReceipt(second, 2).replan.payload.order, undefined);
    host.close();
    second.close();
});

test('a change to the sheet before a Standard roll plans it again with the same dice and the bars it now gives', { skip }, async () => {
    const { host } = await setup({ blocks: blocks(), answers: [ANSWER], settings: { [FORMULA_SETTING]: 'standard' } });
    await host.send('First.', 'One.');
    await host.send('Second.', 'Two.');
    const seed = rollReceipt(host, 4).seed;
    // The first reply goes: the sheet before the second roll is the start again, so its roll is planned again on that.
    await host.st.deleteMessage(2);
    const at = host.ctx.chat.findLastIndex(message => !message.is_user);
    const planned = rollReceipt(host, at);
    assert.equal(planned.seed, seed, 'the same dice');
    const result = planned.data.v2.result;
    for (const hurt of result.hurts) assert.ok(hurt.from === (hurt.kind === 'foe' ? 5 : 6), 'it starts from the sheet as it is now');
    assert.deepEqual(host.store.problems(), []);
    same(host);
    await reloads(host);
    host.close();
});
