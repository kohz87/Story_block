// Rules pack v2 schema, constants, validation, expansion, and export (SPEC §7, §4, §9, §10; pure).

import schemaData from './rules-v2.schema.json' with { type: 'json' };
import { byteLength } from './safety.js';
import { parseRange, satisfies } from './version.js';
import { PACK_FIELDS, PACK_ID, SLUG, SEMVER, DEF_ID, LIMITS, CONTENT_KINDS } from './limits.js';
import { validatePack, HOST_VERSION } from './validate.js';

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

/** Stable error codes for rules-v2 validation and checking. */
export const RULES_V2_ERROR_CODES = deepFreeze({
    ENVELOPE_UNKNOWN: 'envelope-unknown',
    BAD_CAPABILITY: 'bad-capability',
    UNSAFE_MARKUP: 'unsafe-markup',
    UNSAFE_KEY: 'unsafe-key',
    CONTROL_CHARACTER: 'control-character',
    DUP_ID: 'dup-id',
    TIER_CHAIN: 'tier-chain',
    CLASS_SKILLS: 'class-skills',
    BRANCH_GRAPH: 'branch-graph',
    NUMERIC_RANGE: 'numeric-range',
    BAD_TRANSFORM: 'bad-transform',
    BAD_EFFECT: 'bad-effect',
    MP_SP_CONFLICT: 'mp-sp-conflict',
    NUMERIC_ONLY_BRANCH: 'numeric-only-branch',
    BUDGET_CLOSURE: 'budget-closure',
    BAD_REF: 'bad-ref',
    TOO_LARGE: 'too-large',
    ITEM_RULE_MISMATCH: 'item-rule-mismatch',
    BAD_XP_PER_LEVEL: 'bad-xp-per-level',
    BAD_SCHEMA: 'bad-schema',
    STEP_LIMIT: 'step-limit',
    BAD_FORM: 'bad-form',
    BAD_RULES: 'bad-rules',
});

const RECORD_ID_REGEX = /^[a-z][a-z0-9]*_[0-9a-z]{8}$/;
const DEF_ID_REGEX = /^[a-z0-9]+(?:[._-][a-z0-9]+)*\/[a-z0-9]+(?:[_-][a-z0-9]+)*$/;
const REF_REGEX = /^(?:pack\.[a-z0-9]+(?:-[a-z0-9]+)*\/)?[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Pure JavaScript synchronous SHA-256 implementation.
 * Browser-compatible, zero Node builtins, deterministic.
 */
export function sha256(input) {
    const bytes = typeof input === 'string'
        ? new TextEncoder().encode(input)
        : input instanceof Uint8Array ? input : new Uint8Array(input);

    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

    const K = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];

    const l = bytes.length;
    const bitLen = l * 8;
    const padLen = ((l + 8) >> 6) + 1 << 6;
    const padded = new Uint8Array(padLen);
    padded.set(bytes);
    padded[l] = 0x80;

    const view = new DataView(padded.buffer);
    view.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000), false);
    view.setUint32(padLen - 4, bitLen >>> 0, false);

    const w = new Uint32Array(64);

    for (let i = 0; i < padLen; i += 64) {
        for (let t = 0; t < 16; t++) {
            w[t] = view.getUint32(i + t * 4, false);
        }
        for (let t = 16; t < 64; t++) {
            const s0 = ((w[t - 15] >>> 7) | (w[t - 15] << 25)) ^
                       ((w[t - 15] >>> 18) | (w[t - 15] << 14)) ^
                       (w[t - 15] >>> 3);
            const s1 = ((w[t - 2] >>> 17) | (w[t - 2] << 15)) ^
                       ((w[t - 2] >>> 19) | (w[t - 2] << 13)) ^
                       (w[t - 2] >>> 10);
            w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
        }

        let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;

        for (let t = 0; t < 64; t++) {
            const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
            const ch = (e & f) ^ (~e & g);
            const temp1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
            const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (S0 + maj) >>> 0;

            h = g;
            g = f;
            f = e;
            e = (d + temp1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temp1 + temp2) >>> 0;
        }

        h0 = (h0 + a) >>> 0;
        h1 = (h1 + b) >>> 0;
        h2 = (h2 + c) >>> 0;
        h3 = (h3 + d) >>> 0;
        h4 = (h4 + e) >>> 0;
        h5 = (h5 + f) >>> 0;
        h6 = (h6 + g) >>> 0;
        h7 = (h7 + h) >>> 0;
    }

    return [h0, h1, h2, h3, h4, h5, h6, h7]
        .map(x => x.toString(16).padStart(8, '0'))
        .join('');
}

/** Recursively sorts object keys alphabetically while strictly preserving array order. */
export function canonicalizeJson(value) {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(canonicalizeJson);
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
        sorted[key] = canonicalizeJson(value[key]);
    }
    return sorted;
}

/** Unicode normalization: NFC, line endings to \n, outer whitespace trimmed. */
function normalizeString(val) {
    if (typeof val !== 'string') return val;
    return val.normalize('NFC').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

/** Pure plain clone of safe plain JSON values. Never invokes accessors. */
function clonePlain(val) {
    if (val === null || typeof val !== 'object') return val;
    if (Array.isArray(val)) return val.map(clonePlain);
    const out = {};
    for (const key of Object.keys(val)) {
        out[key] = clonePlain(val[key]);
    }
    return out;
}

/** Recursively normalizes string fields and applies defaults in an object without mutation. */
function normalizeStructure(val) {
    if (val === null || typeof val !== 'object') {
        if (typeof val === 'string') return normalizeString(val);
        return val;
    }
    if (Array.isArray(val)) {
        return val.map(normalizeStructure);
    }
    const out = {};
    for (const [k, v] of Object.entries(val)) {
        out[k] = normalizeStructure(v);
    }
    return out;
}

/**
 * Checks plain JSON safety using descriptors and plain prototypes without invoking getters.
 * Halts immediately on oversized arrays (>1000), oversized objects (>200 keys), or depth >= 16.
 * Rejects extra array properties and non-enumerable properties.
 */
function checkPlainSafety(value, limits = RULES_V2_LIMITS) {
    const errors = [];
    const seen = new Set();

    function visit(node, path, depth) {
        if (errors.length >= 20) return;
        if (node === null || typeof node === 'boolean') return;
        if (typeof node === 'string') {
            if (node.length > limits.string) {
                errors.push({ code: RULES_V2_ERROR_CODES.TOO_LARGE, path, message: `String is longer than ${limits.string} characters` });
                return;
            }
            if (node.includes('<') || node.includes('>')) {
                errors.push({ code: RULES_V2_ERROR_CODES.UNSAFE_MARKUP, path, message: 'Text cannot contain "<" or ">"' });
                return;
            }
            if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/.test(node)) {
                errors.push({ code: RULES_V2_ERROR_CODES.CONTROL_CHARACTER, path, message: 'Text cannot contain control characters' });
                return;
            }
            return;
        }
        if (typeof node === 'number') {
            if (!Number.isFinite(node)) {
                errors.push({ code: RULES_V2_ERROR_CODES.NUMERIC_RANGE, path, message: 'Number must be finite' });
            }
            return;
        }
        if (typeof node !== 'object') {
            errors.push({ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path, message: `Unsupported value type: ${typeof node}` });
            return;
        }
        if (seen.has(node)) {
            errors.push({ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path, message: 'Circular reference detected' });
            return;
        }
        if (depth >= limits.depth) {
            errors.push({ code: RULES_V2_ERROR_CODES.TOO_LARGE, path, message: `Object nested ${depth} levels deep; maximum allowed is ${limits.depth - 1}` });
            return;
        }
        const proto = Object.getPrototypeOf(node);
        if (proto !== Object.prototype && proto !== Array.prototype && proto !== null) {
            errors.push({ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path, message: 'Unsupported object prototype' });
            return;
        }

        seen.add(node);
        const isArr = Array.isArray(node);
        if (isArr) {
            if (node.length > limits.array) {
                errors.push({ code: RULES_V2_ERROR_CODES.TOO_LARGE, path, message: `Array has more than ${limits.array} entries` });
                seen.delete(node);
                return;
            }
            const ownKeys = Reflect.ownKeys(node);
            for (const k of ownKeys) {
                if (k === 'length') continue;
                if (typeof k !== 'string' || !/^\d+$/.test(k) || Number(k) >= node.length) {
                    errors.push({ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path: `${path}.${String(k)}`, message: 'Array has invalid property key or extra properties' });
                    seen.delete(node);
                    return;
                }
                const desc = Object.getOwnPropertyDescriptor(node, k);
                if (!desc || !desc.enumerable) {
                    errors.push({ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path: `${path}[${k}]`, message: 'Non-enumerable array property is forbidden' });
                    seen.delete(node);
                    return;
                }
                if (desc.get || desc.set) {
                    errors.push({ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path: `${path}[${k}]`, message: 'Property accessor is forbidden' });
                    seen.delete(node);
                    return;
                }
            }
            for (let i = 0; i < node.length; i++) {
                if (!(i in node)) {
                    errors.push({ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path: `${path}[${i}]`, message: 'Sparse arrays are forbidden' });
                    seen.delete(node);
                    return;
                }
                visit(node[i], `${path}[${i}]`, depth + 1);
            }
        } else {
            const ownKeys = Reflect.ownKeys(node);
            if (ownKeys.length > limits.keys) {
                errors.push({ code: RULES_V2_ERROR_CODES.TOO_LARGE, path, message: `Object has more than ${limits.keys} fields` });
                seen.delete(node);
                return;
            }
            for (const key of ownKeys) {
                if (typeof key === 'symbol') {
                    errors.push({ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path, message: 'Symbol keys are forbidden' });
                    continue;
                }
                if (UNSAFE_KEYS.has(key)) {
                    errors.push({ code: RULES_V2_ERROR_CODES.UNSAFE_KEY, path: path ? `${path}.${key}` : key, message: `Reserved key "${key}" is forbidden` });
                    continue;
                }
                if (key.includes('<') || key.includes('>')) {
                    errors.push({ code: RULES_V2_ERROR_CODES.UNSAFE_MARKUP, path: path ? `${path}.${key}` : key, message: 'Key cannot contain "<" or ">"' });
                    continue;
                }
                const desc = Object.getOwnPropertyDescriptor(node, key);
                if (!desc || !desc.enumerable) {
                    errors.push({ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path: path ? `${path}.${key}` : key, message: 'Non-enumerable property is forbidden' });
                    continue;
                }
                if (desc.get || desc.set) {
                    errors.push({ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path: path ? `${path}.${key}` : key, message: 'Property accessor is forbidden' });
                    continue;
                }
                visit(node[key], path ? `${path}.${key}` : key, depth + 1);
            }
        }
        seen.delete(node);
    }

    visit(value, '', 0);
    return errors;
}

/**
 * Validates Constants argument against frozen specification.
 * Fixed literal fields and budgets cannot be overridden. Unknown keys rejected.
 * Avoids JSON.stringify on untrusted input.
 */
function validateConstants(constants) {
    if (constants === undefined || constants === null) {
        return { ok: true, constants: RULES_V2_CONSTANTS };
    }
    if (typeof constants !== 'object' || Array.isArray(constants)) {
        return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path: 'constants', message: 'Constants must be an object' }] };
    }
    const safeErrs = checkPlainSafety(constants);
    if (safeErrs.length) return { ok: false, errors: safeErrs };

    const allowedKeys = new Set(Object.keys(RULES_V2_CONSTANTS));
    for (const k of Object.keys(constants)) {
        if (!allowedKeys.has(k)) {
            return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path: `constants.${k}`, message: `Unknown constant "${k}"` }] };
        }
    }

    const fixedScalar = [
        'levelCap', 'startLevel', 'startStat', 'startPoints', 'pointsPerLevel', 'statCap',
        'usePerSkillReply', 'usePerSkillDay', 'usePerActorReply', 'usePerActorDay',
        'trainMinutes', 'trainCredits', 'trainEventPercent',
        'pathBudgetIncrement', 'deathDc', 'injuryMinutes', 'injuryCheckPenalty', 'temporaryLimit',
        'difficulty', 'clockMinutesPerDay'
    ];
    for (const f of fixedScalar) {
        if (constants[f] !== undefined && constants[f] !== RULES_V2_CONSTANTS[f]) {
            return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path: `constants.${f}`, message: `Constant "${f}" is fixed and cannot be overridden` }] };
        }
    }

    const fixedArrays = ['masteryAt', 'promotionMilestones', 'pathMilestones', 'classBudget'];
    for (const f of fixedArrays) {
        if (constants[f] !== undefined) {
            const expected = RULES_V2_CONSTANTS[f];
            if (!Array.isArray(constants[f]) || constants[f].length !== expected.length || !constants[f].every((v, i) => v === expected[i])) {
                return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path: `constants.${f}`, message: `Constant "${f}" is fixed and cannot be overridden` }] };
            }
        }
    }

    let xpPerLevel = RULES_V2_CONSTANTS.xpPerLevel;
    if (constants.xpPerLevel !== undefined) {
        const xpDef = rulesV2Schema.$defs.xpPerLevel;
        const val = constants.xpPerLevel;
        if (typeof val !== 'number' || !Number.isSafeInteger(val) ||
            (xpDef.minimum !== undefined && val < xpDef.minimum) ||
            (xpDef.maximum !== undefined && val > xpDef.maximum) ||
            (xpDef.multipleOf !== undefined && val % xpDef.multipleOf !== 0)) {
            return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_XP_PER_LEVEL, path: 'constants.xpPerLevel', message: `xpPerLevel must be integer between ${xpDef.minimum} and ${xpDef.maximum} and a multiple of ${xpDef.multipleOf}` }] };
        }
        xpPerLevel = val;
    }

    let promptChars = RULES_V2_CONSTANTS.promptChars;
    if (constants.promptChars !== undefined) {
        const val = constants.promptChars;
        if (typeof val !== 'number' || !Number.isSafeInteger(val) || val < 500 || val > 8000) {
            return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.NUMERIC_RANGE, path: 'constants.promptChars', message: 'promptChars must be a safe integer between 500 and 8000' }] };
        }
        promptChars = val;
    }

    const merged = deepFreeze({
        ...RULES_V2_CONSTANTS,
        xpPerLevel,
        promptChars,
    });
    return { ok: true, constants: merged };
}

/** Target factor mapping per SPEC §7 & B3/P06. */
function targetFactor(target) {
    if (target === 'one' || target === 'self' || target === 'ally') return 1;
    if (target === 'all' || target === 'allies') return 3;
    return null;
}

const LEGAL_ELEMENTS = new Set(['none', 'fire', 'ice', 'lightning', 'poison', 'holy']);
const HARMFUL_CONDITIONS = new Set(['poison', 'burn', 'bleed', 'stun', 'daze', 'slow', 'weaken']);
const FRIENDLY_CONDITIONS = new Set(['regen', 'guard']);
const LEGAL_FORM_TYPES = new Set(['physical', 'magic', 'heal', 'buff', 'debuff']);

