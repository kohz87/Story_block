// Inventory and wallet commands (§3.2, §7): every success and every rejection; nothing is kept
// on a rejection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './helpers/fake-ctx.js';
import { core, stocked } from './fixtures.js';

function setup(hookMap) {
    const module = core(hookMap);
    return createHarness([module], { state: stocked(module) });
}

// A rejection leaves the state exactly as it was.
function rejects(h, type, payload, code, pattern, opts) {
    const before = h.state;
    const result = h.run(type, payload, opts);
    assert.equal(result.ok, false, `${type} should be rejected`);
    assert.equal(result.code, code, result.message);
    if (pattern) assert.match(result.message, pattern);
    assert.equal(h.state, before, 'nothing kept');
    return result;
}

const inv = h => h.state.domains.inventory;

test('grant: from the story onto a matching loose stack', () => {
    const h = setup();
    const result = h.run('inventory.grant', { def: 'story/rope', qty: 2 }, { cause: 'story' });
    assert.equal(result.ok, true, result.message);
    assert.equal(inv(h).stacks.it_rope0001.qty, 5);
    assert.deepEqual(result.result.data.stacks, ['it_rope0001']);
    assert.equal(result.result.summary, 'The party gains Rope ×2.');
    assert.equal(result.result.narrate, false, 'the story already told it');
    assert.equal(h.state.meta.rev, 1);
});

test('grant: a different note or owner gets its own stack, with the receipt as origin', () => {
    const h = setup();
    const result = h.run('inventory.grant', { def: 'story/rope', note: 'tarred', owner: 'ac_ren00001' }, { cause: 'system' });
    assert.equal(result.ok, true, result.message);
    const [id] = result.result.data.stacks;
    assert.match(id, /^it_[a-z0-9]{8}$/);
    assert.deepEqual(inv(h).stacks[id], { id, def: 'story/rope', qty: 1, owner: 'ac_ren00001', equipped: null, note: 'tarred', from: result.receiptId });
});

test('grant: a non-stacking item makes one stack each', () => {
    const h = setup();
    const result = h.run('inventory.grant', { def: 'story/lantern', qty: 2 }, { cause: 'story' });
    assert.equal(result.ok, true, result.message);
    assert.equal(result.result.data.stacks.length, 2);
    assert.ok(result.result.data.stacks.every(id => inv(h).stacks[id].qty === 1));
});

test('grant: by name resolves or creates a story def', () => {
    const h = setup();
    assert.equal(h.run('inventory.grant', { name: 'ropes' }, { cause: 'story' }).result.data.def, 'story/rope');
    const made = h.run('inventory.grant', { name: 'Silver Ring' }, { cause: 'story' });
    assert.equal(made.result.data.def, 'story/silver-ring');
    assert.equal(made.result.data.created, true);
});

test('grant: the same ID seeds give the same stack IDs (deterministic)', () => {
    const a = setup().run('inventory.grant', { def: 'story/rope', note: 'x' }, { cause: 'story', seed: 7 });
    const b = setup().run('inventory.grant', { def: 'story/rope', note: 'x' }, { cause: 'story', seed: 7 });
    assert.deepEqual(a.result.data.stacks, b.result.data.stacks);
});

test('grant: through ctx.call from another module, even from a click', () => {
    const shop = {
        id: 'rpg-battle',
        domains: {},
        commands: { 'trade.buy': ctx => ctx.call('inventory.grant', { def: 'story/rope' }) },
    };
    const module = core();
    const h = createHarness([module, shop], { state: stocked(module) });
    const result = h.run('trade.buy', {}, { cause: 'ui' });
    assert.equal(result.ok, true, result.message);
    assert.equal(inv(h).stacks.it_rope0001.qty, 4);
});

test('grant rejections', () => {
    const h = setup();
    rejects(h, 'inventory.grant', { def: 'story/rope' }, 'INVALID', /cannot be handed out from a button/, { cause: 'ui' });
    rejects(h, 'inventory.grant', { def: 'story/nothing' }, 'NOT_FOUND', /no such item/, { cause: 'story' });
    rejects(h, 'inventory.grant', {}, 'INVALID', /which item/, { cause: 'story' });
    rejects(h, 'inventory.grant', { def: 'story/rope', qty: 0 }, 'INVALID', /at least 1/, { cause: 'story' });
    rejects(h, 'inventory.grant', { def: 'story/rope', qty: 1.5 }, 'INVALID', /whole number/, { cause: 'story' });
    rejects(h, 'inventory.grant', { def: 'story/rope', owner: 'Ren' }, 'INVALID', /party or to one of its people/, { cause: 'story' });
    rejects(h, 'inventory.grant', { def: 'story/rope', note: 5 }, 'INVALID', /note must be text/, { cause: 'story' });
    rejects(h, 'inventory.grant', { def: 'story/lantern', qty: 51 }, 'INVALID', /does not stack/, { cause: 'story' });
});

