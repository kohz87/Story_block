// C2-7 (a2 pass 2, minimized from fuzz seed 5186 reply 18): a reply in which the model itself writes
// Story Suite's hidden marker ("<!-- STORY_SUITE_V2") is read one way live and another way by Re-read of
// the same, unchanged message. Live, the marker's comment is masked (bareBlocks blanks hidden pairs)
// but extractBlock reads it; hideBlock then writes the blanked body back (same root as C2-6) or leaves
// a line outside the comment, so the saved message no longer holds the lines that were applied.
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
const state = host => JSON.stringify([host.sdk.query('inventory.wallet', { owner: 'party' }).coin ?? 0, host.sdk.query('inventory.items').map(i => `${i.name}×${i.qty}`).sort()]);

for (const [name, text] of [
    ['a marker comment opened before the block', '<!-- STORY_SUITE_V2\n<Changes>\n+ coin 7 -->\n<Changes>\n- item Rope\n</Changes>\n+ item Rope'],
    ['a marker inside a line of the block', 'Story.\n<Changes>\n+ item Rope | note: <!-- STORY_SUITE_V2\n+ coin 3\n</Changes>\nmore -->'],
]) {
    test(`Re-read of an unchanged reply gives the live state: ${name}`, async t => {
        const host = await fresh(t);
        await host.send('I search.', text);
        const live = state(host);
        const mes = host.ctx.chat.at(-1).mes;
        const result = await host.sdk.reread(host.ctx.chat.length - 1);
        assert.equal(result.ok, true);
        assert.equal(state(host), live, `saved message: ${JSON.stringify(mes)}`);
    });
}
