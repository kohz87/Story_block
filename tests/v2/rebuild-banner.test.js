// Home's rebuild banner (screens/rebuild-banner.js): hidden while retrying, the approved permanent-block words, the
// two-choice confirmation with the last 40 replies checked, progress, the done note (specific to what was read), a
// failed attempt whose button is usable again, and dismissal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './view/mounts/helpers.js';
import { STRINGS } from '../../src/v2/strings.js';
import { homeScreen } from '../../src/v2/screens/home.js';
import { createInspectorWidget } from '../../src/v2/screens/inspector.js';
import { createTimeline } from '../../src/v2/timeline/index.js';
import { host as widgetHost, installDom, fakeApi } from './view/widgets/fake-dom.js';
import {
    createRebuildBannerWidget, rebuildTarget, REBUILD_BANNER_WIDGET, REBUILD_READ_ALL, REBUILD_READ_LAST, REBUILD_TEXT,
} from '../../src/v2/screens/rebuild-banner.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const text = node => node.textContent.replace(/\s+/g, ' ').trim();
const block = (code = 'SNAPSHOT_UNAVAILABLE', module = 'npc-state-delta') => ({ reason: 'missing', code, blockedBy: { module, code } });

function mount(options = {}) {
    const doc = setupDom();
    const host = doc.createElement('div');
    doc.body.append(host);
    const widget = createRebuildBannerWidget(options);
    const handle = widget.render(host, {}, {});
    return { doc, host, handle };
}

test('the widget name, its permanent gate, and the hidden states', async () => {
    assert.equal(REBUILD_BANNER_WIDGET, 'story-block.rebuild-banner');
    assert.deepEqual(rebuildTarget(block()), { module: 'npc-state-delta', code: 'SNAPSHOT_UNAVAILABLE' });
    assert.deepEqual(rebuildTarget(block('CONFLICT')), { module: 'npc-state-delta', code: 'CONFLICT' });
    assert.deepEqual(rebuildTarget(block('DEPENDENCY_UNAVAILABLE')), { module: 'npc-state-delta', code: 'DEPENDENCY_UNAVAILABLE' });
    assert.equal(rebuildTarget(block('FAILED')), null);
    assert.equal(rebuildTarget(null), null);
    for (const blocked of [null, block('FAILED'), { reason: 'wait', code: 'STALE', blockedBy: { module: 'npc-state-delta', code: 'STALE' } }]) {
        const { host } = mount({ blocked: () => blocked, last: () => null });
        await tick();
        assert.equal(host.children.length, 0, 'a retrying or free chat has no banner');
    }
});

test('the permanent block shows the mockup words and its primary button', async () => {
    const { host } = mount({ blocked: () => block() });
    await tick();
    const banner = host.querySelector('.rebuild-banner');
    assert.ok(banner);
    assert.equal(text(banner.querySelector('.rebuild-title')), REBUILD_TEXT.title);
    assert.equal(text(banner.querySelector('.rebuild-body')), REBUILD_TEXT.body);
    const start = banner.querySelector('.rebuild-start');
    assert.equal(text(start), REBUILD_TEXT.start);
    assert.equal(start.type, 'button');
    assert.equal(text(banner.querySelector('.rebuild-muted')), REBUILD_TEXT.muted);
});

