// Pack format additions made for the Ersveil pack: `places` and `routes` (the map Story Director's
// atlas reads), a top-level `calendar` (its clock), plus optional `skills` and `presets` records.
// Every rejection, and the queries.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPacksPart } from '../../../src/v2/packs/index.js';
import { calendarOf, contentOf } from '../../../src/v2/packs/content.js';
import { validatePack } from '../../../src/v2/packs/validate.js';
import { countsLine } from '../../../src/v2/packs/panel.js';
import { fakeSettings } from './helpers/fake-settings.js';
import { pack, sample } from './helpers/fixtures.js';

// Fields set to undefined are left out, as in a JSON file.
const plain = input => JSON.parse(JSON.stringify(input));
const ok = input => {
    const result = validatePack(plain(input));
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    return result.pack;
};
const refused = (input, code, path) => {
    const result = validatePack(plain(input));
    assert.equal(result.ok, false, `expected ${code} at ${path}`);
    assert.ok(result.errors.some(error => error.code === code && (path === undefined || error.path === path)), JSON.stringify(result.errors));
    return result.errors;
};

const PLACES = [
    { name: 'Bluewatch Village', region: 'River Confederacy', kind: 'settlement', x: 64, y: 110, aliases: ['Bluewatch'] },
    { name: 'Auvoth', region: 'Auvoth Compact', kind: 'city', x: 59, y: 110 },
    { name: 'Auvoth Depths', kind: 'dungeon', layer: 'underground', x: 58.8, y: 110.2 },
];
const ROUTES = [{ from: 'Bluewatch', to: 'auvoth', kind: 'frontier road', km: 70, corridor: 'Bluewatch–Auvoth Frontier Road' }, { from: 'auvoth', to: 'Auvoth Depths', kind: 'dungeon access', hours: 1 }];
const CALENDAR = { era: 'CY', months: [{ name: 'Dawnwane', days: 30 }, { name: 'Rainmoot', days: 30 }, { name: 'Goldwane', days: 30 }], start: { year: 611, month: 'Goldwane', day: 12, hour: 6, minute: 40 } };
const map = (extra = {}) => pack({ content: { places: PLACES, routes: ROUTES }, ...extra });

test('places and routes are normalized: names, aliases, ids, routes stored with place names', () => {
    const normalized = ok(map());
    assert.deepEqual(normalized.content.places[0], {
        name: 'Bluewatch Village', aliases: ['Bluewatch'], region: 'River Confederacy', kind: 'settlement', layer: '', x: 64, y: 110, note: '',
        id: 'pack.mini/bluewatch-village', slug: 'bluewatch-village', pack: 'mini',
    });
    assert.equal(normalized.content.places[2].layer, 'underground');
    assert.deepEqual(normalized.content.routes, [
        { from: 'Bluewatch Village', to: 'Auvoth', kind: 'frontier road', km: 70, hours: null, corridor: 'Bluewatch–Auvoth Frontier Road', note: '', id: 'pack.mini/bluewatch-auvoth-frontier-road', slug: 'bluewatch-auvoth-frontier-road', pack: 'mini' },
        { from: 'Auvoth', to: 'Auvoth Depths', kind: 'dungeon access', km: null, hours: 1, corridor: '', note: '', id: 'pack.mini/auvoth-auvoth-depths-dungeon-access', slug: 'auvoth-auvoth-depths-dungeon-access', pack: 'mini' },
    ], 'a route names places by name, alias or slug; it is kept with their names');
    assert.equal(ok(map({ content: { places: PLACES, routes: [{ ...ROUTES[0], slug: 'frontier' }] } })).content.routes[0].id, 'pack.mini/frontier');
});

test('place rejections', () => {
    const place = extra => pack({ content: { places: [{ name: 'Shorn', x: 50, y: 95, ...extra }] } });
    refused(place({ x: undefined }), 'BAD_RECORD', 'content.places[0].x');
    refused(place({ y: '95' }), 'BAD_RECORD', 'content.places[0].y');
    refused(place({ x: 1e7 }), 'BAD_RECORD', 'content.places[0].x');
    refused(place({ kind: 7 }), 'BAD_RECORD', 'content.places[0].kind');
    refused(place({ region: 'x'.repeat(81) }), 'BAD_RECORD', 'content.places[0].region');
    refused(place({ aliases: 'Shorn Town' }), 'BAD_RECORD', 'content.places[0].aliases');
    refused(place({ note: 'x'.repeat(501) }), 'BAD_RECORD', 'content.places[0].note');
    refused(place({ population: 3000 }), 'UNKNOWN_FIELD', 'content.places[0].population');
    refused(pack({ content: { places: [{ x: 1, y: 1 }] } }), 'BAD_RECORD', 'content.places[0].name');
    refused(pack({ content: { places: [{ name: 'Shorn', x: 1, y: 1 }, { name: 'shorn', x: 2, y: 2 }] } }), 'DUPLICATE', 'content.places[1]');
    refused(pack({ content: { places: {} } }), 'BAD_CONTENT', 'content.places');
});

