// The split UI host keeps its public exports and the mounted host's original interface.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as facade from '../../../src/v2/ui-host.js';
import { createRuntime } from '../../../src/v2/runtime.js';
import { createFakeContext } from '../../../testkit/fake-st.js';
import { setupDom } from '../view/mounts/helpers.js';

test('ui-host.js retains its original public exports', () => {
    const names = ['hasReplyRecord', 'hudOn', 'isGameViewKey', 'mountUi'];
    assert.deepEqual(Object.keys(facade), names);
    for (const name of names) assert.equal(typeof facade[name], 'function', name);
});

test('the mounted host retains its interface order and frozen controls', t => {
    const doc = setupDom();
    const st = createFakeContext();
    const runtime = createRuntime({ ctx: st.ctx });
    const ui = facade.mountUi({ runtime, ctx: st.ctx, doc });
    t.after(() => ui.destroy());
    assert.deepEqual(Object.keys(ui), [
        'refresh', 'blocked', 'clearBlocked', 'openPanel', 'closePanel', 'openSettings', 'toggleGameView', 'setHud',
        'hudOn', 'syncScreens', 'screens', 'tabs', 'mounts', 'renderer', 'notes', 'extras', 'savePoints', 'inspector',
        'theme', 'cardOffer', 'destroy',
    ]);
    assert.equal(Object.isFrozen(ui.screens), true);
    assert.equal(Object.isFrozen(ui.tabs), true);
});
