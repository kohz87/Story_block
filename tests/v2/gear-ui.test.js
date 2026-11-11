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
import { editPlan } from '../../src/v2/view/gear-form.js';
import { page } from './lean-rpg/view/page.js';
import { FIGHT, dump, gearHost, reply } from './helpers/gear-ui-state.js';
import { createScreenRenderer } from '../../src/v2/view/render-screen.js';
import { resolveData } from '../../src/v2/view/screens.js';
import { standardWidgets } from '../../src/v2/view/widgets/index.js';
import { installFakeDom } from '../ui-fake-dom.js';
import { createInventoryAddWidget, createInventoryViewWidget, createWornFoldWidget, WORN_FOLD_WIDGET, INVENTORY_ADD_WIDGET, INVENTORY_VIEW_WIDGET } from '../../src/v2/screens/inventory-add.js';

const draw = (host, options = {}) => show(inventoryScreen, { state: host.head(), query: host.sdk.query, draft: { wornOpen: '1' }, command: (type, payload, opts) => host.sdk.command(type, payload, opts), ...options });   // (Worn opened: every piece has its row)
const rowOf = (el, name) => el.querySelectorAll('li.item').find(item => item.querySelector('.name')?.textContent === name);
const headings = el => el.querySelectorAll('h4.ss-section-label').map(node => text(node));

