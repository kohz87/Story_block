// sdk.callModel and the `profile` settings field (docs/v2/MODULES.md §G): the rules around a module's
// model call (time limit, abort, one at a time, FEATURE_OFF, errors as results), SillyTavern's two
// ways to make it (a Connection Manager profile's own request, or generateRaw for the chat's
// connection) without changing the reader's connection, the dropdown, and the testkit's scripted model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../ui-fake-dom.js';
import { createHost, createFakeModel } from '../../testkit/index.js';
import { MODEL_CALL_TIMEOUT_MS, createModelCalls, listProfiles, safeReason, stModelCall } from '../../src/v2/model-call.js';
import { PROFILE_TEXT, profileChoices } from '../../src/v2/profile-field.js';
import { createRegistry, definitionProblems } from '../../src/v2/registry.js';
import { createSettings, settingValue } from '../../src/v2/sdk.js';
import { renderSettingsHost } from '../../src/v2/host-ui.js';

const doc = installFakeDom();

// A module that plans with its own model call, behind a feature, with a profile setting.
const planner = (extra = {}) => ({
    id: 'planner',
    name: 'Planner',
    features: [{ id: 'planner.arc', label: 'Arc planning', default: true }],
    settings: {
        defaults: { connection: '' },
        schema: { connection: { type: 'profile', label: 'Planning connection', help: 'Which model plans arcs.' } },
    },
    ...extra,
});
const other = () => ({ id: 'other', name: 'Other', features: [{ id: 'other.flavour', label: 'Flavour' }] });

// A timer the test fires by hand: { setTimeout, clearTimeout, fire(), last (ms asked), cleared }.
function handTimer() {
    const timer = { pending: null, last: null, cleared: 0 };
    timer.setTimeout = (fn, ms) => { timer.pending = fn; timer.last = ms; return 1; };
    timer.clearTimeout = () => { timer.cleared += 1; };
    timer.fire = () => timer.pending?.();
    return timer;
}

// A SillyTavern with two Connection Manager profiles (and one it cannot use), recording each request.
function fakeSt({ cmOff = false, cm = true, profiles = null } = {}) {
    const requests = [];
    const raws = [];
    const ctx = {
        mainApi: 'openai',
        chat: [{ is_user: true, mes: 'hello' }],
        extensionSettings: {
            disabledExtensions: cmOff ? ['connection-manager'] : [],
            connectionManager: {
                selectedProfile: 'p-main',
                profiles: profiles ?? [
                    { id: 'p-main', name: 'Main', api: 'openai', 'secret-id': 'sk-secret-main-123456789', 'api-url': 'https://main.example' },
                    { id: 'p-cheap', name: 'Cheap', api: 'openai', 'secret-id': 'sk-secret-cheap-123456789', 'api-url': 'https://cheap.example' },
                    { id: 'p-img', name: 'Images only', api: 'sd' },
                ],
            },
        },
        async generateRaw(options) {
            raws.push(options);
            return 'from the chat connection';
        },
    };
    if (cm) {
        ctx.ConnectionManagerRequestService = {
            isProfileSupported: profile => profile?.api === 'openai',
            async sendRequest(id, messages, maxTokens, custom) {
                requests.push({ id, messages, maxTokens, custom });
                return { content: `from ${id}` };
            },
        };
    }
    return { ctx, requests, raws };
}
function withSt(st, fn) {
    const before = globalThis.SillyTavern;
    globalThis.SillyTavern = { getContext: () => st.ctx };
    const restore = () => { if (before === undefined) delete globalThis.SillyTavern; else globalThis.SillyTavern = before; };
    try {
        const out = fn();
        if (out && typeof out.then === 'function') return out.finally(restore);
        restore();
        return out;
    } catch (error) {
        restore();
        throw error;
    }
}

