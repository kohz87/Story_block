// The `cast` content kind (cast.js): the pack's hand-written people. Every field and refusal, the caps, the query
// `packs.content({ kind: 'cast' })` with `pack` and `packVersion`, and a hostile value.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePack } from '../../../src/v2/packs/validate.js';
import { contentOf } from '../../../src/v2/packs/content.js';
import { CAST_BEHAVIOUR_LEVERS, CAST_FIELDS, CAST_LIMITS, CONTENT_KINDS, OPTIONAL_KINDS, PORTRAIT_LIMITS } from '../../../src/v2/packs/limits.js';
import { createPacksPart } from '../../../src/v2/packs/index.js';
import { fakeSettings } from './helpers/fake-settings.js';
import { pack } from './helpers/fixtures.js';

const person = (extra = {}) => ({
    id: 'fenna', name: 'Fenna', about: 'Runs the night ferry.', look: 'Wiry, tar-stained coat.',
    start: { place: 'Bluewatch docks', goal: 'Keep the ferry running.' }, ...extra,
});
const withCast = list => pack({ content: { cast: list } });
const one = extra => withCast([person(extra)]);

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
}

test('cast is a content kind, optional: a pack without it has no cast key', () => {
    assert.ok(CONTENT_KINDS.includes('cast') && OPTIONAL_KINDS.includes('cast'));
    assert.equal('cast' in ok(pack()).content, false);
});

test('a minimal person is kept with its own slug as id, the pack id, and nothing it did not give', () => {
    const [fenna] = ok(withCast([person()])).content.cast;
    assert.deepEqual(fenna, {
        id: 'fenna', name: 'Fenna', aliases: [], about: 'Runs the night ferry.', look: 'Wiry, tar-stained coat.',
        start: { place: 'Bluewatch docks', goal: 'Keep the ferry running.' }, pack: 'mini',
    });
});

test('a full person: aliases, voice, personality, history, portrait, routine, drawnTo, meters, stages, fields, secrets, canDieUnmet', () => {
    const full = person({
        aliases: ['the ferrywoman', 'the ferrywoman', 'FENNA'], voice: 'Dry.', personality: 'Patient.', history: 'Widowed by the weir.', portrait: 'fenna.webp',
        start: { place: 'Bluewatch docks', goal: 'Find who opened the weir.', routine: 'Night ferry.' }, drawnTo: ['the weir', 'the weir', 'a flood'],
        meters: { preset: 'companion', trust: 10, regard: -5 },
        stages: [{ id: 'regular', name: 'Regular', needs: [{ meter: 'trust', at: 20 }], milestone: 'rode the ferry twice' }],
        fields: { Trade: 'Night ferry', Age: 38 },
        secrets: [{ title: 'Debt', text: 'She owes the smugglers.', meter: 'trust', at: 20 }, { title: 'Suspect', text: 'She has a name.', when: 'the party learns who opened the weir' }],
        canDieUnmet: true,
    });
    const [fenna] = ok(withCast([full])).content.cast;
    assert.deepEqual(fenna.aliases, ['the ferrywoman'], 'repeats and the name itself are dropped');
    assert.deepEqual(fenna.drawnTo, ['the weir', 'a flood']);
    assert.deepEqual(fenna.meters, { preset: 'companion', trust: 10, regard: -5 });
    assert.deepEqual(fenna.fields, { Trade: 'Night ferry', Age: '38' });
    assert.deepEqual(fenna.secrets, [{ title: 'Debt', text: 'She owes the smugglers.', meter: 'trust', at: 20 }, { title: 'Suspect', text: 'She has a name.', when: 'the party learns who opened the weir' }]);
    assert.equal(fenna.canDieUnmet, true);
    assert.equal(fenna.portrait, 'fenna.webp');
    assert.equal(fenna.start.routine, 'Night ferry.');
    assert.equal(fenna.stages[0].milestone, 'rode the ferry twice');
});

