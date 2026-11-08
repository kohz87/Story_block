// The reader-only carry value of an item (`inventory.carry`, 0-500, Gear in fights on): the reader sets what a story Sling Bag adds,
// 0 removes it, 501 is refused, and no story line or module call can set or raise it. Replay, a rebuild, a reload and a Re-read keep it;
// the carry line lists what each item and mount adds; the Edit form of the reader's own piece has the field.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { createHarness, line } from './domains/helpers/fake-ctx.js';
import { core, def, stack, stocked } from './domains/fixtures.js';
import { createCoreModule } from '../../src/v2/domains/index.js';
import { editFields, editPlan } from '../../src/v2/view/gear-form.js';

const ON = { extra: { feature: id => id === 'story-block.gear' || id === 'story-block.rpg' } };
const reply = (text, lines) => `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;

async function fresh(t) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ settings: { features: { 'story-block.gear': true, 'story-block.rpg': true } } });
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    await host.send('Loot.', reply('A bag.', ['+ item Sling Bag']));
    return host;
}
const bag = host => host.sdk.query('inventory.items').find(item => item.name === 'Sling Bag');
const capacity = host => host.sdk.query('gear.carry', {}).capacity;
const setCarry = (host, carry) => host.sdk.command('inventory.carry', { stack: bag(host).stack, carry });

test('the reader sets 10 on a story Sling Bag and the capacity rises by 10; 0 removes it', async t => {
    const host = await fresh(t);
    const base = capacity(host);
    const out = await setCarry(host, 10);
    assert.equal(out.ok, true, out.message);
    assert.equal(capacity(host), base + 10);
    assert.equal(bag(host).carry, 10, 'the item row shows +10');
    assert.deepEqual(host.store.problems(), []);
    assert.equal((await setCarry(host, 0)).ok, true);
    assert.equal(capacity(host), base);
    assert.equal(Object.values(host.head().domains.inventory.defs).find(item => item.name === 'Sling Bag').carry, undefined);
});

test('501, -1, a fraction and text are refused; a pack item keeps its own value', async t => {
    const host = await fresh(t);
    const base = capacity(host);
    for (const bad of [501, -1, 1.5, '10', null]) {
        const out = await setCarry(host, bad);
        assert.equal(out.ok, false, `${bad} refused`);
    }
    assert.match((await setCarry(host, 501)).message, /whole number from 0 to 500/);
    assert.equal((await setCarry(host, 500)).ok, true, '500 is the top');
    assert.equal(capacity(host), base + 500);
    const module = createCoreModule({ hooks: () => [], settings: () => ({}), extras: { gearOn: () => true } });
    const state = stocked(module);
    state.domains.inventory.defs['pack.fantasy/satchel'] = def('pack.fantasy/satchel', 'Deep Satchel', { kind: 'goods', carry: 20 });
    state.domains.inventory.stacks.it_sat00001 = stack('it_sat00001', 'pack.fantasy/satchel', 1);
    const h = createHarness([module], { state });
    assert.match(h.run('inventory.carry', { stack: 'it_sat00001', carry: 5 }, { cause: 'ui', ...ON }).message, /pack/);
    assert.equal(h.state.domains.inventory.defs['pack.fantasy/satchel'].carry, 20);
});

test('a story line cannot set or raise it: the item line, a later line and a module call are refused or ignored', async t => {
    const host = await fresh(t);
    await setCarry(host, 10);
    const base = capacity(host);
    await host.send('More.', reply('Again.', ['+ item Sling Bag | carry: 400', '+ item Big Pouch | carry: 300 | capacity: 300', '~ carry Sling Bag 500']));
    assert.equal(capacity(host), base, 'the story added nothing to the capacity');
    assert.equal(Object.values(host.head().domains.inventory.defs).find(item => item.name === 'Big Pouch').carry, undefined);
    assert.equal(bag(host).carry, 10);
    const h = createHarness([core()]);
    h.capture(line('+', 'item', 'Sling Bag', {}), ON);
    const stack = Object.keys(h.state.domains.inventory.stacks)[0];
    for (const cause of ['story', 'system']) assert.equal(h.run('inventory.carry', { stack, carry: 50 }, { cause, ...ON }).ok, false, `${cause} refused`);
    assert.equal(h.run('inventory.carry', { stack, carry: 50 }, { cause: 'ui', caller: 'zz-quest', ...ON }).ok, false, 'a module call refused');
    assert.equal(h.run('inventory.carry', { stack, carry: 50 }, { cause: 'ui', ...ON }).ok, true, 'the reader can');
});

test('replay, a rebuild, a reload and a Re-read keep the reader\'s value', async t => {
    const host = await fresh(t);
    await host.send('Walk.', reply('On.', ['+ coin 1']));
    await setCarry(host, 25);
    const view = h => JSON.stringify([h.head().domains.inventory, h.sdk.query('gear.carry', {}).capacity]);
    const live = view(host);
    host.store.rebuild();
    assert.equal(view(host), live, 'a rebuild keeps it');
    const loaded = await createHost({ st: { chat: structuredClone(host.ctx.chat), extensionSettings: structuredClone(host.ctx.extensionSettings) } });
    t.after(() => loaded.close());
    assert.equal(view(loaded), live, 'a reload keeps it');
    assert.equal((await host.turn.reread(host.ctx.chat.length - 1)).ok, true);
    assert.equal(view(host), live, 'a Re-read keeps it');
});

test('the carry line lists the strength, what each item adds and the mounts with the party', async t => {
    const host = await fresh(t);
    await setCarry(host, 10);
    const text = () => host.sdk.query('gear.view', { owner: 'party' }).carry.breakdown;
    assert.equal(text(), 'Strength 30 · Sling Bag +10', 'the reader alone: strength N then the item');
    assert.equal(host.sdk.query('gear.view', { owner: 'party' }).rows[bag(host).stack].carry, 10);
    await host.send('Saddle.', reply('Yard.', ['+ mount Grey | kind: horse']));
    assert.equal(text(), 'Strength 30 \u00b7 Sling Bag +10 \u00b7 Grey +40 (with the party)');
});

test('the Edit form of the reader\'s own piece has the field; a change plans inventory.carry', () => {
    const p = { value: 'Ring', itemCount: 1, itemNote: '', gear: { kind: 'goods', stack: 'it_a', owner: 'party', row: { hand: true, carry: 300 }, kit: false, owners: [] } };
    const field = editFields(p).find(entry => entry.key === 'carry');
    assert.deepEqual([field.type, field.min, field.max, field.value, field.label], ['number', 0, 500, 300, 'Adds carry capacity (0–500)']);
    assert.ok(editFields(p).some(entry => entry.text === 'Only you set this. The story never changes it.'));
    assert.deepEqual(editPlan(p)({ carry: 5 }, { carry: 5, name: 'Ring', count: 1, kind: 'goods' }).steps, [{ command: 'inventory.carry', payload: { stack: 'it_a', carry: 5 }, keys: ['carry'] }]);
    assert.match(editPlan(p)({ carry: 501 }, { carry: 501, name: 'Ring', count: 1, kind: 'goods' }).error, /0 to 500/);
});