test('success: the module gets the text; the call carries prompt, system, maxTokens and profile; the chat is untouched', async () => {
    const model = createFakeModel(['Arc: the flooded vault']);
    const host = await createHost({ callModel: model, modules: [planner()] });
    const chatBefore = structuredClone(host.ctx.chat);
    const headBefore = structuredClone(host.head());
    const result = await host.sdk.callModel({ feature: 'planner.arc', profile: 'Cheap', system: 'You plan arcs.', prompt: 'Plan one.', maxTokens: 500 });
    assert.deepEqual(result, { ok: true, text: 'Arc: the flooded vault', error: null });
    assert.deepEqual(model.calls, [{ prompt: 'Plan one.', maxTokens: 500, profile: 'Cheap', system: 'You plan arcs.' }]);
    assert.deepEqual(host.ctx.chat, chatBefore, 'nothing posted to the chat');
    assert.deepEqual(host.head(), headBefore, 'nothing stored in the story');
    // 'chat', empty or left out: the chat's connection (''); maxTokens defaults and is kept in bounds.
    model.push('a', 'b', 'c');
    await host.sdk.callModel({ feature: 'planner.arc', profile: 'chat', prompt: 'x' });
    await host.sdk.callModel({ feature: 'planner.arc', profile: '  CHAT ', prompt: 'x', maxTokens: 1e9 });
    await host.sdk.callModel({ feature: 'planner.arc', prompt: 'x', maxTokens: -3 });
    assert.deepEqual(model.calls.slice(1).map(call => [call.profile, call.maxTokens]), [['', 300], ['', 8000], ['', 300]]);
    host.close();
});

test('timeout: 60 s by default, configurable per call and per runtime; the call is told to stop', async () => {
    const timer = handTimer();
    const model = createFakeModel([{ hang: true }]);
    const calls = createModelCalls({ call: model, timer, log: () => {} });
    const pending = calls.callModel({ module: 'planner', prompt: 'Plan.' });
    await Promise.resolve();
    assert.equal(timer.last, MODEL_CALL_TIMEOUT_MS);
    assert.equal(MODEL_CALL_TIMEOUT_MS, 60_000);
    timer.fire();
    const result = await pending;
    assert.equal(result.ok, false);
    assert.equal(result.error, 'TIMEOUT');
    assert.equal(result.text, '');
    assert.match(result.message, /within 60 s/);
    assert.equal(model.aborted, 1, 'the request was aborted');
    assert.equal(calls.busy('planner'), false, 'the slot is free again');

    // Per call (kept inside 1 s – 10 min) and per runtime.
    model.push({ hang: true }, { hang: true }, { hang: true });
    const short = calls.callModel({ module: 'planner', prompt: 'Plan.', timeoutMs: 5_000 });
    await Promise.resolve();
    assert.equal(timer.last, 5_000);
    timer.fire();
    assert.equal((await short).error, 'TIMEOUT');
    const tiny = calls.callModel({ module: 'planner', prompt: 'Plan.', timeoutMs: 5 });
    await Promise.resolve();
    assert.equal(timer.last, 1_000);
    timer.fire();
    await tiny;
    const own = createModelCalls({ call: model, timer, log: () => {}, timeoutMs: 20_000 });
    const viaRuntime = own.callModel({ module: 'planner', prompt: 'Plan.' });
    await Promise.resolve();
    assert.equal(timer.last, 20_000);
    timer.fire();
    assert.equal((await viaRuntime).error, 'TIMEOUT');

    // Through the host, with a real (short) limit.
    const host = await createHost({ callModel: createFakeModel([{ hang: true }]), modules: [planner()] });
    const late = await host.sdk.callModel({ feature: 'planner.arc', prompt: 'Plan.', timeoutMs: 1_000 });
    assert.equal(late.error, 'TIMEOUT');
    host.close();
});

