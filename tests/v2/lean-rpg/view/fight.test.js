import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setupDom } from '../../view/mounts/helpers.js';
import { FIGHT_SCREEN_ID, FIGHT_WIDGET, createFightScreen, createFightWidget, hasFoes, readFight } from '../../../../src/v2/lean-rpg/view/fight.js';
import { panelModel, readResolve } from '../../../../src/v2/lean-rpg/view/battle-log.js';
import { ROLES_WITHOUT_TAB } from '../../../../src/v2/lean-rpg/names.js';
import { activeNow } from '../../../../src/v2/view/mounts/common.js';
import { characterDefinition, fakeState, foesDefinition, roleOf } from './helpers.js';

const wessel = { definition: characterDefinition('wessel', 'Wessel'), fields: { health: 3, mana: 4, stamina: 1 } };
const ren = { definition: characterDefinition('ren', 'Ren'), fields: { health: 5, mana: 1, stamina: 3 } };
const foes = fields => ({ definition: foesDefinition(), fields: { foe1: 'Sluice Rat A', hurt1: 2, foe2: 'Sluice Rat B', hurt2: 4, foe3: 'Sluice Rat C', hurt3: 0, class2: 2, ...fields } });
const withScene = (state, place) => ({ ...state, domains: { ...state.domains, scene: { place: { name: place } } } });
const fight = () => withScene(fakeState([wessel, ren, foes()]), 'Bluewatch weir');

const pc = (who, stat, extra = {}) => ({ who, die: 10, stat, statBonus: 5, classValue: 2, classBonus: 4, rank: 0, edge: 0, total: 19, ...extra });
const foe = (name, extra = {}) => ({ slot: 1, name, die: 9, base: 5, classValue: 1, classBonus: 2, total: 16, ...extra });
const resolve = readResolve({ v: 1, checks: [], refused: [], rounds: [
    { n: 1, lines: [{ kind: 'act', outcome: 'success', skill: 'Short blade', pc: pc('Wessel', 'agi', { total: 24 }), foe: foe('Sluice Rat A', { total: 13 }) }] },
    { n: 2, lines: [{ kind: 'foe', outcome: 'success', skill: null, pc: pc('Wessel', 'vit', { total: 23 }), foe: foe('Sluice Rat A', { total: 15 }) }] },
] });
const latestOf = state => ({ latest: () => ({ index: 7, key: 'k', model: panelModel({ resolve, state, before: null, roleOf }) }) });

function draw(state, { battleLog = latestOf(state), api = {}, closeView = () => {}, showReply = () => {}, own = 'Wessel' } = {}) {
    const doc = setupDom(), el = doc.createElement('div');
    doc.body.appendChild(el);
    const widget = createFightWidget({ headState: () => state, readerName: () => own, roleOf, battleLog, closeView, showReply });
    const handle = widget.render(el, {}, api);
    return { doc, el, handle, widget };
}
const foeCard = (el, name) => el.querySelector(`.rpg-foe[data-foe="${name}"]`);

test('the Fight screen is a tab and a screen that is on only while a foe slot is filled', () => {
    const screen = createFightScreen({ roleOf });
    assert.equal(screen.id, FIGHT_SCREEN_ID);
    assert.deepEqual(screen.mounts, ['screen', 'tab']);
    assert.ok(screen.template.includes(FIGHT_WIDGET));
    const on = state => activeNow(screen, state, () => null).on;
    assert.equal(on(fight()), true);
    assert.equal(on(fakeState([wessel, ren])), false, 'no Foes block');
    assert.equal(on(fakeState([wessel, { definition: foesDefinition(), fields: {} }])), false, 'an empty Foes block');
    assert.equal(on(null), false);
    assert.equal(hasFoes(fight(), { roleOf: () => null }), false, 'no role, no foes');
});

test('the Foes block gets no tab of its own while the feature is on', () => {
    assert.ok(ROLES_WITHOUT_TAB.includes('foes'));
});

