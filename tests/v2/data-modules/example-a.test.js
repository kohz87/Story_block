// Worked example A of docs/v2/DATA_MODULES.md (Ersveil faction reputation), end to end on the real
// host: the three replies, the doc's numbers, its delete / Re-read cases and a reload.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reply, world, pin, view, success } from './helpers.js';

const ID = 'pack.ersveil-factions/reputation';
const GAIN = reason => `+ dm pack.ersveil-factions/reputation — ${reason} | kind: gain | faction: guild`;
const LOSS = '- dm pack.ersveil-factions/reputation — broke the Watch\'s seal | kind: loss | faction: watch';
const standing = host => view(host, ID).chat;
const reload = async host => {
    const live = JSON.stringify(host.head());
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(JSON.stringify(host.head()), live, 'a reload gives the live head');
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, 'a cold rebuild gives the live head');
};
const dmProblems = host => host.store.problems().filter(problem => problem.code === 'REPLAY_PREREQUISITE');

async function story(t) {
    const host = await world(t);
    await host.send('Begin.', 'The guild hall.');
    const offer = await pin(host);
    const at = [];
    for (const lines of [[GAIN('repaired the Guild\'s weir')], [GAIN('brought back the register')], [LOSS]]) {
        await host.send('Go on.', reply(...lines));
        at.push(host.ctx.chat.length - 1);
    }
    return { host, offer, at };
}

test('A: Guild 0 -> 3 -> 6 with the title, Watch 0 -> -5, Compact 0 (the doc\'s numbers)', async t => {
    const host = await world(t);
    await host.send('Begin.', 'The guild hall.');
    await pin(host);
    assert.deepEqual(standing(host), { standing: { guild: 0, watch: 0, compact: 0 }, title: 'none' });
    await host.send('One.', reply(GAIN('repaired the Guild\'s weir')));
    assert.deepEqual(standing(host), { standing: { guild: 3, watch: 0, compact: 0 }, title: 'none' });
    await host.send('Two.', reply(GAIN('brought back the register')));
    assert.deepEqual(standing(host), { standing: { guild: 6, watch: 0, compact: 0 }, title: 'Guild Friend' });
    await host.send('Three.', reply(LOSS));
    assert.deepEqual(standing(host), { standing: { guild: 6, watch: -5, compact: 0 }, title: 'Guild Friend' });
    assert.deepEqual(host.sdk.query('dataModules.public', { module: ID, export: 'standing' }), standing(host), 'the export is the module\'s declared fields');
    assert.deepEqual(host.store.problems(), []);
    await reload(host);
});

test('A: the second gain records template favour, range [1,5], midpoint, amount 3, binding guild, the pin hash and its Source with the title effect', async t => {
    const { host, offer, at } = await story(t);
    const span = host.ctx.chat[at[1]].extra.storySuite.spans.find(each => each.guard?.predicate?.kind === 'dm.act');
    assert.equal(span.guard.predicate.hash, offer.hash);
    assert.equal(span.guard.rulesHash, null, 'the rules marker, not the data definition hash');
    const { ordinal, ...pair } = span.source;
    assert.deepEqual(pair, (({ ordinal: _, ...rest }) => rest)(host.store.sourceAt(at[1])));
    assert.ok(Number.isInteger(ordinal));
    const [decision] = span.recorded.decision.decisions;
    assert.equal(decision.template, 'favour');
    assert.deepEqual(decision.ranges.amount, { min: 1, max: 5, pick: 'midpoint' });
    assert.deepEqual(decision.values, { amount: 3 });
    assert.deepEqual(decision.bind, { faction: 'guild' });
    assert.deepEqual(span.recorded.decision.decisions.length, 1);
    const receipt = host.ctx.chat[at[1]].extra.storySuite.receipts.find(each => each.module === 'story-block' && each.data?.v2?.guard?.predicate?.kind === 'dm.act');
    assert.ok(receipt.data.v2.result, 'the durable decision is on the receipt, not only its display data');
    const ops = host.ctx.chat[at[1]].extra.storySuite.ops.map(op => op.path);
    assert.ok(ops.some(path => path.endsWith('/fields/title')), 'the title effect is in the same block');
});

