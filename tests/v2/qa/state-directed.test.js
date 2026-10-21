// QA: directed state scenarios on the real host (testkit createHost with the real store, bus and
// turn, Story Block's core module and the QA probe module): exact rollback on swipe and delete,
// re-narration that never repeats an action, one-time claims, preview/commit, one save per burst,
// failed saves. Problems found are the test.todo entries, named after what should happen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { readRecord } from '../../../src/v2/persist.js';
import { HAPPENED } from '../../../src/v2/prompt.js';
import { BONUS, BONUS_CLAIM, probeModule } from './helpers/probe-module.js';
import { checkInvariants } from './helpers/oracle.js';

const plain = value => JSON.parse(JSON.stringify(value));
const settle = () => new Promise(resolve => setImmediate(resolve));
const tailOf = request => request.chat.filter(message => message.role === 'system').slice(1).map(message => message.content).join('\n');

async function host(t) {
    t.mock.method(console, 'warn', () => {});
    const made = await createHost({ modules: [probeModule()] });
    t.after(() => made.close());
    return made;
}
const coins = h => h.head().domains.inventory.wallets.party?.coin ?? 0;
const itemQty = (h, name) => {
    const inv = h.head().domains.inventory;
    return Object.values(inv.stacks).filter(stack => inv.defs[stack.def]?.name === name).reduce((sum, stack) => sum + stack.qty, 0);
};

test('swipe and swipe back: the first swipe\'s changes (story and UI) leave and come back exactly', async t => {
    const h = await host(t);
    await h.send('I search.', 'A rope.\n<Changes>\n+ item Rope | qty: 2\n+ coin 7\n</Changes>');
    const before = plain(h.store.at(0));
    await h.sdk.command('probe.tick', {});
    const first = plain(h.head());
    assert.equal(itemQty(h, 'Rope'), 2);
    assert.equal(first.domains.probe.n, 1);
    await h.swipe('Nothing here.');
    assert.deepEqual(plain(h.head()), { ...before, meta: { ...before.meta } }, 'the new swipe starts from the greeting\'s state');
    await h.st.swipeTo(2, 0);
    assert.deepEqual(plain(h.head()), first, 'swiping back brings back exactly what the first swipe held');
    await h.st.swipeTo(2, 1);
    assert.deepEqual(plain(h.head()), before);
    checkInvariants(h, 'swipe and back');
});

test('delete the last reply: the state goes back exactly to the one before it, UI commands after it included', async t => {
    const h = await host(t);
    await h.send('One.', 'A lamp.\n<Changes>\n+ item Lamp\n</Changes>');
    await h.sdk.command('probe.tick', {});
    const kept = plain(h.head());
    await h.send('Two.', 'A rope.\n<Changes>\n+ item Rope | qty: 3\n- item Lamp\n</Changes>');
    await h.sdk.command('probe.tick', {});
    await h.sdk.command('wallet.receive', { owner: 'party', amount: 9 });
    await h.st.deleteMessage(4);
    assert.deepEqual(plain(h.head()), kept);
    await h.st.deleteMessage(3);
    assert.deepEqual(plain(h.head()), kept, 'deleting the user message changes nothing');
    checkInvariants(h, 'delete last');
});

test('re-narration: swiping the reply that tells an action tells it again, but never runs it again', async t => {
    const h = await host(t);
    await h.send('One.', 'Fine.');
    const tick = await h.sdk.command('probe.tick', {});
    const pay = await h.sdk.command('probe.pay', {});
    const told = await h.send('Two.', 'Told.');
    assert.ok(tailOf(told.request).startsWith(`${HAPPENED}\nTick 1.\nA bonus of ${BONUS} is paid.`));
    const again = await h.swipe('Told again.');
    assert.ok(tailOf(again.request).startsWith(`${HAPPENED}\nTick 1.\nA bonus of ${BONUS} is paid.`), 'the new swipe is told the same receipts');
    assert.equal(h.head().domains.probe.n, 1, 'the tick ran once');
    assert.equal(coins(h), BONUS, 'the bonus was paid once');
    assert.deepEqual(readRecord(h.ctx.chat[4]).narrated, [tick.receipt.id, pay.receipt.id]);
    const third = await h.send('Three.', 'Next.');
    assert.ok(!tailOf(third.request).includes('Tick 1.'), 'a told receipt is not told again by the next reply');
    checkInvariants(h, 're-narration');
});

