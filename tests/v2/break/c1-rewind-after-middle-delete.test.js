// Beta fuzz cell, a1 pass 1 (C1-3): after a middle delete, rewinding the head reply is refused although
// the chat replays fine. store.js truncate() (used by sdk.rewind's dry run, rewind.js:73) applies the
// KEPT stored ops strictly with step(base, ops), without the replay rules ({ replayed: true }: a remove of
// a key a deleted reply added is passed over, rule c) and not block by block. RPG Battle's checks.prepare
// cue prunes the oldest prepared dice entry (MAX_PREPARED 8) with a `remove`; once the reply that added
// that entry is deleted, a rewind past the cue fails: "The changes could not be taken back, so no branch
// was made: The change path "/domains/checks/prepared/…" does not exist". Invariant 2 (rewind restores
// the state of that point). Uses Story Block's break harness (all four modules).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../../src/v2/store.js';

// Needs the four checkouts side by side (helpers/suite.js); skipped otherwise. The same rule on Story
// Block alone: fix-sb-batch-truncate.test.js.
let suite = null;
try { suite = await import('./helpers/suite.js'); } catch (error) { suite = { error }; }
const skip = suite?.error ? `the four Story Suite checkouts are not side by side: ${suite.error.message}` : false;
const started = (...args) => suite.started(...args);

test('C1-3: a rewind after a middle delete is not refused when the chat replays fine', { skip }, async t => {
    t.mock.method(console, 'warn', () => {});
    const realUUID = globalThis.crypto.randomUUID.bind(globalThis.crypto);
    const h = await started({ pack: false });
    t.after(() => h.close());
    // suite.js's seeded crypto gives every record the same sid (sw_000000000000): give them real ones.
    let n = 0;
    globalThis.crypto.randomUUID = () => `${(++n).toString(16).padStart(8, '0')}-0000-4000-8000-${realUUID().slice(-12)}`;
    for (let k = 0; k < 10; k++) await h.send(`u${k}`, h.reply(`r${k}`, [`+ coin ${k + 1} | from: Kael`]));
    await h.regenerate(h.reply('r9 again', ['+ coin 2 | from: Kael']));   // a second dice cue lands on the reply before
    await h.st.deleteMessage(h.ctx.chat.length - 1);                       // the reader deletes that last reply
    const lastReply = () => h.ctx.chat.findLastIndex(m => !m.is_user);
    const rec = h.ctx.chat[lastReply()].extra.storySuite;
    const prepares = rec.receipts.filter(r => r.type === 'checks.prepare');
    assert.ok(prepares.length >= 2, `setup: two dice cues on the head reply (${rec.receipts.map(r => r.type)})`);
    const removed = rec.ops.find(op => op.op === 'remove' && /^\/domains\/checks\/prepared\//.test(op.path))?.path;
    assert.ok(removed, 'setup: a cue on the head reply prunes an older dice entry');
    // Delete the reply (and its user message) that added that entry: a middle delete.
    const adder = h.ctx.chat.findIndex((m, at) => at > 0 && at < h.ctx.chat.length - 1 && !m.is_user
        && at < lastReply() && (m.extra?.storySuite?.ops ?? []).some(op => op.op === 'add' && op.path === removed));
    assert.ok(adder > 1, `setup: the reply that added ${removed}`);
    await h.st.deleteMessage(adder);
    await h.st.deleteMessage(adder - 1);
    const head = lastReply();
    const cold = createStore({ chat: () => structuredClone(h.ctx.chat), save: async () => {}, scratch: name => h.registry.scratch(name) });
    assert.deepEqual(cold.problems(), [], 'the chat replays with no problem after the delete');
    const last = h.ctx.chat[head].extra.storySuite.receipts.filter(r => r.type === 'checks.prepare').at(-1);
    const out = await h.sdk.rewind({ index: head, beforeRev: last.rev });
    assert.equal(out.ok, true, `rewind before the last cue: ${JSON.stringify(out)}`);
});
