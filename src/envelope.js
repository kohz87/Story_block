// Transport and extraction: where a reply's blocks live inside the message text.
//
// A reply carries its blocks at its end in one hidden HTML comment, the envelope:
//
//   <!-- STORY_BLOCKS_V1
//   <Blocks>
//   <Inventory>
//   Coin Pouch | 1 | 85 Gold
//   </Inventory>
//   </Blocks>
//   -->
//
// Models do not always write it that way: a bare <Blocks> (Megumin Suite and many presets),
// bare tags, a stray "-->" inside a body, or a reply cut off mid-envelope. Everything here
// therefore reads the text structurally first (`scan`), and the exported functions only
// decide what to do with what was found. Port of Inventory Block's src/snapshot.js,
// generalized from one <Inventory> block to many tags inside one envelope.

import { formatFor } from './formats/index.js';

export const ENVELOPE_MARKER = 'STORY_BLOCKS_V1';
export const CUT_MARKER = 'STORY_BLOCKS_V1_CUT';
// Inventory Block's own snapshots; read as the block whose tag is Inventory, never rewritten.
export const LEGACY_MARKER = 'INVENTORY_BLOCK_V05';

// `\b` after V1 keeps STORY_BLOCKS_V1_CUT and STORY_BLOCKS_V1_CONTEXT_* from matching the
// plain marker; the cut marker is listed first so it wins.
const COMMENT_OPENER = /<!--\s*(STORY_BLOCKS_V1_CUT|STORY_BLOCKS_V1|INVENTORY_BLOCK_V05)\b/gi;
// Attributes stay on the tag's own line, so a `<Blocks` cut off mid-tag never reaches
// forward to some unrelated `>` further down.
const BLOCKS_OPEN = /<Blocks(?:[ \t][^>\n]*)?>/gi;
const BLOCKS_CLOSE = /<\/Blocks\s*>/gi;
const ARROW = /-->/g;
const SENTENCE_END = /[.!?…]$/;
// Closing quotes, brackets and markdown emphasis that may follow a sentence's punctuation.
const CLOSING_MARKS = /["'”’»)\]*_~]+$/;

function kindOf(marker) {
    const upper = String(marker).toUpperCase();
    if (upper === CUT_MARKER) return 'cut';
    if (upper === LEGACY_MARKER) return 'legacy';
    return 'envelope';
}

function allMatches(source, pattern) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    return [...source.matchAll(new RegExp(pattern.source, flags))]
        .map(match => ({ index: match.index, end: match.index + match[0].length, match }));
}

function nextIndex(list, from, fallback) {
    const next = list.find(match => match.index >= from);
    return next ? next.index : fallback;
}

// Index just past `pattern` when it matches exactly at `from`.
function skip(source, from, pattern) {
    const sticky = new RegExp(pattern.source, `${pattern.flags.replace(/[gy]/g, '')}y`);
    sticky.lastIndex = from;
    const match = sticky.exec(source);
    return match ? from + match[0].length : from;
}

function trimBack(source, from, to) {
    let end = to;
    while (end > from && /\s/.test(source[end - 1])) end -= 1;
    return end;
}

function finishedLine(line) {
    return SENTENCE_END.test(String(line).trim().replace(CLOSING_MARKS, ''));
}

/** Known tags of `defs`, by lower-cased tag (first definition wins, as normalizeBlocks does). */
function tagIndex(defs) {
    const byTag = new Map();
    for (const def of Array.isArray(defs) ? defs : []) {
        const tag = String(def?.tag ?? '');
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(tag)) continue;
        const key = tag.toLowerCase();
        if (key === 'blocks' || byTag.has(key)) continue;
        byTag.set(key, def);
    }
    return byTag;
}

// `<Tag>` or `<Tag attr>`, never look-alikes such as `<Tag-notes>`; an escaped `<\Tag` is not a tag.
function tagOpens(source, byTag) {
    if (!byTag.size) return [];
    const names = [...byTag.values()].map(def => def.tag).join('|');
    return allMatches(source, new RegExp(`<(${names})(?:[ \\t][^>\\n]*)?>`, 'gi'))
        .map(open => ({ index: open.index, end: open.end, def: byTag.get(open.match[1].toLowerCase()) }));
}

