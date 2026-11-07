// Explicit skill flags are stored on their owning replies and replay through the host.
// The real skill editor reads the defaults and writes only a reader's changes.

import test from 'node:test';
import assert from 'node:assert/strict';
import { boardFlags } from '../../../../src/v2/lean-rpg/board/overrides.js';
import { CORE_FEATURE } from '../../../../src/v2/features.js';
import { skillFlags, skillKey } from '../../../../src/v2/lean-rpg/board/flags.js';
import { readSheet } from '../../../../src/v2/lean-rpg/read.js';
import { page, begin, makeBlocks, party, settle } from '../view/page.js';

test('renaming a skill carries explicit flags and deleting the rename restores the old skill', async t => {
    const { doc, host, ui } = await page(t, { formula: 'standard' });
    await begin(host);
    const blocks = await makeBlocks(host, { skills: { skill1: 'Shadow Step', about1: 'evasion', stat1: 'agi' } });
    const flags = { target: true, area: false, defence: true };
    assert.equal((await host.sdk.command('rpg.boardSkill', { module: blocks.character, slot: 1, name: 'Shadow Step', flags })).ok, true);
    await host.send('Wait.', 'Another reply.');
    ui.mounts.screen.open('story-block/party');
    await settle();
    party(doc).querySelector('.rpg-skills-open').click();
    party(doc).querySelector('.rpg-skill-pencil').click();
    const input = party(doc).querySelector('[data-skill-field="name"]');
    input.value = 'Shadow Evasion'; input.dispatch('input');
    party(doc).querySelector('.rpg-skill-save').click();
    await settle();
    const skill = () => readSheet(host.head()).characters.find(actor => actor.module === blocks.character).skills.find(entry => entry.slot === 1);
    assert.equal(skill().name, 'Shadow Evasion');
    assert.deepEqual(boardFlags(host.head())[skillKey(blocks.character, skill())], flags);
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live);
    await host.st.deleteMessage(host.ctx.chat.length - 1);
    await host.st.deleteMessage(host.ctx.chat.length - 1);
    assert.equal(skill().name, 'Shadow Step');
    assert.deepEqual(boardFlags(host.head())[skillKey(blocks.character, skill())], flags);
    const afterDelete = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), afterDelete);
    assert.deepEqual(host.store.problems(), []);
});

test('a renamed skill keeps its copied flags when the earlier flag edit is deleted', async t => {
    const { doc, host, ui } = await page(t, { formula: 'standard' });
    await begin(host);
    const blocks = await makeBlocks(host, { skills: { skill1: 'Shadow Step', about1: 'evasion', stat1: 'agi' } });
    host.settings.set('story-block', 'rpgRolls', 'off');
    await host.send('Wait.', 'Original choice.');
    const flags = { target: true, area: false, defence: true };
    assert.equal((await host.sdk.command('rpg.boardSkill', { module: blocks.character, slot: 1, name: 'Shadow Step', flags })).ok, true);
    await host.send('Again.', 'Rename.');
    ui.mounts.screen.open('story-block/party');
    await settle();
    party(doc).querySelector('.rpg-skills-open').click();
    party(doc).querySelector('.rpg-skill-pencil').click();
    const name = party(doc).querySelector('[data-skill-field="name"]');
    name.value = 'Shadow Evasion'; name.dispatch('input');
    party(doc).querySelector('.rpg-skill-save').click();
    await settle();
    await host.st.deleteMessage(4);
    await host.st.deleteMessage(3);
    const skill = readSheet(host.head()).characters.find(actor => actor.module === blocks.character).skills.find(entry => entry.slot === 1);
    assert.equal(skill.name, 'Shadow Evasion');
    assert.deepEqual(boardFlags(host.head())[skillKey(blocks.character, skill)], flags);
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live);
    assert.deepEqual(host.store.problems(), []);
});

