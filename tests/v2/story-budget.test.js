// What a reply's story money is counted as (RX-E-2): a module's `wallet.receive { story: true }` from a click
// after the reply is paid in full and counted in the same per-reply tally as the reply's own `+ coin` lines, under
// the reply the click is stored on (the head carrier's sid, ctx.reply). `inventory.storyBudget` says what the
// current reply has given; there is no limit, so its `budget` and `left` are null. Swipes and deletes take a
// click's tally back with its reply; a rebuild equals live.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';

const reply = (text, lines) => `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const coin = host => host.head().domains.inventory.wallets.party?.coin ?? 0;
const plain = value => JSON.parse(JSON.stringify(value));

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

const NONE = null;   // storyBudget's budget and left: no limit
const told = (paid) => ({ budget: NONE, paid, left: NONE });

test('a click after the reply is paid in full and counted with the reply\'s + coin lines', async t => {
    const host = await fresh(t);
    await host.send('Paid.', reply('A purse.', ['+ coin 700']));
    assert.deepEqual(budget(host), told(700));
    assert.equal(vouched(host), 0, 'the reply\'s own coin lines are not vouched payouts');
    const before = coin(host);
    const out = await click(host, 5000);
    assert.equal(out.ok, true);
    assert.equal(coin(host) - before, 5000, 'all of it is paid');
    assert.deepEqual(seen[0].reply, { index: host.store.headIndex(), sid: host.store.carrierSid(host.store.headIndex()) });
    assert.deepEqual(seen[0].budget, { ...told(5700), vouched: 5000 }, 'the command\'s own query sees its draft; 5000 of it vouched');
    assert.equal((await click(host, 100)).ok, true);
    assert.equal(coin(host) - before, 5100);
    assert.deepEqual(budget(host), told(5800));
    assert.equal(vouched(host), 5100);
});

test('a click first, then a Continue on that reply: the continued + coin line is paid too', async t => {
    const host = await fresh(t);
    await host.send('Wait.', reply('An hour.', []));
    const before = coin(host);
    await click(host, 3000);
    assert.deepEqual(budget(host), told(3000));
    await host.cont(reply(' And a purse.', ['+ coin 4000']));
    assert.equal(coin(host) - before, 7000);
    assert.deepEqual(host.turn.problems(), []);
    assert.deepEqual(budget(host), told(7000));
});

test('the next reply counts from nothing; a click without story: true is not counted', async t => {
    const host = await fresh(t);
    await host.send('Paid.', reply('A purse.', ['+ coin 1000']));
    const before = coin(host);
    await click(host, 50, false);
    assert.equal(coin(host) - before, 50, 'code\'s own payout');
    assert.deepEqual(budget(host), told(1000));
    await host.send('On.', reply('The road.', []));
    assert.deepEqual(budget(host), told(0), 'a reply that paid nothing has given nothing');
    await click(host, 400);
    assert.equal(coin(host) - before, 450);
    // a2-3: a click keeps its payout under the reply in `storyClicks` (its own key), not in the reply's
    // `perReply` entry; either way only this reply's bookkeeping is left.
    const sid = host.store.carrierSid(host.store.headIndex());
    assert.deepEqual(Object.keys(host.head().domains.inventory.perReply), []);
    assert.deepEqual(Object.keys(host.head().domains.inventory.storyClicks), [sid]);
});

test('an old saved storyCoinPerReply changes nothing about what the query or a click says', async t => {
    const host = await fresh(t);
    host.settings.set('story-block', 'storyCoinPerReply', 30);
    await host.send('Paid.', reply('Coins.', ['+ coin 20']));
    assert.deepEqual(budget(host), told(20));
    const before = coin(host);
    await click(host, 25);
    assert.equal(coin(host) - before, 25);
    assert.deepEqual(host.turn.problems(), []);
});

test('a swipe takes a click\'s tally back with its reply; a rebuild equals live', async t => {
    const host = await fresh(t);
    await host.send('Wait.', reply('An hour.', []));
    await click(host, 1000);
    await host.swipe(reply('Another hour.', ['+ coin 400']));
    assert.deepEqual(budget(host), told(400), 'the click went with the old swipe');
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
    assert.deepEqual(budget(host), told(1100));
    const wallet = coin(host);
    await host.st.deleteMessage(a);
    await host.st.deleteMessage(a - 1);
    assert.deepEqual(host.store.problems(), []);
    assert.equal(coin(host), wallet - 1400, 'A\'s line and click are gone; B\'s stay');
    assert.deepEqual(budget(host), told(1100));
    const live = plain(host.head());
    host.store.rebuild();
    assert.deepEqual(plain(host.head()), live, 'a cold rebuild says the same');
});
