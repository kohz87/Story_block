// Capture (§4.2, §4.4): item, coin, place and present lines run as story commands; names are
// resolved by alias with singular/plural tolerance, ambiguous names are rejected, never guessed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, line } from './helpers/fake-ctx.js';
import { CROWNS, core, def, stocked } from './fixtures.js';

function setup(hookMap, state) {
    const module = core(hookMap);
    return createHarness([module], { state: state ?? stocked(module) });
}

function rejected(h, change, code, pattern) {
    const before = h.state;
    const result = h.capture(change);
    assert.equal(result.ok, false, `${change.op} ${change.kind} ${change.name} should be rejected`);
    assert.equal(result.code, code, result.message);
    if (pattern) assert.match(result.message, pattern);
    assert.equal(h.state, before, 'nothing kept');
    return result;
}

const inv = h => h.state.domains.inventory;

test('+ item: a known name, plural or with an article, joins the stack', () => {
    const h = setup();
    for (const name of ['Rope', 'ropes', 'the Rope', 'ROPE']) {
        const result = h.capture(line('+', 'item', name));
        assert.equal(result.ok, true, result.message);
        assert.equal(result.result.data.def, 'story/rope', name);
        assert.equal(result.result.narrate, false);
    }
    assert.equal(inv(h).stacks.it_rope0001.qty, 7);
});

test('+ item: qty and note labels; the note may come after a dash', () => {
    const h = setup();
    const result = h.capture(line('+', 'item', 'Minor Healing Draughts', { qty: '2', note: 'cloudy' }));
    assert.equal(result.ok, true, result.message);
    assert.equal(inv(h).stacks.it_potb0001.qty, 3, 'joins the stack with the same note');
    const dashed = h.capture(line('+', 'item', 'Rope', {}, 'tarred, from the docks'));
    const [id] = dashed.result.data.stacks;
    assert.equal(inv(h).stacks[id].note, 'tarred, from the docks');
    const counted = h.capture(line('+', 'item', 'Rope', { QTY: 'x3' }));
    assert.equal(counted.result.data.qty, 3, 'labels are matched case-insensitively and "x3" reads as 3');
});

test('+ item: a new name creates story/<slug> with defaults, then the item.define hooks', () => {
    const seen = [];
    const hooks = {
        'item.define': [
            definition => { seen.push({ ...definition }); definition.rarity = 'rare'; },
            () => ({ kind: 'material', value: 12, id: 'evil/override' }),
        ],
    };
    const h = setup(hooks);
    const result = h.capture(line('+', 'item', 'Moonveil Trout', { qty: '1', note: 'violet-streaked, from the lake' }));
    assert.equal(result.ok, true, result.message);
    assert.equal(seen[0].id, 'story/moonveil-trout');
    assert.equal(seen[0].kind, 'goods');
    assert.equal(seen[0].rarity, 'common');
    assert.equal(seen[0].value, 0);
    const made = inv(h).defs['story/moonveil-trout'];
    assert.deepEqual(made, def('story/moonveil-trout', 'Moonveil Trout', { rarity: 'rare', kind: 'material', value: 12 }));
    assert.equal(inv(h).aliases['moonveil trout'], 'story/moonveil-trout');
    assert.equal(result.result.data.created, true);
    // The plural finds it again rather than making a second def.
    const again = h.capture(line('+', 'item', 'Moonveil Trouts'));
    assert.equal(again.result.data.def, 'story/moonveil-trout');
    assert.equal(again.result.data.created, false);
});

test('+ item: the item.define hooks get { note, owner }; equipment never stacks', () => {
    const seen = [];
    const h = setup({ 'item.define': [(definition, about) => { seen.push(about); return { kind: 'equipment', slot: 'head' }; }] });
    const result = h.capture(line('+', 'item', 'Iron Cap', { qty: '2', note: 'dented' }));
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(seen, [{ note: 'dented', owner: 'party' }]);
    assert.equal(inv(h).defs['story/iron-cap'].stack, false);
    assert.equal(result.result.data.stacks.length, 2);
});

test('+ item: a slug already taken by another name gets a suffix', () => {
    const module = core();
    const state = stocked(module);
    state.domains.inventory.defs['story/old-key'] = def('story/old-key', 'Cellar Key');
    state.domains.inventory.aliases['cellar key'] = 'story/old-key';
    const h = setup({}, state);
    const result = h.capture(line('+', 'item', 'Old Key'));
    assert.equal(result.ok, true, result.message);
    assert.equal(result.result.data.def, 'story/old-key-2');
});

test('+ item: a hook that breaks the def is rejected by the validator', () => {
    const h = setup({ 'item.define': [definition => { definition.rarity = 'mythic'; }] });
    rejected(h, line('+', 'item', 'Odd Stone'), 'INVALID', /unknown rarity "mythic"/);
});

