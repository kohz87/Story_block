// The game view's header is the one place for the scene (view/widgets/hero.js `where`, view/game-header.js): the time, the place, the
// weather and a "Here: names" item (the people present), in that order, as plain lines (no pencils). ONE "Edit" button (top-right, beside the name on a
// phone) opens one editor in the card (view/hero-edit.js): "Story" (Year, Month, Day, Time when Story Director gives its clock; Place, Weather, Here) and
// "Character" (Rank, Wearing, Condition while `story-block.you` is on); Save sends the commands of the changed fields only, the clock first
// (`director.clock`), then `scene.place`, `scene.weather`, `scene.present`, `scene.you`; a refusal stops the rest. An empty place, weather or Here still
// shows; the weather feature off takes the weather and its field away. Without `where` (a card, the UI sample) the corner is read-only, has no Here item
// and no Edit button.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHost } from '../../../testkit/index.js';
import { mountUi } from '../../../src/v2/ui-host.js';
import { CORE_FEATURE } from '../../../src/v2/features.js';
import { clockProps, gameHeroProps } from '../../../src/v2/view/game-header.js';
import { hero } from '../../../src/v2/view/widgets/hero.js';
import { setupDom } from './mounts/helpers.js';
import { fakeApi, host as widgetHost, installDom } from './widgets/fake-dom.js';

const settle = async () => { for (let n = 0; n < 6; n += 1) await new Promise(resolve => setImmediate(resolve)); };
const WHERE = { present: ['Fenna', 'Hooded courier'], places: [{ name: 'Bluewatch Village' }, { name: 'The Weir' }], weatherOn: true, place: 'Bluewatch Village', weatherText: 'heavy rain, rising river' };
const MONTHS = ['Dawnwane', 'Rainmoot', 'Greengale', 'Highsun', 'Goldwane', 'Haywane'].map(name => ({ name, days: 30 }));
const CLOCK = { parts: { year: 611, month: 5, day: 12, minutes: 13 * 60 + 30 }, era: 'CY', months: MONTHS };
const YOU = { rank: 'F-rank', rankLabel: 'Guild rank', wearing: 'oilskin coat', condition: 'soaked', command: 'scene.you' };
const LEAD = { name: 'Wessel', place: 'Bluewatch Village', time: 'CY 611, Goldwane 12, 1:30 pm', weather: 'heavy rain, rising river', where: WHERE, you: YOU, clock: CLOCK };

function draw(props, api = fakeApi()) {
    const doc = installDom();
    const el = widgetHost(doc);
    const handle = hero.render(el, props, api);
    const kinds = () => el.querySelectorAll('.ss-hero-corner-item').map(item => item.getAttribute('data-kind'));
    const item = kind => el.querySelector(`.ss-hero-corner-item[data-kind="${kind}"]`);
    const words = kind => item(kind)?.querySelector('.ss-hero-corner-text')?.textContent;
    const edit = () => el.querySelector('button.ss-hero-edit');
    // the box of a field, by its label (the fake DOM's selectors split at spaces, so a label like "Year (CY)" is found by its text)
    const box = label => {
        const node = el.querySelectorAll('.ss-hero-editor label').find(each => each.querySelector('span').textContent === label);
        return node ? node.querySelector('input') ?? node.querySelector('select') : null;
    };
    const legends = () => el.querySelectorAll('.ss-hero-editor legend').map(node => node.textContent);
    const labels = () => el.querySelectorAll('.ss-hero-editor label').map(node => node.querySelector('span').textContent);
    const save = () => el.querySelector('.ss-hero-editor .ss-w-editable-save');
    const cancel = () => el.querySelector('.ss-hero-editor .ss-w-editable-cancel');
    const error = () => el.querySelector('.ss-hero-editor .ss-w-editable-error')?.textContent;
    const form = () => el.querySelector('.ss-hero-editor .ss-w-editable-form');
    return { el, doc, handle, api, kinds, item, words, edit, box, legends, labels, save, cancel, error, form };
}
const sent = api => api.commands.map(call => [call.type, call.payload]);
// An api whose command answers by type: `{ ok: false, message }` for the ones listed.
function answering(refuse = {}) {
    const api = fakeApi();
    api.command = (type, payload) => { api.commands.push({ type, payload }); return Promise.resolve(refuse[type] ?? { ok: true }); };
    return api;
}

