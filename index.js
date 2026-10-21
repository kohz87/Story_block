// Story Block runtime: SillyTavern wiring for the block engine.
//
// The generation lifecycle is Inventory Block v0.6.7's, generalized from one block to the
// reader's block list: a placeholder registered through SillyTavern's extension prompt
// identifies the reply's own prompt, the real context replaces it at prompt-ready, and
// every block a reply writes lives in that reply's message text — the chat is the store.

import { normalizeBlock, normalizeBlocks } from './src/schema.js';
import { TEMPLATES, defaultBlocks, upgradePrompts } from './src/templates.js';
import { applyReplyChanges, changeDefs, changesOnly } from './src/changes.js';
import { formatFor } from './src/formats/index.js';
import { bareBlockTexts, carryStates, dropForeignCopies, latestBlockInText, latestBlockState, mergeRepeats, normalizeTransport, rejoinContinuation, replacesLastReply, stateForGeneration, upsertBlock } from './src/envelope.js';
import { escapeBody } from './src/formats/escape.js';
import { applyChanges, leaveLine } from './src/formats/rows.js';
import { activeBlocks, buildContext, buildContextParts, defuseMacros, injectContext, promptCarriesContext } from './src/prompt.js';
import { blockStatusInText, blockView, isAssistant, latestAssistantIndex, tabView, viewKey } from './src/view.js';
import { turnCount, turnItems } from './src/turn.js';
import { createTabRegistry } from './src/ui/card.js';
import { el } from './src/ui/dom.js';
import { render as renderPlain } from './src/ui/displays/plain.js';
import { render as renderTree } from './src/ui/displays/tree.js';
import { render as renderFields } from './src/ui/displays/fields.js';
import { render as renderScene } from './src/ui/displays/scene.js';
import { withoutSections } from './src/scene.js';
import { render as renderChoices } from './src/ui/displays/choices.js';
import { render as renderDice } from './src/ui/displays/dice.js';
import { render as renderChatter } from './src/ui/displays/chatter.js';
import { rollDice, stampRolls } from './src/dice.js';
import { renderSettings } from './src/ui/editor.js';
import { initializeMount, scheduleMount, setMountSuspended } from './src/mount.js';
import { openBodyEditor } from './src/body-editor.js';
import { blockInText, blockSnapshot, blockSummary, createListeners, findBlockDef, generationSnapshot, hasTab, pluginBlockDef } from './src/plugin.js';
import { storySuite } from './src/suite.js';
import { contextTokens } from './src/tokens.js';
import { JOURNAL_VERSION, journalKey, journalState } from './src/journal.js';
import { randomId } from './src/id.js';
import { previewParts, renderPreview } from './src/ui/preview.js';
import { closeSuiteOverlay, openSuiteOverlay, refreshSuiteOverlay } from './src/ui/suite-overlay.js';
import { AREA_LABELS, RPG_BATTLE_ID, SHARED_AREAS, SUITE_ID, SUITE_NAME, blockAreas, chatterNote, deferredTo, diceNote, displaysShownElsewhere, fightNarrated, keepsOwnRolls, normalizeSourceChoices, offeredAreas, sourceStatus, statsNotice, timelineKeeper, timelineTrimmed } from './src/handshake.js';
import { DEFAULT_CURRENCY, normalizeCurrency, parseTiersText, purseLine, tiersText } from './src/money.js';

const VERSION = '0.9.30';
const SETTINGS_KEY = 'storyBlock';
// (0.9.21) Two extension prompts, for a provider's prompt cache (docs/STORY_SUITE.md, "Prompt
// cache"): the instructions, the same text reply after reply, and this reply's part, sent last.
const STATIC_PROMPT_KEY = 'story_suite_static_story_block';
const TAIL_PROMPT_KEY = 'story_suite_tail_1_story_block';
// The one key before 0.9.21, cleared so a copy set by an older version never lingers.
const LEGACY_PROMPT_KEY = 'story_block';
// SillyTavern extension_prompt_types.IN_PROMPT / IN_CHAT and extension_prompt_roles.SYSTEM.
const EXTENSION_PROMPT_IN_PROMPT = 0;
const EXTENSION_PROMPT_IN_CHAT = 1;
const EXTENSION_PROMPT_ROLE_SYSTEM = 0;
const SESSION_MAX_AGE_MS = 2 * 60 * 1000;
const SESSION_RECHECK_MS = 15 * 1000;
const DISPLAYS = { plain: renderPlain, tree: renderTree, fields: renderFields, scene: renderScene, choices: renderChoices, dice: renderDice, chatter: renderChatter };

let initialized = false;
// Set once a reply's prompt has been seen carrying the placeholder; from then on a prompt
// without it is never mistaken for a reply's (see foregroundKind).
let contextMarkerSeen = false;
let eventsRegistered = false;
let uiRetry = null;
let coexistenceWarned = false;
let suiteSubscribed = false;
// The Source of truth section of the settings panel, redrawn when the suite changes.
let suiteSection = null;
// "Manage all in Story Suite" at the top of the settings panel and "Story Suite" in the
// Extensions menu, shown while the overlay is offered.
let suiteLink = null;
let suiteMenuItem = null;
// The settings folds' one-line summaries (Display, Source of truth, Blocks), kept current.
const foldHints = {};
const pending = new Map();
const cleanupTimers = new Map();
const normalizingMessages = new Set();
const externalTabs = createTabRegistry();
// Dice animate once, when a reply's rolls are first shown; re-renders show them at rest.
const animatedRolls = new Set();

function context() {
    return globalThis.SillyTavern?.getContext?.() ?? null;
}

function chatIdOf(ctx) {
    try { return ctx?.getCurrentChatId?.() ?? ctx?.chatId ?? null; }
    catch { return ctx?.chatId ?? null; }
}

function hasActiveChat(ctx) {
    return Boolean(ctx && chatIdOf(ctx));
}

function notify(level, message) {
    globalThis.toastr?.[level]?.(message, 'Story Block');
}

function normalizeType(type) {
    return String(type ?? 'normal').trim().toLowerCase();
}

// SillyTavern's background generation types; Story Block drives only foreground replies.
function isBackgroundGeneration(type, isDryRun = false) {
    if (isDryRun) return true;
    const lower = normalizeType(type);
    return lower === 'quiet' || lower === 'impersonate';
}

function settings(ctx = context()) {
    const store = ctx?.extensionSettings;
    if (!store || typeof store !== 'object') return { blocks: defaultBlocks(), compatMarkup: true, display: 'sidebar', hideOffscreen: true, showTurnStrip: false, hideEmptyTabs: false, sidebarPinned: true, sourceOfTruth: normalizeSourceChoices(null), dismissedTemplates: [], currency: structuredClone(DEFAULT_CURRENCY) };
    if (!store[SETTINGS_KEY] || typeof store[SETTINGS_KEY] !== 'object') store[SETTINGS_KEY] = {};
    const own = store[SETTINGS_KEY];
    // A first install starts from the templates; afterwards the stored list is the reader's.
    // (0.9.15) A built-in instruction never edited follows the current version's.
    own.blocks = Array.isArray(own.blocks) ? upgradePrompts(normalizeBlocks(own.blocks)) : defaultBlocks();
    own.compatMarkup = own.compatMarkup !== false;
    // Where blocks are shown: the sidebar (docked on wide screens, a drawer or bottom sheet
    // elsewhere) or the v0.1 card under the latest reply. The strip is opt-in.
    own.display = own.display === 'card' ? 'card' : 'sidebar';
    own.showTurnStrip = own.showTurnStrip === true;
    // (0.9.18) The sidebar lists empty blocks too, unless the reader hides them.
    own.hideEmptyTabs = own.hideEmptyTabs === true;
    own.sidebarPinned = own.sidebarPinned !== false;
    // Off-screen on the scene board is behind the scenes, so it starts hidden.
    own.hideOffscreen = own.hideOffscreen !== false;
    // Story Suite: per shared area, who is the source of truth ('auto', 'mine' or 'theirs').
    own.sourceOfTruth = normalizeSourceChoices(own.sourceOfTruth);
    // Built-in templates the "New built-in blocks" line no longer offers (added or dismissed).
    own.dismissedTemplates = Array.isArray(own.dismissedTemplates) ? [...new Set(own.dismissedTemplates.map(String))] : [];
    // (0.9.12) The Inventory's money, for its purse total: copper/silver/gold unless the reader
    // chose one coin, coins of their own, or none.
    own.currency = own.currency?.mode === 'off' ? { mode: 'off' } : normalizeCurrency(own.currency) ?? structuredClone(DEFAULT_CURRENCY);
    return own;
}

function blocks(ctx = context()) {
    return settings(ctx).blocks;
}

function enabledBlocks(ctx = context()) {
    return blocks(ctx).filter(block => block.enabled);
}

// Blocks other extensions registered: transport only (hidden and kept, never prompted), or
// kept by the extension (shown to the model read-only, a tab without Edit unless `tab: false`).
const pluginBlocks = new Map();
const replyListeners = createListeners('reply listener');
let replyCallbacks = 0;
const updateListeners = createListeners('update listener');

// Every tag Story Block moves into the envelope and keeps out of narration and history.
// (0.9.16) A changes-only block's <Tag_Changes> travels hidden like the rest, until it is applied.
function transportBlocks(ctx = context()) {
    const own = blocks(ctx);
    return [...own, ...changeDefs(own), ...pluginBlocks.values()];
}

function keptBlocks() {
    return [...pluginBlocks.values()].filter(def => def.kept);
}

/**
 * Kept blocks as the next reply's prompt shows them: the newest copy the extension wrote,
 * before the reply a swipe or regenerate replaces (the same baseline as stateful blocks).
 * Their dice modifiers are left out while the reader keeps rolls with Story Block although
 * another extension offers them (keepsOwnRolls); otherwise the Dice block takes them, as in 0.7.
 */
function keptEntries(chat, type, { ownRolls = false } = {}) {
    const list = Array.isArray(chat) ? chat : [];
    const beforeIndex = replacesLastReply(list, type) ? list.length - 1 : null;
    return keptBlocks().map(def => {
        const found = latestBlockState(list, def, { beforeIndex }) ?? archivedState(def);
        if (!found) return null;
        return { def: ownRolls && def.diceModifier ? { ...def, diceModifier: '' } : def, state: found.state, body: found.body };
    }).filter(Boolean);
}

function saveSettings(ctx = context()) {
    ctx?.saveSettingsDebounced?.();
}

// {{user}}/{{char}} in block prompts; state text is never substituted.
function substituter(ctx) {
    return text => (typeof ctx?.substituteParams === 'function' ? ctx.substituteParams(text) : text);
}

function refreshAll(delay = 20) {
    scheduleMount(delay);
    updateListeners.emit({ chatId: chatIdOf(context()) });
}

function syncMountSuspension() {
    const activeId = chatIdOf(context());
    setMountSuspended(Boolean(activeId && pending.has(activeId)));
}

