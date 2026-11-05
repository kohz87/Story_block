// A turn (docs/v2/SPEC.md §4, §5): Story Suite's SillyTavern wiring.
//
// Before the reply (the generation interceptor, for normal, swipe, regenerate and continue):
// flush pending saves, let modules add cues (beforeGenerate), collect the untold receipts and
// assemble the two prompt texts; the static part goes in-prompt, this reply's part in-chat at
// depth 0. The interceptor's context size holds them to a share of it (prompt.js contextFit): the
// tail is cut to fit (what modules send under their own keys, their `ownPrompt` hooks, counts toward it
// too), and when the static part alone is too big the reader is told once per chat. Quiet and impersonate generations (and any other kind) get both slots emptied.
// At prompt-ready: hidden change blocks leave the prompt history, and when the preset left out
// the Main Prompt (SillyTavern then drops in-prompt text) the static part is put back at the
// start of this reply's part, for the story's own prompt only.
// A module's canGenerate hook may stop a story generation first (the interceptor's abort).
// After the reply (MESSAGE_RECEIVED for the carrier the interceptor prepared): read its
// <Changes> block, run each line as its owner's capture command (cause 'story'), append what
// was accepted, run each module's afterCapture hook once after the reply's last story line (its
// commands as `system` steps kept on the reply), record what the reply was told, save once. A line no module takes, or one its
// owner rejects, goes to the Problems list; nothing is thrown at the reader.
// A failed save (before or after the reply) is told and logged but never drops the turn: the state
// stays in memory, marked unsaved, and the save is tried again after the reply.
//
// turn.js receives the SillyTavern context and the host parts; it never imports the store or
// the command bus (their interfaces are docs/v2/SPEC.md §12).

import { LEGACY_PROBLEM, adoptLegacy, assistSections, continuation, cutLine, defangMarker, extractBlock, grammarHeads, hideBlock, markCaps, markOff, parseChanges, sameChangeLine, strayLines, stripBlock, withAssist } from './capture.js';
import { notWritten } from './assist/extractor.js';
import { PRECHECK } from './assist/classifier.js';
import { refusedWhy } from './assist/safety.js';
import { CHATTER_MAX, displayLines, readDisplayLine } from './extras.js';
import { occurrenceOf, operationKey } from './evidence.js';
import { hash, readRecord, swipeLoading } from './persist.js';
import { CAPTURE_PREFIX, HOST_MODULE } from './registry.js';
import { MAX_CHANGE_LINES, ensureModules, makeView } from './sdk.js';
import { cutAt } from '../text.js';
import { LEAN_RPG_FEATURE, practiceFromRollsOnly } from './lean-rpg/names.js';
import { SKILL_SLOTS_MAX } from './skill-slots.js';

// A story line that practises a skill (`practice-N`, data-modules/part.js): the lines a reply is marked for (see captureEach).
const PRACTICE_LINE = new RegExp(`\\|\\s*kind\\s*:\\s*practice-[1-${SKILL_SLOTS_MAX}]\\b`, 'iu');
import { receiptWithCue } from './lean-rpg/cue.js';
import { contentText, contextRoom, within, TIMED_OUT } from './turn/text.js';
import { createSession } from './turn/session.js';
import { createReread } from './turn/reread.js';
import { createPromptBuild } from './turn/prompt-build.js';
import { createPromptHooks } from './turn/prompt-hooks.js';
export { QUIET_MARK_MIN, QUIET_WAIT_MS, MAX_NAME, stripBattleMarker, contextRoom, defuseMacros, flatName, substituteNames, quietMark, restoreMissing } from './turn/text.js';

export const STATIC_KEY = 'story_suite_static';
export const TAIL_KEY = 'story_suite_tail_1';
// Story Block v1's keys (0.9.21+ and before), cleared on load so an old copy never lingers.
export const V1_KEYS = Object.freeze([
    ['story_suite_static_story_block', 'static'],
    ['story_suite_tail_1_story_block', 'tail'],
    ['story_block', 'static'],
]);
export const FOREGROUND = Object.freeze(['normal', 'swipe', 'regenerate', 'continue']);
// A module's `ownPrompt` hook: at most this many parts, each counted up to this many characters.
export const OWN_PROMPT_PARTS = 8;
export const OWN_PROMPT_CHARS = 200000;
export const INTERCEPTOR_NAME = 'storyBlockGenerationInterceptor';
// SillyTavern's extension_prompt_types and extension_prompt_roles, when the context lacks them.
const IN_PROMPT = 0;
const IN_CHAT = 1;
const ROLE_SYSTEM = 0;
const MAX_PROBLEMS = 200;
// How long a canGenerate or beforeGenerate hook may take before the reply goes on without it.
export const HOOK_TIMEOUT_MS = 2500;
// A hook may declare its own, longer limit (`fn.timeoutMs`): the RPG's planner makes a model call of up to 20 s.
export const hookTimeout = fn => (Number.isFinite(fn?.timeoutMs) && fn.timeoutMs > HOOK_TIMEOUT_MS ? fn.timeoutMs : HOOK_TIMEOUT_MS);
// A reply that never ends (no MESSAGE_RECEIVED, GENERATION_ENDED or STOPPED) stops counting as in progress
// after this long, so Story Suite's own model calls on the chat's connection are not held up for good.
export const REPLY_BUSY_MAX_MS = 5 * 60_000;
// How long a send waits for the Assist safety net still reading the last reply (MODULES §F123): briefly.
// Lines that come later are kept on that reply and applied on the next one, right after its own lines.
export const ASSIST_WAIT_MS = 1500;
// How long the RPG's code (rpg-lazy.js) may take to load before a reply or a chat goes on without it: a stalled import never holds a generation or a chat open.
export const RPG_LOAD_WAIT_MS = 4000;
// Stripped history texts kept between prompts (each is read again for every later prompt).
const STRIP_CACHE = 500;
const HAS_BLOCK = /<changes/i;
// Story Block v1's envelope (capture.js adoptLegacy): never sent to the model. In a text completion prompt only a closed
// one, and never across another comment's start, so one left open cannot take the rest of the prompt with it.
const HAS_LEGACY = /<!--\s*(?:STORY_BLOCKS_V1|INVENTORY_BLOCK_V05)/i;
const LEGACY_IN_PROMPT = /\s*<!--\s*(?:STORY_BLOCKS_V1_CUT|STORY_BLOCKS_V1|INVENTORY_BLOCK_V05)\b(?:(?!<!--)[\s\S])*?-->/gi;

const defaultNotify = reason => globalThis.toastr?.warning?.(reason, 'Story Suite');

// Why the state was rebuilt, as the head event tells it (the public API's `story:rebuilt`; 'edit' is not announced).
const REBUILD_REASONS = new Set(['delete', 'swipe', 'edit']);

export const normalizeType = type => String(type ?? 'normal').trim().toLowerCase() || 'normal';
const holdsIn = chat => mark => chat.some(message => contentText(message?.content).includes(mark));
const isCarrier = message => Boolean(message) && !message.is_user;

/**
 * Wires one SillyTavern context. `deps`: { ctx, live?() (SillyTavern's live context, for its API settings;
 * default ctx), store, bus, registry, settings, events?,
 * onBlocked?(reason, moduleId), notify?(reason, moduleId) (default: a toastr warning),
 * initial?() → the initial State for a chat with none (default registry.initialState(); the host
 * adds the packs' start, SPEC §2.6), ownPrompt?(eventData) → true for the prompt of Story Suite's own model
 * call on the chat's connection (model-call.js createOwnCalls().owns): never taken for the reply's }.
 * `settings` is createSettings() (settings() → host settings, settings(id) → a module's).
 * Returns { interceptor, install, uninstall, onGenerationStarted, onPromptReady, onTextPromptReady, onMessageReceived,
 * onChatChanged, seed, onChatRenamed, onTimelineChanged, onGenerationEnded, preview, report, problems, clearProblems, blocked, blockers, unblock,
 * session, replyBusy, whenIdle }.
 */
