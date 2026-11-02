// REVIEW-Z: the safety net refused real new places that share one word with a mapped place, and times of day that
// name one exact time. Those now pass; an invented name for a mapped place is still refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mapPlaces, whereWhy } from '../../../src/v2/assist/where.js';

const places = mapPlaces([
    { name: 'Bluewatch Village / Guild Office', aliases: ['Guild Hall'] },
    { name: 'Silver Mine' }, { name: 'Blackwater Keep' }, { name: 'Kestrel Pass' }, { name: 'Auvoth' },
]);
const place = name => whereWhy({ op: '~', kind: 'place', name }, { places });
const time = name => whereWhy({ op: '~', kind: 'time', name });

test('a new place sharing one word with a mapped place, or a spot named after one, is not refused', () => {
    for (const name of ['Silver Lake', 'Blackwater Village', 'Kestrel Road', 'Silver Mine Road', 'Kestrel Pass Outpost', 'Auvoth Docks']) assert.equal(place(name), '', name);
});

test('an invented name for a mapped place is still refused', () => {
    assert.match(place('Bluewatch Guild Branch'), /the map calls this place "Bluewatch Village \/ Guild Office"/);
});

test('noon, midnight and 9.30 am are clock times; midday and a bare date are not', () => {
    for (const said of ['Goldwane 12, noon', 'Goldwane 12, midnight', 'Goldwane 12, 9.30 am']) assert.equal(time(said), '', said);
    for (const said of ['midday', 'Goldwane 12', 'Goldwane 12, mid-morning']) assert.match(time(said), /has no clock time/, said);
});
