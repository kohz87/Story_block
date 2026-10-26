// Save points and restore with data modules (DATA_MODULES.md sections 4 and 5; TIMELINE.md): a save made before the pin restores
// to a chat without the domain (and without its grammar, tail and screens); a save made after it brings the pinned state back
// exactly; the restore barrier blocks new data module work while it is up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { rulesModule, restore } from '../helpers/timeline.js';
import { fixture, reply, success, pin, view } from './helpers.js';

const GAIN = '+ dm reputation — help | kind: gain | faction: guild';
const ID = 'pack.ersveil-factions/reputation';

async function world(t) {
    const host = await createHost({ modules: [rulesModule()] });
    t.after(() => host.close());
    success(await host.packs.packs.install(fixture('reputation')));
    await host.send('Begin.', reply('+ coin 5'));
    return host;
}
const staticText = host => host.registry.contexts().find(row => row.moduleId === 'story-block').static();

test('restoring a save made before the pin removes the domain, the grammar and the screens; nothing is left behind', async t => {
    const host = await world(t);
    const saved = (await host.sdk.timeline.make({ kind: 'manual', name: 'Before' })).snapshot;
    assert.equal(Object.hasOwn(host.head().domains, 'dataModules'), false);
    await pin(host);
    await host.send('One.', reply(GAIN));
    assert.equal(view(host, ID).chat.standing.guild, 3);
    assert.match(staticText(host), /Data modules in this story/);
    const { prepared, activated } = await restore(host, saved.id);
    assert.equal(prepared.ok, true, prepared.message);
    assert.equal(activated.ok, true);
    assert.equal(Object.hasOwn(host.head().domains, 'dataModules'), false, 'the domain is absent again, not an empty {}');
    assert.doesNotMatch(staticText(host), /Data modules/);
    assert.deepEqual(host.sdk.query('dataModules.presentation'), []);
    assert.equal(host.sdk.query('dataModules.view', { module: ID }), null);
    // Still offered, and can be enabled again.
    assert.equal(host.sdk.query('dataModules.setup')[0].status, 'Available');
});

test('restoring a save made after the pin brings its fields back exactly; later pins and actions go', async t => {
    const host = await world(t);
    await pin(host);
    await host.send('One.', reply(GAIN));
    const saved = (await host.sdk.timeline.make({ kind: 'manual', name: 'After one favour' })).snapshot;
    const atSave = JSON.stringify(host.head().domains.dataModules);
    await host.send('Two.', reply(GAIN));
    await host.send('Three.', reply('- dm reputation — a loss | kind: loss | faction: watch'));
    assert.notEqual(JSON.stringify(host.head().domains.dataModules), atSave);
    const { prepared, activated } = await restore(host, saved.id);
    assert.equal(prepared.ok, true, prepared.message);
    assert.equal(activated.ok, true);
    assert.equal(JSON.stringify(host.head().domains.dataModules), atSave);
    assert.equal(view(host, ID).chat.standing.guild, 3);
    assert.equal(host.registry.restore().state, 'idle');
    // New work after the restore runs normally.
    await host.send('Four.', reply(GAIN));
    assert.equal(view(host, ID).chat.standing.guild, 6);
});

test('while the restore barrier is up, every data module entry refuses and no timer step is made', async t => {
    const host = await world(t);
    const offer = await pin(host);
    await host.send('One.', reply(GAIN));
    const before = JSON.stringify(host.head());
    host.registry.setRestore('pending', 'Restoring a save point.');
    for (const [type, payload] of [['dm.act', { module: offer.module, kind: 'gain', labels: { faction: 'guild' } }], ['dm.migrate', { module: offer.module, hash: offer.hash, packHash: offer.packHash }]]) {
        const result = await host.sdk.command(type, payload);
        assert.equal(result.ok, false, type);
    }
    await host.send('Two.', reply(GAIN));
    host.registry.setRestore('idle', '');
    assert.equal(view(host, ID).chat.standing.guild, 3, 'the line in a reply under the barrier was not used');
    assert.equal(JSON.stringify(host.head()), before, 'the generation itself is held back by the barrier: nothing was written');
});