test('A: faction crown is refused, nothing applied', async t => {
    const host = await world(t);
    await host.send('Begin.', 'Hall.');
    await pin(host);
    const before = JSON.stringify(host.head().domains.dataModules);
    await host.send('Try.', reply('+ dm pack.ersveil-factions/reputation — a favour | kind: gain | faction: crown'));
    assert.equal(JSON.stringify(host.head().domains.dataModules), before);
    assert.ok(host.turn.problems().some(problem => problem.code === 'DM_LABEL' && /faction/.test(problem.message)));
});

test('A: repeating a gain for Guild in a Continue of the same reply is CLAIMED', async t => {
    const host = await world(t);
    await host.send('Begin.', 'Hall.');
    await pin(host);
    await host.send('One.', reply(GAIN('first')));
    await host.cont(reply(GAIN('again')));
    assert.equal(standing(host).standing.guild, 3);
    assert.ok(host.turn.problems().some(problem => problem.code === 'CLAIMED'));
});

test('A: deleting the second gain retracts its +3 and its title together; the loss, whose answers do not change, stays', async t => {
    const { host, at } = await story(t);
    await host.st.deleteMessage(at[1]);
    assert.deepEqual(standing(host), { standing: { guild: 3, watch: -5, compact: 0 }, title: 'none' });
    assert.deepEqual(dmProblems(host), []);
    await reload(host);
});

test('A: deleting the first gain makes only the second inactive (REPLAY_PREREQUISITE); Re-read applies +3 without a title', async t => {
    const { host, at } = await story(t);
    await host.st.deleteMessage(at[0]);
    // The second gain's starting-value guard fails. The loss read the guild standing only for the title rule, which answers
    // "no" now as it did then, so it is still in force.
    assert.deepEqual(standing(host), { standing: { guild: 0, watch: -5, compact: 0 }, title: 'none' });
    const inactive = dmProblems(host);
    assert.equal(inactive.length, 1, JSON.stringify(inactive));
    assert.match(inactive[0].message, /Re-read/);
    await reload(host);
    assert.equal(dmProblems(host).length, 1);
    // One message fewer before it now.
    success(await host.turn.reread(at[1] - 1));
    assert.deepEqual(standing(host), { standing: { guild: 3, watch: -5, compact: 0 }, title: 'none' }, 'recomputed from the new starting value: +3, no title, the loss untouched');
    assert.deepEqual(dmProblems(host), []);
    await reload(host);
});

test('A: a later action whose rule answer would change is stale; one whose answer stays is not', async t => {
    // gain, gain (title), gain: the third read "guild 6 and no title yet" = no. Without the second, it would be "guild 3 + 3 = 6" = yes.
    const host = await world(t);
    await host.send('Begin.', 'The guild hall.');
    await pin(host);
    const at = [];
    for (const reason of ['one', 'two', 'three']) { await host.send('Go.', reply(GAIN(reason))); at.push(host.ctx.chat.length - 1); }
    assert.deepEqual(standing(host), { standing: { guild: 9, watch: 0, compact: 0 }, title: 'Guild Friend' });
    await host.st.deleteMessage(at[1]);
    assert.equal(dmProblems(host).length, 1, 'the third gain would now earn the title: its recorded answer is stale');
    assert.deepEqual(standing(host), { standing: { guild: 3, watch: 0, compact: 0 }, title: 'none' });
    success(await host.turn.reread(at[2] - 1));
    assert.deepEqual(standing(host), { standing: { guild: 6, watch: 0, compact: 0 }, title: 'Guild Friend' });
    assert.deepEqual(dmProblems(host), []);
    await reload(host);
});

test('A: swiping a reply away retracts its block; the pin\'s own reply carries the pin (Re-read retracts it, never silently pins again)', async t => {
    const { host, at } = await story(t);
    const pinReply = host.ctx.chat.findIndex(message => message.extra?.storySuite?.spans?.some(span => span.guard?.predicate?.kind === 'dm.pin'));
    assert.ok(pinReply >= 0);
    const result = await host.turn.reread(pinReply);
    success(result);
    assert.equal(host.head().domains.dataModules?.active?.[ID], undefined, 'Re-read of the pin\'s reply retracts the pin');
    assert.equal(host.sdk.query('dataModules.view', { module: ID }), null);
    assert.ok(dmProblems(host).length >= 1, 'its dependent gains are inactive, not recalculated');
    await reload(host);
    assert.ok(at.length === 3);
});
