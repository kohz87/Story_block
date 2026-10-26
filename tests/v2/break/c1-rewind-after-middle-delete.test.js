// A suite rewind regression: a system cue prunes an old keyed row, its original reply is
// deleted, and rewinding a later cue must still use the replay rules for the kept removal.
// The fixture preserves that history now that RPG Battle no longer prepares check dice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../../src/v2/store.js';

// Needs the four checkouts side by side (helpers/suite.js); skipped otherwise. The same rule on Story
// Block alone: fix-sb-batch-truncate.test.js.
let suite = null;
try { suite = await import('./helpers/suite.js'); } catch (error) { suite = { error }; }
const skip = suite?.error ? `the four Story Suite checkouts are not side by side: ${suite.error.message}` : false;
const started = (...args) => suite.started(...args);

const PRUNER = {
    id: 'pruning-fixture', name: 'Keyed cue fixture', version: '1.0.0',
    domains: { prunes: { initial: () => ({ keys: {} }) } },
    commands: { 'fixture.cue'(ctx) {
        const keys = ctx.draft('prunes').keys;
        keys[`r${ctx.rev}`] = { rev: ctx.rev };
        for (const key of Object.keys(keys).slice(0, Math.max(0, Object.keys(keys).length - 8))) delete keys[key];
        return { summary: '', narrate: false };
    } },
    hooks: { beforeGenerate: () => ({ commands: [{ type: 'fixture.cue', payload: {} }] }) },
};

test('C1-3: a rewind after a middle delete is not refused when the chat replays fine', { skip }, async t => {
    t.mock.method(console, 'warn', () => {});
    const realUUID = globalThis.crypto.randomUUID.bind(globalThis.crypto);
    const h = await started({ pack: false, modules: [PRUNER] });
    t.after(() => h.close());
    // suite.js's seeded crypto gives every record the same sid (sw_000000000000): give them real ones.
    let n = 0;
    globalThis.crypto.randomUUID = () => `${(++n).toString(16).padStart(8, '0')}-0000-4000-8000-${realUUID().slice(-12)}`;
    for (let k = 0; k < 10; k++) await h.send(`u${k}`, h.reply(`r${k}`, [`+ coin ${k + 1} | from: Kael`]));
    await h.regenerate(h.reply('r9 again', ['+ coin 2 | from: Kael']));   // a second dice cue lands on the reply before
    await h.st.deleteMessage(h.ctx.chat.length - 1);                       // the reader deletes that last reply
    const lastReply = () => h.ctx.chat.findLastIndex(m => !m.is_user);
    const rec = h.ctx.chat[lastReply()].extra.storySuite;
    const prepares = rec.receipts.filter(r => r.type === 'fixture.cue');
    assert.ok(prepares.length >= 2, `setup: two pruning cues on the head reply (${rec.receipts.map(r => r.type)})`);
    const removed = rec.ops.find(op => op.op === 'remove' && /^\/domains\/prunes\/keys\//.test(op.path))?.path;
    assert.ok(removed, 'setup: a cue on the head reply prunes an older keyed entry');
    // Delete the reply (and its user message) that added that entry: a middle delete.
    const adder = h.ctx.chat.findIndex((m, at) => at > 0 && at < h.ctx.chat.length - 1 && !m.is_user
        && at < lastReply() && (m.extra?.storySuite?.ops ?? []).some(op => op.op === 'add' && op.path === removed));
    assert.ok(adder > 1, `setup: the reply that added ${removed}`);
    await h.st.deleteMessage(adder);
    await h.st.deleteMessage(adder - 1);
    const head = lastReply();
    const cold = createStore({ chat: () => structuredClone(h.ctx.chat), save: async () => {}, scratch: name => h.registry.scratch(name) });
    assert.deepEqual(cold.problems(), [], 'the chat replays with no problem after the delete');
    const last = h.ctx.chat[head].extra.storySuite.receipts.filter(r => r.type === 'fixture.cue').at(-1);
    const out = await h.sdk.rewind({ index: head, beforeRev: last.rev });
    assert.equal(out.ok, true, `rewind before the last cue: ${JSON.stringify(out)}`);
});
