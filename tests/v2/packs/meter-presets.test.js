// The `meterPresets` content kind: ready-made NPC meter sets for NPC State Delta (MODULES §F81, §F90),
// `{ id, title, meters: [{ id, name, min, max, start, describe?, bands?, drift? }], stages?: [{ id, name,
// needs: [{ meter, at }], milestone? }] }`. Validation of every field and rejection, the caps, the query.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePack } from '../../../src/v2/packs/validate.js';
import { contentOf } from '../../../src/v2/packs/content.js';
import { CONTENT_KINDS, METER_LIMITS, METER_RESERVED, OPTIONAL_KINDS } from '../../../src/v2/packs/limits.js';
import { pack } from './helpers/fixtures.js';

const meter = (extra = {}) => ({ id: 'regard', name: 'Regard', min: -100, max: 100, start: 0, ...extra });
const preset = (extra = {}) => ({ id: 'frontier', title: 'Frontier Regard', meters: [meter()], ...extra });
const withPresets = list => pack({ content: { meterPresets: list } });
const one = extra => withPresets([preset(extra)]);
const withMeter = extra => one({ meters: [meter(extra)] });

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

test('meterPresets is a content kind added after the first format', () => {
    assert.ok(CONTENT_KINDS.includes('meterPresets') && OPTIONAL_KINDS.includes('meterPresets'));
    assert.equal('meterPresets' in ok(pack()).content, false, 'an older pack normalizes as it always did');
    assert.deepEqual(ok(withPresets([])).content.meterPresets, []);
});

test('a preset keeps its meters, bands, drift and stages, with the pack', () => {
    const made = ok(withPresets([{
        id: 'frontier', title: ' Frontier   Regard ',
        meters: [
            meter({ start: -20, describe: '  How far a local trusts an outsider. ', bands: [{ at: -100, word: 'hostile' }, { at: -10, word: 'guarded' }, { at: 50, word: ' trusting ' }] }),
            { id: 'owed', name: 'Owed', min: 0, max: 100, start: 0, drift: { toward: 0, perDay: 1 } },
        ],
        stages: [
            { id: 'marked', name: 'Marked', needs: [{ meter: 'regard', at: -60 }], milestone: ' They name you to the Watch. ' },
            { id: 'vouched', name: 'Vouched for', needs: [{ meter: 'regard', at: 50 }, { meter: 'owed', at: 20 }] },
        ],
    }]));
    assert.deepEqual(made.content.meterPresets, [{
        title: 'Frontier Regard',
        meters: [
            { id: 'regard', name: 'Regard', min: -100, max: 100, start: -20, describe: 'How far a local trusts an outsider.', bands: [{ at: -100, word: 'hostile' }, { at: -10, word: 'guarded' }, { at: 50, word: 'trusting' }] },
            { id: 'owed', name: 'Owed', min: 0, max: 100, start: 0, drift: { toward: 0, perDay: 1 } },
        ],
        stages: [
            { id: 'marked', name: 'Marked', needs: [{ meter: 'regard', at: -60 }], milestone: 'They name you to the Watch.' },
            { id: 'vouched', name: 'Vouched for', needs: [{ meter: 'regard', at: 50 }, { meter: 'owed', at: 20 }] },
        ],
        id: 'pack.mini/frontier', slug: 'frontier', pack: 'mini',
    }]);
    assert.equal('stages' in ok(one({})).content.meterPresets[0], false, 'stages only when given');
    assert.deepEqual(ok(withPresets(Array.from({ length: METER_LIMITS.presets }, (_, index) => preset({ id: `p-${index}` })))).content.meterPresets.length, 4);
    const six = Array.from({ length: METER_LIMITS.meters }, (_, index) => meter({ id: `m-${index}` }));
    assert.equal(ok(one({ meters: six })).content.meterPresets[0].meters.length, 6);
    assert.equal(ok(withMeter({ min: -1000, max: 1000, start: 1000 })).content.meterPresets[0].meters[0].max, 1000, 'NPC State Delta\'s widest custom range');
    assert.deepEqual(contentOf([made], 'meterPresets').map(entry => entry.id), ['pack.mini/frontier']);
});

test('the list and every preset field are checked', () => {
    refused(withPresets({}), 'BAD_CONTENT', 'content.meterPresets');
    refused(withPresets(Array.from({ length: 5 }, (_, index) => preset({ id: `p-${index}` }))), 'BAD_CONTENT', 'content.meterPresets');
    refused(withPresets(['frontier']), 'BAD_RECORD', 'content.meterPresets[0]');
    for (const id of [undefined, '', 'Frontier', 7]) refused(one({ id }), 'BAD_RECORD', 'content.meterPresets[0].id');
    refused(withPresets([preset(), preset()]), 'DUPLICATE', 'content.meterPresets[1]');
    for (const title of [undefined, '', '  ', 7, 'x'.repeat(41), 'Regard: frontier', 'a\nb']) refused(one({ title }), 'BAD_RECORD', 'content.meterPresets[0].title');
    refused(one({ note: 'x' }), 'UNKNOWN_FIELD', 'content.meterPresets[0].note');
    for (const meters of [undefined, [], 'regard', Array.from({ length: 7 }, (_, index) => meter({ id: `m-${index}` }))]) refused(one({ meters }), 'BAD_RECORD', 'content.meterPresets[0].meters');
});

