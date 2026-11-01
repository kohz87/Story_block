// The Standard formula's bars on the screens: the Party card (N blocks, "Hurt · 4 of 6", the next-block line), the hero bars, the Fight tab (foe Health by
// class, the turn order row) and the battle log (the recorded turn order, the quick start, "does not act", the breakdown). A Classic block and a record
// without the new parts draw exactly as before (the older view tests cover those).
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from '../../view/mounts/helpers.js';
import { STANDARD_TEMPLATES } from '../../../../src/v2/lean-rpg/templates.js';
import { createPartyWidget } from '../../../../src/v2/lean-rpg/view/party.js';
import { createFightWidget, readFight } from '../../../../src/v2/lean-rpg/view/fight.js';
import { heroLead } from '../../../../src/v2/lean-rpg/view/hero-data.js';
import { growthText, readFoes, readParty } from '../../../../src/v2/lean-rpg/view/party-data.js';
import { buildPanel, panelModel, readResolve } from '../../../../src/v2/lean-rpg/view/battle-log.js';
import { fakeState } from './helpers.js';

const standard = (name, slug) => ({ ...structuredClone(STANDARD_TEMPLATES.find(entry => entry.name === name).definition), slug });
const roleOf = definition => definition.role ?? null;
const wessel = { definition: standard('Character', 'wessel'), fields: { who: 'Wessel', str: 10, vit: 10, agi: 10, dex: 6, int: 5, luk: 3, cha: 5, soul: 2, health: 4, stamina: 2, mana: 4, 'health-blocks': 6, 'stamina-blocks': 5, 'mana-blocks': 4 } };
const ren = { definition: standard('Character', 'ren'), fields: { who: 'Ren' } };
const foes = { definition: standard('Foes', 'foes'), fields: { foe1: 'Weir-drake', count1: 1, class1: 4, hurt1: 5, foe2: 'Sluice Rat', count2: 2, class2: 2, hurt2: 1 } };
const state = () => fakeState([wessel, ren, foes]);

function draw(widgetOf, props) {
    const doc = setupDom(), el = doc.createElement('div');
    doc.body.appendChild(el);
    widgetOf(props).render(el, {}, {});
    return el;
}
const party = () => draw(createPartyWidget, { headState: state, readerName: () => 'Wessel', roleOf });

test('a Standard character\'s bars are as big as their stats say, with the word spread over them and "n of N"', () => {
    const [mine, theirs] = readParty(state(), { own: 'Wessel', roleOf });
    assert.deepEqual(['health', 'stamina', 'mana'].map(key => [mine.bars[key].value, mine.bars[key].max, mine.bars[key].word, mine.bars[key].text]),
        [[4, 6, 'Hurt', 'Hurt · 4 of 6'], [2, 5, 'Tired', 'Tired · 2 of 5'], [4, 4, 'Fresh', 'Fresh · 4 of 4']]);
    assert.deepEqual(['health', 'stamina', 'mana'].map(key => [theirs.bars[key].max, theirs.bars[key].word]), [[5, 'Unhurt'], [4, 'Fresh'], [4, 'Fresh']], 'new stats of 5: Health 5, Stamina 4, Mana 4');
    assert.equal(mine.bars.health.tone, 'warn');
});

test('the Party card draws one cell per block and says "Hurt · 4 of 6"', () => {
    const el = party();
    const card = el.querySelector('.rpg-card[data-character="Wessel"]');
    const meter = name => card.querySelector(`.rpg-bar[data-bar="${name}"] .ss-w-meter`);
    assert.deepEqual(['health', 'stamina', 'mana'].map(name => meter(name).querySelectorAll('.ss-w-meter-cell').length), [6, 5, 4]);
    assert.deepEqual(['health', 'stamina', 'mana'].map(name => meter(name).querySelectorAll('.ss-w-on').length), [4, 2, 4]);
    assert.match(card.querySelector('.rpg-bar[data-bar="health"]').textContent, /Hurt · 4 of 6/);
    assert.match(card.querySelector('.rpg-bar[data-bar="stamina"]').textContent, /Tired · 2 of 5/);
    assert.equal(meter('health').getAttribute('aria-valuemax'), '6');
});

