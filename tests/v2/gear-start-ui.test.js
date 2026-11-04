// Hand-set gear, the screens (docs/v2/GEAR.md "Your own gear"): "+ Add item" opens the grouped form (Item; Gear when Kind is Equipment) with the live points line,
// the starting kit hint, the equal-width groups; Edit of a piece the reader added shows the same fields (read-only Rarity and Bonus after the first message), a pack
// item gets its hint, bound gear stays as it was. The form data and plans are tested as plain data, then drawn by the real template renderer over a real host.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, hostAvailable } from '../../testkit/index.js';
import { inventoryScreen } from '../../src/v2/screens/index.js';
import { addFields, addPlan, editFields, editPlan } from '../../src/v2/view/gear-form.js';
import { validatePack } from '../../src/v2/packs/validate.js';
import { pack } from './packs/helpers/fixtures.js';
import { show, settle, text } from './screens/helpers.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const ACTORS = { id: 'zz-party', version: '0.0.0', queries: { 'party.actors': () => [{ id: 'ac_astra001', name: 'Astra', pc: true }, { id: 'ac_harrak01', name: 'Harrak' }], 'party.pc': () => ({ id: 'ac_astra001' }) } };
const OWNERS = [{ value: 'ac_astra001', label: 'Astra (you)' }, { value: 'ac_harrak01', label: 'Harrak' }];

async function world(t, { packs = false } = {}) {
    t.mock.method(console, 'warn', () => {});
    const settings = { features: { 'story-block.gear': true, 'story-block.rpg': true } };
    if (packs) {
        const raw = pack({ content: { items: [{ name: 'Rain-Veil Hood', kind: 'equipment', slot: 'head', rarity: 'rare' }] } });
        const built = validatePack(raw);
        settings.packs = [{ id: built.pack.id, version: built.pack.version, enabled: true, source: 'file', origin: 'test', pack: raw }];
    }
    const host = await createHost({ modules: [ACTORS], settings });
    t.after(() => host.close());
    return host;
}
const draw = host => show(inventoryScreen, { state: host.head(), query: host.sdk.query, command: (type, payload, opts) => host.sdk.command(type, payload, opts) });
const labelled = (el, name) => el.querySelectorAll('label').find(node => node.querySelector('span')?.textContent === name)?.querySelector('input, select');
const change = (node, value) => { node.value = value; node.dispatch('change'); };
const openAdd = el => { el.querySelector('.ss-w-inventory-add button').click(); return el.querySelector('.ss-w-editable-form'); };
const groups = el => el.querySelectorAll('fieldset.ss-w-editable-group').map(node => ({ name: node.querySelector('legend')?.textContent, hidden: node.hidden }));
const rowOf = (el, name) => el.querySelectorAll('li.item').find(item => item.querySelector('.name')?.textContent === name);

