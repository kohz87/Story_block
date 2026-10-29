// Exported blocks retain their actual presentation, and editor errors identify the bad effect.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { mountUi } from '../../../src/v2/ui-host.js';
import { buildBlock } from '../../../src/v2/data-modules/block-builder.js';
import { renderBlockEditor } from '../../../src/v2/screens/blocks-editor.js';
import { STRINGS } from '../../../src/v2/strings.js';
import { setupDom } from '../view/mounts/helpers.js';
import { definition, directorStub, pack } from '../data-modules/helpers.js';

const S = STRINGS.blocks;
const settle = () => new Promise(resolve => setImmediate(resolve));
const button = (root, text) => root.querySelectorAll('button').find(node => node.textContent === text);
const input = (root, label) => root.querySelector(`[aria-label="${label}"]`);
const draft = () => ({ name: 'Vigor', fields: [{ key: 'stamina', name: 'Stamina', type: 'number', min: 0, max: 20, default: 0 }],
    functions: [{ type: 'button', name: 'Rest', effects: [{ field: 'stamina', op: 'add', value: 5 }] }], prompt: '',
    show: { tab: true, card: true, tabName: 'Vigor', icon: 'ph-star' } });

test('export, import and enable retain the tab, Home card and buttons without chat-only actions', async t => {
    const doc = setupDom(), form = doc.createElement('div'); form.id = 'send_form'; doc.body.appendChild(form);
    const blobs = [], filenames = [];
    doc.defaultView = { confirm: () => true, Blob: class { constructor(parts) { this.parts = parts; } },
        URL: { createObjectURL: blob => { blobs.push(blob); return 'blob:test'; }, revokeObjectURL() {} } };
    const create = doc.createElement;
    doc.createElement = tag => {
        const node = create(tag);
        if (tag === 'a') node.addEventListener('click', () => filenames.push(node.download));
        return node;
    };
    const host = await createHost(), ui = mountUi({ runtime: host, ctx: host.ctx, doc });
    t.after(() => { ui.destroy(); host.close(); });
    await host.send('Begin.', 'Opening.');
    const built = buildBlock(draft());
    assert.equal(built.ok, true, JSON.stringify(built.errors));
    assert.equal((await host.sdk.command('dm.define', { definition: built.definition })).ok, true);
    ui.mounts.screen.open('story-block/block/vigor');
    const original = doc.querySelector('.ss-gameview [data-ss-screen="story-block/block/vigor"]');
    input(original, S.menu).click();
    button(original, S.exportPack).click();
    assert.deepEqual(filenames, ['vigor.pack.json']);
    const exported = blobs[0].parts.join('');
    assert.equal(JSON.parse(exported).content.dataModules[0].show.card, true);

    await host.st.loadChat([], 'imported-block');
    assert.equal((await host.packs.packs.install(exported)).ok, true);
    await host.send('Begin again.', 'Opening.');
    const offer = host.sdk.query('dataModules.offers').find(row => row.module === 'pack.vigor/vigor');
    assert.ok(offer);
    const pinned = await host.sdk.command('dm.pin', { module: offer.module, hash: offer.hash, packHash: offer.packHash });
    assert.equal(pinned.ok, true, pinned.message);
    const screenId = 'story-block/block/vigor/vigor';
    const presentation = host.sdk.query('dataModules.presentation', { kind: 'screens' });
    assert.equal(presentation.find(screen => screen.id === screenId)?.title, 'Vigor');
    assert.equal(ui.screens.resolve(screenId).screen.icon, 'ph-star');
    assert.ok(doc.querySelector(`.ss-gameview .ss-screenbar-tile[data-id="${screenId}"]`));
    assert.equal(ui.mounts.screen.open(screenId), true);
    const tab = () => doc.querySelector(`.ss-gameview [data-ss-screen="${screenId}"]`);
    assert.match(tab().textContent, /Stamina/);
    input(tab(), S.menu).click();
    for (const label of [S.editFields, S.saveTemplate, S.removeBlock]) assert.equal(button(tab(), label), undefined);
    button(tab(), 'Rest').click();
    await settle(); await settle();
    assert.equal(host.sdk.query('dataModules.view', { module: offer.module }).chat.stamina, 5);

    await host.send('Rest again.', 'A quiet hour.');
    ui.mounts.screen.open('story-block/home');
    const home = () => doc.querySelector('.ss-gameview [data-ss-screen="story-block/home"]');
    assert.match(home().textContent, /Vigor/);
    assert.match(home().textContent, /Stamina/);
    input(home(), S.menu).click();
    for (const label of [S.editFields, S.saveTemplate, S.removeBlock]) assert.equal(button(home(), label), undefined);
    button(home(), 'Rest').click();
    await settle(); await settle();
    assert.equal(host.sdk.query('dataModules.view', { module: offer.module }).chat.stamina, 10);

    // A chat block and a pack module can have the same slug without hiding either tab.
    assert.equal((await host.sdk.command('dm.define', { definition: built.definition })).ok, true);
    assert.ok(ui.screens.resolve('story-block/block/vigor').screen);
    assert.ok(ui.screens.resolve(screenId).screen);
});

