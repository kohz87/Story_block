// The assist part (MODULES §A): its shape, its settings (off by default, the overlay's field types),
// assist.status, the Assist settings section, and the SillyTavern adapter.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULTS, PRECHECK, SCHEMA, SETTING, STATUS_QUERY, answerText, createAssistPart, findProfile, part, renderAssistSection,
    runLine, sdkHasKind, stCallModel, stChat, stChatId, withTimeout,
} from '../../../src/v2/assist/index.js';
import { createRegistry, definitionProblems } from '../../../src/v2/registry.js';
import { installFakeDom, texts } from '../../ui-fake-dom.js';
import { fakeModel, on, user, view } from './helpers/fakes.js';

test('the part: one command, one query, two hooks, an Assist settings section, no domain', () => {
    assert.deepEqual(Object.keys(part.commands), [PRECHECK]);
    assert.deepEqual(Object.keys(part.queries), [STATUS_QUERY]);
    assert.deepEqual(Object.keys(part.hooks).sort(), ['afterReply', 'beforeGenerate']);
    assert.deepEqual(part.domains, {});
    assert.deepEqual(part.kinds, {});
    assert.deepEqual(part.tabs, []);
    assert.equal(part.context, undefined, 'nothing in the static prompt: the pre-roll arrives as an untold receipt');
    assert.equal(part.settings.section, 'Assist');
    assert.equal(typeof part.settings.render, 'function');
});

test('settings: both helpers off by default, fields the overlay knows, the module registers', () => {
    assert.deepEqual(part.settings.defaults, { assistClassifier: false, assistExtractor: false, assistProfile: '' });
    assert.deepEqual(DEFAULTS, part.settings.defaults);
    // The two switches are Story Block's features now (MODULES §F100); only the profile is a settings field.
    assert.deepEqual(Object.fromEntries(Object.entries(SCHEMA).map(([key, field]) => [key, field.type])), { assistProfile: 'profile' });
    for (const field of Object.values(SCHEMA)) assert.ok(field.label && field.help);
    const def = { id: 'story-block', commands: part.commands, queries: part.queries, hooks: part.hooks, settings: part.settings };
    assert.deepEqual(definitionProblems(def), []);
    const registry = createRegistry();
    registry.register(def);
    assert.equal(registry.settingsDefs()[0].title, 'Assist');
});

test('assist.status: on/off from the settings, the profile, the runs newest last', async () => {
    let settings = on({ classifier: true, profile: '  Cheap  ' });
    const assist = createAssistPart({ callModel: fakeModel('none'), settings: () => settings, chat: () => [user('I climb.')], chatId: () => 'c', hasKind: () => true, warn: () => {} });
    const status = assist.queries[STATUS_QUERY];
    assert.deepEqual(status(null), { classifier: { on: true, last: null }, extractor: { on: false, last: null }, profile: 'Cheap', runs: [] });
    await assist.hooks.beforeGenerate(view());
    const after = status(null, undefined, { query: () => null });
    assert.equal(after.classifier.last.outcome, 'none');
    assert.equal(after.classifier.last.seq, 1);
    assert.equal(after.runs.length, 1);
    settings = {};
    assert.equal(status().classifier.on, false, 'missing settings are the defaults');
    assert.doesNotThrow(() => JSON.stringify(status()));
});

test('the Assist section shows the switches and the last runs as text, and refreshes', () => {
    const previous = globalThis.document;
    try {
        const el = installFakeDom().createElement('div');
        let value = { classifier: { on: true }, extractor: { on: false }, profile: 'Cheap', runs: [] };
        renderAssistSection(el, () => value);
        assert.deepEqual(texts(el, '.ss-assist-state'), ['Pre-roll checks: on. Reading forgotten changes: off.']);
        assert.deepEqual(texts(el, '.ss-assist-profile'), ['Calls go through the profile "Cheap".']);
        assert.deepEqual(texts(el, '.ss-assist-empty'), ['No runs yet in this session.']);
        value = { ...value, runs: [
            { seq: 1, helper: 'classifier', outcome: 'check', line: '? check stealth | dc: hard' },
            { seq: 2, helper: 'extractor', outcome: 'lines', lines: 2 },
            { seq: 3, helper: 'extractor', outcome: 'timeout', message: '<b>no answer</b>' },
        ] };
        el.querySelector('.ss-assist-refresh').click();
        assert.deepEqual(texts(el, '.ss-assist-run'), [
            'Reading changes: gave up waiting (<b>no answer</b>).',
            'Reading changes: found changes (2 lines).',
            'Pre-roll: turned the message into a check (? check stealth | dc: hard).',
        ]);
        renderAssistSection(el, () => { throw new Error('gone'); });
        assert.match(texts(el, '.ss-assist-run')[0], /could not be read: gone/);
        // The part's own render, with the overlay's api.query.
        const asked = [];
        part.settings.render(el, { query: name => { asked.push(name); return value; } });
        assert.deepEqual(asked, [STATUS_QUERY]);
        assert.equal(texts(el, '.ss-assist-run').length, 3);
    } finally {
        if (previous === undefined) delete globalThis.document;
        else globalThis.document = previous;
    }
    assert.equal(runLine({ helper: 'classifier', outcome: 'none' }), 'Pre-roll: found nothing to check.');
});