test('route rejections', () => {
    const route = extra => pack({ content: { places: PLACES, routes: [{ from: 'Bluewatch Village', to: 'Auvoth', kind: 'road', ...extra }] } });
    refused(route({ to: 'Glassdock' }), 'UNKNOWN_REF', 'content.routes[0].to');
    refused(route({ from: undefined }), 'UNKNOWN_REF', 'content.routes[0].from');
    refused(route({ to: 'Bluewatch' }), 'BAD_RECORD', 'content.routes[0].to');
    refused(route({ kind: '' }), 'BAD_RECORD', 'content.routes[0].kind');
    refused(route({ kind: undefined }), 'BAD_RECORD', 'content.routes[0].kind');
    refused(route({ km: 0 }), 'BAD_RECORD', 'content.routes[0].km');
    refused(route({ hours: -1 }), 'BAD_RECORD', 'content.routes[0].hours');
    refused(route({ km: '70' }), 'BAD_RECORD', 'content.routes[0].km');
    refused(route({ corridor: 3 }), 'BAD_RECORD', 'content.routes[0].corridor');
    refused(route({ code: 'F' }), 'UNKNOWN_FIELD', 'content.routes[0].code');
    refused(route({ slug: 'Not A Slug' }), 'BAD_RECORD', 'content.routes[0].slug');
    refused(pack({ content: { routes: [{ from: 'A', to: 'B', kind: 'road' }] } }), 'UNKNOWN_REF', 'content.routes[0].from');
    refused(pack({ content: { places: PLACES, routes: [ROUTES[0], { ...ROUTES[0], km: 80 }] } }), 'DUPLICATE', 'content.routes[1]');
    // The same two places by two kinds of way (a river and a road) are two routes.
    assert.equal(ok(pack({ content: { places: PLACES, routes: [ROUTES[0], { ...ROUTES[0], kind: 'river' }] } })).content.routes.length, 2);
});

test('the calendar: normalized, month by name or number, hour and minute default to 0', () => {
    assert.deepEqual(ok(pack({ calendar: CALENDAR })).calendar, CALENDAR);
    assert.deepEqual(ok(pack({ calendar: { ...CALENDAR, start: { year: -3, month: 3, day: 1 } } })).calendar.start, { year: -3, month: 'Goldwane', day: 1, hour: 0, minute: 0 });
    assert.deepEqual(ok(pack({ calendar: { ...CALENDAR, start: { ...CALENDAR.start, month: 'goldwane' } } })).calendar.start.month, 'Goldwane');
    assert.deepEqual(ok(pack({ calendar: { months: [{ name: 'Moon', days: 28 }] } })).calendar, { era: '', months: [{ name: 'Moon', days: 28 }], start: null });
    assert.equal(ok(pack()).calendar, null);
});

