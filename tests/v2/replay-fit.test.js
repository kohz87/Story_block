// Replay after a middle reply is deleted (b1-capture round 2): a later reply's gains do not hang on
// the reply that first made a shared record (the story tally, the party's wallet: r2-11, r2-10), and a
// replayed block that would leave a domain invalid is skipped and reported (r2-14).
import test from 'node:test';
import assert from 'node:assert/strict';
import { rebaseOps } from '../../src/v2/ops.js';
import { validateInventory } from '../../src/v2/domains/inventory.js';
import { createHost } from '../../testkit/index.js';

const reply = (text, lines) => `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const coin = host => host.head().domains.inventory.wallets.party?.coin ?? 0;
const qty = (host, name) => host.sdk.query('inventory.items').filter(item => item.name === name).reduce((sum, item) => sum + item.qty, 0);

async function fresh(t) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    return host;
}

test('the story tally is kept under the reply\'s record ID, one entry at a time', async t => {
    const host = await fresh(t);
    await host.send('A.', reply('A.', ['+ coin 10']));
    await host.send('B.', reply('B.', ['+ coin 20', '+ item Rope']));
    const sid = host.store.carrierSid(host.store.headIndex());
    assert.deepEqual(host.head().domains.inventory.perReply, { [sid]: { coin: 20, worth: 0, made: 1, items: { 'story/rope': 1 } } });
});

test('deleting the reply that made the wallet and the tally keeps a later reply\'s money and items', async t => {
    const host = await fresh(t);
    await host.send('A.', reply('A.', ['+ coin 10']));
    const a = host.store.headIndex();
    await host.send('B.', reply('B.', ['+ coin 20', '+ item Rope']));
    await host.send('C.', reply('C.', ['- coin 5 | to: the ferryman', '+ item Torch | qty: 2']));
    await host.st.deleteMessage(a);
    await host.st.deleteMessage(a - 1);
    assert.deepEqual({ coin: coin(host), rope: qty(host, 'Rope'), torch: qty(host, 'Torch') }, { coin: 15, rope: 1, torch: 2 });
    assert.deepEqual(host.store.problems(), []);
});

test('r2-14: a replayed block that would leave a stack without its definition is skipped and reported', async t => {
    const host = await fresh(t);
    await host.send('A.', reply('A rope.', ['+ item Rope']));
    const a = host.store.headIndex();
    await host.send('B.', reply('Another, frayed.', ['+ item Rope | note: frayed', '+ coin 3']));
    assert.equal(qty(host, 'Rope'), 2);
    await host.st.deleteMessage(a);
    await host.st.deleteMessage(a - 1);
    assert.deepEqual(validateInventory(host.head().domains.inventory), [], 'the head state passes its own validator');
    assert.equal(qty(host, 'Rope'), 0);
    assert.equal(coin(host), 3, 'the block after it still applies (its own tally entry is made again)');
    const problems = host.store.problems();
    assert.equal(problems.length, 1);
    assert.match(problems[0].message, /no longer apply and were skipped: .*item definition that does not exist/);
});

test('rebaseOps: a count whose holder is gone counts from 0; per-reply scratch fits what is there', () => {
    const state = { domains: { inventory: { stacks: {}, wallets: {} } } };
    const scratch = name => (name === 'inventory' ? ['perReply'] : []);
    const { ops, rebased } = rebaseOps(state, [
        { op: 'replace', path: '/domains/inventory/wallets/party/coin', value: 30, was: 10 },
        { op: 'remove', path: '/domains/inventory/perReply/sw_old' },
        { op: 'add', path: '/domains/inventory/perReply/sw_new', value: { coin: 20 } },
        { op: 'replace', path: '/domains/inventory/perReply/sw_new/coin', value: 25 },
    ], { scratch });
    assert.deepEqual(ops, [
        { op: 'add', path: '/domains/inventory/wallets/party', value: { coin: 20 } },
        { op: 'add', path: '/domains/inventory/perReply', value: {} },
        { op: 'add', path: '/domains/inventory/perReply/sw_new', value: { coin: 20 } },
        { op: 'replace', path: '/domains/inventory/perReply/sw_new/coin', value: 25 },
    ]);
    assert.deepEqual([...rebased], ['inventory']);
    const kept = rebaseOps({ domains: { inventory: { perReply: { sw_old: {} } } } }, [{ op: 'remove', path: '/domains/inventory/perReply/sw_old' }], { scratch });
    assert.deepEqual(kept.ops, [{ op: 'remove', path: '/domains/inventory/perReply/sw_old' }], 'an entry that is there goes as written');
    const plain = rebaseOps(state, [{ op: 'remove', path: '/domains/inventory/perReply/sw_old' }]);
    assert.deepEqual(plain.ops, [{ op: 'remove', path: '/domains/inventory/perReply/sw_old' }], 'without scratch nothing is fitted');
});
