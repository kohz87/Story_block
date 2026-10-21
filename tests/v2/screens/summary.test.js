// The changes card's one-line summary (changesDigest / changesSummary): what a reply gained and lost,
// from its state and the state before it, with the ops the real command bus writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommandBus } from '../../../src/v2/commands.js';
import { changesDigest, changesSummary } from '../../../src/v2/screens/index.js';
import { counterIds, fakeRegistry, fakeStore } from '../helpers/bus-fakes.js';
import { core, sceneState } from './helpers.js';

// Runs commands on the real bus and returns { before, state, changes } for what they did together.
function reply(commands, setup = () => {}) {
    const module = core();
    const start = sceneState(module);
    setup(start);
    const store = fakeStore(start);
    const bus = createCommandBus({ store, registry: fakeRegistry([module]), id: counterIds(), seed: () => 7 });
    const before = store.head();
    for (const [type, payload, cause = 'ui'] of commands) {
        const result = bus.command(type, payload, { cause });
        assert.equal(result.ok, true, `${type}: ${result.message}`);
    }
    const changes = store.appended.flatMap(entry => entry.ops.map(op => op.path));
    return { before, state: store.head(), changes };
}

test('gains, losses, coin and a move in one line', () => {
    const view = reply([
        ['inventory.grant', { name: 'Moonveil Trout', note: 'violet' }, 'story'],
        ['inventory.consume', { stack: 'it_rope0001', qty: 1 }],
        ['inventory.drop', { stack: 'it_lant0001', qty: 1 }],
        ['wallet.receive', { owner: 'party', amount: 30, note: 'from the sealer' }],
        // The move leaves Fenna behind (Old Tam comes along); Kael is met there.
        ['scene.place', { name: 'The Weir', kind: 'wild', with: 'Old Tam' }],
        ['scene.present', { add: ['Kael'] }],
    ]);
    const digest = changesDigest(view);
    assert.deepEqual(digest.gained.map(entry => [entry.name, entry.qty]), [['Moonveil Trout', 1]]);
    assert.deepEqual(digest.lost.map(entry => [entry.name, entry.qty]), [['Lantern', 1], ['Rope', 1]]);
    assert.equal(digest.coin, 30);
    assert.equal(digest.place, 'The Weir');
    assert.deepEqual(digest.arrived, ['Kael']);
    assert.deepEqual(digest.left, ['Fenna']);
    assert.equal(changesSummary(view), '+1 Moonveil Trout, −1 Lantern, −1 Rope · +30 gold · to The Weir · Kael arrived · Fenna left');
    // The lantern is gone from the reply's state; the summary still names it from the state before.
    assert.equal(view.state.domains.inventory.stacks.it_lant0001, undefined);
});

test('a hand-over between members, or equipping, is no gain or loss', () => {
    const view = reply([['inventory.equip', { stack: 'it_sword001' }], ['inventory.transfer', { stack: 'it_rope0001', to: 'ac_ren00001', qty: 1 }]], state => {
        state.domains.party = { pc: 'ac_ren00001', order: ['ac_ren00001'], actors: { ac_ren00001: { id: 'ac_ren00001', name: 'Ren' } } };
    });
    assert.ok(view.changes.length > 0);
    assert.equal(changesSummary(view), 'No changes');
});

test('paying shows a minus in the chat\'s currency', () => {
    const view = reply([['wallet.pay', { owner: 'party', amount: 5, note: 'the ferry' }]]);
    assert.equal(changesSummary({ ...view, currency: { name: 'crowns', short: 'cr' } }), '−5 crowns');
});

test('more than three items are counted, not listed', () => {
    const view = reply(['Apple', 'Bread', 'Cheese', 'Dates', 'Eggs'].map(name => ['inventory.grant', { name }, 'story']));
    assert.equal(changesSummary(view), '+1 Apple, +1 Bread, +1 Cheese, 2 more');
});

test('without the state before: what is held now', () => {
    const { state } = reply([]);
    const changes = ['/domains/inventory/stacks/it_rope0001/qty', '/domains/inventory/wallets/party/coin', '/domains/scene/present', '/domains/inventory/stacks/it_gone0001'];
    const digest = changesDigest({ state, changes });
    assert.deepEqual(digest.held.map(entry => [entry.name, entry.qty]), [['Rope', 3]]);
    assert.equal(digest.coinNow, 125);
    assert.deepEqual(digest.presentNow, ['Fenna', 'Old Tam']);
    assert.equal(changesSummary({ state, changes }), 'Rope ×3 · 125 gold now · here: Fenna and Old Tam');
    assert.equal(changesSummary({ state, changes: ['/domains/scene/place/name'] }), 'to Bluewatch Village');
});

test('nothing, or only another module\'s changes', () => {
    const { state, before } = reply([]);
    assert.equal(changesSummary({ state, before, changes: [] }), 'No changes');
    assert.equal(changesSummary({ state, before, changes: ['/meta/rev'] }), 'No changes');
    assert.equal(changesSummary({ state, before, changes: ['/domains/director/time/minutes'] }), 'No item, coin or place changes');
    assert.equal(changesSummary(), 'No changes');
    assert.equal(changesSummary({ state: null, before: null, changes: new Set(['/domains/scene/place']) }), 'place cleared');
});

test('a digest can be passed in, and many people are counted', () => {
    const digest = { gained: [], lost: [], held: [], coin: null, coinNow: null, place: null, arrived: ['A', 'B', 'C', 'D'], left: [], presentNow: null, other: false };
    assert.equal(changesSummary({ digest }), 'A, B and 2 more arrived');
});
