// The `ranks` content kind: a ladder of quest ranks, lowest first ({ id, title?, levels?, reward? }),
// Validation (every field, every rejection, unique ids, the order, the cap), the packs.content query
// and the example ladder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validatePack } from '../../../src/v2/packs/validate.js';
import { contentOf } from '../../../src/v2/packs/content.js';
import { createPacksPart } from '../../../src/v2/packs/index.js';
import { CONTENT_KINDS, OPTIONAL_KINDS, RANKS_LIMITS } from '../../../src/v2/packs/limits.js';
import { fakeSettings } from './helpers/fake-settings.js';
import { pack } from './helpers/fixtures.js';

const LADDER = [
    { id: 'F', title: 'Registered', levels: [1, 10], reward: [50, 400] },
    { id: 'E', title: 'Journeyman', levels: [11, 20], reward: [800, 3000] },
    { id: 'SS' },
];
const withRanks = (ranks, extra = {}) => pack({ content: { ranks }, ...extra });

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

test('ranks is a content kind, added after the first format (only there when the pack gives it)', () => {
    assert.ok(CONTENT_KINDS.includes('ranks'));
    assert.ok(OPTIONAL_KINDS.includes('ranks'));
    assert.equal('ranks' in ok(pack()).content, false, 'an older pack normalizes as it always did');
    assert.deepEqual(ok(withRanks([])).content.ranks, []);
});

test('a ladder keeps its order, its ids as written and only the fields given, with the pack', () => {
    assert.deepEqual(ok(withRanks(LADDER)).content.ranks, [
        { id: 'F', title: 'Registered', levels: [1, 10], reward: [50, 400], pack: 'mini' },
        { id: 'E', title: 'Journeyman', levels: [11, 20], reward: [800, 3000], pack: 'mini' },
        { id: 'SS', pack: 'mini' },
    ]);
    assert.deepEqual(ok(withRanks([{ id: 'EG1', title: '  Minimal   threat ', levels: [3, 3], reward: [0, 0] }])).content.ranks[0], { id: 'EG1', title: 'Minimal threat', levels: [3, 3], reward: [0, 0], pack: 'mini' });
    assert.equal(ok(withRanks([{ id: 'A+' }, { id: 'Ⅱ' }, { id: 'x'.repeat(8) }])).content.ranks.length, 3);
    const twelve = Array.from({ length: RANKS_LIMITS.records }, (_, index) => ({ id: `R${index}` }));
    assert.equal(ok(withRanks(twelve)).content.ranks.length, 12);
});

test('every bad field is refused with its own sentence', () => {
    const one = record => withRanks([record]);
    for (const id of ['', 'TOOLONGID', 'S S', 'F|', 7, null]) refused(one({ id, title: 'x' }), 'BAD_RECORD', 'content.ranks[0].id');
    refused(one({ title: 'Registered' }), 'BAD_RECORD', 'content.ranks[0].id');
    for (const title of ['', '  ', 7, 'x'.repeat(31), 'Rank: F', 'a\nb']) refused(one({ id: 'F', title }), 'BAD_RECORD', 'content.ranks[0].title');
    for (const levels of [[1], [1, 2, 3], [0, 4], [5, 4], [1, 1.5], ['1', '2'], 3, { lo: 1, hi: 2 }, [1, 1000]]) {
        refused(one({ id: 'F', levels }), 'BAD_RECORD', 'content.ranks[0].levels');
    }
    for (const reward of [[-1, 2], [5, 4], [0.5, 1], [1], '50-400', [0, Number.MAX_SAFE_INTEGER + 1]]) {
        refused(one({ id: 'F', reward }), 'BAD_RECORD', 'content.ranks[0].reward');
    }
    refused(one({ id: 'F', name: 'Registered' }), 'UNKNOWN_FIELD', 'content.ranks[0].name');
    refused(withRanks(['F']), 'BAD_RECORD', 'content.ranks[0]');
    refused(withRanks({ F: {} }), 'BAD_CONTENT', 'content.ranks');
});

test('ids are unique ignoring case; a ladder goes lowest first; at most 12 ranks', () => {
    const twice = refused(withRanks([{ id: 'SS' }, { id: 'ss' }]), 'DUPLICATE', 'content.ranks[1].id');
    assert.match(twice.message, /unique/);
    const down = refused(withRanks([{ id: 'E', levels: [11, 20] }, { id: 'F', levels: [1, 10] }]), 'BAD_RECORD', 'content.ranks[1].levels');
    assert.match(down.message, /lowest to highest.*"E"/);
    refused(withRanks([{ id: 'E', reward: [800, 3000] }, { id: 'D' }, { id: 'F', reward: [50, 400] }]), 'BAD_RECORD', 'content.ranks[2].reward');
    // Ranges may overlap (a rank is a record, not a power), and a rank without a range is skipped over.
    ok(withRanks([{ id: 'C', levels: [26, 40] }, { id: 'B', levels: [31, 45], reward: [60000, 360000] }, { id: 'A', reward: [360000, 2000000] }, { id: 'S', levels: [46, 60] }]));
    const many = Array.from({ length: RANKS_LIMITS.records + 1 }, (_, index) => ({ id: `R${index}` }));
    assert.match(refused(withRanks(many), 'BAD_CONTENT', 'content.ranks').message, /at most 12/);
});

test('ranks go through the pack safety checks', () => {
    const codes = value => validatePack(value).errors?.map(error => error.code) ?? [];
    assert.deepEqual(codes(withRanks([{ id: 'F', title: '<script>x</script>' }])), ['UNSAFE_HTML']);
    assert.deepEqual(codes(withRanks([JSON.parse('{"id":"F","__proto__":{"title":"x"}}')])), ['UNSAFE_KEY']);
});

test('packs.content({ kind: "ranks" }) gives the ladders, each pack\'s in order, and narrows by pack', async () => {
    const { part, packs } = createPacksPart({ settings: fakeSettings() });
    for (const value of [withRanks(LADDER, { id: 'guild' }), withRanks([{ id: 'EG1' }, { id: 'EG2' }], { id: 'wild' }), pack({ id: 'plain' })]) {
        assert.equal((await packs.install(JSON.stringify(value))).ok, true);
    }
    const query = args => part.queries['packs.content']({}, args);
    assert.deepEqual(query({ kind: 'ranks' }).map(rank => `${rank.pack}:${rank.id}`), ['guild:F', 'guild:E', 'guild:SS', 'wild:EG1', 'wild:EG2']);
    assert.deepEqual(query({ kind: 'ranks', pack: 'wild' }).map(rank => rank.id), ['EG1', 'EG2']);
    query({ kind: 'ranks' })[0].levels[0] = 99;
    assert.equal(query({ kind: 'ranks' })[0].levels[0], 1, 'copies');
    assert.deepEqual(packs.list().map(entry => entry.counts.ranks), [3, 2, undefined]);
});

