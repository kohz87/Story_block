// The reply prompt: which blocks are asked for, the context section that asks for them, and
// prompt hygiene (old blocks and old context sections never reach the model twice).
// Port of Inventory Block's src/prompt.js, generalized to many blocks in one envelope.

import { formatFor } from './formats/index.js';
import { ENVELOPE_MARKER, replacesLastReply, stripBlocks } from './envelope.js';
import { promptRolls } from './dice.js';
import { changesOnly, changesTag } from './changes.js';
import { changeRules, changeSkeleton } from './formats/rows.js';

export const CONTEXT_BEGIN = 'STORY_BLOCKS_V1_CONTEXT_BEGIN';
export const CONTEXT_END = 'STORY_BLOCKS_V1_CONTEXT_END';
// (0.9.21) What changes from reply to reply (current states, rolls, this reply's notes) is a
// tail of its own, sent last, so the instructions above it stay the same prompt to prompt and
// a provider's prompt cache keeps everything before the tail.
export const STATE_BEGIN = 'STORY_BLOCKS_V1_STATE_BEGIN';
export const STATE_END = 'STORY_BLOCKS_V1_STATE_END';

const CONTEXT_RE = new RegExp(`${CONTEXT_BEGIN}[\\s\\S]*?${CONTEXT_END}`, 'g');
// With the blank line before it, so taking it out of a shared text leaves no gap.
const STATE_RE = new RegExp(`(?:\\n\\n)?${STATE_BEGIN}[\\s\\S]*?${STATE_END}`, 'g');
// In the instructions, where a Dice block's {{rolls}} would go: the rolls themselves are in the tail.
const ROLLS_LATER = 'given at the end of the prompt, under this reply';
const EMPTY_STATE = '(empty — start it from the story)';

function isAssistant(message) {
    return Boolean(message) && !message.is_user && !message.is_system;
}

function keywordPattern(keyword) {
    const escaped = String(keyword).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    // Whole word in any script: no letter, digit or underscore directly on either side.
    return escaped ? new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'iu') : null;
}

/**
 * Enabled blocks whose `when` fires for this generation, in definition order.
 * - `every`: the number of assistant replies so far, counting the reply being written, is a
 *   multiple of when.every. Regenerate/Swipe replace the last reply instead of adding one
 *   (same rule as stateForGeneration), and Continue extends the last reply.
 * - `keyword`: a keyword appears (case-insensitive, whole word) in the last when.scanDepth
 *   user or assistant messages, with blocks stripped so a block's own text cannot fire it.
 */
export function activeBlocks(defs, chat, type = 'normal') {
    const list = Array.isArray(chat) ? chat : [];
    const all = Array.isArray(defs) ? defs.filter(Boolean) : [];
    const history = replacesLastReply(list, type) ? list.slice(0, -1) : list;
    const continuing = String(type ?? '').toLowerCase().includes('continue') && isAssistant(history.at(-1));
    const replies = history.filter(isAssistant).length + (continuing ? 0 : 1);
    const spoken = history.filter(message => message && !message.is_system);
    const stripped = new Map();
    const scanned = message => {
        if (!stripped.has(message)) stripped.set(message, stripBlocks(String(message?.mes ?? ''), all));
        return stripped.get(message);
    };
    return all.filter(def => {
        if (def.enabled === false) return false;
        const when = def.when ?? {};
        if (when.mode === 'every') {
            const every = Math.max(1, Number.parseInt(when.every, 10) || 1);
            return replies % every === 0;
        }
        if (when.mode === 'keyword') {
            const depth = Math.max(1, Number.parseInt(when.scanDepth, 10) || 1);
            const patterns = (Array.isArray(when.keywords) ? when.keywords : []).map(keywordPattern).filter(Boolean);
            const recent = spoken.slice(-depth).map(scanned);
            return patterns.some(pattern => recent.some(text => pattern.test(text)));
        }
        return true;
    });
}

// Kept by another extension: shown as state, never written by the model.
function readOnly(def) {
    return Boolean(def?.kept);
}

function stateful(def) {
    return def?.kind === 'stateful' && !readOnly(def);
}

function lead(def) {
    return def?.kind === 'lead';
}

const KIND_NOTES = {
    stateful: 'kept: rewrite the full current state',
    turn: 'this reply only',
    lead: 'first: this reply only, written before the story',
};

