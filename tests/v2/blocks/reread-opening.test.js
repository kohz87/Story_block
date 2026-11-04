// Stage 68: blocks the reader made after the opening reply (the New character wizard's Character and Skills blocks, `dm.define`) are stored
// on that reply. Its note ("no change lines", or "edited") offers Re-read; pressing it took the blocks away for good (the dataModules domain
// gone, saved so, a reload and later replies the same). A Re-read now keeps the reader's own chat-block setup, as it keeps the reader's other
// actions on the reply (store.js readerSetup); a swipe or a delete of the reply still takes it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { LEAN_RPG_TEMPLATES } from '../../../src/v2/lean-rpg/templates.js';
import { createReplyNotes } from '../../../src/v2/reply-notes.js';
import { setupDom } from '../view/mounts/helpers.js';

test('a Re-read of the opening reply, from its note, keeps the blocks the reader made on it: live, after a reload and after a later reply', async t => {
    const host = await createHost({ settings: { features: { 'story-block.rpg': true }, modules: { 'story-block': { rpgJoin: 'auto', rpgFormula: 'classic' } } } });
    t.after(() => host.close());
    await host.send('Begin.', 'Opening.');
    const defs = Object.fromEntries(LEAN_RPG_TEMPLATES.filter(entry => ['character', 'skills'].includes(entry.definition.role)).map(entry => [entry.definition.role, structuredClone(entry.definition)]));
    defs.character.slug = 'wessel'; defs.character.name = 'Wessel'; defs.character.state.who.default = 'Wessel';
    defs.skills.slug = 'wessel-skills'; defs.skills.name = 'Wessel skills'; defs.skills.state.who.default = 'Wessel';
    for (const definition of [defs.character, defs.skills]) {
        const made = await host.sdk.command('dm.define', { definition });
        assert.equal(made.ok, true, `${made.code}: ${made.message}`);
    }
    const at = host.ctx.chat.findIndex(message => String(message.mes ?? '').startsWith('Opening.'));
    assert.deepEqual(host.ctx.chat[at].extra.storySuite.receipts.map(receipt => receipt.type), ['dm.define', 'dm.define'], 'the blocks are stored on the opening reply');
    const keys = () => Object.keys(host.head().domains.dataModules?.active ?? {}).sort();
    const made = ['pack.chat/wessel', 'pack.chat/wessel-skills'];
    assert.deepEqual(keys(), made);
    const fields = JSON.stringify(host.head().domains.dataModules);
    // The reader's way in: the reply's note (it holds no change lines) with its Re-read button.
    const notes = createReplyNotes({ ctx: host.ctx, doc: setupDom(), reread: index => host.turn.reread(index) });
    t.after(() => notes.destroy?.());
    assert.equal(notes.noteKind(at), 'missing', 'the opening reply offers Re-read');
    const result = await notes.reread(at);
    assert.equal(result?.ok, true, `${result?.code}: ${result?.message}`);
    assert.deepEqual(keys(), made, 'the blocks stay');
    assert.equal(JSON.stringify(host.head().domains.dataModules), fields, 'with their fields as they were');
    assert.deepEqual(host.store.problems(), []);
    assert.deepEqual(host.ctx.chat[at].extra.storySuite.receipts.map(receipt => receipt.type), ['dm.define', 'dm.define'], 'and their receipts');
    const live = JSON.stringify(host.head());
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(JSON.stringify(host.head()), live, 'a reload gives the live head');
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, 'a rebuild gives the live head');
    await host.send('Next.', 'Later reply.');
    assert.deepEqual(keys(), made, 'a later reply keeps them');
    // A swipe of the reply still takes them (reply-bound, as before).
    await host.st.deleteMessage(host.ctx.chat.length - 1);
    await host.st.deleteMessage(host.ctx.chat.length - 1);
    const message = host.ctx.chat[at];
    message.swipes.push('Another opening.');
    message.swipe_info.push({ send_date: '', extra: {} });
    await host.st.swipeTo(at, message.swipes.length - 1);
    assert.deepEqual(keys(), [], 'a swipe away from the reply takes them');
});