test('the line under the skills: how many blocks each bar has, the stat that earns the next one and the next luck', () => {
    const card = party().querySelector('.rpg-card[data-character="Wessel"]');
    assert.equal(card.querySelector('.rpg-growth').textContent, 'Health 6 blocks (VIT 10, next at 15) · Stamina 5 (AGI 10, next at 15) · Mana 4 (INT 5, next at 10) · Edge −3..+3 (next at LUK 5)');
    assert.equal(growthText({ health: { blocks: 8, value: 20, next: null }, stamina: { blocks: 7, value: 20, next: null }, mana: { blocks: 7, value: 20, next: null }, luck: { min: 3, max: 5, next: null } }),
        'Health 8 blocks (VIT 20) · Stamina 7 (AGI 20) · Mana 7 (INT 20) · Edge +3..+5');
    const classic = draw(createPartyWidget, { headState: () => fakeState([{ definition: { ...structuredClone(STANDARD_TEMPLATES[0].definition), state: { ...structuredClone(STANDARD_TEMPLATES[0].definition.state), health: { type: 'int', min: 0, max: 5, default: 5 } } }, fields: { who: 'Old' } }]), readerName: () => 'Old', roleOf });
    assert.equal(classic.querySelector('.rpg-growth'), null, 'a block whose Health is not marked as blocks has no such line');
    assert.equal(readParty(fakeState([wessel]), { own: 'Wessel', roleOf })[0].growth.health.next, 15);
});

test('the pencil on a Standard bar offers every count from empty to full, each with its word', () => {
    const doc = setupDom(), el = doc.createElement('div');
    doc.body.appendChild(el);
    createPartyWidget({ headState: state, readerName: () => 'Wessel', roleOf }).render(el, {}, { command: async () => ({ ok: true }) });
    const bar = el.querySelector('.rpg-card[data-character="Wessel"] .rpg-bar[data-bar="health"]');
    bar.querySelector('.ss-w-editable-pencil').click();
    assert.deepEqual(bar.querySelectorAll('option').map(node => node.textContent),
        ['Down · 0 of 6', 'Badly wounded · 1 of 6', 'Wounded · 2 of 6', 'Hurt · 3 of 6', 'Hurt · 4 of 6', 'Scratched · 5 of 6', 'Unhurt · 6 of 6']);
});

test('the header\'s hero bars have the same sizes and the word', () => {
    const lead = heroLead(state(), { own: 'Wessel', roleOf });
    assert.deepEqual(lead.bars.slice(0, 3), [
        { kind: 'hp', label: 'Health', value: 4, max: 6, text: 'Hurt' }, { kind: 'mp', label: 'Mana', value: 4, max: 4, text: 'Fresh' }, { kind: 'sp', label: 'Stamina', value: 2, max: 5, text: 'Tired' }]);
});

test('foe groups have Health by class: Class IV 5 blocks, Class II 4, the words spread over them', () => {
    assert.deepEqual(readFoes(state(), { roleOf }).map(foe => [foe.name, foe.hurt, foe.max, foe.word]), [['Weir-drake', 5, 5, 'Unhurt'], ['Sluice Rat', 1, 4, 'Badly wounded']]);
    const el = draw(createFightWidget, { headState: state, readerName: () => 'Wessel', roleOf, battleLog: { latest: () => null } });
    const bar = name => el.querySelector(`.rpg-foe[data-foe="${name}"] .ss-w-meter`);
    assert.deepEqual([bar('Weir-drake'), bar('Sluice Rat')].map(node => node.querySelectorAll('.ss-w-meter-cell').length), [5, 4]);
    assert.match(el.querySelector('.rpg-foe[data-foe="Weir-drake"]').textContent, /Unhurt · 5 of 5/);
    assert.match(el.querySelector('.rpg-foe[data-foe="Sluice Rat"]').textContent, /Badly wounded · 1 of 4/);
    assert.match(el.querySelector('.rpg-fight-note').textContent, /^Foe Health grows with class: 4 \+ class\/3 blocks/);
    assert.deepEqual(readFight(state(), { roleOf }).map(foe => foe.stages.length), [6, 5]);
    assert.equal(el.querySelector('.rpg-order'), null, 'no recorded order, no row');
});

