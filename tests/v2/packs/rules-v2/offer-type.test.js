// Generative offers, Story Block 2.5.0: an open quest template's optional `offerType` (hunt, cull, gather, deliver, explore, escort,
// task). Hunt and cull share the objective kind `kill`, gather and deliver `collect`, escort and task `story`, so without it a
// narrator's `type: cull` could only land on the first kill template; with it RPG Battle 2.3.0 picks the template whose type matches.
// Open templates only (a closed quest is refused like a count bound); the type must agree with the template's first objective.
// Run: node --test tests/v2/packs/rules-v2/offer-type.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeValidExtendedPack } from './fixtures/builders.js';
import * as R from '../../../../src/v2/packs/rules-v2.js';

const { validateRulesPack, exportRulesV2, RULES_V2_ERROR_CODES: CODES } = R;
const show = result => JSON.stringify(result.errors);
const copy = value => JSON.parse(JSON.stringify(value));

const OBJECTIVES = {
    kill: { kind: 'kill', count: 2 },
    collect: { kind: 'collect', def: 'potion', count: 2, consume: true },
    visit: { kind: 'visit' },
    story: { kind: 'story' },
};
const KIND_OF = { hunt: 'kill', cull: 'kill', gather: 'collect', deliver: 'collect', explore: 'visit', escort: 'story', task: 'story' };

const template = (slug, kind, extra = {}) => ({
    slug, name: slug, open: true, rank: 'F', category: 'side', giver: null, turnInPlace: null, requirements: [],
    objectives: [{ id: `ob_${(slug.length + 1).toString(16).padStart(8, '0')}`, ...OBJECTIVES[kind] }],
    reward: { coinMin: 10, coinMax: 50, xpMin: 20, xpMax: 100, items: [] }, durationMinutes: null, repeat: null, chain: null, ...extra,
});

function typedPack(quests) {
    const pack = makeValidExtendedPack();
    pack.content.ranks = [{ id: 'F', title: 'F', levels: [1, 10], reward: [10, 100] }];
    pack.content.quests = quests;
    return pack;
}

test('every offerType is accepted on an open template whose first objective settles it, and reaches the resolved quest and the export', () => {
    for (const [type, kind] of Object.entries(KIND_OF)) {
        const pack = typedPack([template(`t-${type}`, kind, { offerType: type })]);
        const checked = validateRulesPack(pack);
        assert.equal(checked.ok, true, `${type}: ${show(checked)}`);
        assert.equal(checked.resolved.quests[`pack.fixture/t-${type}`].offerType, type);
        const exported = exportRulesV2(pack);
        assert.equal(exported.ok, true, show(exported));
        assert.match(exported.text, new RegExp(`"offerType": "${type}"`));
        const again = validateRulesPack(exported.text);
        assert.equal(again.ok, true, show(again));
        assert.deepEqual(again.resolved, checked.resolved);
        assert.equal(again.rulesHash, checked.rulesHash);
    }
});

test('a type that disagrees with the first objective is bad-schema at offerType, with a message that says what is needed', () => {
    let seen = 0;
    for (const type of Object.keys(KIND_OF)) {
        for (const kind of Object.keys(OBJECTIVES)) {
            if (KIND_OF[type] === kind) continue;
            const result = validateRulesPack(typedPack([template('t', kind, { offerType: type })]));
            assert.equal(result.ok, false, `${type} on ${kind}`);
            assert.deepEqual(result.errors.map(e => [e.code, e.path]), [[CODES.BAD_SCHEMA, 'content.quests[0].offerType']], `${type} on ${kind}: ${show(result)}`);
            assert.match(result.errors[0].message, new RegExp(`offerType "${type}" needs a ${KIND_OF[type]} objective first; this template's first objective is a ${kind} one`));
            seen += 1;
        }
    }
    assert.equal(seen, 7 * 3);
});

