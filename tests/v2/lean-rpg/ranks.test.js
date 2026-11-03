// Levels release (LV-C): a pack's ranks and level cap (`content.rpg.ranks`, `content.rpg.levelCap`), the labels and the `rpg.rank` query,
// and the guard of an older fight record (a receipt made before the level, with a class on its groups, still stands).
import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePack } from '../../../src/v2/packs/validate.js';
import { LEAN_RPG_FIELDS, RPG_RANK_LIMITS } from '../../../src/v2/packs/limits.js';
import { RANK_QUERY, bandsOf, clampLevel, levelLabel, packLevelsOf, playerRankValue, rankNamed, rankOf, readSheet } from '../../../src/v2/lean-rpg/index.js';
import { rankQuery } from '../../../src/v2/lean-rpg/levels.js';
import { fightGuard, fightWitness, foeLevel, memberLevel } from '../../../src/v2/lean-rpg/fight.js';
import { FIGHT } from '../../../src/v2/lean-rpg/names.js';
import { hashJson } from '../../../src/v2/replay.js';
import { pack } from '../packs/helpers/fixtures.js';
import { foeBlock, sheetDomain, PARTY } from './helpers.js';

const ERSVEIL = [['F', 1, 9], ['E', 10, 19], ['D', 20, 29], ['C', 30, 39], ['B', 40, 49], ['A', 50, 59], ['S', 60, 69], ['SS', 70, 79], ['SSS', 80, 99]].map(([name, from, to]) => ({ name, from, to }));
const withRpg = rpg => pack({ content: { rpg } });
const result = value => validatePack(JSON.stringify(value));
function ok(value) {
    const made = result(value);
    assert.equal(made.ok, true, JSON.stringify(made.errors));
    return made.pack;
}
function refused(value, code, path) {
    const made = result(value);
    assert.equal(made.ok, false, `${path} should be refused`);
    const hit = made.errors.find(error => error.path === path);
    assert.ok(hit, `no error at ${path}: ${JSON.stringify(made.errors)}`);
    assert.equal(hit.code, code, hit.message);
    assert.ok(hit.message.length > 20, 'a sentence the reader can act on');
}

test('ranks and levelCap are content.rpg fields; a pack with them keeps one record the skill-set readers pass over', () => {
    assert.ok(LEAN_RPG_FIELDS.includes('ranks') && LEAN_RPG_FIELDS.includes('levelCap'));
    assert.deepEqual([RPG_RANK_LIMITS.entries, RPG_RANK_LIMITS.name, RPG_RANK_LIMITS.maxLevel], [20, 12, 99]);
    const made = ok(withRpg({ ranks: ERSVEIL, levelCap: 99 }));
    assert.deepEqual(made.content.rpg, [{ id: 'mini/ranks', slug: 'ranks', pack: 'mini', ranks: ERSVEIL, levelCap: 99 }]);
    assert.deepEqual(packLevelsOf(made.content.rpg), { ranks: ERSVEIL, levelCap: 99 });
    assert.equal(packLevelsOf([]), null);
    assert.equal(packLevelsOf(ok(withRpg({ skillSets: [] })).content.rpg), null);
    // beside the skill sets and the formula, the ranks come last
    const all = ok(withRpg({ skillSets: [{ name: 'Recruit', skills: [{ name: 'Spear', about: 'A long spear.', stat: 'str' }] }], formula: 'standard', ranks: [{ name: 'Novice', from: 1, to: 20 }] })).content.rpg;
    assert.deepEqual(all.map(record => record.slug), ['recruit', 'formula', 'ranks']);
    // a prefix of 1..99 is fine, and so is a cap alone
    assert.deepEqual(ok(withRpg({ ranks: [{ name: 'Green', from: 1, to: 5 }] })).content.rpg[0].ranks, [{ name: 'Green', from: 1, to: 5 }]);
    assert.deepEqual(ok(withRpg({ levelCap: 50 })).content.rpg, [{ id: 'mini/ranks', slug: 'ranks', pack: 'mini', levelCap: 50 }]);
});

