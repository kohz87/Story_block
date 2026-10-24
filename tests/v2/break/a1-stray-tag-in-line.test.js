// B-a1-12 (a1, story-suite break pass 2): a change line written in the story with the block's tag in it
// reads differently live and on Re-read. "+ item Rope </Changes>" (no block): live, strayLines takes the
// whole line (an item "Rope </Changes>", def story/rope-changes) and hides it inside <Changes>…</Changes>,
// where the inner "</Changes>" now closes the block early, so a Re-read reads "+ item Rope" (another item).
// "+ item Rope <Changes>": live, the "<Changes>" opens an (empty, open) block mid-line, so the line is not
// taken; hideBlock leaves "+ item Rope" alone in the story, and a Re-read takes it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

const items = host => host.sdk.query('inventory.items').map(item => item.name).sort();

for (const line of ['+ item Rope </Changes>', '+ item Rope <Changes>']) {
    test(`"${line}" written in the story: Re-read reads it as the live capture did`, async t => {
        t.mock.method(console, 'warn', () => {});
        const host = await createHost();
        t.after(() => host.close());
        await host.send('Hello.', 'The road.');
        await host.send('Look.', `The hall.\n\n${line}`);
        const live = items(host);
        assert.equal((await host.turn.reread(host.ctx.chat.length - 1)).ok, true);
        assert.deepEqual(items(host), live);
    });
}
