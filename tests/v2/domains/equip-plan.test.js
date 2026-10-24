// Equipment through the rules module's plan (RB_CONTRACT §3, P07; §10 E): while a rules module answers
// `rules.equipPlan`, inventory.equip and inventory.equipOn (and so its own item.equip) wear nothing without a
// plan that Story Block asked for inside the transaction and checked against its own records. A direct equip
// cannot bypass the rules, a plan from a caller or a forged answer is refused, nothing loops back into the
// module, an out-of-date plan is STALE, and two-handed / off-hand / swap / accessory slots are applied as
// planned. Without such a module equipment is stored as it always was. The module is a test-only stand-in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EQUIP_SLOTS, equipInputHash } from '../../../src/v2/domains/inventory.js';
import { def, stack } from './fixtures.js';
import { MIRA, REN, world } from './helpers/rb-world.js';
import { RULES_HASH, STATS } from './helpers/rb-stub.js';

const gear = state => {
    const inv = state.domains.inventory;
    const add = (id, name, fields) => {
        inv.defs[id] = def(id, name, { kind: 'equipment', stack: false, ...fields });
        inv.aliases[name.toLowerCase()] = id;
    };
    add('story/iron-helm', 'Iron Helm', { slot: 'head' });
    add('story/old-helm', 'Old Helm', { slot: 'head' });
    for (const letter of 'abcd') add(`story/ring-${letter}`, `Ring ${letter.toUpperCase()}`, { slot: 'accessory' });
    add('story/buckler', 'Buckler', { slot: 'offhand' });
    add('story/greatsword', 'Greatsword', { slot: 'weapon', tags: ['two-handed'] });
    add('story/shortsword', 'Shortsword', { slot: 'weapon' });
    add('story/spear', 'Spear', { slot: 'weapon' });
    add('story/longsword', 'Longsword', { slot: 'weapon', stats: { reqSTR: 12 } });
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
        it_spea0001: stack('it_spea0001', 'story/spear', 1),
        it_long0001: stack('it_long0001', 'story/longsword', 1, { owner: REN }),
    });
};
const arm = (options = {}) => world({ edit: gear, ...options });
const stacks = w => w.inv().stacks;
const worn = (w, owner) => Object.values(stacks(w)).filter(item => item.owner === owner && item.equipped !== null).map(item => [item.id, item.equipped]).sort();
const equipOn = (w, id, actor, extra = {}) => w.command('inventory.equipOn', { stack: id, actor, ...extra }, 'ui');
const planFor = (w, id, actor, targetSlot) => w.query('rules.equipPlan', { stack: id, actor, ...(targetSlot ? { targetSlot } : {}) });
const refusedAs = (w, run, code) => {
    const before = w.head();
    const out = run();
    assert.deepEqual([out.ok, out.code], [false, code], out.message);
    assert.equal(w.head(), before, 'nothing changed');
    return out;
};

// ---------- with no planner: as it always was ----------

test('alone, or beside a rules module with no planner, equipment is stored as it always was', () => {
    const run = w => {
        const out = [];
        out.push(w.command('inventory.equip', { stack: 'it_long0001' }, 'ui'));
        out.push(equipOn(w, 'it_shor0001', MIRA));
        out.push(equipOn(w, 'it_ringa001', REN, { targetSlot: 'accessory-2' }));
        out.push(w.command('inventory.equip', { stack: 'it_helm0001', slot: 'body', plan: { forged: true }, bypass: true }, 'ui'));
        return out;
    };
    const alone = arm({ noRb: true });
    const beside = arm({ rb: { omit: ['rules.equipPlan'] } });
    const a = run(alone);
    const b = run(beside);
    for (const out of [...a, ...b]) assert.equal(out.ok, true, out.message);
    assert.deepEqual(a.map(out => out.receipt.data), b.map(out => out.receipt.data));
    assert.deepEqual([stacks(alone).it_long0001.equipped, stacks(alone).it_shor0001.equipped, stacks(alone).it_ringa001.equipped, stacks(alone).it_helm0001.equipped], ['weapon', 'weapon', 'accessory-1', 'body']);
    assert.equal(a[2].receipt.data.targetSlot, undefined, 'targetSlot is only the rules\' to use');
    assert.deepEqual(stacks(beside).it_shor0001, stacks(alone).it_shor0001);
    assert.equal(beside.stub.log.queries.includes('rules.sheet'), false, 'nothing is asked without a planner');
    assert.equal(a[3].receipt.data.slot, 'body', 'the old free-form slot, stored as given');
});

