import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { core, stocked } from '../domains/fixtures.js';
import { createHarness } from '../domains/helpers/fake-ctx.js';

test('reader scene actions mark edits; system scene actions retain their old receipts', () => {
    const module = core();
    const h = createHarness(module, { state: stocked(module) });
    const place = h.run('scene.place', { name: 'Bluewatch' });
    assert.equal(place.result.data.edit, true);
    const weather = h.run('scene.weather', { text: 'rain' });
    assert.equal(weather.result.data.edit, true);
    const present = h.run('scene.present', { set: ['Ren', 'Mira'] });
    assert.equal(present.result.data.edit, true);
    assert.deepEqual(present.result.data.present, ['Ren', 'Mira']);
    assert.equal(h.run('scene.present', { set: ['Ren'] }, { cause: 'system' }).code, 'REFUSED');
    assert.equal(h.run('scene.present', { set: ['Ren'] }, { caller: 'another-module' }).code, 'REFUSED');
    assert.equal(h.run('scene.present', { set: 'Ren' }).code, 'INVALID');
    const system = h.run('scene.weather', { text: 'sun' }, { cause: 'system' });
    assert.equal(system.result.data.edit, undefined);
});

test('scene edits rebuild, reload and disappear on a swipe', async t => {
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Look.', 'A quiet road.');
    for (const [type, payload] of [['scene.place', { name: 'Bluewatch' }], ['scene.present', { set: ['Ren', 'Mira'] }], ['scene.weather', { text: 'rain' }]]) {
        const result = await host.sdk.command(type, payload);
        assert.equal(result.ok, true, result.message);
    }
    const live = structuredClone(host.head());
    host.store.rebuild();
    assert.deepEqual(host.head(), live);
    const loaded = await createHost({ st: { chat: structuredClone(host.ctx.chat), extensionSettings: structuredClone(host.ctx.extensionSettings) } });
    t.after(() => loaded.close());
    assert.deepEqual(loaded.head(), live);
    assert.equal((await host.turn.reread(host.store.headIndex())).ok, true);
    assert.deepEqual(host.head().domains.scene.present, ['Ren', 'Mira']);
    await host.swipe('Another road.');
    assert.deepEqual(host.head().domains.scene.present, []);
    assert.equal(host.head().domains.scene.place.name, '');
    assert.equal(host.head().domains.scene.weather, undefined);
});

test('scene pencils send a place, the weather and a list of people', async () => {
    const { sceneScreen } = await import('../../../src/v2/screens/scene.js');
    const { queries, sceneState, show, settle } = await import('../screens/helpers.js');
    const module = core();
    const state = sceneState(module);
    const { el, calls } = show(sceneScreen, { state, query: queries(module, state) });
    const place = el.querySelector('.place-title .ss-w-editable');
    place.querySelector('button').click();
    place.querySelector('input').value = 'Grey Shoals';
    place.querySelector('.ss-w-editable-save').click();
    await settle();
    assert.deepEqual(calls.at(-1).slice(0, 2), ['scene.place', { with: ['Fenna', 'Old Tam'], name: 'Grey Shoals' }]);
    const people = el.querySelector('.present .ss-w-editable');
    people.querySelector('button').click();
    people.querySelector('input').value = 'Mira';
    people.querySelector('.ss-w-editable-save').click();
    await settle();
    assert.deepEqual(calls.at(-1).slice(0, 2), ['scene.present', { set: ['Fenna', 'Old Tam', 'Mira'] }]);
});
