// A rules pack through the host (validatePack) and the checker alone (validateRulesPack): what Story Block accepts as an ordinary pack
// plus a valid manifest is accepted by both, and the checker alone never calls valid what the host refuses (RB_CONTRACT §10 E review).
// The ownership rule: the checker owns the manifest and its creatures, quests, shops and recipes; Story Block owns the rest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { slugify, validatePack } from '../../../src/v2/packs/validate.js';
import * as R from '../../../src/v2/packs/rules-v2.js';
import { createInstalled } from '../../../src/v2/packs/installed.js';
import { fakeSettings } from './helpers/fake-settings.js';
import { smallRulesPack } from './rules-v2/fixtures/smallRulesPack.js';
import { makeEveryKindPack } from './rules-v2/fixtures/everyKindPack.js';
import { makeValidExtendedPack } from './rules-v2/fixtures/builders.js';
import { makeTreePack } from './rules-v2/fixtures/treePack.js';

const clone = value => JSON.parse(JSON.stringify(value));
const codes = result => (result.errors ?? []).map(error => [error.code, error.path]);
const has = (result, code, path) => (result.errors ?? []).some(error => error.code === code && (path === undefined || error.path === path));
const SLOTS = ['weapon', 'offhand', 'head', 'body', 'legs', 'feet', 'accessory-1', 'accessory-2'];

/** Both ways in, for one pack. */
const both = pack => ({ host: validatePack(clone(pack), { capabilities: null }), alone: R.validateRulesPack(clone(pack)) });

/** Where a pack on file lives: the examples, and among the test fixtures Bluewatch 1.6.0 and Ersveil 1.0.0 (the old example packs, with RPG Battle rules). */
const FIXTURES = { 'ersveil-bluewatch': 'ersveil-bluewatch-1.6.0.json', 'ersveil-1.0.0': 'ersveil-1.0.0.json' };
const packUrl = name => FIXTURES[name]
    ? new URL(`./fixtures/${FIXTURES[name]}`, import.meta.url)
    : new URL(`../../../examples/packs/${name}/pack.json`, import.meta.url);

/** A shipped example with a rules manifest added: the example's own items and places (no slug written), a rule for each item. */
function exampleWithManifest(name) {
    const pack = JSON.parse(readFileSync(packUrl(name), 'utf8'));
    pack.requires = { ...pack.requires, capabilities: [...new Set([...(pack.requires.capabilities ?? []), 'rb-rules-v2'])] };
    for (const kind of ['creatures', 'quests', 'shops', 'recipes']) pack.content[kind] = [];
    const rules = smallRulesPack().content.rules[0];
    rules.itemRules = (pack.content.items ?? []).map(item => {
        const equipment = item.kind === 'equipment';
        return { def: item.slug ?? slugify(item.name), allowedSlots: equipment ? [SLOTS.includes(item.slot) ? item.slot : 'body'] : [], hands: equipment && ['weapon', 'offhand'].includes(item.slot) ? 1 : 0, requires: {}, weight: 1, unique: false };
    });
    pack.content.rules = [rules];
    return pack;
}

test('the riverside example and the Bluewatch fixture plus a manifest are accepted, host and checker alone, with the slugs Story Block derives', () => {
    const names = ['ersveil-bluewatch', 'riverside-starter'];
    assert.ok(names.includes('ersveil-bluewatch') && names.includes('riverside-starter'));
    for (const name of names) {
        const pack = exampleWithManifest(name);
        const items = pack.content.items ?? [];
        const places = pack.content.places ?? [];
        assert.ok(items.some(item => item.slug === undefined), `${name} writes no slug on some items`);
        const { host, alone } = both(pack);
        assert.equal(host.ok, true, `${name} through the host: ${JSON.stringify(codes(host))}`);
        assert.equal(alone.ok, true, `${name} alone: ${JSON.stringify(codes(alone))}`);
        // The same ids the example has without the manifest, and the checker's pack carries the derived slugs.
        const ordinary = JSON.parse(readFileSync(packUrl(name), 'utf8'));
        const plain = validatePack(ordinary, { capabilities: null });
        assert.deepEqual(host.pack.content.items.map(item => item.id), plain.pack.content.items.map(item => item.id), name);
        assert.deepEqual(host.pack.content.places?.map(place => place.id), plain.pack.content.places?.map(place => place.id), name);
        assert.deepEqual(alone.pack.content.items.map(item => item.slug), items.map(item => slugify(item.name)), name);
        assert.deepEqual((alone.pack.content.places ?? []).map(place => place.slug), places.map(place => slugify(place.name)), name);
    }
});

