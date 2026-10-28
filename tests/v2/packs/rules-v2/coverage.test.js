// Coverage for the checker's rules that the first test suite left untested (found by mutation testing),
// the largest legal graph, a pack that uses every kind of effect, transform, objective and requirement,
// and the pinned golden export.
// Run: node --test "tests/v2/packs/rules-v2/*.test.js"

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as R from '../../../../src/v2/packs/rules-v2.js';
import { smallRulesPack } from './fixtures/smallRulesPack.js';
import { makeValidExtendedPack } from './fixtures/builders.js';
import { makeEveryKindPack } from './fixtures/everyKindPack.js';
import { makeTreePack } from './fixtures/treePack.js';

const CODES = R.RULES_V2_ERROR_CODES;
const has = (res, code, path) => res.errors.some(e => e.code === code && (path === undefined || e.path === path));
const show = res => JSON.stringify(res.errors?.slice(0, 4));
const copy = value => JSON.parse(JSON.stringify(value));

// ---------------------------------------------------------------------------------------------
// canonicalizeJson
// ---------------------------------------------------------------------------------------------

test('canonicalizeJson sorts keys at every level, keeps array order, and ignores the order keys were written in', () => {
    const a = { b: 1, a: { y: [{ d: 1, c: 2 }, { f: 0, e: 0 }], x: 0 }, c: [3, 1, 2] };
    const b = { c: [3, 1, 2], a: { x: 0, y: [{ c: 2, d: 1 }, { e: 0, f: 0 }] }, b: 1 };
    const wanted = '{"a":{"x":0,"y":[{"c":2,"d":1},{"e":0,"f":0}]},"b":1,"c":[3,1,2]}';
    assert.equal(JSON.stringify(R.canonicalizeJson(a)), wanted);
    assert.equal(JSON.stringify(R.canonicalizeJson(b)), wanted);
    assert.equal(JSON.stringify(R.canonicalizeJson({ b: 1, a: 1, B: 1, A: 1 })), '{"A":1,"B":1,"a":1,"b":1}');
    assert.deepEqual(R.canonicalizeJson([3, 1, 2]), [3, 1, 2]);
    assert.equal(R.canonicalizeJson(null), null);
    assert.equal(R.canonicalizeJson('x'), 'x');
});

test('exports and hashes do not depend on the order keys are written in at any depth', () => {
    const seeded = seed => () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const shuffle = (value, random) => {
        if (Array.isArray(value)) return value.map(item => shuffle(item, random));
        if (value && typeof value === 'object') {
            const entries = Object.entries(value).map(([key, item]) => [key, shuffle(item, random)]);
            for (let i = entries.length - 1; i > 0; i--) {
                const j = Math.floor(random() * (i + 1));
                [entries[i], entries[j]] = [entries[j], entries[i]];
            }
            return Object.fromEntries(entries);
        }
        return value;
    };
    const pack = makeEveryKindPack();
    const reference = R.exportRulesV2(pack);
    assert.equal(reference.ok, true, show(reference));
    for (let seed = 1; seed <= 5; seed++) {
        const shuffled = R.exportRulesV2(shuffle(pack, seeded(seed)));
        assert.equal(shuffled.text, reference.text);
        assert.equal(shuffled.rulesHash, reference.rulesHash);
        assert.equal(shuffled.packHash, reference.packHash);
    }
    const parsed = JSON.parse(reference.text);
    const sorted = value => {
        if (Array.isArray(value)) return value.every(item => sorted(item));
        if (value && typeof value === 'object') {
            const keys = Object.keys(value);
            return keys.join() === [...keys].sort().join() && Object.values(value).every(item => sorted(item));
        }
        return true;
    };
    assert.ok(sorted(parsed), 'every object in the export has sorted keys');
});

// ---------------------------------------------------------------------------------------------
// class and skill structure
// ---------------------------------------------------------------------------------------------

test('a skill has one owning class', () => {
    const pack = smallRulesPack();
    pack.content.rules[0].classes[1].skills[0] = 's00';
    const res = R.validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === CODES.CLASS_SKILLS && e.path === 'content.rules[0].classes[1].skills[0]' && /already owned by class "c0"/.test(e.message)), show(res));
    assert.ok(has(res, CODES.CLASS_SKILLS, 'content.rules[0].skills[3]'), 'the skill nobody owns now is an orphan');
});

/** Renames a skill everywhere the rules manifest names it. */
function renameSkill(pack, from, to) {
    const rules = pack.content.rules[0];
    for (const cls of rules.classes) cls.skills = cls.skills.map(s => (s === from ? to : s));
    for (const skill of rules.skills) if (skill.slug === from) skill.slug = to;
    for (const branch of rules.branches) {
        if (branch.skill !== from) continue;
        branch.skill = to;
        branch.slug = branch.slug.replace(from, to);
        branch.fromForm = branch.fromForm.replace(from, to);
    }
    return pack;
}

test('a skill slug may have 52 characters and no more', () => {
    for (const from of ['s30', 's00']) {
        const index = smallRulesPack().content.rules[0].skills.findIndex(s => s.slug === from);
        const fits = R.validateRulesPack(renameSkill(smallRulesPack(), from, 'a'.repeat(R.RULES_V2_LIMITS.skillSlug)));
        assert.equal(fits.ok, true, `${from}: ${show(fits)}`);
        const tooLong = R.validateRulesPack(renameSkill(smallRulesPack(), from, 'a'.repeat(R.RULES_V2_LIMITS.skillSlug + 1)));
        assert.equal(tooLong.ok, false, from);
        assert.ok(has(tooLong, CODES.NUMERIC_RANGE, `content.rules[0].skills[${index}].slug`), show(tooLong));
    }
});

