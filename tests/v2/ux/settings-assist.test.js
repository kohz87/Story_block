// The Assist section (src/v2/view/settings/assist.js, UI stage step 3d): Story Block's two optional helpers on the form engine:
// Extra calls, Checks (pre-roll), Safety net (kinds as chips), Recent runs. The switches are Features, so the Features page and
// this one agree; a row that cannot work now is drawn and locked with the reason, never hidden; the value wall is stated, and
// no chip is on the wrong side of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { setupDom } from '../view/mounts/helpers.js';
import { openSettingsWindow } from '../../../src/v2/view/settings/window.js';
import { ASSIST_FOLD, ASSIST_HOST_KEYS, ASSIST_TEXT, assistSchema } from '../../../src/v2/view/settings/assist.js';
import { DEFAULT_KINDS, KIND_CHOICES, allowedKinds, refusedWhy } from '../../../src/v2/assist/safety.js';
import { SETTING } from '../../../src/v2/assist/common.js';
import { CORE_FEATURE } from '../../../src/v2/features.js';
import { PROFILE_TEXT } from '../../../src/v2/profile-field.js';
import { FORM_TEXT } from '../../../src/v2/view/form/schema.js';

// A module that keeps checks (RPG Battle's `check` kind), so the pre-roll can run.
const CHECKS = { id: 'checks', name: 'Checks', capture: { kinds: { check: { grammar: '? check skill — what | dc: normal' } }, apply: () => ({ summary: 'checked', narrate: false }) } };
const PROFILES = { usable: true, profiles: [{ name: 'Cheap' }, { name: 'Main' }] };

async function open({ modules = [], own = {}, profiles = () => PROFILES, window = {} } = {}) {
    const doc = setupDom();
    const host = await createHost({ modules, settings: { modules: { 'story-block': own } } });
    const win = openSettingsWindow({ registry: host.registry, settings: host.settings, features: host.features, doc, sdk: host.sdk, openState: new Map(), profiles, ...window });
    win.select('assist');
    const page = win.root.querySelectorAll('.ss-settings-page').find(node => node.dataset.ssSection === 'assist');
    return { doc, host, win, root: win.root, page };
}
const field = (page, key) => page.querySelector(`.ss-field[data-field="${key}"]`);
const control = row => row.querySelector('input, select, button');
const tag = row => row.querySelector('.ss-field-tag');
const locked = row => row.getAttribute('data-readonly') === 'true';
const chips = page => field(page, SETTING.extractorKinds).querySelectorAll('.ss-chip');
const pressed = page => chips(page).filter(chip => chip.getAttribute('aria-pressed') === 'true').map(chip => chip.textContent);
const stored = host => host.settings('story-block');
const switchOf = (page, id) => field(page, id).querySelector('input, button');

test('the page: Extra calls, Checks, Safety net, then Recent runs, in the form engine, with no fold', async () => {
    const { page, host } = await open();
    assert.ok(page.querySelector('.ss-form').classList.contains('ss-assist-page'));
    assert.deepEqual(page.querySelectorAll('.ss-section-title').map(node => node.textContent), ['Extra calls', 'Checks', 'Safety net', 'Recent runs']);
    assert.deepEqual(page.querySelectorAll('.ss-form .ss-section').map(card => card.querySelectorAll('.ss-field').map(row => row.dataset.field)), [
        [SETTING.profile, 'callQueue'], [CORE_FEATURE.preroll], [CORE_FEATURE.extractor, SETTING.extractorProfile, SETTING.extractorKinds],
    ]);
    assert.equal(page.querySelectorAll('details').length, 0);
    assert.equal(page.querySelectorAll('.story-suite-row').length, 0, 'the old rows are gone');
    assert.equal(field(page, SETTING.profile).querySelector('.ss-field-label').textContent, ASSIST_TEXT.profile);
    assert.equal(field(page, CORE_FEATURE.preroll).querySelector('.ss-field-label').textContent, 'Roll checks before the reply');
    assert.equal(field(page, 'callQueue').querySelector('.ss-field-label').textContent, 'Run extra calls one at a time per connection');
    // The old Assist panel is the last card; no "N settings shown" line of its own.
    assert.ok(page.querySelector('.ss-assist-runs-card .ss-assist'));
    assert.equal(page.querySelector('.ss-form-status').hidden, true);
    assert.deepEqual(ASSIST_HOST_KEYS, ['callQueue']);
    assert.equal(ASSIST_FOLD, 'story-block::group:Assist');
    host.close();
});

