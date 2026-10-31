// The RPG (suite-notes/SPEC_RPG.md): an optional part of Story Block's core module, behind the feature
// `story-block.rpg` (off by default; off means fully off, features.js). It reads the chat's
// RPG blocks (custom blocks whose definition has a `role`, see ROLES) and adds:
// - automatic rolls: a pre-call before the reply plans the actions, `rpg.resolve` rolls them as a
//   prelude block on the generated reply (a swipe rolls again, a Re-read keeps the dice);
// - the Party tab, the stat distribution view and the battle log (view/, loaded only when the feature is on);
// - "Changed this reply" lines for rolls and automatic level-ups.
//
// This file holds the shared interfaces the pieces build against and the part itself. The names live in
// names.js, the plan in plan.js, the sheet reader in read.js, the pre-call in precall.js, the roll in resolve.js
// (its header documents the `data.v2.result` record the battle log draws from) and the cue text in cue.js.
import { stCallModel, stChat, stChatId } from '../assist/st-adapter.js';
import { LEAN_RPG_FEATURE, RESOLVE, ROLLS, ROLLS_SETTING } from './names.js';
import { createPlanHold } from './plan.js';
import { createPrecall } from './precall.js';
import { leanRpgGuard, resolve, rollsOf } from './resolve.js';

export * from './names.js';
export { CUSTOM_SETTING, DIFFICULTIES, DIFFICULTY_SETTING, NOTE_MAX, NOTE_SETTING, PRESETS, RULE_KEYS, RULE_RANGES, STANDARD, difficultyOf, normalizeRules, oddsFor, oddsSubject, plannerNoteOf, presetOf, rulesFromSettings, sameRules, subjectOdds } from './rules.js';
export { createPlanHold, parsePlanAnswer, planIsEmpty, validatePlan } from './plan.js';
export { characterOf, fold, matchCharacter, matchFoe, matchName, matchSkill, readSheet } from './read.js';
export { NO_ROLLS_LINE, OUTCOME_WORD, cueText, lineText } from './cue.js';
export { PRECALL_HEAD, claimed, createPrecall, precallPrompt, sheetText } from './precall.js';
export { RESULT_VERSION, claimKey, leanRpgGuard, outcomeOf, prepare, resolve, rollPrepared, rollsOf } from './resolve.js';

/** The part's setting (Story Block's own bucket): when the pre-call plans the rolls. */
export const DEFAULT_SETTINGS = Object.freeze({ [ROLLS_SETTING]: ROLLS[0] });

/** The query B reads a reply's rolls through: `rpg.rolls { index? }` → { receipt, result, summary } | null (the head reply by default). */
export const ROLLS_QUERY = 'rpg.rolls';

/**
 * The part merged into Story Block's core module (domains/index.js). `deps` (all optional):
 *   callModel(prompt, { maxTokens, profile, helper }) → text   (default: Assist's st-adapter; the runtime passes its queued call)
 *   chat() → SillyTavern's chat array, chatId() → its id        (default: st-adapter)
 *   metadata() → the chat's metadata object, for the held plan   (default: held in memory)
 *   problem(entry)                                              (the turn's Problems list; default: none)
 *   moduleId = 'story-block' (whose settings it reads), timeoutMs, timer
 * → { commands, queries, hooks, settings: { defaults }, guard }; `guard` is the replay guard for `rpg.resolve` blocks
 * (domains/index.js routes the guards of that predicate to it).
 */
export function createLeanRpgPart({ callModel = stCallModel, chat = stChat, chatId = stChatId, metadata = () => null, problem = null, moduleId = 'story-block', timeoutMs, timer } = {}) {
    const precall = createPrecall({ callModel, chat, chatId, hold: createPlanHold({ metadata }), problem, moduleId, timeoutMs, timer });
    return {
        // A prelude: previewed before the reply and stored on it before its story lines (turn.js). Not tied to the
        // feature, so a Re-read of a reply that has rolls keeps them whatever the feature says now.
        commands: { [RESOLVE]: Object.assign((ctx, payload) => resolve(ctx, payload), { prelude: true, internal: true }) },
        queries: { [ROLLS_QUERY]: Object.assign((_state, args, tools) => rollsOf(tools?.receipts?.() ?? [], Number.isInteger(args?.index) ? args.index : tools?.reply?.index), { feature: LEAN_RPG_FEATURE }) },
        hooks: { beforeGenerate: (view, info) => precall.beforeGenerate(view, info), afterCapture: view => { precall.afterCapture(view); } },
        settings: { defaults: { ...DEFAULT_SETTINGS } },
        guard: leanRpgGuard,
    };
}
