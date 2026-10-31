// Reading the sheet (src/v2/lean-rpg/read.js): blocks by role, the field keys, and how a name is matched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fold, matchCharacter, matchFoe, matchName, matchSkill, readSheet } from '../../../src/v2/lean-rpg/index.js';
import { PARTY, character, foeBlock, sheetDomain, skillBlock } from './helpers.js';

const read = blocks => readSheet({ domains: { dataModules: sheetDomain(blocks) } });

test('characters come from the blocks whose role is character, skills join the character their who names, foes are four slots', () => {
    const sheet = read(PARTY());
    assert.deepEqual(sheet.characters.map(entry => entry.who), ['Ren', 'Wessel'], 'in block order (by module id)');
    const wessel = sheet.characters.find(entry => entry.who === 'Wessel');
    assert.deepEqual([wessel.health, wessel.mana, wessel.stamina, wessel.soul, wessel.stats.str, wessel.stats.cha, wessel.alive], [5, 4, 4, 2, 14, 10, true]);
    assert.deepEqual(wessel.skills, [{ slot: 1, name: 'Iron Breath', rank: 1, practice: 0 }, { slot: 2, name: 'Spark', rank: 0, practice: 0 }]);
    assert.deepEqual(sheet.characters[0].skills.map(skill => skill.name), ['Spark']);
    assert.equal(sheet.foes.length, 4);
    assert.deepEqual(sheet.foes[0], { slot: 1, module: 'pack.chat/foes', name: 'Sluice Rats', count: 6, class: 1, hurt: 5, filled: true });
    assert.deepEqual(sheet.foes.map(foe => foe.filled), [true, false, false, false]);
    assert.deepEqual(sheet.problems, []);
});

test('a block with no role, or a role the RPG does not read as a sheet, is left alone; so is a state with no data modules', () => {
    const blocks = { plain: { role: undefined, fields: character('Plain') }, rules: { role: 'rules', fields: { who: 'x' } } };
    assert.deepEqual(read(blocks).characters, []);
    for (const state of [null, {}, { domains: {} }, { domains: { dataModules: {} } }, { domains: { dataModules: { active: 'no' } } }]) assert.deepEqual(readSheet(state).characters, []);
});

test('a Character block with no name, or a second one of the same name, is left out with a plain sentence', () => {
    const sheet = read({ a: { role: 'character', fields: character('') }, b: { role: 'character', fields: character('Ren') }, c: { role: 'character', fields: character('  ren ') }, d: { role: 'skills', fields: skillBlock('', []) } });
    assert.deepEqual(sheet.characters.map(entry => entry.who), ['Ren']);
    assert.equal(sheet.problems.length, 3);
    assert.match(sheet.problems[0], /^The Character block "pack\.chat\/a" has no name/);
    assert.match(sheet.problems.join(' '), /Two Character blocks are called ren/);
});

test('a missing number reads as null (a stat) or a plain default (soul 1, rank 0); a dead character says so', () => {
    const sheet = read({ a: { role: 'character', fields: { who: 'Pip', str: 12, alive: false } }, s: { role: 'skills', fields: { who: 'Pip', skill1: 'Hide' } } });
    const [pip] = sheet.characters;
    assert.deepEqual([pip.stats.str, pip.stats.dex, pip.soul, pip.health, pip.alive], [12, null, 1, null, false]);
    assert.deepEqual(pip.skills, [{ slot: 1, name: 'Hide', rank: 0, practice: 0 }]);
});

test('fold: lower case, spaces and hyphens gone', () => {
    assert.equal(fold('Iron-Breath'), 'ironbreath');
    assert.equal(fold(' iron  breath '), 'ironbreath');
    assert.equal(fold('ＩＲＯＮ'), 'iron');
});

test('a skill phrase matches a name inside it; the longest wins; two of one length are ambiguous and match nothing', () => {
    const owner = { skills: ['Fire', 'Fireball', 'Iron Breath', 'Ice', 'Ash'].map((name, n) => ({ slot: n + 1, name, rank: 0, practice: 0 })) };
    const named = phrase => matchSkill(owner, phrase)?.name ?? null;
    assert.equal(named('iron breath drill'), 'Iron Breath');
    assert.equal(named('Iron-Breath'), 'Iron Breath');
    assert.equal(named('fireball'), 'Fireball', 'Fire and Fireball both occur in it: the longer wins');
    assert.equal(named('a little fire'), 'Fire');
    assert.equal(named('iron breth'), null);
    assert.equal(named(''), null);
    const tied = { skills: [{ name: 'Ice' }, { name: 'Ash' }] };
    assert.equal(matchSkill(tied, 'ice and ash'), null, 'two names of one length occur in it');
});

test('characters and foes are found by name, by a name inside the phrase, or by a phrase inside the name; a foe also by slot', () => {
    const sheet = read({ ...PARTY(), ren2: { role: 'character', fields: character('Renata') } });
    assert.equal(matchCharacter(sheet, 'wessel')?.who, 'Wessel');
    assert.equal(matchCharacter(sheet, 'Renata')?.who, 'Renata');
    assert.equal(matchCharacter(sheet, 'Ren')?.who, 'Ren', 'an exact name wins over a longer one that holds it');
    assert.equal(matchCharacter(sheet, 'Nobody'), null);
    assert.equal(matchFoe(sheet, 'Sluice Rats')?.slot, 1);
    assert.equal(matchFoe(sheet, 'the sluice rats')?.slot, 1);
    assert.equal(matchFoe(sheet, 'rat')?.slot, 1, 'a phrase inside the one foe name');
    assert.equal(matchFoe(sheet, 'foe1')?.slot, 1);
    assert.equal(matchFoe(sheet, 'slot 2'), null, 'an empty slot is no target');
    assert.equal(matchFoe(sheet, ''), null);
    assert.equal(matchName([{ n: 'A' }], 'x', e => e.n), null);
});
