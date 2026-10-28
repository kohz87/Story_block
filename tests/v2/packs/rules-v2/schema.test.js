// Rules pack v2 schema data tests (SPEC §7, §4; pure).
// Run: node --test "tests/v2/packs/rules-v2/*.test.js"

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
} from '../../../../src/v2/packs/rules-v2.js';

test('JSON artifact deep equality with exported schema', () => {
    const fileUrl = new URL('../../../../src/v2/packs/rules-v2.schema.json', import.meta.url);
    const jsonText = readFileSync(fileUrl, 'utf8');
    const parsed = JSON.parse(jsonText);

    assert.deepEqual(rulesV2Schema, parsed, 'exported rulesV2Schema must be deeply equal to rules-v2.schema.json');
    assert.equal(rulesV2Schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(rulesV2Schema.$id, 'urn:story-suite:rb-rules-v2:manifest');
    assert.equal(rulesV2Schema.type, 'object');
    assert.equal(rulesV2Schema.additionalProperties, false);
});

test('recursive freeze including nested objects and arrays', () => {
    function assertRecursivelyFrozen(obj, path = 'root') {
        if (obj === null || typeof obj !== 'object') return;
        assert.ok(Object.isFrozen(obj), `expected ${path} to be frozen`);
        if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) {
                assertRecursivelyFrozen(obj[i], `${path}[${i}]`);
            }
        } else {
            for (const [key, value] of Object.entries(obj)) {
                assertRecursivelyFrozen(value, `${path}.${key}`);
            }
        }
    }

    assertRecursivelyFrozen(rulesV2Schema, 'rulesV2Schema');
    assert.ok(Object.isFrozen(rulesV2Schema.required), 'required array is frozen');
    assert.ok(Object.isFrozen(rulesV2Schema.properties.classes), 'classes property is frozen');
    assert.ok(Object.isFrozen(rulesV2Schema.$defs.stat.enum), 'stat enum array is frozen');

    assert.throws(() => {
        rulesV2Schema.additionalProperties = true;
    }, TypeError, 'mutating rulesV2Schema must throw in strict mode');

    assert.throws(() => {
        rulesV2Schema.required.push('extra');
    }, TypeError, 'mutating rulesV2Schema.required array must throw');

    assertRecursivelyFrozen(RULES_V2_CONSTANTS, 'RULES_V2_CONSTANTS');
    assert.ok(Object.isFrozen(RULES_V2_CONSTANTS.masteryAt), 'masteryAt array is frozen');
    assert.ok(Object.isFrozen(RULES_V2_CONSTANTS.promotionMilestones), 'promotionMilestones array is frozen');
    assert.ok(Object.isFrozen(RULES_V2_CONSTANTS.pathMilestones), 'pathMilestones array is frozen');
    assert.ok(Object.isFrozen(RULES_V2_CONSTANTS.classBudget), 'classBudget array is frozen');

    assert.throws(() => {
        RULES_V2_CONSTANTS.levelCap = 100;
    }, TypeError, 'mutating RULES_V2_CONSTANTS must throw');

    assert.throws(() => {
        RULES_V2_CONSTANTS.masteryAt.push(50);
    }, TypeError, 'mutating RULES_V2_CONSTANTS.masteryAt array must throw');

    assertRecursivelyFrozen(RULES_V2_STATS, 'RULES_V2_STATS');
    assert.throws(() => {
        RULES_V2_STATS.push('EXTRA');
    }, TypeError, 'mutating RULES_V2_STATS must throw');

    assertRecursivelyFrozen(RULES_V2_SLOTS, 'RULES_V2_SLOTS');
    assert.throws(() => {
        RULES_V2_SLOTS[0] = 'main-hand';
    }, TypeError, 'mutating RULES_V2_SLOTS must throw');

    assertRecursivelyFrozen(RULES_V2_LIMITS, 'RULES_V2_LIMITS');
    assert.throws(() => {
        RULES_V2_LIMITS.packBytes = 1;
    }, TypeError, 'mutating RULES_V2_LIMITS must throw');

    assertRecursivelyFrozen(RULES_V2_PROGRESSION, 'RULES_V2_PROGRESSION');
    assert.ok(Object.isFrozen(RULES_V2_PROGRESSION.tiers), 'tiers array is frozen');
    assert.ok(Object.isFrozen(RULES_V2_PROGRESSION.tierLevels), 'tierLevels object is frozen');
    assert.ok(Object.isFrozen(RULES_V2_PROGRESSION.writtenChoices), 'writtenChoices array is frozen');
    assert.ok(Object.isFrozen(RULES_V2_PROGRESSION.graph), 'graph object is frozen');
    assert.ok(Object.isFrozen(RULES_V2_PROGRESSION.graph.perSkill), 'graph.perSkill object is frozen');
    assert.ok(Object.isFrozen(RULES_V2_PROGRESSION.graph.perClass), 'graph.perClass object is frozen');

    assert.throws(() => {
        RULES_V2_PROGRESSION.writtenChoices.push('c');
    }, TypeError, 'mutating RULES_V2_PROGRESSION writtenChoices must throw');
});

