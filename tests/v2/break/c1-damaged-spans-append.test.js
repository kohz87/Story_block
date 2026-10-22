// Beta fuzz cell, a1 pass 1 (C1-1): a change written onto a reply whose stored record has spans that
// no longer add up (a hand-edited chat file: one op that no longer applies, and the spans/ops out of
// step) is kept live but lost on the next cold rebuild. store.js append(): spansOf(record) is null for
// such a record (story receipts, spans do not add up), so the new spans are just [{ n: added }] while ops
// = old + added; blocksOf then sees spans that do not fit and replays ALL ops as one block, which fails
// on the old bad op and skips the new change too. Invariant 1 (replay == live).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { createStore } from '../../../src/v2/store.js';

const reply = (text, lines) => `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>`;

test('C1-1: a reader action on a reply with a damaged record survives a cold rebuild of the chat', async t => {
    t.mock.method(console, 'warn', () => {});
    const h = await createHost();
    t.after(() => h.close());
    await h.send('a', reply('A rope.', ['+ item Rope', '+ coin 5 | from: Kael']));
    // The chat file is hand-edited: one op of the reply no longer applies, the spans are out of step.
    const file = structuredClone(h.ctx.chat);
    const record = file[2].extra.storySuite;
    record.ops.push({ op: 'replace', path: '/domains/nope/x', value: 1 });
    for (const info of file[2].swipe_info ?? []) if (info?.extra?.storySuite) info.extra.storySuite = structuredClone(record);
    await h.st.loadChat(file, h.ctx.chatId);
    // The reader adds someone to the scene (lands on the latest reply).
    const done = await h.sdk.command('scene.present', { add: 'Ann' });
    assert.equal(done.ok, true, done.message);
    assert.deepEqual(h.head().domains.scene.present, ['Ann'], 'live: Ann is present');
    const cold = createStore({ chat: () => JSON.parse(JSON.stringify(h.ctx.chat)), save: async () => {}, scratch: name => h.registry.scratch(name) }).head();
    assert.deepEqual(cold?.domains?.scene?.present, ['Ann'],
        `a cold rebuild from the chat keeps the reader's action (actual: ${JSON.stringify(cold?.domains?.scene?.present)}; rev live ${h.head().meta.rev}, cold ${cold?.meta?.rev})`);
    assert.equal(cold.meta.rev, h.head().meta.rev, 'and the same rev');
});