function findClose(source, tag, from, to) {
    const pattern = new RegExp(`<\\/${tag}\\s*>`, 'gi');
    pattern.lastIndex = from;
    const match = pattern.exec(source);
    return match && match.index < to ? { index: match.index, end: match.index + match[0].length } : null;
}

/**
 * Block occurrences between `from` and `to`. A body never contains another opening tag of
 * its own block: without that rule a block cut off and followed by more text (Continue)
 * would swallow everything up to the next copy's closing tag. A tag that never closes is
 * truncated and ends where the next known tag opens. Tags nested inside a complete block's
 * body are part of that body, not blocks of their own.
 */
function entriesIn(source, from, to, opens) {
    const inside = opens.filter(open => open.index >= from && open.end <= to);
    const entries = [];
    let covered = from;
    for (let i = 0; i < inside.length; i++) {
        const open = inside[i];
        if (open.index < covered) continue;
        const nextSame = inside.find((other, j) => j > i && other.def === open.def);
        const close = findClose(source, open.def.tag, open.end, nextSame ? nextSame.index : to);
        if (close) {
            entries.push({ def: open.def, start: open.index, end: close.end, bodyStart: open.end, bodyEnd: close.index, truncated: false });
            covered = close.end;
        } else {
            const next = inside[i + 1];
            const end = next ? next.index : to;
            entries.push({ def: open.def, start: open.index, end, bodyStart: open.end, bodyEnd: end, truncated: true });
        }
    }
    return entries;
}

// A match outside every complete block body: a `-->` or `</Blocks>` a model wrote inside a
// body must not end the envelope early.
function firstUncovered(list, from, to, region) {
    const bodies = region.filter(entry => !entry.truncated);
    return list.find(match => match.index >= from && match.end <= to
        && !bodies.some(entry => match.index >= entry.bodyStart && match.index < entry.bodyEnd)) ?? null;
}

function standsAlone(source, start, end) {
    const lineStart = source.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = source.indexOf('\n', end);
    return !source.slice(lineStart, start).trim() && !source.slice(end, lineEnd < 0 ? source.length : lineEnd).trim();
}

// What a body line of each format looks like. Free text has no shape, so for text blocks a
// blank line followed by more text is the only sign that the block has ended.
function shapedLine(def, line) {
    if (def?.format === 'rows') return line.includes('|') || (line.startsWith('[') && line.endsWith(']'));
    if (def?.format === 'fields') return /^[^:|]{1,60}:/.test(line) || /^[-*•]\s/.test(line);
    return true;
}

// The last line of a cut-off block may be a partial line (`Coin Po`, `</Inven`) of any
// length, but not finished prose: a line whose text, ignoring closing quotes and brackets,
// ends in sentence punctuation is prose.
function partialLine(def, line) {
    if (shapedLine(def, line) || line.startsWith('[') || line.startsWith('<')) return true;
    return !finishedLine(line);
}

/**
 * Read the lines of a block that never closed, from `from` (just after its opening tag) to
 * `to`. `full` when every line belongs to the block (the cut fell inside it); otherwise
 * `end` is where the block's own lines stop and the text after it (prose) begins.
 */
function blockTail(def, source, from, to) {
    const freeText = def?.format !== 'rows' && def?.format !== 'fields';
    const lines = source.slice(from, to).split('\n');
    let offset = from;
    let end = from;
    let seen = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const lineEnd = offset + lines[i].length;
        const more = () => lines.slice(i + 1).some(rest => rest.trim());
        if (!line) {
            if (freeText && seen && more()) return { full: false, end };
            offset = lineEnd + 1;
            continue;
        }
        if (!shapedLine(def, line)) return { full: !more() && partialLine(def, line), end };
        seen = true;
        end = lineEnd;
        offset = lineEnd + 1;
    }
    return { full: true, end };
}

// Where finished narration starts in the text after an unterminated container's last block,
// or null when that text is only a fragment of the cut (`</Inven`, `</Blo`, `-`).
function proseStart(source, from, to) {
    let offset = from;
    for (const raw of source.slice(from, to).split('\n')) {
        const line = raw.trim();
        if (line && !/^[<-]/.test(line)) {
            const rest = source.slice(offset, to).trim().split('\n');
            return finishedLine(rest.at(-1)) ? offset : null;
        }
        offset += raw.length + 1;
    }
    return null;
}

