// The state inspector (MODULES §F92): its data over a real host (src/v2/inspect.js) and the read-only
// Inspector widget (src/v2/screens/inspector.js): a reply's state as a folding tree with a search, what
// changed since the reply before, its receipts and problems. Nothing it does writes anything.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { createInspectorSource, diffStates, inspectReply, matchPaths, pointer, preview, replyList } from '../../src/v2/inspect.js';
import { createInspectorWidget, drawTree, inspectorScreen } from '../../src/v2/screens/inspector.js';
import { validateScreen } from '../../src/v2/view/screens.js';
import { host as widgetHost, installDom } from './view/widgets/fake-dom.js';

async function played() {
    const host = await createHost();
    await host.send('Look around.', 'You find rope.\n<Changes>\n+ item Rope\n</Changes>');
    await host.send('Go on.', 'Two coins glint.\n<Changes>\n+ coin 2\n+ item Lantern\n</Changes>');
    await host.send('Rest.', 'Nothing happens.');
    return host;
}

test('pointer, preview: JSON Pointers escaped, values on one line and cut', () => {
    assert.equal(pointer('', 'domains'), '/domains');
    assert.equal(pointer('/a', 'b/c~d'), '/a/b~1c~0d');
    assert.equal(preview('a\nb'), '"a\\nb"');
    assert.equal(preview({ a: 1, b: 2 }), '{2 keys}');
    assert.equal(preview({ a: 1 }), '{1 key}');
    assert.equal(preview([1]), '[1 item]');
    assert.equal(preview([]), '[0 items]');
    assert.equal(preview(undefined), '—');
    assert.equal(preview(null), 'null');
    const long = preview('x'.repeat(500));
    assert.equal(long.length, 120);
    assert.ok(long.endsWith('…'));
});

test('diffStates: adds, removes and changes path by path; lists by element; capped with a count', () => {
    const before = { meta: { rev: 1 }, domains: { inv: { stacks: { a: { qty: 1 } }, tags: ['x'] }, gone: { k: 1 } } };
    const after = { meta: { rev: 3 }, domains: { inv: { stacks: { a: { qty: 4 }, b: { qty: 1, name: 'Rope' } }, tags: ['x', 'y'] } } };
    const { entries, more } = diffStates(before, after);
    assert.equal(more, 0);
    assert.deepEqual(entries.map(e => [e.kind, e.path]), [
        ['change', '/meta/rev'],
        ['change', '/domains/inv/stacks/a/qty'],
        ['add', '/domains/inv/stacks/b'],
        ['add', '/domains/inv/tags/1'],
        ['remove', '/domains/gone'],
    ]);
    assert.deepEqual(entries[1], { kind: 'change', path: '/domains/inv/stacks/a/qty', before: 1, after: 4 });
    assert.deepEqual(diffStates({ a: 1 }, { a: 1 }), { entries: [], more: 0 });
    assert.deepEqual(diffStates(null, { a: 1 }).entries, [{ kind: 'add', path: '', before: undefined, after: { a: 1 } }], 'the first reply: all of it is new');
    assert.deepEqual(diffStates({ a: [1, 2] }, { a: { x: 1 } }).entries.map(e => e.kind), ['change'], 'a list that became an object is one change');
    const wide = diffStates({}, Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, i])), { limit: 4 });
    assert.equal(wide.entries.length, 4);
    assert.equal(wide.more, 6);
});

test('matchPaths: keys and values, any case; the way to each hit; capped', () => {
    const state = { domains: { inventory: { stacks: { it_1: { name: 'Rope', qty: 3 }, it_2: { name: 'Lantern', qty: 1 } } }, scene: { place: { name: 'Bluewatch' } } } };
    const found = matchPaths(state, 'ROPE');
    assert.deepEqual([...found.matches], ['/domains/inventory/stacks/it_1/name']);
    assert.deepEqual([...found.ways], ['', '/domains', '/domains/inventory', '/domains/inventory/stacks', '/domains/inventory/stacks/it_1']);
    assert.equal(found.count, 1);
    assert.deepEqual([...matchPaths(state, 'qty').matches], ['/domains/inventory/stacks/it_1/qty', '/domains/inventory/stacks/it_2/qty'], 'keys match too');
    assert.deepEqual([...matchPaths(state, '3').matches], ['/domains/inventory/stacks/it_1/qty'], 'numbers as text');
    assert.equal(matchPaths(state, '  ').count, 0, 'an empty search finds nothing');
    const capped = matchPaths(state, 'a', { limit: 2 });
    assert.equal(capped.count, 2);
    assert.equal(capped.capped, true);
});

