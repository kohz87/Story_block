// Gear in fights, the screens (`story-block.gear`): the Inventory tab's Carry card and rows, the item Edit's Slot and Equipped by, the Party card's
// Inventory button and slot card. Off: today's screens exactly. Drawn by the real template renderer over a real host.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHost } from '../../testkit/index.js';
import { inventoryScreen } from '../../src/v2/screens/index.js';
import { createCoreModule } from '../../src/v2/domains/index.js';
import { createHarness } from './domains/helpers/fake-ctx.js';
import { stocked } from './domains/fixtures.js';
import { destroyTemplate } from '../../src/v2/view/template/render.js';
import { show, settle, text } from './screens/helpers.js';
import { page } from './lean-rpg/view/page.js';
import { FIGHT, dump, gearHost, reply } from './helpers/gear-ui-state.js';

const draw = (host, options = {}) => show(inventoryScreen, { state: host.head(), query: host.sdk.query, command: (type, payload, opts) => host.sdk.command(type, payload, opts), ...options });
const rowOf = (el, name) => el.querySelectorAll('li.item').find(item => item.querySelector('.name')?.textContent === name);
const headings = el => el.querySelectorAll('h4.ss-section-label').map(node => text(node));

test('Inventory, gear on: Carry first, then Equipment, Consumables, Goods, Quest items; the Carry card is a row-style card with the load, a bar and the breakdown', async t => {
    const host = await gearHost(t);
    const { el, view, problems } = draw(host);
    assert.deepEqual([view.warnings, problems], [[], []]);
    assert.deepEqual(headings(el).filter(Boolean).slice(0, 5), ['Carry', 'Equipment', 'Consumables', 'Goods', 'Quest items']);
    assert.ok(el.querySelector('.inv').classList.contains('gear'));
    const sections = el.querySelectorAll('section.group, section.carry-sec');
    assert.equal(sections[0].classList.contains('carry-sec'), true, 'Carry is the first section');
    const card = el.querySelector('.carry-sec li.item.ss-glass.carry-card');
    assert.ok(card, 'the card is an item row\'s card');
    assert.match(text(card.querySelector('.carry-line')), /^\d+ \/ 30$/);
    assert.equal(card.querySelectorAll('.ss-bar-track').length, 1);
    assert.match(text(card.querySelector('.carry-break')), /^Strength 30$/);
    assert.doesNotMatch(card.className, /heavy|over/, 'normal below 80 %');
    assert.equal(el.querySelector('.carry-sec').querySelector('.carry-state'), null);
    // "+ Add item" is the compact pill (about 30px drawn, a 44px tap area), one line, on a phone as on a desktop.
    const add = el.querySelector('.ss-w-inventory-add button');
    assert.deepEqual([add.textContent, add.classList.contains('ss-tap-pill')], ['+ Add item', true]);
});

test('the Carry card\'s colour bands: normal under 80 %, yellow Heavy load from 80 % to below 100 %, red Encumbered from 100 %', async t => {
    // Capacity 30 (10 + 2 × STR 10). The base state holds 8 items (Healing Salve counts 2).
    const at = async load => {
        const host = await gearHost(t, { wear: [], extra: [`+ item Brick | qty: ${load - 8}`] });
        const { el } = draw(host);
        const card = el.querySelector('.carry-card');
        return { numbers: text(card.querySelector('.carry-num')), classes: card.classes().filter(name => ['heavy', 'over'].includes(name)), state: card.querySelector('.carry-state') ? text(card.querySelector('.carry-state')) : '' };
    };
    assert.deepEqual(await at(23), { numbers: '23 / 30', classes: [], state: '' }, '77 %');
    assert.deepEqual(await at(24), { numbers: '24 / 30', classes: ['heavy'], state: 'Heavy load' }, '80 %');
    assert.deepEqual(await at(29), { numbers: '29 / 30', classes: ['heavy'], state: 'Heavy load' }, '97 %');
    assert.deepEqual(await at(30), { numbers: '30 / 30', classes: ['over'], state: 'Encumbered: AGI and DEX −2' }, '100 %: encumbered (at or over the limit)');
    assert.deepEqual(await at(31), { numbers: '31 / 30', classes: ['over'], state: 'Encumbered: AGI and DEX −2' }, 'over the limit');
});