/**
 * End of the part of an unterminated envelope or <Blocks> that belongs to it. Normally the
 * cut fell inside it and everything up to `limit` is hidden; when finished prose follows the
 * last block (a model that forgot to close the envelope, or text continued after a cut),
 * only the block lines are taken and the prose stays visible.
 */
function openEnd(ctx, from, limit) {
    const { source, opens } = ctx;
    const region = entriesIn(source, from, limit, opens);
    const complete = region.filter(entry => !entry.truncated);
    // An envelope's own `<Blocks>` opener is not part of the tail.
    const tailStart = complete.length ? complete.at(-1).end : skip(source, from, /\s*<Blocks(?:[ \t][^>\n]*)?>/i);
    if (!source.slice(tailStart, limit).trim()) return trimBack(source, from, limit);
    const truncated = region.filter(entry => entry.truncated && entry.start >= tailStart);
    if (truncated.length && !source.slice(tailStart, truncated[0].start).trim()) {
        const last = truncated.at(-1);
        const tail = blockTail(last.def, source, last.bodyStart, limit);
        return tail.full ? trimBack(source, from, limit) : Math.max(tail.end, last.bodyStart);
    }
    const prose = proseStart(source, tailStart, limit);
    return trimBack(source, from, prose ?? limit);
}

function commentContainer(ctx, opener) {
    const { source } = ctx;
    const length = source.length;
    const start = opener.index;
    if (opener.kind === 'cut') {
        // Written by normalizeTransport only, with every "-->" inside escaped.
        const innerStart = skip(source, opener.end, /[ \t]*\n?/);
        const close = source.indexOf('-->', opener.end);
        if (close < 0) return { kind: 'cut', status: 'open', start, innerStart, innerEnd: length, end: length, toEnd: true };
        const innerEnd = Math.max(innerStart, source[close - 1] === '\n' ? close - 1 : close);
        return { kind: 'cut', status: 'complete', start, innerStart, innerEnd, end: close + 3, toEnd: !source.slice(close + 3).trim() };
    }
    const limit = nextIndex(ctx.comments, opener.end, length);
    if (opener.kind === 'legacy') {
        const closing = /<\/Inventory\s*>\s*-->/gi;
        closing.lastIndex = opener.end;
        const block = closing.exec(source);
        const arrow = block && block.index < limit
            ? { index: block.index + block[0].length - 3, end: block.index + block[0].length }
            : ctx.arrows.find(match => match.index >= opener.end && match.index < limit);
        if (!arrow) return { kind: 'legacy', status: 'open', start, innerStart: opener.end, innerEnd: limit, end: limit };
        return { kind: 'legacy', status: 'complete', start, innerStart: opener.end, innerEnd: arrow.index, end: arrow.end };
    }

    const region = entriesIn(source, opener.end, limit, ctx.opens);
    const close = firstUncovered(ctx.blockCloses, opener.end, limit, region);
    if (close) {
        const rest = source.slice(close.end, limit);
        const closer = /^\s*-->/.exec(rest);
        const wellFormed = !source.slice(opener.end, close.index).includes('-->');
        const base = { kind: 'envelope', start, innerStart: opener.end, innerEnd: close.index, wrapEnd: close.end, hasBlocksClose: true };
        if (closer) return { ...base, status: 'complete', end: close.end + closer[0].length, wellFormed };
        // `</Blocks>` without the comment closer. At the very end of the text that is a cut
        // (possibly mid-closer: `</Blocks>\n-`), which Continue may still finish.
        const toEnd = limit === length && /^\s*-{0,2}\s*$/.test(rest);
        return { ...base, status: 'unclosed', end: toEnd ? length : close.end, toEnd };
    }
    // No `</Blocks>`: an envelope written without the wrapper ends at its first `-->` outside a body.
    const arrow = firstUncovered(ctx.arrows, opener.end, limit, region);
    if (arrow) {
        const wellFormed = !source.slice(opener.end, arrow.index).includes('-->');
        return { kind: 'envelope', status: 'complete', start, innerStart: opener.end, innerEnd: arrow.index, wrapEnd: arrow.index, end: arrow.end, wellFormed, hasBlocksClose: false };
    }
    const end = openEnd(ctx, opener.end, limit);
    return { kind: 'envelope', status: 'open', start, innerStart: opener.end, innerEnd: end, end, toEnd: !source.slice(end).trim() };
}

