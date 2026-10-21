// Re-break r2, b2-timeline (testkit probe): Re-read racing a delete. The lines run on the state before the
// reply while the reader can act; the reply's index was taken when Re-read started. Deleted before it
// stored them, the old code stored the lines on whatever message stood at that index then (another
// reply's changes replaced, its item lost), or refused with the wrong reason ("Message 4 is the user's").
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

const reply = (text, lines) => `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const items = h => {
    const inv = h.head().domains.inventory;
    return Object.values(inv.stacks).map(stack => inv.defs[stack.def].name).sort();
};

async function three(t) {
    t.mock.method(console, 'warn', () => {});
    const h = await createHost();
    t.after(() => h.close());
    await h.send('a', reply('A rope.', ['+ item Rope']));
    await h.send('b', reply('A lamp.', ['+ item Lamp']));
    await h.send('c', reply('A key.', ['+ item Iron Key']));
    // The reader corrects reply 4 (the lamp) to a torch and presses Re-read.
    h.ctx.chat[4].mes = reply('A torch.', ['+ item Torch']);
    return h;
}

test('B-b2-timeline-r2: Re-read with the first exchange deleted meanwhile stores nothing on the reply now at its index', async t => {
    const h = await three(t);
    const pending = h.sdk.reread(4);
    h.ctx.chat.splice(1, 2);
    await h.st.eventSource.emit('message_deleted', h.ctx.chat.length);
    const result = await pending;
    assert.equal(result.ok, false);
    assert.equal(result.code, 'CONFLICT');
    assert.match(result.message, /The chat changed while the reply was read again/);
    assert.deepEqual(items(h), ['Iron Key', 'Lamp'], `the key's reply keeps its own change (actual: ${items(h)})`);
});

test('B-b2-timeline-r2: Re-read with a message before it deleted meanwhile gives that reason, not "the user\'s"', async t => {
    const h = await three(t);
    const pending = h.sdk.reread(4);
    await h.st.deleteMessage(1);
    const result = await pending;
    assert.equal(result.code, 'CONFLICT');
    assert.doesNotMatch(result.message, /user's/);
    assert.match(result.message, /deleted/);
    assert.deepEqual(items(h), ['Iron Key', 'Lamp', 'Rope']);
});

test('Re-read with nothing in between still works', async t => {
    const h = await three(t);
    const result = await h.sdk.reread(4);
    assert.equal(result.ok, true);
    assert.deepEqual(items(h), ['Iron Key', 'Rope', 'Torch']);
});
