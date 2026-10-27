// Generative offers, Story Block 2.5.0 (GENERATIVE_OFFERS_SPEC §12.1): the three optional schema additions.
//   * `countMin` / `countMax` on an open quest's kill and collect objectives (1 to 999; countMin <= count <= countMax),
//   * `aliases` on a foe (0 to 8 unique strings of 1 to 80 characters),
//   * `offerWords` on the rules manifest (eleven lists of 0 to 40 lower-case words of 1 to 24 characters).
// All of them are optional, so every pack written before 2.5.0 reads as it did. These tests use a small fixture pack made
// here, never the shipped example pack (which this release leaves as it was).
// Run: node --test tests/v2/packs/rules-v2/offer-bounds.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeValidExtendedPack } from './fixtures/builders.js';
import * as R from '../../../../src/v2/packs/rules-v2.js';

const { validateRulesPack, exportRulesV2, RULES_V2_ERROR_CODES: CODES } = R;
const copy = value => JSON.parse(JSON.stringify(value));
const show = result => JSON.stringify(result.errors);

const open = (id, objective) => ({
    slug: id, name: id, open: true, rank: 'F', category: 'bounty', giver: null, turnInPlace: null, requirements: [],
    objectives: [{ id: `ob_${id.length.toString(16).padStart(8, '0')}`, ...objective }],
    reward: { coinMin: 10, coinMax: 50, xpMin: 20, xpMax: 100, items: [] }, durationMinutes: null, repeat: null, chain: null,
});

// The extended fixture plus a rank and two open templates: a hunt (index 0) and a delivery (index 1).
export function boundsPack() {
    const pack = makeValidExtendedPack();
    pack.content.ranks = [{ id: 'F', title: 'F', levels: [1, 10], reward: [10, 100] }];
    pack.content.quests = [
        open('open-hunt', { kind: 'kill', count: 2, countMin: 1, countMax: 6, allowVariants: true }),
        open('open-delivery', { kind: 'collect', def: 'potion', count: 2, countMin: 1, countMax: 4, consume: true }),
    ];
    return pack;
}

const Q = 'content.quests';
const errorAt = (result, path, code) => result.errors.some(e => e.path === path && (code === undefined || e.code === code));

test('the 2.4.0 shapes still read without any of the new fields', () => {
    const pack = boundsPack();
    for (const q of pack.content.quests) { delete q.objectives[0].countMin; delete q.objectives[0].countMax; }
    const result = validateRulesPack(pack);
    assert.equal(result.ok, true, show(result));
});

test('count bounds survive the canonical roundtrip and reach the resolved quests', () => {
    const pack = boundsPack();
    const checked = validateRulesPack(pack);
    assert.equal(checked.ok, true, show(checked));
    const exported = exportRulesV2(pack);
    assert.equal(exported.ok, true, show(exported));
    const again = validateRulesPack(exported.text);
    assert.equal(again.ok, true, show(again));
    assert.deepEqual(again.resolved, checked.resolved);
    assert.equal(again.rulesHash, checked.rulesHash);
    const hunt = checked.resolved.quests['pack.fixture/open-hunt'].objectives[0];
    assert.deepEqual([hunt.countMin, hunt.count, hunt.countMax], [1, 2, 6]);
    const delivery = checked.resolved.quests['pack.fixture/open-delivery'].objectives[0];
    assert.deepEqual([delivery.countMin, delivery.count, delivery.countMax], [1, 2, 4]);
});

test('one bound alone, and a count equal to a bound, are fine', () => {
    for (const [min, max] of [[2, undefined], [undefined, 2], [2, 2], [1, undefined], [undefined, 999]]) {
        const pack = boundsPack();
        const objective = pack.content.quests[0].objectives[0];
        delete objective.countMin; delete objective.countMax;
        if (min !== undefined) objective.countMin = min;
        if (max !== undefined) objective.countMax = max;
        const result = validateRulesPack(pack);
        assert.equal(result.ok, true, `${min} ${max}: ${show(result)}`);
    }
});