test('addFields: Item (Name, Count, Kind, Note) and Gear (Slot, Rarity, Bonus, points, Equip on) in the starting kit; after it Rarity is disabled, Bonus left out, a hint added', () => {
    const open = addFields({ kit: true, owners: OWNERS });
    assert.deepEqual(open.filter(f => f.group === 'Item').map(f => f.key), ['name', 'count', 'kind', 'note']);
    assert.deepEqual(open.filter(f => f.group === 'Gear').map(f => f.key), ['slot', 'rarity', 'stat1', 'points1', 'stat2', 'points2', 'budget', 'equip']);
    assert.deepEqual(open.find(f => f.key === 'kind').options.map(o => o.label), ['Equipment', 'Consumables', 'Goods', 'Quest items', 'Materials']);
    assert.deepEqual(open.find(f => f.key === 'rarity').options.map(o => o.label), ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary']);
    assert.deepEqual(open.find(f => f.key === 'slot').options.map(o => o.label), ['None', 'Head', 'Body', 'Cloak', 'Feet', 'Weapon', 'Off-hand', 'Accessory 1', 'Accessory 2']);
    assert.deepEqual(open.find(f => f.key === 'equip').options.map(o => o.label), ['None', 'Astra (you)', 'Harrak']);
    assert.equal(open.find(f => f.key === 'rarity').disabled, undefined);
    const later = addFields({ kit: false, owners: OWNERS });
    assert.deepEqual(later.filter(f => f.group === 'Gear').map(f => f.key), ['slot', 'rarity', 'equip', 'later', 'copy']);
    assert.equal(later.find(f => f.key === 'rarity').disabled, true);
    assert.equal(later.find(f => f.key === 'later').text, 'Rarity and bonuses come from the story after the first message.');
});

test('addPlan: one inventory.add; equipment sends slot, rarity, bonus and Equip on; the closed kit sends no rarity or bonus; other kinds send none of them', () => {
    const plan = addPlan({ kit: true });
    const all = { name: ' Wolfskin Cap ', count: 1, kind: 'equipment', note: '', slot: 'head', rarity: 'rare', stat1: 'VIT', points1: 1, stat2: 'AGI', points2: 1, equip: 'ac_astra001' };
    assert.deepEqual(plan({}, all).steps, [{ command: 'inventory.add', payload: { name: 'Wolfskin Cap', qty: 1, kind: 'equipment', slot: 'head', rarity: 'rare', stats: { VIT: 1, AGI: 1 }, equip: 'ac_astra001' }, keys: Object.keys(all) }]);
    assert.deepEqual(plan({}, { ...all, kind: 'goods' }).steps[0].payload, { name: 'Wolfskin Cap', qty: 1, kind: 'goods' });
    assert.deepEqual(addPlan({ kit: false })({}, all).steps[0].payload, { name: 'Wolfskin Cap', qty: 1, kind: 'equipment', slot: 'head', equip: 'ac_astra001' });
    assert.match(plan({}, { ...all, name: ' ' }).error, /Give the item a name/);
    assert.match(plan({}, { ...all, count: 0 }).error, /whole number of at least 1/);
    assert.match(plan({}, { ...all, points1: null }).error, /at most 2 different stats/, 'a stat without points');
});

test('editFields / editPlan: the item\'s own words, then who wears it', () => {
    const p = { value: 'Lucky Bone Ring', itemCount: 1, itemNote: '', gear: { kind: 'equipment', rarity: 'rare', stack: 'it_1', owner: 'party', by: '', place: '', def: 'story/lucky-bone-ring', kit: true, owners: OWNERS, row: { hand: true, defSlot: 'accessory-1', stats: { LUK: 2 } } } };
    const fields = editFields(p);
    assert.equal(fields.find(f => f.key === 'stat1').value, 'LUK');
    assert.equal(fields.find(f => f.key === 'points1').value, 2);
    assert.equal(fields.find(f => f.key === 'slot').value, 'accessory-1');
    assert.equal(fields.some(f => f.key === 'later'), false, 'the kit is open');
    const plan = editPlan(p);
    const all = { name: 'Lucky Bone Ring', count: 1, note: 'carved', kind: 'equipment', slot: 'accessory-1', rarity: 'rare', stat1: 'LUK', points1: 2, stat2: '', points2: null, by: 'ac_astra001' };
    const steps = plan({ note: 'carved', by: 'ac_astra001' }, all).steps;
    assert.deepEqual(steps.map(step => [step.command, step.payload]), [
        ['inventory.edit', { stack: 'it_1', group: true, note: 'carved' }],
        ['item.equip', { stack: 'it_1', owner: 'ac_astra001', slot: 'accessory-1', transfer: true }],
    ]);
    assert.deepEqual(plan({ rarity: 'epic', stat1: 'STR', points1: 3 }, { ...all, rarity: 'epic', stat1: 'STR', points1: 3, by: '' }).steps.map(step => step.payload),
        [{ stack: 'it_1', group: true, rarity: 'epic', stats: { STR: 3 } }]);
    // closed kit: Rarity and Bonus are disabled and show what is
    const later = editFields({ ...p, gear: { ...p.gear, kit: false } });
    assert.deepEqual(['rarity', 'stat1', 'points1', 'stat2', 'points2'].map(key => later.find(f => f.key === key).disabled), [true, true, true, true, true]);
    assert.equal(later.some(f => f.key === 'budget'), false);
    assert.equal(later.find(f => f.key === 'later').text, 'Rarity and bonuses come from the story after the first message.');
});

test('"+ Add item", starting kit: opens the grouped form with the hint; the Gear group shows only for Equipment; the points line is live and turns over-budget', { skip }, async t => {
    const host = await world(t);
    const { el } = draw(host);
    const form = openAdd(el);
    assert.ok(form, 'the form is open');
    assert.equal(el.querySelector('.ss-w-inventory-add > button').hidden, true, 'the button gives way to the form');
    assert.equal(text(form.querySelector('.ss-w-editable-intro')), 'Starting kit: rarity and bonuses can be set until your first message. Starting kit belongs to this greeting.');
    assert.deepEqual(groups(el), [{ name: 'Item', hidden: false }, { name: 'Gear', hidden: true }], 'Kind is not Equipment yet');
    change(labelled(el, 'Kind'), 'equipment');
    assert.deepEqual(groups(el), [{ name: 'Item', hidden: false }, { name: 'Gear', hidden: false }]);
    const line = el.querySelector('.ss-w-editable-points');
    assert.equal(text(line), 'A common piece has no bonus');
    change(labelled(el, 'Rarity'), 'rare');
    assert.equal(text(line), '0 of 2 points for a rare piece');
    const stat = el.querySelectorAll('label').filter(node => node.querySelector('span')?.textContent === 'Bonus')[0].querySelector('select');
    const points = el.querySelectorAll('label').filter(node => node.querySelector('span')?.textContent === 'Points')[0].querySelector('input');
    change(stat, 'VIT'); change(points, '1');
    assert.equal(text(line), '1 of 2 points for a rare piece');
    assert.equal(line.classList.contains('ss-w-editable-over'), false);
    change(points, '3');
    assert.equal(text(line), '3 of 2 points for a rare piece');
    assert.equal(line.classList.contains('ss-w-editable-over'), true, 'over budget turns the line red');
    change(labelled(el, 'Rarity'), 'epic');
    assert.equal(text(line), '3 of 3 points for an epic piece');
    assert.equal(line.classList.contains('ss-w-editable-over'), false);
    change(labelled(el, 'Kind'), 'goods');
    assert.equal(groups(el)[1].hidden, true, 'back to Goods: no Gear group');
});

test('"+ Add item": Save adds the piece, puts it on and closes; an over-budget Bonus shows the command\'s sentence, keeps the form open and adds nothing', { skip }, async t => {
    const host = await world(t);
    const view = draw(host);
    const { el } = view;
    openAdd(el);
    labelled(el, 'Name').value = 'Wolfskin Cap';
    change(labelled(el, 'Kind'), 'equipment');
    change(labelled(el, 'Slot'), 'head');
    change(labelled(el, 'Rarity'), 'rare');
    const boxes = which => el.querySelectorAll('label').filter(node => node.querySelector('span')?.textContent === which).map(node => node.querySelector('input, select'));
    change(boxes('Bonus')[0], 'VIT'); change(boxes('Points')[0], '2');
    change(boxes('Stat')[0], 'AGI'); change(boxes('Points')[1], '1');
    change(labelled(el, 'Equip on'), 'ac_astra001');
    el.querySelector('.ss-w-editable-save').click();
    await settle();
    assert.equal(text(el.querySelector('.ss-w-editable-error')), 'A rare piece gives at most 2 points.');
    assert.ok(el.querySelector('.ss-w-editable-form'), 'the form stays open');
    assert.equal(host.sdk.query('inventory.items').some(item => item.name === 'Wolfskin Cap'), false);
    change(boxes('Points')[0], '1');
    el.querySelector('.ss-w-editable-save').click();
    await settle();
    const cap = host.sdk.query('inventory.items').find(item => item.name === 'Wolfskin Cap');
    assert.deepEqual([cap.rarity, cap.equipped, cap.owner], ['rare', 'head', 'ac_astra001']);
    assert.deepEqual(host.sdk.query('gear.view').rows[cap.stack].stats, { VIT: 1, AGI: 1 });
    assert.equal(el.querySelector('.ss-w-editable-form'), null, 'closed');
    assert.equal(el.querySelector('.ss-w-inventory-add > button').hidden, false, 'the button is back');
    assert.deepEqual(view.calls.map(([type]) => type), ['inventory.add', 'inventory.add']);
});

test('"+ Add item" after the first message: Rarity is Common and disabled, there is no Bonus, the hint says why; Save still adds and puts it on', { skip }, async t => {
    const host = await world(t);
    await host.send('Hello.', 'The road.');
    const { el, calls } = draw(host);
    const form = openAdd(el);
    assert.equal(form.querySelector('.ss-w-editable-intro'), null, 'no starting-kit line');
    change(labelled(el, 'Kind'), 'equipment');
    const rarity = labelled(el, 'Rarity');
    assert.deepEqual([rarity.value, rarity.disabled], ['common', true]);
    assert.equal(el.querySelectorAll('label').some(node => node.querySelector('span')?.textContent === 'Bonus'), false);
    assert.equal(el.querySelector('.ss-w-editable-points'), null);
    assert.equal(text(el.querySelector('.ss-w-editable-note')), 'Rarity and bonuses come from the story after the first message.');
    labelled(el, 'Name').value = 'Forgotten Coat';
    change(labelled(el, 'Slot'), 'body');
    change(labelled(el, 'Equip on'), 'ac_astra001');
    el.querySelector('.ss-w-editable-save').click();
    await settle();
    assert.deepEqual(calls.map(([type, payload]) => [type, payload]), [['inventory.add', { name: 'Forgotten Coat', qty: 1, kind: 'equipment', slot: 'body', equip: 'ac_astra001' }]]);
    assert.equal(host.sdk.query('inventory.items').find(item => item.name === 'Forgotten Coat').equipped, 'body');
});

test('"+ Add item": an empty name is refused in the form; Cancel and Escape close it', { skip }, async t => {
    const host = await world(t);
    const { el, calls } = draw(host);
    openAdd(el);
    el.querySelector('.ss-w-editable-save').click();
    await settle();
    assert.equal(text(el.querySelector('.ss-w-editable-error')), 'Give the item a name.');
    assert.deepEqual(calls, []);
    el.querySelector('.ss-w-editable-cancel').click();
    assert.equal(el.querySelector('.ss-w-editable-form'), null);
    openAdd(el);
    el.querySelector('.ss-w-editable-form').dispatch('keydown', { key: 'Escape' });
    assert.equal(el.querySelector('.ss-w-editable-form'), null);
});

test('Edit of a piece the reader added, starting kit: the same groups with its values; a changed Rarity and Bonus save through inventory.edit', { skip }, async t => {
    const host = await world(t);
    await host.sdk.command('inventory.add', { name: 'Lucky Bone Ring', qty: 1, kind: 'equipment', slot: 'accessory-1', rarity: 'uncommon', stats: { LUK: 1 } });
    const { el, calls } = draw(host);
    const row = rowOf(el, 'Lucky Bone Ring');
    row.querySelector('.ss-w-editable-pencil').click();
    assert.equal(text(row.querySelector('.ss-w-editable-intro')), 'Starting kit: rarity and bonuses can be set until your first message. Starting kit belongs to this greeting.');
    assert.deepEqual(groups(row), [{ name: 'Item', hidden: false }, { name: 'Gear', hidden: false }]);
    assert.deepEqual(['Name', 'Count', 'Kind', 'Note', 'Slot', 'Rarity', 'Equipped by'].map(name => labelled(row, name).value), ['Lucky Bone Ring', '1', 'equipment', '', 'accessory-1', 'uncommon', '']);
    assert.equal(row.querySelectorAll('label').filter(node => node.querySelector('span')?.textContent === 'Bonus')[0].querySelector('select').value, 'LUK');
    change(labelled(row, 'Rarity'), 'rare');
    row.querySelectorAll('label').filter(node => node.querySelector('span')?.textContent === 'Points')[0].querySelector('input').value = '2';
    row.querySelector('.ss-w-editable-save').click();
    await settle();
    assert.deepEqual(calls.map(([type, payload]) => [type, payload.rarity, payload.stats]), [['inventory.edit', 'rare', { LUK: 2 }]]);
    const def = Object.values(host.head().domains.inventory.defs).find(item => item.name === 'Lucky Bone Ring');
    assert.deepEqual([def.rarity, def.stats], ['rare', { LUK: 2 }]);
});

test('Edit after the first message: Rarity and Bonus are disabled with the hint; Kind, Slot and Equipped by still save', { skip }, async t => {
    const host = await world(t);
    await host.sdk.command('inventory.add', { name: 'Wolfskin Cap', qty: 1, kind: 'equipment', slot: 'head', rarity: 'rare', stats: { VIT: 1, AGI: 1 } });
    await host.send('Hello.', 'The road.');
    const { el, calls } = draw(host);
    const row = rowOf(el, 'Wolfskin Cap');
    row.querySelector('.ss-w-editable-pencil').click();
    assert.equal(row.querySelector('.ss-w-editable-intro'), null);
    assert.equal(text(row.querySelector('.ss-w-editable-note')), 'Rarity and bonuses come from the story after the first message.');
    assert.deepEqual([labelled(row, 'Rarity').disabled, labelled(row, 'Rarity').value], [true, 'rare']);
    const selects = row.querySelectorAll('select').filter(node => ['Bonus', 'Stat'].includes(node.getAttribute('aria-label')));
    assert.deepEqual(selects.map(node => [node.value, node.disabled]), [['VIT', true], ['AGI', true]]);
    assert.equal(row.querySelector('.ss-w-editable-points'), null);
    change(labelled(row, 'Equipped by'), 'ac_astra001');
    row.querySelector('.ss-w-editable-save').click();
    await settle();
    assert.deepEqual(calls.map(([type, payload]) => [type, payload.owner, payload.slot]), [['item.equip', 'ac_astra001', 'head']]);
    assert.equal(host.sdk.query('inventory.items').find(item => item.name === 'Wolfskin Cap').equipped, 'head');
});

test('Edit: Kind changed to Goods on a hand-added piece leaves out the Gear group and saves the kind', { skip }, async t => {
    const host = await world(t);
    await host.sdk.command('inventory.add', { name: 'Wolfskin Cap', qty: 1, kind: 'equipment', slot: 'head' });
    const { el, calls } = draw(host);
    const row = rowOf(el, 'Wolfskin Cap');
    row.querySelector('.ss-w-editable-pencil').click();
    change(labelled(row, 'Kind'), 'goods');
    assert.deepEqual(groups(row), [{ name: 'Item', hidden: false }, { name: 'Gear', hidden: true }]);
    row.querySelector('.ss-w-editable-save').click();
    await settle();
    assert.deepEqual(calls.map(([type, payload]) => [type, payload.kind]), [['inventory.edit', 'goods']]);
    assert.equal(host.sdk.query('inventory.items').find(item => item.name === 'Wolfskin Cap').kind, 'goods');
});

test('Edit of a pack item keeps today\'s form (Slot, Equipped by) with one hint; the story\'s item has no hint; a hand-added piece has the grouped form, not the three boxes', { skip }, async t => {
    const host = await world(t, { packs: true });
    await host.sdk.command('inventory.add', { name: 'Rain-Veil Hood', qty: 1 });
    await host.sdk.command('inventory.add', { name: 'Lucky Bone Ring', qty: 1, kind: 'goods' });
    await host.send('Hello.', '+ item Cane Sword | rarity: rare');
    const { el } = draw(host);
    const hood = rowOf(el, 'Rain-Veil Hood');
    hood.querySelector('.ss-w-editable-pencil').click();
    assert.deepEqual(hood.querySelectorAll('select').map(node => node.getAttribute('aria-label')), ['Slot', 'Equipped by']);
    assert.equal(hood.querySelectorAll('fieldset').length, 0, 'today\'s form');
    assert.deepEqual(hood.querySelectorAll('.ss-w-editable-pack-hint').map(node => text(node)), ['Kind, slot and rarity come from the pack.']);
    const sword = rowOf(el, 'Cane Sword');
    sword.querySelector('.ss-w-editable-pencil').click();
    assert.equal(sword.querySelectorAll('.ss-w-editable-pack-hint').length, 0);
    assert.equal(sword.querySelectorAll('fieldset').length, 0);
    const ring = rowOf(el, 'Lucky Bone Ring');
    ring.querySelector('.ss-w-editable-pencil').click();
    assert.equal(ring.querySelectorAll('fieldset').length, 2);
});

test('gear off: "+ Add item" is the inline row (Name, Count, Note) and Edit is today\'s form; no Kind, Slot or Rarity anywhere', { skip }, async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ modules: [ACTORS] });
    t.after(() => host.close());
    await host.sdk.command('inventory.add', { name: 'Bread', qty: 2 });
    const { el, calls } = draw(host);
    el.querySelector('.ss-w-inventory-add button').click();
    assert.ok(el.querySelector('.inv-add-form'));
    assert.equal(el.querySelector('.ss-w-editable-form'), null);
    assert.equal(el.querySelectorAll('.inv-add-form input').length, 3);
    const inputs = el.querySelectorAll('.inv-add-form input');
    inputs[0].value = 'Rope'; inputs[1].value = '1';
    el.querySelector('.inv-add-form .ss-button-primary').click();
    await settle();
    assert.deepEqual(calls.map(([type, payload]) => [type, payload]), [['inventory.add', { name: 'Rope', qty: 1, note: '' }]]);
    const row = rowOf(draw(host).el, 'Bread');
    row.querySelector('.ss-w-editable-pencil').click();
    assert.equal(row.querySelectorAll('fieldset').length, 0);
    assert.equal(row.querySelectorAll('select').length, 0);
});

