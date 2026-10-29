import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlockTemplates, exportBlockPack } from '../../../src/v2/data-modules/block-templates.js';
import { validatePack } from '../../../src/v2/packs/validate.js';
import { buildBlock } from '../../../src/v2/data-modules/block-builder.js';
import { createHost } from '../../../testkit/index.js';

const draft = (name = 'Notes') => ({ name, fields: [{ name: 'Mood', type: 'text', max: 30, default: 'calm' }], functions: [], prompt: '',
    show: { tab: true, card: true, tabName: 'Notes', icon: 'ph-bookmark-simple' } });

test('templates save detached definitions, require replacement consent, and can be listed and deleted', async () => {
    const settings = {}; let saves = 0;
    const templates = createBlockTemplates({ read: () => settings, save: () => { saves++; } });
    const checked = buildBlock(draft());
    assert.equal(checked.ok, true);
    assert.equal((await templates.put(checked.checked)).ok, true);
    checked.checked.state.mood.default = 'changed';
    assert.equal(templates.list()[0].definition.state.mood.default, 'calm');
    assert.equal((await templates.put(buildBlock(draft()).checked)).code, 'EXISTS');
    assert.equal((await templates.put(buildBlock(draft()).checked, { replace: true })).replaced, true);
    assert.equal(saves, 2);
    assert.equal((await templates.remove('Notes')).ok, true);
    assert.deepEqual(templates.list(), []);
});

test('an exported block validates and imports as an ordinary pack with the same fields', () => {
    const built = buildBlock(draft());
    const result = exportBlockPack(built.checked);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.filename, 'notes.pack.json');
    const imported = validatePack(result.text);
    assert.equal(imported.ok, true, JSON.stringify(imported.errors));
    assert.equal(imported.pack.content.dataModules[0].id, 'pack.notes/notes');
    assert.deepEqual(imported.pack.content.dataModules[0].state, built.checked.state);
});

test('templates stop at sixteen and an exported pack enables through the normal host', async t => {
    const settings = {}, templates = createBlockTemplates({ read: () => settings });
    for (let i = 0; i < 16; i++) assert.equal((await templates.put(buildBlock(draft(`Notes ${i}`)).checked)).ok, true);
    assert.equal((await templates.put(buildBlock(draft('One more')).checked)).code, 'FULL');
    const host = await createHost(); t.after(() => host.close());
    const exported = exportBlockPack(buildBlock(draft()).checked);
    assert.equal((await host.packs.packs.install(exported.text)).ok, true);
    await host.send('Begin.', 'Opening.');
    const offer = host.sdk.query('dataModules.offers')[0];
    assert.equal((await host.sdk.command('dm.pin', { module: offer.module, hash: offer.hash, packHash: offer.packHash })).ok, true);
    assert.deepEqual(host.sdk.query('dataModules.view', { module: 'pack.notes/notes' }).chat, { mood: 'calm' });
});