test('Inventory, gear on: Carry first, then Equipment (in the bag), the wearer\'s Worn list, Consumables, Goods; the Carry card is a row-style card with the load, a bar and the breakdown', async t => {
    const host = await gearHost(t);
    const { el, view, problems } = draw(host);
    assert.deepEqual([view.warnings, problems], [[], []]);
    assert.deepEqual(headings(el).filter(Boolean).slice(0, 5), ['Carry', 'Equipment \u00b7 in the bag', 'You', 'Consumables', 'Goods']);
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
    // The worn pieces have Unequip; nothing here is in the bag, so no Equip.
    assert.equal(el.querySelectorAll('button').filter(node => text(node) === 'Unequip').length, 5);
    assert.equal(el.querySelectorAll('button').filter(node => text(node) === 'Equip').length, 0);
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

// The form's Save through the mounted screen with a screen that holds like the real one: a command's `committed` redraw (here only counted in `redraws`) waits while a plan holds (`api.hold`) and runs once at its end. `leave` closes the screen (a chat switch, the panel closed) after the first command;
// `refuse` turns the equip down.
function mounted(h, { leave = false, refuse = false } = {}) {
    const calls = [], redraws = { n: 0, at: [] }, notices = [];
    let holds = 0, owed = false, shown = null;
    const redraw = () => { redraws.n++; };
    const hold = () => { holds++; let done = false; return () => { if (done) return; done = true; if (!--holds && owed) { owed = false; redraw(); } }; };
    shown = show(inventoryScreen, { state: h.state, query: h.query, draft: { wornOpen: '1' }, extra: { api: { hold, notify: text => notices.push(text) } }, command: async (type, payload) => {
        redraws.at.push(redraws.n);
        calls.push(type);
        const done = refuse && type === 'item.equip' ? { ok: false, message: 'No room to carry it.' } : await gearRun(h)(type, payload);
        if (leave && calls.length === 1) destroyTemplate(shown.el);
        else if (holds) owed = true;
        else redraw();
        return done;
    } });
    return { ...shown, calls, redraws, notices, holding: () => holds };
}
const rowsOf = (el, name) => el.querySelectorAll('li.item').filter(item => item.querySelector('.name')?.textContent === name);
const open = (el, name) => { const row = rowOf(el, name); row.querySelector('.ss-w-editable-pencil').click(); return row; };

test('Edit, gear on: a note change and a wearer in one Save finish both steps with no redraw in between and one after', async () => {
    const { module, state } = crewState();
    const h = createHarness([module], { state });
    const { el, calls, redraws } = mounted(h);
    const sword = open(el, 'Iron Sword');
    const [, , note] = sword.querySelectorAll('input');
    note.value = 'keen';
    sword.querySelectorAll('select')[1].value = 'ac_ren00001';
    sword.querySelector('.ss-w-editable-save').click();
    await settle();
    await settle();
    assert.deepEqual(calls, ['inventory.edit', 'item.equip']);
    assert.deepEqual(redraws.at, [0, 0], 'the second step began before any redraw');
    assert.equal(redraws.n, 1, 'one redraw once the plan ended');
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
    const sword = rowsOf(el, 'Iron Sword')[0];   // (the one in the bag is listed first; the worn one is under Worn)
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

test('Edit, gear on: closing the screen mid-plan stops the next step', async () => {
    const { module, state } = crewState();
    const h = createHarness([module], { state });
    const { el, calls } = mounted(h, { leave: true });
    const sword = open(el, 'Iron Sword');
    sword.querySelectorAll('input')[2].value = 'keen';
    sword.querySelectorAll('select')[1].value = 'ac_ren00001';
    sword.querySelector('.ss-w-editable-save').click();
    await settle();
    await settle();
    assert.deepEqual(calls, ['inventory.edit'], 'the equip never ran');
    assert.equal(h.state.domains.inventory.stacks.it_sword001.equipped, null);
});

test('Edit, gear on: a refusal in the second step releases the hold, redraws once and shows as a notice', async () => {
    const { module, state } = crewState();
    const h = createHarness([module], { state });
    const { el, calls, redraws, notices, holding } = mounted(h, { refuse: true });
    const sword = open(el, 'Iron Sword');
    sword.querySelectorAll('input')[2].value = 'keen';
    sword.querySelectorAll('select')[1].value = 'ac_ren00001';
    sword.querySelector('.ss-w-editable-save').click();
    await settle();
    await settle();
    assert.deepEqual(calls, ['inventory.edit', 'item.equip']);
    assert.deepEqual(redraws.at, [0, 0]);
    assert.equal(holding(), 0, 'the hold is released after the refusal');
    assert.equal(redraws.n, 1, 'the screen redraws once');
    assert.deepEqual(notices, ['No room to carry it.'], 'the late refusal shows as a page notice');
    assert.match(text(sword.querySelector('.ss-w-editable-error')), /No room to carry it/);
    assert.equal(h.state.domains.inventory.stacks.it_sword001.note, 'keen');
});

test('Edit, gear on: renaming a piece and changing its carry on a definition two pieces share changes only the selected piece', () => {
    const { module, state } = crewState();
    const inv = state.domains.inventory;
    inv.defs['story/bag'] = { ...structuredClone(inv.defs['pack.fantasy/iron-sword']), id: 'story/bag', name: 'Bag', carry: 5, slot: 'accessory1' };
    for (const id of ['it_bag00001', 'it_bag00002']) inv.stacks[id] = { ...inv.stacks.it_sword001, id, def: 'story/bag', equipped: null };
    const h = createHarness([module], { state });
    const plan = editPlan({ value: 'Bag', itemCount: 1, gear: { stack: 'it_bag00002', kind: 'equipment', place: '', by: '', owner: inv.stacks.it_bag00002.owner, row: { hand: true, defSlot: 'accessory1', carry: 5, stats: {} } } });
    const { steps, error } = plan({ name: 'Satchel', carry: 10 }, { name: 'Satchel', count: 1, note: '', kind: 'equipment', slot: 'accessory1', rarity: 'common', by: '', carry: 10 });
    assert.equal(error, undefined);
    assert.deepEqual(steps.map(step => step.command), ['inventory.edit', 'inventory.carry'], 'the rename first, then the carry');
    for (const step of steps) assert.equal(gearRun(h)(step.command, step.payload).ok, true, step.command);
    const after = h.state.domains.inventory;
    assert.deepEqual([after.defs[after.stacks.it_bag00002.def].name, after.defs[after.stacks.it_bag00002.def].carry], ['Satchel', 10]);
    assert.deepEqual([after.defs[after.stacks.it_bag00001.def].name, after.defs[after.stacks.it_bag00001.def].carry], ['Bag', 5], 'the other piece is untouched');
});

// The game view mounts the Inventory screen too: its body redraws from `committed` through the same hold as the panel's.
async function gameForm(t, wrap = null) {
    t.mock.method(console, 'warn', () => {});
    // These tests edit the List rows: this device's saved view is List (Grid is the default).
    const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => (key === 'story-block.inventoryView' ? 'list' : null), setItem() {}, removeItem() {} } });
    t.after(() => { if (had) Object.defineProperty(globalThis, 'localStorage', had); else delete globalThis.localStorage; });
    const { doc, host, ui } = await page(t, { wrap });
    host.features.set('story-block.gear', true);
    await host.send('Hello.', 'The road.');
    await host.send('Loot.', reply('Gear.', ['+ item Iron Sword | slot: weapon']));
    assert.equal(ui.mounts.screen.open('story-block/inventory'), true);
    await settle();
    const screen = () => doc.querySelector('.ss-gameview [data-ss-screen="story-block/inventory"]');
    const fresh = () => rowOf(screen(), 'Iron Sword');
    const row = fresh();
    row.querySelector('.ss-w-editable-pencil').click();
    return { host, row, fresh, screen };
}
const fill = row => {
    row.querySelectorAll('input')[2].value = 'keen';
    row.querySelectorAll('select')[1].value = 'party';
    row.querySelector('.ss-w-editable-save').click();
};

test('Edit in the game view, gear on: a note and a wearer in one Save run both steps and the screen redraws once after', async t => {
    const seen = [];
    let form;
    form = await gameForm(t, (type, payload, options, run) => { seen.push([type, form.row.isConnected]); return run(type, payload, options); });
    fill(form.row);
    await settle();
    assert.deepEqual(seen, [['inventory.edit', true], ['item.equip', true]], 'the form was alive for both steps');
    assert.equal(form.row.isConnected, false, 'the screen redrew after the plan');
    const held = Object.values(form.host.head().domains.inventory.stacks).find(item => item.note === 'keen');
    assert.deepEqual([held.owner, held.equipped], ['party', 'weapon']);
    assert.match(text(form.screen()), /Worn \(1\)/, 'the piece is worn now: the folded Worn row counts it');
});

test('Edit in the game view, gear on: a refusal in the second step redraws the screen and later commands redraw at once', async t => {
    const form = await gameForm(t, (type, payload, options, run) => (type === 'item.equip' ? { ok: false, message: 'No room to carry it.' } : run(type, payload, options)));
    fill(form.row);
    await settle();
    assert.equal(form.row.isConnected, false, 'the hold went with the plan: the screen redrew');
    assert.match(text(form.fresh()), /keen/);
    const later = form.fresh();
    form.host.events.emit('committed', {});
    assert.equal(later.isConnected, false, 'no hold is left behind: the next redraw runs at once');
});

test('Edit, gear on: a refusal in the first step keeps the form with its sentence and no notice, and holds nothing', async () => {
    const { module, state } = crewState();
    const h = createHarness([module], { state });
    const { el, notices, holding } = mounted(h, { refuse: true });
    const sword = open(el, 'Iron Sword');
    sword.querySelectorAll('select')[1].value = 'ac_ren00001';
    sword.querySelector('.ss-w-editable-save').click();
    await settle();
    await settle();
    assert.match(text(sword.querySelector('.ss-w-editable-error')), /No room to carry it/);
    assert.deepEqual([holding(), notices.length], [0, 0]);
    assert.equal(sword.isConnected, true);
});

test('Edit, gear on: destroying the form mid-plan releases the hold', async () => {
    const { module, state } = crewState();
    const h = createHarness([module], { state });
    const { el, holding } = mounted(h, { leave: true });
    const sword = open(el, 'Iron Sword');
    sword.querySelectorAll('input')[2].value = 'keen';
    sword.querySelectorAll('select')[1].value = 'ac_ren00001';
    sword.querySelector('.ss-w-editable-save').click();
    await settle();
    await settle();
    assert.equal(holding(), 0);
});

// ---- The bag list and the folded Worn row (gear on) ----
const BAG = ['+ item Skinner Billhook | rarity: uncommon | slot: weapon', '+ item Grey Hood | slot: head'];
const names = list => list.map(item => item.querySelector('.name').textContent);
const groupRows = (el, kind) => el.querySelector(`section.group[data-kind="${kind}"]`).querySelectorAll('li.item');
const buttonsOf = (root, label) => root.querySelectorAll('button').filter(node => text(node) === label);
const memory = () => { const map = new Map(); return { map, getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) }; };
const foldWidgets = storage => ({ [WORN_FOLD_WIDGET]: createWornFoldWidget({ chatKey: () => 'chat-1', storage }) });

