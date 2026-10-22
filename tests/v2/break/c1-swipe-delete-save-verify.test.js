// Beta fuzz cell, a1 pass 1 (C1-2): deleting an EARLIER swipe of the reply whose later swipe Story Block
// wrote last makes the next save "fail" its verification (store.js verify.after): the last-write token
// still names swipe 1, the kept swipe is now index 0, so swipe_info[1] is gone and the check reads
// "change none instead of N". The chat WAS saved, but the store stays unsaved, store.flush() throws, and
// sdk.rewind() (which awaits store.flush() outside its try, rewind.js:77) throws instead of answering
// { ok:false } (RB's return-in-time shows the error to the reader). persist.restamp() rewrites the record
// for its new index without going through store.write(), so lastWrite is never moved with it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

const reply = (text, lines) => `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>`;

// SillyTavern's deleteSwipe: syncs the shown swipe, splices swipes + swipe_info, shows newSwipeId.
async function deleteSwipe(h, index, del, show) {
    const m = h.ctx.chat[index];
    m.swipe_info[m.swipe_id].extra = structuredClone(m.extra);
    m.swipes.splice(del, 1);
    m.swipe_info.splice(del, 1);
    m.swipe_id = show;
    m.mes = m.swipes[show];
    m.extra = structuredClone(m.swipe_info[show].extra);
    await h.st.eventSource.emit('message_swipe_deleted', { messageId: index, swipeId: del, newSwipeId: show });
}

async function setup(t) {
    t.mock.method(console, 'warn', () => {});
    const h = await createHost();
    t.after(() => h.close());
    await h.send('a', reply('One.', ['+ item Rope']));
    await h.send('b', reply('Two.', ['+ item Lamp']));
    await h.swipe(reply('Two, again.', ['+ item Torch']));     // swipe 1: written last
    await h.store.flush();
    const i = h.ctx.chat.length - 1;
    const m = h.ctx.chat[i];
    m.swipe_info[m.swipe_id].extra = structuredClone(m.extra);
    await h.st.swipeTo(i, 0);                                   // the reader goes back to swipe 0 ...
    await deleteSwipe(h, i, 0, 0);                              // ... and deletes it; swipe 1 is now swipe 0
    return { h, i };
}

test('C1-2: after deleting an earlier swipe the next save is not reported as failed', async t => {
    const { h } = await setup(t);
    assert.deepEqual(Object.values(h.head().domains.inventory.stacks).map(s => h.head().domains.inventory.defs[s.def].name).sort(), ['Rope', 'Torch']);
    await assert.doesNotReject(() => h.store.flush(), 'the save went through; its verification must not fail');
    assert.equal(h.store.dirty(), false, 'and the story is not left marked unsaved');
});

test('C1-2: sdk.rewind answers (never throws) after deleting an earlier swipe', async t => {
    const { h, i } = await setup(t);
    const rev = h.ctx.chat[i].extra.storySuite.receipts.at(-1).rev;
    let out;
    await assert.doesNotReject(async () => { out = await h.sdk.rewind({ index: i, beforeRev: rev }); }, 'sdk.rewind throws the save-verification error');
    assert.equal(out?.ok, true, JSON.stringify(out));
});