test('replyList: the replies that keep the story, newest first, with the head marked', async () => {
    const host = await played();
    const list = replyList(host.ctx.chat, { head: host.store.headIndex() });
    assert.deepEqual(list.map(r => r.index), [6, 4, 2, 0]);
    assert.equal(list[0].head, true);
    assert.ok(list.slice(1).every(r => !r.head));
    assert.equal(list.at(-1).checkpoint, true, 'the greeting holds the start');
    assert.equal(list[2].receipts, 1);
    assert.equal(list[2].snippet, 'You find rope.', 'the hidden change block is left out');
    assert.ok(list.every(r => Number.isInteger(r.rev)));
    assert.deepEqual(replyList(null), []);
    host.close();
});

test('inspectReply: an older reply\'s own state, what it changed, its receipts and problems; nothing written', async () => {
    const host = await played();
    const chat = structuredClone(host.ctx.chat);
    const seen = [];
    const view = inspectReply({ store: host.store, chat: host.ctx.chat, index: 2, problems: index => { seen.push(index); return [{ code: 'TEST', message: 'a\nproblem' }]; } });
    assert.equal(view.ok, true);
    assert.equal(view.index, 2);
    assert.equal(view.head, false);
    assert.deepEqual(view.state, host.store.at(2));
    assert.deepEqual(view.before, host.store.at(0));
    const added = view.diff.entries.filter(e => e.kind === 'add' && e.path.startsWith('/domains/inventory/stacks/'));
    assert.equal(added.length, 1, 'the Rope came in this reply');
    assert.equal(added[0].after.def, 'story/rope');
    assert.ok(view.diff.entries.some(e => e.path === '/meta/rev'));
    assert.ok(!view.diff.entries.some(e => e.path.includes('Lantern')), 'the later reply\'s Lantern is not here');
    assert.deepEqual(view.receipts.map(r => [r.type, r.cause]), [['capture.item', 'story']]);
    assert.ok(view.receipts[0].summary.includes('Rope'));
    assert.ok(view.ops.length > 0);
    assert.deepEqual(view.problems, [{ code: 'TEST', message: 'a problem' }]);
    assert.deepEqual(seen, [2]);
    // The head reply, and messages that hold no story.
    assert.equal(inspectReply({ store: host.store, chat: host.ctx.chat, index: 6 }).head, true);
    assert.equal(inspectReply({ store: host.store, chat: host.ctx.chat, index: 6 }).diff.entries.length, 0, 'nothing changed in a quiet reply');
    for (const index of [1, 99, -1, 'x']) assert.equal(inspectReply({ store: host.store, chat: host.ctx.chat, index }).ok, false, `message ${index}`);
    // A problems() that throws is no problem.
    assert.deepEqual(inspectReply({ store: host.store, chat: host.ctx.chat, index: 4, problems: () => { throw new Error('x'); } }).problems, []);
    assert.deepEqual(host.ctx.chat, chat, 'read-only');
    host.close();
});

test('the Inspector screen: valid, read-only (no commands), tab and game view, its feature named', () => {
    assert.deepEqual(validateScreen(inspectorScreen, { id: inspectorScreen.id }), []);
    assert.equal(inspectorScreen.feature, 'story-block.inspector');
    assert.doesNotMatch(inspectorScreen.template, /data-command|data-submit/);
    assert.match(inspectorScreen.template, /<ss-widget name="story-block.inspector"><\/ss-widget>/);
});

// ---- the widget ----------------------------------------------------------------------------------

function fakeEvents() {
    const listeners = {};
    return {
        on(name, fn) {
            (listeners[name] ??= new Set()).add(fn);
            return () => listeners[name].delete(fn);
        },
        emit(name) { for (const fn of listeners[name] ?? []) fn(); },
        count: () => Object.values(listeners).reduce((n, set) => n + set.size, 0),
    };
}

async function drawn() {
    const host = await played();
    const doc = installDom();
    const el = widgetHost(doc);
    const source = createInspectorSource({ store: host.store, chat: () => host.ctx.chat, chatId: () => host.ctx.chatId });
    const events = fakeEvents();
    const handle = createInspectorWidget(source).render(el, {}, { on: events.on });
    const q = selector => el.querySelector(selector);
    const all = selector => el.querySelectorAll(selector);
    return { host, doc, el, source, events, handle, q, all };
}

