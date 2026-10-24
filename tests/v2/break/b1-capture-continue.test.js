// B-b1-capture-4: a Continue of a reply whose block was already captured never reads the block the
// continuation adds (turn.js: session.captured makes `block` null), although the comment there
// says "only a block the continuation adds is read". The new lines are lost without a Problem,
// and the bare block stays in the message for the reader to see.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { extractBlock } from '../../../src/v2/capture.js';

test('a Continue that adds a second <Changes> block has its lines captured and hidden', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    await host.send('I search.', 'You find rope.\n\n<Changes>\n+ item Rope\n</Changes>');
    await host.cont(' Then a torch.\n\n<Changes>\n+ item Torch\n</Changes>');
    const items = host.sdk.query('inventory.items').map(item => item.name).sort();
    assert.deepEqual(items, ['Rope', 'Torch']);
    const mes = host.ctx.chat.at(-1).mes;
    // Nothing of a change block is left bare in the message the reader sees.
    assert.equal(extractBlock(mes.replace(/<!--\s*STORY_SUITE_V2[\s\S]*?-->/g, '')), null, mes);
});
