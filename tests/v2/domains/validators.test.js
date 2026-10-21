// Domain validators (§2.5) and initial slices (§2.6).
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateInventory, initialInventory } from '../../../src/v2/domains/inventory.js';
import { validateScene, initialScene } from '../../../src/v2/domains/scene.js';
import { stocked } from './fixtures.js';

const fresh = () => structuredClone(stocked().domains.inventory);
function errorsAfter(change) {
    const slice = fresh();
    change(slice);
    return validateInventory(slice);
}

test('initial slices are valid and plain JSON', () => {
    assert.deepEqual(initialInventory(), { defs: {}, stacks: {}, wallets: {}, aliases: {} });
    assert.deepEqual(initialScene(), { place: { name: '', kind: '', region: '' }, present: [] });
    assert.deepEqual(validateInventory(initialInventory()), []);
    assert.deepEqual(validateScene(initialScene()), []);
    assert.deepEqual(validateInventory(fresh()), []);
});

test('inventory: the slice and its records must be records', () => {
    assert.deepEqual(validateInventory(null), ['The inventory is not a record.']);
    assert.deepEqual(validateInventory({ defs: {}, stacks: [], wallets: {} }), ['The inventory has no stacks record.', 'The inventory has no aliases record.']);
});

test('inventory: stacks hold a whole number of at least 1', () => {
    for (const qty of [0, -1, 1.5, NaN, Infinity, '2', null]) {
        const errors = errorsAfter(slice => { slice.stacks.it_rope0001.qty = qty; });
        assert.match(errors.join(' '), /Rope has quantity .*whole number of at least 1/, String(qty));
    }
    assert.match(errorsAfter(slice => { slice.stacks.it_lant0001.qty = 2; }).join(' '), /Lantern does not stack/);
});

test('inventory: stacks are keyed by ID and refer to existing defs', () => {
    assert.match(errorsAfter(slice => { slice.stacks.it_rope0001.id = 'it_other001'; }).join(' '), /filed under the wrong ID/);
    assert.match(errorsAfter(slice => { slice.stacks.Rope = { ...slice.stacks.it_rope0001, id: 'Rope' }; }).join(' '), /"Rope" is not a well-formed item stack ID/);
    assert.match(errorsAfter(slice => { slice.stacks.it_rope0001.def = 'story/ghost'; }).join(' '), /does not exist \(story\/ghost\)/);
    assert.match(errorsAfter(slice => { slice.stacks.it_rope0001.owner = 'Ren'; }).join(' '), /neither the party nor an actor/);
    assert.match(errorsAfter(slice => { slice.stacks.it_rope0001.note = null; }).join(' '), /note that is not text/);
    assert.match(errorsAfter(slice => { slice.stacks.it_rope0001.from = 3; }).join(' '), /origin/);
    assert.match(errorsAfter(slice => { slice.stacks.it_bad = 'x'; }).join(' '), /not a record/);
});

test('inventory: an equipped slot only on equipment, one item per slot and owner', () => {
    assert.match(errorsAfter(slice => { slice.stacks.it_rope0001.equipped = 'hand'; }).join(' '), /Rope is worn in "hand" but is not equipment/);
    assert.match(errorsAfter(slice => { slice.stacks.it_sword001.equipped = ''; }).join(' '), /equipped slot that is neither empty nor a name/);
    assert.match(errorsAfter(slice => {
        slice.stacks.it_sword001.equipped = 'hand';
        slice.stacks.it_dagg0001.equipped = 'hand';
    }).join(' '), /same slot "hand"/);
    assert.deepEqual(errorsAfter(slice => {
        slice.stacks.it_sword001.equipped = 'hand';
        slice.stacks.it_dagg0001.equipped = 'hand';
        slice.stacks.it_dagg0001.owner = 'ac_ren00001';
    }), [], 'different owners may each use a hand');
});