test('claims: one bonus per line of history; taking the paying reply back frees the claim', async t => {
    const h = await host(t);
    await h.send('One.', 'Fine.');
    assert.equal((await h.sdk.command('probe.pay', {})).ok, true);
    const twice = await h.sdk.command('probe.pay', {});
    assert.equal(twice.ok, false);
    assert.equal(twice.code, 'CLAIMED');
    await h.send('Two.', 'Fine.');
    assert.equal((await h.sdk.command('probe.pay', {})).code, 'CLAIMED', 'a later reply is on the same line');
    assert.equal(coins(h), BONUS);
    await h.st.deleteMessage(4);
    await h.st.deleteMessage(3);
    await h.swipe('Another first reply.');
    assert.equal(h.head().meta.claims[BONUS_CLAIM], undefined, 'the swiped-away reply took its claim with it');
    assert.equal((await h.sdk.command('probe.pay', {})).ok, true, 'a new line of history can pay once');
    assert.equal(coins(h), BONUS);
    checkInvariants(h, 'claims');
});

test('a change line claim: the same probe word is accepted once per line, and again on a new swipe', async t => {
    const h = await host(t);
    await h.send('One.', 'Ember!\n<Changes>\n! probe ember\n! probe ember\n</Changes>');
    assert.deepEqual(h.head().domains.probe.seen, ['ember']);
    assert.deepEqual(h.turn.problems('qa-probe').map(problem => problem.code), ['CLAIMED']);
    await h.send('Two.', 'Ember again.\n<Changes>\n! probe ember\n</Changes>');
    assert.deepEqual(h.head().domains.probe.seen, ['ember']);
    await h.swipe('Ember once more.\n<Changes>\n! probe ember\n</Changes>');
    assert.deepEqual(h.head().domains.probe.seen, ['ember'], 'still seen by the first reply');
    checkInvariants(h, 'line claims');
});

test('preview then commit keeps exactly the previewed result; a second preview of the same claim goes STALE', async t => {
    const h = await host(t);
    await h.send('One.', 'Fine.');
    const a = await h.sdk.preview('probe.pay', {});
    const b = await h.sdk.preview('probe.pay', {});
    assert.equal(a.ok && b.ok, true, 'both previews can claim on a copy');
    assert.equal(h.head().meta.claims[BONUS_CLAIM], undefined, 'a preview stores nothing');
    const kept = await h.sdk.commit(a.token);
    assert.equal(kept.ok, true);
    assert.equal(kept.receipt.id, a.receipt.id, 'the receipt kept is the one previewed');
    assert.equal((await h.sdk.commit(b.token)).code, 'STALE');
    assert.equal(coins(h), BONUS);
    assert.equal((await h.sdk.commit(a.token)).ok, false, 'a token commits once');
    checkInvariants(h, 'preview');
});

test('a refused command stores nothing and schedules no save', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const h = await host(t);
    await h.send('One.', 'Fine.');
    const chat = JSON.stringify(h.ctx.chat);
    const saves = h.st.saves.length;
    for (const [type, payload] of [['probe.broken', {}], ['wallet.pay', { owner: 'party', amount: 1 }], ['inventory.drop', { stack: 'it_00000000' }],
        ['wallet.receive', { owner: 'party', amount: -5 }], ['wallet.receive', { owner: 'party', amount: 1.5 }], ['wallet.receive', { owner: 'nobody', amount: 1 }],
        ['no.such', {}], ['inventory.grant', { name: 'Free Sword' }]]) {
        const result = await h.sdk.command(type, payload);
        assert.equal(result.ok, false, `${type} ${JSON.stringify(payload)} is refused`);
        assert.equal(JSON.stringify(h.ctx.chat), chat, `${type}: nothing stored`);
    }
    t.mock.timers.tick(1000);
    await settle();
    assert.equal(h.st.saves.length, saves, 'nothing saved');
    assert.equal(h.store.dirty(), false);
});

