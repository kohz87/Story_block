// Breaker a2 (final cell): one reply's story money is one budget (SB #109, inventory.storyBudget) across
// its own `+ coin` lines and the clicks after it (a quest turn-in's `wallet.receive { story: true }`), but a
// Re-read of the reply after such a click pays both in full. The click's receipt keeps the reply's tally as
// it wrote it (perReply[<sid>] = { coin: 400, vouched: 400 }); the re-read capture starts the tally afresh,
// pays the reply's `+ coin 400` against an empty budget, and the click replayed after it puts its old tally
// back and its 400 on the wallet again. Live and a cold rebuild agree (842 marks from a 400 budget), so it is
// not a replay drift: the re-read is a second budget. Seen first with Story Director's quest.finish
// (`+ quest Torch Run | goal: bring 1 Torch | reward: 400 marks`, take, buy a torch, Finish, then edit the
// reply to add `+ coin 400` and Re-read): 800 marks paid by one reply whose budget is 400.
// Drop into Story_block/tests/v2/break/.
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

test('a2-3: a Re-read of a reply after a vouched click does not pay the reply\'s budget twice', async t => {
    t.mock.method(console, 'warn', () => {});
    const h = await createHost({ modules: [QUESTS], settings: { modules: { 'story-block': { storyCoinPerReply: 400 } } } });
    t.after(() => h.close());
    await h.send('We arrive.', 'The village gate.' + block(['+ coin 10']));
    await h.send('Any work?', 'Fenna has a job for you.' + block(['~ place Bluewatch | kind: settlement']));
    const index = h.store.headIndex();
    assert.equal(h.sdk.query('inventory.storyBudget').budget, 400);
    const paid = await h.sdk.command('a2.turnIn', {});
    assert.equal(paid.ok, true, paid.message);
    assert.equal(coin(h), 410, 'the click is paid from the reply\'s budget');
    // The reader edits the reply (the model had also written a purse) and presses Re-read.
    await h.st.editMessage(index, 'Fenna has a job for you, and pays up front.' + block(['~ place Bluewatch | kind: settlement', '+ coin 400']));
    const read = await h.sdk.reread(index);
    assert.equal(read.ok, true, read.message);
    assert.ok(coin(h) - 10 <= 400, `one reply with a budget of 400 has paid ${coin(h) - 10} (its + coin line and the click after it)`);
});
