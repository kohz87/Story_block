// NPC Inner Chatter: reading a free-text block of `Name: line` as who said (or thought)
// what. Ported from Megumin Suite's Whisper Thread / Interior treatment (GPL-3.0):
// `parseChatter` and `renderChatter` in src/blocks/treatments.js.
//
// Megumin's rule, kept: two or more NPCs talking behind the player's back are a
// conversation and get a thread; one NPC alone is a private thought, which is not
// dialogue, and gets a pull quote. Counting distinct speakers picks the shape.
//
// Parsing is strict in the same way as choices.js: anything that does not read cleanly
// as speaker lines returns null and the display shows the block as plain text, so a
// model that wrote prose instead still reads fine. Nothing is dropped to make a thread
// fit: a line that is not a speaker belongs to the speaker above it.

export const HUE_COUNT = 8;

// The block's own `[instructions or placeholder]`, left unfilled or echoed back.
const PLACEHOLDER = /^\[[\s\S]*\]$/;
// `---`, `***`, `___`: a markdown rule between turns, not text anyone said.
const RULE = /^(?:[-*_]\s*){3,}$/;

// Words that end in a colon but are not people. "Note:" and "Example:" appear in block
// instructions, and a model echoing its block title writes "Inner Chatter:" as a header.
const BLOCK_TITLE = /^(?:npc[\s_]+)?inner[\s_]+chatter$/i;
const NOT_A_NAME =/^(?:notes?|example|tone|edit|ooc|warning|summary|context|rules?|output|format|scene|time|location|thoughts?|npc inner chatter|inner chatter|chatter)$/i;

// A sentence that happens to contain a colon ("Then she said: run") starts with one of
// these; a name does not. Only the first word is checked, so "The Ferryman" still reads.
const NOT_A_FIRST_WORD = new Set([
    'i', 'he', 'she', 'they', 'we', 'you', 'it', 'his', 'her', 'their', 'our', 'my', 'your',
    'then', 'but', 'and', 'so', 'when', 'if', 'now', 'still', 'just', 'later', 'meanwhile',
    'suddenly', 'finally', 'also', 'yes', 'no', 'well', 'oh', 'this', 'that', 'there', 'here',
    'what', 'why', 'how', 'who', 'only', 'even', 'because', 'once', 'after', 'before',
]);

// Lower-case words a longer name may carry ("Captain of the Guard", "Ser Aldric van Holt").
const CONNECTORS = new Set(['of', 'the', 'de', 'del', 'da', 'di', 'du', 'van', 'von', 'der', 'den', 'la', 'le', 'al', 'el', 'bin', 'ibn', 'y', 'and', 'from', 'at', 'on']);

