// `rpg.resolve` through the real turn: the preview is what is stored, a Re-read keeps the dice, a swipe or a
// regenerate draws new ones, a delete removes them, a rebuild and a reload give the same story, and a roll is planned
// again with the same dice when an earlier change to the sheet goes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hostAvailable } from '../../../testkit/index.js';
import { RESOLVE, ROLLS_QUERY, claimKey, leanRpgGuard, rollsOf } from '../../../src/v2/lean-rpg/index.js';
import { hashJson as hashOf } from '../../../src/v2/replay.js';
import { PLAN_ANSWER, rollReceipt, setup, tailOf } from './helpers.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const ONE = 'act Wessel | skill: Iron Breath | stat: STR | target: Sluice Rats';
const lines = receipt => receipt.summary.split('\n').filter(line => line.startsWith('Round'));

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

test('the preview is the stored roll: the seed in the prompt is the seed on the reply, and the block is guarded and claimed', { skip }, async () => {
    const { host } = await setup();
    const { request } = await host.send('I hit the lead rat.', 'The rats scatter.');
    const record = host.ctx.chat[2].extra.storySuite;
    const receipt = rollReceipt(host, 2);
    assert.equal(receipt.cause, 'system');
    assert.equal(receipt.guarded, true);
    assert.ok(receipt.replan, 'planned again when the story before it changes');
    assert.ok(tailOf(request).includes(receipt.summary), 'the cue told is the cue stored');
    const span = record.spans.find(entry => entry.guard?.predicate?.kind === RESOLVE);
    assert.ok(span, 'a guarded span');
    assert.equal(span.guard.owner, 'story-block');
    assert.deepEqual(span.claims, [claimKey(span.guard.predicate.key)]);
    assert.equal(host.head().meta.claims[claimKey(span.guard.predicate.key)], true);
    assert.equal(span.recorded.plan.pace, 'normal');
    assert.equal(receipt.data.v2.result.key, span.guard.predicate.key);
    // The record is the one the battle log draws from.
    assert.equal(receipt.data.v2.result.v, 1);
    assert.ok(receipt.data.v2.result.rounds.length >= 1);
    same(host);
    await reloads(host);
    host.close();
});

test('a Re-read keeps the dice; a swipe and a regenerate draw new ones with a new pre-call', { skip }, async () => {
    const { host, callModel } = await setup({ answers: [PLAN_ANSWER] });
    await host.send('I hit the lead rat.', 'The rats scatter.');
    const first = rollReceipt(host, 2);
    const before = JSON.stringify(host.head());

    const reread = await host.turn.reread(2);
    assert.equal(reread.ok, true);
    const again = rollReceipt(host, 2);
    assert.equal(again.seed, first.seed, 'same seed');
    assert.equal(again.summary, first.summary, 'same dice');
    assert.deepEqual(again.data.v2.result, first.data.v2.result);
    assert.equal(callModel.calls.length, 1, 'a Re-read never calls the model');
    assert.equal(JSON.stringify(host.head()), before);

    const seeds = new Set([first.seed]);
    await host.swipe('Another telling.');
    seeds.add(rollReceipt(host, 2).seed);
    assert.equal(callModel.calls.length, 2, 'a swipe plans anew');
    await host.regenerate('A third telling.');
    seeds.add(rollReceipt(host, 2).seed);
    assert.equal(callModel.calls.length, 3, 'so does a regenerate');
    assert.equal(seeds.size, 3, 'three generations, three seeds');
    assert.equal(host.ctx.chat[2].extra.storySuite.receipts.filter(receipt => receipt.type === RESOLVE).length, 1, 'one roll on the reply');
    same(host);
    host.close();
});

test('deleting the reply removes its dice (and the claim, so the message can be rolled for again)', { skip }, async () => {
    const { host } = await setup({ answers: [ONE] });
    await host.send('I hit the lead rat.', 'The rats scatter.');
    const key = rollReceipt(host, 2).data.v2.result.key;
    assert.equal(host.head().meta.claims[claimKey(key)], true);
    await host.st.deleteMessage(2);
    assert.equal(host.head().meta.claims?.[claimKey(key)], undefined);
    same(host, 'a rebuild after the delete');
    host.close();
});

test('an earlier change to the sheet goes: the roll is planned again with the same dice on the numbers that are there now', { skip }, async () => {
    const { host } = await setup({ answers: [ONE] });
    await host.send('First.', 'One.');
    // Wessel's STR goes from 14 to 20 on the first reply (his +7 becomes +10), and the second roll is made on that.
    assert.equal((await host.bus.command('test.set', { slug: 'wessel', field: 'str', value: 20 }, { cause: 'system' })).ok, true);
    await host.send('Second.', 'Two.');
    const second = rollReceipt(host, 4);
    const [round] = second.data.v2.result.rounds;
    assert.equal(round.lines[0].pc.statBonus, 10);
    const dieAt = receipt => receipt.data.v2.result.rounds[0].lines[0].pc.die;
    const seed = second.seed;
    const die = dieAt(second);
    const total = round.lines[0].pc.total;

    await host.st.deleteMessage(2);
    const at = host.ctx.chat.findIndex((message, index) => index > 0 && !message.is_user);
    const planned = rollReceipt(host, at);
    assert.equal(planned.seed, seed, 'the same dice');
    assert.equal(dieAt(planned), die);
    assert.equal(planned.data.v2.result.rounds[0].lines[0].pc.statBonus, 7);
    assert.equal(planned.data.v2.result.rounds[0].lines[0].pc.total, total - 3);
    assert.deepEqual(host.store.problems(), [], 'nothing is left inactive');
    same(host);
    await reloads(host);
    host.close();
});