test('the confirmation has the exact words, the 40-reply default, and Cancel returns to the banner without a call', async () => {
    const calls = [];
    const { host } = mount({ blocked: () => block(), rebuild: async (module, choice) => { calls.push([module, choice]); return { ok: true }; } });
    await tick();
    host.querySelector('.rebuild-start').click();
    const dialog = host.querySelector('.rebuild-dialog');
    assert.ok(dialog);
    assert.equal(dialog.getAttribute('role'), 'dialog');
    assert.equal(text(dialog.querySelector('h4')), REBUILD_TEXT.dialogTitle);
    assert.equal(text(dialog.querySelector('p')), REBUILD_TEXT.dialogBody);
    const radios = dialog.querySelectorAll('input');
    assert.equal(radios.length, 2);
    assert.equal(radios[0].value, REBUILD_READ_LAST);
    assert.equal(radios[0].checked, true);
    assert.equal(radios[1].value, REBUILD_READ_ALL);
    assert.equal(radios[1].checked, false);
    assert.match(text(dialog), /Read the last 40 replies \(faster\)/);
    assert.match(text(dialog), /Read the whole chat/);
    assert.match(text(dialog), /This uses model calls, about one per reply read\./);
    assert.equal(text(dialog.querySelector('.rebuild-confirm')), REBUILD_TEXT.confirm);
    assert.equal(text(dialog.querySelector('.rebuild-cancel')), REBUILD_TEXT.cancel);
    dialog.querySelector('.rebuild-cancel').click();
    await tick();
    assert.equal(calls.length, 0, 'Cancel starts nothing');
    assert.ok(host.querySelector('.rebuild-banner'), 'the banner is back');
});

test('working shows the spinner and reply 12 of 40, then the last-40 done note and its dismissal', async () => {
    let finish;
    let held = block();
    const { host, handle } = mount({
        blocked: () => held,
        progress: () => ({ reply: 12, total: 40 }),
        rebuild: () => new Promise(resolve => { finish = resolve; }),
    });
    await tick();
    host.querySelector('.rebuild-start').click();
    host.querySelector('.rebuild-confirm').click();
    await tick();
    const working = host.querySelector('.rebuild-banner');
    assert.ok(working.querySelector('.spin'));
    assert.equal(text(working.querySelector('.rebuild-title')), REBUILD_TEXT.workingTitle);
    assert.equal(text(working.querySelector('.rebuild-progress')), 'Reading reply 12 of 40. Replies resume when it finishes.');
    const disabled = working.querySelector('.rebuild-working');
    assert.equal(text(disabled), REBUILD_TEXT.working);
    assert.equal(disabled.disabled, true);
    held = null;
    finish({ ok: true, read: REBUILD_READ_LAST, reply: 12 });
    await tick();
    const note = host.querySelector('.rebuild-note');
    assert.equal(text(note.querySelector('.rebuild-note-text')), REBUILD_TEXT.doneLast);
    assert.equal(note.querySelectorAll('button').length, 1, 'the note has its dismiss button');
    note.querySelector('.rebuild-dismiss').click();
    await tick();
    assert.equal(host.children.length, 0);
    handle.update();
    await tick();
    assert.equal(host.children.length, 0, 'the dismissed note stays gone');
});

test('choosing the whole chat passes read all and the done note names it', async () => {
    const calls = [];
    const { host } = mount({
        blocked: () => block(),
        rebuild: async (module, choice) => { calls.push([module, choice]); return { ok: true, read: REBUILD_READ_ALL }; },
    });
    await tick();
    host.querySelector('.rebuild-start').click();
    const radios = host.querySelectorAll('.rebuild-dialog input');
    radios[1].checked = true;
    radios[0].checked = false;
    radios[1].click();
    host.querySelector('.rebuild-confirm').click();
    await tick();
    assert.deepEqual(calls, [['npc-state-delta', { read: REBUILD_READ_ALL }]]);
    assert.equal(text(host.querySelector('.rebuild-note-text')), REBUILD_TEXT.doneAll);
});

test('a failed attempt shows the reason and leaves the button usable for a retry', async () => {
    let attempts = 0;
    const { host } = mount({
        blocked: () => block(),
        rebuild: async () => {
            attempts += 1;
            return attempts === 1 ? { ok: false, code: 'FAILED', message: 'the scan failed' } : { ok: true };
        },
    });
    await tick();
    host.querySelector('.rebuild-start').click();
    host.querySelector('.rebuild-confirm').click();
    await tick();
    const failed = host.querySelector('.rebuild-banner');
    assert.equal(text(failed.querySelector('.rebuild-body')), 'the scan failed');
    assert.notEqual(failed.querySelector('.rebuild-start').disabled, true);
    failed.querySelector('.rebuild-start').click();
    host.querySelector('.rebuild-confirm').click();
    await tick();
    assert.equal(attempts, 2);
    assert.ok(host.querySelector('.rebuild-note'));
});