test('only advanced (tier 3) skills have branches', () => {
    for (const [slug, tier] of [['s00', 0], ['s10', 1], ['s20', 2]]) {
        const pack = smallRulesPack();
        pack.content.rules[0].branches.push({
            slug: `${slug}-base-a`, name: 'Early branch', skill: slug, fromForm: `${slug}-base`, step: 1, choice: 'a',
            transforms: [{ op: 'set-element', at: 0, value: 'fire' }],
        });
        const res = R.validateRulesPack(pack);
        assert.equal(res.ok, false, slug);
        const index = pack.content.rules[0].skills.findIndex(s => s.slug === slug);
        assert.ok(res.errors.some(e => e.code === CODES.BRANCH_GRAPH && e.path === `content.rules[0].skills[${index}].branches` && new RegExp(`tier ${tier}`).test(e.message)), show(res));
    }
});

test('a summoned or pet unit names a class of this pack', () => {
    const unit = klass => ({ kind: 'summon', class: klass, statShare: 50, poolShare: 50, rounds: 3 });
    const run = klass => {
        const pack = smallRulesPack();
        pack.content.rules[0].skills[3].base.unit = unit(klass);
        return R.validateRulesPack(pack);
    };
    for (const klass of ['c1', 'pack.fixture/c1']) {
        const res = run(klass);
        assert.equal(res.ok, true, `${klass}: ${show(res)}`);
        assert.equal(res.resolved.manifest.skills[3].base.unit.class, 'pack.fixture/c1');
    }
    for (const klass of ['nope', 'pack.other/c1', 's00', 'pack.fixture/s00']) {
        const res = run(klass);
        assert.equal(res.ok, false, klass);
        assert.ok(has(res, CODES.BAD_REF, 'content.rules[0].skills[3].base.unit.class'), `${klass}: ${show(res)}`);
    }
});

test('duplicate slugs are refused in every list', () => {
    const pack = smallRulesPack();
    pack.content.rules[0].classes[1].slug = 'c0';
    assert.ok(has(R.validateRulesPack(pack), CODES.DUP_ID, 'content.rules[0].classes[1].slug'));

    const skills = smallRulesPack();
    skills.content.rules[0].skills[1].slug = 's00';
    assert.ok(has(R.validateRulesPack(skills), CODES.DUP_ID, 'content.rules[0].skills[1].slug'));

    const branches = smallRulesPack();
    branches.content.rules[0].branches[1].slug = branches.content.rules[0].branches[0].slug;
    assert.ok(has(R.validateRulesPack(branches), CODES.DUP_ID, 'content.rules[0].branches[1].slug'));

    const trainers = makeValidExtendedPack();
    trainers.content.rules[0].trainers.push({ ...copy(trainers.content.rules[0].trainers[0]) });
    assert.ok(has(R.validateRulesPack(trainers), CODES.DUP_ID, 'content.rules[0].trainers[1].slug'));

    // Owned content, checked below the pack envelope where Story Block's own duplicate check is not in the way.
    const good = R.normalizeRulesV2(makeEveryKindPack().content.rules[0], { packKey: 'fixture' }).manifest;
    for (const kind of ['items', 'creatures', 'quests', 'shops', 'recipes', 'places']) {
        const content = copy(makeEveryKindPack().content);
        delete content.rules;
        content[kind].push(copy(content[kind][0]));
        const res = R.validateRulesV2(good, content);
        assert.equal(res.ok, false, kind);
        assert.ok(has(res, CODES.DUP_ID, `content.${kind}[${content[kind].length - 1}].slug`), `${kind}: ${show(res)}`);
    }
});

// ---------------------------------------------------------------------------------------------
// effects
// ---------------------------------------------------------------------------------------------

const form = effects => ({ effects });
const cond = (kind, target, chance = 50, rounds = 2) => ({ op: 'condition', target, kind, chance, rounds });

test('harmful conditions target foes and friendly conditions target friends', () => {
    const foes = ['one', 'all'];
    const friends = ['self', 'ally', 'allies'];
    for (const kind of ['poison', 'burn', 'bleed', 'stun', 'daze', 'slow', 'weaken']) {
        for (const target of foes) assert.equal(R.powerScore(form([cond(kind, target)])).ok, true, `${kind} on ${target}`);
        for (const target of friends) {
            const res = R.powerScore(form([cond(kind, target)]));
            assert.ok(has(res, CODES.BAD_EFFECT, 'effects[0].target'), `${kind} on ${target}: ${show(res)}`);
        }
    }
    for (const kind of ['regen', 'guard']) {
        for (const target of friends) assert.equal(R.powerScore(form([cond(kind, target)])).ok, true, `${kind} on ${target}`);
        for (const target of foes) {
            const res = R.powerScore(form([cond(kind, target)]));
            assert.ok(has(res, CODES.BAD_EFFECT, 'effects[0].target'), `${kind} on ${target}: ${show(res)}`);
        }
    }
    assert.ok(has(R.powerScore(form([cond('frozen', 'one')])), CODES.BAD_EFFECT, 'effects[0].kind'));
});

