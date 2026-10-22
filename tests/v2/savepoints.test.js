// Save points (MODULES §F93): "Save point" makes a named SillyTavern branch at the latest reply and lists
// it in the chat's metadata (never in the story state); "Return here" opens that branch. Over the real
// runtime through the testkit, with a SillyTavern-like createBranch (makes the branch file, stays put).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { SAVEPOINT_LIMITS, createSavePoints, stCreateBranch } from '../../src/v2/rewind.js';
import { createSavePointsWidget, savedAt } from '../../src/v2/screens/savepoints.js';
import { homeScreen } from '../../src/v2/screens/home.js';
import { CORE_FEATURES } from '../../src/v2/domains/index.js';
import { host as widgetHost, installDom } from './view/widgets/fake-dom.js';

const clone = value => structuredClone(value);
const NOW = Date.UTC(2026, 9, 21, 18, 30);

// SillyTavern 1.19's bookmarks.js createBranch, as far as a save point sees it: a new chat file made of
// chat[0..index] (with a copy of the chat's metadata), its name on that message's extra.branches; the
// chat open stays open.
function stLike(host) {
    const made = [];
    const metadata = {};
    host.ctx.saveMetadata = async () => { host.metadataSaves = (host.metadataSaves ?? 0) + 1; };
    return {
        made,
        metadata,
        async createBranch(index) {
            const name = `${host.ctx.chatId} - Branch #${made.length + 1}`;
            made.push({ index, name });
            host.st.chats[name] = clone(host.ctx.chat.slice(0, index + 1));
            metadata[name] = clone(host.ctx.chatMetadata);
            (host.ctx.chat[index].extra.branches ??= []).push(name);
            return name;
        },
        async open(name) {
            if (!host.st.chats[name]) throw new Error(`there is no chat "${name}"`);
            host.st.chats[host.ctx.chatId] = clone(host.ctx.chat);
            await host.st.loadChat(host.st.chats[name], name);
        },
    };
}

async function played() {
    const host = await createHost();
    await host.send('Look around.', 'You find rope.\n<Changes>\n+ item Rope\n</Changes>');
    await host.send('Go on.', 'Two coins glint.\n<Changes>\n+ coin 2\n</Changes>');
    const st = stLike(host);
    const points = createSavePoints({ ctx: host.ctx, store: host.store, live: () => host.ctx, createBranch: st.createBranch, open: st.open, now: () => NOW });
    return { host, st, points };
}

test('save: a branch at the latest reply, named, listed in the chat\'s metadata; the story is untouched', async () => {
    const { host, st, points } = await played();
    const head = clone(host.head());
    const records = host.ctx.chat.map(message => clone(message.extra?.storySuite ?? null));
    const result = await points.save({ name: '  Before\nthe   bridge ' });
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(st.made, [{ index: 4, name: 'chat-1 - Branch #1' }]);
    assert.match(result.point.id, /^sp_[a-z0-9]{8}$/);
    assert.deepEqual({ ...result.point, id: 'x' }, { id: 'x', name: 'Before the bridge', index: 4, branch: 'chat-1 - Branch #1', at: new Date(NOW).toISOString(), rev: head.meta.rev });
    // Kept by id in the chat's metadata, saved with it.
    const stored = host.ctx.chatMetadata.storySuite.savePoints;
    assert.deepEqual(Object.keys(stored), [result.point.id]);
    assert.equal(stored[result.point.id].branch, 'chat-1 - Branch #1');
    assert.equal(host.metadataSaves, 1);
    // Not in the story: same state, same rev, no receipt, the records on the messages as they were.
    assert.deepEqual(host.head(), head);
    assert.deepEqual(host.ctx.chat.map(message => clone(message.extra?.storySuite ?? null)), records);
    assert.equal(host.ctx.chatId, 'chat-1', 'the reader stays where they are');
    // The branch holds the story as it was: its records came along.
    assert.equal(host.st.chats['chat-1 - Branch #1'].length, 5);
    assert.deepEqual(host.st.chats['chat-1 - Branch #1'][4].extra.storySuite.receipts, records[4].receipts);
    assert.deepEqual(points.list(), [result.point]);
    host.close();
});

