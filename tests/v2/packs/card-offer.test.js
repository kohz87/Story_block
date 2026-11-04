// The card offer (packs/card-offer.js, card-offer-ui.js, ui-host.js): what a card brings is offered at the top of the Story panel
// with one click, never installed without it; the dot on the Story button waits until it is answered.
import test from 'node:test';
import assert from 'node:assert/strict';
import { countsLine, addsLine } from '../../../src/v2/packs/panel.js';
import { buildReport } from '../../../src/v2/diagnostics.js';
import { cardPack, cardWorld, goodPortrait, packEntry, portraitsEntry, settingsEntry, settle, tick } from './helpers/card.js';

const nsd = (state = { portraitPromptFormat: 'hybrid' }) => ({
    owner: 'npc-state-delta', label: 'NPC State Delta',
    keys: { portraitPromptFormat: { label: 'NSD portraits', valueText: v => (v === 'natural' ? 'Natural' : 'Structured hybrid'), valid: v => ['natural', 'hybrid'].includes(v) } },
    read: key => state[key],
    apply: async values => { Object.assign(state, values); return { applied: Object.keys(values) }; },
});
const text = node => node.textContent.replace(/\s+/g, ' ').trim();
const problems = world => world.runtime.turn.problems().filter(item => /^CARD_/.test(item.code));

test('a card that brings a new pack: one notice at the top of the Story panel, Install and Not now, the dot on the Story button; nothing installed yet', async t => {
    const pack = cardPack({ portraits: ['fenna.webp'] });
    const world = await cardWorld(t, { entries: [packEntry(pack), portraitsEntry(pack, goodPortrait())] });
    const [notice] = world.notices();
    assert.ok(notice, 'a notice');
    assert.equal(notice.parentNode, world.box(), 'in the offers box');
    assert.equal(world.box().nextElementSibling.className, 'story-suite-sheet-body', 'between the head and the tabs');
    assert.equal(text(notice.querySelector('.story-suite-notice-text')), 'This card brings Sealcrown Blocks 1.0.0 — cast, 1 portrait');
    assert.deepEqual(notice.querySelectorAll('button').map(node => node.textContent), ['Install', 'Not now']);
    assert.ok(notice.querySelector('.ss-button-primary'));
    assert.equal(world.runtime.packs.packs.list().length, 0, 'nothing is installed without the click');
    assert.equal(world.dot().hidden, false, 'the dot');
    const story = world.doc.querySelector('.story-suite-bar-story');
    assert.equal(story.getAttribute('aria-label'), 'Story (a card offer is waiting)');
});

test('a pack of data modules alone is described by the modules it adds', async t => {
    const world = await cardWorld(t, { entries: [packEntry(cardPack())] });
    assert.equal(text(world.notices()[0].querySelector('.story-suite-notice-text')), 'This card brings Sealcrown Blocks 1.0.0 \u2014 adds Reputation');
});

test('the checkbox line lists only the settings that differ; a missing NPC State Delta drops its keys with a muted line, Install still works', async t => {
    const pack = cardPack();
    const entries = [packEntry(pack), settingsEntry({ 'story-block.rpg': true, 'story-block.gear': true, 'story-block.rpgXpRate': 100, 'npc-state-delta.portraitPromptFormat': 'natural' })];
    const world = await cardWorld(t, { entries });
    const [notice] = world.notices();
    assert.equal(text(notice.querySelector('.ss-card-offer-settings')), 'Also apply: RPG on · Gear on', 'the XP rate is already 100');
    assert.equal(notice.querySelector('.ss-card-offer-settings input').checked, true, 'ticked by default');
    assert.equal(text(notice.querySelector('.ss-card-help')), 'Needs NPC State Delta for portraits and dossiers');
    assert.equal(world.button(notice, 'Install').disabled, false);
    world.runtime.sdk.registerCardSettings(nsd());
    await settle();
    const again = world.notices()[0];
    assert.equal(text(again.querySelector('.ss-card-offer-settings')), 'Also apply: RPG on · Gear on · NSD portraits Natural', 'NSD registered after the chat opened: the notice follows');
    assert.equal(again.querySelector('.ss-card-help'), null);
    // with nothing different the line is left out
    world.runtime.features.set('story-block.rpg', true);
    world.runtime.features.set('story-block.gear', true);
    world.runtime.sdk.registerCardSettings(nsd({ portraitPromptFormat: 'natural' }));
    await settle();
    assert.equal(world.notices()[0].querySelector('.ss-card-offer-settings'), null, 'nothing differs: no checkbox line');
});

