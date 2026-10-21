// ui-host.js: the page furniture over the real runtime, on the mounts' fake DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeContext } from '../../testkit/fake-st.js';
import { createRuntime } from '../../src/v2/runtime.js';
import { mountUi } from '../../src/v2/ui-host.js';
import { setupDom } from './view/mounts/helpers.js';

const LATE = { id: 'qa-late', name: 'Late', screens: [{ id: 'qa-late/strip', title: 'Strip', mounts: ['hud', 'tab'], template: '<div>{{ state.meta.rev }}</div>' }] };

function setup(chat) {
    const doc = setupDom();
    const st = createFakeContext({ chat });
    let ui = null;
    const runtime = createRuntime({ ctx: st.ctx, onRegister: () => ui?.syncScreens() });
    ui = mountUi({ runtime, ctx: st.ctx, doc });
    runtime.markReady();
    return { doc, st, ui, runtime };
}

test('stateAt on a chat with no carrier (head index -1) shows nothing instead of throwing', async t => {
    const warnings = [];
    t.mock.method(console, 'warn', (...args) => warnings.push(args.map(String).join(' ')));
    const { doc, ui, runtime } = setup([]);
    assert.equal(runtime.store.headIndex(), -1);
    // A module enabled before the chat holds any reply: its screens follow without a RangeError
    // ("screens could not follow RangeError: There is no message -1").
    await runtime.sdk.registerModule(LATE);
    ui.refresh();
    const mounted = ui.mounts.hud.mount(doc.createElement('div'), 'qa-late/strip');
    assert.ok(mounted.result, 'the head mount drew');
    assert.deepEqual(warnings.filter(line => /could not follow|There is no message/.test(line)), []);
});

test('stateAt with a carrier still reads that reply\'s state', async t => {
    t.mock.method(console, 'warn', () => {});
    const { doc, ui, runtime, st } = setup(undefined);
    await runtime.turn.onChatChanged();
    assert.equal(runtime.store.headIndex(), 0, 'the greeting is the head');
    await runtime.sdk.registerModule(LATE);
    const el = doc.createElement('div');
    ui.mounts.hud.mount(el, 'qa-late/strip');
    assert.equal(el.textContent.trim(), String(runtime.store.head().meta.rev));
    assert.ok(st.ctx.chat.length >= 1);
});
