// The page side of the inspector and the save points (ui-host.js): features gate the screens (the
// Inspector is off until the reader turns it on; save points are on), the host's own widgets are there
// for templates, the Inspector lists a reply's problems; and the status strip's scroll cue on a phone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeContext } from '../../../testkit/fake-st.js';
import { createRuntime } from '../../../src/v2/runtime.js';
import { mountUi } from '../../../src/v2/ui-host.js';
import { createHudMount } from '../../../src/v2/view/mounts/index.js';
import { readFileSync } from 'node:fs';
import { fakeRenderer, screen, screensWith, setupDom } from '../view/mounts/helpers.js';

const read = path => readFileSync(new URL(`../../../src/v2/${path}`, import.meta.url), 'utf8');

// `features`: the reader's stored switches (extension_settings.storySuite.features).
function setup({ features = null } = {}) {
    const doc = setupDom();
    const st = createFakeContext({ extensionSettings: features ? { storySuite: { features } } : {} });
    const runtime = createRuntime({ ctx: st.ctx });
    const ui = mountUi({ runtime, ctx: st.ctx, doc });
    runtime.markReady();
    return { doc, st, ui, runtime };
}

const listed = (ui, mount) => ui.screens.list(mount).map(entry => entry.id);

test('the Inspector is a feature, off by default: no screen, no tab; save points on', async t => {
    t.mock.method(console, 'warn', () => {});
    const { ui, runtime } = setup();
    assert.equal(runtime.registry.featureOn('story-block.inspector'), false);
    assert.equal(runtime.registry.featureOn('story-block.savepoints'), true);
    assert.ok(!listed(ui, 'screen').includes('story-block/inspector'));
    assert.ok(!listed(ui, 'tab').includes('story-block/inspector'));
    assert.ok(listed(ui, 'screen').includes('story-block/home'));
    assert.equal(runtime.registry.feature('story-block.inspector').label, 'State inspector');
});

test('the reader turns the Inspector on: a screen and a tab; save points off: Home draws no panel', async t => {
    t.mock.method(console, 'warn', () => {});
    const home = async features => {
        const { doc, ui, runtime } = setup({ features });
        await runtime.turn.onChatChanged();
        const el = doc.createElement('div');
        doc.body.appendChild(el);
        ui.mounts.screen.mount(el, 'story-block/home');
        return { el, ui };
    };
    const off = await home({ 'story-block.inspector': true, 'story-block.savepoints': false });
    assert.ok(listed(off.ui, 'screen').includes('story-block/inspector'));
    assert.ok(listed(off.ui, 'tab').includes('story-block/inspector'));
    assert.equal(off.el.querySelectorAll('.saves').length, 0);
    assert.ok(off.el.querySelector('.saves-slot'), 'the slot is there, empty');
    const on = await home(null);
    assert.equal(on.el.querySelectorAll('.saves').length, 1, 'on by default');
    assert.ok(on.el.querySelector('.sb-save-make'));
});

test('the host widgets draw in a screen: the Inspector over this chat\'s replies, with their problems', async t => {
    t.mock.method(console, 'warn', () => {});
    const { doc, st, ui, runtime } = setup({ features: { 'story-block.inspector': true } });
    await runtime.turn.onChatChanged();
    runtime.turn.install({ globalName: null });
    st.interceptor = runtime.turn.interceptor;
    await st.send('Look.', { reply: 'Rope.\n<Changes>\n+ item Rope\n+ nonsense line here\n</Changes>' });
    const reply = st.ctx.chat.length - 1;
    const problems = ui.inspector.reply(reply).problems;
    assert.ok(problems.length >= 1, 'the line the code did not use');
    assert.ok(problems.some(p => p.message.includes('nonsense line here')), JSON.stringify(problems));
    const el = doc.createElement('div');
    doc.body.appendChild(el);
    ui.mounts.tab.mount(el, 'story-block/inspector');
    assert.ok(el.querySelector('.sb-insp'), 'the Inspector widget drew');
    assert.equal(el.querySelector('.sb-insp-pick').value, String(reply));
    assert.deepEqual(ui.savePoints.list(), []);
    runtime.turn.uninstall({ globalName: null });
});

test('hud: the strip marks the side with more to scroll to, follows scrolling, and lets go when hidden', () => {
    const doc = setupDom();
    const sheld = doc.createElement('div');
    const form = doc.createElement('form');
    form.id = 'send_form';
    sheld.appendChild(form);
    doc.body.appendChild(sheld);
    const listeners = {};
    const hud = createHudMount({
        screens: screensWith([screen('m/a', ['hud']), screen('m/b', ['hud'])]),
        render: fakeRenderer(),
        query: () => null,
        stateAt: () => ({ v: 2, meta: { rev: 1 }, domains: {} }),
        headIndex: () => 0,
        on: (name, fn) => { (listeners[name] ??= []).push(fn); return () => {}; },
        document: doc,
    });
    const strip = hud.show();
    assert.equal(strip.getAttribute('data-ss-more'), 'none', 'it all fits');
    // A phone: the strip is wider than the screen.
    Object.assign(strip, { scrollWidth: 520, clientWidth: 360, scrollLeft: 0 });
    hud.update();
    assert.equal(strip.getAttribute('data-ss-more'), 'end');
    assert.equal(strip.getAttribute('data-ss-axis'), 'x');
    strip.scrollLeft = 80;
    strip.dispatch('scroll');
    assert.equal(strip.getAttribute('data-ss-more'), 'both');
    hud.hide();
    assert.equal(sheld.querySelector('.ss-hud'), null);
    const css = read('view/mounts.css');
    for (const side of ['end', 'start', 'both']) assert.match(css, new RegExp(`\\.ss-hud\\[data-ss-more="${side}"\\] \\{[^}]*mask-image`), side);
});