test('a pack that needs a capability nobody provides: a muted line, Install disabled, Not now works; Story Director\'s "world events" is named', async t => {
    const pack = cardPack({ capabilities: ['data-modules-v1', 'chronicle-lasting'] });
    const world = await cardWorld(t, { entries: [packEntry(pack)] });
    const [notice] = world.notices();
    assert.equal(text(notice.querySelector('.ss-card-help')), 'Needs Story Director for world events');
    assert.equal(world.button(notice, 'Install').disabled, true);
    assert.equal(world.button(notice, 'Not now').disabled, false);
    await world.offer.install(world.offer.offers()[0].id);
    assert.equal(world.runtime.packs.packs.list().length, 0, 'a blocked install does nothing');
    const other = cardPack({ capabilities: ['data-modules-v1', 'tea-making'] });
    const second = await cardWorld(t, { entries: [packEntry(other)] });
    assert.equal(text(second.notices()[0].querySelector('.ss-card-help')), 'This pack needs tea-making, which no installed module provides.', 'the checker\'s own message');
});

test('Install: the pack is installed from the lorebook, the portraits stored, the data modules turned on in this chat at once, the settings applied, and the notice says what was done', async t => {
    const pack = cardPack({ portraits: ['fenna.webp'] });
    const world = await cardWorld(t, { entries: [packEntry(pack), portraitsEntry(pack, goodPortrait()), settingsEntry({ 'story-block.rpg': true, 'story-block.gear': true })] });
    let saved = 0;
    const real = world.runtime.store.saveSoon.bind(world.runtime.store);
    world.runtime.store.saveSoon = async (...args) => { saved += 1; return real(...args); };
    const [notice] = world.notices();
    world.ui.openPanel();
    const tabs = () => world.doc.querySelectorAll('.story-suite-tab').map(node => node.textContent);
    assert.ok(!tabs().includes('Reputation'));
    world.button(notice, 'Install').click();
    await settle();
    assert.ok(tabs().includes('Reputation'), 'the module\'s tab is in the strip at once: no reload, no reply');
    const listed = world.runtime.packs.packs.list();
    assert.deepEqual(listed.map(item => [item.id, item.version, item.source]), [['sealcrown', '1.0.0', 'lorebook']]);
    assert.equal(world.files.files.size, 1, 'the portrait went through the same store a zip import uses');
    assert.match(world.runtime.sdk.query('packs.portrait', { pack: 'sealcrown', file: 'fenna.webp' }), /^\/user\/files\/storysuite-portrait-sealcrown-/);
    const rows = world.runtime.sdk.query('dataModules.setup');
    assert.deepEqual(rows.map(row => [row.packId, row.pinned, row.status]), [['sealcrown', true, 'Pinned']], 'enabled in this chat now');
    assert.ok(saved >= 1, 'the chat was saved at once, not left to the idle save');
    assert.equal(world.runtime.store.dirty(), false);
    assert.equal(world.runtime.registry.featureOn('story-block.rpg'), true);
    assert.equal(world.runtime.registry.featureOn('story-block.gear'), true);
    const done = world.notices()[0];
    assert.equal(done.dataset.state, 'done');
    assert.equal(text(done.querySelector('.story-suite-notice-text')), 'Installed Sealcrown Blocks 1.0.0 with 1 portrait. 1 data module turned on in this chat. RPG and Gear are on.');
    assert.equal(done.querySelectorAll('.ss-button').length, 0, 'no buttons');
    assert.equal(world.dot().hidden, true, 'the dot goes when the offer is answered');
});

