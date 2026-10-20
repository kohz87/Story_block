// A block definition from an example: the block pasted as the model should write it.
//
// `<Skill_Mastery> … </Skill_Mastery>` gives the tag (and from it the name); the lines
// inside become the layout the model copies and fills. A paragraph written entirely in
// brackets that reads as sentences ("[Add newly established skills … Use hyphens, not
// parentheses.]") is a rule for the model, not part of the skeleton: it goes into the
// instructions, where it is said once instead of being copied into every reply.
// Short brackets inside a line ("[I-IX]", "[0.00-99.99]/100") are placeholders and stay.
//
// The result is a Stateful, Free text block shown as Plain text: the one shape that keeps
// every word of the example as written. The editor then lets the reader change anything.
// Pure.

import { tagFromName } from './schema.js';
import { countWords as words } from './text.js';

const BLOCK = /<([A-Za-z][A-Za-z0-9_]{0,31})(?:\s[^>]*)?>([\s\S]*?)<\/\1\s*>/;
const DEFAULT_PROMPT = 'Keep this block up to date with the story. Carry every value forward unless this reply changed it.';
const RULE_MIN_WORDS = 8;


// "[Add newly established skills … parentheses.]": brackets around the whole paragraph,
// long, and written as sentences rather than a list of options.
function asRule(paragraph) {
    const text = paragraph.trim();
    if (!text.startsWith('[') || !text.endsWith(']')) return null;
    const inner = text.slice(1, -1).trim();
    // "[a] | [b]" is two placeholders on one line, not one bracketed paragraph.
    if (/\]\s*[|,:/]?\s*\[/.test(inner) && !/[.!?]/.test(inner)) return null;
    if (words(inner) < RULE_MIN_WORDS || !/[.!?]["')\]]?\s|[.!?]$/.test(inner)) return null;
    return inner;
}

/** "Skill_Mastery" → "Skill Mastery"; "worldState" → "World State". */
export function nameFromTag(tag) {
    return String(tag ?? '')
        .replace(/_+/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^./, first => first.toUpperCase());
}

/**
 * A new block definition (for the editor to open, unsaved) from an example, or
 * { error } when there is nothing to make one from:
 * { block: { name, tag, icon, kind, format, display, prompt, layout, template: null } }.
 */
export function blockFromExample(text) {
    const source = String(text ?? '').replace(/\r\n?/g, '\n').trim();
    if (!source) return { error: 'Paste a block first, for example <Stats> … </Stats>.' };
    const match = BLOCK.exec(source);
    const tag = match ? match[1] : '';
    const body = (match ? match[2] : source).replace(/^\n+|\s+$/g, '');
    if (!body.trim()) return { error: `<${tag}> is empty: paste the lines that go inside it too.` };

    // Paragraphs are separated by blank lines; a rule paragraph may wrap over several lines.
    const layout = [];
    const rules = [];
    for (const paragraph of body.split(/\n\s*\n/)) {
        const rule = asRule(paragraph.replace(/\s*\n\s*/g, ' '));
        if (rule) rules.push(rule);
        else layout.push(paragraph.replace(/^\n+|\s+$/g, ''));
    }
    const name = nameFromTag(tag) || 'New Block';
    return {
        block: {
            name: name.slice(0, 40),
            tag: tag || tagFromName(name),
            icon: '📄',
            kind: 'stateful',
            format: 'text',
            display: 'plain',
            prompt: rules.length ? rules.join('\n') : DEFAULT_PROMPT,
            layout: layout.filter(Boolean).join('\n\n'),
            template: null,
        },
        rules: rules.length,
    };
}
