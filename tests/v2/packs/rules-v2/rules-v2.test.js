// Rules pack v2 engine tests (SPEC §7, §4, §9, §10; pure).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    rulesV2Schema,
    RULES_V2_CONSTANTS,
    RULES_V2_STATS,
    RULES_V2_SLOTS,
    RULES_V2_LIMITS,
    RULES_V2_PROGRESSION,
    RULES_V2_ERROR_CODES,
    normalizeRulesV2,
    validateRulesV2,
    expandRulesV2,
    powerScore,
    generatePowerUp,
    exportRulesV2,
    validateRulesPack,
    budgetOf,
    sha256,
} from '../../../../src/v2/packs/rules-v2.js';

import { smallRulesPack } from './fixtures/smallRulesPack.js';
import { makeValidExtendedPack, makeBrokenPack } from './fixtures/builders.js';

test('SHA-256 standard vectors (browser-compatible, pure JS)', () => {
    assert.equal(sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    assert.equal(
        sha256('The quick brown fox jumps over the lazy dog'),
        'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592'
    );
});

test('golden exact smallRulesPack tree: 4 classes, 12 skills, 24 branches, 48 forms total', () => {
    const pack = smallRulesPack();
    const result = validateRulesPack(pack);

    assert.equal(result.ok, true, 'smallRulesPack must validate cleanly');
    assert.equal(result.errors.length, 0);

    const norm = normalizeRulesV2(pack.content.rules[0], { packKey: pack.id });
    assert.equal(norm.ok, true, 'normalizeRulesV2 must succeed on golden manifest with packKey');

    const exp = expandRulesV2(norm.manifest, pack.content, RULES_V2_CONSTANTS);
    assert.equal(exp.ok, true, 'expandRulesV2 must succeed on golden smallRulesPack');

    const formKeys = Object.keys(exp.resolved.forms);
    // 12 base forms + 36 descendants (24 written + 12 generated) = 48 forms total
    assert.equal(formKeys.length, 48, 'expected exactly 48 forms total (12 base + 36 descendants)');

    // Verify qualified base form IDs
    for (let tier = 0; tier < 4; tier++) {
        for (let s = 0; s < 3; s++) {
            const baseId = `pack.fixture/s${tier}${s}-base`;
            assert.ok(exp.resolved.forms[baseId], `missing base form ${baseId}`);
            assert.equal(exp.resolved.forms[baseId].step, 0);
            assert.equal(exp.resolved.forms[baseId].origin, 'base');
        }
    }

    // Verify step 1 and step 2 generated and written branches for tier 3
    for (let s = 0; s < 3; s++) {
        const slug = `s3${s}`;
        const base = `pack.fixture/${slug}-base`;
        // Step 1
        assert.ok(exp.resolved.forms[`${base}-g`], `missing step 1 g form ${base}-g`);
        assert.ok(exp.resolved.forms[`${base}-a`], `missing step 1 a form ${base}-a`);
        assert.ok(exp.resolved.forms[`${base}-b`], `missing step 1 b form ${base}-b`);

        // Step 2 from g, a, b
        for (const p of [`${base}-g`, `${base}-a`, `${base}-b`]) {
            assert.ok(exp.resolved.forms[`${p}-g`], `missing step 2 g form from ${p}`);
            assert.ok(exp.resolved.forms[`${p}-a`], `missing step 2 a form from ${p}`);
            assert.ok(exp.resolved.forms[`${p}-b`], `missing step 2 b form from ${p}`);
        }
    }

    // Power scores and budget closure check
    for (const [formId, form] of Object.entries(exp.resolved.forms)) {
        assert.ok(typeof form.powerScore === 'number');
        const budget = RULES_V2_CONSTANTS.classBudget[form.tier] + form.step * RULES_V2_CONSTANTS.pathBudgetIncrement;
        assert.ok(form.powerScore <= budget, `form ${formId} score ${form.powerScore} must be <= budget ${budget}`);
    }
});

test('powerScore calculation for every effect variant and unit scoring (+12)', () => {
    // Physical damage: ceil(45/10) * 1 = 5
    const physDmg = {
        effects: [{ op: 'damage', target: 'one', power: 45, element: 'none', damageType: 'physical' }],
        unit: null,
    };
    assert.deepEqual(powerScore(physDmg), { ok: true, score: 5 });

    // Area damage: ceil(45/10) * 3 = 15
    const areaDmg = {
        effects: [{ op: 'damage', target: 'all', power: 45, element: 'fire', damageType: 'magic' }],
        unit: null,
    };
    assert.deepEqual(powerScore(areaDmg), { ok: true, score: 15 });

    // Heal: ceil(25/10) * 1 = 3
    const healForm = {
        effects: [{ op: 'heal', target: 'ally', power: 25, element: 'none', damageType: null }],
        unit: null,
    };
    assert.deepEqual(powerScore(healForm), { ok: true, score: 3 });

    // Shield: ceil(50/10) * 1 = 5
    const shieldForm = {
        effects: [{ op: 'shield', target: 'self', power: 50, element: 'none', damageType: null }],
        unit: null,
    };
    assert.deepEqual(powerScore(shieldForm), { ok: true, score: 5 });

    // Condition: ceil(70/25)*3 * 1 = 3 * 3 = 9
    const condForm = {
        effects: [{ op: 'condition', target: 'one', kind: 'poison', chance: 70, rounds: 3 }],
        unit: null,
    };
    assert.deepEqual(powerScore(condForm), { ok: true, score: 9 });

    // Stat: 2 * abs(3) * 2 = 12
    const statForm = {
        effects: [{ op: 'stat', target: 'self', stat: 'STR', amount: 3, rounds: 2 }],
        unit: null,
    };
    assert.deepEqual(powerScore(statForm), { ok: true, score: 12 });

    // Unit non-null: adds 12 to score
    const unitForm = {
        effects: [{ op: 'damage', target: 'one', power: 20, element: 'none', damageType: 'physical' }],
        unit: { kind: 'summon', class: 'c0', statShare: 50, poolShare: 50, rounds: 10 },
    };
    assert.deepEqual(powerScore(unitForm), { ok: true, score: 14 }); // ceil(20/10)*1 + 12 = 14
});

test('powerScore strict validation rejects invalid effect semantics and unknown fields', () => {
    // Damage targeting self is illegal
    assert.equal(powerScore({
        effects: [{ op: 'damage', target: 'self', power: 20, element: 'none', damageType: 'physical' }],
    }).ok, false);

    // Damage with invalid element is illegal
    assert.equal(powerScore({
        effects: [{ op: 'damage', target: 'one', power: 20, element: 'FAKE', damageType: 'physical' }],
    }).ok, false);

    // Damage with invalid damageType is illegal
    assert.equal(powerScore({
        effects: [{ op: 'damage', target: 'one', power: 20, element: 'none', damageType: 'FAKE' }],
    }).ok, false);

    // Heal with damageType non-null is illegal
    assert.equal(powerScore({
        effects: [{ op: 'heal', target: 'self', power: 20, element: 'none', damageType: 'magic' }],
    }).ok, false);

    // Effect with unknown property is illegal
    assert.equal(powerScore({
        effects: [{ op: 'damage', target: 'one', power: 20, element: 'none', damageType: 'physical', extra: true }],
    }).ok, false);
});

test('deterministic g power-up generation per B3/P06', () => {
    // 1. Adds 20 to first numeric power
    const baseDamageForm = {
        id: 'pack.fixture/s30-base',
        skill: 'pack.fixture/s30',
        name: 'Slash',
        note: '',
        step: 0,
        fromForm: null,
        origin: 'base',
        type: 'physical',
        stat: 'STR',
        cost: { mp: 0, sp: 1, cooldown: 0 },
        effects: [{ op: 'damage', target: 'one', power: 40, element: 'none', damageType: 'physical' }],
        unit: null,
        tier: 3,
    };

    const g1 = generatePowerUp(baseDamageForm, RULES_V2_CONSTANTS);
    assert.equal(g1.ok, true);
    assert.equal(g1.form.id, 'pack.fixture/s30-base-g');
    assert.equal(g1.form.step, 1);
    assert.equal(g1.form.origin, 'generated');
    assert.equal(g1.form.fromForm, 'pack.fixture/s30-base');
    assert.equal(g1.form.effects[0].power, 60);

    // 2. Adds +1 to stat magnitude when no power effect exists
    const baseStatForm = {
        id: 'pack.fixture/s31-base',
        skill: 'pack.fixture/s31',
        name: 'Rally',
        note: '',
        step: 0,
        fromForm: null,
        origin: 'base',
        type: 'buff',
        stat: 'CHA',
        cost: { mp: 10, sp: 0, cooldown: 0 },
        effects: [{ op: 'stat', target: 'self', stat: 'STR', amount: 2, rounds: 2 }],
        unit: null,
        tier: 3,
    };
    const gStat = generatePowerUp(baseStatForm, RULES_V2_CONSTANTS);
    assert.equal(gStat.ok, true);
    assert.equal(gStat.form.effects[0].amount, 3);

    // 3. Adds +1 to condition rounds when no power or stat effect exists
    const baseCondForm = {
        id: 'pack.fixture/s32-base',
        skill: 'pack.fixture/s32',
        name: 'Venom',
        note: '',
        step: 0,
        fromForm: null,
        origin: 'base',
        type: 'debuff',
        stat: 'DEX',
        cost: { mp: 10, sp: 0, cooldown: 0 },
        effects: [{ op: 'condition', target: 'one', kind: 'poison', chance: 50, rounds: 2 }],
        unit: null,
        tier: 3,
    };
    const gCond = generatePowerUp(baseCondForm, RULES_V2_CONSTANTS);
    assert.equal(gCond.ok, true);
    assert.equal(gCond.form.effects[0].rounds, 3);

    // 4. Step 2 parent rejects further power-up returning frozen BAD_RULES contract
    const step2Form = { ...g1.form, step: 2 };
    const g3 = generatePowerUp(step2Form, RULES_V2_CONSTANTS);
    assert.equal(g3.ok, false);
    assert.equal(g3.errors[0].code, RULES_V2_ERROR_CODES.BAD_RULES);

    // 5. Tier 999 or invalid tier returns BAD_RULES rather than falling back
    const badTierForm = { ...baseDamageForm, tier: 999 };
    const gBadTier = generatePowerUp(badTierForm, RULES_V2_CONSTANTS);
    assert.equal(gBadTier.ok, false);
    assert.equal(gBadTier.errors[0].code, RULES_V2_ERROR_CODES.BAD_RULES);
});

test('extended valid pack with renamed statLabels, 2H/dual slots, trainers, foes, quests, shops, recipes', () => {
    const pack = makeValidExtendedPack();
    const res = validateRulesPack(pack);
    assert.equal(res.ok, true, 'extended valid pack must pass validation');
    assert.equal(res.errors.length, 0);

    // Qualified IDs required in resolved maps
    assert.ok(res.resolved.items['pack.fixture/greatsword'], 'resolved must index itemRule greatsword by qualified ID');
    assert.ok(res.resolved.foes['pack.fixture/goblin-scout'], 'resolved must index foe goblin-scout by qualified ID');
    assert.ok(res.resolved.quests['pack.fixture/scout-threat'], 'resolved must index quest scout-threat by qualified ID');
    assert.ok(res.resolved.shops['pack.fixture/haven-armory'], 'resolved must index shop haven-armory by qualified ID');
    assert.ok(res.resolved.recipes['pack.fixture/brew-potion'], 'resolved must index recipe brew-potion by qualified ID');

    // Local slug keys must NOT be present as duplicate map aliases
    assert.equal(res.resolved.items['greatsword'], undefined, 'resolved must NOT store duplicate local alias in items');
    assert.equal(res.resolved.foes['goblin-scout'], undefined, 'resolved must NOT store duplicate local alias in foes');
    assert.equal(res.resolved.quests['scout-threat'], undefined, 'resolved must NOT store duplicate local alias in quests');
    assert.equal(res.resolved.shops['haven-armory'], undefined, 'resolved must NOT store duplicate local alias in shops');
    assert.equal(res.resolved.recipes['brew-potion'], undefined, 'resolved must NOT store duplicate local alias in recipes');

    // Internal references must be qualified
    assert.equal(res.resolved.foes['pack.fixture/goblin-scout'].skills[0], 'pack.fixture/s00');
    assert.equal(res.resolved.foes['pack.fixture/goblin-scout'].loot[0].def, 'pack.fixture/potion');
    assert.equal(res.resolved.shops['pack.fixture/haven-armory'].stock[0].item, 'pack.fixture/greatsword');
    assert.equal(res.resolved.recipes['pack.fixture/brew-potion'].makes, 'pack.fixture/potion');
    assert.equal(res.resolved.recipes['pack.fixture/brew-potion'].known, true);
});

test('external place/NPC references structurally accepted with warnings', () => {
    const pack = makeValidExtendedPack();
    // Quest giver set to external NPC ID, turnInPlace set to external place ID
    pack.content.quests[0].giver = 'np_00000001';
    pack.content.quests[0].turnInPlace = 'pl_00000001';

    const res = validateRulesPack(pack);
    assert.equal(res.ok, true, 'must be accepted structurally');
    assert.ok(res.warnings.length >= 2, 'must report warnings for external IDs');
    assert.ok(res.warnings.some(w => w.path.includes('giver')));
    assert.ok(res.warnings.some(w => w.path.includes('turnInPlace')));
});

test('external place reference with foreign pack.world/haven syntax is accepted with warning', () => {
    const pack = makeValidExtendedPack();
    pack.content.shops[0].place = 'pack.world/haven';

    const res = validateRulesPack(pack);
    assert.equal(res.ok, true, 'foreign SD place ID pack.world/haven must be accepted');
    assert.ok(res.warnings.some(w => w.path.includes('place') && w.message.includes('External place reference')));
});

test('weaker child class is accepted with no strength comparison', () => {
    const pack = smallRulesPack();
    // Child class c1 given weaker damage (power 10) than parent c0 (power 20)
    pack.content.rules[0].skills[3].base.effects[0].power = 10;
    const res = validateRulesPack(pack);
    assert.equal(res.ok, true, 'weaker child class must be accepted without error');
});

test('normalization applies defaults cleanly without mutating inputs', () => {
    const rawManifest = {
        slug: 'rules',
        name: 'Bare Manifest',
        schema: 2,
        classes: [{
            slug: 'c0',
            name: 'Class 0',
            tier: 0,
            parent: null,
            skills: ['s00', 's01', 's02'],
        }],
        skills: [
            { slug: 's00', name: 's00', base: { type: 'physical', stat: 'STR', unit: null, cost: { mp: 0, sp: 1, cooldown: 0 }, effects: [{ op: 'damage', target: 'one', power: 20, element: 'none', damageType: 'physical' }] } },
            { slug: 's01', name: 's01', base: { type: 'physical', stat: 'STR', unit: null, cost: { mp: 0, sp: 1, cooldown: 0 }, effects: [{ op: 'damage', target: 'one', power: 20, element: 'none', damageType: 'physical' }] } },
            { slug: 's02', name: 's02', base: { type: 'physical', stat: 'STR', unit: null, cost: { mp: 0, sp: 1, cooldown: 0 }, effects: [{ op: 'damage', target: 'one', power: 20, element: 'none', damageType: 'physical' }] } },
        ],
        branches: [],
        itemRules: [],
        trainers: [],
    };

    const cloneBefore = JSON.parse(JSON.stringify(rawManifest));
    const norm = normalizeRulesV2(rawManifest, { packKey: 'fixture' });

    assert.equal(norm.ok, true);
    assert.deepEqual(rawManifest, cloneBefore, 'input object must not be mutated');

    assert.equal(norm.manifest.memory, 'deja-vu', 'default memory is deja-vu');
    assert.deepEqual(norm.manifest.statLabels, {}, 'default statLabels is empty object');
    assert.equal(norm.manifest.classes[0].note, '', 'default class note is empty string');
    assert.equal(norm.manifest.skills[0].note, '', 'default skill note is empty string');
    assert.equal(norm.manifest.skills[0].replaces, null, 'default replaces is null');
});

test('canonical roundtrip twice produces exact identical bytes, hash, and preserved array order', () => {
    const pack = makeValidExtendedPack();
    const export1 = exportRulesV2(pack);
    assert.equal(export1.ok, true, 'first export must succeed');

    const parsed1 = JSON.parse(export1.text);
    const export2 = exportRulesV2(parsed1);
    assert.equal(export2.ok, true, 'second export must succeed');

    assert.equal(export1.text, export2.text, 'text must be byte-for-byte identical across roundtrips');
    assert.equal(export1.hash, export2.hash, 'hash must be identical across roundtrips');

    // Verify UTF-8 trailing newline
    assert.ok(export1.text.endsWith('\n'), 'exported text must end with newline');

    // Verify class and skill arrays preserve authored order
    assert.deepEqual(
        parsed1.content.rules[0].classes.map(c => c.slug),
        ['c0', 'c1', 'c2', 'c3'],
        'classes array order must be preserved'
    );
});

test('exportRulesV2 and validateRulesPack produce identical text and hash', () => {
    const pack = makeValidExtendedPack();
    const chk = validateRulesPack(pack);
    assert.equal(chk.ok, true);

    const exp1 = exportRulesV2(pack);
    const exp2 = exportRulesV2(chk.pack);

    assert.equal(exp1.ok, true);
    assert.equal(exp2.ok, true);
    assert.equal(exp1.text, exp2.text, 'text must be identical whether raw or normalized pack is passed');
    assert.equal(exp1.hash, exp2.hash, 'hash must be identical whether raw or normalized pack is passed');
    assert.equal(exp1.hash, chk.hash, 'export hash must match validateRulesPack hash');
});

test('exportRulesV2 preserves literal IDs inside notes/names and does not shorten them', () => {
    const pack = makeValidExtendedPack();
    pack.content.rules[0].classes[0].note = 'See pack.fixture/c0 for full details';
    pack.content.rules[0].classes[0].name = 'Class pack.fixture/c0';

    const exp = exportRulesV2(pack);
    assert.equal(exp.ok, true);
    assert.ok(exp.text.includes('See pack.fixture/c0 for full details'), 'literal reference in note must not be corrupted');
    assert.ok(exp.text.includes('Class pack.fixture/c0'), 'literal reference in name must not be corrupted');
});

test('document hash changes when envelope version or name changes', () => {
    const pack1 = makeValidExtendedPack();
    const res1 = validateRulesPack(pack1);
    assert.equal(res1.ok, true);

    const pack2 = makeValidExtendedPack();
    pack2.version = '2.1.0';
    const res2 = validateRulesPack(pack2);
    assert.equal(res2.ok, true);
    assert.notEqual(res1.hash, res2.hash, 'changing pack version must change document hash');

    const pack3 = makeValidExtendedPack();
    pack3.name = 'Altered Name';
    const res3 = validateRulesPack(pack3);
    assert.equal(res3.ok, true);
    assert.notEqual(res1.hash, res3.hash, 'changing pack name must change document hash');
});

test('budgetOf compatibility stub returns null', () => {
    assert.equal(budgetOf({}), null);
    assert.equal(budgetOf(null), null);
});

// Regression tests for Round 1 & Round 2 probes

test('probe regression: classes[0].skills[0] = "missing" is rejected with BAD_REF and offending path', () => {
    const pack = makeValidExtendedPack();
    pack.content.rules[0].classes[0].skills[0] = 'missing';
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.BAD_REF && e.path.includes('classes[0].skills[0]')));
});

