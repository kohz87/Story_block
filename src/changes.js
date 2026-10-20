// Changes only (0.9.16): a list block the model updates by writing what changed.
//
// A block with `updates: 'changes'` (the Inventory, unless the reader chose otherwise) is not
// rewritten in full each reply. The model writes <Inventory_Changes> (the block's tag plus
// _Changes) holding lines such as `- Minor Healing Draught | 1`, and when the reply comes in
// they are applied to the last state (rows.applyChanges) and the reply gets the whole new
// <Inventory>, as if the model had written it: every reader sees the full block, a swipe or a
// deleted reply goes back to the state before, and a row nobody changed never passes through
// the model, so its words never drift. A reply that writes the full block instead (a big
// reorganisation) keeps it. Pure.

import { formatFor } from './formats/index.js';
import { applyChanges } from './formats/rows.js';
import { extractBlocks, latestBlockInText, latestBlockState, removeBlock, upsertBlock } from './envelope.js';

export const CHANGES_SUFFIX = '_Changes';

/** Whether `def` is written as changes only. */
export function changesOnly(def) {
    return def?.format === 'rows' && def?.kind === 'stateful' && !def?.kept && def?.updates === 'changes';
}

/** The tag a changes-only block's changes are written in: `Inventory_Changes`. */
export function changesTag(def) {
    return `${String(def?.tag ?? '').slice(0, 32 - CHANGES_SUFFIX.length)}${CHANGES_SUFFIX}`;
}

/** The hidden block a changes-only block's changes travel in (transport only, never shown). */
export function changesDef(def) {
    return {
        id: `${def.id}-changes`,
        name: `${def.name} changes`,
        tag: changesTag(def),
        icon: def.icon,
        enabled: true,
        visible: false,
        optional: true,
        repeating: false,
        kind: 'turn',
        format: 'text',
        display: 'plain',
        prompt: '',
        when: { mode: 'always' },
        changesFor: def.id,
    };
}

/** The changes blocks of every changes-only block in `defs`. */
export function changeDefs(defs) {
    return (Array.isArray(defs) ? defs : []).filter(changesOnly).map(changesDef);
}

/**
 * The reply at `index` of `chat` (its text `text`) with each changes-only block's changes
 * applied: { text, results: [{ def, applied, failed }] }. A reply that also wrote the full
 * block keeps that one and loses only the changes; a changes block cut off is left for
 * Continue; changes that leave the block unreadable are not written.
 */
export function applyReplyChanges(text, defs, chat, index) {
    let out = String(text ?? '');
    const results = [];
    for (const def of (Array.isArray(defs) ? defs : []).filter(changesOnly)) {
        const companion = changesDef(def);
        // An empty one ("nothing changed") is read too, and goes.
        const changes = extractBlocks(out, [companion]).filter(entry => !entry.truncated).at(-1);
        if (!changes) continue;
        if (latestBlockInText(out, def)) {
            out = removeBlock(out, companion);
            results.push({ def, applied: [], failed: [], full: true });
            continue;
        }
        const before = latestBlockState(chat, def, { beforeIndex: index });
        const result = applyChanges(before?.body ?? '', changes.body, def);
        if (!formatFor(def).parse(result.body, def).ok) {
            results.push({ def, applied: [], failed: [{ line: changes.body, why: 'the result could not be read' }] });
            continue;
        }
        out = removeBlock(out, companion);
        // Nothing changed: the reply carries no copy, and the state before it stays current.
        if (result.applied.length) out = upsertBlock(out, def, result.body);
        results.push({ def, applied: result.applied, failed: result.failed });
    }
    return { text: out, results };
}
