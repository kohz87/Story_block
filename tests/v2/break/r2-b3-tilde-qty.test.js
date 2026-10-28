// r2 B-b3-r2-1: `~ item Name | qty: N` sets a stack's count with no story limit: the per-reply cap
// (STORY_ITEM_QTY, 20 of one item) holds `+ item` only. One `+ item` and one `~ item … | qty: 9999`
// make 9999 of anything (Ersveil: 9999 Minor Healing Draughts sold for 11,048,895 marks).
import test from 'node:test';
import assert from 'node:assert/strict';
import { STORY_ITEM_QTY } from '../../../src/v2/domains/inventory.js';
import { coreHost, qtyOf, reply } from './helpers/econ.js';

test('"~ item … | qty:" cannot raise a count past what one reply may give', async () => {
    const host = await coreHost();
    host.settings.set('story-block', 'storyCoinPerReply', 1000);
    try {
        await host.send('A torch.', reply('One torch.', ['+ item Torch']));
        await host.send('More.', reply('The crate was full.', ['~ item Torch | qty: 9999']));
        assert.ok(qtyOf(host, 'Torch') <= 1 + STORY_ITEM_QTY, `${qtyOf(host, 'Torch')} torches after one "~ item Torch | qty: 9999"`);
    } finally { host.close(); }
});
