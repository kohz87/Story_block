// B-a1-8 (a1, story-suite break pass 2): with Coins set to copper 1 and silver 10 and the currency name
// left at its default ("gold"), "+ coin 2 gold" pays 2 copper: money.js coinValue falls back to the
// currency's own name at worth 1. parseAmount promises that "any other word is refused, so no amount is
// read in the wrong coin". A world with coins should read only its coins (and the base unit's names); the
// currency name, when it is not one of the coins, should be refused like any other word.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

const coin = host => host.sdk.query('inventory.wallet', { owner: 'party' }).coin ?? 0;

test('"+ coin 2 gold" is not read as 2 copper when gold is not a coin of this world', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ settings: { modules: { 'story-block': { coins: [{ name: 'copper', value: 1 }, { name: 'silver', value: 10 }], storyCoinPerReply: 500 } } } });
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    await host.send('Paid.', 'He pays.\n\n<Changes>\n+ coin 3 silver\n</Changes>');
    assert.equal(coin(host), 30, 'setup: silver converts');
    await host.send('Paid.', 'Two gold pieces.\n\n<Changes>\n+ coin 2 gold\n</Changes>');
    assert.equal(coin(host), 30, 'gold is not a coin here: refused, not paid as 2 copper');
    assert.ok(host.turn.problems().some(item => /not a coin here/.test(item.message)), 'told why');
});