test('consume: from a stack; the last one removes the stack', () => {
    const h = setup();
    const one = h.run('inventory.consume', { stack: 'it_pota0001' });
    assert.equal(one.ok, true, one.message);
    assert.equal(one.result.summary, 'Minor Healing Draught used up (1 left).');
    assert.equal(inv(h).stacks.it_pota0001.qty, 1);
    h.run('inventory.consume', { stack: 'it_pota0001' });
    assert.equal(inv(h).stacks.it_pota0001, undefined, 'a stack at 0 is removed');
});

test('consume: by def across stacks', () => {
    const h = setup();
    const result = h.run('inventory.consume', { def: 'pack.fantasy/potion', qty: 3 });
    assert.equal(result.ok, true, result.message);
    assert.equal(inv(h).stacks.it_pota0001, undefined);
    assert.equal(inv(h).stacks.it_potb0001, undefined);
});

test('consume rejections', () => {
    const h = setup();
    rejects(h, 'inventory.consume', { stack: 'it_pota0001', qty: 3 }, 'NOT_ENOUGH', /only Minor Healing Draught ×2 left/);
    rejects(h, 'inventory.consume', { def: 'pack.fantasy/potion', qty: 4 }, 'NOT_ENOUGH');
    rejects(h, 'inventory.consume', { def: 'pack.fantasy/potion', owner: 'ac_ren00001' }, 'NOT_ENOUGH', /no Minor Healing Draught left/);
    rejects(h, 'inventory.consume', { stack: 'it_gone0001' }, 'NOT_FOUND', /no longer in the inventory/);
    rejects(h, 'inventory.consume', { def: 'story/nothing' }, 'NOT_FOUND');
    rejects(h, 'inventory.consume', {}, 'INVALID', /which item/);
    rejects(h, 'inventory.consume', { stack: 'it_rope0001', qty: -1 }, 'INVALID');
});

test('transfer: whole stack keeps its ID and is taken off', () => {
    const h = setup();
    h.run('inventory.equip', { stack: 'it_sword001' });
    const result = h.run('inventory.transfer', { stack: 'it_sword001', to: 'ac_ren00001' });
    assert.equal(result.ok, true, result.message);
    assert.equal(inv(h).stacks.it_sword001.owner, 'ac_ren00001');
    assert.equal(inv(h).stacks.it_sword001.equipped, null);
    assert.equal(result.result.summary, 'The party gives Iron Sword to ac_ren00001.');
});

test('transfer: part of a stack, then onto the matching stack', () => {
    const module = core();
    const state = stocked(module);
    state.domains.party = { actors: { ac_ren00001: { name: 'Ren' } } };
    const h = createHarness([module, { id: 'rpg-battle', domains: { party: { initial: () => ({}), validate: () => [] } } }], { state });
    const first = h.run('inventory.transfer', { stack: 'it_rope0001', to: 'ac_ren00001', qty: 1 });
    assert.equal(first.ok, true, first.message);
    assert.equal(first.result.summary, 'The party gives Rope to Ren.');
    const made = first.result.data.stack;
    assert.notEqual(made, 'it_rope0001');
    const second = h.run('inventory.transfer', { stack: 'it_rope0001', to: 'ac_ren00001', qty: 2 });
    assert.equal(second.result.data.stack, made);
    assert.equal(inv(h).stacks[made].qty, 3);
    assert.equal(inv(h).stacks.it_rope0001, undefined);
});

test('transfer rejections', () => {
    const h = setup();
    rejects(h, 'inventory.transfer', { stack: 'it_rope0001' }, 'INVALID', /who should get it/);
    rejects(h, 'inventory.transfer', { stack: 'it_rope0001', to: 'party' }, 'INVALID', /already with the party/);
    rejects(h, 'inventory.transfer', { stack: 'it_rope0001', to: 'ac_ren00001', qty: 4 }, 'NOT_ENOUGH');
    rejects(h, 'inventory.transfer', { stack: 'it_rope0001', to: 'someone' }, 'INVALID');
    rejects(h, 'inventory.transfer', { stack: 'it_none0001', to: 'ac_ren00001' }, 'NOT_FOUND');
});

