// Item definitions between Story Block and a ready rules module (RB_CONTRACT §3, P01; §10 E):
//   * `inventory.definitions` lists the definitions the chat holds, and nothing depends on a pack being installed;
//   * `inventory.registerDefinition` is the rules module's way to put one in, no stack, same bytes a no-op,
//     other bytes a CONFLICT;
//   * a definition that is new to the chat (story, pack hook or a module's full def) goes through the rules
//     module's `rules.registerItem` while one is ready, in the same transaction as the grant, so a failure
//     anywhere leaves neither the definition nor the rule.
// The rules module is a test-only stand-in (helpers/rb-stub.js); "alone" runs have none.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, line } from './helpers/fake-ctx.js';
import { core, def as defOf, stocked } from './fixtures.js';
import { DEFINITIONS_MAX_IDS, definitionsOf, defaultDef } from '../../../src/v2/domains/inventory.js';
import { hashOf } from '../../../src/v2/domains/digest.js';
import { createPacksPart } from '../../../src/v2/packs/index.js';
import { itemDefsIn } from '../../../src/v2/packs/content.js';
import { validatePack } from '../../../src/v2/packs/validate.js';
import { fakeSettings } from '../packs/helpers/fake-settings.js';
import { itemsPack, sampleText } from '../packs/helpers/fixtures.js';
import { REPLY, world } from './helpers/rb-world.js';

const write = 'wr_00000001';
const rope = state => state.domains.inventory.defs['story/rope'];
const register = (w, def, extra = {}) => w.command('test.define', { write, def, hash: hashOf(def), ...extra }, 'system');
const lamp = () => ({ ...defaultDef('craft/hooded-lamp', 'Hooded Lamp'), kind: 'goods', value: 12, tags: ['light'] });
const unchanged = (w, run) => {
    const before = w.head();
    const out = run();
    assert.equal(out.ok, false, 'it should be refused');
    assert.equal(w.head(), before, `nothing is stored on ${out.code}`);
    return out;
};

// ---------- inventory.definitions ----------

test('inventory.definitions: every definition, ID-sorted, copies; or just those asked for', () => {
    const module = core();
    const h = createHarness([module], { state: stocked(module) });
    const all = h.query('inventory.definitions');
    assert.deepEqual(all.map(item => item.id), ['pack.fantasy/dagger', 'pack.fantasy/iron-sword', 'pack.fantasy/potion', 'story/lantern', 'story/rope']);
    assert.deepEqual(all.find(item => item.id === 'story/rope'), { id: 'story/rope', name: 'Rope', kind: 'goods', rarity: 'common', value: 0, stack: true, slot: null, stats: {}, effect: {}, tags: [], note: '' });
    assert.deepEqual(h.query('inventory.definitions', {}), all);
    assert.deepEqual(h.query('inventory.definitions', { ids: ['story/rope', 'pack.fantasy/dagger', 'story/rope', 'story/none'] }).map(item => item.id), ['pack.fantasy/dagger', 'story/rope'], 'unknown left out, each once, sorted');
    assert.deepEqual(h.query('inventory.definitions', { ids: [] }), []);
    assert.equal(h.query('inventory.definitions', { ids: ['pack.fantasy/iron-sword'] })[0].slot, 'hand');
});

test('inventory.definitions: malformed arguments give [], never an error', () => {
    const module = core();
    const h = createHarness([module], { state: stocked(module) });
    for (const args of [{ ids: 'story/rope' }, { ids: [1] }, { ids: ['Story Rope'] }, { ids: ['story/rope', null] }, { ids: { 0: 'story/rope' } }, { ids: Array.from({ length: DEFINITIONS_MAX_IDS + 1 }, () => 'story/rope') }, 'story/rope', 7, [], ['story/rope']]) {
        assert.deepEqual(h.query('inventory.definitions', args), [], JSON.stringify(args).slice(0, 40));
    }
    assert.equal(h.query('inventory.definitions', null).length, 5, 'no arguments at all: everything');
    assert.deepEqual(definitionsOf(undefined, {}), []);
    assert.deepEqual(definitionsOf({ defs: { 'story/a': 5 } }, {}), [], 'a record that is not a def is not listed');
    const first = h.query('inventory.definitions');
    first[0].name = 'Changed';
    assert.notEqual(h.query('inventory.definitions')[0].name, 'Changed', 'a copy each time');
});

