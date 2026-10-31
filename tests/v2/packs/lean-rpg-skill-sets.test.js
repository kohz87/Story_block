// The `leanRpg` content kind: `content.leanRpg.skillSets`, ready-made skills the Lean RPG's New character wizard offers
// (`{ name, slug?, about?, skills: [{ name, about, stat, uses? }] }`). Validation of every field, the caps, the normalized list and the query.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validatePack } from '../../../src/v2/packs/validate.js';
import { contentOf } from '../../../src/v2/packs/content.js';
import { countsLine } from '../../../src/v2/packs/panel.js';
import { CONTENT_KINDS, LEAN_RPG_LIMITS, OPTIONAL_KINDS } from '../../../src/v2/packs/limits.js';
import { CREATION, STATS, USES } from '../../../src/v2/lean-rpg/names.js';
import { pack } from './helpers/fixtures.js';

const skill = (extra = {}) => ({ name: 'Spear', about: 'Holding a line with a long spear.', stat: 'str', ...extra });
const set = (extra = {}) => ({ name: 'Sealwarden recruit', about: 'Trained at the gates.', skills: [skill()], ...extra });
const withSets = list => pack({ content: { leanRpg: { skillSets: list } } });

function ok(value) {
    const result = validatePack(value);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    return result.pack;
}

// Through JSON, as a file gives it: a field set to undefined is a field left out.
function refused(value, code, path) {
    const result = validatePack(JSON.stringify(value));
    assert.equal(result.ok, false, `${path} should be refused`);
    const hit = result.errors.find(error => error.path === path);
    assert.ok(hit, `no error at ${path}: ${JSON.stringify(result.errors)}`);
    assert.equal(hit.code, code, hit.message);
    assert.ok(hit.message.length > 20, 'a sentence the reader can act on');
    return hit;
}

test('leanRpg is a content kind added after the first format, and its limits are the Skills block\'s', () => {
    assert.ok(CONTENT_KINDS.includes('leanRpg') && OPTIONAL_KINDS.includes('leanRpg'));
    assert.equal('leanRpg' in ok(pack()).content, false, 'an older pack normalizes as it always did');
    assert.deepEqual(ok(withSets([])).content.leanRpg, []);
    assert.deepEqual([LEAN_RPG_LIMITS.sets, LEAN_RPG_LIMITS.skills, LEAN_RPG_LIMITS.skillName, LEAN_RPG_LIMITS.skillAbout], [12, 5, CREATION.skillName, CREATION.skillAbout]);
    assert.deepEqual([...LEAN_RPG_LIMITS.stats], [...STATS], 'the same seven stats as the Skills block');
    assert.deepEqual([...LEAN_RPG_LIMITS.uses].sort(), [...USES].sort());
});

test('a set keeps its skills, with the stat in lower case and the resource stamina unless it says mana', () => {
    const made = ok(withSets([set({ name: ' Sealwarden   recruit ', skills: [skill(), skill({ name: 'Ward-reading', about: ' Reading seals. ', stat: 'INT', uses: 'Mana' }), skill({ name: 'Gatecraft', stat: ' vit ', uses: 'stamina' })] })]));
    assert.deepEqual(made.content.leanRpg, [{
        name: 'Sealwarden recruit', about: 'Trained at the gates.',
        skills: [
            { name: 'Spear', about: 'Holding a line with a long spear.', stat: 'str', uses: 'stamina' },
            { name: 'Ward-reading', about: 'Reading seals.', stat: 'int', uses: 'mana' },
            { name: 'Gatecraft', about: 'Holding a line with a long spear.', stat: 'vit', uses: 'stamina' },
        ],
        id: 'pack.mini/sealwarden-recruit', slug: 'sealwarden-recruit', pack: 'mini',
    }]);
    const plain = ok(withSets([{ name: 'Bare', skills: [skill()] }]));
    assert.equal(plain.content.leanRpg[0].about, '', 'about may be left out');
});

test('the shipped test fixture pack is valid and its set comes out of the query with its pack', () => {
    const fixture = JSON.parse(readFileSync(new URL('../lean-rpg/fixtures/skill-sets-pack.json', import.meta.url), 'utf8'));
    const made = ok(fixture);
    const found = contentOf([made], 'leanRpg');
    assert.equal(found.length, 1);
    assert.deepEqual([found[0].name, found[0].pack, found[0].skills.map(entry => [entry.name, entry.stat, entry.uses])],
        ['Sealwarden recruit', 'ersveil-sets', [['Spear', 'str', 'stamina'], ['Ward-reading', 'int', 'mana'], ['Gatecraft', 'vit', 'stamina']]]);
    assert.deepEqual(contentOf([made, ok(withSets([set()]))], 'leanRpg').map(entry => entry.pack), ['ersveil-sets', 'mini'], 'pack order, then file order');
    assert.deepEqual(contentOf([made], 'leanRpg', { pack: 'other' }), []);
    found[0].name = 'changed';
    assert.equal(contentOf([made], 'leanRpg')[0].name, 'Sealwarden recruit', 'the query gives copies');
});