test('representative complete $defs and reference resolution', () => {
    const expectedDefs = [
        'xpPerLevel',
        'id',
        'ref',
        'slug',
        'name',
        'note',
        'stat',
        'target',
        'element',
        'slot',
        'stats',
        'requires',
        'cost',
        'effect',
        'base',
        'class',
        'skill',
        'transform',
        'branch',
        'itemRule',
        'trainer',
        'fixedTrainer',
        'openTrainer',
        'openFee',
        'requirement',
        'objective',
        'reward',
        'quest',
        'closedQuest',
        'openQuest',
        'openObjective',
        'openReward',
        'foe',
        'shop',
        'recipe',
        'unit',
        'offerWords',
        'offerWordList',
    ];

    const actualDefs = Object.keys(rulesV2Schema.$defs);
    for (const defName of expectedDefs) {
        assert.ok(
            rulesV2Schema.$defs[defName] !== undefined,
            `$defs must include "${defName}"`
        );
    }
    assert.equal(actualDefs.length, expectedDefs.length, 'all 38 defs must be present');

    const collectedRefs = [];
    function collectRefs(obj) {
        if (obj === null || typeof obj !== 'object') return;
        if (typeof obj.$ref === 'string') {
            collectedRefs.push(obj.$ref);
        }
        for (const child of Object.values(obj)) {
            collectRefs(child);
        }
    }
    collectRefs(rulesV2Schema);

    assert.ok(collectedRefs.length > 0, 'schema must contain references');
    for (const ref of collectedRefs) {
        assert.ok(ref.startsWith('#/$defs/'), `reference "${ref}" must point to #/$defs/`);
        const target = ref.slice('#/$defs/'.length);
        assert.ok(
            rulesV2Schema.$defs[target] !== undefined,
            `reference target "${target}" must exist in $defs`
        );
    }
});