test('inventory.definitions: sees a transaction\'s own drafts, makes nothing', () => {
    const peek = { id: 'zz-peek', domains: {}, commands: { 'peek.add': ctx => {
        ctx.call('inventory.grant', { name: 'Moonveil Trout' });
        return { summary: 'ok', data: { ids: ctx.query('inventory.definitions', { ids: ['story/moonveil-trout'] }).map(item => item.id) }, narrate: false };
    } } };
    const w = world({ noRb: true, modules: [peek] });
    const out = w.command('peek.add', {}, 'system');
    assert.equal(out.ok, true, out.message);
    assert.deepEqual(out.receipt.data.ids, ['story/moonveil-trout']);
    const before = w.head();
    w.query('inventory.definitions');
    assert.equal(w.head(), before);
});

// ---------- inventory.registerDefinition ----------

test('registerDefinition: only the rules module\'s own nested call; no stack, no alias', () => {
    const w = world();
    const def = lamp();
    assert.equal(w.command('test.define', { write, def, hash: hashOf(def) }, 'system').ok, true);
    assert.deepEqual(w.inv().defs['craft/hooded-lamp'], def);
    assert.equal(Object.values(w.inv().stacks).some(stack => stack.def === 'craft/hooded-lamp'), false, 'no stack');
    assert.equal(w.inv().aliases['hooded lamp'], undefined, 'no alias: lookups find it by its own name');
    assert.equal(w.query('inventory.definitions', { ids: ['craft/hooded-lamp'] }).length, 1);
    const named = w.command('inventory.grant', { name: 'hooded lamp' }, 'system');
    assert.equal(named.ok, true, named.message);
    assert.equal(named.receipt.data.def, 'craft/hooded-lamp', 'the story\'s name finds it');

    const alone = world({ noRb: true });
    for (const [cause, options] of [['ui', {}], ['story', {}], ['system', {}]]) {
        const out = alone.command('inventory.registerDefinition', { write, def, hash: hashOf(def) }, cause, options);
        assert.deepEqual([out.ok, out.code], [false, 'REFUSED'], cause);
    }
    const third = { id: 'zz-third', domains: {}, commands: { 'third.define': ctx => ctx.call('inventory.registerDefinition', { write, def, hash: hashOf(def) }) } };
    const other = world({ noRb: true, modules: [third] });
    assert.equal(other.command('third.define', {}, 'system').code, 'REFUSED', 'another module cannot register');
    assert.equal(Object.hasOwn(other.inv().defs, 'craft/hooded-lamp'), false);
});

