// Settings round 3 (the user's live test #4): a module's own panel right in its fold (never a sub-fold),
// the assist's connection-profile dropdown, and the Diagnostics fold with its report.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, texts } from '../ui-fake-dom.js';
import { createRegistry } from '../../src/v2/registry.js';
import { createSettings } from '../../src/v2/sdk.js';
import { DIAGNOSTICS_FOLD, DIAGNOSTICS_TEXT, renderSettingsHost } from '../../src/v2/host-ui.js';
import { createFeatureStore } from '../../src/v2/features.js';
import { SCHEMA, SETTING, createAssistPart, stCallModel } from '../../src/v2/assist/index.js';
import { listProfiles } from '../../src/v2/model-call.js';
import {
    REMOVED, buildReport, captureConsole, caughtSoFar, chatCounts, isSecretKey, noteError, noteSaveError, reportFileName, resetCaught,
    scrubLine, scrubSecrets, scrubSettings,
} from '../../src/v2/diagnostics.js';

const doc = installFakeDom();

function setup(...defs) {
    const registry = createRegistry();
    for (const def of defs) registry.register(def);
    const es = {};
    const settings = createSettings({ root: () => es, registry, save: () => {} });
    return { registry, es, settings };
}
const foldOf = (root, key) => root.querySelectorAll('details').find(node => node.dataset.fold === key);
// How many <details> hold `node` (the overlay's own top folds count as one).
const depth = node => {
    let n = 0;
    for (let at = node.parentNode; at; at = at.parentNode) if (at.tagName === 'DETAILS') n += 1;
    return n;
};

// ---- 1. a module's own panel ------------------------------------------------------------------

// Like NPC State Delta: features, schema fields in two groups, and a big panel with folds of its own.
const delta = () => ({
    id: 'npc-state-delta',
    name: 'NPC State Delta',
    features: [{ id: 'npc-state-delta.meters', label: 'Meters', default: true }, { id: 'npc-state-delta.stages', label: 'Stages', default: false }],
    settings: {
        defaults: { drift: 1, label: 'x' },
        schema: { drift: { type: 'int', label: 'Meters: Drift' }, label: { type: 'text', label: 'Names: Label' } },
        section(el) {
            const drawer = el.ownerDocument.createElement('div');
            drawer.className = 'inline-drawer story-suite-drawer';
            for (const name of ['Scanning', 'Roster']) {
                const group = el.ownerDocument.createElement('details');
                group.className = 'delta-settings-group story-suite-fold';
                group.dataset.deltaSettingsGroup = name.toLowerCase();
                const select = el.ownerDocument.createElement('select');
                select.id = `delta_${name.toLowerCase()}`;
                group.appendChild(select);
                drawer.appendChild(group);
            }
            el.appendChild(drawer);
        },
    },
});

test('a module\'s custom panel is in its fold itself, right after the features line; its groups are sub-folds below it', () => {
    const { registry, settings } = setup(delta());
    const features = createFeatureStore({ registry, root: () => ({}) });
    const root = doc.createElement('div');
    renderSettingsHost(root, { registry, settings, doc, features });
    const fold = foldOf(root, 'npc-state-delta');
    const body = fold.querySelector('.story-suite-fold-body');
    const kids = body.children.map(node => node.className);
    assert.equal(kids[0], 'story-suite-feature-line', 'the features line first');
    assert.equal(kids[1], 'story-suite-section', 'then the panel, not in a sub-fold');
    assert.deepEqual(kids.slice(2), ['story-suite-subfold', 'story-suite-subfold'], 'then the schema groups');
    assert.deepEqual(body.children.slice(2).map(node => node.dataset.fold), ['npc-state-delta::group:Meters', 'npc-state-delta::group:Names']);
    assert.equal(fold.querySelectorAll('details').filter(node => node.dataset.fold === 'npc-state-delta::section').length, 0, 'no "More" sub-fold');
    // The panel's own folds are the second level, its controls inside them: never three folds deep.
    for (const id of ['delta_scanning', 'delta_roster']) assert.equal(depth(root.querySelectorAll('select').find(node => node.id === id)), 2);
    assert.equal(texts(fold, '.story-suite-feature-link')[0], 'Features: 1 of 2 on — change');
});