function blocksContainer(ctx, open) {
    const { source } = ctx;
    const length = source.length;
    const limit = Math.min(nextIndex(ctx.comments, open.end, length), nextIndex(ctx.blockOpens, open.end, length));
    const region = entriesIn(source, open.end, limit, ctx.opens);
    const close = firstUncovered(ctx.blockCloses, open.end, limit, region);
    if (close) {
        // A `-->` straight after a bare `</Blocks>` is the closer of an envelope whose opener
        // the model mangled; it belongs to the blocks, not to the story.
        const stray = /^\s*-->/.exec(source.slice(close.end, limit));
        return { kind: 'blocks', status: 'complete', start: open.index, innerStart: open.end, innerEnd: close.index, wrapEnd: close.end, end: close.end + (stray ? stray[0].length : 0) };
    }
    // An unclosed `<Blocks>` counts only when blocks follow it or it stands on its own line;
    // prose such as "the <Blocks> tag" is left alone.
    const leads = region.length && !source.slice(open.end, region[0].start).trim();
    if (!leads && !region.some(entry => !entry.truncated) && !standsAlone(source, open.index, open.end)) return null;
    const end = openEnd(ctx, open.end, limit);
    return { kind: 'blocks', status: 'open', start: open.index, innerStart: open.end, innerEnd: end, end, toEnd: !source.slice(end).trim() };
}

/**
 * Structure of a message text: containers (our envelopes, cut-off envelopes, legacy Inventory
 * comments, bare <Blocks>) in order, each with the block entries inside it, and the bare
 * entries outside every container. A bare tag that never closes counts only when it stands
 * on its own line; "keep an <Inventory> of …" in prose is not a block.
 */
function scan(text, defs) {
    const source = String(text ?? '');
    const opens = tagOpens(source, tagIndex(defs));
    const ctx = {
        source,
        opens,
        comments: allMatches(source, COMMENT_OPENER).map(match => ({ ...match, kind: kindOf(match.match[1]) })),
        blockOpens: allMatches(source, BLOCKS_OPEN),
        blockCloses: allMatches(source, BLOCKS_CLOSE),
        arrows: allMatches(source, ARROW),
    };
    const containers = [];
    let position = 0;
    for (;;) {
        const comment = ctx.comments.find(match => match.index >= position);
        const blocks = ctx.blockOpens.find(match => match.index >= position);
        if (!comment && !blocks) break;
        let container;
        if (comment && (!blocks || comment.index <= blocks.index)) {
            container = commentContainer(ctx, comment);
        } else {
            container = blocksContainer(ctx, blocks);
            if (!container) {
                position = blocks.end;
                continue;
            }
        }
        container.entries = entriesIn(source, container.innerStart, container.innerEnd, opens);
        containers.push(container);
        position = Math.max(container.end, position + 1);
    }
    const bare = [];
    let gapStart = 0;
    for (const range of [...containers, { start: source.length, end: source.length }]) {
        for (const entry of entriesIn(source, gapStart, range.start, opens)) {
            if (!entry.truncated || standsAlone(source, entry.start, entry.bodyStart)) bare.push(entry);
        }
        gapStart = range.end;
    }
    return { source, containers, bare };
}

function escapeArrows(text) {
    return String(text).replace(/-->/g, '--\\>');
}

// What a body moved into the envelope must not contain raw: "-->" (ends the comment), the
// envelope tag and the block's own tag. Uses the backslash escapes of formats/escape.js
// without doubling backslashes, so an already escaped body passes through unchanged.
function escapeInner(body, tag) {
    const names = /^[A-Za-z][A-Za-z0-9_]*$/.test(String(tag ?? '')) ? `Blocks|${tag}` : 'Blocks';
    return escapeArrows(body).replace(new RegExp(`<(\\/?)(${names})\\b`, 'gi'), '<\\$1$2');
}

