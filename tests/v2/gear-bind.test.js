// Bound signature gear (`story-block.gear`, docs/v2/GEAR.md "Signature gear"): a cast member's pieces are marked `bound`, every path that would move
// or unequip one is refused ("Bound to Mara: Cane Sword stays with them."), wear and repair go on, the pieces leave with the member and come back once,
// replay is equal, and gear off knows nothing of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, hostAvailable } from '../../testkit/index.js';
import { validatePack } from '../../src/v2/packs/validate.js';
import { LEAN_RPG_TEMPLATES } from '../../src/v2/lean-rpg/templates.js';
import { pack } from './packs/helpers/fixtures.js';
import { createHarness } from './domains/helpers/fake-ctx.js';
import { core, stocked } from './domains/fixtures.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const reply = (...lines) => `The tide turns.\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const ITEMS = [
    { name: 'Cane Sword', kind: 'equipment', slot: 'weapon', rarity: 'uncommon' },
    { name: 'Oak Buckler', kind: 'equipment', slot: 'shield', rarity: 'common' },
    { name: 'Tin Ring', kind: 'equipment', slot: 'accessory', rarity: 'common' },
    { name: 'Rusty Spear', kind: 'equipment', slot: 'weapon', rarity: 'common' },
];
const MARA = { id: 'mara', name: 'Mara', aliases: [], about: 'Runs the night ferry.', look: 'Wiry.', start: { place: 'Docks', goal: 'Keep the ferry running.' }, gear: ['Cane Sword', 'Oak Buckler', 'Tin Ring'] };
const ACTORS = { id: 'zz-party', version: '0.0.0', queries: { 'party.actors': () => [{ id: 'ac_mara0001', name: 'Mara' }, { id: 'ac_wessel01', name: 'Wessel' }] } };
const BOUND = /^Bound to Mara: .+ stays with them\.$/;

async function world(t, { gear = true } = {}) {
    t.mock.method(console, 'warn', () => {});
    const raw = pack({ content: { items: ITEMS, cast: [MARA] } });
    const built = validatePack(raw);
    assert.equal(built.ok, true, JSON.stringify(built.errors));
    const host = await createHost({
        modules: [ACTORS],
        settings: { features: gear ? { 'story-block.gear': true, 'story-block.rpg': true } : { 'story-block.rpg': true }, modules: { 'story-block': { rpgJoin: 'auto', rpgFormula: 'classic' } },
            packs: [{ id: built.pack.id, version: built.pack.version, enabled: true, source: 'file', origin: 'test', pack: raw }] },
    });
    t.after(() => host.close());
    host.packId = built.pack.id;
    await host.send('Begin.', 'Opening.');
    const defs = Object.fromEntries(LEAN_RPG_TEMPLATES.filter(entry => ['character', 'skills'].includes(entry.definition.role)).map(entry => [entry.definition.role, structuredClone(entry.definition)]));
    defs.character.slug = 'wessel'; defs.character.name = 'Wessel'; defs.character.state.who.default = 'Wessel';
    defs.skills.slug = 'wessel-skills'; defs.skills.name = 'Wessel skills'; defs.skills.state.who.default = 'Wessel';
    for (const definition of [defs.character, defs.skills]) assert.equal((await host.sdk.command('dm.define', { definition })).ok, true);
    return host;
}
const rows = host => host.sdk.query('inventory.items');
const row = (host, name) => rows(host).find(item => item.name === name);
const stable = inv => ({ ...inv, stacks: Object.fromEntries(Object.entries(inv.stacks).map(([id, item]) => [id, { ...item, from: undefined }])) });
const bytes = host => JSON.stringify([stable(host.head().domains.inventory), host.sdk.query('inventory.items').map(item => ({ ...item, from: undefined }))]);
const refusedWith = async (host, command, payload) => {
    const before = bytes(host);
    const out = await host.sdk.command(command, payload);
    assert.equal(out.ok, false, `${command} should be refused`);
    assert.match(out.message ?? out.error?.message ?? JSON.stringify(out), /Bound to Mara: (Cane Sword|Oak Buckler|Tin Ring) stays with them\./);
    assert.equal(bytes(host), before, `${command} changed nothing`);
};
const joined = async host => host.send('Mara walks in.', reply('+ party Mara'));