test('text is one plain line: line breaks become spaces, markup and braces are refused, | is refused in the short lines', () => {
    assert.equal(ok(one({ look: 'Tall,\n  thin.' })).content.cast[0].look, 'Tall, thin.');
    refused(one({ look: 'A <b>tall</b> woman' }), 'BAD_RECORD', 'content.cast[0].look');
    refused(one({ history: 'She said {{user}}' }), 'BAD_RECORD', 'content.cast[0].history');
    refused(one({ name: 'Fenna | Ferry' }), 'BAD_RECORD', 'content.cast[0].name');
    refused(one({ start: { place: 'Docks', goal: 'a | b' } }), 'BAD_RECORD', 'content.cast[0].start.goal');
    // the walls every pack has still apply first
    const hostile = validatePack(JSON.stringify(one({ about: '<script>alert(1)</script>' })));
    assert.equal(hostile.ok, false);
});

test('required fields, unknown fields, ids and names', () => {
    for (const field of ['id', 'name', 'about', 'look', 'start']) {
        const value = person();
        delete value[field];
        const result = validatePack(JSON.stringify(withCast([value])));
        assert.equal(result.ok, false, field);
    }
    refused(one({ nickname: 'x' }), 'UNKNOWN_FIELD', 'content.cast[0].nickname');
    refused(one({ id: 'Fenna!' }), 'BAD_RECORD', 'content.cast[0].id');
    refused(withCast([person(), person({ name: 'Other' })]), 'DUPLICATE', 'content.cast[1].id');
    refused(withCast([person(), person({ id: 'f2', aliases: ['fenna'] })]), 'DUPLICATE', 'content.cast[1].name');
    refused(one({ start: { place: 'Docks' } }), 'BAD_RECORD', 'content.cast[0].start.goal');
    refused(one({ start: { place: 'Docks', goal: 'x', home: 'y' } }), 'UNKNOWN_FIELD', 'content.cast[0].start.home');
    refused(one({ name: 'N'.repeat(CAST_LIMITS.name + 1) }), 'BAD_RECORD', 'content.cast[0].name');
    refused(pack({ content: { cast: { id: 'x' } } }), 'BAD_CONTENT', 'content.cast');
    refused(withCast([5]), 'BAD_RECORD', 'content.cast[0]');
});

test('the caps: people per pack, text lengths, aliases, drawnTo, fields, secrets', () => {
    const many = Array.from({ length: CAST_LIMITS.entries + 1 }, (_, n) => person({ id: `p${n}`, name: `Person ${n}` }));
    refused(withCast(many), 'BAD_CONTENT', 'content.cast');
    refused(one({ about: 'a'.repeat(CAST_LIMITS.about + 1) }), 'BAD_RECORD', 'content.cast[0].about');
    refused(one({ look: 'a'.repeat(CAST_LIMITS.look + 1) }), 'BAD_RECORD', 'content.cast[0].look');
    refused(one({ history: 'a'.repeat(CAST_LIMITS.history + 1) }), 'BAD_RECORD', 'content.cast[0].history');
    refused(one({ aliases: Array.from({ length: CAST_LIMITS.aliases + 1 }, (_, n) => `A${n}`) }), 'BAD_RECORD', 'content.cast[0].aliases');
    refused(one({ drawnTo: Array.from({ length: CAST_LIMITS.drawnTo + 1 }, (_, n) => `phrase ${n}`) }), 'BAD_RECORD', 'content.cast[0].drawnTo');
    refused(one({ drawnTo: ['x'.repeat(CAST_LIMITS.phrase + 1)] }), 'BAD_RECORD', 'content.cast[0].drawnTo[0]');
    refused(one({ fields: Object.fromEntries(Array.from({ length: CAST_LIMITS.fields + 1 }, (_, n) => [`F${n}`, 'x'])) }), 'BAD_RECORD', 'content.cast[0].fields');
    refused(one({ fields: { 'Bad:name': 'x' } }), 'BAD_RECORD', 'content.cast[0].fields.Bad:name');
    const secret = n => ({ title: `S${n}`, text: `Text ${n}`, meter: 'trust', at: n });
    ok(one({ secrets: Array.from({ length: CAST_LIMITS.secrets }, (_, n) => secret(n + 1)) }));
    refused(one({ secrets: Array.from({ length: CAST_LIMITS.secrets + 1 }, (_, n) => secret(n + 1)) }), 'BAD_RECORD', 'content.cast[0].secrets');
});

