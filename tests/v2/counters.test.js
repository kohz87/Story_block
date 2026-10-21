// Counts that move on replay (B3-8): a domain's `counters` (the inventory's wallets/*/coin and
// stacks/*/qty) are stored with the value they replaced (`was`), so a replay after a deleted middle
// reply adds each later change to what is there instead of writing the old totals back. Each test fails
// on the code before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isCounterPath, rebaseOps } from '../../src/v2/ops.js';
import { createRegistry } from '../../src/v2/registry.js';
import { createHost } from '../../testkit/index.js';

const reply = (text, lines) => `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const coin = host => host.head().domains.inventory.wallets.party?.coin ?? 0;
const qty = (host, name) => host.sdk.query('inventory.items').filter(item => item.name === name).reduce((sum, item) => sum + item.qty, 0);

async function fresh(t) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Hello.', reply('The road.', ['+ coin 10']));
    return host;
}

test('isCounterPath and rebaseOps: a count that stands elsewhere takes the change, not the number', () => {
    const patterns = ['wallets/*/coin', 'stacks/*/qty'];
    assert.equal(isCounterPath('/domains/inventory/wallets/party/coin', patterns), true);
    assert.equal(isCounterPath('/domains/inventory/stacks/it_aaaaaaaa/qty', patterns), true);
    assert.equal(isCounterPath('/domains/inventory/stacks/it_aaaaaaaa/note', patterns), false);
    assert.equal(isCounterPath('/meta/rev', patterns), false);
    const state = { domains: { inventory: { wallets: { party: { coin: 44 } } } } };
    const ops = [{ op: 'replace', path: '/domains/inventory/wallets/party/coin', value: 75, was: 74 }, { op: 'replace', path: '/meta/rev', value: 9 }];
    const { ops: moved, rebased } = rebaseOps(state, ops);
    assert.deepEqual(moved[0], { op: 'replace', path: '/domains/inventory/wallets/party/coin', value: 45, was: 44 });
    assert.equal(moved[1], ops[1]);
    assert.deepEqual([...rebased], ['inventory']);
    assert.equal(ops[0].value, 75, 'the stored op is left as it was');
    const same = rebaseOps({ domains: { inventory: { wallets: { party: { coin: 74 } } } } }, ops);
    assert.equal(same.ops[0], ops[0], 'standing where it was: applied as written');
    assert.equal(same.rebased.size, 0);
});

test('the bus stores was on counter ops only', async t => {
    const host = await fresh(t);
    await host.send('Buy.', reply('Rope.', ['+ item Rope | qty: 2', '+ coin 5']));
    const ops = host.store.opsAt(host.ctx.chat.length - 1);
    const coinOp = ops.find(op => op.path === '/domains/inventory/wallets/party/coin');
    assert.deepEqual({ value: coinOp.value, was: coinOp.was }, { value: 15, was: 10 });
    await host.send('More rope.', reply('Rope.', ['+ item Rope | qty: 3 | note: x', '+ item Rope']));
    const qtyOps = host.store.opsAt(host.ctx.chat.length - 1).filter(op => op.path.endsWith('/qty'));
    assert.deepEqual(qtyOps.map(op => [op.value, op.was]), [[3, 2]]);
    assert.ok(host.store.opsAt(host.ctx.chat.length - 1).filter(op => op.path === '/meta/rev').every(op => !('was' in op)));
});

test('deleting a middle reply takes back its own change to a count and keeps the later ones', async t => {
    const host = await fresh(t);
    await host.send('Rope.', reply('Rope.', ['+ item Rope | qty: 5']));
    await host.send('Sell.', reply('Sold.', ['- item Rope | qty: 2', '+ coin 30 | from: the chandler']));
    const sale = host.ctx.chat.length - 1;
    await host.send('On.', reply('Found.', ['+ coin 1', '- item Rope']));
    assert.deepEqual({ coin: coin(host), rope: qty(host, 'Rope') }, { coin: 41, rope: 2 });
    await host.st.deleteMessage(sale);
    await host.st.deleteMessage(sale - 1);
    assert.deepEqual({ coin: coin(host), rope: qty(host, 'Rope') }, { coin: 11, rope: 4 });
    assert.deepEqual(host.store.problems(), []);
    // A cold rebuild from the chat says the same.
    const live = host.head();
    host.store.rebuild();
    assert.deepEqual(host.head(), live);
});

test('a moved count the domain refuses (money below zero) skips that block, with a problem', async t => {
    const host = await fresh(t);
    await host.send('Paid.', reply('A purse.', ['+ coin 50']));
    const income = host.ctx.chat.length - 1;
    await host.send('Spend.', reply('Spent.', ['- coin 55 | to: the smith']));
    await host.send('Later.', reply('A tip.', ['+ coin 2']));
    assert.equal(coin(host), 7);
    await host.st.deleteMessage(income);
    await host.st.deleteMessage(income - 1);
    // 10 − 55 would be below zero: that payment no longer applies; the later tip still does.
    assert.equal(coin(host), 12);
    const [problem] = host.store.problems();
    assert.match(problem.message, /no longer fit/);
});

test('ops stored without was (older records) apply as written', async t => {
    const host = await fresh(t);
    await host.send('Gold.', reply('Gold.', ['+ coin 5']));
    const middle = host.ctx.chat.length - 1;
    await host.send('More.', reply('Gold.', ['+ coin 1']));
    // Strip `was` as an older Story Block wrote them.
    for (const message of host.ctx.chat) {
        const record = message.extra?.storySuite;
        if (!record) continue;
        for (const op of record.ops) delete op.was;
        const info = message.swipe_info?.[message.swipe_id ?? 0];
        if (info?.extra?.storySuite && info.extra !== message.extra) info.extra.storySuite = structuredClone(record);
    }
    await host.st.deleteMessage(middle);
    await host.st.deleteMessage(middle - 1);
    assert.equal(coin(host), 16, 'the absolute total comes back, as before');
});

test('a domain\'s counters must be paths inside it', () => {
    const registry = createRegistry();
    assert.throws(() => registry.register({ id: 'bad', domains: { bad: { initial: () => ({}), counters: ['/abs'] } } }), /counters must be a list of paths/);
    registry.register({ id: 'good', domains: { good: { initial: () => ({}), counters: ['pool/*/n'] } } });
    assert.deepEqual(registry.counters('good'), ['pool/*/n']);
    assert.deepEqual(registry.counters('nobody'), []);
});
