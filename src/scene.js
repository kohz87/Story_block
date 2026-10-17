// World State text as a scene: when and where, who is present and how they look,
// what happens off-screen and what is still open. Pure; no DOM.
//
// Port of Megumin Suite's scene-board parser (`parseWorldState`, GPL-3.0). A World State
// block is a template the model filled in, so it is structured text pretending to be
// prose, and the model drifts from the template constantly. The contract is Megumin's:
// parseScene returns null the moment the text stops looking like a World State, and the
// display falls back to plain text. A board that silently drops a sentence is worse
// than the paragraph it replaced, because the block is hidden in the message and the
// reader would see that sentence nowhere at all.
//
// The parse is a small state machine over lines rather than regexes over the whole
// text: the only reliable structure is ORDER (a field belongs to the last person
// named), so matching globally would hand one person's outfit to the next whenever
// the model skipped a field.

import { TEMPLATES } from './templates.js';

export const ARC_PHASES = ['Setup', 'Escalation', 'Complication', 'Crisis', 'Resolution'];
export const SCENE_PHASES = ['Early Simmer', 'Building', 'Midpoint Tension', 'Climax', 'Breather'];

// What the diff calls the PC when the model wrote no name (the compact layout never asks).
export const PC_LABEL = 'You';

// Canonical person fields, plus the spellings a model writes when it paraphrases the
// template. Unknown labels are kept as written; these only merge obvious synonyms so a
// change of wording between replies does not read as one field gone and another new.
const FIELD_ALIASES = new Map([
    ['outfit', 'Outfit'], ['clothing', 'Outfit'], ['clothes', 'Outfit'], ['attire', 'Outfit'], ['wearing', 'Outfit'],
    ['position', 'Position'], ['posture', 'Position'],
    ['mood', 'Mood'], ['emotion', 'Mood'],
    ['agenda', 'Agenda'], ['goal', 'Agenda'], ['wants', 'Agenda'],
    ['secret', 'Secret'], ['secrets', 'Secret'],
    ['visible condition', 'Visible Condition'], ['condition', 'Visible Condition'],
    ['carrying', 'Carrying'], ['holding', 'Carrying'],
]);

const CANONICAL_FIELDS = new Set(FIELD_ALIASES.values());

// Header cells: the three the template asks for, and the shorthand it uses ("Loc", "Wx").
const SCENE_KEYS = [
    { key: 'both', re: /^(?:time|date)\s*(?:&|and|\/|\+)\s*(?:loc|location|place)$/i },
    { key: 'time', re: /^(?:time|date|day|when|date\s*(?:&|and|\/)\s*time)$/i },
    { key: 'location', re: /^(?:loc|location|place|where|setting)$/i },
    { key: 'weather', re: /^(?:wx|weather|temp|temperature|lighting|climate)$/i },
];

// Section dividers, matched on the words rather than the emoji: the emoji is the first
// thing a model drops or swaps.
const SECTIONS = [
    { key: 'npcs', re: /^(?:npcs?(?:\s*present)?|present\s*npcs?|(?:characters?|people)(?:\s*present)?|in\s*scene|present)$/i },
    { key: 'offscreen', re: /^(?:off[\s-]?screen(?:\s*npcs?)?|elsewhere)$/i },
    { key: 'threads', re: /^(?:unresolved(?:\s*threads?)?|(?:open\s*)?threads?|plot\s*threads?)$/i },
    { key: 'seeds', re: /^(?:planted\s*seeds?|seeds?|foreshadowing)$/i },
    { key: 'timers', re: /^(?:consequence\s*timers?|timers?|ticking\s*clocks?|clocks?)$/i },
    { key: 'arc', re: /^arc(?:\s*phase)?$/i },
    { key: 'phase', re: /^scene\s*phase$/i },
];