test('the 32 px control rule is only for a roomy screen with a fine pointer; a phone keeps the 44 px controls', () => {
    const css = inventoryScreen.css;
    const rule = css.indexOf('.ss-w-editable-group input, .ss-w-editable-group select');
    assert.ok(rule > 0);
    const media = css.lastIndexOf('@media', rule);
    assert.ok(css.slice(media, rule).startsWith('@media (min-width: 760px) and (pointer: fine) {'), 'the rule sits inside the desktop media query');
    assert.ok(!css.slice(media, rule).includes('}\n'), 'and that query has not closed before it');
});

test('"+ Add item" groups as approved: Count and Kind share a row, Slot and Rarity share a row, the rarity word is coloured, the reader is "Astra (you)"', { skip }, async t => {
    const host = await world(t);
    const { el } = draw(host);
    const form = openAdd(el);
    change(labelled(el, 'Kind'), 'equipment');
    const rowWith = name => form.querySelectorAll('.ss-w-editable-row').find(row => row.querySelectorAll('label').some(node => node.querySelector('span')?.textContent === name));
    const names = row => row.querySelectorAll('label').map(node => node.querySelector('span')?.textContent);
    assert.deepEqual(names(rowWith('Count')), ['Count', 'Kind']);
    assert.deepEqual(names(rowWith('Slot')), ['Slot', 'Rarity']);
    assert.equal(rowWith('Name'), undefined, 'Name has a row of its own');
    change(labelled(el, 'Rarity'), 'rare');
    const label = el.querySelectorAll('label').find(node => node.querySelector('span')?.textContent === 'Rarity').querySelector('span');
    assert.deepEqual([label.getAttribute('data-tone'), label.getAttribute('data-word')], ['rare', 'Rare']);
    const owners = host.sdk.query('gear.view').owners;
    assert.deepEqual(addFields({ kit: true, owners }).find(f => f.key === 'equip').options.map(o => o.label), ['None', `${owners[0].label} (you)`, ...owners.slice(1).map(o => o.label)]);
});

