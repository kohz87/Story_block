import test from 'node:test';
import assert from 'node:assert/strict';
import { exchangesOf, rpgReplyLines } from '../../../../src/v2/lean-rpg/view/changes-lines.js';
import { mergeRpgLines, changesSummary, replyCardLines } from '../../../../src/v2/screens/changes-card.js';
import { RESOLVE } from '../../../../src/v2/lean-rpg/index.js';
import { characterDefinition, fakeState, roleOf, skillsDefinition } from './helpers.js';

const skillsShow = { tab: true, card: false, tabName: 'Skills', icon: 'ph-star' };
const world = ({ level = 2, xp = 40, rank = 1, ren = 1, points = 0 } = {}) => fakeState([
    { definition: characterDefinition('wessel', 'Wessel'), fields: { level, xp, points } },
    { definition: characterDefinition('ren', 'Ren'), fields: { level: ren } },
    { definition: skillsDefinition('wessel-skills', 'Wessel', skillsShow), fields: { skill1: 'Iron Breath', rank1: rank } },
]);
const record = (...receipts) => ({ receipts });
const rolled = result => ({ id: 'r1', type: RESOLVE, data: { v2: { result } } });

test('"Rolled for you": the exchanges from the reply summary, who fought whom, and where it is told', () => {
    const act = (kind, who, target) => ({ kind, who, target, skill: null, stat: 'str', outcomes: ['success'] });
    const summary = record(rolled({ v: 1, summary: { exchanges: 3, refused: 0, acts: [act('act', 'Wessel', 'Sluice Rat A'), act('foe', 'Sluice Rat A', 'Wessel'), act('act', 'Wessel', 'Sluice Rat A'), act('check', 'Ren', undefined)] } }));
    assert.deepEqual(exchangesOf(summary), { exchanges: 3, pairs: ['Wessel vs Sluice Rat A'] });
    const lines = rpgReplyLines({ state: world(), before: world(), record: summary, roleOf });
    assert.equal(lines.length, 1);
    assert.equal(lines[0].text, 'Rolled for you: 3 exchanges');
    assert.equal(lines[0].summary, '3 exchanges rolled');
    assert.equal(lines[0].note, 'Wessel vs Sluice Rat A · told in the battle log');
    assert.equal(lines[0].tone, 'info');
    assert.equal(lines[0].kind, 'line');
    assert.equal(rpgReplyLines({ state: world(), before: null, record: record(rolled({ summary: { exchanges: 1, acts: [], refused: 0 } })), roleOf })[0].text, 'Rolled for you: 1 exchange', 'the first reply says it too, with no rises');
});

test('a result with no summary is counted by its rounds; one with nothing, or a skipped one, says nothing', () => {
    assert.equal(exchangesOf(record(rolled({ rounds: [{ n: 1, lines: [] }, { n: 2, lines: [] }] }))).exchanges, 2);
    assert.equal(exchangesOf(record(rolled({ rounds: [] }))), null);
    assert.equal(exchangesOf(record({ id: 'x', type: 'inventory.add' })), null);
    assert.equal(exchangesOf(record(rolled({ summary: { exchanges: 2, acts: [], refused: 0 } })), [{ receipts: ['r1'] }]), null);
    assert.equal(exchangesOf(null), null);
});

test('the level rise says "reached Lv 3", and what the XP did, whatever the numbers in force are', () => {
    const rise = rules => rpgReplyLines({ state: world({ level: 3, xp: 0 }), before: world({ level: 2, xp: 85 }), record: record(), roleOf, rules })[0].note;
    assert.equal(rise(undefined), 'XP reached 100 · back to 0');
    assert.equal(rise({ classWeight: 3 }), 'XP reached 100 · back to 0');
});