test('registerDefinition: a closed payload, a well-formed def, and the hash of exactly those bytes', () => {
    const w = world();
    const def = lamp();
    const good = { write, def, hash: hashOf(def) };
    const cases = {
        'a field it does not take': { ...good, grant: 1 },
        'no write ID': { ...good, write: undefined },
        'a write that is not an ID': { ...good, write: 'write-1' },
        'no hash': { ...good, hash: undefined },
        'a hash of other bytes': { ...good, hash: hashOf({ ...def, value: 13 }) },
        'an upper-case hash': { ...good, hash: good.hash.toUpperCase() },
        'no def': { ...good, def: undefined },
        'a def with a field it does not have': { ...good, def: { ...def, hands: 2 }, hash: hashOf({ ...def, hands: 2 }) },
        'an ID that is not a definition ID': { ...good, def: { ...def, id: 'Hooded Lamp' }, hash: hashOf({ ...def, id: 'Hooded Lamp' }) },
        'an unknown kind': { ...good, def: { ...def, kind: 'weapon' }, hash: hashOf({ ...def, kind: 'weapon' }) },
        'equipment that stacks': { ...good, def: { ...def, kind: 'equipment', stack: true }, hash: hashOf({ ...def, kind: 'equipment', stack: true }) },
        'a negative value': { ...good, def: { ...def, value: -1 }, hash: hashOf({ ...def, value: -1 }) },
        'stats that are not numbers': { ...good, def: { ...def, stats: { STR: '2' } }, hash: hashOf({ ...def, stats: { STR: '2' } }) },
        'a carry capacity on a craft item': { ...good, def: { ...def, carry: 5 }, hash: hashOf({ ...def, carry: 5 }) },
        'a name of 121 characters': { ...good, def: { ...def, name: 'n'.repeat(121) }, hash: hashOf({ ...def, name: 'n'.repeat(121) }) },
    };
    for (const [what, payload] of Object.entries(cases)) {
        const out = unchanged(w, () => w.command('test.define', payload, 'system'));
        assert.equal(out.code, 'INVALID', `${what}: ${out.message}`);
    }
    const pack = { ...defaultDef('pack.demo/pack-sack', 'Pack Sack'), carry: 5 };
    assert.equal(w.command('test.define', { write, def: pack, hash: hashOf(pack) }, 'system').ok, true, 'a pack\'s def may carry');
});

test('registerDefinition: the same ID with the same bytes is a no-op, other bytes a CONFLICT', () => {
    const w = world();
    const def = lamp();
    const first = register(w, def);
    assert.deepEqual(first.receipt.data, { def: 'craft/hooded-lamp', hash: hashOf(def), created: true });
    const again = register(w, def, { write: 'wr_00000002' });
    assert.equal(again.ok, true);
    assert.deepEqual(again.receipt.data, { def: 'craft/hooded-lamp', hash: hashOf(def), created: false });
    const before = w.head();
    const changed = { ...def, value: 13 };
    const conflict = register(w, changed);
    assert.deepEqual([conflict.ok, conflict.code], [false, 'CONFLICT']);
    assert.equal(w.head(), before, 'the definition is as it was');
    const renamed = register(w, { ...def, name: 'Hooded Lantern' });
    assert.equal(renamed.code, 'CONFLICT', 'even a name');
    // A definition the story made is just as fixed.
    const story = rope(w.head());
    assert.equal(register(w, story).receipt.data.created, false);
    assert.equal(register(w, { ...story, value: 1 }).code, 'CONFLICT');
});

// ---------- frozen pack definitions ----------

