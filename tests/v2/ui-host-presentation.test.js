// The blocks' screens come from `dataModules.presentation`, which settles the timeline and reads the story. The page asks it again only
// when the pinned block definitions moved (a stamp); the events of one reply that see the same stamp ask once, and every event looks at
// the stamp at once, so the screens are never left for later (the other listeners of the same event read them) and the last state wins.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { mountUi } from '../../src/v2/ui-host.js';
import { setupDom } from './view/mounts/helpers.js';
import { fixture, success } from './data-modules/helpers.js';
import { buildBlock } from '../../src/v2/data-modules/block-builder.js';
import { BLOCK_STARTERS } from '../../src/v2/data-modules/block-starters.js';

const starter = id => BLOCK_STARTERS.find(item => item.id === id);

const MODULE = 'pack.ersveil-factions/reputation';

async function page(t) {
    const doc = setupDom();
    const host = await createHost({}); t.after(() => host.close());
    success(await host.packs.packs.install(fixture('reputation')));
    const asked = [];
    const sdk = { ...host.sdk, query: (name, args) => { if (name === 'dataModules.presentation') asked.push(host.store.headIndex()); return host.sdk.query(name, args); } };
    const runtime = { registry: host.registry, store: host.store, sdk, settings: host.settings, events: host.events, turn: host.turn };
    const ui = mountUi({ runtime, ctx: host.ctx, doc, version: '2.0.0-test' });
    t.after(() => ui.destroy());
    await host.send('Begin.', 'Opening.');
    await tick();
    const shown = () => ui.screens.list('tab').map(entry => entry.id).filter(id => id.includes('reputation')).sort();
    const offer = () => host.sdk.query('dataModules.offers').find(row => row.module === MODULE);
    const pin = async () => { const row = offer(); return host.sdk.command('dm.pin', { module: row.module, hash: row.hash, packHash: row.packHash, subjects: [] }); };
    const truth = () => host.sdk.query('dataModules.presentation', { kind: 'screens' }).map(screen => screen.pack);
    asked.length = 0;
    return { host, ui, asked, shown, pin, truth, offer };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('a reply that changes no block asks the presentation query nothing', async t => {
    const { host, asked } = await page(t);
    await host.send('Go on.', 'The story goes on.\n<Changes>\n+ coin 5\n</Changes>');
    await tick();
    assert.equal(asked.length, 0, 'the stamp did not move: no presentation read');
});

test('pinning a block shows its screens, once, however many events come with it', async t => {
    const { host, ui, asked, shown, pin, truth } = await page(t);
    assert.deepEqual(shown(), []);
    success(await pin());
    await tick();
    assert.equal(asked.length, 1, 'two events (committed, head), one compute');
    assert.ok(truth().length > 0);
    assert.ok(shown().length > 0, `the tab is shown: ${JSON.stringify(ui.screens.list('tab').map(entry => entry.id))}`);
    await host.send('Next.', 'Next reply.');
    await tick();
    assert.equal(asked.length, 1, 'a plain reply asks nothing more');
});

test('events in a row are one compute, and the screens are already right when the event returns (other listeners read them)', async t => {
    const { host, asked, shown, pin } = await page(t);
    host.events.emit('head', { index: 0 });
    host.events.emit('committed', {});
    host.events.emit('head', { index: 0 });
    await tick();
    assert.equal(asked.length, 0, 'unchanged blocks, no compute');
    // the pin lands and, before the microtask runs, more events come: still one compute, and it shows the pinned block
    success(await pin());
    assert.ok(shown().length > 0, 'shown by the time the command returned');
    asked.length = 0;
    host.events.emit('head', {}); host.events.emit('committed', {}); host.events.emit('head', {});
    assert.equal(asked.length, 0, 'the pin was seen already: nothing is asked again');
    assert.ok(shown().length > 0);
});

// The page's tab for the chat block "Quest log", by title, against what the story holds now.
async function blockPage(t) {
    const doc = setupDom(), form = doc.createElement('div'); form.id = 'send_form'; doc.body.appendChild(form);
    const host = await createHost(); t.after(() => host.close());
    const asked = [];
    const sdk = { ...host.sdk, query: (name, args) => { if (name === 'dataModules.presentation') asked.push(1); return host.sdk.query(name, args); } };
    const ui = mountUi({ runtime: { registry: host.registry, store: host.store, sdk, settings: host.settings, events: host.events, turn: host.turn }, ctx: host.ctx, doc, version: '2.0.0-test' });
    t.after(() => ui.destroy());
    await host.send('Begin.', 'Opening.');
    const made = (name, tabName) => { const built = buildBlock({ ...starter('quest-log').draft(), name, slug: 'quest-log' }); assert.equal(built.ok, true); built.definition.show.tabName = tabName; return built.definition; };
    const titles = () => ui.screens.list('tab').filter(entry => entry.id.includes('quest-log')).map(entry => entry.screen.title);
    const truth = () => host.sdk.query('dataModules.presentation', { kind: 'screens' }).map(screen => screen.title);
    const same = (message) => assert.deepEqual(titles(), truth(), message);
    return { host, ui, asked, made, titles, truth, same };
}
const settled = () => new Promise(resolve => setTimeout(resolve, 5));

test('every change of the story that moves a block refreshes its tab: define, edit, swipe, delete, Re-read, rewind, chat switch', async t => {
    const { host, asked, made, titles, truth, same } = await blockPage(t);
    assert.deepEqual(titles(), []);
    await host.send('Make it.', 'Made.');
    success(await host.sdk.command('dm.define', { definition: made('Quest log', 'Quests') }));
    await settled();
    assert.deepEqual(titles(), ['Quests'], 'defined');
    same('defined');
    // a block edit (on a later reply)
    await host.send('Then.', 'Then.');
    success(await host.sdk.command('dm.redefine', { module: 'pack.chat/quest-log', definition: made('Quest log', 'Journal') }));
    await settled();
    assert.deepEqual(titles(), ['Journal'], 'an edit');
    // a plain reply does not ask again
    const quiet = asked.length;
    await host.send('Walk.', 'They walk.'); await settled();
    assert.equal(asked.length, quiet, 'a plain reply asks nothing');
    // a swipe of the reply that carries the edit: the edit goes with it
    await host.send('More.', 'More.\n<Changes>\n+ dm quest-log — asked | kind: add-quests | title: Find the key\n</Changes>'); await settled();
    await host.swipe('Another way.'); await settled();
    same('a swipe');
    assert.deepEqual(titles(), ['Journal'], 'the swipe left the earlier edit');
    // a Re-read of a reply, a delete of the reply that carries the edit, a rewind before it
    success(await host.turn.reread(host.ctx.chat.length - 1)); await settled();
    same('a Re-read');
    const editReply = host.ctx.chat.findIndex(message => (message.extra?.storySuite?.receipts ?? []).some(receipt => receipt.type === 'dm.redefine'));
    assert.ok(editReply > 0);
    await host.st.deleteMessage(editReply); await settled();
    same('a delete');
    assert.deepEqual(titles(), ['Quests'], 'the delete took the edit back');
    await host.st.deleteMessage(host.ctx.chat.findIndex(message => (message.extra?.storySuite?.receipts ?? []).some(receipt => receipt.type === 'dm.define'))); await settled();
    same('a delete of the definition');
    assert.deepEqual(titles(), [], 'the block is gone');
    // a chat switch
    success(await host.sdk.command('dm.define', { definition: made('Quest log', 'Quests') })); await settled();
    assert.deepEqual(titles(), ['Quests']);
    const chat = JSON.parse(JSON.stringify(host.ctx.chat));
    await host.st.loadChat([]); await host.turn.onChatChanged(); await settled();
    assert.deepEqual(titles(), [], 'a chat without the block');
    await host.st.loadChat(chat); await host.turn.onChatChanged(); await settled();
    assert.deepEqual(titles(), ['Quests'], 'the chat back');
    same('the chat back');
    assert.ok(truth().length === 1);
});

test('a rewind to before a block was edited shows the block as it was', async t => {
    const { host, made, titles, same } = await blockPage(t);
    await host.send('Make it.', 'Made.');
    success(await host.sdk.command('dm.define', { definition: made('Quest log', 'Quests') }));
    await host.send('Edit.', 'Edited.');
    success(await host.sdk.command('dm.redefine', { module: 'pack.chat/quest-log', definition: made('Quest log', 'Journal') }));
    await settled();
    assert.deepEqual(titles(), ['Journal']);
    const edit = host.sdk.receipts().find(entry => entry.receipt.type === 'dm.redefine');
    const result = await host.sdk.rewind({ index: edit.index, beforeRev: edit.receipt.rev });
    assert.equal(result.ok, true, result.message);
    await host.turn.onChatChanged(); await settled();
    assert.deepEqual(titles(), ['Quests'], 'the rewound chat');
    same('rewind');
});

test('the refresh does nothing after the page is destroyed', async t => {
    const { host, ui, asked } = await page(t);
    ui.destroy();
    host.events.emit('head', {});
    await tick();
    assert.equal(asked.length, 0);
});
