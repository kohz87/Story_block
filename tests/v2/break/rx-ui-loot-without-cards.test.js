// rx-ui (beta rolling break, Features combinations): the loot picker (story-block.loot, SB #104) lives only
// on the reply's changes card. With the cards turned off (story-block.cards off, or the changes card's own
// switch), loot still enters the prompt grammar ("the reader chooses what to take") and the story lays it
// out, but nothing in the page offers "Take selected": the loot can never be taken.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { makeMessage } from '../../ui-fake-dom.js';
import { setupDom } from '../view/mounts/helpers.js';
import { mountUi } from '../../../src/v2/ui-host.js';

test('with the cards off and loot on, the page still offers a way to take the loot (or loot is not offered)', async () => {
    const doc = setupDom();
    doc.createElementNS = (_ns, tag) => doc.createElement(tag);
    for (const id of ['send_form', 'extensions_settings']) { const node = doc.createElement('div'); node.id = id; doc.body.appendChild(node); }
    const host = await createHost({ settings: { features: { 'story-block.cards': false, 'story-block.loot': true } } });
    const runtime = { registry: host.registry, store: host.store, sdk: host.sdk, settings: host.settings, events: host.events, turn: host.turn, features: host.features };
    const ui = mountUi({ runtime, ctx: host.ctx, doc, version: '2.0.0-test' });
    try {
        await host.send('I search the mud.', 'Something glints.\n<Changes>\n? loot Silver Ring, Old Coin x2 — in the mud\n</Changes>');
        const offered = host.registry.contexts().some(context => context.kinds.some(kind => kind.kind === 'loot'));
        host.ctx.chat.forEach((_, index) => makeMessage(doc, index));
        for (let index = 0; index < host.ctx.chat.length; index += 1) ui.mounts.card?.refresh?.(index, { force: true });
        for (const head of doc.querySelectorAll('.ss-card-head')) head.click();
        const controls = [];
        const look = () => controls.push(...doc.querySelectorAll('[data-command="inventory.lootTake"]'));
        look();
        for (const entry of ui.screens.list('screen')) { ui.mounts.screen.open(entry.id); look(); }
        ui.mounts.screen.close();
        ui.openPanel();
        for (const tab of doc.querySelectorAll('.story-suite-tab')) { tab.click(); look(); }
        assert.ok(!offered || controls.length > 0, 'loot is offered to the story, but no screen, tab or card has "Take selected"');
    } finally {
        host.close();
    }
});
