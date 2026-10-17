// The reply prompt: which blocks are asked for, the context section that asks for them, and
// prompt hygiene (old blocks and old context sections never reach the model twice).
// Port of Inventory Block's src/prompt.js, generalized to many blocks in one envelope.

import { formatFor } from './formats/index.js';
import { ENVELOPE_MARKER, replacesLastReply, stripBlocks } from './envelope.js';
import { formatRolls } from './dice.js';

export const CONTEXT_BEGIN = 'STORY_BLOCKS_V1_CONTEXT_BEGIN';
export const CONTEXT_END = 'STORY_BLOCKS_V1_CONTEXT_END';

const CONTEXT_RE = new RegExp(`${CONTEXT_BEGIN}[\\s\\S]*?${CONTEXT_END}`, 'g');
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

function stateful(def) {
    return def?.kind === 'stateful';
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
    return `### ${def.name} — <${def.tag}> (${KIND_NOTES[def.kind] ?? KIND_NOTES.turn})`;
}

// {{rolls}}: the dice the extension rolled for this block and this reply.
function withRolls(text, entry) {
    return String(text ?? '').replaceAll('{{rolls}}', formatRolls(entry.rolls));
}

function currentState(def, state) {
    const format = formatFor(def);
    const value = state ?? format.empty(def);
    const body = format.isEmpty(value) ? '' : String(format.serialize(value, def) ?? '').trim();
    // The empty note sits outside the tags so it is never copied into the block itself.
    if (!body) return [`Current state: ${EMPTY_STATE}`];
    return ['Current state:', `<${def.tag}>`, body, `</${def.tag}>`];
}

function blockSection(entry, substitute) {
    const { def } = entry;
    const lines = [heading(def)];
    const prompt = String(substitute(withRolls(def.prompt, entry)) ?? '').trim();
    if (prompt) lines.push(prompt);
    const rules = String(formatFor(def).rules(def) ?? '').trim();
    if (rules) lines.push(`Format: ${rules}`);
    if (def.optional) lines.push(`Optional: leave the whole <${def.tag}> tag out when nothing in this reply calls for it${lead(def) ? ', and then leave out the opening envelope too if it would be empty' : ''}.`);
    if (stateful(def)) lines.push(...currentState(def, entry.state));
    return lines.join('\n');
}

// Skeletons are instructions like the block prompt, so {{user}}/{{char}} are filled in;
// the current state never is.
function skeletonEnvelope(list, substitute) {
    const parts = list.map(entry => {
        const { def } = entry;
        const skeleton = String(substitute(withRolls(formatFor(def).skeleton(def), entry)) ?? '').trim();
        return [`<${def.tag}>`, ...(skeleton ? [skeleton] : []), `</${def.tag}>`].join('\n');
    });
    return `<!-- ${ENVELOPE_MARKER}\n<Blocks>\n${parts.join('\n')}\n</Blocks>\n-->`;
}

/**
 * The context section for one reply. entries: [{ def, state }] (state only for stateful
 * blocks, in prompt order). `substitute` applies {{user}}/{{char}} to block prompts and skeletons only —
 * never to state, which must reach the model verbatim. '' when entries is empty.
 */
