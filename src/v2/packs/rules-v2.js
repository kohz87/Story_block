// Rules pack v2 schema and constants (SPEC §7, §4; pure).

import schemaData from './rules-v2.schema.json' with { type: 'json' };

/** Deeply freezes an object or array and all nested structures. */
function deepFreeze(object) {
    if (object === null || typeof object !== 'object') return object;
    Object.freeze(object);
    for (const value of Object.values(object)) {
        if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
            deepFreeze(value);
        }
    }
    return object;
}

/** Deeply frozen JSON Schema for rules-v2 manifests and owned defs. */
export const rulesV2Schema = deepFreeze(schemaData);

/** Canonical 7 stats defined in SPEC §4. */
export const RULES_V2_STATS = rulesV2Schema.$defs.stat.enum;

/** Canonical 8 equipment slots defined in SPEC §4. */
export const RULES_V2_SLOTS = rulesV2Schema.$defs.slot.enum;

/** Rules v2 constants with approved defaults from SPEC §4. */
export const RULES_V2_CONSTANTS = deepFreeze({
    levelCap: 99,
    startLevel: 1,
    startStat: 5,
    startPoints: 10,
    pointsPerLevel: 4,
    statCap: 99,
    xpPerLevel: 100,
    masteryAt: [1, 5, 12, 22, 35],
    usePerSkillReply: 2,
    usePerSkillDay: 10,
    usePerActorReply: 6,
    usePerActorDay: 30,
    trainMinutes: 60,
    trainCredits: 2,
    trainEventPercent: 10,
    promotionMilestones: [10, 20, 30],
    pathMilestones: [40, 50, 60, 70, 80, 90],
    classBudget: [12, 24, 36, 48],
    pathBudgetIncrement: 12,
    deathDc: 15,
    injuryMinutes: 1440,
    injuryCheckPenalty: -2,
    temporaryLimit: 6,
    promptChars: 2000,
    difficulty: 'normal',
    clockMinutesPerDay: 1440,
});

/** Rules v2 pack limits and resolved bounds from SPEC §7. */
export const RULES_V2_LIMITS = deepFreeze({
    packBytes: 512 * 1024,
    installedBytes: 2 * 1024 * 1024,
    depth: 16,
    keys: 200,
    array: 1000,
    string: 4000,
    name: rulesV2Schema.$defs.name.maxLength,
    note: rulesV2Schema.$defs.note.maxLength,
    slug: rulesV2Schema.$defs.slug.maxLength,
    forms: 2048,
    branches: rulesV2Schema.properties.branches.maxItems,
    itemRules: rulesV2Schema.properties.itemRules.maxItems,
    trainers: rulesV2Schema.properties.trainers.maxItems,
    resolvedBytes: 2 * 1024 * 1024,
});

/** Progression structure describing class tiers, skills, mastery, and pathways. */
export const RULES_V2_PROGRESSION = deepFreeze({
    tiers: [0, 1, 2, 3],
    tierLevels: { 0: 0, 1: 10, 2: 20, 3: 30 },
    skillsPerClass: 3,
    maxMastery: 5,
    pathwaySteps: 2,
    writtenChoices: ['a', 'b'],
    generatedChoice: 'g',
    graph: {
        perSkill: { written: 8, generated: 4, total: 12 },
        perClass: { written: 24, generated: 12, total: 36 },
    },
});
