// The New character wizard in a chat with no state yet (stage 39): with the greeting there but Story Block not told of the chat
// (CHAT_CHANGED still on its way), Create starts the state and makes the character; with no message at all it says in one
// plain sentence what to do, never the raw "There is no state to change yet."
import test from 'node:test';
import assert from 'node:assert/strict';
import { page, party, settle } from './page.js';

const wizardOf = dialog => dialog.root.querySelector('.ss-w-rpg-wizard');
const names = host => Object.keys(host.head()?.domains.dataModules?.active ?? {}).sort();

// The chat emptied (every message deleted): no carrier, no state.
async function emptied(ctx) {
    ctx.host.ctx.chat.splice(0);
    await ctx.host.turn.onTimelineChanged();
    assert.equal(ctx.host.head(), null);
}

async function create(ctx) {
    ctx.ui.mounts.screen.open('story-block/party');
    await settle();
    party(ctx.doc).querySelector('.rpg-create').click();
    await settle();
    const dialog = ctx.ui.mounts.dialog.current();
    dialog.goTo(3);
    await settle();
    wizardOf(dialog).querySelector('.rpg-wiz-create').click();
    await settle();
    return dialog;
}

test('a new chat\'s greeting with no state yet: Create starts the state and makes the character', async t => {
    const ctx = await page(t, { persona: 'Wessel' });
    await emptied(ctx);
    // SillyTavern shows the new chat's greeting; its CHAT_CHANGED has not reached Story Block.
    ctx.host.ctx.chat.push({ name: 'Narrator', is_user: false, mes: 'The fire crackles.', extra: {} });
    await create(ctx);
    assert.equal(ctx.ui.mounts.dialog.current(), null, 'created: the dialog closes');
    assert.ok(names(ctx.host).includes('pack.chat/wessel'));
    assert.ok(names(ctx.host).includes('pack.chat/wessel-skills'));
    assert.ok(ctx.host.ctx.chat[0].extra.storySuite, 'the greeting holds the state');
});

test('no message at all: Create says to start the chat first, in one sentence, and nothing is made', async t => {
    const ctx = await page(t, { persona: 'Wessel' });
    await emptied(ctx);
    const dialog = await create(ctx);
    assert.equal(ctx.ui.mounts.dialog.current(), dialog, 'the dialog stays open so nothing typed is lost');
    const status = wizardOf(dialog).querySelector('.rpg-wiz-status').textContent;
    assert.equal(status, 'Start the chat first: the character\'s first message holds the story\'s state.');
    assert.doesNotMatch(status, /no state to change/);
    assert.equal(wizardOf(dialog).querySelector('.rpg-wiz-create').disabled, false, 'Create can be tried again');
    assert.equal(ctx.host.head(), null, 'nothing written');
    // The chat starts (the character's first message): Create now works.
    ctx.host.ctx.chat.push({ name: 'Narrator', is_user: false, mes: 'The fire crackles.', extra: {} });
    wizardOf(dialog).querySelector('.rpg-wiz-create').click();
    await settle();
    assert.equal(ctx.ui.mounts.dialog.current(), null);
    assert.ok(names(ctx.host).includes('pack.chat/wessel'));
});