test('inventory: defs are keyed by ID and well-formed', () => {
    const cases = [
        [slice => { slice.defs['story/rope'].id = 'story/cord'; }, /filed under the wrong ID/],
        [slice => { slice.defs.Rope = { ...slice.defs['story/rope'], id: 'Rope' }; }, /not a well-formed item definition ID/],
        [slice => { slice.defs['story/rope'].name = ' '; }, /needs a name/],
        [slice => { slice.defs['story/rope'].kind = 'food'; }, /unknown kind "food"/],
        [slice => { slice.defs['story/rope'].rarity = 'mythic'; }, /unknown rarity/],
        [slice => { slice.defs['story/rope'].value = -1; }, /value that is not a whole number/],
        [slice => { slice.defs['story/rope'].stack = 'yes'; }, /whether it stacks/],
        [slice => { slice.defs['story/rope'].slot = ''; }, /slot that is neither/],
        [slice => { slice.defs['story/rope'].stats = []; }, /stats that are not a record/],
        [slice => { slice.defs['story/rope'].effect = null; }, /effect that is not a record/],
        [slice => { slice.defs['story/rope'].tags = [1]; }, /tags that are not a list/],
        [slice => { slice.defs['story/rope'].note = 0; }, /note that is not text/],
        [slice => { slice.defs['story/rope'] = 7; }, /not a record/],
    ];
    for (const [change, pattern] of cases) assert.match(errorsAfter(change).join(' '), pattern);
});

test('inventory: wallets are whole numbers of at least 0 per owner', () => {
    assert.deepEqual(errorsAfter(slice => { slice.wallets.party.coin = 0; }), []);
    assert.match(errorsAfter(slice => { slice.wallets.party.coin = -1; }).join(' '), /holds -1 coin/);
    assert.match(errorsAfter(slice => { slice.wallets.party.coin = 2.5; }).join(' '), /whole number of at least 0/);
    assert.match(errorsAfter(slice => { slice.wallets.Ren = { coin: 1 }; }).join(' '), /belongs to "Ren"/);
    assert.match(errorsAfter(slice => { slice.wallets.party = 5; }).join(' '), /wallet of party is not a record/);
    assert.match(errorsAfter(slice => { slice.wallets.party[' '] = 1; }).join(' '), /currency with no name/);
});

test('inventory: aliases are lowercase and point to defs', () => {
    assert.match(errorsAfter(slice => { slice.aliases.Rope = 'story/rope'; }).join(' '), /not written in lowercase/);
    assert.match(errorsAfter(slice => { slice.aliases.cord = 'story/cord'; }).join(' '), /points to a definition that does not exist/);
});

test('scene validator', () => {
    const ok = { place: { name: 'Bluewatch', kind: 'settlement', region: '' }, present: ['Fenna'] };
    assert.deepEqual(validateScene(ok), []);
    assert.deepEqual(validateScene(null), ['The scene is not a record.']);
    assert.match(validateScene({ ...ok, place: null }).join(' '), /no place record/);
    assert.match(validateScene({ ...ok, place: { ...ok.place, kind: 3 } }).join(' '), /kind is not text/);
    assert.match(validateScene({ ...ok, place: { ...ok.place, name: 'x'.repeat(81) } }).join(' '), /longer than 80/);
    assert.match(validateScene({ ...ok, present: 'Fenna' }).join(' '), /no list of who is present/);
    assert.match(validateScene({ ...ok, present: ['Fenna', 'fenna'] }).join(' '), /present twice/);
    assert.match(validateScene({ ...ok, present: [''] }).join(' '), /has no name/);
    assert.match(validateScene({ ...ok, present: ['x'.repeat(81)] }).join(' '), /longer than 80/);
    assert.match(validateScene({ ...ok, present: Array.from({ length: 41 }, (_, i) => `P${i}`) }).join(' '), /At most 40/);
});

test('a command whose result breaks a validator is rejected whole', async () => {
    const { createHarness } = await import('./helpers/fake-ctx.js');
    const { core } = await import('./fixtures.js');
    const module = core({ 'item.define': [definition => { definition.kind = 'food'; }] });
    const h = createHarness([module], { state: stocked(module) });
    const before = h.state;
    const result = h.run('inventory.grant', { name: 'Bread' }, { cause: 'story' });
    assert.equal(result.code, 'INVALID');
    assert.match(result.message, /unknown kind "food"/);
    assert.equal(h.state, before);
});
