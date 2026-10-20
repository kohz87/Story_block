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
//
// A kept block (`kept: true`, v0.7) is a plugin block the model reads but never writes:
// RPG Battle's Character and Party sheets. Its newest copy is shown in every reply's prompt
// as read-only state, it gets a tab like the reader's blocks (without Edit), and only the
// extension writes it, through setBlockText. A copy the model writes anyway is dropped on
// receive and never counts (envelope.js: ownCopy, dropForeignCopies).
//
// A kept block registered with `tab: false` (v0.9.1) is all of that without the tab: the
// extension shows it in a tab of its own (RPG Battle's Battle tab), so Story Block's sidebar
// and card leave it out, with its badge. Underneath it is a block with `visible: false`, the
// reader's own "Show tab" switch, so it is left out exactly where theirs is (hasTab).

import { latestBlockInText, latestBlockState, replacesLastReply } from './envelope.js';
import { FIELD_TYPES, TAG_PATTERN, normalizeBlock, validateBlock } from './schema.js';
import { oneLine } from './text.js';

/**
 * Whether a block gets a tab in the sidebar and the card (once it is enabled and has something
 * to show): the reader's "Show tab" switch, a kept block's `tab`. Transport blocks never do.
 * `shownElsewhere`: displays another extension draws itself (handshake.js,
 * displaysShownElsewhere); a block with one of them has no tab while that lasts.
 */
export function hasTab(def, { shownElsewhere = [] } = {}) {
    return Boolean(def?.visible) && !shownElsewhere.includes(def.display);
}

/**
 * What a plugin may know about a block definition. Kept blocks report kind 'kept' and their
 * owner; every block reports `tab` (hasTab, with the same `options`).
 */
export function blockSummary(def, options = {}) {
    const summary = {
        id: def.id,
        tag: def.tag,
        name: def.name,
        kind: def.kept ? 'kept' : def.kind,
        format: def.format,
        display: def.display,
        enabled: Boolean(def.enabled),
        visible: Boolean(def.visible),
        optional: Boolean(def.optional),
        tab: hasTab(def, options),
    };
    if (def.kept) summary.owner = def.owner;
    return summary;
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

const KEPT_FORMATS = ['fields', 'text'];
const KEPT_DISPLAYS = ['fields', 'plain'];
const MAX_OWNER_LENGTH = 40;
const MAX_NOTE_LENGTH = 300;
const MAX_DICE_MODIFIER_LENGTH = 400;


/**
 * A kept block's definition, checked the way the block editor checks the reader's own
 * (validateBlock), plus what only a kept block has. Returns { def } or { error }.
 */
function keptBlockDef(spec, id, tag, existing) {
    // normalizeBlock would quietly swap a bad tag for one made from the name; a plugin is told.
    if (!TAG_PATTERN.test(tag)) return { error: 'a kept block\'s tag starts with a letter and uses only letters, numbers and underscores (up to 32)' };
    const owner = oneLine(spec.owner, MAX_OWNER_LENGTH);
    if (!owner) return { error: 'a kept block needs an owner (the extension\'s display name)' };
    const fields = Array.isArray(spec.fields) ? spec.fields : [];
    const format = spec.format === undefined ? (fields.length ? 'fields' : 'text') : spec.format;
    if (!KEPT_FORMATS.includes(format)) return { error: 'a kept block\'s format is "fields" or "text"' };
    const display = spec.display === undefined ? (format === 'fields' ? 'fields' : 'plain') : spec.display;
    if (!KEPT_DISPLAYS.includes(display)) return { error: 'a kept block\'s display is "fields" or "plain"' };
    if (display === 'fields' && format !== 'fields') return { error: 'the "fields" display needs the "fields" format' };
    if (spec.tab !== undefined && typeof spec.tab !== 'boolean') return { error: 'a kept block\'s tab is true or false' };
    if (format === 'fields') {
        // Likewise for fields: a plugin hears what is wrong instead of getting a repaired list.
        for (const field of fields) {
            const label = String(field?.label ?? '').trim();
            if (!label) return { error: 'every field needs a label' };
            if (field.type !== undefined && !FIELD_TYPES.includes(field.type)) return { error: `field "${label}": the type is one of ${FIELD_TYPES.join(', ')}` };
        }
    }
    const def = normalizeBlock({
        id,
        tag,
        name: String(spec.name ?? tag),
        icon: String(spec.icon ?? '🧩'),
        short: spec.short,
        // Stateful underneath: its newest valid copy in the chat is its current state, which is
        // how the view, the snapshots and a swipe's baseline already treat state.
        kind: 'stateful',
        format,
        display,
        fields,
        enabled: true,
        // `tab: false`: kept, prompted and read as always, but no tab of its own (v0.9.1).
        visible: spec.tab !== false,
        // Never asked for, so never missed: its tab appears once the extension has written it.
        optional: true,
        repeating: false,
        prompt: '',
        when: { mode: 'always' },
    });
    const errors = validateBlock(def, existing);
    if (errors.length) return { error: errors.join(' ') };
    return {
        def: {
            ...def,
            plugin: true,
            kept: true,
            owner,
            promptNote: oneLine(spec.promptNote, MAX_NOTE_LENGTH),
            diceModifier: oneLine(spec.diceModifier, MAX_DICE_MODIFIER_LENGTH),
        },
    };
}

/**
 * A plugin's block: transport only (never a tab, whatever `spec.tab` says), or kept
 * (`spec.kept: true`, see keptBlockDef). Returns { def } or { error }. A tag a reader's own block already uses stays theirs; a plugin block
 * registered again under its own id is replaced (an extension re-registering after a reload).
 */
export function pluginBlockDef(spec, existing = []) {
    const tag = String(spec?.tag ?? '').trim();
    const id = String(spec?.id ?? '').trim();
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(tag)) return { error: 'a plugin block needs a tag of letters, digits, _ or -' };
    if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(id)) return { error: 'a plugin block needs a lowercase id' };
    const others = (Array.isArray(existing) ? existing : []).filter(def => !(def?.plugin && def.id === id));
    if (findBlockDef(others, tag) || findBlockDef(others, id)) return { error: `the tag or id "${tag}" is already used by another block` };
    if (spec.kept === true) return keptBlockDef(spec, id, tag, others);
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
