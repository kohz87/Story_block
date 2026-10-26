// The checker's reach (RB_CONTRACT §10 E, "Validator opt-in scope"): a pack without a rules manifest is validated exactly as before
// (compared with the frozen old validator in fixtures/old-host); with a manifest (schema 2) the creatures, quests, shops and recipes
// it owns go through the checker, items and old-format skills stay strict, and nested slugs become full IDs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { HOST_VERSION, validatePack } from '../../../src/v2/packs/validate.js';
import { validatePack as oldValidatePack } from './fixtures/old-host/validate.js';
import * as R from '../../../src/v2/packs/rules-v2.js';
import { LIMITS } from '../../../src/v2/packs/limits.js';
import { sample } from './helpers/fixtures.js';
import { smallRulesPack } from './rules-v2/fixtures/smallRulesPack.js';
import { makeEveryKindPack } from './rules-v2/fixtures/everyKindPack.js';
import { makeValidExtendedPack } from './rules-v2/fixtures/builders.js';
import { makeTreePack } from './rules-v2/fixtures/treePack.js';

const clone = value => JSON.parse(JSON.stringify(value));
const show = result => JSON.stringify(result.errors ?? result);
const codes = result => (result.errors ?? []).map(error => [error.code, error.path]);
const has = (result, code, path) => (result.errors ?? []).some(error => error.code === code && (path === undefined || error.path === path));
const HOST = ['rb-rules-v2', 'story-director', 'rpg-battle'];
const fixtureDir = new URL('./rules-v2/fixtures/', import.meta.url);

// A pack the way a rules pack is written: the extended fixture (foes, quests, shop, recipe, trainer) with one change.
const rules = change => {
    const pack = makeValidExtendedPack();
    change(pack.content, pack);
    return validatePack(pack, { capabilities: null });
};

/** Every pack the repository ships or tests carry as data, to be compared with the frozen old validator. */
function packsOnFile() {
    const out = [];
    const examples = new URL('../../../examples/packs/', import.meta.url);
    for (const name of readdirSync(examples)) out.push([`examples/packs/${name}`, JSON.parse(readFileSync(new URL(`${name}/pack.json`, examples), 'utf8'))]);
    out.push(['helpers sample', sample()]);
    for (const name of readdirSync(fixtureDir).filter(file => file.endsWith('.json'))) {
        const pack = JSON.parse(readFileSync(new URL(name, fixtureDir), 'utf8'));
        out.push([`rules-v2/fixtures/${name}`, pack]);
        // The same pack without its manifest is an old-format pack too.
        const legacy = clone(pack);
        delete legacy.content.rules;
        legacy.requires = { storyBlock: legacy.requires?.storyBlock ?? '^2' };
        for (const kind of ['creatures', 'quests', 'shops', 'recipes']) legacy.content[kind] = [];
        out.push([`rules-v2/fixtures/${name} without rules`, legacy]);
    }
    return out;
}

test('old packs are unchanged: every pack on file validates to exactly what the old validator gave, errors included', () => {
    const found = packsOnFile();
    assert.ok(found.length >= 8, 'the examples, the helper sample and the rules fixtures');
    for (const [name, pack] of found) {
        for (const capabilities of [null, ['inventory', 'scene', 'story-director', 'rpg-battle']]) {
            const options = { capabilities };
            const expected = oldValidatePack(clone(pack), options);
            const got = validatePack(clone(pack), options);
            // A pack with a manifest used to be refused for its kind: that is the one thing that changed.
            if (pack.content?.rules) {
                assert.equal(expected.ok, false, name);
                continue;
            }
            assert.deepEqual(got, expected, name);
        }
    }
    // Also as text, and for the shipped examples without options.
    for (const [name, pack] of found.filter(([name]) => name.startsWith('examples/'))) {
        // The Ersveil example carries a rules manifest: the old validator refuses its kind, the current one accepts it.
        if (pack.content?.rules) assert.equal(oldValidatePack(JSON.stringify(pack)).ok, false, name);
        else assert.deepEqual(validatePack(JSON.stringify(pack)), oldValidatePack(JSON.stringify(pack)), name);
        assert.equal(validatePack(pack).ok, true, name);
    }
});

test('old packs are unchanged: broken packs fail with the same errors, and the kind list in the message is the only difference', () => {
    const base = () => clone(sample());
    const cases = [
        ['unknown field', pack => { pack.surprise = 1; }],
        ['unknown kind', pack => { pack.content.rulez = []; }],
        ['strict item', pack => { pack.content.items[0].oops = 1; }],
        ['strict skill', pack => { pack.content.skills = [{ name: 'Brew', slug: 'brew', type: 'magic', stat: 'INT', target: 'one', power: 4 }]; }],
        ['unknown shop item', pack => { pack.content.shops[0].stock[0] = 'nothing-here'; }],
        ['bad version', pack => { pack.version = 'x'; }],
        ['markup', pack => { pack.content.items[0].name = '<script>x</script>'; }],
        ['host range', pack => { pack.requires.storyBlock = '^3'; }],
        ['missing capability', pack => { pack.requires.capabilities = ['nothing-provides-this']; }],
        ['duplicate slug', pack => { pack.content.items.push(clone(pack.content.items[0])); }],
    ];
    for (const [name, change] of cases) {
        const pack = base();
        change(pack);
        const expected = oldValidatePack(clone(pack), { hostVersion: HOST_VERSION, capabilities: ['inventory'] });
        const got = validatePack(clone(pack), { capabilities: ['inventory'] });
        assert.equal(got.ok, false, name);
        // The one message that names the kinds now names `rules` too.
        const plain = errors => errors.map(error => (error.code === 'UNKNOWN_KIND' ? { ...error, message: error.message.replace(/\(expected .*\)\.$/, '') } : error));
        assert.deepEqual(plain(got.errors), plain(expected.errors), name);
    }
    const unknown = base();
    unknown.content.rulez = [];
    const message = validatePack(unknown).errors[0].message;
    assert.match(message, /markets, rules\)/, 'the list of kinds ends with rules');
});