const PC_LABEL_RE = /^(?:pc|player(?:\s*character)?|you|protagonist)\b\s*(?:[—–:(-]\s*)?(.*?)\)?$/i;
const PC_EMOJI = '\u{1F9CD}';
const EMOJI_RUN = /^(?:[\p{Extended_Pictographic}\p{Emoji_Modifier}\u{FE0F}\u{200D}\u{20E3}]|\p{Regional_Indicator})+\s*/u;
const BULLET = /^([*\-•+])\s+(.*)$/;
const SEPARATOR = /^(?:[-*_=]\s*){3,}$/;
const NONE = /^(?:none|nobody|no one|nothing|n\/a|-|—|–)\.?$/i;

// Values a model echoes back from the template unfilled. Taken from the template's own
// layout (and the compact layout Megumin switches to) so the two cannot drift apart; a
// customised layout adds its own through parseScene's `layout` option.
//
// A bracket alone does not make a placeholder. A model filling the block in copies the
// brackets round some of its own answers, because the thing it imitates is written in
// brackets; dropping every bracketed value took real moods and secrets off Megumin's
// card. So a bracketed value is dropped when it IS a template placeholder; otherwise only
// the brackets go. Text that is the unfilled template throughout is no scene at all.
const COMPACT_PLACEHOLDERS = ['Time', 'Location', 'Brief visible clothing', 'Current posture/position', 'Posture/position', 'Name', 'PC Name'];

const placeholderKey = text => String(text ?? '').replace(/\{\{\s*user\s*\}\}/gi, 'user').toLowerCase().replace(/\s+/g, ' ').trim();

function placeholdersOf(layout) {
    const found = new Set();
    for (const match of String(layout ?? '').matchAll(/\[([^\]\n]{1,200})\]/g)) found.add(placeholderKey(match[1]));
    return found;
}

const BUILT_IN_PLACEHOLDERS = (() => {
    const set = new Set(COMPACT_PLACEHOLDERS.map(placeholderKey));
    for (const template of TEMPLATES) {
        if (template.display === 'scene') placeholdersOf(template.layout).forEach(key => set.add(key));
    }
    return set;
})();

// ---- text helpers ---------------------------------------------------------------------

/** Bold/italic markers off: values and labels go into slots of our own, not prose. */
export function stripMarkdown(text) {
    return String(text ?? '')
        .replace(/\*\*|__/g, '')
        .replace(/(^|[\s(\[|])[*_](?=\S)([^*_\n]*?\S)[*_](?=$|[\s).,;:!?\]|])/g, '$1$2')
        .replace(/^[*_]+(?=\S)|(?<=\S)[*_]+$/g, '')
        .trim();
}

function splitEmoji(text) {
    const source = String(text ?? '').trim();
    const match = EMOJI_RUN.exec(source);
    if (!match) return { emoji: '', text: source };
    return { emoji: match[0].trim(), text: source.slice(match[0].length).trim() };
}

const squash = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const wordCount = text => squash(text).split(' ').filter(word => /[\p{L}\p{N}]/u.test(word)).length;

function canonicalField(label) {
    const text = squash(stripMarkdown(label)).replace(/[:.]+$/, '');
    return FIELD_ALIASES.get(text.toLowerCase()) ?? text;
}

const isKnownField = label => FIELD_ALIASES.has(squash(stripMarkdown(label)).replace(/[:.]+$/, '').toLowerCase());

function sceneKeyOf(label) {
    const text = splitEmoji(stripMarkdown(label)).text;
    return SCENE_KEYS.find(entry => entry.re.test(text))?.key ?? null;
}

function sectionOf(label) {
    const text = splitEmoji(stripMarkdown(label)).text.replace(/[:.]+$/, '').trim();
    return SECTIONS.find(entry => entry.re.test(text))?.key ?? null;
}

// `Name — role`, `Name (role)`: the card shows the role as a tag.
function splitRole(text) {
    const source = squash(text);
    let match = /^(.+?)\s*\(([^)]{1,40})\)$/.exec(source);
    if (match) return { name: match[1].trim(), role: match[2].trim() };
    match = /^(.+?)\s*(?:[—–]|\s-\s)\s*(.{1,40})$/.exec(source);
    if (match) return { name: match[1].trim(), role: match[2].trim() };
    return { name: source, role: '' };
}