test('one save per burst: many UI commands, then one save 400 ms after the last; many change lines, one save', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const h = await host(t);
    await h.send('One.', 'Fine.');
    const saves = h.st.saves.length;
    for (let i = 0; i < 10; i++) {
        await h.sdk.command('probe.tick', {});
        t.mock.timers.tick(300);
        await settle();
    }
    assert.equal(h.st.saves.length, saves, 'no save while the clicks keep coming');
    t.mock.timers.tick(400);
    await settle();
    assert.equal(h.st.saves.length, saves + 1, 'one save after the burst');
    const lines = Array.from({ length: 30 }, (_, i) => `+ item Thing ${i}`).join('\n');
    const before = h.st.saves.length;
    await h.send('Many.', `Lots.\n<Changes>\n${lines}\n</Changes>`);
    assert.equal(h.st.saves.length, before + 1, 'thirty change lines, one save at the end of the reply');
    assert.equal(readRecord(h.ctx.chat[4]).receipts.length, 30);
});

test('a failed save keeps the state unsaved, changes nothing in the chat, and the next save writes it all', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const h = await host(t);
    await h.send('One.', 'Fine.');
    const savedBefore = h.st.saved();
    await h.sdk.command('probe.tick', {});
    const chat = JSON.stringify(h.ctx.chat);
    const head = plain(h.head());
    h.st.failSaves = 1;
    t.mock.timers.tick(400);
    await settle();
    await settle();
    assert.equal(h.store.dirty(), true, 'still marked unsaved');
    assert.equal(JSON.stringify(h.ctx.chat), chat, 'the chat in memory is as it was');
    assert.deepEqual(plain(h.head()), head);
    assert.deepEqual(h.st.saved(), savedBefore, 'the last good save is untouched');
    await h.store.flush();
    assert.equal(h.store.dirty(), false);
    assert.deepEqual(h.st.saved(), JSON.parse(chat), 'the next save writes everything');
    checkInvariants(h, 'failed save');
});

test('a flush that fails while saving throws to its caller and keeps the state dirty', async t => {
    const h = await host(t);
    await h.send('One.', 'Fine.');
    await h.sdk.command('probe.tick', {});
    h.st.failSaves = 1;
    await assert.rejects(h.store.flush());
    assert.equal(h.store.dirty(), true);
    await h.store.flush();
    assert.equal(h.store.dirty(), false);
});

test('a chat switch and back: each chat keeps its own state, rebuilt from what it stores', async t => {
    const h = await host(t);
    await h.send('One.', 'A rope.\n<Changes>\n+ item Rope\n</Changes>');
    await h.sdk.command('probe.tick', {});
    const first = plain(h.head());
    const mine = structuredClone(h.ctx.chat);
    await h.st.loadChat([{ ...structuredClone(h.ctx.chat[0]), extra: {}, swipe_info: [{ extra: {} }] }], 'chat-2');
    assert.equal(itemQty(h, 'Rope'), 0, 'the other chat starts fresh');
    assert.equal(h.head().domains.probe.n, 0);
    await h.sdk.command('probe.tick', {});
    await h.st.loadChat(mine, 'chat-1');
    assert.deepEqual(plain(h.head()), first);
    checkInvariants(h, 'chat switch');
});