test('ranks: gaps, overlaps, order, names, limits and unknown keys are refused with a sentence', () => {
    refused(withRpg({ ranks: [{ name: 'F', from: 1, to: 9 }, { name: 'E', from: 11, to: 19 }] }), 'BAD_CONTENT', 'content.rpg.ranks[1].from');     // gap
    refused(withRpg({ ranks: [{ name: 'F', from: 1, to: 9 }, { name: 'E', from: 9, to: 19 }] }), 'BAD_CONTENT', 'content.rpg.ranks[1].from');      // overlap
    refused(withRpg({ ranks: [{ name: 'E', from: 10, to: 19 }, { name: 'F', from: 1, to: 9 }] }), 'BAD_CONTENT', 'content.rpg.ranks[0].from');     // out of order / not from 1
    refused(withRpg({ ranks: [{ name: 'F', from: 2, to: 9 }] }), 'BAD_CONTENT', 'content.rpg.ranks[0].from');                                       // does not start at 1
    refused(withRpg({ ranks: [{ name: 'F', from: 1, to: 100 }] }), 'BAD_CONTENT', 'content.rpg.ranks[0]');                                          // past 99
    refused(withRpg({ ranks: [{ name: 'F', from: 5, to: 4 }] }), 'BAD_CONTENT', 'content.rpg.ranks[0]');                                           // from above to
    refused(withRpg({ ranks: [{ name: 'F', from: 1.5, to: 4 }] }), 'BAD_CONTENT', 'content.rpg.ranks[0]');
    refused(withRpg({ ranks: [{ name: 'F', from: 1, to: 9 }, { name: ' f ', from: 10, to: 19 }] }), 'DUPLICATE', 'content.rpg.ranks[1].name');
    refused(withRpg({ ranks: [{ name: 'x'.repeat(13), from: 1, to: 9 }] }), 'BAD_CONTENT', 'content.rpg.ranks[0].name');
    refused(withRpg({ ranks: [{ name: '', from: 1, to: 9 }] }), 'BAD_CONTENT', 'content.rpg.ranks[0].name');
    refused(withRpg({ ranks: [{ name: '<b>', from: 1, to: 9 }] }), 'BAD_CONTENT', 'content.rpg.ranks[0].name');
    refused(withRpg({ ranks: [{ name: 'F', from: 1, to: 9, color: 'red' }] }), 'UNKNOWN_FIELD', 'content.rpg.ranks[0].color');
    refused(withRpg({ ranks: [] }), 'BAD_CONTENT', 'content.rpg.ranks');
    refused(withRpg({ ranks: 'no' }), 'BAD_CONTENT', 'content.rpg.ranks');
    refused(withRpg({ ranks: ['F'] }), 'BAD_CONTENT', 'content.rpg.ranks[0]');
    const twenty = Array.from({ length: 20 }, (_, n) => ({ name: `R${n}`, from: n * 4 + 1, to: n * 4 + 4 }));
    assert.equal(ok(withRpg({ ranks: twenty })).content.rpg[0].ranks.length, 20);
    refused(withRpg({ ranks: [...twenty, { name: 'R20', from: 81, to: 99 }] }), 'BAD_CONTENT', 'content.rpg.ranks');
    for (const bad of [0, 100, 1.5, '50', null]) refused(withRpg({ levelCap: bad }), 'BAD_CONTENT', 'content.rpg.levelCap');
    refused(withRpg({ skillSets: [], extra: 1 }), 'UNKNOWN_FIELD', 'content.rpg.extra');
});

test('levelLabel and rankOf: "Rank E · Lv 14" with a rank, "Lv 14" without; the band edges; a level out of range is held', () => {
    assert.equal(levelLabel(14, ERSVEIL), 'Rank E · Lv 14');
    assert.equal(levelLabel(14, []), 'Lv 14');
    assert.equal(levelLabel(14), 'Lv 14');
    assert.equal(levelLabel(14, null), 'Lv 14');
    assert.deepEqual([1, 9, 10, 19, 20, 79, 80, 99].map(level => rankOf(level, ERSVEIL).name), ['F', 'F', 'E', 'E', 'D', 'SS', 'SSS', 'SSS']);
    assert.equal(levelLabel(1, ERSVEIL), 'Rank F · Lv 1');
    assert.equal(levelLabel(99, ERSVEIL), 'Rank SSS · Lv 99');
    assert.equal(levelLabel(30, [{ name: 'Green', from: 1, to: 5 }]), 'Lv 30', 'a level no band holds has no rank');
    assert.equal(levelLabel(0, ERSVEIL), 'Rank F · Lv 1');
    assert.equal(levelLabel(500, ERSVEIL), 'Rank SSS · Lv 99');
    assert.equal(levelLabel('x', ERSVEIL), 'Rank F · Lv 1');
    assert.equal(rankOf(2.5, ERSVEIL), null);
    assert.deepEqual([clampLevel(0), clampLevel(100), clampLevel(7), clampLevel(null)], [1, 99, 7, 1]);
    // bands out of order or damaged are read as what is whole
    assert.deepEqual(bandsOf([{ name: 'B', from: 10, to: 19 }, { name: 'A', from: 1, to: 9 }, { name: '', from: 20, to: 29 }, null, { name: 'Z', from: 30, to: 20 }]).map(rank => rank.name), ['A', 'B']);
    assert.deepEqual(bandsOf('no'), []);
    assert.deepEqual(rankNamed(' ss ', ERSVEIL), { name: 'SS', from: 70, to: 79 });
    assert.equal(rankNamed('nope', ERSVEIL), null);
    assert.equal(rankNamed(undefined, ERSVEIL), null);
});