test('a join marks the pieces bound to the member; the rows and gear.view carry bound: { who }', { skip }, async t => {
    const host = await world(t);
    await joined(host);
    for (const name of ['Cane Sword', 'Oak Buckler', 'Tin Ring']) assert.deepEqual(row(host, name).bound, { who: 'Mara' });
    const view = host.sdk.query('gear.view', { owner: 'ac_mara0001' });
    assert.deepEqual(view.rows[row(host, 'Cane Sword').stack].bound, { who: 'Mara' });
    assert.deepEqual(view.slots.weapon.bound, { who: 'Mara' });
    assert.equal(host.head().domains.inventory.stacks[row(host, 'Tin Ring').stack].bound, 'ac_mara0001');
});

test('every command that would move, unequip, drop, use up, edit, split or merge a bound piece is refused with the same sentence', { skip }, async t => {
    const host = await world(t);
    await joined(host);
    const sword = row(host, 'Cane Sword').stack, buckler = row(host, 'Oak Buckler').stack;
    await refusedWith(host, 'inventory.unequip', { stack: sword });
    await refusedWith(host, 'inventory.transfer', { stack: sword, to: 'ac_wessel01' });
    await refusedWith(host, 'inventory.transfer', { stack: sword, to: 'party' });
    await refusedWith(host, 'inventory.drop', { stack: sword });
    await refusedWith(host, 'inventory.consume', { stack: sword });
    await refusedWith(host, 'inventory.consume', { def: 'pack.mini/cane-sword' });
    await refusedWith(host, 'inventory.edit', { stack: sword, name: 'Mine Now' });
    await refusedWith(host, 'inventory.edit', { stack: sword, group: true, qty: 2 });
    await refusedWith(host, 'inventory.split', { stack: sword, qty: 1 });
    await refusedWith(host, 'inventory.merge', { stack: sword, into: buckler });
    await refusedWith(host, 'item.equip', { stack: sword, owner: 'ac_wessel01', slot: 'weapon' });
    await refusedWith(host, 'item.equip', { stack: sword, owner: 'ac_wessel01', slot: 'weapon', transfer: true });
    const ring = row(host, 'Tin Ring').stack;
    await refusedWith(host, 'inventory.equip', { stack: ring, slot: 'accessory-2' });
    // the Edit form's own command: another owner, another slot, or nothing
    await refusedWith(host, 'inventory.edit', { stack: buckler, name: 'My Buckler' });
});

test('putting something else in a bound piece\'s slot does not put the piece away', { skip }, async t => {
    const host = await world(t);
    await joined(host);
    await host.send('A spear.', reply('+ item Rusty Spear | kind: weapon'));
    const spear = row(host, 'Rusty Spear');
    assert.equal((await host.sdk.command('inventory.transfer', { stack: spear.stack, to: 'ac_mara0001' })).ok, true, 'an unbound piece moves as ever');
    await refusedWith(host, 'item.equip', { stack: spear.stack, owner: 'ac_mara0001', slot: 'weapon' });
    assert.equal(row(host, 'Cane Sword').equipped, 'weapon');
});

test('the narrator cannot take a bound piece away: - item, ~ item qty', { skip }, async t => {
    const host = await world(t);
    await joined(host);
    const before = bytes(host);
    await host.send('Thieves.', reply('- item Cane Sword', '~ item Oak Buckler | qty: 0'));
    assert.equal(bytes(host).replace(/"from":"[^"]*"/g, ''), before.replace(/"from":"[^"]*"/g, ''), 'nothing left');
    assert.equal(rows(host).length, 3);
    const text = JSON.stringify(host.turn.problems());
    assert.match(text, /Bound to Mara: Cane Sword stays with them\./);
    assert.match(text, /Bound to Mara: Oak Buckler stays with them\./);
});