test('Inventory, gear on: Equipment lists only the pieces nobody wears, each keeping its bonus, condition and rarity colour, with Equip; Carry still counts everything', async t => {
    const host = await gearHost(t, { extra: BAG });
    const folded = draw(host, { draft: {}, widgets: foldWidgets(memory()) });
    const rows = groupRows(folded.el, 'equipment');
    assert.deepEqual(names(rows), ['Grey Hood', 'Skinner Billhook'], 'the five worn pieces are not listed here');
    const billhook = rowOf(folded.el, 'Skinner Billhook');
    assert.ok(billhook.classList.contains('r-uncommon'));
    assert.equal(text(billhook.querySelector('.gear-line .bonus')), '+2 STR');
    assert.equal(text(billhook.querySelector('.cword')), 'Good');
    assert.ok(billhook.querySelector('.cbar'));
    assert.deepEqual(rows.map(row => buttonsOf(row, 'Equip').length), [1, 1]);
    assert.equal(buttonsOf(folded.el, 'Unequip').length, 0, 'the worn rows are folded away');
    assert.equal(headings(folded.el)[1], 'Equipment \u00b7 in the bag');
    // The load counts every piece owned, worn or not.
    const opened = draw(host);
    assert.equal(text(folded.el.querySelector('.carry-num')), text(opened.el.querySelector('.carry-num')));
    // Equip: choose the wearer; the taken weapon slot swaps and the Cane Sword goes back to the bag.
    buttonsOf(billhook, 'Equip')[0].click();
    const who = buttonsOf(billhook.querySelector('.fold.use-on'), 'You');
    assert.equal(who.length, 1);
    who[0].click();
    await settle();
    const stacks = Object.values(host.head().domains.inventory.stacks);
    const sword = stacks.find(stack => stack.def.endsWith('cane-sword') || /cane/i.test(stack.def));
    const hook = stacks.find(stack => /billhook/i.test(stack.def));
    assert.equal(hook.equipped, 'weapon');
    assert.equal(sword?.equipped ?? null, null, 'the old piece is back in the bag');
    assert.deepEqual(names(groupRows(draw(host, { draft: {}, widgets: foldWidgets(memory()) }).el, 'equipment')).sort(), ['Cane Sword', 'Grey Hood']);
});