// ---------------------------------------------------------------------------------------------
// Without a rules manifest: creatures and quests stay open records
// ---------------------------------------------------------------------------------------------

const LEGACY_CREATURE = { name: 'Dire Wolf', slug: 'dire-wolf', aliases: ['wolf'], look: 'Grey fur and a torn ear.', template: 'beast', boss: false, moves: [{ name: 'Bite', damage: 6 }], hp: 30, difficulty: 2, anything: { goes: [1, 2, 3] } };
const LEGACY_QUEST = { name: 'Wolf Hunt', slug: 'wolf-hunt', difficulty: 'D', detail: 'Bring back a pelt.', giver: 'Old Tam', place: 'Mill Road', objective: 'Kill the dire wolf', reward: { coin: 20 } };

test('legacy moves, template, difficulty and detail packs pass unchanged without a manifest', () => {
    const pack = { id: 'legacy', version: '1.0.0', requires: { storyBlock: '^2' }, content: { creatures: [LEGACY_CREATURE], quests: [LEGACY_QUEST], items: [] } };
    const got = validatePack(clone(pack));
    assert.equal(got.ok, true, show(got));
    assert.deepEqual(got, oldValidatePack(clone(pack)));
    const [creature] = got.pack.content.creatures;
    assert.deepEqual({ ...creature, id: undefined, pack: undefined }, { ...LEGACY_CREATURE, id: undefined, pack: undefined }, 'every field kept as written');
    assert.equal(creature.id, 'pack.legacy/dire-wolf');
    const [quest] = got.pack.content.quests;
    assert.equal(quest.difficulty, 'D');
    assert.equal(quest.detail, 'Bring back a pelt.');
    assert.equal(quest.id, 'pack.legacy/wolf-hunt');
    // Nothing about the checker applies: no hashes, no manifest, schema-2 fields are just data.
    assert.ok(!('rulesHash' in got) && !('rules' in got.pack.content));
    const schema2Shaped = { ...pack, content: { creatures: [{ name: 'Goblin Scout', slug: 'goblin-scout', tier: 0, level: 1, skills: ['s00'], loot: [{ def: 'potion' }] }], quests: [] } };
    assert.deepEqual(validatePack(clone(schema2Shaped)), oldValidatePack(clone(schema2Shaped)), 'without a manifest the shape is not looked at');
});

test('the same legacy creature and quest are refused with a manifest: conflicts need explicit reauthoring, never silent field loss', () => {
    const withLegacy = (kind, record) => rules(content => { content[kind] = [record]; });
    const goblin = makeValidExtendedPack().content.creatures[0];
    const wolf = withLegacy('creatures', LEGACY_CREATURE);
    assert.equal(wolf.ok, false);
    assert.ok(has(wolf, 'bad-schema') || has(wolf, 'envelope-unknown'), show(wolf));
    // A schema-2 foe that also keeps a legacy field.
    for (const field of ['moves', 'template', 'boss', 'look', 'aliases', 'hp']) {
        const result = withLegacy('creatures', { ...goblin, [field]: field === 'moves' ? ['bite'] : field === 'aliases' ? ['gob'] : field === 'boss' ? true : 'x' });
        assert.equal(result.ok, false, field);
        assert.ok(has(result, 'envelope-unknown', `content.creatures[0].${field}`), `${field}: ${show(result)}`);
    }
    const quest = makeValidExtendedPack().content.quests[0];
    for (const field of ['difficulty', 'detail', 'place', 'objective']) {
        const result = withLegacy('quests', { ...quest, [field]: 'x' });
        assert.equal(result.ok, false, field);
        assert.ok(has(result, 'envelope-unknown', `content.quests[0].${field}`), `${field}: ${show(result)}`);
    }
    const old = withLegacy('quests', LEGACY_QUEST);
    assert.equal(old.ok, false, 'the whole legacy quest is refused: the manifest means schema 2 for what it owns');
});

// ---------------------------------------------------------------------------------------------
// With a manifest: owned definitions through the checker
// ---------------------------------------------------------------------------------------------

