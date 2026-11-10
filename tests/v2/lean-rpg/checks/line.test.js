import test from 'node:test';
import assert from 'node:assert/strict';
import { memberNamed, parseCheckLine, validateCheck } from '../../../../src/v2/lean-rpg/checks/line.js';

const astra = { name: 'Astra Vayne', aliases: ['Astra'], stats: { str: 8, vit: 9, agi: 12, dex: 10, int: 11, luk: 9, cha: 14 },
    skills: [{ name: 'Obscure', stat: 'dex', rank: 1, type: 'utility' }, { name: 'Iron Breath', stat: 'str', rank: 2, type: 'combat' }] };
const temiwa = { name: 'Temiwa', aliases: ['Tem'], stats: { str: 12, vit: 10, agi: 9, dex: 14, int: 8, luk: 7, cha: 6 }, skills: [] };
const party = [astra, temiwa];
const offeredDice = [9, 17, 4];
const validate = (line, usedDice = [], offered = offeredDice) => validateCheck(parseCheckLine(line), { party, offeredDice: offered, usedDice });

test('a check line parses its four fields and normalises a difficulty word', () => {
    assert.deepEqual(parseCheckLine('? roll Astra | Lie | normal | 9'), { ok: true, name: 'Astra', what: 'Lie', difficulty: 'normal', die: 9 });
    assert.deepEqual(parseCheckLine('  ? ROLL  Temiwa | Pick a lock | Very-Hard | 17  '), { ok: true, name: 'Temiwa', what: 'Pick a lock', difficulty: 'very hard', die: 17 });
});

test('a malformed line is refused before the party or dice are read', () => {
    assert.deepEqual(parseCheckLine('check Astra | Lie | normal | 9'), { ok: false, reason: 'not a check line' });
    assert.deepEqual(parseCheckLine('? check Astra | Lie | normal | 9'), { ok: false, reason: 'not a check line' }, '`check` is Story Director\'s word, not this kind\'s');
    assert.deepEqual(parseCheckLine('? roll Astra | Lie | normal'), { ok: false, reason: 'needs four parts' });
    assert.deepEqual(parseCheckLine('? roll Astra | Lie | normal | nine'), { ok: false, reason: 'die is not a whole number' });
});

test('a plain stat and a skill validate, and aliases match case-insensitively by whole name', () => {
    assert.equal(memberNamed(party, 'ASTRA'), astra);
    assert.equal(memberNamed(party, 'astra vayne'), astra);
    assert.equal(memberNamed(party, 'Ast'), null, 'a first name is not a whole name');

    const stat = validate('? roll Astra | CHA | normal | 9');
    assert.equal(stat.ok, true);
    assert.equal(stat.member, astra);
    assert.equal(stat.skill, null);
    assert.equal(stat.stat, 'cha');
    assert.equal(stat.dc, 15);

    const skill = validate('? roll astra | obscure | easy | 9');
    assert.equal(skill.ok, true);
    assert.equal(skill.member, astra);
    assert.equal(skill.skill, astra.skills[0]);
    assert.equal(skill.what, 'Obscure');
    assert.equal(skill.stat, 'dex');
    assert.equal(skill.dc, 10);

    assert.equal(validate('? roll Tem | DEX | hard | 9').member, temiwa, 'a whole alias matches too');

    assert.equal(validate('? roll Astra | CHA | normal | 17', [9]).ok, true, 'the second offered die is used in order');
    assert.equal(validate('? roll Astra | CHA | normal | 4', [9, 17]).ok, true, 'the third offered die is used in order');
    assert.equal(validate('? roll Astra | CHA | normal | 9', [9], [9, 9, 4]).ok, true, 'a repeated number is a second offered die');
    assert.equal(validate('? roll Astra | CHA | normal | 4', [9, 9], [9, 9, 4]).ok, true, 'the third die follows two equal dice');
});

test('every refusal has its short reason and no roll', () => {
    assert.deepEqual(validate('? roll Nobody | Lie | normal | 9'), { ok: false, reason: 'unknown person' });
    assert.deepEqual(validate('? roll Astra | Swimming | normal | 9'), { ok: false, reason: 'unknown skill or stat' });
    assert.deepEqual(validate('? roll Astra | Lie | legendary | 9'), { ok: false, reason: 'unknown difficulty' });
    assert.deepEqual(validate('? roll Astra | CHA | normal | 2'), { ok: false, reason: 'die not offered' });
    assert.deepEqual(validate('? roll Astra | CHA | normal | 9', [9]), { ok: false, reason: 'die reused' });
    assert.deepEqual(validate('? roll Astra | CHA | normal | 4', [9]), { ok: false, reason: 'out of order' });
    assert.deepEqual(validate('? roll Astra | CHA | normal | 4', [9, 17, 4]), { ok: false, reason: 'more than 3' });
    assert.deepEqual(validateCheck({ ok: false, reason: 'needs four parts' }, { party, offeredDice, usedDice: [] }), { ok: false, reason: 'needs four parts' });
});

test('a whole name wins over another member\'s alias, and a shared alias is refused', () => {
    const other = { ...temiwa, aliases: ['Astra Vayne', 'Rook'] };
    const third = { name: 'Pella', aliases: ['Rook'] };
    const group = [other, third, astra];
    assert.equal(memberNamed(group, 'Astra Vayne'), astra);
    assert.equal(memberNamed(group, 'Rook'), null);
    assert.deepEqual(validateCheck(parseCheckLine('? roll Rook | DEX | normal | 9'), { party: group, offeredDice, usedDice: [] }), { ok: false, reason: 'unknown person' });
});

test('a skill from an older Skills block, with no stored stat, is supported: it leads with the type\'s main stat as the fight code does', () => {
    const old = { name: 'Brin', aliases: [], stats: { str: 10, vit: 8, agi: 12, dex: 6, int: 14, luk: 9, cha: 10 }, skills: [{ name: 'Lore', stat: null, rank: 1, type: 'utility' }] };
    const found = validateCheck(parseCheckLine('? roll Brin | Lore | easy | 9'), { party: [old], offeredDice: [9], usedDice: [] });
    assert.equal(found.ok, true);
    assert.equal(found.skill, old.skills[0]);
    assert.equal(found.stat, null);
    assert.equal(found.what, 'Lore');
});

test('the difficulty numbers recorded with the reply are the ones used', () => {
    const found = validateCheck(parseCheckLine('? roll Astra | CHA | hard | 9'), { party, offeredDice, usedDice: [], dc: { easy: 8, normal: 12, hard: 17, 'very hard': 22 } });
    assert.equal(found.dc, 17);
});