test('Install with the settings box unticked applies none of them and the notice does not mention them', async t => {
    const pack = cardPack();
    const world = await cardWorld(t, { entries: [packEntry(pack), settingsEntry({ 'story-block.rpg': true })] });
    const [notice] = world.notices();
    const box = notice.querySelector('.ss-card-offer-settings input');
    box.checked = false;
    box.dispatch('change');
    world.button(notice, 'Install').click();
    await settle();
    assert.equal(world.runtime.registry.featureOn('story-block.rpg'), false);
    assert.equal(text(world.notices()[0].querySelector('.story-suite-notice-text')), 'Installed Sealcrown Blocks 1.0.0. 1 data module turned on in this chat.');
});

test('the "Installed" notice has its own close and goes with the next reply', async t => {
    const pack = cardPack();
    const world = await cardWorld(t, { entries: [packEntry(pack)] });
    world.button(world.notices()[0], 'Install').click();
    await settle();
    assert.equal(world.notices().length, 1);
    world.notices()[0].querySelector('.story-suite-notice-close').click();
    assert.equal(world.notices().length, 0, 'closed');
    assert.equal(world.box().hidden, true);
});

test('an update (a newer version of an installed pack) keeps the chat\'s own module choice: nothing is turned on or off', async t => {
    const old = cardPack({ version: '1.0.0' });
    const world = await cardWorld(t, { installed: [old], entries: [packEntry(cardPack({ version: '1.1.0' }))] });
    const [notice] = world.notices();
    assert.equal(text(notice.querySelector('.story-suite-notice-text')), 'This card has a newer Sealcrown Blocks: 1.1.0 (installed 1.0.0)');
    assert.deepEqual(notice.querySelectorAll('button').map(node => node.textContent), ['Update', 'Not now']);
    assert.equal(world.runtime.sdk.query('dataModules.setup')[0].pinned, false, 'the chat chose not to use it');
    world.button(notice, 'Update').click();
    await settle();
    assert.equal(world.runtime.packs.packs.list()[0].version, '1.1.0');
    assert.equal(world.runtime.sdk.query('dataModules.setup')[0].pinned, false, 'still the chat\'s choice');
    assert.equal(text(world.notices()[0].querySelector('.story-suite-notice-text')), 'Updated Sealcrown Blocks 1.1.0.');
});

test('the same or an older version is not offered', async t => {
    const world = await cardWorld(t, { installed: [cardPack({ version: '1.2.0' })], entries: [packEntry(cardPack({ version: '1.2.0' })), packEntry(cardPack({ version: '1.1.0', id: 'sealcrown' }), 'Older [storysuite:pack]')] });
    assert.equal(world.notices().length, 0);
    assert.equal(world.dot().hidden, true);
    assert.equal(world.box().hidden, true);
});

test('"Not now" is remembered per card, pack id and version, writes a Diagnostics line, and asks again for a newer version', async t => {
    const settings = {};
    const world = await cardWorld(t, { entries: [packEntry(cardPack())], settings });
    world.button(world.notices()[0], 'Not now').click();
    await settle();
    assert.equal(world.notices().length, 0);
    assert.equal(world.dot().hidden, true);
    assert.deepEqual(Object.keys(world.st.ctx.extensionSettings.storySuite.cardOffers.notNow), ['ilsa.png|sealcrown|1.0.0']);
    assert.deepEqual(problems(world).map(item => item.code), ['CARD_NOT_NOW']);
    await world.offer.refresh();
    assert.equal(world.notices().length, 0, 'asked once for this version');
    // another page load, same settings: still remembered; a newer version asks again
    const again = await cardWorld(t, { entries: [packEntry(cardPack())], settings: world.st.ctx.extensionSettings.storySuite });
    assert.equal(again.notices().length, 0);
    const newer = await cardWorld(t, { entries: [packEntry(cardPack({ version: '1.0.1' }))], settings: world.st.ctx.extensionSettings.storySuite });
    assert.equal(newer.notices().length, 1);
    // another card with the same pack is a different question
    const other = await cardWorld(t, { entries: [packEntry(cardPack())], settings: { cardOffers: { notNow: { 'someone.png|sealcrown|1.0.0': true } } } });
    assert.equal(other.notices().length, 1);
});