test('the corner: time, place, weather, then Here with the people, as plain lines: no pencil anywhere in the card, ONE Edit button', () => {
    const { el, kinds, words, edit } = draw(LEAD);
    assert.deepEqual(kinds(), ['time', 'place', 'weather', 'here']);
    assert.equal(words('time'), 'CY 611, Goldwane 12, 1:30 pm');
    assert.equal(words('place'), 'Bluewatch Village');
    assert.equal(words('weather'), 'heavy rain, rising river');
    assert.equal(words('here'), 'Here: Fenna, Hooded courier');
    assert.equal(el.querySelectorAll('button.ss-w-editable-pencil').length, 0, 'no pencil button');
    for (const name of ['ss-hero-corner-pencil', 'ss-hero-you-pencil', 'ss-w-editable-pencil']) assert.equal(el.querySelector(`.${name}`), null, name);
    assert.equal(el.querySelectorAll('button').length, 1, 'the one button of the card is Edit');
    assert.equal(el.querySelectorAll('.ss-hero-you-part').map(part => part.querySelector('.ss-hero-you-text').textContent).join('|'), 'F-rank|oilskin coat|soaked');
    assert.equal(edit().querySelector('.ss-hero-edit-text').textContent, 'Edit');
    assert.ok(edit().querySelector('svg') || edit().querySelector('i'), 'a pencil icon');
    assert.equal(edit().getAttribute('aria-label'), 'Edit the story and your character');
    assert.equal(edit().getAttribute('title'), 'Edit the story and your character');
    assert.equal(edit().getAttribute('aria-expanded'), 'false');
    assert.equal(edit().parentNode.className, 'ss-hero-head', 'beside the name (CSS puts it in the corner from 600px)');
});

test('an empty place, weather or Here still shows (plain); the time does not', () => {
    const { kinds, words, item, el } = draw({ name: 'Wessel', where: { present: [], places: [], weatherOn: true } });
    assert.deepEqual(kinds(), ['place', 'weather', 'here']);
    assert.equal(words('place'), 'Somewhere not yet named');
    assert.equal(words('weather'), '\u2014');
    assert.equal(words('here'), 'Here: \u2014');
    assert.ok(item('place').classList.contains('ss-hero-corner-empty'));
    assert.equal(el.querySelectorAll('button.ss-w-editable-pencil').length, 0);
});

test('the weather feature off: no weather line and no Weather field, even where the story still has weather words', () => {
    const m = draw({ ...LEAD, where: { ...WHERE, weatherOn: false } });
    assert.deepEqual(m.kinds(), ['time', 'place', 'here']);
    assert.equal(m.item('weather'), null);
    m.edit().click();
    assert.equal(m.box('Weather'), null);
    assert.ok(m.box('Place'));
});

test('without `where` the card is what it was: read-only corner, no Here item, no Edit button, no editor', () => {
    const m = draw({ name: 'Ren', place: 'Weir', time: 'Day 2', weather: 'Fog' });
    assert.deepEqual(m.kinds(), ['time', 'place', 'weather']);
    assert.equal(m.edit(), null);
    assert.equal(m.el.querySelectorAll('button').length, 0);
    assert.deepEqual(draw({ name: 'Ren' }).kinds(), [], 'nothing to say: no corner items');
    assert.ok(draw({ name: 'Ren', where: WHERE, compact: true }).edit(), 'the header is compact on a phone and has it; the strip under a reply has no `where`');
    const gone = draw(LEAD);
    gone.handle.update({ name: 'Ren' });
    assert.equal(gone.edit(), null, 'the button goes with `where`');
});

