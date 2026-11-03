// Foes by level (Levels release). A foe group has a level, 1..99, instead of a Soul Class. Pure helpers, no imports but the seeded generator:
// - the roll term (`levelBonus`) and a Standard foe's Health blocks (`foeBlocksByLevel`);
// - where a level comes from (`pickLevel`): the line gave it (`level: N`), or gave a rank (a seeded level inside that rank's band), or neither (a seeded level
//   within ±2 of the party's average level, held to 1..99). The seed is the reply's own dice seed, so a swipe (a new seed) draws a new level and a
//   Re-read (the same seed) keeps it;
// - `bandOfRank`: a rank's band, found through the `rpg.rank` query (`{ level }` → `{ name } | null`) by asking for each level.
import { rng as seeded } from '../rng.js';

/** The levels a foe may have, how far from the party's average an unplanned one lands, the roll term's default divisor, and the Health block rule. */
export const FOE_LEVEL = Object.freeze({ min: 1, max: 99, spread: 2, divisor: 5, healthBase: 4, healthStep: 30 });

/** The version mark of a roll that uses levels (`lv` in the payload of `rpg.resolve`); a roll without it replays exactly as before. */
export const LV_VERSION = 1;

/** The level a Soul Class (1–9) of the earlier rules stands for: class n → 10n − 5 (I 5 … IX 85). */
export const levelOfClass = soulClass => (Number.isInteger(soulClass) && soulClass >= 1 && soulClass <= 9 ? 10 * soulClass - 5 : null);

/** The Soul Class (1–9) of the earlier rules that a level stands for, the inverse of levelOfClass: the nearest, 1 to 9 (level 5 → I, 35 → IV, 99 → IX). */
export const classOfLevel = level => Math.max(1, Math.min(9, Math.round(((Number(level) || 1) + 5) / 10)));

const whole = value => (typeof value === 'number' && Number.isInteger(value) ? value : typeof value === 'string' && /^\s*-?\d+\s*$/u.test(value) ? Number(value) : null);

/** `value` as a level: a whole number held to 1..99, else null. */
export const levelOf = value => {
    const n = whole(value);
    return n === null ? null : Math.max(FOE_LEVEL.min, Math.min(FOE_LEVEL.max, n));
};

/** What a level adds to a roll: floor(level / divisor); the divisor is 5 unless the rules say another (a whole number 1 or more). */
export const levelBonus = (level, divisor = FOE_LEVEL.divisor) => Math.floor(Math.max(0, Number(level) || 0) / (Number.isInteger(divisor) && divisor >= 1 ? divisor : FOE_LEVEL.divisor));

/** The divisor the rules in force carry (`levelDivisor`), else the default. */
export const divisorOf = rules => (Number.isInteger(rules?.levelDivisor) && rules.levelDivisor >= 1 ? rules.levelDivisor : FOE_LEVEL.divisor);

/** A Standard foe's Health blocks: 4 + floor(level / 30) (levels 1–29 give 4, 30–59 give 5, 60–89 give 6, 90–99 give 7). */
export const foeBlocksByLevel = level => FOE_LEVEL.healthBase + Math.floor(Math.max(FOE_LEVEL.min, Number(level) || 0) / FOE_LEVEL.healthStep);

/** The party's average level, rounded to the nearest whole level (1 with no one): `levels` is a list of numbers, anything else in it is passed over. */
export function averageLevel(levels) {
    const list = (levels ?? []).filter(value => Number.isFinite(value) && value >= 1);
    return list.length ? Math.max(FOE_LEVEL.min, Math.min(FOE_LEVEL.max, Math.round(list.reduce((sum, value) => sum + value, 0) / list.length))) : FOE_LEVEL.min;
}

/** The levels of a sheet's party (readSheet): each member's `level`, else, for a block of the earlier rules, the level their Soul Class stands for. Left or dead are not counted. */
export const partyLevels = sheet => (sheet?.characters ?? []).filter(entry => entry?.alive !== false)
    .map(entry => (Number.isInteger(entry.level) ? entry.level : levelOfClass(entry.soul))).filter(value => Number.isInteger(value));

/**
 * A foe's level. `ask`: `{ level }` (used as given, held to 1..99), or `{ from, to }` (a rank's band: a seeded level inside it), or `{}` (a seeded level within ±2 of
 * `around`, the party's average, held to 1..99). `random` is a function giving [0, 1) (the reply's seeded generator).
 */
export function pickLevel(ask, around, random) {
    const given = levelOf(ask?.level);
    if (given !== null) return given;
    const from = levelOf(ask?.from), to = levelOf(ask?.to);
    if (from !== null && to !== null && from <= to) return from + Math.floor(random() * (to - from + 1));
    const centre = levelOf(around) ?? FOE_LEVEL.min;
    const level = centre - FOE_LEVEL.spread + Math.floor(random() * (2 * FOE_LEVEL.spread + 1));
    return Math.max(FOE_LEVEL.min, Math.min(FOE_LEVEL.max, level));
}

const SALT = 0x4C56B0F3;

/** The generator of the foe with place `at` (0-based) among the ones a reply opens or sets, from the reply's seed number `base` (a uint32): one stream each, so none moves another. */
export const foeRandom = (base, at) => seeded(((base >>> 0) ^ Math.imul(at + 1, 0x9E3779B1) ^ SALT) >>> 0);

/**
 * A rank's band `{ from, to }`, found with `rankAt(level)` → `{ name } | null` (the `rpg.rank` query): the levels 1..99 whose rank has this name
 * (compared without case); null when none has. A query that throws or answers nothing means no band.
 */
export function bandOfRank(name, rankAt) {
    const wanted = String(name ?? '').trim().toLowerCase();
    if (!wanted || typeof rankAt !== 'function') return null;
    let from = null, to = null;
    for (let level = FOE_LEVEL.min; level <= FOE_LEVEL.max; level += 1) {
        let found = null;
        try { found = rankAt(level); } catch { return null; }
        const hit = typeof found?.name === 'string' && found.name.trim().toLowerCase() === wanted;
        if (hit) { if (from === null) from = level; to = level; } else if (from !== null) break;
    }
    return from === null ? null : { from, to };
}

/** How a foe's level reads in a line: "Rank E · Lv 14" when `rankAt` names one, else "Lv 14". */
export function foeLabel(level, rankAt = null) {
    let name = null;
    try { name = typeof rankAt === 'function' ? rankAt(level)?.name ?? null : null; } catch { name = null; }
    return name ? `Rank ${name} · Lv ${level}` : `Lv ${level}`;
}

/**
 * The foes of a plan's `open` list with their levels settled, from the reply's seed number `base`: an entry that has a `level` keeps it, one with a band
 * (`from`, `to`) draws inside it, one with neither draws near `around`. → [{ name, count, level }] (the same places).
 */
export const settleOpen = (open, around, base) => (open ?? []).map((entry, at) => ({
    name: entry.name, count: entry.count, level: pickLevel(entry, around, foeRandom(base, at)),
}));