test('Inventory rows, gear on: rarity colour and word, slot chip, Equipped · owner, stat bonus, condition bar and word; broken says no bonus', async t => {
    const host = await gearHost(t);
    const { el } = draw(host);
    const cane = rowOf(el, 'Cane Sword');
    assert.ok(cane.classList.contains('r-rare'), 'the rarity colour is on the row');
    assert.equal(text(cane.querySelector('.rarity')), 'rare');
    assert.equal(text(cane.querySelector('.chip.slot')), 'weapon');
    assert.equal(text(cane.querySelector('.chip.worn-by')), 'Equipped · You');
    assert.equal(text(cane.querySelector('.gear-line .bonus')), '+3 DEX');
    assert.equal(text(cane.querySelector('.cword')), 'Worn', 'one step down: worn');
    assert.ok(cane.querySelector('.cbar.w-worn'));
    const cap = rowOf(el, 'Iron Cap');
    assert.equal(text(cap.querySelector('.cword')), 'Good');
    assert.equal(cap.querySelector('.cbar').classList.contains('w-worn'), false);
    assert.equal(text(cap.querySelector('.gear-line .bonus')), '+2 VIT');
    const jerkin = rowOf(el, 'Boiled Leather Jerkin');
    assert.equal(text(jerkin.querySelector('.cword')), 'Torn', 'two steps: torn (the body armour takes the blow)');
    assert.ok(jerkin.querySelector('.cbar.w-torn'));
    const buckler = rowOf(el, 'Oak Buckler');
    assert.equal(text(buckler.querySelector('.cword')), 'Broken — no bonus', 'three steps: broken');
    assert.ok(buckler.querySelector('.cbar.w-broken') && buckler.classList.contains('broken'));
    assert.equal(text(buckler.querySelector('.gear-line .bonus')), '+2 VIT', 'what it would give is still shown; the word says it gives none');
    // Not worn: no Equipped chip; goods and consumables have no bar.
    const salve = rowOf(el, 'Healing Salve');
    assert.equal(salve.querySelector('.chip.worn-by'), null);
    assert.equal(salve.querySelector('.cbar'), null);
    // The Equip / Unequip buttons are the Edit's job now.
    assert.equal(el.querySelectorAll('button').filter(node => ['Equip', 'Unequip'].includes(text(node))).length, 0);
    // The filter box and "Equipped only" still work as before.
    assert.equal(el.querySelectorAll('.filter select').length, 2);
});

test('gear off: the Inventory screen renders exactly as it did before the feature existed', async t => {
    const host = await gearHost(t, { gear: false });
    const { el, view, problems } = draw(host);
    assert.deepEqual([view.warnings, problems], [[], []]);
    assert.equal(dump(el), readFileSync(new URL('./fixtures/inventory-gear-off.html', import.meta.url), 'utf8'));
    assert.equal(el.querySelector('.carry-sec'), null);
    assert.equal(el.querySelector('.ss-w-inventory-add button').classList.contains('ss-tap-pill'), false, 'the add button is the one it always was');
    assert.equal(el.querySelector('.inv').classList.contains('gear'), false);
    // The switch on with the RPG off is as off.
    const half = await createHost({ modules: [FIGHT], settings: { features: { 'story-block.gear': true } } });
    t.after(() => half.close());
    assert.equal(half.sdk.query('gear.view', {}), null);
});

