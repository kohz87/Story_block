// Coins (live test, 2026-10-22, MODULES §F108): a world counts its one currency in coins ("penny: 1",
// "silver: 10", "gold: 100"). The reader's Coins setting beats the pack's `currency.coins`, which beats the
// one name. The wallet holds the smallest unit; "+ coin 3 silver" is 30, read strictly (one number, one
// known coin) before the reply's money budget; amounts show in mixed coins or in the smallest unit; the
// static prompt names the coins in one line that changes only with them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { baseUnit, coinLine, coinPlural, coinValue, coinsOf, currencyOf, formatAmount, isCurrencyName, parseAmount } from '../../../src/v2/domains/money.js';
import { withPackCurrency } from '../../../src/v2/runtime.js';
import { validatePack } from '../../../src/v2/packs/validate.js';
import { createCoreModule } from '../../../src/v2/domains/index.js';
import { changesSummary } from '../../../src/v2/screens/changes-card.js';
import { linesToList } from '../../../src/v2/host-ui.js';
import { createHost } from '../../../testkit/index.js';
import { pack } from '../packs/helpers/fixtures.js';

const COINS = [{ name: 'penny/pennies', value: 1 }, { name: 'silver', value: 10 }, { name: 'gold', value: 100 }];
const PENNY = currencyOf({ currency: 'penny', currencyPlural: 'pennies', coins: COINS });

test('coins: cleaned, smallest first, plurals; the setting reads "name: worth" lines', () => {
    assert.deepEqual(PENNY.coins, [{ name: 'penny', plural: 'pennies', value: 1 }, { name: 'silver', plural: 'silver', value: 10 }, { name: 'gold', plural: 'gold', value: 100 }]);
    assert.deepEqual(coinsOf([{ name: 'gold', value: 100 }, { name: 'copper', value: 1 }]).map(coin => coin.name), ['copper', 'gold'], 'smallest first');
    assert.deepEqual(coinsOf([{ name: 'copper', value: 1 }, { name: 'bronze', value: 1 }]).map(coin => coin.name), ['copper', 'bronze'], 'two names for one worth');
    assert.deepEqual(coinsOf([{ name: '', value: 1 }, { name: 'x', value: 0 }, { name: '5p', value: 5 }, { name: 'a', value: 1.5 }, { name: 'mark', value: 1 }, { name: 'Mark', value: 2 }]), [{ name: 'mark', plural: 'marks', value: 1 }]);
    assert.equal(coinPlural('penny'), 'pennies');
    assert.equal(coinPlural('copper'), 'copper');
    assert.equal(coinPlural('crown'), 'crowns');
    assert.deepEqual(currencyOf({ currency: 'mark' }), { name: 'mark', plural: 'marks', short: 'm' }, 'no coins: as before');
    assert.equal(currencyOf({ coins: COINS, coinDisplay: 'base' }).display, 'base');
    assert.deepEqual(baseUnit(PENNY), { name: 'penny', plural: 'pennies' });
    const field = createCoreModule({ settings: () => ({}) }).settings.schema.coins;
    const read = linesToList(field, 'copper: 1\nsilver: 10\ngold: 100');
    assert.equal(read.ok, true);
    assert.deepEqual(coinsOf(read.items).map(coin => [coin.name, coin.value]), [['copper', 1], ['silver', 10], ['gold', 100]]);
});

test('amounts: a known coin converts to the smallest unit; anything else is refused, not guessed', () => {
    for (const [text, amount] of [['30', 30], ['3 silver', 30], ['3 silver coins', 30], ['2 gold', 200], ['30 pennies', 30], ['1 penny', 1], ['1,200', 1200], ['3 Silver', 30]]) {
        assert.deepEqual(parseAmount(text, PENNY), { amount }, text);
    }
    assert.match(parseAmount('15 copper', PENNY).error, /"copper" is not a coin here: write penny, silver, gold/);
    assert.match(parseAmount('3 silver 5 pennies', PENNY).error, /more than one number: write it in one coin or in pennies/);
    assert.match(parseAmount('-3 silver', PENNY).error, /without a sign/);
    assert.match(parseAmount('0 silver', PENNY).error, /more than nothing/);
    assert.deepEqual(parseAmount('3 silver'), { amount: 3 }, 'without coins the words are ignored, as before');
    assert.equal(coinValue('silver', PENNY), 10);
    assert.equal(coinValue('pieces of gold', PENNY), 100);
    assert.equal(coinValue('rope', PENNY), 0);
    assert.equal(isCurrencyName('Silver', PENNY), true);
});

test('display: mixed coins, largest first, or the smallest unit when the reader prefers', () => {
    assert.equal(formatAmount(35, PENNY), '3 silver 5 pennies');
    assert.equal(formatAmount(135, PENNY), '1 gold 3 silver 5 pennies');
    assert.equal(formatAmount(1, PENNY), '1 penny');
    assert.equal(formatAmount(0, PENNY), '0 pennies');
    assert.equal(formatAmount(1000, PENNY), '10 gold');
    assert.equal(formatAmount(35, { ...PENNY, display: 'base' }), '35 pennies');
    assert.equal(formatAmount(35, currencyOf({ currency: 'mark' })), '35 marks', 'no coins: as before');
    const digest = { gained: [], lost: [], held: [], coin: 35, coinNow: null, place: null, arrived: [], left: [], presentNow: null, other: false, loot: 0 };
    const summary = changesSummary({ digest, currency: PENNY });
    assert.match(summary, /\+3 silver 5 pennies/);
    assert.match(changesSummary({ digest: { ...digest, coin: null, coinNow: 135 }, currency: PENNY }), /^1 gold 3 silver 5 pennies now$/);
});

