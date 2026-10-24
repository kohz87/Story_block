// Confirm soak (C-1): a change line the model writes in the story AND again in its <Changes> block is
// applied twice. fix-encounter (capture.js strayLines) reads a whole grammar line near the block as one of
// the reply's changes; when the same line is also in the block, both are taken. Models echo the line they
// are about to list ("! encounter 3 Wolf …" in the story, then the block), so one item, one payment or
// one fight offer becomes two.
// Drops into Story_block/tests/v2/break/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

const qty = (host, name) => host.sdk.query('inventory.items').filter(item => item.name === name).reduce((sum, item) => sum + item.qty, 0);
const coin = host => host.head().domains.inventory.wallets.party?.coin ?? 0;

test('C-1: an item line echoed in the story and in the block gives the item once', async () => {
    const host = await createHost();
    try {
        await host.send('I ask for it.', 'Fenna hands it over.\n+ item Moonveil Trout | qty: 1\n\n<Changes>\n+ item Moonveil Trout | qty: 1\n</Changes>');
        assert.equal(qty(host, 'Moonveil Trout'), 1, 'one trout was written (twice, the same line), two were given');
    } finally { host.close(); }
});

test('C-1: a coin line echoed in the story and in the block pays once', async () => {
    const host = await createHost();
    try {
        const before = coin(host);
        await host.send('I wait.', 'Fenna counts it out.\n+ coin 12 | from: Fenna\n\n<Changes>\n+ coin 12 | from: Fenna\n</Changes>');
        assert.equal(coin(host) - before, 12, 'twelve coins were written (twice, the same line), twenty-four were paid');
    } finally { host.close(); }
});
