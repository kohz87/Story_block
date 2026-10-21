// Re-break r2, b2-timeline (measured live): every Story Block save writes the whole chat file, and a reply
// cost two of them on top of SillyTavern's two: one right after the cues committed before the reply, one
// after the reply. The cues now go with the reply's save; a reply that never comes still has them saved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { readRecord } from '../../../src/v2/persist.js';

const clock = {
    id: 'clock',
    name: 'Clock',
    domains: { clock: { initial: () => ({ ticks: 0 }) } },
    commands: { 'clock.tick': ctx => { ctx.draft('clock').ticks += 1; return { summary: 'Tick.', narrate: false }; } },
    hooks: { beforeGenerate: (view, { commit }) => (commit ? { commands: [{ type: 'clock.tick', payload: {} }] } : {}) },
};
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };

async function host(t) {
    t.mock.method(console, 'warn', () => {});
    const h = await createHost({ modules: [clock] });
    t.after(() => h.close());
    await h.send('One.', 'Fine.');
    return h;
}

test('B-b2-timeline-r2: a cue committed before a reply is written with the reply, one save for both', async t => {
    const h = await host(t);
    const before = h.st.saves.length;
    const ticks = h.head().domains.clock.ticks;
    await h.send('Two.', 'A lamp.\n<Changes>\n+ item Lamp\n</Changes>');
    assert.equal(h.st.saves.length - before, 1, `one write of the chat for the reply (actual: ${h.st.saves.length - before})`);
    assert.equal(h.head().domains.clock.ticks, ticks + 1);
    assert.equal(h.store.dirty(), false);
    assert.equal(tickCount(h.st.saved()), ticks + 1, 'the saved chat holds the cue (on the reply before) and the reply\'s capture');
    assert.equal(readRecord(h.st.saved().at(-1)).receipts.map(receipt => receipt.type).join(','), 'capture.item');
});

test('B-b2-timeline-r2: a cue whose reply never comes is still saved when the generation ends', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const h = await host(t);
    const ticks = h.head().domains.clock.ticks;
    h.ctx.chat.push({ name: 'User', is_user: true, mes: 'Two.', send_date: '', extra: {} });
    await h.st.eventSource.emit('generation_started', 'normal', {}, false);
    await h.turn.interceptor(structuredClone(h.ctx.chat), 8192, () => {}, 'normal');
    assert.equal(h.store.dirty(), true, 'the cue waits for the reply');
    t.mock.timers.tick(1000);
    await settle();
    assert.equal(h.store.dirty(), true, 'and is not written while the reply is being written');
    // The API failed: no reply, SillyTavern hides the Stop button (GENERATION_ENDED).
    await h.st.eventSource.emit('generation_ended', h.ctx.chat.length);
    t.mock.timers.tick(400);
    await settle();
    assert.equal(h.store.dirty(), false, 'saved once the generation is over');
    assert.equal(tickCount(h.st.saved()), ticks + 1);
});

test('B-b2-timeline-r2: a cue whose chat is left before the reply is saved, not left unsaved', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const h = await host(t);
    h.ctx.chat.push({ name: 'User', is_user: true, mes: 'Two.', send_date: '', extra: {} });
    await h.turn.interceptor(structuredClone(h.ctx.chat), 8192, () => {}, 'normal');
    assert.equal(h.store.dirty(), true);
    // The same chat read again (no Stop, no GENERATION_ENDED), e.g. a reload of the chat.
    await h.st.loadChat(h.ctx.chat);
    t.mock.timers.tick(400);
    await settle();
    assert.equal(h.store.dirty(), false);
});

// The cues stored in a saved chat (each one tick).
function tickCount(messages) {
    return messages.map(readRecord).filter(Boolean)
        .reduce((ticks, record) => ticks + record.receipts.filter(receipt => receipt.type === 'clock.tick').length, 0);
}
