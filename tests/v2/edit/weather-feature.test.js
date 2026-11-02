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
    // Scene's own pencil, and the Game view header's one editor (Home): its Weather field. (The header's per-item pencils are gone: one Edit button.)
    const pencil = () => doc.querySelector('.ss-gameview [aria-label="Edit weather"]');
    const field = () => doc.querySelector('.ss-gameview .ss-hero-editor input[aria-label="Weather"]');
    const editorWeather = () => {
        doc.querySelector('.ss-gameview .ss-hero-edit').click();
        const there = Boolean(field());
        doc.querySelector('.ss-gameview .ss-hero-editor .ss-w-editable-cancel').click();
        return there;
    };
    assert.equal(ui.mounts.screen.open('story-block/home'), true);
    assert.equal(pencil(), null, 'Home\'s header has no per-item pencil');
    assert.equal(editorWeather(), true, 'story-block/home: the unset weather can be edited');
    host.features.set(CORE_FEATURE.weather, false);
    assert.equal(editorWeather(), false, 'story-block/home: no Weather field while the feature is off');
    host.features.set(CORE_FEATURE.weather, true);
    assert.equal(editorWeather(), true, 'story-block/home: the field returns when the feature is on');
    assert.equal(ui.mounts.screen.open('story-block/scene'), true);
    assert.ok(pencil(), 'story-block/scene: the unset weather can be edited');
    host.features.set(CORE_FEATURE.weather, false);
    assert.equal(pencil(), null, 'story-block/scene: the pencil is hidden while the feature is off');
    host.features.set(CORE_FEATURE.weather, true);
    assert.ok(pencil(), 'story-block/scene: the pencil returns when the feature is on');
    assert.equal(ui.mounts.screen.open('story-block/home'), true);
    assert.equal((await host.sdk.command('scene.weather', { text: 'rain' })).ok, true);
    host.features.set(CORE_FEATURE.weather, false);
    assert.equal(editorWeather(), false);
    host.features.set(CORE_FEATURE.weather, true);
    assert.equal(editorWeather(), true);
    assert.equal(host.sdk.query('scene.weather').text, 'rain');
});