/** Validates an effect structure and semantics strictly per SPEC §7 & schema. */
function validateSingleEffect(eff, path = 'effects') {
    if (!eff || typeof eff !== 'object' || Array.isArray(eff)) {
        return { ok: false, error: { code: RULES_V2_ERROR_CODES.BAD_EFFECT, path, message: 'Effect must be an object' } };
    }

    if (eff.op === 'damage') {
        const allowedKeys = new Set(['op', 'target', 'power', 'element', 'damageType']);
        for (const k of Object.keys(eff)) {
            if (!allowedKeys.has(k)) {
                return { ok: false, error: { code: RULES_V2_ERROR_CODES.BAD_EFFECT, path: `${path}.${k}`, message: `Unknown field "${k}" in damage effect` } };
            }
        }
        if (eff.damageType !== 'physical' && eff.damageType !== 'magic') {
            return { ok: false, error: { code: RULES_V2_ERROR_CODES.BAD_EFFECT, path: `${path}.damageType`, message: 'Damage effect requires damageType "physical" or "magic"' } };
        }
        if (eff.target !== 'one' && eff.target !== 'all') {
            return { ok: false, error: { code: RULES_V2_ERROR_CODES.BAD_EFFECT, path: `${path}.target`, message: 'Damage effect must target "one" or "all"' } };
        }
        if (!LEGAL_ELEMENTS.has(eff.element)) {
            return { ok: false, error: { code: RULES_V2_ERROR_CODES.BAD_EFFECT, path: `${path}.element`, message: `Invalid element "${eff.element}"` } };
        }
        if (typeof eff.power !== 'number' || !Number.isSafeInteger(eff.power) || eff.power < 1 || eff.power > 1000) {
            return { ok: false, error: { code: RULES_V2_ERROR_CODES.NUMERIC_RANGE, path: `${path}.power`, message: 'Power must be safe integer 1 to 1000' } };
        }
        return { ok: true, score: Math.ceil(eff.power / 10) * targetFactor(eff.target) };
    }

    if (eff.op === 'heal' || eff.op === 'shield') {
        const allowedKeys = new Set(['op', 'target', 'power', 'element', 'damageType']);
        for (const k of Object.keys(eff)) {
            if (!allowedKeys.has(k)) {
                return { ok: false, error: { code: RULES_V2_ERROR_CODES.BAD_EFFECT, path: `${path}.${k}`, message: `Unknown field "${k}" in ${eff.op} effect` } };
            }
        }
        if (eff.damageType !== null) {
            return { ok: false, error: { code: RULES_V2_ERROR_CODES.BAD_EFFECT, path: `${path}.damageType`, message: 'Heal and shield effects require damageType null' } };
        }
        if (eff.target !== 'self' && eff.target !== 'ally' && eff.target !== 'allies') {
            return { ok: false, error: { code: RULES_V2_ERROR_CODES.BAD_EFFECT, path: `${path}.target`, message: 'Heal and shield effects must target friends ("self", "ally", "allies")' } };
        }
        if (!LEGAL_ELEMENTS.has(eff.element)) {
            return { ok: false, error: { code: RULES_V2_ERROR_CODES.BAD_EFFECT, path: `${path}.element`, message: `Invalid element "${eff.element}"` } };
        }
        if (typeof eff.power !== 'number' || !Number.isSafeInteger(eff.power) || eff.power < 1 || eff.power > 1000) {
            return { ok: false, error: { code: RULES_V2_ERROR_CODES.NUMERIC_RANGE, path: `${path}.power`, message: 'Power must be safe integer 1 to 1000' } };
        }
        return { ok: true, score: Math.ceil(eff.power / 10) * targetFactor(eff.target) };
    }

    if (eff.op === 'condition') {
        const allowedKeys = new Set(['op', 'target', 'kind', 'chance', 'rounds']);
        for (const k of Object.keys(eff)) {
            if (!allowedKeys.has(k)) {
                return { ok: false, error: { code: RULES_V2_ERROR_CODES.BAD_EFFECT, path: `${path}.${k}`, message: `Unknown field "${k}" in condition effect` } };
            }
        }
        if (HARMFUL_CONDITIONS.has(eff.kind)) {
            if (eff.target !== 'one' && eff.target !== 'all') {
                return { ok: false, error: { code: RULES_V2_ERROR_CODES.BAD_EFFECT, path: `${path}.target`, message: `Harmful condition "${eff.kind}" must target foes ("one" or "all")` } };
            }
        } else if (FRIENDLY_CONDITIONS.has(eff.kind)) {
            if (eff.target !== 'self' && eff.target !== 'ally' && eff.target !== 'allies') {
                return { ok: false, error: { code: RULES_V2_ERROR_CODES.BAD_EFFECT, path: `${path}.target`, message: `Beneficial condition "${eff.kind}" must target friends ("self", "ally", "allies")` } };
            }
        } else {
            return { ok: false, error: { code: RULES_V2_ERROR_CODES.BAD_EFFECT, path: `${path}.kind`, message: `Invalid condition kind "${eff.kind}"` } };
        }
        if (typeof eff.chance !== 'number' || !Number.isSafeInteger(eff.chance) || eff.chance < 1 || eff.chance > 100) {
            return { ok: false, error: { code: RULES_V2_ERROR_CODES.NUMERIC_RANGE, path: `${path}.chance`, message: 'Condition chance must be integer 1 to 100' } };
        }
        if (typeof eff.rounds !== 'number' || !Number.isSafeInteger(eff.rounds) || eff.rounds < 1 || eff.rounds > 6) {
            return { ok: false, error: { code: RULES_V2_ERROR_CODES.NUMERIC_RANGE, path: `${path}.rounds`, message: 'Condition rounds must be integer 1 to 6' } };
        }
        return { ok: true, score: Math.ceil(eff.chance / 25) * eff.rounds * targetFactor(eff.target) };
    }

    if (eff.op === 'stat') {
        const allowedKeys = new Set(['op', 'target', 'stat', 'amount', 'rounds']);
        for (const k of Object.keys(eff)) {
            if (!allowedKeys.has(k)) {
                return { ok: false, error: { code: RULES_V2_ERROR_CODES.BAD_EFFECT, path: `${path}.${k}`, message: `Unknown field "${k}" in stat effect` } };
            }
        }
        if (!RULES_V2_STATS.includes(eff.stat)) {
            return { ok: false, error: { code: RULES_V2_ERROR_CODES.BAD_EFFECT, path: `${path}.stat`, message: `Invalid stat "${eff.stat}"` } };
        }
        if (typeof eff.amount !== 'number' || !Number.isSafeInteger(eff.amount) || eff.amount === 0 || Math.abs(eff.amount) > 10) {
            return { ok: false, error: { code: RULES_V2_ERROR_CODES.NUMERIC_RANGE, path: `${path}.amount`, message: 'Stat amount must be non-zero integer -10 to 10' } };
        }
        if (eff.amount > 0) {
            if (eff.target !== 'self' && eff.target !== 'ally' && eff.target !== 'allies') {
                return { ok: false, error: { code: RULES_V2_ERROR_CODES.BAD_EFFECT, path: `${path}.target`, message: 'Positive stat buff must target friends ("self", "ally", "allies")' } };
            }
        } else {
            if (eff.target !== 'one' && eff.target !== 'all') {
                return { ok: false, error: { code: RULES_V2_ERROR_CODES.BAD_EFFECT, path: `${path}.target`, message: 'Negative stat debuff must target foes ("one" or "all")' } };
            }
        }
        if (typeof eff.rounds !== 'number' || !Number.isSafeInteger(eff.rounds) || eff.rounds < 1 || eff.rounds > 6) {
            return { ok: false, error: { code: RULES_V2_ERROR_CODES.NUMERIC_RANGE, path: `${path}.rounds`, message: 'Stat rounds must be integer 1 to 6' } };
        }
        return { ok: true, score: 2 * Math.abs(eff.amount) * eff.rounds * targetFactor(eff.target) };
    }

    return { ok: false, error: { code: RULES_V2_ERROR_CODES.BAD_EFFECT, path: `${path}.op`, message: `Unknown effect op "${eff.op}"` } };
}

/**
 * Pure power score calculation for a form per SPEC §7 & B3/P06.
 * Target factor 1 for one/self/ally, 3 for all/allies.
 * damage/heal/shield: ceil(power/10), condition: ceil(chance/25)*rounds, stat: 2*abs(amount)*rounds.
 * Sum effect scores times target factor plus 12 if unit is non-null. Safe Count score. Never throws.
 */
export function powerScore(form) {
    if (!form || typeof form !== 'object' || Array.isArray(form)) {
        return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_FORM, path: '', message: 'Form must be an object' }] };
    }
    const safeErrs = checkPlainSafety(form);
    if (safeErrs.length) return { ok: false, errors: safeErrs };

    const effects = form.effects ?? form.base?.effects;
    if (!Array.isArray(effects) || effects.length === 0 || effects.length > 4) {
        return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_FORM, path: 'effects', message: 'Form must have 1 to 4 effects' }] };
    }

    let total = 0;
    for (let i = 0; i < effects.length; i++) {
        const valRes = validateSingleEffect(effects[i], `effects[${i}]`);
        if (!valRes.ok) return { ok: false, errors: [valRes.error] };
        total += valRes.score;
    }

    const unit = form.unit !== undefined ? form.unit : form.base?.unit;
    if (unit !== null && unit !== undefined) {
        if (typeof unit !== 'object' || Array.isArray(unit)) {
            return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_FORM, path: 'unit', message: 'Unit must be an object' }] };
        }
        const allowedUnitKeys = new Set(['kind', 'class', 'statShare', 'poolShare', 'rounds']);
        for (const k of Object.keys(unit)) {
            if (!allowedUnitKeys.has(k)) {
                return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_FORM, path: `unit.${k}`, message: `Unknown unit field "${k}"` }] };
            }
        }
        if (unit.kind !== 'summon' && unit.kind !== 'pet') {
            return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_FORM, path: 'unit.kind', message: 'Unit kind must be "summon" or "pet"' }] };
        }
        if (typeof unit.class !== 'string' || !unit.class) {
            return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_FORM, path: 'unit.class', message: 'Unit class must be a valid reference string' }] };
        }
        if (typeof unit.statShare !== 'number' || unit.statShare < 10 || unit.statShare > 100 || !Number.isSafeInteger(unit.statShare)) {
            return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_FORM, path: 'unit.statShare', message: 'Unit statShare must be integer 10 to 100' }] };
        }
        if (typeof unit.poolShare !== 'number' || unit.poolShare < 10 || unit.poolShare > 100 || !Number.isSafeInteger(unit.poolShare)) {
            return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_FORM, path: 'unit.poolShare', message: 'Unit poolShare must be integer 10 to 100' }] };
        }
        if (typeof unit.rounds !== 'number' || unit.rounds < 1 || unit.rounds > 60 || !Number.isSafeInteger(unit.rounds)) {
            return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_FORM, path: 'unit.rounds', message: 'Unit rounds must be integer 1 to 60' }] };
        }
        total += 12;
    }

    if (!Number.isSafeInteger(total) || total < 0) {
        return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.NUMERIC_RANGE, path: 'powerScore', message: 'Power score overflow or non-integer' }] };
    }
    return { ok: true, score: total };
}

/** Compatibility stub for power budget calculation; returns null. */
export function budgetOf() {
    return null;
}

/** Budget calculation for given tier and step. */
function budgetFor(tier, step, constants = RULES_V2_CONSTANTS) {
    if (typeof tier !== 'number' || tier < 0 || tier > 3) return null;
    const baseBudget = constants.classBudget[tier];
    if (baseBudget === undefined) return null;
    return baseBudget + (step ?? 0) * (constants.pathBudgetIncrement ?? 12);
}

/** Checks the complete resolved form before generating a descendant. */
function checkParentForm(form, constants) {
    const errors = [];
    const add = (path, message) => errors.push({ code: RULES_V2_ERROR_CODES.BAD_RULES, path, message });
    const allowed = new Set(['id', 'skill', 'name', 'note', 'step', 'fromForm', 'origin',
        'type', 'stat', 'cost', 'effects', 'unit', 'tier', 'powerScore']);
    for (const key of Object.keys(form)) if (!allowed.has(key)) add(key, `Unknown form field "${key}"`);
    for (const key of ['id', 'skill']) {
        const value = form[key];
        if (typeof value !== 'string' || !DEF_ID.test(value) || value.length > 160 || value.split('/')[1].length > 64) add(key, 'Expected an SB definition ID');
    }
    if (typeof form.skill === 'string' && form.skill.split('/').at(-1).length > 52) add('skill', 'Base skill slug must leave room for both pathway steps');
    for (const key of ['name', 'note']) {
        for (const error of validateSchemaValue(form[key], rulesV2Schema.$defs[key], rulesV2Schema.$defs, key)) add(error.path, error.message);
    }
    if (!Number.isInteger(form.tier) || form.tier !== 3) add('tier', 'Only advanced forms have pathway descendants');
    if (!Number.isInteger(form.step) || form.step < 0 || form.step > 1) add('step', 'Parent step must be 0 or 1');
    if (form.step === 0) {
        if (form.id !== `${form.skill}-base`) add('id', 'Base ID must be skill ID plus -base');
        if (form.fromForm !== null) add('fromForm', 'Base has no parent');
        if (form.origin !== 'base') add('origin', 'Base origin must be base');
    } else if (form.step === 1) {
        const baseId = `${form.skill}-base`;
        if (form.fromForm !== baseId) add('fromForm', 'Step 1 must name its exact base parent');
        if (form.origin === 'generated') {
            if (form.id !== `${baseId}-g`) add('id', 'Generated ID must append -g to parent');
        } else if (form.origin === 'written') {
            if (![`${baseId}-a`, `${baseId}-b`].includes(form.id)) add('id', 'Written ID must append -a or -b to parent');
        } else add('origin', 'Step 1 origin must be written or generated');
    }
    const base = {};
    for (const key of Object.keys(rulesV2Schema.$defs.base.properties)) if (form[key] !== undefined) base[key] = form[key];
    for (const error of validateSchemaValue(base, rulesV2Schema.$defs.base, rulesV2Schema.$defs)) add(error.path, error.message);
    for (const error of validateCostCompatibility(form.type, form.cost)) add(error.path, error.message);
    const score = powerScore(form);
    if (!score.ok) for (const error of score.errors) add(error.path, error.message);
    else {
        if (score.score > budgetFor(form.tier, form.step, constants)) add('powerScore', 'Parent exceeds its own budget');
        if (form.powerScore !== undefined && form.powerScore !== score.score) add('powerScore', 'Stored score does not match form');
    }
    return errors;
}