test('meters and stages: whole numbers in range, known meters, no reserved words', () => {
    refused(one({ meters: { trust: 1.5 } }), 'BAD_RECORD', 'content.cast[0].meters.trust');
    refused(one({ meters: { trust: 5000 } }), 'BAD_RECORD', 'content.cast[0].meters.trust');
    refused(one({ meters: { stage: 5 } }), 'BAD_RECORD', 'content.cast[0].meters.stage');
    refused(one({ meters: { preset: 'Not A Slug' } }), 'BAD_RECORD', 'content.cast[0].meters.preset');
    refused(one({ stages: [{ id: 'a', name: 'A', needs: [{ meter: 'devotion', at: 10 }] }] }), 'UNKNOWN_REF', 'content.cast[0].stages[0].needs[0].meter');
    ok(one({ meters: { preset: 'my-own' }, stages: [{ id: 'a', name: 'A', needs: [{ meter: 'devotion', at: 10 }] }] }));
    ok(one({ meters: { devotion: 20 }, stages: [{ id: 'a', name: 'A', needs: [{ meter: 'devotion', at: 10 }] }] }));
    refused(one({ stages: [{ id: 'a', name: 'A', needs: [{ meter: 'trust', at: 10 }] }, { id: 'a', name: 'B', needs: [{ meter: 'trust', at: 20 }] }] }), 'DUPLICATE', 'content.cast[0].stages[1].id');
});

test('NPC State Delta\'s built-in presets and their meters need no definition in the pack', () => {
    for (const preset of ['companion', 'rival', 'mentor']) ok(one({ meters: { preset, trust: 10 } }));
    const stages = [{ id: 'sworn', name: 'Sworn companion', needs: [{ meter: 'trust', at: 60 }, { meter: 'loyalty', at: 75 }], milestone: 'stood by you in danger' }];
    ok(one({ meters: { preset: 'companion', trust: 10, loyalty: 20 }, stages, secrets: [{ title: 'T', text: 'Body', meter: 'loyalty', at: 40 }] }));
    // without a preset the built-in preset meters are still known by name
    for (const meter of ['loyalty', 'respect', 'rivalry', 'approval', 'tension']) ok(one({ secrets: [{ title: 'T', text: 'Body', meter, at: 10 }] }));
    refused(one({ secrets: [{ title: 'T', text: 'Body', meter: 'devotion', at: 10 }] }), 'UNKNOWN_REF', 'content.cast[0].secrets[0].meter');
});

test('a secret opens by a meter and a value, by a story event, or by both (whichever first); never neither', () => {
    const secret = extra => one({ secrets: [{ title: 'T', text: 'Body', ...extra }] });
    ok(secret({ meter: 'affection', at: -20 }));
    ok(secret({ when: 'she is asked about the weir' }));
    // both rules: kept together, in full
    const both = ok(secret({ meter: 'trust', at: 90, when: 'she is asked about the weir' }));
    assert.deepEqual(contentOf([both], 'cast')[0].secrets, [{ title: 'T', text: 'Body', meter: 'trust', at: 90, when: 'she is asked about the weir' }]);
    refused(secret({ meter: 'trust', at: 10, when: 'w'.repeat(CAST_LIMITS.secretWhen + 1) }), 'BAD_RECORD', 'content.cast[0].secrets[0].when');
    refused(secret({ meter: 'trust', at: 10, when: '' }), 'BAD_RECORD', 'content.cast[0].secrets[0].when');
    refused(secret({ meter: 'trust', when: 'x' }), 'BAD_RECORD', 'content.cast[0].secrets[0].at');
    refused(secret({ meter: 'devotion', at: 5, when: 'x' }), 'UNKNOWN_REF', 'content.cast[0].secrets[0].meter');
    refused(secret({ meter: 'trust', at: 10, when: 'a <b> tag' }), 'BAD_RECORD', 'content.cast[0].secrets[0].when');
    refused(secret({}), 'BAD_RECORD', 'content.cast[0].secrets[0]');
    refused(secret({ meter: 'trust' }), 'BAD_RECORD', 'content.cast[0].secrets[0].at');
    refused(secret({ meter: 'devotion', at: 5 }), 'UNKNOWN_REF', 'content.cast[0].secrets[0].meter');
    refused(secret({ when: 'w'.repeat(CAST_LIMITS.secretWhen + 1) }), 'BAD_RECORD', 'content.cast[0].secrets[0].when');
    refused(one({ secrets: [{ text: 'no title', meter: 'trust', at: 1 }] }), 'BAD_RECORD', 'content.cast[0].secrets[0].title');
});

