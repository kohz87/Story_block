// B-b3-9: a pack event with `once: false` and a minting `then` pays again before every generation
// of the same reply: each Continue and each dry run commits another events.fire. Nothing bounds a
// repeating event to once per reply (pack data must not mint without a bound).
import test from 'node:test';
import assert from 'node:assert/strict';
import { coreHost, coin, eventPack } from './helpers/econ.js';

const TITHE = { id: 'tithe', when: "query('scene.place').name == 'Bluewatch Village'", cue: 'A tithe-box rattles.', once: false, then: [{ command: 'wallet.receive', payload: { owner: 'party', amount: 1000 } }] };

test('a repeating event pays at most once per reply: Continue and dry runs do not pay again', async () => {
    const host = await coreHost();
    try {
        assert.equal((await host.packs.packs.install(eventPack(TITHE))).ok, true);
        await host.send('We wait.', 'Reply one.');
        const once = coin(host);
        for (let n = 0; n < 5; n += 1) await host.cont(' And on.');
        await host.st.generate('normal', { reply: 'x', dryRun: true });
        assert.equal(coin(host), once, `the same reply was paid ${(coin(host) - once) / 1000} more times`);
    } finally { host.close(); }
});
