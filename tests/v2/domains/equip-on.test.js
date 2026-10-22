// "Equip on…" (MODULES §F99): `inventory.equipOn { stack, actor }` moves a piece to a member and puts it
// on in one step; what sat in the slot goes back into that member's carry and the receipt names both.
// Slot counts for accessories and worn pieces come from `items.slots` (RPG Battle's rules), 2 and 1 by
// default, never more than 3. The Inventory screen's pickers read `inventory.equipment`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MANY_SLOTS, MAX_MANY, equipmentView, slotLimits } from '../../../src/v2/domains/inventory.js';
import { createHarness } from './helpers/fake-ctx.js';
import { core, def, stack, stocked } from './fixtures.js';

const MIRA = 'ac_mira0001';
const REN = 'ac_ren00001';

// The stocked state with two named members and a few more pieces: a helm, three rings, a buckler and a
// two-handed greatsword.
function gearState(module) {
    const state = stocked(module);
    state.domains.party = { pc: REN, order: [REN, MIRA], actors: { [REN]: { id: REN, name: 'Ren' }, [MIRA]: { id: MIRA, name: 'Mira' } } };
    const inv = state.domains.inventory;
    const add = (id, name, fields) => {
        inv.defs[id] = def(id, name, { kind: 'equipment', stack: false, ...fields });
        inv.aliases[name.toLowerCase()] = id;
    };
    add('story/iron-helm', 'Iron Helm', { slot: 'head' });
    add('story/old-helm', 'Old Helm', { slot: 'head' });
    add('story/ring-a', 'Ring A', { slot: 'accessory' });
    add('story/ring-b', 'Ring B', { slot: 'accessory' });
    add('story/ring-c', 'Ring C', { slot: 'accessory' });
    add('story/ring-d', 'Ring D', { slot: 'accessory' });
    add('story/buckler', 'Buckler', { slot: 'offhand' });
    add('story/greatsword', 'Greatsword', { slot: 'weapon', tags: ['two-handed'] });
    add('story/shortsword', 'Shortsword', { slot: 'weapon' });
    Object.assign(inv.stacks, {
        it_helm0001: stack('it_helm0001', 'story/iron-helm', 1),
        it_oldh0001: stack('it_oldh0001', 'story/old-helm', 1, { owner: MIRA, equipped: 'head' }),
        it_ringa001: stack('it_ringa001', 'story/ring-a', 1),
        it_ringb001: stack('it_ringb001', 'story/ring-b', 1),
        it_ringc001: stack('it_ringc001', 'story/ring-c', 1),
        it_ringd001: stack('it_ringd001', 'story/ring-d', 1),
        it_buck0001: stack('it_buck0001', 'story/buckler', 1),
        it_grts0001: stack('it_grts0001', 'story/greatsword', 1),
        it_shor0001: stack('it_shor0001', 'story/shortsword', 1),
    });
    return state;
}

// `rules` ({ queries }) stands in for RPG Battle's (items.slots, items.canWear, items.carry).
function harness(rules = null) {
    const module = core();
    const modules = rules ? [module, { id: 'rpg-battle', domains: {}, commands: {}, ...rules }] : [module];
    return createHarness(modules, { state: gearState(module) });
}
const stacks = h => h.state.domains.inventory.stacks;
const worn = (h, owner) => Object.values(stacks(h)).filter(s => s.owner === owner && s.equipped !== null).map(s => [s.id, s.equipped]).sort();

test('one step: the piece goes from the bag to the member and on', () => {
    const h = harness();
    const out = h.run('inventory.equipOn', { stack: 'it_shor0001', actor: MIRA });
    assert.equal(out.ok, true, out.message);
    assert.deepEqual([stacks(h).it_shor0001.owner, stacks(h).it_shor0001.equipped], [MIRA, 'weapon']);
    assert.equal(out.result.summary, 'Mira equips Shortsword from the party (weapon).');
    assert.deepEqual(out.result.data, { stack: 'it_shor0001', def: 'story/shortsword', actor: MIRA, from: 'party', slot: 'weapon', replaced: [], replacedNames: [] });
});

test('a full slot: the piece there goes back into that member\'s carry, and the receipt names both', () => {
    const h = harness();
    const out = h.run('inventory.equipOn', { stack: 'it_helm0001', actor: MIRA });
    assert.equal(out.ok, true, out.message);
    assert.equal(out.result.summary, 'Mira equips Iron Helm from the party (head); Old Helm goes back into Mira\'s pack.');
    assert.deepEqual(out.result.data.replaced, ['it_oldh0001']);
    assert.deepEqual(stacks(h).it_oldh0001, { ...stacks(h).it_oldh0001, owner: MIRA, equipped: null });
    assert.deepEqual(worn(h, MIRA), [['it_helm0001', 'head']]);
});