test('Edit, gear on: Slot (the eight places or none) and Equipped by (a member or none) go through item.equip; transfer and unequip too; a rebuild and a reload agree', async t => {
    const host = await gearHost(t, { wear: [] });
    const first = draw(host);
    const cane = rowOf(first.el, 'Cane Sword');
    cane.querySelector('.ss-w-editable-pencil').click();
    const selects = cane.querySelectorAll('select');
    assert.deepEqual(selects.map(node => node.getAttribute('aria-label')), ['Slot', 'Equipped by']);
    assert.deepEqual(selects[0].querySelectorAll('option').map(node => node.textContent), ['None', 'Head', 'Body', 'Cloak', 'Feet', 'Weapon', 'Off-hand', 'Accessory 1', 'Accessory 2']);
    assert.deepEqual(selects[1].querySelectorAll('option').map(node => node.textContent), ['None', 'You']);
    assert.deepEqual([selects[0].value, selects[1].value], ['weapon', 'party'], 'the form opens on what is true now');
    // A piece that is not worn opens on its own slot and nobody.
    const salve = rowOf(first.el, 'Healing Salve');
    salve.querySelector('.ss-w-editable-pencil').click();
    assert.equal(salve.querySelectorAll('select').length, 0, 'not equipment: no Slot and no Equipped by');
    // Take the sword off (Equipped by: none).
    selects[1].value = '';
    cane.querySelector('.ss-w-editable-save').click();
    await settle();
    const swordRow = () => host.sdk.query('inventory.items').find(item => item.name === 'Cane Sword');
    assert.equal(swordRow().equipped, null);
    assert.equal(host.sdk.query('inventory.gear', { owner: 'party' }).statBonus.DEX, 0);
    // Put it on again, through item.equip.
    const second = draw(host);
    const again = rowOf(second.el, 'Cane Sword');
    again.querySelector('.ss-w-editable-pencil').click();
    const boxes = again.querySelectorAll('select');
    assert.deepEqual([boxes[0].value, boxes[1].value], ['weapon', ''], 'its own slot, nobody');
    boxes[1].value = 'party';
    again.querySelector('.ss-w-editable-save').click();
    await settle();
    assert.deepEqual([swordRow().equipped, swordRow().equippedBy], ['weapon', 'party']);
    assert.equal(host.sdk.query('inventory.gear', { owner: 'party' }).statBonus.DEX, 3);
    const calls = second.calls.map(([type, payload]) => [type, payload.slot ?? null]);
    assert.deepEqual(calls, [['item.equip', 'weapon']]);
    assert.deepEqual(first.calls.map(([type]) => type), ['inventory.unequip']);
    // A refusal shows its sentence and leaves the form open: a sword does not fit the head.
    const third = draw(host);
    const odd = rowOf(third.el, 'Cane Sword');
    odd.querySelector('.ss-w-editable-pencil').click();
    const choose = odd.querySelectorAll('select');
    choose[0].value = 'head';
    odd.querySelector('.ss-w-editable-save').click();
    await settle();
    assert.match(text(odd.querySelector('.ss-w-editable-error')), /does not fit the head slot/);
    assert.equal(swordRow().equipped, 'weapon');
    // Replay: a rebuild and a reload give the same.
    const stable = inv => JSON.stringify({ ...inv, stacks: Object.fromEntries(Object.entries(inv.stacks).map(([id, item]) => [id, { ...item, from: undefined }])) });
    const live = stable(host.head().domains.inventory);
    host.store.rebuild();
    assert.equal(stable(host.head().domains.inventory), live, 'a rebuild equals live');
    const loaded = await createHost({ modules: [FIGHT], st: { chat: structuredClone(host.ctx.chat), extensionSettings: structuredClone(host.ctx.extensionSettings) } });
    t.after(() => loaded.close());
    assert.equal(stable(loaded.head().domains.inventory), live, 'a reload equals live');
});

const gearCore = () => createCoreModule({ hooks: () => [], settings: () => ({}), extras: { gearOn: () => true, persona: () => 'Astra' } });

// A state with a swordsman in the party, a sword that fits a weapon slot and a boat left at the wharf.
function crewState() {
    const module = gearCore();
    const state = stocked(module);
    const inv = state.domains.inventory;
    inv.defs['pack.fantasy/iron-sword'].slot = 'weapon';
    state.domains.party = { actors: { ac_ren00001: { id: 'ac_ren00001', name: 'Ren' } } };
    state.domains.scene.place = { name: 'Mill Road', kind: '', region: '' };
    state.domains.scene.mounts = { 'm:left': { name: 'Skiff', kind: 'boat', count: 1, pace: 30, condition: '', where: 'moored at Eel Wharf' } };
    return { module, state };
}

