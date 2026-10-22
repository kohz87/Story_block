// Tolerant item names (names.js): portion words ("a handful of", "piece of", "some", "pair of") are left
// out and a word-order-insensitive key is tried when the exact name and its singular/plural miss, so a
// fetch quest's "Moonpetal" is found when the story wrote "a handful of moonpetals", and "alloy of sulfur
// (piece)" is the "Sulfur Alloy" the party holds. An exact alias or name always wins.
import test from 'node:test';
import assert from 'node:assert/strict';
import { looseKey, nameForms, portionless, resolveDef } from '../../../src/v2/domains/names.js';
import { createHost } from '../../../testkit/index.js';

const inventory = names => ({
    defs: Object.fromEntries(names.map(([id, name]) => [id, { id, name }])),
    aliases: {},
});

test('portion words go: handful, piece, pair, some, a few, bunch, pinch…', () => {
    assert.equal(portionless('a handful of Moonpetals'), 'moonpetals');
    assert.equal(portionless('two pieces of chalk'), 'chalk');
    assert.equal(portionless('some rope'), 'rope');
    assert.equal(portionless('a pair of boots'), 'boots');
    assert.equal(portionless('a few torches'), 'torches');
    assert.equal(portionless('a pinch of salt'), 'salt');
    assert.equal(portionless('Alloy of Sulfur (piece)'), 'alloy of sulfur');
    assert.equal(portionless('Flask of Oil'), 'flask of oil', 'a container is a thing, not a portion');
});

test('the word-order key: stop and portion words out, each word singular, sorted', () => {
    assert.equal(looseKey('Sulfur Alloy'), 'alloy sulfur');
    assert.equal(looseKey('alloy of sulfur (piece)'), 'alloy sulfur');
    assert.equal(looseKey('sulfur alloys'), 'alloy sulfur');
    assert.equal(looseKey('a bunch of Wild Berries'), 'berry wild');
    assert.equal(looseKey('Berries, wild'), 'berry wild');
    assert.equal(looseKey(''), '');
});

test('plural handling is kept', () => {
    assert.ok(nameForms('Flasks of Oil').includes('flask of oil'));
    const inv = inventory([['story/berry', 'Berry'], ['story/box', 'Box']]);
    assert.equal(resolveDef(inv, 'berries').id, 'story/berry');
    assert.equal(resolveDef(inv, 'boxes').id, 'story/box');
});

test('fallbacks in order: exact first, then without portion words, then any word order', () => {
    const inv = inventory([['story/moonpetal', 'Moonpetal'], ['story/sulfur-alloy', 'Sulfur Alloy'], ['story/boots', 'Pair of Boots'], ['story/rope', 'Rope']]);
    assert.deepEqual(resolveDef(inv, 'a handful of moonpetals'), { status: 'found', id: 'story/moonpetal', ids: ['story/moonpetal'] });
    assert.equal(resolveDef(inv, 'Alloy of Sulfur (piece)').id, 'story/sulfur-alloy');
    assert.equal(resolveDef(inv, 'boots').id, 'story/boots', 'the def\'s own portion words count for nothing');
    assert.equal(resolveDef(inv, 'some rope').id, 'story/rope');
    assert.equal(resolveDef(inv, 'iron').status, 'none');
    // An exact alias wins over anything tolerant.
    inv.defs['story/a-pair-of-boots'] = { id: 'story/a-pair-of-boots', name: 'Boots' };
    assert.equal(resolveDef(inv, 'boots').id, 'story/a-pair-of-boots');
    inv.aliases['pair of boots'] = 'story/boots';
    assert.equal(resolveDef(inv, 'Pair of Boots').id, 'story/boots');
    // Two defs with one loose key: ambiguous, never a guess.
    const two = inventory([['story/salt-pepper', 'Salt and Pepper'], ['story/pepper-salt', 'Pepper Salt']]);
    assert.deepEqual(resolveDef(two, 'pepper and salt'), { status: 'ambiguous', ids: ['story/pepper-salt', 'story/salt-pepper'] });
});

const reply = (text, lines) => `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const qty = (host, name) => host.sdk.query('inventory.items').filter(item => item.name === name).reduce((sum, item) => sum + item.qty, 0);

test('fetch quests: inventory.find and the story\'s own lines find the thing however it is written', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    await host.send('Gather.', reply('You gather petals and ore.', ['+ item Moonpetal | qty: 5', '+ item Sulfur Alloy | qty: 2']));
    // What a quest module asks for its goal ("bring 5 Moonpetals") and what the story writes later.
    for (const name of ['Moonpetals', 'a handful of moonpetals', 'some Moonpetal']) {
        const found = host.sdk.query('inventory.find', { name });
        assert.equal(found.status, 'found', name);
        assert.equal(found.stacks.reduce((sum, item) => sum + item.qty, 0), 5, name);
    }
    assert.equal(host.sdk.query('inventory.find', { name: 'alloy of sulfur (piece)' }).defs[0].name, 'Sulfur Alloy');
    await host.send('Hand over.', reply('You give the herbalist a handful.', ['- item a handful of moonpetals | qty: 2', '- item piece of alloy of sulfur', '+ item some moonpetals']));
    assert.deepEqual(host.turn.problems(), []);
    assert.equal(qty(host, 'Moonpetal'), 4);
    assert.equal(qty(host, 'Sulfur Alloy'), 1);
    assert.equal(host.sdk.query('inventory.items').length, 2, 'no new kind of item was made for a portion');
});