test('Inventory, gear on: the Worn (N) row is folded by default with "wearer count"; opened it groups the worn pieces by wearer with Unequip; the choice is kept per chat on this device', async t => {
    const host = await gearHost(t, { extra: BAG });
    const store = memory();
    const first = draw(host, { draft: {}, widgets: foldWidgets(store) });
    const fold = first.el.querySelector('.worn-fold-btn');
    assert.equal(text(fold), 'Worn (5)You 5');
    assert.equal(fold.getAttribute('aria-expanded'), 'false');
    assert.ok(fold.querySelector('svg path'), 'a drawn chevron, as the Party card\'s Left row');
    assert.equal(first.el.querySelectorAll('.worn-who').length >= 0 && first.el.querySelectorAll('.worn-who li.item').length, 0);
    fold.click();
    await settle();
    assert.equal(first.el.querySelector('.worn-fold-btn').getAttribute('aria-expanded'), 'true');
    assert.equal(text(first.el.querySelector('.worn-fold-btn')), 'Worn (5)', 'opened: no wearer summary');
    const groups = first.el.querySelectorAll('.worn-who');
    assert.deepEqual(groups.map(group => text(group.querySelector('h4'))), ['You']);
    const worn = groups[0].querySelectorAll('li.item');
    assert.deepEqual(names(worn).sort(), ['Boiled Leather Jerkin', 'Cane Sword', 'Iron Cap', 'Moss-Agate Ring', 'Oak Buckler']);
    assert.equal(text(rowOf(first.el, 'Cane Sword').querySelector('.gear-line .bonus')), '+3 DEX');
    assert.ok(rowOf(first.el, 'Cane Sword').classList.contains('r-rare'));
    assert.equal(buttonsOf(rowOf(first.el, 'Cane Sword'), 'Unequip').length, 1);
    assert.ok(rowOf(first.el, 'Cane Sword').querySelector('.ss-w-editable-pencil'), 'Edit stays on a worn row');
    assert.deepEqual([...store.map], [['story-block.inventoryWornOpen|chat-1', '1']]);
    // The same chat on this device opens it again; another chat does not.
    const again = draw(host, { draft: {}, widgets: foldWidgets(store) });
    await settle();
    assert.equal(again.el.querySelector('.worn-fold-btn').getAttribute('aria-expanded'), 'true');
    const other = draw(host, { draft: {}, widgets: { [WORN_FOLD_WIDGET]: createWornFoldWidget({ chatKey: () => 'chat-2', storage: store }) } });
    await settle();
    assert.equal(other.el.querySelector('.worn-fold-btn').getAttribute('aria-expanded'), 'false');
    // Unequip sends inventory.unequip: the piece goes to the bag list.
    buttonsOf(rowOf(first.el, 'Iron Cap'), 'Unequip')[0].click();
    await settle();
    assert.deepEqual(first.calls.map(([type]) => type), ['inventory.unequip']);
    const cap = Object.values(host.head().domains.inventory.stacks).find(stack => /cap/i.test(stack.def));
    assert.equal(cap.equipped ?? null, null);
    // Closing keeps the choice too.
    first.el.querySelector('.worn-fold-btn').click();
    await settle();
    assert.equal(store.map.size, 0);
    assert.equal(first.el.querySelector('.worn-fold-btn').getAttribute('aria-expanded'), 'false');
    assert.match(text(draw(host, { draft: {}, widgets: foldWidgets(memory()) }).el.querySelector('.worn-fold-btn')), /^Worn \(4\)You 4$/, 'drawn again: four are still worn');
});

