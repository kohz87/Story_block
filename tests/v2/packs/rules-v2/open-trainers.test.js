// Open trainer templates (OPEN_TRAINERS_SPEC §3): a trainer with "open": true names a pack rank and a fee
// range instead of a place and a fee. The schema, the validator and the export treat it like an open quest.
// Run: node --test tests/v2/packs/rules-v2/open-trainers.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import { smallRulesPack } from './fixtures/smallRulesPack.js';
import * as R from '../../../../src/v2/packs/rules-v2.js';

const { validateRulesPack, exportRulesV2, RULES_V2_ERROR_CODES: CODES } = R;
const copy = value => JSON.parse(JSON.stringify(value));
const T = 'content.rules[0].trainers';

const fixedTrainer = () => ({ slug: 'old-reka', name: 'Old Reka', place: 'pack.fixture/haven', skills: ['s00', 's01'], fee: 50, minutes: 60, eventTemplates: [] });
const template = () => ({ slug: 'drills', name: 'Drills', open: true, rank: 'F', skills: ['s00', 's01'], fee: { coinMin: 10, coinMax: 40 }, minutes: 60, eventTemplates: [] });

// A small pack with one rank, a fixed trainer (index 0) and a template (index 1).
export function trainersPack() {
    const pack = smallRulesPack({ trainers: [fixedTrainer(), template()] });
    pack.content.ranks = [{ id: 'F', title: 'F', levels: [1, 10], reward: [10, 100] }];
    return pack;
}

test('open trainer templates survive canonical roundtrip', () => {
    const pack = trainersPack();
    const checked = validateRulesPack(pack);
    assert.equal(checked.ok, true, JSON.stringify(checked.errors));
    const exported = exportRulesV2(pack);
    assert.equal(exported.ok, true, JSON.stringify(exported.errors));
    const again = validateRulesPack(exported.text);
    assert.equal(again.ok, true, JSON.stringify(again.errors));
    assert.deepEqual(again.resolved, checked.resolved);
    assert.equal(again.rulesHash, checked.rulesHash);
    const trainers = checked.resolved.manifest.trainers;
    assert.equal(trainers.length, 2);
    // The fixed trainer beside it is unchanged; the template resolves with `open`, `rank` and the range.
    const fixed = trainers.find(t => t.slug === 'old-reka');
    assert.equal(fixed.place, 'pack.fixture/haven');
    assert.equal(fixed.fee, 50);
    assert.equal(fixed.open, undefined);
    const open = trainers.find(t => t.slug === 'drills');
    assert.equal(open.id, 'pack.fixture/drills');
    assert.equal(open.open, true);
    assert.equal(open.rank, 'F');
    assert.deepEqual(open.fee, { coinMin: 10, coinMax: 40 });
    assert.equal(open.place, undefined);
    assert.deepEqual(open.skills, ['pack.fixture/s00', 'pack.fixture/s01']);
});

const refusals = [
    ['a place', t => { t.place = 'pack.fixture/haven'; }, CODES.ENVELOPE_UNKNOWN, 'place'],
    ['one number for the fee', t => { t.fee = 50; }, CODES.BAD_SCHEMA, 'fee'],
    ['an inverted fee', t => { t.fee = { coinMin: 91, coinMax: 90 }; }, CODES.BAD_SCHEMA, 'fee'],
    ['a fee of 0', t => { t.fee.coinMin = 0; }, CODES.NUMERIC_RANGE, 'fee.coinMin'],
    ['a fee over 1,000,000', t => { t.fee.coinMax = 1000001; }, CODES.NUMERIC_RANGE, 'fee.coinMax'],
    ['an unknown rank', t => { t.rank = 'Z'; }, CODES.BAD_SCHEMA, 'rank'],
    ['no rank', t => { delete t.rank; }, CODES.BAD_SCHEMA, 'rank'],
    ['an unknown skill', t => { t.skills = ['fireball']; }, CODES.BAD_REF, 'skills[0]'],
    ['no skills', t => { t.skills = []; }, CODES.NUMERIC_RANGE, 'skills'],
    ['thirty minutes', t => { t.minutes = 30; }, CODES.BAD_SCHEMA, 'minutes'],
    ['open removed', t => { delete t.open; }, CODES.BAD_SCHEMA, 'place'],
    ['the slug of a skill', t => { t.slug = 's00'; }, CODES.DUP_ID, 'slug'],
];
for (const [name, change, code, field] of refusals) {
    test(`open trainer refuses ${name}`, () => {
        const pack = trainersPack();
        change(pack.content.rules[0].trainers[1]);
        const res = validateRulesPack(pack);
        assert.equal(res.ok, false);
        assert.ok(res.errors.some(e => e.code === code && e.path === `${T}[1].${field}`),
            `expected ${code} at ${T}[1].${field}, got ${JSON.stringify(res.errors.slice(0, 4))}`);
    });
}

test('open trainer refuses a pack with no ranks at all', () => {
    const pack = trainersPack();
    delete pack.content.ranks;
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === CODES.BAD_SCHEMA && e.path === `${T}[1].rank`), JSON.stringify(res.errors.slice(0, 4)));
});

test('open trainer with the same low and high fee is a fixed price and is accepted', () => {
    const pack = trainersPack();
    pack.content.rules[0].trainers[1].fee = { coinMin: 30, coinMax: 30 };
    assert.equal(validateRulesPack(pack).ok, true);
});