test('condition and stat effects have exact scores and bounds', () => {
    // condition: ceil(chance / 25) * rounds * target factor (1 for one/self/ally, 3 for all/allies)
    assert.equal(R.powerScore(form([cond('poison', 'one', 1, 1)])).score, 1);
    assert.equal(R.powerScore(form([cond('poison', 'one', 25, 1)])).score, 1);
    assert.equal(R.powerScore(form([cond('poison', 'one', 26, 1)])).score, 2);
    assert.equal(R.powerScore(form([cond('poison', 'all', 100, 6)])).score, 72);
    assert.equal(R.powerScore(form([cond('regen', 'ally', 50, 3)])).score, 6);
    assert.equal(R.powerScore(form([cond('regen', 'allies', 50, 3)])).score, 18);
    for (const [chance, rounds] of [[0, 1], [101, 1], [50, 0], [50, 7], [50.5, 1], [50, 1.5]]) {
        assert.ok(has(R.powerScore(form([cond('poison', 'one', chance, rounds)])), CODES.NUMERIC_RANGE), `${chance}/${rounds}`);
    }
    // stat: 2 * |amount| * rounds * factor; a buff targets friends, a debuff foes
    const stat = (target, amount, rounds = 2) => form([{ op: 'stat', target, stat: 'STR', amount, rounds }]);
    assert.equal(R.powerScore(stat('self', 3)).score, 12);
    assert.equal(R.powerScore(stat('allies', 3)).score, 36);
    assert.equal(R.powerScore(stat('one', -3)).score, 12);
    assert.equal(R.powerScore(stat('all', -10, 6)).score, 360);
    assert.ok(has(R.powerScore(stat('one', 3)), CODES.BAD_EFFECT, 'effects[0].target'));
    assert.ok(has(R.powerScore(stat('self', -3)), CODES.BAD_EFFECT, 'effects[0].target'));
    for (const amount of [0, 11, -11, 1.5]) assert.ok(has(R.powerScore(stat('self', amount)), CODES.NUMERIC_RANGE, 'effects[0].amount'), `amount ${amount}`);
    assert.ok(has(R.powerScore(stat('self', 1, 0)), CODES.NUMERIC_RANGE, 'effects[0].rounds'));
    assert.ok(has(R.powerScore(stat('self', 1, 7)), CODES.NUMERIC_RANGE, 'effects[0].rounds'));
});

// ---------------------------------------------------------------------------------------------
// item rules
// ---------------------------------------------------------------------------------------------

function itemRulePack(itemRule, item = {}) {
    const pack = makeValidExtendedPack();
    pack.content.items.push({ slug: 'trinket', name: 'Trinket', kind: 'equipment', rarity: 'common', value: 5, stack: false, slot: 'ring', stats: {}, effect: {}, tags: [], note: '', ...item });
    pack.content.rules[0].itemRules.push({ def: 'trinket', allowedSlots: [], hands: 0, requires: {}, weight: 1, unique: false, ...itemRule });
    return pack;
}
const RULE_PATH = 'content.rules[0].itemRules[3]';

test('items that are not equipment have no slots and no hands', () => {
    const potion = (rule) => { const pack = makeValidExtendedPack(); Object.assign(pack.content.rules[0].itemRules[2], rule); return R.validateRulesPack(pack); };
    assert.equal(potion({}).ok, true);
    for (const hands of [1, 2]) assert.ok(has(potion({ hands }), CODES.ITEM_RULE_MISMATCH, 'content.rules[0].itemRules[2].hands'), `hands ${hands}`);
    assert.ok(has(potion({ allowedSlots: ['head'] }), CODES.ITEM_RULE_MISMATCH, 'content.rules[0].itemRules[2].allowedSlots'));
    const equipment = R.validateRulesPack(itemRulePack({ allowedSlots: [] }));
    assert.ok(has(equipment, CODES.ITEM_RULE_MISMATCH, `${RULE_PATH}.allowedSlots`), show(equipment));
});

test('hand gear needs hands 1 or 2, and two-handed gear takes only the weapon slot', () => {
    const run = (allowedSlots, hands, item) => R.validateRulesPack(itemRulePack({ allowedSlots, hands }, { slot: null, ...item }));
    assert.equal(run(['weapon'], 1).ok, true);
    assert.equal(run(['weapon'], 2).ok, true);
    assert.equal(run(['weapon', 'offhand'], 1).ok, true);
    assert.equal(run(['offhand'], 1).ok, true);
    assert.ok(has(run(['weapon'], 0), CODES.ITEM_RULE_MISMATCH, `${RULE_PATH}.hands`));
    assert.ok(has(run(['offhand'], 0), CODES.ITEM_RULE_MISMATCH, `${RULE_PATH}.hands`));
    assert.ok(has(run(['weapon', 'offhand'], 2), CODES.ITEM_RULE_MISMATCH, `${RULE_PATH}.allowedSlots`));
    assert.ok(has(run(['offhand'], 2), CODES.ITEM_RULE_MISMATCH, `${RULE_PATH}.allowedSlots`));
    assert.ok(has(run(['weapon', 'head'], 1), CODES.ITEM_RULE_MISMATCH, `${RULE_PATH}.allowedSlots`));
    assert.ok(has(run(['head', 'offhand'], 1), CODES.ITEM_RULE_MISMATCH, `${RULE_PATH}.allowedSlots`));
    // Armour and accessories are never hand gear.
    assert.equal(run(['body'], 0).ok, true);
    assert.ok(has(run(['body'], 1), CODES.ITEM_RULE_MISMATCH, `${RULE_PATH}.hands`));
    assert.ok(has(run(['head', 'legs'], 2), CODES.ITEM_RULE_MISMATCH, `${RULE_PATH}.hands`));
    assert.ok(has(R.validateRulesPack(itemRulePack({ allowedSlots: ['weapon'], hands: 3 })), CODES.BAD_SCHEMA));
    assert.ok(has(R.validateRulesPack(itemRulePack({ allowedSlots: ['ring'], hands: 0 })), CODES.BAD_SCHEMA));
});