test('gear.view: the persona is the main wearer, members follow; the breakdown, a mount left elsewhere, and a member\'s slots by name', () => {
    const { module, state } = crewState();
    state.domains.inventory.stacks.it_dagg0001.owner = 'ac_ren00001';
    state.domains.inventory.stacks.it_dagg0001.equipped = 'weapon';
    state.domains.inventory.defs['pack.fantasy/dagger'].slot = 'weapon';
    state.domains.inventory.defs['pack.fantasy/dagger'].rarity = 'rare';
    const h = createHarness([module], { state });
    const view = h.query('gear.view', {});
    assert.deepEqual(view.owners, [{ value: 'party', label: 'Astra' }, { value: 'ac_ren00001', label: 'Ren' }]);
    assert.equal(view.carry.breakdown, 'Strength 30');
    assert.deepEqual(view.carry.away, ['Skiff +100 \u00b7 moored at Eel Wharf, not with you']);
    assert.equal(view.rows.it_dagg0001.by, 'Ren');
    assert.equal(view.rows.it_sword001.by, '');
    const ren = h.query('gear.view', { who: 'Ren' });
    assert.deepEqual([ren.owner, ren.slots.weapon.name, ren.slots.weapon.bonus, ren.slots.head], ['ac_ren00001', 'Dagger', '+3 DEX', null]);
    const own = h.query('gear.view', { who: 'Whoever', own: true });
    assert.equal(own.owner, 'party', 'the reader\'s own card is the party\'s bag');
    assert.deepEqual(Object.values(h.query('gear.view', { who: 'Nobody' }).slots).filter(Boolean), [], 'an unknown name wears nothing');
    assert.equal(createHarness([createCoreModule({ hooks: () => [], settings: () => ({}) })], { state }).query('gear.view', {}), null, 'off: nothing');
});

test('Edit, gear on: Equipped by a member hands the piece over and puts it on in one command (item.equip with transfer)', async () => {
    const { module, state } = crewState();
    const h = createHarness([module], { state });
    const calls = [];
    const { el } = show(inventoryScreen, {
        state: h.state, query: h.query,
        command: (type, payload) => { calls.push([type, payload]); return h.run(type, payload, { cause: 'ui', extra: { feature: id => id === 'story-block.gear' || id === 'story-block.rpg' } }); },
    });
    const sword = rowOf(el, 'Iron Sword');
    sword.querySelector('.ss-w-editable-pencil').click();
    const [slot, by] = sword.querySelectorAll('select');
    assert.deepEqual([slot.value, by.value], ['weapon', ''], 'its own slot, nobody');
    assert.deepEqual(by.querySelectorAll('option').map(node => node.textContent), ['None', 'Astra', 'Ren']);
    by.value = 'ac_ren00001';
    sword.querySelector('.ss-w-editable-save').click();
    await settle();
    assert.deepEqual(calls.map(([type]) => type), ['item.equip'], 'one command: all or nothing (G7)');
    const held = Object.values(h.state.domains.inventory.stacks).find(item => item.def === 'pack.fantasy/iron-sword');
    assert.deepEqual([held.owner, held.equipped], ['ac_ren00001', 'weapon']);
});

const gearRun = h => (type, payload) => h.run(type, payload, { cause: 'ui', extra: { feature: id => id === 'story-block.gear' || id === 'story-block.rpg' } });

// The form's Save through the mounted screen; `redraw` destroys the screen after the first command, as a real commit's redraw does; `swap` opens another chat
// after it; `refuse` turns the equip down; `notes` collects the page notices.
function mounted(h, { redraw = false, swap = false, refuse = false } = {}) {
    const calls = [], notes = [], at = { chat: 'a', first: 1 };
    const shown = show(inventoryScreen, { state: h.state, query: h.query, extra: { api: { where: () => ({ ...at }), notify: text => notes.push(text) } }, command: async (type, payload) => {
        calls.push(type);
        const done = refuse && type === 'item.equip' ? { ok: false, message: 'No room to carry it.' } : await gearRun(h)(type, payload);
        if (redraw && calls.length === 1) destroyTemplate(shown.el);
        if (swap && calls.length === 1) at.chat = 'b';
        return done;
    } });
    return { ...shown, calls, notes };
}
const rowsOf = (el, name) => el.querySelectorAll('li.item').filter(item => item.querySelector('.name')?.textContent === name);
const open = (el, name) => { const row = rowOf(el, name); row.querySelector('.ss-w-editable-pencil').click(); return row; };