// ---- line shapes ----------------------------------------------------------------------

// `Label: value`, with optional bullet, emphasis markers on either side of the colon and
// a leading emoji. The label run is bounded and cannot hold a colon or a star, so a long
// line without a colon fails in linear time (Megumin hit the quadratic spelling).
const LABEL_LINE = /^([*_]{0,3})\s*([^:*_\n]{1,48}?)\s*([*_]{0,3})\s*:\s*([*_]{0,3})\s*(.*)$/;

function labelLine(content) {
    const match = LABEL_LINE.exec(content);
    if (!match) return null;
    const label = match[2].trim();
    if (!label || /^https?$/i.test(label)) return null;
    // `**Label:**` / `**Label**:` is bold, which is how the template names people;
    // `*Label:*` is its italic spelling for a person's field.
    const bold = /\*\*|__/.test(match[1]) || /\*\*|__/.test(`${match[3]}${match[4]}`);
    return { label, bold, value: match[5].trim() };
}

// A line with no colon that is still a header: `**Astra**`, `### Astra`, `**Astra — companion**`.
function bareHeader(content) {
    let match = /^#{1,6}\s+(.+?)\s*#*$/.exec(content);
    if (match) return stripMarkdown(match[1]).replace(/:$/, '').trim();
    match = /^(?:\*\*|__)([^*_\n]{1,60}?)(?:\*\*|__)$/.exec(content);
    if (match) return match[1].replace(/:$/, '').trim();
    // `**Astra** — companion` / `**Astra** (companion)`: the role outside the bold.
    match = /^(?:\*\*|__)([^*_\n]{1,60}?)(?:\*\*|__)\s*(?:[—–]|\s-\s|-\s)\s*([^:\n]{1,40}?):?$/.exec(content)
        ?? /^(?:\*\*|__)([^*_\n]{1,60}?)(?:\*\*|__)\s*\(([^)\n]{1,40})\):?$/.exec(content);
    if (match) return `${match[1].replace(/:$/, '').trim()} (${stripMarkdown(match[2]).trim()})`;
    return null;
}

// Bold cell labels anywhere in a line (`**📅 Time:** …`), or plain ones at the start or
// after a pipe when they name a scene field (`Time: dusk | Loc: …`).
//
// The line is cut at its LABELS, not its separators: the template's own Loc value is
// `[Place | Region]`, so splitting on "|" breaks a value in half (Megumin's finding).
const BOLD_CELL = /(?:\*\*|__)\s*([^*_:|\n]{1,32}?)\s*(?::\s*(?:\*\*|__)|(?:\*\*|__)\s*:)/g;
const PLAIN_CELL = /(^|\|)\s*([^:|\n]{1,32}?)\s*:/g;

function sceneCells(content) {
    const found = [];
    for (const match of content.matchAll(BOLD_CELL)) {
        found.push({ label: match[1], from: match.index, to: match.index + match[0].length });
    }
    if (!found.length) {
        for (const match of content.matchAll(PLAIN_CELL)) {
            if (!sceneKeyOf(match[2])) continue;
            const from = match.index + match[1].length;
            found.push({ label: match[2], from, to: match.index + match[0].length });
        }
    }
    if (!found.length || !sceneKeyOf(found[0].label)) return null;
    // Only markup or a bullet may stand before the first label.
    if (/[\p{L}\p{N}]/u.test(content.slice(0, found[0].from))) return null;
    return found.map((cell, index) => {
        const end = index + 1 < found.length ? found[index + 1].from : content.length;
        const value = content.slice(cell.to, end).replace(/\s*[|·;]\s*$/, '');
        return { label: splitEmoji(stripMarkdown(cell.label)).text, value };
    });
}

// ---- placeholders ---------------------------------------------------------------------