test('+ item: ambiguous names are rejected, not guessed', () => {
    const module = core();
    const state = stocked(module);
    const defs = state.domains.inventory.defs;
    // Two defs named "Potion", the alias index pointing at one; and two named "Torch" with no alias.
    defs['story/potion'] = def('story/potion', 'Potion');
    defs['pack.fantasy/potion-red'] = def('pack.fantasy/potion-red', 'Potion');
    state.domains.inventory.aliases.potion = 'story/potion';
    defs['story/torch'] = def('story/torch', 'Torch');
    defs['pack.fantasy/torch'] = def('pack.fantasy/torch', 'Torch');
    const h = setup({}, state);
    assert.equal(h.capture(line('+', 'item', 'Potion')).result.data.def, 'story/potion', 'the exact alias wins');
    rejected(h, line('+', 'item', 'Potions'), 'INVALID', /"Potions" could mean Potion \(pack.fantasy\/potion-red\) or Potion \(story\/potion\)/);
    rejected(h, line('+', 'item', 'Torch'), 'INVALID', /"Torch" could mean Torch \(pack.fantasy\/torch\) or Torch \(story\/torch\)/);
    rejected(h, line('-', 'item', 'Torches'), 'INVALID', /could mean/);
    // An exact alias settles it: the alias index is authoritative.
    const aliased = structuredClone(h.state);
    aliased.domains.inventory.aliases.torch = 'story/torch';
    h.state = aliased;
    assert.equal(h.capture(line('+', 'item', 'Torch')).result.data.def, 'story/torch');
});

test('- item: takes from loose party stacks first; reports what is missing', () => {
    const h = setup();
    const result = h.capture(line('-', 'item', 'Minor Healing Draughts', { qty: '2' }));
    assert.equal(result.ok, true, result.message);
    assert.equal(result.result.summary, 'Lost Minor Healing Draught ×2 (1 left).');
    assert.equal(inv(h).stacks.it_pota0001, undefined);
    assert.equal(inv(h).stacks.it_potb0001.qty, 1);
    const one = h.capture(line('-', 'item', 'rope'));
    assert.equal(one.result.data.qty, 1, 'one by default');
    rejected(h, line('-', 'item', 'Rope', { qty: '5' }), 'NOT_ENOUGH', /only Rope ×2 left/);
    rejected(h, line('-', 'item', 'Golden Idol'), 'NOT_FOUND', /no Golden Idol/);
    rejected(h, line('-', 'item', 'Rope', { qty: 'some' }), 'INVALID', /not a quantity/);
    rejected(h, line('-', 'item', 'Rope', { qty: '0' }), 'INVALID');
    h.run('inventory.drop', { stack: 'it_lant0001' });
    rejected(h, line('-', 'item', 'Lantern'), 'NOT_FOUND', /no Lantern in the inventory/);
});

test('~ item: note, qty (0 removes) and rename', () => {
    const h = setup();
    const noted = h.capture(line('~', 'item', 'Rope', { note: 'frayed' }));
    assert.equal(noted.ok, true, noted.message);
    assert.equal(inv(h).stacks.it_rope0001.note, 'frayed');
    h.capture(line('~', 'item', 'Rope', { qty: '5' }));
    assert.equal(inv(h).stacks.it_rope0001.qty, 5);
    const renamed = h.capture(line('~', 'item', 'Rope', { name: 'Silk Rope' }));
    assert.equal(renamed.result.summary, 'Rope is now called Silk Rope.');
    const definition = inv(h).defs['story/rope'];
    assert.equal(definition.name, 'Silk Rope');
    assert.equal(definition.value, 0, 'a rename never changes value');
    assert.equal(inv(h).aliases['silk rope'], 'story/rope');
    assert.equal(inv(h).aliases.rope, 'story/rope', 'the old name still finds it');
    h.capture(line('~', 'item', 'silk ropes', { qty: '0' }));
    assert.equal(inv(h).stacks.it_rope0001, undefined);
});

test('~ item rejections', () => {
    const h = setup();
    rejected(h, line('~', 'item', 'Minor Healing Draught', { note: 'x' }), 'INVALID', /several lots/);
    rejected(h, line('~', 'item', 'Rope'), 'INVALID', /changes nothing/);
    rejected(h, line('~', 'item', 'Rope', { name: 'Iron Sword' }), 'REFUSED', /already the name of another item/);
    rejected(h, line('~', 'item', 'Lantern', { qty: '2' }), 'REFUSED', /does not stack/);
    rejected(h, line('~', 'item', 'Golden Idol', { note: 'x' }), 'NOT_FOUND');
    h.run('inventory.drop', { stack: 'it_rope0001' });
    rejected(h, line('~', 'item', 'Rope', { note: 'x' }), 'NOT_FOUND', /no Rope/);
});