// A Standard record as lean-rpg/standard.js writes it (the parts the log reads).
const pc = (who, stat, extra = {}) => ({ who, die: 17, type: 'physical', stat, second: 'dex', mainValue: 10, secondValue: 6, statBonus: 6, style: null, classValue: 2, classBonus: 4, rank: 2, window: { min: -2, max: 3 }, situation: 0, edge: 0, total: 29, ...extra });
const foeSide = (name, extra = {}) => ({ slot: 1, name, die: 9, base: 3, classValue: 4, classBonus: 12, total: 24, ...extra });
const record = (extra = {}) => ({ v: 1, formula: 'standard', checks: [], refused: [], rounds: [
    { n: 1, lines: [
        { kind: 'act', type: 'physical', outcome: 'success', skill: 'Iaijutsu', decisive: true, pc: pc('Wessel', 'agi'), foe: foeSide('Weir-drake'), damage: { id: 'f:1', kind: 'foe', name: 'Weir-drake', blocks: 2, from: 6, to: 4, size: 6 } },
        { kind: 'foe', type: 'defence', outcome: 'success', skill: 'Shadow step', pc: pc('Wessel', 'agi', { type: 'defence', second: 'vit', secondValue: 10, statBonus: 7, rank: 0, window: { min: 2, max: 4 }, situation: 1, edge: 2, die: 10, total: 23, style: 'dodge' }), foe: foeSide('Weir-drake', { die: 4, total: 19 }) },
        { kind: 'act', type: 'physical', outcome: 'success', skill: 'Sweep', area: true, pc: pc('Ren', 'str', { total: 27 }), foe: foeSide('Sluice Rat', { classValue: 2, classBonus: 6, total: 18 }), damage: { id: 'f:2', kind: 'foe', name: 'Sluice Rat', blocks: 1, from: 5, to: 4, size: 5 } },
        { kind: 'check', type: 'magic', support: true, target: 'Wessel', outcome: 'success', skill: 'Mend', difficulty: 'normal', dc: 15, pc: pc('Mara', 'int', { type: 'magic', total: 21 }), damage: { id: 'c:wessel', kind: 'char', name: 'Wessel', blocks: -1, from: 4, to: 5, size: 6 } }],
      idle: [{ n: 1, id: 'f:2', who: 'Sluice Rat', kind: 'foe', why: 'beaten' }, { n: 1, id: 'c:ren', who: 'Ren', kind: 'char', why: 'down' }] }],
opening: [{ kind: 'act', type: 'physical', opening: true, outcome: 'success', skill: 'Iaijutsu', pc: pc('Wessel', 'agi'), foe: foeSide('Sluice Rat', { classValue: 2, classBonus: 6, total: 18 }) }],
order: [{ id: 'c:wessel', name: 'Wessel', total: 21, die: 12, bonus: 9, agi: 10, party: true, fresh: true }, { id: 'f:1', name: 'Weir-drake', total: 18, party: false }, { id: 'f:2', name: 'Sluice Rat', total: 17, party: false }],
quickStart: [{ who: 'Wessel', against: 'Sluice Rat' }], ...extra });

test('the battle log reads the recorded turn order with its totals, the quick start and opening action, who does not act, and builds the breakdown from the roll\'s parts', () => {
    const read = readResolve(record());
    assert.deepEqual(read.order, ['Wessel', 'Weir-drake', 'Sluice Rat']);
    assert.deepEqual(read.orderEntries.map(item => [item.name, item.total, item.party]), [['Wessel', 21, true], ['Weir-drake', 18, false], ['Sluice Rat', 17, false]]);
    assert.deepEqual(read.quickStart, [{ who: 'Wessel', against: 'Sluice Rat' }]);
    assert.deepEqual(read.rounds[0].skipped, [{ who: 'Sluice Rat', why: 'beaten' }, { who: 'Ren', why: 'down' }]);
    assert.equal(read.opening.length, 1);
    const [hit, dodge, sweep, mend] = read.rounds[0].lines;
    assert.equal(hit.breakdown, 'Physical: d20 17 + (AGI 10 + DEX 6/2)/2 = 6 + Expert 2 + Class II 4 = 29 · vs Weir-drake d20 9 + 3 + Class IV 12 = 24 · Weir-drake loses 2 blocks (4 of 6) · Decisive');
    assert.equal(dodge.breakdown, 'Defence, dodge: d20 10 + (AGI 10 + VIT 10/2)/2 = 7 + Novice 0 + Class II 4 + edge 2 (luck window 2..4) = 23 · vs Weir-drake d20 4 + 3 + Class IV 12 = 19');
    assert.deepEqual([mend.who, mend.target, mend.support, mend.vs], ['Mara', 'Wessel', true, 15]);
    assert.match(mend.breakdown, /vs DC 15 · Wessel heals 1 block \(5 of 6\)$/);
    assert.equal(sweep.area, true);
    const panel = buildPanel(setupDom(), panelModel({ resolve: read, state: state(), before: null, roleOf }));
    assert.equal(panel.querySelector('.rpg-bl-order').textContent, 'Turn order: Wessel 21 > Weir-drake 18 > Sluice Rat 17');
    assert.equal(panel.querySelector('.rpg-bl-quick').textContent, 'Quick start: Wessel acts first against Sluice Rat.');
    assert.equal(panel.querySelector('.rpg-bl-opening .rpg-bl-round-title').textContent, 'Opening action');
    assert.deepEqual(panel.querySelectorAll('.rpg-bl-skip').map(node => node.textContent), ['Sluice Rat does not act: beaten before its turn.', 'Ren does not act: down.']);
    const texts = panel.querySelectorAll('.rpg-bl-round:not(.rpg-bl-opening) .rpg-act-text').map(node => node.textContent);
    assert.match(texts[0], /^Wessel uses Iaijutsu on Weir-drake — Decisive \(29 vs 24\)/);
    assert.match(texts[1], /^Weir-drake attacks Wessel \(Shadow step\) — Blocked \(19 vs 23\)/);
    assert.match(texts[2], /^Ren uses Sweep on Sluice Rat \(area\) — Success/);
    assert.match(texts[3], /^Mara uses Mend on Wessel — Success \(21 vs 15\)/);
    assert.match(panel.querySelector('.rpg-why').textContent, /^Physical: d20 17 \+ \(AGI 10 \+ DEX 6\/2\)\/2 = 6/);
});