test('drop: all by default, or some', () => {
    const h = setup();
    const some = h.run('inventory.drop', { stack: 'it_rope0001', qty: 1 });
    assert.equal(some.result.summary, 'The party drops Rope.');
    assert.equal(some.result.narrate, true, 'a click is told in the next reply');
    assert.equal(inv(h).stacks.it_rope0001.qty, 2);
    const all = h.run('inventory.drop', { stack: 'it_rope0001' });
    assert.equal(all.result.summary, 'The party drops Rope ×2.');
    assert.equal(inv(h).stacks.it_rope0001, undefined);
});

test('drop rejections', () => {
    const h = setup();
    rejects(h, 'inventory.drop', { stack: 'it_rope0001', qty: 9 }, 'NOT_ENOUGH');
    rejects(h, 'inventory.drop', { stack: 'it_rope0001', qty: 0 }, 'INVALID');
    rejects(h, 'inventory.drop', {}, 'NOT_FOUND');
});

test('equip: into its slot, putting away what was there', () => {
    const h = setup();
    const first = h.run('inventory.equip', { stack: 'it_sword001' });
    assert.equal(first.ok, true, first.message);
    assert.equal(inv(h).stacks.it_sword001.equipped, 'hand');
    const swap = h.run('inventory.equip', { stack: 'it_dagg0001' });
    assert.equal(swap.result.summary, 'The party equips Dagger (hand), putting away Iron Sword.');
    assert.equal(inv(h).stacks.it_sword001.equipped, null);
    assert.equal(swap.result.data.replaced, 'it_sword001');
    const other = h.run('inventory.equip', { stack: 'it_sword001', slot: 'off-hand' });
    assert.equal(other.ok, true, other.message);
    assert.equal(inv(h).stacks.it_dagg0001.equipped, 'hand');
});

test('equip: only equipment, and only with a slot', () => {
    const h = setup();
    rejects(h, 'inventory.equip', { stack: 'it_rope0001' }, 'INVALID', /Rope is not equipment/);
    rejects(h, 'inventory.equip', { stack: 'it_rope0001', slot: 'hand' }, 'INVALID', /not equipment/);
    h.run('inventory.equip', { stack: 'it_sword001' });
    rejects(h, 'inventory.equip', { stack: 'it_sword001' }, 'INVALID', /already equipped/);
    rejects(h, 'inventory.equip', { stack: 'it_nope0001' }, 'NOT_FOUND');
    const slotless = setup();
    slotless.state = (() => {
        const state = structuredClone(slotless.state);
        state.domains.inventory.defs['pack.fantasy/dagger'].slot = null;
        return state;
    })();
    rejects(slotless, 'inventory.equip', { stack: 'it_dagg0001' }, 'INVALID', /no slot/);
    rejects(slotless, 'inventory.equip', { stack: 'it_dagg0001', slot: '  ' }, 'INVALID', /no slot/);
});

test('unequip', () => {
    const h = setup();
    rejects(h, 'inventory.unequip', { stack: 'it_sword001' }, 'INVALID', /not equipped/);
    rejects(h, 'inventory.unequip', { stack: 'it_nope0001' }, 'NOT_FOUND');
    h.run('inventory.equip', { stack: 'it_sword001' });
    const result = h.run('inventory.unequip', { stack: 'it_sword001' });
    assert.equal(result.ok, true, result.message);
    assert.equal(result.result.summary, 'The party takes off Iron Sword.');
    assert.equal(inv(h).stacks.it_sword001.equipped, null);
});

test('split', () => {
    const h = setup();
    const result = h.run('inventory.split', { stack: 'it_rope0001', qty: 1 });
    assert.equal(result.ok, true, result.message);
    const made = result.result.data.made;
    assert.equal(inv(h).stacks.it_rope0001.qty, 2);
    assert.equal(inv(h).stacks[made].qty, 1);
    assert.equal(inv(h).stacks[made].def, 'story/rope');
    rejects(h, 'inventory.split', { stack: made, qty: 1 }, 'INVALID', /only one Rope/);
    rejects(h, 'inventory.split', { stack: 'it_rope0001', qty: 2 }, 'INVALID', /between 1 and 1/);
    rejects(h, 'inventory.split', { stack: 'it_rope0001' }, 'INVALID');
    rejects(h, 'inventory.split', { stack: 'it_nope0001', qty: 1 }, 'NOT_FOUND');
});

