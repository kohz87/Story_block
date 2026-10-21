// Re-break r2, b2-timeline: turn.js keeps ONE `dryNext` flag, set by every GENERATION_STARTED. SillyTavern
// (or an extension counting tokens) starts dry-run generations on its own; when one starts between the
// reader's GENERATION_STARTED and the interceptor call of the reader's generation, the reader's real
// reply is taken for a dry run: no session, the reply is not captured, its <Changes> block stays bare.
// Live (SillyTavern 1.19, all four modules): 3 of 12 replies sent about 1 s after the previous reply
// were lost this way ("started normal dry=false", 13-31 ms later "started normal dry=true", "received").
// SillyTavern never calls interceptors for a dry run (Generate: `if (!dryRun) runGenerationInterceptors`).
// Drop into Story_block/tests/v2/break/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

const items = h => {
    const inv = h.head()?.domains?.inventory;
    return inv ? Object.values(inv.stacks).map(stack => inv.defs[stack.def]?.name).sort() : [];
};

test('B-b2-timeline-r2-1: a dry run that starts while the reader\'s reply is starting does not cost that reply its capture', async t => {
    t.mock.method(console, 'warn', () => {});
    const h = await createHost();
    t.after(() => h.close());
    await h.send('One.', 'Fine.');
    // Another caller's token-count dry run starts right after the reader's generation starts.
    let once = false;
    h.st.eventSource.on('generation_started', async (type, options, dryRun) => {
        if (dryRun || once) return;
        once = true;
        await h.st.eventSource.emit('generation_started', 'normal', {}, true);
    });
    await h.send('Two.', 'A lamp.\n<Changes>\n+ item Lamp\n</Changes>');
    assert.deepEqual(items(h), ['Lamp'], 'the reply\'s change line is captured');
    assert.ok(!/<Changes>/.test(h.ctx.chat.at(-1).mes.replace(/<!--[\s\S]*?-->/g, '')), 'and its block is hidden');
});
