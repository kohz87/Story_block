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
const PRICES = { 'Superior Healing Potion': 125, 'Greater Elixir': 200, 'Ruby Shard': 40, 'Royal Crown': 600, 'Silver Ring': 50 };
const world = {
    id: 'zz-world', name: 'World',
    queries: { 'quest.ranks': () => [{ id: 'F', levels: [1, 10], reward: [10, COIN] }] },
    hooks: { 'item.define': def => (Object.hasOwn(PRICES, def.name) ? { value: PRICES[def.name] } : null) },
};

async function fresh(t, more = []) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ modules: [world, ...more] });
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    return host;
}

test('the limits are 5 × the goods budget, and the goods budget 2 × the coin budget', () => {
    assert.equal(STORY_NOTABLE_TIMES, 5);
    assert.deepEqual([GOODS, GIFT], [100, 500]);
});

test('one potion worth more than the reply\'s goods (125 against 100) is given, given as a key item', async t => {
    const host = await fresh(t);
    await host.send('The old man?', reply('The old man hands you a potion.', ['+ item Superior Healing Potion']));
    assert.equal(qty(host, 'Superior Healing Potion'), 1);
    assert.deepEqual(host.turn.problems(), []);
    const { receipt } = host.sdk.receipts().at(-1);
    assert.match(receipt.summary, /Superior Healing Potion, given as a key item/);
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

test('the notable item is one item: a count over 1 is clamped; an item worth more than 5 × the goods budget is refused and is not the notable one', async t => {
    const host = await fresh(t);
    await host.send('Treasure?', reply('A hoard.', ['+ item Royal Crown', '+ item Superior Healing Potion | qty: 5']));
    // The crown (600 > 500) is refused; one potion is the notable item, and the other four are over the
    // goods budget (none of them fits), so they are not given.
    assert.deepEqual([qty(host, 'Royal Crown'), qty(host, 'Superior Healing Potion')], [0, 1]);
    assert.deepEqual(codes(host), ['REFUSED', 'LIMITED']);
    assert.match(host.turn.problems()[0].message, /one Royal Crown is worth 600 gold; one reply may give goods worth at most 100 gold/);
    assert.match(host.turn.problems()[1].message, /Superior Healing Potion ×5 was written, but one reply may give only one key item beyond goods worth 100 gold in all; 1 was given as a key item/);
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

// The notable item is given as a key item (user decision, replacing a resale cap): its own stack,
// `key: true`, usable like any other but never sold (RPG Battle's trade refuses it, and its crafting
// counts it as 0).
const stacks = (host, name) => host.sdk.query('inventory.items').filter(item => item.name === name);
const keyOf = (host, name) => stacks(host, name).map(item => [item.qty, item.key === true]);
const shop = {
    id: 'zz-shop', name: 'Shop',
    commands: { 'zz.buy': (ctx, { name, qty }) => ctx.call('inventory.grant', { name, qty }) },
};

test('the notable item is a key item: its own stack, marked in inventory.items, and usable', async t => {
    const host = await fresh(t);
    await host.send('The old man?', reply('The old man hands you a potion.', ['+ item Superior Healing Potion']));
    assert.deepEqual(keyOf(host, 'Superior Healing Potion'), [[1, true]]);
    const { receipt } = host.sdk.receipts().at(-1);
    assert.equal(receipt.data.key, true);
    assert.match(receipt.summary, /it can't be sold/);
    const [potion] = stacks(host, 'Superior Healing Potion');
    const used = await host.sdk.command('inventory.consume', { stack: potion.stack, qty: 1 });
    assert.equal(used.ok, true, used.message);
    assert.equal(qty(host, 'Superior Healing Potion'), 0, 'the key item is usable');
    await host.send('Rope?', reply('Rope.', ['+ item Rope']));
    assert.deepEqual(keyOf(host, 'Rope'), [[1, false]], 'an ordinary story item is no key item');
    assert.equal(stacks(host, 'Rope')[0].key, undefined);
});

test('a key item never joins a stack of the same item, bought, looted or from the story, nor they it', async t => {
    const host = await fresh(t, [shop]);
    await host.send('A.', reply('A potion.', ['+ item Superior Healing Potion']));
    const bought = await host.sdk.command('zz.buy', { name: 'Superior Healing Potion', qty: 2 });
    assert.equal(bought.ok, true, bought.message);
    assert.deepEqual(keyOf(host, 'Superior Healing Potion').sort(), [[1, true], [2, false]]);
    const [keyItem, rest] = [true, false].map(key => stacks(host, 'Superior Healing Potion').find(item => (item.key === true) === key));
    const merged = await host.sdk.command('inventory.merge', { stack: rest.stack, into: keyItem.stack });
    assert.equal(merged.ok, false);
    assert.match(merged.message, /is a key item, kept apart/);
    // Two rings spend the goods budget, so the shard after them is the reply's key item.
    await host.send('B.', reply('Rings and a shard.', ['+ item Silver Ring | qty: 2', '+ item Ruby Shard']));
    await host.send('C.', reply('A shard.', ['+ item Ruby Shard']));
    assert.deepEqual(keyOf(host, 'Ruby Shard').sort(), [[1, false], [1, true]], 'a story item inside the budget does not join the key item either');
});

test('a key item given away stays a key item, and stays apart from what the receiver holds', async t => {
    const MIRA = 'ac_mira0001';
    const party = { id: 'zz-party', name: 'Party', queries: { 'party.actors': () => [{ id: MIRA, name: 'Mira' }] } };
    const host = await fresh(t, [shop, party]);
    await host.send('A.', reply('A potion.', ['+ item Superior Healing Potion']));
    const bought = await host.sdk.command('zz.buy', { name: 'Superior Healing Potion', qty: 2 });
    assert.equal(bought.ok, true, bought.message);
    const find = key => stacks(host, 'Superior Healing Potion').find(item => (item.key === true) === key);
    const one = await host.sdk.command('inventory.transfer', { stack: find(false).stack, to: MIRA, qty: 1 });
    assert.equal(one.ok, true, one.message);
    const gave = await host.sdk.command('inventory.transfer', { stack: find(true).stack, to: MIRA });
    assert.equal(gave.ok, true, gave.message);
    const mira = stacks(host, 'Superior Healing Potion').filter(item => item.owner === MIRA).map(item => [item.qty, item.key === true]).sort();
    assert.deepEqual(mira, [[1, false], [1, true]]);
    const back = await host.sdk.command('inventory.transfer', { stack: find(true).stack, to: 'party' });
    assert.equal(back.ok, true, back.message);
    assert.deepEqual(keyOf(host, 'Superior Healing Potion').filter(([, key]) => key), [[1, true]], 'still a key item of its own');
    assert.deepEqual(host.store.problems(), []);
});

test('deleting a reply before a key item\'s reply keeps the key item; a rebuild equals live', async t => {
    const host = await fresh(t, [shop]);
    await host.send('A.', reply('Shards.', ['+ item Ruby Shard']));
    const a = host.store.headIndex();
    await host.send('B.', reply('A potion.', ['+ item Superior Healing Potion']));
    await host.sdk.command('zz.buy', { name: 'Superior Healing Potion', qty: 2 });
    await host.send('C.', reply('Another potion.', ['+ item Superior Healing Potion']));
    await host.st.deleteMessage(a);
    await host.st.deleteMessage(a - 1);
    assert.deepEqual(host.store.problems(), []);
    assert.deepEqual(keyOf(host, 'Superior Healing Potion').sort(), [[1, true], [1, true], [2, false]]);
    const live = plain(host.head());
    host.store.rebuild();
    assert.deepEqual(plain(host.head()), live, 'a cold rebuild says the same');
});
