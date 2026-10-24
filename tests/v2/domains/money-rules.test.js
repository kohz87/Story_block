// Money through a ready rules module (RB_CONTRACT §3 and P14): its `purse.currency` is the chat's currency
// when it passes Story Block's checks, its `rules.moneyPolicy` sets the caps a reply's story money is held
// to, and anything else leaves the reader's / pack's / default currency and the old caps in force. The
// wallet stays one whole number of the smallest unit throughout: a currency changes how an amount reads,
// never what is held. The rules module here is a test-only stand-in (helpers/rb-stub.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { currencyResolution, moneyCaps, validCurrency } from '../../../src/v2/domains/money.js';
import { line } from './helpers/fake-ctx.js';
import { CROWNS } from './fixtures.js';
import { REN, world } from './helpers/rb-world.js';

const MARK = { name: 'mark', plural: 'marks', short: 'mk' };
const PENNY = {
    name: 'penny', plural: 'pennies', short: 'p',
    coins: [{ name: 'penny', plural: 'pennies', value: 1 }, { name: 'silver', plural: 'silver', value: 10 }, { name: 'gold', plural: 'gold', value: 100 }],
};
const GOLD = { name: 'gold', plural: 'gold', short: 'g' };
const coin = w => w.inv().wallets.party.coin;

test('alone: the currency is the reader\'s or the pack\'s, as it always was', () => {
    const w = world({ noRb: true });
    assert.deepEqual(w.query('inventory.currency'), GOLD);
    const crowns = world({ noRb: true, settings: CROWNS });
    assert.deepEqual(crowns.query('inventory.currency'), { name: 'crowns', plural: 'crowns', short: 'cr' });
    const paid = crowns.command('wallet.receive', { owner: 'party', amount: 10 }, 'system');
    assert.equal(paid.ok, true, paid.message);
    assert.equal(paid.receipt.summary, 'The party receives 10 crowns (now 135 crowns).');
    assert.equal(coin(crowns), 135);
    assert.equal(w.module.context.static(), world({ noRb: true }).module.context.static(), 'the static part is the same line every time');
    assert.deepEqual(currencyResolution({ currency: 'mark' }, undefined), { currency: { name: 'mark', plural: 'marks', short: 'm' }, source: 'settings', reason: 'none' });
});

test('a rules module with nothing to say (no query, null, a query that throws) changes nothing', () => {
    const base = world({ noRb: true }).query('inventory.currency');
    assert.deepEqual(world({ rb: { omit: ['purse.currency'] } }).query('inventory.currency'), base);
    assert.deepEqual(world({ rb: { currency: null } }).query('inventory.currency'), base);
    assert.deepEqual(world({ rb: { currency: () => { throw new Error('rules are busy'); } } }).query('inventory.currency'), base);
    const w = world({ rb: { currency: () => { throw new Error('rules are busy'); } } });
    assert.equal(w.command('purse.pay', { owner: 'party', amount: 5 }, 'ui').ok, true, 'a rules module that is only unavailable is not blocked');
    assert.equal(coin(w), 120);
});

test('a valid override is the chat\'s currency: display, change lines, the static line and the tail', () => {
    const w = world({ rb: { currency: MARK } });
    assert.deepEqual(w.query('inventory.currency'), MARK);
    const paid = w.command('wallet.receive', { owner: 'party', amount: 10 }, 'system');
    assert.equal(paid.receipt.summary, 'The party receives 10 marks (now 135 marks).');
    assert.equal(coin(w), 135, 'the same whole number, now in marks');

    const coins = world({ rb: { currency: PENNY }, settings: CROWNS });
    assert.deepEqual(coins.query('inventory.currency'), { ...PENNY, coins: PENNY.coins });
    const out = coins.capture(line('+', 'coin', '3 silver', { from: 'the sealer' }));
    assert.equal(out.ok, true, out.message);
    assert.equal(coin(coins), 155, '3 silver is 30 of the smallest unit under the override\'s coins');
    assert.match(out.receipt.summary, /receives 3 silver — from the sealer \(now 1 gold 5 silver 5 pennies\)/);
    assert.equal(coins.capture(line('+', 'coin', '2 copper')).ok, false, 'a coin the override does not have is refused, not guessed');
    assert.equal(coin(coins), 155);
    assert.match(coins.module.context.static(), /Money is counted in pennies: 1 silver = 10 pennies, 1 gold = 100 pennies/);
    const tail = coins.module.context.tail({ state: coins.head(), query: () => null, settings: {}, chat: { length: 1, lastUser: '' } });
    assert.ok(tail.lines.includes('Wallet: 1 gold 5 silver 5 pennies'), tail.lines.join(' | '));
    assert.doesNotMatch(world({ rb: { currency: null }, settings: CROWNS }).module.context.static(), /Money is counted/, 'no override, no coin line');
});