test('pack definitions the rules module froze stay after the pack is removed', async () => {
    const settings = fakeSettings();
    const { part, packs } = createPacksPart({ settings });
    assert.equal((await packs.install(sampleText)).ok, true);
    const defs = itemDefsIn(packs.packs());
    assert.equal(defs.length, 4);
    assert.deepEqual(defs.map(def => def.id), [...defs.map(def => def.id)].sort(), 'ID-sorted');
    assert.deepEqual(itemDefsIn(packs.packs(), ['pack.riverside-starter/willow-rod', 'pack.nobody/rod']).map(def => def.id), ['pack.riverside-starter/willow-rod']);
    assert.deepEqual(itemDefsIn(packs.packs(), []), [], 'an empty ask is an empty answer');
    itemDefsIn(packs.packs())[0].name = 'Changed';
    assert.notEqual(itemDefsIn(packs.packs())[0].name, 'Changed', 'copies');

    const w = world({ hooks: { 'item.resolve': [name => part.hooks['item.resolve'](name)] } });
    const activated = w.command('rules.activate', { defs }, 'system');
    assert.equal(activated.ok, true, activated.message);
    assert.deepEqual(activated.receipt.data.created, [true, true, true, true]);
    const stacksBefore = Object.keys(w.inv().stacks);
    assert.deepEqual(Object.keys(w.inv().stacks), stacksBefore, 'no stacks: the definitions are not materialised');
    const frozen = w.query('inventory.definitions', { ids: defs.map(def => def.id) });
    assert.deepEqual(frozen, defs);

    assert.equal(await packs.remove('riverside-starter'), true);
    assert.deepEqual(itemDefsIn(packs.packs()), [], 'the pack no longer offers them');
    assert.equal(part.hooks['item.resolve']('Willow Rod'), null);
    assert.deepEqual(w.query('inventory.definitions', { ids: defs.map(def => def.id) }), defs, 'the chat\'s own copies are untouched');

    // The story still means them: by name, with no pack and no new registration.
    const taken = w.capture(line('+', 'item', 'Willow Rod'));
    assert.equal(taken.ok, true, taken.message);
    assert.equal(taken.receipt.data.def, 'pack.riverside-starter/willow-rod');
    assert.equal(taken.receipt.data.created, false);
    assert.equal(w.stub.log.commands.includes('rules.registerItem'), false);
    assert.equal(activated.receipt.data.created.length, 4);
    const second = w.command('rules.activate', { defs }, 'system');
    assert.deepEqual(second.receipt.data.created, [false, false, false, false], 'a second activation changes nothing');
});

// ---------- generated definitions through rules.registerItem ----------

test('a generated grant registers its definition and its rule together, through the rules module', () => {
    const w = world({ hooks: { 'item.define': [() => ({ rarity: 'rare', value: 40 })] } });
    const out = w.capture(line('+', 'item', 'Moonveil Trout', { note: 'violet' }));
    assert.equal(out.ok, true, out.message);
    const stored = w.inv().defs['story/moonveil-trout'];
    assert.equal(stored.rarity, 'rare', 'the item.define hooks ran first');
    assert.deepEqual(Object.keys(w.rules()), ['story/moonveil-trout'], 'and the rule, in the same transaction');
    assert.equal(w.rules()['story/moonveil-trout'].from, 'story-block');
    assert.equal(w.stub.log.payloads.length, 1);
    const { caller, payload } = w.stub.log.payloads[0];
    assert.equal(caller, 'story-block');
    assert.deepEqual(Object.keys(payload).sort(), ['area', 'def', 'rule', 'rulesHash', 'template', 'write']);
    assert.match(payload.write, /^wr_[0-9a-f]{8}$/);
    assert.deepEqual(payload.def, stored);
    assert.deepEqual([payload.rule, payload.template, payload.area, payload.rulesHash], [null, null, null, null], 'what only the rules module can resolve is left to it');
    assert.equal(w.inv().aliases['moonveil trout'], 'story/moonveil-trout');
    assert.equal(Object.values(w.inv().stacks).filter(stack => stack.def === 'story/moonveil-trout').length, 1);
    // A second grant of the same thing registers nothing new.
    assert.equal(w.capture(line('+', 'item', 'Moonveil Trout')).ok, true);
    assert.equal(w.stub.log.payloads.length, 1);
});

test('every way a new definition comes in is routed: change line, grant by name, a full def, a pack\'s item', () => {
    const sunblade = { id: 'pack.demo/sunblade', name: 'Sunblade', kind: 'equipment', rarity: 'rare', value: 30, stack: false, slot: 'weapon', stats: { ATK: 3 }, effect: {}, tags: [], note: '' };
    const w = world({ hooks: { 'item.resolve': [name => (name === 'Sunblade' ? sunblade : null)] } });
    assert.equal(w.command('inventory.grant', { name: 'Copper Key' }, 'story').ok, true);
    const full = w.command('inventory.grant', { def: { id: 'craft/lockpick', name: 'Lockpick', value: 4, kind: 'goods' }, qty: 2 }, 'system');
    assert.equal(full.ok, true, full.message);
    assert.equal(w.capture(line('+', 'item', 'Sunblade')).ok, true);
    assert.deepEqual(Object.keys(w.rules()).sort(), ['craft/lockpick', 'pack.demo/sunblade', 'story/copper-key']);
    const byId = Object.fromEntries(w.stub.log.payloads.map(({ payload }) => [payload.def.id, payload]));
    assert.equal(byId['pack.demo/sunblade'].template, 'pack.demo/sunblade', 'a pack item names itself as its template');
    assert.equal(byId['story/copper-key'].template, null);
    assert.deepEqual(w.inv().defs['pack.demo/sunblade'], sunblade, 'a pack\'s def is taken as the pack wrote it');
    assert.equal(w.inv().defs['craft/lockpick'].value, 4);
    assert.equal(w.inv().aliases['sunblade'], 'pack.demo/sunblade');
});

