// Gear condition (0…100) for RPG Battle's wear rules: `inventory.wear { stack, amount }` and
// `inventory.repair { stack, amount }` (the shape RPG Battle's gear part calls), another module's calls
// only. Each write is an event keyed by the reply that wrote it (`condLog[<stack>]['<sid>#<n>']`); the
// condition is 100 (or an older plain `cond`) folded through them, held to 0…100 at each step. Split,
// merge, transfer and the item rows follow it. The story's `~ item … | wear:` goes to `item.wear` when a
// module answers it (and Story Block then writes nothing).
import test from 'node:test';
import assert from 'node:assert/strict';
import { COND_LOG_MAX, COND_MAX, STORY_WEAR, condEvents, condOf, listItems, validateInventory, wearWord } from '../../../src/v2/domains/inventory.js';
import { createHarness, line } from './helpers/fake-ctx.js';
import { core, stocked } from './fixtures.js';

const fresh = () => {
    const module = core();
    return createHarness([module], { state: stocked(module) });
};
const asModule = { caller: 'rpg-battle', cause: 'story' };
const sword = h => h.state.domains.inventory.stacks.it_sword001;
const condNow = (h, id = 'it_sword001') => condOf(h.state.domains.inventory.stacks[id], h.state.domains.inventory);
const log = (h, id = 'it_sword001') => h.state.domains.inventory.condLog?.[id];