test('the level rise reads "Wessel reached Lv 3" and the pill-free summary', () => {
    const lines = rpgReplyLines({ state: world({ level: 3, xp: 0 }), before: world({ level: 2, xp: 85 }), record: record(), roleOf });
    assert.equal(lines.length, 1);
    assert.equal(lines[0].text, 'Wessel reached Lv 3');
    assert.equal(lines[0].summary, 'Wessel Lv 3');
    assert.equal(lines[0].note, 'XP reached 100 · back to 0');
    assert.equal(lines[0].tone, 'good');
    assert.equal(lines[0].icon, 'fa-arrow-up');
});

test('a rise that gave a point says so in plain words (+1 point to spend); one that gave none says only the level', () => {
    const rise = (before, after) => rpgReplyLines({ state: world(after), before: world(before), record: record(), roleOf })[0];
    const gave = rise({ level: 2, xp: 85, points: 0 }, { level: 3, xp: 0, points: 1 });
    assert.equal(gave.text, 'Wessel reached Lv 3 (+1 point to spend)');
    assert.equal(gave.summary, 'Wessel Lv 3 (+1 point)');
    assert.equal(gave.note, 'XP reached 100 · back to 0');
    const many = rise({ level: 2, xp: 85, points: 0 }, { level: 3, xp: 0, points: 3 });
    assert.equal(many.text, 'Wessel reached Lv 3 (+3 points to spend)');
    assert.equal(many.summary, 'Wessel Lv 3 (+3 points)');
    const none = rise({ level: 2, xp: 85, points: 4 }, { level: 3, xp: 0, points: 4 });
    assert.equal(none.text, 'Wessel reached Lv 3');
    assert.equal(none.summary, 'Wessel Lv 3');
});

test('a character whose block has the level field reads it: "reached Lv 15"', () => {
    const lines = rpgReplyLines({ state: world({ level: 15, xp: 0, points: 1 }), before: world({ level: 14, xp: 90, points: 0 }), record: record(), roleOf });
    assert.deepEqual(lines.map(line => line.text), ['Wessel reached Lv 15 (+1 point to spend)']);
});

test('the rank rise reads "Iron Breath: Adept → Expert"; a character who did not rise says nothing', () => {
    const lines = rpgReplyLines({ state: world({ rank: 2 }), before: world({ rank: 1 }), record: record(), roleOf });
    assert.deepEqual(lines.map(line => line.text), ['Iron Breath: Adept → Expert']);
    assert.equal(lines[0].note, 'practice reached 100');
    assert.deepEqual(rpgReplyLines({ state: world({ level: 2 }), before: world({ level: 2 }), record: record(), roleOf }), []);
    assert.deepEqual(rpgReplyLines({ state: world({ rank: 0 }), before: world({ rank: 1 }), record: record(), roleOf }), [], 'a fall (a swipe\'s other state) is no rise');
});

test('rolls, then level, then rank: the order of the mockup', () => {
    const lines = rpgReplyLines({ state: world({ level: 3, xp: 0, rank: 2 }), before: world(), record: record(rolled({ summary: { exchanges: 3, acts: [], refused: 0 } })), roleOf });
    assert.deepEqual(lines.map(line => line.text), ['Rolled for you: 3 exchanges', 'Wessel reached Lv 3', 'Iron Breath: Adept → Expert']);
});

test('the lines have the shape the card draws, and the header line takes their summaries', () => {
    const lines = rpgReplyLines({ state: world({ level: 3, xp: 0 }), before: world(), record: record(rolled({ summary: { exchanges: 3, acts: [], refused: 0 } })), roleOf });
    for (const item of lines) assert.deepEqual(Object.keys(item).sort(), ['check', 'flag', 'icon', 'kind', 'module', 'note', 'summary', 'text', 'tone']);
    assert.match(changesSummary({ state: null, lines }), /3 exchanges rolled · Wessel Lv 3/);
});

