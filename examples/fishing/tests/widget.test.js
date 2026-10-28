import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeSdk } from './helpers/fake-sdk.js';
import { mount, fakeTimers, flush } from './helpers/fake-dom.js';
import { fishingModule, fishingProps } from '../src/module.js';
import { renderFishing, resetFishingWidget } from '../src/widget.js';

// The tab as Story Block would run it: render(el, view, api) from the head state, again after every commit.
function setup({ place = { name: 'Moonfall Lake', kind: 'wild' }, seeds } = {}) {
    resetFishingWidget();
    const fake = createFakeSdk({ seeds });
    const def = fishingModule(fake.sdk);
    fake.sdk.registerModule(def);
    if (place) fake.setPlace(place);
    const el = mount();
    const timers = fakeTimers();
    const api = { command: (type, payload, opts) => fake.sdk.command(type, payload, opts), timers };
    const render = () => def.tabs[0].render(el, fake.view(), api);
    fake.sdk.on('committed', render);
    fake.sdk.on('head', render);
    render();
    return { fake, el, timers, render };
}
const act = (el, name) => el.find(['data-act', name]);
const role = (el, name) => el.find(['data-role', name]);
const phase = el => el.find(n => n.className === 'sbf-water').getAttribute('data-phase');
const reels = fake => fake.calls.filter(c => c.type === 'fishing.reel');
async function castNow(t) {
    await act(t.el, 'cast').click();
    await flush();
    return t.fake.calls.find(c => c.type === 'fishing.cast') && Object.values(t.fake.head().domains.fishing.sessions).find(s => s.status === 'waiting');
}

test('the spot comes from the scene place', () => {
    const t = setup();
    assert.equal(role(t.el, 'kind').value, 'lake');
    assert.equal(role(t.el, 'where').textContent, 'at Moonfall Lake');
    assert.equal(act(t.el, 'cast').disabled, false);
    assert.equal(phase(t.el), 'idle');
});

test('with no water in the scene the reader picks one', async () => {
    const t = setup({ place: { name: 'Bluewatch Village', kind: 'settlement' } });
    const select = role(t.el, 'kind');
    assert.equal(select.value, '');
    assert.equal(act(t.el, 'cast').disabled, true);
    select.value = 'sea';
    await select.dispatch('change');
    assert.equal(role(t.el, 'where').textContent, 'at the sea by Bluewatch Village');
    await castNow(t);
    const cast = t.fake.calls.find(c => c.type === 'fishing.cast');
    assert.deepEqual(cast.payload, { spot: { name: 'the sea by Bluewatch Village', kind: 'sea' } });
    assert.equal(cast.cause, 'ui');
});

test('Reel pressed inside the bite window lands the fish', async () => {
    const t = setup();
    const session = await castNow(t);
    assert.equal(phase(t.el), 'waiting');
    await t.timers.advance(session.bite.bite);
    assert.equal(phase(t.el), 'bite');
    assert.match(role(t.el, 'status').textContent, /A bite/);
    await t.timers.advance(Math.floor(session.bite.window / 2));
    await act(t.el, 'reel').click();
    await flush();
    assert.deepEqual(reels(t.fake).map(c => c.payload), [{ session: session.id, hooked: true }]);
    assert.equal(t.fake.calls.filter(c => c.type === 'inventory.grant').length, 1);
    assert.match(role(t.el, 'message').textContent, /lands an? .+ at Moonfall Lake\./);
    assert.equal(phase(t.el), 'idle');
    assert.equal(t.el.findAll(n => n.className?.startsWith('sbf-catch ')).length, 1);
    assert.equal(t.timers.pending(), 0);
});

test('Reel pressed before the bite spooks the fish and grants nothing', async () => {
    const t = setup();
    const session = await castNow(t);
    await t.timers.advance(session.bite.bite - 200);
    await act(t.el, 'reel').click();
    await flush();
    assert.deepEqual(reels(t.fake).map(c => c.payload), [{ session: session.id, hooked: false }]);
    assert.equal(t.fake.calls.filter(c => c.type === 'inventory.grant').length, 0);
    assert.match(role(t.el, 'message').textContent, /^Too soon: the fish was spooked\. Something takes the bait/);
});

test('a line left unpressed past the window is lost', async () => {
    const t = setup();
    const session = await castNow(t);
    await t.timers.advance(session.bite.bite + session.bite.window + 5);
    await flush();
    assert.deepEqual(reels(t.fake).map(c => c.payload), [{ session: session.id, hooked: false }]);
    assert.equal(t.fake.head().domains.fishing.sessions[session.id].status, 'lost');
    assert.equal(t.fake.calls.filter(c => c.type === 'inventory.grant').length, 0);
    // Pressing after the line is lost does nothing more.
    assert.equal(reels(t.fake).length, 1);
});