test('schema 2 rejects a numeric branch-only copy, a graph mismatch, and every unknown field and reference', () => {
    // A written branch that only changes a number.
    const numeric = smallRulesPack();
    numeric.content.rules[0].branches[0].transforms = [{ op: 'set-power', at: 0, value: 90 }];
    assert.ok(has(validatePack(numeric), 'numeric-only-branch', 'content.rules[0].branches[0]'));
    // The same two transforms that cancel each other are no change either.
    const cancelled = smallRulesPack();
    cancelled.content.rules[0].branches[0].transforms = [{ op: 'set-element', at: 0, value: 'fire' }, { op: 'set-element', at: 0, value: 'none' }];
    assert.ok(has(validatePack(cancelled), 'numeric-only-branch'));

    // Graph mismatch: a missing step-1 child, missing step-2 children (12 written instead of 24), a branch that names no skill.
    const missing = smallRulesPack();
    missing.content.rules[0].branches = missing.content.rules[0].branches.filter(branch => !(branch.skill === 's30' && branch.step === 1 && branch.choice === 'b'));
    assert.ok(has(validatePack(missing), 'branch-graph'));
    const half = smallRulesPack();
    half.content.rules[0].branches = half.content.rules[0].branches.filter(branch => branch.step === 1);
    assert.ok(has(validatePack(half), 'branch-graph'));
    const phantom = smallRulesPack();
    phantom.content.rules[0].branches.push({ slug: 's99-base-a', name: 'Phantom', skill: 'nowhere', fromForm: 's99-base', step: 1, choice: 'a', transforms: [{ op: 'set-element', at: 0, value: 'fire' }] });
    assert.ok(has(validatePack(phantom), 'bad-ref'));

    // Unknown fields, at every level the checker owns.
    const unknown = (path, change) => {
        const pack = makeEveryKindPack();
        change(pack.content);
        const result = validatePack(pack);
        assert.equal(result.ok, false, path);
        assert.ok(has(result, 'envelope-unknown', path), `${path}: ${show(result)}`);
    };
    unknown('content.rules[0].extra', content => { content.rules[0].extra = 1; });
    unknown('content.rules[0].skills[0].extra', content => { content.rules[0].skills[0].extra = 1; });
    unknown('content.rules[0].skills[0].base.cost.sp2', content => { content.rules[0].skills[0].base.cost.sp2 = 1; });
    unknown('content.creatures[0].extra', content => { content.creatures[0].extra = 1; });
    unknown('content.quests[0].extra', content => { content.quests[0].extra = 1; });
    unknown('content.quests[1].reward.xp2', content => { content.quests[1].reward.xp2 = 1; });
    unknown('content.shops[0].extra', content => { content.shops[0].extra = 1; });
    unknown('content.recipes[0].extra', content => { content.recipes[0].extra = 1; });

    // Unknown references.
    // The host's own shop and recipe checks run first and say UNKNOWN_REF for an item that is nowhere; the checker's `bad-ref` is for the rest.
    const unresolved = (path, change, code = 'bad-ref') => {
        const pack = makeEveryKindPack();
        change(pack.content);
        const result = validatePack(pack);
        assert.equal(result.ok, false, path);
        assert.ok(has(result, code, path), `${path}: ${show(result)}`);
        // Standalone is refused too (Story Block's record pass is part of it now, so the code is the same where Story Block found it).
        const alone = R.validateRulesPack(pack);
        assert.ok(has(alone, code, path) || has(alone, 'bad-ref', path), `${path} (checker alone): ${codes(alone)}`);
    };
    unresolved('content.creatures[0].skills[0]', content => { content.creatures[0].skills[0] = 'nothing'; });
    unresolved('content.creatures[0].loot[0].def', content => { content.creatures[0].loot[0].def = 'nothing'; });
    unresolved('content.shops[0].stock[0].item', content => { content.shops[0].stock[0].item = 'nothing'; }, 'UNKNOWN_REF');
    unresolved('content.shops[0].place', content => { content.shops[0].place = 'pack.fixture/nowhere'; });
    unresolved('content.recipes[0].makes', content => { content.recipes[0].makes = 'nothing'; }, 'UNKNOWN_REF');
    unresolved('content.recipes[0].materials[0].item', content => { content.recipes[0].materials[0].item = 'nothing'; }, 'UNKNOWN_REF');
    unresolved('content.quests[0].objectives[0].foe', content => { content.quests[0].objectives[0].foe = 'nothing'; });
    unresolved('content.quests[0].reward.items[0].def', content => { content.quests[0].reward.items[0].def = 'nothing'; });
    unresolved('content.quests[0].chain.next', content => { content.quests[0].chain.next = 'nothing'; });
    // Another pack's internal reference is not a reference into this pack.
    unresolved('content.creatures[0].skills[0]', content => { content.creatures[0].skills[0] = 'pack.other/s00'; });
});

test('schema 2 keeps this host\'s checks that the checker leaves: a recipe\'s craft must be one the pack or the host knows', () => {
    const bad = rules(content => { content.recipes[0].craft = 'weird'; });
    assert.equal(bad.ok, false);
    assert.ok(has(bad, 'UNKNOWN_REF', 'content.recipes[0].craft'), show(bad));
    const own = makeValidExtendedPack();
    own.content.recipes[0].craft = 'brewing';
    own.content.crafts = [{ id: 'brewing', title: 'Brewing', stats: ['INT'] }];
    assert.equal(validatePack(own, { capabilities: null }).ok, true, show(validatePack(own)));
});