test('a pack the checker refuses shows no notice and writes one Diagnostics line; the report carries it', async t => {
    const bad = { ...cardPack(), content: { dataModules: 'nope' } };
    const world = await cardWorld(t, { entries: [packEntry(bad, 'Broken [storysuite:pack]')] });
    assert.equal(world.notices().length, 0);
    assert.equal(world.dot().hidden, true);
    assert.deepEqual(problems(world).map(item => item.code), ['CARD_REFUSED']);
    await world.offer.refresh();
    assert.equal(problems(world).length, 1, 'the same refusal is told once');
    const report = await buildReport({ cardOffers: () => ['Card pack Broken was not offered: x'], hostVersion: '2.21.0' });
    assert.match(report, /== Card offers ==\n- Card pack Broken was not offered: x/);
});

test('skipped portraits and skipped settings keys each write a line; the offer itself still shows', async t => {
    const pack = cardPack({ portraits: ['fenna.webp'] });
    const world = await cardWorld(t, { entries: [packEntry(pack), portraitsEntry(pack, { ...goodPortrait(), 'stranger.webp': goodPortrait('stranger.webp')['stranger.webp'] }), settingsEntry({ 'story-block.rpg': true, 'story-block.tailBudget': 1, 'story-block.rpgXpRate': 999 })] });
    assert.equal(world.notices().length, 1);
    const codes = problems(world).map(item => item.code).sort();
    assert.deepEqual(codes, ['CARD_KEY_SKIPPED', 'CARD_KEY_SKIPPED', 'CARD_PORTRAIT_SKIPPED']);
    assert.equal(text(world.notices()[0].querySelector('.ss-card-offer-settings')), 'Also apply: RPG on', 'the invalid rate is not offered');
});

test('one notice per pack, at most three; the rest are told', async t => {
    const packs = ['a', 'b', 'c', 'd'].map(id => cardPack({ id: `pack-${id}` }));
    const world = await cardWorld(t, { entries: packs.map(pack => packEntry(pack, `${pack.id} [storysuite:pack]`)) });
    assert.equal(world.notices().length, 3);
    assert.deepEqual(world.notices().map(node => node.dataset.pack), ['pack-a', 'pack-b', 'pack-c']);
    assert.equal(problems(world).length, 1);
    // answering one leaves the others and the dot
    world.button(world.notices()[0], 'Not now').click();
    await settle();
    assert.equal(world.notices().length, 2);
    assert.equal(world.dot().hidden, false);
});

test('a group chat shows no offer and does not even read the card', async t => {
    const world = await cardWorld(t, { entries: [packEntry(cardPack())], group: true });
    assert.equal(world.notices().length, 0);
    assert.equal(world.dot().hidden, true);
    assert.equal(world.reads.count, 0);
});

test('a chat with no card entries behaves as 2.20.0: no notice, no dot, no lines, and the prompt is the same bytes with or without an offer waiting', async t => {
    const plain = await cardWorld(t, { entries: [{ book: 'card', uid: 9, title: 'Lore', keys: ['x'], content: 'Some lore.' }] });
    assert.equal(plain.notices().length, 0);
    assert.equal(plain.box().hidden, true);
    assert.equal(plain.dot().hidden, true);
    assert.deepEqual(problems(plain), []);
    const offered = await cardWorld(t, { entries: [packEntry(cardPack()), settingsEntry({ 'story-block.rpg': true })] });
    assert.equal(offered.notices().length, 1);
    const bytes = world => JSON.stringify(world.runtime.turn.preview().map(part => [part.place, part.text]));
    assert.equal(offered.runtime.registry.featureOn('story-block.rpg'), false);
    assert.equal(bytes(offered), bytes(plain), 'RPG off: an offer waiting changes no prompt byte');
});

