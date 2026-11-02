// The Game view hero's editor model (view/hero-edit.js): its fields, and which commands a Save sends, in which order, for which changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CLOCK_KEYS, hasClock, heroEditFields, heroEditPlan, hereNames, hereText, timeMinutes, timeText } from '../../../src/v2/view/hero-edit.js';

const MONTHS = [{ name: 'Dawnwane', days: 30 }, { name: 'Rainmoot', days: 28 }, { name: 'Greengale', days: 30 }];
const CLOCK = { parts: { year: 611, month: 2, day: 12, minutes: 810 }, era: 'CY', months: MONTHS };
const WHERE = { present: ['Fenna', 'Ivo'], places: ['The Weir', { name: 'Bluewatch' }], weatherOn: true, place: 'Bluewatch', weatherText: 'rain' };
const YOU = { rank: 'F', rankLabel: 'Guild rank', wearing: 'coat', condition: '', command: 'scene.you' };
const props = (extra = {}) => ({ name: 'Wessel', place: 'Bluewatch', weather: 'rain', where: WHERE, you: YOU, clock: CLOCK, ...extra });
const keys = fields => fields.map(field => field.key);
const find = (fields, key) => fields.find(field => field.key === key);

test('time of day: minutes to "HH:MM" and back; anything else is nothing', () => {
    assert.equal(timeText(0), '00:00');
    assert.equal(timeText(810), '13:30');
    assert.equal(timeText(1439), '23:59');
    for (const bad of [-1, 1440, 1.5, null, undefined, '13']) assert.equal(timeText(bad), '');
    assert.equal(timeMinutes('13:30'), 810);
    assert.equal(timeMinutes('6:05'), 365);
    assert.equal(timeMinutes('18:00:30'), 1080, 'a time box that answers seconds');
    for (const bad of ['', '24:00', '12:60', 'noon', '1330', null]) assert.equal(timeMinutes(bad), null);
});

test('Here is a comma text field: names trimmed, empty ones dropped, each once, at most twelve, each cut at 80', () => {
    assert.deepEqual(hereNames(' Fenna ,, ivo, Fenna , IVO,Mira'), ['Fenna', 'ivo', 'Mira']);
    assert.equal(hereNames(Array.from({ length: 20 }, (_, at) => `P${at}`).join(',')).length, 12);
    assert.equal(hereNames('x'.repeat(200))[0].length, 80);
    assert.equal(hereText(['Fenna', 'Ivo']), 'Fenna, Ivo');
    assert.equal(hereText(null), '');
    assert.deepEqual(hereNames(null), []);
});

test('the fields: the clock (Year with the era word, Month of the calendar, Day, Time), Place, Weather, Here under Story; Rank, Wearing, Condition under Character', () => {
    const fields = heroEditFields(props());
    assert.deepEqual(keys(fields), ['year', 'month', 'day', 'time', 'place', 'weather', 'here', 'rank', 'wearing', 'condition']);
    assert.deepEqual([...new Set(fields.map(field => field.group))], ['Story', 'Character']);
    assert.equal(find(fields, 'year').label, 'Year (CY)');
    assert.deepEqual(find(fields, 'month').options, [{ value: 1, label: 'Dawnwane' }, { value: 2, label: 'Rainmoot' }, { value: 3, label: 'Greengale' }]);
    assert.equal(find(fields, 'month').type, 'choice');
    assert.equal(find(fields, 'month').value, 2);
    assert.equal(find(fields, 'day').max, 30, 'the longest month: a hint on the box (soft), the clock answers for the exact month');
    assert.equal(find(fields, 'day').soft, true);
    assert.equal(find(fields, 'year').soft, true);
    assert.equal(find(fields, 'time').type, 'time');
    assert.equal(find(fields, 'time').value, '13:30');
    assert.deepEqual(fields.filter(field => CLOCK_KEYS.includes(field.key)).map(field => field.row), ['date', 'date', 'date', 'date']);
    assert.deepEqual(find(fields, 'place').options, ['The Weir', 'Bluewatch']);
    assert.equal(find(fields, 'here').value, 'Fenna, Ivo');
    assert.equal(find(fields, 'rank').label, 'Guild rank');
    assert.equal(find(fields, 'rank').value, 'F');
});

test('no clock (no Story Director, an older one, no calendar): no date or time fields; no `you`: no Character group; no rank word: no Rank; weather feature off: no Weather', () => {
    assert.equal(hasClock(props()), true);
    for (const clock of [null, undefined, { parts: null, months: [] }, { parts: null }, 'x']) {
        assert.equal(hasClock(props({ clock })), false);
        assert.deepEqual(keys(heroEditFields(props({ clock }))).slice(0, 3), ['place', 'weather', 'here']);
    }
    assert.deepEqual(keys(heroEditFields(props({ clock: null, you: null }))), ['place', 'weather', 'here']);
    assert.deepEqual(keys(heroEditFields(props({ clock: null, you: { wearing: 'a', condition: 'b', command: 'scene.you' } }))), ['place', 'weather', 'here', 'wearing', 'condition']);
    assert.equal(find(heroEditFields(props({ where: { ...WHERE, weatherOn: false } })), 'weather'), undefined);
    // an unset clock: blank starting values, and a blank first Month
    const unset = heroEditFields(props({ clock: { parts: null, era: '', months: MONTHS } }));
    assert.equal(find(unset, 'year').label, 'Year');
    assert.deepEqual(['year', 'month', 'day', 'time'].map(key => find(unset, key).value), ['', '', '', '']);
    assert.deepEqual(find(unset, 'month').options[0], { value: '', label: '—' });
});