test('save: no name → "Save point N"; names one line, cut at 60; listed newest reply first', async () => {
    const { host, points } = await played();
    assert.equal((await points.save()).point.name, 'Save point 1');
    await host.send('More.', 'More.');
    assert.equal((await points.save({ name: 'é'.repeat(80) })).point.name, 'é'.repeat(SAVEPOINT_LIMITS.name));
    assert.equal((await points.save({ name: '   ' })).point.name, 'Save point 3');
    assert.deepEqual(points.list().map(point => [point.index, point.name.slice(0, 12)]), [[6, 'Save point 3'], [6, 'éééééééééééé'], [4, 'Save point 1']]);
    host.close();
});

test('save refuses what it cannot do and lists nothing then', async () => {
    const { host, st, points } = await played();
    // The branch could not be made.
    const broken = createSavePoints({ ctx: host.ctx, store: host.store, live: () => host.ctx, createBranch: async () => { throw new Error('disk full'); }, open: st.open });
    assert.deepEqual(await broken.save(), { ok: false, code: 'FAILED', message: 'The chat could not be branched: disk full' });
    const none = createSavePoints({ ctx: host.ctx, store: host.store, live: () => host.ctx, createBranch: async () => null, open: st.open });
    assert.equal((await none.save()).code, 'FAILED');
    assert.equal(points.list().length, 0);
    // Another chat opened while it was made: the branch stays in SillyTavern, but this list is not
    // written into the other chat's metadata.
    const wandering = createSavePoints({ ctx: host.ctx, store: host.store, live: () => host.ctx, open: st.open,
        createBranch: async index => { const name = await st.createBranch(index); host.ctx.chatId = 'other'; return name; } });
    const moved = await wandering.save();
    assert.equal(moved.code, 'FAILED');
    assert.match(moved.message, /the branch "chat-1 - Branch #1" was kept/);
    assert.equal(host.ctx.chatMetadata.storySuite, undefined);
    host.ctx.chatId = 'chat-1';
    // One at a time.
    const slow = createSavePoints({ ctx: host.ctx, store: host.store, live: () => host.ctx, open: st.open,
        createBranch: index => new Promise(resolve => setTimeout(() => resolve(st.createBranch(index)), 5)) });
    const [first, second] = await Promise.all([slow.save(), slow.save()]);
    assert.equal(first.ok, true);
    assert.equal(second.code, 'STALE');
    // At most 50.
    const meta = host.ctx.chatMetadata.storySuite.savePoints;
    for (let i = 0; i < SAVEPOINT_LIMITS.count; i++) meta[`sp_${String(i).padStart(8, '0')}`] = { name: `n${i}`, index: 4, branch: `b${i}`, at: '' };
    assert.equal((await points.save()).code, 'LIMITED');
    host.close();
});

test('save on a chat with no reply that keeps the story is refused', async () => {
    const host = await createHost({ st: { chat: [] } });
    const points = createSavePoints({ ctx: host.ctx, store: host.store, live: () => host.ctx, createBranch: async () => 'x', open: async () => {} });
    assert.equal((await points.save()).code, 'NOT_FOUND');
    host.close();
});