for (const [name, kind, change, message] of [
    ['an inverted range (countMin above the count)', 0, o => { o.countMin = 3; }, /below its countMin 3/],
    ['a count above countMax', 0, o => { o.countMax = 1; }, /above its countMax 1/],
    ['a whole range that misses the count', 0, o => { o.countMin = 5; o.countMax = 6; }, /below its countMin 5/],
    ['an inverted collect range (countMin above the count)', 1, o => { o.countMin = 3; }, /below its countMin 3/],
    ['a collect count above countMax', 1, o => { o.countMax = 1; }, /above its countMax 1/],
]) {
    test(`an open objective with ${name} is bad-schema at its count`, () => {
        const pack = boundsPack();
        change(pack.content.quests[kind].objectives[0]);
        const result = validateRulesPack(pack);
        assert.equal(result.ok, false);
        const found = result.errors.find(e => e.path === `${Q}[${kind}].objectives[0].count`);
        assert.ok(found, show(result));
        assert.equal(found.code, CODES.BAD_SCHEMA);
        assert.match(found.message, message);
    });
}

for (const [name, change, code] of [
    ['countMin 0', o => { o.countMin = 0; }, CODES.NUMERIC_RANGE],
    ['countMax 1000', o => { o.countMax = 1000; }, CODES.NUMERIC_RANGE],
    ['a fractional countMax', o => { o.countMax = 2.5; }, CODES.NUMERIC_RANGE],
    ['a text countMin', o => { o.countMin = '1'; }, undefined],
]) {
    test(`the schema refuses ${name}`, () => {
        const pack = boundsPack();
        change(pack.content.quests[0].objectives[0]);
        const result = validateRulesPack(pack);
        assert.equal(result.ok, false);
        if (code) assert.ok(result.errors.some(e => e.code === code), show(result));
    });
}

test('count bounds belong to the kill and collect branches of an open objective only', () => {
    // A visit or story objective has no count to bound; a closed quest's objective is fixed and has none either.
    for (const objective of [{ kind: 'visit', countMin: 1 }, { kind: 'story', countMax: 3 }]) {
        const pack = boundsPack();
        pack.content.quests[0].objectives = [{ id: 'ob_00000001', ...objective }];
        assert.equal(validateRulesPack(pack).ok, false, JSON.stringify(objective));
    }
    const pack = boundsPack();
    pack.content.quests = [{
        slug: 'closed', name: 'Closed', category: 'side', giver: null, turnInPlace: null, requirements: [],
        objectives: [{ id: 'ob_00000001', kind: 'kill', foe: 'goblin-scout', count: 2, countMax: 4 }],
        reward: { coin: 50, xp: 40, items: [] }, durationMinutes: null, repeat: null, chain: null,
    }];
    const result = validateRulesPack(pack);
    assert.equal(result.ok, false);
    assert.ok(errorAt(result, `${Q}[0].objectives[0].countMax`, CODES.ENVELOPE_UNKNOWN), show(result));
});

// ---- foe aliases -------------------------------------------------------------------------------------------------

const foePath = 'content.creatures[0]';

test('foe aliases are kept by the canonical roundtrip and by the resolved foe', () => {
    const pack = makeValidExtendedPack();
    pack.content.creatures[0].aliases = ['goblin', 'scouts'];
    const checked = validateRulesPack(pack);
    assert.equal(checked.ok, true, show(checked));
    const id = `pack.fixture/${pack.content.creatures[0].slug}`;
    assert.deepEqual(checked.resolved.foes[id].aliases, ['goblin', 'scouts']);
    const exported = exportRulesV2(pack);
    assert.equal(exported.ok, true, show(exported));
    const again = validateRulesPack(exported.text);
    assert.equal(again.ok, true, show(again));
    assert.deepEqual(again.resolved.foes[id].aliases, ['goblin', 'scouts']);
    assert.equal(again.rulesHash, checked.rulesHash);
});

test('aliases are optional, may be empty, and may fill all eight places', () => {
    for (const aliases of [undefined, [], ['a'], Array.from({ length: 8 }, (_, i) => `alias ${i}`), ['x'.repeat(80)]]) {
        const pack = makeValidExtendedPack();
        if (aliases !== undefined) pack.content.creatures[0].aliases = aliases;
        const result = validateRulesPack(pack);
        assert.equal(result.ok, true, `${JSON.stringify(aliases)}: ${show(result)}`);
    }
});

for (const [name, aliases, code] of [
    ['nine aliases', Array.from({ length: 9 }, (_, i) => `alias ${i}`), CODES.NUMERIC_RANGE],
    ['a repeated alias', ['wolf', 'wolf'], CODES.DUP_ID],
    ['an empty alias', [''], CODES.NUMERIC_RANGE],
    ['an alias of 81 characters', ['x'.repeat(81)], CODES.NUMERIC_RANGE],
    ['a number', [7], undefined],
    ['a string instead of a list', 'wolf', undefined],
]) {
    test(`foe aliases refuse ${name}`, () => {
        const pack = makeValidExtendedPack();
        pack.content.creatures[0].aliases = aliases;
        const result = validateRulesPack(pack);
        assert.equal(result.ok, false);
        assert.ok(result.errors.some(e => e.path.startsWith(`${foePath}.aliases`)), show(result));
        if (code) assert.ok(result.errors.some(e => e.code === code), show(result));
    });
}

