// Story Block runtime: SillyTavern wiring for the block engine.
//
// The generation lifecycle is Inventory Block v0.6.7's, generalized from one block to the
// reader's block list: a placeholder registered through SillyTavern's extension prompt
// identifies the reply's own prompt, the real context replaces it at prompt-ready, and
// every block a reply writes lives in that reply's message text — the chat is the store.

import { normalizeBlock, normalizeBlocks } from './src/schema.js';
import { TEMPLATES, defaultBlocks } from './src/templates.js';
import { formatFor } from './src/formats/index.js';
import { bareBlockTexts, normalizeTransport, rejoinContinuation, stateForGeneration, upsertBlock } from './src/envelope.js';
import { activeBlocks, buildContext, defuseMacros, injectContext, promptCarriesContext } from './src/prompt.js';
import { blockStatusInText, blockView, isAssistant, latestAssistantIndex, viewKey } from './src/view.js';
import { turnCount, turnItems } from './src/turn.js';
import { createTabRegistry } from './src/ui/card.js';
import { render as renderPlain } from './src/ui/displays/plain.js';
import { render as renderTree } from './src/ui/displays/tree.js';
import { render as renderFields } from './src/ui/displays/fields.js';
import { render as renderScene } from './src/ui/displays/scene.js';
import { render as renderChoices } from './src/ui/displays/choices.js';
import { render as renderDice } from './src/ui/displays/dice.js';
import { rollDice, stampRolls } from './src/dice.js';
import { renderSettings } from './src/ui/editor.js';
import { initializeMount, scheduleMount, setMountSuspended } from './src/mount.js';
import { openBodyEditor } from './src/body-editor.js';

const VERSION = '0.4.0';
const SETTINGS_KEY = 'storyBlock';
const EXTENSION_PROMPT_KEY = 'story_block';
// SillyTavern extension_prompt_types.IN_PROMPT / IN_CHAT and extension_prompt_roles.SYSTEM.
const EXTENSION_PROMPT_IN_PROMPT = 0;
const EXTENSION_PROMPT_IN_CHAT = 1;
const EXTENSION_PROMPT_ROLE_SYSTEM = 0;
const SESSION_MAX_AGE_MS = 2 * 60 * 1000;
const SESSION_RECHECK_MS = 15 * 1000;
const DISPLAYS = { plain: renderPlain, tree: renderTree, fields: renderFields, scene: renderScene, choices: renderChoices, dice: renderDice };

let initialized = false;
// Set once a reply's prompt has been seen carrying the placeholder; from then on a prompt
// without it is never mistaken for a reply's (see foregroundKind).
let contextMarkerSeen = false;
let eventsRegistered = false;
let uiRetry = null;
let coexistenceWarned = false;
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
    if (!store || typeof store !== 'object') return { blocks: defaultBlocks(), compatMarkup: true, display: 'sidebar', showTurnStrip: false, sidebarPinned: true };
    if (!store[SETTINGS_KEY] || typeof store[SETTINGS_KEY] !== 'object') store[SETTINGS_KEY] = {};
    const own = store[SETTINGS_KEY];
    // A first install starts from the templates; afterwards the stored list is the reader's.
    own.blocks = Array.isArray(own.blocks) ? normalizeBlocks(own.blocks) : defaultBlocks();
    own.compatMarkup = own.compatMarkup !== false;
    // Where blocks are shown: the sidebar (docked on wide screens, a drawer or bottom sheet
    // elsewhere) or the v0.1 card under the latest reply. The strip is opt-in.
    own.display = own.display === 'card' ? 'card' : 'sidebar';
    own.showTurnStrip = own.showTurnStrip === true;
    own.sidebarPinned = own.sidebarPinned !== false;
    return own;
}

function blocks(ctx = context()) {
    return settings(ctx).blocks;
}