function envelopeText(parts) {
    return `<!-- ${ENVELOPE_MARKER}\n<Blocks>\n${parts.join('\n')}\n</Blocks>\n-->`;
}

function cutText(raw) {
    return `<!-- ${CUT_MARKER}\n${escapeArrows(raw)}\n-->`;
}

function blockText(def, body, { close = true } = {}) {
    const inner = escapeInner(String(body ?? '').trim(), def.tag);
    const open = inner ? `<${def.tag}>\n${inner}` : `<${def.tag}>`;
    return close ? `${open}\n</${def.tag}>` : open;
}

function applyEdits(source, edits) {
    let result = source;
    for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
        result = `${result.slice(0, edit.start)}${edit.text}${result.slice(edit.end)}`;
    }
    return result;
}

function entryView(source, entry, container) {
    return {
        def: entry.def,
        body: source.slice(entry.bodyStart, entry.bodyEnd).trim(),
        start: entry.start,
        end: entry.end,
        truncated: entry.truncated,
        container,
    };
}

/**
 * Every occurrence of every def's tag in `text`, in text order:
 * [{ def, body, start, end, truncated, container }]. `body` is the raw (escaped) text,
 * trimmed. `container` says where it was found: 'envelope', 'cut', 'legacy', 'blocks'
 * (a bare <Blocks>) or null (a bare tag).
 */
export function extractBlocks(text, defs) {
    const { source, containers, bare } = scan(text, defs);
    const found = [
        ...containers.flatMap(container => container.entries.map(entry => entryView(source, entry, container.kind))),
        ...bare.map(entry => entryView(source, entry, null)),
    ];
    return found.sort((a, b) => a.start - b.start);
}

function parseBody(def, body) {
    try {
        return formatFor(def).parse(body, def) ?? { ok: false, error: 'Unreadable block.' };
    } catch (caught) {
        return { ok: false, error: String(caught?.message ?? caught) };
    }
}

/**
 * The newest complete, valid occurrence of `def` in one message text: { state, body, start,
 * end } or null. A cut that Continue finished is rejoined first, so offsets refer to
 * rejoinContinuation(text) (the same text for every message normalized on receive).
 */
export function latestBlockInText(text, def) {
    if (!def) return null;
    const entries = extractBlocks(rejoinContinuation(text), [def]).filter(entry => !entry.truncated);
    for (let i = entries.length - 1; i >= 0; i--) {
        const parsed = parseBody(def, entries[i].body);
        if (parsed.ok) return { state: parsed.state, body: entries[i].body, start: entries[i].start, end: entries[i].end };
    }
    return null;
}

function isAssistant(message) {
    return Boolean(message) && !message.is_user && !message.is_system;
}

/**
 * Scan assistant messages from newest to oldest, before `beforeIndex` when given:
 * { state, body, messageIndex, message } for the newest valid copy, or null. Invalid or
 * cut-off copies are skipped, so they never replace the current state.
 */
export function latestBlockState(chat, def, { beforeIndex = null } = {}) {
    const list = Array.isArray(chat) ? chat : [];
    const end = beforeIndex === null || beforeIndex === undefined
        ? list.length
        : Math.max(0, Math.min(list.length, Number(beforeIndex) || 0));
    for (let messageIndex = end - 1; messageIndex >= 0; messageIndex--) {
        const message = list[messageIndex];
        if (!isAssistant(message)) continue;
        const found = latestBlockInText(message.mes, def);
        if (found) return { state: found.state, body: found.body, messageIndex, message };
    }
    return null;
}

/**
 * Regenerate and Swipe replace the final message only when it is an assistant reply; when
 * the chat ends with the user's message (for example after a failed reply) nothing is
 * replaced. This also holds once SillyTavern has already removed the replaced reply.
 */
export function replacesLastReply(chat, type = 'normal') {
    const lower = String(type ?? 'normal').toLowerCase();
    const last = Array.isArray(chat) ? chat.at(-1) : null;
    return (lower.includes('regenerate') || lower.includes('swipe')) && isAssistant(last);
}