test('a panel alone (no schema, no features) is drawn straight into its fold; a broken panel says so there', () => {
    const { registry, settings } = setup(
        { id: 'alone', name: 'Alone', settings: { section(el) { el.textContent = 'Mine'; } } },
        { id: 'broken', name: 'Broken', settings: { section() { throw new Error('boom'); } } },
    );
    const root = doc.createElement('div');
    renderSettingsHost(root, { registry, settings, doc });
    const alone = foldOf(root, 'alone');
    assert.equal(alone.querySelector('.story-suite-section').textContent, 'Mine');
    assert.equal(depth(alone.querySelector('.story-suite-section')), 1);
    assert.equal(alone.querySelectorAll('.story-suite-subfold').length, 0);
    assert.match(foldOf(root, 'broken').querySelector('.story-suite-section').textContent, /could not be shown: boom/);
});

test('every module\'s controls sit at most two folds deep (Story Block\'s own module too)', async () => {
    const { createCoreModule } = await import('../../src/v2/domains/index.js');
    const core = createCoreModule();
    const { registry, settings } = setup(core, delta(), { id: 'rpg-battle', name: 'RPG Battle', settings: { schema: { a: { type: 'bool', label: 'Combat: A' } } } });
    const root = doc.createElement('div');
    renderSettingsHost(root, { registry, settings, doc });
    const controls = root.querySelectorAll('input, select, textarea');
    assert.ok(controls.length > 5);
    for (const control of controls) assert.ok(depth(control) <= 2, `${control.id} is ${depth(control)} folds deep`);
    // Story Block's Assist panel is in its fold; its profile dropdown in the Assist group, two folds deep.
    const sb = foldOf(root, 'story-block');
    assert.ok(texts(sb, '.story-suite-section h4').includes('Assist'));
    assert.equal(depth(sb.querySelector('.story-suite-row[data-field="assistProfile"] select')), 2);
});

// ---- 2. the assist's connection profile: the shared `profile` field (MODULES §G) -----------------

function withSillyTavern(ctx, fn) {
    const previous = globalThis.SillyTavern;
    globalThis.SillyTavern = { getContext: () => ctx };
    return Promise.resolve().then(fn).finally(() => {
        if (previous === undefined) delete globalThis.SillyTavern;
        else globalThis.SillyTavern = previous;
    });
}
const stWith = (profiles, { calls = [], disabled = [] } = {}) => ({
    ConnectionManagerRequestService: {
        isProfileSupported: profile => Boolean(profile?.api),
        sendRequest: async (id, messages, maxTokens) => { calls.push({ id, messages, maxTokens }); return { content: 'none' }; },
    },
    extensionSettings: { connectionManager: { profiles }, disabledExtensions: disabled },
});
function storyBlockSettings() {
    let read = () => ({});
    const assist = createAssistPart({ moduleId: 'story-block', settings: () => read() });
    const made = setup({ id: 'story-block', name: 'Story Block', settings: assist.settings });
    read = () => made.settings('story-block');
    return made;
}
const assistRow = root => root.querySelector('.story-suite-row[data-field="assistProfile"]');