function heading(def) {
    if (readOnly(def)) return `### ${def.name} — <${def.tag}> (kept by ${def.owner}: read it, never write it)`;
    if (changesOnly(def)) return `### ${def.name} — <${changesTag(def)}> (kept: write only the changes)`;
    return `### ${def.name} — <${def.tag}> (${KIND_NOTES[def.kind] ?? KIND_NOTES.turn})`;
}

// The Dice template's instructions grow by each kept block's dice modifier ("the matching
// stat's bonus from the <Character> block"), only while that block is in this prompt. The
// reader's stored prompt is never changed. Dice: Everyone is left alone: its rolls are
// often an NPC's, which a player's sheet says nothing about.
function diceBlock(def) {
    return def?.template === 'dice';
}

function withModifiers(prompt, modifiers) {
    if (!modifiers.length) return prompt;
    // Matches the Dice template's own "- Rule: …" lines when the prompt is written that way.
    const bullet = /^- /.test(prompt.split('\n').at(-1) ?? '') ? '- ' : '';
    return [prompt, ...modifiers.map(text => `${bullet}${text}`)].filter(Boolean).join('\n');
}

// {{rolls}}: the dice the extension rolled for this block and this reply. In the instructions
// (`entry.rolls === STATIC`) it points at the tail, where this reply's rolls are.
const STATIC = Symbol('static');
function withRolls(text, entry) {
    return String(text ?? '').replaceAll('{{rolls}}', entry?.rolls === STATIC ? ROLLS_LATER : promptRolls(entry?.rolls));
}

function stateLines(def, state) {
    const format = formatFor(def);
    const value = state ?? format.empty(def);
    const body = format.isEmpty(value) ? '' : String(format.serialize(value, def) ?? '').trim();
    // The empty note sits outside the tags so it is never copied into the block itself.
    if (!body) return [`Current state: ${EMPTY_STATE}`];
    return ['Current state:', `<${def.tag}>`, body, `</${def.tag}>`];
}

// The body a kept entry is shown with, or '' when there is nothing to show yet.
function readOnlyBody(entry) {
    const body = String(entry.body ?? '').trim();
    if (body) return body;
    const format = formatFor(entry.def);
    if (!entry.state || format.isEmpty(entry.state)) return '';
    return String(format.serialize(entry.state, entry.def) ?? '').trim();
}

// A kept block in the instructions: what it is and how to read it. Its newest copy, as the
// extension wrote it, is in the tail.
function readOnlyHead(entry, substitute) {
    const { def } = entry;
    const lines = [heading(def)];
    const note = String(substitute(def.promptNote ?? '') ?? '').trim();
    if (note) lines.push(note);
    return lines.join('\n');
}

// A block's instructions: its prompt, format and how to leave it out. With `withState` (a block
// only this reply asks for, so it is in the tail whole) also this reply's note and state.
function blockSection(entry, substitute, modifiers = [], { withState = false } = {}) {
    const { def } = entry;
    const lines = [heading(def)];
    const ownPrompt = String(substitute(withRolls(def.prompt, entry)) ?? '').trim();
    const prompt = diceBlock(def) ? withModifiers(ownPrompt, modifiers.map(text => String(substitute(text) ?? '').trim()).filter(Boolean)) : ownPrompt;
    if (prompt) lines.push(prompt);
    // A line the runtime adds for this reply only (handshake.js: chatterNote), after the prompt.
    const note = withState ? String(entry.note ?? '').trim() : '';
    if (note) lines.push(note);
    const rules = String((changesOnly(def) ? changeRules(def) : formatFor(def).rules(def)) ?? '').trim();
    if (rules) lines.push(`Format: ${rules}`);
    // (0.9.16) Nothing changed: no changes block; a big reorganisation may still write it whole.
    if (changesOnly(def)) lines.push(`Leave <${changesTag(def)}> out when this reply changes nothing. Only to reorganise the whole list, write the full <${def.tag}> block instead, every row included.`);
    if (def.optional) lines.push(`Optional: leave the whole <${def.tag}> tag out when nothing in this reply calls for it${lead(def) ? ', and then leave out the opening envelope too if it would be empty' : ''}.`);
    if (withState && stateful(def)) lines.push(...stateLines(def, entry.state));
    return lines.join('\n');
}

