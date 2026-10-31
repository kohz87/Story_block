import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setupDom } from '../../view/mounts/helpers.js';
import { createPartyScreen, createPartyWidget, PARTY_SCREEN_ID, PARTY_WIDGET } from '../../../../src/v2/lean-rpg/view/party.js';
import { hasCharacters, readParty, stageTone, stageWord } from '../../../../src/v2/lean-rpg/view/party-data.js';
import { activeNow } from '../../../../src/v2/view/mounts/common.js';
import { characterDefinition, fakeState, foesDefinition, roleOf, skillsDefinition } from './helpers.js';

const wessel = { definition: characterDefinition('wessel', 'Wessel'), fields: { health: 3, mana: 4, stamina: 1, str: 14, vit: 12, agi: 11, dex: 10, int: 8, luk: 9, cha: 10, points: 3, soul: 2, xp: 40 } };
const ren = { definition: characterDefinition('ren', 'Ren'), fields: { health: 5, mana: 2, stamina: 3, str: 7, vit: 9, agi: 10, dex: 11, int: 15, luk: 10, cha: 12, soul: 1, xp: 85 } };
const skills = { definition: skillsDefinition('wessel-skills', 'Wessel', { tab: true, card: false, tabName: 'Skills', icon: 'ph-star' }), fields: { skill1: 'Iron Breath', rank1: 2, skill2: 'Short blade', rank2: 0 } };
const party = () => fakeState([ren, wessel, skills]);

function draw(state, { api = {}, own = 'Wessel', openWizard = null } = {}) {
    const doc = setupDom(), el = doc.createElement('div');
    doc.body.appendChild(el);
    const widget = createPartyWidget({ headState: () => state, readerName: () => own, roleOf, openWizard });
    const handle = widget.render(el, {}, api);
    return { doc, el, handle, widget };
}
const buttons = (root, text) => root.querySelectorAll('button').filter(node => node.textContent === text);
const card = (el, name) => el.querySelector(`.rpg-card[data-character="${name}"]`);

test('the reader\'s own character comes first, then block order; each card reads its block', () => {
    const read = readParty(party(), { own: 'Wessel', roleOf });
    assert.deepEqual(read.map(character => [character.name, character.own]), [['Wessel', true], ['Ren', false]]);
    const [first] = read;
    assert.equal(first.soulName, 'II');
    assert.deepEqual(first.skills.map(skill => `${skill.name} (${skill.rankName})`), ['Iron Breath (Expert)', 'Short blade (Novice)']);
    assert.deepEqual(read[1].skills, [], 'a character with no Skills block has no skills');
    assert.deepEqual(readParty(party(), { own: 'Nobody', roleOf }).map(character => character.name), ['Ren', 'Wessel'], 'no match: block order');
    assert.deepEqual(readParty(party(), { roleOf: () => null }), [], 'no role, no party');
});

test('stage bars: one cell per stage, the stage word, a tone by stage', () => {
    const [first] = readParty(party(), { own: 'Wessel', roleOf });
    assert.deepEqual(Object.fromEntries(Object.entries(first.bars).map(([key, bar]) => [key, [bar.value, bar.max, bar.word, bar.tone]])),
        { health: [3, 5, 'Hurt', 'warn'], mana: [4, 4, 'Fresh', 'good'], stamina: [1, 4, 'Spent', 'bad'] });
    assert.equal(stageTone(0, 5), 'bad');
    assert.equal(stageTone(5, 5), 'good');
    assert.equal(stageTone(2, 4), 'warn');
    assert.equal(stageWord('health', { names: { 3: 'Battered' } }, 3), 'Battered', 'the field\'s own names win');
});

test('the Party screen is a tab and a screen that is on whenever the feature is, so a story with no character can make one', () => {
    const screen = createPartyScreen();
    assert.equal(screen.id, PARTY_SCREEN_ID);
    assert.deepEqual(screen.mounts, ['screen', 'tab']);
    for (const state of [party(), fakeState([{ definition: foesDefinition() }]), null]) assert.equal(activeNow(screen, state, () => null).on, true);
    assert.equal(hasCharacters(fakeState([skills]), { roleOf }), false, 'a Skills block alone is still no party');
    assert.equal(hasCharacters(party(), { roleOf }), true);
});

