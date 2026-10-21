// index.js, the v2 bootstrap, on the testkit's fake SillyTavern and the fake DOM: the global host,
// the interceptor named in manifest.json, the bar above the message box, the story panel with the core
// tabs, a module's layout screen with a standard widget in the tab and hud mounts, the settings overlay,
// and the notice a canGenerate hook leaves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setupDom } from './view/mounts/helpers.js';
import { createFakeContext } from '../../testkit/index.js';

const doc = setupDom();
doc.head = doc.createElement('head');
for (const id of ['sheld', 'extensions_settings2', 'extensionsMenu']) {
    const node = doc.createElement('div');
    node.id = id;
    doc.body.appendChild(node);
}
const sendForm = doc.createElement('form');
sendForm.id = 'send_form';
doc.querySelector('#sheld').appendChild(sendForm);
const st = createFakeContext();
globalThis.SillyTavern = { getContext: () => st.ctx };
globalThis.toastr = { warning() {}, info() {}, error() {} };

await import('../../index.js');
const sdk = await globalThis.StoryBlock.ready;
const texts = (root, selector) => root.querySelectorAll(selector).map(node => node.textContent);

test('the global host and the manifest agree: v2, the interceptor, the CSS, 2.0.0-alpha.1', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8'));
    assert.equal(manifest.version, '2.0.0-alpha.1');
    assert.equal(manifest.css, 'src/v2/view/host.css');
    assert.match(readFileSync(new URL('../../src/v2/view/host.css', import.meta.url), 'utf8'), /@import url\('\.\/mounts\.css'\)/);
    assert.equal(typeof globalThis[manifest.generate_interceptor], 'function');
    assert.equal(globalThis.StoryBlock.apiVersion, 2);
    assert.equal(globalThis.StoryBlock.sdk, sdk);
    assert.deepEqual(sdk.modules().map(module => module.id), ['story-block']);
    assert.ok(!/import[^;]*index\.v1\.js|from '\.\/src\/(?!v2\/)/.test(readFileSync(new URL('../../index.js', import.meta.url), 'utf8')), 'v1 is not loaded');
});

test('the bar sits right above the message box; the drawer and the wand menu are there', () => {
    const bar = doc.querySelector('#story_suite_v2_bar');
    assert.ok(bar);
    const next = bar.nextElementSibling;
    assert.ok(next === sendForm || (next.classList.contains('ss-hud') && next.nextElementSibling === sendForm), 'the bar, then the hud strip, then the message box');
    assert.ok(doc.querySelector('#story_suite_v2_drawer'));
    assert.ok(doc.querySelector('#story_suite_v2_menu'));
    assert.match(doc.querySelector('#story_suite_v2_drawer').textContent, /Story Block 2\.0\.0-alpha\.1 \(v2\)/);
});

test('a reply\'s change lines reach the Inventory tab of the story panel', async () => {
    await st.send('I take the rope.', { reply: 'You coil the rope.\n<Changes>\n+ item Rope | qty: 2\n+ coin 7 | from: the ferryman\n</Changes>' });
    assert.match(st.ctx.chat.at(-1).mes, /^You coil the rope\.\n\n<!-- STORY_SUITE_V2/, 'the block is hidden');
    doc.querySelector('.story-suite-bar-story').click();
    const panel = doc.querySelector('#story_suite_v2_panel');
    assert.equal(panel.hidden, false);
    assert.deepEqual(texts(panel, '.story-suite-tab-label'), ['Scene', 'Inventory']);
    panel.querySelector('[data-tab-id="story-block/inventory"]').click();
    assert.match(panel.querySelector('.story-suite-pane').textContent, /Rope/);
    assert.match(panel.querySelector('.story-suite-pane').textContent, /7/);
    doc.querySelector('.story-suite-sheet-close').click();
    assert.equal(panel.hidden, true);
});

