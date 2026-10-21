// Return in time (MODULES §F17) and the receipts accessor, on the real runtime through the testkit:
// sdk.rewind branches the chat at a carrier and drops that carrier's receipts from beforeRev on; the
// old timeline is kept; the next command commits on the carrier; sdk.receipts() and tools.receipts().
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { stBranch } from '../../src/v2/rewind.js';

const counter = {
    id: 'clock',
    name: 'Clock',
    domains: { clock: { initial: () => ({ ticks: 0 }) } },
    commands: { 'clock.tick': ctx => { ctx.draft('clock').ticks += 1; ctx.claim(`tick:${ctx.rev}`); return { summary: 'Tick.', narrate: false }; } },
    queries: {
        'clock.ticks': state => state.domains.clock.ticks,
        'clock.history': (state, args, tools) => tools.receipts().filter(entry => entry.receipt.type === 'clock.tick').map(entry => [entry.index, entry.receipt.rev]),
        'clock.both': (state, args, tools) => ({ ticks: tools.query('clock.ticks'), n: tools.query('clock.history').length }),
    },
};

async function played() {
    const host = await createHost({ modules: [counter] });
    await host.send('Go.', 'You find rope.\n<Changes>\n+ item Rope\n</Changes>');
    for (let i = 0; i < 3; i += 1) assert.equal((await host.sdk.command('clock.tick', {})).ok, true);
    return host;
}

test('sdk.receipts() lists the stored receipts in chat order; queries get tools.receipts()', async () => {
    const host = await played();
    const all = host.sdk.receipts();
    assert.deepEqual(all.map(entry => [entry.index, entry.receipt.type]), [[2, 'capture.item'], [2, 'clock.tick'], [2, 'clock.tick'], [2, 'clock.tick']]);
    assert.ok(all.every((entry, i) => i === 0 || entry.index >= all[i - 1].index), 'chat order');
    assert.equal(host.sdk.query('clock.history').length, 3);
    assert.deepEqual(host.sdk.query('clock.both'), { ticks: 3, n: 3 });
    host.close();
});

test('rewind: a branch at the carrier without its receipts from beforeRev on; the old timeline is kept', async () => {
    const host = await played();
    const ticks = host.sdk.receipts().filter(entry => entry.receipt.type === 'clock.tick');
    const second = ticks[1].receipt.rev;
    await host.send('Onward.', 'Later.');
    const oldChatId = host.ctx.chatId;
    const result = await host.sdk.rewind({ index: 2, beforeRev: second });
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(result.dropped, ticks.slice(1).map(entry => entry.receipt.id));
    assert.notEqual(host.ctx.chatId, oldChatId, 'the branch is open');
    assert.equal(host.ctx.chat.length, 3, 'messages after the carrier are not on the branch');
    assert.equal(host.sdk.query('clock.ticks'), 1);
    assert.equal(host.head().meta.rev, second - 1);
    assert.equal(host.head().meta.claims[`tick:${second}`], undefined, 'the dropped claims are gone too');
    assert.ok(Object.values(host.head().domains.inventory.stacks).length === 1, 'earlier receipts stay');
    // The old timeline: all three ticks and the later reply.
    const old = host.st.chats[oldChatId];
    assert.equal(old.length, 5);
    assert.equal(old[2].extra.storySuite.receipts.filter(receipt => receipt.type === 'clock.tick').length, 3);
    // The next command commits on the carrier, with the next rev.
    const again = await host.sdk.command('clock.tick', {});
    assert.equal(again.receipt.rev, second);
    assert.equal(host.ctx.chat[2].extra.storySuite.receipts.at(-1).id, again.receipt.id);
    assert.equal(host.sdk.query('clock.ticks'), 2);
    // Saved: a reload of the branch gives the same head.
    await host.store.flush();
    const saved = host.st.saves.at(-1);
    await host.st.loadChat(saved, host.ctx.chatId);
    assert.equal(host.sdk.query('clock.ticks'), 2);
    host.close();
});

test('rewind refuses what it cannot do, and changes nothing', async () => {
    const host = await played();
    const before = structuredClone(host.ctx.chat);
    assert.equal((await host.sdk.rewind({ index: 1, beforeRev: 2 })).code, 'INVALID', 'a user message');
    assert.equal((await host.sdk.rewind({ index: 2, beforeRev: 0 })).code, 'INVALID');
    assert.equal((await host.sdk.rewind({ index: 99, beforeRev: 2 })).code, 'INVALID');
    assert.deepEqual(host.ctx.chat, before);
    host.close();
});

test('stBranch: the context\'s branchChat, else SillyTavern\'s bookmarks.js, else /branch-create', async () => {
    const calls = [];
    assert.equal(await stBranch({ branchChat: index => { calls.push(['ctx', index]); return 'a'; } })(3), 'a');
    assert.equal(await stBranch({}, { importer: async () => ({ branchChat: async index => { calls.push(['import', index]); return 'b'; } }) })(4), 'b');
    const slash = { executeSlashCommandsWithOptions: async text => { calls.push(['slash', text]); return { pipe: 'c' }; } };
    assert.equal(await stBranch(slash, { importer: async () => { throw new Error('no'); } })(5), 'c');
    assert.deepEqual(calls, [['ctx', 3], ['import', 4], ['slash', '/branch-create 5']]);
    await assert.rejects(stBranch({}, { importer: async () => ({}) })(1), /no way to branch/);
});
