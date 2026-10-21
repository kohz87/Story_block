// B-b3-8: deleting a reply in the middle keeps the money a sale on it made, and brings the goods
// back. The wallet is stored as absolute `replace` ops: any later reply that touches the wallet
// writes "coin = old + sale + later", so dropping the sale's reply drops only its stack op.
// (Timeline: b2-timeline owns middle deletes; this is the economic dupe it enables.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { coreHost, coin, qtyOf, reply } from './helpers/econ.js';

test('deleting the reply that held a payment gives back exactly the state without it', async () => {
    const host = await coreHost();
    try {
        await host.send('We find a pelt.', reply('A pelt.', ['+ item Wolf Pelt | qty: 1']));
        const start = coin(host);
        // The trade: a reply in which the pelt goes and 30 coin come.
        await host.send('I sell the pelt.', reply('The tanner pays.', ['- item Wolf Pelt', '+ coin 30 | from: the tanner']));
        const sale = host.ctx.chat.length - 1;
        // Any later reply that changes the wallet.
        await host.send('On.', reply('A coin on the road.', ['+ coin 1']));
        assert.equal(coin(host), start + 31);
        await host.st.deleteMessage(sale);
        await host.st.deleteMessage(sale - 1);
        const back = { coin: coin(host), pelts: qtyOf(host, 'Wolf Pelt') };
        assert.deepEqual(back, { coin: start + 1, pelts: 1 }, 'the pelt is back, so the 30 coin must be gone');
    } finally { host.close(); }
});