test('exact enums, bounds, and constants', () => {
    // 7 stats
    const expectedStats = ['STR', 'VIT', 'AGI', 'DEX', 'INT', 'LUK', 'CHA'];
    assert.deepEqual(rulesV2Schema.$defs.stat.enum, expectedStats);
    assert.deepEqual(RULES_V2_STATS, expectedStats);

    // 8 slots (frozen contract: 'weapon', not 'main-hand')
    const expectedSlots = [
        'weapon',
        'offhand',
        'head',
        'body',
        'legs',
        'feet',
        'accessory-1',
        'accessory-2',
    ];
    assert.deepEqual(rulesV2Schema.$defs.slot.enum, expectedSlots);
    assert.deepEqual(RULES_V2_SLOTS, expectedSlots);

    // Verify older spelling 'main-hand' does NOT appear in schema or exports
    const schemaString = JSON.stringify(rulesV2Schema);
    assert.ok(!schemaString.includes('main-hand'), 'must not contain older "main-hand" spelling');
    assert.ok(!RULES_V2_SLOTS.includes('main-hand'), 'RULES_V2_SLOTS must not contain "main-hand"');

    // Targets and elements
    assert.deepEqual(rulesV2Schema.$defs.target.enum, ['one', 'all', 'self', 'ally', 'allies']);
    assert.deepEqual(rulesV2Schema.$defs.element.enum, ['none', 'fire', 'ice', 'lightning', 'poison', 'holy']);

    // Memory enum
    assert.deepEqual(rulesV2Schema.properties.memory.enum, ['deja-vu', 'none', 'full']);
    assert.equal(rulesV2Schema.properties.memory.default, 'deja-vu');

    // Conditions and damageType in effect
    const effectVariants = rulesV2Schema.$defs.effect.oneOf;
    assert.equal(effectVariants.length, 3);
    assert.deepEqual(effectVariants[0].properties.op.enum, ['damage', 'heal', 'shield']);
    assert.deepEqual(effectVariants[0].properties.damageType.enum, ['physical', 'magic', null]);
    assert.equal(effectVariants[1].properties.op.const, 'condition');
    assert.deepEqual(effectVariants[1].properties.kind.enum, [
        'poison', 'burn', 'bleed', 'stun', 'daze', 'slow', 'weaken', 'regen', 'guard',
    ]);
    assert.equal(effectVariants[2].properties.op.const, 'stat');

    // Units
    assert.deepEqual(rulesV2Schema.$defs.unit.properties.kind.enum, ['summon', 'pet']);

    // Quests
    assert.deepEqual(rulesV2Schema.$defs.closedQuest.properties.category.enum, ['main', 'side', 'bounty']);

    // Manifest collection bounds
    assert.equal(rulesV2Schema.properties.classes.minItems, 1);
    assert.equal(rulesV2Schema.properties.classes.maxItems, 40);
    assert.equal(rulesV2Schema.properties.skills.minItems, 3);
    assert.equal(rulesV2Schema.properties.skills.maxItems, 120);
    assert.equal(rulesV2Schema.properties.branches.minItems, 0);
    assert.equal(rulesV2Schema.properties.branches.maxItems, 1000);
    assert.equal(rulesV2Schema.properties.itemRules.minItems, 0);
    assert.equal(rulesV2Schema.properties.itemRules.maxItems, 1000);
    assert.equal(rulesV2Schema.properties.trainers.minItems, 0);
    assert.equal(rulesV2Schema.properties.trainers.maxItems, 100);

    // Text field bounds
    assert.equal(rulesV2Schema.$defs.name.minLength, 1);
    assert.equal(rulesV2Schema.$defs.name.maxLength, 80);
    assert.equal(rulesV2Schema.$defs.note.minLength, 0);
    assert.equal(rulesV2Schema.$defs.note.maxLength, 240);
    assert.equal(rulesV2Schema.$defs.note.default, '');
    assert.equal(rulesV2Schema.$defs.slug.minLength, 1);
    assert.equal(rulesV2Schema.$defs.slug.maxLength, 64);
    assert.equal(rulesV2Schema.$defs.id.minLength, 1);
    assert.equal(rulesV2Schema.$defs.id.maxLength, 160);
    assert.equal(rulesV2Schema.$defs.ref.minLength, 1);
    assert.equal(rulesV2Schema.$defs.ref.maxLength, 110);

    // Costs and transforms
    assert.equal(rulesV2Schema.$defs.cost.properties.mp.maximum, 999);
    assert.equal(rulesV2Schema.$defs.cost.properties.sp.maximum, 999);
    assert.equal(rulesV2Schema.$defs.cost.properties.cooldown.maximum, 10);
    assert.equal(rulesV2Schema.$defs.transform.oneOf.length, 9);
    assert.equal(rulesV2Schema.$defs.branch.properties.transforms.minItems, 1);
    assert.equal(rulesV2Schema.$defs.branch.properties.transforms.maxItems, 8);
    assert.deepEqual(rulesV2Schema.$defs.branch.properties.step.enum, [1, 2]);
    assert.deepEqual(rulesV2Schema.$defs.branch.properties.choice.enum, ['a', 'b']);

    // Item rules
    assert.equal(rulesV2Schema.$defs.itemRule.properties.allowedSlots.minItems, 0);
    assert.equal(rulesV2Schema.$defs.itemRule.properties.allowedSlots.maxItems, 2);
    assert.deepEqual(rulesV2Schema.$defs.itemRule.properties.hands.enum, [0, 1, 2]);
    assert.equal(rulesV2Schema.$defs.itemRule.properties.weight.minimum, 0);
    assert.equal(rulesV2Schema.$defs.itemRule.properties.weight.maximum, 10000);
    assert.equal(rulesV2Schema.$defs.itemRule.properties.unique.default, false);

    // Trainers
    assert.equal(rulesV2Schema.$defs.fixedTrainer.properties.fee.minimum, 1);
    assert.equal(rulesV2Schema.$defs.fixedTrainer.properties.fee.maximum, 1000000);
    assert.equal(rulesV2Schema.$defs.fixedTrainer.properties.minutes.const, 60);
    assert.deepEqual(rulesV2Schema.$defs.trainer.oneOf, [{ $ref: '#/$defs/fixedTrainer' }, { $ref: '#/$defs/openTrainer' }]);
    assert.equal(rulesV2Schema.$defs.fixedTrainer.properties.open.const, false);
    assert.equal(rulesV2Schema.$defs.openTrainer.properties.open.const, true);
    assert.equal(rulesV2Schema.$defs.openTrainer.properties.minutes.const, 60);
    assert.equal(rulesV2Schema.$defs.openTrainer.properties.place, undefined, 'a template has no place');
    assert.equal(rulesV2Schema.$defs.openTrainer.properties.fee.$ref, '#/$defs/openFee');
    assert.equal(rulesV2Schema.$defs.openFee.properties.coinMin.minimum, 1);
    assert.equal(rulesV2Schema.$defs.openFee.properties.coinMin.maximum, 1000000);
    assert.equal(rulesV2Schema.$defs.openFee.properties.coinMax.minimum, 1);
    assert.equal(rulesV2Schema.$defs.openFee.properties.coinMax.maximum, 1000000);

    // Section 4 Constants
    assert.equal(RULES_V2_CONSTANTS.levelCap, 99);
    assert.equal(RULES_V2_CONSTANTS.startLevel, 1);
    assert.equal(RULES_V2_CONSTANTS.startStat, 5);
    assert.equal(RULES_V2_CONSTANTS.startPoints, 10);
    assert.equal(RULES_V2_CONSTANTS.pointsPerLevel, 4);
    assert.equal(RULES_V2_CONSTANTS.statCap, 99);
    assert.equal(RULES_V2_CONSTANTS.xpPerLevel, 100);
    assert.deepEqual(RULES_V2_CONSTANTS.masteryAt, [1, 5, 12, 22, 35]);
    assert.equal(RULES_V2_CONSTANTS.usePerSkillReply, 2);
    assert.equal(RULES_V2_CONSTANTS.usePerSkillDay, 10);
    assert.equal(RULES_V2_CONSTANTS.usePerActorReply, 6);
    assert.equal(RULES_V2_CONSTANTS.usePerActorDay, 30);
    assert.equal(RULES_V2_CONSTANTS.trainMinutes, 60);
    assert.equal(RULES_V2_CONSTANTS.trainCredits, 2);
    assert.equal(RULES_V2_CONSTANTS.trainEventPercent, 10);
    assert.deepEqual(RULES_V2_CONSTANTS.promotionMilestones, [10, 20, 30]);
    assert.deepEqual(RULES_V2_CONSTANTS.pathMilestones, [40, 50, 60, 70, 80, 90]);
    assert.deepEqual(RULES_V2_CONSTANTS.classBudget, [12, 24, 36, 48]);
    assert.equal(RULES_V2_CONSTANTS.pathBudgetIncrement, 12);
    assert.equal(RULES_V2_CONSTANTS.deathDc, 15);
    assert.equal(RULES_V2_CONSTANTS.injuryMinutes, 1440);
    assert.equal(RULES_V2_CONSTANTS.injuryCheckPenalty, -2);
    assert.equal(RULES_V2_CONSTANTS.temporaryLimit, 6);
    assert.ok(
        RULES_V2_CONSTANTS.promptChars >= 500 && RULES_V2_CONSTANTS.promptChars <= 8000,
        'promptChars must be within section 4 range 500..8000'
    );
    assert.equal(RULES_V2_CONSTANTS.difficulty, 'normal');
    assert.equal(RULES_V2_CONSTANTS.clockMinutesPerDay, 1440);

    // Section 7 Limits (one flat object with derived schema bounds)
    assert.equal(RULES_V2_LIMITS.packBytes, 512 * 1024);
    assert.equal(RULES_V2_LIMITS.installedBytes, 2 * 1024 * 1024);
    assert.equal(RULES_V2_LIMITS.depth, 16);
    assert.equal(RULES_V2_LIMITS.keys, 200);
    assert.equal(RULES_V2_LIMITS.array, 1000);
    assert.equal(RULES_V2_LIMITS.string, 4000);
    assert.equal(RULES_V2_LIMITS.name, 80);
    assert.equal(RULES_V2_LIMITS.note, 240);
    assert.equal(RULES_V2_LIMITS.slug, 64);
    assert.equal(RULES_V2_LIMITS.skillSlug, 52);
    assert.equal(RULES_V2_LIMITS.forms, 2048);
    assert.equal(RULES_V2_LIMITS.branches, 1000);
    assert.equal(RULES_V2_LIMITS.itemRules, 1000);
    assert.equal(RULES_V2_LIMITS.trainers, 100);
    assert.equal(RULES_V2_LIMITS.resolvedBytes, 2 * 1024 * 1024);

    const expectedLimitKeys = [
        'packBytes',
        'installedBytes',
        'depth',
        'keys',
        'array',
        'string',
        'name',
        'note',
        'slug',
        'skillSlug',
        'forms',
        'branches',
        'itemRules',
        'trainers',
        'resolvedBytes',
        'nodes',
        'errors',
    ];
    assert.deepEqual(Object.keys(RULES_V2_LIMITS).sort(), expectedLimitKeys.sort());
});