test('schema 2 rejects unsafe and oversized content', () => {
    const run = change => {
        const pack = makeEveryKindPack();
        change(pack);
        return validatePack(pack, { capabilities: null });
    };
    // Markup, links, unsafe keys and control characters in what the checker owns: each refused with the code of the layer that found it.
    const refused = (name, code, path, change) => {
        const result = run(change);
        assert.equal(result.ok, false, name);
        assert.deepEqual(codes(result), [[code, path]], `${name}: ${show(result)}`);
    };
    refused('markup in a creature', 'UNSAFE_HTML', 'content.creatures[0].name', pack => { pack.content.creatures[0].name = '<b>Goblin</b>'; });
    refused('a link in a quest', 'UNSAFE_HTML', 'content.quests[0].name', pack => { pack.content.quests[0].name = 'See [x](javascript:alert(1))'; });
    refused('an image in a label', 'UNSAFE_HTML', 'content.rules[0].statLabels.STR', pack => { pack.content.rules[0].statLabels.STR = '<img src=x onerror=alert(1)>'; });
    refused('a key that reaches the prototype', 'UNSAFE_KEY', 'content.rules[0].statLabels.__proto__', pack => { pack.content.rules[0].statLabels = JSON.parse('{"__proto__": "x"}'); });
    refused('a control character', 'control-character', 'content.shops[0].name', pack => { pack.content.shops[0].name = 'Armory\u0000'; });
    // Sizes: a string, a list, an array of records, depth, the pack itself.
    refused('a long string', 'TOO_LONG', 'content.creatures[0].name', pack => { pack.content.creatures[0].name = 'x'.repeat(LIMITS.string + 1); });
    refused('a list over its own limit', 'numeric-range', 'content.creatures[0].loreTags', pack => { pack.content.creatures[0].loreTags = Array.from({ length: 9 }, (_, i) => `t${i}`); });
    refused('too many records', 'TOO_MANY', 'content.rules[0].skills', pack => { pack.content.rules[0].skills = Array.from({ length: LIMITS.array + 1 }, (_, i) => ({ slug: `s${i}` })); });
    let deep = {};
    for (let i = 0; i < 20; i += 1) deep = { deeper: deep };
    const nested = run(pack => { pack.content.rules[0].statLabels = deep; });
    assert.equal(nested.errors[0].code, 'TOO_DEEP');
    const huge = JSON.stringify({ ...makeEveryKindPack(), description: 'd'.repeat(LIMITS.packBytes) });
    assert.deepEqual(codes(validatePack(huge)), [['TOO_LARGE', '']]);
    // The tree the schema allows at most (40 classes, 120 skills, 888 written branches, 1452 forms) is still a valid pack, within the pack limit.
    const tree = makeTreePack(37);
    const big = validatePack(tree, { capabilities: null });
    assert.equal(big.ok, true, show(big));
    assert.ok(JSON.stringify(tree).length < LIMITS.packBytes);
    // One class too many (41 classes) is the checker's refusal, with its code.
    const tooMany = validatePack(makeTreePack(38), { capabilities: null });
    assert.deepEqual(codes(tooMany), [['numeric-range', 'content.rules[0].classes'], ['numeric-range', 'content.rules[0].skills']]);
});

test('a complete advanced graph, 24 written and 12 generated forms per advanced class, validates and is stored as written', () => {
    const pack = smallRulesPack();
    const result = validatePack(pack, { capabilities: HOST });
    assert.equal(result.ok, true, show(result));
    const [manifest] = result.pack.content.rules;
    const advanced = manifest.classes.filter(entry => entry.tier === 3);
    assert.equal(advanced.length, 1);
    const written = manifest.branches.filter(branch => advanced[0].skills.includes(branch.skill));
    assert.equal(written.length, 24, '3 skills x (2 + 6) written branches');
    // The generated 12 are expanded, not stored: the checker's expansion has all 36 descendants of the class.
    const checked = R.validateRulesPack(clone(pack));
    const expanded = R.expandRulesV2(checked.pack.content.rules[0], checked.pack.content);
    assert.equal(expanded.ok, true, show(expanded));
    const descendants = Object.values(expanded.resolved.forms).filter(form => form.step > 0 && advanced[0].skills.includes(form.skill));
    assert.equal(descendants.length, 36);
    assert.equal(descendants.filter(form => form.origin === 'generated').length, 12);
    assert.equal(descendants.filter(form => form.origin === 'written').length, 24);
    // Written order is kept; nothing stored is expanded.
    assert.deepEqual(manifest.branches.map(branch => branch.slug), pack.content.rules[0].branches.map(branch => branch.slug));
    assert.equal(result.rulesHash, checked.rulesHash);
});

