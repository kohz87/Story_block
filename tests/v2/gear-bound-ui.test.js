// Bound signature gear and the standard item row, the screens (`story-block.gear`): three lines on every row, the same height; a bound piece has the lock chip and
// no Drop; its Edit locks everything but the note; its slot tile carries a lock. Off: today's screens (the fixture test in gear-ui.test.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { inventoryScreen } from '../../src/v2/screens/index.js';
import { createCoreModule } from '../../src/v2/domains/index.js';
import { createHarness } from './domains/helpers/fake-ctx.js';
import { stocked } from './domains/fixtures.js';
import { show, settle, text } from './screens/helpers.js';
import { setupDom } from './view/mounts/helpers.js';
import { renderGearCard } from '../../src/v2/lean-rpg/view/gear-card.js';

const rowOf = (el, name) => el.querySelectorAll('li.item').find(item => item.querySelector('.name')?.textContent === name);
const featureOn = id => id === 'story-block.gear' || id === 'story-block.rpg';
const core = gear => createCoreModule({ hooks: () => [], settings: () => ({}), extras: { gearOn: () => gear, persona: () => 'Astra' } });

// Ren's dagger is a signature piece (bound to Ren, worn in the weapon slot); the iron sword is Astra's own (worn); the rest is carried.
function crew({ gear = true, long = null, rope = 0 } = {}) {
    const module = core(gear);
    const state = stocked(module);
    const inv = state.domains.inventory;
    inv.defs['pack.fantasy/iron-sword'].slot = 'weapon';
    inv.defs['pack.fantasy/dagger'].slot = 'weapon';
    inv.defs['pack.fantasy/dagger'].rarity = 'legendary';
    if (long) inv.defs['pack.fantasy/dagger'].name = long;
    if (rope) inv.defs['story/rope'].carry = rope;
    state.domains.party = { actors: { ac_ren00001: { id: 'ac_ren00001', name: 'Ren' } } };
    const dagger = inv.stacks.it_dagg0001;
    dagger.owner = 'ac_ren00001';
    dagger.equipped = 'weapon';
    dagger.bound = 'ac_ren00001';
    dagger.note = 'the Long Watch blade';
    const sword = Object.values(inv.stacks).find(stack => stack.def === 'pack.fantasy/iron-sword');
    sword.equipped = 'weapon';
    const h = createHarness([module], { state, extra: { feature: id => (gear ? featureOn(id) : false) } });
    return { module, state, h };
}

function draw({ module, state, h }, calls = []) {
    return show(inventoryScreen, {
        state: h.state, query: h.query,
        command: (type, payload) => { calls.push([type, payload]); return h.run(type, payload, { cause: 'ui', extra: { feature: featureOn } }); },
    });
}

const daggerRow = el => rowOf(el, 'Dagger');
const swordRow = el => rowOf(el, 'Iron Sword');