test('Edit: Goods made Equipment while the kit is open saves the Rarity the form shows, touched or not; after the kit the form shows Common', { skip }, async t => {
    const host = await world(t);
    await host.sdk.command('inventory.add', { name: 'Lucky Stone', qty: 1, kind: 'goods', rarity: 'rare' });
    const { el, calls } = draw(host);
    const row = rowOf(el, 'Lucky Stone');
    row.querySelector('.ss-w-editable-pencil').click();
    change(labelled(row, 'Kind'), 'equipment');
    change(labelled(row, 'Slot'), 'accessory-1');
    assert.equal(labelled(row, 'Rarity').value, 'rare');
    row.querySelector('.ss-w-editable-save').click();
    await settle();
    assert.equal(calls[0][1].rarity, 'rare');
    assert.equal(Object.values(host.head().domains.inventory.defs).find(item => item.name === 'Lucky Stone').rarity, 'rare');
    const late = await world(t);
    await late.sdk.command('inventory.add', { name: 'Lucky Stone', qty: 1, kind: 'goods', rarity: 'rare' });
    await late.send('Hello.', 'The road.');
    const shown = draw(late);
    const lateRow = rowOf(shown.el, 'Lucky Stone');
    lateRow.querySelector('.ss-w-editable-pencil').click();
    change(labelled(lateRow, 'Kind'), 'equipment');
    assert.equal(labelled(lateRow, 'Rarity').value, 'common');
});

test('an empty chat (no greeting): the kit reads closed and "+ Add item" says in one plain sentence why', { skip }, async t => {
    const host = await createHost({ modules: [ACTORS], settings: { features: { 'story-block.gear': true, 'story-block.rpg': true } }, st: { chat: [] } });
    t.after(() => host.close());
    assert.deepEqual(host.sdk.query('gear.view').kit, { open: false, empty: true });
    const { el } = draw(host);
    el.querySelector('.ss-w-inventory-add button').click();
    assert.equal(el.querySelector('.ss-w-editable-form'), null);
    assert.equal(text(el.querySelector('.ss-w-inventory-add .inv-add-error')), 'This chat has no greeting yet, so there is nothing to add items to. Start the chat first.');
});
