// rx-capture (beta rolling attack) on SB #104 (`? loot`, merged ff96802): a count past three digits
// was read as part of the thing's name, so `Healing Draught x99999` laid out, and the take granted, an item
// named "Healing Draught x99999"; and a coin amount written as a thing ("1000 gold") became an item named
// "1000 gold" while "Gold x500" vanished without a Problem. The rule (coordinator, RX-cap-6): a count of any
// length is a count, clamped to the story item cap with a Problem; money in a loot line is a coin offer in
// that loot, held to the reply's coin budget and paid into the wallet on Take, never an item.
import test from 'node:test';
import assert from 'node:assert/strict';
import { STORY_ITEM_QTY } from '../../../src/v2/domains/inventory.js';
import { createHost } from '../../../testkit/index.js';

test('rx-capture: a loot count is never part of a name, and money is a coin offer, never a thing', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    try {
        let turn = null;
        const off = host.events.on('turn', value => { turn = value; });
        await host.send('Hello.', 'The road.');
        await host.send('Open it.', 'A chest.\n\n<Changes>\n? loot Healing Draught x99999, 1000 gold, Gold x500, Rope — in the chest\n</Changes>');
        off();
        const [sid, offer] = Object.entries(host.head().domains.inventory.loot ?? {})[0];
        const items = Object.values(offer.items);
        assert.deepEqual(items.filter(item => item.coin === undefined).map(item => [item.name, item.qty]), [['Healing Draught', STORY_ITEM_QTY], ['Rope', 1]]);
        // Level 1, no quest module: one reply may give 1000 gold, so 1000 + 500 is held to 1000.
        assert.deepEqual(items.filter(item => item.coin !== undefined), [{ name: '1000 gold', qty: 1, coin: 1000 }]);
        const told = (turn?.problems ?? []).map(problem => `${problem.code}: ${problem.message}`);
        assert.ok(told.some(message => /^LIMITED: .*Healing Draught ×99999 was written, but one reply may give at most 20 of one item/.test(message)), JSON.stringify(told));
        assert.ok(told.some(message => /^(?:LIMITED|REFUSED): .*gold/.test(message)), `the money past the budget is told: ${JSON.stringify(told)}`);
        const taken = await host.sdk.command('inventory.lootTake', { sid, pick: [0, 1, 2] });
        assert.equal(taken.ok, true, taken.message);
        assert.equal(host.head().domains.inventory.wallets.party.coin, 1000, 'the money goes to the wallet');
        assert.deepEqual(host.sdk.query('inventory.items').map(item => [item.name, item.qty]).sort(), [['Healing Draught', 20], ['Rope', 1]]);
        assert.match(taken.receipt.summary, /The party takes .*1000 gold/);
    } finally { host.close(); }
});