test('nested slugs become full IDs in what the pack stores, and the stored pack is what the checker resolved', () => {
    const result = validatePack(makeEveryKindPack(), { capabilities: null });
    assert.equal(result.ok, true, show(result));
    const { content } = result.pack;
    const [goblin, orc] = content.creatures;
    assert.deepEqual(goblin.skills, ['pack.fixture/s00']);
    assert.deepEqual(orc.skills, ['pack.fixture/s10', 'pack.fixture/s11']);
    assert.deepEqual(goblin.loot, [{ chance: 40, def: 'pack.fixture/potion', qty: 1 }]);
    const [first, second] = content.quests;
    assert.deepEqual(first.objectives[0], { count: 1, foe: 'pack.fixture/goblin-scout', id: 'ob_00000001', kind: 'kill' });
    assert.deepEqual(first.chain, { next: 'pack.fixture/supply-run', previous: null });
    assert.deepEqual(first.reward.items, [{ def: 'pack.fixture/potion', qty: 1 }]);
    assert.equal(second.giver, 'np_00000007', 'a canonical external id stays as it is');
    assert.equal(second.objectives[1].place, 'pl_00000009');
    assert.equal(first.turnInPlace, 'pack.fixture/haven', 'a place of this pack is already a full ID');
    const [shop] = content.shops;
    assert.deepEqual(shop.stock.map(line => line.item), ['pack.fixture/greatsword', 'pack.fixture/potion']);
    assert.equal(shop.place, 'pack.fixture/haven');
    const [recipe] = content.recipes;
    assert.equal(recipe.makes, 'pack.fixture/potion');
    assert.deepEqual(recipe.materials, [{ item: 'pack.fixture/potion', qty: 1 }]);
    assert.equal(recipe.known, true, 'the schema default is applied');
    const [rule] = content.rules;
    assert.deepEqual(rule.itemRules.map(entry => entry.def), ['pack.fixture/greatsword', 'pack.fixture/dagger', 'pack.fixture/potion']);
    assert.deepEqual(rule.trainers[0].eventTemplates.length, 1);
    // Same as the checker's own resolved tables, record for record.
    const checked = R.validateRulesPack(makeEveryKindPack());
    for (const [kind, table] of [['creatures', 'foes'], ['quests', 'quests'], ['shops', 'shops'], ['recipes', 'recipes']]) {
        assert.deepEqual(content[kind].map(record => record.id), Object.keys(checked.resolved[table]).sort((a, b) => content[kind].findIndex(r => r.id === a) - content[kind].findIndex(r => r.id === b)), kind);
        for (const record of content[kind]) assert.deepEqual(record, { ...checked.resolved[table][record.id], pack: 'fixture' }, record.id);
    }
    // Items and old-format skills (not the checker's) stay as the old validator normalizes them.
    assert.equal(content.items[0].id, 'pack.fixture/greatsword');
    assert.deepEqual(Object.keys(content.items[0]).sort(), ['aliases', 'effect', 'id', 'kind', 'name', 'note', 'pack', 'rarity', 'slot', 'slug', 'stack', 'stats', 'tags', 'value']);
    // Authored order of the lists is kept, and so are the texts (NFC, trimmed) the checker normalized.
    const messy = makeEveryKindPack();
    messy.content.creatures[0].name = '  Gobliñ Scout \r\n';
    const norm = validatePack(messy, { capabilities: null });
    assert.equal(norm.ok, true, show(norm));
    assert.equal(norm.pack.content.creatures[0].name, 'Gobliñ Scout');
    assert.deepEqual(norm.pack.content.creatures.map(record => record.slug), ['goblin-scout', 'orc-brute']);
});

test('old items and old-format skills stay strict in a rules pack, and old skills do not mix into the manifest', () => {
    const skills = makeValidExtendedPack();
    skills.content.skills = [{ name: 'Brew', slug: 'brew', type: 'magic', stat: 'INT', target: 'one' }];
    const ok = validatePack(skills, { capabilities: null });
    assert.equal(ok.ok, true, show(ok));
    assert.equal(ok.pack.content.skills[0].id, 'pack.fixture/brew');
    assert.equal(ok.pack.content.rules[0].skills.length, 12, 'the v2 skills live in the manifest');
    skills.content.skills[0].power = 4;
    assert.ok(has(validatePack(skills, { capabilities: null }), 'UNKNOWN_FIELD', 'content.skills[0].power'));
    // An item with a field the old format does not know is refused with the old code, not looked at by a looser rule.
    assert.ok(has(rules(content => { content.items[0].hands = 2; }), 'UNKNOWN_FIELD', 'content.items[0].hands'));
    // Every content.items id needs its one rule.
    assert.ok(has(rules(content => { content.items.push({ slug: 'rope', name: 'Rope', kind: 'goods' }); }), 'item-rule-mismatch'));
    // Slugs of items, creatures and so on keep their old form.
    assert.ok(has(rules(content => { content.items[0].slug = 'Bad Slug'; }), 'BAD_RECORD'));
});

test('a rules pack and the shop and recipe checks of the host agree on references by name too: a name is not a reference in schema 2', () => {
    const byName = rules(content => { content.shops[0].stock[1].item = 'Healing Salve'; });
    assert.equal(byName.ok, false, 'old packs may write an item by name; a rules pack writes slugs or full IDs');
    assert.ok(has(byName, 'bad-schema', 'content.shops[0].stock[1].item'), show(byName));
    const qualified = rules(content => { content.shops[0].stock[1].item = 'pack.fixture/potion'; });
    assert.equal(qualified.ok, true, show(qualified));
    assert.equal(qualified.pack.content.shops[0].stock[1].item, 'pack.fixture/potion');
});

// ---------------------------------------------------------------------------------------------
// Options the host hands the checker, and one code for unsafe text
// ---------------------------------------------------------------------------------------------

