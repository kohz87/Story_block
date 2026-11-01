// The game view's header is the one place for the scene (view/widgets/hero.js `where`, view/game-header.js): the time, the place, the
// weather and a "Here: names" item (the people present), in that order; the place, the weather and Here carry the pencils Home's Where
// card had (the same commands: `scene.place`, `scene.weather`, `scene.present`). The words wrap (they are never cut); an empty place,
// weather or Here still shows with its pencil, so there is always a way to set it; the weather feature off takes the weather and its
// pencil away. Without `where` (a card, the UI sample) the corner is read-only and has no Here item.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHost } from '../../../testkit/index.js';
import { mountUi } from '../../../src/v2/ui-host.js';
import { CORE_FEATURE } from '../../../src/v2/features.js';
import { gameHeroProps } from '../../../src/v2/view/game-header.js';
import { hero } from '../../../src/v2/view/widgets/hero.js';
import { setupDom } from './mounts/helpers.js';
import { fakeApi, host as widgetHost, installDom } from './widgets/fake-dom.js';

const settle = async () => { for (let n = 0; n < 6; n += 1) await new Promise(resolve => setImmediate(resolve)); };
const WHERE = { present: ['Fenna', 'Hooded courier'], places: [{ name: 'Bluewatch Village' }, { name: 'The Weir' }], weatherOn: true, place: 'Bluewatch Village', weatherText: 'heavy rain, rising river' };
const LEAD = { name: 'Wessel', place: 'Bluewatch Village', time: 'CY 611, Goldwane 12, 1:30 pm', weather: 'heavy rain, rising river', where: WHERE };

function draw(props, api = fakeApi()) {
    const doc = installDom();
    const el = widgetHost(doc);
    const handle = hero.render(el, props, api);
    const kinds = () => el.querySelectorAll('.ss-hero-corner-item').map(item => item.getAttribute('data-kind'));
    const item = kind => el.querySelector(`.ss-hero-corner-item[data-kind="${kind}"]`);
    const words = kind => item(kind)?.querySelector('.ss-hero-corner-text')?.textContent;
    const pencil = kind => item(kind)?.querySelector('button.ss-w-editable-pencil');
    return { el, doc, handle, api, kinds, item, words, pencil };
}

test('the corner: time, place, weather, then Here with the people; a pencil on the place, the weather and Here (not the time)', () => {
    const { kinds, words, pencil } = draw(LEAD);
    assert.deepEqual(kinds(), ['time', 'place', 'weather', 'here']);
    assert.equal(words('time'), 'CY 611, Goldwane 12, 1:30 pm');
    assert.equal(words('place'), 'Bluewatch Village');
    assert.equal(words('weather'), 'heavy rain, rising river');
    assert.equal(words('here'), 'Here: Fenna, Hooded courier');
    assert.equal(pencil('time'), null, 'the story\'s clock is not edited here');
    assert.equal(pencil('place').getAttribute('aria-label'), 'Edit place');
    assert.equal(pencil('weather').getAttribute('aria-label'), 'Edit weather');
    assert.equal(pencil('here').getAttribute('aria-label'), 'Edit people present');
});

test('the pencils run the same commands as Home\'s Where card did, with the same payloads', async () => {
    const { api, el, item, pencil } = draw({ ...LEAD, where: { ...WHERE, places: [] } });
    pencil('place').click();
    item('place').querySelector('input').value = 'The Weir';
    item('place').querySelector('.ss-w-editable-save').click();
    await settle();
    assert.deepEqual(api.commands.at(-1), { type: 'scene.place', payload: { with: ['Fenna', 'Hooded courier'], name: 'The Weir' } }, 'the people stay with the move, as on Home');
    pencil('weather').click();
    item('weather').querySelector('input').value = 'clear';
    item('weather').querySelector('.ss-w-editable-save').click();
    await settle();
    assert.deepEqual(api.commands.at(-1), { type: 'scene.weather', payload: { text: 'clear' } });
    pencil('here').click();
    item('here').querySelector('input').value = 'Ivo';
    item('here').querySelector('.ss-w-editable-save').click();
    await settle();
    assert.deepEqual(api.commands.at(-1), { type: 'scene.present', payload: { set: ['Fenna', 'Hooded courier', 'Ivo'] } });
    void el;
});