test('wear and repair stay allowed on a bound piece (the story\'s words)', { skip }, async t => {
    const host = await world(t);
    await joined(host);
    await host.send('The blade is nicked.', reply('~ item Cane Sword | wear: tear'));
    const worn = row(host, 'Cane Sword').cond;
    assert.ok(worn < 100, 'worn down');
    await host.send('The smith mends it.', reply('~ item Cane Sword | repair: mend'));
    assert.ok(row(host, 'Cane Sword').cond === undefined || row(host, 'Cane Sword').cond > worn, 'mended');
    assert.deepEqual(row(host, 'Cane Sword').bound, { who: 'Mara' });
});

test('leaving takes the bound pieces out of the inventory; coming back brings them once, with their wear and slots (my choice: the condition is kept)', { skip }, async t => {
    const host = await world(t);
    await joined(host);
    await host.send('The blade is nicked.', reply('~ item Cane Sword | wear: tear'));
    const cond = row(host, 'Cane Sword').cond;
    await host.send('She goes.', reply('- party Mara'));
    assert.deepEqual(rows(host), [], 'nothing of hers in the bag');
    assert.deepEqual(Object.keys(host.head().domains.inventory.kept), ['ac_mara0001']);
    await host.send('She is back.', reply('+ party Mara'));
    assert.equal(rows(host).length, 3, 'once');
    assert.equal(row(host, 'Cane Sword').cond, cond, 'the wear she left with');
    assert.equal(row(host, 'Cane Sword').equipped, 'weapon');
    assert.deepEqual(row(host, 'Tin Ring').bound, { who: 'Mara' });
    assert.equal(host.head().domains.inventory.kept, undefined, 'the set-aside record is spent');
    await host.send('Again.', reply('- party Mara'));
    await host.send('Again back.', reply('+ party Mara'));
    assert.equal(rows(host).length, 3, 'still once');
});

test('replay equals live: rebuild, reload, Re-read, swipe and a middle delete', { skip }, async t => {
    const host = await world(t);
    await joined(host);
    await host.send('Some days pass.', reply('+ coin 2'));
    const middle = host.ctx.chat.length - 1;
    await host.send('She goes.', reply('- party Mara'));
    await host.send('She is back.', reply('+ party Mara'));
    const live = bytes(host);
    host.store.rebuild();
    assert.equal(bytes(host), live, 'rebuild');
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(bytes(host), live, 'reload');
    assert.equal((await host.turn.reread(host.ctx.chat.length - 1)).ok, true);
    assert.equal(bytes(host), live, 'Re-read');
    await host.swipe(reply('Nobody returns.', ['+ coin 1']));
    assert.deepEqual(rows(host), [], 'a swipe of the return: still away');
    assert.equal(Object.keys(host.head().domains.inventory.kept ?? {}).length, 1);
    await host.send('She is back.', reply('+ party Mara'));
    assert.equal(rows(host).length, 3);
    await host.st.deleteMessage(middle);
    assert.equal(rows(host).length, 3, 'a reply deleted from the middle: nothing doubled, nothing lost');
    assert.equal(row(host, 'Cane Sword').equipped, 'weapon');
    assert.deepEqual(host.store.problems(), []);
    const after = bytes(host);
    host.store.rebuild();
    assert.equal(bytes(host), after);
});

test('gear off: no bound mark anywhere, no kept record, and the commands act as in 2.17.0', { skip }, async t => {
    const host = await world(t, { gear: false });
    await joined(host);
    await host.send('She goes.', reply('- party Mara'));
    assert.deepEqual(rows(host), []);
    assert.doesNotMatch(JSON.stringify(host.head().domains.inventory), /bound|kept/);
    await host.send('A sword.', reply('+ item Cane Sword | kind: weapon'));
    assert.equal(rows(host).some(item => 'bound' in item), false);
    const out = await host.sdk.command('inventory.drop', { stack: row(host, 'Cane Sword').stack });
    assert.equal(out.ok, true);
});

// ---- review fixes: who may bind, stow and restore; nothing stuck in kept; the Edit form's note --------------------------------------------------