test('a module\'s layout screen with a standard widget shows as a tab and in the hud', async () => {
    await sdk.registerModule({
        id: 'gauge',
        name: 'Gauge',
        queries: { 'gauge.rope': state => Object.values(state.domains.inventory.stacks).reduce((sum, stack) => sum + stack.qty, 0) },
        screens: [{
            id: 'gauge/rope', title: 'Rope', icon: 'fa-ruler', mounts: ['tab', 'hud'],
            layout: { root: { type: 'col', children: [
                { type: 'text', value: { query: 'gauge.rope' } },
                { type: 'ss.meter', props: { value: 2, max: 4, label: 'Rope' } },
                { type: 'when', cond: "query('gauge.rope') >= 2", children: [{ type: 'text', value: 'plenty' }] },
            ] } },
        }],
    });
    const strip = doc.querySelector('.ss-hud');
    assert.ok(strip, 'the hud strip is shown');
    assert.equal(strip.nextElementSibling?.id === 'send_form' || strip.parentNode === sendForm.parentNode, true);
    assert.match(strip.textContent, /2/);
    assert.match(strip.textContent, /plenty/);
    doc.querySelector('.story-suite-bar-story').click();
    const panel = doc.querySelector('#story_suite_v2_panel');
    assert.deepEqual(texts(panel, '.story-suite-tab-label'), ['Scene', 'Inventory', 'Rope'], 'the usual tabs first, then the rest');
    panel.querySelector('[data-tab-id="gauge/rope"]').click();
    assert.ok(panel.querySelector('.story-suite-pane [data-widget="ss.meter"]'), 'the ss.meter widget is drawn');
    doc.querySelector('.story-suite-sheet-close').click();
});

test('the settings overlay opens from the bar with the Story Block fold and its Packs, Events and Assist panels', () => {
    doc.querySelector('.story-suite-bar-settings').click();
    const overlay = doc.querySelector('#story_suite_v2_overlay');
    assert.ok(overlay);
    assert.deepEqual(texts(overlay, '.story-suite-subsection > h4'), ['Packs', 'Events', 'Assist']);
    overlay.querySelector('.story-suite-close').click();
    assert.equal(doc.querySelector('#story_suite_v2_overlay'), null);
});

test('a canGenerate hook that says no stops the reply and leaves a notice; the next reply clears it', async () => {
    let ready = false;
    await sdk.registerModule({ id: 'gate', name: 'Gate', hooks: { canGenerate: () => (ready ? true : { ok: false, reason: 'Make your character first.' }) } });
    const before = st.ctx.chat.length;
    const out = await st.send('Onward.', { reply: 'Never sent.' });
    assert.equal(out.aborted, true);
    assert.equal(st.ctx.chat.length, before + 1, 'only the reader\'s message');
    const notice = doc.querySelector('.story-suite-notice');
    assert.equal(notice.hidden, false);
    assert.equal(notice.querySelector('.story-suite-notice-text').textContent, 'Gate: Make your character first.');
    ready = true;
    await st.generate('normal', { reply: 'Now it goes.' });
    assert.equal(notice.hidden, true);
});

test('the game view opens on the home screen; a screen asking a query no module answers still draws', () => {
    const game = doc.querySelector('.story-suite-bar-game');
    assert.equal(game.hidden, false, 'the default screens offer a game view');
    game.click();
    const view = doc.querySelector('.ss-gameview');
    assert.ok(view);
    assert.equal(view.querySelector('.ss-gameview-body').getAttribute('data-ss-screen'), 'story-block/home');
    view.querySelector('[data-ss-target="story-block/scene"]').click();
    assert.equal(view.querySelector('.ss-gameview-body').getAttribute('data-ss-screen'), 'story-block/scene');
    assert.equal(view.querySelector('.ss-mount-problem'), null, 'npc.portrait is absent without NSD: no problem line');
    view.querySelector('.ss-gameview-close').click();
    assert.equal(doc.querySelector('.ss-gameview'), null);
});

test('sdk.dialog.open shows a module\'s dialog screen (a creation wizard opened from onBlocked)', async () => {
    await sdk.registerModule({
        id: 'maker',
        name: 'Maker',
        settings: { defaults: { points: 12 }, schema: {} },
        screens: [{ id: 'maker/create', title: 'New character', mounts: ['dialog'], template: '<p class="pts">{{ settings.points }} points</p>' }],
    });
    const handle = sdk.dialog.open('maker/create', { draft: { name: '' } });
    assert.ok(handle);
    const dialog = doc.querySelector('.ss-dialog');
    assert.ok(dialog);
    assert.equal(dialog.querySelector('.pts').textContent, '12 points', 'the screen sees its own module\'s settings');
    handle.close();
    assert.equal(doc.querySelector('.ss-dialog'), null);
});
