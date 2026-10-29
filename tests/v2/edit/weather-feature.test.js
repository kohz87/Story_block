import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { CORE_FEATURE } from '../../../src/v2/features.js';
import { mountUi } from '../../../src/v2/ui-host.js';
import { setupDom } from '../view/mounts/helpers.js';

test('Home and Scene offer weather editing only while the feature is on, even when no weather is set', async t => {
    const doc = setupDom(), form = doc.createElement('div');
    form.id = 'send_form';
    doc.body.appendChild(form);
    const host = await createHost();
    const ui = mountUi({ runtime: host, ctx: host.ctx, doc });
    t.after(() => { ui.destroy(); host.close(); });
    await host.send('Look.', 'A quiet road.');
    const pencil = () => doc.querySelector('.ss-gameview [aria-label="Edit weather"]');
    for (const id of ['story-block/home', 'story-block/scene']) {
        assert.equal(ui.mounts.screen.open(id), true);
        assert.ok(pencil(), `${id}: the unset weather can be edited`);
        host.features.set(CORE_FEATURE.weather, false);
        assert.equal(pencil(), null, `${id}: the pencil is hidden while the feature is off`);
        host.features.set(CORE_FEATURE.weather, true);
        assert.ok(pencil(), `${id}: the pencil returns when the feature is on`);
    }
    assert.equal((await host.sdk.command('scene.weather', { text: 'rain' })).ok, true);
    host.features.set(CORE_FEATURE.weather, false);
    assert.equal(pencil(), null);
    host.features.set(CORE_FEATURE.weather, true);
    assert.ok(pencil());
    assert.equal(host.sdk.query('scene.weather').text, 'rain');
});
