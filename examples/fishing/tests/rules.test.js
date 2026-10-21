import test from 'node:test';
import assert from 'node:assert/strict';
import {
    SPECIES, WATERS, decideCatch, decideBite, waterOf, spotFromPlace, pickedSpotName, formatWeight, article,
    landedLine, lostLine, releasedLine, formatValue, inWindow,
} from '../src/rules.js';
import { rng } from './helpers/fake-sdk.js';

test('the same seed decides the same fish and the same bite', () => {
    for (const water of WATERS) {
        for (const seed of [1, 42, 123456789, 4294967295]) {
            const a = rng(seed), b = rng(seed);
            const first = { fish: decideCatch(a, water) };
            first.bite = decideBite(a, first.fish.rarity);
            const second = { fish: decideCatch(b, water) };
            second.bite = decideBite(b, second.fish.rarity);
            assert.deepEqual(first, second);
        }
    }
});

test('a catch is a fish of that water with whole-number grams and value', () => {
    for (const water of WATERS) {
        const random = rng(7);
        for (let i = 0; i < 300; i += 1) {
            const fish = decideCatch(random, water);
            const species = SPECIES[water].find(s => s.name === fish.name);
            assert.ok(species, fish.name);
            assert.equal(fish.rarity, species.rarity);
            assert.ok(Number.isInteger(fish.grams) && fish.grams >= species.min && fish.grams <= species.max);
            assert.ok(Number.isInteger(fish.value) && fish.value >= 1);
            assert.ok(['poor', 'fair', 'fine', 'prime'].includes(fish.quality));
            const bite = decideBite(random, fish.rarity);
            assert.ok(Number.isInteger(bite.bite) && bite.bite >= 1500 && bite.bite < 5500);
            assert.ok(Number.isInteger(bite.window) && bite.window >= 500 && bite.window < 1300);
        }
    }
});

test('rarer fish come up less often', () => {
    const random = rng(99);
    const counts = {};
    for (let i = 0; i < 4000; i += 1) {
        const { rarity } = decideCatch(random, 'lake');
        counts[rarity] = (counts[rarity] ?? 0) + 1;
    }
    assert.ok(counts.common > counts.uncommon && counts.uncommon > counts.rare && counts.rare > (counts.epic ?? 0));
    assert.ok((counts.legendary ?? 0) < counts.rare);
});

test('the water is read from the place words', () => {
    assert.equal(waterOf('Moonfall Lake'), 'lake');
    assert.equal(waterOf('The Old Weir'), 'river');
    assert.equal(waterOf('Saltmarsh Harbour'), 'sea');
    assert.equal(waterOf('Bluewatch Village', 'settlement', 'the Downs'), null);
    assert.deepEqual(spotFromPlace({ name: 'Moonfall Lake', kind: 'wild', region: '' }), { name: 'Moonfall Lake', kind: 'lake' });
    assert.deepEqual(spotFromPlace({ name: 'Ferry Inn', kind: 'settlement', region: 'River Ash' }), { name: 'Ferry Inn', kind: 'river' });
    assert.equal(spotFromPlace({ name: 'Bluewatch Village', kind: 'settlement' }), null);
    assert.equal(spotFromPlace(null), null);
    assert.equal(pickedSpotName('sea', 'Bluewatch Village'), 'the sea by Bluewatch Village');
    assert.equal(pickedSpotName('river', ''), 'the river');
});

test('catch lines read as plain sentences', () => {
    const trout = { name: 'Silver-violet Trout', rarity: 'rare', grams: 4210, quality: 'fine', value: 164 };
    assert.equal(landedLine('Astra', trout, 'Moonfall Lake'), 'Astra lands a rare 4.2 kg silver-violet trout at Moonfall Lake.');
    assert.equal(landedLine('Ren', { ...trout, name: 'Perch', rarity: 'common', grams: 640 }, 'the Old Weir'),
        'Ren lands a 640 g perch at the Old Weir.');
    assert.equal(landedLine('Ren', { ...trout, name: 'Pike', rarity: 'uncommon', grams: 8000 }, 'the lake'),
        'Ren lands an uncommon 8.0 kg pike at the lake.');
    assert.equal(landedLine('Ren', { ...trout, name: 'Bream', rarity: 'common', grams: 800 }, 'the lake'),
        'Ren lands an 800 g bream at the lake.');
    assert.equal(landedLine('Ren', { ...trout, name: 'Swordfish', rarity: 'epic', grams: 18400 }, 'the sea'),
        'Ren lands an epic 18 kg swordfish at the sea.');
    assert.equal(lostLine('Astra', 'Moonfall Lake'), 'Something takes the bait at Moonfall Lake and gets away from Astra.');
    assert.equal(releasedLine('Astra', trout, 'Moonfall Lake'), 'Astra lets the 4.2 kg silver-violet trout go back into Moonfall Lake.');
    assert.equal(formatWeight(999), '999 g');
    assert.equal(formatWeight(1000), '1.0 kg');
    assert.equal(formatWeight(37600), '38 kg');
    assert.equal(article('11.2 kg'), 'an');
    assert.equal(article('110 g'), 'a');
});

test('values are shown in the currency when there is one', () => {
    const tiers = { mode: 'tiers', tiers: [{ name: 'copper', rate: 1 }, { name: 'silver', rate: 10 }, { name: 'gold', rate: 10 }] };
    assert.equal(formatValue(672, tiers), '6 gold 7 silver 2 copper');
    assert.equal(formatValue(40, tiers), '4 silver');
    assert.equal(formatValue(0, tiers), '0 copper');
    assert.equal(formatValue(12, { mode: 'single', single: 'credits' }), '12 credits');
    assert.equal(formatValue(12, null), '12 coin');
});

test('the reel window includes both of its edges', () => {
    const timing = { bite: 2000, window: 800 };
    assert.equal(inWindow(1999, timing), false);
    assert.equal(inWindow(2000, timing), true);
    assert.equal(inWindow(2800, timing), true);
    assert.equal(inWindow(2801, timing), false);
});