test('a line that carries its own breakdown text shows that instead', () => {
    const read = readResolve(record({ rounds: [{ n: 1, lines: [{ kind: 'act', type: 'physical', outcome: 'success', skill: 'Iaijutsu', breakdown: 'Told by the rules.', pc: pc('Wessel', 'agi'), foe: foeSide('Weir-drake') }] }] }));
    assert.equal(read.rounds[0].lines[0].breakdown, 'Told by the rules.');
});

test('a record without the new parts reads exactly as it did: names of the first round, no totals, no extra lines', () => {
    const old = readResolve({ v: 1, checks: [], refused: [], rounds: [{ n: 1, lines: [{ kind: 'act', outcome: 'success', skill: 'Short blade', pc: { who: 'Wessel', die: 10, stat: 'agi', statBonus: 5, classValue: 2, classBonus: 4, rank: 0, edge: 0, total: 24 }, foe: { slot: 1, name: 'Sluice Rat A', die: 9, base: 5, classValue: 1, classBonus: 2, total: 13 } }] }] });
    assert.deepEqual(Object.keys(old), ['rounds', 'checks', 'refused', 'order', 'ended']);
    assert.deepEqual(Object.keys(old.rounds[0]), ['n', 'lines']);
    assert.deepEqual(old.order, ['Wessel']);
    assert.equal(old.rounds[0].lines[0].breakdown, 'd20 10 + AGI 5 + Class II 4 = 24 vs d20 9 + 5 + Class I 2 = 13', 'a Classic line\'s breakdown is built as before');
    const panel = buildPanel(setupDom(), panelModel({ resolve: old, state: state(), before: null, roleOf }));
    assert.equal(panel.querySelector('.rpg-bl-order').textContent, 'Turn order: Wessel');
    assert.equal(panel.querySelector('.rpg-bl-quick'), null);
    assert.equal(panel.querySelector('.rpg-bl-skip'), null);
    assert.equal(panel.querySelector('.rpg-bl-opening'), null);
});

test('the Fight tab shows the turn order row from the latest rolls and the quick start; a round with only "does not act" still counts', () => {
    const resolve = readResolve(record());
    const latest = () => ({ index: 3, key: 'k', model: panelModel({ resolve, state: state(), before: null, roleOf }) });
    const el = draw(createFightWidget, { headState: state, readerName: () => 'Wessel', roleOf, battleLog: { latest } });
    const row = el.querySelector('.rpg-order');
    assert.equal(row.querySelector('.rpg-order-head').textContent, 'Turn order');
    assert.deepEqual(row.querySelectorAll('.rpg-order-pill').map(node => node.textContent), ['1 Wessel21', '2 Weir-drake18', '3 Sluice Rat17']);
    assert.ok(row.querySelector('.rpg-order-pill').classList.contains('rpg-order-party'));
    assert.match(row.querySelector('.rpg-order-note').textContent, /Rolled at the start of this fight/);
    assert.equal(el.querySelector('.rpg-quick-start').textContent, 'Wessel gets an opening action against Sluice Rat: 10 or more ahead in the turn order.');
    const only = readResolve({ v: 1, checks: [], refused: [], rounds: [{ n: 1, lines: [], idle: [{ who: 'Sluice Rat', why: 'beaten' }] }] });
    assert.deepEqual(only.rounds.map(round => [round.n, round.skipped]), [[1, [{ who: 'Sluice Rat', why: 'beaten' }]]]);
    assert.deepEqual(readResolve({ v: 1, rounds: [{ n: 1, lines: [], skipped: ['Rat'] }] }).rounds[0].skipped, [{ who: 'Rat', why: 'beaten' }], 'plain names read as beaten before their turn');
});
