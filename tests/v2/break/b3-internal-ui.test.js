// B-b3-2: the other internal doors are still open to a click at HEAD (QA todos in
// tests/v2/qa/ownership.test.js and RB qa/conservation.test.js, wave-4 decision "wallet.receive/pay
// from a ui cause need a caller module"): wallet.receive, capture.coin, capture.item.
import test from 'node:test';
import assert from 'node:assert/strict';
import { coreHost, coin, qtyOf } from './helpers/econ.js';

test('wallet.receive from a click is refused (no caller module)', async () => {
    const host = await coreHost();
    try {
        const before = coin(host);
        const r = await host.sdk.command('wallet.receive', { owner: 'party', amount: 5000 });
        assert.equal(r.ok, false, r.receipt?.summary);
        assert.equal(coin(host), before);
    } finally { host.close(); }
});

test('capture.coin / capture.item from a click are refused (a change line the story never wrote)', async () => {
    const host = await coreHost();
    try {
        const before = coin(host);
        const c = await host.sdk.command('capture.coin', { op: '+', kind: 'coin', name: '900', text: '', labels: {} });
        const i = await host.sdk.command('capture.item', { op: '+', kind: 'item', name: 'Gold Ingot', text: '', labels: { qty: '50' } });
        assert.equal(c.ok, false, c.receipt?.summary);
        assert.equal(i.ok, false, i.receipt?.summary);
        assert.equal(coin(host), before);
        assert.equal(qtyOf(host, 'Gold Ingot'), 0);
    } finally { host.close(); }
});