test('Edit, gear on: a note change and a wearer in one Save finish both steps although the first redraws the screen', async () => {
    const { module, state } = crewState();
    const h = createHarness([module], { state });
    const { el, calls } = mounted(h, { redraw: true });
    const sword = open(el, 'Iron Sword');
    const [, , note] = sword.querySelectorAll('input');
    note.value = 'keen';
    sword.querySelectorAll('select')[1].value = 'ac_ren00001';
    sword.querySelector('.ss-w-editable-save').click();
    await settle();
    await settle();
    assert.deepEqual(calls, ['inventory.edit', 'item.equip']);
    const held = h.state.domains.inventory.stacks.it_sword001;
    assert.deepEqual([held.note, held.owner, held.equipped], ['keen', 'ac_ren00001', 'weapon']);
});

// Two swords of one owner; the second (it_sword009) is worse worn; the first may be worn by `wear`.
function twoSwords(wear = null) {
    const { module, state } = crewState();
    const inv = state.domains.inventory;
    inv.stacks.it_sword009 = { ...inv.stacks.it_sword001, id: 'it_sword009', cond: 40 };
    if (wear) Object.assign(inv.stacks.it_sword001, { equipped: wear });
    return { h: createHarness([module], { state }), inv };
}
const pieces = inv => Object.values(inv.stacks).filter(item => item.def === 'pack.fantasy/iron-sword');

test('Edit, gear on: reducing a group\'s count while choosing a wearer keeps the selected (second) piece and its condition', async () => {
    const { h } = twoSwords();
    const { el, calls } = mounted(h);
    const sword = rowsOf(el, 'Iron Sword')[1];
    sword.querySelector('.ss-w-editable-pencil').click();
    const [, count] = sword.querySelectorAll('input');
    count.value = '1';
    sword.querySelectorAll('select')[1].value = 'ac_ren00001';
    sword.querySelector('.ss-w-editable-save').click();
    await settle();
    assert.deepEqual(calls, ['inventory.edit', 'item.equip']);
    const left = pieces(h.state.domains.inventory);
    assert.deepEqual(left.map(item => [item.id, item.cond, item.owner, item.equipped]), [['it_sword009', 40, 'ac_ren00001', 'weapon']]);
});

test('Edit, gear on: a count that would remove the selected piece (the other is worn) is refused, nothing changes', async () => {
    const { h } = twoSwords('weapon');
    const { el, calls } = mounted(h);
    const sword = rowsOf(el, 'Iron Sword')[1];
    sword.querySelector('.ss-w-editable-pencil').click();
    const [, count] = sword.querySelectorAll('input');
    count.value = '1';
    sword.querySelectorAll('select')[1].value = 'ac_ren00001';
    sword.querySelector('.ss-w-editable-save').click();
    await settle();
    assert.deepEqual(calls, ['inventory.edit']);
    assert.match(text(sword.querySelector('.ss-w-editable-error')), /remove the piece you are editing/);
    assert.deepEqual(pieces(h.state.domains.inventory).map(item => [item.id, item.cond, item.owner]), [['it_sword001', undefined, 'party'], ['it_sword009', 40, 'party']]);
});

test('Edit, gear on: an unchanged Save keeps a piece worn by a member who left', async () => {
    const { module, state } = crewState();
    const worn = state.domains.inventory.stacks.it_sword001;
    worn.owner = 'ac_gone0001';
    worn.equipped = 'weapon';
    const h = createHarness([module], { state });
    const { el, calls } = mounted(h);
    const sword = open(el, 'Iron Sword');
    sword.querySelector('.ss-w-editable-save').click();
    await settle();
    assert.deepEqual(calls, [], 'no unequip');
    assert.match(text(sword.querySelector('.ss-w-editable-error')), /^Nothing to change/);
    assert.deepEqual([worn.owner, worn.equipped].join(), 'ac_gone0001,weapon');
});

test('Edit, gear on: Save with nothing to change says so in the form instead of closing', async () => {
    const { module, state } = crewState();
    const h = createHarness([module], { state });
    const calls = [];
    const { el } = show(inventoryScreen, { state: h.state, query: h.query, command: (type, payload) => { calls.push(type); return gearRun(h)(type, payload); } });
    const sword = rowOf(el, 'Iron Sword');
    sword.querySelector('.ss-w-editable-pencil').click();
    sword.querySelector('.ss-w-editable-save').click();
    await settle();
    assert.deepEqual(calls, []);
    assert.match(text(sword.querySelector('.ss-w-editable-error')), /^Nothing to change: no one wears it\.$/);
    const [slot] = sword.querySelectorAll('select');
    slot.value = 'weapon';
    sword.querySelector('.ss-w-editable-save').click();
    await settle();
    assert.match(text(sword.querySelector('.ss-w-editable-error')), /Nothing to change/, 'a Slot with nobody to wear it changes nothing');
});