/**
 * Deterministic g power-up generation per SPEC §7 & B3/P06.
 * Clones parent, sets id=parent.id+'-g', step=step+1, origin='generated', fromForm=parent.id.
 * Adds +20 to first numeric power, else +1 to first stat magnitude, else +1 to first condition rounds.
 * Validates bounds and budget closure. Parent step 2 or invalid closure returns frozen BAD_RULES contract. Never throws.
 */
export function generatePowerUp(form, constants = RULES_V2_CONSTANTS) {
    if (!form || typeof form !== 'object' || Array.isArray(form)) {
        return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_RULES, path: '', message: 'Form must be an object' }] };
    }
    const safeErrs = checkPlainSafety(form);
    if (safeErrs.length) {
        return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_RULES, path: '', message: 'Unsafe parent form input' }] };
    }

    const cRes = validateConstants(constants);
    if (!cRes.ok) return cRes;
    const c = cRes.constants;

    const parentErrors = checkParentForm(form, c);
    if (parentErrors.length) return { ok: false, errors: parentErrors };
    const step = form.step;
    const tier = form.tier;
    const effects = form.effects;

    const cloned = clonePlain(form);
    cloned.effects = clonePlain(effects);
    cloned.id = `${form.id}-g`;
    cloned.step = step + 1;
    cloned.origin = 'generated';
    cloned.fromForm = form.id;
    cloned.tier = tier;

    let applied = false;
    for (let i = 0; i < cloned.effects.length; i++) {
        const eff = cloned.effects[i];
        if (eff && (eff.op === 'damage' || eff.op === 'heal' || eff.op === 'shield')) {
            eff.power += 20;
            if (eff.power > 1000) {
                return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_RULES, path: `effects[${i}].power`, message: 'Power exceeds maximum 1000' }] };
            }
            applied = true;
            break;
        }
    }
    if (!applied) {
        for (let i = 0; i < cloned.effects.length; i++) {
            const eff = cloned.effects[i];
            if (eff && eff.op === 'stat') {
                if (eff.amount > 0) eff.amount += 1;
                else eff.amount -= 1;
                if (Math.abs(eff.amount) > 10) {
                    return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_RULES, path: `effects[${i}].amount`, message: 'Stat amount magnitude exceeds 10' }] };
                }
                applied = true;
                break;
            }
        }
    }
    if (!applied) {
        for (let i = 0; i < cloned.effects.length; i++) {
            const eff = cloned.effects[i];
            if (eff && eff.op === 'condition') {
                eff.rounds += 1;
                if (eff.rounds > 6) {
                    return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_RULES, path: `effects[${i}].rounds`, message: 'Condition rounds exceed 6' }] };
                }
                applied = true;
                break;
            }
        }
    }
    if (!applied) {
        return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_RULES, path: 'effects', message: 'No modifiable effect found for power-up' }] };
    }

    const scoreRes = powerScore(cloned);
    if (!scoreRes.ok) {
        return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_RULES, path: 'powerScore', message: 'Failed powerScore on generated form' }] };
    }

    const budget = budgetFor(tier, cloned.step, c);
    if (budget === null || scoreRes.score > budget) {
        return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_RULES, path: 'powerScore', message: `Power score ${scoreRes.score} exceeds budget ${budget} at step ${cloned.step}` }] };
    }
    cloned.powerScore = scoreRes.score;
    return { ok: true, form: deepFreeze(cloned) };
}

/** Validates MP/SP compatibility: physical forms use SP and MP 0; others MP and SP 0. */
function validateCostCompatibility(type, cost, path = 'cost') {
    const errors = [];
    if (!cost || typeof cost !== 'object') return errors;
    if (type === 'physical') {
        if (cost.mp !== 0) {
            errors.push({ code: RULES_V2_ERROR_CODES.MP_SP_CONFLICT, path: `${path}.mp`, message: 'Physical forms must have mp 0' });
        }
    } else {
        if (cost.sp !== 0) {
            errors.push({ code: RULES_V2_ERROR_CODES.MP_SP_CONFLICT, path: `${path}.sp`, message: 'Non-physical forms must have sp 0' });
        }
    }
    return errors;
}

/**
 * Checks whether final form behavior differs from parent excluding numeric-only differences.
 * Returns true if behavior changed, false if identical/numeric-only.
 */
function hasBehavioralDifference(parentForm, form) {
    if (form.type !== parentForm.type) return true;
    if (form.stat !== parentForm.stat) return true;
    const u1 = form.unit, u0 = parentForm.unit;
    if (Boolean(u1) !== Boolean(u0)) return true;
    if (u1 && u0 && (u1.kind !== u0.kind || u1.class !== u0.class)) return true;

    if (form.effects.length !== parentForm.effects.length) return true;
    for (let i = 0; i < form.effects.length; i++) {
        const e1 = form.effects[i];
        const e0 = parentForm.effects[i];
        if (e1.op !== e0.op) return true;
        if (e1.target !== e0.target) return true;
        if (e1.element !== e0.element) return true;
        if (e1.damageType !== e0.damageType) return true;
        if (e1.kind !== e0.kind) return true;
        if (e1.stat !== e0.stat) return true;
        if (e1.op === 'stat' && Math.sign(e1.amount) !== Math.sign(e0.amount)) return true;
    }
    return false;
}

/** Applies sequential typed transforms to clone of parent form. */
function applyBranchTransforms(parentForm, branch, tier, constants = RULES_V2_CONSTANTS, branchPath = '') {
    const form = clonePlain(parentForm);
    form.id = `${parentForm.id}-${branch.choice}`;
    form.step = branch.step;
    form.origin = 'written';
    form.fromForm = parentForm.id;
    form.name = branch.name;
    form.note = branch.note ?? '';
    form.tier = tier;

    for (let t = 0; t < branch.transforms.length; t++) {
        const tr = branch.transforms[t];
        const p = `${branchPath}transforms[${t}]`;

        switch (tr.op) {
            case 'set-target': {
                if (tr.at < 0 || tr.at >= form.effects.length) {
                    return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_TRANSFORM, path: `${p}.at`, message: `Index ${tr.at} out of range for effects array` }] };
                }
                form.effects[tr.at].target = tr.value;
                break;
            }
            case 'set-element': {
                if (tr.at < 0 || tr.at >= form.effects.length) {
                    return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_TRANSFORM, path: `${p}.at`, message: `Index ${tr.at} out of range for effects array` }] };
                }
                const eff = form.effects[tr.at];
                if (eff.op !== 'damage' && eff.op !== 'heal' && eff.op !== 'shield') {
                    return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_TRANSFORM, path: `${p}.at`, message: `Cannot set element on effect op "${eff.op}"` }] };
                }
                eff.element = tr.value;
                break;
            }
            case 'set-power': {
                if (tr.at < 0 || tr.at >= form.effects.length) {
                    return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_TRANSFORM, path: `${p}.at`, message: `Index ${tr.at} out of range for effects array` }] };
                }
                const eff = form.effects[tr.at];
                if (eff.op !== 'damage' && eff.op !== 'heal' && eff.op !== 'shield') {
                    return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_TRANSFORM, path: `${p}.at`, message: `Cannot set power on effect op "${eff.op}"` }] };
                }
                eff.power = tr.value;
                break;
            }
            case 'replace-effect': {
                if (tr.at < 0 || tr.at >= form.effects.length) {
                    return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_TRANSFORM, path: `${p}.at`, message: `Index ${tr.at} out of range for effects array` }] };
                }
                form.effects[tr.at] = clonePlain(tr.value);
                break;
            }
            case 'add-effect': {
                if (form.effects.length >= 4) {
                    return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_TRANSFORM, path: p, message: 'Cannot add effect; maximum 4 effects allowed' }] };
                }
                form.effects.push(clonePlain(tr.value));
                break;
            }
            case 'remove-effect': {
                if (tr.at < 0 || tr.at >= form.effects.length) {
                    return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_TRANSFORM, path: `${p}.at`, message: `Index ${tr.at} out of range for effects array` }] };
                }
                if (form.effects.length <= 1) {
                    return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_TRANSFORM, path: p, message: 'Cannot remove effect; minimum 1 effect required' }] };
                }
                form.effects.splice(tr.at, 1);
                break;
            }
            case 'set-cost': {
                form.cost = clonePlain(tr.value);
                break;
            }
            case 'set-stat': {
                form.stat = tr.value;
                break;
            }
            case 'set-type': {
                form.type = tr.value;
                break;
            }
            default:
                return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_TRANSFORM, path: `${p}.op`, message: `Unknown transform op: ${tr.op}` }] };
        }
    }

    const costErr = validateCostCompatibility(form.type, form.cost, `${branchPath}cost`);
    if (costErr.length) return { ok: false, errors: costErr };

    for (let i = 0; i < form.effects.length; i++) {
        const valRes = validateSingleEffect(form.effects[i], `${branchPath}effects[${i}]`);
        if (!valRes.ok) return { ok: false, errors: [valRes.error] };
    }

    if (!hasBehavioralDifference(parentForm, form)) {
        return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.NUMERIC_ONLY_BRANCH, path: branchPath.replace(/\.$/, ''), message: 'Written branch must change behavior, not merely numeric fields' }] };
    }

    const scoreRes = powerScore(form);
    if (!scoreRes.ok) return scoreRes;
    const budget = budgetFor(tier, branch.step, constants);
    if (budget === null || scoreRes.score > budget) {
        return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BUDGET_CLOSURE, path: `${branchPath}powerScore`, message: `Power score ${scoreRes.score} exceeds budget ${budget} at step ${branch.step}` }] };
    }
    form.powerScore = scoreRes.score;
    return { ok: true, form };
}

function resolveSchema(s, defs) {
    let curr = s;
    let depth = 0;
    while (curr && curr.$ref && depth < 10) {
        const refName = curr.$ref.replace('#/$defs/', '');
        const target = defs ? defs[refName] : null;
        if (!target) break;
        const { $ref: _r, ...siblings } = curr;
        curr = Object.keys(siblings).length > 0 ? { ...target, ...siblings } : target;
        depth++;
    }
    return curr;
}

function matchesDiscriminator(resolvedSub, key, valKey) {
    if (!resolvedSub || !resolvedSub.properties || !resolvedSub.properties[key]) return false;
    const prop = resolvedSub.properties[key];
    if (prop.const !== undefined && prop.const === valKey) return true;
    if (Array.isArray(prop.enum) && prop.enum.includes(valKey)) return true;
    return false;
}

/**
 * Generic schema validation for manifest and owned definitions subset with $ref sibling checks.
 * Evaluates keywords independently of explicit type so siblings (e.g. maxLength:40 on $ref) are strictly enforced.
 * Record boundaries allow and validate id/pack; nested structures strictly reject them.
 */