test('portrait names: a file name beside the pack; at most 32 different files', () => {
    for (const name of ['fenna.webp', 'a_b-c.PNG', 'x.jpg', 'x.jpeg']) ok(one({ portrait: name }));
    for (const name of ['../fenna.webp', 'dir/fenna.webp', 'fenna.gif', 'fenna', '.webp', 'fenna.svg', 'a b.png']) refused(one({ portrait: name }), 'BAD_RECORD', 'content.cast[0].portrait');
    const people = n => Array.from({ length: n }, (_, k) => person({ id: `p${k}`, name: `Person ${k}`, portrait: `p${k}.webp` }));
    ok(withCast(people(PORTRAIT_LIMITS.perPack)));
    refused(withCast(people(PORTRAIT_LIMITS.perPack + 1)), 'BAD_CONTENT', 'content.cast');
    const shared = Array.from({ length: 40 }, (_, k) => person({ id: `p${k}`, name: `Person ${k}`, portrait: 'same.webp' }));
    ok(withCast(shared));
});

test('packs.content({ kind: cast }): the enabled packs\' people in pack order, each with pack and packVersion; a copy', () => {
    const a = ok(withCast([person()]));
    const b = ok({ ...withCast([person({ id: 'sera', name: 'Sera' })]), id: 'other', version: '2.1.0' });
    const list = contentOf([a, b], 'cast');
    assert.deepEqual(list.map(entry => [entry.pack, entry.packVersion, entry.id]), [['mini', '1.0.0', 'fenna'], ['other', '2.1.0', 'sera']]);
    assert.deepEqual(contentOf([a, b], 'cast', { pack: 'other' }).map(entry => entry.id), ['sera']);
    list[0].name = 'changed';
    assert.equal(contentOf([a, b], 'cast')[0].name, 'Fenna');
    assert.deepEqual(contentOf([ok(pack())], 'cast'), []);
});

test('the part answers packs.content for cast over installed packs, and the list counts them', async () => {
    const { part, packs } = createPacksPart({ settings: fakeSettings() });
    assert.equal((await packs.install(withCast([person(), person({ id: 'sera', name: 'Sera' })]))).ok, true);
    const list = part.queries['packs.content']({}, { kind: 'cast' });
    assert.deepEqual(list.map(entry => entry.id), ['fenna', 'sera']);
    assert.equal(list[0].packVersion, '1.0.0');
    assert.equal(packs.list()[0].counts.cast, 2);
    await packs.setEnabled('mini', false);
    assert.deepEqual(part.queries['packs.content']({}, { kind: 'cast' }), []);
});