test('the panel counts them as skill sets', () => {
    assert.equal(countsLine({ items: 2, leanRpg: 1 }, false), '2 items, 1 skill set');
    assert.equal(countsLine({ leanRpg: 3 }, false), '3 skill sets');
});

test('a set is refused, in plain words, for anything outside the limits', () => {
    refused(pack({ content: { leanRpg: [] } }), 'BAD_CONTENT', 'content.leanRpg');
    refused(pack({ content: { leanRpg: { skillSets: [set()], extra: 1 } } }), 'UNKNOWN_FIELD', 'content.leanRpg.extra');
    refused(pack({ content: { leanRpg: { skillSets: 'no' } } }), 'BAD_CONTENT', 'content.leanRpg.skillSets');
    refused(withSets(Array.from({ length: 13 }, (_, n) => set({ name: `Set ${n}` }))), 'BAD_CONTENT', 'content.leanRpg.skillSets');
    assert.equal(ok(withSets(Array.from({ length: 12 }, (_, n) => set({ name: `Set ${n}` })))).content.leanRpg.length, 12, 'twelve is fine');
    refused(withSets([set({ name: 'x'.repeat(41) })]), 'BAD_RECORD', 'content.leanRpg.skillSets[0].name');
    refused(withSets([set({ name: '' })]), 'BAD_RECORD', 'content.leanRpg.skillSets[0].name');
    refused(withSets([set(), set()]), 'DUPLICATE', 'content.leanRpg.skillSets[1]');
    refused(withSets([set({ about: 'x'.repeat(161) })]), 'BAD_RECORD', 'content.leanRpg.skillSets[0].about');
    refused(withSets([set({ about: 5 })]), 'BAD_RECORD', 'content.leanRpg.skillSets[0].about');
    refused(withSets([set({ colour: 'red' })]), 'UNKNOWN_FIELD', 'content.leanRpg.skillSets[0].colour');
    refused(withSets([set({ skills: [] })]), 'BAD_RECORD', 'content.leanRpg.skillSets[0].skills');
    refused(withSets([set({ skills: 'many' })]), 'BAD_RECORD', 'content.leanRpg.skillSets[0].skills');
    refused(withSets([set({ skills: Array.from({ length: 6 }, (_, n) => skill({ name: `Skill ${n}` })) })]), 'BAD_RECORD', 'content.leanRpg.skillSets[0].skills');
    assert.equal(ok(withSets([set({ skills: Array.from({ length: 5 }, (_, n) => skill({ name: `Skill ${n}` })) })])).content.leanRpg[0].skills.length, 5, 'five is fine');
});

test('a skill is refused for a bad name, description, stat, resource or field, and a repeated name', () => {
    const at = field => `content.leanRpg.skillSets[0].skills[0].${field}`;
    refused(withSets([set({ skills: [skill({ name: '' })] })]), 'BAD_RECORD', at('name'));
    refused(withSets([set({ skills: [skill({ name: 'x'.repeat(41) })] })]), 'BAD_RECORD', at('name'));
    refused(withSets([set({ skills: [skill({ name: 7 })] })]), 'BAD_RECORD', at('name'));
    refused(withSets([set({ skills: [skill({ about: '' })] })]), 'BAD_RECORD', at('about'));
    refused(withSets([set({ skills: [skill({ about: 'x'.repeat(121) })] })]), 'BAD_RECORD', at('about'));
    refused(withSets([set({ skills: [skill({ stat: 'wis' })] })]), 'BAD_RECORD', at('stat'));
    refused(withSets([set({ skills: [skill({ stat: undefined })] })]), 'BAD_RECORD', at('stat'));
    refused(withSets([set({ skills: [skill({ uses: 'rage' })] })]), 'BAD_RECORD', at('uses'));
    refused(withSets([set({ skills: [skill({ rank: 2 })] })]), 'UNKNOWN_FIELD', at('rank'));
    refused(withSets([set({ skills: [skill({ practice: 50 })] })]), 'UNKNOWN_FIELD', at('practice'));
    refused(withSets([set({ skills: ['Spear'] })]), 'BAD_RECORD', 'content.leanRpg.skillSets[0].skills[0]');
    refused(withSets([set({ skills: [skill(), skill({ name: ' spear ' })] })]), 'DUPLICATE', 'content.leanRpg.skillSets[0].skills[1].name');
    // Rank and practice are never part of a set: a pack cannot hand out Expert skills.
    assert.equal(validatePack(JSON.stringify(withSets([set({ skills: [skill({ rank: 3 })] })]))).ok, false);
});