test('withTimeout passes answers and errors through and clears its timer', async () => {
    const cleared = [];
    const timer = { set: () => 7, clear: handle => cleared.push(handle) };
    assert.equal(await withTimeout(() => 'ok', 100, timer), 'ok');
    await assert.rejects(withTimeout(() => { throw new Error('no'); }, 100, timer), /no/);
    assert.deepEqual(cleared, [7, 7]);
});

function withSillyTavern(ctx, fn) {
    const previous = globalThis.SillyTavern;
    globalThis.SillyTavern = { getContext: () => ctx };
    return Promise.resolve().then(fn).finally(() => {
        if (previous === undefined) delete globalThis.SillyTavern;
        else globalThis.SillyTavern = previous;
    });
}

test('the adapter: generateRaw in either form, a named profile through the Connection Manager', async () => {
    await assert.rejects(stCallModel('x'), /SillyTavern is not available/);
    assert.deepEqual(stChat(), []);
    assert.equal(stChatId(), '');

    const calls = [];
    await withSillyTavern({ generateRaw: async options => { calls.push(options); return ' none '; }, chat: [user('a')], getCurrentChatId: () => 'chat-9' }, async () => {
        assert.equal(await stCallModel('prompt text', { maxTokens: 60 }), ' none ');
        assert.equal(stChat().length, 1);
        assert.equal(stChatId(), 'chat-9');
    });
    assert.deepEqual(calls, [{ prompt: 'prompt text', responseLength: 60 }]);

    const positional = [];
    async function oldRaw(prompt, api, instructOverride, quietToLoud, systemPrompt, responseLength) { positional.push([...arguments]); return 'ok'; }
    await withSillyTavern({ generateRaw: oldRaw }, async () => assert.equal(await stCallModel('p', { maxTokens: 50 }), 'ok'));
    assert.deepEqual(positional, [['p', '', false, false, '', 50]]);

    const sent = [];
    const ctx = {
        generateRaw: async () => { throw new Error('the current connection must not be used'); },
        extensionSettings: { connectionManager: { profiles: [{ id: 'p1', name: 'Cheap Model' }] } },
        ConnectionManagerRequestService: { sendRequest: async (...args) => { sent.push(args); return { content: '? check lore — the runes | dc: easy' }; } },
    };
    await withSillyTavern(ctx, async () => {
        assert.equal(await stCallModel('q', { maxTokens: 80, profile: ' cheap model ' }), '? check lore — the runes | dc: easy');
        await assert.rejects(stCallModel('q', { profile: 'Missing' }), /no connection profile called "Missing"/);
    });
    assert.deepEqual(sent, [['p1', [{ role: 'user', content: 'q' }], 80]]);
    await withSillyTavern({ extensionSettings: {} }, () => assert.rejects(stCallModel('q', { profile: 'Cheap' }), /no Connection Manager/));
    await withSillyTavern({}, () => assert.rejects(stCallModel('q'), /no generateRaw/));

    assert.equal(findProfile({}, 'x'), null);
    assert.equal(answerText({ choices: [{ message: { content: 'hi' } }] }), 'hi');
    assert.equal(answerText({ choices: [{ text: 'yo' }] }), 'yo');
    assert.equal(answerText(null), '');
});

test('sdkHasKind reads the module list of the public sdk', () => {
    const previous = globalThis.StoryBlock;
    try {
        delete globalThis.StoryBlock;
        assert.equal(sdkHasKind('check'), false);
        globalThis.StoryBlock = { sdk: { modules: () => [{ id: 'rpg-battle', kinds: ['check', 'wound'] }] } };
        assert.equal(sdkHasKind('check'), true);
        assert.equal(sdkHasKind('quest'), false);
    } finally {
        globalThis.StoryBlock = previous;
    }
    assert.equal(SETTING.profile, 'assistProfile');
});
