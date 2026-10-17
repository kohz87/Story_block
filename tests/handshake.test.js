// Story Block's side of the Story Suite: what its blocks offer, the reader's Source of truth
// choices, the Character Sheet's "RPG Battle owns stats" notice and the dice modifier gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { storySuite } from '../src/suite.js';
import { CHATTER_NOTE, SHARED_AREAS, blockAreas, chatterNote, deferredTo, displaysShownElsewhere, keepsOwnRolls, normalizeSourceChoices, offeredAreas, sourceStatus, statsNotice } from '../src/handshake.js';
import { pluginBlockDef } from '../src/plugin.js';
import { defaultBlocks, templateById } from '../src/templates.js';

function fresh() {
    delete globalThis.StorySuite;
    return storySuite();
}

const on = id => ({ ...templateById(id), enabled: true });
const sheet = on('character-sheet');
const auto = normalizeSourceChoices(null);
const announceBlock = (suite, owns) => suite.announce({ id: 'story-block', name: 'Story Block', version: '0.8.0', owns });
const announceBattle = (suite, owns = ['stats', 'items', 'rolls']) => suite.announce({ id: 'rpg-battle', name: 'RPG Battle', version: '1.0.0', owns });

test('offeredAreas: each built-in offers its areas only while it is enabled', () => {
    assert.deepEqual(offeredAreas(defaultBlocks()), ['items'], 'a new install has only Inventory on');
    assert.deepEqual(offeredAreas([on('world-state')]), ['scene', 'timeline']);
    assert.deepEqual(offeredAreas([on('character-sheet')]), ['stats']);
    assert.deepEqual(offeredAreas([on('dice')]), ['rolls']);
    assert.deepEqual(offeredAreas([on('dice-everyone')]), ['rolls']);
    assert.deepEqual(offeredAreas([on('choices'), on('inner-chatter'), on('scene-notes')]), [], 'the others offer nothing');
    assert.deepEqual(offeredAreas([on('dice'), on('character-sheet'), on('inventory'), on('world-state')]), SHARED_AREAS, 'in settings order, whatever the block order');
    assert.deepEqual(offeredAreas(defaultBlocks().map(def => ({ ...def, enabled: false }))), []);
    assert.deepEqual(offeredAreas(null), []);
});

test('offeredAreas: copies keep their template; custom scene and dice blocks count; kept blocks never do', () => {
    // A duplicate or a renamed template keeps `template`.
    assert.deepEqual(offeredAreas([{ ...sheet, id: 'sheet-2', tag: 'Hero', name: 'Hero' }]), ['stats']);
    assert.deepEqual(blockAreas({ id: 'board', tag: 'Board', display: 'scene', enabled: true }), ['scene', 'timeline']);
    assert.deepEqual(blockAreas({ id: 'luck', tag: 'Luck', display: 'dice', enabled: true }), ['rolls']);
    assert.deepEqual(blockAreas({ id: 'bag', tag: 'inventory', display: 'plain', enabled: true }), ['items'], 'the Inventory tag');
    assert.deepEqual(blockAreas({ id: 'stats', tag: 'Stats', display: 'fields', format: 'fields', enabled: true }), [], 'any fields block is not a Character Sheet');
    const character = pluginBlockDef({ kept: true, id: 'rpg-character', tag: 'Character', owner: 'RPG Battle', fields: [{ label: 'HP', type: 'meter' }] }, []).def;
    assert.deepEqual(blockAreas(character), [], 'RPG Battle\'s own sheet is RPG Battle\'s');
    assert.deepEqual(blockAreas(null), []);
});

test('normalizeSourceChoices: auto for every shared area unless mine or theirs was picked', () => {
    assert.deepEqual(normalizeSourceChoices(undefined), { scene: 'auto', timeline: 'auto', items: 'auto', stats: 'auto', rolls: 'auto' });
    assert.deepEqual(normalizeSourceChoices({ stats: 'mine', items: 'theirs', rolls: 'yes', calendar: 'mine' }), { scene: 'auto', timeline: 'auto', items: 'theirs', stats: 'mine', rolls: 'auto' });
    assert.deepEqual(normalizeSourceChoices('mine'), auto);
});

test('statsNotice: alone, or with an extension that does not offer stats, the sheet has no notice', () => {
    const suite = fresh();
    assert.equal(statsNotice(sheet, auto, suite), '', 'nobody announced');
    announceBlock(suite, ['stats']);
    for (const stats of ['auto', 'mine', 'theirs']) assert.equal(statsNotice(sheet, { stats }, suite), '', stats);
    suite.announce({ id: 'story-director', name: 'Story Director', owns: ['timeline'] });
    assert.equal(statsNotice(sheet, { stats: 'theirs' }, suite), '');
});

test('statsNotice: with RPG Battle offering stats, the sheet says so by its announced name, as the choice allows', () => {
    const suite = fresh();
    announceBlock(suite, ['stats']);
    announceBattle(suite);
    assert.match(statsNotice(sheet, auto, suite), /^RPG Battle owns stats\. This sheet keeps working/);
    assert.match(statsNotice(sheet, { stats: 'theirs' }, suite), /^RPG Battle owns stats/);
    assert.equal(statsNotice(sheet, { stats: 'mine' }, suite), '', 'the reader kept stats with Story Block');
    assert.equal(statsNotice(on('inventory'), auto, suite), '', 'only blocks that provide stats are marked');
    suite.announce({ id: 'rpg-battle', name: 'Battle Engine', version: '1.1.0', owns: ['stats'] });
    assert.match(statsNotice(sheet, auto, suite), /^Battle Engine owns stats/, 'the name as announced');
    suite.withdraw('rpg-battle');
    assert.equal(statsNotice(sheet, auto, suite), '', 'gone again when it withdraws');
});

