// B-b3-5: parseAmount drops a minus sign, so "+ coin -50 | to: the ferryman" (a payment written
// with a sign) is read as the party RECEIVING 50.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount } from '../../../src/v2/domains/money.js';
import { coreHost, coin, reply } from './helpers/econ.js';

test('parseAmount refuses a negative amount instead of reading its digits', () => {
    assert.ok(parseAmount('-50').error, 'got ' + JSON.stringify(parseAmount('-50')));
    assert.ok(parseAmount('−50 marks').error, 'unicode minus');
});

test('"+ coin -50" never adds to the wallet', async () => {
    const host = await coreHost();
    try {
        const before = coin(host);
        await host.send('We pay the toll.', reply('The keeper takes his due.', ['+ coin -40 | to: the toll keeper']));
        assert.ok(coin(host) <= before, `wallet went ${before} → ${coin(host)}`);
    } finally { host.close(); }
});