test('the safety net: a switch in the Features store; its profile and kinds are drawn and locked, with the reason, while it is off', async () => {
    const { page, host, win, root } = await open();
    const net = field(page, CORE_FEATURE.extractor);
    assert.equal(host.features.on(CORE_FEATURE.extractor), false);
    assert.equal(switchOf(page, CORE_FEATURE.extractor).getAttribute('aria-checked') ?? String(switchOf(page, CORE_FEATURE.extractor).checked), 'false');
    // Off: both rows are there, locked, and say why; they are not hidden.
    for (const key of [SETTING.extractorProfile, SETTING.extractorKinds]) {
        const row = field(page, key);
        assert.ok(row && !row.hidden, `${key} is drawn`);
        assert.equal(locked(row), true, `${key} is locked`);
        assert.equal(tag(row).hidden, false);
        assert.equal(tag(row).textContent, ASSIST_TEXT.netOff);
        assert.ok(tag(row).classList.contains('ss-field-tag-why'));
    }
    assert.ok(chips(page).every(chip => chip.disabled), 'the chips are locked');
    assert.equal(control(field(page, SETTING.extractorProfile)).disabled, true);
    // The shared profile is off while both helpers are off.
    assert.equal(locked(field(page, SETTING.profile)), true);
    assert.equal(tag(field(page, SETTING.profile)).textContent, ASSIST_TEXT.bothOff);
    // Turn it on: the same store the Features page writes through.
    switchOf(page, CORE_FEATURE.extractor).click();
    assert.equal(host.features.on(CORE_FEATURE.extractor), true);
    assert.equal(net.querySelector('.ss-field-error')?.hidden ?? true, true);
    for (const key of [SETTING.extractorProfile, SETTING.extractorKinds, SETTING.profile]) {
        assert.equal(locked(field(page, key)), false, `${key} is open now`);
        assert.equal(tag(field(page, key)).hidden, true);
    }
    assert.ok(chips(page).every(chip => !chip.disabled));
    assert.equal(control(field(page, SETTING.extractorProfile)).disabled, false);
    // The Features page agrees (it was redrawn).
    const tile = root.querySelectorAll('.ss-settings-page').find(node => node.dataset.ssSection === 'features').querySelector(`[data-feature="${CORE_FEATURE.extractor}"], .ss-field[data-field="${CORE_FEATURE.extractor}"]`);
    assert.ok(tile);
    assert.equal(win.section(), 'assist');
    // Turned off from the store (as the Features page does): this page follows on a refresh.
    host.features.set(CORE_FEATURE.extractor, false);
    win.refresh();
    assert.equal(locked(field(page, SETTING.extractorKinds)), true);
    assert.equal(switchOf(page, CORE_FEATURE.extractor).getAttribute('aria-checked') ?? String(switchOf(page, CORE_FEATURE.extractor).checked), 'false');
    host.close();
});

test('pre-roll: drawn and locked, with the reason the feature gives, while no module keeps checks; live once one does', async () => {
    const without = await open();
    const row = field(without.page, CORE_FEATURE.preroll);
    assert.ok(row && !row.hidden);
    assert.equal(locked(row), true);
    assert.equal(tag(row).textContent, 'Needs a module that keeps checks, like Story Director.');
    assert.equal(control(row).disabled, true);
    without.host.close();
    const { page, host } = await open({ modules: [CHECKS] });
    assert.equal(locked(field(page, CORE_FEATURE.preroll)), false);
    assert.equal(host.features.on(CORE_FEATURE.preroll), false);
    // The shared profile is off while both are off, and opens as soon as one is on.
    assert.equal(locked(field(page, SETTING.profile)), true);
    switchOf(page, CORE_FEATURE.preroll).click();
    assert.equal(host.features.on(CORE_FEATURE.preroll), true);
    assert.equal(locked(field(page, SETTING.profile)), false);
    switchOf(page, CORE_FEATURE.preroll).click();
    assert.equal(host.features.on(CORE_FEATURE.preroll), false);
    assert.equal(locked(field(page, SETTING.profile)), true);
    host.close();
});

