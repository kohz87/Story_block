import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { buildBlock, blockDraft, uniqueBlockSlug } from '../../../src/v2/data-modules/block-builder.js';
import { directorStub, reload, reply, view } from '../data-modules/helpers.js';

const draft = () => ({ name: "Wessel's Notes", fields: [
    { name: 'Mood', type: 'text', max: 30, default: 'calm' },
    { name: 'Fatigue', type: 'number', min: 0, max: 10, default: 0 },
    { name: 'Standing', type: 'choice', values: ['new', 'trusted'], default: 'new' },
    { name: 'Known contacts', type: 'list', default: '' },
], prompt: 'Keep track of these.', show: { tab: true, card: true, tabName: 'Notes', icon: 'ph-bookmark-simple' }, functions: [
    { type: 'button', name: 'Rest', effects: [{ field: 'fatigue', op: 'add', value: -3 }, { field: 'mood', op: 'set', value: 'rested' }] },
    { type: 'rule', name: 'Tired', when: { field: 'fatigue', op: 'ge', value: 5 }, effects: [{ field: 'mood', op: 'set', value: 'tired' }] },
    { type: 'timer', name: 'Passing time', every: 60, effects: [{ field: 'fatigue', op: 'add', value: 1 }] },
] });

test('the builder makes checked story kinds and ordinary button, rule and timer declarations', () => {
    const result = buildBlock(draft());
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.definition.slug, 'wessel-s-notes');
    assert.equal(result.definition.state.mood.label, 'Mood');
    assert.equal(result.definition.state['known-contacts'].list, true);
    assert.equal(result.definition.kinds['button-rest'].title, 'Rest');
    assert.deepEqual(result.definition.timers[0].effects[0].value, ['mul', ['timer', 'periods'], 1]);
    const again = buildBlock(blockDraft(result.checked));
    assert.equal(again.ok, true, JSON.stringify(again.errors));
    assert.deepEqual(again.checked, result.checked);
    assert.equal(uniqueBlockSlug('Notes', ['pack.chat/notes', 'pack.chat/notes-2']), 'notes-3');
    assert.equal(uniqueBlockSlug('Chat'), 'chat-2');
});

test('generated kinds, a button, a rule and an elapsed timer use the existing interpreter', async t => {
    const host = await createHost({ modules: [directorStub()] }); t.after(() => host.close());
    await host.send('Begin.', 'Opening.');
    const built = buildBlock(draft());
    assert.equal(built.ok, true, JSON.stringify(built.errors));
    const id = 'pack.chat/wessel-s-notes';
    const defined = await host.sdk.command('dm.define', { definition: built.definition });
    assert.equal(defined.ok, true, defined.message);
    await host.send('Tire.', reply('~ dm wessel-s-notes — walked | kind: change-fatigue | by: 6'));
    assert.equal(view(host, id).chat.fatigue, 6);
    assert.equal(view(host, id).chat.mood, 'tired');
    await host.send('Rest.', 'A quiet moment.');
    const button = await host.sdk.command('dm.act', { module: id, kind: 'button-rest' });
    assert.equal(button.ok, true, button.message);
    assert.equal(button.receipt.data.edit, true);
    assert.equal(view(host, id).chat.fatigue, 3);
    assert.equal(view(host, id).chat.mood, 'rested');
    await host.send('Wait.', reply('! time 120'));
    assert.equal(view(host, id).chat.fatigue, 5);
    assert.equal(view(host, id).chat.mood, 'tired');
    await host.send('Change it.', 'A pause.');
    assert.equal((await host.sdk.command('dm.set', { module: id, field: 'fatigue', value: 0 })).ok, true);
    assert.equal((await host.sdk.command('dm.set', { module: id, field: 'mood', value: 'rested' })).ok, true);
    assert.equal((await host.sdk.command('dm.set', { module: id, field: 'fatigue', value: 6 })).ok, true);
    assert.equal(view(host, id).chat.mood, 'tired');
    await reload(host);
});

test('the builder refuses invalid fields, functions and choices without weakening the data-module limits', () => {
    const badChoice = draft(); badChoice.fields[2].values = ['only'];
    assert.match(buildBlock(badChoice).errors[0].message, /2 to 32/);
    const tooMany = draft(); tooMany.functions = Array.from({ length: 9 }, () => tooMany.functions[0]);
    assert.match(buildBlock(tooMany).errors[0].message, /8 functions/);
    const timerSet = draft(); timerSet.functions[2].effects = [{ field: 'mood', op: 'set', value: 'awake' }];
    assert.equal(buildBlock(timerSet).ok, false, 'the existing timer contract refuses set effects');
});

test('a generated numeric change uses the maximum field value for its symmetric label bounds', () => {
    const form = draft();
    form.fields[1].min = -100;
    form.fields[1].max = 10;
    const built = buildBlock(form);
    assert.equal(built.ok, true, JSON.stringify(built.errors));
    assert.deepEqual(built.definition.kinds['change-fatigue'].labels.by, { type: 'int', min: -10, max: 10 });
});

test('a numeric timer set uses the existing additive interpreter and runs once after elapsed periods', async t => {
    const form = draft();
    form.functions = [{ type: 'timer', name: 'Reset', every: 60, effects: [{ field: 'fatigue', op: 'set', value: 4 }] }];
    const built = buildBlock(form);
    assert.equal(built.ok, true, JSON.stringify(built.errors));
    assert.equal(blockDraft(built.checked).functions[0].effects[0].op, 'set');
    const host = await createHost({ modules: [directorStub()] }); t.after(() => host.close());
    await host.send('Begin.', 'Opening.');
    assert.equal((await host.sdk.command('dm.define', { definition: built.definition })).ok, true);
    await host.send('Wait.', reply('! time 180'));
    assert.equal(view(host, 'pack.chat/wessel-s-notes').chat.fatigue, 4);
    await reload(host);
});

test('an unchanged timer keeps its partially elapsed interval when a block is redefined', async t => {
    const form = draft();
    form.functions = [{ type: 'timer', name: 'Passing time', every: 60, effects: [{ field: 'fatigue', op: 'add', value: 1 }] }];
    const built = buildBlock(form), id = 'pack.chat/wessel-s-notes';
    const host = await createHost({ modules: [directorStub()] }); t.after(() => host.close());
    await host.send('Begin.', 'Opening.');
    assert.equal((await host.sdk.command('dm.define', { definition: built.definition })).ok, true);
    await host.send('Wait.', reply('! time 30'));
    assert.equal(view(host, id).chat.fatigue, 0);
    assert.equal((await host.sdk.command('dm.redefine', { module: id, definition: built.definition })).ok, true);
    await host.send('Wait again.', reply('! time 30'));
    assert.equal(view(host, id).chat.fatigue, 1);
    await reload(host);
});