// ---------- a direct equip cannot bypass the rules ----------

test('a direct equip, an Equip on… and the rules module\'s own item.equip all go through the plan', () => {
    const w = arm();
    const alone = arm({ noRb: true });
    assert.equal(alone.command('inventory.equip', { stack: 'it_long0001' }, 'ui').ok, true, 'what the old direct equip allowed');
    for (const run of [
        () => w.command('inventory.equip', { stack: 'it_long0001' }, 'ui'),
        () => equipOn(w, 'it_long0001', REN),
        () => w.command('item.equip', { stack: 'it_long0001', actor: REN }, 'ui'),
        () => w.command('inventory.equip', { stack: 'it_long0001' }, 'system'),
        () => w.command('inventory.equip', { stack: 'it_long0001' }, 'story'),
    ]) {
        const out = refusedAs(w, run, 'REFUSED');
        assert.match(out.message, /Longsword needs STR 12/);
    }
    w.stub.options.stats = { ...STATS, STR: 12 };
    const fits = w.command('inventory.equip', { stack: 'it_long0001' }, 'ui');
    assert.equal(fits.ok, true, fits.message);
    assert.equal(stacks(w).it_long0001.equipped, 'weapon');
});

test('the free-form slot of the old direct equip no longer reaches the planner\'s pieces', () => {
    const w = arm();
    w.stub.options.stats = { ...STATS, STR: 12 };
    assert.equal(arm({ noRb: true }).command('inventory.equip', { stack: 'it_long0001', slot: 'head' }, 'ui').ok, true, 'alone it is stored where it is told');
    const out = refusedAs(w, () => w.command('inventory.equip', { stack: 'it_long0001', slot: 'head' }, 'ui'), 'REFUSED');
    assert.match(out.message, /does not go in head/);
    assert.equal(refusedAs(w, () => w.command('inventory.equip', { stack: 'it_long0001', slot: 'hand' }, 'ui'), 'INVALID').ok, false, 'not one of the eight slots');
    assert.equal(refusedAs(w, () => w.command('inventory.equip', { stack: 'it_long0001', targetSlot: 5 }, 'ui'), 'INVALID').ok, false, 'not text');
    assert.equal(refusedAs(w, () => w.command('inventory.equip', { stack: 'it_long0001', slot: 'weapon', targetSlot: 'offhand' }, 'ui'), 'INVALID').ok, false, 'two different slots');
    const ok = w.command('inventory.equip', { stack: 'it_long0001', slot: 'offhand' }, 'ui');
    assert.equal(ok.ok, true, ok.message);
    assert.equal(ok.receipt.data.slot, 'offhand');
    assert.equal(ok.receipt.data.targetSlot, 'offhand');
});