function clearCleanupTimer(chatId) {
    const timer = cleanupTimers.get(chatId);
    if (timer) clearTimeout(timer);
    cleanupTimers.delete(chatId);
}

// Chat completion places in-prompt extension prompts next to the Main Prompt and drops
// them when a preset disables it, so the instructions' placeholder goes in-chat there (at
// prompt-ready they move up, after the leading system messages). Text completion keeps it
// inside the story string. (0.9.21) This reply's part goes in-chat at depth 0 in both, and is
// filled in where SillyTavern put it. `parts`: { static, tail } (defused), or '' to clear.
function setExtensionPlaceholder(ctx, parts = '') {
    if (typeof ctx?.setExtensionPrompt !== 'function') return;
    const head = typeof parts === 'object' && parts ? String(parts.static ?? '') : '';
    const tail = typeof parts === 'object' && parts ? String(parts.tail ?? '') : '';
    const position = ctx.mainApi === 'openai' ? EXTENSION_PROMPT_IN_CHAT : EXTENSION_PROMPT_IN_PROMPT;
    ctx.setExtensionPrompt(STATIC_PROMPT_KEY, head, position, 0, false, EXTENSION_PROMPT_ROLE_SYSTEM);
    ctx.setExtensionPrompt(TAIL_PROMPT_KEY, tail, EXTENSION_PROMPT_IN_CHAT, 0, false, EXTENSION_PROMPT_ROLE_SYSTEM);
    ctx.setExtensionPrompt(LEGACY_PROMPT_KEY, '', position, 0, false, EXTENSION_PROMPT_ROLE_SYSTEM);
}

// Shown in the settings panel and logged, so a missing injection can be diagnosed.
function reportStatus(text, level = 'info') {
    const status = globalThis.document?.getElementById?.('story_block_status');
    if (status) status.textContent = `${new Date().toLocaleTimeString()} · ${text}`;
    console[level === 'warn' ? 'warn' : 'info'](`[Story Block] ${text}`);
}

function clearSession(chatId) {
    if (!chatId) return;
    clearCleanupTimer(chatId);
    const session = pending.get(chatId);
    if (session && session.entries.length && !session.injected && session.promptsSeen > 0) {
        reportStatus(`Last reply: none of its ${session.promptsSeen} prompt(s) carried the Story Block placeholder, so no block instructions were sent.`, 'warn');
    }
    pending.delete(chatId);
    if (!pending.size) setExtensionPlaceholder(context(), '');
    syncMountSuspension();
}

function scheduleSessionCleanup(chatId, delay = 3000) {
    clearCleanupTimer(chatId);
    cleanupTimers.set(chatId, setTimeout(() => clearSession(chatId), delay));
}

// SillyTavern marks <body data-generating="true"> and shows its Stop button while a reply generates.
function generationRunning() {
    if (document.body?.dataset?.generating === 'true') return true;
    const stop = document.getElementById('mes_stop');
    return Boolean(stop) && getComputedStyle(stop).display !== 'none';
}

/**
 * Safety net for generations that never report back (API errors, aborts that emit no
 * end event). Without it the session stays pending, the card stays suspended and never
 * refreshes again until the next generation.
 */
function armSessionWatchdog(chatId, delay = SESSION_MAX_AGE_MS) {
    clearCleanupTimer(chatId);
    cleanupTimers.set(chatId, setTimeout(() => {
        if (generationRunning()) armSessionWatchdog(chatId, SESSION_RECHECK_MS);
        else clearSession(chatId);
    }, delay));
}

// (0.9.21) The blocks the instructions always hold (when: always), and those the rules are
// worded for (every enabled block), as the reply is prompted with them: the instructions stay
// the same while the reader's blocks do. A block asked for only now and then is in the tail.
function promptDefs(ctx = context()) {
    const keeper = timelineKeeper(settings(ctx).sourceOfTruth, storySuite());
    const shown = def => timelineTrimmed(def, null, keeper, withoutSections).def;
    const enabled = enabledBlocks(ctx);
    return {
        staticDefs: enabled.filter(def => (def.when?.mode ?? 'always') === 'always').map(shown),
        ruleDefs: enabled.map(shown),
    };
}

function sessionParts(ctx, session) {
    return buildContextParts(session.entries, { substitute: substituter(ctx), ...(session.defs ?? promptDefs(ctx)) });
}

// (0.9.12) The currency the purse is counted in: RPG Battle's while it is here and on (money is
// one of its rules, so the two never disagree), else the reader's own; null when it is off.
function currencyNow(ctx = context(), suite = storySuite()) {
    try {
        const theirs = normalizeCurrency(suite?.api?.(RPG_BATTLE_ID)?.currency?.());
        if (theirs) return theirs;
    } catch {
        // An older RPG Battle shares no currency: Story Block's own is used.
    }
    const own = settings(ctx).currency;
    return own?.mode === 'off' ? null : normalizeCurrency(own);
}

// Whether Story Block keeps the items (alone, or as the reader's or Story Suite's choice): then
// the purse line is its to write, and RPG Battle leaves its own out.
function keepsItems(ctx = context(), suite = storySuite()) {
    return !deferredTo('items', settings(ctx).sourceOfTruth.items, suite);
}

/** The Inventory's "Purse in all: …" line for this reply, or '' (v0.9.12). */
function purseNote(def, state, ctx = context(), suite = storySuite()) {
    if (!blockAreas(def).includes('items') || !keepsItems(ctx, suite)) return '';
    try {
        return purseLine(state, currencyNow(ctx, suite));
    } catch {
        return '';
    }
}

/** Whether the next reply's Inventory section carries the purse line (for RPG Battle, v0.9.12). */
function printsPurse() {
    try {
        const ctx = context();
        const chat = ctx?.chat ?? [];
        return enabledBlocks(ctx).some(def => def.kind === 'stateful' && Boolean(purseNote(def, stateForGeneration(chat, def, 'normal'), ctx)));
    } catch {
        return false;
    }
}

// What a generation of `type` is prompted with: kept blocks, then the active blocks with their
// state, fresh dice and any runtime note.
function generationEntries(ctx, chat, type) {
    const suite = storySuite();
    const ownRolls = keepsOwnRolls(settings(ctx).sourceOfTruth.rolls, suite);
    // (0.9.5) With another extension keeping the timeline, the World State is asked for
    // without the threads, seeds, timers and arc phase it tracks.
    const keeper = timelineKeeper(settings(ctx).sourceOfTruth, suite);
    // (0.9.11) The reply that tells a fight RPG Battle resolved gets no dice block: with fresh
    // rolls in hand, a model fights the settled fight again.
    const narrating = fightNarrated(suite, type);
    const blocks = activeBlocks(enabledBlocks(ctx), chat, type).filter(def => !(narrating && def.display === 'dice'));
    return [...keptEntries(chat, type, { ownRolls }), ...blocks.map(def => {
        const state = def.kind === 'stateful' ? (generationSnapshot(chat, def, type) ?? archivedBlock(def.id))?.state ?? formatFor(def).empty(def) : null;
        const shown = timelineTrimmed(def, state, keeper, withoutSections);
        return {
            def: shown.def,
            state: shown.state,
            rolls: def.rolls?.count > 0 ? rollDice(def.rolls.count, def.rolls.sides) : null,
            // Chatter points at NPC State Delta's cards while it is here (v0.9.1); dice leave
            // fights to RPG Battle while it is here (v0.9.4); the Inventory says what the purse
            // holds in all (v0.9.12).
            note: chatterNote(def, suite) || diceNote(def, suite) || purseNote(def, shown.state, ctx, suite),
        };
    })];
}

/**
 * Story Suite's manage.tokens() (v0.9.1): what Story Block adds to the next ordinary reply, from
 * the entries and context section that reply would get (src/tokens.js). Never throws.
 */
function suiteTokens() {
    try {
        const ctx = context();
        if (!ctx) return { input: 0, output: 0, parts: [] };
        return contextTokens(generationEntries(ctx, ctx.chat ?? [], 'normal'), { substitute: substituter(ctx), ...promptDefs(ctx) });
    } catch (error) {
        console.warn('[Story Block] token estimate failed', error);
        return { input: 0, output: 0, parts: [] };
    }
}

/**
 * (0.9.18) Story Suite's manage.preview(): the context section the next ordinary reply would get,
 * as it would be sent ({{user}} and {{char}} filled in). Its dice are a fresh sample: the reply
 * rolls its own. Never throws.
 */
function suitePreview() {
    try {
        const ctx = context();
        if (!ctx || !hasActiveChat(ctx)) return [{ label: 'Story Blocks', text: '' }];
        // (0.9.21) In the two parts it is sent in: the instructions (the same every reply, so a
        // provider's prompt cache keeps them) and this reply's part (sent last).
        const parts = buildContextParts(generationEntries(ctx, ctx.chat ?? [], 'normal'), { substitute: substituter(ctx), ...promptDefs(ctx) });
        const list = [
            { label: 'Story Blocks: instructions (same every reply)', text: parts.static },
            { label: 'Story Blocks: this reply', text: parts.tail },
        ].filter(part => part.text);
        return list.length ? list : [{ label: 'Story Blocks', text: '' }];
    } catch (error) {
        console.warn('[Story Block] preview failed', error);
        return [{ label: 'Story Blocks', text: '' }];
    }
}

async function prepareGeneration(type = 'normal', _params = null, isDryRun = false) {
    const ctx = context();
    if (!ctx || !hasActiveChat(ctx)) return null;
    warnCoexistence();
    if (isBackgroundGeneration(type, isDryRun)) {
        // A quiet/impersonate generation started before the reply's own prompt is built (for
        // example from another extension's handler) builds its prompt first, and in text
        // completion that prompt carries the placeholder too. Count it so it is not mistaken
        // for the reply's prompt.
        const pendingSession = pending.get(chatIdOf(ctx));
        if (!isDryRun && pendingSession && !pendingSession.consumed) pendingSession.backgroundPrompts += 1;
        return null;
    }
    const chatId = chatIdOf(ctx);
    const chat = ctx.chat ?? [];
    await reconnectRegeneratedReply();
    if (context()?.chat !== chat || chatIdOf(context()) !== chatId) return null;
    // Dice are rolled here, once per generation: a swipe or regenerate rolls again, and the
    // placeholder and the real context carry the same numbers.
    const session = {
        chatId,
        type: normalizeType(type),
        entries: [],
        replacement: replacesLastReply(chat, type) ? { chat, index: chat.length - 1, prefix: chat.slice(0, -1),
            owners: replyOwners(chat.at(-1)), previewOwner: randomId() } : null,
        defs: promptDefs(ctx),
        contextInPrompt: typeof ctx.setExtensionPrompt === 'function',
        consumed: false,
        backgroundPrompts: 0,
        // Set when the generate interceptor runs, i.e. once this reply's own prompt is about
        // to be built; used only by the fallback when the placeholder never shows.
        armed: false,
        injected: false,
        promptsSeen: 0,
    };
    pending.set(chatId, session);
    session.entries = generationEntries(ctx, chat, type);
    const parts = session.entries.length ? sessionParts(ctx, session) : { static: '', tail: '' };
    setExtensionPlaceholder(ctx, session.contextInPrompt && (parts.static || parts.tail) ? { static: defuseMacros(parts.static), tail: defuseMacros(parts.tail) } : '');
    armSessionWatchdog(chatId);
    syncMountSuspension();
    return session;
}