// ---------------------------------------------------------------------------------------------
// references from another pack
// ---------------------------------------------------------------------------------------------

const rule = pack => pack.content.rules[0];
const FOREIGN_SPOTS = [
    ['class parent', p => { rule(p).classes[1].parent = 'X'; }, CODES.BAD_REF, 'content.rules[0].classes[1].parent'],
    ['class skill', p => { rule(p).classes[0].skills[0] = 'X'; }, CODES.BAD_REF, 'content.rules[0].classes[0].skills[0]'],
    ['skill replaces', p => { rule(p).skills[0].replaces = 'X'; }, CODES.BAD_REF, 'content.rules[0].skills[0].replaces'],
    ['unit class', p => { rule(p).skills.find(s => s.slug === 's12').base.unit.class = 'X'; }, CODES.BAD_REF, 'content.rules[0].skills[5].base.unit.class'],
    ['branch skill', p => { rule(p).branches[0].skill = 'X'; }, CODES.BAD_REF, 'content.rules[0].branches[0].skill'],
    ['branch fromForm', p => { rule(p).branches[0].fromForm = 'X'; }, CODES.BRANCH_GRAPH, 'content.rules[0].branches[0].fromForm'],
    ['item rule def', p => { rule(p).itemRules[0].def = 'X'; }, CODES.BAD_REF, 'content.rules[0].itemRules[0].def'],
    ['trainer skill', p => { rule(p).trainers[0].skills[0] = 'X'; }, CODES.BAD_REF, 'content.rules[0].trainers[0].skills[0]'],
    ['trainer event', p => { rule(p).trainers[0].eventTemplates[0] = 'X'; }, CODES.BAD_REF, 'content.rules[0].trainers[0].eventTemplates[0]'],
    ['creature skill', p => { p.content.creatures[0].skills[0] = 'X'; }, CODES.BAD_REF, 'content.creatures[0].skills[0]'],
    ['creature loot', p => { p.content.creatures[0].loot[0].def = 'X'; }, CODES.BAD_REF, 'content.creatures[0].loot[0].def'],
    ['requirement class', p => { p.content.quests[1].requirements[6].classes[0] = 'X'; }, CODES.BAD_REF, 'content.quests[1].requirements[6].classes[0]'],
    ['requirement item', p => { p.content.quests[1].requirements[3].def = 'X'; }, CODES.BAD_REF, 'content.quests[1].requirements[3].def'],
    ['requirement quest', p => { p.content.quests[1].requirements[2].template = 'X'; }, CODES.BAD_REF, 'content.quests[1].requirements[2].template'],
    ['kill objective', p => { p.content.quests[1].objectives[3].foe = 'X'; }, CODES.BAD_REF, 'content.quests[1].objectives[3].foe'],
    ['collect objective', p => { p.content.quests[1].objectives[0].def = 'X'; }, CODES.BAD_REF, 'content.quests[1].objectives[0].def'],
    ['reward item', p => { p.content.quests[1].reward.items[0].def = 'X'; }, CODES.BAD_REF, 'content.quests[1].reward.items[0].def'],
    ['chain previous', p => { p.content.quests[1].chain.previous = 'X'; }, CODES.BAD_REF, 'content.quests[1].chain.previous'],
    ['chain next', p => { p.content.quests[0].chain.next = 'X'; }, CODES.BAD_REF, 'content.quests[0].chain.next'],
    ['shop stock', p => { p.content.shops[0].stock[0].item = 'X'; }, CODES.BAD_REF, 'content.shops[0].stock[0].item'],
    ['recipe makes', p => { p.content.recipes[0].makes = 'X'; }, CODES.BAD_REF, 'content.recipes[0].makes'],
    ['recipe material', p => { p.content.recipes[0].materials[0].item = 'X'; }, CODES.BAD_REF, 'content.recipes[0].materials[0].item'],
];

test('references to another pack, or to nothing in this pack, are refused everywhere', () => {
    assert.equal(R.validateRulesPack(makeEveryKindPack()).ok, true);
    for (const [label, mutate, code, path] of FOREIGN_SPOTS) {
        for (const ref of ['pack.other/thing', 'pack.fixture/ghost']) {
            const pack = makeEveryKindPack();
            mutate(pack);
            // The placeholder X becomes the reference under test.
            const text = JSON.stringify(pack).replace('"X"', JSON.stringify(ref));
            assert.notEqual(text, JSON.stringify(makeEveryKindPack()), label);
            const res = R.validateRulesPack(text);
            assert.equal(res.ok, false, `${label} -> ${ref}`);
            assert.ok(has(res, code, path), `${label} -> ${ref}: expected ${code} at ${path}, got ${show(res)}`);
        }
    }
});