test('Worn row: a storage that throws means folded, and the choice then lasts this page', async t => {
    const host = await gearHost(t);
    const broken = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); }, removeItem() { throw new Error('no'); } };
    const { el } = draw(host, { draft: {}, widgets: foldWidgets(broken) });
    await settle();
    assert.equal(el.querySelector('.worn-fold-btn').getAttribute('aria-expanded'), 'false');
    el.querySelector('.worn-fold-btn').click();
    await settle();
    assert.equal(el.querySelector('.worn-fold-btn').getAttribute('aria-expanded'), 'true');
});

// The late refusal of a multi-step item form, through the real renderer the mounts use (render-screen.js), not a scope the test builds: its widget api carries the page's `notify`.
test('Edit, gear on: a refusal after a committed step reaches the page notice through the real screen renderer', async () => {
    const { module, state } = crewState();
    const h = createHarness([module], { state });
    const doc = installFakeDom();
    const el = doc.createElement('div');
    doc.body.appendChild(el);
    doc.head ??= doc.createElement('head');
    const notices = [];
    const renderer = createScreenRenderer({ queryAt: (name, args, at) => h.query(name, args), widgets: () => ({ ...standardWidgets, [INVENTORY_ADD_WIDGET]: createInventoryAddWidget(), [WORN_FOLD_WIDGET]: createWornFoldWidget({ storage: null }), [INVENTORY_VIEW_WIDGET]: createInventoryViewWidget({ storage: null, fallback: 'list' }) }) });
    const api = { hold: () => () => {}, notify: text => notices.push(text), on: () => () => {},
        command: async (type, payload) => (type === 'item.equip' ? { ok: false, message: 'No room to carry it.' } : gearRun(h)(type, payload)) };
    const data = resolveData(inventoryScreen.data, h.query);
    renderer.render(el, inventoryScreen, { state: h.state, q: data.q, api, mount: 'tab', draft: { wornOpen: '1' }, changes: [], settings: {} });
    const sword = open(el, 'Iron Sword');
    sword.querySelectorAll('input')[2].value = 'keen';
    sword.querySelectorAll('select')[1].value = 'ac_ren00001';
    sword.querySelector('.ss-w-editable-save').click();
    await settle();
    await settle();
    assert.deepEqual(notices, ['No room to carry it.']);
    assert.match(text(sword.querySelector('.ss-w-editable-error')), /No room to carry it/);
});