// Session lifetime is owned by the watchdog, which knows whether a reply is still generating.
function selectPromptSession() {
    const activeId = chatIdOf(context());
    if (activeId && pending.has(activeId)) return pending.get(activeId);
    return pending.size === 1 ? [...pending.values()][0] : null;
}

async function onGenerationInterceptor(_chat, _contextSize, _abort, type = 'normal') {
    if (isBackgroundGeneration(type)) return;
    const ctx = context();
    if (!ctx || !hasActiveChat(ctx)) return;
    const chatId = chatIdOf(ctx);
    if (!pending.has(chatId)) await prepareGeneration(type);
    const session = pending.get(chatId);
    if (session) session.armed = true;
}

globalThis.storyBlockGenerationInterceptor = onGenerationInterceptor;

/**
 * Only the reply's own prompt receives block instructions; raw or quiet generations by
 * other extensions while the reply is pending are background prompts and stay untouched
 * (other extensions read block evidence such as <World_State> from what they send).
 * Returns 'marked', 'fallback' or null. Fallback, while the placeholder has never been
 * seen: prompts built after the generate interceptor ran get the context.
 */
function foregroundKind(session, eventData) {
    if (!session || session.consumed) return null;
    const marked = session.contextInPrompt && promptCarriesContext(eventData);
    const kind = marked ? 'marked' : (!session.contextInPrompt || (!contextMarkerSeen && session.armed)) ? 'fallback' : null;
    if (kind && session.backgroundPrompts > 0) {
        session.backgroundPrompts -= 1;
        return null;
    }
    return kind;
}

function onPromptReady(eventData = null) {
    if (eventData?.dryRun === true) return;
    const session = selectPromptSession();
    if (!session || session.consumed) return;
    session.promptsSeen += 1;
    const kind = foregroundKind(session, eventData);
    if (!kind) return;
    const ctx = context();
    const parts = session.entries.length ? sessionParts(ctx, session) : { static: '', tail: '' };
    // With no active block the prompt still loses old blocks from its history; the model
    // would otherwise keep writing them from example.
    const result = injectContext(eventData, parts, [...enabledBlocks(ctx), ...pluginBlocks.values()], { knownBlocks: historyBlocks(ctx) });
    if (result.injected) {
        session.injected = true;
        const names = session.entries.map(entry => entry.def.name).join(', ') || 'none active';
        reportStatus(`Last reply: block instructions sent (${names}; ${kind === 'marked' ? 'placeholder found' : 'fallback'}, ${Array.isArray(eventData?.chat) ? 'chat completion' : 'text completion'}).`);
    }
    if (result.injected && kind === 'marked') {
        contextMarkerSeen = true;
        session.consumed = true;
        // The context is needed for this one prompt; later quiet prompts must not inherit it.
        setExtensionPlaceholder(ctx, '');
    } else if (result.injected && !session.contextInPrompt) {
        session.consumed = true;
    } else if (!result.injected && !['unsupported-event', 'empty-context'].includes(result.reason)) {
        console.warn(`[Story Block] prompt injection skipped: ${result.reason}`);
    }
}

// Visible blocks in assistant history, so copies a preset embedded in user/system content
// can be told apart from blocks a person wrote there.
function historyBlocks(ctx) {
    const known = new Set();
    const defs = transportBlocks(ctx);
    for (const message of ctx?.chat ?? []) {
        if (isAssistant(message)) bareBlockTexts(message.mes, defs).forEach(block => known.add(block));
    }
    return known;
}

async function saveChat(ctx) {
    const staged = stageJournal(ctx);
    if (staged?.availability !== undefined && staged.availability !== 'available') throw new Error(staged.reason);
    if (staged) chatMetadata(ctx).storyBlockJournal = staged.journal;
    if (typeof ctx.saveChat === 'function') await ctx.saveChat();
    else ctx.saveMetadataDebounced?.();
}

function syncActiveSwipeText(message) {
    if (!message || !Array.isArray(message.swipes)) return;
    const swipe = Number.isInteger(message.swipe_id) ? message.swipe_id : 0;
    if (swipe >= 0 && swipe < message.swipes.length) message.swipes[swipe] = String(message.mes ?? '');
    if (message.swipe_info?.[swipe]) message.swipe_info[swipe].extra = structuredClone(message.extra ?? {});
}

// Identities and transactions belong to one swipe, not its message slot.
function messageIdentity(messageIndex) {
    const message = context()?.chat?.[Number(messageIndex)];
    const identity = message?.extra?.storyBlockIdentity;
    return identity?.swipe === (message?.swipe_id ?? 0) ? identity.id : null;
}

function ensureMessageIdentity(message, replaced = []) {
    const swipe = message.swipe_id ?? 0;
    const identity = message.extra?.storyBlockIdentity;
    if (identity?.swipe === swipe) {
        const replaces = [...new Set([...(identity.replaces ?? []), ...replaced])].filter(id => id !== identity.id);
        if (replaces.length === (identity.replaces?.length ?? 0)) return false;
        message.extra.storyBlockIdentity = { ...identity, replaces };
        return true;
    }
    const extra = { ...(message.extra ?? {}) };
    if (extra.storyBlockIdentity) {
        // The host may copy extras; the old swipe_info retains its own transactions.
        for (const receipt of Object.values(extra.storyBlockCommits ?? {})) {
            if (typeof receipt?.namespace === 'string') delete extra[receipt.namespace];
            for (const name of receipt?.extras ?? []) delete extra[name];
        }
        delete extra.storyBlockCommits;
    }
    const replaces = [...new Set([...replaced, ...(identity?.id ? [identity.id] : [])])];
    message.extra = { ...extra, storyBlockIdentity: { id: randomId(), swipe, ...(replaces.length ? { replaces } : {}) } };
    return true;
}

const JOURNAL_EXTRAS = ['storyDirectorQuest', 'storyDirectorState', 'rpgBattleEvidence', 'rpgBattleAwards', 'storyBlockReplacement'];
const chatMetadata = ctx => ctx?.chatMetadata ?? ctx?.chat_metadata ?? null;
let uncertainJournalRepair = null;

const replyOwners = message => [...new Set([message?.extra, ...(message?.swipe_info ?? []).map(info => info?.extra)]
    .map(extra => extra?.storyBlockIdentity?.id).filter(id => typeof id === 'string' && id))];

function replacementContext(ctx, index) {
    const replacement = pending.get(chatIdOf(ctx))?.replacement;
    return replacement?.chat === ctx.chat && replacement.index === index && ctx.chat.length <= index + 1
        && replacement.prefix.every((message, at) => ctx.chat[at] === message) ? replacement : null;
}

function stageJournal(ctx = context(), overrideIndex = -1, override = null, preview = false) {
    const meta = chatMetadata(ctx);
    if (!meta) return null;
    if (uncertainJournalRepair?.chat === ctx.chat && uncertainJournalRepair.chatId === chatIdOf(ctx)) {
        return { availability: 'incomplete', reason: 'Journal reconnection could not be verified. Reload the page before retrying.' };
    }
    const defs = transportBlocks(ctx).filter(def => def.kind === 'stateful');
    const frames = [];
    (ctx.chat ?? []).forEach((stored, index) => {
        const message = index === overrideIndex ? override : stored;
        const identity = message?.extra?.storyBlockIdentity;
        if (message?.is_user || !identity?.id || identity.swipe !== (message.swipe_id ?? 0)) return;
        const extra = Object.fromEntries(JOURNAL_EXTRAS.filter(name => message.extra[name] !== undefined).map(name => [name, message.extra[name]]));
        const blocks = {};
        for (const def of defs) {
            const own = blockInText(message.mes, def);
            const baseline = !frames.length && !meta.storyBlockJournal ? blockSnapshot(ctx.chat, def, { beforeIndex: index + 1 }) : null;
            if (own || baseline) blocks[def.tag] = (own ?? baseline).text;
        }
        frames.push({ owner: identity.id, index, blocks, extra,
            replaces: [...new Set([...(identity.replaces ?? []), ...replyOwners(message).filter(id => id !== identity.id)])],
            signature: journalKey(message.mes) + ':' + journalKey(JSON.stringify(extra)) });
    });
    // A read during generation may need the archived parents of the removed reply.
    // This placeholder is never saved; receive attaches the actual replacement link.
    const replacement = pending.get(chatIdOf(ctx))?.replacement;
    if (preview && replacementContext(ctx, replacement?.index) && !frames.some(frame => frame.index === replacement.index)) {
        frames.push({ owner: replacement.previewOwner, index: replacement.index, signature: 'pending', replaces: replacement.owners });
    }
    return journalState(meta.storyBlockJournal, frames, { scope: chatIdOf(ctx) });
}

function journal() {
    const state = stageJournal(context(), -1, null, true);
    if (!state) return { availability: 'unavailable', reason: 'Chat metadata is unavailable.', entries: [], prefix: [] };
    const { journal: _saved, ...view } = state;
    return view;
}

// Older releases could lose the sole journal root during Regenerate. Reconnect
// only at its original position, without adopting archived ancestry or known descendants.
function regeneratedReplyRecovery() {
    const ctx = context(), saved = chatMetadata(ctx)?.storyBlockJournal;
    const head = saved?.nodes?.[saved.head];
    const index = (ctx?.chat ?? []).findIndex((message, at) => !message.is_user && messageIdentity(at));
    const owner = messageIdentity(index);
    if (!owner || !head || head.parent || saved.scope !== chatIdOf(ctx) || head.position !== index
        || pending.has(chatIdOf(ctx)) || blockCommits.has(chatIdOf(ctx))) return null;
    const known = new Set(Object.values(saved.nodes).map(node => node.owner));
    if (ctx.chat.some((_message, at) => known.has(messageIdentity(at)))) return null;
    const view = journal();
    if (view.availability !== 'incomplete' || view.reason !== 'No retained reply matches the saved quest history.') return null;
    return { chatId: chatIdOf(ctx), messageIndex: index, owner, replacedOwner: head.owner, head: saved.head };
}

async function recoverRegeneratedReply(expected) {
    const plan = regeneratedReplyRecovery();
    if (!plan || JSON.stringify(plan) !== JSON.stringify(expected)) return { status: 'failed', reason: 'The recovery target changed. Reload before retrying.' };
    const ctx = context(), chat = ctx.chat, message = chat[plan.messageIndex];
    const result = await commitBlocks({ id: `replacement:${plan.owner}:${plan.head}`, chatId: plan.chatId, messageIndex: plan.messageIndex,
        expectedText: message.mes, expectedExtra: JSON.stringify(message.extra ?? {}),
        namespace: 'storyBlockReplacement', value: plan }, plan.replacedOwner);
    if (result.status === 'uncertain') uncertainJournalRepair = { chatId: plan.chatId, chat };
    return result;
}

