// rx-ui (beta rolling break, invariant 4 + F100): the dialog mount ignores features. A dialog opened for a
// screen whose feature the reader turned off still opens a modal (raw id as title, "cannot be shown",
// Back/Next/Done), and a dialog already open when its feature goes off stays up with working controls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { setupDom } from '../view/mounts/helpers.js';
import { mountUi } from '../../../src/v2/ui-host.js';

const probe = () => ({
    id: 'probe',
    name: 'Probe',
    version: '1.0.0',
    features: [{ id: 'probe.panel', label: 'Panel', default: true }],
    domains: { probe: { initial: () => ({ gems: 0 }) } },
    commands: { 'probe.add': ctx => { ctx.draft('probe').gems += 1; return { summary: 'added' }; } },
    screens: [{ id: 'probe/gems', title: 'Gems', mounts: ['dialog', 'tab'], template: '<p class="pg">Gems: {{ state.probe.gems }}</p><button data-submit="probe.add">Add</button>', feature: 'probe.panel' }],
});

async function page() {
    const doc = setupDom();
    for (const id of ['send_form', 'extensions_settings']) { const node = doc.createElement('div'); node.id = id; doc.body.appendChild(node); }
    const host = await createHost({ modules: [probe()] });
    const runtime = { registry: host.registry, store: host.store, sdk: host.sdk, settings: host.settings, events: host.events, turn: host.turn, features: host.features };
    const ui = mountUi({ runtime, ctx: host.ctx, doc, version: '2.0.0-test' });
    return { doc, host, ui };
}

test('a dialog for a screen whose feature is off does not open (no modal with a raw id and dead buttons)', async () => {
    const { doc, host, ui } = await page();
    host.features.set('probe.panel', false);
    const handle = ui.mounts.dialog.open('probe/gems');
    const dialogs = doc.querySelectorAll('.ss-dialog');
    assert.equal(dialogs.length, 0, `a modal opened: "${dialogs.map(node => node.textContent).join(' | ')}"`);
    assert.equal(handle ?? null, null, 'open() says nothing was opened');
    host.close();
});

test('a dialog that is open when its feature is turned off closes', async () => {
    const { doc, host, ui } = await page();
    ui.mounts.dialog.open('probe/gems');
    assert.equal(doc.querySelectorAll('.ss-dialog').length, 1);
    host.features.set('probe.panel', false);
    assert.equal(doc.querySelectorAll('.ss-dialog').length, 0, 'the dialog of an off screen is still up, its Add button still live');
    host.close();
});