test('rows, gear on: three lines in order (name, pencil, rarity word, slot chip / who has it / bonus, condition, note), the line kept when empty, one class for equal height', () => {
    const { el, problems } = draw(crew());
    assert.deepEqual(problems, []);
    const rows = el.querySelectorAll('li.item').filter(item => !item.classList.contains('carry-card'));
    assert.ok(rows.length >= 4);
    for (const row of rows) {
        const body = row.querySelector(':scope > .body') ?? row.querySelector('.body');
        const lines = body.childNodes.filter(node => node.nodeType === 1).map(node => node.classes().find(name => /^g-l\d$/.test(name)) ?? node.classes()[0]);
        assert.deepEqual(lines.slice(0, 3), ['g-l1', 'g-l2', 'g-l3'], `${row.querySelector('.name').textContent}: three lines, then the actions`);
        assert.ok(row.classList.contains('grow') && row.classList.contains('ss-glass'), 'the same card on every row');
    }
    const sword = swordRow(el);
    assert.deepEqual(sword.querySelector('.g-l1').childNodes.filter(node => node.nodeType === 1).map(node => node.classes()[0]), ['name', 'item-edit', 'rarity', 'chip']);
    assert.equal(text(sword.querySelector('.g-l1 .chip.slot')), 'weapon');
    assert.equal(text(sword.querySelector('.g-l2 .chip.eq')), 'Equipped · Astra');
    assert.equal(text(sword.querySelector('.g-l3 .bonus')) !== '', true);
    assert.ok(sword.querySelector('.g-l3 .cbar') && sword.querySelector('.g-l3 .cword'));
    // A good with no owner chip still has line 2 (empty), and its note sits on line 3.
    const empty = rows.filter(row => row.querySelector('.g-l2').childNodes.filter(node => node.nodeType === 1).length === 0);
    assert.ok(empty.length > 0, 'a row with nothing on line 2 still has the line (kept at its height)');
    const letter = rows.find(row => row.querySelector('.note'));
    assert.ok(letter, 'a row with a note');
    assert.ok(letter.querySelector('.g-l3 .note.muted'), 'the note is muted, on line 3');
    assert.equal(letter.querySelector('.line .note'), null);
    // The CSS: the three lines have fixed heights and the row a minimum, all rows alike; the Drop is centred on the rows; one left edge (one column).
    const css = inventoryScreen.css;
    assert.match(css, /\.inv\.gear \.item\.grow:not\(:has\(\.ss-w-editable-item-form\)\) \{ min-height: 84px;/);
    assert.match(css, /grid-template-rows: 20px 16px 16px;/);
    assert.match(css, /> \.actions \{ grid-column: 2; grid-row: 1 \/ 4; align-self: center;/);
    assert.match(css, /> :is\(\.g-l1, \.g-l2, \.g-l3\) \{ grid-column: 1;/);
});

test('rows, gear off: none of the gear lines (today\'s rows)', () => {
    const { el } = draw(crew({ gear: false }));
    assert.equal(el.querySelectorAll('.g-l1, .g-l2, .g-l3, .grow, .bound').length, 0);
});

test('phone: the rarity word is hidden at phone width (a CSS rule), and shown on desktop', () => {
    const css = inventoryScreen.css;
    const phone = css.match(/@media \(max-width: 500px\) \{([^\n]*)\}/g)?.find(rule => /\.rarity \{ display: none; \}/.test(rule));
    assert.ok(phone, 'the media rule hides .rarity in the gear rows');
    assert.match(phone, /\.inv\.gear \.g-l1 \.rarity \{ display: none; \}/);
    // Outside the media rule nothing hides it.
    const outside = css.replace(/@media[^\n]*\n/g, '');
    assert.doesNotMatch(outside, /\.rarity[^{]*\{[^}]*display: none/);
});

test('a bound row: the lock chip "Bound · Ren" in place of "Equipped", the reason as its title, and no Drop; other rows keep their Drop', () => {
    const { el } = draw(crew());
    const dagger = daggerRow(el);
    const chip = dagger.querySelector('.g-l2 .chip.eq');
    // (the lock is the badge widget: its own label is hidden and spoken, so the chip's words are what is outside it)
    assert.equal(chip.childNodes.filter(node => !(node.nodeType === 1 && node.classes().includes('bound-lock'))).map(node => node.textContent).join('').trim(), 'Bound · Ren');
    assert.equal(chip.querySelector('.bound-lock .ss-w-badge-label').hidden, true, 'the badge\'s label is not drawn twice');
    assert.ok(chip.classList.contains('bound'));
    assert.ok(chip.querySelector('.bound-lock svg'), 'the lock glyph from the app\'s icon set');
    assert.match(chip.querySelector('svg').querySelector('path').getAttribute('d'), /^M208,80H176V56a48,48,0,0,0-96,0V80H48/, 'ph-lock-simple (solid)');
    assert.equal(chip.getAttribute('title'), 'Bound to Ren: it cannot be unequipped, given away, sold or dropped');
    assert.equal(dagger.querySelectorAll('.g-l2 .chip.eq').length, 1, 'one chip, not Equipped as well');
    assert.equal(dagger.querySelectorAll('button').filter(node => text(node) === 'Drop').length, 0, 'no Drop');
    assert.equal(dagger.querySelectorAll('.fold.drop').length, 0);
    assert.equal(text(swordRow(el).querySelector('.chip.eq')), 'Equipped · Astra');
    assert.equal(swordRow(el).querySelector('.chip.bound'), null);
    assert.equal(swordRow(el).querySelectorAll('button').filter(node => text(node) === 'Drop').length, 1, 'an ordinary piece keeps its Drop');
});

test('Edit on a bound piece: name, count, slot and Equipped by are disabled, the note is editable, the hint line says why; Save sends a note-only inventory.edit', async () => {
    const setup = crew();
    const calls = [];
    const { el } = draw(setup, calls);
    const dagger = daggerRow(el);
    dagger.querySelector('.ss-w-editable-pencil').click();
    const field = label => dagger.querySelector(`[aria-label="${label}"]`);
    for (const label of ['Item name', 'Count', 'Slot', 'Equipped by']) assert.equal(field(label).disabled, true, `${label} is disabled`);
    assert.equal(field('Note').disabled === true, false, 'the note stays editable');
    assert.equal(field('Slot').value, 'weapon');
    assert.equal(field('Equipped by').value, 'ac_ren00001');
    assert.equal(text(dagger.querySelector('.ss-w-editable-item-hint')), 'Bound to Ren: it stays in this slot and leaves with Ren. Only the note can change.');
    field('Note').value = 'the Long Watch blade, notched';
    dagger.querySelector('.ss-w-editable-save').click();
    await settle();
    assert.deepEqual(calls, [['inventory.edit', { stack: 'it_dagg0001', group: true, note: 'the Long Watch blade, notched' }]], 'one command, only the note');
    const stack = setup.h.state.domains.inventory.stacks.it_dagg0001;
    assert.deepEqual([stack.note, stack.bound, stack.owner, stack.equipped], ['the Long Watch blade, notched', 'ac_ren00001', 'ac_ren00001', 'weapon']);
    // An ordinary piece keeps its enabled fields and no hint.
    const second = draw(setup);
    const sword = swordRow(second.el);
    sword.querySelector('.ss-w-editable-pencil').click();
    assert.equal(sword.querySelectorAll('input, select').filter(node => node.disabled === true).length, 0);
    // (a pack's item says where its kind, slot and rarity come from; there is no bound hint)
    assert.deepEqual(sword.querySelectorAll('.ss-w-editable-item-hint').map(node => text(node)), ['Kind, slot and rarity come from the pack.']);
});

test('Edit on a bound piece: Save with nothing changed sends nothing (the locked choices do not unequip it)', async () => {
    const setup = crew();
    const calls = [];
    const { el } = draw(setup, calls);
    const dagger = daggerRow(el);
    dagger.querySelector('.ss-w-editable-pencil').click();
    dagger.querySelector('.ss-w-editable-save').click();
    await settle();
    assert.deepEqual(calls, []);
    assert.equal(setup.h.state.domains.inventory.stacks.it_dagg0001.equipped, 'weapon');
});

test('Edit, a note-only Save on a piece with a long name (61 to 120 characters) sends the note alone: no cut-down rename (refused on a bound piece, a silent rename on any other)', async () => {
    const long = 'Dagger of the Long Watch that Ren carried out of the burning Sealcrown';
    assert.ok(long.length > 60 && long.length <= 120);
    const setup = crew({ long });
    const calls = [];
    const { el } = draw(setup, calls);
    const row = rowOf(el, long);
    row.querySelector('.ss-w-editable-pencil').click();
    assert.equal(row.ownerDocument.activeElement, row.querySelector('[aria-label="Note"]'), 'a bound piece puts the focus on its note, the one field that can change');
    row.querySelector('[aria-label="Note"]').value = 'notched';
    row.querySelector('.ss-w-editable-save').click();
    await settle();
    assert.deepEqual(calls, [['inventory.edit', { stack: 'it_dagg0001', group: true, note: 'notched' }]]);
    const inv = setup.h.state.domains.inventory;
    assert.deepEqual([inv.stacks.it_dagg0001.note, inv.defs['pack.fantasy/dagger'].name], ['notched', long]);
});

test('the slot card: a bound tile carries a lock in its corner (and says so in its title); an ordinary tile has none', () => {
    const setup = crew();
    const doc = setupDom();
    const parent = doc.createElement('div');
    doc.body.appendChild(parent);
    const view = setup.h.query('gear.view', { who: 'Ren' });
    assert.equal(view.slots.weapon.bound.who, 'Ren');
    renderGearCard(parent, { character: { name: 'Ren', levelText: 'Lv 1', module: 'x', subject: 'ren' }, view, doc });
    const tile = parent.querySelector('.rpg-slot[data-slot="weapon"]');
    assert.ok(tile.classList.contains('bound'));
    const lock = tile.querySelector('svg.rpg-slot-lock');
    assert.ok(lock, 'the lock glyph sits in the tile');
    assert.equal(lock.getAttribute('aria-label'), 'Bound to Ren');
    assert.match(tile.getAttribute('title'), /Bound to Ren$/);
    assert.equal(parent.querySelectorAll('.rpg-slot-lock').length, 1, 'only the bound tile');
    const mine = setup.h.query('gear.view', { who: 'Astra', own: true });
    const own = doc.createElement('div');
    doc.body.appendChild(own);
    renderGearCard(own, { character: { name: 'Astra', levelText: 'Lv 1', module: 'x', subject: 'astra' }, view: mine, doc });
    assert.equal(own.querySelectorAll('.rpg-slot-lock, .rpg-slot.bound').length, 0, 'Astra\'s own sword is not bound');
});

test('the refusal sentence is the code\'s, gender-neutral: "Bound to Ren: Dagger stays with them."', async () => {
    const setup = crew();
    const result = await Promise.resolve(setup.h.run('inventory.drop', { stack: 'it_dagg0001' }, { cause: 'ui', extra: { feature: featureOn } }));
    const message = JSON.stringify(result);
    assert.match(message, /Bound to Ren: Dagger stays with them\./);
    assert.doesNotMatch(message, /\bhim\b|\bher\b/);
});

test('a story item\'s Carry control shows its word, and its open form keeps line 2 and sits outside any height-locked line', async () => {
    const setup = crew({ rope: 7 });
    const calls = [];
    const { el, problems } = draw(setup, calls);
    assert.deepEqual(problems, []);
    const rope = rowOf(el, 'Rope');
    const control = rope.querySelector('.g-l2 .item-carry');
    assert.ok(control, 'the Carry control is in line 2');
    assert.equal(text(control.querySelector('.ss-w-editable-value')), 'Carry +7', 'its word');
    assert.equal(rope.querySelectorAll('.ss-w-editable-pencil').length, 2, 'Edit pencil and Carry pencil');
    control.querySelector('.ss-w-editable-pencil').click();
    const form = rope.querySelector('.item-carry .ss-w-editable-item-form');
    assert.ok(form, 'the Carry form is open inside the control');
    assert.ok(form.querySelector('input[type="number"]'), 'with its number input');
    assert.ok(form.querySelector('.ss-w-editable-save') && form.querySelector('.ss-w-editable-cancel'), 'Save and Cancel');
    // The CSS: line 2 holding the open form is not hidden and not locked to 16px; the row's fixed-line rules stop while any form is open.
    const css = inventoryScreen.css;
    assert.match(css, /:is\(\.g-l2:not\(:has\(\.ss-w-editable-item-form\)\), \.g-l3\) \{ display: none; \}/);
    assert.match(css, /\.g-l2:has\(\.ss-w-editable-item-form\) \{ display: flex; flex-wrap: wrap; height: auto; overflow: visible; white-space: normal; \}/);
    assert.equal(rope.querySelector('.g-l1').querySelector('.item-carry'), null);
    // Gear off: no Carry control.
    assert.equal(draw(crew({ gear: false })).el.querySelectorAll('.item-carry').length, 0);
});

test('rendered at phone width, gear on: clicking Carry shows a visible form with a usable input (optional browser)', async t => {
    let chromium;
    try { ({ chromium } = await import('playwright')); } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; t.skip('Install the optional browser package to run the rendered check.'); return; }
    let browser;
    try { browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] }); } catch (error) { t.skip(`Browser unavailable: ${String(error).split('\n')[0]}`); return; }
    t.after(() => browser.close());
    const css = inventoryScreen.css;
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    // The row's real shape (lines, Edit control, Carry control with an open form) under the screen's own CSS.
    await page.setContent(`<style>${css}</style><div class="inv gear"><ul><li class="item grow"><div class="body"><div class="line g-l1"><span class="name">Rope</span></div>
      <div class="g-l2"><span class="item-carry"><span class="ss-w-editable"><button class="ss-w-editable-pencil">p</button><form class="ss-w-editable-item-form"><label>Adds carry capacity (0-500)<input type="number" value="7"></label><button type="button">Save</button><button type="button">Cancel</button></form></span></span></div>
      <div class="detail g-l3">x</div></div></li></ul></div>`);
    const box = await page.locator('.item-carry input').boundingBox();
    assert.ok(box && box.width > 40 && box.height > 10, 'the input is visible with a size');
    assert.equal(await page.locator('.g-l2').evaluate(node => getComputedStyle(node).display !== 'none' && getComputedStyle(node).overflow === 'visible'), true);
    assert.equal(await page.locator('.g-l3').evaluate(node => getComputedStyle(node).display), 'none');
});
