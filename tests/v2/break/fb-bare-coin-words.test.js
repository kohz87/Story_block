// Final break FB-3: with no Coins setting, "+ item Gold Coins" went to the wallet (gold is the currency's
// name) but "+ item Coins | qty: 5" stayed a story item "Coins" x5: "coins" alone was a filler word, so it
// named nothing. The bare money words now name the smallest unit (money.js coinValue), so every money-named
// item is money, as #139 ruled: coin, coins, the currency's own name and its plural, with qty (MODULES §F108).
import test from 'node:test';
import assert from 'node:assert/strict';
import { coinValue, currencyOf, parseAmount } from '../../../src/v2/domains/money.js';
import { createHost } from '../../../testkit/index.js';

const COINS = [{ name: 'copper', value: 1 }, { name: 'silver', value: 10 }, { name: 'gold', value: 100 }];
const coin = host => host.sdk.query('inventory.wallet', { owner: 'party' }).coin ?? 0;
const items = host => host.sdk.query('inventory.items').map(item => `${item.name} x${item.qty}`);

async function fresh(t, settings = {}) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ settings });
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    return host;
}

test('coinValue: "coin" or "coins" alone is the smallest unit; filler words alone are not money', () => {
    const plain = currencyOf({});
    const coined = currencyOf({ coins: COINS });
    for (const currency of [plain, coined]) {
        assert.deepEqual(['Coins', 'coin', 'COINS', 'pieces of coin'].map(word => coinValue(word, currency)), [1, 1, 1, 1]);
        assert.deepEqual(['pieces', 'of', 'Coin Purse', ''].map(word => coinValue(word, currency)), [0, 0, 0, 0]);
    }
    assert.deepEqual([coinValue('Gold Coins', plain), coinValue('Golds', plain), coinValue('Gold Coins', coined)], [1, 1, 100]);
    assert.deepEqual(parseAmount('5 coins', coined), { amount: 5 }, 'a coin line in coins is in the smallest unit, as "+ coin 5" is');
});

for (const [line, paid] of [['+ item Coins | qty: 5', 5], ['+ item Coin', 1], ['+ item 5 coins', 5], ['+ item Gold Coins | qty: 4', 4], ['+ item Gold | qty: 2', 2], ['+ item Golds | qty: 3', 3]]) {
    test(`no Coins setting: "${line}" is money (${paid}), the same on Re-read`, async t => {
        const host = await fresh(t);
        await host.send('Found.', `A purse.\n\n<Changes>\n${line}\n</Changes>`);
        assert.deepEqual(items(host), [], 'no stack of coins as an item');
        assert.equal(coin(host), paid);
        assert.equal((await host.turn.reread(host.ctx.chat.length - 1)).ok, true);
        assert.deepEqual([items(host), coin(host)], [[], paid]);
    });
}

test('no Coins setting: "- item Coins | qty: 2" pays 2; a coin purse stays an item', async t => {
    const host = await fresh(t);
    await host.send('Paid.', 'He pays.\n\n<Changes>\n+ coin 10\n</Changes>');
    await host.send('I pay.', 'You pay.\n\n<Changes>\n- item Coins | qty: 2\n+ item Coin Purse\n</Changes>');
    assert.equal(coin(host), 8);
    assert.deepEqual(items(host), ['Coin Purse x1']);
});

test('with Coins: "+ item Coins | qty: 5" is 5 of the smallest coin; "? loot 3 coins" too', async t => {
    const host = await fresh(t, { modules: { 'story-block': { coins: COINS } } });
    await host.send('Found.', 'A purse.\n\n<Changes>\n+ item Coins | qty: 5\n</Changes>');
    assert.deepEqual([items(host), coin(host)], [[], 5]);
    await host.send('Look.', 'A crate.\n\n<Changes>\n? loot 3 coins, Rope\n</Changes>');
    const sid = host.store.carrierSid(host.store.headIndex());
    const out = await host.sdk.command('inventory.lootTake', { sid, pick: [0, 1] });
    assert.equal(out.ok, true, out.message);
    assert.deepEqual([items(host), coin(host)], [['Rope x1'], 8]);
});
