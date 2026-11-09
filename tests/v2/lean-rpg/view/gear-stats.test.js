// What gear adds to a stat on the Party card (Gear in fights): the big number is the stat a roll uses with "+N" under it, in a theme colour; no gear on
// the stat is today's markup; a broken piece, the switch off and a companion's own gear; and the Skills sheet's "Rolls with it" line agrees with the roll.
// The numbers come from planGear + applyGear, the roll's own source. The rendered check (real CSS, sizes, shots) is run outside the suite with Playwright.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setupDom } from '../../view/mounts/helpers.js';
import { STANDARD_TEMPLATES_EIGHT as STANDARD_TEMPLATES } from '../../../../src/v2/lean-rpg/templates.js';
import { createPartyWidget } from '../../../../src/v2/lean-rpg/view/party.js';
import { readParty } from '../../../../src/v2/lean-rpg/view/party-data.js';
import { renderSkills, rollOf } from '../../../../src/v2/lean-rpg/view/skills.js';
import { applyGear, planGear } from '../../../../src/v2/lean-rpg/gear.js';
import { readSheet } from '../../../../src/v2/lean-rpg/read.js';
import { createCoreModule } from '../../../../src/v2/domains/index.js';
import { createHarness } from '../../domains/helpers/fake-ctx.js';
import { stocked } from '../../domains/fixtures.js';
import { dump } from '../../helpers/gear-ui-state.js';
import { fakeState } from './helpers.js';

const template = role => structuredClone(STANDARD_TEMPLATES.find(entry => entry.definition.role === role).definition);
const BASE = { str: 5, vit: 10, agi: 10, dex: 5, int: 5, luk: 5, cha: 5, level: 2 };
const roleOf = definition => definition?.role ?? null;
const named = (who, fields) => { const definition = template('character'); definition.slug = who.toLowerCase(); definition.name = who; return { definition, fields: { who, ...BASE, ...fields } }; };
const SKILLS = { who: 'Astra', skill1: 'Short blade', stat1: 'agi', uses1: 'stamina', rank1: 1, skill2: 'Iron Breath', stat2: 'vit', uses2: 'stamina', rank2: 2 };

/** The owner's shape: Astra (the reader's lead, gear filed under `party`) wears Linen Clothes +1 VIT, Traveling Robe +1 VIT, Cane Sword +1 AGI; Ren (a companion) wears what `ren` says. */
function world({ ren = [], cond = {}, extra = {} } = {}) {
    const module = createCoreModule({ hooks: () => [], settings: () => ({}), extras: { gearOn: () => true, persona: () => 'Astra' } });
    const s = stocked(module), inv = s.domains.inventory;
    const piece = (id, name, slot, owner, stats, place, rarity = 'common') => {
        inv.defs[`story/${id}`] = { id: `story/${id}`, name, kind: 'equipment', slot, rarity, value: 1, stack: false, tags: [], note: '', stats };
        inv.stacks[`it_${id}0000`] = { id: `it_${id}0000`, def: `story/${id}`, qty: 1, owner, equipped: place, note: '', from: '', ...(cond[id] === undefined ? {} : { cond: cond[id] }) };
    };
    piece('linen', 'Linen Clothes', 'body', 'party', { VIT: 1 }, 'body');
    piece('robe', 'Traveling Robe', 'cloak', 'party', { VIT: 1 }, 'cloak');
    piece('cane', 'Cane Sword', 'weapon', 'party', { AGI: 1 }, 'weapon');
    ren.forEach(([id, name, slot, stats, rarity]) => piece(id, name, slot, 'ac_ren00001', stats, slot, rarity));
    s.domains.party = { actors: { ac_ren00001: { id: 'ac_ren00001', name: 'Ren' } } };
    Object.assign(s.domains, fakeState([named('Astra', {}), named('Ren', extra), { definition: { ...template('skills'), slug: 'astra-skills' }, fields: SKILLS }]).domains);
    // (the harness works on a copy of the state, so each question is put to a fresh one: a change to `s` shows at once, as a new head would)
    const query = (name, args) => (name === 'party.actors' ? [{ id: 'ac_ren00001', name: 'Ren' }] : createHarness([module], { state: s }).query(name, args));
    return { s, query, plan: () => planGear(readSheet(s), query, 'Astra') };
}