test('renaming a skill with inferred flags keeps the new wording inferred', async t => {
    const { doc, host, ui } = await page(t, { formula: 'standard' });
    await begin(host);
    const blocks = await makeBlocks(host, { skills: { skill1: 'Sweep', about1: 'strike every foe', stat1: 'agi' } });
    ui.mounts.screen.open('story-block/party');
    await settle();
    party(doc).querySelector('.rpg-skills-open').click();
    party(doc).querySelector('.rpg-skill-pencil').click();
    const name = party(doc).querySelector('[data-skill-field="name"]');
    const about = party(doc).querySelector('[data-skill-field="about"]');
    name.value = 'Dodge'; name.dispatch('input');
    about.value = 'evasion'; about.dispatch('input');
    party(doc).querySelector('.rpg-skill-save').click();
    await settle();
    const skill = readSheet(host.head()).characters.find(actor => actor.module === blocks.character).skills.find(entry => entry.slot === 1);
    const saved = boardFlags(host.head())[skillKey(blocks.character, skill)];
    assert.equal(skill.name, 'Dodge');
    assert.equal(saved, undefined, 'renaming did not freeze inferred defaults');
    assert.deepEqual(skillFlags(skill, saved), { target: false, area: false, defence: true });
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live);
});

test('the skill editor saves flags and a middle deletion keeps the later choice', async t => {
    const { doc, host, ui } = await page(t, { formula: 'standard' });
    await begin(host);
    const blocks = await makeBlocks(host, { skills: { skill1: 'Shadow Step', about1: 'evasion', stat1: 'agi' } });
    host.settings.set('story-block', 'rpgRolls', 'off');
    await host.send('Wait.', 'One.');
    await settle();
    ui.mounts.screen.open('story-block/party');
    await settle();
    party(doc).querySelector('.rpg-skills-open').click();
    party(doc).querySelector('.rpg-skill-pencil').click();
    const defence = party(doc).querySelector('[data-board-flag="defence"]');
    assert.equal(defence.checked, true, 'wording supplies the default');
    defence.checked = false; defence.dispatch('change');
    party(doc).querySelector('.rpg-skill-save').click();
    await settle();
    const key = skillKey(blocks.character, { slot: 1, name: 'Shadow Step' });
    assert.equal(boardFlags(host.head())[key].defence, false);
    await host.send('Again.', 'Two.');
    const saved = await host.sdk.command('rpg.boardSkill', { module: blocks.character, slot: 1, name: 'Shadow Step', flags: { target: true, area: false, defence: true } });
    assert.equal(saved.ok, true, saved.message);
    assert.equal(boardFlags(host.head())[key].defence, true);
    await host.st.deleteMessage(4);
    assert.equal(boardFlags(host.head())[key].defence, true, 'later flags survive deleting the earlier edit');
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live);
    assert.deepEqual(host.store.problems(), []);
});

test('deleting the newer flag edit brings back the earlier keyed choice', async t => {
    const { host } = await page(t, { formula: 'standard' });
    await begin(host);
    const blocks = await makeBlocks(host, { skills: { skill1: 'Shadow Step', about1: 'evasion', stat1: 'agi' } });
    const key = skillKey(blocks.character, { slot: 1, name: 'Shadow Step' });
    const save = flags => host.sdk.command('rpg.boardSkill', { module: blocks.character, slot: 1, name: 'Shadow Step', flags });
    host.settings.set('story-block', 'rpgRolls', 'off');
    await host.send('Wait.', 'One.');
    assert.equal((await save({ target: true, area: false, defence: false })).ok, true);
    await host.send('Again.', 'Two.');
    assert.equal((await save({ target: false, area: true, defence: true })).ok, true);
    assert.deepEqual(boardFlags(host.head())[key], { target: false, area: true, defence: true });
    await host.st.deleteMessage(host.ctx.chat.length - 1);
    await host.st.deleteMessage(host.ctx.chat.length - 1);
    assert.deepEqual(boardFlags(host.head())[key], { target: true, area: false, defence: false }, 'the surviving reply supplies the older choice');
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, 'a rebuild restores the same earlier choice');
    assert.deepEqual(host.store.problems(), []);
});

test('damaged flag entries are skipped instead of throwing', () => {
    const flags = { target: true, area: false, defence: true };
    const state = { domains: { dataModules: { boardFlags: { a: { x: null, y: 'bad', z: { id: 'z', key: 'k', flags, rev: 1 } }, b: 7 } } } };
    assert.deepEqual(boardFlags(state), { k: flags });
});

// --- A12: a rename carries explicit flags with the board off (rpg.boardSkillCarry, no feature gate) ---

async function renameThroughEditor({ doc, ui }, name) {
    ui.mounts.screen.open('story-block/party');
    await settle();
    party(doc).querySelector('.rpg-skills-open').click();
    party(doc).querySelector('.rpg-skill-pencil').click();
    const input = party(doc).querySelector('[data-skill-field="name"]');
    input.value = name; input.dispatch('input');
    party(doc).querySelector('.rpg-skill-save').click();
    await settle();
}
const skillOf = (host, module) => readSheet(host.head()).characters.find(actor => actor.module === module).skills.find(entry => entry.slot === 1);