test('the checker takes the real host version and limits for its envelope pass (and keeps 2.1.0 and the default limits when given none)', () => {
    const wants = range => smallRulesPack({ requires: { storyBlock: range, capabilities: ['rb-rules-v2'] } });
    // Packs that ask for an older host than the checker's built-in 2.1.0 (a beta), and one that asks for a newer host.
    for (const [range, hostVersion] of [['=2.0.0-beta.2', '2.0.0-beta.2'], ['<=2.0.0-beta.5', '2.0.0-beta.2'], ['>=2.0.0-beta.1 <2.0.0', '2.0.0-beta.2'], ['^2.2', '2.2.4']]) {
        assert.equal(R.validateRulesPack(wants(range)).ok, false, `${range}: the built-in version is not enough`);
        const given = R.validateRulesPack(wants(range), { hostVersion });
        assert.equal(given.ok, true, `${range} on ${hostVersion}: ${show(given)}`);
        const host = validatePack(wants(range), { hostVersion, capabilities: null });
        assert.equal(host.ok, true, `${range} on ${hostVersion} through the host: ${show(host)}`);
    }
    assert.ok(has(validatePack(wants('^2.1'), { hostVersion: '2.0.0-beta.2' }), 'HOST_VERSION', 'requires.storyBlock'), 'a host that is too old still refuses');
    assert.ok(has(R.validateRulesPack(wants('^2.1'), { hostVersion: '2.0.9' }), 'HOST_VERSION'));
    assert.equal(R.validateRulesPack(wants('^2')).ok, true);
    for (const bad of ['', 'two', 2, null]) {
        const result = R.validateRulesPack(wants('^2'), { hostVersion: bad });
        if (bad === null) assert.equal(result.ok, true, 'null is "not given"');
        else assert.ok(has(result, 'bad-schema', 'options.hostVersion'), JSON.stringify(bad));
    }
    // Limits: the host's own are used, not the defaults.
    const pack = smallRulesPack();
    pack.description = 'd'.repeat(60);
    const tight = { ...LIMITS, string: 50 };
    assert.ok(has(R.validateRulesPack(pack, { limits: tight }), 'TOO_LONG', 'description'));
    assert.ok(has(validatePack(pack, { limits: tight }), 'TOO_LONG', 'description'));
    assert.equal(R.validateRulesPack(pack).ok, true);
    assert.equal(R.validateRulesPack(pack, { limits: { string: 50 } }).ok, false, 'a partial table is laid over the defaults');
    for (const bad of [{ nope: 5 }, { string: 0 }, { string: 'x' }, [], 5]) assert.ok(has(R.validateRulesPack(pack, { limits: bad }), 'bad-schema', 'options.limits'), JSON.stringify(bad));
});

test('envelope: false skips the checker\'s own pass over the envelope and the records Story Block owns; by default it is on', () => {
    // Nothing the host owns is wrong in this pack except an item field, which only the envelope pass looks at.
    const pack = makeValidExtendedPack();
    pack.content.items[0].oops = 1;
    pack.content.places = [{ name: 'Nowhere', x: 'far', y: 0 }];
    assert.equal(R.validateRulesPack(clone(pack)).ok, false, 'standalone: on by default');
    assert.ok(has(R.validateRulesPack(clone(pack), { envelope: true }), 'UNKNOWN_FIELD', 'content.items[0].oops'));
    const skipped = R.validateRulesPack(clone(pack), { envelope: false });
    assert.ok(!has(skipped, 'UNKNOWN_FIELD'), show(skipped));
    // The manifest and the definitions it owns are still checked, and so is the declaration.
    const owned = makeValidExtendedPack();
    owned.content.rules[0].skills[0].base.effects[0].power = -50;
    assert.ok(has(R.validateRulesPack(owned, { envelope: false }), 'numeric-range', 'content.rules[0].skills[0].base.effects[0].power'));
    const silent = smallRulesPack({ requires: { storyBlock: '^2', capabilities: [] } });
    assert.ok(has(R.validateRulesPack(silent, { envelope: false }), 'MISSING_CAPABILITY'));
    assert.ok(has(R.validateRulesPack(smallRulesPack(), { envelope: 'no' }), 'bad-schema', 'options.envelope'));
    // The same good pack gives the same answer, hashes included, either way.
    const good = makeEveryKindPack();
    const on = R.validateRulesPack(clone(good));
    const off = R.validateRulesPack(clone(good), { envelope: false });
    assert.equal(on.ok && off.ok, true);
    assert.deepEqual([off.rulesHash, off.packHash], [on.rulesHash, on.packHash]);
    assert.deepEqual(off.pack, on.pack);
    // The host does its own envelope pass first and hands the checker the rest: a bad item field is the host's code, found once.
    const hosted = validatePack(clone(pack), { capabilities: null });
    assert.deepEqual(codes(hosted).filter(([code]) => code === 'UNKNOWN_FIELD'), [['UNKNOWN_FIELD', 'content.items[0].oops']]);
});

test('a rules pack\'s money: display and an empty coin list are the checker\'s; the host keeps its own reading of the rest', () => {
    const pack = smallRulesPack();
    pack.currency = { name: 'mark', plural: 'marks', short: 'm', display: 'base', coins: [] };
    const result = validatePack(pack, { capabilities: null });
    assert.equal(result.ok, true, show(result));
    assert.equal(result.pack.currency.name, 'mark');
    assert.equal(result.pack.currency.display, 'base');
    pack.currency = { name: 'mark' };
    assert.equal(validatePack(pack, { capabilities: null }).pack.currency.display, 'mixed', 'the schema default');
    pack.currency = { name: 'mark', display: 'weird' };
    assert.ok(has(validatePack(pack, { capabilities: null }), 'bad-schema', 'currency.display'));
    pack.currency = { name: 'mark', coins: [{ name: 'penny', value: 1 }, { name: 'silver', value: 10 }], display: 'mixed' };
    assert.equal(validatePack(pack, { capabilities: null }).pack.currency.coins.length, 2);
    // Without a manifest the old reading stands: display is not a currency field there.
    const old = { id: 'plain', version: '1.0.0', requires: { storyBlock: '^2' }, currency: { name: 'mark', display: 'base' }, content: {} };
    assert.equal(validatePack(old).ok, false);
    assert.deepEqual(validatePack(old), oldValidatePack(old));
});

