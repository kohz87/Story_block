// Block definitions: the one shape every block has, built-in template or custom.
//
// A block is data. Inventory, Character Sheet and every custom block are the same
// definition with different settings; the engine reads `kind`, `format` and
// `display` to decide how the block is prompted, parsed, stored and drawn.

export const KINDS = ['stateful', 'turn', 'lead'];
export const FORMATS = ['rows', 'fields', 'text'];
export const DISPLAYS = ['plain', 'tree', 'fields', 'scene', 'choices', 'dice'];
export const DIE_SIDES = [4, 6, 8, 10, 12, 20, 100];
export const MAX_ROLLS = 10;
export const FIELD_TYPES = ['meter', 'number', 'text', 'list'];
export const WHEN_MODES = ['always', 'every', 'keyword'];

// The display each format reads best in; used when a definition names none.
export const DEFAULT_DISPLAY = { rows: 'tree', fields: 'fields', text: 'plain' };

export const DEFAULT_COLUMNS = ['Item', 'Qty', 'Note'];
export const DEFAULT_MAX_DEPTH = 3;
export const MIN_MAX_DEPTH = 1;
export const MAX_MAX_DEPTH = 5;
export const MAX_FIELDS = 24;
export const MAX_PROMPT_LENGTH = 4000;
export const MAX_LAYOUT_LENGTH = 4000;

// Tags that would collide with markup SillyTavern, the envelope or other extensions
// already give meaning to. A block using one would vanish or be mistaken for
// something else, so the editor refuses them.
export const RESERVED_TAGS = [
    'blocks', 'details', 'summary', 'think', 'thinking', 'reasoning', 'div', 'span', 'img', 'p', 'br',
    'script', 'style', 'html', 'body', 'head', 'a', 'b', 'i', 'u', 'em', 'strong', 'code', 'pre',
    'font', 'q', 'small', 'sub', 'sup', 'table', 'tr', 'td', 'th', 'ul', 'ol', 'li', 'hr', 'audio', 'video',
];

export const TAG_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/;

const cleanText = (value, max = 200) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
const clampInt = (value, min, max, fallback) => {
    const number = Number.parseInt(value, 10);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

export function tagFromName(name) {
    const tag = String(name ?? '').trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '').replace(/^[^A-Za-z]+/, '');
    return tag.slice(0, 32);
}