async function reconnectRegeneratedReply() {
    const ctx = context(), chat = ctx?.chat, plan = regeneratedReplyRecovery();
    if (!plan) return false;
    replyCallbacks++;
    try {
        const result = await recoverRegeneratedReply(plan);
        if (result.status !== 'durable') {
            uncertainJournalRepair = { chatId: plan.chatId, chat };
            throw new Error(`Reply reconnection was not verified: ${result.reason}. Reload before retrying.`);
        }
        // The failed receive never reached plugins. Resume only the latest reply,
        // including its injected quest choices, after the repaired header is verified.
        if (context()?.chat === chat && chatIdOf(context()) === plan.chatId) await receiveMessage(latestAssistantIndex(chat));
        return true;
    } finally { replyCallbacks--; refreshAll(0); }
}

function archivedBlock(tagOrId) {
    const def = findBlockDef(transportBlocks(), tagOrId);
    const history = journal();
    const text = history.availability === 'available' ? history.prefix.at(-1)?.blocks[def?.tag] : null;
    if (text == null || !def) return null;
    const found = blockInText(upsertBlock('', def, text), def);
    return found ? { ...found, messageIndex: -1 } : null;
}

function archivedState(def) {
    const saved = archivedBlock(def.id);
    return saved ? { state: saved.state, body: formatFor(def).serialize(saved.state, def) } : null;
}

// No MESSAGE_UPDATED is emitted here: built-in Translate re-translates (and, with auto mode
// off, discards a manual translation) and Summarize reacts to it. On receive, SillyTavern's
// CHARACTER_MESSAGE_RENDERED follows anyway; on edit, SillyTavern renders the normalized
// text itself and emits MESSAGE_UPDATED once.
async function persistMessageEdit(ctx, messageId, message, { rerender = true, save = true } = {}) {
    syncActiveSwipeText(message);
    if (rerender && document.querySelector(`#chat .mes[mesid="${Number(messageId)}"]`)) {
        ctx.updateMessageBlock?.(messageId, message);
    }
    if (save) await saveChat(ctx);
}

async function normalizeMessageTransport(messageId, { rerender = true, save = true } = {}) {
    const ctx = context();
    const id = Number(messageId);
    if (!ctx || !Number.isInteger(id) || normalizingMessages.has(id)) return false;
    const message = ctx.chat?.[id];
    if (!isAssistant(message)) return false;
    const rejoined = rejoinContinuation(message.mes);
    const defs = transportBlocks(ctx);
    const normalized = normalizeTransport(rejoined, defs);
    // Several tags of a repeating block become one, after they are inside the envelope. A
    // kept block the model (or a raw edit) wrote is dropped: only its extension writes it.
    let folded = dropForeignCopies(defs.reduce((text, def) => mergeRepeats(text, def), normalized.text), defs);
    // (0.9.16) A changes-only block's changes applied to the state before this reply: the reply
    // carries the whole block from here on, as if the model had written it.
    const changes = applyReplyChanges(folded, blocks(ctx), ctx.chat, id);
    folded = changes.text;
    const failed = changes.results.flatMap(result => result.failed.map(item => `${result.def.name}: "${item.line}" (${item.why})`));
    if (failed.length) notify('warning', `Some changes could not be applied: ${failed.join('; ')}.`);
    if (folded === message.mes) return false;
    normalized.text = folded;

    normalizingMessages.add(id);
    try {
        message.mes = normalized.text;
        await persistMessageEdit(ctx, id, message, { rerender, save });
        return true;
    } finally {
        normalizingMessages.delete(id);
    }
}

function describeMissing(problems) {
    return problems.map(({ def, status, error }) => {
        if (status === 'invalid') return `${def.name} couldn't be read (${error})`;
        if (status === 'truncated') return `${def.name} was cut off`;
        return `${def.name} was missing`;
    }).join('; ');
}

async function onMessageReceived(messageId) {
    replyCallbacks++;
    try { await receiveMessage(messageId); }
    catch (error) { notify('warning', `Reply state needs recovery: ${error.message}`); throw error; }
    finally { replyCallbacks--; refreshAll(0); }
}

async function receiveMessage(messageId) {
    const ctx = context();
    const id = Number(messageId);
    if (!ctx || !Number.isInteger(id)) return;
    const message = ctx.chat?.[id];
    if (!isAssistant(message)) return;

    const chatId = chatIdOf(ctx);
    const session = chatId ? pending.get(chatId) : null;

    // Keep the blocks in the raw message, but hide their transport from the narration.
    // (0.9.19) The chat is saved once, below, for this and the edits after it.
    const identified = ensureMessageIdentity(message, replacementContext(ctx, id)?.owners ?? []);
    let dirty = await normalizeMessageTransport(id, { rerender: true, save: false }) || identified;

    // Record the dice that were handed over on the block itself, so this message (and this
    // swipe) can be checked against them later. After normalizing: moving a bare block into
    // the envelope rebuilds its tag, which would drop the stamp.
    let stamped = false;
    for (const entry of session?.entries ?? []) {
        if (!entry.rolls?.length) continue;
        const next = stampRolls(message.mes, entry.def, entry.rolls);
        if (next !== message.mes) {
            message.mes = next;
            stamped = true;
        }
    }
    // The stamp sits inside the hidden envelope: nothing visible changed, so no re-render.
    if (stamped) {
        await persistMessageEdit(ctx, id, message, { rerender: false, save: false });
        dirty = true;
    }

    if (session?.entries.length) {
        const problems = session.entries
            .map(({ def }) => ({ def, ...blockStatusInText(message.mes, def) }))
            // An optional block may simply not have been needed this reply; a kept block is
            // never the model's to write.
            .filter(item => !item.def.kept)
            // (0.9.16) A changes-only block left out had nothing to change: its state carries on.
            .filter(item => !(changesOnly(item.def) && item.status === 'missing'))
            .filter(item => item.status !== 'valid' && !(item.def.optional && item.status === 'missing'));
        if (problems.length) {
            const kept = problems.some(item => item.def.kind === 'stateful') ? ' The last valid state of each stateful block stays current.' : '';
            notify('warning', `${describeMissing(problems)}.${kept}`);
        }
    }
    // (0.9.17) Every reply holds the whole state: a block it did not write (nothing changed,
    // or the model left it out) is carried into it as it stood, so no reply depends on older ones.
    const carried = carryStates(message.mes, transportBlocks(ctx), ctx.chat, id, archivedState);
    if (carried !== message.mes) {
        message.mes = carried;
        await persistMessageEdit(ctx, id, message, { rerender: false, save: false });
        dirty = true;
    }
    // Generation is over even when its bookkeeping needs repair. Holding the
    // session here would prevent the verified recovery transaction itself.
    clearSession(chatId);
    const recovery = regeneratedReplyRecovery();
    if (recovery) {
        const result = await recoverRegeneratedReply(recovery);
        if (result.status !== 'durable') throw new Error(`Reply reconnection was not verified: ${result.reason}`);
    }
    if (dirty || chatMetadata(ctx)) {
        syncActiveSwipeText(message);
        await saveChat(ctx);
    }
    if (context()?.chat !== ctx.chat || chatIdOf(context()) !== chatId) return;
    refreshAll(0);
    // The Overview's token estimates follow the new reply (nothing is polled).
    refreshSuiteOverlay();
    await replyListeners.emitAsync({ chatId, messageIndex: id });
}

function onGenerationEnded() {
    const chatId = chatIdOf(context());
    if (chatId && pending.has(chatId)) scheduleSessionCleanup(chatId, 2500);
    setTimeout(() => {
        syncMountSuspension();
        refreshAll(0);
    }, 50);
}

function onGenerationStopped() {
    clearSession(chatIdOf(context()));
    refreshAll(0);
}

async function saveBlockBody(def, body, expectedChatId) {
    const ctx = context();
    if (!ctx || chatIdOf(ctx) !== expectedChatId) throw new Error('The active chat changed while the editor was open. Nothing was saved.');
    if (pending.has(expectedChatId)) throw new Error('Finish the current generation before editing blocks.');
    const target = latestAssistantIndex(ctx.chat);
    if (target < 0) throw new Error('No assistant message exists yet. Generate or open a greeting first.');
    const message = ctx.chat[target];
    message.mes = upsertBlock(message.mes, def, body);
    // The envelope is hidden machine state. Re-rendering the whole message would destroy DOM
    // owned by other extensions although no visible narration changed: persist the raw
    // message/swipe only, then refresh the card.
    await persistMessageEdit(ctx, target, message, { rerender: false });
    refreshAll(0);
}

/**
 * Plugin API: replace a block's text in one assistant message (hidden; nothing re-renders).
 * A kept block's text is plain text, stored as written (escaped for the envelope) once its
 * own format reads it: a copy nothing can read would be silently ignored, so it is refused.
 */
async function setBlockText(messageIndex, tagOrId, text) {
    const ctx = context();
    if (!ctx || !hasActiveChat(ctx)) throw new Error('No chat is open.');
    if (pending.has(chatIdOf(ctx))) throw new Error('A reply is still generating.');
    const def = findBlockDef(transportBlocks(ctx), tagOrId);
    if (!def) throw new Error(`No block with the tag or id "${tagOrId}".`);
    const id = Number(messageIndex);
    const message = ctx.chat?.[id];
    if (!isAssistant(message)) throw new Error(`Message #${messageIndex} is not an assistant reply.`);
    const next = upsertBlock(message.mes, def, blockBody(def, text));
    if (next === message.mes) return false;
    const staged = stageJournal(ctx, id, { ...message, mes: next });
    if (staged && staged.availability !== 'available') throw new Error(staged.reason);
    message.mes = next;
    await persistMessageEdit(ctx, id, message, { rerender: false });
    refreshAll(0);
    return true;
}

function blockBody(def, text) {
    let body = String(text ?? '');
    if (def.kept) {
        body = escapeBody(body.replace(/\r\n?/g, '\n').trim(), def.tag);
        const parsed = formatFor(def).parse(body, def);
        if (!parsed.ok) throw new Error(`${def.name} could not be read: ${parsed.error}`);
    }
    return body;
}

// saveChat can swallow errors: verify persisted state in the captured chat.
async function savedMessages(ctx, chatId) {
    if (typeof ctx.getRequestHeaders !== 'function') throw new Error('Chat readback is unavailable.');
    const character = ctx.characters?.[ctx.characterId];
    const group = Boolean(ctx.groupId);
    if (!group && !character?.avatar) throw new Error('The chat character is unavailable.');
    const response = await fetch(group ? '/api/chats/group/get' : '/api/chats/get', {
        method: 'POST', headers: ctx.getRequestHeaders(), cache: 'no-store',
        body: JSON.stringify(group ? { id: chatId } : { avatar_url: character.avatar, file_name: chatId }),
    });
    if (!response.ok) throw new Error('Saved chat could not be read.');
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error('Saved chat could not be verified.');
    return { messages: data.filter(entry => typeof entry?.mes === 'string'), metadata: data.find(entry => entry?.chat_metadata)?.chat_metadata };
}

