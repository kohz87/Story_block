// C2-2 (a2 pass 1): a <Changes> block split across a Continue. The reply is cut off inside its block
// (max tokens, or Stop), the reader presses Continue, and the continuation finishes the block. Only
// blocks that START inside the continuation are read (capture.js laterBlocks: block.start >= from),
// so the continuation's own lines are never read and its tail ("…\n</Changes>", or the whole block
// when the open tag itself was cut) is left in the message for the reader to see. No Problem says so.
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
const names = host => host.sdk.query('inventory.items').map(item => item.name).sort();
const coin = host => host.sdk.query('inventory.wallet', { owner: 'party' }).coin ?? 0;

test('Continue that finishes a cut-off block reads the lines it adds and leaves no bare markup', async t => {
    const host = await fresh(t);
    await host.send('I search.', 'You find things.\n\n<Changes>\n+ coin 5\n');
    await host.cont('+ item Rope | qty: 2\n</Changes>');
    const mes = host.ctx.chat.at(-1).mes;
    assert.equal(coin(host), 5);
    assert.deepEqual(names(host), ['Rope'], `items after the Continue: ${JSON.stringify(names(host))}; message: ${JSON.stringify(mes)}`);
    assert.ok(!/<\/Changes>\s*$/.test(mes.replace(/<!--[\s\S]*?-->/g, '')), `the reader sees raw change-block text: ${JSON.stringify(mes)}`);
});

test('Continue after a reply cut inside the open tag ("<Chan" + "ges>…") reads the block and hides it', async t => {
    const host = await fresh(t);
    await host.send('I search.', 'You find things.\n\n<Chan');
    await host.cont('ges>\n+ coin 5\n+ item Rope\n</Changes>');
    const mes = host.ctx.chat.at(-1).mes;
    const problems = host.turn.problems().map(p => p.message);
    assert.ok(coin(host) === 5 || problems.length > 0, `5 coin written, ${coin(host)} paid, no Problem; message: ${JSON.stringify(mes)}`);
    assert.ok(!/<Changes>/.test(mes.replace(/<!--[\s\S]*?-->/g, '')), `the block is left bare in the message: ${JSON.stringify(mes)}`);
});

test('Continue after a stopped reply cut mid-line ("+ item Ro" + "pe | qty: 2") does not lose the line silently', async t => {
    const host = await fresh(t);
    await host.send('I search.', 'You find things.\n\n<Changes>\n+ coin 5\n+ item Ro', { stopped: true });
    await host.cont('pe | qty: 2\n</Changes>');
    const mes = host.ctx.chat.at(-1).mes;
    assert.ok(!/qty: 2\s*<\/Changes>/.test(mes.replace(/<!--[\s\S]*?-->/g, '')), `the continuation's half line is left as visible text: ${JSON.stringify(mes)}`);
});
