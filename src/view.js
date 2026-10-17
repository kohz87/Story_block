// What the card shows for each block, worked out from the chat alone.
//
// The chat is the only store: the newest valid copy of a stateful block is its current
// state, and a turn block belongs to the latest assistant reply. Nothing here touches
// the DOM, so the rules are testable on plain message arrays.

import { extractBlocks, latestBlockInText, latestBlockState } from './envelope.js';
import { formatFor } from './formats/index.js';
import { diffScene } from './scene.js';

export function isAssistant(message) {
    return Boolean(message) && !message.is_user && !message.is_system;
}

export function latestAssistantIndex(chat) {
    const list = Array.isArray(chat) ? chat : [];
    for (let i = list.length - 1; i >= 0; i--) if (isAssistant(list[i])) return i;
    return -1;
}

/**
 * How the newest occurrence of `def` in one message fared: 'valid', 'invalid' (with the
 * parser's error), 'truncated', or 'missing' when the message has no copy at all.
 */
export function blockStatusInText(text, def) {
    const entries = extractBlocks(String(text ?? ''), [def]);
    const last = entries.at(-1);
    if (!last) return { status: 'missing' };
    if (last.truncated) return { status: 'truncated' };
    const parsed = formatFor(def).parse(last.body, def);
    return parsed.ok ? { status: 'valid' } : { status: 'invalid', error: parsed.error };
}

// A World State is stored as text (its layout is the format other readers know), so its
// changes come from the scene board's parser rather than from the text format.
export function changesFor(def, previousState, state) {
    if (def.format === 'text' && def.display === 'scene') return diffScene(previousState?.text ?? '', state?.text ?? '', { layout: def.layout });
    return formatFor(def).diff(previousState, state, def);
}

/**
 * Everything one block's tab needs, or null when there is nothing to show yet.
 * `fromEarlierReply` marks a stateful state (and its changes) that came from an older
 * reply because the latest one did not carry a valid copy.
 */
export function blockView(chat, def) {
    const list = Array.isArray(chat) ? chat : [];
    const latestIndex = latestAssistantIndex(list);
    const latest = latestIndex >= 0 ? list[latestIndex] : null;
    const own = latest ? blockStatusInText(latest.mes, def) : { status: 'missing' };
    const error = own.status === 'invalid' ? own.error : null;
    const truncated = own.status === 'truncated';
    const format = formatFor(def);

    if (def.kind === 'turn') {
        const found = latest ? latestBlockInText(latest.mes, def) : null;
        if (!found && !error && !truncated) return null;
        return {
            def, state: found?.state ?? null, body: found?.body ?? '', previousState: null, changes: [],
            error, truncated, messageIndex: latestIndex, fromEarlierReply: false,
        };
    }

    const current = latestBlockState(list, def);
    if (!current && !error && !truncated) return null;
    const previous = current ? latestBlockState(list, def, { beforeIndex: current.messageIndex }) : null;
    const changes = current && previous ? changesFor(def, previous.state, current.state) : [];
    return {
        def,
        state: current?.state ?? format.empty(def),
        body: current?.body ?? '',
        previousState: previous?.state ?? null,
        changes,
        error,
        truncated,
        messageIndex: current?.messageIndex ?? -1,
        fromEarlierReply: Boolean(current) && current.messageIndex !== latestIndex,
    };
}

// A cheap content key: equal keys mean the pane can be kept as it is.
export function viewKey(view) {
    if (!view) return '';
    return JSON.stringify([view.def, view.body, view.messageIndex, view.error, view.truncated, view.changes.length]);
}
