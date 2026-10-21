// One notable item per reply (SPEC §7 "Story limits"): the first `+ item` line whose one item is worth
// more than the reply's goods budget has left is given outside the worth tally, up to
// STORY_NOTABLE_TIMES × the goods budget. "The old man hands you a potion" at level 1, where the potion
// is worth more than a whole reply's goods.
import test from 'node:test';
import assert from 'node:assert/strict';
import { STORY_NOTABLE_TIMES, STORY_WORTH_TIMES } from '../../src/v2/domains/inventory.js';
import { createHost } from '../../testkit/index.js';

const reply = (text, lines) => `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const qty = (host, name) => host.sdk.query('inventory.items').filter(item => item.name === name).reduce((sum, item) => sum + item.qty, 0);
const codes = host => host.turn.problems().map(problem => problem.code);
const tally = host => host.head().domains.inventory.perReply[host.store.carrierSid(host.store.headIndex())];
const plain = value => JSON.parse(JSON.stringify(value));

// A built-in style ladder: rank F (levels 1-10) pays at most 50, so a level-1 reply may give 50 coin and
// goods worth 100; the notable item may be worth up to 500.
const COIN = 50;
const GOODS = STORY_WORTH_TIMES * COIN;
const GIFT = STORY_NOTABLE_TIMES * GOODS;
const PRICES = { 'Superior Healing Potion': 125, 'Greater Elixir': 200, 'Ruby Shard': 40, 'Royal Crown': 600 };
const world = {
    id: 'zz-world', name: 'World',
    queries: { 'quest.ranks': () => [{ id: 'F', levels: [1, 10], reward: [10, COIN] }] },
    hooks: { 'item.define': def => (Object.hasOwn(PRICES, def.name) ? { value: PRICES[def.name] } : null) },
};

async function fresh(t) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ modules: [world] });
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    return host;
}

test('the limits are 5 × the goods budget, and the goods budget 2 × the coin budget', () => {
    assert.equal(STORY_NOTABLE_TIMES, 5);
    assert.deepEqual([GOODS, GIFT], [100, 500]);
});

test('one potion worth more than the reply\'s goods (125 against 100) is given, named as the notable gift', async t => {
    const host = await fresh(t);
    await host.send('The old man?', reply('The old man hands you a potion.', ['+ item Superior Healing Potion']));
    assert.equal(qty(host, 'Superior Healing Potion'), 1);
    assert.deepEqual(host.turn.problems(), []);
    const { receipt } = host.sdk.receipts().at(-1);
    assert.match(receipt.summary, /notable gift: Superior Healing Potion/);
    assert.equal(receipt.data.notable, true);
    assert.deepEqual(tally(host), { coin: 0, worth: 0, made: 1, items: { 'story/superior-healing-potion': 1 }, notable: true });
});

test('the notable item stays out of the worth tally; a second line over the budget is held as before', async t => {
    const host = await fresh(t);
    await host.send('Loot?', reply('A chest.', [
        '+ item Superior Healing Potion',   // notable
        '+ item Ruby Shard | qty: 3',       // 120 written, 100 of goods: 2 given (LIMITED)
        '+ item Greater Elixir',            // over what is left, and the notable item is spent: REFUSED
    ]));
    assert.deepEqual([qty(host, 'Superior Healing Potion'), qty(host, 'Ruby Shard'), qty(host, 'Greater Elixir')], [1, 2, 0]);
    assert.deepEqual(codes(host), ['LIMITED', 'REFUSED']);
    assert.match(host.turn.problems()[0].message, /Ruby Shard ×3 was written, but one reply may give goods worth at most 100 gold in all; 2 were given/);
    assert.match(host.turn.problems()[1].message, /already given goods worth 80 gold, and one Greater Elixir is worth 200 gold/);
    assert.equal(tally(host).worth, 80);
});

test('a notable line past 5 × the goods budget is clamped; an item worth more than that on its own is refused and is not the notable one', async t => {
    const host = await fresh(t);
    await host.send('Treasure?', reply('A hoard.', ['+ item Royal Crown', '+ item Superior Healing Potion | qty: 5']));
    // The crown (600 > 500) is refused; the potions are the notable item: 4 × 125 = 500 fit, not 5.
    assert.deepEqual([qty(host, 'Royal Crown'), qty(host, 'Superior Healing Potion')], [0, 4]);
    assert.deepEqual(codes(host), ['REFUSED', 'LIMITED']);
    assert.match(host.turn.problems()[0].message, /one Royal Crown is worth 600 gold; one reply may give goods worth at most 100 gold/);
    assert.match(host.turn.problems()[1].message, /Superior Healing Potion ×5 was written, but one reply may give one notable item worth at most 500 gold; 4 were given/);
    assert.equal(host.sdk.query('inventory.find', { name: 'Royal Crown' }).status, 'none', 'a refused line makes no definition');
});

test('the notable allowance starts again on the next reply; a raised count is never notable', async t => {
    const host = await fresh(t);
    await host.send('A.', reply('A potion.', ['+ item Superior Healing Potion']));
    await host.send('B.', reply('An elixir.', ['+ item Greater Elixir']));
    assert.deepEqual([qty(host, 'Superior Healing Potion'), qty(host, 'Greater Elixir')], [1, 1]);
    assert.deepEqual(codes(host), []);
    assert.equal(tally(host).notable, true);
    await host.send('C.', reply('More potions.', ['~ item Superior Healing Potion | qty: 2']));
    assert.equal(qty(host, 'Superior Healing Potion'), 1);
    assert.deepEqual(codes(host), ['REFUSED']);
    await host.send('D.', reply('Rope.', ['+ item Rope']));
    assert.equal(tally(host).notable, undefined, 'a reply with no notable item stores no mark');
});

test('a swipe takes the notable item back and gives the new one; a rebuild equals live', async t => {
    const host = await fresh(t);
    await host.send('A.', reply('A potion.', ['+ item Superior Healing Potion']));
    await host.swipe(reply('An elixir instead.', ['+ item Greater Elixir', '+ item Superior Healing Potion']));
    assert.deepEqual([qty(host, 'Superior Healing Potion'), qty(host, 'Greater Elixir')], [0, 1]);
    assert.deepEqual(codes(host), ['REFUSED'], 'the swipe\'s own notable item is the elixir');
    const live = plain(host.head());
    host.store.rebuild();
    assert.deepEqual(plain(host.head()), live, 'a cold rebuild says the same');
});

test('deleting a middle reply keeps the others\' notable items; a rebuild equals live, and the next reply has its own', async t => {
    const host = await fresh(t);
    await host.send('A.', reply('A potion.', ['+ item Superior Healing Potion']));
    await host.send('B.', reply('An elixir.', ['+ item Greater Elixir']));
    const b = host.store.headIndex();
    await host.send('C.', reply('Another potion.', ['+ item Superior Healing Potion']));
    await host.st.deleteMessage(b);
    await host.st.deleteMessage(b - 1);
    assert.deepEqual(host.store.problems(), []);
    assert.deepEqual([qty(host, 'Superior Healing Potion'), qty(host, 'Greater Elixir')], [2, 0]);
    assert.equal(tally(host).notable, true, 'C keeps its own mark');
    const live = plain(host.head());
    host.store.rebuild();
    assert.deepEqual(plain(host.head()), live, 'a cold rebuild says the same');
    await host.send('D.', reply('An elixir.', ['+ item Greater Elixir']));
    assert.deepEqual([qty(host, 'Greater Elixir'), codes(host).length], [1, 0]);
    assert.deepEqual(Object.keys(host.head().domains.inventory.perReply), [host.store.carrierSid(host.store.headIndex())]);
});
