// "Pick what you take" (`story-block.loot`): `? loot A, B x2, C — where` lays things out on the reply; its
// card shows them as chips and "Take selected" (`inventory.lootTake { sid, pick }`) puts the ticked ones in
// the party's bag. The offer is held to the reply's story limits when it is read; things already carried
// (tolerant names) are left out; each reply's loot is taken once (claim `loot:<sid>`); swipes and deletes
// take it back with the reply.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LOOT_ITEMS, LOOT_KEEP, captureLoot } from '../../src/v2/domains/inventory.js';
import { readFileSync } from 'node:fs';
import { createHost } from '../../testkit/index.js';
import { createHarness, line } from './domains/helpers/fake-ctx.js';
import { core, stocked } from './domains/fixtures.js';

const reply = (text, lines) => `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const qty = (host, name) => host.sdk.query('inventory.items').filter(item => item.name === name).reduce((sum, item) => sum + item.qty, 0);
const sid = host => host.store.carrierSid(host.store.headIndex());
const offer = host => host.head().domains.inventory.loot?.[sid(host)] ?? null;
const take = (host, pick, at = sid(host)) => host.sdk.command('inventory.lootTake', { sid: at, pick });

async function fresh(t, options = {}) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost(options);
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    return host;
}

test('? loot lays things out without giving them; the reader takes the ones ticked', async t => {
    const host = await fresh(t);
    await host.send('Search the cellar.', reply('Dusty shelves.', ['? loot Rusty Key, Lantern Oil x2, Torn Map — on the cellar shelf']));
    assert.deepEqual(host.turn.problems(), []);
    assert.deepEqual(host.sdk.query('inventory.items'), [], 'nothing is given until it is taken');
    const laid = offer(host);
    assert.deepEqual(laid.items, { 0: { name: 'Rusty Key', qty: 1 }, 1: { name: 'Lantern Oil', qty: 2 }, 2: { name: 'Torn Map', qty: 1 } });
    assert.deepEqual([laid.where, laid.claim], ['on the cellar shelf', `loot:${sid(host)}`]);
    assert.match(host.sdk.receipts().at(-1).receipt.summary, /^Loot to pick from \(on the cellar shelf\): Rusty Key, Lantern Oil ×2, Torn Map\./);

    const out = await take(host, ['0', 1]);
    assert.equal(out.ok, true, out.message);
    assert.equal(out.receipt.summary, 'The party takes Rusty Key and Lantern Oil ×2 (on the cellar shelf).');
    assert.deepEqual([qty(host, 'Rusty Key'), qty(host, 'Lantern Oil'), qty(host, 'Torn Map')], [1, 2, 0]);
    // Once per reply: the rest stays where it lay.
    const again = await take(host, [2]);
    assert.deepEqual([again.ok, again.code], [false, 'REFUSED']);
    assert.match(again.message, /already been taken/);
    assert.equal(qty(host, 'Torn Map'), 0);
});

test('a take that picks nothing, or what is not there, is INVALID; another reply\'s gone loot NOT_FOUND', async t => {
    const host = await fresh(t);
    await host.send('Look.', reply('A crate.', ['? loot Rope, Torch — in the crate']));
    for (const pick of [[], [5], [-1], 'all', [1.5], null]) {
        const out = await take(host, pick);
        assert.deepEqual([out.ok, out.code], [false, 'INVALID'], JSON.stringify(pick));
    }
    assert.equal((await take(host, [0], 'nosuchsid')).code, 'NOT_FOUND');
    assert.equal((await take(host, [0, 0, 1])).ok, true, 'a repeated pick counts once');
    assert.deepEqual([qty(host, 'Rope'), qty(host, 'Torch')], [1, 1]);
});

test('things already carried are not offered, and are skipped at the take (tolerant names)', async t => {
    const host = await fresh(t);
    await host.send('Gear up.', reply('Supplies.', ['+ item Rope']));
    await host.send('Look.', reply('A crate.', ['? loot some rope, Torch, Sulfur Alloy — in the crate']));
    assert.deepEqual(Object.values(offer(host).items).map(item => item.name), ['Torch', 'Sulfur Alloy']);
    assert.deepEqual(host.turn.problems().map(problem => [problem.code, problem.message]), [['LIMITED', 'rope is already carried, so it is not offered.']]);
    // The story then gives the alloy itself (written another way) before the reader takes.
    await host.cont(reply('', ['+ item alloy of sulfur (piece)']));
    const out = await take(host, [0, 1]);
    assert.equal(out.ok, true, out.message);
    assert.equal(out.receipt.summary, 'The party takes Torch (in the crate); Sulfur Alloy is already carried.');
    assert.deepEqual([qty(host, 'Sulfur Alloy'), qty(host, 'alloy of sulfur (piece)')], [0, 1], 'the story\'s own piece, nothing more');
});

test('the offer is held to the reply\'s story limits when it is read (worth, 20 of one item, new kinds)', async t => {
    const PRICES = { 'Ruby Shard': 40, 'Royal Crown': 600 };
    const world = {
        id: 'zz-world', name: 'World',
        queries: { 'quest.ranks': () => [{ id: 'F', levels: [1, 10], reward: [10, 50] }] },
        hooks: { 'item.define': def => (Object.hasOwn(PRICES, def.name) ? { value: PRICES[def.name] } : null) },
    };
    const host = await fresh(t, { modules: [world] });
    // Goods worth at most 100 per reply: 2 Ruby Shards fit; the crown is never notable as loot.
    await host.send('The vault.', reply('Glitter.', ['? loot Ruby Shard x3, Royal Crown, Arrows x25 — in the vault']));
    assert.deepEqual(Object.values(offer(host).items), [{ name: 'Ruby Shard', qty: 2 }, { name: 'Arrows', qty: 20 }]);
    const messages = host.turn.problems().map(problem => problem.message).join(' | ');
    assert.match(messages, /Ruby Shard ×3 was written, but one reply may give goods worth at most 100 gold in all; 2 were given/);
    assert.match(messages, /one Royal Crown is worth 600 gold/);
    assert.match(messages, /Arrows ×25 was written, but one reply may give at most 20 of one item; 20 were given/);
    assert.equal(host.sdk.query('inventory.find', { name: 'Royal Crown' }).status, 'none', 'laying out makes no definition');
    // The same reply's later lines see the budget the loot holds.
    const tally = host.head().domains.inventory.perReply[sid(host)];
    assert.equal(tally.worth, 80);
    assert.equal((await take(host, [0, 1])).ok, true);
    assert.deepEqual([qty(host, 'Ruby Shard'), qty(host, 'Arrows')], [2, 20]);
});

test('the reader\'s take is refused past the carry limit (nothing taken, the loot still there)', async t => {
    let room = 0;
    const carry = { id: 'zz-carry', name: 'Carry', queries: { 'items.carry': (state, args) => (Array.isArray(args?.add) && args.add.reduce((sum, entry) => sum + entry.qty, 0) > room ? { ok: false, message: 'The party cannot carry that.' } : { ok: true }) } };
    const host = await fresh(t, { modules: [carry] });
    await host.send('Look.', reply('A crate.', ['? loot Rope x3, Torch']));
    room = 2;
    const refused = await take(host, [0, 1]);
    assert.deepEqual([refused.ok, refused.code, refused.message], [false, 'REFUSED', 'The party cannot carry that.']);
    assert.deepEqual(host.sdk.query('inventory.items'), []);
    room = 10;
    assert.equal((await take(host, [0, 1])).ok, true, 'a refused take did not use up the claim');
    assert.equal(qty(host, 'Rope'), 3);
});

test('one offer per reply: a second loot line adds to it; at most LOOT_ITEMS things; older replies\' offers kept up to LOOT_KEEP', async t => {
    assert.deepEqual([LOOT_ITEMS, LOOT_KEEP], [8, 5]);
    const host = await fresh(t);
    await host.send('Look.', reply('Two piles.', ['? loot A1, A2 — by the door', '? loot A3, A4, A5, A6, A7, A8, A9 — by the bed']));
    const laid = offer(host);
    assert.equal(Object.keys(laid.items).length, LOOT_ITEMS);
    assert.equal(laid.where, 'by the door; by the bed');
    assert.match(host.turn.problems().map(problem => problem.message).join(' '), /at most 8 things to pick from; A9 and the rest were left out/);
    const sids = [sid(host)];
    for (let n = 0; n < LOOT_KEEP + 2; n += 1) {
        await host.send(`Step ${n}.`, reply('More.', [`? loot Thing ${n}`]));
        sids.push(sid(host));
    }
    const kept = Object.keys(host.head().domains.inventory.loot);
    assert.deepEqual(kept.sort(), sids.slice(-LOOT_KEEP).sort());
    assert.equal((await take(host, [0], sids[0])).code, 'NOT_FOUND', 'an old offer is gone');
    assert.equal((await take(host, [0], sids.at(-2))).ok, true, 'a recent older reply\'s loot can still be taken');
});

test('a swipe or a deleted reply takes the offer and what was taken back; replay equals rebuild', async t => {
    const host = await fresh(t);
    await host.send('Gear.', reply('Supplies.', ['+ item Rope']));
    await host.send('Look.', reply('A crate.', ['? loot Torch x2, Map']));
    assert.equal((await take(host, [0])).ok, true);
    assert.equal(qty(host, 'Torch'), 2);
    await host.swipe(reply('An empty crate.', ['+ coin 3']));
    assert.equal(qty(host, 'Torch'), 0);
    assert.equal(offer(host), null);
    await host.send('Again.', reply('Another crate.', ['? loot Torch, Lamp']));
    assert.equal((await take(host, [0, 1])).ok, true);
    await host.send('On.', reply('The road.', ['+ coin 1']));
    const index = host.ctx.chat.findIndex(message => /Another crate/.test(message.mes));
    await host.st.deleteMessage(index);
    await host.st.deleteMessage(index - 1);
    assert.deepEqual(host.store.problems(), []);
    assert.deepEqual([qty(host, 'Torch'), qty(host, 'Lamp'), qty(host, 'Rope')], [0, 0, 1]);
    assert.deepEqual(host.head().domains.inventory.loot ?? {}, {});
});

test('the reader cannot lay out loot from a button; the line wants ?; with the feature off it is FEATURE_OFF', () => {
    const module = core();
    const h = createHarness([module], { state: stocked(module) });
    const carrier = { index: 3, swipe: 0, sid: 'sid-test-1', key: '3:0' };
    const ok = h.capture(line('?', 'loot', 'Torch, Map'), { extra: { carrier } });
    assert.equal(ok.ok, true, ok.message);
    assert.equal(h.capture(line('+', 'loot', 'Torch'), { extra: { carrier } }).code, 'INVALID');
    assert.equal(h.capture(line('?', 'loot', 'Torch')).code, 'REFUSED', 'no reply to keep it on');
    const off = h.capture(line('?', 'loot', 'Torch'), { extra: { carrier, feature: id => id !== 'story-block.loot' } });
    assert.deepEqual([off.ok, off.code], [false, 'FEATURE_OFF']);
    const taken = h.run('inventory.lootTake', { sid: 'sid-test-1', pick: [0] }, { extra: { feature: () => false } });
    assert.equal(taken.code, 'FEATURE_OFF');
    assert.equal(h.run('inventory.lootTake', { sid: 'sid-test-1', pick: [0] }).ok, true);
    assert.equal(typeof captureLoot, 'function');
});

test('a host with Features: off, the loot grammar leaves the static part and a loot line is not used', async t => {
    const staticOf = host => host.st.promptLog.filter(entry => entry.key === 'story_suite_static' && entry.value).at(-1)?.value ?? '';
    const on = await fresh(t);
    await on.send('Look.', reply('A crate.', ['? loot Torch']));
    assert.match(staticOf(on), /\? loot Thing, Other Thing x2 — where it lies/);
    const off = await fresh(t, { settings: { features: { 'story-block.loot': false } } });
    await off.send('Look.', reply('A crate.', ['? loot Torch']));
    assert.doesNotMatch(staticOf(off), /\? loot/);
    assert.deepEqual(off.turn.problems().map(problem => problem.code), ['FEATURE_OFF']);
    assert.equal(off.head().domains.inventory.loot, undefined);
    assert.equal((await take(off, [0])).code, 'FEATURE_OFF');
});

// FB-2: loot the story offered is the story's own (`story: true`, as a `+ item` line's, B-a2-2), a pack's
// goods too: a module that buys things back holds what it pays to their worth at the sell rate, not past
// the reply's budget. A stack it joins is the story's.
test('what is taken from a story\'s loot is the story\'s own (story: true), a pack\'s goods and story/ ones', async t => {
    const sample = JSON.parse(readFileSync(new URL('../../examples/packs/riverside-starter/pack.json', import.meta.url), 'utf8'));
    const host = await fresh(t, { settings: { packs: [{ id: sample.id, version: sample.version, enabled: true, source: 'file', origin: 'test', pack: sample }] } });
    await host.send('Search the weir.', reply('Things in the reeds.', ['? loot Moonveil Trout x2, Old Boot — in the reeds']));
    const out = await take(host, [0, 1]);
    assert.equal(out.ok, true, out.message);
    const inv = host.head().domains.inventory;
    const taken = out.receipt.data.stacks.map(id => inv.stacks[id]);
    assert.deepEqual(taken.map(stack => [inv.defs[stack.def].name, stack.qty, stack.story]), [['Moonveil Trout', 2, true], ['Old Boot', 1, true]]);
    assert.match(taken[0].def, /^pack\.riverside-starter\//, 'the pack\'s own def');
    // What the pack's start gave stays code's (no flag).
    assert.ok(Object.values(inv.stacks).filter(stack => !out.receipt.data.stacks.includes(stack.id)).every(stack => stack.story !== true));
    // A rebuild equals live.
    const live = structuredClone(host.head().domains.inventory);
    host.store.rebuild();
    assert.deepEqual(host.head().domains.inventory, live);
});