test('probe regression: append orphan unowned skill is rejected with CLASS_SKILLS', () => {
    const { pack } = makeBrokenPack('orphan-skill');
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.CLASS_SKILLS));
});

test('probe regression: branch for nonexistent skill is rejected with BAD_REF', () => {
    const { pack } = makeBrokenPack('unaccounted-branch');
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.BAD_REF && e.path.includes('skill')));
});

test('probe regression: content.whatever = [] is rejected with ENVELOPE_UNKNOWN', () => {
    const pack = makeValidExtendedPack();
    pack.content.whatever = [];
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.ENVELOPE_UNKNOWN && e.path.includes('whatever')));
});

test('probe regression: requires.rpgBattle = "^2" is rejected with ENVELOPE_UNKNOWN', () => {
    const pack = makeValidExtendedPack();
    pack.requires.rpgBattle = '^2';
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.ENVELOPE_UNKNOWN && e.path.includes('rpgBattle')));
});

test('probe regression: version = "nonsense" is rejected with BAD_SCHEMA', () => {
    const pack = makeValidExtendedPack();
    pack.version = 'nonsense';
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.BAD_SCHEMA && e.path.includes('version')));
});

test('probe regression: skill slug "s30-base-g" collides with generated form ID and is rejected with DUP_ID', () => {
    const { pack } = makeBrokenPack('skill-generated-collision');
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.DUP_ID));
});