// ---------------------------------------------------------------------------------------------
// generated forms
// ---------------------------------------------------------------------------------------------

/** A tier 3 skill s30 whose base is one stat or condition effect, with branches that change behaviour. */
function closurePack(effect) {
    const pack = smallRulesPack();
    const rules = pack.content.rules[0];
    const skill = rules.skills.find(s => s.slug === 's30');
    skill.base = { type: 'buff', stat: 'CHA', unit: null, cost: { mp: 3, sp: 0, cooldown: 0 }, effects: [effect] };
    rules.branches = rules.branches.filter(b => b.skill !== 's30');
    const add = (parent, step, choice, transforms) => rules.branches.push({ slug: `${parent}-${choice}`, name: `${parent}-${choice}`, skill: 's30', fromForm: parent, step, choice, transforms });
    add('s30-base', 1, 'a', [{ op: 'add-effect', value: { op: 'damage', target: 'one', power: 10, element: 'none', damageType: 'physical' } }]);
    add('s30-base', 1, 'b', [{ op: 'add-effect', value: { op: 'damage', target: 'one', power: 10, element: 'fire', damageType: 'physical' } }]);
    for (const parent of ['s30-base-g', 's30-base-a', 's30-base-b']) {
        add(parent, 2, 'a', [{ op: 'set-target', at: 0, value: 'ally' }]);
        add(parent, 2, 'b', [{ op: 'set-target', at: 0, value: 'allies' }]);
    }
    return pack;
}
const statEffect = amount => ({ op: 'stat', target: 'self', stat: 'STR', amount, rounds: 1 });
const regen = rounds => ({ op: 'condition', target: 'self', kind: 'regen', chance: 25, rounds });

test('validateRulesV2 reports a generated form that leaves its bounds, from either generation step', () => {
    for (const [label, build, bad] of [
        ['stat amount 10 (generated from the base: 11)', statEffect, 10],
        ['stat amount 9 (generated from the generated parent: 11)', statEffect, 9],
        ['condition rounds 6 (7)', regen, 6],
        ['condition rounds 5 (generated from the generated parent: 7)', regen, 5],
    ]) {
        const res = R.validateRulesPack(closurePack(build(bad)));
        assert.equal(res.ok, false, label);
        const field = build === statEffect ? 'amount' : 'rounds';
        assert.ok(has(res, CODES.BAD_RULES, `effects[0].${field}`), `${label}: ${show(res)}`);
        // The same graph reaches the error through validateRulesV2 and expandRulesV2 as well.
        const norm = R.normalizeRulesV2(closurePack(build(bad)).content.rules[0], { packKey: 'fixture' });
        const content = copy(closurePack(build(bad)).content);
        delete content.rules;
        assert.ok(has(R.validateRulesV2(norm.manifest, content), CODES.BAD_RULES, `effects[0].${field}`), label);
        assert.equal(R.expandRulesV2(norm.manifest, content).ok, false, label);
    }
    for (const [build, fine] of [[statEffect, 8], [regen, 4]]) {
        const res = R.validateRulesPack(closurePack(build(fine)));
        assert.equal(res.ok, true, `${fine}: ${show(res)}`);
    }
});

// ---------------------------------------------------------------------------------------------
// limits and graph size
// ---------------------------------------------------------------------------------------------

test('checkResolvedLimits stops at 2048 forms and 2 MiB, and accepts exactly the limit', () => {
    assert.equal(R.RULES_V2_LIMITS.forms, 2048);
    assert.equal(R.RULES_V2_LIMITS.resolvedBytes, 2 * 1024 * 1024);
    const resolved = { forms: { a: {}, b: {}, c: {} }, pad: '' };
    const bytes = JSON.stringify(resolved).length;
    assert.equal(R.checkResolvedLimits(resolved, { forms: 3, resolvedBytes: bytes }).ok, true);
    const tooManyForms = R.checkResolvedLimits(resolved, { forms: 2, resolvedBytes: bytes });
    assert.ok(has(tooManyForms, CODES.TOO_LARGE, 'forms'), show(tooManyForms));
    const tooManyBytes = R.checkResolvedLimits(resolved, { forms: 3, resolvedBytes: bytes - 1 });
    assert.ok(has(tooManyBytes, CODES.TOO_LARGE, 'resolved'), show(tooManyBytes));
    // Bytes, not characters.
    const wide = { forms: {}, pad: 'éé' };
    assert.equal(R.checkResolvedLimits(wide, { forms: 1, resolvedBytes: JSON.stringify(wide).length }).ok, false);
    assert.equal(R.checkResolvedLimits(wide, { forms: 1, resolvedBytes: JSON.stringify(wide).length + 2 }).ok, true);
    // The default limits are the contract's.
    assert.equal(R.checkResolvedLimits({ forms: {}, pad: '' }).ok, true);
    const manyForms = { forms: Object.fromEntries(Array.from({ length: 2049 }, (_, i) => [`f${i}`, 0])) };
    assert.ok(has(R.checkResolvedLimits(manyForms), CODES.TOO_LARGE, 'forms'));
    delete manyForms.forms.f0;
    assert.equal(R.checkResolvedLimits(manyForms).ok, true);
    const heavy = { forms: {}, pad: 'x'.repeat(2 * 1024 * 1024) };
    assert.ok(has(R.checkResolvedLimits(heavy), CODES.TOO_LARGE, 'resolved'));
});