test('every meter field is checked', () => {
    const at = field => `content.meterPresets[0].meters[0]${field}`;
    refused(one({ meters: ['regard'] }), 'BAD_RECORD', at(''));
    for (const id of [undefined, '', 'Regard', 'x'.repeat(41), 7]) refused(withMeter({ id }), 'BAD_RECORD', at('.id'));
    for (const id of METER_RESERVED) refused(withMeter({ id }), 'BAD_RECORD', at('.id'));
    refused(one({ meters: [meter(), meter()] }), 'DUPLICATE', 'content.meterPresets[0].meters[1].id');
    for (const name of [undefined, '', 7, 'x'.repeat(41), 'Regard | 5', 'a:b']) refused(withMeter({ name }), 'BAD_RECORD', at('.name'));
    for (const range of [{ min: 0, max: 0 }, { min: 10, max: 0 }, { min: -1001 }, { max: 1001 }, { min: 0.5 }, { max: '100' }, { min: undefined }]) refused(withMeter(range), 'BAD_RECORD', at('.min'));
    for (const start of [undefined, -101, 101, 0.5, '0']) refused(withMeter({ start }), 'BAD_RECORD', at('.start'));
    for (const describe of [7, 'x'.repeat(201)]) refused(withMeter({ describe }), 'BAD_RECORD', at('.describe'));
    refused(withMeter({ colour: 'red' }), 'UNKNOWN_FIELD', at('.colour'));
});

test('bands go lowest first inside the range, with short words', () => {
    const at = field => `content.meterPresets[0].meters[0].bands${field}`;
    for (const bands of [[], 'low', Array.from({ length: 9 }, (_, index) => ({ at: index, word: `w${index}` }))]) refused(withMeter({ bands }), 'BAD_RECORD', at(''));
    refused(withMeter({ bands: [5] }), 'BAD_RECORD', at('[0]'));
    refused(withMeter({ bands: [{ at: 0, word: 'even', colour: 'red' }] }), 'BAD_RECORD', at('[0]'));
    for (const value of [-101, 101, 0.5, '0', undefined]) refused(withMeter({ bands: [{ at: value, word: 'even' }] }), 'BAD_RECORD', at('[0].at'));
    refused(withMeter({ bands: [{ at: 10, word: 'civil' }, { at: 10, word: 'warm' }] }), 'BAD_RECORD', at('[1].at'));
    refused(withMeter({ bands: [{ at: 10, word: 'civil' }, { at: -10, word: 'cold' }] }), 'BAD_RECORD', at('[1].at'));
    for (const word of [undefined, '', 'x'.repeat(25), 'a|b', 7]) refused(withMeter({ bands: [{ at: 0, word }] }), 'BAD_RECORD', at('[0].word'));
});

test('drift pulls toward a value inside the range by a whole amount a day', () => {
    const at = 'content.meterPresets[0].meters[0].drift';
    for (const drift of ['down', { toward: 0 }, { perDay: 1 }, { toward: 101, perDay: 1 }, { toward: 0, perDay: 0 }, { toward: 0, perDay: 1.5 }, { toward: 0, perDay: 201 }, { toward: 0, perDay: 1, every: 2 }]) {
        refused(withMeter({ drift }), 'BAD_RECORD', at);
    }
    assert.deepEqual(ok(withMeter({ drift: { toward: -100, perDay: 200 } })).content.meterPresets[0].meters[0].drift, { toward: -100, perDay: 200 });
});

test('stages name meters of the preset, at values inside their ranges', () => {
    const at = field => `content.meterPresets[0].stages${field}`;
    const stage = (extra = {}) => ({ id: 'trusted', name: 'Trusted', needs: [{ meter: 'regard', at: 50 }], ...extra });
    const withStages = stages => one({ stages });
    for (const stages of ['trusted', Array.from({ length: 9 }, (_, index) => stage({ id: `s-${index}` }))]) refused(withStages(stages), 'BAD_RECORD', at(''));
    assert.equal(ok(withStages(Array.from({ length: 8 }, (_, index) => stage({ id: `s-${index}` })))).content.meterPresets[0].stages.length, 8);
    refused(withStages(['trusted']), 'BAD_RECORD', at('[0]'));
    for (const id of [undefined, '', 'Trusted', 7]) refused(withStages([stage({ id })]), 'BAD_RECORD', at('[0].id'));
    refused(withStages([stage(), stage()]), 'DUPLICATE', at('[1].id'));
    for (const name of [undefined, '', 'x'.repeat(41), 'Stage: one']) refused(withStages([stage({ name })]), 'BAD_RECORD', at('[0].name'));
    for (const needs of [undefined, [], { meter: 'regard', at: 1 }, Array.from({ length: 5 }, () => ({ meter: 'regard', at: 1 }))]) refused(withStages([stage({ needs })]), 'BAD_RECORD', at('[0].needs'));
    refused(withStages([stage({ needs: [{ meter: 'regard', at: 1, or: 2 }] })]), 'BAD_RECORD', at('[0].needs[0]'));
    refused(withStages([stage({ needs: [{ meter: 'trust', at: 1 }] })]), 'UNKNOWN_REF', at('[0].needs[0].meter'));
    refused(withStages([stage({ needs: [{ meter: 'regard', at: 1 }, { meter: 'regard', at: 5 }] })]), 'DUPLICATE', at('[0].needs[1].meter'));
    for (const value of [101, -101, 0.5, '50', undefined]) refused(withStages([stage({ needs: [{ meter: 'regard', at: value }] })]), 'BAD_RECORD', at('[0].needs[0].at'));
    for (const milestone of ['', '  ', 7, 'x'.repeat(201)]) refused(withStages([stage({ milestone })]), 'BAD_RECORD', at('[0].milestone'));
    refused(withStages([stage({ hidden: true })]), 'UNKNOWN_FIELD', at('[0].hidden'));
});