test('a piece in the party\'s bag is worn through Equip on… with someone named; non-equipment never', () => {
    const w = arm();
    const out = refusedAs(w, () => w.command('inventory.equip', { stack: 'it_helm0001' }, 'ui'), 'REFUSED');
    assert.match(out.message, /in the party's bag: choose who puts it on/);
    assert.match(refusedAs(w, () => w.command('inventory.equip', { stack: 'it_rope0001' }, 'ui'), 'REFUSED').message, /not equipment/);
    assert.match(refusedAs(w, () => equipOn(w, 'it_rope0001', REN), 'REFUSED').message, /not equipment/);
    assert.equal(refusedAs(w, () => equipOn(w, 'it_helm0001', 'ac_nobody01'), 'REFUSED').ok, false);
    assert.equal(refusedAs(w, () => equipOn(w, 'it_helm0001', 'party'), 'INVALID').ok, false);
    assert.equal(refusedAs(w, () => w.command('inventory.equip', { stack: 'it_nope0001' }, 'ui'), 'NOT_FOUND').ok, false);
});

// ---------- a plan cannot be supplied or forged ----------

test('a caller cannot hand in a plan, a token or a way round one', () => {
    const w = arm();
    const plan = planFor(w, 'it_helm0001', REN).plan;
    for (const claim of [{ plan }, { token: 'ok' }, { bypass: true }, { trusted: true }, { force: true }, { skipRules: true }, { rules: 'off' }, { rulesHash: RULES_HASH }, { inputHash: plan.inputHash }, { unequip: [] }, { move: [] }]) {
        const out = refusedAs(w, () => equipOn(w, 'it_helm0001', REN, claim), 'INVALID');
        assert.match(out.message, /planned by the rules, not by the caller/);
        refusedAs(w, () => w.command('inventory.equip', { stack: 'it_long0001', ...claim }, 'ui'), 'INVALID');
    }
    assert.equal(equipOn(w, 'it_helm0001', REN).ok, true, 'the same call without it');
});

test('a forged or malformed answer to the plan query is refused', () => {
    const w = arm();
    const good = planFor(w, 'it_helm0001', REN);
    const mutate = (change) => {
        const copy = JSON.parse(JSON.stringify(good));
        change(copy.plan, copy);
        return copy;
    };
    const try_ = (answer, code) => {
        w.stub.options.fixedPlan = answer;
        const out = refusedAs(w, () => equipOn(w, 'it_helm0001', REN), code);
        delete w.stub.options.fixedPlan;
        return out;
    };
    const hex = 'b'.repeat(64);
    // Not a plan at all, or not for this piece and wearer, or not made of the right parts.
    try_({ ok: true, plan: { ...good.plan, inputHash: hex } }, 'STALE');
    try_({ ok: true, plan: { ...good.plan, rulesHash: hex } }, 'STALE');
    for (const [what, answer] of Object.entries({
        'a string': 'yes',
        'a list': [],
        'an empty record': {},
        'ok without a plan': { ok: true },
        'ok as text': { ok: 'true', plan: good.plan },
        'another wearer': mutate(plan => { plan.actor = MIRA; }),
        'another piece': mutate(plan => { plan.stack = 'it_ringa001'; }),
        'another definition': mutate(plan => { plan.def = 'story/old-helm'; }),
        'a slot it is not': mutate(plan => { plan.slot = 'hand'; }),
        'a field too many': mutate(plan => { plan.extra = 1; }),
        'a field missing': mutate(plan => { delete plan.move; }),
        'no input hash': mutate(plan => { plan.inputHash = 'abc'; }),
        'a rules hash in capitals': mutate(plan => { plan.rulesHash = RULES_HASH.toUpperCase(); }),
        'unequip not a list': mutate(plan => { plan.unequip = 'it_oldh0001'; }),
        'unequip with the piece itself': mutate(plan => { plan.unequip = ['it_helm0001']; }),
        'unequip with a repeat': mutate(plan => { plan.unequip = ['it_oldh0001', 'it_oldh0001']; }),
        'unequip with an ID that is not one': mutate(plan => { plan.unequip = ['old helm']; }),
        'a move of a piece it has nothing to do with': mutate(plan => { plan.move.push({ stack: 'it_ringa001', from: 'party', to: REN }); }),
        'a move to nobody': mutate(plan => { plan.move[0].to = 'ac_nobody01'; }),
        'a move to another member': mutate(plan => { plan.move[0].to = MIRA; }),
        'a move from itself to itself': mutate(plan => { plan.move[0] = { stack: 'it_helm0001', from: REN, to: REN }; }),
        'a move twice': mutate(plan => { plan.move.push({ ...plan.move[0] }); }),
        'a move with a field too many': mutate(plan => { plan.move[0].why = 'x'; }),
        'no move of the piece to its wearer': mutate(plan => { plan.move = []; }),
    })) {
        const out = try_(answer, 'RULES_MISMATCH');
        assert.match(out.message, /does not fit/, what);
    }
    // Records that moved on since: a piece it takes off is not worn by them, a piece changed hands.
    try_(mutate(plan => { plan.unequip = ['it_ringa001']; }), 'STALE');
    try_(mutate(plan => { plan.unequip = ['it_nope0001']; }), 'STALE');
    try_(mutate(plan => { plan.move[0].from = MIRA; }), 'STALE');
    // A plan that leaves two pieces in one slot.
    stacks(w);
    const crowded = arm();
    equipOn(crowded, 'it_helm0001', REN);
    const spare = planFor(crowded, 'it_oldh0001', REN);
    const two = JSON.parse(JSON.stringify(spare));
    two.plan.unequip = [];
    crowded.stub.options.fixedPlan = two;
    refusedAs(crowded, () => equipOn(crowded, 'it_oldh0001', REN), 'RULES_MISMATCH');
});

test('what the rules module says instead of a plan is carried, closed and unchanged', () => {
    const w = arm();
    const ask = (planAnswer) => {
        w.stub.options.planAnswer = planAnswer;
        return w.stub.options;
    };
    const as = (answer, code) => {
        ask(answer);
        const out = refusedAs(w, () => equipOn(w, 'it_helm0001', REN), code);
        return out;
    };
    assert.match(as({ ok: false, code: 'REFUSED', message: 'Not while the guard watches.' }, 'REFUSED').message, /Not while the guard watches\. Nothing was changed\./);
    as({ ok: false, code: 'NOT_FOUND', message: 'No such wearer.' }, 'NOT_FOUND');
    as({ ok: false, code: 'weird', message: 'Odd.' }, 'REFUSED');
    as({ ok: false }, 'REFUSED');
    as({ ok: false, code: 'STALE', message: 'Moved on.' }, 'STALE');
    as(null, 'DEPENDENCY_UNAVAILABLE');
    as(() => { throw Object.assign(new Error('Rules are not ready.'), { code: 'RESTORE_PENDING' }); }, 'RESTORE_PENDING');
    as(() => { throw new Error('boom'); }, 'DEPENDENCY_UNAVAILABLE');
    as(() => { throw Object.assign(new Error('what'), { code: 'MADE_UP' }); }, 'DEPENDENCY_UNAVAILABLE');
    delete w.stub.options.planAnswer;
    w.stub.options.noSheet = true;
    const blind = refusedAs(w, () => equipOn(w, 'it_helm0001', REN), 'DEPENDENCY_UNAVAILABLE');
    assert.match(blind.message, /could not give the wearer's stats/);
});

// ---------- no recursion into the rules module ----------

test('the rules module is asked for one plan and never told to equip: no item.equip call, no loop', () => {
    const w = arm();
    const via = w.command('item.equip', { stack: 'it_helm0001', actor: REN, targetSlot: 'head' }, 'ui');
    assert.equal(via.ok, true, via.message);
    assert.deepEqual(w.stub.log.commands, ['item.equip'], 'only the module\'s own command ran');
    assert.equal(w.stub.log.queries.filter(name => name === 'rules.equipPlan').length, 1, 'one plan for one equip');
    assert.equal(stacks(w).it_helm0001.equipped, 'head');
    w.stub.log.commands.length = 0;
    w.stub.log.queries.length = 0;
    assert.equal(w.command('inventory.equip', { stack: 'it_oldh0001' }, 'ui').ok, false, 'already worn');
    assert.equal(w.command('inventory.equip', { stack: 'it_spea0001' }, 'ui').ok, false, 'in the party\'s bag');
    assert.equal(equipOn(w, 'it_spea0001', MIRA).ok, true);
    assert.deepEqual(w.stub.log.commands, [], 'a direct equip and an Equip on… never call the rules module\'s item.equip');
    assert.equal(w.stub.log.queries.filter(name => name === 'rules.equipPlan').length, 3, 'one plan each: a direct equip of a bag piece only learns that rules are ready, and uses no answer');
});

// ---------- stale plans ----------

test('a plan whose owner or stats changed since it was made is STALE', () => {
    const fresh = () => arm();
    // Made for the bag's helm going to Ren; then the helm changes hands.
    let w = fresh();
    let plan = planFor(w, 'it_helm0001', REN);
    assert.equal(w.command('inventory.transfer', { stack: 'it_helm0001', to: MIRA }, 'system').ok, true);
    w.stub.options.fixedPlan = plan;
    refusedAs(w, () => equipOn(w, 'it_helm0001', REN), 'STALE');
    // The wearer's stats change.
    w = fresh();
    plan = planFor(w, 'it_helm0001', REN);
    w.stub.options.stats = { ...STATS, STR: 9 };
    w.stub.options.fixedPlan = plan;
    refusedAs(w, () => equipOn(w, 'it_helm0001', REN), 'STALE');
    // Their life changes.
    w = fresh();
    plan = planFor(w, 'it_helm0001', REN);
    w.stub.options.life = 'downed';
    w.stub.options.fixedPlan = plan;
    refusedAs(w, () => equipOn(w, 'it_helm0001', REN), 'STALE');
    // The piece is worn somewhere else in the meantime.
    w = fresh();
    plan = planFor(w, 'it_helm0001', REN);
    equipOn(w, 'it_helm0001', MIRA);
    w.stub.options.fixedPlan = plan;
    refusedAs(w, () => equipOn(w, 'it_helm0001', REN), 'STALE');
    // What the plan would take off is no longer worn.
    w = fresh();
    plan = planFor(w, 'it_helm0001', MIRA);
    assert.deepEqual(plan.plan.unequip, ['it_oldh0001']);
    w.command('inventory.unequip', { stack: 'it_oldh0001' }, 'ui');
    w.stub.options.fixedPlan = plan;
    refusedAs(w, () => equipOn(w, 'it_helm0001', MIRA), 'STALE');
    // A plan made for another request (a slot was asked for) is not this one's.
    w = fresh();
    plan = planFor(w, 'it_ringa001', REN, 'accessory-2');
    w.stub.options.fixedPlan = plan;
    refusedAs(w, () => equipOn(w, 'it_ringa001', REN), 'STALE');
    refusedAs(w, () => equipOn(w, 'it_ringa001', REN, { targetSlot: 'accessory-1' }), 'RULES_MISMATCH');
    // Asked afresh, the same changes are simply planned for.
    w = fresh();
    w.stub.options.stats = { ...STATS, STR: 9 };
    assert.equal(equipOn(w, 'it_helm0001', REN).ok, true);
});

test('the inputHash Story Block checks is the Hash of exactly these inputs', () => {
    const input = {
        rulesHash: RULES_HASH, actor: REN, stats: { STR: 8, VIT: 9 }, life: 'alive', targetSlot: null,
        stack: { id: 'it_helm0001', def: 'story/iron-helm', qty: 1, owner: 'party', equipped: null, note: 'not part of it', from: 'rc_1' },
        affected: [{ id: 'it_oldh0001', def: 'story/old-helm', qty: 1, owner: MIRA, equipped: 'head', cond: 40 }, { id: 'it_helm0001', def: 'x', qty: 1, owner: 'party', equipped: null }],
    };
    const text = '{"actor":{"id":"ac_ren00001","life":"alive","stats":{"STR":8,"VIT":9}},"affected":[{"def":"story/old-helm","equipped":"head","id":"it_oldh0001","owner":"ac_mira0001","qty":1}],'
        + `"rulesHash":"${RULES_HASH}","slot":null,"stack":{"def":"story/iron-helm","equipped":null,"id":"it_helm0001","owner":"party","qty":1}}`;
    assert.equal(equipInputHash(input), createHash('sha256').update(text).digest('hex'));
    assert.notEqual(equipInputHash({ ...input, targetSlot: 'head' }), equipInputHash(input));
    assert.notEqual(equipInputHash({ ...input, life: 'downed' }), equipInputHash(input));
    assert.equal(equipInputHash({ ...input, affected: [...input.affected].reverse() }), equipInputHash(input), 'the affected pieces are by ID');
    assert.equal(equipInputHash({ ...input, stack: { ...input.stack, note: 'other', cond: 3 } }), equipInputHash(input), 'only where a piece is counts');
    assert.deepEqual(EQUIP_SLOTS, ['weapon', 'offhand', 'head', 'body', 'legs', 'feet', 'accessory-1', 'accessory-2']);
});

// ---------- two-handed, off-hand, swap, accessories ----------

test('a two-handed weapon puts the off-hand away; an off-hand is refused while one is held', () => {
    const w = arm();
    assert.equal(equipOn(w, 'it_buck0001', REN).receipt.data.slot, 'offhand');
    const great = equipOn(w, 'it_grts0001', REN);
    assert.equal(great.ok, true, great.message);
    assert.equal(great.receipt.summary, 'Ren equips Greatsword from the party (weapon); Buckler goes back into Ren\'s pack.');
    assert.deepEqual(great.receipt.data, { stack: 'it_grts0001', def: 'story/greatsword', actor: REN, from: 'party', slot: 'weapon', replaced: ['it_buck0001'], replacedNames: ['Buckler'] });
    assert.deepEqual([stacks(w).it_buck0001.owner, stacks(w).it_buck0001.equipped], [REN, null]);
    assert.deepEqual(worn(w, REN), [['it_grts0001', 'weapon']]);
    const out = refusedAs(w, () => equipOn(w, 'it_buck0001', REN), 'REFUSED');
    assert.match(out.message, /Greatsword is two-handed/);
    // Taking the greatsword off, the off-hand is free again.
    assert.equal(w.command('inventory.unequip', { stack: 'it_grts0001' }, 'ui').ok, true);
    assert.equal(equipOn(w, 'it_buck0001', REN).ok, true);
});

test('a swap: the piece in the slot comes off into its wearer\'s pack, in one receipt', () => {
    const w = arm();
    assert.equal(equipOn(w, 'it_shor0001', REN).ok, true);
    const swap = equipOn(w, 'it_spea0001', REN);
    assert.equal(swap.ok, true, swap.message);
    assert.deepEqual(swap.receipt.data.replaced, ['it_shor0001']);
    assert.deepEqual([stacks(w).it_shor0001.owner, stacks(w).it_shor0001.equipped, stacks(w).it_spea0001.equipped], [REN, null, 'weapon']);
    // A direct equip of a member's own piece swaps the same way and says so.
    const direct = w.command('inventory.equip', { stack: 'it_shor0001' }, 'ui');
    assert.equal(direct.ok, true, direct.message);
    assert.equal(direct.receipt.summary, 'Ren equips Shortsword (weapon), putting away Spear.');
    assert.deepEqual(direct.receipt.data, { stack: 'it_shor0001', def: 'story/shortsword', slot: 'weapon', replaced: 'it_spea0001' });
    assert.match(refusedAs(w, () => w.command('inventory.equip', { stack: 'it_shor0001' }, 'ui'), 'REFUSED').message, /already equipped/);
    // A piece the party's bag lends to the main character comes off the bag's record into theirs.
    const w2 = arm({ edit: state => { gear(state); Object.assign(state.domains.inventory.stacks.it_helm0001, { equipped: 'head' }); } });
    assert.deepEqual(worn(w2, 'party'), [['it_helm0001', 'head']]);
    const lent = equipOn(w2, 'it_oldh0001', REN);
    assert.equal(lent.ok, true, lent.message);
    assert.deepEqual([stacks(w2).it_helm0001.owner, stacks(w2).it_helm0001.equipped, stacks(w2).it_oldh0001.owner, stacks(w2).it_oldh0001.equipped], [REN, null, REN, 'head']);
    assert.deepEqual(worn(w2, MIRA), [], 'and what Mira wore comes off her');
});

test('accessories: the first free ring slot, then an explicit first-slot swap; targetSlot chooses', () => {
    const w = arm();
    assert.equal(equipOn(w, 'it_ringa001', REN).receipt.data.slot, 'accessory-1');
    assert.equal(equipOn(w, 'it_ringb001', REN).receipt.data.slot, 'accessory-2');
    const third = equipOn(w, 'it_ringc001', REN);
    assert.equal(third.ok, true, third.message);
    assert.deepEqual([third.receipt.data.slot, third.receipt.data.replaced], ['accessory-1', ['it_ringa001']]);
    const chosen = equipOn(w, 'it_ringd001', REN, { targetSlot: 'accessory-2' });
    assert.deepEqual([chosen.receipt.data.slot, chosen.receipt.data.replaced, chosen.receipt.data.targetSlot], ['accessory-2', ['it_ringb001'], 'accessory-2']);
    assert.deepEqual(worn(w, REN), [['it_ringc001', 'accessory-1'], ['it_ringd001', 'accessory-2']]);
    assert.match(refusedAs(w, () => equipOn(w, 'it_helm0001', REN, { targetSlot: 'accessory-1' }), 'REFUSED').message, /does not go in accessory-1/);
});

test('a hand-over follows the carry limit, and a piece someone else wears comes off them', () => {
    let full = true;
    const carry = { id: 'zz-carry', domains: {}, commands: {}, queries: { 'items.carry': () => (full ? { ok: false, message: 'Ren cannot carry more.' } : { ok: true }) } };
    const w = arm({ modules: [carry] });
    const out = refusedAs(w, () => equipOn(w, 'it_helm0001', REN), 'REFUSED');
    assert.match(out.message, /Ren cannot carry more/);
    full = false;
    assert.equal(equipOn(w, 'it_helm0001', REN).ok, true);
    const taken = equipOn(w, 'it_oldh0001', REN);
    assert.equal(taken.ok, true, taken.message);
    assert.equal(taken.receipt.summary, 'Ren equips Old Helm from Mira (head); Iron Helm goes back into Ren\'s pack.');
    assert.deepEqual(worn(w, MIRA), []);
    assert.deepEqual(worn(w, REN), [['it_oldh0001', 'head']]);
});

test('the stored state stays valid after every plan (the bus checks each domain)', () => {
    const w = arm();
    for (const [id, actor, extra] of [['it_buck0001', REN], ['it_grts0001', REN], ['it_helm0001', MIRA], ['it_ringa001', MIRA], ['it_ringb001', MIRA], ['it_ringc001', MIRA, { targetSlot: 'accessory-2' }]]) {
        const out = equipOn(w, id, actor, extra);
        assert.equal(out.ok, true, `${id}: ${out.message}`);
    }
    const slots = Object.values(stacks(w)).filter(item => item.equipped !== null).map(item => `${item.owner}/${item.equipped}`);
    assert.equal(new Set(slots).size, slots.length, 'one piece to a slot');
});