function draw(w, { on = true } = {}) {
    const doc = setupDom(), el = doc.createElement('div');
    doc.body.appendChild(el);
    const gear = { on: () => on, view: args => w.query('gear.view', args), plan: w.plan };
    const widget = createPartyWidget({ headState: () => w.s, readerName: () => 'Astra', roleOf, gear });
    const handle = widget.render(el, {}, {});
    return { doc, el, widget, handle };
}
const cell = (el, name, stat) => el.querySelector(`.rpg-card[data-character="${name}"] .rpg-stat[data-stat="${stat}"]`);
const cells = (el, name) => el.querySelector(`.rpg-card[data-character="${name}"] .rpg-stats`).querySelectorAll('.rpg-stat').map(node => node.textContent);

test('the owner\'s shape: VIT reads 12 with +2 under it, AGI 11 with +1; the other five are untouched', () => {
    const { el } = draw(world());
    assert.equal(cell(el, 'Astra', 'vit').textContent, 'VIT12+2');
    assert.equal(cell(el, 'Astra', 'agi').textContent, 'AGI11+1');
    assert.deepEqual(cells(el, 'Astra').filter((_, at) => ![1, 2].includes(at)), ['STR5', 'DEX5', 'INT5', 'LUK5', 'CHA5']);
    assert.ok(cell(el, 'Astra', 'vit').querySelector('b').classList.contains('rpg-stat-up'), 'the big number wears the colour class');
    assert.equal(cell(el, 'Astra', 'vit').querySelector('.rpg-stat-add').textContent, '+2');
    // the big number is the very one the roll reads
    const rolled = applyGear(readSheet(world().s), world().plan()).characters.find(entry => entry.key === 'astra').stats;
    assert.deepEqual([rolled.vit, rolled.agi], [12, 11]);
    // the growth line stays on the block's numbers
    assert.match(el.querySelector('.rpg-card[data-character="Astra"] .rpg-growth').textContent, /VIT 10\b/);
});

test('no gear on a stat: the cell is today\'s markup, and a card with no gear at all is byte-identical to the card with no gear host', () => {
    const none = world();
    for (const stack of Object.values(none.s.domains.inventory.stacks)) stack.equipped = '';
    const worn = draw(none), bare = draw(world(), { on: false });
    assert.equal(dump(worn.el.querySelector('.rpg-card[data-character="Astra"] .rpg-stats')), dump(bare.el.querySelector('.rpg-card[data-character="Astra"] .rpg-stats')));
    assert.equal(cell(bare.el, 'Astra', 'str').querySelectorAll('span').length, 0, 'no extra node');
    assert.deepEqual(cells(bare.el, 'Astra'), ['STR5', 'VIT10', 'AGI10', 'DEX5', 'INT5', 'LUK5', 'CHA5'], 'switch off: no bonus');
});

test('a broken piece gives nothing: its +1 is gone from the cell', () => {
    const { el } = draw(world({ cond: { robe: 0 } }));
    assert.equal(cell(el, 'Astra', 'vit').textContent, 'VIT11+1');
    const all = draw(world({ cond: { robe: 0, linen: 0, cane: 0 } }));
    assert.deepEqual(cells(all.el, 'Astra'), ['STR5', 'VIT10', 'AGI10', 'DEX5', 'INT5', 'LUK5', 'CHA5']);
});

test('a companion\'s own gear shows on their card only; the reader\'s party bag is not theirs', () => {
    const { el } = draw(world({ ren: [['cap', 'Iron Cap', 'head', { VIT: 2 }, 'uncommon']] }));
    assert.equal(cell(el, 'Ren', 'vit').textContent, 'VIT12+2');
    assert.equal(cell(el, 'Ren', 'agi').textContent, 'AGI10', 'the cane sword is Astra\'s');
    assert.equal(cell(el, 'Astra', 'vit').textContent, 'VIT12+2');
});

test('both cards show soak from the same effective VIT as their rolls, including broken gear and the cap', () => {
    const options = { ren: [['cap', 'Iron Cap', 'head', { VIT: 3 }, 'rare'], ['robe2', 'Robe', 'cloak', { VIT: 3 }, 'rare']] };
    const w = world(options), { el } = draw(w);
    const growth = name => el.querySelector(`.rpg-card[data-character="${name}"] .rpg-growth`).textContent;
    const rolled = applyGear(readSheet(w.s), w.plan()).characters;
    assert.deepEqual(rolled.map(actor => actor.stats.vit), [12, 16]);
    assert.match(growth('Astra'), /Soak \+3 \(next at VIT 16\)$/);
    assert.match(growth('Ren'), /Soak \+4 \(next at VIT 20\)$/);
    const broken = draw(world({ ...options, cond: { cap: 0, robe2: 0 } })).el;
    assert.match(broken.querySelector('.rpg-card[data-character="Ren"] .rpg-growth').textContent, /Soak \+2 \(next at VIT 12\)$/);
    const capped = draw(world({ ...options, extra: { vit: 20 } })).el;
    assert.match(capped.querySelector('.rpg-card[data-character="Ren"] .rpg-growth').textContent, /Soak \+5$/);
});