test('the largest legal tree (40 classes, 120 skills, 888 branches, 1452 forms) validates, expands and exports', () => {
    const pack = makeTreePack(37);
    assert.equal(pack.content.rules[0].classes.length, 40);
    assert.equal(pack.content.rules[0].skills.length, 120);
    const res = R.validateRulesPack(pack);
    assert.equal(res.ok, true, show(res));
    assert.equal(Object.keys(res.resolved.forms).length, 120 + 111 * 12);
    assert.ok(Buffer.byteLength(JSON.stringify(res.resolved)) < R.RULES_V2_LIMITS.resolvedBytes);
    const exported = R.exportRulesV2(pack);
    assert.equal(exported.ok, true, show(exported));
    assert.ok(Buffer.byteLength(exported.text) < R.RULES_V2_LIMITS.packBytes);
    assert.equal(R.exportRulesV2(exported.text).text, exported.text);
});

test('oversized graphs are refused, never truncated', () => {
    const classes = makeTreePack(38);
    const tooManyClasses = R.validateRulesPack(classes);
    assert.equal(classes.content.rules[0].classes.length, 41);
    assert.ok(has(tooManyClasses, CODES.NUMERIC_RANGE, 'content.rules[0].classes'), show(tooManyClasses));

    const skills = makeTreePack(37);
    skills.content.rules[0].skills.push({ ...copy(skills.content.rules[0].skills[0]), slug: 'extra', name: 'Extra' });
    assert.equal(skills.content.rules[0].skills.length, 121);
    assert.ok(has(R.validateRulesPack(skills), CODES.NUMERIC_RANGE, 'content.rules[0].skills'));

    const branches = makeTreePack(37);
    const spare = copy(branches.content.rules[0].branches);
    branches.content.rules[0].branches.push(...spare.slice(0, 113));
    assert.equal(branches.content.rules[0].branches.length, 1001);
    assert.ok(has(R.validateRulesPack(branches), CODES.TOO_LARGE, 'content.rules[0].branches'));

    const trainers = makeTreePack(1);
    trainers.content.rules[0].trainers = Array.from({ length: 101 }, (_, i) => ({
        slug: `t${i}`, name: `Trainer ${i}`, place: 'pack.tree/haven', skills: ['r0s0'], fee: 10, minutes: 60, eventTemplates: [],
    }));
    assert.ok(has(R.validateRulesPack(trainers), CODES.NUMERIC_RANGE, 'content.rules[0].trainers'));
    trainers.content.rules[0].trainers.pop();
    assert.equal(R.validateRulesPack(trainers).ok, true, '100 trainers is the limit');

    const itemRules = makeTreePack(1);
    itemRules.content.rules[0].itemRules = Array.from({ length: 1001 }, (_, i) => ({ def: `i${i}`, allowedSlots: [], hands: 0, requires: {}, weight: 1 }));
    assert.ok(has(R.validateRulesPack(itemRules), CODES.TOO_LARGE, 'content.rules[0].itemRules'));
});

test('a pack object over 512 KiB, and text over 512 KiB, are refused', () => {
    const pack = smallRulesPack();
    pack.content.places = Array.from({ length: 1000 }, (_, i) => ({ slug: `p-${i}`, name: 'Place', x: i, y: 0, note: 'x'.repeat(600) }));
    assert.ok(Buffer.byteLength(JSON.stringify(pack)) > 512 * 1024);
    assert.ok(has(R.validateRulesPack(pack), CODES.TOO_LARGE));
    assert.ok(has(R.validateRulesPack(JSON.stringify(pack)), CODES.TOO_LARGE, ''));
    assert.ok(has(R.validateRulesPack(' '.repeat(512 * 1024 + 1)), CODES.TOO_LARGE));
});

test('circular references are named, shared references are not circular', () => {
    const cyclic = smallRulesPack();
    const node = { a: 1 };
    node.self = node;
    cyclic.content.items = [{ slug: 'loop', name: 'Loop', kind: 'goods', effect: node }];
    const res = R.validateRulesPack(cyclic);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === CODES.BAD_SCHEMA && /Circular reference/.test(e.message) && e.path === 'content.items[0].effect.self'), show(res));

    const arrays = [];
    arrays.push([arrays]);
    const nested = R.canonicalizeJson({ list: arrays });
    assert.ok(nested.errors.some(e => /Circular reference/.test(e.message)), show(nested));

    const manifest = R.normalizeRulesV2(smallRulesPack().content.rules[0], { packKey: 'fixture' }).manifest;
    const cyclicContent = { places: [] };
    cyclicContent.places.push({ slug: 'x', again: cyclicContent });
    assert.ok(R.validateRulesV2(manifest, cyclicContent).errors.some(e => /Circular reference/.test(e.message)));

    // The same object reachable twice is fine.
    const twice = { v: 1 };
    assert.deepEqual(R.canonicalizeJson({ a: twice, b: twice, c: [twice, twice] }), { a: { v: 1 }, b: { v: 1 }, c: [{ v: 1 }, { v: 1 }] });
});

// ---------------------------------------------------------------------------------------------
// hashes
// ---------------------------------------------------------------------------------------------