test('the assist profile is a `profile` field in its own Assist group: Same as chat, then the profiles; the pick is kept and used', async () => {
    assert.equal(SCHEMA[SETTING.profile].type, 'profile');
    const calls = [];
    const ctx = stWith([{ id: 'p2', name: 'Big', api: 'openai', 'api-url': 'http://10.0.0.9/v1' }, { id: 'p1', name: 'Cheap', api: 'openai' }, { id: 'p3', name: 'No API' }], { calls });
    await withSillyTavern(ctx, async () => {
        const { registry, settings, es } = storyBlockSettings();
        const root = doc.createElement('div');
        renderSettingsHost(root, { registry, settings, doc });
        const row = assistRow(root);
        assert.equal(row.closest('details').dataset.fold, 'story-block::group:Assist');
        assert.equal(depth(row), 2, 'two folds deep');
        const select = row.querySelector('select');
        assert.deepEqual(select.querySelectorAll('option').map(node => [node.value, node.textContent]), [['', 'Same as chat'], ['Big', 'Big'], ['Cheap', 'Cheap']]);
        assert.equal(row.querySelector('.story-suite-profile-note'), null, 'nothing to say');
        select.value = 'Cheap';
        select.dispatch('change');
        assert.equal(es.storySuite.modules['story-block'].assistProfile, 'Cheap', 'stored');
        const again = doc.createElement('div');
        renderSettingsHost(again, { registry, settings, doc });
        assert.equal(assistRow(again).querySelector('select').value, 'Cheap', 'drawn again (a reload): the choice shows');
        assert.deepEqual(texts(again, '.ss-assist-profile'), ['Calls go through the profile "Cheap".']);
        assert.equal(await stCallModel('q', { maxTokens: 40, profile: settings('story-block').assistProfile }), 'none');
        assert.deepEqual(calls.map(call => [call.id, call.maxTokens]), [['p1', 40]], 'the call went through that profile');
        assert.ok(!JSON.stringify(listProfiles(ctx)).includes('10.0.0.9'), 'the list holds names and ids only');
    });
});

test('the assist profile: no profile yet, Connection Profiles off, or a profile gone: a plain note, the choice never moved', async () => {
    await withSillyTavern(stWith([]), () => {
        const { registry, settings } = storyBlockSettings();
        const root = doc.createElement('div');
        renderSettingsHost(root, { registry, settings, doc });
        assert.match(assistRow(root).querySelector('.story-suite-profile-note').textContent, /There are no connection profiles yet/);
        assert.equal(assistRow(root).querySelectorAll('option').length, 1);
    });
    await withSillyTavern(stWith([{ id: 'p1', name: 'Cheap', api: 'openai' }], { disabled: ['connection-manager'] }), () => {
        const { registry, settings } = storyBlockSettings();
        const root = doc.createElement('div');
        renderSettingsHost(root, { registry, settings, doc });
        assert.match(assistRow(root).querySelector('.story-suite-profile-note').textContent, /turned off/);
    });
    await withSillyTavern(stWith([{ id: 'p1', name: 'Cheap', api: 'openai' }]), () => {
        const { registry, settings, es } = storyBlockSettings();
        settings.set('story-block', 'assistProfile', 'Old one');
        const root = doc.createElement('div');
        renderSettingsHost(root, { registry, settings, doc });
        assert.equal(assistRow(root).querySelector('select').value, 'Old one');
        assert.match(assistRow(root).querySelector('.story-suite-profile-note').textContent, /not in the Connection Manager any more/);
        assert.equal(es.storySuite.modules['story-block'].assistProfile, 'Old one');
    });
});

// ---- 3. Diagnostics ---------------------------------------------------------------------------

test('secret keys are left out by name; tokens counts are kept', () => {
    for (const key of ['apiKey', 'api_key', 'openaiApiKey', 'authToken', 'password', 'endpoint', 'endpointUrl', 'proxy_password', 'secret', 'session', 'cookie', 'privateKey', 'url'])
        assert.ok(isSecretKey(key), key);
    for (const key of ['maxTokens', 'scannerMaxOutputTokens', 'tailBudget', 'currency', 'keyword', 'passive', 'skirmisher', 'monkey'])
        assert.ok(!isSecretKey(key), key);
    const removed = [];
    const out = scrubSettings({ apiKey: 'sk-abcdefghijklmnopqrstuvwxyz', nested: { authToken: 'x', ok: 1, list: [{ password: 'p', name: 'Anna' }] }, scannerMaxOutputTokens: 900 }, removed);
    assert.deepEqual(out, { nested: { ok: 1, list: [{ name: 'Anna' }] }, scannerMaxOutputTokens: 900 });
    assert.deepEqual(removed, ['apiKey', 'nested.authToken', 'nested.list[0].password']);
});

