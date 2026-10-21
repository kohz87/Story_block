// Break round F103, b2-timeline: the state following the chat timeline (store.js, persist.js, turn.js,
// rewind.js). B-4: a checkpoint made over a reply since deleted is passed over (store.js chain).
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

test('B-b2-timeline-4: deleting a middle reply takes its changes back the same way wherever the checkpoints fall', async t => {
    const outcome = [];
    for (const filler of [3, 25]) {
        const h = await host(t);
        await h.send('a', reply('A rope.', ['+ item Rope']));
        for (let i = 0; i < filler; i++) await h.send(`m${i}`, `Nothing ${i}.`);
        await h.st.deleteMessage(2);                 // the reply that gave the rope
        outcome.push(items(h).includes('Rope'));
    }
    assert.deepEqual(outcome, [false, false], `the rope is gone after deleting its reply, in a short and a long chat (actual: [short, long] = ${JSON.stringify(outcome)}; the long chat's checkpoint keeps it)`);
});


test('B-b2-timeline-4: checkpoints list the records they were made over; the long chat starts from the greeting again', async t => {
    const h = await host(t);
    await h.send('a', reply('A rope.', ['+ item Rope']));
    for (let i = 0; i < 25; i++) await h.send(`m${i}`, `Nothing ${i}.`);
    const records = h.ctx.chat.map(message => message.extra?.storySuite).filter(Boolean);
    const later = records.filter(record => record.checkpoint && Array.isArray(record.covers));
    assert.ok(later.length >= 1);
    assert.ok(later[0].covers.includes(records[1].sid), 'the rope reply is one the checkpoint covers');
    await h.st.deleteMessage(2);
    assert.deepEqual(items(h), []);
    assert.deepEqual(h.store.problems(), []);
});
