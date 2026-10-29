// The `terms` content kind (MODULES §F25): the words a world uses for levels and XP, suggested by a
// pack the way it suggests a currency. Validation (every field, every rejection, the record cap,
// the safety walls), the packs.content query, and lorebook packs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { validatePack } from '../../../src/v2/packs/validate.js';
import { contentOf } from '../../../src/v2/packs/content.js';
import { createPacksPart } from '../../../src/v2/packs/index.js';
import { createInstalled } from '../../../src/v2/packs/installed.js';
import { CONTENT_KINDS, OPTIONAL_KINDS, TERMS_LIMITS } from '../../../src/v2/packs/limits.js';
import { fakeSettings } from './helpers/fake-settings.js';
import { pack, sampleText } from './helpers/fixtures.js';

const SOUL = { levelName: 'Soul Class', xpName: 'Soul Growth', tiers: { size: 10, numerals: 'roman' } };
const withTerms = (terms, extra = {}) => pack({ content: { terms }, ...extra });

function ok(value) {
    const result = validatePack(value);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    return result.pack;
}

function refused(value, code, path) {
    const result = validatePack(value);
    assert.equal(result.ok, false, `${path} should be refused`);
    const hit = result.errors.find(error => error.path === path);
    assert.ok(hit, `no error at ${path}: ${JSON.stringify(result.errors)}`);
    assert.equal(hit.code, code, hit.message);
    assert.ok(hit.message.length > 20, 'a sentence the reader can act on');
    return hit;
}

test('terms is a content kind, added after the first format (only there when the pack gives it)', () => {
    assert.ok(CONTENT_KINDS.includes('terms'));
    assert.ok(OPTIONAL_KINDS.includes('terms'));
    assert.equal('terms' in ok(pack()).content, false, 'an older pack normalizes as it always did');
    assert.deepEqual(ok(withTerms([])).content.terms, []);
});

test('a terms record normalizes with its id, slug and pack, and only the fields it gives', () => {
    const [record] = ok(withTerms([SOUL])).content.terms;
    assert.deepEqual(record, { ...SOUL, id: 'pack.mini/terms', slug: 'terms', pack: 'mini' });
    assert.deepEqual(ok(withTerms([{ xpName: '  Power   Growth ' }])).content.terms[0], { xpName: 'Power Growth', id: 'pack.mini/terms', slug: 'terms', pack: 'mini' });
    assert.equal(ok(withTerms([{ tiers: true }])).content.terms[0].tiers, true, 'tiers: true is kept');
    assert.deepEqual(ok(withTerms([{ tiers: {} }])).content.terms[0].tiers, {});
    assert.deepEqual(ok(withTerms([{ tiers: { enabled: false } }])).content.terms[0].tiers, { enabled: false });
    assert.deepEqual(ok(withTerms([{ levelName: 'Circle', tiers: { numerals: 'arabic', size: 1 } }])).content.terms[0].tiers, { numerals: 'arabic', size: 1 });
    assert.equal(ok(withTerms([{ levelName: 'x'.repeat(TERMS_LIMITS.term) }])).content.terms[0].levelName.length, 30);
});

test('a record keeps its id and name; slugs come from the id, the name, or terms, terms-2 …', () => {
    const terms = ok(withTerms([{ id: 'guild', name: 'Guild Rank', levelName: 'Rank' }, { name: 'Soul Class', ...SOUL }, { xpName: 'Renown' }, { levelName: 'Tier' }])).content.terms;
    assert.deepEqual(terms.map(record => [record.id, record.slug, record.name]), [
        ['pack.mini/guild', 'guild', 'Guild Rank'], ['pack.mini/soul-class', 'soul-class', 'Soul Class'], ['pack.mini/terms', 'terms', undefined], ['pack.mini/terms-2', 'terms-2', undefined],
    ]);
    refused(withTerms([{ id: 'Soul Class', levelName: 'x' }]), 'BAD_RECORD', 'content.terms[0].id');
    refused(withTerms([{ id: 'a', levelName: 'x' }, { id: 'a', xpName: 'y' }]), 'DUPLICATE', 'content.terms[1]');
    refused(withTerms([{ name: '', levelName: 'x' }]), 'BAD_RECORD', 'content.terms[0].name');
    refused(withTerms([{ name: 7, levelName: 'x' }]), 'BAD_RECORD', 'content.terms[0].name');
    refused(withTerms([{ name: 'n'.repeat(81), levelName: 'x' }]), 'BAD_RECORD', 'content.terms[0].name');
});