test('only the first objective counts', () => {
    const pack = typedPack([template('t', 'kill', { offerType: 'hunt' })]);
    pack.content.quests[0].objectives.push({ id: 'ob_000000aa', ...OBJECTIVES.story });
    assert.equal(validateRulesPack(pack).ok, true);
    pack.content.quests[0].objectives.reverse();
    const reversed = validateRulesPack(pack);
    assert.equal(reversed.ok, false);
    assert.ok(reversed.errors.some(e => e.path === 'content.quests[0].offerType'), show(reversed));
});

test('an unknown type, or a type that is not a word, is refused', () => {
    for (const value of ['slay', 'Hunt', '', 'kill', null, 3, ['hunt']]) {
        const result = validateRulesPack(typedPack([template('t', 'kill', { offerType: value })]));
        assert.equal(result.ok, false, JSON.stringify(value));
        assert.ok(result.errors.some(e => e.path === 'content.quests[0].offerType'), `${JSON.stringify(value)}: ${show(result)}`);
    }
});

test('a closed quest refuses offerType the way it refuses countMin and countMax: envelope-unknown at the field', () => {
    const closed = (extra = {}) => ({
        slug: 'closed', name: 'Closed', category: 'side', giver: null, turnInPlace: null, requirements: [],
        objectives: [{ id: 'ob_00000001', kind: 'kill', foe: 'goblin-scout', count: 2 }],
        reward: { coin: 50, xp: 40, items: [] }, durationMinutes: null, repeat: null, chain: null, ...extra,
    });
    for (const extra of [{ offerType: 'hunt' }, { open: false, offerType: 'hunt' }]) {
        const result = validateRulesPack(typedPack([closed(extra)]));
        assert.equal(result.ok, false, JSON.stringify(extra));
        assert.deepEqual(result.errors.map(e => [e.code, e.path]), [[CODES.ENVELOPE_UNKNOWN, 'content.quests[0].offerType']], show(result));
    }
    const bounds = validateRulesPack(typedPack([closed({ objectives: [{ id: 'ob_00000001', kind: 'kill', foe: 'goblin-scout', count: 2, countMax: 4 }] })]));
    assert.deepEqual(bounds.errors.map(e => [e.code, e.path]), [[CODES.ENVELOPE_UNKNOWN, 'content.quests[0].objectives[0].countMax']]);
    assert.equal(validateRulesPack(typedPack([closed()])).ok, true, 'the same closed quest without it is fine');
});

test('two open templates may share a type and a rank, and templates without a type sit beside typed ones', () => {
    const pack = typedPack([template('cull-a', 'kill', { offerType: 'cull' }), template('cull-b', 'kill', { offerType: 'cull' }), template('hunt-a', 'kill', { offerType: 'hunt' }), template('plain', 'kill')]);
    const result = validateRulesPack(pack);
    assert.equal(result.ok, true, show(result));
    const quests = result.resolved.quests;
    assert.deepEqual(['cull-a', 'cull-b', 'hunt-a', 'plain'].map(slug => quests[`pack.fixture/${slug}`].offerType), ['cull', 'cull', 'hunt', undefined]);
});

test('a template without offerType keeps its exact bytes: the key is never added', () => {
    const plain = typedPack([template('t', 'kill'), template('d', 'collect')]);
    const exported = exportRulesV2(plain);
    assert.equal(exported.ok, true, show(exported));
    assert.ok(!exported.text.includes('offerType'));
    const resolved = validateRulesPack(plain).resolved.quests;
    for (const quest of Object.values(resolved)) assert.ok(!('offerType' in quest));
    // The same pack with the key adds exactly that key to the bytes, and nothing else changes.
    const typed = copy(plain);
    typed.content.quests[0].offerType = 'hunt';
    const withType = exportRulesV2(typed);
    assert.equal(withType.text.replace(/,\n\s*"offerType": "hunt"/, ''), exported.text);
    assert.notEqual(withType.rulesHash, exported.rulesHash);
});