test('the guard asks the sheet before the block: it holds while the numbers are the same and says so when they are not', { skip }, async () => {
    const { host } = await setup({ answers: [ONE] });
    await host.send('First.', 'One.');
    const span = host.ctx.chat[2].extra.storySuite.spans.find(entry => entry.guard?.predicate?.kind === RESOLVE);
    const before = host.store.before(2);
    const ask = state => leanRpgGuard({ state, hash: hashOf }, { guard: span.guard, source: span.source, recorded: span.recorded });
    assert.deepEqual(ask(before), { ok: true });
    const moved = structuredClone(before);
    moved.domains.dataModules.instances['pack.chat/wessel'].chat.fields.str = 20;
    const answer = ask(moved);
    assert.equal(answer.ok, false);
    assert.match(answer.reason, /^The sheet before this roll changed; Re-read this reply\.$/);
    const damaged = { ...span.recorded, plan: { pace: 'sideways' } };
    assert.equal(leanRpgGuard({ state: before, hash: hashOf }, { guard: span.guard, source: span.source, recorded: damaged }).ok, false);
    assert.equal(leanRpgGuard({ state: before, hash: hashOf }, { guard: { ...span.guard, predicate: { kind: 'dm.act' } }, source: span.source, recorded: span.recorded }).ok, false);
    assert.equal(leanRpgGuard({ state: before, hash: hashOf }, {}).ok, false);
    host.close();
});

test('a second roll for the same message is refused (one claim per message), and a bad payload stores nothing', { skip }, async () => {
    const { host } = await setup({ answers: [ONE] });
    await host.send('First.', 'One.');
    const state = JSON.stringify(host.head());
    const { key } = rollReceipt(host, 2).data.v2.result;
    const plan = host.ctx.chat[2].extra.storySuite.spans.find(entry => entry.guard?.predicate?.kind === RESOLVE).recorded.plan;
    assert.equal((await host.bus.command(RESOLVE, { key, plan }, { cause: 'system' })).code, 'CLAIMED');
    for (const [payload, code] of [
        [{ key: 'nope', plan }, 'INVALID'],
        [{ key: '9-abc', plan: { pace: 'sideways' } }, 'INVALID'],
        [{ key: '9-abc' }, 'INVALID'],
        [{ key: '9-abc', plan: { pace: 'normal', acts: [{ who: 'Nobody', stat: 'str', target: 'Sluice Rats' }] } }, 'NO_LONGER_DONE'],
    ]) assert.equal((await host.bus.command(RESOLVE, payload, { cause: 'system' })).code, code);
    assert.equal((await host.bus.command(RESOLVE, { key: '9-abc', plan }, { cause: 'ui' })).code, 'REFUSED', 'never a reader\'s action');
    assert.equal(JSON.stringify(host.head()), state);
    host.close();
});

test('the query hands a reply\'s rolls to the battle log: the record, the summary, and nothing for a reply without any', { skip }, async () => {
    const { host } = await setup({ answers: [PLAN_ANSWER, 'none'] });
    await host.send('I hit the lead rat.', 'The rats scatter.');
    await host.send('I thank the guard.', 'He nods.');
    const found = host.sdk.query(ROLLS_QUERY, { index: 2 });
    assert.equal(found.result.v, 1);
    assert.equal(found.summary.exchanges, found.result.rounds.length);
    assert.equal(found.receipt.type, RESOLVE);
    assert.equal(host.sdk.query(ROLLS_QUERY, { index: 4 }), null, 'the head reply has none');
    assert.equal(host.sdk.query(ROLLS_QUERY), null, 'by default the head reply');
    assert.equal(rollsOf([], 2), null);
    assert.equal(rollsOf(null, 2), null);
    assert.equal(rollsOf([{ index: 2, receipt: { type: RESOLVE, data: { v2: { result: { v: 99 } } } } }], 2), null, 'a record of another version is not read');
    host.close();
});

test('a Re-read of a reply whose rolls were made keeps them when the feature is turned off afterwards', { skip }, async () => {
    const { host } = await setup({ answers: [ONE] });
    await host.send('First.', 'One.');
    const first = rollReceipt(host, 2);
    host.features.set('story-block.lean-rpg', false);
    assert.equal((await host.turn.reread(2)).ok, true);
    assert.equal(rollReceipt(host, 2).seed, first.seed);
    assert.equal(rollReceipt(host, 2).summary, first.summary);
    host.close();
});