test('the definition used is the one the rules module registered', () => {
    const w = world({ rb: { tweakDef: def => ({ ...def, rarity: 'uncommon', value: 5, stats: { luck: 1 } }) } });
    assert.equal(w.capture(line('+', 'item', 'Charm')).ok, true);
    assert.deepEqual([w.inv().defs['story/charm'].rarity, w.inv().defs['story/charm'].value, w.inv().defs['story/charm'].stats], ['uncommon', 5, { luck: 1 }]);
    const moved = world({ rb: { tweakDef: def => ({ ...def, id: 'story/other' }) } });
    const before = moved.head();
    const out = moved.capture(line('+', 'item', 'Charm'));
    assert.deepEqual([out.ok, out.code], [false, 'RULES_MISMATCH'], 'a different ID is not the item that was asked for');
    assert.equal(moved.head(), before);
});

test('a conflicting ID or bytes is refused and nothing is kept', () => {
    const w = world();
    const stored = rope(w.head());
    const ask = def => w.command('rules.registerItem', { write, def, rule: null, template: null, area: null, rulesHash: null }, 'system');
    const same = ask(stored);
    assert.equal(same.ok, true, same.message);
    assert.equal(same.receipt.data.created, false, 'the same bytes: found, not made');
    assert.deepEqual(Object.keys(w.rules()), ['story/rope'], 'a rule for a definition that already existed');
    const rulesBefore = JSON.stringify(w.rules());
    const before = w.head();
    const clash = ask({ ...stored, value: 99 });
    assert.deepEqual([clash.ok, clash.code], [false, 'CONFLICT']);
    assert.equal(w.head(), before, 'neither the definition nor the rule moved');
    assert.equal(JSON.stringify(w.rules()), rulesBefore);

    // A full def handed to inventory.grant for an ID the chat has: with a ready rules module it must be that
    // definition; alone, "an existing def with that ID wins", as ever.
    const grantAs = (world, def) => world.command('inventory.grant', { def, owner: 'party' }, 'system');
    const refused = grantAs(w, { id: 'story/rope', value: 99 });
    assert.deepEqual([refused.ok, refused.code], [false, 'CONFLICT']);
    assert.match(refused.message, /already defined, and not like this \(value\)/);
    assert.equal(w.head(), before);
    assert.equal(grantAs(w, { id: 'story/rope', name: 'Hemp Rope', value: 0, kind: 'goods', tags: [], stats: {} }).ok, true, 'the same rules (a name may differ) is the same definition');
    assert.equal(grantAs(w, { id: 'story/rope' }).ok, true);
    const equipment = grantAs(w, { id: 'pack.fantasy/dagger', stack: true });
    assert.equal(equipment.ok, true, 'equipment never stacks, whatever a caller wrote');
    const alone = world({ noRb: true });
    const quiet = grantAs(alone, { id: 'story/rope', value: 99 });
    assert.equal(quiet.ok, true, quiet.message);
    assert.equal(rope(alone.head()).value, 0, 'alone the existing def wins, unchanged');
});

