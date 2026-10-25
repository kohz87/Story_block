// The active-history filter (docs/v2/HISTORY.md): the one place that turns "which messages of the chat are faded" into what a
// generation request, a prompt note or a module's view may read. `faded()` is the coordinator's rule (the faded intervals of the
// returns on the line of history); nothing else decides it. Every host reader of earlier messages asks for a reader here by
// name, and the host reports `retainedChatRestore` only when every name has been asked for.

/** The host's readers of earlier messages. Adding one means asking for it by name, so the capability cannot claim more than is wired. */
export const ACTIVE_READERS = Object.freeze([
    'prompt.chat',      // the chat-completion request (turn.js onPromptReady)
    'prompt.text',      // the text-completion request (turn.js onTextPromptReady)
    'prompt.chatter',   // the Inner chatter tail line (domains chatterBack)
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
export function createActiveHistory({ messages, faded }) {
    const wired = new Set();
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
        reader(name) {
            if (!ACTIVE_READERS.includes(name)) throw new Error(`"${name}" is not a host reader of earlier messages.`);
            wired.add(name);
            return Object.freeze({
                /** `list` (the chat) without its faded messages. */
                messages: list => {
                    const out = faded();
                    return out.size ? list.filter((_, at) => !out.has(at)) : list;
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
