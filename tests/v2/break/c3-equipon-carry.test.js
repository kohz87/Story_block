// C3-7: Equip on… puts what the main character wore from the shared bag into their own carry without
// asking the carry limit. equipOn (src/v2/domains/inventory.js, "Back into the wearer's own carry")
// checks `items.carry` only for the new piece (readerCarry(..., actor, move)) and then sets
// `other.owner = actor` for the replaced pieces; a replaced piece that was the shared bag's ('party',
// worn by party.pc) is new weight for that member. So a reader's click takes a member past their own
// capacity (SPEC §7 Encumbered: "The reader's own takes, buys and hand-overs past the limit are still
// refused"; invariant 3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

const REN = 'ac_ren00001';
const WEIGHT = 10;
const CAPACITY = 20;

// A stand-in for RPG Battle's rules: one member (the main character), a per-member carry limit, every
// piece weighing 10. Only the member's own load is checked for a hand-over (`move`), as RPG Battle does.
const rules = () => ({
    id: 'rules', name: 'Rules', version: '0.0.1',
    queries: {
        'party.actors': () => [{ id: REN, name: 'Ren' }],
        'party.pc': () => ({ id: REN }),
        'items.carry': (state, { owner, add = [] } = {}) => {
            if (owner === 'party') return { ok: true };
            const load = Object.values(state.domains.inventory.stacks).filter(stack => stack.owner === owner).reduce((sum, stack) => sum + WEIGHT * stack.qty, 0);
            const weight = add.reduce((sum, entry) => sum + WEIGHT * (entry.qty ?? 1), 0);
            return load + weight <= CAPACITY ? { ok: true } : { ok: false, message: `Ren cannot carry that (${load + weight} of ${CAPACITY}).` };
        },
    },
});
const pack = { id: 'gear', version: '1.0.0', requires: { storyBlock: '^2' }, content: { items: [
    { name: 'Old Mail', kind: 'equipment', slot: 'armour', value: 5 },
    { name: 'New Mail', kind: 'equipment', slot: 'armour', value: 5 },
    { name: 'Pack Frame', kind: 'goods', value: 1 },
] } };

const load = host => Object.values(host.head().domains.inventory.stacks).filter(stack => stack.owner === REN).reduce((sum, stack) => sum + WEIGHT * stack.qty, 0);
const stackOf = (host, name) => {
    const inv = host.head().domains.inventory;
    return Object.values(inv.stacks).find(stack => inv.defs[stack.def]?.name === name);
};

test('Equip on… does not take a member past their own carry limit with the piece it puts away', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ modules: [rules()] });
    t.after(() => host.close());
    assert.equal((await host.packs.packs.install(JSON.stringify(pack))).ok, true);
    await host.send('Look.', 'Gear.\n<Changes>\n+ item Old Mail\n+ item New Mail\n+ item Pack Frame\n</Changes>');
    // The main character wears Old Mail from the shared bag, and carries a pack frame of their own.
    assert.equal((await host.sdk.command('inventory.equip', { stack: stackOf(host, 'Old Mail').id })).ok, true);
    assert.equal((await host.sdk.command('inventory.transfer', { stack: stackOf(host, 'Pack Frame').id, qty: 1, to: REN })).ok, true);
    assert.equal(load(host), 10);
    // New Mail fits (10 + 10 = 20); Old Mail coming back into Ren's own carry would make 30.
    const result = await host.sdk.command('inventory.equipOn', { stack: stackOf(host, 'New Mail').id, actor: REN });
    if (result.ok) assert.ok(load(host) <= CAPACITY, `Ren carries ${load(host)} of ${CAPACITY} after Equip on…`);
    else assert.equal(load(host), 10);
});