test('an empty place, weather or Here still shows, with its pencil; the time does not (nothing to edit there)', () => {
    const { kinds, words, pencil, item } = draw({ name: 'Wessel', where: { present: [], places: [], weatherOn: true } });
    assert.deepEqual(kinds(), ['place', 'weather', 'here']);
    assert.equal(words('place'), 'Somewhere not yet named');
    assert.equal(words('weather'), '—');
    assert.equal(words('here'), 'Here: —');
    assert.ok(item('place').classList.contains('ss-hero-corner-empty'));
    for (const kind of ['place', 'weather', 'here']) assert.ok(pencil(kind), `${kind} has a pencil`);
});

test('the weather feature off: no weather and no weather pencil, even where the story still has weather words', () => {
    const { kinds, item } = draw({ ...LEAD, where: { ...WHERE, weatherOn: false } });
    assert.deepEqual(kinds(), ['time', 'place', 'here']);
    assert.equal(item('weather'), null);
});

test('without `where` the corner is what it was: read-only, and no Here item', () => {
    const { kinds, pencil } = draw({ name: 'Ren', place: 'Weir', time: 'Day 2', weather: 'Fog' });
    assert.deepEqual(kinds(), ['time', 'place', 'weather']);
    for (const kind of kinds()) assert.equal(pencil(kind), null);
    assert.deepEqual(draw({ name: 'Ren' }).kinds(), [], 'nothing to say: no corner items');
});

test('a redraw keeps the pencils and an open edit; only the words change', () => {
    const m = draw(LEAD);
    m.pencil('here').click();
    const form = m.item('here').querySelector('.ss-w-editable-form');
    assert.ok(form, 'the edit is open');
    m.handle.update({ ...LEAD, place: 'The Weir', where: { ...WHERE, place: 'The Weir', present: ['Fenna'] } });
    assert.equal(m.words('place'), 'The Weir');
    assert.equal(m.item('here').querySelector('.ss-w-editable-form'), form, 'the same open form');
    assert.deepEqual(m.kinds(), ['time', 'place', 'weather', 'here'], 'the same items in the same order');
});

test('the words are cut for the corner, never the place the pencil starts from; Here is cut at 120', () => {
    const long = 'P'.repeat(60);
    const m = draw({ name: 'Wessel', place: long, where: { present: Array.from({ length: 12 }, (_, at) => `Person${at}-${'x'.repeat(10)}`), places: [], weatherOn: true, place: long } });
    assert.equal(m.words('place').length, 40, 'the corner shows 40');
    m.pencil('place').click();
    assert.equal(m.item('place').querySelector('input').value, long, 'the edit starts from the whole name');
    assert.ok(m.words('here').length <= 'Here: '.length + 120);
});

test('gameHeroProps reads the pencils\' data: the people, the pack\'s places, whether the weather feature is on', () => {
    const answers = { 'scene.place': { name: 'Bluewatch Village' }, 'scene.weather': { text: 'rain' }, 'scene.present': ['Fenna', ' ', 'Ivo'], 'packs.content': [{ name: 'The Weir' }] };
    const asked = [];
    const query = (name, args) => { asked.push([name, args]); return answers[name] ?? null; };
    const props = gameHeroProps({ state: {}, query, context: { personaName: 'Wessel' } });
    assert.deepEqual(props.where, { present: ['Fenna', 'Ivo'], places: [{ name: 'The Weir' }], weatherOn: true, place: 'Bluewatch Village', weatherText: 'rain' });
    assert.deepEqual(asked.find(([name]) => name === 'packs.content')[1], { kind: 'places' });
    assert.equal(gameHeroProps({ state: {}, query, context: {}, weatherOn: false }).where.weatherOn, false);
    const bare = gameHeroProps({ state: {}, query: () => null, context: {} });
    assert.deepEqual(bare.where, { present: [], places: [], weatherOn: true, place: '', weatherText: '' });
});