export function buildContext(entries, { substitute = text => text } = {}) {
    const list = (Array.isArray(entries) ? entries : []).filter(entry => entry?.def);
    if (!list.length) return '';
    const first = list.filter(entry => lead(entry.def));
    const last = list.filter(entry => !lead(entry.def));
    const rules = [
        last.length
            ? `At the very end of your reply, after the story, write exactly one hidden envelope holding the blocks below${first.length ? ' that are not marked "first"' : ''}, exactly as shown under "Write it exactly like this". The reader never sees it, so write it in every reply.`
            : 'Write the hidden envelope shown under "Write it exactly like this" in every reply. The reader never sees it.',
        'Write the blocks in the order given, each tag exactly once, and close every tag you open.',
        'Never write the blocks, their tags or their contents as visible narration, and do not explain them in the story.',
        'Never write "-->" anywhere inside the envelope; write "--\\>" instead. A backslash escapes the character after it (for example --\\> or <\\Tag); keep such escapes exactly as written.',
    ];
    if (list.some(entry => stateful(entry.def))) {
        rules.push('Blocks marked "kept" carry state from reply to reply. The current state shown here is the only authoritative one; earlier copies in the story are history. Rewrite each kept block in full every reply, with only the changes this reply actually makes. It is never a patch or a list of changes: omission means loss, so keep everything that did not change.');
    }
    if (first.length) {
        rules.push('Blocks marked "first" go in their own hidden envelope at the very start of your reply, before any story text: write that envelope first, decide it before you write the scene, and never revise it once the story exists.');
    }
    if (list.some(entry => entry.def.kind === 'turn')) {
        rules.push('Blocks marked "this reply only" describe this reply alone; write them fresh and never copy earlier ones.');
    }
    const sections = list.map(entry => blockSection(entry, substitute));
    return `${CONTEXT_BEGIN}\n## Story Blocks\n${rules.map(rule => `- ${rule}`).join('\n')}\n\n` +
        `${sections.join('\n\n')}\n\n` +
        `Write it exactly like this:\n${[
            first.length ? skeletonEnvelope(first, substitute) : '',
            first.length && last.length ? '[your reply]' : '',
            last.length ? skeletonEnvelope(last, substitute) : '',
        ].filter(Boolean).join('\n')}\n${CONTEXT_END}`;
}

/** True when `text` carries a context section (the placeholder or the real one). */
export function hasContext(text) {
    return typeof text === 'string' && text.includes(CONTEXT_BEGIN) && text.includes(CONTEXT_END);
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
    return String(text ?? '').replace(CONTEXT_RE, '');
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

/**
 * Foreground prompt: strip every block and every old context section from the prompt
 * history, then insert `context`.
 * - Chat completion (eventData.chat): a system message that only held the placeholder is
 *   dropped, the placeholder region is removed from a shared message, and `context` goes in
 *   as a system message after the leading system messages. The shared array object is kept
 *   (splice) so other prompt-ready handlers holding a reference do not lose their work.
 * - Text completion (eventData.prompt): the placeholder region is replaced in place, else
 *   the context is prepended.
 * `options.knownBlocks`: visible history blocks (bareBlockTexts) to drop from user/system content.
 * An empty `context` only cleans the prompt. Returns { injected, kind, reason }.
 */
export function injectContext(eventData, context, defs, { knownBlocks = null } = {}) {
    if (!eventData || typeof eventData !== 'object' || eventData.dryRun === true) return { injected: false, reason: 'invalid-event' };
    const text = String(context ?? '');

    if (Array.isArray(eventData.chat)) {
        const chat = eventData.chat;
        const cleaned = [];
        for (const message of chat) {
            const content = mapContentText(message?.content, part => sanitizeText(part, defs, stripOptions(message, knownBlocks)));
            const ownContextOnly = message?.role === 'system'
                && onlyText(message?.content)
                && contentText(message.content).includes(CONTEXT_BEGIN)
                && !contentText(content).trim();
            if (!ownContextOnly) cleaned.push(message && typeof message === 'object' ? { ...message, content } : message);
        }
        chat.splice(0, chat.length, ...cleaned);
        if (!text) return { injected: false, kind: 'chat', reason: 'empty-context' };
        insertSystemPrompt(chat, text);
        return { injected: true, kind: 'chat' };
    }

    if (typeof eventData.prompt === 'string') {
        const prompt = eventData.prompt;
        // The placeholder SillyTavern placed inside the instruct template is replaced in place.
        const begin = prompt.lastIndexOf(CONTEXT_BEGIN);
        const end = begin >= 0 ? prompt.indexOf(CONTEXT_END, begin) : -1;
        if (begin >= 0 && end >= 0) {
            const close = end + CONTEXT_END.length;
            eventData.prompt = `${sanitizeText(prompt.slice(0, begin), defs)}${text}${sanitizeText(prompt.slice(close), defs)}`;
            return text ? { injected: true, kind: 'text-extension-prompt' } : { injected: false, kind: 'text-extension-prompt', reason: 'empty-context' };
        }
        // Fallback when no placeholder landed: prepend to the combined prompt.
        const clean = sanitizeText(prompt, defs);
        if (!text) {
            eventData.prompt = clean;
            return { injected: false, kind: 'text', reason: 'empty-context' };
        }
        eventData.prompt = `${text}\n${clean}`;
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