function skeletonPart(entry, substitute) {
    const { def } = entry;
    const changes = changesOnly(def);
    const tag = changes ? changesTag(def) : def.tag;
    const skeleton = String(substitute(withRolls(changes ? changeSkeleton(def) : formatFor(def).skeleton(def), entry)) ?? '').trim();
    return [`<${tag}>`, ...(skeleton ? [skeleton] : []), `</${tag}>`].join('\n');
}

// Skeletons are instructions like the block prompt, so {{user}}/{{char}} are filled in;
// the current state never is.
function skeletonEnvelope(list, substitute) {
    return `<!-- ${ENVELOPE_MARKER}\n<Blocks>\n${list.map(entry => skeletonPart(entry, substitute)).join('\n')}\n</Blocks>\n-->`;
}

const KEPT_RULE = 'Blocks marked "read it, never write it" are kept by another extension, not by you. Their current state is what is true right now: use it in the story, but never write their tags, in the envelope or anywhere else, and never change them yourself; the extension updates them.';

function rulesFor(defs, { kept = false } = {}) {
    const first = defs.filter(lead);
    const last = defs.filter(def => !lead(def));
    const rules = [
        last.length
            ? `At the very end of your reply, after the story, write exactly one hidden envelope holding the blocks below${first.length ? ' that are not marked "first"' : ''}, exactly as shown under "Write it exactly like this". The reader never sees it, so write it in every reply.`
            : 'Write the hidden envelope shown under "Write it exactly like this" in every reply. The reader never sees it.',
        'Write the blocks in the order given, each tag exactly once, and close every tag you open.',
        'Keep every envelope on its own lines, with a blank line between it and the story; never start or end a line of story on the same line as "<!--" or "-->".',
        'Never write the blocks, their tags or their contents as visible narration, and do not explain them in the story.',
        'Never write "-->" anywhere inside the envelope; write "--\\>" instead. A backslash escapes the character after it (for example --\\> or <\\Tag); keep such escapes exactly as written.',
        // (0.9.21) Everything that changes from reply to reply is in one place, near the end.
        'Each block\'s current state, and anything that holds only for the reply you are writing now, is given under "Story Blocks: this reply" near the end of the prompt.',
    ];
    if (defs.some(def => stateful(def) && !changesOnly(def))) {
        rules.push('Blocks marked "kept" carry state from reply to reply. The current state given for this reply is the only authoritative one; earlier copies in the story are history. Rewrite each kept block in full every reply, with only the changes this reply actually makes. It is never a patch or a list of changes: omission means loss, so keep everything that did not change.');
    }
    if (defs.some(changesOnly)) {
        rules.push('Blocks marked "write only the changes" also carry state, but you never rewrite them: write only what this reply changes, line by line, in their changes tag; everything not mentioned stays exactly as it is.');
    }
    if (first.length) {
        rules.push('Blocks marked "first" go in their own hidden envelope at the very start of your reply, before any story text: write that envelope first, decide it before you write the scene, and never revise it once the story exists. When none of them has anything this reply, leave that envelope out rather than writing it empty.');
    }
    if (defs.some(def => def.kind === 'turn')) {
        rules.push('Blocks marked "this reply only" describe this reply alone; write them fresh and never copy earlier ones.');
    }
    if (kept) rules.push(KEPT_RULE);
    return rules;
}

const sameBlock = (a, b) => Boolean(a && b) && (a === b || (a.id && a.id === b.id) || (a.tag && a.tag === b.tag));

/**
 * (0.9.21) The context section in two parts, for a provider's prompt cache:
 * - `static`: the rules, every block's instructions and the envelope to write — the same text
 *   reply after reply while the reader's blocks stay the same, sent early;
 * - `tail`: this reply's part — each block's current state, a kept block's newest copy, the
 *   dice rolled for this reply, a line the runtime adds for this reply only, a block only this
 *   reply asks for (whole), and a block of the instructions this reply leaves out — sent last.
 * entries: [{ def, state, rolls, note }] (as before; kept blocks' entries carry `body`).
 * `staticDefs`: the blocks the instructions always hold (default: this reply's own, which is
 * the 0.9.19 layout); `ruleDefs`: the blocks the rules are worded for (default: the static
 * ones and this reply's), so the rules too stay the same while the reader's blocks do.
 * `substitute` applies {{user}}/{{char}} to prompts and skeletons only, never to state.
 * Both '' when there is nothing to send.
 */
