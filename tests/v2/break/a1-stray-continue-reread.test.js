// B-a1-10 (a1, story-suite break pass 2): a Continue writes a change line in its story text more than 3
// paragraphs above its own block. Live, the Continue reads its own text (capture.js strayLines with
// `from`/`tail`: the anchor is the Continue's own block), so the line is too far up: told as STRAY, not
// taken. A Re-read of the whole reply anchors on the FIRST block of the reply (the original reply's hidden
// comment, before the Continue's text), and every paragraph after it counts as "after the block", so the
// same line is taken: the wallet moves on a Re-read of an unedited reply. SPEC: live, Re-read, swipes,
// Continue and the rebuild read the same.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

const coin = host => host.sdk.query('inventory.wallet', { owner: 'party' }).coin ?? 0;

test('Re-read after a Continue reads the Continue\'s far story line as the live Continue did (not taken)', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    await host.send('Go.', 'The hall.\n\n<Changes>\n~ place Bluewatch Village\n</Changes>');
    await host.cont('\n\n+ coin 7\n\nOne.\n\nTwo.\n\nThree.\n\nFour.\n\n<Changes>\n+ coin 1\n</Changes>');
    assert.equal(coin(host), 1, 'setup: live, only the block\'s coin');
    assert.ok(host.turn.problems().some(item => item.code === 'STRAY' && item.line === '+ coin 7'), 'setup: the far line is told');
    const live = structuredClone(host.head());
    assert.equal((await host.turn.reread(host.ctx.chat.length - 1)).ok, true);
    assert.equal(coin(host), 1, 'Re-read takes the line the live Continue refused as too far up');
    assert.deepEqual(host.head().domains.inventory, live.domains.inventory);
});