test('markup in an alias is refused like markup anywhere else in a foe', () => {
    const pack = makeValidExtendedPack();
    pack.content.creatures[0].aliases = ['<b>wolf</b>'];
    const result = validateRulesPack(pack);
    assert.equal(result.ok, false);
});

// ---- offerWords --------------------------------------------------------------------------------------------------

const LISTS = ['hunt', 'cull', 'gather', 'deliver', 'explore', 'escort', 'task', 'easy', 'normal', 'hard', 'nightmare'];
const W = 'content.rules[0].offerWords';

test('offerWords: all eleven lists, kept by the roundtrip and the resolved manifest', () => {
    const pack = makeValidExtendedPack();
    const words = Object.fromEntries(LISTS.map(list => [list, [`${list}a`, `${list}b`]]));
    pack.content.rules[0].offerWords = words;
    const checked = validateRulesPack(pack);
    assert.equal(checked.ok, true, show(checked));
    assert.deepEqual(checked.resolved.manifest.offerWords, words);
    const exported = exportRulesV2(pack);
    assert.equal(exported.ok, true, show(exported));
    const again = validateRulesPack(exported.text);
    assert.equal(again.ok, true, show(again));
    assert.deepEqual(again.resolved.manifest.offerWords, words);
    assert.equal(again.rulesHash, checked.rulesHash);
});

test('offerWords is optional, may be empty, and any list may be left out or empty; words in any language', () => {
    for (const offerWords of [undefined, {}, { hunt: [] }, { hunt: ['jagd'], easy: ['leicht', '簡単'] }, { cull: Array.from({ length: 40 }, (_, i) => `w${i}`) }, { task: ['x'.repeat(24)] }]) {
        const pack = makeValidExtendedPack();
        if (offerWords !== undefined) pack.content.rules[0].offerWords = offerWords;
        const result = validateRulesPack(pack);
        assert.equal(result.ok, true, `${JSON.stringify(offerWords)}: ${show(result)}`);
    }
});

for (const [name, offerWords, path, code] of [
    ['an unknown list', { slay: ['x'] }, `${W}.slay`, CODES.ENVELOPE_UNKNOWN],
    ['41 words', { hunt: Array.from({ length: 41 }, (_, i) => `w${i}`) }, `${W}.hunt`, CODES.NUMERIC_RANGE],
    ['an empty word', { hunt: [''] }, `${W}.hunt[0]`, CODES.NUMERIC_RANGE],
    ['a word of 25 characters', { easy: ['x'.repeat(25)] }, `${W}.easy[0]`, CODES.NUMERIC_RANGE],
    ['a capital letter', { hard: ['fine', 'Risky'] }, `${W}.hard[1]`, CODES.BAD_SCHEMA],
    ['a capital in another script', { hard: ['ÉPIQUE'] }, `${W}.hard[0]`, CODES.BAD_SCHEMA],
    ['a list that is not a list', { hunt: 'kill' }, `${W}.hunt`, undefined],
    ['a number as a word', { hunt: [3] }, `${W}.hunt[0]`, undefined],
    ['a list instead of the object', ['hunt'], W, undefined],
]) {
    test(`offerWords refuses ${name}`, () => {
        const pack = makeValidExtendedPack();
        pack.content.rules[0].offerWords = offerWords;
        const result = validateRulesPack(pack);
        assert.equal(result.ok, false);
        assert.ok(errorAt(result, path, code), `${path}: ${show(result)}`);
    });
}

test('adding the new fields changes the rules hash only through what is written (the schema is part of it)', () => {
    const plain = makeValidExtendedPack();
    const withWords = copy(plain);
    withWords.content.rules[0].offerWords = { hunt: ['slay'] };
    const a = validateRulesPack(plain);
    const b = validateRulesPack(withWords);
    assert.equal(a.ok && b.ok, true);
    assert.notEqual(a.rulesHash, b.rulesHash);
    assert.equal(validateRulesPack(copy(plain)).rulesHash, a.rulesHash, 'the same pack hashes the same');
});
