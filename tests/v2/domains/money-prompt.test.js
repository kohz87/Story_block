// The static prompt always names the chat's currency (money.js moneyLine): the default gold, a single
// currency the reader named, a currency with coins (the bundled Ersveil copper/silver/gold), and a
// setting switch. Without it the narrator follows the lore's own coins once the reader names another
// currency (the live report: "crown" chosen over Ersveil, prose still in copper and silver).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { coinLine, currencyOf, foreignCoin, moneyLine, parseAmount } from '../../../src/v2/domains/money.js';
import { createHost } from '../../../testkit/index.js';

const ERSVEIL = readFileSync(new URL('../../../examples/packs/ersveil/pack.json', import.meta.url), 'utf8');
const staticPart = host => host.st.requests.at(-1).chat.find(message => message.role === 'system').content;
const moneyOf = text => text.split('\n').filter(line => /^Money /.test(line));

async function start(t, { settings = {}, ersveil = false } = {}) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ settings: { modules: { 'story-block': settings } } });
    t.after(() => host.close());
    if (ersveil) assert.equal((await host.packs.packs.install(ERSVEIL, { origin: 'pack.json' })).ok, true);
    await host.send('Hello.', 'The road.');
    return host;
}

test('the money line: one short line per currency, by name, plural and short form', () => {
    assert.equal(moneyLine(currencyOf({})), 'Money in this story is gold. Name amounts in gold in narration and in coin lines (+ coin 35); no other coins exist.');
    assert.equal(moneyLine(currencyOf({ currency: 'crown' })), 'Money in this story is the crown (plural: crowns). Name amounts in crowns in narration and in coin lines (+ coin 35); no other coins exist.');
    assert.equal(moneyLine(currencyOf({ currency: 'mark', currencyPlural: 'marken', currencyShort: 'mk' })),
        'Money in this story is the mark (plural: marken, short: mk). Name amounts in marken in narration and in coin lines (+ coin 35); no other coins exist.');
    for (const settings of [{}, { currency: 'crown' }, { currency: 'crowns', currencyShort: 'cr' }, { currency: 'penny', currencyPlural: 'pennies', coins: [{ name: 'penny', value: 1 }, { name: 'silver', value: 10 }] }]) {
        assert.ok(!moneyLine(currencyOf(settings)).includes('\n'), 'one line');
    }
});

test('the money line with coins is the coin line; the currency\'s name is added only when it is none of the coins', () => {
    const coins = [{ name: 'copper', value: 1 }, { name: 'silver', value: 10 }, { name: 'gold', value: 100 }];
    const ersveil = currencyOf({ currency: 'copper', currencyPlural: 'copper', coins });
    assert.equal(moneyLine(ersveil), coinLine(ersveil));
    assert.equal(moneyLine(ersveil), 'Money is counted in copper: 1 silver = 10 copper, 1 gold = 100 copper. A coin line names one coin (+ coin 3 silver) or copper (+ coin 35); never two coins in one line.');
    const named = currencyOf({ currency: 'mark', coins });
    assert.equal(moneyLine(named), `Money in this story is the mark (plural: marks). ${coinLine(named)}`);
});

test('the new line does not conflict with foreignCoin: the currency\'s own words pass, a coin of another world is refused', () => {
    const crown = currencyOf({ currency: 'crown' });
    assert.equal(parseAmount('35 crowns', crown).amount, 35);
    assert.equal(parseAmount('35', crown).amount, 35);
    assert.equal(foreignCoin('35 crowns', crown), '');
    assert.match(parseAmount('40 silver', crown).error, /"silver" is not this chat's money/);
    assert.equal(foreignCoin('12 copper', crown), 'copper');
    assert.equal(parseAmount('3 gold', currencyOf({})).amount, 3, 'the default gold still reads its own name');
    assert.match(parseAmount('40 silver', currencyOf({})).error, /not this chat's money/);
});

test('(a) the default chat names gold in the static prompt', async t => {
    const host = await start(t);
    assert.deepEqual(moneyOf(staticPart(host)), [moneyLine(currencyOf({}))]);
    assert.match(staticPart(host), /Money in this story is gold\. Name amounts in gold/);
});

test('(b) a reader-named single currency: the static prompt names crown/crowns', async t => {
    const host = await start(t, { settings: { currency: 'crown' } });
    assert.deepEqual(moneyOf(staticPart(host)), ['Money in this story is the crown (plural: crowns). Name amounts in crowns in narration and in coin lines (+ coin 35); no other coins exist.']);
});

test('(b) the live report: the reader\'s crown over the Ersveil pack drops the pack\'s coins, and the prompt says crowns', async t => {
    const host = await start(t, { settings: { currency: 'crown' }, ersveil: true });
    const text = staticPart(host);
    assert.deepEqual(moneyOf(text), ['Money in this story is the crown (plural: crowns). Name amounts in crowns in narration and in coin lines (+ coin 35); no other coins exist.']);
    assert.doesNotMatch(moneyOf(text).join('\n'), /copper|silver/);
});

test('(c) a coins currency: Ersveil\'s copper, silver and gold are named with their worth', async t => {
    const host = await start(t, { ersveil: true });
    const coinsLine = moneyOf(staticPart(host));
    assert.equal(coinsLine.length, 1);
    assert.match(coinsLine[0], /^Money is counted in copper: 1 silver = 10 copper, 1 gold = \d+ copper\. A coin line names one coin \(\+ coin 3 silver\) or copper \(\+ coin 35\); never two coins in one line\.$/);
});

test('(d) switching the setting updates the line, and it is byte-identical while the setting is', async t => {
    const host = await start(t, { ersveil: true });
    const ersveil = moneyOf(staticPart(host));
    await host.send('Again.', 'Quiet.\n<Changes>\n+ coin 3\n</Changes>');
    assert.deepEqual(moneyOf(staticPart(host)), ersveil, 'unchanged while the currency is');
    host.settings.set('story-block', 'currency', 'crown');
    await host.send('Crowns.', 'Quiet.');
    assert.deepEqual(moneyOf(staticPart(host)), ['Money in this story is the crown (plural: crowns). Name amounts in crowns in narration and in coin lines (+ coin 35); no other coins exist.']);
    host.settings.set('story-block', 'currency', 'ducat');
    host.settings.set('story-block', 'currencyPlural', 'ducats');
    await host.send('Ducats.', 'Quiet.');
    assert.match(moneyOf(staticPart(host))[0], /^Money in this story is the ducat \(plural: ducats\)\. Name amounts in ducats /);
    host.settings.set('story-block', 'currency', '');
    await host.send('Back.', 'Quiet.');
    assert.deepEqual(moneyOf(staticPart(host)), ersveil, 'the setting cleared: the pack\'s coins again');
});
