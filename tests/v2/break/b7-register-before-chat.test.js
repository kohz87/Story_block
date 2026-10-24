// B-b7-combos-8: every page load, each module registers before SillyTavern opens a chat (RPG Battle,
// Story Director and NPC State Delta all wait for StoryBlock.ready, which index.js resolves before
// the first CHAT_CHANGED). index.js's onRegister → ui.syncScreens() then redraws the mounts with no
// carrier and store.at(-1) throws "RangeError: There is no message -1 in this chat"; sdk.js logs
// "a module was registered, but the screens could not follow" on every boot, and the card mounts'
// refreshAll() after it is skipped. Seen live in every combination with a module (console warning).
// Drop into Story_block/tests/v2/break/.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createHost } from '../../../testkit/index.js';
import { setupDom } from '../view/mounts/helpers.js';
import { mountUi } from '../../../src/v2/ui-host.js';

const SCREEN_MODULE = {
    id: 'late-screen', name: 'Late', version: '0.0.1',
    screens: [{ id: 'late-screen/strip', title: 'Strip', mounts: ['tab', 'hud'], template: '<b>{{ state.scene.place.name }}</b>' }],
};

test('a module registering while no chat is open does not make the UI throw', async () => {
    const doc = setupDom();
    for (const id of ['send_form', 'extensions_settings']) {
        const node = doc.createElement('div');
        node.id = id;
        doc.body.appendChild(node);
    }
    // No chat yet: SillyTavern's chat array is empty at boot.
    const host = await createHost({ st: { chat: [] } });
    const runtime = { registry: host.registry, store: host.store, sdk: host.sdk, settings: host.settings, events: host.events, turn: host.turn };
    const ui = mountUi({ runtime, ctx: host.ctx, doc, version: '2.0.0-test' });
    host.registry.register(SCREEN_MODULE);
    assert.doesNotThrow(() => ui.syncScreens(), 'syncScreens with no carrier');
    host.close();
});

// Same boot race, the other side (seen live with Story Block + Story Director + NPC State Delta):
// SillyTavern has filled ctx.chat but Story Block's CHAT_CHANGED handler has not written the first
// state yet when a module registers. ensureModules() then sees head() === null, treats EVERY module
// (Story Block's own core included) as "enabled after the chat began", and runs module.init.* on a
// chat with no state: "Story Block could not be set up in this chat: There is no state to change yet."
test('a module registering between the chat load and CHAT_CHANGED does not try to set up every module', async () => {
    const host = await createHost({ st: { chat: [] } });
    const warnings = [];
    const warn = console.warn;
    console.warn = (...args) => warnings.push(args.map(String).join(' '));
    try {
        // SillyTavern loaded a chat with only its greeting; CHAT_CHANGED is not handled yet.
        host.ctx.chat.push({ name: 'Narrator', is_user: false, mes: 'Welcome.', extra: {} });
        await host.sdk.registerModule({ id: 'zz-late', name: 'Late', domains: { late: { initial: () => ({ n: 0 }) } } });
        await host.turn.onChatChanged();
    } finally {
        console.warn = warn;
    }
    assert.deepEqual(warnings.filter(text => /could not be set up/.test(text)), [], 'no module set-up should be attempted (or fail) before the chat has its state');
    assert.equal(host.head().domains.late?.n, 0);
    host.close();
});