function validateSchemaValue(val, schema, defs, path = '', options = {}) {
    const errors = [];
    if (!schema) return errors;

    if (schema.$ref) {
        const refName = schema.$ref.replace('#/$defs/', '');
        const targetDef = defs[refName];
        if (!targetDef) {
            errors.push({ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path, message: `Unknown schema ref: ${schema.$ref}` });
            return errors;
        }
        const { $ref: _r, ...siblings } = schema;
        const merged = Object.keys(siblings).length > 0 ? { ...targetDef, ...siblings } : targetDef;
        return validateSchemaValue(val, merged, defs, path, options);
    }

    if (schema.oneOf) {
        const matches = [];
        const branchDiagnostics = [];
        for (const sub of schema.oneOf) {
            const errs = validateSchemaValue(val, sub, defs, path, options);
            if (errs.length === 0) {
                matches.push(sub);
            }
            branchDiagnostics.push({ sub, resolved: resolveSchema(sub, defs), errs });
        }
        if (matches.length === 1) {
            return errors;
        }
        if (matches.length > 1) {
            errors.push({ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path, message: `Value matched multiple oneOf branches (${matches.length})` });
            return errors;
        }

        // matches.length === 0: select discriminator-compatible alternative (op/kind or matching type)
        let selected = null;
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
            if (val.op !== undefined) {
                const opBranches = branchDiagnostics.filter(b => matchesDiscriminator(b.resolved, 'op', val.op));
                if (opBranches.length === 1) selected = opBranches[0];
            }
            if (!selected && val.kind !== undefined) {
                const kindBranches = branchDiagnostics.filter(b => matchesDiscriminator(b.resolved, 'kind', val.kind));
                if (kindBranches.length === 1) selected = kindBranches[0];
            }
            if (!selected) {
                const objBranches = branchDiagnostics.filter(b => b.resolved?.type === 'object' || b.resolved?.properties !== undefined);
                if (objBranches.length === 1) selected = objBranches[0];
            }
        } else if (val === null) {
            const nullBranches = branchDiagnostics.filter(b => b.resolved?.type === 'null');
            if (nullBranches.length === 1) selected = nullBranches[0];
        } else if (typeof val === 'string') {
            const strBranches = branchDiagnostics.filter(b => b.resolved?.type === 'string');
            if (strBranches.length === 1) selected = strBranches[0];
        } else if (typeof val === 'number') {
            const numBranches = branchDiagnostics.filter(b => b.resolved?.type === 'integer' || b.resolved?.type === 'number');
            if (numBranches.length === 1) selected = numBranches[0];
        } else if (typeof val === 'boolean') {
            const boolBranches = branchDiagnostics.filter(b => b.resolved?.type === 'boolean');
            if (boolBranches.length === 1) selected = boolBranches[0];
        }

        if (selected && selected.errs.length > 0) {
            return selected.errs;
        }

        errors.push({ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path, message: 'Value did not match any oneOf branch' });
        return errors;
    }

    // Type validation
    if (schema.type) {
        const t = schema.type;
        if (t === 'object') {
            if (val === null || typeof val !== 'object' || Array.isArray(val)) {
                errors.push({ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path, message: `Expected object, got ${Array.isArray(val) ? 'array' : typeof val}` });
                return errors;
            }
        } else if (t === 'array') {
            if (!Array.isArray(val)) {
                errors.push({ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path, message: `Expected array, got ${typeof val}` });
                return errors;
            }
        } else if (t === 'string') {
            if (typeof val !== 'string') {
                errors.push({ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path, message: `Expected string, got ${typeof val}` });
                return errors;
            }
        } else if (t === 'integer') {
            if (typeof val !== 'number' || !Number.isSafeInteger(val)) {
                errors.push({ code: RULES_V2_ERROR_CODES.NUMERIC_RANGE, path, message: `Expected safe integer, got ${val}` });
                return errors;
            }
        } else if (t === 'boolean') {
            if (typeof val !== 'boolean') {
                errors.push({ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path, message: `Expected boolean, got ${typeof val}` });
                return errors;
            }
        } else if (t === 'null') {
            if (val !== null) {
                errors.push({ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path, message: `Expected null, got ${typeof val}` });
                return errors;
            }
        }
    }

    // String keywords
    if (typeof val === 'string') {
        const codePointLen = [...val].length;
        if (schema.minLength !== undefined && codePointLen < schema.minLength) {
            errors.push({ code: RULES_V2_ERROR_CODES.NUMERIC_RANGE, path, message: `String length ${codePointLen} below minLength ${schema.minLength}` });
        }
        if (schema.maxLength !== undefined && codePointLen > schema.maxLength) {
            errors.push({ code: RULES_V2_ERROR_CODES.NUMERIC_RANGE, path, message: `String length ${codePointLen} above maxLength ${schema.maxLength}` });
        }
        if (schema.pattern) {
            const regex = new RegExp(schema.pattern);
            if (!regex.test(val)) {
                errors.push({ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path, message: `String "${val}" does not match pattern ${schema.pattern}` });
            }
        }
    }

    // Number keywords
    if (typeof val === 'number') {
        if (schema.minimum !== undefined && val < schema.minimum) {
            errors.push({ code: RULES_V2_ERROR_CODES.NUMERIC_RANGE, path, message: `Number ${val} below minimum ${schema.minimum}` });
        }
        if (schema.maximum !== undefined && val > schema.maximum) {
            errors.push({ code: RULES_V2_ERROR_CODES.NUMERIC_RANGE, path, message: `Number ${val} above maximum ${schema.maximum}` });
        }
        if (schema.multipleOf !== undefined && val % schema.multipleOf !== 0) {
            errors.push({ code: RULES_V2_ERROR_CODES.NUMERIC_RANGE, path, message: `Number ${val} must be a multiple of ${schema.multipleOf}` });
        }
        if (schema.not && schema.not.const !== undefined && val === schema.not.const) {
            errors.push({ code: RULES_V2_ERROR_CODES.NUMERIC_RANGE, path, message: `Number cannot equal ${schema.not.const}` });
        }
    }

    // Array keywords
    if (Array.isArray(val)) {
        const isClassSkills = path.endsWith('skills') && (path.includes('classes') || path.startsWith('classes'));
        if (schema.minItems !== undefined && val.length < schema.minItems) {
            errors.push({
                code: isClassSkills ? RULES_V2_ERROR_CODES.CLASS_SKILLS : RULES_V2_ERROR_CODES.NUMERIC_RANGE,
                path,
                message: `Array has ${val.length} items, minimum ${schema.minItems}`
            });
        }
        if (schema.maxItems !== undefined && val.length > schema.maxItems) {
            errors.push({
                code: isClassSkills ? RULES_V2_ERROR_CODES.CLASS_SKILLS : RULES_V2_ERROR_CODES.NUMERIC_RANGE,
                path,
                message: `Array has ${val.length} items, maximum ${schema.maxItems}`
            });
        }
        if (schema.uniqueItems) {
            const set = new Set(val.map(x => typeof x === 'object' ? JSON.stringify(x) : x));
            if (set.size !== val.length) {
                errors.push({
                    code: isClassSkills ? RULES_V2_ERROR_CODES.CLASS_SKILLS : RULES_V2_ERROR_CODES.DUP_ID,
                    path,
                    message: 'Array items must be unique'
                });
            }
        }
        if (schema.items) {
            const areItemsRecords = (
                path.endsWith('classes') || path.endsWith('skills') || path.endsWith('branches') ||
                path.endsWith('trainers') || path.endsWith('items') || path.endsWith('creatures') ||
                path.endsWith('quests') || path.endsWith('shops') || path.endsWith('recipes') ||
                path.endsWith('places') || path.endsWith('rules')
            );
            for (let i = 0; i < val.length; i++) {
                errors.push(...validateSchemaValue(
                    val[i],
                    schema.items,
                    defs,
                    `${path}[${i}]`,
                    { ...options, isRecordBoundary: areItemsRecords }
                ));
            }
        }
    }

    // Object keywords
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
        if (schema.required) {
            for (const req of schema.required) {
                if (val[req] === undefined) {
                    errors.push({ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path: path ? `${path}.${req}` : req, message: `Missing required field: "${req}"` });
                }
            }
        }
        if (schema.properties) {
            for (const [propName, propSchema] of Object.entries(schema.properties)) {
                if (val[propName] !== undefined) {
                    errors.push(...validateSchemaValue(
                        val[propName],
                        propSchema,
                        defs,
                        path ? `${path}.${propName}` : propName,
                        { ...options, isRecordBoundary: false } // NEVER propagate record boundary to properties
                    ));
                }
            }
        }
        if (schema.additionalProperties === false && schema.properties) {
            const allowed = new Set(Object.keys(schema.properties));
            const isRecord = options.isRecordBoundary === true;
            for (const key of Object.keys(val)) {
                if (isRecord && (key === 'id' || key === 'pack')) {
                    if (key === 'id') {
                        if (typeof val.id !== 'string' || !(RECORD_ID_REGEX.test(val.id) || DEF_ID_REGEX.test(val.id) || REF_REGEX.test(val.id))) {
                            errors.push({ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path: path ? `${path}.id` : 'id', message: 'Record id wrapper has invalid syntax' });
                        }
                    } else if (key === 'pack') {
                        if (typeof val.pack !== 'string' || !PACK_ID.test(val.pack)) {
                            errors.push({ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path: path ? `${path}.pack` : 'pack', message: 'Record pack wrapper has invalid syntax' });
                        }
                    }
                    continue;
                }
                if (!allowed.has(key)) {
                    errors.push({ code: RULES_V2_ERROR_CODES.ENVELOPE_UNKNOWN, path: path ? `${path}.${key}` : key, message: `Unknown field: "${key}"` });
                }
            }
        }
    }

    if (schema.const !== undefined && val !== schema.const) {
        errors.push({ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path, message: `Expected constant ${JSON.stringify(schema.const)}, got ${JSON.stringify(val)}` });
    }

    if (schema.enum && !schema.enum.includes(val)) {
        errors.push({ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path, message: `Value ${JSON.stringify(val)} not in enum: ${schema.enum.join(', ')}` });
    }

    return errors;
}

/**
 * Normalizes a raw rules manifest object without mutating the input.
 * Requires valid packKey matching SB PACK_ID. Validates constants per frozen type.
 * Strips host wrappers (id, pack) from manifest root for closed checking while retaining pack identity.
 * Applies schema defaults generically without guessing required unannotated lists.
 * Converges local and same-pack refs on qualified normalized IDs.
 */
export function normalizeRulesV2(raw, rawOptions = {}) {
    const options = (rawOptions && typeof rawOptions === 'object' && !Array.isArray(rawOptions)) ? rawOptions : {};
    const { packKey = null, constants = RULES_V2_CONSTANTS } = options;

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path: '', message: 'Manifest must be an object' }] };
    }

    if (!packKey || typeof packKey !== 'string' || !PACK_ID.test(packKey)) {
        return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path: 'packKey', message: 'Valid packKey matching PACK_ID (1 to 40 lowercase letters, digits, or dashes) is required' }] };
    }

    const constRes = validateConstants(constants);
    if (!constRes.ok) return constRes;

    const plainErrors = checkPlainSafety(raw);
    if (plainErrors.length) return { ok: false, errors: plainErrors };

    const cloned = clonePlain(raw);

    if (cloned.id !== undefined) {
        if (typeof cloned.id !== 'string' || !(RECORD_ID_REGEX.test(cloned.id) || DEF_ID_REGEX.test(cloned.id) || REF_REGEX.test(cloned.id))) {
            return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path: 'id', message: 'Manifest id wrapper has invalid syntax' }] };
        }
        delete cloned.id;
    }
    if (cloned.pack !== undefined) {
        if (typeof cloned.pack !== 'string' || !PACK_ID.test(cloned.pack) || (packKey && cloned.pack !== packKey)) {
            return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path: 'pack', message: 'Manifest pack wrapper has invalid syntax or does not match packKey' }] };
        }
        delete cloned.pack;
    }

    for (const kind of ['classes', 'skills', 'branches', 'trainers']) {
        if (Array.isArray(cloned[kind])) {
            for (let i = 0; i < cloned[kind].length; i++) {
                const rec = cloned[kind][i];
                if (rec && typeof rec === 'object' && !Array.isArray(rec)) {
                    if (rec.id !== undefined) {
                        if (typeof rec.id !== 'string' || !(RECORD_ID_REGEX.test(rec.id) || DEF_ID_REGEX.test(rec.id) || REF_REGEX.test(rec.id))) {
                            return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path: `${kind}[${i}].id`, message: 'Record id wrapper has invalid syntax' }] };
                        }
                        delete rec.id;
                    }
                    if (rec.pack !== undefined) {
                        if (typeof rec.pack !== 'string' || !PACK_ID.test(rec.pack) || rec.pack !== packKey) {
                            return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path: `${kind}[${i}].pack`, message: 'Record pack wrapper has invalid syntax' }] };
                        }
                        delete rec.pack;
                    }
                }
            }
        }
    }

    // Apply generic annotated defaults from rulesV2Schema
    if (cloned.statLabels === undefined && rulesV2Schema.properties.statLabels?.default !== undefined) {
        cloned.statLabels = clonePlain(rulesV2Schema.properties.statLabels.default);
    }
    if (cloned.memory === undefined && rulesV2Schema.properties.memory?.default !== undefined) {
        cloned.memory = rulesV2Schema.properties.memory.default;
    }

    const norm = normalizeStructure(cloned);

    // Default application on children from schema annotations
    const noteDef = rulesV2Schema.$defs.note?.default ?? '';
    const repDef = rulesV2Schema.$defs.skill?.properties?.replaces?.default ?? null;
    const uniqueDef = rulesV2Schema.$defs.itemRule?.properties?.unique?.default ?? false;

    if (Array.isArray(norm.classes)) {
        for (const cls of norm.classes) {
            if (cls && typeof cls === 'object' && !Array.isArray(cls)) {
                if (cls.note === undefined) cls.note = noteDef;
            }
        }
    }
    if (Array.isArray(norm.skills)) {
        for (const skl of norm.skills) {
            if (skl && typeof skl === 'object' && !Array.isArray(skl)) {
                if (skl.note === undefined) skl.note = noteDef;
                if (skl.replaces === undefined) skl.replaces = repDef;
            }
        }
    }
    if (Array.isArray(norm.branches)) {
        for (const br of norm.branches) {
            if (br && typeof br === 'object' && !Array.isArray(br)) {
                if (br.note === undefined) br.note = noteDef;
            }
        }
    }
    if (Array.isArray(norm.itemRules)) {
        for (const ir of norm.itemRules) {
            if (ir && typeof ir === 'object' && !Array.isArray(ir)) {
                if (ir.unique === undefined) ir.unique = uniqueDef;
            }
        }
    }

    const schemaErrors = validateSchemaValue(norm, rulesV2Schema, rulesV2Schema.$defs, '', { isRecordBoundary: true });
    if (schemaErrors.length) return { ok: false, errors: schemaErrors };

    // Converge local and qualified references to normalized IDs
    const prefix = `pack.${packKey}/`;
    const toFull = ref => (typeof ref === 'string' && !ref.startsWith('pack.') && !ref.startsWith('story/') ? `${prefix}${ref}` : ref);

    norm.pack = packKey;
    norm.id = `${prefix}${norm.slug}`;

    if (Array.isArray(norm.classes)) {
        for (const cls of norm.classes) {
            if (cls && typeof cls === 'object') {
                cls.id = `${prefix}${cls.slug}`;
                cls.pack = packKey;
                if (cls.parent) cls.parent = toFull(cls.parent);
                if (Array.isArray(cls.skills)) cls.skills = cls.skills.map(toFull);
            }
        }
    }

    if (Array.isArray(norm.skills)) {
        for (const skl of norm.skills) {
            if (skl && typeof skl === 'object') {
                skl.id = `${prefix}${skl.slug}`;
                skl.pack = packKey;
                if (skl.replaces) skl.replaces = toFull(skl.replaces);
                if (skl.base?.unit?.class) skl.base.unit.class = toFull(skl.base.unit.class);
            }
        }
    }

    if (Array.isArray(norm.branches)) {
        for (const br of norm.branches) {
            if (br && typeof br === 'object') {
                br.id = `${prefix}${br.slug}`;
                br.pack = packKey;
                if (br.skill) br.skill = toFull(br.skill);
                if (br.fromForm) br.fromForm = toFull(br.fromForm);
            }
        }
    }

    if (Array.isArray(norm.itemRules)) {
        for (const ir of norm.itemRules) {
            if (ir && typeof ir === 'object') {
                if (ir.def) ir.def = toFull(ir.def);
            }
        }
    }

    if (Array.isArray(norm.trainers)) {
        for (const trn of norm.trainers) {
            if (trn && typeof trn === 'object') {
                trn.id = `${prefix}${trn.slug}`;
                trn.pack = packKey;
                if (Array.isArray(trn.skills)) trn.skills = trn.skills.map(toFull);
                if (Array.isArray(trn.eventTemplates)) trn.eventTemplates = trn.eventTemplates.map(toFull);
            }
        }
    }

    return { ok: true, manifest: canonicalizeJson(norm) };
}

/** Resolves reference against local pack set or verifies external syntax. */
function checkReference(ref, packId, localSet, externalAllowed = false, path = '') {
    if (!ref || typeof ref !== 'string') {
        return { ok: false, error: { code: RULES_V2_ERROR_CODES.BAD_REF, path, message: 'Reference must be a string' } };
    }
    const prefix = `pack.${packId}/`;
    let localSlug = ref;
    if (ref.startsWith(prefix)) {
        localSlug = ref.slice(prefix.length);
    }
    if (localSet.has(localSlug)) {
        return { ok: true, id: `${prefix}${localSlug}`, isExternal: false };
    }
    if (externalAllowed) {
        if (RECORD_ID_REGEX.test(ref) || DEF_ID_REGEX.test(ref) || REF_REGEX.test(ref)) {
            return { ok: true, id: ref, isExternal: true };
        }
    }
    if (ref.startsWith('pack.') && !ref.startsWith(prefix)) {
        return { ok: false, error: { code: RULES_V2_ERROR_CODES.BAD_REF, path, message: `Foreign-pack internal reference "${ref}" is rejected` } };
    }
    return { ok: false, error: { code: RULES_V2_ERROR_CODES.BAD_REF, path, message: `Reference "${ref}" could not be resolved` } };
}

/**
 * Validates manifest and owned content per SPEC §7.
 * Resolves references, checks graph, budgets, 24 written + 12 generated structure, slots/hands compatibility.
 * Structural owned-content validation completes before semantic access. Never mutates caller data.
 */
