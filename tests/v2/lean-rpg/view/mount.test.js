// The Lean RPG's screens on the page (ui-host.js): nothing is imported or mounted while the feature is off; on, the Party
// tab shows while the story has a Character block, the Spend points sheet saves through the real host, the settings fold
// draws and the "Changed this reply" card carries the RPG lines.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../../testkit/index.js';
import { makeMessage } from '../../../ui-fake-dom.js';
import { setupDom } from '../../view/mounts/helpers.js';
import { mountUi } from '../../../../src/v2/ui-host.js';
import { CORE_FEATURE } from '../../../../src/v2/features.js';
import { CHANGES_CARD_SCREEN_ID } from '../../../../src/v2/screens/index.js';
import { RESOLVE } from '../../../../src/v2/lean-rpg/index.js';
import { characterDefinition, defineAll, fieldsOf, foesDefinition, roleOf, setField, skillsDefinition } from './helpers.js';

const settle = async () => { for (let n = 0; n < 6; n += 1) await new Promise(resolve => setImmediate(resolve)); };

async function page(t, { feature = false } = {}) {
    const doc = setupDom();
    const form = doc.createElement('div'); form.id = 'send_form'; doc.body.appendChild(form);
    doc.defaultView = { confirm: () => true, localStorage: null };
    const host = await createHost();
    if (feature) host.features.set(CORE_FEATURE.leanRpg, true);
    const loads = [];
    // The real loader, with the block engine's `role` read from the slug while that key is not in the schema yet.
    const loadLeanRpg = () => { loads.push(1); return import('../../../../src/v2/lean-rpg/view/index.js').then(view => ({ ...view, mountLeanRpg: deps => view.mountLeanRpg({ ...deps, roleOf }) })); };
    const runtime = { registry: host.registry, store: host.store, sdk: host.sdk, settings: host.settings, events: host.events, turn: host.turn, features: host.features };
    const ui = mountUi({ runtime, ctx: host.ctx, doc, loadLeanRpg });
    t.after(() => { ui.destroy(); host.close(); });
    const draw = () => { for (const old of doc.querySelectorAll('.mes')) old.remove(); host.ctx.chat.forEach((message, index) => makeMessage(doc, index)); };
    await settle();
    return { doc, host, ui, loads, draw };
}
const hasLink = doc => doc.querySelectorAll('link[data-ss-lean-rpg]').length;
const navIds = doc => {
    const view = doc.querySelector('.ss-gameview');
    return view ? [...view.querySelectorAll('.ss-screenbar-item[data-id]'), ...view.querySelectorAll('.ss-screenbar-tile[data-id]')].map(node => node.getAttribute('data-id')) : [];
};
const PARTY = 'story-block/party';
const party = doc => doc.querySelector(`.ss-gameview [data-ss-screen="${PARTY}"]`);

test('feature off: nothing is imported, nothing is mounted, and the Party screen is not there', async t => {
    const { doc, host, ui, loads, draw } = await page(t);
    await host.send('Begin.', 'Opening.');
    await defineAll(host, [characterDefinition('wessel', 'Wessel')]);
    draw();
    await settle();
    assert.equal(loads.length, 0, 'the loader is never asked');
    assert.equal(ui.screens.resolve(PARTY), null);
    assert.equal(hasLink(doc), 0);
    assert.equal(doc.querySelectorAll('.rpg-battle').length, 0);
    ui.mounts.screen.open();
    assert.ok(!navIds(doc).includes(PARTY));
    ui.openSettings();
    assert.equal(doc.querySelectorAll('.rpg-settings').filter(node => !node.hidden).length, 0, 'no Lean RPG fold');
});

test('turning the feature on mounts it once; turning it off takes it all away; on again mounts it again', async t => {
    const { doc, host, ui, loads } = await page(t);
    host.features.set(CORE_FEATURE.leanRpg, true);
    await settle();
    assert.equal(loads.length, 1);
    assert.ok(ui.screens.resolve(PARTY));
    assert.equal(hasLink(doc), 1, 'the stylesheet is added');
    host.features.set(CORE_FEATURE.leanRpg, true);
    await settle();
    assert.equal(loads.length, 1, 'already mounted: not loaded twice');
    host.features.set(CORE_FEATURE.leanRpg, false);
    assert.equal(ui.screens.resolve(PARTY), null);
    assert.equal(hasLink(doc), 0);
    host.features.set(CORE_FEATURE.leanRpg, true);
    await settle();
    assert.equal(loads.length, 2);
    assert.ok(ui.screens.resolve(PARTY));
});

