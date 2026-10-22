// C2-6 (a2 pass 1): hideBlock (capture.js:290-299) builds the hidden comment from blocks found in the
// MASKED text (bareBlocks: reasoning blanked to spaces), so a block whose span covers a reasoning pair
// is written back with the reasoning replaced by spaces: the reasoning is erased from the saved
// message for good. And an open tag mentioned mid-line ("a <Changes> word") opens a block, so the
// story text after it is moved into the hidden comment, out of the reader's sight.
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

test('reasoning inside a change block is not erased from the saved message', async t => {
    const host = await fresh(t);
    await host.send('I search.', 'Story.\n<Changes>\n+ coin 5\n<think>secret plan</think>\n+ item Rope\n</Changes>');
    const mes = host.ctx.chat.at(-1).mes;
    assert.ok(mes.includes('secret plan'), `the reasoning text is gone from the message: ${JSON.stringify(mes)}`);
});

test('story text after a mid-line mention of <Changes> stays visible, and no reasoning is blanked', async t => {
    const host = await fresh(t);
    await host.send('I search.', 'Story with a <Changes> word in it.\n\n<think>\nI should pay 20.\n</think>\n\n<Changes>\n+ coin 5\n</Changes>');
    const mes = host.ctx.chat.at(-1).mes;
    const visible = mes.replace(/<!--[\s\S]*?-->/g, '');
    assert.ok(visible.includes('word in it.'), `the story's own words were hidden: ${JSON.stringify(mes)}`);
    assert.ok(mes.includes('I should pay 20.'), `the reasoning was erased: ${JSON.stringify(mes)}`);
});