export function validateRulesV2(manifest, content = {}, constants = RULES_V2_CONSTANTS) {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path: '', message: 'Manifest must be an object' }] };
    }
    if (!content || typeof content !== 'object' || Array.isArray(content)) {
        return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path: 'content', message: 'Content must be an object' }] };
    }

    const plainErrors = checkPlainSafety({ manifest, content });
    if (plainErrors.length) return { ok: false, errors: plainErrors };

    const constRes = validateConstants(constants);
    if (!constRes.ok) return constRes;
    const c = constRes.constants;

    const packKey = manifest.pack;
    if (!packKey || typeof packKey !== 'string' || !PACK_ID.test(packKey)) {
        return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path: 'pack', message: 'Manifest must be normalized with a packKey before validation' }] };
    }

    // Structural validation of manifest root against rulesV2Schema
    const manifestSchemaErrors = validateSchemaValue(manifest, rulesV2Schema, rulesV2Schema.$defs, 'content.rules[0]', { isRecordBoundary: true });
    if (manifestSchemaErrors.length) {
        return { ok: false, errors: manifestSchemaErrors };
    }

    const errors = [];
    const warnings = [];

    // Clone inputs safely so caller objects are never mutated or frozen
    const m = clonePlain(manifest);
    const cnt = clonePlain(content);
    delete cnt._envelope;

    // Structural validation of owned content container lists: must be arrays if present
    const ownedContainerKinds = ['items', 'creatures', 'quests', 'shops', 'recipes', 'places', 'events'];
    for (const k of ownedContainerKinds) {
        if (cnt[k] !== undefined && !Array.isArray(cnt[k])) {
            return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path: `content.${k}`, message: `content.${k} must be an array` }] };
        }
    }

    const contentItems = cnt.items ?? [];
    const contentCreatures = cnt.creatures ?? [];
    const contentQuests = cnt.quests ?? [];
    const contentShops = cnt.shops ?? [];
    const contentRecipes = cnt.recipes ?? [];
    const contentPlaces = cnt.places ?? [];
    const contentEvents = cnt.events ?? [];

    for (let i = 0; i < contentCreatures.length; i++) {
        errors.push(...validateSchemaValue(contentCreatures[i], rulesV2Schema.$defs.foe, rulesV2Schema.$defs, `content.creatures[${i}]`, { isRecordBoundary: true }));
    }
    for (let i = 0; i < contentQuests.length; i++) {
        errors.push(...validateSchemaValue(contentQuests[i], rulesV2Schema.$defs.quest, rulesV2Schema.$defs, `content.quests[${i}]`, { isRecordBoundary: true }));
    }
    for (let i = 0; i < contentShops.length; i++) {
        errors.push(...validateSchemaValue(contentShops[i], rulesV2Schema.$defs.shop, rulesV2Schema.$defs, `content.shops[${i}]`, { isRecordBoundary: true }));
    }
    for (let i = 0; i < contentRecipes.length; i++) {
        const rcp = contentRecipes[i];
        if (rcp && typeof rcp === 'object' && rcp.known === undefined) {
            rcp.known = rulesV2Schema.$defs.recipe?.properties?.known?.default ?? true;
        }
        errors.push(...validateSchemaValue(rcp, rulesV2Schema.$defs.recipe, rulesV2Schema.$defs, `content.recipes[${i}]`, { isRecordBoundary: true }));
    }

    if (errors.length) return { ok: false, errors };

    // Sets for slug uniqueness and reference verification
    const classSlugs = new Set();
    for (let i = 0; i < (m.classes ?? []).length; i++) {
        const s = m.classes[i].slug;
        if (classSlugs.has(s)) errors.push({ code: RULES_V2_ERROR_CODES.DUP_ID, path: `content.rules[0].classes[${i}].slug`, message: `Duplicate class slug "${s}"` });
        classSlugs.add(s);
    }

    const skillSlugs = new Set();
    for (let i = 0; i < (m.skills ?? []).length; i++) {
        const s = m.skills[i].slug;
        if (skillSlugs.has(s)) errors.push({ code: RULES_V2_ERROR_CODES.DUP_ID, path: `content.rules[0].skills[${i}].slug`, message: `Duplicate skill slug "${s}"` });
        skillSlugs.add(s);
    }

    const branchSlugs = new Set();
    for (let i = 0; i < (m.branches ?? []).length; i++) {
        const s = m.branches[i].slug;
        if (branchSlugs.has(s)) errors.push({ code: RULES_V2_ERROR_CODES.DUP_ID, path: `content.rules[0].branches[${i}].slug`, message: `Duplicate branch slug "${s}"` });
        branchSlugs.add(s);
    }

    const trainerSlugs = new Set();
    for (let i = 0; i < (m.trainers ?? []).length; i++) {
        const s = m.trainers[i].slug;
        if (trainerSlugs.has(s)) errors.push({ code: RULES_V2_ERROR_CODES.DUP_ID, path: `content.rules[0].trainers[${i}].slug`, message: `Duplicate trainer slug "${s}"` });
        trainerSlugs.add(s);
    }

    const itemSlugs = new Set();
    for (let i = 0; i < contentItems.length; i++) {
        const s = contentItems[i].slug;
        if (itemSlugs.has(s)) errors.push({ code: RULES_V2_ERROR_CODES.DUP_ID, path: `content.items[${i}].slug`, message: `Duplicate item slug "${s}"` });
        itemSlugs.add(s);
    }

    const creatureSlugs = new Set();
    for (let i = 0; i < contentCreatures.length; i++) {
        const s = contentCreatures[i].slug;
        if (creatureSlugs.has(s)) errors.push({ code: RULES_V2_ERROR_CODES.DUP_ID, path: `content.creatures[${i}].slug`, message: `Duplicate creature slug "${s}"` });
        creatureSlugs.add(s);
    }

    const questSlugs = new Set();
    for (let i = 0; i < contentQuests.length; i++) {
        const s = contentQuests[i].slug;
        if (questSlugs.has(s)) errors.push({ code: RULES_V2_ERROR_CODES.DUP_ID, path: `content.quests[${i}].slug`, message: `Duplicate quest slug "${s}"` });
        questSlugs.add(s);
    }

    const shopSlugs = new Set();
    for (let i = 0; i < contentShops.length; i++) {
        const s = contentShops[i].slug;
        if (shopSlugs.has(s)) errors.push({ code: RULES_V2_ERROR_CODES.DUP_ID, path: `content.shops[${i}].slug`, message: `Duplicate shop slug "${s}"` });
        shopSlugs.add(s);
    }

    const recipeSlugs = new Set();
    for (let i = 0; i < contentRecipes.length; i++) {
        const s = contentRecipes[i].slug;
        if (recipeSlugs.has(s)) errors.push({ code: RULES_V2_ERROR_CODES.DUP_ID, path: `content.recipes[${i}].slug`, message: `Duplicate recipe slug "${s}"` });
        recipeSlugs.add(s);
    }

    const placeSlugs = new Set();
    for (let i = 0; i < contentPlaces.length; i++) {
        const s = contentPlaces[i].slug;
        if (placeSlugs.has(s)) errors.push({ code: RULES_V2_ERROR_CODES.DUP_ID, path: `content.places[${i}].slug`, message: `Duplicate place slug "${s}"` });
        placeSlugs.add(s);
    }

    const eventSlugs = new Set();
    for (let i = 0; i < contentEvents.length; i++) {
        const s = contentEvents[i].slug ?? contentEvents[i].id;
        if (s) eventSlugs.add(s);
    }

    // Class hierarchy and skill ownership
    const classBySlug = new Map();
    const skillOwner = new Map();

    for (let i = 0; i < (m.classes ?? []).length; i++) {
        const cls = m.classes[i];
        classBySlug.set(cls.slug, cls);
        if (!cls.skills || cls.skills.length !== 3) {
            errors.push({ code: RULES_V2_ERROR_CODES.CLASS_SKILLS, path: `content.rules[0].classes[${i}].skills`, message: `Class "${cls.slug}" must have exactly 3 skills` });
        } else {
            const rawSkills = cls.skills.map(s => s.startsWith(`pack.${packKey}/`) ? s.slice(`pack.${packKey}/`.length) : s);
            const uniqueSkills = new Set(rawSkills);
            if (uniqueSkills.size !== 3) {
                errors.push({ code: RULES_V2_ERROR_CODES.CLASS_SKILLS, path: `content.rules[0].classes[${i}].skills`, message: `Skills for class "${cls.slug}" must be unique` });
            }
            for (let j = 0; j < rawSkills.length; j++) {
                const s = rawSkills[j];
                if (!skillSlugs.has(s)) {
                    errors.push({ code: RULES_V2_ERROR_CODES.BAD_REF, path: `content.rules[0].classes[${i}].skills[${j}]`, message: `Referenced skill "${s}" does not exist in manifest` });
                } else if (skillOwner.has(s)) {
                    errors.push({ code: RULES_V2_ERROR_CODES.CLASS_SKILLS, path: `content.rules[0].classes[${i}].skills[${j}]`, message: `Skill "${s}" is already owned by class "${skillOwner.get(s)}"` });
                } else {
                    skillOwner.set(s, cls.slug);
                }
            }
        }
        if (cls.tier === 0) {
            if (cls.parent !== null) {
                errors.push({ code: RULES_V2_ERROR_CODES.TIER_CHAIN, path: `content.rules[0].classes[${i}].parent`, message: `Tier 0 class "${cls.slug}" must have parent null` });
            }
        } else {
            if (!cls.parent) {
                errors.push({ code: RULES_V2_ERROR_CODES.TIER_CHAIN, path: `content.rules[0].classes[${i}].parent`, message: `Tier ${cls.tier} class "${cls.slug}" must have a parent` });
            }
        }
    }

    // Check each skill has exactly one owner (no orphan skills)
    for (let i = 0; i < (m.skills ?? []).length; i++) {
        const skl = m.skills[i];
        if (!skillOwner.has(skl.slug)) {
            errors.push({ code: RULES_V2_ERROR_CODES.CLASS_SKILLS, path: `content.rules[0].skills[${i}]`, message: `Orphan skill "${skl.slug}" is not owned by any class` });
        }
    }

    // Class parent linkage and tier chain
    const parentOf = new Set();
    for (let i = 0; i < (m.classes ?? []).length; i++) {
        const cls = m.classes[i];
        if (cls.parent) {
            const parentSlug = cls.parent.startsWith(`pack.${packKey}/`) ? cls.parent.slice(`pack.${packKey}/`.length) : cls.parent;
            parentOf.add(parentSlug);
            const pClass = classBySlug.get(parentSlug);
            if (!pClass) {
                errors.push({ code: RULES_V2_ERROR_CODES.BAD_REF, path: `content.rules[0].classes[${i}].parent`, message: `Parent class "${cls.parent}" not found` });
            } else if (pClass.tier !== cls.tier - 1) {
                errors.push({ code: RULES_V2_ERROR_CODES.TIER_CHAIN, path: `content.rules[0].classes[${i}].parent`, message: `Class "${cls.slug}" (tier ${cls.tier}) parent "${cls.parent}" must be tier ${cls.tier - 1}` });
            }
        }
    }

    // Cycle and root check
    for (let i = 0; i < (m.classes ?? []).length; i++) {
        const cls = m.classes[i];
        let cur = cls;
        const visited = new Set();
        while (cur && cur.parent) {
            if (visited.has(cur.slug)) {
                errors.push({ code: RULES_V2_ERROR_CODES.TIER_CHAIN, path: `content.rules[0].classes[${i}]`, message: `Cycle detected in class hierarchy through "${cur.slug}"` });
                break;
            }
            visited.add(cur.slug);
            const pSlug = cur.parent.startsWith(`pack.${packKey}/`) ? cur.parent.slice(`pack.${packKey}/`.length) : cur.parent;
            cur = classBySlug.get(pSlug);
        }
        if (cur && cur.tier !== 0) {
            errors.push({ code: RULES_V2_ERROR_CODES.TIER_CHAIN, path: `content.rules[0].classes[${i}]`, message: `Class "${cls.slug}" does not chain back to a tier 0 root` });
        }
    }

    // All leaves must be tier 3
    for (let i = 0; i < (m.classes ?? []).length; i++) {
        const cls = m.classes[i];
        if (!parentOf.has(cls.slug) && cls.tier !== 3) {
            errors.push({ code: RULES_V2_ERROR_CODES.TIER_CHAIN, path: `content.rules[0].classes[${i}].tier`, message: `Leaf class "${cls.slug}" must be tier 3` });
        }
    }

    // Skills validation
    for (let i = 0; i < (m.skills ?? []).length; i++) {
        const skl = m.skills[i];
        if ([...skl.slug].length > 52) {
            errors.push({ code: RULES_V2_ERROR_CODES.NUMERIC_RANGE, path: `content.rules[0].skills[${i}].slug`, message: `Skill slug "${skl.slug}" exceeds maximum length 52` });
        }
        const owningClassSlug = skillOwner.get(skl.slug);
        const owningClass = owningClassSlug ? classBySlug.get(owningClassSlug) : null;
        const tier = owningClass ? owningClass.tier : 0;

        const costErr = validateCostCompatibility(skl.base.type, skl.base.cost, `content.rules[0].skills[${i}].base.cost`);
        errors.push(...costErr);

        for (let eIdx = 0; eIdx < skl.base.effects.length; eIdx++) {
            const valRes = validateSingleEffect(skl.base.effects[eIdx], `content.rules[0].skills[${i}].base.effects[${eIdx}]`);
            if (!valRes.ok) errors.push(valRes.error);
        }

        if (skl.base.unit) {
            const uClass = skl.base.unit.class.startsWith(`pack.${packKey}/`) ? skl.base.unit.class.slice(`pack.${packKey}/`.length) : skl.base.unit.class;
            if (!classSlugs.has(uClass)) {
                errors.push({ code: RULES_V2_ERROR_CODES.BAD_REF, path: `content.rules[0].skills[${i}].base.unit.class`, message: `Unit class "${skl.base.unit.class}" not found` });
            }
        }
        if (skl.replaces) {
            const rep = skl.replaces.startsWith(`pack.${packKey}/`) ? skl.replaces.slice(`pack.${packKey}/`.length) : skl.replaces;
            if (!skillSlugs.has(rep)) {
                errors.push({ code: RULES_V2_ERROR_CODES.BAD_REF, path: `content.rules[0].skills[${i}].replaces`, message: `Replaced skill "${skl.replaces}" not found` });
            }
        }

        const scoreRes = powerScore(skl.base);
        if (!scoreRes.ok) {
            errors.push(...scoreRes.errors);
        } else {
            const budget = budgetFor(tier, 0, c);
            if (budget === null || scoreRes.score > budget) {
                errors.push({ code: RULES_V2_ERROR_CODES.BUDGET_CLOSURE, path: `content.rules[0].skills[${i}].base.powerScore`, message: `Skill "${skl.slug}" power score ${scoreRes.score} exceeds tier ${tier} budget ${budget}` });
            }
        }
    }

    // Form ID collision index: reserve all base, written, and generated form IDs
    const reservedFormIds = new Map();
    for (const skl of m.skills ?? []) {
        const baseFormId = `pack.${packKey}/${skl.slug}-base`;
        reservedFormIds.set(baseFormId, `base form of skill "${skl.slug}"`);
        const owningClassSlug = skillOwner.get(skl.slug);
        const owningClass = owningClassSlug ? classBySlug.get(owningClassSlug) : null;
        if (owningClass && owningClass.tier === 3) {
            const s1 = [`${baseFormId}-g`, `${baseFormId}-a`, `${baseFormId}-b`];
            for (const f of s1) reservedFormIds.set(f, `step 1 form of skill "${skl.slug}"`);
            for (const p of s1) {
                for (const ch of ['g', 'a', 'b']) {
                    reservedFormIds.set(`${p}-${ch}`, `step 2 form of skill "${skl.slug}"`);
                }
            }
        }
    }

    // Check collision of all authored definition slugs/IDs with reserved form IDs
    for (let i = 0; i < (m.skills ?? []).length; i++) {
        const skl = m.skills[i];
        const qId = `pack.${packKey}/${skl.slug}`;
        if (reservedFormIds.has(qId)) {
            errors.push({ code: RULES_V2_ERROR_CODES.DUP_ID, path: `content.rules[0].skills[${i}].slug`, message: `Skill slug "${skl.slug}" collides with form ID "${qId}"` });
        }
    }

    for (let i = 0; i < (m.classes ?? []).length; i++) {
        const cls = m.classes[i];
        const qId = `pack.${packKey}/${cls.slug}`;
        if (reservedFormIds.has(qId)) {
            errors.push({ code: RULES_V2_ERROR_CODES.DUP_ID, path: `content.rules[0].classes[${i}].slug`, message: `Class slug "${cls.slug}" collides with form ID "${qId}"` });
        }
    }

    for (let i = 0; i < (m.trainers ?? []).length; i++) {
        const trn = m.trainers[i];
        const qId = `pack.${packKey}/${trn.slug}`;
        if (reservedFormIds.has(qId)) {
            errors.push({ code: RULES_V2_ERROR_CODES.DUP_ID, path: `content.rules[0].trainers[${i}].slug`, message: `Trainer slug "${trn.slug}" collides with form ID "${qId}"` });
        }
    }

    for (let i = 0; i < contentItems.length; i++) {
        const it = contentItems[i];
        const qId = `pack.${packKey}/${it.slug}`;
        if (reservedFormIds.has(qId)) {
            errors.push({ code: RULES_V2_ERROR_CODES.DUP_ID, path: `content.items[${i}].slug`, message: `Item slug "${it.slug}" collides with form ID "${qId}"` });
        }
    }

    for (let i = 0; i < contentCreatures.length; i++) {
        const f = contentCreatures[i];
        const qId = `pack.${packKey}/${f.slug}`;
        if (reservedFormIds.has(qId)) {
            errors.push({ code: RULES_V2_ERROR_CODES.DUP_ID, path: `content.creatures[${i}].slug`, message: `Creature slug "${f.slug}" collides with form ID "${qId}"` });
        }
    }

    for (let i = 0; i < contentQuests.length; i++) {
        const q = contentQuests[i];
        const qId = `pack.${packKey}/${q.slug}`;
        if (reservedFormIds.has(qId)) {
            errors.push({ code: RULES_V2_ERROR_CODES.DUP_ID, path: `content.quests[${i}].slug`, message: `Quest slug "${q.slug}" collides with form ID "${qId}"` });
        }
    }

    for (let i = 0; i < contentShops.length; i++) {
        const s = contentShops[i];
        const qId = `pack.${packKey}/${s.slug}`;
        if (reservedFormIds.has(qId)) {
            errors.push({ code: RULES_V2_ERROR_CODES.DUP_ID, path: `content.shops[${i}].slug`, message: `Shop slug "${s.slug}" collides with form ID "${qId}"` });
        }
    }

    for (let i = 0; i < contentRecipes.length; i++) {
        const r = contentRecipes[i];
        const qId = `pack.${packKey}/${r.slug}`;
        if (reservedFormIds.has(qId)) {
            errors.push({ code: RULES_V2_ERROR_CODES.DUP_ID, path: `content.recipes[${i}].slug`, message: `Recipe slug "${r.slug}" collides with form ID "${qId}"` });
        }
    }

    for (let i = 0; i < (m.branches ?? []).length; i++) {
        const br = m.branches[i];
        if (br.slug.endsWith('-g')) {
            errors.push({ code: RULES_V2_ERROR_CODES.DUP_ID, path: `content.rules[0].branches[${i}].slug`, message: 'Branch slug cannot end with reserved generated suffix "-g"' });
        }
        const expectedFromForm = br.fromForm.startsWith(`pack.${packKey}/`) ? br.fromForm.slice(`pack.${packKey}/`.length) : br.fromForm;
        const skillSlug = br.skill.startsWith(`pack.${packKey}/`) ? br.skill.slice(`pack.${packKey}/`.length) : br.skill;
        const baseSlug = `${skillSlug}-base`;
        const parents = br.step === 1 ? [baseSlug] : ['g', 'a', 'b'].map(choice => `${baseSlug}-${choice}`);
        if (!parents.includes(expectedFromForm)) {
            errors.push({ code: RULES_V2_ERROR_CODES.BRANCH_GRAPH, path: `content.rules[0].branches[${i}].fromForm`, message: 'Branch must name its exact parent at the preceding step in its own skill' });
        }
        const expectedSlug = `${expectedFromForm}-${br.choice}`;
        if (br.slug !== expectedSlug) {
            errors.push({ code: RULES_V2_ERROR_CODES.BRANCH_GRAPH, path: `content.rules[0].branches[${i}].slug`, message: `Branch slug "${br.slug}" does not match expected "${expectedSlug}"` });
        }
    }

    // Branch Graph Validation
    const branchesBySkill = new Map();
    const branchIndexMap = new Map();
    for (let i = 0; i < (m.branches ?? []).length; i++) {
        const br = m.branches[i];
        const sklSlug = br.skill.startsWith(`pack.${packKey}/`) ? br.skill.slice(`pack.${packKey}/`.length) : br.skill;
        if (!branchesBySkill.has(sklSlug)) branchesBySkill.set(sklSlug, []);
        branchesBySkill.get(sklSlug).push(br);
        branchIndexMap.set(br, i);
    }

    for (const skl of m.skills ?? []) {
        const owningClassSlug = skillOwner.get(skl.slug);
        const owningClass = owningClassSlug ? classBySlug.get(owningClassSlug) : null;
        const tier = owningClass ? owningClass.tier : 0;
        const branches = branchesBySkill.get(skl.slug) ?? [];

        if (tier < 3) {
            if (branches.length > 0) {
                errors.push({ code: RULES_V2_ERROR_CODES.BRANCH_GRAPH, path: `content.rules[0].skills[${skl.slug}].branches`, message: `Starter/intermediate class skills (tier ${tier}) cannot have branches` });
            }
            continue;
        }

        if (branches.length !== 8) {
            errors.push({ code: RULES_V2_ERROR_CODES.BRANCH_GRAPH, path: `content.rules[0].skills[${skl.slug}].branches`, message: `Advanced skill "${skl.slug}" must have exactly 8 written branches, found ${branches.length}` });
        }

        const baseFormId = `pack.${packKey}/${skl.slug}-base`;
        const baseForm = {
            id: baseFormId,
            skill: `pack.${packKey}/${skl.slug}`,
            name: skl.name,
            note: skl.note ?? '',
            step: 0,
            fromForm: null,
            origin: 'base',
            type: skl.base.type,
            stat: skl.base.stat,
            cost: skl.base.cost,
            effects: skl.base.effects,
            unit: skl.base.unit,
            tier: 3,
        };

        const step1Branches = branches.filter(b => (b.fromForm === baseFormId || b.fromForm === `${skl.slug}-base`) && b.step === 1);
        const step1Choices = new Set(step1Branches.map(b => b.choice));
        if (step1Branches.length !== 2 || step1Choices.size !== 2 || !step1Choices.has('a') || !step1Choices.has('b')) {
            errors.push({ code: RULES_V2_ERROR_CODES.BRANCH_GRAPH, path: `content.rules[0].skills[${skl.slug}].branches`, message: `Skill "${skl.slug}" base form must have written step-1 choices 'a' and 'b'` });
        }

        const g1Res = generatePowerUp(baseForm, c);
        if (!g1Res.ok) errors.push(...g1Res.errors);
        const g1Form = g1Res.ok ? g1Res.form : null;

        const formsAtStep1 = new Map();
        if (g1Form) formsAtStep1.set(g1Form.id, g1Form);

        for (const b of step1Branches) {
            const bIdx = branchIndexMap.get(b);
            const applied = applyBranchTransforms(baseForm, b, 3, c, `content.rules[0].branches[${bIdx}].`);
            if (!applied.ok) errors.push(...applied.errors);
            else formsAtStep1.set(applied.form.id, applied.form);
        }

        const step1Parents = [`${baseFormId}-g`, `${baseFormId}-a`, `${baseFormId}-b`];
        for (const pId of step1Parents) {
            const step2Branches = branches.filter(b => (b.fromForm === pId || b.fromForm === pId.slice(`pack.${packKey}/`.length)) && b.step === 2);
            const step2Choices = new Set(step2Branches.map(b => b.choice));
            if (step2Branches.length !== 2 || step2Choices.size !== 2 || !step2Choices.has('a') || !step2Choices.has('b')) {
                errors.push({ code: RULES_V2_ERROR_CODES.BRANCH_GRAPH, path: `content.rules[0].skills[${skl.slug}].branches`, message: `Parent form "${pId}" must have written step-2 choices 'a' and 'b'` });
            }
            const parentForm = formsAtStep1.get(pId);
            if (parentForm) {
                const g2Res = generatePowerUp(parentForm, c);
                if (!g2Res.ok) errors.push(...g2Res.errors);
                for (const b of step2Branches) {
                    const bIdx = branchIndexMap.get(b);
                    const applied2 = applyBranchTransforms(parentForm, b, 3, c, `content.rules[0].branches[${bIdx}].`);
                    if (!applied2.ok) errors.push(...applied2.errors);
                }
            }
        }
    }

    // Check for unaccounted branches belonging to nonexistent skills
    for (let i = 0; i < (m.branches ?? []).length; i++) {
        const br = m.branches[i];
        const sSlug = br.skill.startsWith(`pack.${packKey}/`) ? br.skill.slice(`pack.${packKey}/`.length) : br.skill;
        if (!skillSlugs.has(sSlug)) {
            errors.push({ code: RULES_V2_ERROR_CODES.BAD_REF, path: `content.rules[0].branches[${i}].skill`, message: `Branch skill "${br.skill}" not found` });
        }
    }

    // Item rules bijection and equipment slot/hands checks
    if (contentItems.length !== (m.itemRules ?? []).length) {
        errors.push({ code: RULES_V2_ERROR_CODES.ITEM_RULE_MISMATCH, path: 'content.rules[0].itemRules', message: `Item rules count (${(m.itemRules ?? []).length}) must match content.items count (${contentItems.length}) 1:1` });
    }

    const itemMap = new Map(contentItems.map(it => [it.slug, it]));
    const coveredItemSlugs = new Set();

    for (let i = 0; i < (m.itemRules ?? []).length; i++) {
        const rule = m.itemRules[i];
        const defSlug = rule.def.startsWith(`pack.${packKey}/`) ? rule.def.slice(`pack.${packKey}/`.length) : rule.def;
        if (coveredItemSlugs.has(defSlug)) {
            errors.push({ code: RULES_V2_ERROR_CODES.ITEM_RULE_MISMATCH, path: `content.rules[0].itemRules[${i}].def`, message: `Duplicate item rule definition "${rule.def}"` });
        }
        coveredItemSlugs.add(defSlug);

        const item = itemMap.get(defSlug);
        if (!item) {
            errors.push({ code: RULES_V2_ERROR_CODES.BAD_REF, path: `content.rules[0].itemRules[${i}].def`, message: `Item rule definition "${rule.def}" does not match any item in content.items` });
            continue;
        }

        if (item.kind !== 'equipment') {
            if (rule.allowedSlots && rule.allowedSlots.length > 0) {
                errors.push({ code: RULES_V2_ERROR_CODES.ITEM_RULE_MISMATCH, path: `content.rules[0].itemRules[${i}].allowedSlots`, message: `Non-equipment item "${item.slug}" must have empty allowedSlots` });
            }
            if (rule.hands !== 0) {
                errors.push({ code: RULES_V2_ERROR_CODES.ITEM_RULE_MISMATCH, path: `content.rules[0].itemRules[${i}].hands`, message: `Non-equipment item "${item.slug}" must have hands 0` });
            }
        } else {
            if (!Array.isArray(rule.allowedSlots) || rule.allowedSlots.length === 0) {
                errors.push({ code: RULES_V2_ERROR_CODES.ITEM_RULE_MISMATCH, path: `content.rules[0].itemRules[${i}].allowedSlots`, message: `Equipment item "${item.slug}" requires nonempty allowedSlots` });
            } else {
                for (const slt of rule.allowedSlots) {
                    if (!RULES_V2_SLOTS.includes(slt)) {
                        errors.push({ code: RULES_V2_ERROR_CODES.ITEM_RULE_MISMATCH, path: `content.rules[0].itemRules[${i}].allowedSlots`, message: `Invalid equipment slot "${slt}"` });
                    }
                }
                const isHand = rule.allowedSlots.includes('weapon') || rule.allowedSlots.includes('offhand');
                if (isHand) {
                    if (rule.hands !== 1 && rule.hands !== 2) {
                        errors.push({ code: RULES_V2_ERROR_CODES.ITEM_RULE_MISMATCH, path: `content.rules[0].itemRules[${i}].hands`, message: 'Hand gear (weapon/offhand) requires hands 1 or 2' });
                    }
                    if (rule.hands === 2) {
                        if (rule.allowedSlots.length !== 1 || rule.allowedSlots[0] !== 'weapon') {
                            errors.push({ code: RULES_V2_ERROR_CODES.ITEM_RULE_MISMATCH, path: `content.rules[0].itemRules[${i}].allowedSlots`, message: '2-handed gear must have allowedSlots ["weapon"] only' });
                        }
                    } else if (rule.hands === 1) {
                        for (const slt of rule.allowedSlots) {
                            if (slt !== 'weapon' && slt !== 'offhand') {
                                errors.push({ code: RULES_V2_ERROR_CODES.ITEM_RULE_MISMATCH, path: `content.rules[0].itemRules[${i}].allowedSlots`, message: '1-handed gear can only occupy weapon or offhand' });
                            }
                        }
                    }
                } else {
                    if (rule.hands !== 0) {
                        errors.push({ code: RULES_V2_ERROR_CODES.ITEM_RULE_MISMATCH, path: `content.rules[0].itemRules[${i}].hands`, message: 'Non-hand equipment requires hands 0' });
                    }
                }
                if (item.slot && !rule.allowedSlots.includes(item.slot)) {
                    errors.push({ code: RULES_V2_ERROR_CODES.ITEM_RULE_MISMATCH, path: `content.rules[0].itemRules[${i}].allowedSlots`, message: `Item rule allowedSlots must include item declared slot "${item.slot}"` });
                }
            }
        }
    }

    // Owned content cross-references
    for (let i = 0; i < contentCreatures.length; i++) {
        const foe = contentCreatures[i];
        const p = `content.creatures[${i}]`;
        if (foe.skills) {
            for (let s = 0; s < foe.skills.length; s++) {
                const sRef = checkReference(foe.skills[s], packKey, skillSlugs, false, `${p}.skills[${s}]`);
                if (!sRef.ok) errors.push(sRef.error);
            }
        }
        if (foe.loot) {
            for (let l = 0; l < foe.loot.length; l++) {
                const lRef = checkReference(foe.loot[l].def, packKey, itemSlugs, false, `${p}.loot[${l}].def`);
                if (!lRef.ok) errors.push(lRef.error);
            }
        }
    }

    for (let i = 0; i < contentQuests.length; i++) {
        const q = contentQuests[i];
        const p = `content.quests[${i}]`;
        if (q.giver) {
            const gRef = checkReference(q.giver, packKey, creatureSlugs, true, `${p}.giver`);
            if (!gRef.ok) errors.push(gRef.error);
            else if (gRef.isExternal) warnings.push({ path: `${p}.giver`, message: `External giver reference "${q.giver}" accepted with runtime eligibility check` });
        }
        if (q.turnInPlace) {
            const pRef = checkReference(q.turnInPlace, packKey, placeSlugs, true, `${p}.turnInPlace`);
            if (!pRef.ok) errors.push(pRef.error);
            else if (pRef.isExternal) warnings.push({ path: `${p}.turnInPlace`, message: `External place reference "${q.turnInPlace}" accepted with runtime eligibility check` });
        }
        if (q.requirements) {
            for (let r = 0; r < q.requirements.length; r++) {
                const req = q.requirements[r];
                if (req.kind === 'class') {
                    for (let cIdx = 0; cIdx < req.classes.length; cIdx++) {
                        const cRef = checkReference(req.classes[cIdx], packKey, classSlugs, false, `${p}.requirements[${r}].classes[${cIdx}]`);
                        if (!cRef.ok) errors.push(cRef.error);
                    }
                } else if (req.kind === 'item') {
                    const iRef = checkReference(req.def, packKey, itemSlugs, false, `${p}.requirements[${r}].def`);
                    if (!iRef.ok) errors.push(iRef.error);
                } else if (req.kind === 'quest') {
                    const qRef = checkReference(req.template, packKey, questSlugs, false, `${p}.requirements[${r}].template`);
                    if (!qRef.ok) errors.push(qRef.error);
                } else if (req.kind === 'place') {
                    const plRef = checkReference(req.place, packKey, placeSlugs, true, `${p}.requirements[${r}].place`);
                    if (!plRef.ok) errors.push(plRef.error);
                    else if (plRef.isExternal) warnings.push({ path: `${p}.requirements[${r}].place`, message: `External place reference "${req.place}" accepted with runtime eligibility check` });
                } else if (req.kind === 'thread') {
                    const thRef = checkReference(req.thread, packKey, new Set(), true, `${p}.requirements[${r}].thread`);
                    if (!thRef.ok) errors.push(thRef.error);
                    else if (thRef.isExternal) warnings.push({ path: `${p}.requirements[${r}].thread`, message: `External thread reference "${req.thread}" accepted with runtime eligibility check` });
                }
            }
        }
        if (q.objectives) {
            for (let o = 0; o < q.objectives.length; o++) {
                const obj = q.objectives[o];
                if (obj.kind === 'kill') {
                    const fRef = checkReference(obj.foe, packKey, creatureSlugs, false, `${p}.objectives[${o}].foe`);
                    if (!fRef.ok) errors.push(fRef.error);
                } else if (obj.kind === 'collect') {
                    const cRef = checkReference(obj.def, packKey, itemSlugs, false, `${p}.objectives[${o}].def`);
                    if (!cRef.ok) errors.push(cRef.error);
                } else if (obj.kind === 'visit') {
                    const vRef = checkReference(obj.place, packKey, placeSlugs, true, `${p}.objectives[${o}].place`);
                    if (!vRef.ok) errors.push(vRef.error);
                    else if (vRef.isExternal) warnings.push({ path: `${p}.objectives[${o}].place`, message: `External place reference "${obj.place}" accepted with runtime eligibility check` });
                }
            }
        }
        if (q.reward?.items) {
            for (let ri = 0; ri < q.reward.items.length; ri++) {
                const rRef = checkReference(q.reward.items[ri].def, packKey, itemSlugs, false, `${p}.reward.items[${ri}].def`);
                if (!rRef.ok) errors.push(rRef.error);
            }
        }
        if (q.chain) {
            if (q.chain.previous) {
                const chRef = checkReference(q.chain.previous, packKey, questSlugs, false, `${p}.chain.previous`);
                if (!chRef.ok) errors.push(chRef.error);
            }
            if (q.chain.next) {
                const chRef = checkReference(q.chain.next, packKey, questSlugs, false, `${p}.chain.next`);
                if (!chRef.ok) errors.push(chRef.error);
            }
        }
    }

    for (let i = 0; i < contentShops.length; i++) {
        const shp = contentShops[i];
        const p = `content.shops[${i}]`;
        const plRef = checkReference(shp.place, packKey, placeSlugs, true, `${p}.place`);
        if (!plRef.ok) errors.push(plRef.error);
        else if (plRef.isExternal) warnings.push({ path: `${p}.place`, message: `External place reference "${shp.place}" accepted with runtime eligibility check` });
        if (shp.stock) {
            for (let s = 0; s < shp.stock.length; s++) {
                const iRef = checkReference(shp.stock[s].item, packKey, itemSlugs, false, `${p}.stock[${s}].item`);
                if (!iRef.ok) errors.push(iRef.error);
            }
        }
    }

    for (let i = 0; i < contentRecipes.length; i++) {
        const rcp = contentRecipes[i];
        const p = `content.recipes[${i}]`;
        const mRef = checkReference(rcp.makes, packKey, itemSlugs, false, `${p}.makes`);
        if (!mRef.ok) errors.push(mRef.error);
        if (rcp.materials) {
            for (let mIdx = 0; mIdx < rcp.materials.length; mIdx++) {
                const matRef = checkReference(rcp.materials[mIdx].item, packKey, itemSlugs, false, `${p}.materials[${mIdx}].item`);
                if (!matRef.ok) errors.push(matRef.error);
            }
        }
    }

    for (let i = 0; i < (m.trainers ?? []).length; i++) {
        const trn = m.trainers[i];
        const p = `content.rules[0].trainers[${i}]`;
        const plRef = checkReference(trn.place, packKey, placeSlugs, true, `${p}.place`);
        if (!plRef.ok) errors.push(plRef.error);
        else if (plRef.isExternal) warnings.push({ path: `${p}.place`, message: `External place reference "${trn.place}" accepted with runtime eligibility check` });
        for (let s = 0; s < trn.skills.length; s++) {
            const sRef = checkReference(trn.skills[s], packKey, skillSlugs, false, `${p}.skills[${s}]`);
            if (!sRef.ok) errors.push(sRef.error);
        }
        if (trn.eventTemplates) {
            for (let e = 0; e < trn.eventTemplates.length; e++) {
                const eRef = checkReference(trn.eventTemplates[e], packKey, eventSlugs, false, `${p}.eventTemplates[${e}]`);
                if (!eRef.ok) errors.push(eRef.error);
            }
        }
    }

    if (errors.length) return { ok: false, errors };

    // Build fully expanded forms table
    const forms = {};
    const branchesBySkillFinal = new Map();
    for (const br of m.branches ?? []) {
        const sSlug = br.skill.startsWith(`pack.${packKey}/`) ? br.skill.slice(`pack.${packKey}/`.length) : br.skill;
        if (!branchesBySkillFinal.has(sSlug)) branchesBySkillFinal.set(sSlug, []);
        branchesBySkillFinal.get(sSlug).push(br);
    }

    for (const skl of m.skills ?? []) {
        const owningClassSlug = skillOwner.get(skl.slug);
        const owningClass = classBySlug.get(owningClassSlug);
        const tier = owningClass ? owningClass.tier : 0;
        const baseFormId = `pack.${packKey}/${skl.slug}-base`;
        const baseForm = {
            id: baseFormId,
            skill: `pack.${packKey}/${skl.slug}`,
            name: skl.name,
            note: skl.note ?? '',
            step: 0,
            fromForm: null,
            origin: 'base',
            type: skl.base.type,
            stat: skl.base.stat,
            cost: skl.base.cost,
            effects: skl.base.effects,
            unit: skl.base.unit,
            tier,
        };
        const scoreRes = powerScore(baseForm);
        baseForm.powerScore = scoreRes.ok ? scoreRes.score : 0;
        forms[baseFormId] = baseForm;

        if (tier === 3) {
            const branches = branchesBySkillFinal.get(skl.slug) ?? [];
            const step1Branches = branches.filter(b => (b.fromForm === baseFormId || b.fromForm === `${skl.slug}-base`) && b.step === 1);
            const g1Res = generatePowerUp(baseForm, c);
            if (g1Res.ok) forms[g1Res.form.id] = g1Res.form;

            for (const b of step1Branches) {
                const applied = applyBranchTransforms(baseForm, b, 3, c, '');
                if (applied.ok) forms[applied.form.id] = applied.form;
            }

            const step1Parents = [`${baseFormId}-g`, `${baseFormId}-a`, `${baseFormId}-b`];
            for (const pId of step1Parents) {
                const parentForm = forms[pId];
                if (!parentForm) continue;
                const g2Res = generatePowerUp(parentForm, c);
                if (g2Res.ok) forms[g2Res.form.id] = g2Res.form;

                const step2Branches = branches.filter(b => (b.fromForm === pId || b.fromForm === pId.slice(`pack.${packKey}/`.length)) && b.step === 2);
                for (const b of step2Branches) {
                    const applied2 = applyBranchTransforms(parentForm, b, 3, c, '');
                    if (applied2.ok) forms[applied2.form.id] = applied2.form;
                }
            }
        }
    }

    // Build fully normalized resolved definitions with qualified IDs and references (no local aliases in keys)
    const prefix = `pack.${packKey}/`;
    const toFull = ref => (typeof ref === 'string' && !ref.startsWith('pack.') && !ref.startsWith('story/') ? `${prefix}${ref}` : ref);

    const resolvedItems = {};
    for (const r of m.itemRules ?? []) {
        const fullDef = toFull(r.def);
        const copy = clonePlain(r);
        copy.def = fullDef;
        resolvedItems[fullDef] = copy;
    }

    const resolvedFoes = {};
    for (const f of contentCreatures) {
        const fullId = `${prefix}${f.slug}`;
        const copy = clonePlain(f);
        copy.id = fullId;
        if (Array.isArray(copy.skills)) copy.skills = copy.skills.map(toFull);
        if (Array.isArray(copy.loot)) {
            for (const l of copy.loot) {
                if (l.def) l.def = toFull(l.def);
            }
        }
        resolvedFoes[fullId] = copy;
    }

    const resolvedQuests = {};
    for (const q of contentQuests) {
        const fullId = `${prefix}${q.slug}`;
        const copy = clonePlain(q);
        copy.id = fullId;
        if (copy.giver && !copy.giver.startsWith('np_') && !copy.giver.startsWith('pack.')) copy.giver = toFull(copy.giver);
        if (copy.turnInPlace && !copy.turnInPlace.startsWith('pl_') && !copy.turnInPlace.startsWith('pack.')) copy.turnInPlace = toFull(copy.turnInPlace);
        if (Array.isArray(copy.requirements)) {
            for (const req of copy.requirements) {
                if (req.kind === 'class' && Array.isArray(req.classes)) req.classes = req.classes.map(toFull);
                else if (req.kind === 'item' && req.def) req.def = toFull(req.def);
                else if (req.kind === 'quest' && req.template) req.template = toFull(req.template);
                else if (req.kind === 'place' && req.place && !req.place.startsWith('pl_') && !req.place.startsWith('pack.')) req.place = toFull(req.place);
            }
        }
        if (Array.isArray(copy.objectives)) {
            for (const obj of copy.objectives) {
                if (obj.kind === 'kill' && obj.foe) obj.foe = toFull(obj.foe);
                else if (obj.kind === 'collect' && obj.def) obj.def = toFull(obj.def);
                else if (obj.kind === 'visit' && obj.place && !obj.place.startsWith('pl_') && !obj.place.startsWith('pack.')) obj.place = toFull(obj.place);
            }
        }
        if (Array.isArray(copy.reward?.items)) {
            for (const it of copy.reward.items) {
                if (it.def) it.def = toFull(it.def);
            }
        }
        if (copy.chain) {
            if (copy.chain.previous) copy.chain.previous = toFull(copy.chain.previous);
            if (copy.chain.next) copy.chain.next = toFull(copy.chain.next);
        }
        resolvedQuests[fullId] = copy;
    }

    const resolvedShops = {};
    for (const s of contentShops) {
        const fullId = `${prefix}${s.slug}`;
        const copy = clonePlain(s);
        copy.id = fullId;
        if (copy.place && !copy.place.startsWith('pl_') && !copy.place.startsWith('pack.')) copy.place = toFull(copy.place);
        if (Array.isArray(copy.stock)) {
            for (const st of copy.stock) {
                if (st.item) st.item = toFull(st.item);
            }
        }
        resolvedShops[fullId] = copy;
    }

    const resolvedRecipes = {};
    for (const r of contentRecipes) {
        const fullId = `${prefix}${r.slug}`;
        const copy = clonePlain(r);
        copy.id = fullId;
        copy.known = copy.known !== undefined ? copy.known : (rulesV2Schema.$defs.recipe?.properties?.known?.default ?? true);
        if (copy.makes) copy.makes = toFull(copy.makes);
        if (Array.isArray(copy.materials)) {
            for (const m of copy.materials) {
                if (m.item) m.item = toFull(m.item);
            }
        }
        resolvedRecipes[fullId] = copy;
    }

    const resolved = deepFreeze({
        manifest: m,
        forms,
        items: resolvedItems,
        foes: resolvedFoes,
        quests: resolvedQuests,
        shops: resolvedShops,
        recipes: resolvedRecipes,
        constants: clonePlain(c),
    });

    return { ok: true, resolved, warnings };
}