test('the Ersveil 1.0.0 fixture, which writes its item slugs and derives its place slugs, plus a manifest is accepted by the host and the checker alone with the same ids', () => {
    const pack = exampleWithManifest('ersveil-1.0.0');
    assert.ok((pack.content.items ?? []).length > 0 && (pack.content.places ?? []).length > 0);
    assert.ok(pack.content.items.every(item => item.slug !== undefined), 'Ersveil writes its item slugs out');
    assert.ok(pack.content.places.every(place => place.slug === undefined), 'Ersveil leaves its place slugs to be derived');
    const { host, alone } = both(pack);
    assert.equal(host.ok, true, `through the host: ${JSON.stringify(codes(host))}`);
    assert.equal(alone.ok, true, `alone: ${JSON.stringify(codes(alone))}`);
    const plain = validatePack(JSON.parse(readFileSync(packUrl('ersveil-1.0.0'), 'utf8')), { capabilities: null });
    assert.deepEqual(host.pack.content.items.map(item => item.id), plain.pack.content.items.map(item => item.id));
    assert.deepEqual(host.pack.content.places.map(place => place.id), plain.pack.content.places.map(place => place.id));
    assert.deepEqual(alone.pack.content.items.map(item => item.slug), pack.content.items.map(item => item.slug));
    assert.deepEqual(alone.pack.content.places.map(place => place.slug), pack.content.places.map(place => slugify(place.name)));
});

test('a missing slug on an item or place is the one Story Block derives; writing it out gives the same pack and hash', () => {
    const omitted = smallRulesPack();
    omitted.content.items = [{ name: 'Iron Sword (old)', kind: 'equipment', slot: 'weapon' }];
    omitted.content.rules[0].itemRules = [{ def: 'iron-sword-old', allowedSlots: ['weapon'], hands: 1, requires: {}, weight: 3, unique: false }];
    omitted.content.places = [{ name: 'Haven Square', x: 0, y: 0 }, { name: 'Mill', x: 1, y: 0 }];
    const written = clone(omitted);
    written.content.items[0].slug = 'iron-sword-old';
    written.content.places[0].slug = 'haven-square';
    written.content.places[1].slug = 'mill';
    const a = both(omitted);
    const b = both(written);
    for (const result of [a.host, a.alone, b.host, b.alone]) assert.equal(result.ok, true, JSON.stringify(codes(result)));
    assert.equal(a.host.pack.content.items[0].id, 'pack.fixture/iron-sword-old');
    assert.deepEqual(a.host.pack, b.host.pack);
    assert.equal(a.alone.packHash, b.alone.packHash);
    assert.equal(a.alone.rulesHash, b.alone.rulesHash);
    assert.equal(a.host.packHash, a.alone.packHash);
    // A name with nothing to make a slug from, and two names with one slug, are still refused where Story Block refuses them.
    const empty = clone(omitted);
    empty.content.items[0].name = '!!!';
    assert.equal(both(empty).host.ok, false);
    assert.equal(both(empty).alone.ok, false);
    const twice = clone(omitted);
    twice.content.places[1].name = 'haven square!';
    assert.deepEqual(both(twice).host.ok || both(twice).alone.ok, false);
});

// ---------------------------------------------------------------------------------------------
// The checker alone does not call valid what the host refuses
// ---------------------------------------------------------------------------------------------

const refusedByBoth = (name, change, base = makeEveryKindPack) => {
    const pack = base();
    change(pack);
    const { host, alone } = both(pack);
    assert.equal(host.ok, false, `${name}: the host refuses`);
    assert.equal(alone.ok, false, `${name}: the checker alone refuses too (${JSON.stringify(codes(alone))})`);
    return { host, alone };
};