export function idFromName(name) {
    return String(name ?? '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'block';
}

/** A block id not yet used by `blocks`, derived from `name`. */
export function newBlockId(name, blocks = []) {
    const used = new Set(blocks.map(block => block?.id));
    const base = idFromName(name);
    if (!used.has(base)) return base;
    for (let n = 2; ; n += 1) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

export function normalizeField(field) {
    const label = cleanText(field?.label, 40).replace(/:/g, '');
    if (!label) return null;
    const type = oneOf(field?.type, FIELD_TYPES, 'text');
    const out = { label, type };
    if (type === 'meter') out.max = clampInt(field?.max, 1, 1_000_000, 100);
    if (field?.hint) out.hint = cleanText(field.hint, 80);
    return out;
}

/**
 * Fill in defaults and drop anything malformed, so the rest of the engine can trust
 * the shape. Never throws: a broken stored definition comes back usable.
 */
export function normalizeBlock(value = {}) {
    const input = value && typeof value === 'object' ? value : {};
    const name = cleanText(input.name, 40) || 'Block';
    const format = oneOf(input.format, FORMATS, 'text');
    const tag = TAG_PATTERN.test(String(input.tag ?? '')) ? String(input.tag) : (tagFromName(name) || 'Block');
    const block = {
        id: ID_PATTERN.test(String(input.id ?? '')) ? String(input.id) : idFromName(name),
        name,
        icon: cleanText(input.icon, 8) || '📄',
        tag,
        enabled: input.enabled !== false,
        visible: input.visible !== false,
        // Optional blocks are written only when something calls for them (Dice); a reply
        // without one is not warned about.
        optional: input.optional === true,
        kind: oneOf(input.kind, KINDS, 'stateful'),
        format,
        display: oneOf(input.display, DISPLAYS, DEFAULT_DISPLAY[format]),
        prompt: String(input.prompt ?? '').slice(0, MAX_PROMPT_LENGTH),
        when: {
            mode: oneOf(input.when?.mode, WHEN_MODES, 'always'),
            every: clampInt(input.when?.every, 2, 100, 2),
            keywords: (Array.isArray(input.when?.keywords) ? input.when.keywords : String(input.when?.keywords ?? '').split(','))
                .map(keyword => cleanText(keyword, 60)).filter(Boolean).slice(0, 32),
            scanDepth: clampInt(input.when?.scanDepth, 1, 20, 2),
        },
        template: input.template ? cleanText(input.template, 48) : null,
        // Dice the extension rolls before each reply and hands over through {{rolls}}; 0 = none.
        rolls: {
            count: clampInt(input.rolls?.count, 0, MAX_ROLLS, 0),
            sides: DIE_SIDES.includes(Number(input.rolls?.sides)) ? Number(input.rolls.sides) : 20,
        },
    };
    if (format === 'rows') {
        const columns = Array.isArray(input.columns) ? input.columns.map(column => cleanText(column, 24)) : [];
        block.columns = DEFAULT_COLUMNS.map((fallback, index) => columns[index] || fallback);
        block.maxDepth = clampInt(input.maxDepth, MIN_MAX_DEPTH, MAX_MAX_DEPTH, DEFAULT_MAX_DEPTH);
    }
    // A text block may carry a layout: the skeleton the model fills in (World State, CYOA).
    if (format === 'text') block.layout = String(input.layout ?? '').replace(/\r\n?/g, '\n').trim().slice(0, MAX_LAYOUT_LENGTH);
    if (format === 'fields') {
        const seen = new Set();
        block.fields = (Array.isArray(input.fields) ? input.fields : [])
            .map(normalizeField)
            .filter(field => field && !seen.has(field.label.toLowerCase()) && seen.add(field.label.toLowerCase()))
            .slice(0, MAX_FIELDS);
    }
    return block;
}

/**
 * Problems that make a definition unusable next to `blocks` (the full list it will
 * live in). Returns [] when it is fine. Messages are written for the settings UI.
 */
export function validateBlock(block, blocks = []) {
    const errors = [];
    if (!cleanText(block?.name, 40)) errors.push('Give the block a name.');
    const tag = String(block?.tag ?? '');
    if (!TAG_PATTERN.test(tag)) errors.push('The tag must start with a letter and use only letters, numbers and underscores (up to 32).');
    else if (RESERVED_TAGS.includes(tag.toLowerCase())) errors.push(`"${tag}" is reserved. Pick another tag.`);
    const others = blocks.filter(other => other && other !== block && other.id !== block?.id);
    const clash = others.find(other => String(other.tag).toLowerCase() === tag.toLowerCase());
    if (clash) errors.push(`The tag "${tag}" is already used by ${clash.name}.`);
    if (others.some(other => other.id === block?.id)) errors.push('Another block already has this id.');
    if (!KINDS.includes(block?.kind)) errors.push('Pick a kind.');
    if (!FORMATS.includes(block?.format)) errors.push('Pick a format.');
    if (!DISPLAYS.includes(block?.display)) errors.push('Pick a display.');
    if (block?.format === 'fields' && !(block.fields ?? []).length) errors.push('A Fields block needs at least one field.');
    if (block?.when?.mode === 'keyword' && !(block.when.keywords ?? []).length) errors.push('Add at least one keyword, or choose another "When".');
    return errors;
}

/** Normalize a stored list: definitions repaired, duplicate ids and tags dropped (first wins). */
export function normalizeBlocks(list) {
    const out = [];
    const ids = new Set();
    const tags = new Set();
    for (const input of Array.isArray(list) ? list : []) {
        const block = normalizeBlock(input);
        if (ids.has(block.id) || tags.has(block.tag.toLowerCase()) || RESERVED_TAGS.includes(block.tag.toLowerCase())) continue;
        ids.add(block.id);
        tags.add(block.tag.toLowerCase());
        out.push(block);
    }
    return out;
}
