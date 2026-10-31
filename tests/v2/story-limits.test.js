// What one reply's story lines give (SPEC §7 "Story limits"): the story decides what it pays, so there is no
// per-reply cap on coin, goods, quantities or new kinds, whatever an older saved `storyCoinPerReply` says. A
// `~ item … | qty:` that raises a count is a gain (r2-1); a module's payout the story alone vouched for is paid in full
// (`wallet.receive { story: true }`); a rebased take to exactly 0 removes the stack (r2-3); the tally survives a middle
// reply being deleted; a chat saved while a cap was set replays as it was written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rebaseOps } from '../../src/v2/ops.js';
import { createHost } from '../../testkit/index.js';

const reply = (text, lines) => `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const coin = host => host.head().domains.inventory.wallets.party?.coin ?? 0;
const qty = (host, name) => host.sdk.query('inventory.items').filter(item => item.name === name).reduce((sum, item) => sum + item.qty, 0);
const problems = host => host.turn.problems().map(problem => `${problem.code}: ${problem.message}`);
// A saved value of the removed setting (it capped one reply at this many coins): it must change nothing now.
const OLD_CAP = 1000;
const plain = value => JSON.parse(JSON.stringify(value));

// Rules that price story items: a Gem is worth 300, everything else nothing.
const pricing = { id: 'zz-prices', name: 'Prices', hooks: { 'item.define': def => (def.name.startsWith('Gem') ? { value: 300 } : null) } };

async function fresh(t, options) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ settings: { modules: { 'story-block': { storyCoinPerReply: OLD_CAP } } }, ...options });
    t.after(() => host.close());
    await host.send('Hello.', reply('The road.', ['+ item Torch']));
    return host;
}

test('a big payout is not capped: coin, valuable goods, quantities and new kinds, with or without an old saved cap', async t => {
    for (const settings of [{}, { modules: { 'story-block': { storyCoinPerReply: 0 } } }, { modules: { 'story-block': { storyCoinPerReply: 100 } } }]) {
        const host = await fresh(t, { settings, modules: [pricing] });
        const before = coin(host);
        const lines = ['+ coin 50000', '+ item Gem A | qty: 30', '+ item Gem B | qty: 9', '+ item Arrow | qty: 500', ...Array.from({ length: 12 }, (_, i) => `+ item Trinket ${i + 1}`)];
        await host.send('A hoard.', reply('A hoard.', lines));
        assert.equal(coin(host) - before, 50000, JSON.stringify(settings));
        assert.deepEqual([qty(host, 'Gem A'), qty(host, 'Gem B'), qty(host, 'Arrow')], [30, 9, 500]);
        assert.equal(host.sdk.query('inventory.items').filter(item => item.name.startsWith('Trinket')).length, 12);
        assert.deepEqual(problems(host), []);
        const budget = host.sdk.query('inventory.storyBudget');
        assert.deepEqual([budget.budget, budget.left, budget.paid], [null, null, 50000], 'no limit; what was paid is still told');
    }
});

test('an old saved storyCoinPerReply is ignored: not in the schema or the defaults, and setting it caps nothing', async t => {
    const host = await fresh(t);
    const module = host.registry.settingsDefs().find(def => def.moduleId === 'story-block');
    assert.equal(Object.hasOwn(module.schema, 'storyCoinPerReply'), false);
    assert.equal(Object.hasOwn(module.defaults, 'storyCoinPerReply'), false);
    for (const value of [1, 30, 1e9, -5, 'lots', null, 2.5]) {
        host.settings.set('story-block', 'storyCoinPerReply', value);
        const before = coin(host);
        await host.send('Paid.', reply('A purse.', ['+ coin 5000', '+ item Rope | qty: 40']));
        assert.equal(coin(host) - before, 5000, String(value));
        assert.deepEqual(problems(host), [], String(value));
    }
});

test('~ item | qty: raising a count is a gain and is not limited either', async t => {
    const host = await fresh(t);
    await host.send('More.', reply('The crate was full.', ['~ item Torch | qty: 9999']));
    assert.equal(qty(host, 'Torch'), 9999);
    assert.deepEqual(problems(host), []);
    await host.send('Torches.', reply('Torches.', ['+ item Torch | qty: 15', '~ item Torch | qty: 30000', '~ item Torch | qty: 40000']));
    assert.equal(qty(host, 'Torch'), 40000);
    assert.deepEqual(problems(host), []);
});

test('~ item | qty: lowering a count is free', async t => {
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

test('a thing that does not stack is still held to 50 a line, the one limit left', async t => {
    const host = await fresh(t, { modules: [{ id: 'zz-single', name: 'Single', hooks: { 'item.define': def => (def.name === 'Coin Purse' ? { stack: false } : null) } }] });
    await host.send('Purses.', reply('Purses.', ['+ item Coin Purse | qty: 80']));
    assert.equal(qty(host, 'Coin Purse'), 50);
    assert.deepEqual(host.turn.problems().map(problem => problem.code), ['LIMITED']);
});

test('goods worth a fortune and a swipe: the tally rolls back with it', async t => {
    const host = await fresh(t, { modules: [pricing] });
    await host.send('A hoard.', reply('Gems.', ['+ item Gem A | qty: 60']));
    assert.equal(qty(host, 'Gem A'), 60);
    await host.swipe(reply('Other gems.', ['+ item Gem B | qty: 60']));
    assert.deepEqual([qty(host, 'Gem A'), qty(host, 'Gem B')], [0, 60]);
    assert.deepEqual(problems(host), []);
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

test('wallet.receive { story: true } from a module is paid in full and counted for the reply', async t => {
    const host = await fresh(t, { modules: [vouching] });
    const before = coin(host);
    paidOut.length = 0;
    await host.send('Done.', reply('The errands are done.', ['+ coin 600', '+ reward 300', '+ reward 300', '+ reward 300']));
    assert.equal(coin(host) - before, 1500);
    assert.deepEqual(paidOut, [300, 300, 300], 'data.amount is what was paid');
    assert.deepEqual(problems(host), []);
    const budget = host.sdk.query('inventory.storyBudget');
    assert.deepEqual([budget.budget, budget.left, budget.paid, budget.vouched], [null, null, 1500, 900]);
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
