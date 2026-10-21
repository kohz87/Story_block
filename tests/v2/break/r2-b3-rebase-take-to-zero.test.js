// r2 B-b3-r2-3: counter rebase with removes. Reply B adds 3 to a stack of 2; reply C takes 2 (stored
// as "5 → 3"). Delete B: C's take, moved onto 2, leaves 0, which the validator refuses ("a stack holds
// at least 1"), so the take is skipped instead of removing the stack. Live keeps 2 torches that C used
// up (C's other lines, the coin it paid, stay): 2 torches made out of nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { coin, coreHost, qtyOf, reply } from './helpers/econ.js';

test('a later take that a deleted reply\'s gain made room for empties the stack on replay', async () => {
    const host = await coreHost();
    try {
        await host.send('A.', reply('Two torches.', ['+ item Torch | qty: 2']));
        const start = coin(host);
        await host.send('B.', reply('Three more.', ['+ item Torch | qty: 3']));
        const b = host.ctx.chat.length - 1;
        await host.send('C.', reply('We burn two and pay the ferry.', ['- item Torch | qty: 2', '- coin 20 | to: the ferryman']));
        await host.st.deleteMessage(b);
        await host.st.deleteMessage(b - 1);
        assert.deepEqual({ torches: qtyOf(host, 'Torch'), coin: coin(host) }, { torches: 0, coin: start - 20 }, 'the chat as if B never was: A gave 2, C took 2 and paid 20');
    } finally { host.close(); }
});