test('Edit opens the one editor: Story (Year (CY), Month, Day, Time, Place, Weather, Here) and Character (Rank, Wearing, Condition), the help line, Save and Cancel', () => {
    const m = draw(LEAD);
    assert.equal(m.form(), null);
    m.edit().click();
    assert.ok(m.form(), 'open');
    assert.equal(m.edit().getAttribute('aria-expanded'), 'true');
    assert.ok(m.el.querySelector('.ss-hero').classList.contains('ss-hero-editing'), 'the lines it edits are hidden (CSS) while it is open');
    assert.deepEqual(m.legends(), ['Story', 'Character']);
    assert.deepEqual(m.labels(), ['Year (CY)', 'Month', 'Day', 'Time', 'Place', 'Weather', 'Here', 'Guild rank', 'Wearing', 'Condition']);
    assert.equal(m.form().getAttribute('role'), 'group');
    assert.equal(m.form().getAttribute('aria-label'), 'Edit the story and your character');
    assert.equal(m.el.querySelector('.ss-w-editable-help').textContent, 'Changes apply from this reply on.');
    assert.equal(m.save().textContent, 'Save');
    assert.equal(m.cancel().textContent, 'Cancel');
    // the starting values
    assert.equal(m.box('Year (CY)').value, '611');
    assert.equal(m.box('Month').localName, 'select');
    assert.deepEqual(m.box('Month').querySelectorAll('option').map(option => option.textContent), MONTHS.map(month => month.name));
    assert.equal(m.box('Month').value, '5');
    assert.equal(m.box('Day').value, '12');
    assert.equal(m.box('Time').getAttribute('type'), 'time');
    assert.equal(m.box('Time').value, '13:30');
    assert.equal(m.box('Place').value, 'Bluewatch Village');
    assert.equal(m.box('Weather').value, 'heavy rain, rising river');
    assert.equal(m.box('Here').value, 'Fenna, Hooded courier', 'the people as a comma text field');
    assert.equal(m.box('Wearing').value, 'oilskin coat');
    assert.equal(m.el.querySelectorAll('.ss-hero-editor datalist option').map(option => option.value).join('|'), 'Bluewatch Village|The Weir', 'the pack\'s places are suggested');
    // a second click on Edit changes nothing (one editor)
    m.edit().click();
    assert.equal(m.el.querySelectorAll('.ss-hero-editor .ss-w-editable-form').length, 1);
});

test('no Story Director (no clock): no Year, Month, Day or Time; the Story group keeps Place, Weather and Here; no `you`: no Character group; no pack Rank: no Rank', () => {
    const bare = { name: 'Wessel', where: WHERE };
    const m = draw(bare);
    m.edit().click();
    assert.deepEqual(m.legends(), ['Story']);
    assert.deepEqual(m.labels(), ['Place', 'Weather', 'Here']);
    const noRank = draw({ ...LEAD, clock: null, you: { wearing: 'a coat', condition: '', command: 'scene.you' } });
    noRank.edit().click();
    assert.deepEqual(noRank.legends(), ['Story', 'Character']);
    assert.deepEqual(noRank.labels(), ['Place', 'Weather', 'Here', 'Wearing', 'Condition']);
    // A calendar with no era says just "Year"; an unset clock starts the date and time empty.
    const unset = draw({ ...LEAD, clock: { parts: null, era: '', months: MONTHS } });
    unset.edit().click();
    assert.equal(unset.labels()[0], 'Year');
    assert.equal(unset.box('Year').value, '');
    assert.equal(unset.box('Day').value, '');
    assert.equal(unset.box('Time').value, '');
    assert.equal(unset.box('Month').querySelectorAll('option').length, MONTHS.length + 1, 'a blank first choice');
});

test('Save with nothing changed closes and sends nothing; Cancel and Escape close without saving; focus returns to the Edit button', async () => {
    const m = draw(LEAD);
    m.edit().click();
    m.save().click();
    await settle();
    assert.deepEqual(m.api.commands, []);
    assert.equal(m.form(), null, 'closed');
    assert.equal(m.edit().getAttribute('aria-expanded'), 'false');
    assert.equal(m.doc.activeElement, m.edit());
    assert.equal(m.el.querySelector('.ss-hero').classList.contains('ss-hero-editing'), false);
    m.edit().click();
    m.box('Weather').value = 'clear';
    m.cancel().click();
    assert.equal(m.form(), null);
    assert.deepEqual(m.api.commands, []);
    assert.equal(m.doc.activeElement, m.edit());
    m.edit().click();
    m.box('Day').value = '14';
    m.box('Day').dispatch('keydown', { key: 'Escape' });
    assert.equal(m.form(), null);
    assert.deepEqual(m.api.commands, []);
    assert.equal(m.doc.activeElement, m.edit());
    m.edit().click();
    assert.equal(m.box('Day').value, '12', 'reopened from the card\'s own values, not the abandoned edit');
});