test('a refused, failed or rolled-back grant leaves neither the definition nor the rule', () => {
    const clean = w => {
        assert.equal(w.head(), w.baseline, 'the whole state is as it was');
        assert.deepEqual(w.rules(), {});
    };
    // The rules module refuses after writing its rule.
    const refusing = world({ rb: { refuseRegister: 'No template for that.' } });
    refusing.baseline = refusing.head();
    const refused = refusing.capture(line('+', 'item', 'Moonveil Trout'));
    assert.deepEqual([refused.ok, refused.code], [false, 'RULES_MISMATCH']);
    clean(refusing);
    // It writes its rule and never registers the definition.
    const forgetful = world({ rb: { skipDefinition: true } });
    forgetful.baseline = forgetful.head();
    const lost = forgetful.capture(line('+', 'item', 'Moonveil Trout'));
    assert.deepEqual([lost.ok, lost.code], [false, 'RULES_MISMATCH']);
    clean(forgetful);
    // Story Block refuses after the rules module registered: a goods budget (the item is worth more than a
    // reply may give, even as its notable one).
    const dear = world({ settings: { storyCoinPerReply: 10 }, hooks: { 'item.define': [() => ({ value: 101 })] } });
    dear.baseline = dear.head();
    const over = dear.capture(line('+', 'item', 'Crown Jewel'));
    assert.deepEqual([over.ok, over.code], [false, 'REFUSED']);
    assert.match(over.message, /goods worth at most/);
    clean(dear);
    // A full-def grant that fails on its own count after the definition was registered.
    const many = world();
    many.baseline = many.head();
    const grant = many.command('inventory.grant', { def: { id: 'craft/lockpick', name: 'Lockpick', stack: false }, qty: 99 }, 'system');
    assert.deepEqual([grant.ok, grant.code], [false, 'INVALID']);
    clean(many);
    assert.equal(Object.hasOwn(many.inv().defs, 'craft/lockpick'), false);
});

test('a buy or a craft that fails after the item was registered takes the definition and the rule back', () => {
    const shop = { id: 'zz-shop', domains: {}, commands: { 'shop.buy'(ctx, payload) {
        const def = { ...defaultDef('trade/silver-comb', 'Silver Comb'), value: payload.price, tags: ['trade'] };
        ctx.call('rules.registerItem', { write, def, rule: null, template: null, area: null, rulesHash: null });
        ctx.call('wallet.pay', { owner: 'party', amount: payload.price, note: 'a comb' });
        return ctx.call('inventory.grant', { defId: def.id });
    } } };
    // A craft is the same shape: the item registered, then the materials taken, which the party does not have.
    const smith = { id: 'zz-smith', domains: {}, commands: { 'smith.craft'(ctx) {
        const def = { ...defaultDef('craft/rope-ladder', 'Rope Ladder'), tags: ['craft'] };
        ctx.call('rules.registerItem', { write, def, rule: null, template: null, area: null, rulesHash: null });
        ctx.call('inventory.consume', { def: 'story/rope', qty: 99 });
        return ctx.call('inventory.grant', { defId: def.id });
    } } };
    const forge = world({ modules: [smith] });
    const forgeBefore = forge.head();
    const short = forge.command('smith.craft', {}, 'ui');
    assert.deepEqual([short.ok, short.code], [false, 'NOT_ENOUGH']);
    assert.equal(forge.head(), forgeBefore);
    assert.deepEqual(forge.rules(), {});
    const poor = world({ modules: [shop] });
    const before = poor.head();
    const failed = poor.command('shop.buy', { price: 500 }, 'ui');
    assert.deepEqual([failed.ok, failed.code], [false, 'NOT_ENOUGH']);
    assert.equal(poor.head(), before);
    assert.deepEqual(poor.rules(), {});
    const paid = poor.command('shop.buy', { price: 50 }, 'ui');
    assert.equal(paid.ok, true, paid.message);
    assert.equal(poor.inv().wallets.party.coin, 75);
    assert.deepEqual(Object.keys(poor.rules()), ['trade/silver-comb']);
    assert.equal(Object.hasOwn(poor.inv().defs, 'trade/silver-comb'), true);
    assert.equal(Object.values(poor.inv().stacks).filter(stack => stack.def === 'trade/silver-comb').length, 1);
});