test('calendar rejections', () => {
    const calendar = extra => pack({ calendar: { ...CALENDAR, ...extra } });
    const start = extra => calendar({ start: { ...CALENDAR.start, ...extra } });
    refused(pack({ calendar: [] }), 'BAD_CALENDAR', 'calendar');
    refused(calendar({ weeks: [] }), 'BAD_CALENDAR', 'calendar.weeks');
    refused(calendar({ era: 'x'.repeat(25) }), 'BAD_CALENDAR', 'calendar.era');
    refused(calendar({ months: [] }), 'BAD_CALENDAR', 'calendar.months');
    refused(calendar({ months: Array.from({ length: 61 }, (_, i) => ({ name: `M${i}`, days: 30 })) }), 'BAD_CALENDAR', 'calendar.months');
    refused(calendar({ months: [{ name: 'Dawnwane', days: 0 }] }), 'BAD_CALENDAR', 'calendar.months[0]');
    refused(calendar({ months: [{ name: 'Dawnwane', days: 30.5 }] }), 'BAD_CALENDAR', 'calendar.months[0]');
    refused(calendar({ months: [{ name: '', days: 30 }] }), 'BAD_CALENDAR', 'calendar.months[0]');
    refused(calendar({ months: [{ name: 'Dawnwane', days: 30, short: 'Dw' }] }), 'BAD_CALENDAR', 'calendar.months[0]');
    refused(calendar({ months: [{ name: 'Dawnwane', days: 30 }, { name: 'DAWNWANE', days: 30 }] }), 'BAD_CALENDAR', 'calendar.months[1]');
    refused(start({ year: 611.5 }), 'BAD_CALENDAR', 'calendar.start.year');
    refused(start({ month: 'Highsun' }), 'BAD_CALENDAR', 'calendar.start.month');
    refused(start({ month: 4 }), 'BAD_CALENDAR', 'calendar.start.month');
    refused(start({ month: 0 }), 'BAD_CALENDAR', 'calendar.start.month');
    refused(start({ day: 31 }), 'BAD_CALENDAR', 'calendar.start.day');
    refused(start({ day: 0 }), 'BAD_CALENDAR', 'calendar.start.day');
    refused(start({ hour: 24 }), 'BAD_CALENDAR', 'calendar.start.hour');
    refused(start({ minute: 60 }), 'BAD_CALENDAR', 'calendar.start.minute');
    refused(start({ second: 0 }), 'BAD_CALENDAR', 'calendar.start');
    refused(calendar({ start: 'Goldwane 12' }), 'BAD_CALENDAR', 'calendar.start');
});

const CREATION = {
    races: [{ id: 'human', name: 'Human' }],
    talents: [{ id: 'shadow-bent', name: 'Shadow-bent', stats: { INT: 1 } }, { name: 'River-born', stats: { AGI: 1 } }],
    skills: [{ name: 'Cane Draw', type: 'physical', stat: 'DEX', target: 'one', note: 'The hidden blade drawn and cut in one motion.' }, { name: 'Shadow Cut', type: 'magic', stat: 'INT', target: 'all' }],
};
const preset = extra => pack({ content: { ...CREATION, presets: [{ id: 'wessel', name: 'Wessel (kit)', race: 'human', talents: ['shadow-bent', 'River-born'], points: { DEX: 3 }, skills: ['cane-draw', 'Shadow Cut'], ...extra }] } });

test('skills and presets: references become full ids, skills keep only what they are', () => {
    const normalized = ok(preset());
    assert.deepEqual(normalized.content.skills[0], { name: 'Cane Draw', type: 'physical', stat: 'DEX', target: 'one', element: null, note: 'The hidden blade drawn and cut in one motion.', tags: [], id: 'pack.mini/cane-draw', slug: 'cane-draw', pack: 'mini' });
    assert.deepEqual(ok(pack({ content: { skills: [{ name: 'Jab' }] } })).content.skills[0], { name: 'Jab', type: 'physical', stat: null, target: 'one', element: null, note: '', tags: [], id: 'pack.mini/jab', slug: 'jab', pack: 'mini' });
    assert.deepEqual(normalized.content.presets[0], {
        name: 'Wessel (kit)', note: '', race: 'pack.mini/human', talents: ['pack.mini/shadow-bent', 'pack.mini/river-born'], points: { DEX: 3 },
        skills: ['pack.mini/cane-draw', 'pack.mini/shadow-cut'], id: 'pack.mini/wessel', slug: 'wessel', pack: 'mini',
    });
    assert.deepEqual(ok(preset({ race: 'pack.mini/human', talents: undefined, skills: undefined, points: undefined })).content.presets[0], {
        name: 'Wessel (kit)', note: '', race: 'pack.mini/human', talents: [], points: {}, skills: [], id: 'pack.mini/wessel', slug: 'wessel', pack: 'mini',
    });
    assert.equal(ok(preset({ race: null })).content.presets[0].race, null, 'no race: the reader picks one');
});

test('skill rejections', () => {
    const skill = extra => pack({ content: { skills: [{ name: 'Cane Draw', ...extra }] } });
    refused(skill({ type: 'shadow' }), 'BAD_RECORD', 'content.skills[0].type');
    refused(skill({ target: 'everyone' }), 'BAD_RECORD', 'content.skills[0].target');
    refused(skill({ stat: 'dex' }), 'BAD_RECORD', 'content.skills[0].stat');
    refused(skill({ element: 'Fire!' }), 'BAD_RECORD', 'content.skills[0].element');
    refused(skill({ power: 2 }), 'UNKNOWN_FIELD', 'content.skills[0].power');
    refused(skill({ tags: [''] }), 'BAD_RECORD', 'content.skills[0].tags');
    refused(skill({ note: 'x'.repeat(501) }), 'BAD_RECORD', 'content.skills[0].note');
});

