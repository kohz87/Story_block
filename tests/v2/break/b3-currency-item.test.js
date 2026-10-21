// B-b3-6: an item named exactly like the chat's currency is not turned into wallet coin (wave-4
// decision "an item named exactly the currency becomes wallet coin"): `+ item Gold | qty: 50`
// makes 50 "Gold" items next to the wallet, which the wallet, prices and quests do not see.
import test from 'node:test';
import assert from 'node:assert/strict';
import { coreHost, coin, qtyOf, reply } from './helpers/econ.js';

test('"+ item Gold | qty: 50" in a gold chat goes into the wallet, not into a stack', async () => {
    const host = await coreHost();
    try {
        const before = coin(host);
        await host.send('We count the purse.', reply('Fifty gold.', ['+ item Gold | qty: 50']));
        assert.equal(qtyOf(host, 'Gold'), 0, 'no stack named like the currency');
        assert.equal(coin(host), before + 50);
    } finally { host.close(); }
});
