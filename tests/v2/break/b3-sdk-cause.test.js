// B-b3-20: sdk.command(type, payload, { cause }) passes the caller's cause straight to the bus, so
// any page code holding the public sdk (another extension, a widget's api) runs a command as
// 'story' or 'system' and gets past the "not from a button" rules (inventory.grant).
import test from 'node:test';
import assert from 'node:assert/strict';
import { coreHost, qtyOf } from './helpers/econ.js';

test('the public sdk cannot raise a command\'s cause above ui', async () => {
    const host = await coreHost();
    try {
        const r = await host.sdk.command('inventory.grant', { name: 'Excalibur', qty: 3 }, { cause: 'story' });
        assert.equal(r.ok, false, r.receipt?.summary);
        assert.equal(qtyOf(host, 'Excalibur'), 0);
    } finally { host.close(); }
});