test('wears is optional text, kept after look only when given, and has its own limit', () => {
    assert.equal(CAST_LIMITS.wears, 300);
    assert.equal('wears' in ok(withCast([person()])).content.cast[0], false, 'left out when not given');
    const [fenna] = ok(one({ wears: 'A tar-stained\n  coat, a   boat hook.' })).content.cast;
    assert.equal(fenna.wears, 'A tar-stained coat, a boat hook.', 'one plain line, like look');
    assert.deepEqual(Object.keys(fenna).slice(0, 6), ['id', 'name', 'aliases', 'about', 'look', 'wears']);
    ok(one({ wears: 'a'.repeat(CAST_LIMITS.wears) }));
    refused(one({ wears: 'a'.repeat(CAST_LIMITS.wears + 1) }), 'BAD_RECORD', 'content.cast[0].wears');
    refused(one({ wears: 'A <b>coat</b>' }), 'BAD_RECORD', 'content.cast[0].wears');
    refused(one({ wears: '{{user}}' }), 'BAD_RECORD', 'content.cast[0].wears');
    for (const wears of [5, true, ['a coat'], { coat: 1 }, '', '   ', null]) refused(one({ wears }), 'BAD_RECORD', 'content.cast[0].wears');
    // Unknown fields are still refused, and the message now lists wears among the cast fields.
    refused(one({ outfit: 'x' }), 'UNKNOWN_FIELD', 'content.cast[0].outfit');
    const message = validatePack(JSON.stringify(one({ outfit: 'x' }))).errors.find(error => error.path === 'content.cast[0].outfit').message;
    assert.match(message, /look, wears, voice/);
});

test('behaviour: up to 6 "Lever: level - effect" lines, the lever and level words checked, a lever once, written back in one form', () => {
    assert.deepEqual([CAST_LIMITS.behaviour, CAST_LIMITS.behaviourEffect], [6, 120]);
    assert.equal('behaviour' in ok(withCast([person()])).content.cast[0], false, 'absent when not given');
    assert.equal('behaviour' in ok(one({ behaviour: [] })).content.cast[0], false, 'absent when empty');
    const [fenna] = ok(one({ behaviour: ['mercy: LOW -  stitches\n slowly', 'CARE : High – protective of the dead', 'Loyalty: medium - stays'] })).content.cast;
    assert.deepEqual(fenna.behaviour, ['Mercy: low - stitches slowly', 'Care: high - protective of the dead', 'Loyalty: medium - stays']);
    assert.deepEqual(Object.keys(fenna).slice(0, 6), ['id', 'name', 'aliases', 'about', 'look', 'behaviour'], 'after look, wears/voice/personality when given');
    const all = CAST_BEHAVIOUR_LEVERS.map(lever => `${lever}: low - x`);
    assert.equal(all.length, 12);
    ok(one({ behaviour: all.slice(0, 6) }));
    ok(one({ behaviour: [`Care: high - ${'a'.repeat(CAST_LIMITS.behaviourEffect)}`] }));
    refused(one({ behaviour: all.slice(0, 7) }), 'BAD_RECORD', 'content.cast[0].behaviour');
    refused(one({ behaviour: [`Care: high - ${'a'.repeat(CAST_LIMITS.behaviourEffect + 1)}`] }), 'BAD_RECORD', 'content.cast[0].behaviour[0]');
    for (const bad of ['Care: high', 'Care: high -', 'Care high - x', 'Charm: high - x', 'Care: extreme - x', 'Care: high - <b>x</b>', 'Care: high - a | b', 'Care: high - {{user}}', '', 5, null, ['Care']]) {
        refused(one({ behaviour: [bad] }), 'BAD_RECORD', 'content.cast[0].behaviour[0]');
    }
    for (const bad of ['Care: high - x', 5, { Care: 'high' }, true, null]) refused(one({ behaviour: bad }), 'BAD_RECORD', 'content.cast[0].behaviour');
    refused(one({ behaviour: ['Care: high - a', 'care: low - b'] }), 'DUPLICATE', 'content.cast[0].behaviour[1]');
    // The message names the person, the line and the allowed words.
    const message = (value, path) => validatePack(JSON.stringify(one({ behaviour: value }))).errors.find(error => error.path === path).message;
    const lever = message(['Charm: high - x'], 'content.cast[0].behaviour[0]');
    assert.match(lever, /Fenna/); assert.match(lever, /behaviour\[0\]/); assert.match(lever, /Charm/);
    for (const word of CAST_BEHAVIOUR_LEVERS) assert.ok(lever.includes(word), word);
    const level = message(['Care: extreme - x'], 'content.cast[0].behaviour[0]');
    assert.match(level, /Fenna/); assert.match(level, /Care/); assert.match(level, /low, medium, high/);
    assert.match(message(['Care: high - a', 'CARE: low - b'], 'content.cast[0].behaviour[1]'), /Fenna.*Care.*twice/);
});

