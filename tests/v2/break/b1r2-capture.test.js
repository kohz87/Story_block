// b1-capture round 2 (Story Block): findings against 2f17c2c.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

const reply = (text, lines) => `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;

async function fresh(t) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    return host;
}
const qtyOf = (host, name) => host.sdk.query('inventory.items').filter(item => item.name === name).reduce((sum, item) => sum + item.qty, 0);

// B-b1r2-1: `~ item X | qty: N` sets a stack's count with no story budget (STORY_ITEM_QTY is applied
// to `+ item` only), so one line turns 1 of anything into 999999 (RB then sells them: 62,999,937 gold
// for Superior Healing Potions in one click).
test('~ item | qty cannot raise a stack past the per-reply story item budget', async t => {
    const host = await fresh(t);
    await host.send('I find a potion.', reply('A potion.', ['+ item Healing Draught', '~ item Healing Draught | qty: 999999']));
    assert.ok(qtyOf(host, 'Healing Draught') <= 20, `the party holds ${qtyOf(host, 'Healing Draught')} Healing Draughts`);
});

// B-b1r2-2: an unclosed block's last line is always dropped as CUT_OFF when the reply ends without a
// line break, and SillyTavern trims every reply (power_user.trim_spaces, default on: cleanUpMessage
// ends with getMessage.trim()), so a block the model forgot to close always loses its last line.
// Beta-candidate break (B-a1-14) changed the rule on purpose: a reply cut by the length limit ends the same
// way ("+ item To" of "+ item Torch"), so that last line is never applied; it is told (CUT_OFF), and a
// Continue that ends the line (or closes the block) reads it whole.
test('an unclosed block whose last line has nothing after it: told, not applied; a Continue that ends it reads it', async t => {
    const host = await fresh(t);
    await host.send('I search.', 'You find things.\n\n<Changes>\n+ item Rope\n+ item Torch');
    assert.deepEqual(host.sdk.query('inventory.items').map(item => item.name).sort(), ['Rope']);
    assert.ok(host.turn.problems().some(item => item.code === 'CUT_OFF' && item.line === '+ item Torch'));
    await host.cont('\n</Changes>');
    assert.deepEqual(host.sdk.query('inventory.items').map(item => item.name).sort(), ['Rope', 'Torch']);
});

// B-b1r2-3: Re-read runs the lines with fresh seeds, so every record a line made gets a new id
// (stacks, threads, offers, checks); any action that names one of them afterwards (here the
// reader's own drop on the same reply) makes the Re-read of an unchanged reply a CONFLICT.
test('Re-read of an unchanged reply after the reader acted on what it gave succeeds', async t => {
    const host = await fresh(t);
    await host.send('I search.', reply('Rope.', ['+ item Rope | qty: 3']));
    const index = host.store.headIndex();
    const stack = host.sdk.query('inventory.items')[0].stack;
    assert.equal((await host.sdk.command('inventory.drop', { stack, qty: 1 })).ok, true);
    const out = await host.sdk.reread(index);
    assert.equal(out.ok, true, `${out.code}: ${out.message}`);
    assert.equal(qtyOf(host, 'Rope'), 2);
});

// B-b1r2-4: each line costs time in proportion to the whole domain it drafts (clone, diff, apply of
// the slice; ctx.query clones the whole state), and nothing bounds how far the story grows a domain:
// 150 new items per reply are allowed every reply. After 750 story items a 150-line reply takes
// 6–30 s (maxChangeLines bounds the lines, not their cost).
test('a 150-line reply after five such replies is captured within 3 s', async t => {
    const host = await fresh(t);
    let k = 0;
    for (let r = 0; r < 5; r += 1) await host.send('More.', reply('Things.', Array.from({ length: 150 }, () => `+ item Thing ${k += 1}`)));
    const started = performance.now();
    await host.send('More.', reply('Things.', Array.from({ length: 150 }, () => `+ item Thing ${k += 1}`)));
    const ms = performance.now() - started;
    assert.ok(ms < 3000, `the sixth reply took ${Math.round(ms)} ms`);
});

// B-b1r2-10: the story money tally is keyed by ctx.carrier.key ("index:swipe"), which moves when
// earlier messages are deleted; a later reply that lands on the same index finds the old reply's
// tally and its own `+ coin` is refused ("This reply has already given all the money…").
// ctx.carrier.sid (the record id that stays with the reply) exists for this.
test('a new reply on an index an older reply held before a delete gets its own story money', async t => {
    const host = await fresh(t);
    const coin = () => host.sdk.query('inventory.wallet', { owner: 'party' }).coin ?? 0;
    await host.send('One.', reply('A.', ['+ coin 10']));
    await host.send('Two.', reply('B.', ['+ coin 1000']));
    const b = host.store.headIndex();
    // The reader deletes the first exchange: B moves up two places.
    await host.st.deleteMessage(b - 2);
    await host.st.deleteMessage(b - 3);
    await host.send('Three.', reply('C.', ['+ coin 500']));
    assert.equal(host.store.headIndex(), b, 'C sits where B was');
    assert.equal(coin(), 1500, JSON.stringify(host.turn.problems().slice(-2).map(problem => problem.message)));
});

// B-b1r2-11: the story budget tally (inventory.perReply) is part of the state and each reply's
// first coin or item line rewrites it with `replace /domains/inventory/perReply/at` (diff against the
// last reply's tally). Deleting the reply that first made the tally makes every later reply's coin
// and item lines fail on replay ("…/perReply/at does not exist"), so all their gains vanish up to the
// next checkpoint: deleting one early `+ coin 10` reply wipes Rope, Torch ×2, Lamp and 25 gold.
test('deleting the first reply that gained something keeps every later reply\'s gains', async t => {
    const host = await fresh(t);
    const coin = () => host.sdk.query('inventory.wallet', { owner: 'party' }).coin ?? 0;
    await host.send('a', reply('A.', ['+ coin 10']));
    const a = host.store.headIndex();
    await host.send('b', reply('B.', ['+ item Rope', '+ coin 20']));
    await host.send('c', reply('C.', ['+ item Torch | qty: 2']));
    await host.send('d', 'D, nothing.');
    await host.send('e', reply('E.', ['+ coin 5', '+ item Lamp']));
    await host.st.deleteMessage(a);
    await host.st.deleteMessage(a - 1);
    assert.equal(coin(), 25, JSON.stringify(host.store.problems().map(problem => problem.message)));
    assert.equal(qtyOf(host, 'Rope') + qtyOf(host, 'Torch') + qtyOf(host, 'Lamp'), 4);
});