test('probe regression: item rules must form actual bijection (duplicate rule rejected)', () => {
    const { pack } = makeBrokenPack('item-rule-duplicate');
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.ITEM_RULE_MISMATCH));
});

test('probe regression: caller data purity - recipe.known not written into caller object and objects not frozen', () => {
    const pack = makeValidExtendedPack();
    const callerRecipe = pack.content.recipes[0];
    delete callerRecipe.known; // unassigned
    const callerFoe = pack.content.creatures[0];

    const res = validateRulesPack(pack);
    assert.equal(res.ok, true);

    assert.equal(callerRecipe.known, undefined, 'caller recipe object must not have known=true written into it');
    assert.equal(Object.isFrozen(callerFoe), false, 'caller foe object must not be frozen by validator or expansion');
    assert.equal(Object.isFrozen(pack), false, 'caller pack object must not be frozen');
});

test('probe regression: constants fixed literal fields cannot be overridden', () => {
    const pack = makeValidExtendedPack();
    const res = validateRulesPack(pack, { constants: { classBudget: [999, 999, 999, 999] } });
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.BAD_SCHEMA && e.path.includes('classBudget')));
});

test('probe regression: generatePowerUp({}) does not throw and returns clean error', () => {
    assert.doesNotThrow(() => {
        const res = generatePowerUp({});
        assert.equal(res.ok, false);
        assert.ok(res.errors.length > 0);
    });
});

test('probe regression: intermediate transform type/cost mismatch succeeds when final form is valid', () => {
    const pack = makeValidExtendedPack();
    // Written branch converting physical skill to magic: step 0 sets type to magic (temporary mismatch), step 1 sets cost to mp:10, sp:0
    pack.content.rules[0].branches[0].transforms = [
        { op: 'set-type', value: 'magic' },
        { op: 'set-cost', value: { mp: 10, sp: 0, cooldown: 0 } },
    ];
    const res = validateRulesPack(pack);
    assert.equal(res.ok, true, 'intermediate mismatch must be permitted when final form is valid');
});