test('a card per character: name, role line, Soul Class, XP, three bars, seven stats, skills, two buttons', () => {
    const { el } = draw(party());
    const cards = el.querySelectorAll('.rpg-card');
    assert.deepEqual(cards.map(node => node.getAttribute('data-character')), ['Wessel', 'Ren']);
    const mine = card(el, 'Wessel');
    assert.equal(mine.querySelector('.rpg-name').textContent, 'Wessel');
    assert.equal(mine.querySelector('.rpg-sub').textContent, 'you');
    assert.equal(card(el, 'Ren').querySelector('.rpg-sub').textContent, 'companion');
    assert.match(mine.textContent, /Soul Class II/);
    assert.match(mine.textContent, /3 points to spend/);
    assert.match(mine.querySelector('.rpg-xp').textContent, /40 \/ 100/);
    assert.deepEqual(mine.querySelectorAll('.rpg-bar').map(node => node.getAttribute('data-bar')), ['health', 'mana', 'stamina']);
    assert.match(mine.querySelector('.rpg-bar[data-bar="health"]').textContent, /Hurt/);
    assert.match(mine.querySelector('.rpg-bar[data-bar="stamina"]').textContent, /Spent/);
    assert.deepEqual(mine.querySelectorAll('.rpg-stat').map(node => node.textContent), ['STR14', 'VIT12', 'AGI11', 'DEX10', 'INT8', 'LUK9', 'CHA10']);
    assert.equal(mine.querySelector('.rpg-skills').textContent, 'Iron Breath (Expert) · Short blade (Novice)');
    assert.deepEqual(mine.querySelectorAll('.rpg-card-actions button').map(node => node.textContent), ['Spend points', 'Skills']);
    assert.deepEqual(card(el, 'Ren').querySelectorAll('.rpg-card-actions button').map(node => node.textContent), ['Stats'], 'no Skills block, no Skills button');
    assert.doesNotMatch(card(el, 'Ren').textContent, /points to spend/);
});

test('the stage meters carry the stage count and the word', () => {
    const { el } = draw(party());
    const meter = card(el, 'Wessel').querySelector('.rpg-bar[data-bar="health"] .ss-w-meter');
    assert.equal(meter.getAttribute('aria-valuenow'), '3');
    assert.equal(meter.getAttribute('aria-valuemax'), '5');
    assert.match(meter.getAttribute('aria-valuetext'), /Hurt/);
    assert.ok(meter.classList.contains('ss-w-tone-warn'));
    assert.ok(card(el, 'Wessel').querySelector('.rpg-bar[data-bar="mana"] .ss-w-meter').classList.contains('ss-w-tone-good'));
    assert.ok(card(el, 'Wessel').querySelector('.rpg-bar[data-bar="stamina"] .ss-w-meter').classList.contains('ss-w-tone-bad'));
});

test('a fallen character is greyed and says Fallen', () => {
    const { el } = draw(fakeState([{ ...wessel, fields: { ...wessel.fields, alive: false } }, ren]));
    assert.ok(card(el, 'Wessel').classList.contains('rpg-fallen'));
    assert.match(card(el, 'Wessel').textContent, /Fallen/);
    assert.ok(!card(el, 'Ren').classList.contains('rpg-fallen'));
});

test('a bar is tapped to edit: a pencil over it saves through dm.set', async () => {
    const calls = [];
    const { el } = draw(party(), { api: { command: async (type, payload) => { calls.push([type, payload]); return { ok: true }; } } });
    const pencil = card(el, 'Wessel').querySelector('.rpg-bar[data-bar="health"] .ss-w-editable-pencil');
    assert.ok(pencil, 'the bar has its pencil');
    assert.match(pencil.getAttribute('aria-label'), /Edit Health/);
    pencil.click();
    const select = card(el, 'Wessel').querySelector('.rpg-bar[data-bar="health"] select');
    assert.deepEqual(select.querySelectorAll('option').map(node => node.textContent), ['Down', 'Badly wounded', 'Wounded', 'Hurt', 'Scratched', 'Unhurt']);
    select.value = '5';
    card(el, 'Wessel').querySelector('.rpg-bar[data-bar="health"] .ss-w-editable-save').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [['dm.set', { module: 'pack.chat/wessel', field: 'health', value: 5 }]]);
});

test('without a command the bars are plain: no pencil', () => {
    const { el } = draw(party());
    assert.equal(el.querySelectorAll('.ss-w-editable-pencil').length, 0);
});

test('with no character the widget says so; update redraws from the head', () => {
    let state = fakeState([]);
    const doc = setupDom(), el = doc.createElement('div');
    doc.body.appendChild(el);
    const handle = createPartyWidget({ headState: () => state, roleOf }).render(el, {}, {});
    assert.match(el.textContent, /No characters yet/);
    state = party();
    handle.update({});
    assert.equal(el.querySelectorAll('.rpg-card').length, 2);
    handle.destroy();
    assert.equal(el.querySelectorAll('.rpg-card').length, 0);
});

test('the widget is named lean-rpg.party and the screen draws it', () => {
    assert.equal(PARTY_WIDGET, 'lean-rpg.party');
    assert.match(createPartyScreen().template, /lean-rpg\.party/);
});

test('the stylesheet: cards side by side on a wide screen, stacked on a phone, theme tokens only, nothing fixed', () => {
    const css = readFileSync(new URL('../../../../src/v2/lean-rpg/view/lean-rpg.css', import.meta.url), 'utf8');
    assert.match(css, /\.rpg-cards \{[^}]*grid-template-columns: repeat\(auto-fill, minmax\(min\(100%, 300px\), 1fr\)\)/);
    assert.doesNotMatch(css, /position:\s*fixed/);
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'no colour of its own');
    assert.doesNotMatch(css, /\brgba?\(/);
    assert.match(css, /@container \(min-width: 700px\)/);
    assert.match(css, /@media \(max-width: 600px\)/);
});
