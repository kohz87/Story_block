// Home's "Before you start" (screens/ready-hint.js, turn.blockers / turn.unblock): while a module's
// canGenerate holds the story back, Home shows its reason and a button that runs its onBlocked hook (RPG
// Battle's opens the character wizard). Story Block alone, or a module that is ready, shows nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeContext } from '../../testkit/fake-st.js';
import { createRuntime } from '../../src/v2/runtime.js';
import { mountUi } from '../../src/v2/ui-host.js';
import { createReadyHintWidget, READY_HINT_WIDGET } from '../../src/v2/screens/ready-hint.js';
import { STRINGS } from '../../src/v2/strings.js';
import { setupDom } from './view/mounts/helpers.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function setup() {
    const doc = setupDom();
    const st = createFakeContext({});
    let ui = null;
    const runtime = createRuntime({ ctx: st.ctx, onRegister: () => ui?.syncScreens() });
    ui = mountUi({ runtime, ctx: st.ctx, doc });
    runtime.markReady();
    return { doc, st, ui, runtime };
}

// A module that holds the story back until `made`, like RPG Battle until your character exists.
function creator(log, { action = 'Create your character', hook = true } = {}) {
    const state = { made: false };
    const def = {
        id: 'qa-creator',
        name: 'Creator',
        hooks: {
            canGenerate: () => (state.made ? { ok: true } : { ok: false, reason: 'Create your character first.', ...(action === null ? {} : { action }) }),
            ...(hook ? { onBlocked: (reason, moduleId) => log.push([moduleId, reason]) } : {}),
        },
    };
    return { def, state };
}

async function home(env) {
    env.ui.mounts.screen.open('story-block/home');
    await tick();
    return env.doc.querySelectorAll('.ready-hint')[0] ?? null;
}

test('turn.blockers lists every module holding back, with its button words; nothing is logged', async t => {
    t.mock.method(console, 'warn', () => {});
    const env = setup();
    await env.runtime.turn.onChatChanged();
    const log = [];
    await env.runtime.sdk.registerModule(creator(log).def);
    await env.runtime.sdk.registerModule({ id: 'qa-plain', hooks: { canGenerate: () => false } });
    await env.runtime.sdk.registerModule({ id: 'qa-none', name: 'No button', hooks: { canGenerate: () => ({ ok: false, reason: 'Wait.', action: false }), onBlocked: () => log.push('none') } });
    await env.runtime.sdk.registerModule({ id: 'qa-bug', hooks: { canGenerate() { throw new Error('oops'); } } });
    await env.runtime.sdk.registerModule({ id: 'qa-ready', hooks: { canGenerate: () => ({ ok: true }), onBlocked: () => log.push('ready') } });
    const list = await env.runtime.turn.blockers();
    assert.deepEqual(list.map(entry => entry.moduleId).sort(), ['qa-creator', 'qa-none', 'qa-plain']);
    const by = Object.fromEntries(list.map(entry => [entry.moduleId, entry]));
    assert.deepEqual(by['qa-creator'], { moduleId: 'qa-creator', reason: 'Create your character first.', name: 'Creator', action: 'Create your character', canOpen: true });
    assert.equal(by['qa-plain'].reason, 'qa-plain is not ready for the story to go on yet.');
    assert.equal(by['qa-plain'].canOpen, false, 'no onBlocked hook: no button');
    assert.equal(by['qa-none'].canOpen, false, 'action: false asks for no button');
    assert.deepEqual(env.runtime.turn.problems(), [], 'asking for Home logs nothing, not even the throwing hook');
    assert.deepEqual(env.runtime.turn.blocked(), [], 'and no generation counts as stopped');
    assert.equal(env.runtime.turn.unblock('qa-creator', 'Create your character first.'), true);
    assert.deepEqual(log, [['qa-creator', 'Create your character first.']]);
    assert.equal(env.runtime.turn.unblock('qa-plain', 'x'), false, 'no hook to run');
});

test('a button label from the module is flattened and cut; none given → the plain default', async t => {
    t.mock.method(console, 'warn', () => {});
    const env = setup();
    await env.runtime.turn.onChatChanged();
    await env.runtime.sdk.registerModule(creator([], { action: '  Make\n\u0007a   hero ' + 'x'.repeat(80) }).def);
    const [entry] = await env.runtime.turn.blockers();
    assert.ok(!/[\n\u0007]/.test(entry.action));
    assert.ok(entry.action.startsWith('Make a hero x'));
    assert.ok(Array.from(entry.action).length <= 40);
    const env2 = setup();
    await env2.runtime.turn.onChatChanged();
    await env2.runtime.sdk.registerModule(creator([], { action: null }).def);
    const card = await home(env2);
    assert.equal(card.querySelector('.sb-ready-go').textContent, STRINGS.readyHint.go);
});

