// B-b3-1: "events.fire" from a click runs any `then` steps as Story Block's own sub-commands, so a
// button (or a pack screen's data-command) mints coin and items: inventory.grant's "no items from
// a button" rule is passed, because the step's ctx.caller is story-block.
import test from 'node:test';
import assert from 'node:assert/strict';
import { coreHost, coin, qtyOf } from './helpers/econ.js';

test('a UI events.fire with a wallet.receive / inventory.grant `then` mints nothing', async () => {
    const host = await coreHost();
    try {
        const before = coin(host);
        const r = await host.sdk.command('events.fire', {
            id: 'b3.mint', cue: 'Coins rain.', once: false,
            then: [
                { command: 'wallet.receive', payload: { owner: 'party', amount: 100000 } },
                { command: 'inventory.grant', payload: { name: 'Excalibur', qty: 5 } },
            ],
        });
        assert.equal(r.ok, false, `events.fire from a click committed: ${r.receipt?.summary}`);
        assert.equal(coin(host), before);
        assert.equal(qtyOf(host, 'Excalibur'), 0);
        // The direct route is refused, so the event route must be too.
        assert.equal((await host.sdk.command('inventory.grant', { name: 'Excalibur', qty: 5 })).code, 'REFUSED');
    } finally { host.close(); }
});