test('probe regression: no-op branch transforms are rejected as numeric-only-branch', () => {
    const pack = makeValidExtendedPack();
    // Element is already 'none' on s30-base; setting element to 'none' is a no-op
    pack.content.rules[0].branches[0].transforms = [
        { op: 'set-element', at: 0, value: 'none' },
        { op: 'set-power', at: 0, value: 85 },
    ];
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.NUMERIC_ONLY_BRANCH));
});

test('probe regression: cancelled branch transforms are rejected as numeric-only-branch', () => {
    const pack = makeValidExtendedPack();
    // Sets fire then sets back to none
    pack.content.rules[0].branches[0].transforms = [
        { op: 'set-element', at: 0, value: 'fire' },
        { op: 'set-element', at: 0, value: 'none' },
    ];
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.NUMERIC_ONLY_BRANCH));
});

test('probe regression: safety checks run before stringify without invoking accessors', () => {
    let getterCalled = false;
    const sneakyObject = {
        id: 'fixture',
        version: '2.0.0',
        requires: { storyBlock: '^2', capabilities: ['rb-rules-v2'] },
        content: {
            rules: [{
                slug: 'rules',
                name: 'Sneaky',
                schema: 2,
                get exploit() {
                    getterCalled = true;
                    return 'gotcha';
                },
                classes: [],
                skills: [],
                branches: [],
                itemRules: [],
                trainers: [],
            }],
        },
    };

    const res = validateRulesPack(sneakyObject);
    assert.equal(res.ok, false);
    assert.equal(getterCalled, false, 'accessor getter must never be invoked during safety checks');
});

// Published reachable error codes fixtures

test('error code: ENVELOPE_UNKNOWN', () => {
    const { pack } = makeBrokenPack(RULES_V2_ERROR_CODES.ENVELOPE_UNKNOWN);
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.ENVELOPE_UNKNOWN));
});

test('error code: BAD_CAPABILITY', () => {
    const { pack } = makeBrokenPack(RULES_V2_ERROR_CODES.BAD_CAPABILITY);
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.BAD_CAPABILITY && e.path.includes('capabilities')));
});

test('error code: UNSAFE_MARKUP', () => {
    const { pack } = makeBrokenPack(RULES_V2_ERROR_CODES.UNSAFE_MARKUP);
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.UNSAFE_MARKUP));
});

test('error code: UNSAFE_KEY', () => {
    const { pack } = makeBrokenPack(RULES_V2_ERROR_CODES.UNSAFE_KEY);
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.UNSAFE_KEY));
});

test('error code: CONTROL_CHARACTER', () => {
    const { pack } = makeBrokenPack(RULES_V2_ERROR_CODES.CONTROL_CHARACTER);
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.CONTROL_CHARACTER));
});

test('error code: DUP_ID', () => {
    const { pack } = makeBrokenPack(RULES_V2_ERROR_CODES.DUP_ID);
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.DUP_ID && e.path.includes('skills[1].slug')));
});

test('error code: generated collision with reserved -g suffix', () => {
    const { pack } = makeBrokenPack('generated-collision');
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.DUP_ID && e.path.includes('branches[0].slug')));
});

test('error code: TIER_CHAIN', () => {
    const { pack } = makeBrokenPack(RULES_V2_ERROR_CODES.TIER_CHAIN);
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.TIER_CHAIN && e.path.includes('classes[2].parent')));
});

test('error code: BAD_REF', () => {
    const { pack } = makeBrokenPack(RULES_V2_ERROR_CODES.BAD_REF);
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.BAD_REF && e.path.includes('classes[0].skills[0]')));
});

test('error code: CLASS_SKILLS', () => {
    const { pack } = makeBrokenPack(RULES_V2_ERROR_CODES.CLASS_SKILLS);
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.CLASS_SKILLS && e.path.includes('classes[0].skills')));
});

test('error code: BRANCH_GRAPH', () => {
    const { pack } = makeBrokenPack(RULES_V2_ERROR_CODES.BRANCH_GRAPH);
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.BRANCH_GRAPH));
});

test('error code: NUMERIC_RANGE', () => {
    const { pack } = makeBrokenPack(RULES_V2_ERROR_CODES.NUMERIC_RANGE);
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.NUMERIC_RANGE));
});

test('error code: BAD_TRANSFORM', () => {
    const { pack } = makeBrokenPack(RULES_V2_ERROR_CODES.BAD_TRANSFORM);
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.BAD_TRANSFORM && e.path.includes('branches[0].transforms[0].at')));
});

test('error code: NUMERIC_ONLY_BRANCH', () => {
    const { pack } = makeBrokenPack(RULES_V2_ERROR_CODES.NUMERIC_ONLY_BRANCH);
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.NUMERIC_ONLY_BRANCH));
});

test('error code: BUDGET_CLOSURE', () => {
    const { pack } = makeBrokenPack(RULES_V2_ERROR_CODES.BUDGET_CLOSURE);
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.BUDGET_CLOSURE && e.path.includes('branches[0].powerScore')));
});

test('error code: ITEM_RULE_MISMATCH', () => {
    const { pack } = makeBrokenPack(RULES_V2_ERROR_CODES.ITEM_RULE_MISMATCH);
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.ITEM_RULE_MISMATCH));
});

test('error code: BAD_EFFECT', () => {
    const { pack } = makeBrokenPack(RULES_V2_ERROR_CODES.BAD_EFFECT);
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.BAD_EFFECT && e.path.includes('skills[0].base.effects[0].damageType')));
});

test('error code: MP_SP_CONFLICT', () => {
    const { pack } = makeBrokenPack(RULES_V2_ERROR_CODES.MP_SP_CONFLICT);
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.MP_SP_CONFLICT && e.path.includes('skills[0].base.cost.mp')));
});

test('error code: BAD_XP_PER_LEVEL', () => {
    const { pack, constants } = makeBrokenPack(RULES_V2_ERROR_CODES.BAD_XP_PER_LEVEL);
    const res = validateRulesPack(pack, { constants });
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.BAD_XP_PER_LEVEL && e.path.includes('xpPerLevel')));
});

test('error code: BAD_SCHEMA', () => {
    const { pack } = makeBrokenPack(RULES_V2_ERROR_CODES.BAD_SCHEMA);
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.BAD_SCHEMA));
});

test('error code: TOO_LARGE', () => {
    const hugeString = 'a'.repeat(RULES_V2_LIMITS.packBytes + 10);
    const res = validateRulesPack(hugeString);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.TOO_LARGE));
});

// Newly added contract coverage tests for Monitor Review Round 3

test('closed schema rejects nested id and pack wrappers inside costs, effects, and unit', () => {
    const pack1 = makeValidExtendedPack();
    pack1.content.rules[0].skills[0].base.cost.id = 'leak-id';
    const res1 = validateRulesPack(pack1);
    assert.equal(res1.ok, false);
    assert.ok(res1.errors.some(e => e.code === RULES_V2_ERROR_CODES.ENVELOPE_UNKNOWN && e.path.includes('cost.id')));

    const pack2 = makeValidExtendedPack();
    pack2.content.rules[0].skills[0].base.effects[0].pack = 'leak-pack';
    const res2 = validateRulesPack(pack2);
    assert.equal(res2.ok, false);
    assert.ok(res2.errors.some(e => e.path.includes('effects[0].pack')));
});

