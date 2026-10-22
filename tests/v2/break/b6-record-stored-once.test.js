// B-b6-soak-7: the chat file grows ~24 KB per reply in the soak (5.5 MB at 213 replies, see
// break/b6-soak/charts/size-growth.png), three times PERFORMANCE.md's bench; 86% of it is
// extra.storySuite, and half of that is the second copy writeRecord() keeps in
// swipe_info[swipe_id].extra (persist.js:60-71) on every carrier, old ones included. SillyTavern rewrites
// the whole file on every save (3+ per reply), so the copy doubles the per-reply save cost that already
// grows linearly with the chat. PERFORMANCE.md proposes keeping it only on the last reply.
// Drop into Story_block/tests/v2/break/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

test('an older reply stores its story record once in the saved chat', async () => {
    const host = await createHost({ st: { greeting: 'The quay.' } });
    for (let i = 0; i < 4; i += 1) await host.send(`Turn ${i}.`, `Gulls.\n\n<Changes>\n+ item Rope ${i} | qty: 1\n</Changes>`);
    const saved = host.st.saved();
    const older = saved.findIndex((m, i) => i > 0 && !m.is_user && m.extra?.storySuite);
    assert.ok(older > 0 && older < saved.length - 1, 'an older carrier with a record');
    const line = JSON.stringify(saved[older]);
    const copies = line.split('"sid":').length - 1;
    assert.equal(copies, 1, `message ${older} carries ${copies} copies of its record (${line.length} bytes)`);
    host.close();
});