test('allowed kinds are chips: one per kind the wall lets through; the stored text follows, and entries the chips do not list are kept', async () => {
    const { page, host, win } = await open({ own: { assistExtractorKinds: '~ time, ~ place, ~ mood' } });
    host.features.set(CORE_FEATURE.extractor, true);
    win.refresh();
    assert.deepEqual(chips(page).map(chip => chip.textContent), KIND_CHOICES.map(choice => choice.label));
    assert.equal(chips(page).length, 10);
    // The stored list is read: two chips on, an unknown entry kept.
    assert.deepEqual(pressed(page), ['Time moves on', 'Place']);
    chips(page)[5].click();
    assert.equal(stored(host).assistExtractorKinds, '~ time, ~ place, ~ weather, ~ mood');
    chips(page)[0].click();
    assert.equal(stored(host).assistExtractorKinds, '! time, ~ time, ~ place, ~ weather, ~ mood');
    chips(page)[1].click();
    chips(page)[2].click();
    assert.equal(stored(host).assistExtractorKinds, '! time, ~ weather, ~ mood');
    assert.deepEqual([...allowedKinds(stored(host).assistExtractorKinds)], ['! time', '~ weather', '~ mood']);
    host.close();
});

test('the default list is every chip on, and the page states the wall plainly', async () => {
    const { page, host } = await open();
    assert.equal(stored(host).assistExtractorKinds, DEFAULT_KINDS);
    assert.deepEqual(pressed(page), KIND_CHOICES.map(choice => choice.label));
    const wall = page.querySelectorAll('.ss-assist-wall').map(node => node.textContent);
    assert.equal(wall.length, 2);
    assert.equal(wall[0], ASSIST_TEXT.wall);
    assert.match(wall[0], /^Never coin, new items, XP, loot or healing\./);
    assert.match(wall[1], /wait for the next reply/);
    assert.ok(field(page, SETTING.extractorKinds).parentNode.contains(page.querySelector('.ss-assist-wall')), 'in the Safety net card, after the kinds');
    // None of those has a chip.
    const labels = chips(page).map(chip => chip.textContent.toLowerCase()).join(' | ');
    for (const word of ['coin', 'new item', 'xp', 'loot', 'heal']) assert.ok(!labels.includes(word), `no "${word}" chip`);
    host.close();
});

test('no chip is on the wrong side of the value wall, and the things without a chip are refused whatever is stored', () => {
    const line = (op, kind, labels = {}) => ({ op, kind, name: 'X', labels });
    for (const choice of KIND_CHOICES) {
        const [op, kind] = choice.value.split(' ');
        assert.equal(refusedWhy(line(op, kind), allowedKinds(choice.value)), '', `${choice.value} passes the wall`);
    }
    assert.deepEqual(KIND_CHOICES.map(choice => choice.value), [...allowedKinds(DEFAULT_KINDS)], 'the chips are the default list, in its order');
    const stuffed = allowedKinds('+ coin, + coins, + gold, + item, + loot, + xp, ~ xp, + reward, ~ heal, ? roll');
    for (const [op, kind, labels] of [['+', 'coin'], ['+', 'gold'], ['+', 'item'], ['+', 'loot'], ['+', 'xp'], ['~', 'xp'], ['+', 'reward'], ['~', 'wound', { heal: '5' }], ['?', 'roll']]) {
        assert.notEqual(refusedWhy(line(op, kind, labels), stuffed), '', `${op} ${kind} is refused`);
    }
});

test('a profile select with only "Same as chat" to pick is disabled, with a note; with profiles it is open and writes the name', async () => {
    const none = await open({ profiles: () => ({ usable: false, why: 'The Connection Manager is off.' }) });
    none.host.features.set(CORE_FEATURE.extractor, true);
    none.win.refresh();
    for (const key of [SETTING.profile, SETTING.extractorProfile]) {
        const row = field(none.page, key);
        assert.equal(control(row).disabled, true, `${key} has nothing to pick`);
        assert.equal(row.querySelector('.ss-field-note').textContent, 'The Connection Manager is off.');
        assert.deepEqual(row.querySelectorAll('option').map(node => node.textContent), [PROFILE_TEXT.same]);
    }
    none.host.close();
    const empty = await open({ profiles: () => ({ usable: true, profiles: [] }) });
    assert.equal(control(field(empty.page, SETTING.profile)).disabled, true);
    assert.equal(field(empty.page, SETTING.profile).querySelector('.ss-field-note').textContent, PROFILE_TEXT.none);
    empty.host.close();

    const { page, host, win } = await open();
    host.features.set(CORE_FEATURE.extractor, true);
    win.refresh();
    const select = control(field(page, SETTING.extractorProfile));
    assert.equal(select.disabled, false);
    assert.deepEqual(select.querySelectorAll('option').map(node => node.textContent), [PROFILE_TEXT.same, 'Cheap', 'Main']);
    select.value = 'Cheap';
    select.dispatch('change');
    assert.equal(stored(host).assistExtractorProfile, 'Cheap');
    const shared = control(field(page, SETTING.profile));
    shared.value = 'Main';
    shared.dispatch('change');
    assert.equal(stored(host).assistProfile, 'Main');
    // A stored profile that is gone stays, named, with the note; the select is open so it can be changed.
    host.settings.set('story-block', SETTING.extractorProfile, 'Old One');
    win.refresh();
    const gone = field(page, SETTING.extractorProfile);
    assert.equal(control(gone).disabled, false);
    assert.match(gone.querySelector('.ss-field-note').textContent, /"Old One" is not in the Connection Manager any more/);
    host.close();
});