/** Shortens internal reference string to local slug if in same pack. */
function shortenTypedRef(ref, packId) {
    if (typeof ref !== 'string') return ref;
    const prefix = `pack.${packId}/`;
    if (ref.startsWith(prefix)) return ref.slice(prefix.length);
    return ref;
}

/**
 * Builds canonical authored shortened representation of document.
 * Normalizes text (NFC, CRLF to LF, trimmed) and defaults across WHOLE document.
 * Validates and strips host wrappers ONLY at documented record boundaries.
 * Shortens ONLY typed internal $defs.ref fields, never names, notes, or canonical place IDs.
 * Preserves authored array ordering and canonicalizes object keys.
 */
function buildCanonicalDocument(doc, packId) {
    const raw = normalizeStructure(clonePlain(doc));

    function stripWrappers(rec) {
        if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return;
        if (rec.id !== undefined) {
            if (typeof rec.id === 'string' && (RECORD_ID_REGEX.test(rec.id) || DEF_ID_REGEX.test(rec.id) || REF_REGEX.test(rec.id))) {
                delete rec.id;
            }
        }
        if (rec.pack !== undefined) {
            if (typeof rec.pack === 'string' && PACK_ID.test(rec.pack)) {
                delete rec.pack;
            }
        }
    }

    if (raw.content?.rules?.[0]) {
        const r = raw.content.rules[0];
        stripWrappers(r);

        if (r.statLabels === undefined) r.statLabels = clonePlain(rulesV2Schema.properties.statLabels.default);
        if (r.memory === undefined) r.memory = rulesV2Schema.properties.memory.default;

        if (Array.isArray(r.classes)) {
            for (const c of r.classes) {
                stripWrappers(c);
                if (c.note === undefined) c.note = rulesV2Schema.$defs.note.default;
                if (c.parent) c.parent = shortenTypedRef(c.parent, packId);
                if (Array.isArray(c.skills)) c.skills = c.skills.map(s => shortenTypedRef(s, packId));
            }
        }
        if (Array.isArray(r.skills)) {
            for (const s of r.skills) {
                stripWrappers(s);
                if (s.note === undefined) s.note = rulesV2Schema.$defs.note.default;
                if (s.replaces === undefined) s.replaces = rulesV2Schema.$defs.skill.properties.replaces.default;
                if (s.replaces) s.replaces = shortenTypedRef(s.replaces, packId);
                if (s.base?.unit?.class) s.base.unit.class = shortenTypedRef(s.base.unit.class, packId);
            }
        }
        if (Array.isArray(r.branches)) {
            for (const b of r.branches) {
                stripWrappers(b);
                if (b.note === undefined) b.note = rulesV2Schema.$defs.note.default;
                if (b.skill) b.skill = shortenTypedRef(b.skill, packId);
                if (b.fromForm) b.fromForm = shortenTypedRef(b.fromForm, packId);
            }
        }
        if (Array.isArray(r.itemRules)) {
            for (const ir of r.itemRules) {
                if (ir.unique === undefined) ir.unique = rulesV2Schema.$defs.itemRule.properties.unique.default;
                if (ir.def) ir.def = shortenTypedRef(ir.def, packId);
            }
        }
        if (Array.isArray(r.trainers)) {
            for (const trn of r.trainers) {
                stripWrappers(trn);
                if (Array.isArray(trn.skills)) trn.skills = trn.skills.map(s => shortenTypedRef(s, packId));
                if (Array.isArray(trn.eventTemplates)) trn.eventTemplates = trn.eventTemplates.map(e => shortenTypedRef(e, packId));
            }
        }
    }

    if (Array.isArray(raw.content?.items)) {
        for (const it of raw.content.items) {
            stripWrappers(it);
        }
    }

    if (Array.isArray(raw.content?.creatures)) {
        for (const f of raw.content.creatures) {
            stripWrappers(f);
            if (Array.isArray(f.skills)) f.skills = f.skills.map(s => shortenTypedRef(s, packId));
            if (Array.isArray(f.loot)) {
                for (const l of f.loot) {
                    if (l.def) l.def = shortenTypedRef(l.def, packId);
                }
            }
        }
    }

    if (Array.isArray(raw.content?.quests)) {
        for (const q of raw.content.quests) {
            stripWrappers(q);
            if (Array.isArray(q.requirements)) {
                for (const req of q.requirements) {
                    if (req.kind === 'class' && Array.isArray(req.classes)) req.classes = req.classes.map(c => shortenTypedRef(c, packId));
                    else if (req.kind === 'item' && req.def) req.def = shortenTypedRef(req.def, packId);
                    else if (req.kind === 'quest' && req.template) req.template = shortenTypedRef(req.template, packId);
                }
            }
            if (Array.isArray(q.objectives)) {
                for (const obj of q.objectives) {
                    // Retain required authored obj.id (ob_...)
                    if (obj.kind === 'kill' && obj.foe) obj.foe = shortenTypedRef(obj.foe, packId);
                    else if (obj.kind === 'collect' && obj.def) obj.def = shortenTypedRef(obj.def, packId);
                }
            }
            if (Array.isArray(q.reward?.items)) {
                for (const it of q.reward.items) {
                    if (it.def) it.def = shortenTypedRef(it.def, packId);
                }
            }
            if (q.chain) {
                if (q.chain.previous) q.chain.previous = shortenTypedRef(q.chain.previous, packId);
                if (q.chain.next) q.chain.next = shortenTypedRef(q.chain.next, packId);
            }
        }
    }

    if (Array.isArray(raw.content?.shops)) {
        for (const s of raw.content.shops) {
            stripWrappers(s);
            // Place IDs stay qualified
            if (Array.isArray(s.stock)) {
                for (const st of s.stock) {
                    if (st.item) st.item = shortenTypedRef(st.item, packId);
                }
            }
        }
    }

    if (Array.isArray(raw.content?.recipes)) {
        for (const r of raw.content.recipes) {
            stripWrappers(r);
            if (r.known === undefined) r.known = rulesV2Schema.$defs.recipe?.properties?.known?.default ?? true;
            if (r.makes) r.makes = shortenTypedRef(r.makes, packId);
            if (Array.isArray(r.materials)) {
                for (const m of r.materials) {
                    if (m.item) m.item = shortenTypedRef(m.item, packId);
                }
            }
        }
    }

    if (Array.isArray(raw.content?.places)) {
        for (const p of raw.content.places) {
            stripWrappers(p);
        }
    }

    return canonicalizeJson(raw);
}

