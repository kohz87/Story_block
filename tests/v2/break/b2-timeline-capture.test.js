// Break round F103, b2-timeline: the state following the chat timeline (store.js, persist.js, turn.js,
// rewind.js). The items Story Block fix 1 took (5, 11; 4 with the counters); the others are SB-fix3's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

const items = h => {
    const inv = h.head()?.domains?.inventory;
    return inv ? Object.values(inv.stacks).map(stack => inv.defs[stack.def]?.name).sort() : null;
};
const coin = h => h.head()?.domains?.inventory?.wallets?.party?.coin ?? 0;
const reply = (text, lines) => `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>`;
async function host(t, options) {
    t.mock.method(console, 'warn', () => {});
    const h = await createHost(options);
    t.after(() => h.close());
    return h;
}

test('B-b2-timeline-5: Continue of a reply that already had a block captures the block the continuation adds', async t => {
    const h = await host(t);
    await h.send('a', reply('A rope.', ['+ item Rope']));
    await h.cont(`\nAnd a lamp.\n<Changes>\n+ item Lamp\n</Changes>`);
    assert.deepEqual(items(h), ['Lamp', 'Rope'], `the lamp from the continuation is kept (actual: ${items(h)})`);
    const visible = h.ctx.chat.at(-1).mes.replace(/<!--[\s\S]*?-->/g, '');
    assert.ok(!visible.includes('<Changes>'), 'and its block is hidden like any other (actual: left visible in the reply)');
});


test('B-b2-timeline-11: a reply stopped mid-line does not capture the cut-off last change line as written', async t => {
    // Stop (or a dropped stream) cuts "+ coin 25 | from: Fenna" to "+ coin 2"; SillyTavern still emits
    // MESSAGE_RECEIVED for the partial text and the open block runs to the end of it.
    const h = await host(t);
    await h.send('a', 'Fenna pays you.\n<Changes>\n+ item Rope\n+ coin 2');
    assert.deepEqual(items(h), ['Rope'], 'the complete line is kept');
    assert.equal(coin(h), 0, `the cut-off line is not taken as "+ coin 2" (actual: ${coin(h)} coin)`);
});