test('the rpg.rank query: { level } → { name } | null, from the arguments or from the packs\' content', () => {
    assert.equal(RANK_QUERY, 'rpg.rank');
    const tools = records => ({ query: (name, args) => (name === 'packs.content' && args.kind === 'rpg' ? records : null) });
    const records = ok(withRpg({ ranks: ERSVEIL })).content.rpg;
    assert.deepEqual(rankQuery({}, { level: 14 }, tools(records)), { name: 'E' });
    assert.deepEqual(rankQuery({}, { level: 99 }, tools(records)), { name: 'SSS' });
    assert.equal(rankQuery({}, { level: 14 }, tools([])), null, 'no ranks, no name');
    assert.equal(rankQuery({}, { level: 14 }, {}), null);
    assert.equal(rankQuery({}, {}, tools(records)), null, 'no level');
    assert.deepEqual(rankQuery({}, { level: 3, ranks: [{ name: 'Low', from: 1, to: 5 }] }, tools(records)), { name: 'Low' }, 'ranks in the arguments win');
    assert.equal(rankQuery({}, { level: 14 }, { query: () => { throw new Error('x'); } }), null);
});

test('a fight record made before the level (groups with a class, a guard on the older witness) still passes its guard; a sheet with levels adds them to the witness', () => {
    const blocks = PARTY();
    const sheet = readSheet({ domains: { dataModules: sheetDomain(blocks) } });
    const domain = sheetDomain(blocks);
    const source = { sid: 's', swipeKey: 'k' };
    const witness = fightWitness(sheet, domain, source, { was: [1] });
    // the witness of an older sheet is what it was: no level anywhere
    assert.ok(witness.foes.every(foe => !('level' in foe)) && witness.members.every(member => !('level' in member)));
    assert.deepEqual(Object.keys(witness.foes[0]), ['slot', 'name', 'count', 'class', 'hurt']);
    const predicate = { kind: FIGHT };
    const guard = { version: 2, rulesHash: null, predicate, inputHash: hashJson({ source, predicate, witness }) };
    const state = { domains: { dataModules: domain } };
    assert.deepEqual(fightGuard({ state, hash: hashJson }, { guard, source, recorded: { was: [1] } }), { ok: true });
    // a changed number is still caught
    state.domains.dataModules.instances['pack.chat/foes'].chat.fields.hurt1 = 2;
    assert.equal(fightGuard({ state, hash: hashJson }, { guard, source, recorded: { was: [1] } }).ok, false);
});

test('a sheet entry without a level counts its class as the level; one with a level uses it', () => {
    assert.equal(foeLevel({ class: 3 }), 25, 'class n stands for the level 10n - 5');
    assert.equal(foeLevel({ class: 3, level: 40 }), 40);
    assert.equal(foeLevel({}), 1);
    assert.equal(memberLevel({ soul: 2 }), 15);
    assert.equal(memberLevel({ soul: 2, level: 17 }), 17);
    assert.equal(memberLevel({ level: 500 }), 99);
    assert.equal(memberLevel({}), 1);
    assert.equal(foeBlock([['Rats', 2, 4, 5]]).class1, 4);
});

const PLAYER = { module: 'guild-membership', field: 'letter', label: 'Guild' };