/**
 * Expands all forms (bases, written branches, generated power-ups) per SPEC §7.
 * Returns immutable resolved ruleset and deterministic SHA-256 hash.
 */
export function expandRulesV2(manifest, content = {}, constants = RULES_V2_CONSTANTS) {
    const valRes = validateRulesV2(manifest, content, constants);
    if (!valRes.ok) return valRes;

    const resolved = valRes.resolved;
    const formCount = Object.keys(resolved.forms).length;
    if (formCount > RULES_V2_LIMITS.forms) {
        return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.TOO_LARGE, path: 'forms', message: `Forms count ${formCount} exceeds limit of ${RULES_V2_LIMITS.forms}` }] };
    }

    const resolvedJson = JSON.stringify(resolved);
    if (byteLength(resolvedJson) > RULES_V2_LIMITS.resolvedBytes) {
        return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.TOO_LARGE, path: 'resolved', message: `Resolved ruleset exceeds ${RULES_V2_LIMITS.resolvedBytes} bytes` }] };
    }

    const hashPayload = canonicalizeJson({
        constants: resolved.constants,
        content: buildCanonicalDocument({ content: { ...content, rules: [resolved.manifest] } }, resolved.manifest.pack).content,
        schema: rulesV2Schema,
    });
    const hash = sha256(JSON.stringify(hashPayload));

    return { ok: true, resolved: deepFreeze(canonicalizeJson(resolved)), hash };
}