test('widget: the newest reply first; pick an older one; its changes, receipts and state', async () => {
    const { host, el, source, events, handle, q, all } = await drawn();
    const options = all('option');
    assert.deepEqual(options.map(o => o.getAttribute('value')), ['6', '4', '2', '0']);
    assert.match(options[0].textContent, /^Message 6 · Narrator · rev \d+ \(now\)$/);
    assert.equal(q('.sb-insp-pick').value, '6');
    assert.ok(q('.sb-insp-newer').disabled && q('.sb-insp-latest').disabled);
    assert.equal(q('.sb-insp-changes .sb-insp-empty').textContent, 'Nothing changed in this reply.');
    assert.equal(q('.sb-insp-receipts-box .sb-insp-empty').textContent, 'No receipts on this reply.');

    // The reply with the coin and the lantern.
    const picker = q('.sb-insp-pick');
    picker.value = '4';
    picker.dispatch('change');
    assert.equal(source.memory.index, 4);
    const paths = all('.sb-insp-diff li').map(li => li.getAttribute('data-path'));
    assert.ok(paths.includes('/meta/rev'));
    assert.ok(paths.some(path => path.startsWith('/domains/inventory/stacks/')));
    assert.ok(paths.some(path => path.startsWith('/domains/inventory/wallets/')));
    assert.equal(all('.sb-insp-receipts li').length, 2);
    const metas = all('.sb-insp-receipts .sb-insp-meta').map(node => node.textContent);
    assert.ok(metas.every(text => /^capture\.\w+ · story-block · story · rev \d+( · not told)?$/.test(text)), metas.join(' | '));
    assert.match(q('.sb-insp-ops-box summary').textContent, /^Ops \(\d+\)$/);
    assert.ok(all('.sb-insp-ops li').length > 0);
    assert.equal(q('.sb-insp-problems-box .sb-insp-empty').textContent, 'No problems with this reply.');
    // Older and Newer step through; Latest follows the story again.
    q('.sb-insp-older').click();
    assert.equal(q('.sb-insp-pick').value, '2');
    q('.sb-insp-newer').click();
    assert.equal(q('.sb-insp-pick').value, '4');
    q('.sb-insp-latest').click();
    assert.equal(source.memory.index, null);
    assert.equal(q('.sb-insp-pick').value, '6');

    // Text comes in as text: no element was made from a reply's words.
    assert.ok(el.querySelectorAll('script').length === 0);
    handle.destroy();
    assert.equal(events.count(), 0, 'its listeners go with it');
    host.close();
});

test('widget: the tree folds, draws an object\'s insides when first opened, and remembers what is open', async () => {
    const { host, el, source, handle, q } = await drawn();
    const domains = q('details[data-path="/domains"]');
    assert.ok(domains.hasAttribute('open'), 'the domains start open');
    const inventory = q('details[data-path="/domains/inventory"]');
    assert.ok(!inventory.hasAttribute('open'));
    assert.equal(inventory.querySelector('.sb-insp-kids').children.length, 0, 'not drawn until opened');
    inventory.setAttribute('open', '');
    inventory.dispatch('toggle');
    assert.ok(inventory.querySelector('details[data-path="/domains/inventory/stacks"]'));
    assert.ok(source.memory.open.has('/domains/inventory'));
    // A redraw (a new reply) keeps it open.
    handle.update({});
    assert.ok(q('details[data-path="/domains/inventory"]').hasAttribute('open'));
    const shut = q('details[data-path="/domains/inventory"]');
    shut.removeAttribute('open');
    shut.dispatch('toggle');
    assert.ok(!source.memory.open.has('/domains/inventory'));
    const meta = q('details[data-path="/meta"]');
    assert.equal(el.querySelector('.sb-insp-leaf[data-path="/meta/rev"]'), null);
    meta.setAttribute('open', '');
    meta.dispatch('toggle');
    assert.equal(el.querySelector('.sb-insp-leaf[data-path="/meta/rev"] .sb-insp-num').textContent, String(host.store.head().meta.rev));
    host.close();
});