function makeReader(known) {
    // A `[…]` segment that is the template's own text is dropped wherever it sits; any
    // other bracket pair round a whole value is the model's answer, so only the
    // brackets go. Names are the exception (readName).
    return function readValue(raw) {
        let removed = false;
        let value = stripMarkdown(raw).replace(/\[([^\]\n]*)\]/g, (whole, inner) => {
            if (!known.has(placeholderKey(inner)) && !/\{\{/.test(inner)) return whole;
            removed = true;
            return '';
        });
        // Separators left dangling by a dropped placeholder go with it; a trailing comma
        // the model wrote stays, since the value may continue on the next line.
        value = squash(value).replace(removed ? /^[|,;·\s]+|[|,;·\s]+$/g : /^[|;·\s]+|[|;·\s]+$/g, '');
        if (removed) value = value.replace(/([|,;])(?:\s*[|,;])+/g, '$1');
        const whole = /^\[([^\]]*)\]$/.exec(value);
        if (whole) value = whole[1].trim();
        return value;
    };
}

// A name in brackets is never rescued: `**[NPC Name]:**` has nobody behind it, and an
// unsubstituted `{{user}}` is no name either.
function readName(raw) {
    const value = squash(stripMarkdown(raw).replace(/\{\{\s*user\s*\}\}/gi, ''));
    return /^\[[\s\S]*\]$/.test(value) ? '' : value.replace(/:$/, '').trim();
}

// Whether the text is the template itself rather than a reply written from it: an
// unfilled template is unfilled THROUGHOUT, so one value written without brackets
// means the model was writing, and the bracketed values beside it are its own words.
// Labels, emoji and separators inside a header line's value do not count as writing.
function isUnfilled(lines) {
    let bracketed = 0;
    let written = 0;
    for (const line of lines) {
        const content = (BULLET.exec(line)?.[2] ?? line).trim();
        const parsed = labelLine(content);
        if (!parsed) continue;
        const value = stripMarkdown(parsed.value);
        if (!value) continue;
        const rest = value
            .replace(/\[[^\]]*\]/g, '')
            .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
            .replace(/[^|:]{1,32}:/g, '');
        if (/[\p{L}\p{N}]/u.test(rest)) written += 1;
        else if (/\[/.test(value)) bracketed += 1;
    }
    return bracketed > 0 && written === 0;
}

// ---- the parser -----------------------------------------------------------------------

/**
 * Parse World State text into a scene, or null when it does not look like one.
 *
 * `options.layout` adds a customised layout's own `[placeholders]` to the ones that are
 * dropped as unfilled.
 */