test('rename with board off carries explicit flags', async t => {
    const { doc, host, ui } = await page(t, { formula: 'standard' });
    await begin(host);
    const blocks = await makeBlocks(host, { skills: { skill1: 'Shadow Step', about1: 'evasion', stat1: 'agi' } });
    const flags = { target: true, area: false, defence: true };
    assert.equal((await host.sdk.command('rpg.boardSkill', { module: blocks.character, slot: 1, name: 'Shadow Step', flags })).ok, true);
    await host.send('Wait.', 'Another reply.');
    host.features.set(CORE_FEATURE.fightBoard, false);
    await renameThroughEditor({ doc, ui }, 'Shadow Evasion');
    assert.equal(skillOf(host, blocks.character).name, 'Shadow Evasion');
    host.features.set(CORE_FEATURE.fightBoard, true);
    assert.deepEqual(boardFlags(host.head())[skillKey(blocks.character, skillOf(host, blocks.character))], flags);
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live);
    assert.deepEqual(host.store.problems(), []);
});

test('rename with board off and no explicit flags writes nothing', async t => {
    const { doc, host, ui } = await page(t, { formula: 'standard' });
    await begin(host);
    const blocks = await makeBlocks(host, { skills: { skill1: 'Sweep', about1: 'strike every foe', stat1: 'agi' } });
    host.features.set(CORE_FEATURE.fightBoard, false);
    await renameThroughEditor({ doc, ui }, 'Wide Sweep');
    assert.equal(skillOf(host, blocks.character).name, 'Wide Sweep');
    assert.equal(host.head().domains.dataModules.boardFlags, undefined, 'no boardFlags entry');
    const carried = await host.sdk.command('rpg.boardSkillCarry', { module: blocks.character, slot: 1, from: 'Sweep', name: 'Wide Sweep' });
    assert.equal(carried.ok, true);
    assert.deepEqual(boardFlags(host.head()), {}, 'a carry with no old entry makes no flags from defaults');
});

test('carry replays after middle delete and rebuild', async t => {
    const { doc, host, ui } = await page(t, { formula: 'standard' });
    await begin(host);
    const blocks = await makeBlocks(host, { skills: { skill1: 'Shadow Step', about1: 'evasion', stat1: 'agi' } });
    const flags = { target: false, area: true, defence: false };
    assert.equal((await host.sdk.command('rpg.boardSkill', { module: blocks.character, slot: 1, name: 'Shadow Step', flags })).ok, true);
    await host.send('Wait.', 'Another reply.');
    host.features.set(CORE_FEATURE.fightBoard, false);
    await renameThroughEditor({ doc, ui }, 'Shadow Evasion');
    await host.st.deleteMessage(host.ctx.chat.length - 1);
    await host.st.deleteMessage(host.ctx.chat.length - 1);
    assert.equal(skillOf(host, blocks.character).name, 'Shadow Step');
    assert.deepEqual(boardFlags(host.head())[skillKey(blocks.character, skillOf(host, blocks.character))], flags);
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live);
    assert.deepEqual(host.store.problems(), []);
});

test('rpg.boardSkillCarry refuses a reader-less cause and bad payloads', async t => {
    const { host } = await page(t, { formula: 'standard' });
    await begin(host);
    const blocks = await makeBlocks(host, { skills: { skill1: 'Shadow Step', about1: 'evasion', stat1: 'agi' } });
    const bad = payload => host.sdk.command('rpg.boardSkillCarry', payload);
    assert.equal((await bad({ module: blocks.character, slot: 1, from: 7, name: 'Shadow Step' })).ok, false);
    assert.equal((await bad({ module: blocks.character, slot: 'one', from: 'A', name: 'Shadow Step' })).ok, false);
    assert.equal((await bad({ module: blocks.character, slot: 1, from: 'Shadow Step', name: 'Not There' })).ok, false, 'the new name must be on the sheet');
    assert.equal((await bad(null)).ok, false);
    const story = await host.sdk.command('rpg.boardSkillCarry', { module: blocks.character, slot: 1, from: 'A', name: 'Shadow Step' }, { cause: 'story' });
    assert.equal(story?.ok, false, 'only the reader carries');
});