test('standalone runs Story Block\'s record checks on the owned records too: a recipe\'s stat, its craft, the lengths of names', () => {
    // A stat sum Story Block refuses, an unknown craft, and a stock line.
    const stat = refusedByBoth('recipe stat STR+STR', pack => { pack.content.recipes[0].stat = 'STR+STR'; });
    assert.ok(has(stat.host, 'BAD_RECORD', 'content.recipes[0].stat') || has(stat.host, 'bad-schema'), JSON.stringify(codes(stat.host)));
    const craft = refusedByBoth('unknown craft', pack => { pack.content.recipes[0].craft = 'weird'; });
    assert.ok(has(craft.alone, 'UNKNOWN_REF', 'content.recipes[0].craft'), JSON.stringify(codes(craft.alone)));
    assert.ok(has(craft.host, 'UNKNOWN_REF', 'content.recipes[0].craft'));
    refusedByBoth('unknown stock item', pack => { pack.content.shops[0].stock[0].item = 'nothing'; });
    // A craft the pack declares is fine in both.
    const own = makeEveryKindPack();
    own.content.recipes[0].craft = 'brewing';
    own.content.crafts = [{ id: 'brewing', title: 'Brewing', stats: ['INT'] }];
    const ok = both(own);
    assert.equal(ok.host.ok && ok.alone.ok, true, JSON.stringify([codes(ok.host), codes(ok.alone)]));
});

test('names count in UTF-16 units, 1 to 80, as in Story Block, everywhere: a long name of astral characters is refused by both', () => {
    const places = [
        ['creature', pack => { pack.content.creatures[0].name = 'x'.repeat(81); }, pack => { pack.content.creatures[0].name = 'x'.repeat(80); }, pack => { pack.content.creatures[0].name = '😀'.repeat(40); }, pack => { pack.content.creatures[0].name = '😀'.repeat(41); }],
        ['quest', pack => { pack.content.quests[0].name = 'x'.repeat(81); }, pack => { pack.content.quests[0].name = 'x'.repeat(80); }, pack => { pack.content.quests[0].name = '😀'.repeat(40); }, pack => { pack.content.quests[0].name = '😀'.repeat(41); }],
        ['shop', pack => { pack.content.shops[0].name = 'x'.repeat(81); }, pack => { pack.content.shops[0].name = 'x'.repeat(80); }, pack => { pack.content.shops[0].name = '😀'.repeat(40); }, pack => { pack.content.shops[0].name = '😀'.repeat(41); }],
        ['recipe', pack => { pack.content.recipes[0].name = 'x'.repeat(81); }, pack => { pack.content.recipes[0].name = 'x'.repeat(80); }, pack => { pack.content.recipes[0].name = '😀'.repeat(40); }, pack => { pack.content.recipes[0].name = '😀'.repeat(41); }],
        ['manifest', pack => { pack.content.rules[0].name = 'x'.repeat(81); }, pack => { pack.content.rules[0].name = 'x'.repeat(80); }, pack => { pack.content.rules[0].name = '😀'.repeat(40); }, pack => { pack.content.rules[0].name = '😀'.repeat(41); }],
        ['class', pack => { pack.content.rules[0].classes[1].name = 'x'.repeat(81); }, pack => { pack.content.rules[0].classes[1].name = 'x'.repeat(80); }, pack => { pack.content.rules[0].classes[1].name = '😀'.repeat(40); }, pack => { pack.content.rules[0].classes[1].name = '😀'.repeat(41); }],
    ];
    for (const [where, long, edge, astralEdge, astralLong] of places) {
        refusedByBoth(`${where} name of 81`, long);
        refusedByBoth(`${where} name of 41 astral characters (82 units)`, astralLong);
        for (const [what, change] of [['80', edge], ['40 astral characters (80 units)', astralEdge]]) {
            const pack = makeEveryKindPack();
            change(pack);
            const { host, alone } = both(pack);
            assert.equal(host.ok, true, `${where} name of ${what}, host: ${JSON.stringify(codes(host))}`);
            assert.equal(alone.ok, true, `${where} name of ${what}, alone: ${JSON.stringify(codes(alone))}`);
        }
    }
    // The same for a text bound that is not a name.
    const note = makeEveryKindPack();
    note.content.rules[0].skills[0].note = '😀'.repeat(121);
    assert.equal(both(note).alone.ok, false, 'a note of 242 units is over its 240');
    assert.equal(both(note).host.ok, false);
});