test('deferredTo: the owner under auto, the next one under theirs, by id when no name was given', () => {
    const suite = fresh();
    announceBlock(suite, ['items', 'scene']);
    suite.announce({ id: 'npc-state-delta', owns: ['scene'] });
    assert.equal(deferredTo('scene', 'auto', suite), null, 'Story Block owns the scene');
    assert.deepEqual(deferredTo('scene', 'theirs', suite), { id: 'npc-state-delta', name: 'npc-state-delta' });
    assert.equal(deferredTo('scene', 'mine', suite), null);
    assert.equal(deferredTo('items', 'theirs', suite), null, 'nobody else offers items');
});

test('keepsOwnRolls: kept dice modifiers stay on unless the reader keeps rolls with Story Block against an offer', () => {
    const suite = fresh();
    for (const rolls of ['auto', 'mine', 'theirs']) assert.equal(keepsOwnRolls(rolls, suite), false, `${rolls}, alone`);
    announceBlock(suite, ['rolls']);
    // RPG Battle 0.7-style: registers its sheet and modifier but never announces.
    assert.equal(keepsOwnRolls('mine', suite), false, 'an extension that never announced keeps the 0.7 behaviour');
    announceBattle(suite);
    assert.equal(keepsOwnRolls('auto', suite), false, 'RPG Battle owns rolls');
    assert.equal(keepsOwnRolls('theirs', suite), false);
    assert.equal(keepsOwnRolls('mine', suite), true, 'the reader chose Story Block\'s own guess');
});

test('sourceStatus: who has each area now, or that its block is off', () => {
    const suite = fresh();
    announceBlock(suite, ['stats']);
    assert.equal(sourceStatus('stats', { choice: 'auto', suite, offered: true }), 'Now: Story Block');
    announceBattle(suite);
    assert.equal(sourceStatus('stats', { choice: 'auto', suite, offered: true }), 'Now: RPG Battle');
    assert.equal(sourceStatus('stats', { choice: 'mine', suite, offered: true }), 'Now: Story Block');
    assert.equal(sourceStatus('items', { choice: 'auto', suite, offered: false }), 'Inventory is off · RPG Battle has it');
    assert.equal(sourceStatus('scene', { choice: 'auto', suite, offered: false }), 'World State is off');
});

// ---- v0.9.1: chatter shown on NPC State Delta's cards ----

const announceDelta = (suite, extra = {}) => suite.announce({ id: 'npc-state-delta', name: 'NPC State Delta', version: '1.2.2', owns: ['scene', 'npc'], ...extra });

test('displaysShownElsewhere: an enabled other extension announcing shows: [\'chatter\'], and only known displays', () => {
    const suite = fresh();
    assert.deepEqual(displaysShownElsewhere(suite), [], 'alone');
    announceBlock(suite, ['items']);
    announceDelta(suite);
    assert.deepEqual(displaysShownElsewhere(suite), [], 'announced without shows');
    announceDelta(suite, { shows: ['chatter', 'scene', 'fields'] });
    assert.deepEqual(displaysShownElsewhere(suite), ['chatter'], 'other displays are never hidden this way');
    announceDelta(suite, { shows: ['chatter'], enabled: false });
    assert.deepEqual(displaysShownElsewhere(suite), [], 'switched off');
    announceDelta(suite, { shows: 'chatter' });
    assert.deepEqual(displaysShownElsewhere(suite), [], 'shows is a list');
    suite.withdraw('npc-state-delta');
    suite.announce({ id: 'story-block', name: 'Story Block', version: '0.9.1', owns: [], shows: ['chatter'] });
    assert.deepEqual(displaysShownElsewhere(suite), [], 'Story Block itself does not count');
    suite.announce({ id: 'someone-else', name: 'Other', version: '1.0.0', owns: [], shows: ['chatter'] });
    assert.deepEqual(displaysShownElsewhere(suite), ['chatter'], 'any extension may show it');
});

test('chatterNote: one runtime line for chatter-display blocks while NPC State Delta is here and on', () => {
    const suite = fresh();
    const chatter = templateById('inner-chatter');
    const custom = { ...on('scene-notes'), display: 'chatter' };
    assert.equal(chatterNote(chatter, suite), '', 'alone');
    announceDelta(suite);
    assert.equal(chatterNote(chatter, suite), CHATTER_NOTE);
    assert.equal(chatterNote(custom, suite), CHATTER_NOTE, 'any block shown as chatter');
    assert.equal(chatterNote(on('scene-notes'), suite), '', 'other displays');
    assert.ok(CHATTER_NOTE.length <= 60, 'about ten tokens');
    announceDelta(suite, { enabled: false });
    assert.equal(chatterNote(chatter, suite), '', 'switched off');
    assert.equal(chatterNote(null, suite), '');
});