test('values that look like a secret or an address are replaced; quoted text keeps only its length', () => {
    for (const secret of ['sk-proj-abcdefghijklmnopqrstu', 'Bearer abc.def', 'https://user:pw@host.example/v1?key=1', 'ghp_abcdefghijklmnopqrstuv1234', 'api_key=hunter2', 'AIzaSyAbcdefghijklmnopqrstu', '0123456789abcdef0123456789abcdef'])
        assert.ok(!scrubSecrets(`x ${secret} y`).includes(secret.slice(4, 12)), secret);
    assert.equal(scrubSecrets('skirmisher, archer'), 'skirmisher, archer');
    assert.equal(scrubLine('Line 3 "Anna kissed Bram" is not a change line.'), 'Line 3 "[16 characters]" is not a change line.');
    assert.equal(scrubLine('a\n\nb'), 'a b');
    assert.equal(scrubSettings('x'.repeat(500)).length < 260, true);
    assert.deepEqual(scrubSettings(Array.from({ length: 25 }, (_, i) => i)).slice(-2), [19, '+5 more']);
});

test('chatCounts: messages, replies, records and the size, without reading any text', () => {
    const chat = [{ is_user: false, mes: 'Hello' }, { is_user: true, mes: 'Hi' }, { is_user: false, mes: 'Yes', extra: { storySuite: { sid: 'a' } } }, { is_system: true, mes: 'note' }];
    const counts = chatCounts(chat);
    assert.deepEqual({ ...counts, bytes: counts.bytes > 0 }, { messages: 4, replies: 2, records: 1, bytes: true });
    assert.deepEqual(chatCounts(null), { messages: 0, replies: 0, records: 0, bytes: 0 });
});

const CHAT_TEXT = 'Anna whispered the password swordfish to Bram';
function source(extra = {}) {
    return {
        stVersion: async () => 'SillyTavern 1.19.0',
        hostVersion: '2.0.0-alpha.2',
        modules: () => [{ id: 'npc-state-delta', name: 'NPC State Delta', version: '1.2.19' }, { id: 'story-block', name: 'Story Block', version: '2.0.0-alpha.2' }],
        refusals: () => [{ id: 'old-mod', message: 'needs Story Block 3' }],
        features: () => [{ id: 'story-block.hud', on: true }, { id: 'story-block.preroll', on: false }, { id: 'npc-state-delta.x', on: true, available: false }],
        hostSettings: () => ({ tailBudget: 600 }),
        settingsOf: id => (id === 'story-block' ? { currency: 'gold', assistProfile: 'p1', apiKey: 'sk-live-0123456789abcdefghij' } : { scannerConnectionProfile: 'p2', proxyUrl: 'http://10.0.0.1:8080' }),
        promptParts: () => ({ parts: [{ module: 'story-block', place: 'static', text: 'x'.repeat(40) }, { module: 'npc-state-delta', place: 'tail', text: 'y'.repeat(80) }], fit: { size: 8192, reply: 512, share: 1200, room: 3000, percent: 40, budget: 600 } }),
        problems: () => Array.from({ length: 25 }, (_, i) => ({ module: 'story-block', code: 'BAD_LINE', message: `Line ${i} "${CHAT_TEXT}" is not a change line.`, index: i })),
        save: () => ({ failing: false, dirty: true, suspect: false }),
        caught: () => ({ errors: [{ text: '[Story Suite] boom' }], saves: [{ text: 'Network down' }], saveFailures: 1 }),
        chat: () => [{ is_user: false, mes: CHAT_TEXT, extra: { storySuite: { sid: 's' } } }, { is_user: true, mes: CHAT_TEXT }],
        chatOpen: () => true,
        hooks: () => [{ moduleId: 'npc-state-delta', fn: () => ({ lines: ['Scanner: idle'], data: { lastOutcome: 'success', apiKey: 'sk-zzzzzzzzzzzzzzzzzzzzzz' } }) }],
        now: () => new Date('2026-10-22T09:30:00Z'),
        ...extra,
    };
}

