// Choices: reading a CYOA block as a list of options, and putting one in SillyTavern's
// message box. Ported from Megumin Suite's choices (GPL-3.0): `parseChoices` in
// src/blocks/render.js and `meguminApplyChoice` in src/features/blocks/chat.js.
//
// Parsing is deliberately strict and deliberately reversible: anything that is not a
// clean list of options returns null and the display falls back to plain text. A model
// that wrote its choices as prose still reads fine, it just gets no buttons. Nothing the
// model wrote is ever dropped to make a list fit, which is why a stray line of prose
// refuses the list instead of being skipped.

export const MIN_CHOICES = 2;
export const MAX_CHOICES = 8;
// A line this long is a paragraph that happens to start with "1.", not a suggestion.
const MAX_CHOICE_LENGTH = 240;

// `1. text`, `1) text`, or a bullet (`-`, `*`, `+`, `•`), matched after emphasis is
// stripped so `**1.** text` and `**1. text**` read too. The marker must be followed by
// whitespace, so "1.5 gold" or "*emphasis*" never reads as a list.
const NUMBERED_LINE = /^(\d{1,2})[.)]\s+(.+)$/;
const BULLET_LINE = /^[-*+•]\s+(.+)$/;

// The template's own `[Short suggestion]`, left unfilled. Clicking it would put the
// placeholder in the message box, so a list that still has one is not offered as buttons.
const PLACEHOLDER = /^\[[^\]]*\]$/;

/**
 * Markdown emphasis removed: the text goes into the message box, where `**` would be
 * typed literally. Underscores count only at word edges so snake_case and file_names
 * survive.
 */
export function stripEmphasis(text) {
    let out = String(text ?? '');
    let previous;
    // Repeat so nested emphasis (`***both***`, `**a *b* c**`) comes off completely.
    do {
        previous = out;
        out = out
            .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '$1')
            .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1$2')
            .replace(/\*(?=[^\s*])([^*]*?[^\s*])\*/g, '$1')
            .replace(/(^|[^\w])_(?=[^\s_])([^_]*?[^\s_])_(?!\w)/g, '$1$2')
            .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1');
    } while (out !== previous);
    return out.replace(/\s+/g, ' ').trim();
}

/**
 * The options in a CYOA body: 2–8 strings, emphasis stripped, in the order written.
 * Returns null unless every non-blank line is an option of one kind (all numbered
 * 1, 2, 3… in order, or all bulleted) and none is empty, overlong or a `[placeholder]`.
 */
export function parseChoices(text) {
    if (typeof text !== 'string') return null;
    const lines = text.replace(/\r\n?/g, '\n').split('\n').map(line => line.trim()).filter(Boolean);
    if (lines.length < MIN_CHOICES || lines.length > MAX_CHOICES) return null;

    let kind = null;
    const choices = [];
    for (const raw of lines) {
        const line = stripEmphasis(raw);
        const numbered = NUMBERED_LINE.exec(line);
        const bullet = numbered ? null : BULLET_LINE.exec(line);
        const lineKind = numbered ? 'numbered' : bullet ? 'bullet' : null;
        if (!lineKind) return null;
        // Mixed markers usually mean an option list followed by notes or sub-points;
        // treating them all as options would turn notes into buttons.
        if (kind && lineKind !== kind) return null;
        kind = lineKind;
        // Out-of-order numbers mean something else is going on (a ranked list, a list
        // continued from earlier); the buttons are numbered 1..n, so they would mislead.
        if (numbered && Number(numbered[1]) !== choices.length + 1) return null;

        const choice = (numbered ? numbered[2] : bullet[1]).trim();
        // No letter or digit at all ("**", "…") is markup residue, not something to do.
        if (!/[\p{L}\p{N}]/u.test(choice) || choice.length > MAX_CHOICE_LENGTH || PLACEHOLDER.test(choice)) return null;
        choices.push(choice);
    }
    return choices;
}

/** SillyTavern reads a message that leads with "/" as a slash command, not story text. */
export function isSlashCommand(text) {
    return /^\s*\//.test(String(text ?? ''));
}

function byId(doc, id) {
    if (!doc) return null;
    if (typeof doc.getElementById === 'function') return doc.getElementById(id);
    return typeof doc.querySelector === 'function' ? doc.querySelector(`#${id}`) : null;
}

/**
 * Put `choice` into SillyTavern's message box (#send_textarea) and, with `send`,
 * send it (#send_but). Returns 'filled', 'sent', or 'unavailable' when there is no box.
 *
 * A plain click FILLS rather than sends: a choice is a suggestion the reader often
 * wants to extend ("Follow her out" -> "Follow her out, but hang back at the door").
 * The choice is APPENDED: something half-typed in the box is the reader's work and a
 * click must never throw it away.
 */
export function fillInput(choice, { send = false, document = globalThis.document } = {}) {
    const box = byId(document, 'send_textarea');
    if (!box) return 'unavailable';
    const text = String(choice ?? '').trim();

    const existing = String(box.value ?? '');
    const kept = existing.replace(/\s+$/, '');
    if (!kept) box.value = text;
    else if (!text) box.value = existing;
    else {
        // The reader ended on a new line on purpose (a list, a new paragraph): keep it.
        // Otherwise one space, however much trailing whitespace there was.
        const separator = existing.slice(kept.length).includes('\n') ? '\n' : ' ';
        box.value = `${kept}${separator}${text}`;
    }

    // SillyTavern's auto-resize and its send-button state both hang off `input`, and
    // setting .value from script does not fire it.
    const EventType = document.defaultView?.Event ?? globalThis.Event;
    if (typeof box.dispatchEvent === 'function' && typeof EventType === 'function') {
        box.dispatchEvent(new EventType('input', { bubbles: true }));
    }
    box.focus?.();
    try {
        const end = box.value.length;
        box.setSelectionRange?.(end, end);
    } catch {
        // Some input types refuse selection ranges; the caret position is a nicety.
    }

    if (!send) return 'filled';
    // Shift is one key away from an ordinary click, and a slash makes the message an
    // instruction to the app rather than to the story. The text stays in the box where
    // the reader can see it and decide. Both the choice and the composed message are
    // checked: a slash only commands when it leads the message, but a choice that is
    // itself a command was never meant to be sent blind either.
    if (isSlashCommand(text) || isSlashCommand(box.value)) return 'filled';
    const sendButton = byId(document, 'send_but');
    if (!sendButton || typeof sendButton.click !== 'function') return 'filled';
    sendButton.click();
    return 'sent';
}