const blockCommits = new Set();

// Transaction v1: validate the base, save blocks/extras once, then verify readback.
async function commitBlocks({ id, chatId, messageIndex, expectedText, expectedExtra, changes = [], namespace, value, extras = {} }, replacement = null) {
    const ctx = context();
    if (!ctx || !chatId || chatIdOf(ctx) !== chatId || blockCommits.has(chatId)) return { status: 'failed', reason: 'Chat changed or a save is in progress.' };
    if (pending.has(chatId) || typeof ctx.saveChat !== 'function') return { status: 'failed', reason: 'A reply is generating or saving is unavailable.' };
    const message = ctx.chat?.[messageIndex];
    if (!id || !isAssistant(message) || !/^[a-z][a-zA-Z0-9]+$/.test(namespace ?? '')) return { status: 'failed', reason: 'Invalid transaction.' };
    if (Object.keys(extras).some(name => !/^[a-z][a-zA-Z0-9]+$/.test(name) || ['storyBlockIdentity', 'storyBlockCommits'].includes(name))) return { status: 'failed', reason: 'Invalid transaction extras.' };
    if (message.mes !== expectedText || (expectedExtra !== undefined && JSON.stringify(message.extra ?? {}) !== expectedExtra)) return { status: 'failed', reason: 'The reply changed; refresh before retrying.' };
    const before = structuredClone(message);
    const candidate = structuredClone(message);
    const meta = chatMetadata(ctx);
    const beforeJournal = meta?.storyBlockJournal;
    let candidateJournal = beforeJournal;
    const oldReceipt = message.extra?.storyBlockCommits?.[id];
    blockCommits.add(chatId);
    let applied = false;
    try {
        if (!oldReceipt) {
            for (const change of changes) {
                const def = findBlockDef(transportBlocks(ctx), change.tag);
                if (!def) throw new Error(`Unknown block: ${change.tag}`);
                candidate.mes = upsertBlock(candidate.mes, def, blockBody(def, change.text));
            }
            ensureMessageIdentity(candidate, replacement ? [replacement] : []);
            candidate.extra = {
                ...candidate.extra, ...structuredClone(extras), [namespace]: structuredClone(value),
                storyBlockCommits: { ...(candidate.extra?.storyBlockCommits ?? {}), [id]: { namespace, ...(Object.keys(extras).length ? { extras: Object.keys(extras) } : {}) } },
            };
            syncActiveSwipeText(candidate);
            const staged = stageJournal(ctx, messageIndex, candidate);
            if (staged && staged.availability !== 'available') throw new Error(staged.reason);
            candidateJournal = staged?.journal;
            Object.assign(message, structuredClone(candidate));
            if (meta && candidateJournal) meta.storyBlockJournal = candidateJournal;
        }
        applied = true;
        if (!oldReceipt) {
            try { await ctx.saveChat(); } catch { /* Readback distinguishes a lost response from a failed write. */ }
        }
        const stored = await savedMessages(ctx, chatId);
        const saved = stored.messages[messageIndex];
        const confirmed = saved?.mes === candidate.mes
            && saved?.extra?.storyBlockCommits?.[id]?.namespace === namespace
            && JSON.stringify(saved?.extra?.[namespace]) === JSON.stringify(candidate.extra[namespace])
            && Object.keys(extras).every(name => JSON.stringify(saved?.extra?.[name]) === JSON.stringify(candidate.extra[name]))
            && (!candidateJournal || JSON.stringify(stored.metadata?.storyBlockJournal) === JSON.stringify(candidateJournal));
        if (confirmed) {
            if (chatIdOf(context()) === chatId) refreshAll(0);
            return { status: 'durable', id, owner: candidate.extra.storyBlockIdentity.id };
        }
        const unchanged = saved?.mes === before.mes && JSON.stringify(saved?.extra ?? {}) === JSON.stringify(before.extra ?? {})
            && (!candidateJournal || JSON.stringify(stored.metadata?.storyBlockJournal) === JSON.stringify(beforeJournal));
        if (unchanged && JSON.stringify(message) === JSON.stringify(candidate)
            && (!meta || JSON.stringify(meta.storyBlockJournal) === JSON.stringify(candidateJournal))) {
            for (const key of Object.keys(message)) delete message[key];
            Object.assign(message, before);
            if (meta) {
                if (beforeJournal) meta.storyBlockJournal = beforeJournal;
                else delete meta.storyBlockJournal;
            }
            return { status: 'failed', reason: 'The transaction was not saved.' };
        }
        return { status: 'uncertain', reason: 'Saved state differs; reload and reconcile before retrying.' };
    } catch (error) {
        return { status: applied ? 'uncertain' : 'failed', reason: error.message };
    } finally {
        blockCommits.delete(chatId);
    }
}

async function editBlock(def) {
    const ctx = context();
    if (!ctx || !hasActiveChat(ctx)) return notify('warning', 'Open a chat before editing blocks.');
    const expectedChatId = chatIdOf(ctx);
    const view = blockView(ctx.chat ?? [], def);
    const format = formatFor(def);
    const body = view?.body || format.serialize(view?.state ?? format.empty(def), def);
    try {
        const saved = await openBodyEditor(ctx, def, body, { onSave: next => saveBlockBody(def, next, expectedChatId) });
        if (saved) notify('success', `${def.name} saved into the chat.`);
    } catch (error) {
        notify('error', error instanceof Error ? error.message : String(error));
    }
}

// (0.9.18) A list the reader writes into, as the latest reply left it: its finds can be left behind.
function leavable(def, view) {
    if (def.kept || def.format !== 'rows' || def.kind !== 'stateful' || view.fromEarlierReply) return false;
    return view.messageIndex >= 0 && view.messageIndex === latestAssistantIndex(context()?.chat ?? []);
}

/** Leave a find behind: the gain comes out of that reply's copy, so a swipe or delete still rolls back. */
async function leaveGain(def, messageIndex, gain) {
    try {
        const message = context()?.chat?.[messageIndex];
        const found = message ? latestBlockInText(message.mes, def) : null;
        if (!found) return;
        const result = applyChanges(found.body, leaveLine(gain), def);
        if (!result.applied.length) return notify('warning', `${gain.name} could not be found in this reply's ${def.name}.`);
        await setBlockText(messageIndex, def.id, result.body);
        notify('info', `${gain.name} left behind.`);
    } catch (error) {
        notify('error', error instanceof Error ? error.message : String(error));
    }
}

function latestAssistantElement(ctx) {
    const elements = [...document.querySelectorAll('#chat .mes')].reverse();
    return elements.find(element => {
        const id = Number.parseInt(element.getAttribute('mesid') ?? '', 10);
        return Number.isInteger(id) && isAssistant(ctx?.chat?.[id]);
    }) ?? null;
}

// Rail labels are small: the block's short label, else (0.9.18) its built-in template's (a
// block saved before short labels: "Items", not "Invento…"), else a short name, else its first word.
function shortName(def) {
    if (def.short) return def.short;
    const template = def.template ? TEMPLATES.find(entry => entry.id === def.template || entry.template === def.template) : null;
    if (template?.short && template.name === def.name) return template.short;
    return shortLabel(def.name);
}

// A label of ten letters or fewer as it is, a longer one by its first word ("Present NPCs" → "Present").
function shortLabel(name) {
    const text = String(name ?? '');
    return text.length <= 10 ? text : text.split(/\s+/)[0].replace(/[^\p{L}\p{N}]+$/u, '').slice(0, 10);
}

function blockTab(view, uiKey) {
    const { def } = view;
    const display = DISPLAYS[def.display] ?? renderPlain;
    const own = settings();
    const hideOffscreen = own.hideOffscreen;
    // "RPG Battle owns stats" on a Character Sheet while another extension owns them; the
    // sheet is drawn as always and the reader decides whether to keep it.
    const deferNote = statsNotice(def, own.sourceOfTruth, storySuite());
    let animate = false;
    if (def.display === 'dice' && view.state) {
        const message = context()?.chat?.[view.messageIndex];
        const key = `${uiKey}:${def.id}:${view.messageIndex}:${message?.swipe_id ?? 0}:${view.body}`;
        animate = !animatedRolls.has(key);
        animatedRolls.add(key);
    }
    return {
        id: `block:${def.id}`,
        label: def.name,
        short: shortName(def),
        icon: def.icon,
        badge: turnCount(view),
        // The off-screen switch changes how a scene board draws, so a flip must redraw it; so
        // does an owner arriving or leaving.
        key: `${viewKey(view)}|${hideOffscreen ? 1 : 0}|${deferNote}`,
        render: pane => display(pane, {
            def: deferNote ? { ...def, deferNote } : def,
            state: view.state,
            previousState: view.previousState,
            changes: view.changes,
            changesFromEarlierReply: view.fromEarlierReply,
            error: view.error,
            truncated: view.truncated,
            rolls: view.rolls ?? null,
            animate,
            // Only its extension writes a kept block; the frame says whose it is instead.
            onEdit: def.kept ? null : () => void editBlock(def),
            // (0.9.18) The latest reply's finds, each the reader's to leave behind.
            onLeave: leavable(def, view) ? gain => void leaveGain(def, view.messageIndex, gain) : null,
            uiKey: `${uiKey}:${def.id}`,
            hideOffscreen,
        }),
    };
}

// (0.9.20) Whose a tab is, so each extension's tabs sit together in the row: what it
// registered as `group`, else the suite's own extensions by their tab ids, else the id's
// first word.
const KNOWN_TAB_OWNERS = [['rpg-', 'RPG Battle'], ['story-director', 'Story Director'], ['npc-state-delta', 'NPC State Delta']];
function tabGroup(tab) {
    const given = String(tab?.group ?? '').trim();
    if (given) return given;
    const id = String(tab?.id ?? '');
    const known = KNOWN_TAB_OWNERS.find(([prefix]) => id.startsWith(prefix));
    if (known) return known[1];
    const word = id.split(/[-_:]/)[0] || id;
    return word.charAt(0).toUpperCase() + word.slice(1);
}