test('a chat switch during the read drops the stale answer', async t => {
    const world = await cardWorld(t, { entries: [] });
    let release = null;
    world.reads.queue.push({ gate: new Promise(resolve => { release = resolve; }), entries: [packEntry(cardPack({ id: 'old-chat' }))] });
    const first = world.offer.refresh();                 // the first chat's slow read
    await world.offer.refresh();                         // the next chat opened: answered at once (no card entries)
    release();
    await first;
    await settle();
    assert.equal(world.notices().length, 0, 'the first chat\'s answer came late and was dropped');
    assert.equal(world.dot().hidden, true);
});

test('the dot shows until the offer is answered', async t => {
    const world = await cardWorld(t, { entries: [packEntry(cardPack())] });
    assert.equal(world.dot().hidden, false);
    world.button(world.notices()[0], 'Install').click();
    await settle();
    assert.equal(world.dot().hidden, true);
    assert.equal(world.doc.querySelector('.story-suite-bar-story').getAttribute('aria-label'), 'Open the story panel');
});

test('the Packs row says "N data modules" for a pack that holds data modules and nothing else countable', async t => {
    assert.equal(countsLine({ dataModules: 4 }, false), '4 data modules');
    assert.equal(countsLine({ dataModules: 1 }, false), '1 data module');
    assert.equal(countsLine({ items: 2, dataModules: 4 }, false), '2 items', 'other content is told as before');
    assert.equal(countsLine({}, false), 'no content');
    const world = await cardWorld(t, { installed: [cardPack()] });
    const listed = world.runtime.packs.packs.list()[0];
    assert.equal(addsLine(listed), '1 data module');
});

test('Install saves SillyTavern\'s settings now (not after its debounce): the pack list, portraits and settings are on disk before the chat pins anything and before the notice says "Installed"', async t => {
    const pack = cardPack({ portraits: ['fenna.webp'] });
    const disk = [];
    let world = null;
    const flushSettings = async () => {
        const root = world.st.ctx.extensionSettings.storySuite;
        disk.push({ packs: (root.packs ?? []).map(entry => entry.id), portraits: Object.keys(root.portraits?.sealcrown ?? {}), rpg: root.features?.['story-block.rpg'] ?? null,
            pinned: world.runtime.sdk.query('dataModules.setup').filter(row => row.pinned).length, noticeState: world.notices()[0]?.dataset.state });
        return { ok: true, message: '' };
    };
    world = await cardWorld(t, { entries: [packEntry(pack), portraitsEntry(pack, goodPortrait()), settingsEntry({ 'story-block.rpg': true })], flushSettings });
    world.button(world.notices()[0], 'Install').click();
    await settle();
    assert.equal(disk.length, 2, 'once after the install, once after the settings');
    assert.deepEqual(disk[0], { packs: ['sealcrown'], portraits: ['fenna.webp'], rpg: null, pinned: 0, noticeState: 'working' }, 'the pack and the portrait index are saved before any pin');
    assert.deepEqual(disk[1], { packs: ['sealcrown'], portraits: ['fenna.webp'], rpg: true, pinned: 1, noticeState: 'working' }, 'then the pins and settings, still before the notice says done');
    assert.equal(world.notices()[0].dataset.state, 'done');
});

