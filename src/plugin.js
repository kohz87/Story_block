// The plugin API behind globalThis.StoryBlock: what another extension (Story Director, NPC
// State Delta) may read, and the little it may write, without knowing how blocks are stored.
//
// Reads work on plain message arrays, so they are tested without SillyTavern. A snapshot is
// the newest valid copy of a block, exactly as the sidebar shows it: invalid and cut-off
// copies never count, and swipes and edits are already reflected in the chat array.
// `generationSnapshot` answers the question a checker asks before a reply: which copy will
// the model be shown (a swipe or regenerate is shown the copy before the reply it replaces).
//
// A plugin block is transport only: Story Block moves its tag into the hidden envelope,
// keeps it out of the narration and out of the prompt's history, but never prompts for it
// and never gives it a tab. The plugin writes its own instructions.

import { latestBlockInText, latestBlockState, replacesLastReply } from './envelope.js';
import { normalizeBlock } from './schema.js';

/** What a plugin may know about a block definition. */
export function blockSummary(def) {
    return {
        id: def.id,
        tag: def.tag,
        name: def.name,
        kind: def.kind,
        format: def.format,
        display: def.display,
        enabled: Boolean(def.enabled),
        visible: Boolean(def.visible),
        optional: Boolean(def.optional),
    };
}

/** A block by id or tag (tags compare case-insensitively, as the model writes them). */
export function findBlockDef(blocks, tagOrId) {
    const wanted = String(tagOrId ?? '').trim();
    if (!wanted) return null;
    const list = Array.isArray(blocks) ? blocks : [];
    return list.find(def => def.id === wanted)
        ?? list.find(def => String(def.tag).toLowerCase() === wanted.toLowerCase())
        ?? null;
}

// Free-text blocks are their text; structured ones are the body as the model wrote it.
function snapshotOf(def, found, messageIndex = found?.messageIndex ?? null) {
    if (!found) return null;
    const text = typeof found.state?.text === 'string' ? found.state.text : String(found.body ?? '');
    return { id: def.id, tag: def.tag, text, state: found.state, messageIndex };
}

/**
 * The newest valid copy of `def` in `chat` (before `beforeIndex` when given):
 * { id, tag, text, state, messageIndex }, or null when the chat has none.
 */
export function blockSnapshot(chat, def, { beforeIndex = null } = {}) {
    if (!def) return null;
    return snapshotOf(def, latestBlockState(chat, def, { beforeIndex }));
}

/** The copy the model will be shown for a generation of `type` (normal, swipe, regenerate…). */
export function generationSnapshot(chat, def, type = 'normal') {
    if (!def) return null;
    const list = Array.isArray(chat) ? chat : [];
    const beforeIndex = replacesLastReply(list, type) ? list.length - 1 : null;
    return snapshotOf(def, latestBlockState(list, def, { beforeIndex }));
}

/** The block as written in one message's text (copies of a repeating block merged), or null. */
export function blockInText(text, def) {
    if (!def) return null;
    return snapshotOf(def, latestBlockInText(String(text ?? ''), def), null);
}

/**
 * A plugin's transport-only block. Returns { def } or { error } (a tag a reader's own block
 * already uses stays theirs).
 */
export function pluginBlockDef(spec, existing = []) {
    const tag = String(spec?.tag ?? '').trim();
    const id = String(spec?.id ?? '').trim();
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(tag)) return { error: 'a plugin block needs a tag of letters, digits, _ or -' };
    if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(id)) return { error: 'a plugin block needs a lowercase id' };
    if (findBlockDef(existing, tag) || findBlockDef(existing, id)) return { error: `the tag or id "${tag}" is already used by another block` };
    const def = normalizeBlock({
        id,
        tag,
        name: String(spec.name ?? tag),
        icon: String(spec.icon ?? '🧩'),
        kind: 'turn',
        format: 'text',
        display: 'plain',
        enabled: true,
        visible: false,
        optional: true,
        repeating: true,
        prompt: '',
        when: { mode: 'always' },
    });
    return { def: { ...def, plugin: true } };
}

/**
 * A tiny listener list. A listener that throws is logged and skipped: one broken plugin
 * must not stop Story Block, or the plugins after it.
 */
export function createListeners(name = 'listener') {
    const listeners = new Set();
    return {
        add(callback) {
            if (typeof callback !== 'function') return () => {};
            listeners.add(callback);
            return () => listeners.delete(callback);
        },
        emit(payload) {
            for (const callback of [...listeners]) {
                try {
                    callback(payload);
                } catch (error) {
                    console.warn(`[Story Block] ${name} failed`, error);
                }
            }
        },
        get size() { return listeners.size; },
    };
}
