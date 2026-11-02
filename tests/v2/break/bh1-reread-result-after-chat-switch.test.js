// Bug hunt (stage 41), reply-notes.js runReread. A Re-read still running when another chat opens: its answer (refused lines, or
// the failure text) was stored under "index|swipe", which the new chat's reply at the same place also has, so the note of a reply
// of the chat now open told of lines refused in the chat before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createReplyNotes } from '../../../src/v2/reply-notes.js';
import { setupDom } from '../view/mounts/helpers.js';

const reply = text => ({ is_user: false, mes: text, swipe_id: 0, swipes: [text], extra: {} });

test('bh1: a Re-read answered after another chat was opened leaves no note on that chat\'s reply', async () => {
    const doc = setupDom();
    const ctx = { chat: [reply('Hello'), reply('A second reply')] };
    let answer;
    const notes = createReplyNotes({ ctx, doc, reread: () => new Promise(resolve => { answer = resolve; }) });
    const running = notes.reread(1);                                           // Re-read in chat A
    ctx.chat = [reply('Another hello'), reply('Another second reply')];       // chat B opens (CHAT_CHANGED)
    notes.forget();
    answer({ ok: true, problems: [{ index: 1, line: '+ item Gold bar', code: 'REFUSED', message: '"+ item Gold bar" was not used: nothing like it.' }] });
    await running;
    assert.deepEqual(notes.refusedAt(1), [], 'the lines refused in chat A are not chat B\'s');
});
