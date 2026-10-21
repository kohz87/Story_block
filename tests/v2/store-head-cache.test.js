// B-b1r2-4 (store side): the head is not replayed again when the chat only grew by messages that hold no
// record (the reader's next message, a reply not read yet), nor after a batch writes its records again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { action, apply, fullReplay, greeting, initial, reply, setup, user } from './helpers/store-chat.js';

function counted(n) {
    let calls = 0;
    const counting = (state, ops) => { calls++; return apply(state, ops); };
    const { ctx, store } = setup([greeting()], { apply: counting });
    store.ensureInitial(initial());
    for (let i = 1; i <= n; i++) {
        ctx.chat.push(user(`turn ${i}`), reply(`reply ${i}`));
        action(store, `it_${i}`, i);
    }
    return { ctx, store, calls: () => calls, reset: () => { calls = 0; } };
}

test('new messages without a record keep the cached head: no replay', () => {
    const { ctx, store, calls, reset } = counted(15);
    const head = store.head();
    reset();
    ctx.chat.push(user('turn 16'));
    assert.equal(store.head(), head, 'the reader\'s message changes nothing');
    ctx.chat.push(reply('reply 16'));
    assert.equal(store.head(), head, 'nor a reply not read yet');
    assert.equal(store.headIndex(), ctx.chat.length - 1);
    assert.equal(calls(), 0, 'nothing was replayed');
    action(store, 'it_16', 16);
    assert.deepEqual(store.head(), fullReplay(ctx.chat, ctx.chat.length - 1));
});

test('a new message that holds a record, or a change before it, is replayed as before', () => {
    const { ctx, store, calls, reset } = counted(5);
    const copy = structuredClone(ctx.chat.at(-1));
    ctx.chat.push(user('turn 6'), copy);   // a reply that already carries a record (a pasted or loaded one)
    reset();
    store.head();
    assert.ok(calls() > 0, 'a carried record is replayed');
    assert.deepEqual(store.head(), fullReplay(ctx.chat, ctx.chat.length - 1));
    ctx.chat.splice(1, 2);   // an earlier exchange deleted: the head carrier moves
    reset();
    store.head();
    assert.ok(calls() > 0);
    assert.deepEqual(store.head(), fullReplay(ctx.chat, ctx.chat.length - 1));
});

test('the end of a batch writes the records again without throwing the cached head away', async () => {
    const { ctx, store, calls, reset } = counted(5);
    ctx.chat.push(user('turn 6'), reply('reply 6'));
    await store.batch(() => {
        action(store, 'it_6a', 1);
        action(store, 'it_6b', 2);
    });
    reset();
    const head = store.head();
    store.setNarrated(ctx.chat.length - 1, []);
    assert.equal(store.head(), head);
    assert.equal(calls(), 0, 'no replay after the batch');
    assert.deepEqual(store.head(), fullReplay(ctx.chat, ctx.chat.length - 1));
});