test('every bad field is refused with its own sentence', () => {
    const one = record => withTerms([record]);
    for (const value of ['', '   ', 7, null, 'x'.repeat(31), ['Rank']]) {
        refused(one({ levelName: value }), 'BAD_RECORD', 'content.terms[0].levelName');
        refused(one({ xpName: value }), 'BAD_RECORD', 'content.terms[0].xpName');
    }
    // Term labels contain no field separators or line breaks.
    for (const value of ['Soul|Class', 'Soul: Class', '#1', 'Rank\nTwo', 'a > b']) refused(one({ levelName: value }), 'BAD_RECORD', 'content.terms[0].levelName');
    const hit = refused(one({ xpName: 'Growth:' }), 'BAD_RECORD', 'content.terms[0].xpName');
    assert.match(hit.message, /\| : # < >/);
    for (const value of [false, 'yes', 10, ['roman'], null]) refused(one({ tiers: value }), 'BAD_RECORD', 'content.terms[0].tiers');
    for (const value of [0, -1, 1.5, '10', 1000]) refused(one({ tiers: { size: value } }), 'BAD_RECORD', 'content.terms[0].tiers.size');
    for (const value of ['Roman', 'greek', 1]) refused(one({ tiers: { numerals: value } }), 'BAD_RECORD', 'content.terms[0].tiers.numerals');
    for (const value of [true, 'false', 0]) refused(one({ tiers: { enabled: value } }), 'BAD_RECORD', 'content.terms[0].tiers.enabled');
    refused(one({ tiers: { size: 10, titles: ['Novice'] } }), 'UNKNOWN_FIELD', 'content.terms[0].tiers.titles');
    refused(one({ ...SOUL, cap: 99 }), 'UNKNOWN_FIELD', 'content.terms[0].cap');
    refused(one({ level: 'Soul Class' }), 'UNKNOWN_FIELD', 'content.terms[0].level');
    const empty = refused(one({}), 'BAD_RECORD', 'content.terms[0]');
    assert.match(empty.message, /levelName, xpName or tiers/);
    refused(one({ id: 'only-an-id', name: 'Nothing' }), 'BAD_RECORD', 'content.terms[0]');
    refused(withTerms(['Soul Class']), 'BAD_RECORD', 'content.terms[0]');
    refused(withTerms({ levelName: 'Soul Class' }), 'BAD_CONTENT', 'content.terms');
});

test('a pack holds at most a few terms records', () => {
    const records = Array.from({ length: TERMS_LIMITS.records }, (_, index) => ({ id: `t${index}`, levelName: `Rank ${index}` }));
    assert.equal(ok(withTerms(records)).content.terms.length, TERMS_LIMITS.records);
    const hit = refused(withTerms([...records, { id: 'one-more', xpName: 'Renown' }]), 'BAD_CONTENT', 'content.terms');
    assert.match(hit.message, /at most 4/);
});

test('terms go through the pack safety checks: no markup, scripts or reserved keys', () => {
    const codes = value => validatePack(value).errors?.map(error => error.code) ?? [];
    assert.deepEqual(codes(withTerms([{ levelName: '<script>x</script>' }])), ['UNSAFE_HTML']);
    assert.deepEqual(codes(withTerms([{ xpName: '<img src=x onerror=alert(1)>' }])), ['UNSAFE_HTML']);
    assert.deepEqual(codes(withTerms([{ name: 'javascript:alert(1)', levelName: 'Rank' }])), ['UNSAFE_HTML']);
    const proto = JSON.parse('{"levelName":"Rank","tiers":{"__proto__":{"size":3}}}');
    assert.deepEqual(codes(withTerms([proto])), ['UNSAFE_KEY']);
});

test('packs.content({ kind: "terms" }) gives every enabled pack\'s records, in pack order, and narrows by pack', async () => {
    const settings = fakeSettings();
    const { part, packs } = createPacksPart({ settings });
    for (const value of [withTerms([SOUL], { id: 'ersveil' }), withTerms([{ levelName: 'Circle' }], { id: 'other' }), pack({ id: 'plain' })]) {
        assert.equal((await packs.install(JSON.stringify(value))).ok, true);
    }
    const query = (args) => part.queries['packs.content']({}, args);
    assert.deepEqual(query({ kind: 'terms' }).map(record => [record.pack, record.levelName]), [['ersveil', 'Soul Class'], ['other', 'Circle']]);
    assert.deepEqual(query({ kind: 'terms', pack: 'other' }).map(record => record.id), ['pack.other/terms']);
    assert.deepEqual(query({ kind: 'terms', pack: 'plain' }), []);
    // Copies: a caller changing what it got does not change the pack.
    query({ kind: 'terms' })[0].tiers.size = 1;
    assert.equal(query({ kind: 'terms' })[0].tiers.size, 10);
    await packs.setEnabled('ersveil', false);
    assert.deepEqual(query({ kind: 'terms' }).map(record => record.pack), ['other']);
    assert.deepEqual(packs.list().map(entry => entry.counts.terms), [1, 1, undefined]);
    assert.deepEqual(contentOf([], 'terms'), []);
});

test('a pack carried in a lorebook brings its terms too', async () => {
    const settings = fakeSettings();
    const installed = createInstalled({ settings });
    const value = JSON.parse(sampleText);
    value.content.terms = [SOUL];
    const { results } = await installed.importLorebook([{ book: 'Mara lore', uid: 2, title: 'Riverside [storysuite:pack]', content: '```json\n' + JSON.stringify(value) + '\n```' }]);
    assert.equal(results[0].ok, true, JSON.stringify(results[0].errors));
    assert.deepEqual(contentOf(installed.packs(), 'terms').map(record => [record.pack, record.levelName, record.xpName]), [['riverside-starter', 'Soul Class', 'Soul Growth']]);
});