test('widget: the search draws only the hits and the way to them, opened; a hit object opens whole', async () => {
    const { host, el, source, q, all } = await drawn();
    const box = q('.sb-insp-search');
    box.value = 'Lantern';
    box.dispatch('input');
    assert.equal(source.memory.search, 'Lantern');
    // The definition's name, its id (a key and a value), its stack's def, and the alias (key and value).
    assert.equal(q('.sb-insp-count').textContent, '6 found');
    const leaf = q('.sb-insp-leaf[data-path="/domains/inventory/defs/story~1lantern/name"]');
    assert.ok(leaf.classList.contains('sb-insp-hit'));
    assert.equal(leaf.querySelector('.sb-insp-str').textContent, '"Lantern"');
    assert.equal(all('details[data-path="/domains/scene"]').length, 0, 'the rest is left out');
    assert.equal(all('details[data-path="/domains/inventory/defs/story~1rope"]').length, 0);
    assert.ok(q('details[data-path="/domains/inventory/defs"]').hasAttribute('open'));
    // An object that is a hit (its key) stays shut and shows all of itself when opened.
    box.value = 'stacks';
    box.dispatch('input');
    const stacks = q('details[data-path="/domains/inventory/stacks"]');
    assert.ok(stacks.classList.contains('sb-insp-hit'));
    assert.ok(!stacks.hasAttribute('open'));
    stacks.setAttribute('open', '');
    stacks.dispatch('toggle');
    assert.equal(stacks.querySelector('.sb-insp-kids').children.length, 2, 'both stacks');
    box.value = 'nothing-like-this';
    box.dispatch('input');
    assert.equal(q('.sb-insp-count').textContent, 'Nothing found.');
    assert.equal(q('.sb-insp-tree').children.length, 0);
    box.value = '';
    box.dispatch('input');
    assert.equal(q('.sb-insp-count'), null);
    assert.ok(el.querySelector('details[data-path="/domains/scene"]'));
    host.close();
});

test('widget: a new reply moves "latest" along; a picked reply stays picked; another chat starts over', async () => {
    const { host, events, source, q } = await drawn();
    await host.send('More.', 'A key.\n<Changes>\n+ item Key\n</Changes>');
    events.emit('head');
    assert.equal(q('.sb-insp-pick').value, '8', 'following the story');
    q('.sb-insp-older').click();
    assert.equal(source.memory.index, 6);
    await host.send('More.', 'Quiet.');
    events.emit('turn');
    assert.equal(q('.sb-insp-pick').value, '6', 'a picked reply stays picked');
    host.ctx.chatId = 'another-chat';
    events.emit('head');
    assert.equal(source.memory.index, null);
    assert.equal(q('.sb-insp-pick').value, '10');
    host.close();
});

test('widget: a chat with no story yet says so; drawTree caps wide objects and cuts long text', () => {
    const doc = installDom();
    const el = widgetHost(doc);
    const source = { memory: { index: null, search: '', open: new Set() }, replies: () => [], reply: () => null, headIndex: () => -1 };
    createInspectorWidget(source).render(el, {}, {});
    assert.equal(el.querySelector('.sb-insp-empty').textContent, 'This chat has no story state yet.');
    assert.ok(el.querySelector('.sb-insp-pick').disabled);
    const box = doc.createElement('div');
    const wide = Object.fromEntries(Array.from({ length: 205 }, (_, i) => [`k${i}`, i]));
    drawTree(box, { wide, long: 'y'.repeat(400), empty: {} }, { doc, open: new Set(['/wide', '/empty']), search: null });
    assert.equal(box.querySelectorAll('details[data-path="/wide"] .sb-insp-leaf').length, 201, '200 and "…and 5 more"');
    assert.equal(box.querySelector('details[data-path="/wide"] .sb-insp-kids').children.at(-1).textContent, '…and 5 more');
    assert.equal(box.querySelector('.sb-insp-leaf[data-path="/long"] .sb-insp-str').textContent.length, 303, '300 characters, the quotes and …');
    assert.equal(box.querySelector('details[data-path="/empty"] .sb-insp-leaf').textContent, '{}');
});

test('widget: while its feature is off it draws nothing, wherever a screen names it (B-rxui-11)', () => {
    const doc = installDom();
    const el = widgetHost(doc);
    let asked = 0;
    const source = { memory: { index: null, search: '', open: new Set() }, replies: () => { asked += 1; return []; }, reply: () => null, headIndex: () => -1 };
    const handle = createInspectorWidget(source, { enabled: () => false }).render(el, {}, {});
    assert.equal(el.children.length, 0);
    assert.ok(el.hidden);
    assert.equal(asked, 0, 'not even the reply list is read');
    handle.update({});
    handle.destroy();
    assert.equal(el.children.length, 0);
});