test('unsafe text is UNSAFE_HTML from validatePack whoever found it; the checker alone keeps unsafe-markup', () => {
    const creature = makeEveryKindPack();
    creature.content.creatures[0].name = '<b>Goblin</b>';
    const quest = makeEveryKindPack();
    quest.content.quests[0].name = 'See [x](javascript:alert(1))';
    const inRules = makeEveryKindPack();
    inRules.content.rules[0].skills[0].name = 'Slash <i>hard</i>';
    for (const [name, pack, path] of [['creature name', creature, 'content.creatures[0].name'], ['quest text', quest, 'content.quests[0].name'], ['manifest text', inRules, 'content.rules[0].skills[0].name']]) {
        const host = validatePack(clone(pack), { capabilities: null });
        assert.deepEqual(codes(host), [['UNSAFE_HTML', path]], `${name}: ${show(host)}`);
        assert.ok(!show(host).includes('unsafe-markup'), name);
    }
    // Standalone (Studio): the checker's own code stays.
    assert.ok(has(R.validateRulesPack(clone(creature)), 'unsafe-markup', 'content.creatures[0].name'));
    assert.ok(has(R.validateRulesPack(clone(inRules)), 'unsafe-markup', 'content.rules[0].skills[0].name'));
    // Also with the envelope pass skipped, which is how the host calls it: the checker still says unsafe-markup itself, the host maps it.
    assert.ok(has(R.validateRulesPack(clone(creature), { envelope: false }), 'unsafe-markup'));
});

test('the "<" and ">" ban is the checker\'s own: it holds for the manifest and what the checker owns, and leaves the rest to Story Block', () => {
    const ranged = range => smallRulesPack({ requires: { storyBlock: range, capabilities: ['rb-rules-v2'] } });
    // A version range and an event condition are Story Block\'s, so they read as in an ordinary pack.
    for (const range of ['>=2.0.0-beta.2', '<=2.0.0-beta.5', '>2.0.0-alpha.1 <3', '>=2.0.0-beta.1 <2.0.0']) {
        const standalone = R.validateRulesPack(ranged(range), { hostVersion: '2.0.0-beta.2' });
        assert.equal(standalone.ok, true, `${range}: ${codes(standalone)}`);
        const host = validatePack(ranged(range), { hostVersion: '2.0.0-beta.2', capabilities: null });
        assert.equal(host.ok, true, `${range} through the host: ${codes(host)}`);
        assert.equal(host.pack.requires.storyBlock, range);
    }
    const withWhen = when => {
        const pack = smallRulesPack();
        pack.content.events = [{ id: 'rich', when, cue: 'Coins ring', once: true, then: [] }];
        return pack;
    };
    for (const when of ['gold > 5', 'gold >= 5 && day < 3']) {
        assert.equal(R.validateRulesPack(withWhen(when)).ok, true, when);
        const host = validatePack(withWhen(when), { capabilities: null });
        assert.equal(host.ok, true, `${when}: ${codes(host)}`);
        assert.equal(host.pack.content.events[0].when, when);
    }
    // Still scanned in those fields, by Story Block\'s safety rules: script-like tags and event attributes.
    for (const [pack, path] of [
        [ranged('<script>alert(1)</script>'), 'requires.storyBlock'],
        [ranged('>=2.0.0 <img onerror=alert(1)>'), 'requires.storyBlock'],
        [withWhen('<script>alert(1)</script>'), 'content.events[0].when'],
        [withWhen('gold > 5 <img onerror=alert(1)>'), 'content.events[0].when'],
    ]) {
        assert.ok(has(R.validateRulesPack(clone(pack)), 'unsafe-markup', path), path);
        const host = validatePack(clone(pack), { capabilities: null });
        assert.equal(host.ok, false, path);
        assert.ok(has(host, 'UNSAFE_HTML', path) || has(host, 'BAD_REQUIRES', path), `${path} through the host: ${codes(host)}`);
    }
    // Standalone, a character reference that stands for "<" is still refused anywhere.
    assert.ok(has(R.validateRulesPack(withWhen('gold &#62; 5')), 'unsafe-markup', 'content.events[0].when'));
    assert.ok(has(R.validateRulesPack(ranged('&#60;3')), 'unsafe-markup', 'requires.storyBlock'));
});

test('"<" and ">" are still refused in the manifest and in every record the checker owns, through the host and standalone', () => {
    const refuse = (name, path, change) => {
        const pack = makeEveryKindPack();
        change(pack);
        assert.ok(has(R.validateRulesPack(clone(pack)), 'unsafe-markup', path), `${name} (checker alone): ${codes(R.validateRulesPack(clone(pack)))}`);
        assert.deepEqual(codes(validatePack(clone(pack), { capabilities: null })), [['UNSAFE_HTML', path]], name);
    };
    refuse('manifest name', 'content.rules[0].name', pack => { pack.content.rules[0].name = 'Rules <3'; });
    refuse('skill note', 'content.rules[0].skills[0].note', pack => { pack.content.rules[0].skills[0].note = 'hits for > 5'; });
    refuse('class name', 'content.rules[0].classes[1].name', pack => { pack.content.rules[0].classes[1].name = 'A > B'; });
    refuse('stat label', 'content.rules[0].statLabels.STR', pack => { pack.content.rules[0].statLabels.STR = 'Str > all'; });
    refuse('trainer name', 'content.rules[0].trainers[0].name', pack => { pack.content.rules[0].trainers[0].name = 'Master <Blade>'; });
    refuse('creature name', 'content.creatures[0].name', pack => { pack.content.creatures[0].name = 'Goblin > Orc'; });
    refuse('creature tag', 'content.creatures[0].loreTags[0]', pack => { pack.content.creatures[0].loreTags[0] = 'a<b'; });
    refuse('quest name', 'content.quests[0].name', pack => { pack.content.quests[0].name = 'Reach level > 3'; });
    refuse('quest objective text', 'content.quests[1].objectives[2].text', pack => { pack.content.quests[1].objectives[2].text = 'Talk to <the miller>'; });
    refuse('shop name', 'content.shops[0].name', pack => { pack.content.shops[0].name = 'Armory <&> Co'; });
    refuse('recipe name', 'content.recipes[0].name', pack => { pack.content.recipes[0].name = 'Brew > Boil'; });
    refuse('a key under the manifest', 'content.rules[0].statLabels.a<b', pack => { pack.content.rules[0].statLabels = { 'a<b': 'x' }; });
});

