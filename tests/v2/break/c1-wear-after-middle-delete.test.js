// Beta fuzz cell, a1 pass 2 (C1-5): gear condition is not a counter, so deleting the reply that wore a piece
// does not give its wear back. inventory.js storyWear (and inventory.wear / repair) write the stack's
// `cond` as an absolute number (`replace …/cond value: 45`, no `was`); `cond` is not in the inventory's
// counters (domains/index.js: counters ['wallets/*/coin', 'stacks/*/qty']). Reply A tears the Cane-Blade
// (100 → 85), reply B ruins it (85 → 45); deleting reply A leaves 45: A's tear is still on it (expected 60,
// B's ruin alone, as coin and qty rebase since B3-8). Invariant 2 (a delete undoes that reply's changes).
// Uses Story Block's break harness (all four modules, Ersveil pack). Its seeded crypto gives every record
// the same sid (sw_000000000000), so real ones are given here (else B's wear is refused as "this reply").
import test from 'node:test';
import assert from 'node:assert/strict';
import { condOf } from '../../../src/v2/domains/inventory.js';

// Needs the four checkouts side by side (helpers/suite.js); skipped otherwise. The same rule on Story
// Block alone: rx-timeline-cond-delete.test.js.
let suite = null;
try { suite = await import('./helpers/suite.js'); } catch (error) { suite = { error }; }
const skip = suite?.error ? `the four Story Suite checkouts are not side by side: ${suite.error.message}` : false;
const started = (...args) => suite.started(...args);

test('C1-5: deleting the reply that wore a piece gives its wear back', { skip }, async t => {
    t.mock.method(console, 'warn', () => {});
    const realUUID = globalThis.crypto.randomUUID.bind(globalThis.crypto);
    const h = await started({ pack: true });
    t.after(() => h.close());
    let n = 0;
    globalThis.crypto.randomUUID = () => `${(++n).toString(16).padStart(8, '0')}-0000-4000-8000-${realUUID().slice(-12)}`;
    // Since SB #110 / RB's gear part the condition is not the stack's plain `cond` (the test first read
    // that): with RPG Battle it is RB's keyed gear events (items.condition), else SB's condLog fold.
    const cond = () => {
        const inv = h.head().domains.inventory;
        const s = Object.values(inv.stacks).find(s => /cane-blade/.test(s.def));
        if (!s) return 100;
        return h.q('items.condition', { stack: s.id })?.cur ?? condOf(s, inv);
    };
    await h.send('I parry.', h.reply('The blade bites steel.', ['~ item Cane-Blade | wear: tear']));
    assert.equal(cond(), 85, 'setup: tear takes 15');
    await h.send('Again.', h.reply('It cracks.', ['~ item Cane-Blade | wear: ruin']));
    assert.equal(cond(), 45, 'setup: ruin takes 40 more');
    const a = h.ctx.chat.length - 3;          // reply A (the tear), and its user message before it
    await h.st.deleteMessage(a);
    await h.st.deleteMessage(a - 1);
    assert.deepEqual(h.store.problems(), [], 'the chat replays with no problem');
    assert.equal(cond(), 60, `only the ruin is left on the blade (actual ${cond()}: the deleted reply's tear stayed)`);
});
