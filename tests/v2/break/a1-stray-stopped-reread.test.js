// B-a1-3 (a1, story-suite break pass 2): a reply the reader stopped ends in a change line written in the
// story. Live, that last line is refused ("the reply stopped in the middle of it", STRAY) and left in the
// story. A Re-read of the same reply takes it (turn.js reread calls extractBlock/strayLines without
// `stopped`, and the line was never hidden), so Re-read reads differently from the live capture: SPEC says
// live, Re-read, swipes, Continue and the rebuild read the same. For a block the cut line is dropped from
// the hidden body, so Re-read cannot see it; a stray line has no such guard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

const coin = host => host.sdk.query('inventory.wallet', { owner: 'party' }).coin ?? 0;

test('Re-read of a stopped reply reads its last story change line as the live capture did (not taken)', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    await host.send('Open it.', 'A purse lies in the mud.\n\n+ coin 12', { stopped: true });
    assert.equal(coin(host), 0, 'live: the stopped last line is not taken');
    assert.ok(host.turn.problems().some(item => item.code === 'STRAY' && /stopped/.test(item.message)), 'live: told as STRAY');
    const live = structuredClone(host.head());
    const res = await host.turn.reread(host.ctx.chat.length - 1);
    assert.equal(res.ok, true);
    assert.equal(coin(host), 0, 'Re-read takes the line the live capture refused');
    assert.deepEqual(host.head().domains.inventory, live.domains.inventory);
});