test('accessories: 2 by default; a third sends the oldest back; keys stay in the order they went on', () => {
    const h = harness();
    for (const id of ['it_ringa001', 'it_ringb001']) assert.equal(h.run('inventory.equipOn', { stack: id, actor: REN }).ok, true);
    assert.deepEqual(worn(h, REN), [['it_ringa001', 'accessory-1'], ['it_ringb001', 'accessory-2']]);
    const third = h.run('inventory.equipOn', { stack: 'it_ringc001', actor: REN });
    assert.equal(third.ok, true, third.message);
    assert.match(third.result.summary, /Ring A goes back into Ren's pack/);
    assert.deepEqual(worn(h, REN), [['it_ringb001', 'accessory-1'], ['it_ringc001', 'accessory-2']]);
    // Taking one off and putting another on: the newest still goes last, the oldest first out.
    assert.equal(h.run('inventory.unequip', { stack: 'it_ringb001' }).ok, true);
    assert.equal(h.run('inventory.equipOn', { stack: 'it_ringd001', actor: REN }).ok, true);
    assert.deepEqual(worn(h, REN), [['it_ringc001', 'accessory-1'], ['it_ringd001', 'accessory-2']]);
    const next = h.run('inventory.equipOn', { stack: 'it_ringa001', actor: REN });
    assert.deepEqual(next.result.data.replaced, ['it_ringc001']);
});

test('the accessory count comes from items.slots, held to 0…3', () => {
    assert.deepEqual(MANY_SLOTS, { accessory: 2, worn: 1 });
    assert.equal(MAX_MANY, 3);
    const ask = answer => slotLimits(name => {
        if (name !== 'items.slots') throw new Error('no such query');
        return answer;
    });
    assert.deepEqual(ask({ accessory: 3 }), { accessory: 3, worn: 1 });
    assert.deepEqual(ask({ accessories: 9, worn: 2 }), { accessory: 3, worn: 2 });
    assert.deepEqual(ask({ accessory: -1 }), { accessory: 0, worn: 1 });
    assert.deepEqual(ask('nonsense'), MANY_SLOTS);
    assert.deepEqual(slotLimits(() => { throw new Error('none'); }), MANY_SLOTS);

    const three = harness({ queries: { 'items.slots': () => ({ accessory: 3 }) } });
    for (const id of ['it_ringa001', 'it_ringb001', 'it_ringc001']) assert.equal(three.run('inventory.equipOn', { stack: id, actor: REN }).ok, true);
    assert.equal(worn(three, REN).length, 3);
    const none = harness({ queries: { 'items.slots': () => ({ accessory: 0 }) } });
    const refused = none.run('inventory.equipOn', { stack: 'it_ringa001', actor: REN });
    assert.deepEqual([refused.ok, refused.code], [false, 'REFUSED']);
    assert.match(refused.message, /no accessories count/);
});

test('a two-handed weapon puts the off-hand away; an off-hand is refused while one is held', () => {
    const h = harness();
    assert.equal(h.run('inventory.equipOn', { stack: 'it_buck0001', actor: REN }).ok, true);
    const great = h.run('inventory.equipOn', { stack: 'it_grts0001', actor: REN });
    assert.equal(great.ok, true, great.message);
    assert.deepEqual(great.result.data.replacedNames, ['Buckler']);
    const buckler = h.run('inventory.equipOn', { stack: 'it_buck0001', actor: REN });
    assert.deepEqual([buckler.ok, buckler.code], [false, 'REFUSED']);
    assert.match(buckler.message, /Greatsword is two-handed/);
});

test('a piece someone else wears comes off them and goes to the new wearer', () => {
    const h = harness();
    const out = h.run('inventory.equipOn', { stack: 'it_oldh0001', actor: REN });
    assert.equal(out.ok, true, out.message);
    assert.equal(out.result.summary, 'Ren equips Old Helm from Mira (head).');
    assert.deepEqual(worn(h, MIRA), []);
    assert.deepEqual(worn(h, REN), [['it_oldh0001', 'head']]);
});

test('refusals keep everything as it was', () => {
    const h = harness({
        queries: {
            'items.canWear': (state, { actor, defId }) => (defId === 'story/iron-helm' && actor === REN ? { ok: false, message: 'Ren\'s head is too big for it.' } : { ok: true }),
            'items.carry': (state, args) => (args.owner === MIRA && args.add?.[0]?.defId === 'story/shortsword' ? { ok: false, message: 'Mira cannot carry that.' } : { ok: true }),
        },
    });
    const before = h.state;
    const cases = [
        [{ stack: 'it_rope0001', actor: REN }, 'REFUSED', /not equipment/],
        [{ stack: 'it_shor0001', actor: 'ac_nobody01' }, 'REFUSED', /not in the party/],
        [{ stack: 'it_shor0001', actor: 'party' }, 'INVALID', /which member/],
        [{ stack: 'it_shor0001' }, 'INVALID', /which member/],
        [{ stack: 'it_gone0001', actor: REN }, 'NOT_FOUND', /no longer in the inventory/],
        [{ stack: 'it_oldh0001', actor: MIRA }, 'REFUSED', /already wears Old Helm/],
        [{ stack: 'it_helm0001', actor: REN }, 'REFUSED', /too big/],
        [{ stack: 'it_shor0001', actor: MIRA }, 'REFUSED', /Mira cannot carry that/],
    ];
    for (const [payload, code, message] of cases) {
        const out = h.run('inventory.equipOn', payload);
        assert.deepEqual([out.ok, out.code], [false, code], JSON.stringify(payload));
        assert.match(out.message, message);
    }
    assert.equal(h.state, before, 'nothing saved');
    // A slot-less piece of equipment.
    const inv = structuredClone(h.state);
    inv.domains.inventory.defs['story/ring-a'].slot = null;
    h.state = inv;
    assert.match(h.run('inventory.equipOn', { stack: 'it_ringa001', actor: REN }).message, /no slot/);
});

test('inventory.equipment: who wears what, who may put each piece on, where Give may hand it', () => {
    const h = harness({ queries: { 'items.canWear': (state, { actor, defId }) => ({ ok: !(defId === 'story/greatsword' && actor === MIRA) }) } });
    const view = h.query('inventory.equipment');
    assert.deepEqual(view.members, [{ id: REN, name: 'Ren' }, { id: MIRA, name: 'Mira' }]);
    assert.deepEqual(view.worn.map(group => [group.id, group.name, group.items.map(item => [item.name, item.equipped, item.cond])]), [[MIRA, 'Mira', [['Old Helm', 'head', null]]]]);
    assert.deepEqual(view.wearers.it_grts0001, [{ id: REN, name: 'Ren' }], 'only those who can wear it');
    assert.deepEqual(view.wearers.it_oldh0001, [{ id: REN, name: 'Ren' }], 'not its wearer');
    assert.equal(view.wearers.it_rope0001, undefined, 'not equipment');
    assert.deepEqual(view.givers.it_rope0001.map(to => to.id), [REN, MIRA]);
    assert.deepEqual(view.givers.it_oldh0001.map(to => to.id), ['party', REN]);
    assert.deepEqual(view.limits, { accessory: 2, worn: 1 });
    assert.equal(view.detail, false);
    // What the shared bag wears is the main character's (RPG Battle's rule).
    const state = structuredClone(h.state);
    state.domains.inventory.stacks.it_sword001.equipped = 'hand';
    const shown = equipmentView(state, { query: (name, args) => h.query(name, args) });
    assert.deepEqual(shown.worn.map(group => [group.id, group.items.map(item => item.name)]), [[REN, ['Iron Sword']], [MIRA, ['Old Helm']]]);
    // RPG Battle's item detail query there: the screen draws its widget.
    const detail = createHarness([core(), { id: 'rpg-battle', queries: { 'rpg-battle.itemDetail': () => null } }]);
    assert.equal(detail.query('inventory.equipment').detail, true);
});

test('Give from the Inventory screen: a hand-over the taker cannot carry is refused', () => {
    const h = harness({ queries: { 'items.carry': (state, args) => (args.owner === MIRA ? { ok: false, message: 'Mira cannot carry that.' } : { ok: true }) } });
    const refused = h.run('inventory.transfer', { stack: 'it_rope0001', to: MIRA });
    assert.deepEqual([refused.ok, refused.message], [false, 'Mira cannot carry that.']);
    assert.equal(h.run('inventory.transfer', { stack: 'it_rope0001', to: REN }).ok, true);
    // A module's or the story's hand-over is not the reader's: not held here.
    assert.equal(h.run('inventory.transfer', { stack: 'it_lant0001', to: MIRA }, { cause: 'story' }).ok, true);
});
