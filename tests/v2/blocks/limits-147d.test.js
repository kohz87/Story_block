import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { buildBlock, editableBlockDraft } from '../../../src/v2/data-modules/block-builder.js';
import { renderBlockEditor } from '../../../src/v2/screens/blocks-editor.js';
import { STRINGS } from '../../../src/v2/strings.js';
import { setupDom } from '../view/mounts/helpers.js';
import { definition, pack, pin, reload, success, view, world } from '../data-modules/helpers.js';

const S = STRINGS.blocks;
const block = n => ({ ...definition(), slug: `block-${n}`, name: `Block ${n}`, kinds: {} });
const field = n => ({ key: `f${n}`, name: `F${n}`, type: 'number', min: 0, max: 10, default: 0 });
const draft = (fields = []) => ({ name: 'Limits', fields, functions: [], prompt: '',
    show: { tab: true, card: false, tabName: 'Limits', icon: 'ph-star' } });
const button = (root, label) => root.querySelectorAll('button').find(node => node.textContent === label);
const define = async (host, n) => success(await host.sdk.command('dm.define', { definition: block(n) }));
const offerPayload = offer => ({ module: offer.module, hash: offer.hash, packHash: offer.packHash });

async function withPacks(t) {
    const modules = Array.from({ length: 8 }, (_, i) => ({ ...definition(), slug: `m${i}` }));
    const host = await world(t, pack(modules));
    const second = pack([{ ...definition(), slug: 'extra' }]); second.id = 'dm-next';
    success(await host.packs.packs.install(second));
    await host.send('Begin.', 'Opening.');
    return host;
}

test('eight blocks and eight pack pins coexist; each limit refuses the next addition', async t => {
    const host = await withPacks(t);
    for (let n = 0; n < 8; n++) await define(host, n);
    const before = structuredClone(host.head());
    const ninthBlock = await host.sdk.command('dm.define', { definition: block(8) });
    assert.equal(ninthBlock.code, 'DM_BUDGET');
    assert.match(ninthBlock.message, /at most 8 blocks/);
    assert.deepEqual(host.head(), before);
    for (let n = 0; n < 8; n++) {
        await host.send('More.', 'A reply.');
        await pin(host, [], n);
    }
    assert.equal(Object.keys(host.head().domains.dataModules.active).length, 16);
    const extra = host.sdk.query('dataModules.offers').find(offer => offer.module === 'pack.dm-next/extra');
    const full = structuredClone(host.head());
    assert.equal((await host.sdk.command('dm.pin', offerPayload(extra))).code, 'DM_BUDGET');
    assert.deepEqual(host.head(), full);
    await reload(host);
});

test('eight packs may precede a block, and a pack may follow seven blocks up to the shared limit', async t => {
    const host = await withPacks(t);
    for (let n = 0; n < 8; n++) {
        if (n) await host.send('More.', 'A reply.');
        await pin(host, [], n);
    }
    for (let n = 0; n < 7; n++) {
        await host.send('Block.', 'A reply.');
        await define(host, n);
    }
    const extra = host.sdk.query('dataModules.offers').find(offer => offer.module === 'pack.dm-next/extra');
    await host.send('More.', 'A reply.');
    success(await host.sdk.command('dm.pin', offerPayload(extra)));
    const before = structuredClone(host.head());
    assert.equal((await host.sdk.command('dm.define', { definition: block(7) })).code, 'DM_BUDGET');
    assert.deepEqual(host.head(), before);
    await reload(host);
});

test('replay rechecks the block limit when an earlier removal is deleted', async t => {
    const host = await createHost(); t.after(() => host.close());
    await host.send('Begin.', 'Opening.');
    for (let n = 0; n < 8; n++) await define(host, n);
    await host.send('Remove.', 'A reply.');
    const removeAt = host.store.headIndex();
    success(await host.sdk.command('dm.remove', { module: 'pack.chat/block-0' }));
    await host.send('Replace.', 'Another reply.');
    await define(host, 8);
    await host.st.deleteMessage(removeAt);
    assert.ok(view(host, 'pack.chat/block-0'));
    assert.equal(view(host, 'pack.chat/block-8'), null);
    assert.ok(host.store.problems().some(problem => problem.code === 'REPLAY_PREREQUISITE'));
    await reload(host);
});

test('fields and buttons share 16 kinds while rules and timers do not use them', () => {
    const form = draft(Array.from({ length: 14 }, (_, n) => field(n)));
    form.functions = [
        { type: 'button', name: 'One', effects: [{ field: 'f0', op: 'add', value: 1 }] },
        { type: 'button', name: 'Two', effects: [{ field: 'f0', op: 'add', value: 1 }] },
        { type: 'rule', name: 'Rule', when: { field: 'f0', op: 'eq', value: 1 }, effects: [{ field: 'f0', op: 'add', value: 1 }] },
        { type: 'timer', name: 'Timer', every: 60, effects: [{ field: 'f0', op: 'add', value: 1 }] },
    ];
    const built = buildBlock(form);
    assert.equal(built.ok, true, JSON.stringify(built.errors));
    assert.equal(Object.keys(built.definition.kinds).length, 16);
    assert.equal(built.definition.rules.length, 1);
    assert.equal(built.definition.timers.length, 1);
    form.fields.push(field(14));
    assert.match(buildBlock(form).errors[0].message, /at most 16 fields and buttons/);
    form.fields.pop();
    form.functions.push({ type: 'button', name: 'Three', effects: [{ field: 'f0', op: 'add', value: 1 }] });
    assert.match(buildBlock(form).errors[0].message, /at most 16 fields and buttons/);
});

