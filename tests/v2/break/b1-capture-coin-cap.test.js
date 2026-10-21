// B-b1-capture-2: a story `+ coin` line takes any safe integer, and a reply may repeat it without
// limit, so model text mints coin with no clamp, claim or per-reply cap (invariant 3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

const reply = (text, lines) => `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const coin = host => host.head().domains.inventory.wallets.party?.coin ?? 0;

async function fresh(t) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    return host;
}

test('one + coin line cannot set the wallet to Number.MAX_SAFE_INTEGER', async t => {
    const host = await fresh(t);
    await host.send('I open the chest.', reply('Gold!', ['+ coin 9007199254740991 | from: a chest']));
    assert.ok(coin(host) < 1_000_000, `the wallet holds ${coin(host)}`);
});

test('the same + coin line repeated 300 times in one reply is not paid 300 times', async t => {
    const host = await fresh(t);
    await host.send('I search.', reply('Coins.', Array.from({ length: 300 }, () => '+ coin 1000')));
    assert.ok(coin(host) < 300_000, `the wallet holds ${coin(host)}`);
});