/**
 * Exports canonical raw envelope per SPEC §7.
 * Validates document, strips host wrappers, shortens only typed internal refs, preserves authored arrays.
 * UTF-8 with 2 spaces indent and trailing newline.
 */
export function exportRulesV2(document, constants = RULES_V2_CONSTANTS) {
    const chk = validateRulesPack(document, { constants });
    if (!chk.ok) return { ok: false, errors: chk.errors };

    const packKey = chk.pack.id;
    const canonical = buildCanonicalDocument(chk.pack, packKey);
    const text = JSON.stringify(canonical, null, 2) + '\n';
    const hash = chk.hash;

    return { ok: true, text, hash };
}

/**
 * Convenience pack validator per SPEC §7, §9, §10.
 * Reuses SB validatePack on detached legacy projection.
 * Validates envelope, JSON safety, rules manifest, and owned content. Never throws.
 */
export function validateRulesPack(pack, rawOptions = {}) {
    try {
        const options = (rawOptions && typeof rawOptions === 'object' && !Array.isArray(rawOptions)) ? rawOptions : {};
        const { constants = RULES_V2_CONSTANTS } = options;

        let value = pack;
        if (typeof pack === 'string') {
            if (byteLength(pack) > RULES_V2_LIMITS.packBytes) {
                return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.TOO_LARGE, path: '', message: 'Pack text exceeds 512 KiB' }] };
            }
            try {
                value = JSON.parse(pack);
            } catch (err) {
                return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path: '', message: `Invalid JSON: ${err.message}` }] };
            }
        }
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path: '', message: 'Pack must be a JSON object' }] };
        }

        const plainErrors = checkPlainSafety(value);
        if (plainErrors.length) return { ok: false, errors: plainErrors };

        // Enforce 512 KiB raw boundary on object inputs too
        try {
            if (byteLength(JSON.stringify(value)) > RULES_V2_LIMITS.packBytes) {
                return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.TOO_LARGE, path: '', message: 'Pack object exceeds 512 KiB' }] };
            }
        } catch {
            return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.TOO_LARGE, path: '', message: 'Pack object exceeds limits' }] };
        }

        const constRes = validateConstants(constants);
        if (!constRes.ok) return constRes;
        const c = constRes.constants;

        // Normalize safe detached value before SB/structural/semantic checking (NFC, trim, CRLF/CR -> LF)
        const detachedVal = normalizeStructure(clonePlain(value));

        // Check envelope fields against closed PACK_FIELDS
        for (const key of Object.keys(detachedVal)) {
            if (!PACK_FIELDS.includes(key)) {
                return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.ENVELOPE_UNKNOWN, path: key, message: `Unknown pack envelope field: "${key}"` }] };
            }
        }

        // Validate envelope requirements
        if (!detachedVal.id || typeof detachedVal.id !== 'string' || !PACK_ID.test(detachedVal.id)) {
            return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path: 'id', message: 'Pack id must be 1 to 40 lowercase letters, digits, or dashes' }] };
        }
        if (!detachedVal.version || typeof detachedVal.version !== 'string' || !SEMVER.test(detachedVal.version)) {
            return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path: 'version', message: 'Pack version must match semver syntax' }] };
        }
        if (!detachedVal.requires || typeof detachedVal.requires !== 'object' || Array.isArray(detachedVal.requires)) {
            return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path: 'requires', message: 'Pack requires must be an object' }] };
        }
        for (const rk of Object.keys(detachedVal.requires)) {
            if (rk !== 'storyBlock' && rk !== 'capabilities') {
                return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.ENVELOPE_UNKNOWN, path: `requires.${rk}`, message: `"${rk}" is not a requires field` }] };
            }
        }
        if (typeof detachedVal.requires.storyBlock !== 'string' || !parseRange(detachedVal.requires.storyBlock)) {
            return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path: 'requires.storyBlock', message: 'requires.storyBlock must be a valid version range' }] };
        }
        if (detachedVal.requires.capabilities !== undefined) {
            if (!Array.isArray(detachedVal.requires.capabilities) || !detachedVal.requires.capabilities.every(cap => typeof cap === 'string' && SLUG.test(cap))) {
                return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_CAPABILITY, path: 'requires.capabilities', message: 'requires.capabilities must be a list of capability slugs' }] };
            }
        }

        if (!detachedVal.content || typeof detachedVal.content !== 'object' || Array.isArray(detachedVal.content)) {
            return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path: 'content', message: 'Pack content must be an object' }] };
        }
        for (const ck of Object.keys(detachedVal.content)) {
            if (ck !== 'rules' && !CONTENT_KINDS.includes(ck)) {
                return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.ENVELOPE_UNKNOWN, path: `content.${ck}`, message: `"${ck}" is not a content kind` }] };
            }
        }

        if (!Array.isArray(detachedVal.content.rules) || detachedVal.content.rules.length !== 1) {
            return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path: 'content.rules', message: 'Pack must carry exactly one rules manifest in content.rules[0]' }] };
        }

        // Run SB validatePack on detached legacy projection
        const legacyProj = clonePlain(detachedVal);
        delete legacyProj.content.rules;
        legacyProj.content.creatures = [];
        legacyProj.content.quests = [];
        legacyProj.content.shops = [];
        legacyProj.content.recipes = [];

        const sbRes = validatePack(legacyProj, { hostVersion: HOST_VERSION, capabilities: null });
        if (!sbRes.ok) {
            const mapped = sbRes.errors.map(err => {
                if (err.code === 'UNKNOWN_FIELD' && !err.path.includes('.')) {
                    return { ...err, code: RULES_V2_ERROR_CODES.ENVELOPE_UNKNOWN };
                }
                if (err.code === 'UNKNOWN_KIND') {
                    return { ...err, code: RULES_V2_ERROR_CODES.ENVELOPE_UNKNOWN };
                }
                return err;
            });
            return { ok: false, errors: mapped };
        }

        const rawManifest = detachedVal.content.rules[0];
        const normRes = normalizeRulesV2(rawManifest, { packKey: detachedVal.id, constants: c });
        if (!normRes.ok) return normRes;

        const valRes = validateRulesV2(normRes.manifest, detachedVal.content, c);
        if (!valRes.ok) return valRes;

        const expRes = expandRulesV2(normRes.manifest, detachedVal.content, c);
        if (!expRes.ok) return expRes;

        // Build clean normalized pack with text normalization and recipe defaults
        const normalizedPack = detachedVal;
        normalizedPack.content.rules = [normRes.manifest];
        if (Array.isArray(normalizedPack.content?.recipes)) {
            for (const r of normalizedPack.content.recipes) {
                if (r && typeof r === 'object' && r.known === undefined) {
                    r.known = rulesV2Schema.$defs.recipe?.properties?.known?.default ?? true;
                }
            }
        }

        // Build canonical document and hash for validateRulesPack and exportRulesV2
        const canonicalPack = buildCanonicalDocument(normalizedPack, detachedVal.id);
        const hashPayload = canonicalizeJson({
            constants: c,
            pack: canonicalPack,
            schema: rulesV2Schema,
        });
        const hash = sha256(JSON.stringify(hashPayload));

        return {
            ok: true,
            errors: [],
            pack: normalizedPack,
            raw: clonePlain(value),
            resolved: valRes.resolved,
            hash,
            warnings: valRes.warnings ?? [],
        };
    } catch (err) {
        return { ok: false, errors: [{ code: RULES_V2_ERROR_CODES.BAD_SCHEMA, path: '', message: `Unexpected error: ${err.message}` }] };
    }
}