test('Settings, RPG: the Gear in fights card sits after the Stat formula, with On and Off buttons like Rolls, and its words', async t => {
    const ctx = await page(t, { feature: true });
    const win = ctx.ui.openSettings();
    win.select('rpg');
    await settle();
    const root = ctx.doc.querySelector('[data-ss-section="rpg"]');
    assert.deepEqual(root.querySelectorAll('.rpg-set-title').slice(0, 4).map(node => node.textContent), ['Stat formula', 'Levels and practice', 'Gear in fights', 'Rolls']);
    const card = root.querySelector('[data-card="gear"]');
    assert.deepEqual(card.querySelectorAll('.rpg-chip').map(node => node.textContent), ['On', 'Off']);
    assert.equal(card.querySelector('[aria-pressed="true"]').textContent, 'Off', 'off until the reader switches it on');
    assert.match(card.textContent, /^Gear in fightsOnOffOn: worn gear adds stat points by rarity \(common \+0 up to legendary \+4\); .* Off: fights run as before; items, rarity and slots are kept\.$/);
    assert.deepEqual(root.querySelector('[data-card="rolls"]').querySelectorAll('.rpg-chip').map(node => node.textContent), ['Automatic', 'Off'], 'Rolls keeps its own choices');
    assert.equal(root.querySelector('[data-card="checks"] [role="switch"]').getAttribute('aria-checked'), 'true', 'Story checks has its own default-on switch');
});

test('Edit, gear on: choosing None for a piece a member who left wears takes it off; leaving the choice alone does not', async () => {
    const { module, state } = crewState();
    const worn = state.domains.inventory.stacks.it_sword001;
    Object.assign(worn, { owner: 'ac_gone0001', equipped: 'weapon' });
    const h = createHarness([module], { state });
    const { el, calls } = mounted(h);
    const sword = open(el, 'Iron Sword');
    const by = sword.querySelectorAll('select')[1];
    assert.deepEqual([by.value, by.querySelectorAll('option').map(node => node.textContent)], ['ac_gone0001', ['None', 'Astra', 'Ren', 'Left the party']]);
    by.value = '';
    sword.querySelector('.ss-w-editable-save').click();
    await settle();
    assert.deepEqual(calls, ['inventory.unequip']);
    assert.equal(h.state.domains.inventory.stacks.it_sword001.equipped, null);
});

test('Edit, gear on: a plan stops before its next step when another chat is open', async () => {
    const { module, state } = crewState();
    const h = createHarness([module], { state });
    const { el, calls } = mounted(h, { redraw: true, swap: true });
    const sword = open(el, 'Iron Sword');
    sword.querySelectorAll('input')[2].value = 'keen';
    sword.querySelectorAll('select')[1].value = 'ac_ren00001';
    sword.querySelector('.ss-w-editable-save').click();
    await settle();
    await settle();
    assert.deepEqual(calls, ['inventory.edit'], 'the equip never ran against the other chat');
    assert.equal(h.state.domains.inventory.stacks.it_sword001.equipped, null);
});

test('Edit, gear on: a refusal after the form is gone is a page notice', async () => {
    const { module, state } = crewState();
    const h = createHarness([module], { state });
    const { el, calls, notes } = mounted(h, { redraw: true, refuse: true });
    const sword = open(el, 'Iron Sword');
    sword.querySelectorAll('input')[2].value = 'keen';
    sword.querySelectorAll('select')[1].value = 'ac_ren00001';
    sword.querySelector('.ss-w-editable-save').click();
    await settle();
    await settle();
    assert.deepEqual(calls, ['inventory.edit', 'item.equip']);
    assert.equal(notes.length, 1);
    assert.match(notes[0], /No room to carry it/);
    assert.equal(h.state.domains.inventory.stacks.it_sword001.note, 'keen');
});
