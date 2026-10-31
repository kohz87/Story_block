import test from 'node:test';
import assert from 'node:assert/strict';
import { exchangesOf, rpgReplyLines } from '../../../../src/v2/lean-rpg/view/changes-lines.js';
import { mergeRpgLines, changesSummary, replyCardLines } from '../../../../src/v2/screens/changes-card.js';
import { RESOLVE } from '../../../../src/v2/lean-rpg/index.js';
import { characterDefinition, fakeState, roleOf, skillsDefinition } from './helpers.js';

const skillsShow = { tab: true, card: false, tabName: 'Skills', icon: 'ph-star' };
const world = ({ soul = 2, xp = 40, rank = 1, ren = 1 } = {}) => fakeState([
    { definition: characterDefinition('wessel', 'Wessel'), fields: { soul, xp } },
    { definition: characterDefinition('ren', 'Ren'), fields: { soul: ren } },
    { definition: skillsDefinition('wessel-skills', 'Wessel', skillsShow), fields: { skill1: 'Iron Breath', rank1: rank } },
]);
const record = (...receipts) => ({ receipts });
const rolled = result => ({ id: 'r1', type: RESOLVE, data: { v2: { result } } });

test('"Rolled for you": the exchanges from the reply summary, who fought whom, and where it is told', () => {
    const summary = record(rolled({ summary: { exchanges: 3, acts: [{ who: 'Wessel', target: 'Sluice Rat A' }, { who: 'Sluice Rat A', target: 'Wessel', foe: true }, { who: 'Wessel', target: 'Sluice Rat A' }] } }));
    assert.deepEqual(exchangesOf(summary), { exchanges: 3, pairs: ['Wessel vs Sluice Rat A'] });
    const lines = rpgReplyLines({ state: world(), before: world(), record: summary, roleOf });
    assert.equal(lines.length, 1);
    assert.equal(lines[0].text, 'Rolled for you: 3 exchanges');
    assert.equal(lines[0].summary, '3 exchanges rolled');
    assert.equal(lines[0].note, 'Wessel vs Sluice Rat A · told in the battle log');
    assert.equal(lines[0].tone, 'info');
    assert.equal(lines[0].kind, 'line');
    assert.equal(rpgReplyLines({ state: world(), before: null, record: record(rolled({ exchanges: 1 })), roleOf })[0].text, 'Rolled for you: 1 exchange', 'the first reply says it too, with no rises');
});

test('a result that only lists its rounds is counted; one with nothing, or a skipped one, says nothing', () => {
    assert.equal(exchangesOf(record(rolled({ rounds: [{ actions: [{ who: 'A', target: 'B' }] }, { actions: [] }] }))).exchanges, 2);
    assert.equal(exchangesOf(record(rolled({ rounds: [] }))), null);
    assert.equal(exchangesOf(record({ id: 'x', type: 'inventory.add' })), null);
    assert.equal(exchangesOf(record(rolled({ exchanges: 2 })), [{ receipts: ['r1'] }]), null);
    assert.equal(exchangesOf(null), null);
});

test('the class rise reads "Soul Class II → III" with the display names, and says what it brings', () => {
    const lines = rpgReplyLines({ state: world({ soul: 3, xp: 0 }), before: world({ soul: 2, xp: 85 }), record: record(), roleOf });
    assert.equal(lines.length, 1);
    assert.equal(lines[0].text, 'Wessel: Soul Class II → III');
    assert.equal(lines[0].summary, 'Soul Class III');
    assert.equal(lines[0].note, 'XP reached 100 · back to 0 · +2 to every roll');
    assert.equal(lines[0].tone, 'good');
    assert.equal(lines[0].icon, 'fa-arrow-up');
});

test('the rank rise reads "Iron Breath: Adept → Expert"; a character who did not rise says nothing', () => {
    const lines = rpgReplyLines({ state: world({ rank: 2 }), before: world({ rank: 1 }), record: record(), roleOf });
    assert.deepEqual(lines.map(line => line.text), ['Iron Breath: Adept → Expert']);
    assert.equal(lines[0].note, 'practice reached 100');
    assert.deepEqual(rpgReplyLines({ state: world({ soul: 2 }), before: world({ soul: 2 }), record: record(), roleOf }), []);
    assert.deepEqual(rpgReplyLines({ state: world({ rank: 0 }), before: world({ rank: 1 }), record: record(), roleOf }), [], 'a fall (a swipe\'s other state) is no rise');
});

test('rolls, then class, then rank: the order of the mockup', () => {
    const lines = rpgReplyLines({ state: world({ soul: 3, xp: 0, rank: 2 }), before: world(), record: record(rolled({ exchanges: 3 })), roleOf });
    assert.deepEqual(lines.map(line => line.text), ['Rolled for you: 3 exchanges', 'Wessel: Soul Class II → III', 'Iron Breath: Adept → Expert']);
});

test('the lines have the shape the card draws, and the header line takes their summaries', () => {
    const lines = rpgReplyLines({ state: world({ soul: 3, xp: 0 }), before: world(), record: record(rolled({ exchanges: 3 })), roleOf });
    for (const item of lines) assert.deepEqual(Object.keys(item).sort(), ['check', 'flag', 'icon', 'kind', 'module', 'note', 'summary', 'text', 'tone']);
    assert.match(changesSummary({ state: null, lines }), /3 exchanges rolled · Soul Class III/);
});

test('mergeRpgLines puts them first and drops the plain rule line a rise leaves; other rule lines stay', () => {
    const rule = name => ({ text: `Rule: ${name}`, summary: `Rule: ${name}`, kind: 'line', tone: 'accent', icon: 'fa-bolt', flag: '', note: '', check: null });
    const rise = rpgReplyLines({ state: world({ soul: 3, xp: 0 }), before: world(), record: record(), roleOf });
    assert.deepEqual(mergeRpgLines([rule('class-up'), rule('down-latch')], rise).map(line => line.text), ['Wessel: Soul Class II → III', 'Rule: down-latch']);
    const rolls = rpgReplyLines({ state: world(), before: world(), record: record(rolled({ exchanges: 2 })), roleOf });
    assert.deepEqual(mergeRpgLines([rule('class-up')], rolls).map(line => line.text), ['Rolled for you: 2 exchanges', 'Rule: class-up'], 'no rise told: the rule line stays');
    const plain = [rule('a')];
    assert.equal(mergeRpgLines(plain, []), plain, 'no RPG lines: untouched');
    assert.equal(replyCardLines([{ moduleId: 'x', fn: () => [{ text: 'ok' }] }], {}).length, 1);
});
