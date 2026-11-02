// Bug hunt (stage 41), persist.js createSaver.rescueOrphans. Three chats in quick succession: a change in A, then one in B,
// then one in C, and A is opened again before anything was written. A's change comes back to the open chat (it is saved with
// the open chat), and C's change, still pending, was overwritten as "the newest change" and never handed to `rescue`: lost.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSaver } from '../../../src/v2/persist.js';

test('bh1: reopening the first chat does not drop the change a third chat still has unsaved', async () => {
    let open = 'A';
    const saved = [];
    const rescued = [];
    const saver = createSaver({
        target: () => ({ chatId: open }),
        check: change => (change.chatId === open ? '' : { moved: 'another chat is open' }),
        save: async change => { saved.push(change.chatId); },
        rescue: async change => { rescued.push(change.chatId); },
        timers: { setTimeout: () => 0, clearTimeout: () => {} },
    });
    saver.touch();            // a change in A
    open = 'B';
    saver.touch();            // a change in B
    open = 'C';
    saver.touch();            // a change in C
    open = 'A';               // A is opened again before any save ran
    await saver.saveSoon();
    await saver.saveSoon();
    assert.deepEqual(saved, ['A'], 'the open chat is saved once');
    assert.deepEqual(rescued.sort(), ['B', 'C'], 'B and C each had a change of their own, put into their own files');
    assert.equal(saver.dirty(), false);
});