test('Save sends the commands of the changed fields only: the clock first, then place, weather, here, you', async () => {
    const m = draw(LEAD);
    m.edit().click();
    m.box('Year (CY)').value = '612';
    m.box('Month').value = '2';
    m.box('Day').value = '14';
    m.box('Time').value = '18:00';
    m.box('Wearing').value = 'a dry cloak';
    m.box('Guild rank').value = 'E-rank';
    m.box('Here').value = 'Fenna, Ivo';
    m.box('Weather').value = 'clear';
    m.box('Place').value = 'The Weir';
    m.save().click();
    await settle();
    assert.deepEqual(sent(m.api), [
        ['director.clock', { year: 612, month: 2, day: 14, minutes: 1080 }],
        ['scene.place', { with: ['Fenna', 'Hooded courier'], name: 'The Weir' }],
        ['scene.weather', { text: 'clear' }],
        ['scene.present', { set: ['Fenna', 'Ivo'] }],
        ['scene.you', { rank: 'E-rank', wearing: 'a dry cloak' }],
    ]);
    assert.equal(m.form(), null, 'closed after the last one went through');
    assert.equal(m.doc.activeElement, m.edit());
});

test('one changed field sends one command (a day alone still sends the whole date and time, which is one command); an unchanged field sends nothing', async () => {
    const m = draw(LEAD);
    m.edit().click();
    m.box('Day').value = '13';
    m.save().click();
    await settle();
    assert.deepEqual(sent(m.api), [['director.clock', { year: 611, month: 5, day: 13, minutes: 810 }]]);
    m.edit().click();
    m.box('Condition').value = 'rested';
    m.box('Here').value = ' Fenna ,Hooded courier ';
    m.save().click();
    await settle();
    assert.deepEqual(sent(m.api).slice(1), [['scene.you', { condition: 'rested' }]], 'the same people with other spaces are no change');
    m.edit().click();
    m.box('Weather').value = '';
    m.save().click();
    await settle();
    assert.deepEqual(sent(m.api).at(-1), ['scene.weather', { text: '' }], 'a cleared field is a change, as the weather pencil did');
});

test('a refused clock names its sentence under the fields, keeps the editor open and sends nothing else', async () => {
    const api = answering({ 'director.clock': { ok: false, message: 'Goldwane has 30 days.' } });
    const m = draw(LEAD, api);
    m.edit().click();
    m.box('Day').value = '31';
    m.box('Weather').value = 'clear';
    m.box('Wearing').value = 'a cloak';
    m.save().click();
    await settle();
    assert.deepEqual(sent(api), [['director.clock', { year: 611, month: 5, day: 31, minutes: 810 }]], 'the clock was first, and nothing after it');
    assert.equal(m.error(), 'Goldwane has 30 days.');
    assert.ok(m.form(), 'still open');
    assert.equal(m.box('Weather').value, 'clear', 'what was typed is kept');
    assert.equal(m.save().disabled, false);
    // Fixed: the next Save sends everything that is still to send.
    m.box('Day').value = '13';
    api.command = (type, payload) => { api.commands.push({ type, payload }); return Promise.resolve({ ok: true }); };
    m.save().click();
    await settle();
    assert.deepEqual(sent(api).slice(1).map(([type]) => type), ['director.clock', 'scene.weather', 'scene.you']);
    assert.equal(m.form(), null);
});