test('abort through signal: ABORTED at once, the request cut off; an already aborted signal makes no call', async () => {
    const model = createFakeModel([{ hang: true }]);
    const host = await createHost({ callModel: model, modules: [planner()] });
    const controller = new AbortController();
    const pending = host.sdk.callModel({ feature: 'planner.arc', prompt: 'Plan.', signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    const result = await pending;
    assert.equal(result.ok, false);
    assert.equal(result.error, 'ABORTED');
    assert.equal(model.aborted, 1);
    assert.equal(model.pending(), 0);

    const gone = new AbortController();
    gone.abort();
    const before = model.calls.length;
    assert.equal((await host.sdk.callModel({ feature: 'planner.arc', prompt: 'Plan.', signal: gone.signal })).error, 'ABORTED');
    assert.equal(model.calls.length, before, 'no call made');
    // Free again for the next one.
    model.push('ok');
    assert.equal((await host.sdk.callModel({ feature: 'planner.arc', prompt: 'Plan.' })).text, 'ok');
    host.close();
});

test('one call at a time per module: a second is refused (BUSY); another module is not held up', async () => {
    const model = createFakeModel([{ text: 'first', delayMs: 30 }, 'flavour', 'third']);
    const host = await createHost({ callModel: model, modules: [planner(), other()] });
    const first = host.sdk.callModel({ feature: 'planner.arc', prompt: 'one' });
    const second = await host.sdk.callModel({ feature: 'planner.arc', prompt: 'two' });
    assert.equal(second.ok, false);
    assert.equal(second.error, 'BUSY');
    assert.match(second.message, /planner already has a model call on its way/);
    // The same module named directly shares the slot; another module has its own.
    assert.equal((await host.sdk.callModel({ module: 'planner', prompt: 'two' })).error, 'BUSY');
    const flavour = await host.sdk.callModel({ feature: 'other.flavour', prompt: 'look' });
    assert.deepEqual(flavour, { ok: true, text: 'flavour', error: null });
    assert.equal((await first).text, 'first');
    assert.equal((await host.sdk.callModel({ feature: 'planner.arc', prompt: 'three' })).text, 'third', 'free after the first answered');
    assert.deepEqual(model.calls.map(call => call.prompt), ['one', 'look', 'three'], 'the refused calls never reached the model');
    host.close();
});

test('FEATURE_OFF while the calling module\'s feature is off (and for an id no module declares); on again, it calls', async () => {
    const model = createFakeModel(['planned']);
    const host = await createHost({ callModel: model, modules: [planner()] });
    host.features.set('planner.arc', false);
    const off = await host.sdk.callModel({ feature: 'planner.arc', prompt: 'Plan.' });
    assert.equal(off.ok, false);
    assert.equal(off.error, 'FEATURE_OFF');
    assert.match(off.message, /"planner\.arc" is turned off/);
    assert.equal((await host.sdk.callModel({ feature: 'nobody.thing', prompt: 'Plan.' })).error, 'FEATURE_OFF');
    assert.equal(model.calls.length, 0);
    host.features.set('planner.arc', true);
    assert.equal((await host.sdk.callModel({ feature: 'planner.arc', prompt: 'Plan.' })).text, 'planned');
    host.close();
});

test('errors come back as results, never thrown; the log holds module, profile, time and outcome only', async () => {
    const lines = [];
    const model = createFakeModel([
        new Error('API request failed: 401 invalid key sk-proj-abcdefghijklmnopqrstuvwxyz0123\nheaders: …'),
        () => { throw 'plain string'; },
        '   ',
        { text: 'kept' },
    ]);
    const calls = createModelCalls({ call: model, log: line => lines.push(line), featureModule: id => id.split('.')[0] });
    const failed = await calls.callModel({ feature: 'planner.arc', profile: 'Cheap', prompt: 'SECRET PROMPT' });
    assert.equal(failed.error, 'FAILED');
    assert.doesNotMatch(failed.message, /sk-proj|abcdefghijklmnop|headers/, 'nothing key-like, one line');
    assert.equal((await calls.callModel({ feature: 'planner.arc', prompt: 'x' })).error, 'FAILED');
    assert.equal((await calls.callModel({ feature: 'planner.arc', prompt: 'x' })).error, 'EMPTY');
    assert.equal((await calls.callModel({ feature: 'planner.arc', prompt: 'x' })).text, 'kept');
    for (const bad of [undefined, null, 'text', { prompt: '' }, { prompt: '   ' }, { prompt: 42 }, { prompt: 'x', system: 3 }]) {
        const result = await calls.callModel(bad);
        assert.equal(result.ok, false);
        assert.equal(result.error, 'BAD_REQUEST');
    }
    const broken = createModelCalls({ call: null, log: () => {} });
    assert.equal((await broken.callModel({ prompt: 'x' })).error, 'FAILED');
    assert.equal((await createModelCalls({ call: model, featureOn: () => { throw new Error('x'); }, log: () => {} }).callModel({ feature: 'a.b', prompt: 'x' })).error, 'FEATURE_OFF');
    assert.equal(lines.length, 11);
    assert.match(lines[0], /^\[Story Suite\] model call: planner, Cheap, \d+ ms, FAILED$/);
    assert.match(lines[3], /^\[Story Suite\] model call: planner, the chat's connection, \d+ ms, ok$/);
    assert.ok(lines.every(line => !/SECRET|sk-|kept|invalid/.test(line)), 'never the prompt, answer or error words');
    assert.equal(safeReason({ cause: { message: 'Bearer abcdefghijklmnop1234 refused' } }), '… refused');
    // An sdk with no model call says so.
    const host = await createHost({ modules: [planner()] });
    const { createSdk } = await import('../../src/v2/sdk.js');
    const bare = createSdk({ store: host.store, bus: host.bus, registry: host.registry, settings: host.settings }).sdk;
    assert.equal((await bare.callModel({ prompt: 'x' })).error, 'UNAVAILABLE');
    const throwing = createSdk({ store: host.store, bus: host.bus, registry: host.registry, settings: host.settings, callModel: () => { throw new Error('boom'); } }).sdk;
    assert.equal((await throwing.callModel({ prompt: 'x' })).error, 'FAILED');
    host.close();
});

test('SillyTavern: a profile is called directly with its own settings; the reader\'s connection is never switched', async () => {
    const st = fakeSt();
    const before = structuredClone({ mainApi: st.ctx.mainApi, cm: st.ctx.extensionSettings.connectionManager });
    await withSt(st, async () => {
        const controller = new AbortController();
        assert.equal(await stModelCall('Plan.', { profile: 'cheap', system: 'You plan.', maxTokens: 400, signal: controller.signal }), 'from p-cheap');
        assert.equal(await stModelCall('Plan.', { profile: 'p-cheap' }), 'from p-cheap', 'an id works too');
        assert.deepEqual(st.requests[0].messages, [{ role: 'system', content: 'You plan.' }, { role: 'user', content: 'Plan.' }]);
        assert.equal(st.requests[0].maxTokens, 400);
        assert.equal(st.requests[0].custom.signal, controller.signal, 'the signal reaches the request');
        assert.equal(st.requests[0].custom.stream, false);
        assert.deepEqual(st.requests[1].messages, [{ role: 'user', content: 'Plan.' }]);
        // The chat's connection: generateRaw, no chat, the system text and the length.
        assert.equal(await stModelCall('Plan.', { profile: 'chat', system: 'You plan.', maxTokens: 120 }), 'from the chat connection');
        assert.equal(await stModelCall('Plan.', {}), 'from the chat connection');
        assert.deepEqual(st.raws[0], { prompt: 'Plan.', systemPrompt: 'You plan.', responseLength: 120 });
        // A missing profile is an error, never the chat's connection in its place.
        await assert.rejects(stModelCall('Plan.', { profile: 'Gone' }), error => error.code === 'NO_PROFILE' && /no connection profile called "Gone"/.test(error.message));
    });
    assert.deepEqual({ mainApi: st.ctx.mainApi, cm: st.ctx.extensionSettings.connectionManager }, before, 'selected profile, profiles and API unchanged');
    assert.equal(st.ctx.chat.length, 1);

    for (const [options, why] of [[{ cmOff: true }, /turned off/], [{ cm: false }, /no Connection Manager/]]) {
        const off = fakeSt(options);
        await withSt(off, async () => {
            await assert.rejects(stModelCall('x', { profile: 'Cheap' }), error => error.code === 'NO_PROFILE' && why.test(error.message));
            assert.equal(await stModelCall('x', { profile: '' }), 'from the chat connection');
        });
    }
    // Through the runtime (no callModel option): SillyTavern's own call, with the rules around it.
    const live = fakeSt();
    await withSt(live, async () => {
        const host = await createHost({ modules: [planner()] });
        const result = await host.sdk.callModel({ feature: 'planner.arc', profile: 'Cheap', prompt: 'Plan.' });
        assert.deepEqual(result, { ok: true, text: 'from p-cheap', error: null });
        const gone = await host.sdk.callModel({ feature: 'planner.arc', profile: 'Gone', prompt: 'Plan.' });
        assert.equal(gone.error, 'NO_PROFILE');
        host.close();
    });
});

test('listProfiles: the usable profiles by name, id and name only; a plain reason without a Connection Manager', () => {
    const list = listProfiles(fakeSt().ctx);
    assert.deepEqual(list, { usable: true, why: '', profiles: [{ id: 'p-cheap', name: 'Cheap' }, { id: 'p-main', name: 'Main' }] });
    assert.doesNotMatch(JSON.stringify(list), /secret|example/);
    assert.equal(listProfiles(fakeSt({ cmOff: true }).ctx).usable, false);
    assert.match(listProfiles(fakeSt({ cmOff: true }).ctx).why, /turned off/);
    assert.match(listProfiles(fakeSt({ cm: false }).ctx).why, /no Connection Manager/);
    assert.equal(listProfiles(null).usable, false);
});

test('the profile field: a dropdown of the profiles plus "Same as chat", stores the name, a plain note when there are none', () => {
    const registry = createRegistry();
    assert.deepEqual(definitionProblems(planner()), []);
    registry.register(planner());
    const es = {};
    const settings = createSettings({ root: () => es, registry });
    const fieldRow = root => root.querySelectorAll('details.story-suite-fold')
        .find(fold => fold.dataset.fold === 'planner').querySelector('.story-suite-row[data-field="connection"]');
    const draw = st => withSt(st, () => {
        const root = doc.createElement('div');
        renderSettingsHost(root, { registry, settings, doc });
        return fieldRow(root);
    });

    const row = draw(fakeSt());
    assert.equal(row.dataset.type, 'profile');
    assert.equal(row.querySelector('b').textContent, 'Planning connection');
    const select = row.querySelector('select');
    assert.deepEqual(select.querySelectorAll('option').map(node => [node.value, node.textContent]), [['', 'Same as chat'], ['Cheap', 'Cheap'], ['Main', 'Main']]);
    assert.equal(select.value, '');
    assert.equal(row.querySelector('.story-suite-profile-note'), null, 'nothing to say');
    select.value = 'Cheap';
    select.dispatch('change');
    assert.equal(settings('planner').connection, 'Cheap', 'the name is stored');
    assert.equal(draw(fakeSt()).querySelector('select').value, 'Cheap');

    // Stored values are names: trimmed, cut at 100, 'chat' is the chat's connection.
    assert.equal(settings.set('planner', 'connection', '  chat '), '');
    assert.equal(settings.set('planner', 'connection', `  ${'x'.repeat(150)} `).length, 100);
    assert.equal(settingValue({ type: 'profile' }, 42), '');

    // A stored profile that is gone stays, marked, with a note.
    settings.set('planner', 'connection', 'Retired');
    const gone = draw(fakeSt());
    assert.deepEqual(gone.querySelectorAll('option').map(node => node.textContent), ['Same as chat', 'Cheap', 'Main', 'Retired (not found)']);
    assert.equal(gone.querySelector('select').value, 'Retired');
    assert.match(gone.querySelector('.story-suite-profile-note').textContent, /"Retired" is not in the Connection Manager any more/);

    // No profiles; Connection Manager off; none at all.
    settings.set('planner', 'connection', '');
    const none = draw(fakeSt({ profiles: [] }));
    assert.deepEqual(none.querySelectorAll('option').map(node => node.textContent), ['Same as chat']);
    assert.equal(none.querySelector('.story-suite-profile-note').textContent, PROFILE_TEXT.none);
    assert.match(draw(fakeSt({ cmOff: true })).querySelector('.story-suite-profile-note').textContent, /Connection Profiles is turned off/);
    assert.match(draw(fakeSt({ cm: false })).querySelector('.story-suite-profile-note').textContent, /no Connection Manager/);
    assert.deepEqual(profileChoices('', { usable: false, why: '', profiles: [] }).note, PROFILE_TEXT.none);
});

test('testkit: createFakeModel scripts answers, errors, computed answers, delays and hangs', async () => {
    const model = createFakeModel(['one', new Error('down'), call => `echo ${call.prompt}`, { text: 'later', delayMs: 5 }], { fallback: 'none' });
    assert.equal(await model('a', { maxTokens: 10 }), 'one');
    await assert.rejects(model('b'), /down/);
    assert.equal(await model('c'), 'echo c');
    assert.equal(await model('d'), 'later');
    assert.equal(await model('e'), 'none', 'the fallback once the script is spent');
    assert.deepEqual(model.calls.map(call => call.prompt), ['a', 'b', 'c', 'd', 'e']);
    assert.deepEqual(model.calls[0], { prompt: 'a', maxTokens: 10, profile: '', system: '' });
    model.push({ hang: true });
    const controller = new AbortController();
    const hung = model('f', { signal: controller.signal });
    assert.equal(model.pending(), 1);
    controller.abort();
    await assert.rejects(hung, error => error.name === 'AbortError');
    assert.equal(model.pending(), 0);
    assert.equal(model.aborted, 1);
    // It also stands in for the assist helpers' call (same option), and works with the module alone.
    const host = await createHost({ callModel: createFakeModel(['solo']), modules: [planner()] });
    assert.equal((await host.sdk.callModel({ feature: 'planner.arc', prompt: 'p' })).text, 'solo');
    host.close();
});