test('the balance is a whole number of the smallest unit and is never converted when the currency changes', () => {
    const w = world({ rb: { currency: MARK } });
    const seen = [];
    for (const currency of [MARK, PENNY, null, { ...PENNY, display: 'base' }, MARK]) {
        w.stub.options.currency = currency;
        seen.push([w.query('inventory.currency').name, coin(w), w.query('inventory.wallet')]);
    }
    assert.deepEqual(seen.map(([name]) => name), ['mark', 'penny', 'gold', 'penny', 'mark']);
    for (const [, held, wallet] of seen) {
        assert.equal(held, 125);
        assert.deepEqual(wallet, { coin: 125 });
    }
    // Paying and receiving keep integers in every currency; the stored wallet holds nothing but `coin`.
    w.stub.options.currency = PENNY;
    w.command('wallet.pay', { owner: 'party', amount: 35 }, 'system');
    w.stub.options.currency = MARK;
    w.command('wallet.receive', { owner: 'party', amount: 5 }, 'system');
    assert.deepEqual(w.inv().wallets.party, { coin: 95 });
    assert.ok(Number.isSafeInteger(coin(w)));
});

const BAD_CURRENCIES = {
    'a string': 'gold',
    'a list': [],
    'no short form': { name: 'mark', plural: 'marks' },
    'an empty name': { ...MARK, name: ' ' },
    'a name of 25 characters': { ...MARK, name: 'm'.repeat(25) },
    'a short form of 7 characters': { ...MARK, short: 'm'.repeat(7) },
    'a plural that is not text': { ...MARK, plural: 7 },
    'markup in the name': { ...MARK, name: '<b>mark</b>' },
    'a delimiter in the name': { ...MARK, name: 'a|b' },
    'a field it does not have': { ...MARK, tax: 5 },
    'a display that is neither kind': { ...PENNY, display: 'wide' },
    'coins that are not a list': { ...MARK, coins: { penny: 1 } },
    'nine coins': { ...MARK, coins: Array.from({ length: 9 }, (_, at) => ({ name: `coin${String.fromCharCode(97 + at)}`, plural: `coin${String.fromCharCode(97 + at)}s`, value: at + 1 })) },
    'coins without the smallest unit': { ...MARK, coins: [{ name: 'silver', plural: 'silver', value: 10 }, { name: 'gold', plural: 'gold', value: 100 }] },
    'two coins of one name': { ...MARK, coins: [{ name: 'Gold', plural: 'golds', value: 1 }, { name: 'gold', plural: 'gold', value: 10 }] },
    'a coin worth 0': { ...MARK, coins: [{ name: 'penny', plural: 'pennies', value: 1 }, { name: 'dust', plural: 'dust', value: 0 }] },
    'a coin worth a fraction': { ...MARK, coins: [{ name: 'penny', plural: 'pennies', value: 1.5 }] },
    'a coin worth over a million': { ...MARK, coins: [{ name: 'penny', plural: 'pennies', value: 1 }, { name: 'vault', plural: 'vaults', value: 1_000_001 }] },
    'a coin worth text': { ...MARK, coins: [{ name: 'penny', plural: 'pennies', value: '1' }] },
    'a coin field it does not have': { ...MARK, coins: [{ name: 'penny', plural: 'pennies', value: 1, weight: 2 }] },
    'a coin name with a digit': { ...MARK, coins: [{ name: '5p', plural: '5ps', value: 1 }] },
    'a coin name with a colon': { ...MARK, coins: [{ name: 'a:b', plural: 'abs', value: 1 }] },
};

test('an invalid override falls back, one reason, and the balance is untouched', () => {
    for (const [what, raw] of Object.entries(BAD_CURRENCIES)) {
        assert.equal(validCurrency(raw), null, what);
        const found = currencyResolution({ currency: 'crowns' }, () => raw);
        assert.equal(found.reason, 'invalid', what);
        assert.equal(found.source, 'settings', what);
        assert.equal(found.currency.name, 'crowns', what);
    }
    const w = world({ rb: { currency: BAD_CURRENCIES['coins without the smallest unit'] }, settings: CROWNS });
    assert.equal(w.query('inventory.currency').name, 'crowns', 'the display falls back to the reader\'s');
    const paid = w.command('wallet.receive', { owner: 'party', amount: 10 }, 'system');
    assert.equal(paid.receipt.summary, 'The party receives 10 crowns (now 135 crowns).');
    assert.equal(w.capture(line('+', 'coin', '5')).ok, true);
    assert.equal(coin(w), 140);
});

