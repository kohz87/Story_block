// The lean RPG (suite-notes/SPEC_RPG.md): an optional part of Story Block's core module, behind the
// feature `story-block.lean-rpg` (off by default; off means fully off, features.js). It reads the chat's
// RPG blocks (custom blocks whose definition has a `role`, see ROLES) and adds:
// - automatic rolls: a pre-call before the reply plans the actions, `rpg.resolve` rolls them as a
//   prelude block on the generated reply (a swipe rolls again, a Re-read keeps the dice);
// - the Party tab, the stat distribution view and the battle log (view/, loaded only when the feature is on);
// - "Changed this reply" lines for rolls and automatic level-ups.
//
// This file holds the shared interfaces the pieces build against; the pieces fill in the part.

/** The feature that switches all of it. */
export const LEAN_RPG_FEATURE = 'story-block.lean-rpg';

/** The prelude command a planned reply's rolls are committed through (turn.js prelude list). */
export const RESOLVE = 'rpg.resolve';

/** `role` on a block definition: what the RPG reads it as. A Character, Skills or Foes block names its `who`. */
export const ROLES = Object.freeze(['character', 'skills', 'foes', 'rules']);

/** The seven stats, 1–20 each (a pack may rename them through its Character template's field labels). */
export const STATS = Object.freeze(['str', 'vit', 'agi', 'dex', 'int', 'luk', 'cha']);

/** Stage words, full → empty. Field values are the stage index (0 = empty) so a meter can draw them. */
export const STAGES = Object.freeze({
    health: Object.freeze(['Down', 'Badly wounded', 'Wounded', 'Hurt', 'Scratched', 'Unhurt']),
    mana: Object.freeze(['Empty', 'Drained', 'Low', 'Steady', 'Fresh']),
    stamina: Object.freeze(['Empty', 'Spent', 'Tired', 'Winded', 'Fresh']),
});

/** The formula (SPEC_RPG §0): PC d20 + stat/2 + 2×class + skill rank vs foe d20 + 5 + 2×class. */
export const FORMULA = Object.freeze({ die: 20, statDivisor: 2, classWeight: 2, foeBase: 5, edgeMax: 3, costMargin: 2 });

/** Pacing: exchanges per reply. */
export const PACE = Object.freeze({ careful: 1, normal: 5, all: 8 });

/**
 * A plan (what the pre-call answers, parsed): the actions to roll for the next reply.
 * `{ pace: 'careful'|'normal'|'all', acts: [{ who, skill?, stat, target, edge?, why? }],
 *    foes: [{ slot, target, defend } | { slot, hold: true }], checks: [{ who, skill?, stat, dc: 'easy'|'normal'|'hard'|'very hard' }] }`
 * `validatePlan` is the one place a plan's shape is checked; the pieces never trust a plan without it.
 */
export function validatePlan(plan) {
    const errors = [];
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return { ok: false, errors: ['A plan must be an object.'] };
    if (!Object.hasOwn(PACE, plan.pace)) errors.push('pace must be careful, normal or all.');
    for (const key of ['acts', 'foes', 'checks']) if (plan[key] !== undefined && !Array.isArray(plan[key])) errors.push(`${key} must be a list.`);
    return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
}

/** The part merged into Story Block's core module (domains/index.js). Empty until the pieces land. */
export function createLeanRpgPart() {
    return { commands: {}, queries: {}, hooks: {} };
}
