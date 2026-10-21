// Round 3, b2-timeline: what the reader does before the first reply lives on the greeting's record (the
// character made in the creation wizard, people present, ...). SillyTavern 1.19 treats a chat holding only
// the greeting as "pristine" unless chat_metadata.tainted is set: createOrEditCharacter (run when the
// character card is edited and saved, and by renameChat) replaces chat[0] with a fresh greeting from the
// card (no extra), emits MESSAGE_RECEIVED(0, 'first_message') and saves. Story Block never taints the chat,
// so the record and everything on it are gone. Live (r3): party.create + scene.present on a new chat, then
// one word added to the card's description → file and page lose the character (party.pc null); a rename of
// such a chat does the same. Drop into Story_block/tests/v2/break/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { aiMessage } from '../../../testkit/fake-st.js';

// script.js createOrEditCharacter, the pristine-chat branch.
async function stCardSaved(h) {
    const { ctx, st } = h;
    const pristine = !ctx.chatMetadata?.tainted && ctx.chat.length === 1 && !ctx.chat[0].is_user && !ctx.chat[0].is_system;
    if (!pristine) return false;
    ctx.chat.splice(0, ctx.chat.length, aiMessage('The story begins.', { name: ctx.name2 }));
    await st.eventSource.emit('message_received', 0, 'first_message');
    await ctx.saveChat();
    return true;
}

test('B-b2-timeline-r3-1: what the reader did before the first reply survives a character card edit', async t => {
    t.mock.method(console, 'warn', () => {});
    const h = await createHost();
    t.after(() => h.close());
    assert.equal((await h.sdk.command('scene.present', { add: 'Ann' })).ok, true);   // on the greeting
    assert.deepEqual([...h.head().domains.scene.present], ['Ann']);
    await stCardSaved(h);
    h.store.rebuild();
    assert.deepEqual([...(h.head()?.domains?.scene?.present ?? [])], ['Ann'], 'the greeting\'s state is still there (Story Block marks the chat as used, or carries the record)');
});