test('what a valid currency may look like', () => {
    assert.deepEqual(validCurrency({ name: 'm'.repeat(24), plural: 'ms', short: 'm'.repeat(6) }), { name: 'm'.repeat(24), plural: 'ms', short: 'm'.repeat(6) });
    assert.deepEqual(validCurrency({ ...MARK, coins: [] }), MARK, 'an empty coin table is no coins');
    const eight = Array.from({ length: 8 }, (_, at) => ({ name: `c${'abcdefgh'[at]}x`, plural: `c${'abcdefgh'[at]}xs`, value: at === 0 ? 1 : at * 7 }));
    assert.equal(validCurrency({ ...MARK, coins: eight }).coins.length, 8);
    assert.deepEqual(validCurrency({ ...PENNY, coins: [...PENNY.coins].reverse(), display: 'base' }), { ...PENNY, display: 'base' }, 'smallest first, as the reader\'s coins are');
    assert.deepEqual(validCurrency({ ...PENNY, display: 'mixed' }), PENNY);
    assert.equal(validCurrency({ ...MARK, name: '  mark  ' }).name, 'mark', 'spaces around a word are not part of it');
    assert.deepEqual(validCurrency({ ...MARK, name: 'マーク', short: '円' }), { ...MARK, name: 'マーク', short: '円' });
});

test('invalid rules money holds the rules module\'s own payments; everyone else goes on in the fallback', () => {
    const w = world({ rb: { currency: { name: 'broken' } }, settings: CROWNS });
    for (const [type, payload] of [['purse.pay', { owner: 'party', amount: 5 }], ['purse.receive', { owner: 'party', amount: 5 }], ['purse.receive', { owner: 'party', amount: 5, story: true }]]) {
        const out = w.command(type, payload, 'ui');
        assert.deepEqual([out.ok, out.code], [false, 'RULES_MISMATCH'], type);
        assert.match(out.message, /not a valid one/);
    }
    assert.equal(coin(w), 125, 'nothing moved');
    const own = w.command('wallet.pay', { owner: 'party', amount: 5 }, 'system');
    assert.equal(own.ok, true, own.message);
    assert.equal(own.receipt.summary, 'The party pays 5 crowns (120 crowns left).');
    assert.equal(w.capture(line('+', 'coin', '10')).ok, true);
    assert.equal(coin(w), 130);
    w.stub.options.currency = MARK;
    assert.equal(w.command('purse.pay', { owner: 'party', amount: 5 }, 'ui').ok, true, 'a proper answer lifts the hold');
});

test('asked from inside its own answer, the resolver answers the fallback instead of looping', () => {
    const w = world({ noRb: true, settings: CROWNS, modules: [{ id: 'rpg-battle', domains: {}, commands: {}, queries: { 'purse.currency': (state, args, tools) => tools.query('inventory.currency') } }] });
    assert.deepEqual(w.query('inventory.currency'), { name: 'crowns', plural: 'crowns', short: 'cr' });
    assert.equal(currencyResolution({}, (name) => (name === 'purse.currency' ? currencyResolution({}, () => GOLD).currency : null)).source, 'rules');
});

// ---------- caps ----------

test('alone, a reply may give 1000 per level and take any amount, as before', () => {
    const w = world({ noRb: true });
    assert.equal(w.query('inventory.storyBudget').budget, 1000);
    const big = w.capture(line('+', 'coin', '1500'));
    assert.equal(big.ok, true, big.message);
    assert.match(big.problem, /one reply may give at most 1000 gold; 1000 gold was paid/);
    const taken = w.capture(line('-', 'coin', '600'), { index: 2, sid: 'sr_reply002' });
    assert.equal(taken.ok, true, taken.message);
    assert.equal(taken.problem, undefined);
    assert.equal(coin(w), 125 + 1000 - 600);
    assert.equal(Object.hasOwn(w.inv().perReply.sr_reply002 ?? {}, 'debit'), false, 'no debit is counted without a cap');
});