test('preset rejections', () => {
    refused(preset({ race: 'elf' }), 'UNKNOWN_REF', 'content.presets[0].race');
    refused(preset({ talents: ['bookish'] }), 'UNKNOWN_REF', 'content.presets[0].talents[0]');
    refused(preset({ talents: ['shadow-bent', 'Shadow-bent'] }), 'DUPLICATE', 'content.presets[0].talents[1]');
    refused(preset({ talents: 'shadow-bent' }), 'BAD_RECORD', 'content.presets[0].talents');
    refused(preset({ skills: ['Firebolt'] }), 'UNKNOWN_REF', 'content.presets[0].skills[0]');
    refused(preset({ points: { DEX: -1 } }), 'BAD_RECORD', 'content.presets[0].points');
    refused(preset({ points: { dex: 1 } }), 'BAD_RECORD', 'content.presets[0].points');
    refused(preset({ points: { DEX: 1.5 } }), 'BAD_RECORD', 'content.presets[0].points');
    refused(preset({ points: [3] }), 'BAD_RECORD', 'content.presets[0].points');
    refused(preset({ stats: {} }), 'UNKNOWN_FIELD', 'content.presets[0].stats');
    refused(preset({ id: 'Wessel Kit' }), 'BAD_RECORD', 'content.presets[0].id');
    refused(preset({ name: '' }), 'BAD_RECORD', 'content.presets[0].name');
    refused(pack({ content: { presets: [{ name: 'Wessel', race: 'human' }] } }), 'UNKNOWN_REF', 'content.presets[0].race');
});

test('an older pack normalizes as before: no new kinds, no calendar, the same counts', async () => {
    const riverside = ok(sample());
    assert.deepEqual(Object.keys(riverside.content), ['items', 'creatures', 'shops', 'recipes', 'events', 'quests', 'races', 'talents']);
    assert.equal(riverside.calendar, null);
    assert.deepEqual(contentOf([riverside], 'places'), []);
    assert.deepEqual(contentOf([riverside], 'routes'), []);
    assert.deepEqual(contentOf([riverside], 'presets'), []);
    assert.equal(calendarOf([riverside]), null);
    assert.match(countsLine({ places: 2, routes: 1, presets: 1, skills: 2 }, false), /2 skills.*1 ready-made character.*2 places.*1 route/);
});

test('packs.calendar: the first enabled pack with a calendar, a copy; null with none', async () => {
    const settings = fakeSettings();
    const { part, packs } = createPacksPart({ settings });
    assert.equal(part.queries['packs.calendar'](), null);
    await packs.install(pack({ id: 'no-clock' }));
    assert.equal(part.queries['packs.calendar'](), null);
    await packs.install(pack({ id: 'ersveil', calendar: CALENDAR }));
    await packs.install(pack({ id: 'other', calendar: { era: 'AD', months: [{ name: 'Moon', days: 28 }] } }));
    const first = part.queries['packs.calendar']();
    assert.deepEqual(first, { pack: 'ersveil', ...CALENDAR });
    first.months[0].days = 1;
    assert.equal(part.queries['packs.calendar']().months[0].days, 30, 'a fresh copy every time');
    await packs.setEnabled('ersveil', false);
    assert.equal(part.queries['packs.calendar']().pack, 'other', 'a switched-off pack gives no calendar');
});

test('packs.content gives places and routes of enabled packs, in pack order, narrowed by pack', async () => {
    const { part, packs } = createPacksPart({ settings: fakeSettings() });
    await packs.install(map({ id: 'north' }));
    await packs.install(pack({ id: 'south', content: { places: [{ name: 'Thousand Sails', x: 40, y: 40 }] } }));
    assert.deepEqual(part.queries['packs.content']({}, { kind: 'places' }).map(place => [place.pack, place.name]), [['north', 'Bluewatch Village'], ['north', 'Auvoth'], ['north', 'Auvoth Depths'], ['south', 'Thousand Sails']]);
    assert.deepEqual(part.queries['packs.content']({}, { kind: 'places', pack: 'south' }).map(place => place.name), ['Thousand Sails']);
    assert.equal(part.queries['packs.content']({}, { kind: 'routes' }).length, 2);
    assert.deepEqual(packs.list().map(entry => entry.counts.places), [3, 1]);
});