test('validateRulesV2 enforces schema: tampering normalized manifest schema=999 or empty classes is rejected', () => {
    const pack = smallRulesPack();
    const norm = normalizeRulesV2(pack.content.rules[0], { packKey: 'fixture' });
    assert.equal(norm.ok, true);

    // Tamper schema version
    const tamperedSchema = { ...norm.manifest, schema: 999 };
    const res1 = validateRulesV2(tamperedSchema, pack.content);
    assert.equal(res1.ok, false);
    assert.ok(res1.errors.some(e => e.path.includes('schema')));

    // Tamper empty classes list
    const tamperedClasses = { ...norm.manifest, classes: [] };
    const res2 = validateRulesV2(tamperedClasses, pack.content);
    assert.equal(res2.ok, false);
    assert.ok(res2.errors.some(e => e.code === RULES_V2_ERROR_CODES.NUMERIC_RANGE && e.path.includes('classes')));

    // Calling validateRulesV2 without normalized pack identity returns clean error without guessing
    const rawWithoutPack = { ...pack.content.rules[0] };
    delete rawWithoutPack.pack;
    const res3 = validateRulesV2(rawWithoutPack, pack.content);
    assert.equal(res3.ok, false);
    assert.ok(res3.errors.some(e => e.path === 'pack'));
});

test('malformed owned content list containers (e.g. non-array string or object) are rejected', () => {
    const pack = makeValidExtendedPack();
    pack.content.creatures = 'not-an-array';
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.BAD_SCHEMA && e.path === 'content.creatures'));
});

test('schema $ref sibling: shop.kind length 41 is rejected despite slug maxLength 64', () => {
    const pack = makeValidExtendedPack();
    pack.content.shops[0].kind = 'a'.repeat(41); // valid slug characters, but length 41 exceeds shop.kind sibling maxLength:40
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.NUMERIC_RANGE && e.path.includes('kind')));

    // Length 40 is accepted
    pack.content.shops[0].kind = 'a'.repeat(40);
    const resValid = validateRulesPack(pack);
    assert.equal(resValid.ok, true);
});

test('class skills: both 2 skills and 4 skills return CLASS_SKILLS', () => {
    const pack2 = makeValidExtendedPack();
    pack2.content.rules[0].classes[0].skills = ['s00', 's01']; // 2 skills
    const res2 = validateRulesPack(pack2);
    assert.equal(res2.ok, false);
    assert.ok(res2.errors.some(e => e.code === RULES_V2_ERROR_CODES.CLASS_SKILLS && e.path.includes('classes[0].skills')));

    const pack4 = makeValidExtendedPack();
    pack4.content.rules[0].classes[0].skills = ['s00', 's01', 's02', 's10']; // 4 skills
    const res4 = validateRulesPack(pack4);
    assert.equal(res4.ok, false);
    assert.ok(res4.errors.some(e => e.code === RULES_V2_ERROR_CODES.CLASS_SKILLS && e.path.includes('classes[0].skills')));
});

test('class skills: duplicate skills return CLASS_SKILLS', () => {
    const pack = makeValidExtendedPack();
    pack.content.rules[0].classes[0].skills = ['s00', 's00', 's02'];
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.CLASS_SKILLS && e.path.includes('classes[0].skills')));
});

test('valid same-pack fully qualified references are accepted cleanly', () => {
    const pack = makeValidExtendedPack();
    pack.content.rules[0].classes[0].skills = [
        'pack.fixture/s00',
        'pack.fixture/s01',
        'pack.fixture/s02',
    ];
    const res = validateRulesPack(pack);
    assert.equal(res.ok, true, 'valid same-pack full references must be accepted');
});

test('foreign internal references are rejected with BAD_REF', () => {
    const pack = makeValidExtendedPack();
    pack.content.rules[0].classes[0].skills[0] = 'pack.other/s00';
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.BAD_REF && e.path.includes('classes[0].skills[0]')));
});

test('collision reservation: class slug matching generated form ID s30-base-g is rejected', () => {
    const pack = makeValidExtendedPack();
    // Rename c2 to s30-base-g and update child parent link
    pack.content.rules[0].classes[2].slug = 's30-base-g';
    pack.content.rules[0].classes[3].parent = 's30-base-g';

    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.DUP_ID && e.path.includes('classes[2].slug')));
});

test('collision reservation: item slug matching generated form ID s30-base-g is rejected', () => {
    const pack = makeValidExtendedPack();
    // Rename potion to s30-base-g and update itemRule
    pack.content.items[2].slug = 's30-base-g';
    pack.content.rules[0].itemRules[2].def = 's30-base-g';

    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.DUP_ID && e.path.includes('items[2].slug')));
});

test('object raw byte size limit: objects exceeding 512 KiB are rejected with TOO_LARGE', () => {
    const pack = makeValidExtendedPack();
    pack.content.rules[0].classes[0].note = 'x'.repeat(200);
    const largeObject = {
        ...pack,
        content: {
            ...pack.content,
            places: Array.from({ length: 500 }, (_, i) => ({
                slug: `place-${i}`,
                name: 'P'.repeat(70),
                note: '界'.repeat(500),
                x: i,
                y: i,
            })),
        },
    };
    assert.ok(Buffer.byteLength(JSON.stringify(largeObject), 'utf8') > 512 * 1024);
    const res = validateRulesPack(largeObject);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.TOO_LARGE));
});

test('safety: depth limit (depth >= 16) is rejected with TOO_LARGE', () => {
    let deep = { value: 1 };
    for (let i = 0; i < 16; i++) {
        deep = { nested: deep };
    }
    const pack = makeValidExtendedPack();
    pack.content.items[0].stats = deep;
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.TOO_LARGE));
});

test('safety: >200 keys halts immediately with TOO_LARGE', () => {
    const hugeKeys = {};
    for (let i = 0; i < 205; i++) {
        hugeKeys[`k${i}`] = i;
    }
    const pack = makeValidExtendedPack();
    pack.content.items[0].stats = hugeKeys;
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.TOO_LARGE));
});

test('safety: arrays with custom non-index properties are rejected with BAD_SCHEMA', () => {
    const pack = makeValidExtendedPack();
    const arr = ['s00', 's01', 's02'];
    arr.customProp = 'forbidden';
    pack.content.rules[0].classes[0].skills = arr;

    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.BAD_SCHEMA));
});

test('static invalid-ref.json fixture fails with intended code and passes after fixing single error', () => {
    const fileUrl = new URL('./fixtures/invalid-ref.json', import.meta.url);
    const jsonText = readFileSync(fileUrl, 'utf8');
    const parsed = JSON.parse(jsonText);

    const res = validateRulesPack(parsed);
    assert.equal(res.ok, false, 'invalid-ref.json must fail validation');
    assert.ok(
        res.errors.some(e => e.code === RULES_V2_ERROR_CODES.BAD_REF && e.path.includes('classes[0].skills[0]')),
        'must fail with BAD_REF at classes[0].skills[0]'
    );

    // Fix the single broken reference
    parsed.content.rules[0].classes[0].skills[0] = 's00';
    const resFixed = validateRulesPack(parsed);
    assert.equal(resFixed.ok, true, 'must validate cleanly with 0 errors after fixing the single broken ref');
    assert.equal(resFixed.errors.length, 0);
});

test('static invalid-tier.json fixture fails with intended code and passes after fixing single error', () => {
    const fileUrl = new URL('./fixtures/invalid-tier.json', import.meta.url);
    const jsonText = readFileSync(fileUrl, 'utf8');
    const parsed = JSON.parse(jsonText);

    const res = validateRulesPack(parsed);
    assert.equal(res.ok, false, 'invalid-tier.json must fail validation');
    assert.ok(
        res.errors.some(e => e.code === RULES_V2_ERROR_CODES.TIER_CHAIN && e.path.includes('classes[2].parent')),
        'must fail with TIER_CHAIN at classes[2].parent'
    );

    // Fix the single broken tier link
    parsed.content.rules[0].classes[2].parent = 'c1';
    const resFixed = validateRulesPack(parsed);
    assert.equal(resFixed.ok, true, 'must validate cleanly with 0 errors after fixing the single broken tier link');
    assert.equal(resFixed.errors.length, 0);
});