test('the page: the header\'s pencils change the scene through the real commands, and Home has no Where card under the header', async t => {
    t.mock.method(console, 'warn', () => {});
    const doc = setupDom(), form = doc.createElement('div');
    form.id = 'send_form';
    doc.body.appendChild(form);
    const h = await createHost();
    const ui = mountUi({ runtime: h, ctx: h.ctx, doc });
    t.after(() => { ui.destroy(); h.close(); });
    await h.send('Look.', 'The road.\n\n<Changes>\n~ place Vell Harbour | kind: settlement\n~ weather cold drizzle\n+ present Fenna\n</Changes>');
    assert.equal(ui.mounts.screen.open('story-block/home'), true);
    const words = kind => doc.querySelector(`.ss-gameview-hero .ss-hero-corner-item[data-kind="${kind}"] .ss-hero-corner-text`)?.textContent;
    assert.equal(words('place'), 'Vell Harbour');
    assert.equal(words('weather'), 'cold drizzle');
    assert.equal(words('here'), 'Here: Fenna');
    assert.equal(doc.querySelector('.ss-gameview-body section.scene'), null, 'the header has the scene: Home has no Where card');
    const item = kind => doc.querySelector(`.ss-gameview-hero .ss-hero-corner-item[data-kind="${kind}"]`);
    item('here').querySelector('button.ss-w-editable-pencil').click();
    item('here').querySelector('input').value = 'Ivo';
    item('here').querySelector('.ss-w-editable-add').click();
    item('here').querySelector('.ss-w-editable-save').click();
    await settle();
    assert.deepEqual(h.sdk.query('scene.present'), ['Fenna', 'Ivo']);
    assert.equal(words('here'), 'Here: Fenna, Ivo');
    item('weather').querySelector('button.ss-w-editable-pencil').click();
    item('weather').querySelector('input').value = 'clear sky';
    item('weather').querySelector('.ss-w-editable-save').click();
    await settle();
    assert.equal(h.sdk.query('scene.weather').text, 'clear sky');
    assert.equal(words('weather'), 'clear sky');
    // The weather feature off: the header leaves it out, and its pencil with it.
    h.features.set(CORE_FEATURE.weather, false);
    await settle();
    ui.mounts.screen.update();
    assert.equal(words('weather'), undefined);
});

test('the corner\'s words wrap on a phone and a wide screen alike; the touch areas of its pencils are kept apart', () => {
    const css = readFileSync(new URL('../../../src/v2/view/glass.css', import.meta.url), 'utf8');
    const rule = selector => {
        const at = css.indexOf(`${selector} {`);
        assert.ok(at >= 0, `${selector} has a rule`);
        return css.slice(at, css.indexOf('}', at));
    };
    assert.match(rule('.ss-hero-corner-text'), /overflow-wrap: anywhere;/);
    assert.doesNotMatch(rule('.ss-hero-corner-text'), /white-space: nowrap|text-overflow/, 'not cut, not one line');
    assert.match(rule('.ss-hero-compact .ss-hero-corner'), /flex-wrap: wrap;/);
    assert.match(rule('.ss-hero-compact .ss-hero-corner'), /gap: 6px 10px;/, 'wrapped lines are far enough apart for the pencils');
    assert.doesNotMatch(rule('.ss-hero-compact .ss-hero-corner'), /overflow: hidden/);
    assert.doesNotMatch(rule('.ss-hero-compact .ss-hero-corner-text'), /ellipsis|nowrap/, 'no "Bluewatch Vi…"');
    assert.match(rule('.ss-hero-corner-pencil'), /margin: -9px 0;/);
    assert.match(rule('.ss-hero-corner-item:has(.ss-w-editable-form)'), /flex-wrap: wrap;/, 'an open edit takes the line under the words');
});
