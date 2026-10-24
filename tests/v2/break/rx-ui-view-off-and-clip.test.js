// rx-ui (B-rxui-11, B-rxui-12; beta rolling break, SB #105 view): (1) the Inspector is the `story-block.inspector` feature (off
// by default) but only its screen is hidden: the host widget draws the whole state inspector in any other
// screen that names it (a pack's or module's), feature off or not. (2) The Versions fold prints a
// module's name and version as given: a 3000-character name and a 5000-character version come out whole
// (one unbroken word in the overlay; 12 KB of text for one row).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { setupDom } from '../view/mounts/helpers.js';
import { mountUi } from '../../../src/v2/ui-host.js';

async function page(modules = []) {
    const doc = setupDom();
    doc.createElementNS = (_ns, tag) => doc.createElement(tag);
    for (const id of ['send_form', 'extensions_settings']) { const node = doc.createElement('div'); node.id = id; doc.body.appendChild(node); }
    const host = await createHost({ modules });
    const runtime = { registry: host.registry, store: host.store, sdk: host.sdk, settings: host.settings, events: host.events, turn: host.turn, features: host.features };
    const ui = mountUi({ runtime, ctx: host.ctx, doc, version: '2.0.0-test' });
    return { doc, host, ui };
}

test('the Inspector widget draws nothing in another screen while its feature is off', async () => {
    const peek = { id: 'peek', name: 'Peek', screens: [{ id: 'peek/look', title: 'Look', mounts: ['screen'], template: '<div class="pk"><ss-widget name="story-block.inspector"></ss-widget></div>' }] };
    const { doc, host, ui } = await page([peek]);
    try {
        await host.send('hi', 'A rope.\n<Changes>\n+ item Rope\n</Changes>');
        assert.equal(host.sdk.feature('story-block.inspector'), false);
        ui.mounts.screen.open('peek/look');
        const text = doc.querySelector('.ss-gameview-body').textContent;
        assert.doesNotMatch(text, /rev \d+|Changed since/, `the Inspector is drawn with its feature off: ${text.replace(/\s+/g, ' ').slice(0, 120)}`);
    } finally {
        host.close();
    }
});

test('the Versions fold clips a module\'s name and version', async () => {
    const weird = { id: 'weird', name: 'N'.repeat(3000), version: 'v'.repeat(5000) };
    const { doc, host, ui } = await page([weird]);
    try {
        ui.openSettings();
        const longest = Math.max(...doc.querySelector('#story_suite_v2_overlay').querySelectorAll('*').map(node => node.children.length ? 0 : node.textContent.length));
        assert.ok(longest <= 400, `a text node of ${longest} characters in the overlay`);
    } finally {
        host.close();
    }
});