test('merge: only alike stacks join', () => {
    const h = setup();
    const made = h.run('inventory.split', { stack: 'it_rope0001', qty: 1 }).result.data.made;
    const result = h.run('inventory.merge', { stack: made, into: 'it_rope0001' });
    assert.equal(result.ok, true, result.message);
    assert.equal(inv(h).stacks.it_rope0001.qty, 3);
    assert.equal(inv(h).stacks[made], undefined);

    rejects(h, 'inventory.merge', { stack: 'it_rope0001', into: 'it_rope0001' }, 'INVALID', /itself/);
    rejects(h, 'inventory.merge', { stack: 'it_rope0001', into: 'it_pota0001' }, 'INVALID', /different items/);
    rejects(h, 'inventory.merge', { stack: 'it_potb0001', into: 'it_pota0001' }, 'INVALID', /different notes/);
    rejects(h, 'inventory.merge', { stack: 'it_rope0001', into: 'it_nope0001' }, 'NOT_FOUND');

    const away = h.run('inventory.split', { stack: 'it_rope0001', qty: 1 }).result.data.made;
    h.run('inventory.transfer', { stack: away, to: 'ac_ren00001' });
    rejects(h, 'inventory.merge', { stack: away, into: 'it_rope0001' }, 'INVALID', /different owners/);

    const twin = h.run('inventory.grant', { def: 'pack.fantasy/iron-sword' }, { cause: 'story' }).result.data.stacks[0];
    assert.equal(twin, 'it_sword001', 'a loose copy joins the loose stack');
    h.run('inventory.equip', { stack: 'it_sword001' });
    const third = h.run('inventory.split', { stack: 'it_sword001', qty: 1 }).result.data.made;
    rejects(h, 'inventory.merge', { stack: third, into: 'it_sword001' }, 'INVALID', /worn and the other is not/);

    const lamp = h.run('inventory.grant', { def: 'story/lantern' }, { cause: 'story' }).result.data.stacks[0];
    rejects(h, 'inventory.merge', { stack: lamp, into: 'it_lant0001' }, 'INVALID', /does not stack/);
});

test('wallet.pay and wallet.receive', () => {
    const h = setup({ currency: [() => [{ name: 'copper', rate: 1 }, { name: 'silver', rate: 10 }]] });
    const h2 = setup();
    // The default currency is one coin named 'coin'; the stocked wallet is under 'coin'.
    const paid = h2.run('wallet.pay', { amount: 25, to: 'the ferryman' });
    assert.equal(paid.ok, true, paid.message);
    assert.equal(paid.result.summary, 'The party pays 25 coin to the ferryman (100 coin left).');
    assert.equal(h2.state.domains.inventory.wallets.party.coin, 100);
    const got = h2.run('wallet.receive', { amount: 5, from: 'a sealer', owner: 'ac_ren00001' });
    assert.equal(got.result.summary, 'ac_ren00001 receives 5 coin from a sealer (now 5 coin).');
    assert.deepEqual(h2.state.domains.inventory.wallets.ac_ren00001, { coin: 5 });
    // With a currency hook the wallet key is the smallest coin.
    const tiered = h.run('wallet.receive', { amount: 38 });
    assert.equal(tiered.result.summary, 'The party receives 3 silver, 8 copper (now 3 silver, 8 copper).');
    assert.equal(h.state.domains.inventory.wallets.party.copper, 38);
    const other = h.run('wallet.receive', { amount: 2, currency: 'gems' });
    assert.equal(other.result.summary, 'The party receives 2 gems (now 2 gems).');
});

test('wallet rejections', () => {
    const h = setup();
    rejects(h, 'wallet.pay', { amount: 126 }, 'NOT_ENOUGH', /has only 125 coin; 126 coin is needed/);
    rejects(h, 'wallet.pay', { amount: 1, owner: 'ac_ren00001' }, 'NOT_ENOUGH', /only 0 coin/);
    rejects(h, 'wallet.pay', {}, 'INVALID', /amount/);
    rejects(h, 'wallet.pay', { amount: 0 }, 'INVALID');
    rejects(h, 'wallet.receive', { amount: 2.5 }, 'INVALID');
    rejects(h, 'wallet.receive', { amount: 1, currency: '' }, 'INVALID', /currency/);
    rejects(h, 'wallet.receive', { amount: 1, owner: 'nobody' }, 'INVALID');
    rejects(h, 'wallet.receive', { amount: Number.MAX_SAFE_INTEGER }, 'INVALID', /more money/);
});

test('handlers draft only their own domains', () => {
    const intruder = {
        id: 'intruder',
        domains: {},
        commands: { 'x.steal': ctx => { ctx.draft('inventory').wallets.party.coin = 0; } },
    };
    const module = core();
    const h = createHarness([module, intruder], { state: stocked(module) });
    rejects(h, 'x.steal', {}, 'NOT_OWNER');
});