test('both hashes cover the constants and the schema, recomputed here from the export', () => {
    const exported = R.exportRulesV2(makeEveryKindPack());
    const document = JSON.parse(exported.text);
    const sha = value => R.sha256(JSON.stringify(R.canonicalizeJson(value)));
    const constants = R.RULES_V2_CONSTANTS;
    const schema = R.rulesV2Schema;
    assert.equal(exported.rulesHash, sha({ constants, content: document.content, schema }));
    assert.equal(exported.packHash, sha({ constants, pack: document, schema }));
    assert.notEqual(exported.rulesHash, sha({ constants, content: document.content }), 'dropping the schema changes the hash');
    assert.notEqual(exported.rulesHash, sha({ content: document.content, schema }), 'dropping the constants changes the hash');
    assert.notEqual(exported.packHash, sha({ constants, pack: document }));
    assert.notEqual(exported.packHash, sha({ pack: document, schema }));
    assert.notEqual(exported.rulesHash, sha({ constants: { ...constants, xpPerLevel: 200 }, content: document.content, schema }));
    const altered = copy(document);
    altered.content.rules[0].name = 'Other';
    assert.notEqual(exported.rulesHash, sha({ constants, content: altered.content, schema }));
});

// ---------------------------------------------------------------------------------------------
// a pack that uses everything
// ---------------------------------------------------------------------------------------------

test('every effect kind, unit kind and transform op is exercised by the every-kind pack', () => {
    const res = R.validateRulesPack(makeEveryKindPack());
    assert.equal(res.ok, true, show(res));
    const { manifest, forms } = res.resolved;

    const effectOps = new Set();
    const conditionKinds = new Set();
    const targets = new Set();
    for (const f of Object.values(forms)) {
        for (const e of f.effects) {
            effectOps.add(e.op);
            targets.add(e.target);
            if (e.op === 'condition') conditionKinds.add(e.kind);
        }
        assert.equal(f.powerScore, R.powerScore(f).score, `${f.id} stores its score`);
    }
    assert.deepEqual([...effectOps].sort(), ['condition', 'damage', 'heal', 'shield', 'stat']);
    assert.deepEqual([...targets].sort(), ['all', 'allies', 'ally', 'one', 'self']);
    for (const kind of ['poison', 'bleed', 'stun', 'regen', 'guard']) assert.ok(conditionKinds.has(kind), kind);
    assert.deepEqual(new Set(manifest.skills.filter(s => s.base.unit).map(s => s.base.unit.kind)), new Set(['summon', 'pet']));
    assert.deepEqual(new Set(Object.values(forms).map(f => f.type)), new Set(['physical', 'magic', 'heal', 'buff', 'debuff']));
    assert.deepEqual(
        new Set(manifest.branches.flatMap(b => b.transforms.map(t => t.op))),
        new Set(['set-target', 'set-element', 'set-power', 'replace-effect', 'add-effect', 'remove-effect', 'set-cost', 'set-stat', 'set-type']),
    );
    assert.equal(Object.keys(forms).length, 12 + 3 * 12, '12 bases + 36 descendants of the three advanced skills');
});

test('each transform op produces exactly the form it describes', () => {
    const { forms } = R.validateRulesPack(makeEveryKindPack()).resolved;
    const f = id => forms[`pack.fixture/${id}`];
    const dmg = (power, extra = {}) => ({ op: 'damage', target: 'one', power, element: 'none', damageType: 'physical', ...extra });
    const bleed = { op: 'condition', target: 'one', kind: 'bleed', chance: 50, rounds: 2 };
    const agi = (target = 'one') => ({ op: 'stat', target, stat: 'AGI', amount: -1, rounds: 2 });
    const heal = target => ({ op: 'heal', target, power: 30, element: 'none', damageType: null });
    const expectForm = (id, { type = 'physical', stat = 'STR', cost = { mp: 0, sp: 2, cooldown: 1 }, effects }) => {
        const form = f(id);
        assert.equal(form.type, type, `${id} type`);
        assert.equal(form.stat, stat, `${id} stat`);
        assert.deepEqual(form.cost, cost, `${id} cost`);
        assert.deepEqual(form.effects, effects, `${id} effects`);
    };
    expectForm('s30-base', { effects: [dmg(40), bleed, agi()] });
    expectForm('s30-base-g', { effects: [dmg(60), bleed, agi()] });
    expectForm('s30-base-a', { effects: [dmg(70, { element: 'fire' }), bleed, agi()] });
    expectForm('s30-base-b', { effects: [dmg(40), bleed, heal('self')] });
    expectForm('s30-base-g-a', { effects: [dmg(60, { target: 'all' }), bleed, agi()] });
    expectForm('s30-base-g-b', { effects: [dmg(60), { op: 'condition', target: 'one', kind: 'stun', chance: 25, rounds: 1 }, agi()] });
    expectForm('s30-base-a-a', { stat: 'DEX', effects: [dmg(70, { element: 'fire' }), bleed, agi()] });
    expectForm('s30-base-a-b', { cost: { mp: 0, sp: 5, cooldown: 2 }, effects: [dmg(70, { element: 'fire' }), bleed, agi('all')] });
    expectForm('s30-base-b-a', { type: 'magic', cost: { mp: 6, sp: 0, cooldown: 0 }, effects: [dmg(40), bleed, heal('self')] });
    expectForm('s30-base-b-b', { effects: [dmg(40), bleed, heal('allies')] });
    // Generated forms add 20 to the first power, whatever the parent.
    expectForm('s30-base-a-g', { effects: [dmg(90, { element: 'fire' }), bleed, agi()] });
    expectForm('s30-base-b-g', { effects: [dmg(60), bleed, heal('self')] });
    expectForm('s30-base-g-g', { effects: [dmg(80), bleed, agi()] });
    for (const id of ['s30-base-a', 's30-base-g-b', 's30-base-b-b']) {
        assert.equal(f(id).origin, id.endsWith('-g') ? 'generated' : 'written');
        assert.equal(f(id).name, id);
    }
    assert.equal(f('s30-base-g').origin, 'generated');
    assert.equal(f('s30-base-g-a').fromForm, 'pack.fixture/s30-base-g');
    assert.equal(f('s30-base-g-a').step, 2);
    assert.equal(f('s12-base').unit.kind, 'summon');
    assert.equal(f('s12-base').unit.class, 'pack.fixture/c0');
    assert.equal(f('s20-base').unit.class, 'pack.fixture/c1');
});