test('a result already recorded is drawn as the done note; destroy removes the widget and its subscriptions', async () => {
    const drawn = [];
    const { host, handle } = mount({ blocked: () => null, last: () => ({ module: 'npc-state-delta', read: REBUILD_READ_ALL, reply: 9 }) });
    await tick();
    assert.equal(text(host.querySelector('.rebuild-note-text')), REBUILD_TEXT.doneAll);
    const api = { on: (name, fn) => { drawn.push(name); return () => drawn.push(`off:${name}`); } };
    const other = createRebuildBannerWidget({ blocked: () => block() });
    const doc = host.ownerDocument;
    const second = doc.createElement('div');
    other.render(second, {}, api);
    await tick();
    assert.ok(drawn.includes('head'));
    handle.destroy();
    assert.equal(host.children.length, 0);
});

test('the note and a late rebuild result do not appear in another chat', async () => {
    const a = {}, b = {};
    let current = a, finish;
    const { host, handle } = mount({
        scope: () => current,
        blocked: () => current === a ? block() : null,
        rebuild: () => new Promise(resolve => { finish = resolve; }),
    });
    await tick();
    host.querySelector('.rebuild-start').click();
    host.querySelector('.rebuild-confirm').click();
    current = b;
    handle.update();
    await tick();
    finish({ ok: true, read: REBUILD_READ_LAST });
    await tick();
    assert.equal(host.querySelector('.rebuild-note'), null);
    current = a;
    handle.update();
    await tick();
    assert.ok(host.querySelector('.rebuild-start'));
    host.querySelector('.rebuild-start').click();
    host.querySelector('.rebuild-confirm').click();
    finish({ ok: true, read: REBUILD_READ_LAST });
    await tick();
    assert.ok(host.querySelector('.rebuild-note'));
    current = b;
    handle.update();
    await tick();
    assert.equal(host.querySelector('.rebuild-note'), null);
});

test('a module lifecycle event redraws the permanent-block banner', async () => {
    const doc = setupDom(), host = doc.createElement('div'), handlers = {};
    let held = null;
    createRebuildBannerWidget({ blocked: () => held }).render(host, {}, { on: (name, fn) => { handlers[name] = fn; } });
    await tick();
    assert.equal(host.children.length, 0);
    held = block();
    handlers.modules();
    await tick();
    assert.ok(host.querySelector('.rebuild-start'));
});

// ---- Step 2: strings, Home, the Inspector's Problem row, the timeline's host command ------------------

test('the words live in strings/screens.js and match the approved mockup', () => {
    assert.equal(REBUILD_TEXT, STRINGS.rebuild);
    assert.equal(STRINGS.rebuild.rowTitle, "Dossiers can't be restored here");
    assert.equal(STRINGS.rebuild.dialogMuted, 'This uses model calls, about one per reply read.');
    assert.equal(Object.isFrozen(STRINGS.rebuild), true);
});

test('Home mounts the banner slot above "Before you start", and the slot hides while empty', () => {
    const a = homeScreen.template.indexOf('name="story-block.rebuild-banner" class="rebuild-slot"');
    const b = homeScreen.template.indexOf('name="story-block.ready-hint"');
    assert.ok(a > 0 && a < b);
    assert.match(homeScreen.css, /\.rebuild-slot:empty \{ display: none; \}/);
});

