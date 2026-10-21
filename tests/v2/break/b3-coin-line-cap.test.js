// B-b3-4: one `+ coin` line mints any amount (invariant 3: model text never mints beyond the
// rules; there is no clamp or per-reply cap on coin lines).
import test from 'node:test';
import assert from 'node:assert/strict';
import { coreHost, coin, reply } from './helpers/econ.js';

test('a single reply cannot write a million coins into the wallet', async () => {
    const host = await coreHost();
    try {
        const before = coin(host);
        await host.send('We open the chest.', reply('Gold spills out.', ['+ coin 1,000,000 | from: the chest', '+ coin 999999 | from: the lid']));
        const gained = coin(host) - before;
        assert.ok(gained < 10000, `one reply's change lines gave ${gained} coin`);
    } finally { host.close(); }
});