test('the report: versions, features, settings, prompt size, the last 20 problems, saving, the chat, errors, module sections', async () => {
    const text = await buildReport(source());
    for (const part of ['== Versions ==', 'SillyTavern: SillyTavern 1.19.0', 'Story Block: 2.0.0-alpha.2', 'NPC State Delta (npc-state-delta): 1.2.19', 'Not loaded: old-mod: needs Story Block 3',
        '== Features ==', '1 of 3 on.', 'On: story-block.hud', 'npc-state-delta.x (unavailable)',
        '== Settings ==', 'story-block: {"currency":"gold","assistProfile":"p1"}', 'left out: apiKey', 'npc-state-delta: {"scannerConnectionProfile":"p2"}', 'left out: proxyUrl',
        '== Prompt size ==', 'Instructions: 10. This reply\'s part: 20 of 600. In all: 30.', 'Context size: 8,192 tokens (512 for the reply). Story Suite\'s share: 1,200 of 3,000 (40%).',
        '== Problems (the last 20) ==', '[BAD_LINE] story-block, reply 24', '== Saving ==', 'Unsaved changes: yes.', 'Failed saves this page load: 1.', '- Network down',
        '== This chat ==', 'Messages: 2. Replies: 1. Replies with a Story Suite record: 1.', '== Recent Story Suite errors ==', '- [Story Suite] boom',
        '== NPC State Delta (its own) ==', 'Scanner: idle', 'lastOutcome: success', '(left out: apiKey)'])
        assert.ok(text.includes(part), `missing: ${part}\n${text}`);
    assert.equal((text.match(/\[BAD_LINE\]/g) ?? []).length, 20);
    assert.ok(!text.includes('reply 4,') && !text.includes('reply 4:'), 'only the last 20');
    for (const leak of ['swordfish', 'Anna', 'sk-live', 'sk-zzz', '10.0.0.1', 'whispered']) assert.ok(!text.includes(leak), `leaked ${leak}`);
});

test('the report goes on when a part fails: a hook that throws or never answers, no chat, no prompt', async () => {
    const slow = () => new Promise(() => {});
    const text = await buildReport(source({
        stVersion: async () => { throw new Error('offline'); },
        settingsOf: () => { throw new Error('bad'); },
        promptParts: () => null,
        chatOpen: () => false,
        problems: () => [],
        hooks: () => [{ moduleId: 'npc-state-delta', fn: () => { throw new Error('no scanner'); } }, { moduleId: 'slow-mod', fn: slow }],
    }));
    assert.match(text, /SillyTavern: unknown/);
    assert.match(text, /could not be read: bad/);
    assert.match(text, /No chat open \(nothing to count\)/);
    assert.match(text, /No chat open\./);
    assert.match(text, /Problems \(the last 20\) ==\nNone\./);
    assert.match(text, /\(could not be read: no scanner\)/);
    assert.match(text, /slow-mod \(its own\) ==\n\(no answer within 2 s\)/);
});

test('console capture keeps Story Suite\'s errors only, made safe; save errors are counted', () => {
    resetCaught();
    const printed = [];
    const fakeConsole = { error: (...parts) => printed.push(parts.join(' ')) };
    const stop = captureConsole(fakeConsole, null);
    fakeConsole.error('[Story Suite] the save failed "Anna said hi" at https://host.example/x');
    fakeConsole.error('Some other extension failed');
    fakeConsole.error('[NPC State Delta] scan failed', new Error('Bearer abc123'));
    assert.equal(printed.length, 3, 'the console still prints everything');
    assert.deepEqual(caughtSoFar().errors.map(item => item.text), [
        `[Story Suite] the save failed "[12 characters]" at ${REMOVED}`,
        `[NPC State Delta] scan failed Error: ${REMOVED}`,
    ]);
    stop();
    fakeConsole.error('[Story Suite] after stop');
    assert.equal(caughtSoFar().errors.length, 2);
    assert.equal(noteError('plain'), false);
    noteSaveError(new Error('disk full'));
    assert.deepEqual(caughtSoFar().saves.map(item => item.text), ['disk full']);
    assert.equal(caughtSoFar().saveFailures, 1);
    resetCaught();
});