test('item lines with other ops or no name are rejected', () => {
    const h = setup();
    rejected(h, line('!', 'item', 'Rope'), 'INVALID', /use \+, - or ~/);
    rejected(h, line('?', 'item', 'Rope'), 'INVALID');
    rejected(h, line('+', 'item', '  '), 'INVALID', /needs the item's name/);
    rejected(h, line('+', 'item', 'x'.repeat(121)), 'INVALID', /1 to 120/);
});

test('+ coin / - coin: only the number counts, in the chat currency', () => {
    const h = setup();
    const got = h.capture(line('+', 'coin', '30', { from: 'the sealer' }));
    assert.equal(got.ok, true, got.message);
    assert.equal(got.result.summary, 'The party receives 30 gold — from the sealer (now 155 gold).');
    assert.equal(got.result.narrate, false);
    const paid = h.capture(line('-', 'coin', '5 silver coins', { to: 'the ferryman' }));
    assert.equal(paid.result.summary, 'The party pays 5 gold — to the ferryman (150 gold left).', 'coin words are ignored');
    assert.equal(inv(h).wallets.party.coin, 150);
    const labelled = h.capture(line('+', 'coin', 'reward', { amount: '12' }));
    assert.equal(labelled.result.data.amount, 12);
    rejected(h, line('-', 'coin', '163'), 'NOT_ENOUGH', /only 162 gold; 163 gold is needed/);
    rejected(h, line('+', 'coin', '3 silver, 8 copper'), 'INVALID', /more than one number/);
    rejected(h, line('+', 'coin', 'a few'), 'INVALID', /No amount/);
    rejected(h, line('+', 'coin', '0'), 'INVALID', /more than nothing/);
    rejected(h, line('~', 'coin', '3'), 'INVALID', /use \+ coin or - coin/);
});

test('+ coin with a renamed currency', () => {
    const module = core();
    const h = createHarness([module], { state: stocked(module), settings: { 'story-block': CROWNS } });
    const got = h.capture(line('+', 'coin', '30 gold'));
    assert.equal(got.result.summary, 'The party receives 30 crowns (now 155 crowns).');
});

test('an item named exactly the currency (singular or plural) is coin in the wallet, not an item', () => {
    const module = core();
    const h = createHarness([module], { state: stocked(module), settings: { 'story-block': { currency: 'mark', currencyShort: 'mk' } } });
    const defs = Object.keys(inv(h).defs).length;
    const stacks = Object.keys(inv(h).stacks).length;
    const plural = h.capture(line('+', 'item', 'Marks', { qty: '44', from: 'the reeve' }));
    assert.equal(plural.ok, true, plural.message);
    assert.equal(plural.result.summary, 'The party receives 44 marks — from the reeve (now 169 marks).');
    const one = h.capture(line('+', 'item', 'mark'));
    assert.equal(one.result.summary, 'The party receives 1 mark (now 170 marks).');
    const paid = h.capture(line('-', 'item', 'marks', { qty: '20', to: 'the ferryman' }));
    assert.equal(paid.result.summary, 'The party pays 20 marks — to the ferryman (150 marks left).');
    assert.equal(inv(h).wallets.party.coin, 150);
    assert.equal(Object.keys(inv(h).defs).length, defs, 'no item called Marks was made');
    assert.equal(Object.keys(inv(h).stacks).length, stacks);
    rejected(h, line('-', 'item', 'Mark', { qty: '151' }), 'NOT_ENOUGH', /only 150 marks; 151 marks is needed/);
    rejected(h, line('~', 'item', 'marks', { note: 'shiny' }), 'INVALID', /money, not an item/);
    rejected(h, line('+', 'item', 'marks', { qty: 'lots' }), 'INVALID', /not a quantity/);
    // Only the exact name: an item that merely holds the word stays an item.
    const map = h.capture(line('+', 'item', 'Marked Map'));
    assert.equal(map.ok, true, map.message);
    assert.equal(map.result.data.created, true);
    // The default currency too: "+ item Gold" is 1 gold, "+ item Gold Bar" an item.
    const plain = setup();
    assert.equal(plain.capture(line('+', 'item', 'Gold', { qty: '3' })).result.summary, 'The party receives 3 gold (now 128 gold).');
    assert.equal(plain.capture(line('+', 'item', 'Gold Bar')).result.data.created, true);
});

test('~ place sets the place; a move clears the kind but keeps the region', () => {
    const h = setup();
    const result = h.capture(line('~', 'place', 'Bluewatch Village', { kind: 'settlement', region: 'Lakeshire' }));
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(h.state.domains.scene.place, { name: 'Bluewatch Village', kind: 'settlement', region: 'Lakeshire' });
    assert.equal(result.result.summary, 'The scene moves to Bluewatch Village.');
    assert.equal(result.result.narrate, false);
    h.capture(line('~', 'place', 'bluewatch village', { region: 'North Lakeshire' }));
    assert.equal(h.state.domains.scene.place.kind, 'settlement', 'the same place keeps its kind');
    h.capture(line('+', 'place', 'Drowned Crypt'));
    assert.deepEqual(h.state.domains.scene.place, { name: 'Drowned Crypt', kind: '', region: 'North Lakeshire' });
    rejected(h, line('-', 'place', 'Drowned Crypt'), 'INVALID', /use ~ place/);
    rejected(h, line('~', 'place', ''), 'INVALID', /needs a name/);
    rejected(h, line('~', 'place', 'x'.repeat(81)), 'INVALID', /longer than 80/);
});

test('+ present / - present', () => {
    const h = setup();
    const came = h.capture(line('+', 'present', 'Fenna, Old Tam'));
    assert.equal(came.ok, true, came.message);
    assert.deepEqual(h.state.domains.scene.present, ['Fenna', 'Old Tam']);
    assert.equal(came.result.summary, 'Fenna, Old Tam are here.');
    const again = h.capture(line('+', 'present', 'fenna'));
    assert.equal(again.ok, true, 'someone already here is not an error');
    assert.deepEqual(h.state.domains.scene.present, ['Fenna', 'Old Tam']);
    const left = h.capture(line('-', 'present', 'FENNA'));
    assert.equal(left.result.summary, 'Fenna leaves.');
    assert.deepEqual(h.state.domains.scene.present, ['Old Tam']);
    // Someone the story says leaves who is not here (left behind by a move): nothing to change, not refused.
    const gone = h.capture(line('-', 'present', 'Fenna'));
    assert.equal(gone.ok, true, gone.message);
    assert.equal(gone.result.summary, 'Fenna is not here.');
    assert.deepEqual(gone.result.data.missing, ['Fenna']);
    assert.deepEqual(h.state.domains.scene.present, ['Old Tam']);
    rejected(h, line('~', 'present', 'Old Tam'), 'INVALID', /use \+ present or - present/);
    rejected(h, line('+', 'present', ' , '), 'INVALID', /needs a name/);
});

test('a move leaves everyone behind but who came along (| with:); the same place keeps them', () => {
    const h = setup();
    h.capture(line('~', 'place', 'Inspection Quay', { kind: 'dock' }));
    h.capture(line('+', 'present', 'Marrit, Fenna'));
    assert.deepEqual(h.state.domains.scene.present, ['Marrit', 'Fenna']);

    // Described anew: nobody leaves.
    const same = h.capture(line('~', 'place', 'inspection quay', { region: 'Bluewatch' }));
    assert.equal(same.ok, true, same.message);
    assert.deepEqual(h.state.domains.scene.present, ['Marrit', 'Fenna']);

    // A move with Fenna along: Marrit stays at the quay; a newcomer is added after the move.
    const moved = h.capture(line('~', 'place', 'Bluewatch Village', { kind: 'settlement', with: 'fenna, Lyra' }));
    assert.equal(moved.ok, true, moved.message);
    assert.equal(moved.result.summary, 'The scene moves to Bluewatch Village with fenna, Lyra.');
    assert.deepEqual(moved.result.data.left, ['Marrit']);
    assert.deepEqual(h.state.domains.scene.present, ['Fenna', 'Lyra'], 'Fenna keeps her spelling; Lyra came along');
    h.capture(line('+', 'present', 'Old Tam'));
    assert.deepEqual(h.state.domains.scene.present, ['Fenna', 'Lyra', 'Old Tam']);

    // A move with no one named: the scene starts empty there.
    const alone = h.capture(line('~', 'place', 'East Bluff'));
    assert.deepEqual(alone.result.data.left, ['Fenna', 'Lyra', 'Old Tam']);
    assert.deepEqual(h.state.domains.scene.present, []);
    // "Marrit stays behind" after the move is no refusal.
    assert.equal(h.capture(line('-', 'present', 'Marrit')).ok, true);

    rejected(h, line('~', 'place', 'Weir', { with: 'x'.repeat(81) }), 'INVALID', /at most 80/);
    assert.deepEqual(h.state.domains.scene.place.name, 'East Bluff', 'nothing is saved on a refusal');
});

test('an unknown kind handed to the module is rejected', () => {
    const module = core();
    const h = createHarness([module], { state: stocked(module) });
    const result = h.capture({ ...line('+', 'item', 'Rope'), kind: 'item' });
    assert.equal(result.ok, true);
    const ctx = { fail: (code, message) => { throw Object.assign(new Error(message), { code }); } };
    assert.throws(() => module.capture.apply(ctx, line('+', 'wound', 'Ren')), /does not handle "wound"/);
});
