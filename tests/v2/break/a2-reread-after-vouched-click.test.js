// Breaker a2 (final cell): a Re-read of a reply after a quest click (`wallet.receive { story: true }`). The click keeps its own
// pay (storyClicks[<sid>][<receipt>]); the re-read capture pays the reply's lines as they stand now, and the click replayed
// after it pays again what it paid. There is no per-reply cap, so the reply gives what its lines and its click say, live and
// on a cold rebuild alike (it once held both to one budget; that budget is gone).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

// A module whose click pays a reward the story vouched for (as Story Director's quest.finish does).
const QUESTS = {
    id: 'a2-quests',
    name: 'a2 quests',
    version: '0.0.0',
    commands: { 'a2.turnIn': ctx => ctx.call('wallet.receive', { owner: 'party', amount: 400, note: 'quest reward', story: true }) },
};
const coin = h => h.head().domains.inventory.wallets?.party?.coin ?? 0;
const block = lines => `\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;

test('a2-3: a Re-read of a reply after a vouched click pays its lines and the click, each once', async t => {
    t.mock.method(console, 'warn', () => {});
    const h = await createHost({ modules: [QUESTS] });
    t.after(() => h.close());
    await h.send('We arrive.', 'The village gate.' + block(['+ coin 10']));
    await h.send('Any work?', 'Fenna has a job for you.' + block(['~ place Bluewatch | kind: settlement']));
    const index = h.store.headIndex();
    assert.equal(h.sdk.query('inventory.storyBudget').budget, null, 'no limit');
    const paid = await h.sdk.command('a2.turnIn', {});
    assert.equal(paid.ok, true, paid.message);
    assert.equal(coin(h), 410, 'the click is paid');
    // The reader edits the reply (the model had also written a purse) and presses Re-read.
    await h.st.editMessage(index, 'Fenna has a job for you, and pays up front.' + block(['~ place Bluewatch | kind: settlement', '+ coin 400']));
    const read = await h.sdk.reread(index);
    assert.equal(read.ok, true, read.message);
    assert.equal(coin(h), 810, 'the reply\'s + coin 400 line and the click after it, each once');
});
