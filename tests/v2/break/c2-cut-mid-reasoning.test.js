// C2-3 (a2 pass 1): a reply cut off while the model is still reasoning in the text (<think> open, no
// close yet) has the draft <Changes> block inside that reasoning read and applied (capture.js
// reasoningPairs masks closed pairs only). When Continue then closes the reasoning and writes the real
// block, the draft stays applied: the reader gets the draft's coin and items as well as the real ones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

async function fresh(t) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    return host;
}
const names = host => host.sdk.query('inventory.items').map(item => item.name).sort();
const coin = host => host.sdk.query('inventory.wallet', { owner: 'party' }).coin ?? 0;
const CUT = '<think>\nThe party should find rope.\n<Changes>\n+ coin 20\n+ item Torch | qty: 3\n</Changes>\nHmm, maybe not';

test('a reply stopped mid-reasoning applies no draft lines from inside the reasoning', async t => {
    const host = await fresh(t);
    await host.send('I search.', CUT, { stopped: true });
    assert.equal(coin(host), 0, 'the draft "+ coin 20" inside the unclosed <think> was paid');
    assert.deepEqual(names(host), []);
});

test('Continue that closes the reasoning leaves only the real block applied', async t => {
    const host = await fresh(t);
    await host.send('I search.', CUT);
    await host.cont('.\n</think>\nYou find a rope.\n\n<Changes>\n+ item Rope\n</Changes>');
    assert.equal(coin(host), 0, 'the draft coin inside the (now closed) reasoning stayed paid');
    assert.deepEqual(names(host), ['Rope']);
});