test('the plan: the clock first, then place, weather, present, you; only what changed; each step names the fields it covers', () => {
    const plan = heroEditPlan(props());
    const all = { year: 612, month: 3, day: 4, time: '06:40', place: 'The Weir', weather: 'clear', here: 'Ivo, Mira', rank: 'E', wearing: 'cloak', condition: 'tired' };
    assert.deepEqual(plan(all, all), {
        steps: [
            { command: 'director.clock', payload: { year: 612, month: 3, day: 4, minutes: 400 }, keys: ['year', 'month', 'day', 'time'] },
            { command: 'scene.place', payload: { with: ['Fenna', 'Ivo'], name: 'The Weir' }, keys: ['place'] },
            { command: 'scene.weather', payload: { text: 'clear' }, keys: ['weather'] },
            { command: 'scene.present', payload: { set: ['Ivo', 'Mira'] }, keys: ['here'] },
            { command: 'scene.you', payload: { rank: 'E', wearing: 'cloak', condition: 'tired' }, keys: ['rank', 'wearing', 'condition'] },
        ],
    });
    assert.deepEqual(plan({}, all), { steps: [] }, 'nothing changed: nothing sent');
    assert.deepEqual(plan({ weather: 'clear' }, all).steps.map(step => step.command), ['scene.weather']);
    assert.deepEqual(plan({ condition: 'tired' }, all).steps, [{ command: 'scene.you', payload: { condition: 'tired' }, keys: ['condition'] }]);
});

test('the plan: a date or time field alone sends the whole clock (one command), never a part of it', () => {
    const plan = heroEditPlan(props());
    const all = { year: 611, month: 2, day: 13, time: '13:30', place: 'Bluewatch', weather: 'rain', here: 'Fenna, Ivo' };
    assert.deepEqual(plan({ day: 13 }, all).steps, [{ command: 'director.clock', payload: { year: 611, month: 2, day: 13, minutes: 810 }, keys: ['year', 'month', 'day', 'time'] }]);
    assert.deepEqual(plan({ time: '13:30' }, all).steps.map(step => step.command), ['director.clock']);
    // the clock may go backwards: nothing here compares with the time now
    assert.deepEqual(plan({ year: 500 }, { ...all, year: 500 }).steps[0].payload, { year: 500, month: 2, day: 13, minutes: 810 });
});

test('the plan: an incomplete date or time is refused with the clock\'s own words, nothing sent; unset and left alone is no change', () => {
    const plan = heroEditPlan(props({ clock: { parts: null, era: 'CY', months: MONTHS } }));
    const blank = { year: null, month: '', day: null, time: '', place: 'Bluewatch', weather: 'rain', here: 'Fenna, Ivo' };
    assert.deepEqual(plan({ weather: 'clear' }, { ...blank, weather: 'clear' }).steps.map(step => step.command), ['scene.weather'], 'blank and untouched: no clock step');
    for (const partial of [{ year: 611 }, { month: 2 }, { day: 3 }, { time: '06:40' }, { year: 611, month: 2, day: 3 }]) {
        assert.deepEqual(plan(partial, { ...blank, ...partial }), { error: 'Pick a date and a time.' }, JSON.stringify(partial));
    }
    assert.equal(plan({ time: '24:00' }, { year: 611, month: 2, day: 3, time: '24:00' }).error, 'Pick a date and a time.');
    assert.deepEqual(plan({ year: 611, month: 2, day: 3, time: '06:40' }, { ...blank, year: 611, month: 2, day: 3, time: '06:40' }).steps[0].payload, { year: 611, month: 2, day: 3, minutes: 400 });
});

test('the plan: the people stay with a move; Here typed again with other spaces is no change; the look goes in one command under the props\' own command name', () => {
    const plan = heroEditPlan(props({ you: { ...YOU, command: 'scene.you' } }));
    assert.deepEqual(plan({ place: 'X' }, { place: 'X' }).steps[0].payload, { with: ['Fenna', 'Ivo'], name: 'X' });
    assert.deepEqual(plan({ here: 'Fenna,Ivo ' }, { here: 'Fenna,Ivo ' }), { steps: [] });
    assert.deepEqual(plan({ here: '' }, { here: '' }).steps, [{ command: 'scene.present', payload: { set: [] }, keys: ['here'] }], 'emptying the people is a change');
    assert.deepEqual(plan({ wearing: '' }, { wearing: '' }).steps, [{ command: 'scene.you', payload: { wearing: '' }, keys: ['wearing'] }], 'a cleared part is sent as cleared');
});