test('static valid-pack.json fixture validates cleanly with 0 errors', () => {
    const fileUrl = new URL('./fixtures/valid-pack.json', import.meta.url);
    const jsonText = readFileSync(fileUrl, 'utf8');
    const parsed = JSON.parse(jsonText);

    const res = validateRulesPack(parsed);
    assert.equal(res.ok, true, 'static valid-pack.json must validate cleanly');
    assert.equal(res.errors.length, 0);
});

test('regression: fixture validity before negative mutations', () => {
    const pack = makeValidExtendedPack();
    const res = validateRulesPack(pack);
    assert.equal(res.ok, true, 'base makeValidExtendedPack fixture must be completely valid before mutations');
    assert.equal(res.errors.length, 0);
    assert.ok(res.pack);
    assert.ok(res.resolved);
    assert.ok(typeof res.hash === 'string' && res.hash.length === 64);
});

test('regression: normalized-vs-raw export bytes and hash equivalence with missing defaults, CRLF, and un-trimmed strings', () => {
    const rawPack = makeValidExtendedPack();
    // Omit optional fields that have defaults
    delete rawPack.content.rules[0].statLabels;
    delete rawPack.content.rules[0].memory;
    for (const c of rawPack.content.rules[0].classes) delete c.note;
    for (const s of rawPack.content.rules[0].skills) {
        delete s.note;
        delete s.replaces;
    }
    for (const b of rawPack.content.rules[0].branches) delete b.note;
    for (const ir of rawPack.content.rules[0].itemRules) delete ir.unique;
    for (const r of rawPack.content.recipes) delete r.known;

    // Inject unnormalized strings (CRLF, untrimmed whitespace, decomposed Unicode)
    rawPack.name = '  Fixture \r\n Pack  ';
    rawPack.content.rules[0].name = '  Rules \r\n Name  ';
    rawPack.content.items[0].note = 'Note line 1\r\nline 2  ';
    rawPack.content.items[0].name = '  P\u006f\u0301tion  '; // decomposed ó

    const chk = validateRulesPack(rawPack);
    assert.equal(chk.ok, true, 'raw pack with missing defaults and unnormalized strings must validate cleanly');
    assert.equal(chk.errors.length, 0);

    const expRaw = exportRulesV2(rawPack);
    const expNorm = exportRulesV2(chk.pack);

    assert.equal(expRaw.ok, true, 'export of raw pack must succeed');
    assert.equal(expNorm.ok, true, 'export of normalized pack must succeed');
    assert.equal(expRaw.text, expNorm.text, 'exported text must be byte-for-byte identical between raw and normalized inputs');
    assert.equal(expRaw.hash, expNorm.hash, 'exported hash must be identical between raw and normalized inputs');
    assert.equal(expRaw.hash, chk.hash, 'exported hash must match validateRulesPack hash');

    // Roundtrip parsed export through exportRulesV2 again
    const parsed = JSON.parse(expRaw.text);
    const expRoundtrip = exportRulesV2(parsed);
    assert.equal(expRoundtrip.ok, true);
    assert.equal(expRoundtrip.text, expRaw.text, 'roundtrip re-export must produce identical text');
    assert.equal(expRoundtrip.hash, expRaw.hash, 'roundtrip re-export must produce identical hash');
});

test('regression: NFC, whitespace trim, and CRLF line ending normalization across envelope and owned records', () => {
    const pack = makeValidExtendedPack();
    pack.name = '  Extended \r\n Pack  ';
    pack.description = 'Desc\r\nline2';
    pack.content.rules[0].name = '  Rules \r\n Manifest  ';
    pack.content.rules[0].classes[0].name = '  Class \u0061\u0300  '; // decomposed à
    pack.content.rules[0].classes[0].note = '  C0 note\r\nline2  ';
    pack.content.rules[0].skills[0].name = '  Skill \u0065\u0301  '; // decomposed é
    pack.content.rules[0].skills[0].note = '  Skill note\r\nline2  ';
    pack.content.rules[0].branches[0].name = '  Branch \u0069\u0302  '; // decomposed î
    pack.content.rules[0].branches[0].note = '  Branch note\r\nline2  ';
    pack.content.items[0].name = '  Iron \u0053\u0077\u006f\u0072\u0064  ';
    pack.content.items[0].note = '  Sword note\r\nline2  ';
    pack.content.creatures[0].name = '  Goblin \r\n Scout  ';
    pack.content.quests[0].name = '  Scout \r\n Quest  ';
    pack.content.shops[0].name = '  Armory \r\n Shop  ';
    pack.content.recipes[0].name = '  Potion \r\n Recipe  ';
    pack.content.places[0].name = '  Haven \r\n Town  ';
    pack.content.rules[0].trainers[0].name = '  Master \r\n Blade  ';

    const res = validateRulesPack(pack);
    assert.equal(res.ok, true);
    assert.equal(res.errors.length, 0);

    // Verify envelope strings normalized
    assert.equal(res.pack.name, 'Extended \n Pack');
    assert.equal(res.pack.description, 'Desc\nline2');
    assert.equal(res.pack.content.rules[0].name, 'Rules \n Manifest');

    // Verify owned records NFC and whitespace trim
    assert.equal(res.pack.content.rules[0].classes[0].name, 'Class \u00e0');
    assert.equal(res.pack.content.rules[0].classes[0].note, 'C0 note\nline2');
    assert.equal(res.pack.content.rules[0].skills[0].name, 'Skill \u00e9');
    assert.equal(res.pack.content.rules[0].skills[0].note, 'Skill note\nline2');
    assert.equal(res.pack.content.rules[0].branches[0].name, 'Branch \u00ee');
    assert.equal(res.pack.content.rules[0].branches[0].note, 'Branch note\nline2');
    assert.equal(res.pack.content.items[0].name, 'Iron Sword');
    assert.equal(res.pack.content.items[0].note, 'Sword note\nline2');
    assert.equal(res.pack.content.creatures[0].name, 'Goblin \n Scout');
    assert.equal(res.pack.content.quests[0].name, 'Scout \n Quest');
    assert.equal(res.pack.content.shops[0].name, 'Armory \n Shop');
    assert.equal(res.pack.content.recipes[0].name, 'Potion \n Recipe');
    assert.equal(res.pack.content.places[0].name, 'Haven \n Town');
    assert.equal(res.pack.content.rules[0].trainers[0].name, 'Master \n Blade');

    const exported = exportRulesV2(pack);
    assert.equal(exported.ok, true);
    assert.ok(!exported.text.includes('\r\n'), 'exported text must not contain carriage returns');
});

