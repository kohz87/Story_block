// Explicit skill flags are stored on their owning replies and replay through the host.
// The real skill editor reads the defaults and writes only a reader's changes.

import test from 'node:test';
import assert from 'node:assert/strict';
import { boardFlags } from '../../../../src/v2/lean-rpg/board/overrides.js';
import { skillKey } from '../../../../src/v2/lean-rpg/board/flags.js';
import { page, begin, makeBlocks, party, settle } from '../view/page.js';

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