test('xpPerLevel multipleOf10 and skill3', () => {
    // $defs.xpPerLevel
    const xpDef = rulesV2Schema.$defs.xpPerLevel;
    assert.equal(xpDef.type, 'integer');
    assert.equal(xpDef.minimum, 10);
    assert.equal(xpDef.maximum, 10000);
    assert.equal(xpDef.multipleOf, 10);
    assert.equal(xpDef.default, 100);

    // Constant alignment
    assert.equal(RULES_V2_CONSTANTS.xpPerLevel % 10, 0, 'xpPerLevel must be divisible by 10');
    assert.ok(RULES_V2_CONSTANTS.xpPerLevel >= 10 && RULES_V2_CONSTANTS.xpPerLevel <= 10000);

    // Class skills: exactly 3
    const classSkills = rulesV2Schema.$defs.class.properties.skills;
    assert.equal(classSkills.type, 'array');
    assert.equal(classSkills.minItems, 3);
    assert.equal(classSkills.maxItems, 3);
    assert.equal(classSkills.uniqueItems, true);
    assert.equal(RULES_V2_PROGRESSION.skillsPerClass, 3);
});

test('schema required and closed manifest and owned defs', () => {
    // Root manifest
    assert.equal(rulesV2Schema.additionalProperties, false, 'root manifest must be closed');
    const expectedRequired = [
        'slug',
        'name',
        'schema',
        'classes',
        'skills',
        'branches',
        'itemRules',
        'trainers',
    ];
    assert.deepEqual(rulesV2Schema.required, expectedRequired);
    assert.equal(rulesV2Schema.properties.slug.const, 'rules');
    assert.equal(rulesV2Schema.properties.schema.const, 2);

    // Every object definition in $defs must be closed (additionalProperties: false)
    const closedDefs = [
        'stats',
        'requires',
        'cost',
        'base',
        'class',
        'skill',
        'branch',
        'itemRule',
        'fixedTrainer',
        'openTrainer',
        'openFee',
        'reward',
        'closedQuest',
        'openQuest',
        'openReward',
        'foe',
        'shop',
        'recipe',
        'unit',
    ];
    for (const defName of closedDefs) {
        const def = rulesV2Schema.$defs[defName];
        assert.equal(
            def.additionalProperties,
            false,
            `$defs.${defName} must have additionalProperties: false`
        );
    }

    // oneOf variants must also be closed objects
    for (const variant of rulesV2Schema.$defs.effect.oneOf) {
        assert.equal(variant.additionalProperties, false, 'effect oneOf variant must be closed');
    }
    for (const variant of rulesV2Schema.$defs.transform.oneOf) {
        assert.equal(variant.additionalProperties, false, 'transform oneOf variant must be closed');
    }
    for (const variant of rulesV2Schema.$defs.requirement.oneOf) {
        assert.equal(variant.additionalProperties, false, 'requirement oneOf variant must be closed');
    }
    for (const variant of rulesV2Schema.$defs.objective.oneOf) {
        assert.equal(variant.additionalProperties, false, 'objective oneOf variant must be closed');
    }

    // statLabels must also be closed
    assert.equal(rulesV2Schema.properties.statLabels.additionalProperties, false);
});