test('regression: section 10 D - generated-parent step2 branch expands and stays within budget', () => {
    const pack = smallRulesPack();
    const res = validateRulesPack(pack);
    assert.equal(res.ok, true);

    const norm = normalizeRulesV2(pack.content.rules[0], { packKey: pack.id });
    const exp = expandRulesV2(norm.manifest, pack.content, RULES_V2_CONSTANTS);
    assert.equal(exp.ok, true);

    // Verify step 1 generated parent exists
    const genParentId = 'pack.fixture/s30-base-g';
    assert.ok(exp.resolved.forms[genParentId], 'step 1 generated parent must exist');
    assert.equal(exp.resolved.forms[genParentId].step, 1);
    assert.equal(exp.resolved.forms[genParentId].origin, 'generated');
    assert.equal(exp.resolved.forms[genParentId].fromForm, 'pack.fixture/s30-base');

    // Verify step 2 written branches from generated parent exist
    const step2WrittenA = 'pack.fixture/s30-base-g-a';
    const step2WrittenB = 'pack.fixture/s30-base-g-b';
    assert.ok(exp.resolved.forms[step2WrittenA], 'step 2 written branch a from generated parent must exist');
    assert.equal(exp.resolved.forms[step2WrittenA].step, 2);
    assert.equal(exp.resolved.forms[step2WrittenA].origin, 'written');
    assert.equal(exp.resolved.forms[step2WrittenA].fromForm, genParentId);

    assert.ok(exp.resolved.forms[step2WrittenB], 'step 2 written branch b from generated parent must exist');
    assert.equal(exp.resolved.forms[step2WrittenB].step, 2);
    assert.equal(exp.resolved.forms[step2WrittenB].origin, 'written');
    assert.equal(exp.resolved.forms[step2WrittenB].fromForm, genParentId);

    // Verify step 2 generated branch from generated parent exists
    const step2GenG = 'pack.fixture/s30-base-g-g';
    assert.ok(exp.resolved.forms[step2GenG], 'step 2 generated branch g from generated parent must exist');
    assert.equal(exp.resolved.forms[step2GenG].step, 2);
    assert.equal(exp.resolved.forms[step2GenG].origin, 'generated');
    assert.equal(exp.resolved.forms[step2GenG].fromForm, genParentId);

    // Verify budget closure at step 2 (48 + 2 * 12 = 72)
    const step2Budget = RULES_V2_CONSTANTS.classBudget[3] + 2 * RULES_V2_CONSTANTS.pathBudgetIncrement;
    assert.equal(step2Budget, 72);
    assert.ok(exp.resolved.forms[step2WrittenA].powerScore <= step2Budget);
    assert.ok(exp.resolved.forms[step2WrittenB].powerScore <= step2Budget);
    assert.ok(exp.resolved.forms[step2GenG].powerScore <= step2Budget);
});

test('regression: section 10 D - 12-versus-24 written graph rejects missing step 2 branches with BRANCH_GRAPH', () => {
    assert.equal(makeValidExtendedPack().content.rules[0].branches.length, 24);
    const { pack } = makeBrokenPack('missing-step2-branch');
    assert.equal(pack.content.rules[0].branches.length, 12);
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(
        res.errors.some(e => e.code === RULES_V2_ERROR_CODES.BRANCH_GRAPH && e.path.includes('branches')),
        'missing step 2 branch must fail with BRANCH_GRAPH'
    );
});

test('regression: section 10 D - class hierarchy failures (cycle, leaf not tier 3, root not tier 0, orphan) reject with TIER_CHAIN', () => {
    // Cycle in classes (c1 <-> c2)
    const { pack: packCycle } = makeBrokenPack('cycle-class');
    const resCycle = validateRulesPack(packCycle);
    assert.equal(resCycle.ok, false);
    assert.ok(resCycle.errors.some(e => e.code === RULES_V2_ERROR_CODES.TIER_CHAIN));

    // Leaf class not tier 3
    const { pack: packLeaf } = makeBrokenPack('leaf-not-tier3');
    const resLeaf = validateRulesPack(packLeaf);
    assert.equal(resLeaf.ok, false);
    assert.ok(resLeaf.errors.some(e => e.code === RULES_V2_ERROR_CODES.TIER_CHAIN));

    // Root class not tier 0
    const { pack: packRoot } = makeBrokenPack('root-not-tier0');
    const resRoot = validateRulesPack(packRoot);
    assert.equal(resRoot.ok, false);
    assert.ok(resRoot.errors.some(e => e.code === RULES_V2_ERROR_CODES.TIER_CHAIN));

    // Orphan class pointing to nonexistent class
    const { pack: packOrphan } = makeBrokenPack('orphan-class');
    const resOrphan = validateRulesPack(packOrphan);
    assert.equal(resOrphan.ok, false);
    assert.ok(resOrphan.errors.some(e => e.code === RULES_V2_ERROR_CODES.TIER_CHAIN || e.code === RULES_V2_ERROR_CODES.BAD_REF));
});

test('regression: section 10 D - item rule failures (2H offhand and non-equip slots) reject with ITEM_RULE_MISMATCH', () => {
    // 2H weapon occupying offhand
    const { pack: pack2H } = makeBrokenPack('item-rule-2h-offhand');
    const res2H = validateRulesPack(pack2H);
    assert.equal(res2H.ok, false);
    assert.ok(res2H.errors.some(e => e.code === RULES_V2_ERROR_CODES.ITEM_RULE_MISMATCH));

    // Non-equipment consumable item with allowedSlots
    const { pack: packNonEquip } = makeBrokenPack('item-rule-non-equip-slot');
    const resNonEquip = validateRulesPack(packNonEquip);
    assert.equal(resNonEquip.ok, false);
    assert.ok(resNonEquip.errors.some(e => e.code === RULES_V2_ERROR_CODES.ITEM_RULE_MISMATCH));
});

test('regression: section 10 D - unknown kind in content rejects with ENVELOPE_UNKNOWN', () => {
    const { pack } = makeBrokenPack('unknown-kind');
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.code === RULES_V2_ERROR_CODES.ENVELOPE_UNKNOWN && e.path.includes('unknownKind')));
});

test('regression: section 10 D - defaults application across envelope and owned records', () => {
    const pack = makeValidExtendedPack();
    delete pack.content.rules[0].statLabels;
    delete pack.content.rules[0].memory;
    delete pack.content.rules[0].classes[0].note;
    delete pack.content.rules[0].skills[0].note;
    delete pack.content.rules[0].skills[0].replaces;
    delete pack.content.rules[0].branches[0].note;
    delete pack.content.rules[0].itemRules[0].unique;
    delete pack.content.recipes[0].known;

    const res = validateRulesPack(pack);
    assert.equal(res.ok, true);

    assert.deepEqual(res.pack.content.rules[0].statLabels, {});
    assert.equal(res.pack.content.rules[0].memory, 'deja-vu');
    assert.equal(res.pack.content.rules[0].classes[0].note, '');
    assert.equal(res.pack.content.rules[0].skills[0].note, '');
    assert.equal(res.pack.content.rules[0].skills[0].replaces, null);
    assert.equal(res.pack.content.rules[0].branches[0].note, '');
    assert.equal(res.pack.content.rules[0].itemRules[0].unique, false);
    assert.equal(res.pack.content.recipes[0].known, true);
    assert.equal(res.resolved.recipes['pack.fixture/brew-potion'].known, true);
});

test('bad inputs never throw and return clean error result across all public APIs', () => {
    const circular = {};
    circular.self = circular;

    const badInputs = [
        null,
        undefined,
        42,
        -1,
        0,
        3.14,
        NaN,
        Infinity,
        -Infinity,
        '',
        'not-json',
        '{ bad json',
        true,
        false,
        Symbol('sym'),
        () => {},
        [],
        [1, 2, 3],
        {},
        { id: 123 },
        circular,
        Object.create(null),
    ];

    for (const [caseIndex, bad] of badInputs.entries()) {
        assert.doesNotThrow(() => {
            const res = validateRulesPack(bad);
            assert.equal(res.ok, false);
            assert.ok(Array.isArray(res.errors));
        }, `validateRulesPack threw on: ${caseIndex}`);

        assert.doesNotThrow(() => {
            const res = normalizeRulesV2(bad, { packKey: 'fixture' });
            assert.equal(res.ok, false);
            assert.ok(Array.isArray(res.errors));
        }, `normalizeRulesV2 threw on: ${caseIndex}`);

        assert.doesNotThrow(() => {
            const res = validateRulesV2(bad, {}, RULES_V2_CONSTANTS);
            assert.equal(res.ok, false);
            assert.ok(Array.isArray(res.errors));
        }, `validateRulesV2 threw on: ${caseIndex}`);

        assert.doesNotThrow(() => {
            const res = expandRulesV2(bad, {}, RULES_V2_CONSTANTS);
            assert.equal(res.ok, false);
            assert.ok(Array.isArray(res.errors));
        }, `expandRulesV2 threw on: ${caseIndex}`);

        assert.doesNotThrow(() => {
            const res = exportRulesV2(bad);
            assert.equal(res.ok, false);
            if (!res.ok) assert.ok(Array.isArray(res.errors));
        }, `exportRulesV2 threw on: ${caseIndex}`);

        assert.doesNotThrow(() => {
            const res = powerScore(bad);
            assert.equal(res.ok, false);
            if (!res.ok) assert.ok(Array.isArray(res.errors));
        }, `powerScore threw on: ${caseIndex}`);

        assert.doesNotThrow(() => {
            const res = generatePowerUp(bad);
            assert.equal(res.ok, false);
            if (!res.ok) assert.ok(Array.isArray(res.errors));
        }, `generatePowerUp threw on: ${caseIndex}`);
    }
});