test('on at page load: it mounts when the page does', async t => {
    const { ui, loads } = await page(t, { feature: true });
    assert.equal(loads.length, 1);
    assert.ok(ui.screens.resolve(PARTY));
});

test('the Party tab shows only while there is a Character block, right after Home', async t => {
    const { doc, host, ui } = await page(t, { feature: true });
    await host.send('Begin.', 'Opening.');
    ui.mounts.screen.open();
    assert.ok(!navIds(doc).includes(PARTY), 'no Character block: no tab');
    await defineAll(host, [skillsDefinition('wessel-skills', 'Wessel'), foesDefinition()]);
    ui.mounts.screen.update();
    assert.ok(!navIds(doc).includes(PARTY), 'a Skills or Foes block alone is no party');
    await defineAll(host, [characterDefinition('wessel', 'Wessel')]);
    await settle();
    ui.mounts.screen.update();
    assert.equal(navIds(doc)[1], PARTY, 'the second place, after Home');
    ui.openPanel();
    assert.ok(doc.querySelectorAll('.story-suite-tab').some(node => /Party/.test(node.textContent)), 'the Story panel has it too');
});

test('the tab draws a card per character and the sheet saves through the real host', async t => {
    const { doc, host, ui } = await page(t, { feature: true });
    await host.send('Begin.', 'Opening.');
    await defineAll(host, [characterDefinition('wessel', 'Wessel'), characterDefinition('ren', 'Ren'), skillsDefinition('wessel-skills', 'Wessel', { tab: true, card: false, tabName: 'Skills', icon: 'ph-star' })]);
    for (const [field, value] of Object.entries({ points: 2, str: 14, soul: 2, health: 3 })) await setField(host, 'wessel', field, value);
    await setField(host, 'wessel-skills', 'skill1', 'Iron Breath');
    await host.send('Go.', 'The quay.');
    assert.equal(ui.mounts.screen.open(PARTY), true);
    await settle();
    assert.deepEqual(party(doc).querySelectorAll('.rpg-card').map(node => node.getAttribute('data-character')), ['Wessel', 'Ren'], 'no persona name here: block order');
    const card = party(doc).querySelector('.rpg-card[data-character="Wessel"]');
    assert.match(card.textContent, /2 points to spend/);
    assert.match(card.textContent, /Iron Breath \(Novice\)/);
    card.querySelector('.rpg-open').click();
    const sheet = party(doc).querySelector('.rpg-sheet');
    assert.ok(sheet, 'the sheet opens over the cards');
    assert.equal(party(doc).querySelector('.rpg-main').hidden, true);
    sheet.querySelector('.rpg-stat-step[data-stat="str"] .ss-w-stepper-inc').click();
    sheet.querySelector('.rpg-save').click();
    await settle();
    assert.deepEqual([fieldsOf(host, 'wessel').str, fieldsOf(host, 'wessel').points], [15, 1]);
    assert.equal(party(doc).querySelector('.rpg-sheet'), null, 'saved: the sheet closes');
    assert.equal(party(doc).querySelector('.rpg-main').hidden, false);
    assert.match(party(doc).querySelector('.rpg-card[data-character="Wessel"]').textContent, /1 point to spend/);
    assert.match(party(doc).querySelector('.rpg-card[data-character="Wessel"] .rpg-stat[data-stat="str"]').textContent, /15/);
    party(doc).querySelector('.rpg-card[data-character="Ren"] .rpg-open').click();
    assert.ok(party(doc).querySelector('.rpg-sheet').getAttribute('aria-label').includes('Ren: stats'), 'no points: the Stats view');
    party(doc).querySelector('.rpg-cancel').click();
    assert.equal(party(doc).querySelector('.rpg-sheet'), null);
});

