// Re-break r2, b2-timeline: swipe marks vs SillyTavern's non-streaming swipe.
// SillyTavern 1.19 (swipe → Generate('swipe'), streaming off): while the interceptor runs, the message
// still shows the previous swipe's text and send_date (saveReply sets the new text and date later, just
// before MESSAGE_RECEIVED). A cue committed before the reply (beforeGenerate → system receipt on the head
// carrier: RPG Battle's checks.prepare, Story Director's due events) creates the new swipe's record then,
// stamped with the OLD swipe's mark. When the reply arrives both mark parts differ, readRecord takes the
// record for a copy, and the reply gets a fresh record: the cue's ops are gone. The cached head keeps them
// until the next rebuild (live: page head one rev ahead of the replay of the page's own chat, and a swipe
// or delete back shows a different state). Drop into Story_block/tests/v2/break/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

const clock = {
    id: 'clock',
    name: 'Clock',
    domains: { clock: { initial: () => ({ ticks: 0 }) } },
    commands: { 'clock.tick': ctx => { ctx.draft('clock').ticks += 1; return { summary: 'Tick.', narrate: false }; } },
    hooks: { beforeGenerate: () => ({ commands: [{ type: 'clock.tick', payload: {} }] }) },
};

test('B-b2-timeline-r2-3: a cue committed before a non-streamed swipe\'s reply stays on that swipe', async t => {
    t.mock.method(console, 'warn', () => {});
    const h = await createHost({ modules: [clock] });
    t.after(() => h.close());
    const { st, ctx, turn, store } = h;
    let n = 0;
    st.eventSource.makeFirst('message_received', id => { ctx.chat[id].send_date = `October 21, 2026 ${++n}:00pm`; });
    await h.send('One.', 'The first answer, long enough to mark.');
    const m = ctx.chat[2];
    // SillyTavern's swipe(): syncMesToSwipe, a new swipe id, the old text and date stay for now.
    m.swipe_info[m.swipe_id].extra = structuredClone(m.extra);
    m.swipe_id = m.swipes.length;
    await st.eventSource.emit('message_swiped', 2);
    await st.eventSource.emit('generation_started', 'swipe', {}, false);
    await turn.interceptor(structuredClone(ctx.chat), 8192, () => {}, 'swipe');
    await st.eventSource.emit('chat_completion_prompt_ready', { chat: [{ role: 'system', content: 'x' }], dryRun: false });
    // saveReply: the new text and date, then MESSAGE_RECEIVED, then swipe_info for the new swipe.
    m.swipes.length += 1;
    m.mes = 'A different second answer, also long enough.';
    await st.eventSource.emit('message_received', 2, 'swipe');
    m.swipes[m.swipe_id] = m.mes;
    m.swipe_info[m.swipe_id] = { send_date: m.send_date, extra: structuredClone(m.extra) };
    await st.eventSource.emit('generation_ended', ctx.chat.length);
    const live = h.head().domains.clock.ticks;
    store.rebuild();
    assert.equal(h.head().domains.clock.ticks, live, `the swipe keeps the tick committed before its reply after a rebuild (live ${live}, rebuilt ${h.head().domains.clock.ticks})`);
});
