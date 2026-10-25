// The active-history filter (docs/v2/HISTORY.md): the one place that turns "which messages of the chat are faded" into what a
// generation request, a prompt note or a module's view may read. `faded()` is the coordinator's rule (the faded intervals of the
// returns on the line of history); nothing else decides it. Every host reader of earlier messages asks for a reader here by
// name, and the host reports `retainedChatRestore` only when every name has been asked for.
//
// A request is filtered by identity first: the chat the host hands the generation interceptor is tied to the chat's messages (who
// spoke, which swipe, which record), before any formatting or regex has changed a word of it, and the faded entries are taken out
// (`intercept`). The text filters (`chatPrompt`, `textPrompt`) are a second line over the finished request. A request that cannot be
// tied is not passed on silently: the chat is marked untied and the capability reports retainedChatRestore false for it.

/** The host's readers of earlier messages. Adding one means asking for it by name, so the capability cannot claim more than is wired. */
export const ACTIVE_READERS = Object.freeze([
    'prompt.chat',      // the chat-completion request (turn.js onPromptReady)
    'prompt.text',      // the text-completion request (turn.js onTextPromptReady)
    'prompt.intercept', // the chat the generation interceptor is handed, filtered by identity (turn.js interceptor)
    'prompt.chatter',   // the Inner chatter tail line (domains chatterBack)
    'query.chatter.head', // the newest reply's Inner chatter (query chatter.head)
    'query.scene.chatter', // the thoughts under the people present (query scene.chatter, the Scene screen)
    'view.lastUser',    // the reader's last message a module's view shows (sdk makeView)
    'assist.late',      // the previous reply's late safety-net lines (turn.js lateLines)
]);

// A request entry's text: a string, or the text parts of a multimodal message.
function textOf(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content.map(part => (typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : '')).join('\n');
}

// An entry quotes a message when it is its text, or its text behind the speaker's name on the same line ("Name: text").
const quotes = (entry, text) => entry === text || (entry.endsWith(text) && /^[^\n]{1,80}: $/.test(entry.slice(0, entry.length - text.length)));

// Where each faded message stands in a request, found from the newest message to the oldest: a request may leave out the oldest
// messages (the context is full), never a newer one after an older one, so a later message is never taken for an earlier
// message with the same words. `find(text, before)` → { from, to } | null, searching only what lies before `before`.
function cuts(messages, faded, find) {
    const out = [];
    let before = Infinity;
    for (let at = messages.length - 1; at >= 0; at -= 1) {
        const text = String(messages[at]?.mes ?? '');
        if (!text.trim()) continue;
        const place = find(text, before);
        if (!place) continue;
        before = place.from;
        if (faded.has(at)) out.push(place);
    }
    return out;
}

/**
 * createActiveHistory({ messages(), faded() }) → { wired(), reader(name) }.
 * `messages()`: the chat; `faded()`: the Set of indexes of its faded messages. `reader(name)` → { messages(list), chatPrompt(entries),
 * textPrompt(text) } and counts `name` as wired.
 */
export function createActiveHistory({ messages, faded, holder = () => null }) {
    const wired = new Set();
    // Chats (by their holder) whose last request could not be tied to their messages.
    const untied = new WeakSet();
    const mark = (ok) => { const chat = holder(); if (chat !== null && typeof chat === 'object') { if (ok) untied.delete(chat); else untied.add(chat); } };
    const find = {
        // A request of { role, content } entries.
        chat: entries => (text, before) => {
            for (let at = Math.min(before, entries.length) - 1; at >= 0; at -= 1) if (quotes(textOf(entries[at]?.content), text)) return { from: at, to: at + 1 };
            return null;
        },
        // A request that is one text.
        text: prompt => (text, before) => {
            const at = prompt.lastIndexOf(text, before === Infinity ? Infinity : before - text.length);
            if (at < 0) return null;
            const lineStart = prompt.lastIndexOf('\n', at - 1) + 1;
            const from = /^[^\n]{1,80}: $/.test(prompt.slice(lineStart, at)) ? lineStart : at;
            return { from, to: at + text.length };
        },
    };
    return Object.freeze({
        wired: () => ACTIVE_READERS.every(name => wired.has(name)),
        /** False for a chat whose last request could not be tied to its messages (faded text may have gone with it). */
        intact: () => { const chat = holder(); return chat === null || typeof chat !== 'object' || !untied.has(chat); },
        reader(name) {
            if (!ACTIVE_READERS.includes(name)) throw new Error(`"${name}" is not a host reader of earlier messages.`);
            wired.add(name);
            return Object.freeze({
                /** `list` (the chat) without its faded messages. */
                messages: list => {
                    const out = faded();
                    return out.size ? list.filter((_, at) => !out.has(at)) : list;
                },
                /**
                 * The chat the generation interceptor is handed (`entries`), tied to the chat's messages by `idOf` (who, which swipe, which
                 * record: nothing that formatting or a regex changes) and without the entries of faded messages; the list itself is changed.
                 * Messages the host leaves out are system messages, or the last one of a swipe (`swipe`). → { ok: true } or { ok: false, why }
                 * when an entry cannot be tied, in which case nothing is removed and the chat is marked untied.
                 */
                intercept(entries, idOf, { swipe = false } = {}) {
                    const out = faded();
                    if (!out.size) { mark(true); return { ok: true }; }
                    if (!Array.isArray(entries)) { mark(false); return { ok: false, why: 'the host gave the interceptor no chat' }; }
                    const list = messages();
                    const at = [];
                    let next = 0;
                    for (const entry of entries) {
                        const want = idOf(entry);
                        while (next < list.length && idOf(list[next]) !== want) {
                            if (!list[next]?.is_system) { mark(false); return { ok: false, why: `the request holds a message (${want}) that is not where the chat has it` }; }
                            next += 1;
                        }
                        if (next >= list.length) { mark(false); return { ok: false, why: `the request holds a message (${want}) that the chat does not` }; }
                        at.push(next);
                        next += 1;
                    }
                    const left = list.slice(next).filter(message => !message?.is_system).length;
                    if (left > (swipe ? 1 : 0)) { mark(false); return { ok: false, why: 'the chat has messages the request does not' }; }
                    for (let n = entries.length - 1; n >= 0; n -= 1) if (out.has(at[n])) entries.splice(n, 1);
                    mark(true);
                    return { ok: true };
                },
                /** The indexes of the chat's faded messages. */
                faded: () => faded(),
                /** A chat-completion request (a list of { role, content }) without the entries of faded messages; the list itself is changed. */
                chatPrompt(entries) {
                    const out = faded();
                    if (!out.size || !Array.isArray(entries)) return entries;
                    const gone = cuts(messages(), out, find.chat(entries)).map(place => place.from).sort((a, b) => b - a);
                    for (const at of gone) entries.splice(at, 1);
                    return entries;
                },
                /** A text-completion request without the lines of faded messages. */
                textPrompt(prompt) {
                    const out = faded();
                    if (!out.size || typeof prompt !== 'string') return prompt;
                    let text = prompt;
                    for (const { from, to } of cuts(messages(), out, find.text(prompt))) {
                        // (the message's line goes whole: its newline too)
                        text = text.slice(0, from) + text.slice(text[to] === '\n' ? to + 1 : to);
                    }
                    return text;
                },
            });
        },
    });
}