test('progression metadata describes tiers, skills, mastery, steps, and graph', () => {
    assert.deepEqual(RULES_V2_PROGRESSION.tiers, [0, 1, 2, 3]);
    assert.deepEqual(RULES_V2_PROGRESSION.tierLevels, { 0: 0, 1: 10, 2: 20, 3: 30 });
    assert.equal(RULES_V2_PROGRESSION.skillsPerClass, 3);
    assert.equal(RULES_V2_PROGRESSION.maxMastery, 5);
    assert.equal(RULES_V2_PROGRESSION.pathwaySteps, 2);
    assert.deepEqual(RULES_V2_PROGRESSION.writtenChoices, ['a', 'b']);
    assert.equal(RULES_V2_PROGRESSION.generatedChoice, 'g');
    assert.equal(RULES_V2_PROGRESSION.graph.perSkill.written, 8);
    assert.equal(RULES_V2_PROGRESSION.graph.perSkill.generated, 4);
    assert.equal(RULES_V2_PROGRESSION.graph.perSkill.total, 12);
    assert.equal(RULES_V2_PROGRESSION.graph.perClass.written, 24);
    assert.equal(RULES_V2_PROGRESSION.graph.perClass.generated, 12);
    assert.equal(RULES_V2_PROGRESSION.graph.perClass.total, 36);

    const expectedProgressionKeys = [
        'tiers',
        'tierLevels',
        'skillsPerClass',
        'maxMastery',
        'pathwaySteps',
        'writtenChoices',
        'generatedChoice',
        'graph',
    ];
    assert.deepEqual(Object.keys(RULES_V2_PROGRESSION).sort(), expectedProgressionKeys.sort());
});