test('the sum is held to 30', () => {
    const { el } = draw(world({ extra: { vit: 20 }, ren: [['plate', 'Plate', 'body', { VIT: 5 }, 'legendary'], ['helm', 'Helm', 'head', { VIT: 5 }, 'legendary'], ['mail', 'Mail', 'feet', { VIT: 5 }, 'legendary']] }));
    assert.equal(cell(el, 'Ren', 'vit').querySelector('b').textContent, '30');
});

test('redraw: equipping, unequipping or breaking a piece changes the cell on the next draw', () => {
    const w = world(), { el, handle } = draw(w);
    const changed = () => handle.update();
    assert.equal(cell(el, 'Astra', 'agi').textContent, 'AGI11+1');
    w.s.domains.inventory.stacks.it_cane0000.equipped = '';
    changed();
    assert.equal(cell(el, 'Astra', 'agi').textContent, 'AGI10');
    w.s.domains.inventory.stacks.it_cane0000.equipped = 'weapon';
    changed();
    assert.equal(cell(el, 'Astra', 'agi').textContent, 'AGI11+1');
    w.s.domains.inventory.stacks.it_linen0000.cond = 0;
    changed();
    assert.equal(cell(el, 'Astra', 'vit').textContent, 'VIT11+1');
});

test('the Skills sheet\'s roll line uses the effective stat and the same total as the roll; the Stats screen stays on the block\'s numbers', () => {
    const w = world(), { el } = draw(w);
    el.querySelector('.rpg-card[data-character="Astra"] .rpg-skills-open').click();
    const lines = el.querySelectorAll('.rpg-skill-roll').map(node => node.textContent);
    // what the roll reads: the sheet with the gear laid over it
    const stats = applyGear(readSheet(w.s), w.plan()).characters.find(entry => entry.key === 'astra').stats;
    assert.deepEqual([stats.agi, stats.vit], [11, 12]);
    assert.match(lines[0], /AGI 11/);
    assert.match(lines[1], /VIT 12/);
    assert.equal(lines[0].startsWith(`d20 +${Math.floor(stats.agi / 2) + 1}`) || lines[0].includes(`+${Math.floor(stats.agi / 2) + 1}`), true, lines[0]);
    assert.equal(lines[1].includes(`+${Math.floor(stats.vit / 2) + 2}`), true, lines[1]);
    // the pure function: effective stat in, the roll's total out; a card with no `eff` rolls as before
    const party = readParty(w.s, { own: 'Astra', roleOf })[0];
    const dressed = { ...party, stats: party.stats.map(stat => (stat.key === 'agi' ? { ...stat, eff: 11, add: 1 } : stat)) };
    const blade = party.skills[0];
    assert.equal(rollOf(blade, party).total, 5 + 1);
    assert.deepEqual([rollOf(blade, dressed).total, rollOf(blade, dressed).value], [5 + 1, 11]);
    assert.equal(rollOf({ ...blade, stat: 'agi' }, { ...dressed, stats: dressed.stats.map(stat => (stat.key === 'agi' ? { ...stat, eff: 12 } : stat)) }).total, 6 + 1);
    // the Stats (points) screen reads the block's numbers
    const src = readFileSync(new URL('../../../../src/v2/lean-rpg/view/distribute.js', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /\.eff\b|gear-stats/);
});

test('the colours are theme tokens, never literals', () => {
    const css = readFileSync(new URL('../../../../src/v2/lean-rpg/view/lean-rpg.css', import.meta.url), 'utf8');
    for (const name of ['rpg-stat-up', 'rpg-stat-down']) assert.match(new RegExp(`\\.${name} \\{ color: var\\(--ss-[a-z]+\\); \\}`).exec(css)?.[0] ?? '', /var\(--ss-/);
    assert.doesNotMatch(/\.rpg-stat-(up|down|add)[^}]*\}/.exec(css)[0], /#[0-9a-f]{3,6}|rgb/i);
});