export function parseScene(text, { layout = '' } = {}) {
    const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n').map(line => line.trim());
    if (!lines.some(Boolean)) return null;
    // The template itself, echoed back: nothing in it is a fact about anyone.
    if (isUnfilled(lines)) return null;
    const known = layout ? new Set([...BUILT_IN_PLACEHOLDERS, ...placeholdersOf(layout)]) : BUILT_IN_PLACEHOLDERS;
    const readValue = makeReader(known);

    const scene = {
        time: '', location: '', weather: '',
        pc: null,
        people: [],
        offscreen: [],
        threads: [],
        seeds: [],
        timers: [],
        arc: '',
        phase: '',
        extras: [],
    };
    const order = [];           // every person in order, PC included
    const compact = new Set();  // people written as one `* Name: clothing | posture` bullet
    let section = 'top';        // top | pc | npcs | person | offscreen | threads | seeds | timers
    let person = null;          // the person a field attaches to
    let last = null;            // where a value carried onto the next line belongs
    let lost = 0;               // lines the parse could not place
    let npcsAt = -1;            // how many people were named before the NPCs divider
    let pending = null;         // 'arc' | 'phase' written with its value on the next line
    let offName = '';           // a bare name header inside Off-Screen groups the bullets below it
    let sections = 0;           // section dividers seen, as evidence this is a World State

    const isList = () => section === 'threads' || section === 'seeds' || section === 'timers';
    const inCast = () => section === 'npcs' || section === 'person';

    const setScene = (key, value) => {
        if (!value) return;
        scene[key] = scene[key] ? `${scene[key]}, ${value}` : value;
        last = { kind: 'cell', key };
    };

    const addCell = (label, raw) => {
        const key = sceneKeyOf(label);
        const value = readValue(raw);
        if (!value) return;
        if (key === 'both') {
            // `Time & Loc: dusk at Heron Ford` is two facts. Split at the compact
            // layout's own joiner, first " at " only, so a place containing the word
            // keeps its tail.
            const at = value.split(/\s+at\s+/);
            if (at.length >= 2 && at[0].trim()) {
                setScene('time', at[0].trim());
                setScene('location', at.slice(1).join(' at ').trim());
            } else setScene('time', value);
        } else if (key) setScene(key, value);
        else {
            scene.extras.push({ label: canonicalField(label), value });
            last = null;
        }
    };

    const newPerson = ({ name, role = '' }, { pc = false } = {}) => {
        const entry = { name, role, fields: {} };
        if (pc) scene.pc = entry;
        else scene.people.push(entry);
        order.push(entry);
        person = entry;
        last = null;
        return entry;
    };

    const setField = (target, label, raw) => {
        const value = readValue(raw);
        last = null;
        if (!value) return;
        const key = canonicalField(label) || 'Note';
        target.fields[key] = target.fields[key] ? `${target.fields[key]}; ${value}` : value;
        last = { kind: 'field', person: target, label: key };
    };

    // `clothing | posture`, in the compact layout's own order; a third cell is kept as a note.
    const setCells = (target, raw) => {
        // One value without a pipe could be either half, so it is not guessed at.
        const parts = String(raw).split('|');
        if (parts.length === 1) setField(target, 'Note', raw);
        else parts.forEach((part, index) => setField(target, ['Outfit', 'Position'][index] ?? 'Note', part));
    };

    const pushItem = (list, raw) => {
        // Seeds and timers written inline often hold several, `;`-separated. Threads
        // are one per line by the template's own instruction.
        const parts = list === scene.threads ? [raw] : String(raw).split(/\s*;\s*/);
        for (const part of parts) {
            const value = readValue(part);
            if (!value || NONE.test(value)) continue;
            list.push(value);
            last = { kind: 'list', list, index: list.length - 1 };
        }
    };

    const pushOffscreen = (raw, name = null) => {
        let label = name === null ? '' : readName(name);
        let rest = raw;
        if (name === null) {
            const bold = /^(?:\*\*|__)([^*_\n]{1,40}?)(?:\*\*|__)\s*(?:[—–:]|\s-\s)?\s*(.*)$/.exec(String(raw).trim());
            if (bold) {
                label = readName(bold[1].replace(/:$/, ''));
                rest = bold[2];
            } else {
                const value = readValue(raw);
                // The ASCII hyphen needs a space on both sides, so "Jean-Luc" keeps his name.
                const split = /^(.{1,40}?)(?:\s*[—–:]\s*|\s+-\s+)(.+)$/.exec(value);
                if (split && wordCount(split[1]) <= 4) {
                    label = split[1].trim();
                    rest = split[2];
                } else rest = value;
            }
        }
        if (!label) label = offName;
        let detail = readValue(rest);
        if (NONE.test(detail)) detail = '';
        if (!label && !detail) return;
        scene.offscreen.push({ name: label, text: detail });
        last = { kind: 'off', index: scene.offscreen.length - 1 };
    };

    const startSection = (key, inline) => {
        sections += 1;
        person = null;
        last = null;
        pending = null;
        offName = '';
        if (key === 'arc' || key === 'phase') {
            const value = readValue(inline);
            if (value) scene[key] = value;
            else pending = key;
            section = 'top';
            return;
        }
        section = key;
        if (key === 'npcs' && npcsAt < 0) npcsAt = order.length;
        const value = readValue(inline);
        if (!value || NONE.test(value)) return;
        if (key === 'seeds' || key === 'timers' || key === 'threads') pushItem(scene[key], inline);
        else if (key === 'offscreen') pushOffscreen(inline);
        else if (key === 'npcs') {
            // `NPCs Present: Astra, Merrit` names people without describing them.
            const names = value.split(/\s*,\s*/).filter(Boolean);
            if (names.every(name => wordCount(name) <= 4)) names.forEach(name => newPerson(splitRole(name)));
            else lost += 1;
            person = null;
        }
    };

    const startPc = (rawLabel, inline) => {
        const { text: label } = splitEmoji(stripMarkdown(rawLabel));
        const match = PC_LABEL_RE.exec(label);
        const { name, role } = splitRole(readName(match ? match[1] : label));
        section = 'pc';
        person = scene.pc ?? newPerson({ name, role }, { pc: true });
        last = null;
        if (readValue(inline)) setCells(person, inline);
    };

    // A header naming somebody. Returns false when the text is not a name.
    const startPerson = (rawLabel, inline, { strong }) => {
        const { emoji, text: label } = splitEmoji(stripMarkdown(rawLabel));
        const name = readName(label);
        if (!name) {
            // A bold line that named nobody still ENDS the person before it, or the
            // fields under an unfilled `**[NPC Name]:**` attach to the last real person.
            person = null;
            last = null;
            return true;
        }
        if (name.length > 60 || wordCount(name) > 6 || /[.!?]$/.test(name)) return false;
        if (!strong && !emoji && !inCast()) return false;
        if (/^(?:world\s*state|scene(?:\s*board)?|status|tracker)$/i.test(name)) {
            person = null;
            last = null;
            return true;
        }
        if (section === 'offscreen' && !readValue(inline)) {
            offName = name;
            return true;
        }
        const target = newPerson(splitRole(name));
        section = 'person';
        if (readValue(inline)) setCells(target, inline);
        return true;
    };

    const continueLast = raw => {
        const value = readValue(raw);
        if (!value) return true;
        if (!last) return false;
        if (last.kind === 'field') last.person.fields[last.label] = `${last.person.fields[last.label]} ${value}`;
        else if (last.kind === 'list') last.list[last.index] = `${last.list[last.index]} ${value}`;
        else if (last.kind === 'off') scene.offscreen[last.index].text = squash(`${scene.offscreen[last.index].text} ${value}`);
        else scene[last.key] = `${scene[last.key]} ${value}`;
        return true;
    };

    const stray = raw => {
        const value = stripMarkdown(raw);
        // A wholly bracketed line is the template talking to the model
        // (`*[Repeat for each NPC…]*`), and one or two words are a title or a label the
        // parse did not recognise: neither carries anything the board is not showing.
        if (!value || /^\[[\s\S]*\]$/.test(value) || wordCount(value) < 3) return;
        lost += 1;
    };

    for (const line of lines) {
        if (!line || SEPARATOR.test(line)) continue;
        const bullet = BULLET.exec(line);
        const content = bullet ? bullet[2].trim() : line;
        if (!content) continue;

        if (pending) {
            const value = readValue(content);
            if (value && !labelLine(content)) {
                scene[pending] = value;
                pending = null;
                continue;
            }
            pending = null;
        }

        // Header cells (time, place, weather), on one line or several. Under a person
        // only a bold one counts: a plain `Location: by the door` there is their field.
        if (bullet ? !person && section === 'top' : !person || /\*\*|__/.test(content)) {
            const cells = sceneCells(content);
            if (cells) {
                cells.forEach(cell => addCell(cell.label, cell.value));
                continue;
            }
        }

        const parsed = labelLine(content);
        const header = parsed ? null : bareHeader(content);

        if (bullet) {
            if (section === 'offscreen') {
                if (parsed && wordCount(parsed.label) <= 4) pushOffscreen(parsed.value, parsed.label);
                else pushOffscreen(content);
                continue;
            }
            if (isList()) {
                pushItem(scene[section], content);
                continue;
            }
            if (parsed) {
                const hasValue = Boolean(readValue(parsed.value));
                const field = isKnownField(parsed.label);
                // `* **Astra:**` with nothing after: a person header written as a bullet.
                if (!hasValue && parsed.bold && !field && inCast()) {
                    startPerson(parsed.label, '', { strong: true });
                    continue;
                }
                // A compact person takes known fields only: an unknown label after
                // `* Astra: dress | standing` is the next person, not Astra's field.
                if (person && (field || !compact.has(person))) {
                    setField(person, parsed.label, parsed.value);
                    continue;
                }
                if (inCast() && !field) {
                    const name = readName(parsed.label);
                    if (!name) {
                        person = null;
                        last = null;
                        continue;
                    }
                    if (wordCount(name) <= 6) {
                        const target = newPerson(splitRole(name));
                        compact.add(target);
                        setCells(target, parsed.value);
                        section = 'npcs';
                        continue;
                    }
                }
                if (!person && section === 'top' && sceneKeyOf(parsed.label)) {
                    addCell(parsed.label, parsed.value);
                    continue;
                }
                if (hasValue) lost += 1;
                continue;
            }
            const boldName = /^(?:\*\*|__)([^*_\n]{1,60}?)(?:\*\*|__)\s*(?:(?:[—–(]|\s-\s|-\s)\s*(.*?)\)?)?$/.exec(content);
            if (boldName && inCast()) {
                startPerson(boldName[2] ? `${boldName[1]} (${boldName[2]})` : boldName[1], '', { strong: true });
                continue;
            }
            if (person) {
                setField(person, 'Note', content);
                continue;
            }
            if (section === 'npcs') {
                const name = readName(content);
                if (!name) continue;
                if (wordCount(name) <= 5) {
                    compact.add(newPerson(splitRole(name)));
                    continue;
                }
            }
            stray(content);
            continue;
        }

        // Not a bullet: a section, a person, a field written without its bullet, or a
        // value carried onto the next line.
        if (parsed || header !== null) {
            const label = parsed ? parsed.label : header;
            const inline = parsed ? parsed.value : '';
            const strong = parsed ? parsed.bold : true;
            const hasValue = Boolean(readValue(inline));
            const sectionKey = sectionOf(label);
            if (sectionKey) {
                startSection(sectionKey, inline);
                continue;
            }
            const { emoji, text: bareLabel } = splitEmoji(stripMarkdown(label));
            if (emoji.startsWith(PC_EMOJI) || PC_LABEL_RE.test(bareLabel)) {
                startPc(label, inline);
                continue;
            }
            if (section === 'offscreen' && hasValue) {
                pushOffscreen(inline, label);
                continue;
            }
            if (isList() && hasValue) {
                pushItem(scene[section], `${stripMarkdown(label)}: ${inline}`);
                continue;
            }
            const field = isKnownField(label);
            // `Outfit: …` without its bullet, under the person it describes.
            if (person && (field || (hasValue && !strong && !compact.has(person)))) {
                setField(person, label, inline);
                continue;
            }
            if (!hasValue || strong || emoji || inCast()) {
                if (startPerson(label, inline, { strong: strong || Boolean(emoji) })) continue;
            }
            if (!hasValue && parsed) {
                stray(label);
                continue;
            }
            if (parsed && last && !strong && continueLast(line)) continue;
            if (!parsed && continueLast(line)) continue;
            stray(line);
            continue;
        }

        if (isList()) {
            pushItem(scene[section], line);
            continue;
        }
        if (section === 'offscreen') {
            pushOffscreen(line);
            continue;
        }
        if (continueLast(line)) continue;
        if (person) {
            setField(person, 'Note', line);
            continue;
        }
        stray(line);
    }

    // The PC is the 🧍 / PC: card or, failing that, the first person, but only when
    // the model wrote the NPCs divider after them: otherwise "first" means nothing.
    if (!scene.pc && npcsAt > 0 && scene.people.length) scene.pc = scene.people.shift();

    // The guard: one line the board cannot draw hands the text back to the plain
    // display, and without one described person (or a scene with somebody or
    // something in it) this is not a World State, whatever it is.
    if (lost) return null;
    const everyone = [scene.pc, ...scene.people].filter(Boolean);
    const described = everyone.filter(entry => Object.keys(entry.fields).length);
    const where = scene.time || scene.location || scene.weather;
    const more = everyone.length || scene.threads.length || scene.offscreen.length || scene.arc || scene.phase;
    // One `**Note:** something` line would otherwise be a person called Note: a
    // described person needs a field the template names, and the text needs some
    // shape of a scene around them.
    const knows = described.some(entry => Object.keys(entry.fields).some(label => CANONICAL_FIELDS.has(label)));
    const shape = where || sections || scene.pc || everyone.length > 1 || described.some(entry => Object.keys(entry.fields).length > 1);
    if (!(knows && shape) && !(where && more)) return null;
    return scene;
}

