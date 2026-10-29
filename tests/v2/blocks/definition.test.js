import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { validateDataModules } from '../../../src/v2/data-modules/check.js';
import { grammarFor, summaryOf } from '../../../src/v2/data-modules/part.js';
import { kindGrammar, moduleGrammar } from '../../../src/v2/data-modules/grammar.js';
import { estimateTokens } from '../../../src/v2/prompt.js';
import { definition, reload, view } from '../data-modules/helpers.js';

const check = input => validateDataModules([input], { packId: 'chat', capabilities: ['data-modules-v1'] });
const block = () => ({ ...definition(), slug: 'notes', name: 'Notes', state: {
    mood: { type: 'text', max: 3, default: '' }, contacts: { type: 'text', max: 240, default: '', list: true },
}, kinds: {
    'set-mood': { op: '~', labels: { to: { type: 'text', max: 3 } }, effects: [{ op: 'set', path: ['mood'], value: { arg: 'to' } }] },
    'set-contacts': { op: '~', labels: { to: { type: 'text', max: 240 } }, effects: [{ op: 'set', path: ['contacts'], value: { arg: 'to' } }] },
}, prompt: 'Keep track of\n these notes.', show: { tab: true, card: false, tabName: 'Notes', icon: 'ph-bookmark-simple' } });

test('purpose, display settings and list fields are checked with the normal definition validator', () => {
    const good = check(block());
    assert.equal(good.ok, true, JSON.stringify(good.errors));
    assert.equal(good.definitions[0].prompt, 'Keep track of these notes.');
    for (const change of [
        d => { d.prompt = '😀'.repeat(601); },
        d => { d.show.icon = 'not-an-icon'; },
        d => { d.show.tab = false; d.show.card = false; },
        d => { d.show.tabName = 'a'.repeat(25); },
        d => { d.state.mood.list = 'yes'; },
        d => { d.state.points = { type: 'int', min: 0, max: 1, default: 0, list: true }; },
        d => { d.state.contacts.default = Array.from({ length: 13 }, (_, i) => `x${i}`).join('; '); },
    ]) {
        const d = block(); change(d);
        assert.equal(check(d).ok, false, JSON.stringify(d));
    }
    const large = block();
    large.kinds = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`kind-${i}`, {
        op: '~', labels: { choice: { type: 'enum', values: Array.from({ length: 32 }, (_, j) => `choice-${i}-${j}`) } }, effects: [],
    }]));
    assert.ok(check(large).errors.some(error => error.code === 'DM_BUDGET'));
    const tooManyEntries = block();
    tooManyEntries.kinds['set-contacts'].effects[0].value = Array.from({ length: 13 }, (_, i) => `x${i}`).join('; ');
    assert.equal(check(tooManyEntries).ok, false);
});

test('module names count Unicode code points', () => {
    const d = block();
    d.name = '😀'.repeat(80);
    assert.equal(check(d).ok, true);
    d.name += '😀';
    assert.equal(check(d).ok, false);
});

test('the last grammar line is kept when purpose and grammar exactly fill the static budget', () => {
    const d = block(); d.state = {}; d.prompt = 'x'.repeat(600);
    d.kinds = { example: { op: '~', labels: { item: { type: 'enum', values: ['a'] } }, effects: [] } };
    const probe = { ...d, id: 'pack.chat/notes', pack: 'chat' };
    const base = [...kindGrammar(probe, 'example', probe.id)].length;
    d.kinds.example.labels.item.values = ['a'.repeat(1 + 1399 - base)];
    const checked = check(d);
    assert.equal(checked.ok, true, JSON.stringify(checked.errors));
    const grammar = moduleGrammar(checked.definitions[0], 'pack.chat/notes');
    assert.equal([...grammar].length, 2000);
    assert.match(grammar, /kind: example/);
});

test('list edits and story lines are bounded, Unicode-safe and survive replay', async t => {
    const host = await createHost(); t.after(() => host.close());
    await host.send('Begin.', 'Opening.');
    assert.equal((await host.sdk.command('dm.define', { definition: block() })).ok, true);
    const id = 'pack.chat/notes';
    const set = (field, value) => host.sdk.command('dm.set', { module: id, field, value });
    assert.equal((await set('mood', '😀👍aZ')).ok, true);
    assert.equal(view(host, id).chat.mood, '😀👍a');
    assert.equal((await set('contacts', ['Mara', ' Old Teo '])).ok, true);
    assert.equal(view(host, id).chat.contacts, 'Mara; Old Teo');
    assert.equal((await set('contacts', Array.from({ length: 13 }, (_, i) => `person ${i}`))).ok, false);
    await host.send('Change.', 'The story.\n<Changes>\n~ dm notes — a mood | kind: set-mood | to: 😀😃😄😁\n~ dm notes — friends | kind: set-contacts | to: Mara; Teo\n</Changes>');
    assert.deepEqual(view(host, id).chat, { mood: '😀😃😄', contacts: 'Mara; Teo' });
    const grammar = grammarFor(host.head());
    assert.ok(grammar.indexOf('Keep track of these notes.') < grammar.indexOf('kind: set-mood'));
    assert.match(grammar, /kind: set-contacts \| to: text/);
    assert.match(summaryOf(host.head(), id), /Mara; Teo/);
    await reload(host);
});

test('an emoji-heavy module tail stays within the host token estimate without splitting a character', async t => {
    const host = await createHost(); t.after(() => host.close());
    await host.send('Begin.', 'Opening.');
    const d = block();
    d.state.mood = { type: 'text', max: 240, default: '😀'.repeat(240) };
    d.state.contacts = { type: 'text', max: 240, default: '👍'.repeat(240), list: true };
    assert.equal((await host.sdk.command('dm.define', { definition: d })).ok, true);
    const summary = summaryOf(host.head(), 'pack.chat/notes');
    assert.ok(estimateTokens(summary) <= 100);
    assert.equal(summary.isWellFormed(), true);
    await reload(host);
});
