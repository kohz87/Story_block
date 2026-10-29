import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { mountUi } from '../../../src/v2/ui-host.js';
import { setupDom } from '../view/mounts/helpers.js';

test('standalone Studio layouts become tabs and leave when their pack is disabled', async t => {
    const doc = setupDom(), host = await createHost();
    const ui = mountUi({ runtime: host, ctx: host.ctx, doc });
    t.after(() => { ui.destroy(); host.close(); });
    await host.send('Begin.', 'Opening.');
    const pack = { id: 'studio-example', name: 'Studio example', version: '1.0.0', requires: { storyBlock: '^2' }, content: {},
        layouts: [{ id: 'studio/example', title: 'Example', icon: 'ph-star', root: { type: 'text', value: 'Hello from Studio' } }] };
    assert.equal((await host.packs.packs.install(pack)).ok, true);
    assert.ok(ui.screens.list('tab').some(entry => entry.id === 'studio/example'));
    const root = doc.createElement('div');
    const handle = ui.mounts.tab.mount(root, 'studio/example');
    assert.match(root.textContent, /Hello from Studio/);
    handle.unmount();
    await host.packs.packs.setEnabled('studio-example', false);
    assert.equal(ui.screens.resolve('studio/example'), null);
});

test('a reader-owned standalone layout appears as a tab without a pack', async t => {
    const doc = setupDom(), host = await createHost();
    host.ctx.extensionSettings.storySuite.screens = { 'reader/mine': { id: 'reader/mine', title: 'Mine', icon: 'ph-star', mounts: ['tab'],
        layout: { root: { type: 'text', value: 'My layout' } } } };
    const ui = mountUi({ runtime: host, ctx: host.ctx, doc });
    t.after(() => { ui.destroy(); host.close(); });
    await host.send('Begin.', 'Opening.');
    assert.ok(ui.screens.list('tab').some(entry => entry.id === 'reader/mine'));
    const root = doc.createElement('div');
    const handle = ui.mounts.tab.mount(root, 'reader/mine');
    assert.match(root.textContent, /My layout/);
    handle.unmount();
});