export function buildContextParts(entries, { substitute = text => text, staticDefs = null, ruleDefs = null } = {}) {
    const all = (Array.isArray(entries) ? entries : []).filter(entry => entry?.def);
    const kept = all.filter(entry => readOnly(entry.def))
        .map(entry => ({ ...entry, body: readOnlyBody(entry) }))
        .filter(entry => entry.body);
    const active = all.filter(entry => !readOnly(entry.def));
    const always = (Array.isArray(staticDefs) ? staticDefs : active.map(entry => entry.def)).filter(def => def && !readOnly(def));
    if (!always.length && !active.length && !kept.length) return { static: '', tail: '' };
    const modifiers = kept.map(entry => entry.def.diceModifier).filter(Boolean);
    const words = Array.isArray(ruleDefs) ? ruleDefs.filter(def => def && !readOnly(def)) : [...always, ...active.map(entry => entry.def).filter(def => !always.some(other => sameBlock(other, def)))];
    // Only kept blocks: nothing to write, so no envelope and no rules for one.
    const rules = always.length || active.length ? rulesFor(words, { kept: kept.length > 0 }) : [KEPT_RULE];

    // The instructions: rules, kept blocks' heads, every always-sent block, the envelope.
    const fixed = always.map(def => ({ def, rolls: STATIC }));
    const first = fixed.filter(entry => lead(entry.def));
    const last = fixed.filter(entry => !lead(entry.def));
    const head = [
        `${CONTEXT_BEGIN}\n## Story Blocks\n${rules.map(rule => `- ${rule}`).join('\n')}`,
        ...kept.map(entry => readOnlyHead(entry, substitute)),
        ...fixed.map(entry => blockSection(entry, substitute, modifiers)),
    ];
    const envelopes = fixed.length ? `Write it exactly like this:\n${[
        first.length ? skeletonEnvelope(first, substitute) : '',
        first.length && last.length ? '[your reply]' : '',
        last.length ? skeletonEnvelope(last, substitute) : '',
    ].filter(Boolean).join('\n')}\n` : '';
    const staticText = `${head.join('\n\n')}\n\n${envelopes}${CONTEXT_END}`;

    // This reply: states, rolls, notes, blocks only it asks for, blocks it leaves out.
    const parts = kept.map(entry => [`### ${entry.def.name}: current state (kept by ${entry.def.owner})`, `<${entry.def.tag}>`, entry.body, `</${entry.def.tag}>`].join('\n'));
    for (const entry of active) {
        const { def } = entry;
        if (!always.some(other => sameBlock(other, def))) {
            const tag = changesOnly(def) ? changesTag(def) : def.tag;
            parts.push(`${blockSection(entry, substitute, modifiers, { withState: true })}\nThis reply also writes <${tag}>, in the ${lead(def) ? 'first envelope' : 'envelope'}, like this:\n${skeletonPart(entry, substitute)}`);
            continue;
        }
        const lines = [];
        const note = String(entry.note ?? '').trim();
        if (note) lines.push(note);
        if (def.rolls?.count > 0 || String(def.prompt ?? '').includes('{{rolls}}')) lines.push(`This reply's rolls, in order: ${promptRolls(entry.rolls)}.`);
        if (stateful(def)) lines.push(...stateLines(def, entry.state));
        if (lines.length) parts.push([`### ${def.name}`, ...lines].join('\n'));
    }
    const skipped = always.filter(def => !active.some(entry => sameBlock(entry.def, def)));
    if (skipped.length) parts.push(`Leave ${skipped.map(def => `<${changesOnly(def) ? changesTag(def) : def.tag}>`).join(', ')} out of this reply.`);
    const tail = parts.length ? `${STATE_BEGIN}\n## Story Blocks: this reply\n${parts.join('\n\n')}\n${STATE_END}` : '';
    return { static: always.length || kept.length ? staticText : '', tail };
}

/**
 * The context section for one reply as one text: the instructions, then this reply's part
 * (buildContextParts). Used where the two are shown or counted together (preview, tokens).
 */
export function buildContext(entries, options = {}) {
    const { static: head, tail } = buildContextParts(entries, options);
    return [head, tail].filter(Boolean).join('\n\n');
}