test('every quest objective and requirement kind resolves, with external ids reported', () => {
    const res = R.validateRulesPack(makeEveryKindPack());
    assert.equal(res.ok, true, show(res));
    const supply = res.resolved.quests['pack.fixture/supply-run'];
    assert.deepEqual(supply.objectives.map(o => o.kind), ['collect', 'visit', 'story', 'kill']);
    assert.deepEqual(supply.requirements.map(r => r.kind), ['level', 'stat', 'quest', 'item', 'place', 'thread', 'class', 'flag']);
    assert.equal(supply.objectives[0].def, 'pack.fixture/potion');
    assert.equal(supply.objectives[0].consume, true);
    assert.equal(supply.objectives[1].place, 'pl_00000009');
    assert.equal(supply.objectives[3].foe, 'pack.fixture/orc-brute');
    assert.equal(supply.requirements[2].template, 'pack.fixture/scout-threat');
    assert.equal(supply.requirements[3].def, 'pack.fixture/potion');
    assert.equal(supply.requirements[4].place, 'pack.fixture/mill');
    assert.equal(supply.requirements[5].thread, 'th_00000001');
    assert.deepEqual(supply.requirements[6].classes, ['pack.fixture/c0', 'pack.fixture/c1']);
    assert.deepEqual(supply.requirements[7], { kind: 'flag', key: 'met-ranger', value: true });
    assert.equal(supply.giver, 'np_00000007');
    assert.equal(supply.turnInPlace, 'pack.fixture/mill');
    assert.deepEqual(supply.chain, { previous: 'pack.fixture/scout-threat', next: null });
    assert.deepEqual(supply.reward.items.map(i => i.def), ['pack.fixture/potion', 'pack.fixture/dagger']);
    assert.deepEqual(res.warnings.map(w => w.path).sort(), [
        'content.quests[1].giver',
        'content.quests[1].objectives[1].place',
        'content.quests[1].requirements[5].thread',
    ]);
    // The export keeps this pack's own references short and the external ones as written.
    const text = R.exportRulesV2(makeEveryKindPack()).text;
    assert.ok(text.includes('"np_00000007"') && text.includes('"pl_00000009"') && text.includes('"th_00000001"'));
});

// ---------------------------------------------------------------------------------------------
// golden values other tracks consume
// ---------------------------------------------------------------------------------------------

// If one of these changes on purpose, update every consumer of the hash with it.
const GOLDEN = {
    smallRulesPack: { rulesHash: '4350400203831b86069c7e1230894db0524645c2671289cfe251072254d6cd74', packHash: '378883318fde8ee731404fb2fbecb9bb54b09e9d7898078a5f8c1da1ab422fec' },
};

test('golden: smallRulesPack exports these exact bytes and hashes', () => {
    const exported = R.exportRulesV2(smallRulesPack());
    assert.equal(exported.ok, true, show(exported));
    const golden = readFileSync(new URL('./fixtures/golden-small-export.json', import.meta.url), 'utf8');
    assert.equal(exported.text, golden, 'export bytes match the pinned golden file');
    assert.equal(exported.rulesHash, GOLDEN.smallRulesPack.rulesHash);
    assert.equal(exported.packHash, GOLDEN.smallRulesPack.packHash);
    assert.equal(R.validateRulesPack(smallRulesPack()).rulesHash, GOLDEN.smallRulesPack.rulesHash);
    const norm = R.normalizeRulesV2(smallRulesPack().content.rules[0], { packKey: 'fixture' });
    assert.equal(R.expandRulesV2(norm.manifest, smallRulesPack().content).rulesHash, GOLDEN.smallRulesPack.rulesHash);
    // Importing the golden bytes gives the same bytes and hashes back.
    const again = R.exportRulesV2(golden);
    assert.equal(again.text, golden);
    assert.equal(again.rulesHash, GOLDEN.smallRulesPack.rulesHash);
    assert.equal(again.packHash, GOLDEN.smallRulesPack.packHash);
    assert.ok(golden.endsWith('}\n') && !golden.endsWith('\n\n'));
    assert.ok(golden.startsWith('{\n  "content": {'), 'two-space indent, sorted keys');
    assert.equal(Object.keys(R.validateRulesPack(smallRulesPack()).resolved.forms).length, 48);
});