function buildCardTabs() {
    const ctx = context();
    if (!ctx || !hasActiveChat(ctx)) return null;
    const own = settings(ctx);
    const messageElement = latestAssistantElement(ctx);
    // The card needs a message to sit under; the sidebar does not.
    if (!messageElement && own.display === 'card') return null;
    const latestIndex = latestAssistantIndex(ctx.chat ?? []);
    const messageId = messageElement ? Number.parseInt(messageElement.getAttribute('mesid') ?? '', 10) : latestIndex;
    const message = ctx.chat?.[messageId];
    const uiKey = String(chatIdOf(ctx) ?? 'default');
    const tabs = [];
    const views = [];
    // A block without a tab (the reader's "Show tab" off, a kept block registered with
    // `tab: false`, chatter while NPC State Delta shows it on its cards) is still prompted and
    // kept; it only has no tab, badge or strip line here.
    const shownElsewhere = displaysShownElsewhere(storySuite());
    for (const def of [...enabledBlocks(ctx), ...keptBlocks()]) {
        if (!hasTab(def, { shownElsewhere })) continue;
        const view = tabView(ctx.chat ?? [], def, { sidebar: own.display === 'sidebar' });
        // (0.9.18) An empty block keeps its tab unless the reader hides empty tabs.
        if (!view || (view.empty && own.hideEmptyTabs)) continue;
        // (0.9.20) A kept block's tab sits with its extension's.
        const tab = { ...blockTab(view, uiKey), group: def.kept ? String(def.owner ?? '') : '' };
        tabs.push(tab);
        views.push({ view, tabId: tab.id });
    }
    for (const tab of externalTabs.list()) {
        try {
            if (typeof tab.isAvailable === 'function' && !tab.isAvailable({ messageId, message })) continue;
            tabs.push({
                id: `ext:${tab.id}`,
                label: tab.label,
                short: tab.short || shortLabel(tab.label),
                icon: tab.icon,
                group: tabGroup(tab),
                order: tab.order,
                // A plugin may say when its pane is unchanged (key) and what to count (badge).
                key: typeof tab.key === 'function' ? String(tab.key({ messageId, message }) ?? '') : undefined,
                badge: typeof tab.badge === 'function' ? Number(tab.badge({ messageId, message })) || 0 : undefined,
                render: pane => tab.render(pane, { messageId, message }),
            });
        } catch (error) {
            console.warn(`[Story Block] tab "${tab.id}" failed`, error);
        }
    }
    return {
        display: own.display,
        messageElement,
        tabs,
        uiKey,
        meta: latestIndex >= 0 ? `reply #${latestIndex}` : '',
        pinned: own.sidebarPinned,
        onPinnedChange: value => {
            settings().sidebarPinned = Boolean(value);
            saveSettings();
            refreshAll(0);
        },
        strip: own.showTurnStrip ? turnItems(views) : null,
        compatMarkup: own.compatMarkup,
        // The header's gear opens Story Suite while two or more of the suite are installed.
        showSuite: suiteOffered(),
        onSuite: opener => void openSuite('overview', opener),
    };
}

async function rescan() {
    const ctx = context();
    if (!ctx || !hasActiveChat(ctx)) return notify('warning', 'Open a chat before rescanning.');
    const chatId = chatIdOf(ctx);
    if (pending.has(chatId)) {
        if (generationRunning()) return notify('info', 'A response is still generating. The card refreshes when it finishes.');
        clearSession(chatId);
    }
    let hidden = 0;
    try {
        for (let id = 0; id < (ctx.chat?.length ?? 0); id++) {
            if (await normalizeMessageTransport(id, { rerender: true, save: false })) hidden++;
        }
        if (hidden) await saveChat(ctx);
    } catch (error) {
        notify('error', `Rescan could not update chat messages: ${error instanceof Error ? error.message : String(error)}`);
    }
    refreshAll(0);
    const lines = enabledBlocks(ctx).map(def => {
        const view = blockView(ctx.chat ?? [], def);
        if (!view) return `${def.name}: nothing yet`;
        const where = view.messageIndex >= 0 ? `message #${view.messageIndex}` : 'none';
        return `${def.name}: ${where}${view.error ? ' (latest copy unreadable)' : ''}${view.truncated ? ' (latest copy cut off)' : ''}`;
    });
    if (hidden) lines.unshift(`Hid raw blocks in ${hidden} ${hidden === 1 ? 'message' : 'messages'}.`);
    notify('info', lines.join(' · ') || 'No blocks are enabled.');
}

// Rough token cost of one block per reply: its prompt section plus what the model writes back.
function estimateTokens(def) {
    const ctx = context();
    const block = normalizeBlock(def);
    const shown = timelineTrimmed(block, block.kind === 'stateful' ? stateForGeneration(ctx?.chat ?? [], block) : null, timelineKeeper(settings(ctx).sourceOfTruth, storySuite()), withoutSections);
    const state = shown.state;
    const section = buildContext([{ def: shown.def, state }], { substitute: substituter(ctx) });
    const written = state ? formatFor(block).serialize(state, block).length : 200;
    return Math.round((section.length + written) / 3.5);
}

function onBlocksChanged(next) {
    const ctx = context();
    settings(ctx).blocks = normalizeBlocks(next);
    saveSettings(ctx);
    announceToSuite(ctx);
    setFoldHint('blocks', blocksHint());
    refreshAll(0);
}

// The "New built-in blocks" line offers each template once: added or dismissed, it is remembered.
function dismissTemplate(key) {
    const ctx = context();
    const own = settings(ctx);
    if (own.dismissedTemplates.includes(key)) return;
    own.dismissedTemplates = [...own.dismissedTemplates, key];
    saveSettings(ctx);
}

function addSettingsPanel(documentRef) {
    if (documentRef.querySelector('#story_block_settings')) return true;
    const host = documentRef.querySelector('#extensions_settings') ?? documentRef.querySelector('#extensions_settings2');
    if (!host) return false;
    const wrapper = documentRef.createElement('div');
    wrapper.id = 'story_block_settings';
    host.appendChild(wrapper);
    const panel = renderSettings(wrapper, {
        blocks: blocks(),
        templates: TEMPLATES,
        onChange: onBlocksChanged,
        estimateTokens,
        dismissedTemplates: settings().dismissedTemplates,
        onDismissTemplate: dismissTemplate,
    });
    addRuntimeControls(documentRef, panel?.root ?? wrapper);
    return true;
}

// The settings panel's sections fold, so it is not one long column. Which are open is the
// reader's own convenience, remembered in this browser only; Blocks starts open.
const FOLDS_STORAGE = 'story_block_settings_folds';
const FOLDS_OPEN = { display: false, money: false, suite: false, blocks: true, sent: false };

function foldsOpen() {
    try {
        const saved = JSON.parse(globalThis.localStorage?.getItem(FOLDS_STORAGE) ?? 'null');
        return { ...FOLDS_OPEN, ...(saved && typeof saved === 'object' ? saved : {}) };
    } catch {
        return { ...FOLDS_OPEN };
    }
}

function rememberFold(key, open) {
    try { globalThis.localStorage?.setItem(FOLDS_STORAGE, JSON.stringify({ ...foldsOpen(), [key]: open })); } catch { /* private window */ }
}

// The suite's shared panel markup (src/suite.css, docs/STORY_SUITE.md "One look for the four
// settings panels"): details > summary (<b> title, <small> hint) + a body.
function settingsFold(documentRef, key, title, children) {
    const fold = documentRef.createElement('details');
    fold.className = `story-suite-fold is-${key}`;
    fold.dataset.fold = key;
    fold.open = foldsOpen()[key];
    const summary = documentRef.createElement('summary');
    const name = documentRef.createElement('b');
    name.className = 'story-suite-fold-title';
    name.textContent = title;
    const hint = documentRef.createElement('small');
    hint.className = 'story-suite-fold-hint';
    summary.append(name, hint);
    const body = documentRef.createElement('div');
    body.className = 'story-suite-fold-body';
    body.append(...children);
    fold.append(summary, body);
    fold.addEventListener('toggle', () => rememberFold(key, Boolean(fold.open)));
    foldHints[key] = hint;
    return fold;
}

function setFoldHint(key, text) {
    if (foldHints[key] && foldHints[key].textContent !== text) foldHints[key].textContent = text;
}

// "3 of 5 on", for the Blocks fold.
function blocksHint() {
    const list = blocks();
    return `${list.filter(block => block.enabled).length} of ${list.length} on`;
}

// (0.9.12) The Money fold's hint: the coins the purse is counted in, and whose they are.
function moneyHint() {
    let theirs = null;
    try {
        theirs = normalizeCurrency(storySuite()?.api?.(RPG_BATTLE_ID)?.currency?.());
    } catch {
        theirs = null;
    }
    if (theirs) return 'RPG Battle\'s currency';
    const own = settings().currency;
    if (own?.mode === 'off') return 'Off';
    return own?.mode === 'single' ? `One coin: ${own.single}` : tiersText(own).replace(/=\d+/g, '').replace(/, /g, ' / ');
}

// One row: which money, and its words (the coin's name, or names with rates).
function moneyRow(documentRef) {
    const row = documentRef.createElement('div');
    row.className = 'story-block-money';
    row.innerHTML = `
        <label class="story-suite-row" for="story_block_money">
            <span><b>Purse total</b><small>The Inventory's money rows ("Coin Pouch | 1 | 1 Gold, 35 Silver") are added up and the story is told the sum, so it never lets anyone pay more. With RPG Battle on, its currency is used instead.</small></span>
            <select id="story_block_money" class="text_pole">
                <option value="tiers">Coins with rates</option>
                <option value="single">One coin</option>
                <option value="off">Off</option>
            </select>
        </label>
        <label class="story-suite-row" for="story_block_money_words">
            <span><b>Coins</b><small>Smallest first, each rate counting the one before: copper=1, silver=10, gold=10. For one coin, just its name.</small></span>
            <input id="story_block_money_words" type="text" class="text_pole">
        </label>`;
    const mode = row.querySelector('#story_block_money');
    const words = row.querySelector('#story_block_money_words');
    const read = () => {
        const own = settings().currency;
        if (mode) mode.value = own?.mode === 'off' ? 'off' : own?.mode === 'single' ? 'single' : 'tiers';
        if (words) {
            words.value = own?.mode === 'single' ? own.single : own?.mode === 'off' ? '' : tiersText(own);
            words.disabled = own?.mode === 'off';
            words.placeholder = own?.mode === 'single' ? 'coins' : 'copper=1, silver=10, gold=10';
        }
    };
    const write = () => {
        const chosen = mode?.value;
        const text = String(words?.value ?? '').trim();
        if (chosen === 'off') settings().currency = { mode: 'off' };
        else if (chosen === 'single') settings().currency = { mode: 'single', tiers: [], single: text && !text.includes('=') ? text : 'coins' };
        else settings().currency = parseTiersText(text) ?? structuredClone(DEFAULT_CURRENCY);
        saveSettings();
        read();
        setFoldHint('money', moneyHint());
    };
    mode?.addEventListener('change', write);
    words?.addEventListener('change', write);
    read();
    return row;
}

function displayHint() {
    const own = settings();
    return own.display === 'card' ? 'Card under the reply' : `Sidebar${own.showTurnStrip ? ' · strip on' : ''}`;
}