test('B1: inventory.grant { bound }, inventory.stow and inventory.restore are Story Block\'s own: an event, another module and a top-level call are refused', () => {
    const ON = { feature: () => true };
    const make = () => createHarness([core()], { state: stocked(core()) });
    for (const caller of ['event:curse', 'dm', 'zz-party', null]) {
        for (const cause of ['system', 'story']) {
            const h = make();
            const grant = h.run('inventory.grant', { def: 'pack.fantasy/iron-sword', qty: 500, owner: 'party', bound: true }, { cause, caller, extra: ON });
            assert.equal(grant.ok, false, `grant ${caller}/${cause}`);
            assert.equal(grant.code, 'REFUSED');
            for (const command of ['inventory.stow', 'inventory.restore']) {
                const out = h.run(command, { owner: 'ac_mara0001' }, { cause, caller, extra: ON });
                assert.equal(out.ok, false, `${command} ${caller}/${cause}`);
                assert.equal(out.code, 'REFUSED');
            }
        }
    }
    // Story Block's own call is let through (the join and the leave)
    assert.notEqual(make().run('inventory.stow', { owner: 'ac_mara0001' }, { cause: 'story', caller: 'story-block', extra: ON }).code, 'REFUSED');
});

test('B2: what a member left with comes back when the gear switch is off at their return', { skip }, async t => {
    const host = await world(t);
    await joined(host);
    await host.send('She goes.', reply('- party Mara'));
    host.features.set('story-block.gear', false);
    await host.send('She is back.', reply('+ party Mara'));
    assert.equal(rows(host).length, 3);
    assert.equal(host.head().domains.inventory.kept, undefined, 'nothing stuck');
    assert.equal(row(host, 'Cane Sword').equipped, 'weapon');
    assert.match(host.ctx.chat.at(-1).extra.storySuite.receipts.find(entry => entry.type === 'capture.party').summary, /is back in the party\. Gear: /);
});

test('B2: ... when the pack is disabled at their return', { skip }, async t => {
    const host = await world(t);
    await joined(host);
    await host.send('She goes.', reply('- party Mara'));
    assert.equal(await host.packs.packs.setEnabled(host.packId, false), true);
    await host.send('She is back.', reply('+ party Mara'));
    assert.equal(rows(host).length, 3);
    assert.equal(host.head().domains.inventory.kept, undefined);
});

test('B2: ... when the member was renamed while away', { skip }, async t => {
    const host = await world(t);
    await joined(host);
    await host.send('She goes.', reply('- party Mara'));
    assert.equal((await host.sdk.command('dm.set', { module: 'pack.chat/mara', fields: { who: 'Mara Vell' } })).ok, true);
    await host.send('She is back.', reply('+ party Mara Vell'));
    assert.equal(rows(host).length, 3);
    assert.equal(host.head().domains.inventory.kept, undefined);
    assert.deepEqual(row(host, 'Cane Sword').bound, { who: 'Mara' });
});

test('an Edit of a bound piece may change its note, never its name or count; the narrator\'s ~ item likewise (note: yes, name: no)', { skip }, async t => {
    const host = await world(t);
    await joined(host);
    const sword = row(host, 'Cane Sword').stack;
    assert.equal((await host.sdk.command('inventory.edit', { stack: sword, note: 'her father\'s' })).ok, true);
    assert.equal(row(host, 'Cane Sword').note, 'her father\'s');
    await refusedWith(host, 'inventory.edit', { stack: sword, name: 'Fine Sword' });
    await refusedWith(host, 'inventory.edit', { stack: sword, qty: 2 });
    await host.send('A note.', reply('~ item Cane Sword | note: sharpened'));
    assert.equal(row(host, 'Cane Sword').note, 'sharpened');
    await host.send('A rename.', reply('~ item Cane Sword | name: Fine Sword'));
    assert.equal(row(host, 'Cane Sword')?.name, 'Cane Sword');
    assert.match(JSON.stringify(host.turn.problems()), /Bound to Mara: Cane Sword stays with them\./);
});