test('direct block commands also enforce the combined field and button limit', async t => {
    const host = await createHost(); t.after(() => host.close());
    await host.send('Begin.', 'Opening.');
    const definition = block(0);
    definition.state = Object.fromEntries(Array.from({ length: 15 }, (_, n) => [`f${n}`, { type: 'int', min: 0, max: 10, default: 0 }]));
    definition.kinds = {
        first: { op: '!', ui: true, labels: {}, effects: [{ op: 'add', path: ['f0'], value: 1, bounds: 'clamp' }] },
        second: { op: '!', ui: true, labels: {}, effects: [{ op: 'add', path: ['f0'], value: 1, bounds: 'clamp' }] },
    };
    const before = structuredClone(host.head());
    const result = await host.sdk.command('dm.define', { definition });
    assert.equal(result.code, 'DM_BUDGET');
    assert.match(result.message, /at most 16 fields and buttons/);
    assert.deepEqual(host.head(), before);
    delete definition.kinds.second;
    success(await host.sdk.command('dm.define', { definition }));
    definition.kinds.second = definition.kinds.first;
    assert.equal((await host.sdk.command('dm.redefine', { module: 'pack.chat/block-0', definition })).code, 'DM_BUDGET');
    await reload(host);
});

test('an old editor-generated number field can be reopened without accepting unrelated changes', () => {
    const built = buildBlock(draft([field(1)]));
    assert.equal(built.ok, true, JSON.stringify(built.errors));
    const legacy = structuredClone(built.definition);
    legacy.kinds['change-f1'] = { op: '~', labels: { by: { type: 'int', min: -10, max: 10 } },
        effects: [{ op: 'add', path: ['f1'], value: ['arg', 'by'], bounds: 'clamp' }] };
    const reopened = editableBlockDraft(legacy);
    assert.ok(reopened);
    const updated = buildBlock(reopened);
    assert.equal(updated.ok, true, JSON.stringify(updated.errors));
    assert.equal(updated.definition.kinds['change-f1'], undefined);
    legacy.kinds['change-f1'].effects[0].bounds = 'reject';
    assert.equal(editableBlockDraft(legacy), null);
});

test('the editor updates the kind count and refuses additions at 16 without blocking rules or timers', () => {
    const doc = setupDom(), root = doc.createElement('div');
    const form = draft(Array.from({ length: 15 }, (_, n) => field(n)));
    const editor = renderBlockEditor(root, { draft: form, directorOn: true, onSave: () => ({ ok: true }), onCancel() {} });
    assert.match(root.querySelector('.ss-block-kind-count').textContent, /15 of 16 used/);
    button(root, S.addField).click();
    assert.match(root.querySelector('.ss-block-kind-count').textContent, /16 of 16 used/);
    button(root, S.addField).click();
    assert.equal(form.fields.length, 16);
    assert.match(root.textContent, /at most 16 fields and buttons/);
    button(root, S.addButton).click();
    assert.equal(form.functions.length, 0);
    button(root, S.addRule).click();
    button(root, S.addTimer).click();
    assert.deepEqual(form.functions.map(fn => fn.type), ['rule', 'timer']);
    assert.match(root.querySelector('.ss-block-kind-count').textContent, /16 of 16 used/);
    const lastField = root.querySelectorAll('.ss-block-field-editor').at(-1);
    button(lastField, S.remove).click();
    assert.match(root.querySelector('.ss-block-kind-count').textContent, /15 of 16 used/);
    button(root, S.addButton).click();
    assert.match(root.querySelector('.ss-block-kind-count').textContent, /16 of 16 used/);
    editor.destroy();
});

test('timer controls offer only number fields and the add action', () => {
    const doc = setupDom(), root = doc.createElement('div');
    const form = draft([
        { key: 'mood', name: 'Mood', type: 'text', max: 20, default: '' },
        field(1),
        { key: 'people', name: 'People', type: 'list', default: '' },
        { key: 'status', name: 'Status', type: 'choice', values: ['new', 'old'], default: 'new' },
        field(2),
    ]);
    const editor = renderBlockEditor(root, { draft: form, directorOn: true, onSave: () => ({ ok: true }), onCancel() {} });
    button(root, S.addTimer).click();
    const timer = root.querySelector('.ss-block-function');
    const selectField = timer.querySelector(`[aria-label="${S.effectField}"]`);
    const selectAction = timer.querySelector(`[aria-label="${S.effectAction}"]`);
    assert.deepEqual(selectField.querySelectorAll('option').map(option => option.value), ['f1', 'f2']);
    assert.deepEqual(selectAction.querySelectorAll('option').map(option => option.value), ['add']);
    assert.deepEqual(form.functions[0].effects[0], { field: 'f1', op: 'add', value: '' });
    button(timer, S.addStep).click();
    assert.deepEqual(form.functions[0].effects[1], { field: 'f1', op: 'add', value: '' });
    editor.destroy();
});