test('mergeRpgLines puts them first and drops the plain rule line a rise leaves; other rule lines stay', () => {
    const rule = name => ({ text: `Rule: ${name}`, summary: `Rule: ${name}`, kind: 'line', tone: 'accent', icon: 'fa-bolt', flag: '', note: '', check: null });
    const rise = rpgReplyLines({ state: world({ level: 3, xp: 0 }), before: world(), record: record(), roleOf });
    assert.deepEqual(mergeRpgLines([rule('level-up'), rule('down-latch')], rise).map(line => line.text), ['Wessel reached Lv 3', 'Rule: down-latch']);
    const rolls = rpgReplyLines({ state: world(), before: world(), record: record(rolled({ summary: { exchanges: 2, acts: [], refused: 0 } })), roleOf });
    assert.deepEqual(mergeRpgLines([rule('level-up')], rolls).map(line => line.text), ['Rolled for you: 2 exchanges', 'Rule: level-up'], 'no rise told: the rule line stays');
    const plain = [rule('a')];
    assert.equal(mergeRpgLines(plain, []), plain, 'no RPG lines: untouched');
    assert.equal(replyCardLines([{ moduleId: 'x', fn: () => [{ text: 'ok' }] }], {}).length, 1);
});


test('F2 (Levels): a rise tells the same whatever numbers the reply\'s roll recorded or today\'s settings hold: no roll bonus is stated', () => {
    const rise = (recorded, now) => rpgReplyLines({ state: world({ level: 3, xp: 0 }), before: world({ level: 2, xp: 85 }), roleOf, rules: now,
        record: record(rolled({ v: 1, ...(recorded ? { rules: recorded } : {}), summary: { exchanges: 1, acts: [], refused: 0 } })) }).find(line => line.text.includes('reached Lv')).note;
    const harsh = { foeBase: 7, classWeight: 3, statDivisor: 3, costMargin: 1, decisiveMargin: 6, roundCap: 4 };
    assert.equal(rise(harsh, { classWeight: 1 }), 'XP reached 100 · back to 0');
    assert.equal(rise(undefined, { classWeight: 3 }), 'XP reached 100 · back to 0');
    const none = rpgReplyLines({ state: world({ level: 3, xp: 0 }), before: world({ level: 2, xp: 85 }), roleOf, rules: { classWeight: 1 }, record: record() })[0].note;
    assert.equal(none, 'XP reached 100 · back to 0');
});

test('F7: the XP note ("XP reached 100 · back to N") is told only when the XP made the rise; a level typed by hand has none', () => {
    const typed = rpgReplyLines({ state: world({ level: 5, xp: 40 }), before: world({ level: 4, xp: 40 }), record: record(), roleOf });
    assert.equal(typed[0].text, 'Wessel reached Lv 5');
    assert.equal(typed[0].note, '', 'the XP did not fall: no note');
    const carried = rpgReplyLines({ state: world({ level: 5, xp: 35 }), before: world({ level: 4, xp: 95 }), record: record(), roleOf });
    assert.equal(carried[0].note, 'XP reached 100 · back to 35', 'the XP over 100 is carried and said');
});

test('a Soul Class rise of the earlier rules says "+1 point to spend", and "+2 points" for more', () => {
    const legacy = ({ soul, points }) => {
        const definition = characterDefinition('wessel', 'Wessel');
        delete definition.state.level;
        definition.state.soul = { type: 'int', min: 1, max: 9, default: 1, names: { 1: 'I', 2: 'II', 3: 'III' } };
        return fakeState([{ definition, fields: { soul, points, xp: 40 } }]);
    };
    const rise = gain => rpgReplyLines({ state: legacy({ soul: 2, points: gain }), before: legacy({ soul: 1, points: 0 }), record: record(), roleOf })[0];
    assert.equal(rise(1).summary.endsWith('(+1 point)'), true, rise(1).summary);
    assert.match(rise(1).note, /\+1 point to spend$/);
    assert.equal(rise(3).summary.endsWith('(+3 points)'), true);
    assert.match(rise(3).note, /\+3 points to spend$/);
});