/** True when `text` carries a context section (the placeholder or the real one). */
export function hasContext(text) {
    return typeof text === 'string' && ((text.includes(CONTEXT_BEGIN) && text.includes(CONTEXT_END)) || (text.includes(STATE_BEGIN) && text.includes(STATE_END)));
}

/**
 * SillyTavern runs macro substitution over extension prompts, which would rewrite
 * `{{user}}`, `{{roll:1d6}}` or `<USER>` inside block state. The extension prompt therefore
 * carries a defused copy that only reserves the place (and roughly the token budget); the
 * real context replaces it at prompt-ready.
 */
export function defuseMacros(text) {
    return String(text ?? '')
        .replace(/\{\{/g, '{​{')
        .replace(/<(USER|BOT|CHAR|CHARIFNOTGROUP|GROUP)>/gi, '<​$1>');
}

function removeOldContext(text) {
    return String(text ?? '').replace(CONTEXT_RE, '').replace(STATE_RE, '');
}

function sanitizeText(text, defs, options = {}) {
    return stripBlocks(removeOldContext(text), defs, options);
}

/**
 * Chat completion keeps roles, so only assistant messages (where blocks live) are fully
 * stripped; user and system content (messages, character cards, World Info) only lose our
 * hidden envelopes and legacy comments, plus visible history copies listed in knownBlocks,
 * keeping any block a person wrote there. A combined text-completion prompt has no roles
 * and is stripped fully.
 */
function stripOptions(message, knownBlocks) {
    return { bare: message?.role === 'assistant', knownBlocks };
}

// Message content is a string or, for multimodal prompts, an array of parts.
function mapContentText(content, transform) {
    if (typeof content === 'string') return transform(content);
    if (!Array.isArray(content)) return content;
    return content.map(part => {
        if (typeof part === 'string') return transform(part);
        if (part && typeof part === 'object' && typeof part.text === 'string') return { ...part, text: transform(part.text) };
        return part;
    });
}

function contentText(content) {
    const texts = [];
    mapContentText(content, text => { texts.push(text); return text; });
    return texts.join('\n');
}

function onlyText(content) {
    return typeof content === 'string'
        || (Array.isArray(content) && content.every(part => typeof part === 'string' || (part && typeof part.text === 'string')));
}

function insertSystemPrompt(chat, prompt) {
    let index = 0;
    while (index < chat.length && chat[index]?.role === 'system') index += 1;
    chat.splice(index, 0, { role: 'system', content: prompt });
}

// Where this reply's tail placeholder stood, kept through the clean-up and filled in after it.
const TAIL_SLOT = '\u0000STORY_BLOCKS_TAIL\u0000';

function markTailSlot(text) {
    let marked = false;
    const out = String(text ?? '').replace(STATE_RE, () => {
        if (marked) return '';
        marked = true;
        return TAIL_SLOT;
    });
    return { text: out, marked };
}

// This reply's part where its placeholder stood; none to put: the slot goes with its blank line.
function fillTailSlot(text, tail) {
    return tail ? String(text).replace(TAIL_SLOT, tail) : String(text).replace(/\s*\u0000STORY_BLOCKS_TAIL\u0000/, '');
}

// The index a system message goes at to sit after the last message the model answers: before a
// trailing assistant message (a Continue's own reply, or a prefill), else at the end.
function tailIndex(chat) {
    return chat.length && chat.at(-1)?.role === 'assistant' ? chat.length - 1 : chat.length;
}

/**
 * Foreground prompt: strip every block and every old context section from the prompt
 * history, then put the context in. `context` is the text (0.9.19 layout: all of it early) or
 * (0.9.21) `{ static, tail }` from buildContextParts:
 * - Chat completion (eventData.chat): the instructions go in as a system message after the
 *   leading system messages; this reply's part fills the placeholder SillyTavern put at depth 0
 *   (inside whatever message holds it, other extensions' tails included), or goes in as a
 *   system message right before the reply when there is none. A system message that only held
 *   placeholders is dropped. The shared array object is kept (splice) so other prompt-ready
 *   handlers holding a reference do not lose their work.
 * - Text completion (eventData.prompt): each placeholder is replaced in place (the
 *   instructions in the story string, this reply's part at depth 0); without one, the
 *   instructions are prepended and this reply's part follows them.
 * `options.knownBlocks`: visible history blocks (bareBlockTexts) to drop from user/system content.
 * An empty context only cleans the prompt. Returns { injected, kind, reason }.
 */
export function injectContext(eventData, context, defs, { knownBlocks = null } = {}) {
    if (!eventData || typeof eventData !== 'object' || eventData.dryRun === true) return { injected: false, reason: 'invalid-event' };
    const parts = typeof context === 'object' && context !== null ? context : { static: String(context ?? ''), tail: '' };
    const head = String(parts.static ?? '');
    const tail = String(parts.tail ?? '');
    const any = Boolean(head || tail);

    if (Array.isArray(eventData.chat)) {
        const chat = eventData.chat;
        const cleaned = [];
        let slotAt = -1;
        for (const message of chat) {
            let slot = false;
            const content = mapContentText(message?.content, part => {
                const marked = slotAt < 0 && !slot ? markTailSlot(part) : { text: part, marked: false };
                if (marked.marked) slot = true;
                return sanitizeText(marked.text, defs, stripOptions(message, knownBlocks));
            });
            const placeholderOnly = message?.role === 'system'
                && onlyText(message?.content)
                && hasContext(contentText(message.content))
                && !contentText(content).replace(TAIL_SLOT, '').trim();
            if (slot) slotAt = cleaned.length;
            if (placeholderOnly && !slot) continue;
            cleaned.push(message && typeof message === 'object' ? { ...message, content } : message);
        }
        if (slotAt >= 0) {
            const message = cleaned[slotAt];
            const filled = mapContentText(message.content, part => fillTailSlot(part, tail));
            if (contentText(filled).trim()) cleaned[slotAt] = { ...message, content: filled };
            else cleaned.splice(slotAt, 1);
        }
        chat.splice(0, chat.length, ...cleaned);
        if (!any) return { injected: false, kind: 'chat', reason: 'empty-context' };
        if (head) insertSystemPrompt(chat, head);
        if (tail && slotAt < 0) chat.splice(tailIndex(chat), 0, { role: 'system', content: tail });
        return { injected: true, kind: 'chat' };
    }

    if (typeof eventData.prompt === 'string') {
        const { text: prompt, marked } = markTailSlot(eventData.prompt);
        // The placeholder SillyTavern placed inside the story string is replaced in place.
        const begin = prompt.lastIndexOf(CONTEXT_BEGIN);
        const end = begin >= 0 ? prompt.indexOf(CONTEXT_END, begin) : -1;
        const fill = text => fillTailSlot(text, tail);
        if (begin >= 0 && end >= 0) {
            const close = end + CONTEXT_END.length;
            const after = marked ? fill(sanitizeText(prompt.slice(close), defs)) : sanitizeText(prompt.slice(close), defs);
            const lead = marked ? head : [head, tail].filter(Boolean).join('\n\n');
            eventData.prompt = `${sanitizeText(prompt.slice(0, begin), defs)}${lead}${after}`;
            return any ? { injected: true, kind: 'text-extension-prompt' } : { injected: false, kind: 'text-extension-prompt', reason: 'empty-context' };
        }
        // No instructions placeholder: they are prepended; this reply's part fills its own, else follows them.
        const clean = sanitizeText(prompt, defs);
        if (!any) {
            eventData.prompt = fillTailSlot(clean, '');
            return { injected: false, kind: 'text', reason: 'empty-context' };
        }
        const body = marked ? fill(clean) : clean;
        const lead = marked ? head : [head, tail].filter(Boolean).join('\n\n');
        eventData.prompt = lead ? `${lead}\n${body}` : body;
        return { injected: true, kind: 'text' };
    }

    return { injected: false, reason: 'unsupported-event' };
}

/** True when the prompt carries the context placeholder (or a context) anywhere. */
export function promptCarriesContext(eventData) {
    if (typeof eventData?.prompt === 'string') return hasContext(eventData.prompt);
    if (!Array.isArray(eventData?.chat)) return false;
    return eventData.chat.some(message => {
        const content = message?.content;
        if (typeof content === 'string') return hasContext(content);
        return Array.isArray(content) && content.some(part => hasContext(typeof part === 'string' ? part : part?.text));
    });
}