function enabledBlocks(ctx = context()) {
    return blocks(ctx).filter(block => block.enabled);
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
// them when a preset disables it, so the placeholder goes in-chat there (it is removed
// again at prompt-ready). Text completion keeps it inside the story string.
function setExtensionPlaceholder(ctx, value = '') {
    if (typeof ctx?.setExtensionPrompt !== 'function') return;
    const position = ctx.mainApi === 'openai' ? EXTENSION_PROMPT_IN_CHAT : EXTENSION_PROMPT_IN_PROMPT;
    ctx.setExtensionPrompt(EXTENSION_PROMPT_KEY, value, position, 0, false, EXTENSION_PROMPT_ROLE_SYSTEM);
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

function sessionContext(ctx, session) {
    return buildContext(session.entries, { substitute: substituter(ctx) });
}

function prepareGeneration(type = 'normal', _params = null, isDryRun = false) {
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
    // Dice are rolled here, once per generation: a swipe or regenerate rolls again, and the
    // placeholder and the real context carry the same numbers.
    const entries = activeBlocks(enabledBlocks(ctx), chat, type).map(def => ({
        def,
        state: def.kind === 'stateful' ? stateForGeneration(chat, def, type) : null,
        rolls: def.rolls?.count > 0 ? rollDice(def.rolls.count, def.rolls.sides) : null,
    }));
    const session = {
        chatId,
        type: normalizeType(type),
        entries,
        contextInPrompt: typeof ctx.setExtensionPrompt === 'function',
        consumed: false,
        backgroundPrompts: 0,
        // Set when the generate interceptor runs, i.e. once this reply's own prompt is about
        // to be built; used only by the fallback when the placeholder never shows.
        armed: false,
        injected: false,
        promptsSeen: 0,
    };
    const text = entries.length ? sessionContext(ctx, session) : '';
    setExtensionPlaceholder(ctx, session.contextInPrompt && text ? defuseMacros(text) : '');
    pending.set(chatId, session);
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
    if (!pending.has(chatId)) prepareGeneration(type);
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
    const text = session.entries.length ? sessionContext(ctx, session) : '';
    // With no active block the prompt still loses old blocks from its history; the model
    // would otherwise keep writing them from example.
    const result = injectContext(eventData, text, enabledBlocks(ctx), { knownBlocks: historyBlocks(ctx) });
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
    const defs = blocks(ctx);
    for (const message of ctx?.chat ?? []) {
        if (isAssistant(message)) bareBlockTexts(message.mes, defs).forEach(block => known.add(block));
    }
    return known;
}

async function saveChat(ctx) {
    if (typeof ctx.saveChat === 'function') await ctx.saveChat();
    else ctx.saveMetadataDebounced?.();
}

function syncActiveSwipeText(message) {
    if (!message || !Array.isArray(message.swipes)) return;
    const swipe = Number.isInteger(message.swipe_id) ? message.swipe_id : 0;
    if (swipe >= 0 && swipe < message.swipes.length) message.swipes[swipe] = String(message.mes ?? '');
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
    const normalized = normalizeTransport(rejoined, blocks(ctx));
    if (!normalized.changed && rejoined === message.mes) return false;

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
    const ctx = context();
    const id = Number(messageId);
    if (!ctx || !Number.isInteger(id)) return;
    const message = ctx.chat?.[id];
    if (!isAssistant(message)) return;

    const chatId = chatIdOf(ctx);
    const session = chatId ? pending.get(chatId) : null;

    // Keep the blocks in the raw message, but hide their transport from the narration.
    await normalizeMessageTransport(id, { rerender: true });

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
    if (stamped) await persistMessageEdit(ctx, id, message, { rerender: false });

    if (session?.entries.length) {
        const problems = session.entries
            .map(({ def }) => ({ def, ...blockStatusInText(message.mes, def) }))
            // An optional block may simply not have been needed this reply.
            .filter(item => item.status !== 'valid' && !(item.def.optional && item.status === 'missing'));
        if (problems.length) {
            const kept = problems.some(item => item.def.kind === 'stateful') ? ' The last valid state of each stateful block stays current.' : '';
            notify('warning', `${describeMissing(problems)}.${kept}`);
        }
    }
    clearSession(chatId);
    refreshAll(0);
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

function latestAssistantElement(ctx) {
    const elements = [...document.querySelectorAll('#chat .mes')].reverse();
    return elements.find(element => {
        const id = Number.parseInt(element.getAttribute('mesid') ?? '', 10);
        return Number.isInteger(id) && isAssistant(ctx?.chat?.[id]);
    }) ?? null;
}

// Rail labels are small: a long name shows its first word.
function shortName(name) {
    const text = String(name ?? '');
    return text.length <= 10 ? text : text.split(/\s+/)[0].slice(0, 10);
}

function blockTab(view, uiKey) {
    const { def } = view;
    const display = DISPLAYS[def.display] ?? renderPlain;
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
        short: shortName(def.name),
        icon: def.icon,
        badge: turnCount(view),
        key: viewKey(view),
        render: pane => display(pane, {
            def,
            state: view.state,
            previousState: view.previousState,
            changes: view.changes,
            changesFromEarlierReply: view.fromEarlierReply,
            error: view.error,
            truncated: view.truncated,
            rolls: view.rolls ?? null,
            animate,
            onEdit: () => void editBlock(def),
            uiKey: `${uiKey}:${def.id}`,
        }),
    };
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
    for (const def of enabledBlocks(ctx)) {
        if (!def.visible) continue;
        const view = blockView(ctx.chat ?? [], def);
        if (!view) continue;
        const tab = blockTab(view, uiKey);
        tabs.push(tab);
        views.push({ view, tabId: tab.id });
    }
    for (const tab of externalTabs.list()) {
        try {
            if (typeof tab.isAvailable === 'function' && !tab.isAvailable({ messageId, message })) continue;
            tabs.push({
                id: `ext:${tab.id}`,
                label: tab.label,
                icon: tab.icon,
                order: tab.order,
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
    const state = block.kind === 'stateful' ? stateForGeneration(ctx?.chat ?? [], block) : null;
    const section = buildContext([{ def: block, state }], { substitute: substituter(ctx) });
    const written = state ? formatFor(block).serialize(state, block).length : 200;
    return Math.round((section.length + written) / 3.5);
}

function onBlocksChanged(next) {
    const ctx = context();
    settings(ctx).blocks = normalizeBlocks(next);
    saveSettings(ctx);
    refreshAll(0);
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
    });
    addRuntimeControls(documentRef, panel?.root ?? wrapper);
    return true;
}

// Version, Rescan and the compatibility switch sit above the editor's status line; the
// editor re-renders only its own list, so these stay put.
function addRuntimeControls(documentRef, root) {
    const content = root.querySelector?.('.inline-drawer-content');
    if (!content) return;
    const row = documentRef.createElement('div');
    row.className = 'story-block-runtime';
    row.innerHTML = `
        <span class="story-block-runtime-version">v${VERSION}</span>
        <button id="story_block_rescan" type="button" class="menu_button"><i class="fa-solid fa-rotate"></i> Rescan chat</button>
        <label class="story-block-runtime-field" for="story_block_display">
            <span>Show blocks in</span>
            <select id="story_block_display" class="text_pole">
                <option value="sidebar">Sidebar (docked on wide screens)</option>
                <option value="card">Card under the latest reply</option>
            </select>
        </label>
        <label class="checkbox_label" for="story_block_strip" title="One line under the latest reply listing what it changed; tapping it opens the sidebar.">
            <input id="story_block_strip" type="checkbox"> <span>"This turn" strip under the reply</span>
        </label>
        <label class="checkbox_label" for="story_block_compat" title="Lets extensions that add a tab to Megumin Suite's card (NPC State Delta) add it to Story Block's card. Turn off if Megumin Suite itself is installed.">
            <input id="story_block_compat" type="checkbox"> <span>Megumin-compatible card</span>
        </label>`;
    row.querySelector('#story_block_rescan')?.addEventListener('click', () => void rescan());
    const display = row.querySelector('#story_block_display');
    const strip = row.querySelector('#story_block_strip');
    const compat = row.querySelector('#story_block_compat');
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
            refreshAll(0);
        });
    };
    bind(display, input => { input.value = settings().display; }, input => { settings().display = input.value === 'card' ? 'card' : 'sidebar'; });
    bind(strip, input => { input.checked = settings().showTurnStrip; }, input => { settings().showTurnStrip = Boolean(input.checked); });
    bind(compat, input => { input.checked = settings().compatMarkup; }, input => { settings().compatMarkup = Boolean(input.checked); });
    syncEnabled();
    content.prepend(row);
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

function onChatChanged() {
    // Pending sessions are chat-scoped and intentionally survive UI chat switches: a
    // generation already prepared may still reach prompt-ready after the user views another chat.
    syncMountSuspension();
    refreshAll(0);
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
            refreshAll(0);
        });
    }
}

// Public tab API: other extensions add a tab to the card without being ported.
globalThis.StoryBlock = Object.freeze({
    version: VERSION,
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

export async function init() {
    if (initialized) return;
    if (!globalThis.SillyTavern?.getContext) {
        setTimeout(() => void init(), 100);
        return;
    }
    initialized = true;
    setExtensionPlaceholder(context(), '');
    ensureExtensionUi();
    initializeMount(buildCardTabs);
    registerEvents();
    refreshAll(0);
    console.info(`[Story Block] v${VERSION} loaded.`);
}

void init();