test('host and checker alone agree on a sweep of single changes to a good pack (apart from the layers\' own extra strictness)', () => {
    // (the full sweep, every path of both packs with ten kinds of change, is 16,000 pairs and takes two minutes; this is every ninth path)
    const bases = { every: makeEveryKindPack() };
    const paths = (o, p = []) => { const out = [p]; if (o && typeof o === 'object') for (const k of Object.keys(o)) out.push(...paths(o[k], [...p, k])); return out; };
    const setAt = (root, p, f) => { let o = root; for (const k of p.slice(0, -1)) o = o[k]; f(o, p[p.length - 1]); };
    const mutations = [
        ['str', (o, k) => { o[k] = 'zz'; }],
        ['long', (o, k) => { o[k] = 'x'.repeat(81); }],
        ['sum', (o, k) => { o[k] = 'STR+STR'; }],
    ];
    const strictAlone = /control-character|unsafe-markup/;
    const found = [];
    for (const [name, base] of Object.entries(bases)) {
        for (const [at, path] of paths(base).entries()) {
            if (path.length < 2 || at % 9 !== 0) continue;
            for (const [mutation, change] of mutations) {
                const pack = clone(base);
                try { setAt(pack, path, change); } catch { continue; }
                const { host, alone } = both(pack);
                if (alone.ok && !host.ok) found.push(`${name} ${mutation} ${path.join('.')}: alone accepts, host ${JSON.stringify(codes(host))}`);
                if (host.ok && !alone.ok && !strictAlone.test(JSON.stringify(codes(alone)))) found.push(`${name} ${mutation} ${path.join('.')}: host accepts, alone ${JSON.stringify(codes(alone))}`);
            }
        }
    }
    assert.deepEqual(found, []);
});

// ---------------------------------------------------------------------------------------------
// What Story Block owns is not counted or compared by the checker
// ---------------------------------------------------------------------------------------------

test('layouts of 110 x 1000 values and keys that differ only in Unicode form pass with a manifest, host and alone', () => {
    const pack = smallRulesPack();
    pack.layouts = Array.from({ length: 110 }, () => ({ d: Array.from({ length: 1000 }, () => 0) }));
    pack.layouts.push(Object.fromEntries([['café', 1], ['café', 2]]));
    const { host, alone } = both(pack);
    assert.equal(host.ok, true, JSON.stringify(codes(host)));
    assert.equal(alone.ok, true, JSON.stringify(codes(alone)));
    // The same layouts in an ordinary pack: Story Block takes them.
    assert.equal(validatePack({ id: 'plain', version: '1.0.0', requires: { storyBlock: '^2' }, content: {}, layouts: pack.layouts }).ok, true);
    // What the checker owns keeps both rules: keys that collide after NFC in the manifest are refused.
    const owned = smallRulesPack();
    owned.content.rules[0].statLabels = Object.fromEntries([['café', 'a'], ['café', 'b']]);
    assert.ok(has(both(owned).alone, 'dup-id'));
    assert.equal(both(owned).host.ok, false);
    // A shared reference graph cannot be used to make the checker walk forever outside the rules either.
    let shared = { leaf: 1 };
    for (let i = 0; i < 8; i += 1) { const next = {}; for (let k = 0; k < 10; k += 1) next[`k${k}`] = shared; shared = next; }
    const trap = smallRulesPack();
    trap.layouts = [shared];
    const started = Date.now();
    assert.equal(R.validateRulesPack(trap).ok, false);
    assert.ok(Date.now() - started < 5000);
});

// ---------------------------------------------------------------------------------------------
// The slug `rules` is the manifest's
// ---------------------------------------------------------------------------------------------

