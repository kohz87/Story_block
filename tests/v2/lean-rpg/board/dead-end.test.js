// A fight the reader staged must never leave the "Fight tab, Discard fight" advice with no tab:
// the Fight tab is listed while a board fight is kept, and Discard fight clears the hold so a send goes through.
// Also: a send after two user messages in a row (no session, no record before the reader's message) does not throw.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrecall } from '../../../../src/v2/lean-rpg/index.js';
import { LEAN_RPG_FEATURE } from '../../../../src/v2/lean-rpg/names.js';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';
import { STANDARD_TEMPLATES } from '../../../../src/v2/lean-rpg/templates.js';
import { boardSession, openBoard, stageExchange } from '../../../../src/v2/lean-rpg/board/session.js';
import { begin, makeBlocks, page, settle } from '../view/page.js';

const BOARD = 'story-block.fight-board';

test('two user messages in a row with no fight session: canGenerate and beforeGenerate answer instead of throwing', async () => {
    const messages = [{ is_user: false, mes: 'The rats close in.' }, { is_user: true, mes: 'I wait.' }, { is_user: true, mes: 'I hit the lead rat.' }];
    const precall = createPrecall({ chat: () => messages, metadata: () => ({}) });
    const view = { feature: id => id === LEAN_RPG_FEATURE || id === BOARD, query: () => null, state: { domains: {} }, settings: () => ({}) };
    for (const type of ['normal', 'regenerate']) {
        assert.doesNotThrow(() => precall.canGenerate(view, { commit: true, type }));
        await assert.doesNotReject(async () => precall.beforeGenerate(view, { commit: true, type }));
    }
});

test('a staged fight whose reply was deleted keeps the Fight tab; Discard fight clears the hold and a send goes through', async t => {
    const { doc, host, ui } = await page(t, { formula: 'standard' });
    await begin(host);
    await makeBlocks(host, { character: { agi: 20 }, skills: { skill1: 'Cut', stat1: 'str', about1: 'cut one foe' } });
    const foes = structuredClone(STANDARD_TEMPLATES.find(item => item.definition.role === 'foes').definition);
    Object.assign(foes.state.foe1, { default: 'Rats' });
    Object.assign(foes.state.count1, { default: 2 });
    Object.assign(foes.state.level1, { default: 1 });
    Object.assign(foes.state.hurt1, { default: 5 });
    assert.equal((await host.sdk.command('dm.define', { definition: foes })).ok, true);
    host.features.set('story-block.fight-board', true);
    await settle();
    const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex());
    assert.equal(openBoard(meta, host.head(), { sid, rules: { ...STANDARD_FORMULA, levelDivisor: 5 } }).error, undefined);
    assert.equal(stageExchange(meta, host.head(), [{ who: 'Wessel', kind: 'attack', target: 11 }]).error, undefined);
    // The reply the fight hangs on is deleted, and with it the foes.
    await host.st.deleteMessage(2);
    await settle();
    assert.ok(boardSession(meta)?.exchanges.length, 'the staged fight is still kept');
    const held = await host.send('I press on.', 'The story goes on.');
    assert.equal(held.aborted, true, 'the send is held');
    assert.equal(host.ctx.chat.at(-1).is_user, true);
    const fightScreen = () => ui.screens.list('tab').find(entry => entry.id === 'story-block/fight')?.screen;
    assert.equal(fightScreen().active(host.head(), {}).on, true, 'the Fight tab is listed with no foe on the sheet');
    ui.mounts.screen.open('story-block/fight');
    await settle();
    const fight = () => doc.querySelector('[data-ss-screen="story-block/fight"]');
    assert.ok(fight(), 'the Fight screen opens');
    assert.ok(fight().querySelector('.rpg-board-discard'), 'Discard fight is there');
    fight().querySelector('.rpg-board-discard').click();
    fight().querySelector('.rpg-board-confirm').click();
    assert.equal(boardSession(meta), null, 'the fight is discarded');
    assert.equal(fightScreen().active(host.head(), {}).on, false, 'with nothing kept and no foe the tab leaves again');
    const again = await host.send('I press on.', 'The story goes on.');
    assert.equal(again.aborted, undefined, 'the hold is gone');
    assert.equal(host.ctx.chat.at(-1).is_user, false);
});

test('a held reply\'s fight keeps the Fight tab even after Discard fight, until the reply is regenerated', async t => {
    const { host, ui } = await page(t, { formula: 'standard' });
    await begin(host);
    host.features.set('story-block.fight-board', true);
    const meta = host.ctx.chatMetadata, sid = host.store.carrierSid(host.store.headIndex());
    const fightScreen = () => ui.screens.list('tab').find(entry => entry.id === 'story-block/fight')?.screen;
    assert.equal(fightScreen().active(host.head(), {}).on, false, 'no foe, nothing held: no tab');
    meta.rpgFightHeld = { [sid]: { current: { type: 'normal', prechecks: [{ type: 'rpg.resolve', payload: { key: 'b:x:y:0', board: { id: 'x:0', anchor: 'y' } } }] }, staged: {} } };
    assert.equal(fightScreen().active(host.head(), {}).on, true, 'a held fight lists the tab');
    meta.rpgFightHeldDiscarded = { [sid]: true };
    assert.equal(fightScreen().active(host.head(), {}).on, true, 'the held reply still says "Regenerate the held reply" there');
});