// The panel in the suite's shared look: the Manage all line, a quickbar (Rescan, the editor's
// status line, the version), then the folds Display, Source of truth and Blocks (the editor's
// own view, which it redraws in place). Built once; the editor re-renders only its list.
function addRuntimeControls(documentRef, root) {
    const content = root.querySelector?.('.inline-drawer-content');
    if (!content) return;
    content.classList?.add('story-suite-panel');
    const quickbar = documentRef.createElement('div');
    quickbar.className = 'story-suite-quickbar';
    quickbar.innerHTML = `
        <div class="story-suite-actions">
            <button id="story_block_rescan" type="button" class="menu_button" title="Re-reads every block in this chat and hides raw ones left in the story."><i class="fa-solid fa-rotate"></i> Rescan chat</button>
        </div>
        <small class="story-suite-muted story-block-runtime-version">Story Block v${VERSION} · Rescan re-reads every block in this chat and hides raw ones left in the story.</small>`;
    const status = content.querySelector('#story_block_status');
    if (status) quickbar.appendChild(status);
    quickbar.querySelector('#story_block_rescan')?.addEventListener('click', () => void rescan());
    const row = documentRef.createElement('div');
    row.className = 'story-block-display';
    row.innerHTML = `
        <label class="story-suite-row" for="story_block_display">
            <span><b>Show blocks in</b><small>The sidebar is docked beside the chat on wide screens.</small></span>
            <select id="story_block_display" class="text_pole">
                <option value="sidebar">Sidebar</option>
                <option value="card">Card under the latest reply</option>
            </select>
        </label>
        <label class="story-suite-row" for="story_block_strip">
            <span><b>"This turn" strip under the reply</b><small>One line listing what the reply changed; tapping it opens the sidebar. Sidebar only.</small></span>
            <input id="story_block_strip" type="checkbox">
        </label>
        <label class="story-suite-row" for="story_block_empty_tabs">
            <span><b>Hide empty tabs</b><small>A block with nothing in it yet gets no tab until a reply writes it. Sidebar only.</small></span>
            <input id="story_block_empty_tabs" type="checkbox">
        </label>
        <label class="story-suite-row" for="story_block_offscreen">
            <span><b>Hide off-screen until revealed</b><small>The scene board counts off-screen entries until you reveal them. The block itself is unchanged, so NPC State Delta still reads it.</small></span>
            <input id="story_block_offscreen" type="checkbox">
        </label>
        <label class="story-suite-row" for="story_block_compat">
            <span><b>Megumin-compatible card</b><small>Card only. Lets extensions that add a tab to Megumin Suite's card (NPC State Delta) add it here. Turn off if Megumin Suite itself is installed.</small></span>
            <input id="story_block_compat" type="checkbox">
        </label>`;
    const display = row.querySelector('#story_block_display');
    const strip = row.querySelector('#story_block_strip');
    const compat = row.querySelector('#story_block_compat');
    const offscreen = row.querySelector('#story_block_offscreen');
    const emptyTabs = row.querySelector('#story_block_empty_tabs');
    // The strip only exists next to the sidebar; the compatible markup only on the card.
    const syncEnabled = () => {
        const card = settings().display === 'card';
        if (strip) strip.disabled = card;
        if (compat) compat.disabled = !card;
    };
    const bind = (input, read, write) => {
        if (!input) return;
        read(input);
        input.addEventListener('change', () => {
            write(input);
            saveSettings();
            syncEnabled();
            setFoldHint('display', displayHint());
            refreshAll(0);
        });
    };
    bind(display, input => { input.value = settings().display; }, input => { settings().display = input.value === 'card' ? 'card' : 'sidebar'; });
    bind(strip, input => { input.checked = settings().showTurnStrip; }, input => { settings().showTurnStrip = Boolean(input.checked); });
    bind(offscreen, input => { input.checked = settings().hideOffscreen; }, input => { settings().hideOffscreen = Boolean(input.checked); });
    bind(emptyTabs, input => { input.checked = settings().hideEmptyTabs; }, input => { settings().hideEmptyTabs = Boolean(input.checked); });
    bind(compat, input => { input.checked = settings().compatMarkup; }, input => { settings().compatMarkup = Boolean(input.checked); });
    syncEnabled();
    suiteSection = documentRef.createElement('div');
    suiteSection.className = 'story-block-suite';
    const folds = documentRef.createElement('div');
    folds.className = 'story-suite-folds';
    folds.append(settingsFold(documentRef, 'display', 'Display', [row]), settingsFold(documentRef, 'money', 'Money', [moneyRow(documentRef)]), settingsFold(documentRef, 'suite', 'Source of truth', [suiteSection]));
    const view = content.querySelector('.story-block-view');
    if (view) folds.appendChild(settingsFold(documentRef, 'blocks', 'Blocks', [view]));
    folds.appendChild(sentFold(documentRef));
    content.append(folds);
    content.prepend(quickbar);
    content.prepend(suiteLinkLine(documentRef));
    setFoldHint('display', displayHint());
    setFoldHint('money', moneyHint());
    setFoldHint('blocks', blocksHint());
    renderSuiteSection();
    syncSuiteEntries();
}

// (0.9.18) What's sent: the context the next reply gets, drawn when the fold opens (and on
// Refresh), never on every reply.
function sentFold(documentRef) {
    const body = documentRef.createElement('div');
    body.className = 'story-block-sent';
    const fill = () => {
        const parts = previewParts(suitePreview(), 'Story Blocks');
        body.replaceChildren(renderPreview(documentRef, parts?.filter(part => part.text) ?? [], { onRefresh: fill }));
        const size = parts?.reduce((sum, part) => sum + part.text.length, 0) ?? 0;
        setFoldHint('sent', size ? `~${Math.round(size / 4).toLocaleString('en-US')} tokens with the next reply` : 'Nothing right now');
    };
    const fold = settingsFold(documentRef, 'sent', "What's sent", [body]);
    setFoldHint('sent', 'Exactly what the next reply is told');
    fold.addEventListener('toggle', () => { if (fold.open) fill(); });
    if (fold.open) fill();
    return fold;
}

// Above the folds: one line that opens Story Suite with every extension's settings in one place.
// Every extension's link carries data-story-suite-link, which the overlay hides inside itself.
function suiteLinkLine(documentRef) {
    suiteLink = documentRef.createElement('div');
    suiteLink.className = 'story-suite-manage';
    suiteLink.setAttribute('data-story-suite-link', '');
    const open = documentRef.createElement('button');
    open.type = 'button';
    open.className = 'menu_button';
    open.innerHTML = '<i class="fa-solid fa-layer-group" aria-hidden="true"></i> Manage all in Story Suite';
    open.addEventListener('click', () => void openSuite('overview', open));
    suiteLink.appendChild(open);
    return suiteLink;
}

// Source of truth: one choice per shared area Story Block can offer, with who has it now.
// Built from nodes, not markup: the other extensions' names come from their announcements.
function renderSuiteSection() {
    if (!suiteSection) return;
    const documentRef = globalThis.document;
    const own = settings();
    const suite = storySuite();
    const offered = offeredAreas(blocks());
    const make = (tag, className = '', text = '') => el(tag, className, text, documentRef);
    const intro = make('p', 'story-suite-muted', 'With Story Director, NPC State Delta or RPG Battle installed, who tracks what. Automatic lets the specialist for each area lead; alone, every choice works like Automatic.');
    const nodes = [intro];
    for (const area of SHARED_AREAS) {
        const { label, provider } = AREA_LABELS[area];
        const field = make('label', 'story-suite-row');
        field.dataset.area = area;
        field.setAttribute('for', `story_block_source_${area}`);
        const title = make('span');
        title.append(make('b', '', `${label} (${provider})`), make('small', 'story-suite-status', sourceStatus(area, { choice: own.sourceOfTruth[area], suite, offered: offered.includes(area) })));
        const select = make('select', 'text_pole');
        select.id = `story_block_source_${area}`;
        for (const [value, text] of [['auto', 'Automatic'], ['mine', `This extension (${SUITE_NAME})`], ['theirs', 'The other one']]) {
            const option = make('option', '', text);
            option.value = value;
            select.appendChild(option);
        }
        select.value = own.sourceOfTruth[area];
        select.addEventListener('change', () => {
            settings().sourceOfTruth = normalizeSourceChoices({ ...settings().sourceOfTruth, [area]: select.value });
            saveSettings();
            renderSuiteSection();
            refreshAll(0);
        });
        field.append(title, select);
        nodes.push(field);
    }
    suiteSection.replaceChildren(...nodes);
    const chosen = SHARED_AREAS.filter(area => own.sourceOfTruth[area] !== 'auto').length;
    setFoldHint('suite', chosen ? `${chosen} chosen by hand` : 'Automatic');
}

// Story Suite's overlay (src/ui/suite-overlay.js) is offered while two or more extensions are
// announced, on or off; alone, its entry points stay hidden and nothing else changes.
function suiteOffered() {
    return storySuite().providers().length >= 2;
}

function syncSuiteEntries() {
    const display = suiteOffered() ? '' : 'none';
    for (const node of [suiteMenuItem, suiteLink]) if (node?.style && node.style.display !== display) node.style.display = display;
}

/** Open Story Suite on a tab ('overview', or an extension's id). False with nowhere to show it. */
function openSuite(tabId = 'overview', opener = null) {
    return Boolean(openSuiteOverlay({ document: globalThis.document, suite: storySuite(), tab: tabId, opener }));
}

// Story Suite's overlay sets every extension's Source of truth through api.manage; Story Block's
// is the same choice as its own select, saved and redrawn the same way.
function setSourceFromSuite(area, choice) {
    if (!SHARED_AREAS.includes(area)) return false;
    settings().sourceOfTruth = normalizeSourceChoices({ ...settings().sourceOfTruth, [area]: choice });
    saveSettings();
    renderSuiteSection();
    refreshAll(0);
    return true;
}

// Story Suite (src/suite.js): announce what the reader's enabled blocks offer. Only a change is
// announced, since every announcement wakes every extension's listeners; a registry that lost
// or never had Story Block's entry gets it again.
function announceToSuite(ctx = context()) {
    const suite = storySuite();
    const owns = offeredAreas(blocks(ctx));
    const current = suite.providers().find(provider => provider.id === SUITE_ID);
    if (current?.enabled && current.version === VERSION && current.owns.join() === owns.join()) return;
    suite.announce({ id: SUITE_ID, name: SUITE_NAME, version: VERSION, owns, settings: '#story_block_settings', api: SUITE_API });
}

// Another extension arrived, left or changed what it offers: the settings' owners, the
// Character Sheet's notice and which tabs are shown (chatter another extension shows) follow. Story Block's own announcements land here too, harmlessly.
function onSuiteChanged() {
    renderSuiteSection();
    syncSuiteEntries();
    refreshSuiteOverlay();
    refreshAll(0);
}

function addMenuButton(documentRef) {
    if (documentRef.querySelector('#story_block_menu')) return true;
    const menu = documentRef.querySelector('#extensionsMenu');
    if (!menu) return false;
    const item = documentRef.createElement('div');
    item.id = 'story_block_menu';
    item.className = 'list-group-item flex-container flexGap5';
    item.title = `Story Block v${VERSION}: re-read every block in this chat`;
    item.innerHTML = '<div class="fa-solid fa-layer-group extensionsMenuExtensionButton"></div><span>Story Block: Rescan</span>';
    item.addEventListener('click', () => void rescan());
    menu.appendChild(item);
    // Story Suite, its own item: hidden until a second extension of the suite is announced.
    suiteMenuItem = documentRef.createElement('div');
    suiteMenuItem.id = 'story_suite_menu';
    suiteMenuItem.className = 'list-group-item flex-container flexGap5';
    suiteMenuItem.title = 'Story Suite: every installed extension of the suite, and who keeps what';
    suiteMenuItem.innerHTML = '<div class="fa-solid fa-sliders extensionsMenuExtensionButton"></div><span>Story Suite</span>';
    const opener = suiteMenuItem;
    opener.addEventListener('click', () => void openSuite('overview', opener));
    menu.appendChild(opener);
    syncSuiteEntries();
    return true;
}