test('the reader\'s own character, by the persona\'s name, is the first card', async t => {
    const { doc, host, ui } = await page(t, { feature: true });
    host.ctx.name1 = 'Ren';
    await host.send('Begin.', 'Opening.');
    await defineAll(host, [characterDefinition('wessel', 'Wessel'), characterDefinition('ren', 'Ren')]);
    await host.send('Go.', 'The quay.');
    ui.mounts.screen.open(PARTY);
    await settle();
    assert.deepEqual(party(doc).querySelectorAll('.rpg-card').map(node => node.getAttribute('data-character')), ['Ren', 'Wessel']);
    assert.equal(party(doc).querySelector('.rpg-card .rpg-sub').textContent, 'you');
});

test('the Skills button opens the Skills block\'s own tab', async t => {
    const { doc, host, ui } = await page(t, { feature: true });
    await host.send('Begin.', 'Opening.');
    await defineAll(host, [characterDefinition('wessel', 'Wessel'), skillsDefinition('wessel-skills', 'Wessel', { tab: true, card: false, tabName: 'Skills', icon: 'ph-star' })]);
    await host.send('Go.', 'The quay.');
    ui.mounts.screen.open(PARTY);
    await settle();
    party(doc).querySelector('.rpg-skills-open').click();
    assert.ok(doc.querySelector('.ss-gameview [data-ss-screen="story-block/block/wessel-skills"]'), 'the block\'s own view');
});

test('a bar tapped on a card saves through dm.set', async t => {
    const { doc, host, ui } = await page(t, { feature: true });
    await host.send('Begin.', 'Opening.');
    await defineAll(host, [characterDefinition('wessel', 'Wessel')]);
    await host.send('Go.', 'The quay.');
    ui.mounts.screen.open(PARTY);
    await settle();
    const card = party(doc).querySelector('.rpg-card[data-character="Wessel"]');
    card.querySelector('.rpg-bar[data-bar="stamina"] .ss-w-editable-pencil').click();
    const select = card.querySelector('.rpg-bar[data-bar="stamina"] select');
    select.value = '1';
    card.querySelector('.rpg-bar[data-bar="stamina"] .ss-w-editable-save').click();
    await settle();
    assert.equal(fieldsOf(host, 'wessel').stamina, 1);
    assert.match(party(doc).querySelector('.rpg-card[data-character="Wessel"] .rpg-bar[data-bar="stamina"]').textContent, /Spent/);
});

test('Settings has the Lean RPG fold while the feature is on: Rolls automatic or off', async t => {
    const { doc, host, ui } = await page(t, { feature: true });
    ui.openSettings();
    const fold = doc.querySelectorAll('.rpg-settings').find(node => !node.hidden);
    assert.ok(fold, 'the fold is there');
    assert.match(fold.querySelector('summary').textContent, /Lean RPG/);
    assert.match(fold.textContent, /Rolls/);
    const radios = fold.querySelectorAll('[role="radio"]');
    assert.deepEqual(radios.map(node => node.textContent), ['Automatic', 'Off']);
    assert.equal(radios[0].getAttribute('aria-checked'), 'true', 'automatic is the default');
    radios[1].click();
    await settle();
    assert.equal(host.settings('story-block').rolls, 'off');
    host.features.set(CORE_FEATURE.leanRpg, false);
    assert.ok(doc.querySelectorAll('.rpg-settings').every(node => node.hidden || !node.parentNode), 'off: the fold goes');
});