test('a rules module\'s caps hold a reply\'s story money, credit and debit', () => {
    const w = world({ rb: { policy: { storyCreditCap: 300, storyDebitCap: 50 } } });
    assert.equal(w.query('inventory.storyBudget').budget, 300);
    const gain = w.capture(line('+', 'coin', '500', { from: 'a thief' }));
    assert.equal(gain.ok, true, gain.message);
    assert.match(gain.problem, /one reply may give at most 300 gold; 300 gold was paid/);
    assert.equal(coin(w), 425);
    assert.equal(w.capture(line('+', 'coin', '1')).ok, false, 'the credit is used up');
    const first = w.capture(line('-', 'coin', '30'));
    assert.equal(first.ok, true, first.message);
    const second = w.capture(line('-', 'coin', '30'));
    assert.equal(second.ok, true, second.message);
    assert.match(second.problem, /one reply may take at most 50 gold; 20 gold was paid/);
    assert.equal(coin(w), 425 - 50);
    assert.equal(w.inv().perReply[REPLY_SID].debit, 50);
    const third = w.capture(line('-', 'coin', '1'));
    assert.deepEqual([third.ok, third.code], [false, 'REFUSED']);
    assert.match(third.message, /already taken all the money one reply may take/);
    // The next reply starts again, and a module's own payment is never counted.
    assert.equal(w.capture(line('-', 'coin', '40'), { index: 2, sid: 'sr_reply002' }).ok, true);
    assert.equal(w.command('purse.pay', { owner: 'party', amount: 200 }, 'ui').ok, true);
});
const REPLY_SID = 'sr_reply001';

test('the reader\'s own number beats the rules module\'s credit cap; the policy is asked for the character\'s level', () => {
    const asked = [];
    const levelled = { id: 'zz-party', domains: {}, commands: {}, queries: { 'party.pc': () => ({ id: REN, level: 7 }) } };
    const w = world({ rb: { policy: args => { asked.push(args.level); return { storyCreditCap: 100 * args.level, storyDebitCap: 10 }; } }, modules: [levelled] });
    assert.equal(w.query('inventory.storyBudget').budget, 700);
    assert.ok(asked.length && asked.every(level => level === 7), `asked with level ${asked}`);
    const own = world({ rb: { policy: { storyCreditCap: 300, storyDebitCap: 10 } }, settings: { storyCoinPerReply: 50 } });
    assert.equal(own.query('inventory.storyBudget').budget, 50);
    const gain = own.capture(line('+', 'coin', '80'));
    assert.match(gain.problem, /at most 50 gold; 50 gold was paid/);
    assert.match(own.capture(line('-', 'coin', '80')).problem, /at most 10 gold; 10 gold was paid/, 'the debit cap is the rules module\'s alone');
});

test('a policy that is not one leaves the old caps: 1000 per level, any payment', () => {
    for (const policy of [null, 'cap', [], { storyCreditCap: -5, storyDebitCap: 1.5 }, { storyCreditCap: '300', storyDebitCap: NaN }, {}, () => { throw new Error('no'); }]) {
        const w = world({ rb: { policy } });
        assert.equal(w.query('inventory.storyBudget').budget, 1000, JSON.stringify(policy));
        const taken = w.capture(line('-', 'coin', '100'));
        assert.equal(taken.ok, true, taken.message);
        assert.equal(taken.problem, undefined);
    }
    const half = world({ rb: { policy: { storyCreditCap: 200, storyDebitCap: 'x' } } });
    assert.equal(half.query('inventory.storyBudget').budget, 200, 'each cap stands on its own');
    assert.equal(half.capture(line('-', 'coin', '100')).problem, undefined);
    assert.deepEqual(moneyCaps(() => ({ storyCreditCap: 0, storyDebitCap: 9007199254740991 })), { credit: 0, debit: 9007199254740991 });
    assert.deepEqual(moneyCaps(undefined), { credit: null, debit: null });
});

test('through the whole host: the override reaches the screens\' query, the prompt and a reply\'s coin line', async t => {
    const { createHost } = await import('../../../testkit/index.js');
    const { createRbStub } = await import('./helpers/rb-stub.js');
    t.mock.method(console, 'warn', () => {});
    const stub = createRbStub({ currency: PENNY, policy: { storyCreditCap: 200, storyDebitCap: 40 } });
    const host = await createHost({ modules: [stub.module] });
    t.after(() => host.close());
    assert.equal(host.sdk.query('inventory.currency').name, 'penny');
    assert.match(host.registry.contexts().map(context => (typeof context.static === 'function' ? context.static() : '')).join('\n'), /Money is counted in pennies/);
    await host.send('Hello.', 'The sealer pays.\n\n<Changes>\n+ coin 3 silver\n</Changes>');
    assert.equal(host.head().domains.inventory.wallets.party.coin, 30);
    await host.send('More.', 'And more.\n\n<Changes>\n+ coin 500\n</Changes>');
    assert.equal(host.head().domains.inventory.wallets.party.coin, 30 + 200, 'held to the rules module\'s credit cap');
    stub.options.currency = null;
    assert.equal(host.sdk.query('inventory.currency').name, 'gold');
    assert.equal(host.head().domains.inventory.wallets.party.coin, 230, 'the same number, in the fallback currency');
});
