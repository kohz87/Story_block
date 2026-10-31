// rx-capture (beta rolling attack) on SB #104 (`? loot`, merged ff96802): a count past three digits
// was read as part of the thing's name, so `Healing Draught x99999` laid out, and the take granted, an item
// named "Healing Draught x99999"; and a coin amount written as a thing ("1000 gold") became an item named
// "1000 gold" while "Gold x500" vanished without a Problem. The rule (coordinator, RX-cap-6): a count of any
// length is a count; money in a loot line is a coin offer in that loot, paid into the wallet on Take, never an
// item. There is no per-reply cap on either.
import test from 'node:test';
import assert from 'node:assert/strict';
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
        assert.deepEqual(items.filter(item => item.coin === undefined).map(item => [item.name, item.qty]), [['Healing Draught', 99999], ['Rope', 1]]);
        // 1000 gold and Gold x500 are one coin offer in that loot.
        assert.deepEqual(items.filter(item => item.coin !== undefined), [{ name: '1500 gold', qty: 1, coin: 1500 }]);
        assert.deepEqual(turn?.problems ?? [], []);
        const taken = await host.sdk.command('inventory.lootTake', { sid, pick: [0, 1, 2] });
        assert.equal(taken.ok, true, taken.message);
        assert.equal(host.head().domains.inventory.wallets.party.coin, 1500, 'the money goes to the wallet');
        assert.deepEqual(host.sdk.query('inventory.items').map(item => [item.name, item.qty]).sort(), [['Healing Draught', 99999], ['Rope', 1]]);
        assert.match(taken.receipt.summary, /The party takes .*1500 gold/);
    } finally { host.close(); }
});