test('the reader\'s coins beat the pack\'s, which beat the one name; a currency the reader named takes no pack coins', () => {
    const offer = { name: 'copper', plural: 'copper', short: 'c', coins: [{ name: 'copper', plural: 'copper', value: 1 }, { name: 'silver', plural: 'silver', value: 10 }] };
    const make = stored => {
        const base = () => structuredClone({ currency: 'gold', coins: [], ...stored });
        base.stored = () => stored;
        base.set = () => undefined;
        return withPackCurrency(base, () => offer);
    };
    assert.deepEqual(currencyOf(make({})('story-block')).coins.map(coin => coin.name), ['copper', 'silver'], 'the pack\'s');
    assert.deepEqual(currencyOf(make({ coins: COINS })('story-block')).coins.map(coin => coin.name), ['penny', 'silver', 'gold'], 'the reader\'s');
    assert.equal(currencyOf(make({ currency: 'penny' })('story-block')).coins, undefined, 'the reader\'s own name: no pack coins');
    // A pack's coins are checked.
    const checked = validatePack(pack({ currency: { name: 'copper', coins: offer.coins } }));
    assert.equal(checked.ok, true, JSON.stringify(checked.errors));
    assert.deepEqual(checked.pack.currency.coins.map(coin => coin.value), [1, 10]);
    for (const coins of [[], [{ name: 'a', value: 0 }], [{ name: 'a', value: 1, extra: 1 }], [{ name: '5p', value: 5 }], [{ name: 'a', value: 1 }, { name: 'A', value: 2 }], 'copper']) {
        const refused = validatePack(pack({ currency: { name: 'copper', coins } }));
        assert.equal(refused.ok, false, JSON.stringify(coins));
        assert.ok(refused.errors.some(error => error.path === 'currency.coins' || error.path === 'currency'));
    }
});

async function hostWith(t, own) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ settings: { modules: { 'story-block': own } } });
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    return host;
}
const coin = host => host.sdk.query('inventory.wallet', { owner: 'party' }).coin ?? 0;
const staticPart = host => host.st.requests.at(-1).chat.find(message => message.role === 'system').content;

test('capture: + coin 3 silver pays 30, + item Silver | qty: 3 too, loot in coins; a big amount is paid whole', async t => {
    const host = await hostWith(t, { currency: 'penny', currencyPlural: 'pennies', coins: COINS });
    await host.send('I sell the pelt.', 'He pays.\n<Changes>\n+ coin 3 silver | from: the trader\n</Changes>');
    assert.equal(coin(host), 30);
    await host.send('More.', 'She tips.\n<Changes>\n+ item Silver | qty: 2\n</Changes>');
    assert.equal(coin(host), 50);
    await host.send('Rich.', 'A purse.\n<Changes>\n+ coin 2 gold\n</Changes>');
    assert.equal(coin(host), 250, '2 gold is 200 pennies: all of it is paid, there is no per-reply cap');
    await host.send('Copper?', 'Odd coin.\n<Changes>\n+ coin 15 copper\n</Changes>');
    assert.equal(coin(host), 250, 'an unknown coin is refused, not paid as pennies');
    await host.send('Two coins.', 'Change.\n<Changes>\n+ coin 3 silver 5 pennies\n</Changes>');
    assert.equal(coin(host), 250, 'two coins in one line are refused');
    await host.send('Pay.', 'You pay.\n<Changes>\n- coin 1 silver | to: the inn\n</Changes>');
    assert.equal(coin(host), 240);
    await host.send('Loot.', 'A chest.\n<Changes>\n? loot 4 silver, Rope — in the chest\n</Changes>');
    const purse = host.sdk.query('inventory.loot')?.[0]?.items?.find(item => item.coin !== undefined);
    assert.equal(purse?.coin, 40, JSON.stringify(host.sdk.query('inventory.loot')));
    assert.equal(purse.name, '4 silver');
});

test('the static prompt names the coins in one line, byte-identical reply to reply; none without coins', async t => {
    const host = await hostWith(t, { currency: 'penny', currencyPlural: 'pennies', coins: COINS });
    await host.send('Next.', 'Quiet.');
    const first = staticPart(host);
    assert.ok(first.includes(coinLine(PENNY)), first);
    assert.match(coinLine(PENNY), /^Money is counted in pennies: 1 silver = 10 pennies, 1 gold = 100 pennies\. A coin line names one coin \(\+ coin 3 silver\) or pennies \(\+ coin 35\)/);
    await host.send('Again.', 'Still quiet.\n<Changes>\n+ coin 3\n</Changes>');
    await host.send('Again.', 'Quiet.');
    assert.equal(staticPart(host), first, 'unchanged while the coins are');
    const plain = await hostWith(t, {});
    await plain.send('Next.', 'Quiet.');
    assert.doesNotMatch(staticPart(plain), /Money is counted in/);
});
