// The reader-facing side on the real host: Setup's Data modules card (Settings -> Tabs & Packs) and the screens a pin
// brings. Nothing here exists for a chat that uses no data module.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeContext } from '../../../testkit/fake-st.js';
import { createRuntime } from '../../../src/v2/runtime.js';
import { mountUi } from '../../../src/v2/ui-host.js';
import { openSettingsWindow } from '../../../src/v2/view/settings/window.js';
import { setupDom } from '../view/mounts/helpers.js';
import { fixture, reply, success } from './helpers.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

async function mounted(t, { packs = [] } = {}) {
    t.mock.method(console, 'warn', () => {});
    const doc = setupDom();
    const st = createFakeContext();
    let ui = null;
    const runtime = createRuntime({ ctx: st.ctx, onRegister: () => ui?.syncScreens() });
    ui = mountUi({ runtime, ctx: st.ctx, doc });
    runtime.turn.install({ globalName: null });
    st.interceptor = runtime.turn.interceptor;
    t.after(() => runtime.turn.uninstall({ globalName: null }));
    runtime.markReady();
    await runtime.turn.onChatChanged();
    for (const pack of packs) success(await runtime.packs.packs.install(pack));
    return { doc, st, ui, runtime, sdk: runtime.sdk };
}
const cardOf = win => win.root.querySelectorAll('.ss-settings-page').find(node => node.dataset.ssSection === 'tabs').querySelector('.ss-dm-card');

test('Settings -> Tabs & Packs: no Data modules card until the library holds one; Enable previews first and writes nothing until the second click', async t => {
    const { doc, ui, runtime, sdk, st } = await mounted(t);
    const win = openSettingsWindow({ registry: runtime.registry, settings: runtime.settings, features: runtime.features, doc, sdk, openState: new Map(), tabs: ui.tabs });
    win.select('tabs');
    assert.equal(cardOf(win), null, 'a chat and library without data modules draw no card');
    success(await runtime.packs.packs.install(fixture('reputation')));
    win.refresh();
    const card = cardOf(win);
    assert.ok(card && !card.hidden);
    assert.match(card.textContent, /Reputation/);
    assert.match(card.textContent, /\+ dm reputation — why it happens \| kind: gain \| faction: guild/);
    const before = JSON.stringify({ chat: st.ctx.chat, state: runtime.store.head() });
    card.querySelectorAll('button').find(node => node.textContent === 'Enable for this chat').click();
    assert.match(card.textContent, /Enable Reputation for this chat\?/);
    card.querySelectorAll('button').find(node => node.textContent === 'Cancel').click();
    assert.equal(JSON.stringify({ chat: st.ctx.chat, state: runtime.store.head() }), before);
    assert.equal(runtime.store.head().domains.dataModules, undefined);
    card.querySelectorAll('button').find(node => node.textContent === 'Enable for this chat').click();
    card.querySelectorAll('button').find(node => node.textContent === 'Enable').click();
    await tick(); await tick();
    assert.ok(runtime.store.head().domains.dataModules.active['pack.ersveil-factions/reputation']);
    win.refresh();
    assert.match(cardOf(win).textContent, /Pinned/);
    assert.equal(cardOf(win).querySelectorAll('button').some(node => node.textContent === 'Enable for this chat'), false);
});

test('screens of a pin mount with it, not before, and leave with the reply that carries the pin; the library cannot take them away', async t => {
    const { ui, runtime, sdk, st } = await mounted(t, { packs: [fixture('reputation')] });
    await st.send('Begin.', 'The hall.');
    assert.equal(ui.screens.resolve('ersveil-reputation'), null, 'installed is not pinned');
    const offer = sdk.query('dataModules.offers')[0];
    success(await sdk.command('dm.pin', { module: offer.module, hash: offer.hash, packHash: offer.packHash }));
    ui.refresh();
    const entry = ui.screens.resolve('ersveil-reputation');
    assert.ok(entry?.screen, 'the pinned screen is registered');
    assert.equal(entry.source, 'pack');
    assert.ok(ui.screens.list('tab').some(each => each.id === 'ersveil-reputation'));
    await runtime.packs.packs.remove('ersveil-factions');
    ui.refresh();
    assert.ok(ui.screens.resolve('ersveil-reputation')?.screen, 'frozen: removing the pack changes nothing');
    // The pin is on the reply; deleting that message takes the pin and its screen with it.
    await st.deleteMessage(st.ctx.chat.length - 1);
    assert.equal(runtime.store.head().domains.dataModules?.active?.['pack.ersveil-factions/reputation'], undefined);
    assert.equal(ui.screens.resolve('ersveil-reputation'), null);
});

test('a reader\'s own choice for a screen still wins over the pinned presentation', async t => {
    const { ui, sdk } = await mounted(t, { packs: [fixture('reputation')] });
    const offer = sdk.query('dataModules.offers')[0];
    success(await sdk.command('dm.pin', { module: offer.module, hash: offer.hash, packHash: offer.packHash }));
    ui.refresh();
    ui.screens.choose('ersveil-reputation', { id: 'ersveil-reputation', title: 'Mine', mounts: ['tab'], template: '<p>mine</p>' });
    ui.refresh();
    assert.equal(ui.screens.resolve('ersveil-reputation').source, 'reader');
});