test('return here opens the branch (the old story there), says "here" in it, and refuses a gone one', async () => {
    const { host, st, points } = await played();
    const saved = await points.save({ name: 'Bridge' });
    const coinThen = host.head().domains.inventory.wallets.party.coin;
    await host.send('Spend.', 'More coin.\n<Changes>\n+ coin 5\n</Changes>');
    assert.equal(host.head().domains.inventory.wallets.party.coin, coinThen + 5);
    const back = await points.returnTo(saved.point.id);
    assert.deepEqual(back, { ok: true, branch: 'chat-1 - Branch #1' });
    assert.equal(host.ctx.chatId, 'chat-1 - Branch #1');
    assert.equal(host.head().domains.inventory.wallets.party.coin, coinThen, 'the story as it was at the save point');
    // In the branch: its copy of the list came from the chat's metadata as it was then (the fake
    // keeps one metadata object, so the entry is seen here too) and it is "here".
    assert.deepEqual(await points.returnTo(saved.point.id), { ok: true, branch: 'chat-1 - Branch #1', here: true });
    assert.equal((await points.returnTo('sp_nothere0')).code, 'NOT_FOUND');
    delete host.st.chats['chat-1 - Branch #1'];
    host.ctx.chatId = 'chat-1';
    const gone = await points.returnTo(saved.point.id);
    assert.equal(gone.code, 'FAILED');
    assert.match(gone.message, /could not be opened \(it may have been renamed or deleted in SillyTavern\)/);
    host.close();
});

test('forget takes an entry off the list only; junk entries are not listed', async () => {
    const { host, st, points } = await played();
    const saved = await points.save({ name: 'Keep' });
    const meta = host.ctx.chatMetadata.storySuite.savePoints;
    meta.junk = { branch: 'x' };
    meta.sp_aaaaaaaa = 'not a record';
    meta.sp_bbbbbbbb = { name: 'no branch' };
    assert.deepEqual(points.list().map(point => point.id), [saved.point.id]);
    assert.deepEqual(await points.forget(saved.point.id), { ok: true });
    assert.equal(Object.hasOwn(meta, saved.point.id), false);
    assert.ok(host.st.chats[st.made[0].name], 'the branch itself is kept');
    assert.equal((await points.forget(saved.point.id)).code, 'NOT_FOUND');
    host.close();
});

test('stCreateBranch: the context\'s createBranch, else bookmarks.js createBranch, else branch and come back', async () => {
    const calls = [];
    assert.equal(await stCreateBranch({ createBranch: index => { calls.push(['ctx', index]); return 'a'; } })(3), 'a');
    assert.equal(await stCreateBranch({}, { importer: async () => ({ createBranch: async index => { calls.push(['import', index]); return 'b'; } }) })(4), 'b');
    // Only a way that opens the branch: the chat the reader was in is opened again.
    const ctx = { chatId: 'main', getCurrentChatId: () => ctx.chatId };
    const made = await stCreateBranch(ctx, {
        importer: async () => { throw new Error('no page'); },
        branch: async index => { calls.push(['branch', index]); ctx.chatId = 'main - Branch #1'; return 'main - Branch #1'; },
        reopen: async name => { calls.push(['reopen', name]); ctx.chatId = name; },
        live: () => ctx,
    })(5);
    assert.equal(made, 'main - Branch #1');
    assert.equal(ctx.chatId, 'main');
    assert.deepEqual(calls, [['ctx', 3], ['import', 4], ['branch', 5], ['reopen', 'main']]);
});

// ---- the Home widget --------------------------------------------------------------------------------