test('a fee range is not held inside the rank\'s quest reward range', () => {
    const pack = trainersPack();
    pack.content.rules[0].trainers[1].fee = { coinMin: 1, coinMax: 5000 };
    assert.equal(validateRulesPack(pack).ok, true);
});

test('a fixed trainer that writes open: true is read as a template, and refused for its place', () => {
    const pack = trainersPack();
    pack.content.rules[0].trainers[0].open = true;
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    // Reported against the template's fields: a missing rank, a fee that is not a range, a place it must not have.
    for (const field of ['rank', 'fee', 'place']) {
        assert.ok(res.errors.some(e => e.code !== undefined && e.path === `${T}[0].${field}`), `${field}: ${JSON.stringify(res.errors.slice(0, 4))}`);
    }
});

test('a fixed trainer may write open: false and nothing else changes', () => {
    const plain = trainersPack();
    const marked = trainersPack();
    marked.content.rules[0].trainers[0].open = false;
    const a = validateRulesPack(plain);
    const b = validateRulesPack(marked);
    assert.equal(b.ok, true, JSON.stringify(b.errors));
    // `open: false` is written through as authored, so the fixed trainer differs by that one key only and the
    // other records are identical.
    const strip = res => { const m = copy(res.resolved.manifest); for (const t of m.trainers) delete t.open; return m; };
    assert.deepEqual(strip(b), strip(a));
    assert.equal(b.resolved.manifest.trainers.find(t => t.slug === 'old-reka').place, 'pack.fixture/haven');
    assert.equal(exportRulesV2(marked).ok, true);
});

test('100 trainers is still the limit, templates counted', () => {
    const pack = smallRulesPack();
    pack.content.ranks = [{ id: 'F', title: 'F', levels: [1, 10], reward: [10, 100] }];
    pack.content.rules[0].trainers = Array.from({ length: 101 }, (_, i) => (i % 2
        ? { ...template(), slug: `t${i}`, name: `Trainer ${i}` }
        : { ...fixedTrainer(), slug: `t${i}`, name: `Trainer ${i}` }));
    const over = validateRulesPack(pack);
    assert.equal(over.ok, false);
    assert.ok(over.errors.some(e => e.code === CODES.NUMERIC_RANGE && e.path === T), JSON.stringify(over.errors.slice(0, 4)));
    pack.content.rules[0].trainers.pop();
    assert.equal(validateRulesPack(pack).ok, true, '100 trainers is the limit');
});

test('Ersveil 1.6.0 ships four bounded trainer templates matching its class lines', async () => {
    const { readFileSync } = await import('node:fs');
    const pack = JSON.parse(readFileSync(new URL('../../../../examples/packs/ersveil-bluewatch/pack.json', import.meta.url)));
    assert.equal(pack.version, '1.6.0');
    const checked = validateRulesPack(pack);
    assert.equal(checked.ok, true, JSON.stringify(checked.errors));
    assert.deepEqual(checked.warnings ?? [], []);
    const rules = pack.content.rules[0];
    const templates = rules.trainers.filter(t => t.open === true);
    assert.deepEqual(templates.map(t => t.slug), ['open-blade-drills', 'open-spear-and-shield', 'open-street-craft', 'open-hedge-lessons']);
    assert.deepEqual(templates.map(t => t.rank), ['F', 'F', 'F', 'E']);
    assert.deepEqual(templates.map(t => [t.fee.coinMin, t.fee.coinMax]), [[40, 90], [35, 80], [30, 70], [80, 160]]);
    // Each template teaches exactly the six skills of a tier-0 class and its tier-1 child, in class order.
    const lines = [['blade-initiate', 'mirage-fencer'], ['militiaman', 'iron-cadet'], ['barge-drifter', 'slum-stalker'], ['hedge-apprentice', 'spell-weaver']];
    templates.forEach((template, i) => {
        const [base, child] = lines.at(i).map(slug => rules.classes.find(c => c.slug === slug));
        assert.equal(base.tier, 0);
        assert.equal(child.tier, 1);
        assert.equal(child.parent, base.slug);
        assert.deepEqual(template.skills, [...base.skills, ...child.skills], template.slug);
        assert.equal(template.skills.length, 6);
        assert.equal(template.minutes, 60);
        assert.deepEqual(template.eventTemplates, []);
        assert.equal(template.place, undefined);
        assert.deepEqual(Object.keys(template).sort(), ['eventTemplates', 'fee', 'minutes', 'name', 'open', 'rank', 'skills', 'slug']);
    });
    // The fees sit under their rank's quest reward maximum, so the checker's note stays quiet.
    for (const template of templates) assert.ok(template.fee.coinMax <= pack.content.ranks.find(r => r.id === template.rank).reward[1], template.slug);
    // The flame line has no template: its teachers are people the pack already places.
    assert.ok(!templates.some(t => t.skills.includes('sacred-ember')));
    // The seven fixed trainers of 1.5.0 come first and are unchanged.
    const before = JSON.parse(readFileSync(new URL('./data/ersveil-bluewatch-1.5.0-trainers.json', import.meta.url)));
    assert.equal(before.length, 7);
    assert.deepEqual(rules.trainers.slice(0, 7), before);
    assert.equal(rules.trainers.length, 11);
    assert.equal(checked.resolved.manifest.trainers.length, 11);
    // The authoring kit's checker agrees: OK, and no note.
    const { checkPack } = await import('../../../../authoring-kit/check.mjs');
    const kit = checkPack(pack);
    assert.equal(kit.ok, true);
    assert.deepEqual(kit.notes, []);
});