/** Baseline state of a stateful block for a generation (port of inventoryForGeneration). */
export function stateForGeneration(chat, def, type = 'normal') {
    const list = Array.isArray(chat) ? chat : [];
    const found = latestBlockState(list, def, replacesLastReply(list, type) ? { beforeIndex: list.length - 1 } : {});
    return found ? found.state : formatFor(def).empty(def);
}

// A reply that ends in an incomplete envelope opener (`<!-- STORY_BL`) was cut before its
// blocks began. Hiding it as a cut lets Continue complete the opener.
function trailingPartialOpener(source) {
    const match = /<!(?:-{1,2}\s*([A-Za-z0-9_]*))?$/.exec(source);
    if (!match) return null;
    const word = String(match[1] ?? '').toUpperCase();
    return CUT_MARKER.startsWith(word) ? match.index : null;
}

function containerEdit(source, container) {
    const { kind, status, start, end } = container;
    if (kind === 'legacy' || kind === 'cut') return null;
    if (kind === 'blocks' && !container.entries.length) return null;
    if ((status === 'open' || status === 'unclosed') && container.toEnd) {
        return { start, end: source.length, text: cutText(source.slice(start)) };
    }
    if (kind === 'envelope') {
        if (status === 'complete') {
            if (container.wellFormed) return null;
            return { start, end, text: `${escapeArrows(source.slice(start, container.wrapEnd))}${source.slice(container.wrapEnd, end)}` };
        }
        const stop = status === 'unclosed' ? container.wrapEnd : end;
        return { start, end: stop, text: `${escapeArrows(source.slice(start, stop))}\n-->` };
    }
    const stop = status === 'complete' ? container.wrapEnd : end;
    return { start, end, text: `<!-- ${ENVELOPE_MARKER}\n${escapeArrows(source.slice(start, stop))}\n-->` };
}

/**
 * Bare blocks to hide. A complete one is always hidden. One that never closes is hidden
 * when its lines look like the block's own (the cut fell inside it); when finished prose
 * follows and another block or envelope comes after (a block cut off and then continued),
 * only its own lines are hidden. Otherwise it is left alone: an unclosed tag followed by
 * finished narration may be prose.
 */
function bareSpans(source, bare) {
    const spans = [];
    for (const entry of bare) {
        if (!entry.truncated) {
            spans.push({ entry, start: entry.start, end: entry.end });
            continue;
        }
        const tail = blockTail(entry.def, source, entry.bodyStart, entry.end);
        if (tail.full) spans.push({ entry, start: entry.start, end: trimBack(source, entry.bodyStart, entry.end) });
        else if (source.slice(entry.end).trim()) spans.push({ entry, start: entry.start, end: tail.end });
    }
    return spans;
}

function bareEdits(source, bare) {
    // Blocks separated only by whitespace share one envelope at the place they were written.
    const runs = [];
    for (const span of bareSpans(source, bare)) {
        const run = runs.at(-1);
        if (run && !source.slice(run.at(-1).end, span.start).trim()) run.push(span);
        else runs.push([span]);
    }
    return runs.map(run => {
        const start = run[0].start;
        const last = run.at(-1);
        if (last.entry.truncated && !source.slice(last.end).trim()) {
            return { start, end: source.length, text: cutText(source.slice(start)) };
        }
        const parts = run.map(({ entry, end }) => (entry.truncated
            ? blockText(entry.def, source.slice(entry.bodyStart, end), { close: false })
            : blockText(entry.def, source.slice(entry.bodyStart, entry.bodyEnd))));
        return { start, end: last.end, text: envelopeText(parts) };
    });
}

/**
 * Hide model-written blocks from the narration. A bare <Blocks>…</Blocks> holding known
 * blocks, or bare known tags, become one hidden envelope at the same place (bodies escaped
 * for the comment). An envelope with a raw "-->" inside a body is repaired. An envelope or
 * <Blocks> cut off before its end is hidden to the end of the text under CUT_MARKER, so
 * Continue can still complete it (see rejoinContinuation). Finished prose after a cut-off
 * block is never hidden. Idempotent; legacy INVENTORY_BLOCK_V05 comments and a bare
 * <Blocks> without known blocks (another extension's) are left alone.
 */