test('Home: "Before you start" shows the reason and a button that runs the module\'s onBlocked; gone once ready', async t => {
    t.mock.method(console, 'warn', () => {});
    const env = setup();
    await env.runtime.turn.onChatChanged();
    const log = [];
    const { def, state } = creator(log);
    await env.runtime.sdk.registerModule(def);
    const card = await home(env);
    assert.ok(card, 'the card is on Home');
    assert.equal(card.getAttribute('aria-label'), 'Before you start');
    assert.match(card.textContent, /Creator/);
    assert.match(card.textContent, /Create your character first\./);
    const go = card.querySelector('.sb-ready-go');
    assert.equal(go.textContent, 'Create your character');
    assert.equal(go.type, 'button');
    go.click();
    assert.deepEqual(log, [['qa-creator', 'Create your character first.']]);
    // The character is made: the next redraw has no card.
    state.made = true;
    env.ui.mounts.screen.update();
    await tick();
    assert.equal(env.doc.querySelectorAll('.ready-hint').length, 0);
});

test('Story Block alone (no module holding back): Home has no "Before you start"', async t => {
    t.mock.method(console, 'warn', () => {});
    const env = setup();
    await env.runtime.turn.onChatChanged();
    const card = await home(env);
    assert.equal(card, null);
    assert.ok(env.doc.querySelectorAll('.ready-slot')[0], 'the slot is there, empty');
    // A module without canGenerate does not add one either.
    await env.runtime.sdk.registerModule({ id: 'qa-quiet', hooks: {} });
    assert.equal(await home(env), null);
});

test('the widget draws the newest answer only, and nothing after destroy', async () => {
    const doc = setupDom();
    const answers = [];
    const widget = createReadyHintWidget({ blockers: () => new Promise(resolve => answers.push(resolve)) });
    const el = doc.createElement('div');
    const handle = widget.render(el, {}, {});
    handle.update();
    answers[1]([{ moduleId: 'a', name: 'A', reason: 'second', canOpen: false }]);
    await tick();
    answers[0]([{ moduleId: 'a', name: 'A', reason: 'first (stale)', canOpen: false }]);
    await tick();
    assert.match(el.textContent, /second/);
    assert.doesNotMatch(el.textContent, /stale/);
    assert.equal(el.querySelectorAll('.sb-ready-go').length, 0, 'no hook: no button');
    handle.update();
    handle.destroy();
    answers[2]([{ moduleId: 'a', name: 'A', reason: 'after destroy', canOpen: true }]);
    await tick();
    assert.doesNotMatch(el.textContent, /after destroy/);
    // A failing source draws nothing (and does not throw).
    const bad = doc.createElement('div');
    createReadyHintWidget({ blockers: () => { throw new Error('x'); } }).render(bad, {}, {});
    await tick();
    assert.equal(bad.children.length, 0);
    assert.equal(READY_HINT_WIDGET, 'story-block.ready-hint');
});

test('sdk.dialog.current (and the widget api\'s) gives the open dialog, so a module does not open a second', async t => {
    t.mock.method(console, 'warn', () => {});
    const env = setup();
    await env.runtime.turn.onChatChanged();
    await env.runtime.sdk.registerModule({ id: 'qa-wiz', screens: [{ id: 'qa-wiz/step', title: 'Wizard', mounts: ['dialog'], template: '<p>Step</p>' }] });
    assert.equal(env.runtime.sdk.dialog.current(), null);
    const handle = env.runtime.sdk.dialog.open('qa-wiz/step', {});
    assert.ok(handle, 'opened');
    assert.equal(env.runtime.sdk.dialog.current(), handle);
    handle.close();
    assert.equal(env.runtime.sdk.dialog.current(), null, 'closed: none');
});

test('the bar\'s "held back" notice goes once that module no longer holds the story back', async t => {
    t.mock.method(console, 'warn', () => {});
    const env = setup();
    await env.runtime.turn.onChatChanged();
    const { def, state } = creator([]);
    await env.runtime.sdk.registerModule(def);
    env.ui.blocked('Create your character first.', 'qa-creator');
    const notice = env.doc.querySelectorAll('.story-suite-notice')[0];
    assert.equal(notice.hidden, false);
    env.runtime.events.emit('committed', {});
    await tick();
    assert.equal(notice.hidden, false, 'still held back: the notice stays');
    state.made = true;
    env.runtime.events.emit('committed', {});
    await tick();
    assert.equal(notice.hidden, true, 'ready now: gone');
});