test('if an immediate settings save fails the install goes on (pin, apply, flush again) and the notice warns that settings may not be saved; it never says "nothing else was done"', async t => {
    const pack = cardPack();
    const warn = /Settings may not have been saved; if Sealcrown Blocks is missing after a reload, import it from Settings → Tabs & Packs\.$/;
    const first = await cardWorld(t, { entries: [packEntry(pack), settingsEntry({ 'story-block.rpg': true })], flushSettings: async () => ({ ok: false, message: 'SillyTavern did not confirm that its settings were saved.' }) });
    first.button(first.notices()[0], 'Install').click();
    await settle();
    const done = first.notices()[0];
    assert.equal(done.dataset.state, 'done');
    assert.match(text(done), /^Installed Sealcrown Blocks 1\.0\.0\. 1 data module turned on in this chat\. RPG is on\./);
    assert.match(text(done), warn);
    assert.doesNotMatch(text(done), /Nothing else was done/);
    assert.equal(first.runtime.sdk.query('dataModules.setup').filter(row => row.pinned).length, 1, 'pinned all the same');
    assert.equal(first.runtime.registry.featureOn('story-block.rpg'), true);
    assert.equal(problems(first).length, 2, 'each failed save writes a line');
    let calls = 0;
    const second = await cardWorld(t, { entries: [packEntry(pack)], flushSettings: async () => (++calls === 1 ? { ok: true, message: '' } : { ok: false, message: 'SillyTavern did not confirm that its settings were saved.' }) });
    second.button(second.notices()[0], 'Install').click();
    await settle();
    assert.equal(second.notices()[0].dataset.state, 'done');
    assert.match(text(second.notices()[0]), /^Installed Sealcrown Blocks 1\.0\.0\. 1 data module turned on in this chat\. Settings may not have been saved/);
});

test('a chat switch during Install: nothing is pinned in the new chat, the player is told by notice, toast and Diagnostics, and the working offer survives the refresh', async t => {
    const pack = cardPack();
    const toasts = [];
    globalThis.toastr = { warning: (...args) => toasts.push(args) };
    t.after(() => { delete globalThis.toastr; });
    let release = null;
    const gate = new Promise(resolve => { release = resolve; });
    const world = await cardWorld(t, { entries: [packEntry(pack)], flushSettings: async () => { await gate; return { ok: true, message: '' }; } });
    world.button(world.notices()[0], 'Install').click();
    await tick();
    assert.equal(world.notices()[0].dataset.state, 'working');
    // the player opens another chat while the settings save is on its way (the testkit's loadChat tells CHAT_CHANGED; the card of the new chat has the pack too)
    await world.st.loadChat([{ name: 'Narrator', is_user: false, mes: 'Another chat.', send_date: '' }], 'chat-B');
    assert.equal(world.notices().length, 1, 'the working offer is not thrown away by the chat change');
    release();
    await settle();
    assert.deepEqual(world.runtime.packs.packs.list().map(entry => entry.id), ['sealcrown'], 'installed');
    assert.equal(world.runtime.sdk.query('dataModules.setup').filter(row => row.pinned).length, 0, 'no pin in chat-B');
    const done = world.notices().find(node => node.dataset.pack === 'sealcrown');
    assert.equal(done.dataset.state, 'done');
    assert.match(text(done), /Installed Sealcrown Blocks 1\.0\.0\. The chat changed, so its data modules were not turned on/);
    assert.deepEqual(toasts.map(args => args[0]), ['Sealcrown Blocks is installed. Turn its modules on in Settings → Data modules for that chat.']);
    assert.ok(problems(world).some(item => /chat changed during the install/.test(item.message)), 'a Diagnostics line');
});

test('a chat that pins a module whose pack is not installed loads without harm: the module stays pinned and listed, and the offer comes back', async t => {
    const pack = cardPack();
    const world = await cardWorld(t, { entries: [packEntry(pack)] });
    world.button(world.notices()[0], 'Install').click();
    await settle();
    // the settings save was lost (a reload within a second, before the fix): the pack list is gone but the chat kept its pins
    await world.runtime.packs.packs.remove('sealcrown');
    world.ui.refresh();
    const rows = world.runtime.sdk.query('dataModules.setup');
    assert.deepEqual(rows.map(row => [row.module, row.pinned, row.status]), [['pack.sealcrown/reputation', true, 'Pinned']]);
    assert.doesNotThrow(() => world.runtime.sdk.query('dataModules.view', { module: 'pack.sealcrown/reputation' }));
    await world.offer.refresh();
    assert.equal(world.notices().length, 1, 'the card offers the pack again');
    world.button(world.notices()[0], 'Install').click();
    await settle();
    assert.equal(world.runtime.sdk.query('dataModules.setup').filter(row => row.pinned).length, 1, 'still one pin: nothing doubled');
});