test('a v1 chat (v1 extras, no v2 record) opens as a fresh chat', async t => {
    t.mock.method(console, 'warn', () => {});
    const v1 = { name: 'Narrator', is_user: false, mes: 'Old.', swipe_id: 0, swipes: ['Old.'], swipe_info: [{ extra: { storyBlock: { inventory: ['Sword'] } } }], extra: { storyBlock: { inventory: ['Sword'] } } };
    const h = await createHost({ modules: [probeModule()], st: { chat: [v1, { name: 'You', is_user: true, mes: 'Hi', extra: {} }, { ...structuredClone(v1), mes: 'Reply <World State>gold: 999</World State>' }] } });
    t.after(() => h.close());
    assert.equal(h.store.headIndex(), 2);
    assert.deepEqual(plain(h.head().domains.inventory.stacks), {}, 'nothing of v1 is read');
    assert.equal(h.head().meta.rev, 0);
});

test('Continue: a block the continuation adds is captured once; the reply keeps what it was told', async t => {
    const h = await host(t);
    await h.send('One.', 'Fine.');
    const tick = await h.sdk.command('probe.tick', {});
    await h.send('Two.', 'The door opens');
    assert.deepEqual(readRecord(h.ctx.chat[4]).narrated, [tick.receipt.id]);
    await h.cont(' and a lamp is there.\n<Changes>\n+ item Lamp\n</Changes>');
    assert.equal(itemQty(h, 'Lamp'), 1);
    assert.deepEqual(readRecord(h.ctx.chat[4]).narrated, [tick.receipt.id], 'still told once, by this reply');
    await h.cont(' And more.');
    assert.equal(itemQty(h, 'Lamp'), 1, 'continuing again does not capture the block a second time');
    checkInvariants(h, 'continue');
});

// ---- problems found (each a failing check, kept as a todo so CI stays green) -----------------

test.todo('store.js append: a UI command committed onto a head carrier whose old ops no longer apply survives a rebuild', async t => {
    // Delete a middle reply so the head's stored ops no longer apply: replay skips the head carrier
    // whole. append() still adds new ops to that same record, so after the next rebuild (any swipe,
    // delete or chat reload) the new command is gone too, and its claim with it.
    const h = await host(t);
    await h.send('a', 'A rope.\n<Changes>\n+ item Rope\n</Changes>');
    await h.send('b', 'Rope used.\n<Changes>\n- item Rope\n</Changes>');
    await h.st.deleteMessage(2);
    assert.equal(h.store.problems().length, 1, 'the head carrier no longer applies');
    assert.equal((await h.sdk.command('probe.tick', {})).ok, true);
    assert.equal(h.head().domains.probe.n, 1);
    h.store.rebuild();
    assert.equal(h.head().domains.probe.n, 1, 'the tick committed after the delete is still there after a rebuild (actual: 0)');
});

test.todo('store.js append: a claim committed onto a skipped head carrier keeps paying once (no double bonus after a rebuild)', async t => {
    const h = await host(t);
    await h.send('a', 'A rope.\n<Changes>\n+ item Rope\n</Changes>');
    await h.send('b', 'Rope used.\n<Changes>\n- item Rope\n</Changes>');
    await h.st.deleteMessage(2);
    assert.equal((await h.sdk.command('probe.pay', {})).ok, true);
    h.store.rebuild();
    const again = await h.sdk.command('probe.pay', {});
    assert.equal(again.ok, false, 'the bonus is paid once on this line (actual: paid again)');
});

test.todo('turn.js interceptor: a save that fails before a reply still captures the reply\'s <Changes> and hides the block', async t => {
    // interceptor → store.flush() throws → catch sets session = null → the reply is sent without the
    // static part and the tail, onMessageReceived ignores it, its block stays visible in the chat.
    const h = await host(t);
    await h.send('One.', 'Fine.');
    await h.sdk.command('probe.tick', {});
    h.st.failSaves = 1;
    const result = await h.send('Two.', 'A lamp.\n<Changes>\n+ item Lamp\n</Changes>');
    assert.ok(result.request.chat[0].content.includes('[Story Suite'), 'the static part was sent');
    assert.equal(itemQty(h, 'Lamp'), 1, 'the reply\'s change line was captured');
    assert.ok(!h.ctx.chat[4].mes.includes('<Changes>\n+ item Lamp'), 'the block is hidden');
    assert.equal(h.store.dirty(), false, 'and saved at the end of the reply');
});