// Where a second speaker may start inside one physical line: after the end of a sentence
// (or a closing quote, star or bracket), at an upper-case letter, optionally bolded.
// Megumin anchors here too, because a model writes the exchange as one paragraph as
// often as it writes lines.
const INLINE_BOUNDARY = /(?<=[.!?…"”’*)\]~])\s+(?=(?:\*\*|__|\*)?[\p{Lu}\p{Lo}])/gu;

const QUOTES_AT_ENDS = /^["“”'‘’«»]+|["“”'‘’«»]+$/g;

/** Comparison key for a speaker: markdown, quotes, a trailing colon and case removed. */
function keyOf(name) {
    return String(name ?? '')
        .replace(/[*_]+/g, '')
        .replace(/[:：]\s*$/, '')
        .replace(QUOTES_AT_ENDS, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

/**
 * Splits a line into a speaker head and what follows the colon, or null when the line
 * has no colon near its start. Does not decide whether the head is a name: that is
 * isNameLike's job, because a head that names a known speaker is accepted more freely.
 */
function readSpeaker(line) {
    let rest = String(line)
        // A list bullet ("- ", "* ", "• ") before the name. "*Astra:*" has no space after
        // the star, so it is emphasis, not a bullet.
        .replace(/^\s*(?:[-•–—+]\s+|\*\s+(?=\S))/, '')
        // A leading emoji ("🗣 Astra:"), which some presets put before every name.
        .replace(/^[\p{Extended_Pictographic}️‍\s]+/u, '');
    const colon = rest.search(/[:：]/);
    if (colon <= 0 || colon > 64) return null;
    let head = rest.slice(0, colon);
    let text = rest.slice(colon + 1);
    // `**Astra:** text` — the bold closes after the colon; take the closing marks with it.
    const open = /^\s*(\*{1,3}|_{1,3})/.exec(head);
    if (open && text.startsWith(open[1])) text = text.slice(open[1].length);
    // "Re:Zero", "http://": a speaker's colon is followed by a space or the end of the line.
    if (text && !/^\s/.test(text)) return null;

    head = head.replace(/\*+/g, '').replace(/^_+|_+$/g, '').trim();
    // `"Go home: now," she said.` — a quote opened before the colon and not closed is
    // speech running past a colon, not a quoted name.
    if (/^["“‘«]/.test(head) && !/["”’»]$/.test(head)) return null;
    head = head.replace(QUOTES_AT_ENDS, '').trim();
    let note = '';
    // `Astra (thinking)` / `Old Brenn [whispering to Astra]`: a stage note, not the name.
    const staged = /^(.*?)\s*[([]([^)\]]*)[)\]]\s*$/.exec(head);
    if (staged) {
        head = staged[1].trim();
        note = staged[2].replace(/[*_]+/g, '').trim();
    }
    return { name: head.replace(/\s+/g, ' '), note, text: text.trim() };
}

/** True when `name` reads as a person's name or label rather than the start of prose. */
function isNameLike(name) {
    const value = String(name ?? '');
    if (!value || value.length > 40) return false;
    // Sentence punctuation at the end, or a comma anywhere, is prose ("Strange, she said:").
    if (/[.!?…,;]$/.test(value)) return false;
    if (!/^[\p{L}\p{M}\p{N}'’.\- ]+$/u.test(value) || !/\p{L}/u.test(value)) return false;
    if (!/^[\p{Lu}\p{Lt}\p{Lo}\p{N}]/u.test(value)) return false;
    if (NOT_A_NAME.test(value)) return false;
    const words = value.split(' ');
    if (words.length > 4) return false;
    if (NOT_A_FIRST_WORD.has(words[0].toLowerCase())) return false;
    // Two words may be a description ("Old woman", "Tall guard"); three or four must be
    // title-cased apart from connectors, or "Brenn told her twice" would be a speaker.
    if (words.length >= 3 && !words.slice(1).every(word => CONNECTORS.has(word) || /^[\p{Lu}\p{Lt}\p{Lo}\p{N}]/u.test(word))) return false;
    return true;
}

/**
 * Whether a head nobody has used yet starts a new speaker. A head with a lower-case
 * word ("Old woman", but also "Night fell") must be followed by what looks like speech
 * starting (an upper-case letter, a quote, an action), so "Night fell: cold and grey"
 * stays prose while "Old woman: Don't." reads as a speaker.
 */
function startsSpeaker(turn, known) {
    if (known.has(keyOf(turn.name))) return true;
    if (!isNameLike(turn.name)) return false;
    const casual = turn.name.split(' ').some(word => /^\p{Ll}/u.test(word) && !CONNECTORS.has(word));
    return !casual || !/^\p{Ll}/u.test(turn.text);
}

/** The text after a speaker's colon, tidied: a leading `(note)` taken, wrapping quotes off. */
function cleanTurn(turn) {
    let { note, text } = turn;
    if (!note) {
        const lead = /^[*_]?\(([^)]{1,48})\)[*_]?\s*/.exec(text);
        if (lead) {
            note = lead[1].trim();
            text = text.slice(lead[0].length);
        }
    }
    // `Astra: "She keeps watching."` — the quotes only say it is speech, which the
    // bubble already says. Taken off only when they wrap the whole line, so
    // `"Fine," he said, "go."` keeps all of its own.
    const wrapped = /^["“]([^"“”]*)["”]$/.exec(text.trim());
    if (wrapped) text = wrapped[1].trim();
    return { note, text: text.trim() };
}

/**
 * Splits one piece of text at every point where a further speaker starts mid-line.
 * Returns the text before the first speaker (may be '') and the turns after it.
 */
function splitInline(text, known) {
    const turns = [];
    let lead = null;
    let rest = text;
    for (;;) {
        let found = null;
        for (const match of rest.matchAll(INLINE_BOUNDARY)) {
            const turn = readSpeaker(rest.slice(match.index + match[0].length));
            if (!turn || !startsSpeaker(turn, known)) continue;
            // An unknown name mid-line also needs its words to look like speech starting
            // ("Brenn: Don't"), so "I saw it. Twice: once at dawn" stays one turn.
            if (!known.has(keyOf(turn.name)) && !/^[^\p{Ll}]/u.test(turn.text)) continue;
            found = { at: match.index, turn };
            break;
        }
        const before = found ? rest.slice(0, found.at).trim() : rest.trim();
        if (lead === null) lead = before;
        else turns[turns.length - 1].text = before;
        if (!found) break;
        turns.push(found.turn);
        known.set(keyOf(found.turn.name), known.get(keyOf(found.turn.name)) ?? found.turn.name);
        rest = found.turn.text;
    }
    return { lead, turns };
}

/**
 * Reads an Inner Chatter body.
 *
 * Returns `{ mode, lines }` where `lines` is `[{ speaker, note, text }]` in order and
 * `mode` is 'thought' for exactly one distinct speaker, 'thread' for two or more. A
 * speaker is matched case-insensitively and shown as first spelled. Lines with no
 * speaker continue the previous speaker's text (joined with "\n"). Returns null when the
 * first line names nobody, when a would-be name is clearly prose, or for the block's
 * unfilled `[placeholder]`.
 */
export function parseChatter(text) {
    const source = String(text ?? '').replace(/\r\n?/g, '\n').trim();
    if (!source || PLACEHOLDER.test(source)) return null;

    const known = new Map();
    const lines = [];
    const append = (piece) => {
        if (!piece) return;
        const last = lines[lines.length - 1];
        last.text = last.text ? `${last.text}\n${piece}` : piece;
    };
    const add = (turn) => {
        const key = keyOf(turn.name);
        if (!known.has(key)) known.set(key, turn.name);
        const { note, text: words } = cleanTurn(turn);
        lines.push({ speaker: known.get(key), note, text: words });
    };

    for (const raw of source.split('\n')) {
        const line = raw.trim();
        if (!line || RULE.test(line)) continue;
        const turn = readSpeaker(line);
        // A model echoing the block title as a header ("NPC Inner Chatter:") before the
        // turns: skipped, not a reason to refuse the whole block.
        if (!lines.length && turn && !turn.text && BLOCK_TITLE.test(turn.name)) continue;
        if (turn && startsSpeaker(turn, known)) {
            const { lead, turns } = splitInline(turn.text, known);
            add({ ...turn, text: lead });
            turns.forEach(add);
        } else if (!lines.length) {
            // Prose first, or a "speaker" that is really a sentence: not chatter.
            return null;
        } else {
            const { lead, turns } = splitInline(line, known);
            append(lead);
            turns.forEach(add);
        }
    }

    // An unfilled template line (`Astra: [her thought]`) is not anyone's words.
    if (lines.some(line => PLACEHOLDER.test(line.text))) return null;
    // A name with nothing after it ("Inner Chatter:" as a header, a turn cut off) is not
    // a turn; it is dropped rather than drawn as an empty bubble.
    const filled = lines.filter(line => /[\p{L}\p{N}]/u.test(line.text));
    if (!filled.length) return null;
    const speakers = new Set(filled.map(line => keyOf(line.speaker)));
    return { mode: speakers.size === 1 ? 'thought' : 'thread', lines: filled };
}

/**
 * A stable colour index (0..HUE_COUNT-1) for a speaker name: FNV-1a over the normalized
 * name. Hash-based rather than by order of appearance (Megumin's choice) so the same NPC
 * keeps the same colour in every reply; two speakers may share a hue, which is why the
 * name is always shown and colour is never the only cue.
 */
export function speakerHue(name) {
    const key = keyOf(name);
    let hash = 0x811c9dc5;
    for (const char of key) {
        hash ^= char.codePointAt(0);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0) % HUE_COUNT;
}
