// One story-money budget per reply (RX-E-2): a module's `wallet.receive { story: true }` from a click
// after the reply counts against the same per-reply tally as the reply's own `+ coin` lines, under the
// reply the click is stored on (the head carrier's sid, ctx.reply). `inventory.storyBudget` says what
// the current reply may give, has given and has left. Swipes and deletes take a click's tally back with
// its reply; a rebuild equals live.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';

const reply = (text, lines) => `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const coin = host => host.head().domains.inventory.wallets.party?.coin ?? 0;
const plain = value => JSON.parse(JSON.stringify(value));
const BUDGET = 1000;   // 1000 × level 1, no quest ranks

// A module whose button pays a reward the story wrote, as Story Director's quest Finish click does.
const seen = [];
const clicking = {
    id: 'zz-click', name: 'Click',
    commands: {
        'zz.reward'(ctx, payload) {
            const out = ctx.call('wallet.receive', { owner: 'party', amount: payload.amount, story: payload.story !== false });
            seen.push({ amount: out.data.amount, reply: ctx.reply, budget: ctx.query('inventory.storyBudget') });
            return { summary: out.summary, data: { amount: out.data.amount } };
        },
    },
};

async function fresh(t, options = {}) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ modules: [clicking], ...options });
    t.after(() => host.close());
    await host.send('Hello.', reply('The road.', ['+ item Torch']));
    seen.length = 0;
    return host;
}

const click = (host, amount, story = true) => host.sdk.command('zz.reward', { amount, story });
// { budget, paid, left } of inventory.storyBudget; `vouched` (the part modules' payouts gave) on its own.
const budget = host => { const { vouched, ...rest } = host.sdk.query('inventory.storyBudget'); return rest; };
const vouched = host => host.sdk.query('inventory.storyBudget').vouched;

test('a click after the reply is held to what the reply\'s + coin lines left', async t => {
    const host = await fresh(t);
    await host.send('Paid.', reply('A purse.', ['+ coin 700']));
    assert.deepEqual(budget(host), { budget: BUDGET, paid: 700, left: 300 });
    assert.equal(vouched(host), 0, 'the reply\'s own coin lines are not vouched payouts');
    const before = coin(host);
    const out = await click(host, 500);
    assert.equal(out.ok, true);
    assert.equal(coin(host) - before, 300, 'what is left is paid');
    assert.deepEqual(seen[0].reply, { index: host.store.headIndex(), sid: host.store.carrierSid(host.store.headIndex()) });
    assert.deepEqual(seen[0].budget, { budget: BUDGET, paid: BUDGET, left: 0, vouched: 300 }, 'the command\'s own query sees its draft; 300 of it vouched');
    assert.equal((await click(host, 100)).ok, true, 'never refused');
    assert.equal(coin(host) - before, 300, 'nothing past the budget');
    assert.deepEqual(budget(host), { budget: BUDGET, paid: BUDGET, left: 0 });
    assert.equal(vouched(host), 300);
});

test('a click first, then a Continue on that reply: the continued + coin line is held', async t => {
    const host = await fresh(t);
    await host.send('Wait.', reply('An hour.', []));
    const before = coin(host);
    await click(host, BUDGET);
    assert.deepEqual(budget(host), { budget: BUDGET, paid: BUDGET, left: 0 });
    await host.cont(reply(' And a purse.', ['+ coin 400']));
    assert.equal(coin(host) - before, BUDGET, 'one reply, one budget');
    assert.match(host.turn.problems().map(problem => problem.message).join(' '), /already given all the money one reply may give/);
});

test('the next reply has a budget of its own; a click without story: true is not counted', async t => {
    const host = await fresh(t);
    await host.send('Paid.', reply('A purse.', [`+ coin ${BUDGET}`]));
    const before = coin(host);
    await click(host, 50, false);
    assert.equal(coin(host) - before, 50, 'code\'s own payout');
    assert.deepEqual(budget(host), { budget: BUDGET, paid: BUDGET, left: 0 });
    await host.send('On.', reply('The road.', []));
    assert.deepEqual(budget(host), { budget: BUDGET, paid: 0, left: BUDGET }, 'a reply that paid nothing has its whole budget');
    await click(host, 400);
    assert.equal(coin(host) - before, 450);
    assert.deepEqual(Object.keys(host.head().domains.inventory.perReply), [host.store.carrierSid(host.store.headIndex())]);
});

test('the reader\'s storyCoinPerReply sets the budget the query and a click hold to', async t => {
    const host = await fresh(t);
    host.settings.set('story-block', 'storyCoinPerReply', 30);
    await host.send('Paid.', reply('Coins.', ['+ coin 20']));
    assert.deepEqual(budget(host), { budget: 30, paid: 20, left: 10 });
    const before = coin(host);
    await click(host, 25);
    assert.equal(coin(host) - before, 10);
});

test('a swipe takes a click\'s tally back with its reply; a rebuild equals live', async t => {
    const host = await fresh(t);
    await host.send('Wait.', reply('An hour.', []));
    await click(host, BUDGET);
    await host.swipe(reply('Another hour.', ['+ coin 400']));
    assert.deepEqual(budget(host), { budget: BUDGET, paid: 400, left: 600 }, 'the click went with the old swipe');
    const live = plain(host.head());
    host.store.rebuild();
    assert.deepEqual(plain(host.head()), live, 'a cold rebuild says the same');
});

test('deleting a middle reply keeps a later reply\'s click tally; a rebuild equals live', async t => {
    const host = await fresh(t);
    await host.send('A.', reply('Coins.', ['+ coin 900']));
    await click(host, 500);
    const a = host.store.headIndex();
    await host.send('B.', reply('Coins.', ['+ coin 600']));
    await click(host, 500);
    assert.deepEqual(budget(host), { budget: BUDGET, paid: BUDGET, left: 0 });
    const wallet = coin(host);
    await host.st.deleteMessage(a);
    await host.st.deleteMessage(a - 1);
    assert.deepEqual(host.store.problems(), []);
    assert.equal(coin(host), wallet - BUDGET, 'A\'s line and click are gone; B\'s stay');
    assert.deepEqual(budget(host), { budget: BUDGET, paid: BUDGET, left: 0 });
    const live = plain(host.head());
    host.store.rebuild();
    assert.deepEqual(plain(host.head()), live, 'a cold rebuild says the same');
    await click(host, 1);
    assert.equal(coin(host), wallet - BUDGET, 'B still has nothing left');
});