// ---- phases ---------------------------------------------------------------------------

/** Where a written phase sits on its ladder (0-4), or -1 when it is not on it. */
export function phaseStep(kind, value) {
    const ladder = kind === 'arc' ? ARC_PHASES : SCENE_PHASES;
    const text = String(value ?? '').toLowerCase();
    if (!text) return -1;
    let best = -1;
    let at = Infinity;
    ladder.forEach((step, index) => {
        const found = text.indexOf(step.toLowerCase());
        if (found >= 0 && found < at) {
            best = index;
            at = found;
        }
    });
    return best;
}

// ---- diff -----------------------------------------------------------------------------

const compareKey = text => squash(stripMarkdown(text)).toLowerCase();
export const personKey = name => compareKey(name);
export const pcName = pc => (pc?.name ? pc.name : PC_LABEL);

const SCENE_FIELDS = [
    ['time', 'Time'],
    ['location', 'Location'],
    ['weather', 'Weather'],
    ['arc', 'Arc Phase'],
    ['phase', 'Scene Phase'],
];

const isSecret = label => /^secrets?\b/i.test(String(label ?? '').trim());

function fieldChanges(name, before, after, changes) {
    const labels = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    for (const label of labels) {
        // Secrets never reach the diff: the change strip and badges would spoil them.
        if (isSecret(label)) continue;
        const from = before[label] ?? '';
        const to = after[label] ?? '';
        if (compareKey(from) === compareKey(to)) continue;
        changes.push({ type: 'changed', label: `${name} · ${label}`, from, to });
    }
}