test('re-rendering while the line is out keeps its clock and casts nothing', async () => {
    const t = setup();
    const session = await castNow(t);
    await t.timers.advance(1000);
    t.render();
    t.render();
    assert.equal(t.fake.calls.filter(c => c.type === 'fishing.cast').length, 1);
    assert.equal(phase(t.el), 'waiting');
    await t.timers.advance(session.bite.bite - 1000);
    assert.equal(phase(t.el), 'bite');
    await act(t.el, 'reel').click();
    await flush();
    assert.deepEqual(reels(t.fake).map(c => c.payload.hooked), [true]);
    t.render();
    assert.equal(reels(t.fake).length, 1);
});

test('the bite time shown is the one the cast receipt decided', async () => {
    for (const seed of [11, 12]) {
        const t = setup({ seeds: [seed] });
        const session = await castNow(t);
        await t.timers.advance(session.bite.bite - 1);
        assert.equal(phase(t.el), 'waiting');
        await t.timers.advance(1);
        assert.equal(phase(t.el), 'bite');
    }
});

test('Release on a logged catch lets it go', async () => {
    const t = setup();
    const session = await castNow(t);
    await t.timers.advance(session.bite.bite);
    await act(t.el, 'reel').click();
    await flush();
    await act(t.el, 'release').click();
    await flush();
    const release = t.fake.calls.find(c => c.type === 'fishing.release');
    assert.ok(release);
    assert.equal(release.payload.catch, t.fake.head().domains.fishing.log[0].id);
    assert.match(role(t.el, 'message').textContent, /go back into Moonfall Lake\./);
    assert.equal(act(t.el, 'release'), null);
    assert.ok(t.el.find(n => n.className === 'sbf-released'));
});

test('a rejected cast shows its message', async () => {
    const t = setup();
    const el = mount();
    const api = { command: async () => ({ ok: false, code: 'INVALID', message: 'The ice is too thick.' }), timers: fakeTimers() };
    renderFishing(el, fishingProps(t.fake.view()), api);
    await act(el, 'cast').click();
    await flush();
    assert.equal(role(el, 'message').textContent, 'The ice is too thick.');
    assert.equal(act(el, 'cast').disabled, false);
});

test('values in the log use the currency hook when a module offers one', async () => {
    const t = setup();
    t.fake.sdk.registerModule({ id: 'currency-demo', hooks: { currency: () => ({ mode: 'single', single: 'marks' }) } });
    const session = await castNow(t);
    await t.timers.advance(session.bite.bite);
    await act(t.el, 'reel').click();
    await flush();
    t.render();
    const entry = t.fake.head().domains.fishing.log[0];
    assert.match(t.el.find(n => n.className === 'sbf-catch-text').textContent, new RegExp(` · ${entry.value} marks$`));
});

test('the widget runs on its own when nothing re-renders it (a layout widget)', async () => {
    resetFishingWidget();
    const fake = createFakeSdk();
    fake.sdk.registerModule(fishingModule(fake.sdk));
    const el = mount();
    const timers = fakeTimers();
    const api = { command: (type, payload) => fake.sdk.command(type, payload, { cause: 'ui' }), timers };
    renderFishing(el, { spot: { name: 'the Old Weir', kind: 'river' }, place: null, session: null, log: [], last: null }, api);
    await act(el, 'cast').click();
    await flush();
    assert.equal(phase(el), 'waiting');
    const session = Object.values(fake.head().domains.fishing.sessions)[0];
    await timers.advance(session.bite.bite);
    await act(el, 'reel').click();
    await flush();
    assert.equal(phase(el), 'idle');
    assert.match(role(el, 'message').textContent, /lands an? .+ at the Old Weir\./);
});

test('the registered fishing widget looks up what a layout leaves out', async () => {
    resetFishingWidget();
    const fake = createFakeSdk();
    const def = fishingModule(fake.sdk);
    fake.sdk.registerModule(def);
    fake.setPlace({ name: 'Moonfall Lake', kind: 'wild' });
    assert.ok(def.widgets.fishing.props.session);
    const el = mount();
    const timers = fakeTimers();
    const api = { query: fake.sdk.query, command: (type, payload) => fake.sdk.command(type, payload), timers };
    def.widgets.fishing.render(el, {}, api);
    assert.equal(role(el, 'where').textContent, 'at Moonfall Lake');
    await act(el, 'cast').click();
    await flush();
    // A layout re-rendering the widget with no props still finds the open line by query.
    def.widgets.fishing.render(el, {}, api);
    assert.equal(phase(el), 'waiting');
    const open = fake.sdk.query('fishing.session');
    await timers.advance(open.bite);
    await act(el, 'reel').click();
    await flush();
    def.widgets.fishing.render(el, {}, api);
    assert.equal(el.findAll(n => n.className?.startsWith('sbf-catch ')).length, 1);
    assert.equal(fake.calls.find(c => c.type === 'fishing.cast').cause, 'ui');
});