test('the Diagnostics fold: last before Versions; built on open; Copy uses the clipboard, else selects the text; Save downloads a .txt', async () => {
    const { registry, settings } = setup({ id: 'aaa', name: 'AAA', settings: { schema: { on: 'bool' } } });
    const copied = [];
    const links = [];
    const selected = [];
    doc.defaultView = {
        navigator: { clipboard: { writeText: async text => { copied.push(text); } } },
        Blob: class { constructor(parts, options) { this.parts = parts; this.type = options.type; } },
        URL: { createObjectURL: blob => { links.push(blob); return 'blob:1'; }, revokeObjectURL: () => {} },
        getSelection: () => ({ removeAllRanges: () => {}, addRange: range => selected.push(range) }),
    };
    doc.createRange = () => ({ selectNodeContents: node => { selected.push(node); } });
    try {
        let builds = 0;
        const root = doc.createElement('div');
        renderSettingsHost(root, { registry, settings, doc, diagnostics: { report: async () => { builds += 1; return `REPORT ${builds}`; }, fileName: () => 'story-suite-diagnostics-x.txt' } });
        assert.deepEqual(root.children.map(node => node.dataset.fold), ['story-suite', 'aaa', DIAGNOSTICS_FOLD, 'story-suite-versions']);
        const fold = foldOf(root, DIAGNOSTICS_FOLD);
        assert.deepEqual(fold.querySelectorAll(':scope > summary > *').map(node => node.textContent), [DIAGNOSTICS_TEXT.title, DIAGNOSTICS_TEXT.hint]);
        assert.equal(builds, 0, 'nothing built while it is closed');
        fold.open = true;
        fold.dispatch('toggle');
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(fold.querySelector('.story-suite-diagnostics-report').textContent, 'REPORT 1');
        fold.querySelector('.story-suite-diagnostics-copy').click();
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.deepEqual(copied, ['REPORT 2']);
        assert.equal(fold.querySelector('.story-suite-diagnostics-status').textContent, DIAGNOSTICS_TEXT.copied);
        fold.querySelector('.story-suite-diagnostics-save').click();
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.deepEqual(links.map(blob => [blob.parts[0], blob.type]), [['REPORT 3', 'text/plain;charset=utf-8']]);
        assert.equal(fold.querySelector('.story-suite-diagnostics-status').textContent, 'Saved the report as story-suite-diagnostics-x.txt.');
        // No clipboard here: the report is selected for copying by hand.
        doc.defaultView.navigator = {};
        fold.querySelector('.story-suite-diagnostics-copy').click();
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(fold.querySelector('.story-suite-diagnostics-status').textContent, DIAGNOSTICS_TEXT.copyFailed);
        assert.equal(selected[0], fold.querySelector('.story-suite-diagnostics-report'));
    } finally {
        delete doc.defaultView;
        delete doc.createRange;
    }
    // Without a diagnostics source there is no fold.
    const plain = doc.createElement('div');
    renderSettingsHost(plain, { registry, settings, doc });
    assert.equal(foldOf(plain, DIAGNOSTICS_FOLD), undefined);
});

test('a module\'s hooks.diagnostics registers quietly (no warning) and is offered to the report', () => {
    const { registry } = setup({ id: 'npc-state-delta', name: 'NPC State Delta', hooks: { diagnostics: () => 'Scanner: idle' } });
    assert.deepEqual(registry.hookEntries('diagnostics').map(entry => entry.moduleId), ['npc-state-delta']);
    assert.match(reportFileName(new Date(2026, 9, 22, 9, 5)), /^story-suite-diagnostics-2026-10-22-0905\.txt$/);
});