export function createTurn({ ctx, live = () => ctx, store, bus, registry, settings, events = null, onBlocked = null, notify = defaultNotify, initial = () => registry.initialState(), ownPrompt = () => false, timeline = null, prepare = null }) {
    const types = () => ctx?.extension_prompt_types ?? ctx?.extensionPromptTypes ?? {};
    const roles = () => ctx?.extension_prompt_roles ?? ctx?.extensionPromptRoles ?? {};
    const position = place => (place === 'static' ? types().IN_PROMPT ?? IN_PROMPT : types().IN_CHAT ?? IN_CHAT);
    const hostSettings = () => (typeof settings === 'function' ? settings() : settings ?? {});
    // Story Block's readers of earlier messages that this turn owns, each asked for by name from the timeline's active-history filter
    // (timeline/active.js): messages a restore faded are not a module's last reader message nor a source of late lines. (A request is not
    // filtered here: SillyTavern leaves the hidden messages out of it, and a restore hides what it faded.) A host without a timeline has none.
    const reader = name => (typeof timeline?.active === 'function' ? timeline.active(name) : null);
    const lateReader = reader('assist.late');
    const viewReader = reader('view.lastUser');
    const s = {
        session: null,
        deferred: false,   // cues committed before a reply, left for the reply's save (runCues)
        listeners: [],
        problemLog: [],
        blocks: [],
        lastSize: null,   // the context size the last interceptor call was handed
        // Quiet generations told by GENERATION_STARTED: { mark, claimed (its interceptor ran, at this time) }, oldest first.
        quiets: [],
        // What the two slots hold now (setPrompts).
        slots: { staticText: '', tailText: '' },
        toldSmall: new Set(),   // chats whose reader was told the context is too small
        // A reply in progress: from its interceptor until it is received, ended, stopped or held back (or the
        // chat changes). Story Suite's own model calls on the chat's connection wait for it (whenIdle).
        replyBusy: false,
        // The Assist safety net's runs on the last reply (afterReply), until they settle.
        assistPending: null,
        busyTimer: null,
        idleWaiters: [],
        // Every earlier reply is in every prompt: what its text is without blocks is remembered, and a
        // text with no "<changes" in it at all is passed by without reading it further.
        stripped: new Map(),
        offModules: null,
    };
    const liveContext = () => {
        try { return live() ?? ctx; } catch { return ctx; }
    };
    const contextNow = () => contextRoom(liveContext(), s.lastSize);
    const whenIdle = () => (s.replyBusy ? new Promise(resolve => s.idleWaiters.push(resolve)) : Promise.resolve());
    // Our own model call's prompt (model-call.js) is never the reply's.
    const isOwn = eventData => {
        try { return ownPrompt(eventData) === true; } catch { return false; }
    };

    const view = () => makeView({ store, registry, settings, chat: ctx?.chat, active: viewReader });
    const hasCarrier = () => (ctx?.chat ?? []).some(isCarrier);
    const lastCarrier = () => (ctx?.chat ?? []).findLastIndex(isCarrier);

    // The commands run as preludes: Assist's pre-roll, and any command a module marks `prelude` (registry.isPrelude).
    const isPrelude = type => type === PRECHECK || registry.isPrelude?.(type) === true;

    // Runs the reply's change lines; returns { receipts, problems }.
    // Each line runs on the state the lines before it left (bus.run's `state`), as its owner's
    // capture handler (bus.run's `capture`), and is stored on the reply before the next one runs.
    // A reply holds at most maxChangeLines change lines; the rest are one Problem (pushed to `found`).
    const lineCap = () => (Number.isInteger(hostSettings()?.maxChangeLines) && hostSettings().maxChangeLines > 0 ? hostSettings().maxChangeLines : MAX_CHANGE_LINES);

    // A block's lines read, at most maxChangeLines of them, change lines or not; the rest are one Problem.
    function readBlock(index, text) {
        const cap = lineCap();
        const parsed = parseChanges(text, { max: cap });
        const problems = parsed.problems.map(line => problem({ index, code: 'UNREADABLE', message: line }));
        if (parsed.over) {
            const { count, total, first } = parsed.over;
            problems.push(problem({ index, code: 'TOO_MANY', message: `The reply has ${total} change lines; only the first ${cap} were read, so ${count} ${count === 1 ? 'line was' : 'lines were'} not used (from "${cutAt(first, 60)}").` }));
        }
        return { lines: parsed.lines, problems };
    }

    // The heads of the kinds the reply may write ("! encounter", "+ quest"), for the change lines a
    // model writes in the story near the block (capture.js strayLines). Read at each capture, so a
    // feature turned off takes its kinds' heads with it.
    function changeHeads() {
        try { return grammarHeads(registry.contexts().flatMap(context => context.kinds ?? [])); } catch { return new Set(); }
    }
    // The story's change lines that were not taken (too far up, written another way) as Problems.
    // (A line that repeats one the reply's block holds, `read` (raw), was used: it is not told.)
    function strayProblems(index, text, heads, options, read = []) {
        const used = new Set(read.map(sameChangeLine));
        return strayLines(text, heads, options).problems.filter(({ line }) => !used.has(sameChangeLine(line)))
            .map(({ line, reason }) => problem({ index, line, code: 'STRAY', message: `"${line}" was not used: ${reason}.` }));
    }
    // The one Problem of a reply whose changes were read from a v1 envelope (capture.js adoptLegacy).
    const legacyProblem = index => problem({ index, code: 'LEGACY_FORMAT', message: LEGACY_PROBLEM });

    function capped(index, all, found) {
        const cap = lineCap();
        if (all.length > cap) {
            const more = all.length - cap;
            found.push(problem({ index, code: 'TOO_MANY', message: `The reply has ${all.length} change lines; only the first ${cap} were read, so ${more} ${more === 1 ? 'line was' : 'lines were'} not used (from "${cutAt(all[cap].raw, 60)}").` }));
        }
        return all.slice(0, cap);
    }

    // The Assist safety net's marks on its receipts and Problems (MODULES §F123).
    const NOW = 'now';
    const LATE = 'late';
    // The safety net's lines that fit the reply's cap after `used` lines; the rest are one Problem.
    function assistRoom(index, items, used, found) {
        const room = Math.max(0, lineCap() - used);
        if (items.length > room) {
            const more = items.length - room;
            found.push(problem({ index, code: 'TOO_MANY', assist: items[room].mark, message: `(assist) The reply's lines fill its cap of ${lineCap()}, so ${more} safety-net ${more === 1 ? 'line was' : 'lines were'} not used (from "${cutAt(items[room].line.raw, 60)}").` }));
        }
        return items.slice(0, room);
    }

    // The previous reply's safety-net lines read after the reader had sent (its <Changes-assist-next>),
    // for reply `index` (not a Continue's): parsed, through the stricter wall for late lines, without the
    // ones the reply's own lines (`own`, raw) already hold.
    function lateLines(index, own = []) {
        const chat = ctx?.chat ?? [];
        const from = chat.slice(0, Math.max(0, index)).findLastIndex(isCarrier);
        if (from < 0 || lateReader?.faded().has(from)) return [];
        const stored = assistSections(String(chat[from]?.mes ?? '')).next;
        if (!stored.length) return [];
        const safe = parseChanges(stored.join('\n')).lines.filter(line => !refusedWhy(line, null, { late: true }));
        const keep = new Set(notWritten(safe.map(line => line.raw), own, { late: true }));
        return safe.filter(line => keep.has(line.raw));
    }

    // A reply's own safety-net lines (its <Changes-assist>), parsed, without the ones `own` already holds, nor
    // a place, time or weather `block` (the reply's own block lines, raw) set (extractor.js SCENE_KINDS).
    function nowLines(mes, own = [], block = own) {
        const stored = assistSections(String(mes ?? '')).now;
        if (!stored.length) return [];
        const parsed = parseChanges(stored.join('\n')).lines.filter(line => !refusedWhy(line, null));
        const keep = new Set(notWritten(parsed.map(line => line.raw), own, { scene: block }));
        return parsed.filter(line => keep.has(line.raw));
    }

    // How many lines of each display kind `mes` already shows (extras.js displayLines, the rule the card
    // draws by): lines a Continue or the extractor adds count after these against the cap (F115), so a
    // choice past it is told as one of the original reply's would be.
    const shownIn = mes => new Map(Object.entries(displayLines(mes, { entryOf: word => registry.capture(word), max: lineCap() }))
        .map(([kind, values]) => [kind, values.length]));

    // `before`: the reply's text before these lines were added (a Continue's, the extractor's), or null.
    // `type`: the generation's (normal, swipe, regenerate, continue) or 'late' (the extractor's lines).
    // `late` / `assist` (MODULES §F123): the Assist safety net's lines, run after the reply's own as story
    // lines marked as its (late: read from the reply before, after the reader had sent), within the same
    // cap per reply (`used`: lines the reply already read in an earlier call).
    async function captureLines(index, all, before = null, type = 'normal', { late = [], assist = [], used = 0, prechecks = [] } = {}) {
        const receipts = [];
        const found = [];
        const lines = capped(index, all, found);
        const extra = assistRoom(index, [...late.map(line => ({ line, mark: LATE })), ...assist.map(line => ({ line, mark: NOW }))], used + lines.length, found);
        const shown = typeof before === 'string' ? shownIn(before) : new Map();
        // One write of the reply's record for all its lines and its afterCapture steps (store.batch).
        let off = [];
        let steps = [];
        await (store.batch ?? (fn => fn()))(async () => {
            // The seeded pre-roll precedes this reply's story lines, as it did in the prompt.
            // Its Source is now this reply's; the previous reply is never changed.
            const prepared = prechecks.length ? await afterCapture(index, { type, problems: found, prechecks, onlyPrechecks: true }) : [];
            ({ off } = await captureEach(index, lines, receipts, found, null, null, shown));
            for (const mark of [LATE, NOW]) {
                const group = extra.filter(item => item.mark === mark).map(item => item.line);
                if (group.length) off = [...new Set([...off, ...(await captureEach(index, group, receipts, found, null, null, shown, mark)).off])];
            }
            // A pre-roll is part of this reply even when its narration has no Changes block.
            if (receipts.length || prepared.length) steps = [...prepared, ...await afterCapture(index, { type, problems: found })];
            // A reply with no story lines runs only the hooks that opted in (`hook.always === true`).
            else steps = await afterCapture(index, { type, problems: found, alwaysOnly: true });
        });
        return { receipts, problems: found, off, steps: steps.map(step => step.receipt) };
    }

    /**
     * afterCapture (SPEC §4.2 step 3): once the reply's story lines have run, each module's
     * `afterCapture(view, { index, type })` hook may return `{ commands: [{ type, payload }] }` to run as
     * `system` steps on the scene the reply ended up in (a turn-in its line read before the reply's own
     * `~ place` line). A step is stored on the reply right after its story lines, as part of that reply, its
     * receipt marked `afterCapture` (and `replan`), so a swipe or delete of the reply takes it back and a
     * Re-read runs the hook again on the new story lines. A Continue runs it again after the Continue's
     * lines. A hook that fails or takes longer than HOOK_TIMEOUT_MS, or a step that is refused, is a Problem.
     * Live (no `state`): each step is appended to the head as it runs. A Re-read passes `state` (the reply's
     * state after its new story lines), `reply` and `seeds` (the old steps' seeds by type, in order): nothing
     * is stored, and the steps come back as [{ ops, receipt, block? }] for store.replaceStory (`block`: what a
     * guarded step hands over, REPLAY.md; `plan` counts the guarded blocks the Re-read has planned so far, so
     * each gets its own ordinal). The same runner stores Assist's seeded pre-roll prelude with
     * `beforeGenerate: true`; Re-read plans that prelude before the story lines and replaces it too.
     */
    async function afterCapture(index, { type = 'normal', problems = [], state = null, reply = null, seeds = null, plan = null, prechecks = [], onlyPrechecks = false, alwaysOnly = false } = {}) {
        const steps = [];
        const live = state === null;
        let now = live ? store.head() : state;
        // A Re-read has stored nothing yet: the proof its lines and earlier steps planned is what the hooks and steps see.
        const planned = () => (live || !plan ? [] : [...plan.blocks.flatMap(piece => piece.block?.evidence ?? []), ...steps.flatMap(step => step.block?.evidence ?? [])]);
        // The reply's own receipts as far as this run knows them (`info.receipts`, read only when a hook asks): the store's for a live reply, a Re-read's planned ones.
        const replyReceipts = () => (live ? (store.receipts?.() ?? []).filter(entry => entry.index === index).map(entry => entry.receipt) : [...(plan?.blocks ?? []).map(piece => piece.receipt), ...steps.map(step => step.receipt)].filter(Boolean)).map(receiptWithCue);
        const hooks = [
            ...(prechecks.length ? [{ moduleId: HOST_MODULE, precheck: true, fn: () => ({ commands: prechecks }) }] : []),
            ...(onlyPrechecks ? [] : registry.hookEntries('afterCapture').filter(entry => !alwaysOnly || entry.fn.always === true)),
        ];
        for (const { moduleId, fn, precheck = false } of hooks) {
            const seen = live ? view() : makeView({ store, registry, settings, chat: ctx?.chat, active: viewReader, state: now, reply, pendingProofs: () => planned().map(proof => ({ proof, block: null })) });
            let out;
            try { out = await within(fn(seen, Object.defineProperty({ index, type, ...(alwaysOnly ? { always: true } : {}) }, 'receipts', { get: replyReceipts })), HOOK_TIMEOUT_MS); } catch (error) {
                problems.push(problem({ module: moduleId, index, code: 'FAILED', message: `afterCapture failed: ${error?.message ?? error}` }));
                continue;
            }
            if (out === TIMED_OUT) {
                problems.push(problem({ module: moduleId, index, code: 'TIMEOUT', message: `afterCapture did not answer within ${HOOK_TIMEOUT_MS / 1000} s; its steps after the reply's lines were not run.` }));
                continue;
            }
            for (const command of Array.isArray(out?.commands) ? out.commands : []) {
                const payload = command?.payload ?? {};
                const seed = command.seed ?? seeds?.(command?.type);
                const taking = plan ? occurrenceFor(plan, command?.type, payload) : null;
                const result = bus.run(command?.type, payload, { cause: 'system', state: live ? store.head() : now, ...(reply ? { reply: plan ? { ...reply, ...(taking.span && (plan.preserveSources || occurrenceOf(taking.span) === null) ? { ordinal: taking.span.source.ordinal } : {}), pending: plan.pending, opsBefore: plan.blocks.reduce((sum, piece) => sum + (Number.isInteger(piece.n) ? piece.n : 0), 0) + steps.reduce((sum, step) => sum + (Array.isArray(step.ops) ? step.ops.length : 0), 0) } : reply } : {}), ...(plan ? { planned: planned(), replacing: plan.replacing, reusing: taking.span, ...(Number.isInteger(taking.value) ? { occurrence: taking.value } : {}) } : {}), ...(seed === undefined ? {} : { seed }) });
                if (!result?.ok) {
                    problems.push(problem({ module: moduleId, index, code: result?.code ?? 'FAILED', message: `The step "${command?.type}" after the reply's lines was not run: ${result?.message ?? 'unknown error'}` }));
                    continue;
                }
                // Done, but not all of what was asked (a clamp, a line of the story that was not used): the step says why, and it goes to the Problems list.
                if (typeof result.problem === 'string' && result.problem) problems.push(problem({ module: moduleId, index, code: 'LIMITED', message: result.problem }));
                let replan = result.receipt.replan;
                if (!replan) { try { replan = { payload: structuredClone(payload) }; } catch { replan = undefined; } }
                const receipt = { ...result.receipt, afterCapture: true, ...(precheck ? { beforeGenerate: true } : {}), ...(replan ? { replan } : {}) };
                if (live) {
                    store.append({ ops: result.ops, receipt, ...(result.block ? { block: result.block } : {}) });
                    now = store.head();
                    events?.emit('committed', { receipt });
                } else {
                    now = result.state;
                    if (result.block && plan) {
                        plan.pending += 1;
                        if (taking.key) plan.reuse.commit(taking.key, result.block.occurrence);
                    }
                }
                steps.push({ ops: result.ops, receipt, state: now, ...(result.block ? { block: result.block } : {}) });
            }
        }
        return steps;
    }

    // The occurrence a block of a Re-read that does `type` with `payload` takes (evidence.js reusePlan): the number of a block it replaces, else the next unused.
    function occurrenceFor(plan, type, payload) {
        try {
            const key = operationKey(type, payload);
            return { key, value: plan.reuse.peek(key), span: plan.reuse.span(key) };
        } catch { return { key: null, value: undefined }; }
    }

    // For a Re-read: each afterCapture step run again gets the seed of the old one of its type, in order.
    function stepSeeds(record) {
        const stored = (Array.isArray(record?.receipts) ? record.receipts : [])
            .filter(receipt => receipt?.cause === 'system' && receipt.afterCapture === true && Number.isInteger(receipt.seed));
        const used = new Set();
        return type => {
            const at = stored.findIndex((receipt, n) => !used.has(n) && receipt.type === type);
            if (at < 0) return undefined;
            used.add(at);
            return stored[at].seed;
        };
    }

    // The reply's lines in the order they run: as written, except a line of a kind with `after` (registry captureEntry) goes behind the
    // reply's last line of the kinds it names, so it reads what those lines set up. The others keep their order, and so do the moved ones.
    function linesInOrder(lines) {
        const kinds = lines.map(line => registry.capture(line.kind));
        if (!kinds.some(entry => entry?.after)) return lines;
        const key = (line, at) => {
            const after = kinds[at]?.after;
            const last = after ? kinds.reduce((found, entry, other) => (other > at && after.includes(entry?.kind) ? other : found), -1) : -1;
            return last < 0 ? [at, 0] : [last, at + 1];
        };
        return lines.map((line, at) => ({ line, order: key(line, at) }))
            .sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1])
            .map(item => item.line);
    }

    // Runs `lines` as story captures on carrier `index`, each on the state the one before left. Stored on
    // the head as they go (append), or, with `base` (a Re-read), run on that state and returned as
    // { ops } for store.replaceStory, nothing stored.
    // `plan` ({ blocks: [], pending: 0 }, a Re-read's, shared by its calls): the guarded blocks planned so far
    // (REPLAY.md), so each line's block gets the next ordinal and replaceStory stores each as a block of its own.
    // How many Inner chatter lines this reply could show, kept in its hidden comment when the reader's setting is not the
    // usual 3 (capture.js markCaps): the reply shows the same lines whatever the setting becomes. Every reply without a
    // mark was read at 3.
    function keptCaps() {
        let entry = null;
        try { entry = registry.capture('chatter'); } catch { entry = null; }
        const cap = entry && !entry.off ? entry.display?.perReply : undefined;
        return Number.isInteger(cap) && cap > 0 && cap !== CHATTER_MAX ? { chatter: cap } : {};
    }
    const withCaps = (mes, from = 0, always = false) => {
        const caps = keptCaps();
        return always || Object.keys(caps).length ? markCaps(mes, caps, from) : mes;
    };

    async function captureEach(index, lines, receipts, found, base = null, seeds = null, shown = new Map(), assist = null, plan = null) {
        const collected = [];
        const firstProblem = found.length;
        lines = linesInOrder(lines);
        // Display kinds (written words) whose lines were read while their feature was off (capture.js markOff).
        const off = new Set();
        let state = base ?? store.head();
        // ctx.carrier and ctx.chat for the capture handlers (MODULES §F2's capture context).
        const message = ctx?.chat?.[index];
        // `sid`: the reply's record ID, which stays with the reply when earlier messages are deleted.
        const carrier = { index, swipe: Number.isInteger(message?.swipe_id) ? message.swipe_id : 0, sid: store.carrierSid?.(index) ?? null };
        // The practice rule recorded with the reply: skill practice comes only from rolls (data-modules/part.js refuses a story practice-N line). A reply
        // captured live under the rule (the RPG on, Rolls automatic) that has such a line is marked; a Re-read or an edit goes by the mark the reply
        // already has, so an older reply keeps the practice lines it was told with.
        if (readRecord(message)?.practiceRule === 'rolls') carrier.practiceRule = 'rolls';
        else if (base === null && lines.some(line => PRACTICE_LINE.test(line.raw ?? '')) && practiceFromRollsOnly(registry.featureOn?.(LEAN_RPG_FEATURE) === true, settings?.('story-block'))) {
            try { store.setPracticeRule?.(index); carrier.practiceRule = 'rolls'; } catch { /* an unmarked reply is judged as before */ }
        }
        // The message right before the reply (system messages aside), and only when it is the reader's: a reply that
        // follows another reply has no message of the reader's to quote (proof, EVIDENCE.md).
        const before = (ctx?.chat ?? []).slice(0, index).findLast(item => !item?.is_system);
        const reader = before?.is_user ? before : null;
        const chat = { lastUser: String(reader?.mes ?? ''), reply: stripBlock(String(message?.mes ?? ''), 'Changes', { heads: changeHeads() }) };
        // A Re-read (a2-3): the reply as it stands now, for bookkeeping its kept blocks wrote (ctx.standing).
        let standing = null;
        if (base) { try { standing = store.at(index); } catch { standing = null; } }
        // (and what the reply's own receipts recorded, ctx.standingReceipts: the rows a join or a return seeded)
        const standingReceipts = base ? (readRecord(message)?.receipts ?? null) : null;
        // `shown`: how many lines of each display kind this reply has shown so far (their cap per reply).
        for (const line of lines) {
            const entry = registry.capture(line.kind);
            if (!entry) {
                found.push(problem({ index, line: line.raw, code: 'UNKNOWN_KIND', message: `No module keeps "${line.kind}", so "${line.raw}" was not used.` }));
                continue;
            }
            const mark = lineMark(line.raw);
            const seed = seeds?.(entry.kind, mark);
            // C3-4: a Re-read runs a line that made a change before (its receipt gives the seed) even
            // while its feature is off, so turning a feature off never takes away what it already did.
            const again = base !== null && seed !== undefined;
            // A kind whose feature the reader turned off (MODULES §F100): not an error, just not used.
            if (entry.off && !again) {
                const label = registry.feature?.(entry.feature)?.label ?? entry.feature;
                found.push(problem({ module: entry.moduleId, index, line: line.raw, code: 'FEATURE_OFF', quiet: true, message: `"${line.raw}" was not used: ${label} is turned off (feature off).` }));
                // B-a1-5: a display line told as not used stays unshown when the feature is turned on
                // later; a Re-read reads it again.
                if (entry.display) off.add(line.kind);
                continue;
            }
            // A display kind (Choices, Inner chatter; extras.js): read for the reader alone. No command
            // runs and nothing is stored; what is shown is read again from the reply's hidden block, by
            // the same rule (readDisplayLine), so only what the rule refuses is told here.
            if (entry.display) {
                const read = readDisplayLine(entry, line, shown);
                if (!read.ok) found.push(problem({ module: entry.moduleId, index, line: line.raw, code: read.code, message: `"${line.raw}" was not used: ${read.message}.` }));
                continue;
            }
            let result;
            try {
                const operation = { type: `${CAPTURE_PREFIX}${entry.kind}`, payload: { ...line, kind: entry.kind, word: line.kind } };
                const taking = plan ? occurrenceFor(plan, operation.type, operation.payload) : null;
                const run = opts => bus.run(operation.type, operation.payload, { cause: 'story', state, capture: entry, carrier: plan ? { ...carrier, ...(taking.span && (plan.preserveSources || occurrenceOf(taking.span) === null) ? { ordinal: taking.span.source.ordinal } : {}), pending: plan.pending, opsBefore: plan.blocks.reduce((sum, piece) => sum + (Number.isInteger(piece.n) ? piece.n : 0), 0) } : carrier, chat, standing, standingReceipts, ...(plan ? { planned: plan.blocks.flatMap(piece => piece.block?.evidence ?? []), replacing: plan.replacing, reusing: taking.span, ...(Number.isInteger(taking.value) ? { occurrence: taking.value } : {}) } : {}), ...(seed === undefined ? {} : { seed }), ...opts });
                result = entry.off ? await run({ capture: { ...entry, off: false }, again: true }) : await run();
                // Refused by a feature that is off (a command it called, ctx.feature): run as it ran before.
                if (again && !entry.off && result?.code === 'FEATURE_OFF') result = await run({ again: true });
                // The receipt remembers which line made it (`line`), so a Re-read can give the line its seed again.
                // The safety net's lines are marked as its (receipt `assist`: 'now' | 'late', and the line).
                if (result?.ok) result = { ...result, receipt: { ...result.receipt, line: mark, ...(assist ? { assist, assistLine: cutAt(line.raw, 200) } : {}) } };
                if (result?.ok && base) {
                    collected.push(...result.ops);
                    if (plan) {
                        plan.blocks.push({ n: result.ops.length, receipt: result.receipt, ...(result.block ? { block: result.block } : {}) });
                        if (result.block) {
                            plan.pending += 1;
                            if (taking.key) plan.reuse.commit(taking.key, result.block.occurrence);
                        }
                    }
                } else if (result?.ok) store.append({ ops: result.ops, receipt: result.receipt, ...(result.block ? { block: result.block } : {}) });
            } catch (error) {
                result = { ok: false, code: 'FAILED', message: error?.message ?? String(error) };
            }
            if (!result?.ok) {
                // A line refused because a feature the reader turned off answered it (another module's
                // command it called, MODULES §F100): listed quietly, like a line of a kind that is off.
                found.push(problem({ module: entry.moduleId, index, line: line.raw, code: result?.code ?? 'FAILED', message: `"${line.raw}" was not used: ${result?.message ?? 'unknown error'}`, ...(result?.code === 'FEATURE_OFF' ? { quiet: true } : {}) }));
                continue;
            }
            state = result.state ?? (base ? state : store.head());
            receipts.push(result.receipt);
            // Used, but not all of it (a clamp): the owner says why, and that goes to the Problems list.
            if (typeof result.problem === 'string' && result.problem) {
                found.push(problem({ module: entry.moduleId, index, line: line.raw, code: 'LIMITED', message: result.problem }));
            }
            if (!base) events?.emit('committed', { receipt: result.receipt });
        }
        // What the safety net's lines met is marked as its in the Problems list.
        if (assist) {
            for (const item of found.slice(firstProblem)) {
                if (item.assist) continue;
                item.assist = assist;
                item.message = `(assist${assist === LATE ? ', from the previous reply' : ''}) ${item.message}`;
            }
        }
        return { ops: collected, off: [...off], state };
    }

    const refusal = (code, message) => ({ ok: false, code, message });

    // A change line's mark: a hash of its text without spaces (hiding the block breaks up "--" with one).
    const lineMark = raw => hash(String(raw ?? '').replace(/\s+/g, ''));

    // For a Re-read (r2-3): each line run again gets the seed of the story receipt it made before, so the
    // records it makes keep their IDs and the reader's later actions on them still fit. The reply's story
    // receipts are taken in order, a line matching the next one of its kind made by the same line text
    // (`line`, lineMark); a line that made none before (it failed, was changed, or is new) gets a fresh
    // seed. → (kind, mark) => seed | undefined.
    function storySeeds(record) {
        const stored = (Array.isArray(record?.receipts) ? record.receipts : [])
            .filter(receipt => receipt?.cause === 'story' && typeof receipt.line === 'string' && Number.isInteger(receipt.seed));
        let next = 0;
        return (kind, mark) => {
            const at = stored.findIndex((receipt, n) => n >= next && receipt.type === `${CAPTURE_PREFIX}${kind}` && receipt.line === mark);
            if (at < 0) return undefined;
            next = at + 1;
            return stored[at].seed;
        };
    }

    /**
     * Re-read (F40): reads reply `index`'s <Changes> block again, as its shown swipe has it now, and
     * replaces the story changes stored on it the way a fresh capture would (store.replaceStory): its
     * `story` receipts go, the lines run again on the state before the reply, and the reader's own
     * actions and system steps on it stay after them (their claims too). Later replies are checked
     * again on top; if one of them no longer fits, nothing changes. Refused for the reader's messages,
     * system messages, messages that hold no story record, and while a reply is being written.
     * Saves once and emits `turn` ({ index, type: 'reread', receipts, problems, told: [] }).
     * → { ok: true, receipts, problems } | { ok: false, code, message }.
     */
    // The first module held back (registry.heldModules) that the reply carries lines, receipts or ops of, as
    // { code, name, reason }, else null. `lines`: the change lines about to be read again.
    function heldInReply(message, lines) {
        const held = new Set(registry.heldModules?.() ?? []);
        if (!held.size) return null;
        const record = readRecord(message);
        const found = new Set();
        for (const line of lines) {
            const owner = registry.captureOwner?.(line?.kind);
            if (owner) found.add(owner);
        }
        for (const receipt of record?.receipts ?? []) if (typeof receipt?.module === 'string') found.add(receipt.module);
        for (const op of record?.ops ?? []) {
            const owner = typeof op?.path === 'string' ? registry.domainOwner?.(/^\/domains\/([^/]+)/.exec(op.path)?.[1] ?? '') : null;
            if (owner) found.add(owner);
        }
        const id = [...held].sort().find(item => found.has(item));
        if (!id) return null;
        const life = registry.lifecycle?.(id);
        return { code: life?.status === 'restore-pending' ? 'RESTORE_PENDING' : 'DEPENDENCY_UNAVAILABLE', name: registry.module?.(id)?.name ?? id, reason: life?.reason ?? 'It is not running.' };
    }

    // Session housekeeping and Re-read (turn/session.js, turn/reread.js): wired here, after every const they are given.
    const { markBusy, markIdle, setPrompt, setPrompts, clearPrompts, problem, trySave, ensureInitial, repairActions, repair, startOver, rebuild, planAgain, reconcileNow } = createSession(s, { ctx, store, bus, events, notify, initial, position, roles, hasCarrier, refusal, STATIC_KEY, TAIL_KEY, REPLY_BUSY_MAX_MS, MAX_PROBLEMS, ROLE_SYSTEM });
    const { reread, saveText, redraw } = createReread(s, { ctx, store, events, timeline, refusal, changeHeads, readBlock, strayProblems, capped, lateLines, assistRoom, nowLines, heldInReply, legacyProblem, storySeeds, afterCapture, captureEach, stepSeeds, withCaps, isPrelude, LATE, NOW, planAgain, problem, trySave });

    // The prompt side of a turn (turn/prompt-build.js, turn/prompt-hooks.js): wired here, after every const they are given. The interceptor asks for claimQuiet only when it runs.
    const { runCues, build, askCanGenerate, runOnBlocked, interceptor, battleOn, stripHistory, backgroundPrompt, foreignPrompt } = createPromptBuild(s, { ctx, store, bus, registry, settings, events, onBlocked, notify, initial, prepare, hostSettings, viewReader, view, contextNow, hasCarrier, lastCarrier, isPrelude, markBusy, markIdle, setPrompts, clearPrompts, problem, trySave, claimQuiet: () => claimQuiet(), FOREGROUND, HOOK_TIMEOUT_MS, ASSIST_WAIT_MS, RPG_LOAD_WAIT_MS, OWN_PROMPT_PARTS, OWN_PROMPT_CHARS, STRIP_CACHE, HAS_BLOCK, HAS_LEGACY, hookTimeout, normalizeType });
    const { onGenerationStarted, claimQuiet, onPromptReady, onTextPromptReady } = createPromptHooks(s, { isOwn, battleOn, stripHistory, backgroundPrompt, foreignPrompt, HAS_LEGACY, LEGACY_IN_PROMPT, holdsIn, normalizeType });

    /** MESSAGE_RECEIVED: (messageId, type). */
    async function onMessageReceived(messageId) {
        const id = Number(messageId);
        const current = s.session;
        if (!current || !Number.isInteger(id) || id !== current.index) return null;
        s.session = null;
        markIdle();
        clearPrompts();
        const message = ctx?.chat?.[id];
        if (!isCarrier(message)) return null;
        // The turn's save window opens now, so the capture's lines are not saved one by one (400 ms each).
        const idle = store.saveIdle?.() === true;
        try {
            if (store.headIndex() !== id) store.rebuild();
            ensureInitial();
            if (store.headIndex() !== id) {
                problem({ index: id, code: 'FAILED', message: 'The reply is not the last message that keeps the story, so its changes were not read.' });
                return null;
            }
            const written = String(message.mes ?? '');
            // A Continue: SillyTavern wrote the old text again, cleaned up, so it can be shorter than it
            // was; where the added text starts is found, not counted, or its block is left bare.
            const at = typeof current.base === 'string' ? continuation(current.base, written) : null;
            // C2-7: a copy of the hidden comment's marker the model wrote itself is defanged first, so the
            // reply is read live as Re-read will read the saved message.
            // A v1 envelope (capture.js adoptLegacy): read as the reply's block when it has none, else taken out unread.
            const adopted = adoptLegacy(defangMarker(written, at?.from ?? 0), { at });
            const text = adopted.text;
            let edited = false;
            if (text !== written) {
                message.mes = text;
                if (Array.isArray(message.swipes) && Number.isInteger(message.swipe_id)) message.swipes[message.swipe_id] = text;
                edited = true;
            }
            // The reader stopped it (GENERATION_STOPPED): an open block's unfinished last line is left out.
            const stopped = current.stopped === true;
            // Change lines written in the story near the block are read with it (capture.js strayLines).
            const heads = changeHeads();
            const block = extractBlock(text, 'Changes', at, { stopped, heads });
            const parsed = block === null ? { lines: [], problems: [] } : readBlock(id, block);
            const problems = [...parsed.problems, ...strayProblems(id, text, heads, { from: at?.from ?? 0, tail: at?.tail === true, stopped }, parsed.lines.map(line => line.raw))];
            if (adopted.legacy === 'read') problems.push(legacyProblem(id));
            const cut = block === null ? null : cutLine(text, 'Changes', at);
            if (cut) problems.push(problem({ index: id, line: cut, code: 'CUT_OFF', message: `The reply ended in the middle of the change line "${cutAt(cut, 80)}" (nothing after it on its line, and the block was not closed), so it was not used. Continue finishes it; or end the line and close the block by hand, then Re-read.` }));
            // The previous reply's safety-net lines that came after the reader sent (not for a Continue).
            const late = current.type === 'continue' ? [] : lateLines(id, parsed.lines.map(line => line.raw));
            const result = await captureLines(id, parsed.lines, at ? current.base : null, current.type, { late, prechecks: current.prechecks });
            problems.push(...result.problems);
            receivedHooks(id, current.type);

            // What this reply was told; a Continue keeps what the reply was told before.
            // (B-b2-timeline-9: read through readRecord, and only receipt IDs, whatever the chat holds.)
            const told = current.type === 'continue' ? readRecord(message)?.narrated ?? [] : [];
            const before = told.filter(id => typeof id === 'string');
            store.setNarrated(id, [...new Set([...before, ...current.untold, ...result.steps.filter(receipt => receipt.beforeGenerate === true).map(receipt => receipt.id)])], { reply: !(current.type === 'swipe' && id === 0) });   // (a swipe of the opening greeting is still a greeting)

            // Also with no block: the change lines left in the story are listed in the hidden comment, so a
            // Re-read leaves them too (B-a1-3, B-a1-10).
            let hidden = hideBlock(message.mes, 'Changes', { ...(at ?? {}), stopped, heads, legacy: adopted.legacy === 'read' });
            if (result.off.length) hidden = markOff(hidden, result.off, at?.from ?? 0);
            hidden = withCaps(hidden, at?.from ?? 0);
            if (hidden !== message.mes) {
                message.mes = hidden;
                if (Array.isArray(message.swipes) && Number.isInteger(message.swipe_id)) message.swipes[message.swipe_id] = hidden;
                edited = true;
            }
            if (timeline?.needsRecovery()) {
                const anchored = await timeline.recover();
                if (!anchored.ok) problem({ index: id, code: anchored.code, message: anchored.message });
            }
            s.deferred = false;
            // One write for the reply, its capture and the reader's actions after it (store.saveIdle).
            if (idle && store.dirty()) store.saveIdle();
            else if (store.dirty()) await trySave('after the reply');
            else if (edited) await saveText();
            // At MESSAGE_RECEIVED SillyTavern has not drawn the reply yet (it draws the text as saved), so
            // redrawing can fail; that is not a reason to lose the turn.
            if (edited) redraw(id, message);
            const turn = { index: id, type: current.type, receipts: result.receipts, steps: result.steps, problems, told: current.untold };
            events?.emit('turn', turn);
            afterReply(id, current.type, message, [...parsed.lines, ...late].map(line => line.raw));
            return turn;
        } catch (error) {
            problem({ index: id, code: 'FAILED', message: `The reply's changes could not be kept: ${error?.message ?? error}` });
            return null;
        }
    }

    // afterReply (the assist extractor): a reply that came without change lines may get them from a
    // module after all. Not awaited; a failure is logged. `capture(text, { index, swipe })` runs the
    // lines as story captures on that reply when it is still the head on the same swipe.
    // (The Assist safety net runs after every reply; `lines` are the change lines its capture read.) A send
    // waits for these runs briefly (assistPending, ASSIST_WAIT_MS).
    function afterReply(index, type, message, lines = []) {
        const swipe = Number.isInteger(message?.swipe_id) ? message.swipe_id : 0;
        const runs = [];
        for (const { moduleId, fn } of registry.hookEntries('afterReply')) {
            runs.push(Promise.resolve()
                .then(() => fn({ index, swipe, type, lines: [...lines], mes: String(message?.mes ?? ''), capture: (text, at = { index, swipe }, opts = {}) => captureLate(at, text, opts) }))
                .catch(error => problem({ module: moduleId, index, code: 'FAILED', message: `afterReply failed: ${error?.message ?? error}` }))
                // C2-ext: what the hook made of the reply (the extractor read it, or failed to) can change
                // the reply's note, so the notes are drawn again.
                .finally(() => { if (store.headIndex() === index) events?.emit('head', { index }); }));
        }
        if (!runs.length) return;
        const all = Promise.allSettled(runs).then(() => { if (s.assistPending === all) s.assistPending = null; });
        s.assistPending = all;
    }

    // afterReceive: every reply that arrives, with or without change lines, once its lines have been read and before it is
    // saved (the RPG lets go of the plan it held for the reply). Nothing is asked of it; a failure is a Problem.
    function receivedHooks(index, type) {
        for (const { moduleId, fn } of registry.hookEntries('afterReceive')) {
            try { fn(view(), { index, type }); } catch (error) {
                problem({ module: moduleId, index, code: 'FAILED', message: `afterReceive failed: ${error?.message ?? error}` });
            }
        }
    }

    /** Change lines found after the reply (afterReply): captured on it and kept in its hidden block. */
    async function captureLate({ index, swipe } = {}, text = '', { assist = false, refused = [] } = {}) {
        const message = ctx?.chat?.[index];
        if (assist) return captureAssist({ index, swipe }, text, message, refused);
        if (!isCarrier(message) || store.headIndex() !== index || (Number.isInteger(message.swipe_id) ? message.swipe_id : 0) !== swipe || s.session) {
            return { receipts: [], problems: ['The reply changed before its late change lines arrived; they were not used.'] };
        }
        const parsed = readBlock(index, String(text ?? ''));
        const problems = [...parsed.problems];
        const result = await captureLines(index, parsed.lines, String(message.mes ?? ''), 'late');
        problems.push(...result.problems);
        if (parsed.lines.length) {
            // Kept in a hidden block of their own after the reply's, so Re-read finds them too (and what the
            // reply's comment holds besides its block, the lines left in the story, stays as it was).
            const base = String(message.mes ?? '');
            const from = base.trimEnd().length;
            const mes = withCaps(markOff(hideBlock(`${base}\n\n<Changes>\n${parsed.lines.map(line => line.raw).join('\n')}\n</Changes>`, 'Changes', { from }), result.off, from), from);
            message.mes = mes;
            if (Array.isArray(message.swipes) && Number.isInteger(message.swipe_id)) message.swipes[message.swipe_id] = mes;
        }
        if (store.dirty()) {
            if (store.saveIdle?.() !== true) await trySave('after the late change lines');
        } else if (parsed.lines.length) await saveText();
        if (parsed.lines.length) redraw(index, message);
        const turn = { index, type: 'late', receipts: result.receipts, steps: result.steps, problems, told: [] };
        events?.emit('turn', turn);
        return turn;
    }

    /**
     * The Assist safety net's lines for reply `index` (MODULES §F123). Still the head on the same swipe and
     * no send begun: run now as story lines marked `assist: 'now'`, after the reply's own, and kept in its
     * <Changes-assist> section. A send already begun (the brief wait is over): kept on the reply as
     * <Changes-assist-next>, through the stricter wall, for the next reply to apply after its own lines;
     * nothing changes now. Anything else (swiped, deleted, the next reply already in): not used.
     */
    async function captureAssist({ index, swipe }, text, message, refused = []) {
        const same = isCarrier(message) && store.headIndex() === index && (Number.isInteger(message.swipe_id) ? message.swipe_id : 0) === swipe;
        if (!same) return { receipts: [], problems: ['The reply changed before the safety net\'s lines arrived; they were not used.'], dropped: true };
        // Lines the safety net wrote that code refused (an unknown name for a place the map has, a time with no clock time): a
        // Problems line each, so the reader sees what was left out and why; they are not applied and not kept on the reply.
        const refusals = (Array.isArray(refused) ? refused : []).filter(item => typeof item?.line === 'string' && item.line)
            .map(item => problem({ index, line: item.line, code: 'REFUSED', message: `"${item.line}" was not used: ${String(item.why ?? '').slice(0, 240)}.` }));
        const heads = changeHeads();
        const mes = String(message.mes ?? '');
        const block = extractBlock(mes, 'Changes', null, { heads });
        const blockLines = block === null ? [] : parseChanges(block).lines.map(line => line.raw);
        const own = [...blockLines, ...lateLines(index, []).map(line => line.raw)];
        const parsed = parseChanges(String(text ?? '')).lines;
        const fresh = new Set(notWritten(parsed.map(line => line.raw), own, { scene: blockLines }));
        const kept = parsed.filter(line => fresh.has(line.raw) && !refusedWhy(line, null, { late: Boolean(s.session || s.replyBusy) }));
        const store1 = mes2 => {
            message.mes = mes2;
            if (Array.isArray(message.swipes) && Number.isInteger(message.swipe_id)) message.swipes[message.swipe_id] = mes2;
        };
        if (s.session || s.replyBusy) {
            if (!kept.length) return { receipts: [], problems: refusals, deferred: true };
            // Saved with the next reply (its own save writes the chat).
            store1(withAssist(mes, kept.map(line => line.raw), { next: true }));
            redraw(index, message);
            return { receipts: [], problems: refusals, deferred: true, lines: kept.map(line => line.raw) };
        }
        if (!kept.length) return { index, type: 'late', receipts: [], steps: [], problems: refusals, told: [] };
        const used = block === null ? 0 : readBlock(index, block).lines.length;
        const result = await captureLines(index, [], mes, 'late', { assist: kept, used });
        store1(withCaps(markOff(withAssist(mes, kept.map(line => line.raw)), result.off, mes.trimEnd().length), mes.trimEnd().length));
        if (store.dirty()) {
            if (store.saveIdle?.() !== true) await trySave('after the safety net\'s lines');
        } else await saveText();
        redraw(index, message);
        const turn = { index, type: 'late', receipts: result.receipts, steps: result.steps, problems: [...refusals, ...result.problems], told: [] };
        events?.emit('turn', turn);
        return turn;
    }

    /** CHAT_CHANGED: a new chat (or the same one reloaded). */
    async function onChatChanged() {
        // The old chat's session and prompts go at once, before anything is awaited: a generation started while the RPG's code loads is the new chat's.
        s.session = null;
        s.quiets = [];
        markIdle();
        clearPrompts();
        // The RPG's code, when this chat needs it (the feature is on, or it holds the RPG's records), before anything is replayed (rpg-lazy.js); a stalled
        // import is waited for only RPG_LOAD_WAIT_MS (the guard mark then says the code is missing, so a later load makes the chat look again).
        if (typeof prepare === 'function') { try { await within(prepare(), RPG_LOAD_WAIT_MS); } catch { /* the loader reports its own failure */ } }
        rebuild({ publish: false });
        timeline?.settle();
        // A1-2: read-backs of a write that timed out before a reload of the page go on.
        try { store.resume?.(); } catch { /* only a guard */ }
        // A cue left for the reply's save (runCues) whose reply will not come here: saved now (into its
        // own chat's file when this is another chat, the store's rescue).
        if (s.deferred) {
            s.deferred = false;
            if (store.dirty?.()) store.scheduleSave?.();
        }
        await ensureModules({ store, bus, registry, events });
        events?.emit('head', { index: store.headIndex(), reason: 'chat' });
    }

    /**
     * A reader's action in a chat that has a message but no state yet (sdk.command): the state starts on its first carrier now, as
     * onChatChanged would. SillyTavern shows a new chat's greeting before it tells of the chat (CHAT_CHANGED comes after its save, and
     * after every listener ahead of Story Block's), and a message added with no event Story Block reads (/sendas into an empty chat)
     * starts nothing. No open chat, or no carrier: nothing to start. → true when the chat has a state.
     */
    function seed() {
        if (store.head()) return true;
        let open = true;
        try { open = typeof ctx?.getCurrentChatId !== 'function' || !!ctx.getCurrentChatId(); } catch { open = true; }
        if (!open || !hasCarrier()) return false;
        rebuild();
        return !!store.head();
    }

    /**
     * CHAT_RENAMED: { oldFileName, newFileName } (file names with ".jsonl"). SillyTavern 1.19 renames the
     * file, reads the open chat back (CHAT_CHANGED), then tells this; a change not saved yet goes into the
     * renamed file (store.renamed, B-b2-timeline-r2-2). The server may clean the new name up (characters
     * it does not allow in a file name); when the open chat's ID is that name cleaned up, it is the one.
     */
    function onChatRenamed(data) {
        const name = value => String(value ?? '').trim().replace(/\.jsonl$/i, '');
        const from = name(data?.oldFileName);
        let to = name(data?.newFileName);
        if (!from || !to) return false;
        let open = null;
        try { open = typeof ctx?.getCurrentChatId === 'function' ? ctx.getCurrentChatId() : null; } catch { open = null; }
        const loose = id => String(id).replace(/[\/?<>\\:*|"\u0000-\u001f\u0080-\u009f]/g, '').replace(/[. ]+$/, '');
        if (typeof open === 'string' && open && open !== from && open !== to && loose(open) === loose(to)) to = open;
        return store.renamed?.(from, to) ?? false;
    }

    /**
     * Deleted messages, swipes, a greeting picked: the state is rebuilt from what is stored. `reason` ('delete', 'swipe',
     * 'edit'; anything else is none) rides on the head event for the public API's `story:rebuilt`.
     */
    async function onTimelineChanged(reason) {
        rebuild({ publish: false });
        reconcileNow();
        timeline?.settle();
        if (timeline?.needsRecovery()) await timeline.recover();
        // one head, after the steps that follow the change are planned again
        events?.emit('head', { index: store.headIndex(), ...(REBUILD_REASONS.has(reason) ? { reason } : {}) });
    }

    /**
     * A deleted swipe. SillyTavern tells of the deletion of the swipe being shown before it shows the next one (`extra` is
     * still the deleted swipe's; MESSAGE_SWIPED follows). The shown swipe is told by whose record it holds, not by its text
     * (persist.js swipeLoading): while it is in flux nothing is rebuilt, restamped, reconciled or published, so no record is
     * written and no head is told of; the swipe load that follows does all of it once. Any other swipe deletion is a
     * change on its own.
     */
    function onSwipeDeleted(detail) {
        const live = ctx?.chat ?? [];
        const at = Number.isInteger(detail) ? detail : detail?.messageId;
        const message = live[Number.isInteger(at) ? at : live.length - 1];
        const deleted = Number.isInteger(detail?.swipeId) ? detail.swipeId : null;
        if (swipeLoading(message, deleted)) return;
        return onTimelineChanged('delete');
    }

    /** GENERATION_STOPPED: the reader stopped the reply being written (its last line may be unfinished). */
    function onGenerationStopped() {
        if (s.session) s.session.stopped = true;
        onGenerationEnded();
    }

    /** GENERATION_ENDED / GENERATION_STOPPED: a spent note never reaches a later prompt. */
    function onGenerationEnded() {
        if (s.session?.prompted) clearPrompts();
        s.deferred = false;
        markIdle();
        // A save that failed and was not made good after the reply (or the reply never came): again soon.
        if (store.dirty()) store.scheduleSave();
    }

    function install({ globalName = INTERCEPTOR_NAME } = {}) {
        for (const [key, place] of V1_KEYS) setPrompt(key, '', place);
        clearPrompts();
        if (globalName) globalThis[globalName] = interceptor;
        // A module turned ready or dormant: guarded blocks of its are asked again (store.lifecycleChanged).
        s.offModules?.();
        s.offModules = events?.on?.('modules', () => {
            if (store.lifecycleChanged?.()) events?.emit('head', { index: store.headIndex(), reason: 'module' });
        }) ?? null;
        const source = ctx?.eventSource;
        const names = ctx?.eventTypes ?? ctx?.event_types ?? {};
        const on = (event, fn) => {
            if (!event || typeof source?.on !== 'function') return;
            source.on(event, fn);
            s.listeners.push([event, fn]);
        };
        on(names.GENERATION_STARTED, onGenerationStarted);
        on(names.CHAT_COMPLETION_PROMPT_READY, onPromptReady);
        on(names.GENERATE_AFTER_COMBINE_PROMPTS, onTextPromptReady);
        on(names.MESSAGE_RECEIVED, onMessageReceived);
        on(names.GENERATION_ENDED, onGenerationEnded);
        on(names.GENERATION_STOPPED, onGenerationStopped);
        on(names.CHAT_CHANGED, onChatChanged);
        on(names.CHAT_RENAMED, onChatRenamed);
        // MESSAGE_EDITED too: a record's swipe mark follows an edit (persist.js restamp), so a Continue
        // after it still finds the record.
        for (const [event, reason] of [[names.MESSAGE_DELETED, 'delete'], [names.MESSAGE_SWIPED, 'swipe'], [names.CHARACTER_FIRST_MESSAGE_SELECTED, 'swipe'], [names.MESSAGE_EDITED, 'edit']]) on(event, () => onTimelineChanged(reason));
        on(names.MESSAGE_SWIPE_DELETED, onSwipeDeleted);
        return api;
    }

    function uninstall({ globalName = INTERCEPTOR_NAME } = {}) {
        s.offModules?.();
        s.offModules = null;
        const source = ctx?.eventSource;
        for (const [event, fn] of s.listeners) (source?.removeListener ?? source?.off)?.call(source, event, fn);
        s.listeners = [];
        if (globalName && globalThis[globalName] === interceptor) delete globalThis[globalName];
        clearPrompts();
        markIdle();
    }

    const api = {
        repairActions,
        repair,
        startOver,
        interceptor,
        install,
        uninstall,
        onGenerationStarted,
        onPromptReady,
        onTextPromptReady,
        onMessageReceived,
        onChatChanged,
        seed,
        onChatRenamed,
        onTimelineChanged,
        onGenerationEnded,
        reread,
        /** What the next ordinary reply would be sent, without changing anything (no cues run). */
        preview: () => build().parts,
        /**
         * The same with how it fits the context and what modules send on their own: { parts, fit, own }
         * (fit: prompt.js contextFit, or null; own: [{ module, label, place: 'own', text, tokens }]).
         */
        previewFit: () => {
            const built = build();
            return { parts: built.parts, fit: built.fit, own: built.own };
        },
        /** Adds { module?, code?, message, index?, line? } to the Problems list (and the console). */
        // (`toast`: told at once too, not only listed)
        report: entry => {
            const item = problem(entry);
            if (entry?.toast === true) { try { notify?.(item.message, item.module); } catch { /* a missing toastr is not an error */ } }
            return item;
        },
        /** The Problems list, oldest first; `moduleId` narrows it (null: the host's own). */
        problems: moduleId => s.problemLog.filter(item => moduleId === undefined || item.module === moduleId).map(item => ({ ...item })),
        clearProblems: () => { s.problemLog.length = 0; },
        /** Generations a canGenerate hook stopped: [{ moduleId, reason }], oldest first. */
        blocked: () => s.blocks.map(item => ({ ...item })),
        /**
         * Every module holding the story back now (each canGenerate asked, none logged):
         * Promise<[{ moduleId, name, reason, action, canOpen }]> (`action`: the module's button words, '' for
         * the host's own, false for no button; `canOpen`: it has an onBlocked hook to run).
         */
        blockers: () => askCanGenerate({ all: true }),
        /** Runs module `moduleId`'s onBlocked(reason, moduleId) hook (Home's button). → true when it ran. */
        unblock: (moduleId, reason = '') => runOnBlocked(moduleId, reason),
        /** The pending reply's session (for status and tests), or null. */
        session: () => (s.session ? { ...s.session } : null),
        /** Whether a reply is being built or awaited (its interceptor ran; not yet received, ended or stopped). */
        replyBusy: () => s.replyBusy,
        /** Resolves when no reply is in progress (at once when none is). */
        whenIdle,
    };
    return api;
}