test('a character-scoped pack presentation targets the selected attached character', async t => {
    const actors = [{ id: 'ca_first001', name: 'First', bonuses: {} }, { id: 'ca_second01', name: 'Second', bonuses: {} }];
    const doc = setupDom(), form = doc.createElement('div'); form.id = 'send_form'; doc.body.appendChild(form);
    doc.defaultView = { confirm: () => true };
    const host = await createHost({ modules: [directorStub({ actors })] }), ui = mountUi({ runtime: host, ctx: host.ctx, doc });
    t.after(() => { ui.destroy(); host.close(); });
    const d = definition(); d.scope = 'character'; d.show = { tab: true, card: true, tabName: 'Counter', icon: 'ph-star' };
    d.state.id = { type: 'text', max: 20, default: 'field value' };
    assert.equal((await host.packs.packs.install(pack([d]))).ok, true);
    await host.send('Begin.', 'Opening.');
    const offer = host.sdk.query('dataModules.offers')[0];
    const pinned = await host.sdk.command('dm.pin', { module: offer.module, hash: offer.hash, packHash: offer.packHash, subjects: actors.map(actor => actor.id) });
    assert.equal(pinned.ok, true, pinned.message);
    ui.mounts.screen.open('story-block/block/dm-test/counter');
    const screen = () => doc.querySelector('.ss-gameview [data-ss-screen="story-block/block/dm-test/counter"]');
    assert.deepEqual(screen().querySelectorAll('.ss-block-subject').map(node => node.textContent), ['First', 'Second']);
    assert.equal(screen().querySelectorAll('.ss-block-actions button').length, 2);
    screen().querySelectorAll('.ss-block-actions button')[1].click();
    await settle(); await settle();
    const instances = host.head().domains.dataModules.instances[offer.module].characters;
    assert.equal(instances.ca_first001.fields.points, 0);
    assert.equal(instances.ca_second01.fields.points, 1);
});

for (const [op, value] of [['add', ''], ['set', ''], ['set', '99']]) test(`a bad ${op} value ${JSON.stringify(value)} appears beside its own effect`, () => {
    const doc = setupDom(), root = doc.createElement('div'), form = draft();
    form.functions[0].effects.unshift({ field: 'stamina', op: 'add', value: 1 });
    form.functions[0].effects[1] = { field: 'stamina', op, value };
    let saves = 0;
    const editor = renderBlockEditor(root, { draft: form, onSave: () => { saves++; return { ok: true }; }, onCancel() {} });
    button(root, S.save).click();
    const effects = root.querySelectorAll('.ss-block-effect');
    const error = effect => input(effect, S.effectValue).closest('.ss-block-control').querySelector('[role="alert"]').textContent;
    assert.equal(error(effects[0]), '');
    assert.ok(error(effects[1]), 'the invalid Value shows the validation message');
    assert.equal(input(root, S.functionName).closest('.ss-block-control').querySelector('[role="alert"]').textContent, '');
    assert.equal(saves, 0);
    editor.destroy();
});
