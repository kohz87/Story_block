// r2 B-b3-r2-2 (whole suite, Ersveil): the story's coin budget (one reply: the party rank's top,
// 400 marks at level 1) is beside the point when goods are free: the item limit counts 20 of each
// item, not their worth. One reply with 50 made-up draughts × 20 sells for 69,000 marks; one with
// 20 of each of eleven pack items for 76,932. (Story items also skip the carry limit, F39.)
// Needs the four checkouts side by side (helpers/suite.js); skipped otherwise.
import test from 'node:test';
import assert from 'node:assert/strict';

let suite = null;
try { suite = await import('./helpers/suite.js'); } catch (error) { suite = { error }; }
const skip = suite?.error ? `the four Story Suite checkouts are not side by side: ${suite.error.message}` : false;

async function sellAll(h, match) {
    let got = 0;
    for (const item of h.items().filter(entry => match(entry.name) && !entry.equipped)) {
        let best = null;
        for (const kind of ['general', 'apothecary', 'smith', 'crafter', 'guild']) {
            const quote = h.q('trade.quote', { type: 'sell', stack: item.stack, qty: item.qty, kind });
            if (quote.ok && (!best || quote.total > best.total)) best = { ...quote, kind };
        }
        if (!best) continue;
        const sold = await h.cmd('trade.sell', { stack: item.stack, qty: item.qty, kind: best.kind });
        if (sold.ok) got += sold.receipt.data.total;
    }
    return got;
}

test('what one reply\'s story lines make sells for no more than one reply may give in coin', { skip }, async () => {
    const h = await suite.started({ seed: 3 });
    try {
        const budget = h.q('inventory.storyBudget').budget;
        await h.send('A cache.', h.reply('An alchemist\'s cache.', Array.from({ length: 50 }, (_, i) => `+ item Phoenix Draught ${i + 1} | qty: 20 | note: heal 999`)));
        const got = await sellAll(h, name => name.startsWith('Phoenix Draught'));
        assert.ok(got <= budget * 2, `one reply's goods sold for ${got}; one reply may give ${budget} in coin`);
    } finally { h.close(); }
});