export function normalizeTransport(text, defs) {
    const original = String(text ?? '');
    const { source, containers, bare } = scan(rejoinContinuation(original), defs);
    const edits = [...containers.map(container => containerEdit(source, container)).filter(Boolean), ...bareEdits(source, bare)];
    const partial = trailingPartialOpener(source);
    const covered = Math.max(0, ...containers.map(container => container.end), ...edits.map(edit => edit.end));
    if (partial !== null && partial >= covered && !edits.some(edit => edit.end > partial)) {
        edits.push({ start: partial, end: source.length, text: cutText(source.slice(partial)) });
    }
    const result = applyEdits(source, edits);
    return { text: result, changed: result !== original };
}

// Closes something the continuation never opened: `</Inventory>`, `</Blocks>` or `-->`
// finishing the cut-off envelope, as opposed to a new block written after it.
function closesUnopened(text) {
    for (const match of text.matchAll(/-->|<\/([A-Za-z][A-Za-z0-9_]*)/g)) {
        const before = text.slice(0, match.index);
        if (match[0] === '-->') {
            if (!before.includes('<!--')) return true;
        } else if (!new RegExp(`<${match[1]}(?![A-Za-z0-9_])`, 'i').test(before)) {
            return true;
        }
    }
    return false;
}

function continuesCut(text) {
    if (!text.trim()) return false;
    // Picks up exactly where the cut fell (`ld`, `tory>`, `->`).
    if (/^[^\s<]/.test(text)) return true;
    if (closesUnopened(text)) return true;
    // A further row or a fragment before any new tag; finished narration is not a continuation.
    const tagAt = text.search(/<[A-Za-z!]/);
    const head = text.slice(0, tagAt < 0 ? text.length : tagAt).trim();
    return Boolean(head) && !finishedLine(head.split('\n').at(-1));
}

/**
 * Continue after a cut: SillyTavern appends the continuation straight after the CUT envelope
 * normalizeTransport wrote. When that text continues the cut (it starts right at the cut,
 * closes the cut-off tags or envelope, or is a further unfinished line), the wrapper is
 * removed and the halves rejoin so normalizeTransport can hide the completed whole (port of
 * rejoinContinuedCuts). A cut followed by finished prose or by a new block stays as it is.
 */
export function rejoinContinuation(text) {
    let source = String(text ?? '');
    const openers = allMatches(source, COMMENT_OPENER);
    for (let i = openers.length - 1; i >= 0; i--) {
        const opener = openers[i];
        if (kindOf(opener.match[1]) !== 'cut') continue;
        const close = source.indexOf('-->', opener.end);
        if (close < 0) continue;
        const end = close + 3;
        const next = openers.find(other => other.index >= end);
        if (!continuesCut(source.slice(end, next ? next.index : source.length))) continue;
        const innerStart = skip(source, opener.end, /[ \t]*\n?/);
        const innerEnd = Math.max(innerStart, source[close - 1] === '\n' ? close - 1 : close);
        source = `${source.slice(0, opener.index)}${source.slice(innerStart, innerEnd)}${source.slice(end)}`;
    }
    return source;
}

function removeRanges(source, ranges) {
    let result = source;
    for (const [start, end] of [...ranges].sort((a, b) => b[0] - a[0])) result = `${result.slice(0, start)}${result.slice(end)}`;
    return result;
}

function containerRange(source, container) {
    return [container.start, container.toEnd ? source.length : container.end];
}

/**
 * Remove every envelope (complete or CUT), every legacy INVENTORY_BLOCK_V05 comment, every
 * bare <Blocks>…</Blocks> and every bare known tag of `defs`. Leaves the surrounding text
 * intact. With `bare: false` only the hidden envelopes and legacy comments go, plus visible
 * copies listed in `knownBlocks` (trimmed raw texts, see bareBlockTexts): a block a person
 * wrote into a message, character card or World Info entry reaches the model untouched.
 */
