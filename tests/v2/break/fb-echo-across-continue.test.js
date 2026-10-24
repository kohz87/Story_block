// Final break FB-1: C-1 (#139) read a story line the reply's block repeats once, but only inside one read.
// When the story line came in the reply and the block that lists it in the Continue (the reply was cut off
// before or inside its block, the usual reason to press Continue), both were applied, live and on Re-read.
// The lines a read takes from the story are kept as the story's in the hidden comment (`<Changes story>`),
// so a Continue's block line that repeats one is its echo (<Changes-echo>), never read again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

const coin = host => host.sdk.query('inventory.wallet', { owner: 'party' }).coin ?? 0;
const qty = (host, name) => host.sdk.query('inventory.items').filter(item => item.name === name).reduce((sum, item) => sum + item.qty, 0);

async function fresh(t) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    return host;
}

// The bag and wallets (a Re-read writes new receipts, so a stack's `from` receipt is left out).
const goods = host => JSON.parse(JSON.stringify(host.head().domains.inventory, (key, value) => (key === 'from' ? undefined : value)));
// Re-read of the last reply equals live, and a second Re-read changes neither the text nor the state.
async function rereadTwice(host) {
    const last = host.ctx.chat.length - 1;
    const live = goods(host);
    assert.equal((await host.turn.reread(last)).ok, true);
    assert.deepEqual(goods(host), live, 'Re-read == live');
    const text = host.ctx.chat[last].mes;
    assert.equal((await host.turn.reread(last)).ok, true);
    assert.equal(host.ctx.chat[last].mes, text, 'a second Re-read leaves the text');
    assert.deepEqual(goods(host), live, 'a second Re-read leaves the state');
}

test('FB-1: a coin line in the story, then the same line in the Continue\'s block, pays once (live and Re-read)', async t => {
    const host = await fresh(t);
    await host.send('I wait.', 'Fenna counts it out.\n\n+ coin 12');
    await host.cont('\n\n<Changes>\n+ coin 12\n</Changes>');
    assert.equal(coin(host), 12);
    assert.doesNotMatch(host.ctx.chat.at(-1).mes.replace(/<!--[\s\S]*?-->/g, ''), /coin|Changes/, 'nothing is left bare');
    await rereadTwice(host);
    assert.equal(coin(host), 12);
});

test('FB-1: a story item line, the block cut off, the Continue lists the same line: given once', async t => {
    const host = await fresh(t);
    await host.send('I search.', 'You find it.\n\n+ item Rope\n\n<Changes>\n+ item Lamp\n');
    await host.cont('+ item Rope\n</Changes>');
    assert.equal(qty(host, 'Lamp'), 1);
    assert.equal(qty(host, 'Rope'), 1);
    await rereadTwice(host);
    assert.equal(qty(host, 'Rope'), 1);
});

test('FB-1: the block cut in the middle of the echo line; the Continue finishes it: given once', async t => {
    const host = await fresh(t);
    await host.send('I search.', 'You find it.\n\n+ item Rope\n\n<Changes>\n+ item Lamp\n+ item Ro');
    await host.cont('pe\n</Changes>');
    assert.deepEqual([qty(host, 'Lamp'), qty(host, 'Rope')], [1, 1]);
    await rereadTwice(host);
    assert.deepEqual([qty(host, 'Lamp'), qty(host, 'Rope')], [1, 1]);
});

test('FB-1: a cut line a Continue goes on with on a new line is applied as written (goesOn); the echo still once', async t => {
    const host = await fresh(t);
    await host.send('I search.', 'You find it.\n\n+ item Rope\n\n<Changes>\n+ item La');
    await host.cont('\n+ item Rope\n</Changes>');
    assert.deepEqual([qty(host, 'La'), qty(host, 'Rope')], [1, 1], 'the cut line as it was, and Rope once');
    await rereadTwice(host);
    assert.deepEqual([qty(host, 'La'), qty(host, 'Rope')], [1, 1]);
});

test('FB-1: each story line has one echo: written once in the story and twice in Continues\' blocks, it counts twice', async t => {
    const host = await fresh(t);
    await host.send('I wait.', 'Fenna counts it out.\n\n+ coin 12');
    await host.cont('\n\n<Changes>\n+ coin 12\n+ coin 12\n</Changes>');
    assert.equal(coin(host), 24, 'one echo, one more line');
    await rereadTwice(host);
    // Two separate blocks in one reply are two changes, as before.
    const other = await fresh(t);
    await other.send('I wait.', 'Fenna pays.\n\n<Changes>\n+ coin 5\n</Changes>');
    await other.cont('\n\n<Changes>\n+ coin 5\n</Changes>');
    assert.equal(coin(other), 10);
});

test('FB-1: a Continue\'s story line that repeats a line of the reply\'s block is its echo, read once', async t => {
    const host = await fresh(t);
    await host.send('I wait.', 'Fenna pays.\n\n<Changes>\n+ coin 5\n</Changes>');
    await host.cont('\n\nShe nods.\n\n+ coin 5');
    assert.equal(coin(host), 5);
    await rereadTwice(host);
});