function fakePoints() {
    const list = [];
    const calls = [];
    let here = 'main';
    return {
        calls,
        setHere: name => { here = name; },
        list: () => list.slice(),
        chatId: () => here,
        async save({ name }) {
            calls.push(['save', name]);
            if (name === 'bad') return { ok: false, code: 'FAILED', message: 'nope' };
            const point = { id: `sp_0000000${list.length}`, name: name || `Save point ${list.length + 1}`, index: 4, branch: `main - Branch #${list.length + 1}`, at: new Date(NOW).toISOString(), rev: 3 };
            list.unshift(point);
            return { ok: true, point };
        },
        async returnTo(id) { calls.push(['return', id]); return { ok: true }; },
        async forget(id) { calls.push(['forget', id]); list.splice(list.findIndex(p => p.id === id), 1); return { ok: true }; },
    };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('widget: Save point asks a name, saves on Enter, lists name, reply and date, with Return here', async () => {
    const doc = installDom();
    const el = widgetHost(doc);
    const points = fakePoints();
    const notes = [];
    createSavePointsWidget({ points, notify: text => notes.push(text) }).render(el, {}, {});
    const q = selector => el.querySelector(selector);
    assert.equal(q('.sb-save-none').textContent, 'No save points in this chat yet.');
    q('.sb-save-make').click();
    const name = q('.sb-save-name');
    assert.equal(name.getAttribute('placeholder'), 'Save point 1');
    assert.equal(name.getAttribute('maxlength'), '60');
    name.value = 'At the gate';
    name.dispatch('keydown', { key: 'Enter' });
    await settle();
    assert.deepEqual(points.calls, [['save', 'At the gate']]);
    assert.equal(q('.sb-save-form'), null, 'the name box closes');
    assert.equal(q('.sb-save-status').textContent, 'Saved "At the gate".');
    const row = q('.sb-save-point');
    assert.equal(row.querySelector('.sb-save-label').textContent, 'At the gate');
    assert.match(row.querySelector('.sb-save-when').textContent, /^Message 4 · .+/);
    row.querySelector('.sb-save-return').click();
    await settle();
    assert.deepEqual(points.calls.at(-1), ['return', 'sp_00000000']);
    // In that branch: "You are here" instead of Return here.
    points.setHere('main - Branch #1');
    q('.sb-save-make').click();
    q('.sb-save-cancel').click();
    assert.equal(q('.sb-save-here').textContent, 'You are here');
    assert.equal(q('.sb-save-return'), null);
    // A failure is told in the panel and as a toast.
    q('.sb-save-make').click();
    q('.sb-save-name').value = 'bad';
    q('.sb-save-ok').click();
    await settle();
    assert.equal(q('.sb-save-status').textContent, 'The save point was not made: nope');
    assert.deepEqual(notes, ['The save point was not made: nope']);
    // Forget.
    q('.sb-save-forget').click();
    await settle();
    assert.equal(q('.sb-save-point'), null);
    // Nothing on the page was a story command.
    assert.equal(el.querySelectorAll('[data-command]').length, 0);
});

test('widget: draws nothing while its feature is off, and follows the switch on redraw', () => {
    const doc = installDom();
    const el = widgetHost(doc);
    let on = false;
    const listeners = {};
    const api = { on: (name, fn) => { (listeners[name] ??= new Set()).add(fn); return () => listeners[name].delete(fn); } };
    const handle = createSavePointsWidget({ points: fakePoints(), enabled: () => on }).render(el, {}, api);
    assert.equal(el.children.length, 0);
    on = true;
    for (const fn of listeners.feature) fn();
    assert.ok(el.querySelector('.saves'), 'the reader switched it on');
    on = false;
    handle.update({});
    assert.equal(el.children.length, 0);
    handle.destroy();
    assert.equal(el.children.length, 0);
    assert.equal(listeners.head.size + listeners.feature.size, 0, 'its listeners go with it');
});

test('Home holds the save points slot; the feature is declared on by default, the inspector\'s off', () => {
    assert.match(homeScreen.template, /<ss-widget name="story-block.savepoints" class="saves-slot"><\/ss-widget>/);
    assert.match(homeScreen.css, /\.saves-slot:empty, \.packs-slot:empty \{ display: none; \}/);
    const ours = CORE_FEATURES.filter(f => ['story-block.inspector', 'story-block.savepoints'].includes(f.id));
    assert.deepEqual(ours.map(f => [f.id, f.default]), [['story-block.inspector', false], ['story-block.savepoints', true]]);
    for (const f of ours) assert.ok(f.label && f.describe, f.id);
    assert.equal(savedAt('not a date'), '');
    assert.ok(savedAt(new Date(NOW).toISOString(), 'en-GB').includes('2026'));
});
