// The money guard: a coin line that repeats a payment from the same source in the last few replies, or is far above the purse, still
// applies and only adds a Problems warning. Shapes are the owner's coffer lines (Master Vane's saddle-coffer, four replies in a row).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { moneyWarning, sourceOf } from '../../src/v2/turn/money-guard.js';

const COFFER = (amount, note) => `The coffer is opened.\n<Changes>\n+ coin ${amount} | from: ${note}\n</Changes>`;
// A purse of 60 from six different sources of 10 each (none of them over 10, so none is warned about).
const seed = host => host.send('Pockets.', `Coins turn up.\n<Changes>\n${['a', 'b', 'c', 'd', 'e', 'f'].map(who => `+ coin 10 | from: ${who} pocket`).join('\n')}\n</Changes>`);
const purse = host => host.head().domains.inventory.wallets.party?.coin ?? 0;
const warnings = host => host.turn.problems().filter(item => /applied; undo it/u.test(item.message));

test('the same payment from the same source in a later reply is applied and warned about', async t => {
    const host = await createHost();
    t.after(() => host.close());
    await seed(host);
    await host.send('I open the coffer.', COFFER(150, "Master Vane's saddle-coffer (70 Coinwater silvers and 8 dwarven gold crowns)"));
    assert.equal(warnings(host).length, 0, 'a first payment is not warned about');
    await host.send('I search it again.', COFFER(150, "Master Vane's saddle-coffer (70 silver and 8 dwarven gold crowns)"));
    assert.equal(purse(host), 360, 'the repeat still applies: the guard never blocks');
    assert.equal(warnings(host).length, 1);
    assert.match(warnings(host)[0].message, /150 from "master vane's saddle-coffer"/u);
});

test('the same source with another amount is not a repeat, and a repeat outside the last few replies is forgotten', async t => {
    const host = await createHost();
    t.after(() => host.close());
    await seed(host);
    await host.send('One.', COFFER(150, "Master Vane's saddle-coffer"));
    await host.send('Two.', COFFER(60, "Master Vane's saddle-coffer (Astra's split)"));
    assert.equal(warnings(host).length, 0);
    for (let n = 0; n < 5; n += 1) await host.send(`Gap ${n}.`, 'Nothing is paid.');
    await host.send('Late.', COFFER(150, "Master Vane's saddle-coffer"));
    assert.equal(warnings(host).length, 0, 'five replies on, the same find is a new one to the guard');
    assert.equal(purse(host), 420);
});

test('a line far above the purse (over 5 times the purse and over 10) is applied with a warning', async t => {
    const host = await createHost();
    t.after(() => host.close());
    await seed(host);
    await host.send('Two.', COFFER(600, "Master Vane's saddle-coffer (Astra's split after paying Temiwa and Torka)"));
    assert.equal(purse(host), 660);
    assert.match(warnings(host)[0]?.message ?? '', /600 is more than 5 times the purse \(60\)/u);
    await host.send('Three.', COFFER(200, 'the vault'));
    assert.equal(warnings(host).length, 1, '200 is not over 5 times a purse of 660');
});

test('small amounts and a purse that is only a little behind never warn; paying out never warns', () => {
    const receipt = (amount, now, note, summary = 'The party receives 1 gold') => ({ type: 'capture.coin', summary, data: { owner: 'party', amount, now, note } });
    assert.equal(moneyWarning(receipt(10, 10, 'from x'), []), null, 'ten is not over ten');
    assert.equal(moneyWarning(receipt(61, 66, 'from x'), [])?.includes('more than 5 times'), true, 'purse 5, +61');
    assert.equal(moneyWarning(receipt(20, 100, 'from x'), []), null);
    assert.equal(moneyWarning(receipt(500, 500, 'from x'), []), null, 'an empty purse is no baseline');
    assert.equal(moneyWarning(receipt(500, 500, 'to x', 'The party pays 500 gold'), []), null);
    assert.equal(sourceOf('from Master Vane (70 silver)'), 'master vane');
});

test('the warning changes no state: the warned chat\'s domains equal a chat that never warns (same coin, different source), save the reply ids', async t => {
    const run = async second => {
        const host = await createHost();
        t.after(() => host.close());
        await seed(host);
        await host.send('One.', COFFER(40, 'Marrit'));
        await host.send('Two.', COFFER(40, second));
        return host;
    };
    const warned = await run('Marrit'), plain = await run('Tarn');
    assert.equal(warnings(warned).length, 1);
    assert.equal(warnings(plain).length, 0);
    const bare = host => JSON.stringify(host.head().domains, (key, value) => (key === 'perReply' ? undefined : value));
    assert.equal(bare(warned), bare(plain), 'the same state: the guard wrote nothing');
    assert.equal(purse(warned), 140);
});

const PLATE = (qty = 1) => `The plate is stamped.\n<Changes>\n+ item Iron Guild Plate (F) | qty: ${qty} | note: guild rank F token\n</Changes>`;
const repeats = host => host.turn.problems().filter(item => /^Possible repeat/u.test(item.message));

test('the same item gained again in the very next reply is applied and told as a possible repeat; the reply after a gap, another quantity and a first gain are not', async t => {
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Plate.', PLATE());
    assert.equal(repeats(host).length, 0, 'a first gain is not told');
    await host.send('Again.', PLATE());
    assert.equal(repeats(host).length, 1);
    assert.equal(repeats(host)[0].code, 'LIMITED');
    assert.match(repeats(host)[0].message, /Iron Guild Plate \(F\).* gained in the reply before\. It was applied/u);
    const carried = host.head().domains.inventory;
    assert.ok(JSON.stringify(carried).includes('Iron Guild Plate'), 'the repeat still applies: the guard never blocks');
    await host.send('Gap.', 'Nothing is gained.');
    await host.send('Late.', PLATE());
    assert.equal(repeats(host).length, 1, 'the reply before had no such gain: nothing new is told');
    await host.send('Three.', PLATE(2));
    assert.equal(repeats(host).length, 1, 'another quantity is not the same award');
});

test('a coin payment repeated in the very next reply says "Possible repeat" too', async t => {
    const host = await createHost();
    t.after(() => host.close());
    await seed(host);
    await host.send('One.', COFFER(15, 'Clerk Hest'));
    await host.send('Two.', COFFER(15, 'Clerk Hest'));
    assert.equal(repeats(host).length, 1);
    assert.match(repeats(host)[0].message, /^Possible repeat: 15 from "clerk hest"/u);
});

test('the item repeat warning is receipts only: a Re-read tells it again and a rebuild changes nothing', async t => {
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Plate.', PLATE());
    await host.send('Again.', PLATE());
    const at = host.ctx.chat.length - 1, live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, 'a rebuild');
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.equal(JSON.stringify(host.head()), live, 'a Re-read');
    assert.ok(repeats(host).length >= 1, 'a Re-read tells it again');
});