test('the header names the place when it is known, the note says the rolls are automatic, the pills count the exchange and the foes', () => {
    const { el } = draw(fight());
    assert.equal(el.querySelector('h3').textContent, 'Fight · Bluewatch weir');
    assert.match(el.querySelector('.rpg-fight-note').textContent, /^Rolls are automatic: /);
    assert.equal(el.querySelector('.rpg-exchange').textContent, 'Exchange 2');
    assert.equal(el.querySelector('.rpg-foe-count').textContent, '3 foes · 1 down');
    assert.equal(draw(fakeState([wessel, foes()])).el.querySelector('h3').textContent, 'Fight', 'no scene place: just Fight');
    const quiet = draw(fight(), { battleLog: { latest: () => null } }).el;
    assert.equal(quiet.querySelector('.rpg-exchange'), null, 'no rolls yet: no Exchange pill');
    assert.equal(quiet.querySelector('.rpg-fight-last'), null);
    const grouped = draw(fakeState([foes({ foe1: 'Sluice Rats', count1: 3, hurt1: 0, foe2: '', foe3: '' })])).el;
    assert.equal(grouped.querySelector('.rpg-foe-count').textContent, '3 foes · 3 down', 'a group counts as its members');
    assert.equal(draw(fakeState([foes({ foe2: '', foe3: '' })])).el.querySelector('.rpg-foe-count').textContent, '1 foe · 0 down');
});

test('a card per filled foe slot: name (× count), Class pill, five-cell health bar in the stage\'s tone, Down greyed', () => {
    const state = fakeState([foes({ foe4: 'Rat Swarm', count4: 3, hurt4: 5 })]);
    const { el } = draw(state);
    assert.deepEqual(el.querySelectorAll('.rpg-foe').map(node => node.getAttribute('data-foe')), ['Sluice Rat A', 'Sluice Rat B', 'Sluice Rat C', 'Rat Swarm']);
    assert.equal(foeCard(el, 'Rat Swarm').querySelector('.rpg-name').textContent, 'Rat Swarm ×3');
    assert.equal(foeCard(el, 'Sluice Rat A').querySelector('.rpg-name').textContent, 'Sluice Rat A');
    assert.equal(foeCard(el, 'Sluice Rat A').querySelector('.ss-pill').textContent, 'Class I');
    assert.equal(foeCard(el, 'Sluice Rat B').querySelector('.ss-pill').textContent, 'Class II');
    const bar = name => foeCard(el, name).querySelector('.ss-w-meter');
    assert.equal(bar('Sluice Rat A').getAttribute('aria-valuemax'), '5');
    assert.equal(bar('Sluice Rat A').querySelectorAll('.ss-w-meter-cell').length, 5, 'five cells');
    assert.match(foeCard(el, 'Sluice Rat A').textContent, /Wounded/);
    assert.match(foeCard(el, 'Sluice Rat B').textContent, /Scratched/);
    assert.deepEqual(['Sluice Rat A', 'Sluice Rat B', 'Rat Swarm'].map(name => bar(name).className.match(/ss-w-tone-(\w+)/)[1]), ['warn', 'good', 'good']);
    assert.match(foeCard(el, 'Sluice Rat C').textContent, /Down/);
    assert.ok(foeCard(el, 'Sluice Rat C').classList.contains('rpg-down'), 'greyed');
    assert.ok(!foeCard(el, 'Sluice Rat A').classList.contains('rpg-down'));
    assert.deepEqual(readFight(state, { roleOf }).map(item => [item.name, item.tone, item.down]), [['Sluice Rat A', 'warn', false], ['Sluice Rat B', 'good', false], ['Sluice Rat C', 'bad', true], ['Rat Swarm', 'good', false]]);
});

test('the pencil is the existing inline edit for the slot, saved through dm.set', async () => {
    const calls = [];
    const { el } = draw(fight(), { api: { command: async (type, payload) => { calls.push([type, payload]); return { ok: true }; } } });
    const card = foeCard(el, 'Sluice Rat B');
    card.querySelector('.ss-w-editable-pencil').click();
    card.querySelector('input').value = 'Sluice Rat Bruiser';
    card.querySelector('.ss-w-editable-save').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [['dm.set', { module: 'pack.chat/foes', field: 'foe2', value: 'Sluice Rat Bruiser' }]]);
    assert.equal(draw(fight()).el.querySelectorAll('.ss-w-editable-pencil').filter(node => !node.hidden).length, 0, 'no command, no pencil');
});