function inspectorWith(held, problems, calls = []) {
    const doc = installDom();
    const source = {
        memory: { index: null, search: '', open: new Set() }, replies: () => [{ index: 1, name: 'Ren', rev: 2, head: true, snippet: 'x' }], headIndex: () => 1,
        reply: () => ({ ok: true, index: 1, name: 'Ren', rev: 2, checkpoint: false, diff: { entries: [], more: 0 }, ops: [], receipts: [], problems, state: { meta: { rev: 2 } } }),
    };
    const banner = createRebuildBannerWidget({ blocked: () => held, rebuild: async (module, choice) => { calls.push([module, choice]); return { ok: true, read: choice.read, reply: 4 }; } });
    const widget = createInspectorWidget(source, { rebuild: { widget: banner, blocked: () => held, nameOf: () => 'NPC State Delta' } });
    const el = widgetHost(doc);
    widget.render(el, {}, fakeApi());
    return { el, calls };
}

test('the Inspector Problem row has the button while the block is permanent: its own row when no reply row carries it, then the same confirmation', async () => {
    const { el, calls } = inspectorWith(block(), []);
    const row = el.querySelector('.sb-insp-problems li');
    assert.ok(row, 'the block has a row even with no reply problems');
    assert.equal(text(row.querySelector('.ss-listcard-title')), "Dossiers can't be restored here");
    assert.equal(text(row.querySelector('.ss-listcard-sub')), 'SNAPSHOT_UNAVAILABLE · NPC State Delta');
    const button = row.querySelector('.sb-insp-rebuild');
    assert.equal(text(button), REBUILD_TEXT.start);
    button.click();
    await tick();
    const dialog = row.querySelector('.rebuild-dialog');
    assert.ok(dialog, 'the same confirmation opens in the row');
    assert.equal(dialog.querySelectorAll('input')[0].checked, true);
    dialog.querySelector('.rebuild-confirm').click();
    await tick();
    assert.deepEqual(calls, [['npc-state-delta', { read: REBUILD_READ_LAST }]]);
    assert.ok(row.querySelector('.rebuild-note'));
});

test('Cancel in the Inspector restores the Problem-row button', async () => {
    const { el, calls } = inspectorWith(block(), []);
    const button = el.querySelector('.sb-insp-rebuild');
    button.click();
    await tick();
    el.querySelector('.rebuild-cancel').click();
    assert.equal(button.hidden, false);
    assert.equal(el.querySelector('.rebuild-dialog'), null);
    button.click();
    await tick();
    assert.ok(el.querySelector('.rebuild-dialog'));
    assert.deepEqual(calls, []);
});

test('the button goes on the reply row that carries the cause (once); a retrying or free chat has none', () => {
    const rows = [{ code: 'SNAPSHOT_UNAVAILABLE', message: 'file missing' }, { code: 'SNAPSHOT_UNAVAILABLE', message: 'again' }, { code: 'REFUSED', message: 'x' }];
    const { el } = inspectorWith(block(), rows);
    assert.equal(el.querySelectorAll('.sb-insp-problems li').length, 3);
    assert.equal(el.querySelectorAll('.sb-insp-rebuild').length, 1);
    assert.ok(el.querySelectorAll('.sb-insp-problems li')[0].querySelector('.sb-insp-rebuild'));
    for (const held of [null, block('FAILED')]) {
        const none = inspectorWith(held, [{ code: 'SNAPSHOT_UNAVAILABLE', message: 'file missing' }]);
        assert.equal(none.el.querySelectorAll('.sb-insp-rebuild').length, 0);
    }
});

test('createTimeline: host.rebuild and blocked() are wired; the host command refuses with no block, and the public api has no rebuild', async () => {
    const meta = {};
    const timeline = createTimeline({
        store: { flush: async () => {}, touch() {}, receipts: () => [], state: () => null }, registry: { restore: () => ({ state: 'idle' }), setRestore() {}, module: () => null },
        metadata: () => meta, chat: () => [],
    });
    assert.equal(typeof timeline.host.rebuild, 'function');
    assert.equal(timeline.api.rebuild, undefined, 'a module cannot call it');
    assert.equal(timeline.blocked(), null);
    const answer = await timeline.host.rebuild('npc-state-delta', { read: 'last-40' });
    assert.equal(answer.ok, false);
    assert.ok(['REFUSED', 'FAILED'].includes(answer.code));
});