function ensureExtensionUi() {
    const menuReady = addMenuButton(document);
    const settingsReady = addSettingsPanel(document);
    if (menuReady && settingsReady) {
        if (uiRetry) clearTimeout(uiRetry);
        uiRetry = null;
        return;
    }
    if (!uiRetry) uiRetry = setTimeout(() => {
        uiRetry = null;
        ensureExtensionUi();
    }, 250);
}

// Inventory Block writes its own snapshots and instructions; running both doubles the
// inventory in every prompt. Story Block reads Inventory Block's snapshots, so it can replace it.
function warnCoexistence() {
    if (coexistenceWarned || typeof globalThis.inventoryBlockGenerationInterceptor !== 'function') return;
    if (!blocks().some(block => block.enabled && block.tag.toLowerCase() === 'inventory')) return;
    coexistenceWarned = true;
    notify('warning', 'Inventory Block is also enabled. Story Block\'s Inventory reads its snapshots — disable Inventory Block to avoid two inventories in every prompt.');
}

function onTimelineChanged() {
    refreshAll(20);
}

function onMessageVariantChanged(messageId) {
    void normalizeMessageTransport(messageId).finally(() => refreshAll(20));
}

// SillyTavern awaits MESSAGE_EDITED, then renders chat[id].mes itself and emits
// MESSAGE_UPDATED. Normalizing before that render needs no re-render of our own.
async function onMessageEdited(messageId) {
    try { await normalizeMessageTransport(messageId, { rerender: false }); }
    finally { refreshAll(20); }
}

function onCharacterMessageRendered(messageId) {
    void normalizeMessageTransport(messageId).finally(() => refreshAll(20));
}

async function onChatChanged() {
    // Pending sessions are chat-scoped and intentionally survive UI chat switches: a
    // generation already prepared may still reach prompt-ready after the user views another chat.
    syncMountSuspension();
    announceToSuite();
    refreshAll(0);
    try { await reconnectRegeneratedReply(); }
    catch (error) { notify('warning', `Reply state needs recovery: ${error.message}`); }
}

function registerEvents() {
    if (eventsRegistered) return;
    const ctx = context();
    if (!ctx?.eventSource || !ctx?.eventTypes) return;
    eventsRegistered = true;
    const events = ctx.eventTypes;

    const prepare = events.GENERATION_AFTER_COMMANDS || events.GENERATION_STARTED;
    if (prepare) ctx.eventSource.on(prepare, prepareGeneration);
    for (const event of [events.CHAT_COMPLETION_PROMPT_READY, events.GENERATE_AFTER_COMBINE_PROMPTS]) if (event) ctx.eventSource.on(event, onPromptReady);
    // On swipe and render, run before other extensions' listeners so their decorations are
    // applied after any re-render instead of being wiped by it. MESSAGE_RECEIVED stays a plain
    // listener: SillyTavern's own reasoning auto-parse must move <think> out of the reply first,
    // and extensions decorate on CHARACTER_MESSAGE_RENDERED, which follows anyway.
    const first = (event, listener) => (typeof ctx.eventSource.makeFirst === 'function'
        ? ctx.eventSource.makeFirst(event, listener)
        : ctx.eventSource.on(event, listener));
    if (events.MESSAGE_RECEIVED) ctx.eventSource.on(events.MESSAGE_RECEIVED, onMessageReceived);
    if (events.GENERATION_ENDED) ctx.eventSource.on(events.GENERATION_ENDED, onGenerationEnded);
    if (events.GENERATION_STOPPED) ctx.eventSource.on(events.GENERATION_STOPPED, onGenerationStopped);
    if (events.MESSAGE_EDITED) ctx.eventSource.on(events.MESSAGE_EDITED, onMessageEdited);
    for (const event of [events.MESSAGE_SWIPED, events.CHARACTER_FIRST_MESSAGE_SELECTED]) {
        if (event) first(event, onMessageVariantChanged);
    }
    for (const event of [events.MESSAGE_DELETED, events.MESSAGE_SWIPE_DELETED]) {
        if (event) ctx.eventSource.on(event, onTimelineChanged);
    }
    for (const event of [events.CHAT_CHANGED, events.CHAT_LOADED]) if (event) ctx.eventSource.on(event, onChatChanged);
    if (events.CHARACTER_MESSAGE_RENDERED) first(events.CHARACTER_MESSAGE_RENDERED, onCharacterMessageRendered);
    if (events.MORE_MESSAGES_LOADED) ctx.eventSource.on(events.MORE_MESSAGES_LOADED, onTimelineChanged);
    for (const event of [events.APP_READY, events.APP_INITIALIZED, events.EXTENSIONS_FIRST_LOAD, events.EXTENSION_SETTINGS_LOADED]) {
        if (event) ctx.eventSource.on(event, () => {
            ensureExtensionUi();
            // The stored block list may only now be loaded.
            announceToSuite();
            renderSuiteSection();
            refreshAll(0);
        });
    }
}

// The public API: tabs for other extensions, and read access to blocks (docs/ARCHITECTURE.md).
globalThis.StoryBlock = Object.freeze({
    version: VERSION,
    apiVersion: 1,
    /** Every block definition, the reader's and plugins': [{ id, tag, name, kind, … }]. */
    listBlocks: () => {
        const shownElsewhere = displaysShownElsewhere(storySuite());
        return transportBlocks().filter(def => !def.changesFor).map(def => blockSummary(def, { shownElsewhere }));
    },
    /** The newest valid copy of a block (before `beforeIndex`): { id, tag, text, state, messageIndex } | null. */
    getBlock(tagOrId, { beforeIndex = null } = {}) {
        const ctx = context();
        return blockSnapshot(ctx?.chat ?? [], findBlockDef(transportBlocks(ctx), tagOrId), { beforeIndex }) ?? archivedBlock(tagOrId);
    },
    /** The copy the model will be shown for a generation of `type` (a swipe sees the one before). */
    blockForGeneration(tagOrId, type = 'normal') {
        const ctx = context();
        return generationSnapshot(ctx?.chat ?? [], findBlockDef(transportBlocks(ctx), tagOrId), type) ?? archivedBlock(tagOrId);
    },
    /** A block as written in one message's text, or null. */
    blockInText(text, tagOrId) {
        return blockInText(text, findBlockDef(transportBlocks(), tagOrId));
    },
    setBlockText,
    transactionVersion: 1,
    journalVersion: JOURNAL_VERSION,
    journal,
    regeneratedReplyRecovery,
    recoverRegeneratedReply,
    reconnectRegeneratedReply,
    commitBlocks,
    messageIdentity,
    /**
     * A plugin's block: transport only, or with `kept: true` read by the model every reply and
     * written only by the plugin (setBlockText), with a tab of its own unless `tab: false`.
     * Registering again under the same id replaces it (and may flip its tab). { ok, error }.
     */
    registerBlock(spec) {
        const result = pluginBlockDef(spec, transportBlocks());
        if (result.error) return { ok: false, error: result.error };
        const replaced = pluginBlocks.get(result.def.id);
        pluginBlocks.set(result.def.id, result.def);
        if (result.def.kept || replaced?.kept) refreshAll(0);
        return { ok: true };
    },
    unregisterBlock(id) {
        const def = pluginBlocks.get(String(id ?? ''));
        const removed = pluginBlocks.delete(String(id ?? ''));
        if (def?.kept) refreshAll(0);
        return removed;
    },
    /** After each reply is received and normalized: callback({ chatId, messageIndex }). Returns unsubscribe. */
    onReply: (callback, options) => replyListeners.add(callback, options),
    replyBusy: () => replyCallbacks > 0,
    /** Whenever Story Block refreshes (reply, swipe, edit, delete, chat change). Returns unsubscribe. */
    onUpdate: callback => updateListeners.add(callback),
    registerTab(tab) {
        const result = externalTabs.register(tab);
        refreshAll(0);
        return result;
    },
    unregisterTab(id) {
        const result = externalTabs.unregister(id);
        refreshAll(0);
        return result;
    },
    refresh: () => refreshAll(0),
});

// What Story Block shares with the suite: reading blocks, its Source of truth choices for Story
// Suite's overlay (no on/off switch: Story Block hosts the overlay and is always on), and opening
// the overlay. Built once, so every announcement carries the same api.
const SUITE_API = Object.freeze({
    listBlocks: globalThis.StoryBlock.listBlocks,
    getBlock: globalThis.StoryBlock.getBlock,
    transactionVersion: 1,
    journalVersion: JOURNAL_VERSION,
    journal,
    commitBlocks,
    messageIdentity,
    manage: Object.freeze({
        areas: SHARED_AREAS,
        sources: () => ({ ...settings().sourceOfTruth }),
        setSource: setSourceFromSuite,
        tokens: suiteTokens,
        preview: suitePreview,
    }),
    /** Open Story Suite's overlay on a tab: 'overview' (default) or an extension's id. */
    openSuite: (tabId = 'overview') => openSuite(tabId),
    /** (0.9.12) True while the Inventory's prompt says the purse in one sum: RPG Battle then leaves its own line out. */
    printsPurse: () => printsPurse(),
});

// The suite's shared styles (src/suite.css, identical in all four), linked once per page: the
// first extension to load adds <link id="story-suite-css">, the others find it there.
function loadSuiteStyles(documentRef = globalThis.document) {
    try {
        if (!documentRef?.createElement || documentRef.querySelector?.('#story-suite-css')) return false;
        const parent = documentRef.head ?? documentRef.body;
        if (typeof parent?.appendChild !== 'function') return false;
        const link = documentRef.createElement('link');
        link.id = 'story-suite-css';
        link.rel = 'stylesheet';
        link.href = new URL('./src/suite.css', import.meta.url).href;
        parent.appendChild(link);
        return true;
    } catch (error) {
        console.warn('[Story Block] could not link the Story Suite styles', error);
        return false;
    }
}

export async function init() {
    if (initialized) return;
    if (!globalThis.SillyTavern?.getContext) {
        setTimeout(() => void init(), 100);
        return;
    }
    initialized = true;
    // A copy of Story Block reloaded without a page refresh: panels a stale overlay holds go home.
    closeSuiteOverlay();
    loadSuiteStyles();
    setExtensionPlaceholder(context(), '');
    ensureExtensionUi();
    initializeMount(buildCardTabs);
    registerEvents();
    announceToSuite();
    if (!suiteSubscribed) {
        suiteSubscribed = true;
        storySuite().onChange(onSuiteChanged);
    }
    refreshAll(0);
    console.info(`[Story Block] v${VERSION} loaded.`);
}

void init();