test('wear and repair are another module\'s calls only, whatever the cause', () => {
    const h = fresh();
    for (const cause of ['ui', 'story', 'system']) {
        const out = h.run('inventory.wear', { stack: 'it_sword001', amount: 10 }, { cause });
        assert.deepEqual([out.ok, out.code], [false, 'REFUSED'], cause);
        assert.match(out.message, /another module's rules/);
        assert.equal(h.run('inventory.repair', { stack: 'it_sword001', amount: 5 }, { cause }).code, 'REFUSED');
    }
    assert.equal(sword(h).cond, undefined, 'a stack with no condition is as new');
    assert.equal(condNow(h), COND_MAX);
    assert.equal(h.state.domains.inventory.condLog, undefined);
});

test('events, not a value: wear down, repair up, folded and held to 0…100 at each step; back at 100 the events go', () => {
    const h = fresh();
    const carrier = sid => ({ ...asModule, extra: { carrier: { index: 2, swipe: 0, sid, key: '2:0' } } });
    let out = h.run('inventory.wear', { stack: 'it_sword001', amount: 30 }, carrier('sw_a'));
    assert.equal(out.ok, true, out.message);
    assert.equal(out.result.summary, 'Iron Sword wears (100 → 70).');
    assert.deepEqual([condNow(h), out.result.data.now, out.result.narrate, sword(h).cond], [70, 70, false, undefined], 'never stored on the stack');
    assert.deepEqual(log(h), { 'sw_a#1': { d: -30, n: 1 } });
    out = h.run('inventory.wear', { stack: 'it_sword001', amount: 500 }, carrier('sw_b'));
    assert.deepEqual([out.ok, condNow(h), out.result.data.amount, out.result.data.broken, out.result.summary], [true, 0, 100, true, 'Iron Sword breaks.']);
    out = h.run('inventory.wear', { stack: 'it_sword001', amount: 5 }, carrier('sw_b'));
    assert.deepEqual([out.ok, out.result.summary], [true, 'Iron Sword is already broken.']);
    assert.deepEqual(Object.keys(log(h)), ['sw_a#1', 'sw_b#1', 'sw_b#2'], 'one key per write, by the reply that wrote it');
    out = h.run('inventory.repair', { stack: 'it_sword001', amount: 60 }, carrier('sw_c'));
    assert.deepEqual([out.ok, condNow(h), out.result.summary], [true, 60, 'Iron Sword is mended (0 → 60).'], 'held at 0 on the way, not -35');
    out = h.run('inventory.repair', { stack: 'it_sword001', amount: 250 }, carrier('sw_c'));
    assert.deepEqual([out.ok, out.result.data.now, condNow(h)], [true, 100, 100]);
    assert.deepEqual(log(h), {}, 'as new: its events are dropped, by key');
    out = h.run('inventory.repair', { stack: 'it_sword001', amount: 1 }, asModule);
    assert.equal(out.result.summary, 'Iron Sword is already as good as new.');
    assert.deepEqual(h.query('inventory.condition', { stack: 'it_sword001' }), { stack: 'it_sword001', cond: 100, events: [] });
});

test('an older plain cond reads as where it starts; many events fold into one; logs of gone stacks are dropped', () => {
    const module = core();
    const state = stocked(module);
    state.domains.inventory.stacks.it_sword001.cond = 50;
    const h = createHarness([module], { state });
    assert.equal(condNow(h), 50);
    assert.equal(h.run('inventory.wear', { stack: 'it_sword001', amount: 10 }, asModule).result.data.now, 40);
    assert.deepEqual(h.query('inventory.condition', { stack: 'it_sword001' }).events.map(event => event.d), [-10]);
    assert.equal(h.run('inventory.repair', { stack: 'it_sword001', amount: 60 }, asModule).result.data.now, 100);
    assert.equal(Object.hasOwn(sword(h), 'cond'), false, 'the old value goes once it is as new');
    for (let n = 0; n <= COND_LOG_MAX; n += 1) assert.equal(h.run('inventory.wear', { stack: 'it_sword001', amount: 1 }, asModule).ok, true);
    assert.equal(Object.keys(log(h)).length, 1, 'folded into one event');
    assert.equal(condNow(h), 100 - COND_LOG_MAX - 1);
    assert.equal(h.run('inventory.wear', { stack: 'it_dagg0001', amount: 3 }, asModule).ok, true);
    assert.equal(h.run('inventory.drop', { stack: 'it_sword001' }).ok, true);
    assert.equal(h.run('inventory.wear', { stack: 'it_dagg0001', amount: 3 }, asModule).ok, true);
    assert.deepEqual(Object.keys(h.state.domains.inventory.condLog), ['it_dagg0001']);
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
    for (const bad of [{ x: { d: 101, n: 1 } }, { x: { d: -5 } }, { x: 'worn' }]) {
        inv.condLog = { it_sword001: bad };
        assert.match(validateInventory(inv).join(' '), /condition event|condition log/, JSON.stringify(bad));
    }
    inv.condLog = { it_sword001: { 'sw_a#1': { d: 20, n: 3 } }, it_gone0001: { 'sw_a#1': { d: -4, n: 3 } } };
    assert.deepEqual(validateInventory(inv), [], 'a log of a stack no longer there is no error');
    const rows = listItems(inv);
    assert.equal(rows.find(row => row.stack === 'it_sword001').cond, 20);
    assert.deepEqual(condEvents(inv, 'it_sword001'), [{ key: 'sw_a#1', d: 20, n: 3 }]);
    assert.equal(Object.hasOwn(rows.find(row => row.stack === 'it_rope0001'), 'cond'), false);
});

test('split keeps the condition; stacks in different condition never merge or pile together', () => {
    const module = core();
    const state = stocked(module);
    state.domains.inventory.stacks.it_rope0001.cond = 40;
    const h = createHarness([module], { state });
    const split = h.run('inventory.split', { stack: 'it_rope0001', qty: 1 });
    assert.equal(split.ok, true, split.message);
    assert.equal(condNow(h, split.result.data.made), 40, 'the new lot starts where the old one stands');
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
    assert.deepEqual(lots.map(s => [s.qty, condOf(s, g.state.domains.inventory)]).sort(), [[1, 100], [1, 40]]);
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
    assert.equal(condNow(alone), 85);
    assert.deepEqual(Object.keys(log(alone)), ['sid-wear-1#1']);
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
    assert.equal(routed.state.domains.inventory.condLog, undefined, 'and Story Block writes no event');
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

// RX-TL-2 (rx-timeline): a rules module that wears a piece by a code number from its own story line, as
// RPG Battle's item.wear does; middle deletes take exactly the deleted reply's wear or repair back.
const GEAR = {
    id: 'rx-gear', name: 'rx gear', version: '0.0.0',
    capture: {
        kinds: { rxwear: { grammar: '~ rxwear <amount>' } },
        apply(ctx, line) {
            const stack = Object.values(ctx.read('inventory').stacks).find(s => s.def.endsWith('iron-sword'));
            const n = Number(line.name);
            ctx.call(n < 0 ? 'inventory.repair' : 'inventory.wear', { stack: stack.id, amount: Math.abs(n) });
            return { summary: 'worn', narrate: false };
        },
    },
};
const reply = (text, lines) => `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const swordCond = host => host.sdk.query('inventory.condition', { stack: Object.values(host.head().domains.inventory.stacks).find(s => s.def.endsWith('iron-sword')).id }).cond;

async function gearHost(t) {
    const { createHost } = await import('../../../testkit/index.js');
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ modules: [GEAR] });
    t.after(() => host.close());
    await host.send('Go.', reply('A sword.', ['+ item Iron Sword']));
    return host;
}

async function dropExchange(host, said) {
    const at = host.ctx.chat.findIndex(message => message.is_user && message.mes === said);
    await host.st.deleteMessage(at + 1);
    await host.st.deleteMessage(at);
}

test('RX-TL-2: deleting the reply that wore a piece takes that wear back; a later reply\'s wear stays', async t => {
    const host = await gearHost(t);
    await host.send('Fight.', reply('It cracks.', ['~ rxwear 15']));
    await host.send('Rocks.', reply('It chips.', ['~ rxwear 40']));
    assert.equal(swordCond(host), 45);
    await dropExchange(host, 'Fight.');
    assert.deepEqual(host.store.problems(), []);
    assert.equal(swordCond(host), 60, 'as if the crack never happened');
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live);
});

test('RX-TL-2: a deleted repair is gone, and a repair after a deleted wear stays in range; nothing is skipped', async t => {
    const host = await gearHost(t);
    await host.send('A.', reply('Hit.', ['~ rxwear 50']));
    await host.send('B.', reply('Smith.', ['~ rxwear -30']));
    await host.send('C.', reply('Hit.', ['~ rxwear 20']));
    assert.equal(swordCond(host), 60);
    await dropExchange(host, 'B.');
    assert.deepEqual(host.store.problems(), []);
    assert.equal(swordCond(host), 30, 'the repair is taken back');
    await host.send('D.', reply('Smith.', ['~ rxwear -90']));
    assert.equal(swordCond(host), 100);
    await dropExchange(host, 'A.');
    assert.deepEqual(host.store.problems(), []);
    assert.equal(swordCond(host), 100, 'held at 100, never 150');
});

// What each reply leaves in the log, modelled on its own (SPEC §2.2): a write adds its event under its
// reply's key; one that brings the piece back to 100 instead drops, by key, the events there then (its own
// never stays). A replay applies what each kept reply left, in order.
const fold = log => [...log.values()].reduce((cond, d) => Math.max(0, Math.min(100, cond + d)), 100);

test('fuzz: middle deletes around wear and repair: no Problems, the condition is what the kept replies leave, rebuild equals live', async t => {
    const { prng } = await import('../qa/helpers/seeded.js');
    const { checkInvariants } = await import('../qa/helpers/oracle.js');
    for (const seed of [5, 23, 91, 140]) {
        const r = prng(seed);
        const host = await gearHost(t);
        const live = new Map();
        const done = [];
        for (let step = 0; step < 18; step += 1) {
            const n = r.chance(0.35) ? -r.int(1, 40) : r.int(1, 30);
            const said = `S${seed}-${step}`;
            await host.send(said, reply('Clash.', [`~ rxwear ${n}`]));
            live.set(said, -n);
            const left = fold(live) === 100 ? { drop: [...live.keys()].filter(key => key !== said) } : { add: [said, -n] };
            if (left.drop) live.clear();
            done.push({ said, left });
            assert.equal(swordCond(host), fold(live), `seed ${seed} step ${step}: live`);
            if (step < 2 || !r.chance(0.3)) continue;
            const gone = done.splice(r.int(0, done.length - 2), 1)[0];
            await dropExchange(host, gone.said);
            live.clear();
            for (const { left: entry } of done) {
                for (const key of entry.drop ?? []) live.delete(key);
                if (entry.add) live.set(...entry.add);
            }
            const label = `seed ${seed} step ${step} (deleted ${gone.said})`;
            assert.deepEqual(host.store.problems(), [], `${label}: nothing skipped`);
            assert.equal(swordCond(host), fold(live), `${label}: what the kept replies leave`);
            const head = JSON.stringify(host.head());
            host.store.rebuild();
            assert.equal(JSON.stringify(host.head()), head, `${label}: rebuild equals live`);
            checkInvariants(host, label);   // every carrier equals the independent oracle's rebuild
        }
    }
});

test('a wear line answered by item.wear with its feature off is a quiet Problem, and Story Block wears nothing', async t => {
    const { createHost } = await import('../../../testkit/index.js');
    t.mock.method(console, 'warn', () => {});
    const gear = {
        id: 'zz-gear', name: 'Gear', version: '0.0.0',
        features: [{ id: 'zz-gear.wear', label: 'Gear wear', default: true }],
        commands: { 'item.wear': { handler: () => ({ summary: 'worn' }), feature: 'zz-gear.wear' } },
    };
    const host = await createHost({ modules: [gear], settings: { features: { 'zz-gear.wear': false } } });
    t.after(() => host.close());
    const say = (text, lines) => `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
    await host.send('Hello.', 'The road.');
    await host.send('Gear.', say('A coat.', ['+ item Wool Coat']));
    await host.send('Brambles.', say('Thorns.', ['~ item Wool Coat — torn by brambles | wear: tear']));
    const problems = host.turn.problems();
    assert.deepEqual(problems.map(problem => [problem.code, problem.quiet]), [['FEATURE_OFF', true]]);
    assert.equal(host.sdk.query('inventory.items')[0].cond, undefined);
    assert.equal(host.head().domains.inventory.condLog, undefined);
});
