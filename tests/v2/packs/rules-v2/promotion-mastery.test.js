// Generative offers, Story Block 2.5.0: the rules manifest's optional `promotionMastery`, how much mastery each promotion needs.
// Today every promotion needs all three of a class's skills at the top mastery (5), fixed. A pack may now say, for the promotions at
// levels 10, 20 and 30 in the order of `promotionMilestones`, a whole number 1 to 5 for each. Absent means [5, 5, 5], today's rule.
// The resolved constants (and so the pin RPG Battle freezes) carry the effective value; every other constant stays fixed.
// Run: node --test tests/v2/packs/rules-v2/promotion-mastery.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import { smallRulesPack } from './fixtures/smallRulesPack.js';
import { HOST_VERSION } from '../../../../src/v2/packs/validate.js';
import * as R from '../../../../src/v2/packs/rules-v2.js';
import { createPacksPart } from '../../../../src/v2/packs/index.js';
import { fakeSettings } from '../helpers/fake-settings.js';

const { validateRulesPack, exportRulesV2, RULES_V2_CONSTANTS: FIXED, RULES_V2_ERROR_CODES: CODES } = R;
const show = result => JSON.stringify(result.errors);
const P = 'content.rules[0].promotionMastery';
const packWith = value => {
    const pack = smallRulesPack();
    if (value !== undefined) pack.content.rules[0].promotionMastery = value;
    return pack;
};

test('the schema ties the field to the progression: one whole number 1 to the top mastery for each promotion', () => {
    const field = R.rulesV2Schema.properties.promotionMastery;
    assert.equal(field.minItems, FIXED.promotionMilestones.length);
    assert.equal(field.maxItems, FIXED.promotionMilestones.length);
    assert.equal(field.items.type, 'integer');
    assert.equal(field.items.minimum, 1);
    assert.equal(field.items.maximum, R.RULES_V2_PROGRESSION.maxMastery);
    assert.equal(field.items.maximum, FIXED.masteryAt.length);
    assert.deepEqual(FIXED.promotionMastery, [5, 5, 5], 'the default is today\'s rule');
    assert.ok(!R.rulesV2Schema.required?.includes('promotionMastery') && !('default' in field), 'optional, with no default written into packs');
});

test('a pack without it resolves to [5, 5, 5], writes no key, and its other constants are the fixed ones', () => {
    const result = validateRulesPack(packWith());
    assert.equal(result.ok, true, show(result));
    assert.deepEqual(result.resolved.constants, JSON.parse(JSON.stringify(FIXED)));
    assert.deepEqual(result.resolved.constants.promotionMastery, [5, 5, 5]);
    assert.ok(!('promotionMastery' in result.resolved.manifest));
    const exported = exportRulesV2(packWith());
    assert.equal(exported.ok, true, show(exported));
    assert.ok(!exported.text.includes('promotionMastery'), 'the bytes of a pack without it are unchanged');
});

test('a pack that writes it: accepted, kept by the manifest, effective in the resolved constants, and nothing else moves', () => {
    for (const value of [[3, 4, 5], [1, 1, 1], [5, 5, 5], [2, 2, 5], [5, 1, 5]]) {
        const result = validateRulesPack(packWith(value));
        assert.equal(result.ok, true, `${value}: ${show(result)}`);
        assert.deepEqual(result.resolved.manifest.promotionMastery, value);
        assert.deepEqual(result.resolved.constants.promotionMastery, value);
        const { promotionMastery: _written, ...others } = result.resolved.constants;
        const { promotionMastery: _default, ...fixed } = JSON.parse(JSON.stringify(FIXED));
        assert.deepEqual(others, fixed, 'masteryAt, the use caps and every other constant are the fixed ones');
        assert.ok(Object.isFrozen(result.resolved.constants.promotionMastery), 'the resolved ruleset is immutable');
    }
});

test('the export keeps it and a re-import resolves to the same constants and the same hash', () => {
    const pack = packWith([3, 4, 5]);
    const checked = validateRulesPack(pack);
    const exported = exportRulesV2(pack);
    assert.equal(exported.ok, true, show(exported));
    assert.match(exported.text, /"promotionMastery": \[\s*3,\s*4,\s*5\s*\]/);
    const again = validateRulesPack(exported.text);
    assert.equal(again.ok, true, show(again));
    assert.deepEqual(again.resolved.constants.promotionMastery, [3, 4, 5]);
    assert.deepEqual(again.resolved, checked.resolved);
    assert.equal(again.rulesHash, checked.rulesHash);
    assert.equal(again.packHash, checked.packHash);
});