test('playerRank: validated as module, field (1..40) and label (1..12), kept on the ranks record', () => {
    assert.ok(LEAN_RPG_FIELDS.includes('playerRank'));
    const made = ok(withRpg({ ranks: ERSVEIL, playerRank: PLAYER }));
    assert.deepEqual(made.content.rpg[0].playerRank, PLAYER);
    assert.deepEqual(packLevelsOf(made.content.rpg), { ranks: ERSVEIL, playerRank: PLAYER });
    assert.deepEqual(ok(withRpg({ playerRank: { module: ' guild-membership ', field: 'letter', label: 'Guild' } })).content.rpg[0].playerRank, PLAYER, 'spacing is trimmed');
    refused(withRpg({ playerRank: 'no' }), 'BAD_CONTENT', 'content.rpg.playerRank');
    refused(withRpg({ playerRank: { field: 'letter', label: 'Guild' } }), 'BAD_CONTENT', 'content.rpg.playerRank.module');
    refused(withRpg({ playerRank: { module: 'x'.repeat(41), field: 'letter', label: 'Guild' } }), 'BAD_CONTENT', 'content.rpg.playerRank.module');
    refused(withRpg({ playerRank: { module: 'm', field: '', label: 'Guild' } }), 'BAD_CONTENT', 'content.rpg.playerRank.field');
    refused(withRpg({ playerRank: { module: 'm', field: 'f'.repeat(41), label: 'Guild' } }), 'BAD_CONTENT', 'content.rpg.playerRank.field');
    refused(withRpg({ playerRank: { module: 'm', field: 'f', label: 'x'.repeat(13) } }), 'BAD_CONTENT', 'content.rpg.playerRank.label');
    refused(withRpg({ playerRank: { module: 'm', field: 'f', label: '<b>' } }), 'BAD_CONTENT', 'content.rpg.playerRank.label');
    refused(withRpg({ playerRank: { module: 'm', field: 'f', label: 'G', extra: 1 } }), 'UNKNOWN_FIELD', 'content.rpg.playerRank.extra');
});

test('levelLabel with a player rank: "Lv 14 · Guild F" with a value, "Lv 14" without; foes and no source keep "Rank F · Lv 7"', () => {
    assert.equal(levelLabel(14, ERSVEIL, { playerRank: PLAYER, value: 'F' }), 'Lv 14 · Guild F');
    assert.equal(levelLabel(14, ERSVEIL, { playerRank: PLAYER, value: ' D  ' }), 'Lv 14 · Guild D');
    assert.equal(levelLabel(14, ERSVEIL, { playerRank: PLAYER, value: 3 }), 'Lv 14 · Guild 3');
    for (const value of [undefined, null, '', '  ', {}]) assert.equal(levelLabel(14, ERSVEIL, { playerRank: PLAYER, value }), 'Lv 14', `no value: ${JSON.stringify(value)}`);
    assert.equal(levelLabel(7, ERSVEIL), 'Rank F · Lv 7', 'a foe');
    assert.equal(levelLabel(7, ERSVEIL, {}), 'Rank F · Lv 7');
    assert.equal(levelLabel(7, ERSVEIL, { value: 'F' }), 'Rank F · Lv 7', 'a value without the pack field names nothing');
    assert.equal(levelLabel(7, ERSVEIL, { playerRank: null }), 'Rank F · Lv 7');
});

test('playerRankValue reads the named block\'s field through the data-modules view, and is null when the block is not pinned or the field is empty', () => {
    const domain = sheetDomain({ 'guild-membership': { role: undefined, fields: { letter: 'F', other: 'x' } } });
    const state = { domains: { dataModules: domain } };
    const query = (name, args) => (name === 'dataModules.view' && args.module === 'pack.chat/guild-membership' ? { chat: { letter: 'F' } } : null);
    assert.equal(playerRankValue(state, PLAYER, query), 'F');
    assert.equal(playerRankValue(state, PLAYER), 'F', 'without a query: the state\'s own instance');
    assert.equal(playerRankValue(state, { ...PLAYER, field: 'missing' }, query), null);
    assert.equal(playerRankValue(state, { ...PLAYER, module: 'nope' }, query), null, 'not pinned');
    assert.equal(playerRankValue({}, PLAYER, query), null);
    assert.equal(playerRankValue(state, null, query), null);
    // F9: no Guild pill until the member has registered (the block's `registered` is a flag that starts false)
    const joined = flag => ({ domains: { dataModules: sheetDomain({ 'guild-membership': { role: undefined, fields: { registered: flag, letter: 'F' } } }) } });
    assert.equal(playerRankValue(joined(false), PLAYER), null, 'not registered: the default letter is no rank');
    assert.equal(playerRankValue(joined(true), PLAYER), 'F', 'registered: the letter');
    assert.equal(playerRankValue(state, PLAYER, () => { throw new Error('x'); }), null);
    assert.equal(levelLabel(14, ERSVEIL, { playerRank: PLAYER, value: playerRankValue(state, PLAYER, query) }), 'Lv 14 · Guild F');
    assert.equal(levelLabel(14, ERSVEIL, { playerRank: PLAYER, value: playerRankValue({}, PLAYER, query) }), 'Lv 14');
});