test('a card per character with the three stage bars', () => {
    const { el } = draw(fight());
    assert.deepEqual(el.querySelectorAll('.rpg-pc').map(node => node.getAttribute('data-character')), ['Wessel', 'Ren']);
    const mine = el.querySelector('.rpg-pc[data-character="Wessel"]');
    assert.deepEqual(mine.querySelectorAll('.rpg-bar').map(node => node.getAttribute('data-bar')), ['health', 'mana', 'stamina']);
    assert.match(mine.querySelector('.rpg-bar[data-bar="health"]').textContent, /Hurt/);
    assert.match(mine.querySelector('.rpg-bar[data-bar="stamina"]').textContent, /Spent/);
    assert.equal(mine.querySelectorAll('.ss-w-editable-pencil').length, 0, 'read-only here: the Party tab edits them');
});

test('Last exchange is the latest reply\'s battle-log panel', () => {
    const { el } = draw(fight());
    assert.equal(el.querySelector('.rpg-fight-lasthead .rpg-fight-h').textContent, 'Last exchange');
    const panel = el.querySelector('.rpg-fight-last .rpg-battle');
    assert.ok(panel);
    assert.equal(panel.querySelector('.rpg-bl-title').textContent, 'Combat · Exchanges 1–2');
    assert.equal(panel.querySelector('.rpg-bl-body').hidden, false, 'open');
    assert.match(panel.textContent, /Wessel uses Short blade on Sluice Rat A — Success \(24 vs 13\)/);
    assert.match(panel.textContent, /Sluice Rat A attacks Wessel — Blocked \(15 vs 23\)/);
});

test('"See it in the story" closes the game view and takes the chat to that reply', () => {
    const order = [];
    const { el } = draw(fight(), { closeView: () => order.push('close'), showReply: index => order.push(`show ${index}`) });
    const button = el.querySelector('.rpg-see');
    assert.equal(button.textContent, 'See it in the story');
    button.click();
    assert.deepEqual(order, ['close', 'show 7']);
    const scrolled = [];
    const doc = setupDom(), host = doc.createElement('div'), message = doc.createElement('div');
    message.className = 'mes'; message.setAttribute('mesid', '7');
    message.scrollIntoView = options => scrolled.push(options);
    doc.body.append(host, message);
    createFightWidget({ headState: () => fight(), roleOf, battleLog: latestOf(fight()), closeView: () => scrolled.push('close') }).render(host, {}, {});
    host.querySelector('.rpg-see').click();
    assert.deepEqual(scrolled, ['close', { block: 'start' }], 'by default the reply\'s own element scrolls into view');
});

test('the view redraws from the state on update, and destroy takes it away', () => {
    let state = fight();
    const doc = setupDom(), el = doc.createElement('div');
    doc.body.appendChild(el);
    const handle = createFightWidget({ headState: () => state, roleOf, battleLog: latestOf(state) }).render(el, {}, {});
    assert.equal(el.querySelectorAll('.rpg-foe').length, 3);
    state = fakeState([foes({ foe3: '' })]);
    handle.update();
    assert.equal(el.querySelectorAll('.rpg-foe').length, 2);
    handle.destroy();
    assert.equal(el.querySelectorAll('.rpg-foe').length, 0);
});

test('the stylesheet: a grid on a wide screen, one column on a phone, a Down foe greyed', () => {
    const css = readFileSync(new URL('../../../../src/v2/lean-rpg/view/lean-rpg.css', import.meta.url), 'utf8');
    assert.match(css, /\.rpg-foes \{[^}]*grid-template-columns: repeat\(auto-fill, minmax\(min\(100%, 280px\), 1fr\)\)/);
    assert.match(css, /\.rpg-fight-party \{[^}]*grid-template-columns: repeat\(auto-fill, minmax\(min\(100%, 300px\), 1fr\)\)/);
    assert.match(css, /\.rpg-down \{[^}]*grayscale/);
});

test('a foe\'s name from the story is text on its card', () => {
    const MARK = '<img src=x onerror="globalThis.pwned=1"><b>bold</b>';
    const { el } = draw(fakeState([foes({ foe1: MARK })]), { battleLog: { latest: () => null } });
    assert.ok(el.textContent.includes(MARK), 'shown as text');
    assert.equal(el.querySelectorAll('img, script, iframe, style, a').length, 0);
});