/**
 * Changes between two World State texts, in the shared Change shape. [] when either
 * side does not parse as a scene: a diff of prose would be noise.
 */
export function diffScene(previousText, nextText, options = {}) {
    const before = parseScene(previousText, options);
    const after = parseScene(nextText, options);
    if (!before || !after) return [];
    const changes = [];

    for (const [key, label] of SCENE_FIELDS) {
        const from = before[key] ?? '';
        const to = after[key] ?? '';
        if (compareKey(from) === compareKey(to)) continue;
        if (!from) changes.push({ type: 'added', label, to });
        else if (!to) changes.push({ type: 'removed', label, from });
        else changes.push({ type: 'changed', label, from, to });
    }

    if (before.pc && after.pc) fieldChanges(pcName(after.pc), before.pc.fields, after.pc.fields, changes);

    const earlier = new Map(before.people.map(entry => [personKey(entry.name), entry]));
    for (const entry of after.people) {
        const key = personKey(entry.name);
        const old = earlier.get(key);
        earlier.delete(key);
        if (!old) {
            changes.push({ type: 'added', label: entry.name, to: entry.fields.Position || entry.fields.Outfit || '' });
            continue;
        }
        fieldChanges(entry.name, old.fields, entry.fields, changes);
    }
    for (const old of earlier.values()) {
        changes.push({ type: 'removed', label: old.name, from: old.fields.Position || old.fields.Outfit || '' });
    }

    const oldThreads = new Map(before.threads.map(thread => [compareKey(thread), thread]));
    const newThreads = new Map(after.threads.map(thread => [compareKey(thread), thread]));
    for (const [key, thread] of newThreads) if (!oldThreads.has(key)) changes.push({ type: 'added', label: thread });
    for (const [key, thread] of oldThreads) if (!newThreads.has(key)) changes.push({ type: 'removed', label: thread });
    return changes;
}