test('what Story Block owns is read as in an ordinary pack: "<" and ">" in the envelope, events, items, places, screens, theme and layouts', () => {
    const screen = { id: 'camp', title: 'Camp', mounts: ['tab'], template: '<section class="camp"><h2>{{place}}</h2><p>a &amp; b</p></section>'.padEnd(9000, ' <b>x</b>'), css: '.camp > h2 { color: red; }' };
    const theme = { '--ss-accent': '#3f7f8f' };
    const layouts = [{ id: 'row', note: 'a < b' }];
    const ordinary = extra => ({ id: 'plain', version: '1.0.0', requires: { storyBlock: '^2' }, content: {}, ...extra });
    const withRules = extra => ({ ...smallRulesPack(), ...extra });

    // The screen, the theme and the layouts, which Story Block parses itself (a template or css may be 64 KB, not 4000 characters).
    const good = validatePack(withRules({ screens: [screen], theme, layouts }), { capabilities: null });
    assert.equal(good.ok, true, codes(good));
    assert.equal(validatePack(ordinary({ screens: [screen], theme, layouts })).ok, true, 'the same screen in an ordinary pack');
    const unwrap = list => list.map(({ pack: _pack, ...rest }) => rest);
    assert.deepEqual(unwrap(good.pack.screens), unwrap(validatePack(ordinary({ screens: [screen], theme, layouts })).pack.screens), 'and read the same');
    assert.deepEqual(good.pack.theme, theme);
    assert.equal(R.validateRulesPack(withRules({ screens: [screen], theme, layouts })).ok, true, 'standalone too');
    // Where Story Block refuses a screen it refuses it here, with the same code and path.
    for (const [name, change] of [
        ['a script in the template', s => { s.template = '<script>x</script>'; }],
        ['an event attribute', s => { s.template = '<img src=x onerror=a>'; }],
        ['a link in css', s => { s.css = '.a{background:url(javascript:x)}'; }],
        ['a template over 64 KB', s => { s.template = 'x'.repeat(64 * 1024 + 1); }],
    ]) {
        const bad = { ...screen };
        change(bad);
        const there = validatePack(ordinary({ screens: [bad] }));
        assert.equal(there.ok, false, name);
        assert.deepEqual(codes(validatePack(withRules({ screens: [bad] }), { capabilities: null })), codes(there), name);
    }

    // Plain "<" and ">" in prose Story Block owns.
    const prose = [
        ['description', pack => { pack.description = 'a < b and c > d'; }],
        ['author', pack => { pack.author = 'A <B>'; }],
        ['event cue', pack => { pack.content.events = [{ id: 'e', when: 'day > 1', cue: 'a > b', then: [] }]; }],
        ['item note', pack => { pack.content.items = [{ slug: 'rope', name: 'Rope', kind: 'goods', note: 'x > y' }]; pack.content.rules[0].itemRules = [{ def: 'rope', allowedSlots: [], hands: 0, requires: {}, weight: 1, unique: false }]; }],
        ['place name', pack => { pack.content.places[0].name = 'Haven <north>'; }],
        ['place note', pack => { pack.content.places[0].note = '3 < 4'; }],
    ];
    for (const [name, change] of prose) {
        const pack = smallRulesPack();
        change(pack);
        const host = validatePack(clone(pack), { capabilities: null });
        assert.equal(host.ok, true, `${name} through the host: ${codes(host)}`);
        // The same text in an ordinary pack is accepted by Story Block (the manifest is the only difference).
        const plain = clone(pack);
        delete plain.content.rules;
        plain.requires = { storyBlock: '^2' };
        plain.content.creatures = [];
        plain.content.quests = [];
        plain.content.shops = [];
        plain.content.recipes = [];
        assert.equal(validatePack(plain).ok, true, `${name} in an ordinary pack: ${codes(validatePack(plain))}`);
        assert.equal(R.validateRulesPack(clone(pack)).ok, true, `${name} standalone`);
    }
    // Story Block\'s own rule still holds there: a tag that can run code.
    const script = smallRulesPack();
    script.description = '<script>x</script>';
    assert.deepEqual(codes(validatePack(script, { capabilities: null })), [['UNSAFE_HTML', 'description']]);
    // A key with "<" is never a range or a condition: standalone it stays refused.
    const keyed = makeEveryKindPack();
    keyed.content.items[0].effect = { 'a<b': 1 };
    assert.ok(has(R.validateRulesPack(keyed), 'unsafe-markup'));
});