test('the call queue switch moved here from the Story Suite fold: same host setting, same default', async () => {
    const { page, host, root } = await open();
    const row = field(page, 'callQueue');
    assert.ok(row);
    assert.equal(host.settings().callQueue, true, 'on by default');
    assert.equal(switchOf(page, 'callQueue').getAttribute('aria-checked') ?? String(switchOf(page, 'callQueue').checked), 'true');
    switchOf(page, 'callQueue').click();
    assert.equal(host.settings().callQueue, false);
    // Not in the Story Suite fold any more.
    const tabs = root.querySelectorAll('.ss-settings-page').find(node => node.dataset.ssSection === 'tabs');
    assert.equal(tabs.querySelector('[data-field="callQueue"]'), null);
    host.close();
});

test('search finds the rows and the runs card; the old fold id still opens the page with the focus on its first control', async () => {
    const { page, win, root } = await open();
    const input = root.querySelector('.ss-search-input');
    input.value = 'safety net';
    input.dispatch('input');
    const shown = page.querySelectorAll('.ss-field').filter(row => !row.hidden && !row.parentNode.hidden).map(row => row.dataset.field);
    assert.ok(shown.includes(CORE_FEATURE.extractor));
    assert.ok(shown.includes(SETTING.extractorKinds));
    input.value = 'nonsense-xyz';
    input.dispatch('input');
    assert.equal(page.querySelectorAll('.ss-field').filter(row => !row.hidden && !row.parentNode.hidden).length, 0);
    input.value = '';
    input.dispatch('input');
    assert.ok(win.select('assist'));
    win.close();
    const again = await open({ window: { fold: ASSIST_FOLD } });
    assert.equal(again.win.section(), 'assist');
    assert.ok(again.doc.activeElement && again.page.contains(again.doc.activeElement));
    again.host.close();
});

test('Recent runs: Refresh draws the panel again and the focus stays on the Refresh button (so Escape still closes the window)', async () => {
    const { page, host, doc, win } = await open();
    const refresh = () => page.querySelector('.ss-assist-runs-card .ss-assist-refresh');
    const before = refresh();
    before.focus();
    assert.ok(doc.activeElement === before);
    before.click();
    assert.ok(refresh() !== before, 'drawn again');
    assert.ok(doc.activeElement === refresh(), 'the focus is on the new button');
    // A redraw while the focus is elsewhere does not take it.
    const net = switchOf(page, CORE_FEATURE.extractor);
    net.focus();
    win.refresh();
    assert.ok(doc.activeElement === net || doc.activeElement === switchOf(page, CORE_FEATURE.extractor));
    host.close();
});

test('assistSchema: without a feature store, the switches are locked and say so; without the Assist part the page draws no rows', async () => {
    const featureOf = () => null;
    const { schema, sources } = assistSchema({ featureOf, on: () => false, hostSettings: Object.assign(() => ({}), { set: () => {} }), features: null });
    assert.equal(schema[CORE_FEATURE.extractor].readOnly(), true);
    assert.equal(schema[CORE_FEATURE.extractor].lockText(), ASSIST_TEXT.noFeatures);
    assert.equal(sources[CORE_FEATURE.extractor].set(true), undefined, 'a refusal');
    assert.equal(sources[CORE_FEATURE.extractor].get(), false);
    assert.equal(FORM_TEXT.readOnly, 'Read only', 'the default tag text is unchanged');
    const bare = await open({ window: { registry: { settingsDefs: () => [], module: () => null, modules: () => [] } } });
    assert.equal(bare.page.querySelectorAll('.ss-field').length, 0);
    assert.equal(bare.page.querySelector('.ss-assist-runs-card'), null);
    bare.host.close();
});
