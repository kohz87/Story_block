// Chats saved while the per-reply story cap existed (the removed `storyCoinPerReply` setting): they replay as they were
// written (what a capped reply gave is in its stored ops), an old saved value of the setting changes nothing, a key
// item the cap's "notable item" rule once gave stays a key item, and new replies are not capped.
// The fixtures are chats written by Story Block 2.8.0 with the cap on (tests/v2/fixtures/): old-cap-capped-chat.json
// (cap 100: `+ coin 500` paid 100 and `+ item Arrow | qty: 60` gave 20, then `+ coin 30`) and key-item-chat.json
// (cap 50: a potion worth 125 given as a key item, and `+ coin 20`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHost } from '../../testkit/index.js';

const load = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const reply = (text, lines) => `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const coin = host => host.head().domains.inventory.wallets.party?.coin ?? 0;
const qty = (host, name) => host.sdk.query('inventory.items').filter(item => item.name === name).reduce((sum, item) => sum + item.qty, 0);
const shop = { id: 'zz-shop', name: 'Shop', commands: { 'zz.buy': (ctx, { name, qty }) => ctx.call('inventory.grant', { name, qty }) } };
const plain = value => JSON.parse(JSON.stringify(value));

async function opened(t, fixture, options = {}) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost(options);
    t.after(() => host.close());
    await host.st.loadChat(load(fixture));
    return host;
}

test('a reply the cap held back replays as it was written, with or without the old setting', async t => {
    for (const settings of [{}, { modules: { 'story-block': { storyCoinPerReply: 100 } } }, { modules: { 'story-block': { storyCoinPerReply: 1 } } }, { modules: { 'story-block': { storyCoinPerReply: 0 } } }]) {
        const host = await opened(t, 'old-cap-capped-chat.json', { settings });
        assert.deepEqual(host.store.problems(), [], JSON.stringify(settings));
        assert.equal(coin(host), 130, 'the capped 100 and the 30 after it: what it gave, not what it wrote');
        assert.equal(qty(host, 'Arrow'), 20);
        assert.equal(qty(host, 'Torch'), 1);
        const live = plain(host.head());
        host.store.rebuild();
        assert.deepEqual(plain(host.head()), live, 'a cold rebuild says the same');
    }
});

test('an old chat goes on: new replies are not capped, and a swipe or a middle delete still replays', async t => {
    const host = await opened(t, 'old-cap-capped-chat.json', { settings: { modules: { 'story-block': { storyCoinPerReply: 100 } } } });
    await host.send('More.', reply('A vault.', ['+ coin 40000', '+ item Arrow | qty: 300']));
    assert.equal(coin(host), 40130);
    assert.equal(qty(host, 'Arrow'), 320);
    assert.deepEqual(host.turn.problems(), []);
    await host.swipe(reply('A smaller vault.', ['+ coin 7000']));
    assert.equal(coin(host), 7130);
    assert.equal(qty(host, 'Arrow'), 20);
    // Delete the old capped reply (the first with money): the rest replays without it.
    const at = host.ctx.chat.findIndex(message => /\+ coin 500/.test(message.mes ?? ''));
    assert.ok(at > 0);
    await host.st.deleteMessage(at);
    await host.st.deleteMessage(at - 1);
    assert.deepEqual(host.store.problems(), []);
    assert.equal(coin(host), 7030, 'the capped reply\'s 100 went with it');
    assert.equal(qty(host, 'Arrow'), 0);
    const live = plain(host.head());
    host.store.rebuild();
    assert.deepEqual(plain(host.head()), live);
});

test('a key item the cap once gave stays a key item: its own stack, usable, apart from the rest', async t => {
    const host = await opened(t, 'key-item-chat.json', { modules: [shop] });
    assert.deepEqual(host.store.problems(), []);
    const potions = () => host.sdk.query('inventory.items').filter(item => item.name === 'Superior Healing Potion');
    assert.deepEqual(potions().map(item => [item.qty, item.key === true]), [[1, true]]);
    assert.equal(coin(host), 20);
    // A potion that is not a key item does not join it.
    const gave = await host.sdk.command('zz.buy', { name: 'Superior Healing Potion', qty: 2 });
    assert.equal(gave.ok, true, gave.message);
    assert.deepEqual(potions().map(item => [item.qty, item.key === true]).sort(), [[1, true], [2, false]]);
    const [keyItem, rest] = [true, false].map(key => potions().find(item => (item.key === true) === key));
    const merged = await host.sdk.command('inventory.merge', { stack: rest.stack, into: keyItem.stack });
    assert.equal(merged.ok, false);
    assert.match(merged.message, /is a key item, kept apart/);
    const used = await host.sdk.command('inventory.consume', { stack: keyItem.stack, qty: 1 });
    assert.equal(used.ok, true, used.message);
    assert.deepEqual(potions().map(item => [item.qty, item.key === true]), [[2, false]]);
    const live = plain(host.head());
    host.store.rebuild();
    assert.deepEqual(plain(host.head()), live);
});

test('a new valuable gift is no longer a key item: it joins the stack like any other story item', async t => {
    const world = { id: 'zz-world', name: 'World', hooks: { 'item.define': def => (def.name === 'Royal Crown' ? { value: 100000 } : null) } };
    const host = await opened(t, 'key-item-chat.json', { modules: [world], settings: { modules: { 'story-block': { storyCoinPerReply: 50 } } } });
    await host.send('Crowns.', reply('Crowns.', ['+ item Royal Crown | qty: 3', '+ item Royal Crown']));
    const crowns = host.sdk.query('inventory.items').filter(item => item.name === 'Royal Crown');
    assert.deepEqual(crowns.map(item => [item.qty, item.key === true]), [[4, false]]);
    assert.deepEqual(host.turn.problems(), []);
});