test('mannerisms: up to 4 one-line habits of at most 120 characters; absent when not given or empty', () => {
    assert.deepEqual([CAST_LIMITS.mannerisms, CAST_LIMITS.mannerism], [4, 120]);
    assert.equal('mannerisms' in ok(withCast([person()])).content.cast[0], false);
    assert.equal('mannerisms' in ok(one({ mannerisms: [] })).content.cast[0], false);
    assert.deepEqual(ok(one({ mannerisms: ['Coils a\n rope', 'Hums'] })).content.cast[0].mannerisms, ['Coils a rope', 'Hums']);
    ok(one({ mannerisms: ['a', 'b', 'c', 'd'] }));
    ok(one({ mannerisms: ['a'.repeat(CAST_LIMITS.mannerism)] }));
    refused(one({ mannerisms: ['a', 'b', 'c', 'd', 'e'] }), 'BAD_RECORD', 'content.cast[0].mannerisms');
    refused(one({ mannerisms: 'Hums' }), 'BAD_RECORD', 'content.cast[0].mannerisms');
    refused(one({ mannerisms: ['a'.repeat(CAST_LIMITS.mannerism + 1)] }), 'BAD_RECORD', 'content.cast[0].mannerisms[0]');
    for (const bad of ['', '  ', 5, null, '<b>x</b>', 'a | b', '{{user}}']) refused(one({ mannerisms: ['ok', bad] }), 'BAD_RECORD', 'content.cast[0].mannerisms[1]');
});

test('withYou: text up to 320 characters (the size of the NPC State Delta relationship summary), one plain line, after personality; absent when not given', () => {
    assert.equal(CAST_LIMITS.withYou, 320);
    assert.equal('withYou' in ok(withCast([person()])).content.cast[0], false);
    const [fenna] = ok(one({ personality: 'Patient.', withYou: 'Wary of you\n  at first.' })).content.cast;
    assert.equal(fenna.withYou, 'Wary of you at first.');
    assert.deepEqual(Object.keys(fenna).slice(0, 7), ['id', 'name', 'aliases', 'about', 'look', 'personality', 'withYou']);
    ok(one({ withYou: 'a'.repeat(CAST_LIMITS.withYou) }));
    refused(one({ withYou: 'a'.repeat(CAST_LIMITS.withYou + 1) }), 'BAD_RECORD', 'content.cast[0].withYou');
    for (const withYou of [5, true, ['x'], '', '   ', null, 'A <b>x</b>', '{{user}}']) refused(one({ withYou }), 'BAD_RECORD', 'content.cast[0].withYou');
});

test('the three new keys sit with the other cast fields; unknown fields are still refused and the message lists them', () => {
    for (const key of ['behaviour', 'mannerisms', 'withYou']) assert.ok(CAST_FIELDS.includes(key), key);
    refused(one({ habits: ['x'] }), 'UNKNOWN_FIELD', 'content.cast[0].habits');
    const message = validatePack(JSON.stringify(one({ habits: ['x'] }))).errors.find(error => error.path === 'content.cast[0].habits').message;
    assert.match(message, /personality, behaviour, mannerisms, withYou, history/);
    // A person with all three comes back with everything else exactly as before.
    const base = ok(one({ personality: 'Patient.' })).content.cast[0];
    const more = ok(one({ personality: 'Patient.', behaviour: ['Care: high - x'], mannerisms: ['Hums'], withYou: 'Wary.' })).content.cast[0];
    const { behaviour, mannerisms, withYou, ...rest } = more;
    assert.deepEqual(rest, base);
});
