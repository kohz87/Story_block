// a2-3 (final breaker cell): a click's vouched payout (`wallet.receive { story: true }`) is kept as its own
// key under the reply (`storyClicks[<sid>][<receipt>]`, add-only), and a Re-read's capture counts it from
// the reply as it stood (ctx.standing), so the reply's lines and the clicks after it share one budget
// live, on replay and on a cold rebuild (SPEC §2.2). Story Block alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { createStore } from '../../../src/v2/store.js';

const QUESTS = {
    id: 'rv-quests', name: 'rv quests', version: '0.0.0',
    commands: { 'rv.turnIn': (ctx, { amount = 400 } = {}) => ctx.call('wallet.receive', { owner: 'party', amount, note: 'quest reward', story: true }) },
};
const coin = state => state.domains.inventory.wallets?.party?.coin ?? 0;
const block = lines => `\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const cold = h => createStore({ chat: () => JSON.parse(JSON.stringify(h.ctx.chat)), save: async () => {}, scratch: name => h.registry.scratch(name) }).head();

async function setup(t, firstLines) {
    t.mock.method(console, 'warn', () => {});
    const h = await createHost({ modules: [QUESTS], settings: { modules: { 'story-block': { storyCoinPerReply: 400 } } } });
    t.after(() => h.close());
    await h.send('We arrive.', 'The village gate.' + block(['+ coin 10']));
    await h.send('Any work?', 'Fenna has a job for you.' + block(firstLines));
    return h;
}

test('a click is paid what the reply\'s lines left, and kept as its own key', async t => {
    const h = await setup(t, ['+ coin 100']);
    const sid = h.store.carrierSid(h.store.headIndex());
    assert.equal((await h.sdk.command('rv.turnIn', {})).ok, true);
    assert.equal(coin(h.head()), 10 + 100 + 300);
    const inv = h.head().domains.inventory;
    assert.equal(inv.perReply[sid].coin, 100, 'the reply\'s own entry is not written by the click');
    assert.deepEqual(Object.values(inv.storyClicks[sid]), [300]);
    assert.deepEqual(h.sdk.query('inventory.storyBudget'), { budget: 400, paid: 400, left: 0, vouched: 300 });
});

test('Re-read of an unchanged reply after a click changes no money', async t => {
    const h = await setup(t, ['+ coin 100']);
    const index = h.store.headIndex();
    await h.sdk.command('rv.turnIn', { amount: 200 });
    const before = coin(h.head());
    assert.equal(before, 310);
    assert.equal((await h.sdk.reread(index)).ok, true);
    assert.equal(coin(h.head()), before);
    assert.equal(coin(cold(h)), before, 'a cold rebuild agrees');
});

test('Re-read that adds coin after a click: one budget live, on replay and on a cold rebuild', async t => {
    const h = await setup(t, ['~ place Bluewatch | kind: settlement']);
    const index = h.store.headIndex();
    await h.sdk.command('rv.turnIn', {});
    assert.equal(coin(h.head()), 410);
    await h.st.editMessage(index, 'Fenna pays up front.' + block(['~ place Bluewatch | kind: settlement', '+ coin 400']));
    const read = await h.sdk.reread(index);
    assert.equal(read.ok, true, read.message);
    assert.equal(coin(h.head()), 410, 'the click already used the budget; the new line is refused');
    assert.ok(read.problems.some(problem => /all the money one reply may give/.test(problem.message ?? '')), JSON.stringify(read.problems));
    assert.equal(h.sdk.query('inventory.storyBudget').paid, 400);
    assert.equal(coin(cold(h)), 410, 'a cold rebuild agrees');
    // A middle delete (the first exchange) replays the reply and its click on top: still one budget.
    await h.st.deleteMessage(2);
    await h.st.deleteMessage(1);
    assert.deepEqual(h.store.problems(), []);
    assert.equal(coin(h.head()), 400);
    assert.equal(coin(cold(h)), 400);
    assert.equal(h.sdk.query('inventory.storyBudget').paid, 400);
});
