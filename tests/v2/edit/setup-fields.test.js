import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDataModules } from '../../../src/v2/data-modules/setup.js';
import { setupDom } from '../view/mounts/helpers.js';
import { definition, directorStub, int, pack, pin, success, view, world } from '../data-modules/helpers.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const line = (root, label) => root.querySelectorAll('.ss-dm-field').find(node => node.textContent.startsWith(`${label}:`));

test('Setup edits pinned fields that have no layout, including map keys, and keeps locked fields out', async t => {
    const d = definition();
    d.state = { points: int(2, 0, 10), note: { type: 'text', max: 30, default: '<old>' },
        mood: { type: 'enum', values: ['calm', 'wary'], default: 'calm' },
        flags: { type: 'map', keys: ['north', 'south'], values: { type: 'bool', default: false } },
        secret: { ...int(), edit: false } };
    const doc = setupDom(), root = doc.createElement('div'), host = await world(t, pack([d]));
    const offer = await pin(host);
    const ui = renderDataModules(root, { sdk: host.sdk });
    t.after(() => ui.destroy());
    assert.deepEqual(root.querySelectorAll('.ss-dm-field').map(node => node.textContent.split(':')[0]),
        ['points', 'note', 'mood', 'flags · north', 'flags · south']);
    assert.equal(line(root, 'note').querySelector('.ss-w-editable-value').textContent, '<old>');
    assert.equal(line(root, 'secret'), undefined);
    const points = line(root, 'points'), pencil = points.querySelector('.ss-w-editable-pencil');
    pencil.click();
    points.querySelector('input').value = '7';
    points.querySelector('.ss-w-editable-save').click();
    await settle(); await settle();
    assert.equal(view(host, offer.module).chat.points, 7);
    assert.equal(points.querySelector('.ss-w-editable-value').textContent, '7');
    assert.equal(doc.activeElement, pencil);
    ui.refresh();
    assert.equal(doc.activeElement, pencil, 'refresh after a successful edit keeps focus');
    const north = line(root, 'flags · north');
    north.querySelector('.ss-w-editable-pencil').click();
    north.querySelector('select').value = 'true';
    north.querySelector('.ss-w-editable-save').click();
    await settle(); await settle();
    assert.equal(view(host, offer.module).chat.flags.north, true);
});

test('Setup uses the pinned generation and edits the chosen attached character', async t => {
    const d = definition();
    d.scope = 'character';
    d.state = { points: int(1, 0, 10) };
    const actors = [{ id: 'ca_first001', name: 'First', bonuses: {} }, { id: 'ca_second01', name: 'Second', bonuses: {} }];
    const doc = setupDom(), root = doc.createElement('div'), host = await world(t, pack([d]), [directorStub({ actors })]);
    const offer = await pin(host, actors.map(actor => actor.id));
    const replacement = definition();
    replacement.scope = 'character';
    replacement.state = { points: int(1, 0, 10), newfield: int() };
    replacement.stateVersion = 2;
    replacement.migrations = [{ from: 1, to: 2, add: { newfield: int() } }];
    success(await host.packs.packs.install({ ...pack([replacement]), version: '1.1.0' }));
    const ui = renderDataModules(root, { sdk: host.sdk });
    t.after(() => ui.destroy());
    assert.ok(line(root, 'First · points'));
    assert.ok(line(root, 'Second · points'));
    assert.equal(line(root, 'First · newfield'), undefined);
    const second = line(root, 'Second · points');
    second.querySelector('.ss-w-editable-pencil').click();
    second.querySelector('input').value = '8';
    second.querySelector('.ss-w-editable-save').click();
    await settle(); await settle();
    assert.deepEqual(view(host, offer.module).characters.map(person => person.points), [1, 8]);
});