test('a refused pack saves nothing', async () => {
    const settings = fakeSettings();
    const { packs } = createPacksPart({ settings });
    const result = await packs.install(pack({ calendar: { ...CALENDAR, start: { ...CALENDAR.start, day: 99 } } }));
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, 'BAD_CALENDAR');
    assert.equal(settings.saves, 0);
    assert.deepEqual(settings.root.packs ?? [], []);
});

test('calendar holidays: named yearly days, month by name or number kept as the name, names flattened and cut', async () => {
    const holidays = [
        { name: '  Lantern\n Night ', month: 'goldwane', day: 2 },
        { name: 'First​ Light', month: 1, day: 1 },
        { name: 'x'.repeat(80), month: 'Rainmoot', day: 30 },
    ];
    const out = ok(pack({ calendar: { ...CALENDAR, holidays } })).calendar;
    assert.deepEqual(out.holidays, [
        { name: 'Lantern Night', month: 'Goldwane', day: 2 },
        { name: 'First Light', month: 'Dawnwane', day: 1 },
        { name: 'x'.repeat(60), month: 'Rainmoot', day: 30 },
    ]);
    assert.deepEqual(out.start, CALENDAR.start);
    // None given, or an empty list: no holidays key (a calendar reads as before).
    assert.equal(Object.hasOwn(ok(pack({ calendar: CALENDAR })).calendar, 'holidays'), false);
    assert.equal(Object.hasOwn(ok(pack({ calendar: { ...CALENDAR, holidays: [] } })).calendar, 'holidays'), false);
    // 60 is the most.
    const sixty = Array.from({ length: 60 }, (_, i) => ({ name: `Day ${i}`, month: 1 + (i % 3), day: 1 + (i % 30) }));
    assert.equal(ok(pack({ calendar: { ...CALENDAR, holidays: sixty } })).calendar.holidays.length, 60);
    // packs.calendar gives them.
    const { part, packs } = createPacksPart({ settings: fakeSettings() });
    await packs.install(pack({ id: 'ersveil', calendar: { ...CALENDAR, holidays } }));
    assert.deepEqual(part.queries['packs.calendar']().holidays.map(day => [day.name, day.month, day.day]), [['Lantern Night', 'Goldwane', 2], ['First Light', 'Dawnwane', 1], ['x'.repeat(60), 'Rainmoot', 30]]);
});

test('calendar holiday rejections', () => {
    const calendar = holidays => pack({ calendar: { ...CALENDAR, holidays } });
    const one = extra => calendar([{ name: 'Lantern Night', month: 'Goldwane', day: 2, ...extra }]);
    refused(calendar({}), 'BAD_CALENDAR', 'calendar.holidays');
    refused(calendar(Array.from({ length: 61 }, (_, i) => ({ name: `Day ${i}`, month: 1, day: 1 }))), 'BAD_CALENDAR', 'calendar.holidays');
    refused(calendar(['Lantern Night']), 'BAD_CALENDAR', 'calendar.holidays[0]');
    refused(one({ year: 611 }), 'BAD_CALENDAR', 'calendar.holidays[0]');
    refused(one({ name: '' }), 'BAD_CALENDAR', 'calendar.holidays[0].name');
    refused(one({ name: ' ​ ' }), 'BAD_CALENDAR', 'calendar.holidays[0].name');
    refused(one({ name: 7 }), 'BAD_CALENDAR', 'calendar.holidays[0].name');
    refused(one({ month: 'Highsun' }), 'BAD_CALENDAR', 'calendar.holidays[0].month');
    refused(one({ month: 4 }), 'BAD_CALENDAR', 'calendar.holidays[0].month');
    refused(one({ month: 0 }), 'BAD_CALENDAR', 'calendar.holidays[0].month');
    refused(one({ day: 31 }), 'BAD_CALENDAR', 'calendar.holidays[0].day');
    refused(one({ day: 0 }), 'BAD_CALENDAR', 'calendar.holidays[0].day');
    refused(one({ day: 2.5 }), 'BAD_CALENDAR', 'calendar.holidays[0].day');
    // A bad holiday does not hide a bad start.
    refused(pack({ calendar: { ...CALENDAR, start: { ...CALENDAR.start, day: 31 }, holidays: [{ name: 'X', month: 1, day: 0 }] } }), 'BAD_CALENDAR', 'calendar.start.day');
});