export function stripBlocks(text, defs, { bare = true, knownBlocks = null } = {}) {
    if (bare) {
        const { source, containers } = scan(normalizeTransport(text, defs).text, defs);
        return removeRanges(source, containers.map(container => containerRange(source, container)));
    }
    const { source, containers, bare: entries } = scan(rejoinContinuation(text), defs);
    const ranges = containers.filter(container => container.kind !== 'blocks').map(container => containerRange(source, container));
    if (knownBlocks?.size) {
        for (const container of containers) {
            if (container.kind === 'blocks' && container.status === 'complete' && knownBlocks.has(source.slice(container.start, container.wrapEnd).trim())) {
                ranges.push([container.start, container.end]);
            }
        }
        for (const entry of entries) {
            if (!entry.truncated && knownBlocks.has(source.slice(entry.start, entry.end).trim())) ranges.push([entry.start, entry.end]);
        }
    }
    return removeRanges(source, ranges);
}

/**
 * Raw text of the visible complete blocks in `text`: bare <Blocks>…</Blocks> and bare tags.
 * Collected from chat history so copies that presets embed in user/system content can be
 * told apart from blocks a person wrote there.
 */
export function bareBlockTexts(text, defs) {
    const { source, containers, bare } = scan(text, defs);
    const found = [];
    for (const container of containers) {
        if (container.kind === 'blocks' && container.status === 'complete') found.push(source.slice(container.start, container.wrapEnd).trim());
    }
    for (const entry of bare) if (!entry.truncated) found.push(source.slice(entry.start, entry.end).trim());
    return found;
}

// A cut-off envelope holding `def`, or the one the reply ended in, cannot take an edit
// (Continue would rejoin around it), so it becomes a closed envelope first; its complete
// blocks stay readable, cut ones stay cut. A cut that holds only part of an opener goes.
function closeCuts(source, plan) {
    const edits = plan.containers.filter(container => container.kind === 'cut' && (container.entries.length || container.toEnd)).map(container => {
        let inner = source.slice(container.innerStart, container.innerEnd).replace(/^\s*<!--\s*STORY_BLOCKS_V1\b[ \t]*\n?/i, '');
        if (!/<[A-Za-z]/.test(inner)) return { start: container.start, end: container.end, text: '' };
        const close = /<\/Blocks\s*>/i.exec(inner);
        if (close) inner = inner.slice(0, close.index + close[0].length);
        else if (/<Blocks(?:[ \t][^>\n]*)?>/i.test(inner)) inner = `${inner.trimEnd()}\n</Blocks>`;
        else inner = `<Blocks>\n${inner.trim()}\n</Blocks>`;
        return { start: container.start, end: container.end, text: `<!-- ${ENVELOPE_MARKER}\n${inner.trim()}\n-->` };
    });
    return applyEdits(source, edits);
}

// A cut-off copy being replaced ends at the next line that starts a tag, so blocks the scan
// does not know about (only `def` is passed in) are kept.
function truncatedEditEnd(source, entry) {
    const nextTag = /\n[ \t]*<\/?[A-Za-z]/g;
    nextTag.lastIndex = entry.bodyStart;
    const match = nextTag.exec(source);
    return trimBack(source, entry.bodyStart, match && match.index < entry.end ? match.index : entry.end);
}

/**
 * Write `body` (already serialized and escaped) as `def`'s block inside the message's
 * envelope: replaces the newest copy in an envelope, else adds the block to the last
 * envelope, else appends a new envelope at the end of the text.
 */
export function upsertBlock(text, def, body) {
    const block = blockText(def, body);
    let source = normalizeTransport(text, [def]).text;
    source = closeCuts(source, scan(source, [def]));
    const { containers } = scan(source, [def]);
    const envelopes = containers.filter(container => container.kind === 'envelope' && container.status === 'complete');
    const target = envelopes.flatMap(container => container.entries).at(-1);
    if (target) {
        const end = target.truncated ? truncatedEditEnd(source, target) : target.end;
        return `${source.slice(0, target.start)}${block}${source.slice(end)}`;
    }
    const envelope = envelopes.at(-1);
    if (envelope) {
        const at = trimBack(source, envelope.innerStart, envelope.innerEnd);
        return `${source.slice(0, at)}\n${block}${source.slice(at)}`;
    }
    const kept = source.trimEnd();
    return kept ? `${kept}\n\n${envelopeText([block])}` : envelopeText([block]);
}
