// What one reply's story lines may make out of nothing (SPEC §7 "Story limits"), round-2 fixes:
// a `~ item … | qty:` that raises a count is a gain (r2-1); goods are held to a worth budget and new
// kinds to a count (r2-2); a module's payout the story alone vouched for counts against the coin
// budget (`wallet.receive { story: true }`); a rebased take to exactly 0 removes the stack (r2-3);
// and the tally survives a middle reply being deleted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { STORY_ITEM_QTY, STORY_NEW_DEFS, STORY_WORTH_TIMES } from '../../src/v2/domains/inventory.js';
import { rebaseOps } from '../../src/v2/ops.js';
import { createHost } from '../../testkit/index.js';

const reply = (text, lines) => `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const coin = host => host.head().domains.inventory.wallets.party?.coin ?? 0;
const qty = (host, name) => host.sdk.query('inventory.items').filter(item => item.name === name).reduce((sum, item) => sum + item.qty, 0);
const problems = host => host.turn.problems().map(problem => `${problem.code}: ${problem.message}`);
const BUDGET = 1000;

// Rules that price story items: a Gem is worth 300, everything else nothing.
const pricing = { id: 'zz-prices', name: 'Prices', hooks: { 'item.define': def => (def.name.startsWith('Gem') ? { value: 300 } : null) } };

async function fresh(t, options) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ settings: { modules: { 'story-block': { storyCoinPerReply: BUDGET } } }, ...options });
    t.after(() => host.close());
    await host.send('Hello.', reply('The road.', ['+ item Torch']));
    return host;
}

test('automatic money lets the story give coin, valuable goods, quantities and new kinds without per-reply limits', async t => {
    const host = await fresh(t, { settings: { modules: { 'story-block': { storyCoinPerReply: 0 } } }, modules: [pricing] });
    const lines = ['+ coin 50000', '+ item Gem A | qty: 30', ...Array.from({ length: 12 }, (_, i) => `+ item Trinket ${i + 1}`)];
    await host.send('A hoard.', reply('A hoard.', lines));
    assert.equal(coin(host), 50000);
    assert.equal(qty(host, 'Gem A'), 30);
    assert.equal(host.sdk.query('inventory.items').filter(item => item.name.startsWith('Trinket')).length, 12);
    assert.deepEqual(problems(host), []);
    const budget = host.sdk.query('inventory.storyBudget');
    assert.equal(budget.budget, null);
    assert.equal(budget.left, null);
});

test('~ item | qty: raising a count is held to the per-reply item limit; the clamp is a LIMITED Problem', async t => {
    const host = await fresh(t);
    await host.send('More.', reply('The crate was full.', ['~ item Torch | qty: 9999']));
    assert.equal(qty(host, 'Torch'), 1 + STORY_ITEM_QTY);
    assert.deepEqual(host.turn.problems().map(problem => problem.code), ['LIMITED']);
    assert.match(host.turn.problems()[0].message, /Torch ×9998 more was written, but one reply may give at most 20 of one item; 20 were given/);
});

test('~ item | qty: a raise counts with + item in the same reply; past the limit it is refused', async t => {
    const host = await fresh(t);
    await host.send('More.', reply('Torches.', ['+ item Torch | qty: 15', '~ item Torch | qty: 30', '~ item Torch | qty: 40']));
    assert.equal(qty(host, 'Torch'), 1 + STORY_ITEM_QTY);
    assert.deepEqual(host.turn.problems().map(problem => problem.code), ['LIMITED', 'REFUSED']);
});

test('~ item | qty: lowering a count is free, even after the reply gave all it may', async t => {
    const host = await fresh(t);
    await host.send('More.', reply('Torches.', ['+ item Torch | qty: 20', '~ item Torch | qty: 5']));
    assert.equal(qty(host, 'Torch'), 5);
    assert.deepEqual(problems(host), []);
});

test('~ item | qty: a raise past the carry limit is kept and the party is encumbered (story-block.encumbrance, on by default)', async t => {
    const asked = [];
    const carry = {
        id: 'zz-carry', name: 'Carry',
        queries: { 'items.carry': (state, args) => { asked.push(args); return args?.add?.[0]?.qty > 2 ? { ok: false, message: 'Too heavy to carry.' } : { ok: true }; } },
    };
    const host = await fresh(t, { modules: [carry] });
    await host.send('More.', reply('Torches.', ['~ item Torch | qty: 9']));
    assert.equal(qty(host, 'Torch'), 9, 'nothing the story gave is lost');
    assert.deepEqual(problems(host), []);
    const { receipt } = host.sdk.receipts().at(-1);
    assert.match(receipt.summary, /encumbered until something is put down/);
    assert.equal(receipt.data.encumbered, true);
    assert.deepEqual(asked.filter(args => Array.isArray(args?.add)).at(-1), { owner: 'party', add: [{ defId: 'story/torch', qty: 8 }] });
    await host.send('Two more.', reply('Torches.', ['~ item Torch | qty: 3']));
    assert.equal(qty(host, 'Torch'), 3);
});

test('story goods are held to a worth budget (2 × the coin budget): clamped with LIMITED, then REFUSED', async t => {
    assert.equal(STORY_WORTH_TIMES, 2);
    const host = await fresh(t, { modules: [pricing] });
    await host.send('A hoard.', reply('Gems.', ['+ item Gem A | qty: 5', '+ item Gem B | qty: 5', '+ item Gem C', '+ item Gem D', '+ item Rope | qty: 3']));
    // 2000 of worth: 5 Gem A (1500), 1 Gem B (300, 1800); Gem C (300, 200 left) is the reply's one notable
    // item (story-notable.test.js), so Gem D is refused; Rope is worth nothing.
    assert.deepEqual([qty(host, 'Gem A'), qty(host, 'Gem B'), qty(host, 'Gem C'), qty(host, 'Gem D'), qty(host, 'Rope')], [5, 1, 1, 0, 3]);
    assert.deepEqual(host.turn.problems().map(problem => problem.code), ['LIMITED', 'REFUSED']);
    assert.match(host.turn.problems()[0].message, /Gem B ×5 was written, but one reply may give goods worth at most 2,?000 gold in all; 1 was given/);
    assert.match(host.turn.problems()[1].message, /already given goods worth 1,?800 gold/);
    assert.equal(host.sdk.query('inventory.find', { name: 'Gem D' }).status, 'none', 'a refused line makes no definition');
    await host.send('Another.', reply('One more gem.', ['+ item Gem D | qty: 6']));
    assert.equal(qty(host, 'Gem D'), 6, 'the next reply starts again');
});

test('the worth tally rolls back with a swipe', async t => {
    const host = await fresh(t, { modules: [pricing] });
    await host.send('A hoard.', reply('Gems.', ['+ item Gem A | qty: 6']));
    assert.equal(qty(host, 'Gem A'), 6);
    await host.swipe(reply('Other gems.', ['+ item Gem B | qty: 6']));
    assert.deepEqual([qty(host, 'Gem A'), qty(host, 'Gem B')], [0, 6]);
    assert.deepEqual(problems(host), []);
});

test(`at most ${STORY_NEW_DEFS} new kinds of item per reply; a known item still comes`, async t => {
    const host = await fresh(t);
    const lines = Array.from({ length: STORY_NEW_DEFS + 2 }, (_, i) => `+ item Trinket ${i + 1}`);
    await host.send('A drawer.', reply('Trinkets.', [...lines, '+ item Torch']));
    const names = host.sdk.query('inventory.items').map(item => item.name);
    assert.equal(names.filter(name => name.startsWith('Trinket')).length, STORY_NEW_DEFS);
    assert.equal(qty(host, 'Torch'), 2);
    assert.deepEqual(host.turn.problems().map(problem => problem.code), ['REFUSED', 'REFUSED']);
    assert.match(host.turn.problems()[0].message, /already brought 10 new kinds of item/);
    assert.equal(Object.keys(host.head().domains.inventory.defs).filter(id => id.startsWith('story/trinket')).length, STORY_NEW_DEFS);
});

// A module whose capture kind pays what the story vouched for, as Story Director's quest close does.
const paidOut = [];
const vouching = {
    id: 'zz-vouch', name: 'Vouch',
    capture: {
        kinds: { reward: { grammar: '+ reward Amount' } },
        apply(ctx, line) {
            const out = ctx.call('wallet.receive', { owner: 'party', amount: Number(line.name), story: line.labels?.counted !== 'no' });
            paidOut.push(out.data.amount);
            return { summary: out.summary, ...(out.problem ? { problem: out.problem } : {}) };
        },
    },
};

test('wallet.receive { story: true } from a module counts against the reply\'s coin budget: clamped, never refused', async t => {
    const host = await fresh(t, { modules: [vouching] });
    const before = coin(host);
    paidOut.length = 0;
    await host.send('Done.', reply('The errands are done.', ['+ coin 600', '+ reward 300', '+ reward 300', '+ reward 300']));
    assert.equal(coin(host) - before, BUDGET);
    assert.deepEqual(paidOut, [300, 100, 0], 'data.amount is what was paid, nothing once the budget is spent');
    assert.deepEqual(host.turn.problems().map(problem => problem.code), ['LIMITED', 'LIMITED']);
    assert.match(host.turn.problems()[0].message, /300 gold was written, but one reply may give at most 1,?000 gold; 100 gold was paid/);
    assert.match(host.turn.problems()[1].message, /300 gold was written, but one reply may give at most 1,?000 gold; 0 gold was paid/);
    await host.send('Coin.', reply('A purse.', ['+ coin 1']));
    assert.equal(coin(host) - before, BUDGET + 1, 'a story coin line after it in a new reply is paid');
});

test('wallet.receive without story: true, or outside a story capture, is code\'s own payout and not counted', async t => {
    const host = await fresh(t, { modules: [vouching] });
    const before = coin(host);
    await host.send('Done.', reply('Paid.', ['+ coin 1000', '+ reward 500 | counted: no']));
    assert.equal(coin(host) - before, 1500);
    const paid = await host.bus.command('wallet.receive', { owner: 'party', amount: 5000, story: true }, { cause: 'system' });
    assert.equal(paid.ok, true);
    assert.equal(coin(host) - before, 6500);
    const bad = await host.bus.command('wallet.receive', { owner: 'party', amount: 5, story: 'yes' }, { cause: 'system' });
    assert.equal(bad.ok, false);
    assert.equal(bad.code, 'INVALID');
});

test('deleting a middle reply keeps a later reply\'s story gains (the tally is replaced whole)', async t => {
    const host = await fresh(t);
    await host.send('A.', reply('Rope.', ['+ item Rope']));
    await host.send('B.', reply('Torches.', ['+ item Lamp | qty: 3']));
    const b = host.ctx.chat.length - 1;
    await host.send('C.', reply('Paid.', ['+ coin 5', '+ item Flint']));
    await host.st.deleteMessage(b);
    await host.st.deleteMessage(b - 1);
    assert.deepEqual({ coin: coin(host), lamp: qty(host, 'Lamp'), flint: qty(host, 'Flint') }, { coin: 5, lamp: 0, flint: 1 });
});

test('a later take that a deleted reply\'s gain made room for empties the stack on replay', async t => {
    const host = await fresh(t);
    await host.send('B.', reply('Three more.', ['+ item Torch | qty: 3']));
    const b = host.ctx.chat.length - 1;
    await host.send('C.', reply('We burn one.', ['- item Torch', '+ coin 7']));
    assert.equal(qty(host, 'Torch'), 3);
    await host.st.deleteMessage(b);
    await host.st.deleteMessage(b - 1);
    // C's take, stored as "4 → 3", moved onto the 1 torch there is: 0, so the stack goes.
    assert.deepEqual({ torches: qty(host, 'Torch'), coin: coin(host) }, { torches: 0, coin: 7 });
    assert.deepEqual(Object.keys(host.head().domains.inventory.stacks), []);
});

test('rebaseOps: a moved qty at exactly 0 removes its stack; a coin at 0 stays; below 0 stays a number', () => {
    const state = { domains: { inventory: { stacks: { it_aaaaaaaa: { id: 'it_aaaaaaaa', qty: 2 } }, wallets: { party: { coin: 2 } } } } };
    const { ops, rebased } = rebaseOps(state, [
        { op: 'replace', path: '/domains/inventory/stacks/it_aaaaaaaa/qty', value: 3, was: 5 },
        { op: 'replace', path: '/domains/inventory/wallets/party/coin', value: 3, was: 5 },
    ]);
    assert.deepEqual(ops, [
        { op: 'remove', path: '/domains/inventory/stacks/it_aaaaaaaa' },
        { op: 'replace', path: '/domains/inventory/wallets/party/coin', value: 0, was: 2 },
    ]);
    assert.deepEqual([...rebased], ['inventory']);
    const below = rebaseOps(state, [{ op: 'replace', path: '/domains/inventory/stacks/it_aaaaaaaa/qty', value: 1, was: 5 }]);
    assert.deepEqual(below.ops, [{ op: 'replace', path: '/domains/inventory/stacks/it_aaaaaaaa/qty', value: -2, was: 2 }]);
});
