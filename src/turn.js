// "This turn": what the latest reply changed, per block, for the in-chat strip and the
// tab badges. Pure, so the wording rules are testable on plain views from view.js.

import { describeChange } from './ui/displays/tree.js';

const LEADING_NUMBER = /^\s*[−-]?\d[\d,]*(?:\.\d+)?/;

function numberOf(text) {
    const match = LEADING_NUMBER.exec(String(text ?? ''));
    return match ? Number(match[0].replace(/[,\s]/g, '').replace('−', '-')) : null;
}

// A value that went down reads as a loss (Gold 100 → 85, HP 80 → 72); up as a gain.
function toneOfChange(change) {
    if (change.type === 'added') return 'up';
    if (change.type === 'removed') return 'down';
    // Rows compare their quantity first, then a number in the note (Coin Pouch 100 Gold → 85 Gold).
    if (change.before && change.after) {
        for (const field of ['quantity', 'remark']) {
            const before = numberOf(change.before[field]);
            const after = numberOf(change.after[field]);
            if (before !== null && after !== null && before !== after) return after < before ? 'down' : 'up';
        }
        return 'neutral';
    }
    const before = numberOf(change.from);
    const after = numberOf(change.to);
    if (before !== null && after !== null && before !== after) return after < before ? 'down' : 'up';
    return 'neutral';
}

function describe(change, def) {
    if (def.format === 'rows') return describeChange(change);
    if (change.type === 'added') return `${change.label}: ${change.to ?? ''}`.trim();
    if (change.type === 'removed') return `− ${change.label}`;
    return `${change.label} ${change.from ?? '—'} → ${change.to ?? '—'}`;
}

function firstLine(text) {
    return String(text ?? '').split('\n').map(line => line.trim()).find(Boolean) ?? '';
}

/** Changes this reply made to one block (badge count); 0 when its state came from an earlier reply. */
export function turnCount(view) {
    if (!view || view.fromEarlierReply) return 0;
    return view.changes?.length ?? 0;
}

/**
 * Strip items for the latest reply, in block order: problems first within a block, then its
 * changes. `views` is [{ view, tabId }] for the visible blocks.
 */
export function turnItems(views) {
    const items = [];
    for (const { view, tabId } of views) {
        if (!view) continue;
        const { def } = view;
        if (view.error) items.push({ tabId, block: def.name, text: `${def.name} couldn't be read`, tone: 'warn' });
        else if (view.truncated) items.push({ tabId, block: def.name, text: `${def.name} was cut off`, tone: 'warn' });
        // Choices are something to act on, not a change; they stay in their tab.
        if (def.display === 'choices') continue;
        if (def.kind === 'turn') {
            const line = firstLine(view.state?.text);
            if (line && !view.error) items.push({ tabId, block: def.name, text: `${def.name}: ${line}`, tone: 'neutral' });
            continue;
        }
        if (view.fromEarlierReply) continue;
        for (const change of view.changes ?? []) items.push({ tabId, block: def.name, text: describe(change, def), tone: toneOfChange(change) });
    }
    return items;
}
