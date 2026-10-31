// B-a1-7 (a1, story-suite break pass 2): with Coins (copper 1, silver 10, gold 100), "+ coin 3 silver
// coins" pays 30 (money.js coinValue drops "coins"/"pieces"/"of" and reads "silvers"), but the item and loot
// paths ask isCurrencyName, which wants the exact coin name: "+ item Silver Coins | qty: 3" makes a story
// item "Silver Coins" x3 and "? loot 2 gold pieces" offers an item "2 gold pieces" instead of 200 copper.
// Money ends up as items the wallet, prices and the coin budget do not see, and the two paths disagree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

const COINS = [{ name: 'copper', value: 1 }, { name: 'silver', value: 10 }, { name: 'gold', value: 100 }];
const coin = host => host.sdk.query('inventory.wallet', { owner: 'party' }).coin ?? 0;
const names = host => host.sdk.query('inventory.items').map(item => item.name);

async function fresh(t) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ settings: { modules: { 'story-block': { coins: COINS } } } });
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    return host;
}

for (const line of ['+ item Silver Coins | qty: 3', '+ item 3 silver coins', '+ item Silvers | qty: 3']) {
    test(`"${line}" is money (30 copper), not a story item`, async t => {
        const host = await fresh(t);
        await host.send('Paid.', 'He pays.\n\n<Changes>\n+ coin 3 silver coins\n</Changes>');
        assert.equal(coin(host), 30, 'setup: the coin line reads "3 silver coins" as 30');
        await host.send('Found.', `A purse.\n\n<Changes>\n${line}\n</Changes>`);
        assert.deepEqual(names(host), [], 'no stack of coins as an item');
        assert.equal(coin(host), 60);
    });
}

test('"? loot 2 gold pieces" offers 200 copper, not an item', async t => {
    const host = await fresh(t);
    await host.send('Look.', 'A chest.\n\n<Changes>\n? loot 2 gold pieces, Rope — in the chest\n</Changes>');
    const items = host.sdk.query('inventory.loot')?.at(-1)?.items ?? [];
    const purse = items.find(item => item.coin !== undefined);
    assert.equal(purse?.coin, 200, JSON.stringify(items));
});