test('a refusal later in the order stops the rest, keeps the editor open, and a step that went through is not sent again', async () => {
    const api = answering({ 'scene.weather': { ok: false, message: 'The weather has no words.' } });
    const m = draw(LEAD, api);
    m.edit().click();
    m.box('Day').value = '13';
    m.box('Place').value = 'The Weir';
    m.box('Weather').value = '???';
    m.box('Here').value = 'Ivo';
    m.box('Condition').value = 'rested';
    m.save().click();
    await settle();
    assert.deepEqual(sent(api).map(([type]) => type), ['director.clock', 'scene.place', 'scene.weather'], 'present and you were not sent');
    assert.equal(m.error(), 'The weather has no words.');
    assert.ok(m.form());
    m.box('Weather').value = 'clear';
    api.command = (type, payload) => { api.commands.push({ type, payload }); return Promise.resolve({ ok: true }); };
    m.save().click();
    await settle();
    assert.deepEqual(sent(api).slice(3).map(([type]) => type), ['scene.weather', 'scene.present', 'scene.you'], 'the clock and the place went through: not again');
    assert.equal(m.form(), null);
});

test('an invalid field saves nothing and is named; a half-given date is refused in the words of the clock', async () => {
    const m = draw(LEAD);
    m.edit().click();
    m.box('Year (CY)').value = 'six';
    m.box('Weather').value = 'clear';
    m.save().click();
    await settle();
    assert.deepEqual(m.api.commands, []);
    assert.equal(m.error(), 'Year (CY): enter a whole number.');
    assert.ok(m.form());
    m.box('Year (CY)').value = '611';
    m.box('Time').value = '';
    m.save().click();
    await settle();
    assert.deepEqual(m.api.commands, []);
    assert.equal(m.error(), 'Pick a date and a time.');
    m.box('Time').value = '13:30';
    m.box('Day').value = '';
    m.save().click();
    await settle();
    assert.equal(m.error(), 'Day: enter a whole number.', 'a date field that had a value cannot be emptied');
    // An unset clock left alone is not an error for an edit of something else.
    const unset = draw({ ...LEAD, clock: { parts: null, era: 'CY', months: MONTHS } });
    unset.edit().click();
    unset.box('Weather').value = 'clear';
    unset.save().click();
    await settle();
    assert.deepEqual(sent(unset.api), [['scene.weather', { text: 'clear' }]], 'blank date and time fields that stayed blank send no clock');
    // ... and a date given in part is refused whole.
    unset.edit().click();
    unset.box('Year (CY)').value = '611';
    unset.save().click();
    await settle();
    assert.equal(unset.error(), 'Pick a date and a time.');
    assert.equal(sent(unset.api).length, 1);
    unset.box('Month').value = '5';
    unset.box('Day').value = '12';
    unset.box('Time').value = '06:40';
    unset.save().click();
    await settle();
    assert.deepEqual(sent(unset.api).at(-1), ['director.clock', { year: 611, month: 5, day: 12, minutes: 400 }]);
});

test('a redraw keeps an open editor and what was typed; the lines change behind it', () => {
    const m = draw(LEAD);
    m.edit().click();
    m.box('Weather').value = 'clear';
    const form = m.form();
    m.handle.update({ ...LEAD, place: 'The Weir', where: { ...WHERE, place: 'The Weir', present: ['Fenna'] } });
    assert.equal(m.words('place'), 'The Weir');
    assert.equal(m.form(), form, 'the same open form');
    assert.equal(m.box('Weather').value, 'clear');
    assert.deepEqual(m.kinds(), ['time', 'place', 'weather', 'here'], 'the same lines in the same order');
});

test('the words are cut for the corner, never the place the editor starts from; Here is cut at 120', () => {
    const long = 'P'.repeat(60);
    const m = draw({ name: 'Wessel', place: long, where: { present: Array.from({ length: 12 }, (_, at) => `Person${at}-${'x'.repeat(10)}`), places: [], weatherOn: true, place: long } });
    assert.equal(m.words('place').length, 40, 'the corner shows 40');
    m.edit().click();
    assert.equal(m.box('Place').value, long, 'the edit starts from the whole name');
    assert.ok(m.words('here').length <= 'Here: '.length + 120);
});