test('no other record of a rules pack may be called "rules" (pack.<id>/rules is the manifest), by slug, id or name', () => {
    const cases = [
        ['item slug', pack => { pack.content.items[0].slug = 'rules'; pack.content.rules[0].itemRules[0].def = 'rules'; pack.content.shops[0].stock = [{ item: 'rules', qty: 1, price: 1 }]; pack.content.recipes[0].materials = [{ item: 'rules', qty: 1 }]; pack.content.recipes[0].makes = 'rules'; pack.content.creatures[0].loot = []; pack.content.quests = []; }, 'content.items[0]'],
        ['place by name', pack => { pack.content.places[0] = { name: 'Rules', x: 0, y: 0 }; }, 'content.places[0]'],
        ['creature slug', pack => { pack.content.creatures[1].slug = 'rules'; pack.content.quests[1].objectives[3].foe = 'rules'; }, 'content.creatures[1]'],
        ['event id', pack => { pack.content.events[0].id = 'rules'; pack.content.rules[0].trainers[0].eventTemplates = ['rules']; }, 'content.events[0]'],
        ['quest slug', pack => { pack.content.quests[0].slug = 'rules'; pack.content.quests[1].chain.previous = 'rules'; pack.content.quests[1].requirements[2].template = 'rules'; }, 'content.quests[0]'],
    ];
    for (const [name, change, path] of cases) {
        const pack = makeEveryKindPack();
        change(pack);
        const { host, alone } = both(pack);
        assert.equal(host.ok, false, name);
        assert.ok(has(host, 'DUPLICATE') && codes(host).some(([, at]) => at.startsWith(path)), `${name}, host: ${JSON.stringify(codes(host))}`);
        assert.equal(alone.ok, false, name);
        assert.ok(has(alone, 'dup-id') && codes(alone).some(([, at]) => at.startsWith(path)), `${name}, alone: ${JSON.stringify(codes(alone))}`);
        assert.match(host.errors.find(error => error.code === 'DUPLICATE').message, /rules manifest/, 'the message says why');
    }
    // Inside the manifest the same ID space is shared.
    for (const [kind, index] of [['classes', 1], ['skills', 4], ['branches', 0]]) {
        const pack = smallRulesPack();
        pack.content.rules[0][kind][index].slug = 'rules';
        const { host, alone } = both(pack);
        assert.equal(host.ok || alone.ok, false, kind);
        assert.ok(has(alone, 'dup-id', `content.rules[0].${kind}[${index}].slug`), `${kind}: ${JSON.stringify(codes(alone))}`);
    }
    // Without a manifest, "rules" is a slug like any other.
    const plain = { id: 'plain', version: '1.0.0', requires: { storyBlock: '^2' }, content: { items: [{ name: 'Rules', slug: 'rules' }] } };
    assert.equal(validatePack(plain).ok, true);
});

// ---------------------------------------------------------------------------------------------
// Hashes on demand
// ---------------------------------------------------------------------------------------------

test('rulesHash and packHash are not worked out until asked for (and then are the checker\'s)', () => {
    const pack = makeEveryKindPack();
    const result = validatePack(clone(pack), { capabilities: null });
    assert.equal(result.ok, true);
    assert.deepEqual(Object.keys(result), ['ok', 'pack', 'raw'], 'not listed, not copied, not saved by a spread');
    assert.equal(typeof Object.getOwnPropertyDescriptor(result, 'rulesHash').get, 'function');
    const checked = R.validateRulesPack(clone(pack));
    assert.equal(result.rulesHash, checked.rulesHash);
    assert.equal(result.packHash, checked.packHash);
    assert.equal(result.rulesHash, result.rulesHash, 'kept');
    // The checker leaves them out on request.
    const lean = R.validateRulesPack(clone(pack), { hashes: false });
    assert.equal(lean.ok, true);
    assert.ok(!('rulesHash' in lean) && !('packHash' in lean));
    assert.deepEqual(lean.pack, checked.pack);
    assert.ok(has(R.validateRulesPack(clone(pack), { hashes: 'no' }), 'bad-schema', 'options.hashes'));
    // Reading the installed list asks for neither.
    const settings = fakeSettings({ packs: [{ id: 'fixture', version: '2.0.0', enabled: true, pack: clone(pack) }] });
    const installed = createInstalled({ settings });
    assert.equal(installed.list()[0].counts.rules, 1);
    assert.equal(installed.packs().length, 1);
    const tree = createInstalled({ settings: fakeSettings({ packs: Array.from({ length: 2 }, (_, i) => ({ id: `tree${i}`, version: '2.0.0', enabled: true, pack: { ...makeTreePack(37), id: `tree${i}` } })) }) });
    assert.equal(tree.list().every(entry => entry.problem === ''), true);
});
