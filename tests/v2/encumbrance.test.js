// Encumbered (`story-block.encumbrance`, on by default): what the story gives past the carry limit
// (`items.carry`, RPG Battle's) is kept, and the party is encumbered: a check penalty other modules read
// from `inventory.encumbrance`, and one tail line. Derived from the load, never stored, so it lifts once
// something is put down. The reader's own takes and hand-overs are still refused. Off: the story's line
// is refused with the carry module's reason (F39).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ENCUMBERED_PENALTY, encumbrance, encumbranceTail } from '../../src/v2/domains/inventory.js';
import { createHost } from '../../testkit/index.js';
import { createHarness, line } from './domains/helpers/fake-ctx.js';
import { core, stocked } from './domains/fixtures.js';

const reply = (text, lines) => `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const qty = (host, name) => host.sdk.query('inventory.items').filter(item => item.name === name).reduce((sum, item) => sum + item.qty, 0);
const tail = host => host.st.promptLog.filter(entry => entry.key === 'story_suite_tail_1' && entry.value).at(-1)?.value ?? '';

// Every thing weighs 1; the party (the shared bag) carries 5.
const CAPACITY = 5;
const loadOf = state => Object.values(state?.domains?.inventory?.stacks ?? {}).reduce((sum, stack) => sum + stack.qty, 0);
const carry = {
    id: 'zz-carry', name: 'Carry',
    queries: {
        'items.carry': (state, args = {}) => {
            const load = loadOf(state);
            if (!Array.isArray(args.add)) return { on: true, people: [], bag: load, load, capacity: CAPACITY };
            const weight = args.add.reduce((sum, entry) => sum + entry.qty, 0);
            return load + weight > CAPACITY ? { ok: false, message: `The party cannot carry that: ${load} of ${CAPACITY} carried.` } : { ok: true };
        },
    },
};

async function fresh(t, modules = [carry]) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ modules });
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    return host;
}

test('a story + item past the limit is kept, and the party is encumbered until something is put down', async t => {
    const host = await fresh(t);
    await host.send('Loot.', reply('A pile of stones.', ['+ item Stone | qty: 4', '+ item Brick | qty: 3']));
    assert.deepEqual([qty(host, 'Stone'), qty(host, 'Brick')], [4, 3], 'nothing the story gave is lost');
    assert.deepEqual(host.turn.problems(), []);
    const last = host.sdk.receipts().at(-1).receipt;
    assert.match(last.summary, /^The party gains Brick ×3\. The party now carries more than it can and is encumbered/);
    assert.equal(last.data.encumbered, true);
    assert.equal(host.sdk.receipts().at(-2).receipt.data.encumbered, undefined, 'the first line still fit');
    const found = host.sdk.query('inventory.encumbrance');
    assert.deepEqual(found, { on: true, encumbered: true, party: true, who: [], load: 7, capacity: 5, penalty: ENCUMBERED_PENALTY, stats: ['AGI', 'DEX'] });
    await host.send('Onward.', reply('Heavy steps.', ['+ coin 1']));
    assert.match(tail(host), /^Encumbered \(carrying more than they can\): the party \(7\/5\); AGI and DEX checks -2 until something is put down\.$/m);

    // The reader's own take is still refused while encumbered.
    await host.send('Look.', reply('A crate.', ['? loot Feather']));
    const sid = host.store.carrierSid(host.store.headIndex());
    const refused = await host.sdk.command('inventory.lootTake', { sid, pick: [0] });
    assert.deepEqual([refused.ok, refused.code], [false, 'REFUSED']);
    assert.match(refused.message, /cannot carry that/);

    // Putting things down lifts it by itself.
    await host.send('Drop the bricks.', reply('Lighter.', ['- item Brick | qty: 3']));
    assert.equal(host.sdk.query('inventory.encumbrance').encumbered, false);
    await host.send('On.', reply('The road.', ['+ coin 1']));
    assert.doesNotMatch(tail(host), /Encumbered/);
});

test('without a carry module there is no limit and no line', async t => {
    const host = await fresh(t, []);
    await host.send('Loot.', reply('Stones.', ['+ item Stone | qty: 20']));
    assert.equal(host.sdk.query('inventory.encumbrance').encumbered, false);
    assert.equal(host.sdk.receipts().at(-1).receipt.data.encumbered, undefined);
});

test('members over their own capacity are named; the line is one short sentence', () => {
    const view = { on: true, people: [{ id: 'ac_mira0001', name: 'Mira\nthe Tall', load: 9, capacity: 8 }, { id: 'ac_ren00001', name: 'Ren', load: 3, capacity: 8 }], load: 12, capacity: 16 };
    const found = encumbrance({}, { query: () => view });
    assert.deepEqual(found.who, [{ id: 'ac_mira0001', name: 'Mira the Tall', load: 9, capacity: 8 }]);
    assert.equal(found.party, false);
    assert.deepEqual(encumbranceTail(found), ['Encumbered (carrying more than they can): Mira the Tall (9/8); AGI and DEX checks -2 until something is put down.']);
    assert.deepEqual(encumbranceTail(encumbrance({}, { query: () => ({ ...view, on: false }) })), []);
    assert.deepEqual(encumbranceTail(encumbrance({}, { query: () => { throw new Error('none'); } })), []);
});

test('with the feature off the story\'s line past the limit is refused with the module\'s reason (F39)', () => {
    const module = core();
    const h = createHarness([module, { id: 'zz-carry', ...carry }], { state: stocked(module) });
    const off = { extra: { feature: id => id !== 'story-block.encumbrance' } };
    const refused = h.capture(line('+', 'item', 'Stone', { qty: '4' }), off);
    assert.deepEqual([refused.ok, refused.code], [false, 'REFUSED']);
    assert.match(refused.message, /cannot carry that/);
    assert.equal(h.capture(line('~', 'item', 'Rope', { qty: '9' }), off).code, 'REFUSED');
    const on = h.capture(line('+', 'item', 'Stone', { qty: '4' }));
    assert.deepEqual([on.ok, on.result.data.encumbered], [true, true]);
    // The tail is left out with the feature off, even while the load is over.
    const tailOf = feature => module.context.tail({ state: h.state, query: (name, args) => h.query(name, args), feature }).lines;
    assert.ok(tailOf(undefined).some(text => text.startsWith('Encumbered')));
    assert.ok(!tailOf(() => false).some(text => text.startsWith('Encumbered')));
});

test('a host with Features: encumbrance off, the story\'s line past the limit is refused; no line, no condition', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ modules: [carry], settings: { features: { 'story-block.encumbrance': false } } });
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    await host.send('Loot.', reply('Stones.', ['+ item Stone | qty: 4', '+ item Brick | qty: 3']));
    assert.deepEqual([qty(host, 'Stone'), qty(host, 'Brick')], [4, 0]);
    assert.deepEqual(host.turn.problems().map(problem => problem.code), ['REFUSED']);
    assert.match(host.turn.problems()[0].message, /The party cannot carry that: 4 of 5 carried/);
    assert.equal(host.sdk.query('inventory.encumbrance'), null, 'the query answers nothing while the feature is off');
});