test('gameHeroProps reads the editor\'s data: the people, the pack\'s places, whether the weather feature is on', () => {
    const answers = { 'scene.place': { name: 'Bluewatch Village' }, 'scene.weather': { text: 'rain' }, 'scene.present': ['Fenna', ' ', 'Ivo'], 'packs.content': [{ name: 'The Weir' }] };
    const asked = [];
    const query = (name, args) => { asked.push([name, args]); return answers[name] ?? null; };
    const props = gameHeroProps({ state: {}, query, context: { personaName: 'Wessel' } });
    assert.deepEqual(props.where, { present: ['Fenna', 'Ivo'], places: [{ name: 'The Weir' }], weatherOn: true, place: 'Bluewatch Village', weatherText: 'rain' });
    assert.deepEqual(asked.find(([name]) => name === 'packs.content')[1], { kind: 'places' });
    assert.equal(gameHeroProps({ state: {}, query, context: {}, weatherOn: false }).where.weatherOn, false);
    const bare = gameHeroProps({ state: {}, query: () => null, context: {} });
    assert.deepEqual(bare.where, { present: [], places: [], weatherOn: true, place: '', weatherText: '' });
    assert.equal('clock' in bare, false, 'no Story Director: no clock');
});

test('gameHeroProps gives the clock only when Story Director answers `parts` and a calendar with months', () => {
    const calendar = { era: 'CY', months: MONTHS, leapYears: null };
    const ask = (time, cal = calendar) => gameHeroProps({ state: {}, context: {}, query: name => (name === 'director.time' ? time : name === 'director.calendar' ? cal : null) });
    const parts = { year: 611, month: 5, day: 12, minutes: 810 };
    assert.deepEqual(ask({ minutes: 123, text: 'x', parts }).clock, { parts, era: 'CY', months: MONTHS });
    assert.deepEqual(ask({ minutes: null, text: '', parts: null }).clock, { parts: null, era: 'CY', months: MONTHS }, 'an unset clock: the fields start empty');
    assert.equal('clock' in ask({ minutes: 123, text: 'x' }), false, 'an older Story Director (no `parts`): no date or time fields');
    assert.equal('clock' in ask({ minutes: 1, parts }, null), false, 'no calendar answer');
    assert.equal('clock' in ask({ minutes: 1, parts }, { era: 'CY', months: [] }), false, 'no months');
    assert.equal(clockProps({ parts: { year: 611, month: 9, day: 1, minutes: 5 } }, calendar).parts, null, 'a month past the calendar\'s is not taken');
    assert.equal(clockProps({ parts: { year: 611, month: 5, day: 12, minutes: 1440 } }, calendar).parts, null, 'minutes past the day\'s end are not taken');
    assert.deepEqual(clockProps({ parts: null }, { months: [{ name: ' Frost ', days: 28.5 }, { name: 'Thaw', days: 30 }, { name: '', days: 5 }] }).months, [{ name: 'Thaw', days: 30 }]);
});