test('"Changed this reply" tells the rolls and the rises', async t => {
    const { doc, host, ui, draw } = await page(t, { feature: true });
    await host.send('Begin.', 'Opening.');
    await defineAll(host, [characterDefinition('wessel', 'Wessel'), skillsDefinition('wessel-skills', 'Wessel', { tab: true, card: false, tabName: 'Skills', icon: 'ph-star' })]);
    await setField(host, 'wessel', 'soul', 2);
    await setField(host, 'wessel-skills', 'skill1', 'Iron Breath');
    await setField(host, 'wessel-skills', 'rank1', 1);
    await host.send('Fight.', 'The rats come.');
    const head = host.store.headIndex();
    await setField(host, 'wessel', 'soul', 3);
    await setField(host, 'wessel-skills', 'rank1', 2);
    host.ctx.chat[head].extra.storySuite.receipts.push({ id: 'rc_rpg0001', type: RESOLVE, module: 'story-block', cause: 'system', summary: '', narrate: false, rev: 99,
        data: { v2: { result: { summary: { exchanges: 3, acts: [{ who: 'Wessel', target: 'Sluice Rat A' }] }, rounds: [] } } } });
    draw();
    ui.mounts.card.refresh(head, { force: true });
    const card = doc.querySelector(`.mes[mesid="${head}"] [data-ss-card="${CHANGES_CARD_SCREEN_ID}"]`);
    assert.ok(card);
    assert.match(card.querySelector('[data-slot="summary"]').textContent, /3 exchanges rolled/);
    assert.match(card.querySelector('[data-slot="summary"]').textContent, /Soul Class III/);
    ui.mounts.card.toggle(head, CHANGES_CARD_SCREEN_ID, true);
    const body = doc.querySelector(`.mes[mesid="${head}"] [data-ss-card="${CHANGES_CARD_SCREEN_ID}"] .ss-card-body`).textContent;
    assert.match(body, /Rolled for you: 3 exchanges/);
    assert.match(body, /Wessel: Soul Class II → III/);
    assert.match(body, /Iron Breath: Adept → Expert/);
    assert.match(body, /You set/, 'the reader\'s own edits are still told');
});

test('with the feature off the card is as it always was', async t => {
    const { doc, host, ui, draw } = await page(t);
    await host.send('Begin.', 'Opening.');
    await host.send('Go.', 'The quay.');
    const head = host.store.headIndex();
    host.ctx.chat[head].extra.storySuite.receipts.push({ id: 'rc_rpg0001', type: RESOLVE, module: 'story-block', cause: 'system', summary: '', narrate: false, rev: 99, data: { v2: { result: { exchanges: 3 } } } });
    draw();
    ui.mounts.card.refresh(head, { force: true });
    assert.doesNotMatch(doc.querySelector(`.mes[mesid="${head}"] [data-ss-card="${CHANGES_CARD_SCREEN_ID}"]`).textContent, /Rolled for you|exchanges/);
});

test('an open sheet and its draft survive the page drawing itself again (a bar edited on the sheet, a new reply)', async t => {
    const { doc, host, ui } = await page(t, { feature: true });
    await host.send('Begin.', 'Opening.');
    await defineAll(host, [characterDefinition('wessel', 'Wessel')]);
    for (const [field, value] of Object.entries({ points: 3, str: 14, health: 3 })) await setField(host, 'wessel', field, value);
    await host.send('Go.', 'The quay.');
    ui.mounts.screen.open(PARTY);
    await settle();
    party(doc).querySelector('.rpg-open').click();
    party(doc).querySelector('.rpg-stat-step[data-stat="str"] .ss-w-stepper-inc').click();
    // A bar edited on the sheet commits a change: the screen is drawn again from nothing.
    const sheet = () => party(doc).querySelector('.rpg-sheet');
    sheet().querySelector('.rpg-bar[data-bar="health"] .ss-w-editable-pencil').click();
    sheet().querySelector('.rpg-bar[data-bar="health"] select').value = '5';
    sheet().querySelector('.rpg-bar[data-bar="health"] .ss-w-editable-save').click();
    await settle();
    assert.equal(fieldsOf(host, 'wessel').health, 5);
    assert.ok(sheet(), 'still open');
    assert.equal(sheet().querySelector('.rpg-stat-step[data-stat="str"] .ss-w-stepper-input').value, '15', 'with the draft');
    assert.match(sheet().querySelector('.rpg-bar[data-bar="health"]').textContent, /Unhurt/);
    await host.send('Next.', 'More quay.');
    ui.mounts.screen.update();
    assert.ok(sheet(), 'a new reply does not close it either');
    assert.equal(fieldsOf(host, 'wessel').str, 14, 'nothing is written until Save');
});