test('what a pack says is in its hashes: the same rules with another promotionMastery hash differently', () => {
    const a = validateRulesPack(packWith([3, 4, 5]));
    const b = validateRulesPack(packWith([3, 4, 4]));
    const plain = validateRulesPack(packWith());
    assert.equal(new Set([a.rulesHash, b.rulesHash, plain.rulesHash]).size, 3);
    assert.equal(new Set([a.packHash, b.packHash, plain.packHash]).size, 3);
    assert.equal(validateRulesPack(packWith([3, 4, 5])).rulesHash, a.rulesHash, 'and the same pack hashes the same');
});

for (const [name, value, path, code] of [
    ['two numbers', [3, 5], P, CODES.NUMERIC_RANGE],
    ['four numbers', [3, 4, 5, 5], P, CODES.NUMERIC_RANGE],
    ['an empty list', [], P, CODES.NUMERIC_RANGE],
    ['a 0', [0, 5, 5], `${P}[0]`, CODES.NUMERIC_RANGE],
    ['a 6', [5, 6, 5], `${P}[1]`, CODES.NUMERIC_RANGE],
    ['a negative number', [5, 5, -1], `${P}[2]`, CODES.NUMERIC_RANGE],
    ['a fraction', [2.5, 5, 5], `${P}[0]`, CODES.NUMERIC_RANGE],
    ['a number written as text', ['3', 5, 5], `${P}[0]`, undefined],
    ['null', [null, 5, 5], `${P}[0]`, undefined],
    ['a single number', 5, P, CODES.BAD_SCHEMA],
    ['text', '5,5,5', P, CODES.BAD_SCHEMA],
    ['an object', { 10: 5, 20: 5, 30: 5 }, P, CODES.BAD_SCHEMA],
]) {
    test(`promotionMastery refuses ${name}`, () => {
        const result = validateRulesPack(packWith(value));
        assert.equal(result.ok, false);
        const found = result.errors.find(e => e.path === path);
        assert.ok(found, `${path}: ${show(result)}`);
        if (code) assert.equal(found.code, code);
    });
}

test('the constants argument cannot set it: it may only repeat the default, like masteryAt and the other fixed arrays', () => {
    const ok = validateRulesPack(packWith(), { hostVersion: HOST_VERSION, constants: { promotionMastery: [5, 5, 5] } });
    assert.equal(ok.ok, true, show(ok));
    for (const constants of [{ promotionMastery: [3, 3, 3] }, { promotionMastery: [5, 5] }, { promotionMastery: 5 }]) {
        const refused = validateRulesPack(packWith(), { hostVersion: HOST_VERSION, constants });
        assert.equal(refused.ok, false, JSON.stringify(constants));
        assert.deepEqual(refused.errors.map(e => [e.code, e.path]), [[CODES.BAD_SCHEMA, 'constants.promotionMastery']]);
        assert.match(refused.errors[0].message, /fixed and cannot be overridden/);
    }
    // The fixed constants stay as strict as before.
    for (const constants of [{ masteryAt: [1, 2, 3, 4, 5] }, { promotionMilestones: [5, 20, 30] }, { usePerSkillReply: 3 }, { levelCap: 50 }]) {
        assert.equal(validateRulesPack(packWith([3, 4, 5]), { hostVersion: HOST_VERSION, constants }).ok, false, JSON.stringify(constants));
    }
    assert.equal(validateRulesPack(packWith([3, 4, 5]), { hostVersion: HOST_VERSION, constants: { xpPerLevel: 200 } }).ok, true, 'xpPerLevel and promptChars still take values');
});

test('an installed pack\'s pin carries the effective value, and its constants hash follows it', async () => {
    const MODULES = ['story-director', 'rpg-battle', 'story-block', 'scene', 'inventory'];
    const pinOf = async value => {
        const { part, packs } = createPacksPart({ settings: fakeSettings(), capabilities: () => MODULES });
        assert.equal((await packs.install(JSON.stringify(packWith(value)), { source: 'file', origin: 'rules.json' })).ok, true);
        return part.queries['packs.rules']({}, { resolve: true })[0].pin;
    };
    const plain = await pinOf();
    const lenient = await pinOf([3, 4, 5]);
    assert.deepEqual(plain.resolved.constants.promotionMastery, [5, 5, 5]);
    assert.deepEqual(lenient.resolved.constants.promotionMastery, [3, 4, 5]);
    assert.deepEqual(lenient.resolved.manifest.promotionMastery, [3, 4, 5]);
    assert.notEqual(lenient.constantsHash, plain.constantsHash);
    assert.equal(lenient.constantsHash, R.sha256(JSON.stringify(R.canonicalizeJson(lenient.resolved.constants))));
    assert.deepEqual(lenient.progression, plain.progression, 'the progression structure is unchanged');
});
