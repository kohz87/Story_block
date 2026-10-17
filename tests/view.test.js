// What each block's tab shows, worked out from plain message arrays.
import test from 'node:test';
import assert from 'node:assert/strict';
import { blockStatusInText, blockView, emptyView, latestAssistantIndex, tabView, viewKey } from '../src/view.js';
import { normalizeBlock } from '../src/schema.js';
import { templateById } from '../src/templates.js';

const inventory = templateById('inventory');
const notes = normalizeBlock({ id: 'notes', name: 'Notes', tag: 'Notes', kind: 'turn', format: 'text' });
const envelope = (...blocks) => `<!-- STORY_BLOCKS_V1\n<Blocks>\n${blocks.join('\n')}\n</Blocks>\n-->`;
const inv = gold => `<Inventory>\nCoin Pouch | 1 | ${gold} Gold\n</Inventory>`;
const reply = mes => ({ is_user: false, is_system: false, mes });
const user = mes => ({ is_user: true, mes });

test('stateful: newest valid copy, its predecessor and the diff between them', () => {
    const chat = [reply(envelope(inv(100))), user('buy'), reply(envelope(inv(85)))];
    const view = blockView(chat, inventory);
    assert.equal(view.messageIndex, 2);
    assert.equal(view.fromEarlierReply, false);
    assert.equal(view.state.categories[0].items[0].remark, '85 Gold');
    assert.deepEqual(view.changes.map(change => [change.type, change.from, change.to]), [['changed', '1 · 100 Gold', '1 · 85 Gold']]);
});

test('stateful: an unreadable or missing latest copy keeps the older state and says so', () => {
    const broken = [reply(envelope(inv(100))), user('go'), reply(envelope('<Inventory>\nRope | 1 |\nrope | 2 |\n</Inventory>'))];
    const view = blockView(broken, inventory);
    assert.equal(view.messageIndex, 0);
    assert.equal(view.fromEarlierReply, true);
    assert.match(view.error, /Duplicate/);
    const missing = blockView([reply(envelope(inv(100))), user('go'), reply('Just prose.')], inventory);
    assert.equal(missing.fromEarlierReply, true);
    assert.equal(missing.error, null);
    assert.equal(blockView([reply('Nothing yet.')], inventory), null);
});

test('stateful: a cut-off latest copy is flagged', () => {
    const chat = [reply(envelope(inv(100))), user('go'), reply('Story.\n<!-- STORY_BLOCKS_V1_CUT\n<Blocks>\n<Inventory>\nCoin Pouch | 1 | 9')];
    assert.equal(blockView(chat, inventory).truncated, true);
});

test('turn blocks come only from the latest reply', () => {
    const chat = [reply(envelope('<Notes>\nOld note.\n</Notes>')), user('go'), reply('No notes this time.')];
    assert.equal(blockView(chat, notes), null);
    chat.push(user('again'), reply(envelope('<Notes>\nThe guards are on alert.\n</Notes>')));
    assert.equal(blockView(chat, notes).state.text, 'The guards are on alert.');
});

test('status, latest index and view keys', () => {
    assert.equal(blockStatusInText(envelope(inv(5)), inventory).status, 'valid');
    assert.equal(blockStatusInText('prose', inventory).status, 'missing');
    assert.equal(latestAssistantIndex([reply('a'), user('b')]), 0);
    const chat = [reply(envelope(inv(1)))];
    assert.equal(viewKey(blockView(chat, inventory)), viewKey(blockView(chat, inventory)));
    assert.notEqual(viewKey(blockView(chat, inventory)), viewKey(blockView([reply(envelope(inv(2)))], inventory)));
});

test('emptyView: a block with nothing yet still has a view the sidebar can list', () => {
    const view = emptyView(inventory);
    assert.equal(view.empty, true);
    assert.deepEqual(view.state, { categories: [] });
    assert.deepEqual(view.changes, []);
    assert.equal(emptyView(notes).state, null, 'a per-reply block shows its "not in the latest reply" state');
});

test('tabView: the sidebar lists empty blocks, but an optional one only when the latest reply has it', () => {
    const dice = templateById('dice');
    const chat = [user('I check the grate.'), reply(`The water rose.\n${envelope(inv(5))}`)];
    assert.equal(tabView(chat, inventory, { sidebar: true }).empty, undefined, 'a block with content');
    assert.equal(tabView(chat, notes, { sidebar: true }).empty, true, 'an empty block still gets a tab');
    assert.equal(tabView(chat, notes), null, 'the card shows only blocks with content');
    assert.equal(tabView(chat, dice, { sidebar: true }), null, 'no roll, no Dice tab');

    const rolled = [...chat, user('I climb.'), reply(`${envelope('<Dice>\n🎲 Climb — d20+2 vs 15 → 12+2 = 14 · success\n</Dice>')}\nYou climb.`)];
    const view = tabView(rolled, dice, { sidebar: true });
    assert.ok(view && !view.empty, 'a roll in the latest reply brings the tab back');
    assert.match(view.body, /Climb/);
});