test('loot on offer registers nothing; taking it does, and a refused take leaves nothing', () => {
    let heavy = true;
    const carry = { id: 'zz-carry', domains: {}, commands: {}, queries: { 'items.carry': () => (heavy ? { ok: false, message: 'Too heavy to carry.' } : { ok: true }) } };
    const w = world({ modules: [carry] });
    const laid = w.capture(line('?', 'loot', 'Silver Spoon, Tin Cup', {}, 'on the shelf'));
    assert.equal(laid.ok, true, laid.message);
    assert.deepEqual(Object.keys(w.inv().defs).filter(id => id.startsWith('story/s') || id.startsWith('story/t')), [], 'no definition for what is only on offer');
    assert.deepEqual(w.rules(), {});
    assert.equal(w.stub.log.commands.length, 0, 'the rules module is not asked');
    const before = w.head();
    const refused = w.command('inventory.lootTake', { sid: REPLY.sid, pick: [0, 1] }, 'ui');
    assert.deepEqual([refused.ok, refused.code], [false, 'REFUSED']);
    assert.equal(w.head(), before, 'neither definitions nor rules, nor the claim');
    assert.deepEqual(w.rules(), {});
    heavy = false;
    const taken = w.command('inventory.lootTake', { sid: REPLY.sid, pick: [0, 1] }, 'ui');
    assert.equal(taken.ok, true, taken.message);
    assert.deepEqual(Object.keys(w.rules()).sort(), ['story/silver-spoon', 'story/tin-cup']);
});

// ---------- Story Block alone ----------

test('alone, a new definition is stored directly, exactly as before; a rules module without the route changes nothing', () => {
    const alone = world({ noRb: true, hooks: { 'item.define': [() => ({ rarity: 'rare' })] } });
    const noRoute = world({ rb: { omit: ['rules.registerItem'] }, hooks: { 'item.define': [() => ({ rarity: 'rare' })] } });
    for (const w of [alone, noRoute]) {
        assert.equal(w.capture(line('+', 'item', 'Moonveil Trout', { note: 'violet' })).ok, true);
        assert.equal(w.command('inventory.grant', { def: { id: 'craft/lockpick', name: 'Lockpick' } }, 'system').ok, true);
    }
    const strip = state => { const copy = JSON.parse(JSON.stringify(state)); delete copy.domains.rbrules; return copy; };
    assert.deepEqual(strip(noRoute.head()), strip(alone.head()));
    assert.deepEqual(alone.inv().defs['story/moonveil-trout'], { ...defOf('story/moonveil-trout', 'Moonveil Trout'), rarity: 'rare' });
    assert.equal(alone.inv().aliases['moonveil trout'], 'story/moonveil-trout');
    assert.equal(alone.inv().aliases['lockpick'], 'craft/lockpick');
    assert.deepEqual(alone.query('inventory.definitions', { ids: ['craft/lockpick'] }).map(item => item.name), ['Lockpick']);
});

test('validatePack\'s items are exactly the defs a rules module would freeze', () => {
    const result = validatePack(itemsPack('forge', [{ name: 'Iron Sword', kind: 'equipment', slot: 'weapon', value: 40, carry: 3 }, { name: 'Rope' }]));
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const defs = itemDefsIn([result.pack]);
    assert.deepEqual(defs.map(def => def.id), ['pack.forge/iron-sword', 'pack.forge/rope']);
    const w = world();
    assert.equal(w.command('rules.activate', { defs }, 'system').ok, true, 'each passes the shape check, carry on a pack def included');
    assert.equal(w.inv().defs['pack.forge/iron-sword'].carry, 3);
});