test('the page: the header\'s one editor changes the scene through the real commands, there is no pencil on the header, and Home has no Where card under the header', async t => {
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
    assert.equal(doc.querySelectorAll('.ss-gameview-hero button.ss-w-editable-pencil').length, 0, 'no pencil on the header');
    assert.equal(doc.querySelectorAll('.ss-gameview-hero .ss-hero-edit').length, 1, 'one Edit button');
    const box = label => doc.querySelector(`.ss-gameview-hero .ss-hero-editor [aria-label="${label}"]`);
    doc.querySelector('.ss-gameview-hero .ss-hero-edit').click();
    // Story Block alone: no Story Director, so no date or time fields; no `~ you` yet but the feature is on: the Character group is there.
    assert.equal(box('Year'), null);
    assert.equal(box('Time'), null);
    assert.equal(box('Place').value, 'Vell Harbour');
    assert.equal(box('Weather').value, 'cold drizzle');
    assert.equal(box('Here').value, 'Fenna');
    box('Here').value = 'Fenna, Ivo';
    box('Weather').value = 'clear sky';
    box('Wearing').value = 'oilskin coat';
    doc.querySelector('.ss-gameview-hero .ss-hero-editor .ss-w-editable-save').click();
    await settle();
    assert.deepEqual(h.sdk.query('scene.present'), ['Fenna', 'Ivo']);
    assert.equal(h.sdk.query('scene.weather').text, 'clear sky');
    assert.equal(h.sdk.query('scene.you').wearing, 'oilskin coat');
    assert.equal(h.sdk.query('scene.place').name, 'Vell Harbour', 'the place was left as it was');
    assert.equal(doc.querySelector('.ss-gameview-hero .ss-hero-editor .ss-w-editable-form'), null, 'closed');
    assert.equal(words('here'), 'Here: Fenna, Ivo');
    assert.equal(words('weather'), 'clear sky');
    assert.equal(doc.querySelector('.ss-gameview-hero [data-part="wearing"] .ss-hero-you-text').textContent, 'oilskin coat');
    // The weather feature off: the header leaves it out, and its field with it.
    h.features.set(CORE_FEATURE.weather, false);
    await settle();
    ui.mounts.screen.update();
    assert.equal(words('weather'), undefined);
    doc.querySelector('.ss-gameview-hero .ss-hero-edit').click();
    assert.equal(box('Weather'), null);
    assert.ok(box('Place'));
});

test('the header\'s one Edit button is a pill in the corner (a phone: beside the name), the editor stacks its groups on a phone, and the lines it edits are hidden while it is open', () => {
    const css = readFileSync(new URL('../../../src/v2/view/glass.css', import.meta.url), 'utf8');
    const widgetCss = readFileSync(new URL('../../../src/v2/view/widgets/styles.js', import.meta.url), 'utf8');
    const rule = selector => {
        const at = css.indexOf(`${selector} {`);
        assert.ok(at >= 0, `${selector} has a rule`);
        return css.slice(at, css.indexOf('}', at));
    };
    assert.match(rule('.ss-hero-corner-text'), /overflow-wrap: anywhere;/);
    assert.doesNotMatch(rule('.ss-hero-corner-text'), /white-space: nowrap|text-overflow/, 'not cut, not one line');
    assert.match(rule('.ss-hero-compact .ss-hero-corner'), /flex-wrap: wrap;/);
    assert.match(rule('.ss-hero-compact .ss-hero-corner'), /gap: 6px 10px;/);
    assert.doesNotMatch(rule('.ss-hero-compact .ss-hero-corner'), /overflow: hidden/);
    assert.doesNotMatch(rule('.ss-hero-compact .ss-hero-corner-text'), /ellipsis|nowrap/, 'no "Bluewatch Vi…"');
    assert.doesNotMatch(css, /ss-hero-corner-pencil|ss-hero-you-pencil/, 'no pencil rules left for the header');
    assert.match(rule('.ss-hero-head'), /display: flex;/);
    assert.match(rule('.ss-hero-edit'), /margin: 0 0 0 auto;/, 'beside the name, at the end of its row');
    assert.match(css, /@container \(min-width: 600px\) \{[^@]*\.ss-hero-edit \{\s*position: absolute;\s*top: 10px;\s*right: 12px;/, 'the card\'s top-right corner from 600px');
    assert.match(rule('.ss-hero.ss-hero-editing .ss-hero-corner,\n:where(.story-suite-overlay, .story-suite-sheet, .ss-gameview, .ss-dialog, .ss-cards, .ss-card, .ss-hud, [data-ss-screen], .story-suite-bar, .story-suite-extras, .story-suite-reply-note) .ss-hero.ss-hero-editing .ss-hero-you'), /display: none;/, 'over the compact header\'s own corner rules');
    assert.match(css, /@media \(max-width: 600px\) \{\s*:where\([^)]*\) \.ss-hero-editor \.ss-w-editable-groups \{\s*grid-template-columns: minmax\(0, 1fr\);/, 'the groups stack on a phone');
    assert.match(widgetCss, /:where\(\.ss-w-editable-groups\) \{ display: grid; grid-template-columns: minmax\(0, 1\.6fr\) minmax\(0, 1fr\);/);
});