test.skip('Story Block host import integration with rules pack (track E rules registration pending)', () => {
    // Registered rules pack kind in SB's pack loader is track E work.
    // Studio part 1 checker runs directly without dispatching rules through old loader.
});


test('expansion bytes, IDs, forms and hash are stable twice and across two export round trips', () => {
    for (const seed of [smallRulesPack(), makeValidExtendedPack()]) {
        const expand = pack => {
            const norm = normalizeRulesV2(pack.content.rules[0], { packKey: pack.id });
            assert.equal(norm.ok, true);
            const result = expandRulesV2(norm.manifest, pack.content);
            assert.equal(result.ok, true, JSON.stringify(result.errors));
            return result;
        };
        const first = expand(seed);
        assert.equal(JSON.stringify(expand(seed)), JSON.stringify(first));
        let pack = seed;
        let previousExport;
        for (let run = 0; run < 2; run++) {
            const exported = exportRulesV2(pack);
            assert.equal(exported.ok, true);
            if (previousExport) assert.deepEqual(exported, previousExport);
            previousExport = exported;
            pack = JSON.parse(exported.text);
            assert.equal(JSON.stringify(expand(pack)), JSON.stringify(first));
        }
    }
});

test('every written branch names the exact preceding parent in its own skill', () => {
    const cases = [
        ['step one from written child', 0, 's30-base-a'],
        ['step one from generated child', 0, 's30-base-g'],
        ['step one from another skill', 0, 's31-base'],
        ['missing parent', 0, 'missing'],
        ['foreign parent', 0, 'pack.other/s30-base'],
        ['step two from base', 2, 's30-base'],
        ['step two from grandchild', 2, 's30-base-g-g'],
        ['step two from another skill', 2, 's31-base-g'],
        ['step two missing generated parent', 2, 's30-base-missing'],
    ];
    for (const [label, index, parent] of cases) {
        const pack = smallRulesPack();
        assert.equal(validateRulesPack(pack).ok, true);
        pack.content.rules[0].branches[index].fromForm = parent;
        const result = validateRulesPack(pack);
        assert.equal(result.ok, false, label);
        assert.ok(result.errors.some(error => error.path === `content.rules[0].branches[${index}].fromForm`), label);
    }
    for (const parent of ['g', 'a', 'b']) {
        const pack = smallRulesPack();
        pack.content.rules[0].branches = pack.content.rules[0].branches.filter(branch => branch.fromForm !== `s30-base-${parent}`);
        assert.equal(validateRulesPack(pack).ok, false, `missing step two from ${parent}`);
    }
});

test('generation validates the complete parent and its own budget before making a child', () => {
    const valid = validateRulesPack(smallRulesPack());
    assert.equal(valid.ok, true);
    const base = valid.resolved.forms['pack.fixture/s30-base'];
    assert.equal(generatePowerUp(base).ok, true);
    const cases = [
        ['id', 'bad id'], ['skill', 'bad id'], ['type', 'invalid'], ['stat', 'INVALID'],
        ['cost', { mp: 900, sp: 900, cooldown: 99 }],
        ['cost', { mp: 1, sp: 1, cooldown: 0 }], ['cost', { mp: 0, sp: 1 }],
        ['tier', 2.5], ['tier', 2], ['step', 0.5], ['step', 2],
        ['name', '<bad>'], ['note', 'x'.repeat(241)], ['unit', { kind: 'invalid' }],
        ['fromForm', 'pack.fixture/s31-base'], ['origin', 'generated'],
        ['effects', [{ op: 'damage', target: 'one', power: 490, element: 'none', damageType: 'physical' }]],
        ['powerScore', 0], ['unknown', true],
    ];
    for (const [key, value] of cases) {
        const result = generatePowerUp({ ...base, [key]: value });
        assert.equal(result.ok, false, key);
        assert.ok(result.errors.every(error => error.code === 'bad-rules'), key);
    }
    const generated = generatePowerUp(base).form;
    for (const mutation of [
        { fromForm: 'pack.fixture/s31-base' }, { id: 'pack.fixture/s30-base-a' }, { origin: 'base' },
    ]) assert.equal(generatePowerUp({ ...generated, ...mutation }).ok, false);
    assert.equal(generatePowerUp(generated).ok, true);
    const written = valid.resolved.forms['pack.fixture/s30-base-a'];
    assert.equal(generatePowerUp(written).ok, true);
    assert.equal(generatePowerUp({ ...written, id: 'pack.fixture/s30-base-g' }).ok, false);
});

test('authored legendary items pass; form rarity/provenance cannot be injected at the closed authoring boundary', () => {
    const pack = makeValidExtendedPack();
    pack.content.items[0].rarity = 'legendary';
    assert.equal(validateRulesPack(pack).ok, true);
    // Runtime generated item registration belongs to B3. Forms have no rarity field.
    const validForm = validateRulesPack(pack).resolved.forms['pack.fixture/s30-base-g'];
    assert.equal(generatePowerUp(validForm).ok, true);
    assert.equal(generatePowerUp({ ...validForm, rarity: 'legendary' }).ok, false);
    pack.content.items[0].origin = 'generated';
    assert.equal(validateRulesPack(pack).ok, false);
});

test('static broken tier fixture has only the intended tier-chain defect', () => {
    const pack = JSON.parse(readFileSync(new URL('./fixtures/broken-tier-chain.json', import.meta.url), 'utf8'));
    assert.equal(validateRulesPack(pack).ok, false);
    pack.content.rules[0].classes[2].parent = 'c1';
    assert.equal(validateRulesPack(pack).ok, true);
});


test('direct generation reserves SB slug space for the complete two-step graph', () => {
    const base = validateRulesPack(smallRulesPack()).resolved.forms['pack.fixture/s30-base'];
    const make = length => {
        const skill = `pack.fixture/${'s'.repeat(length)}`;
        return { ...base, skill, id: `${skill}-base` };
    };
    const first = generatePowerUp(make(52));
    assert.equal(first.ok, true);
    const second = generatePowerUp(first.form);
    assert.equal(second.ok, true);
    assert.ok(second.form.id.split('/')[1].length <= 64);
    const invalid = generatePowerUp(make(53));
    assert.equal(invalid.ok, false);
    assert.ok(invalid.errors.some(error => error.code === 'bad-rules' && error.path === 'skill'));
});


test('canonical export refuses formatting that would exceed the raw file boundary', () => {
    const pack = smallRulesPack();
    pack.content.places = Array.from({ length: 900 }, (_, index) => ({
        slug: `p-${index}`, name: 'Place', x: index, y: 0, note: 'x'.repeat(480),
    }));
    assert.ok(Buffer.byteLength(JSON.stringify(pack)) < 512 * 1024);
    assert.equal(validateRulesPack(pack).ok, true);
    const exported = exportRulesV2(pack);
    assert.equal(exported.ok, false);
    assert.ok(exported.errors.some(error => error.code === 'too-large'));
});
