// Gear condition on stacks (`cond`, 0…100; absent = 100) for RPG Battle's wear rules:
// `inventory.wear { stack, amount }` and `inventory.repair { stack, amount }` (the shape RPG Battle's gear
// part calls), another module's calls only, with clamps; the validator, split, merge, transfer and the item
// rows keep it. The story's `~ item … | wear: scuff|tear|ruin` goes to `item.wear` when a module answers it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { COND_MAX, STORY_WEAR, condOf, listItems, validateInventory, wearWord } from '../../../src/v2/domains/inventory.js';
import { createHarness, line } from './helpers/fake-ctx.js';
import { core, stocked } from './fixtures.js';

const fresh = () => {
    const module = core();
    return createHarness([module], { state: stocked(module) });
};
const asModule = { caller: 'rpg-battle', cause: 'story' };
const sword = h => h.state.domains.inventory.stacks.it_sword001;

test('wear and repair are another module\'s calls only, whatever the cause', () => {
    const h = fresh();
    for (const cause of ['ui', 'story', 'system']) {
        const out = h.run('inventory.wear', { stack: 'it_sword001', amount: 10 }, { cause });
        assert.deepEqual([out.ok, out.code], [false, 'REFUSED'], cause);
        assert.match(out.message, /another module's rules/);
        assert.equal(h.run('inventory.repair', { stack: 'it_sword001', amount: 5 }, { cause }).code, 'REFUSED');
    }
    assert.equal(sword(h).cond, undefined, 'a stack with no condition is as new');
    assert.equal(condOf(sword(h)), COND_MAX);
});

test('wear goes down by its amount, never below 0 (broken); repair up by its amount, never above 100 (then the field goes)', () => {
    const h = fresh();
    let out = h.run('inventory.wear', { stack: 'it_sword001', amount: 30 }, asModule);
    assert.equal(out.ok, true, out.message);
    assert.equal(out.result.summary, 'Iron Sword wears (100 → 70).');
    assert.deepEqual([sword(h).cond, out.result.data.now, out.result.narrate], [70, 70, false]);
    out = h.run('inventory.wear', { stack: 'it_sword001', amount: 500 }, asModule);
    assert.deepEqual([out.ok, sword(h).cond, out.result.data.amount, out.result.data.broken], [true, 0, 100, true]);
    assert.equal(out.result.summary, 'Iron Sword breaks.');
    out = h.run('inventory.wear', { stack: 'it_sword001', amount: 5 }, asModule);
    assert.deepEqual([out.ok, out.result.summary], [true, 'Iron Sword is already broken.']);
    out = h.run('inventory.repair', { stack: 'it_sword001', amount: 60 }, asModule);
    assert.deepEqual([out.ok, sword(h).cond, out.result.summary], [true, 60, 'Iron Sword is mended (0 → 60).']);
    out = h.run('inventory.repair', { stack: 'it_sword001', amount: 250 }, asModule);
    assert.deepEqual([out.ok, Object.hasOwn(sword(h), 'cond'), out.result.data.now], [true, false, 100]);
    out = h.run('inventory.repair', { stack: 'it_sword001', amount: 1 }, asModule);
    assert.equal(out.result.summary, 'Iron Sword is already as good as new.');
});

test('the validator holds cond to a whole number 0…100; items rows carry it when it is there', () => {
    const state = stocked(core());
    const inv = state.domains.inventory;
    assert.deepEqual(validateInventory(inv), []);
    for (const bad of [-1, 101, 2.5, '50', null]) {
        inv.stacks.it_sword001.cond = bad;
        assert.match(validateInventory(inv).join(' '), /condition of .*whole number from 0 to 100/, String(bad));
    }
    inv.stacks.it_sword001.cond = 0;
    assert.deepEqual(validateInventory(inv), []);
    const rows = listItems(inv);
    assert.equal(rows.find(row => row.stack === 'it_sword001').cond, 0);
    assert.equal(Object.hasOwn(rows.find(row => row.stack === 'it_rope0001'), 'cond'), false);
});

test('split keeps the condition; stacks in different condition never merge or pile together', () => {
    const module = core();
    const state = stocked(module);
    state.domains.inventory.stacks.it_rope0001.cond = 40;
    const h = createHarness([module], { state });
    const split = h.run('inventory.split', { stack: 'it_rope0001', qty: 1 });
    assert.equal(split.ok, true, split.message);
    assert.equal(h.state.domains.inventory.stacks[split.result.data.made].cond, 40);
    const merged = h.run('inventory.merge', { stack: split.result.data.made, into: 'it_rope0001' });
    assert.equal(merged.ok, true, 'same condition: together again');
    // A worn lot handed to someone who holds a fresh lot stays its own stack.
    const two = stocked(module);
    two.domains.inventory.stacks.it_rope0001.cond = 40;
    two.domains.inventory.stacks.it_rope0002 = { ...two.domains.inventory.stacks.it_rope0001, id: 'it_rope0002', owner: 'ac_ren00001', qty: 1 };
    delete two.domains.inventory.stacks.it_rope0002.cond;
    const g = createHarness([module], { state: two });
    assert.equal(g.run('inventory.merge', { stack: 'it_rope0001', into: 'it_rope0002' }).code, 'REFUSED');
    const moved = g.run('inventory.transfer', { stack: 'it_rope0001', to: 'ac_ren00001', qty: 1 });
    assert.equal(moved.ok, true, moved.message);
    const lots = Object.values(g.state.domains.inventory.stacks).filter(s => s.def === 'story/rope' && s.owner === 'ac_ren00001');
    assert.deepEqual(lots.map(s => [s.qty, condOf(s)]).sort(), [[1, 100], [1, 40]]);
});

test('the story\'s wear word: to item.wear when a module answers it, else Story Block wears the piece once per reply', () => {
    assert.deepEqual(STORY_WEAR, { scuff: 5, tear: 15, ruin: 40 });
    assert.deepEqual(['scuff', 'badly scratched', 'ripped', 'shattered', 'fine'].map(wearWord), ['scuff', 'scuff', 'tear', 'ruin', null]);
    const carrier = { index: 2, swipe: 0, sid: 'sid-wear-1', key: '2:0' };
    const module = core();
    const state = stocked(module);
    state.domains.inventory.stacks.it_sword001.equipped = 'hand';
    const alone = createHarness([module], { state });
    const torn = alone.capture(line('~', 'item', 'Iron Sword', { wear: 'torn' }, 'nicked by a goblin blade'), { extra: { carrier } });
    assert.equal(torn.ok, true, torn.message);
    assert.equal(torn.result.summary, 'Iron Sword is damaged (85/100).');
    assert.equal(alone.state.domains.inventory.stacks.it_sword001.cond, 85);
    assert.equal(alone.state.domains.inventory.stacks.it_sword001.note, '', 'the text says how, it is no note');
    const again = alone.capture(line('~', 'item', 'Iron Sword', { wear: 'ruin' }), { extra: { carrier } });
    assert.equal(again.code, 'CLAIMED', 'once per piece per reply');
    assert.equal(alone.capture(line('~', 'item', 'Iron Sword', { wear: 'polished' }), { extra: { carrier } }).code, 'INVALID');

    const asked = [];
    const gear = { id: 'rpg-battle', commands: { 'item.wear': (ctx, payload) => { asked.push([payload, ctx.caller]); return { summary: 'Ren\'s Iron Sword is now worn.', data: {} }; } } };
    const routed = createHarness([module, gear], { state });
    const out = routed.capture(line('~', 'item', 'iron swords', { wear: 'tear' }, 'torn by brambles'), { extra: { carrier } });
    assert.equal(out.ok, true, out.message);
    assert.equal(out.result.summary, 'Ren\'s Iron Sword is now worn.');
    assert.deepEqual(asked, [[{ name: 'Iron Sword', wear: 'tear', why: 'torn by brambles', story: true }, 'story-block']]);
    assert.equal(routed.state.domains.inventory.stacks.it_sword001.cond, undefined, 'RPG Battle keeps the numbers then');
});

test('on the real host: a wear line without a gear module wears the piece; swipe takes it back', async t => {
    const { createHost } = await import('../../../testkit/index.js');
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    const reply = (text, lines) => `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
    await host.send('Hello.', 'The road.');
    await host.send('Gear.', reply('A coat.', ['+ item Wool Coat']));
    await host.send('Brambles.', reply('Thorns.', ['~ item Wool Coat — torn by brambles | wear: tear']));
    assert.deepEqual(host.turn.problems(), []);
    assert.equal(host.sdk.query('inventory.items')[0].cond, 85);
    await host.swipe(reply('No thorns.', ['+ coin 1']));
    assert.equal(host.sdk.query('inventory.items')[0].cond, undefined);
});
