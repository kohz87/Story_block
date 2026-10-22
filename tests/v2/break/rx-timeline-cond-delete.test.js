// rx-timeline (beta rolling attack), SB-inv: a stack's gear condition (`cond`) is a plain value, so the
// later reply's write holds what an earlier reply's wear did; deleting the earlier reply keeps its wear
// (and a repair a deleted reply paid for stays). Coin and counts rebase on a middle delete (SPEC §2.2,
// counters with `was`); cond should too, or RPG Battle's fix for RX-TL-1 (gear deltas) is undone by the
// host condition pieceOf prefers. Invariant #2.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

// A rules module that wears a piece by a code number from a story line, as RPG Battle's item.wear does.
const GEAR = {
    id: 'rx-gear',
    name: 'rx gear',
    version: '0.0.0',
    capture: {
        kinds: { rxwear: { grammar: '~ rxwear <amount>' } },
        apply(ctx, line) {
            const stack = Object.values(ctx.read('inventory').stacks).find(s => s.def.endsWith('iron-sword'));
            ctx.call('inventory.wear', { stack: stack.id, amount: Number(line.name) });
            return { summary: 'worn', narrate: false };
        },
    },
};
const reply = (text, lines) => `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>`;
// The condition is derived (events folded, SPEC §7), so it is read through the query, not the stack.
const cond = host => host.sdk.query('inventory.condition', { stack: Object.values(host.head().domains.inventory.stacks).find(s => s.def.endsWith('iron-sword')).id }).cond;

test("deleting the reply that wore a piece takes that wear back; a later reply's wear stays", async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ modules: [GEAR] });
    try {
        await host.send('Go.', reply('A sword.', ['+ item Iron Sword']));
        await host.send('Fight.', reply('It cracks.', ['~ rxwear 15']));
        await host.send('Rocks.', reply('It chips.', ['~ rxwear 40']));
        assert.equal(cond(host), 45);
        const at = host.ctx.chat.findIndex(m => m.is_user && m.mes === 'Fight.');
        await host.st.deleteMessage(at + 1);
        await host.st.deleteMessage(at);
        assert.deepEqual(host.store.problems(), []);
        assert.equal(cond(host), 60, 'as if the crack never happened');
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live);
    } finally {
        host.close();
    }
});
