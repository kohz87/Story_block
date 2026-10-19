// Rows: `Name | Qty | Note` lines under `[Category > Sub]` headers. This is Inventory
// Block's snapshot body format (v0.6.7), ported unchanged so its snapshots read as-is
// and every parser rule it learned from real model output still applies.
//
// The structure is three columns; a definition only renames them (`def.columns`).

export const id = 'rows';
export const ROOT_CATEGORY = 'General';
export const CATEGORY_PATH_SEPARATOR = '>';

const TABLE_RULE = /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?$/;
const LIST_MARKER = /^(?:[-*•]|\d+[.)])\s+/;
// (0.9.10) A line that only says a section is empty ("(empty)", "*(None)*", "—"), as a model
// writes under a header it keeps for later: nothing to list, not a broken row.
const EMPTY_LINE = /^[\s*_([{]*(?:empty|none|nothing|nothing yet|n\/a|-+|—|–)[\s*_)\]}.]*$/i;
const FALLBACK_COLUMNS = ['Name', 'Quantity', 'Remark'];

function clean(value) {
    return String(value ?? '').replace(/\r?\n/g, ' ').trim();
}

function key(value) {
    return clean(value).normalize('NFKC').toLowerCase();
}

function columnsOf(def) {
    return def?.columns?.length === 3 ? def.columns : FALLBACK_COLUMNS;
}

/**
 * Category headers may carry a sub-category path such as `[Wagon > Food]`.
 * The stored category name stays the full path; only whitespace around the
 * separators is canonicalized so `Wagon>Food` and `Wagon > Food` are the same.
 */
export function splitCategoryPath(name) {
    return clean(name).split(CATEGORY_PATH_SEPARATOR).map(segment => segment.trim()).filter(Boolean);
}

export function canonicalCategoryName(name) {
    return splitCategoryPath(name).join(` ${CATEGORY_PATH_SEPARATOR} `);
}

export function categoryKey(name) {
    return key(canonicalCategoryName(name));
}

export function itemKey(name) {
    return key(name);
}

export function empty() {
    return { categories: [] };
}

export function isEmpty(state) {
    return !(state?.categories ?? []).some(category => category?.items?.length);
}

export function normalizeRows(input) {
    const result = empty();
    const categories = Array.isArray(input?.categories) ? input.categories : [];
    let root = null;
    for (const category of categories) {
        const name = canonicalCategoryName(category?.name) || ROOT_CATEGORY;
        const items = Array.isArray(category?.items) ? category.items : [];
        const normalized = items
            .map(item => ({
                name: clean(item?.name),
                quantity: clean(item?.quantity),
                remark: clean(item?.remark),
            }))
            .filter(item => item.name);
        if (key(name) === key(ROOT_CATEGORY)) {
            root ??= { name: ROOT_CATEGORY, items: [] };
            if (!result.categories.includes(root)) result.categories.unshift(root);
            root.items.push(...normalized);
        } else {
            result.categories.push({ name, items: normalized });
        }
    }
    return result;
}

function splitRow(line) {
    const cells = [];
    let current = '';
    let escaped = false;
    for (const char of String(line ?? '')) {
        if (escaped) {
            current += char;
            escaped = false;
            continue;
        }
        if (char === '\\') {
            escaped = true;
            continue;
        }
        if (char === '|') {
            cells.push(current.trim());
            current = '';
            continue;
        }
        current += char;
    }
    if (escaped) current += '\\';
    cells.push(current.trim());
    return cells;
}

function tagPattern(tag) {
    const names = ['blocks'];
    if (tag && /^[A-Za-z][A-Za-z0-9_]*$/.test(tag)) names.push(tag.toLowerCase());
    return new RegExp(`<(?=\\/?(?:${names.join('|')})\\b)`, 'gi');
}

/**
 * Backslash escapes are reversible through splitRow/unescapeText. Besides `\`
 * and `|`, escape anything that would end the hidden comment (`-->`, `--!>`) or
 * open/close the block or the envelope (`<Tag`, `</Tag`, `<Blocks`) inside a cell.
 */
function escapeText(value, specials, tag) {
    return clean(value)
        .replace(/\\/g, '\\\\')
        .replace(specials, '\\$&')
        .replace(/--(!?)>/g, '--$1\\>')
        .replace(tagPattern(tag), '<\\');
}

function escapeCell(value, tag) {
    return escapeText(value, /\|/g, tag);
}

// A name starting like a list marker, table divider or header (`- Spare`, `2. Map`,
// `[Sealed] Letter`) gets a leading backslash so the parser keeps it verbatim.
function escapeName(value, tag) {
    const text = escapeCell(value, tag);
    return /^(?:[-*•:[]|\d+[.)])/.test(text) ? `\\${text}` : text;
}

function escapeHeader(name, tag) {
    return escapeText(name, /[|\]]/g, tag);
}

// A header is `[…]` whose only unescaped `]` is the final one. `[Food | Water]` (written by
// Inventory Block versions that did not escape `|`) stays a header; `[Sealed] Letter | 1 |` is a row.
function isHeaderLine(line) {
    if (!line.startsWith('[') || !line.endsWith(']')) return false;
    let escaped = false;
    for (let i = 1; i < line.length - 1; i++) {
        const char = line[i];
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === ']') return false;
    }
    return !escaped;
}

function rowCells(text) {
    const cells = splitRow(text);
    // Markdown-table rows: `| Rope | 1 | coiled |`. Drop the empty edge cells.
    if (text.startsWith('|')) cells.shift();
    if (cells.length >= 4 && cells.at(-1) === '') cells.pop();
    return cells;
}

// Only a markdown-table row (`| Name | Qty | Note |`) can be a header row; a canonical
// `Name | Qty |` row is an ordinary item. The block's own column labels count too.
function isTableHeaderRow(cells, markdown, def) {
    if (!markdown) return false;
    const [first, second] = [key(cells[0]), key(cells[1])];
    const columns = columnsOf(def).map(key);
    if (first === columns[0] && second === columns[1]) return true;
    return /^(?:name|items?)$/.test(first) && /^(?:qty|quantity|amount|count|#)$/.test(second);
}

function unescapeText(value) {
    let result = '';
    let escaped = false;
    for (const char of String(value ?? '')) {
        if (escaped) {
            result += char;
            escaped = false;
        } else if (char === '\\') {
            escaped = true;
        } else {
            result += char;
        }
    }
    return escaped ? `${result}\\` : result;
}

function blockName(def) {
    return def?.name || 'Rows';
}

function validateRows(state, def) {
    const rows = normalizeRows(state);
    const categoryKeys = new Set();
    for (const category of rows.categories) {
        const categoryKeyValue = key(category.name);
        if (categoryKeys.has(categoryKeyValue)) throw new Error(`Duplicate ${blockName(def)} category: ${category.name}`);
        categoryKeys.add(categoryKeyValue);
        const itemKeys = new Set();
        for (const item of category.items) {
            const itemKeyValue = key(item.name);
            if (itemKeys.has(itemKeyValue)) throw new Error(`Duplicate ${blockName(def)} row in ${category.name}: ${item.name}`);
            itemKeys.add(itemKeyValue);
        }
    }
    return rows;
}

function parseBody(body, def) {
    const categories = [];
    let current = null;
    const ensureRoot = () => {
        current = categories.find(category => key(category.name) === key(ROOT_CATEGORY));
        if (!current) {
            current = { name: ROOT_CATEGORY, items: [] };
            categories.unshift(current);
        }
        return current;
    };

    const lines = String(body ?? '').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        if (!line || TABLE_RULE.test(line)) continue;
        // A whole row wrapped in brackets (`[Spare Rope | 1 | coiled]`) is a row, not a header:
        // headers escape `|`, and older ones rarely held two.
        if (isHeaderLine(line) && splitRow(line.slice(1, -1)).length >= 3) line = line.slice(1, -1).trim();
        if (isHeaderLine(line)) {
            const name = canonicalCategoryName(unescapeText(line.slice(1, -1)));
            if (!name) throw new Error(`${blockName(def)} category on line ${i + 1} is blank.`);
            // A repeated header continues the earlier section instead of invalidating the block.
            current = categories.find(category => key(category.name) === key(name));
            if (!current) {
                current = { name, items: [] };
                categories.push(current);
            }
            continue;
        }
        if (EMPTY_LINE.test(line.replace(LIST_MARKER, ''))) continue;
        const row = line.replace(LIST_MARKER, '');
        const cells = rowCells(row);
        if (isTableHeaderRow(cells, row.startsWith('|'), def)) continue;
        if (cells.length < 2 || !clean(cells[0])) {
            throw new Error(`${blockName(def)} line ${i + 1} must be ${columnsOf(def).join(' | ')}.`);
        }
        if (!current) ensureRoot();
        current.items.push({
            name: clean(cells[0]),
            quantity: clean(cells[1]),
            // An unescaped `|` inside the last column only splits it further; keep it as text.
            remark: clean(cells.slice(2).join(' | ')),
        });
    }
    return validateRows({ categories }, def);
}

/**
 * A reply cut off mid-block is closed with `\n-->` when it is received; if Continue then
 * finishes the same block, that closer can end up inside the body. It is never part of a
 * row (a real `-->` in a cell is escaped as `--\>`), so when the body only parses
 * without it, it is dropped.
 */
export function parse(body, def) {
    const text = String(body ?? '');
    try {
        return { ok: true, state: parseBody(text, def) };
    } catch (caught) {
        if (/\n-->/.test(text)) {
            try { return { ok: true, state: parseBody(text.replace(/\n-->/g, ''), def) }; } catch { /* keep the original error */ }
        }
        return { ok: false, error: caught instanceof Error ? caught.message : String(caught) };
    }
}

export function serialize(state, def) {
    const rows = validateRows(state, def);
    const tag = def?.tag;
    const lines = [];
    const line = item => `${escapeName(item.name, tag)} | ${escapeCell(item.quantity, tag)} | ${escapeCell(item.remark, tag)}`;
    const root = rows.categories.find(category => key(category.name) === key(ROOT_CATEGORY));
    for (const item of root?.items ?? []) lines.push(line(item));
    for (const category of rows.categories.filter(category => key(category.name) !== key(ROOT_CATEGORY))) {
        if (lines.length && lines.at(-1) !== '') lines.push('');
        lines.push(`[${escapeHeader(category.name, tag)}]`);
        for (const item of category.items) lines.push(line(item));
    }
    return lines.join('\n');
}

// Row identity across replies: category + name. tree.js uses the same key.
export function rowKey(category, name) {
    return `${categoryKey(category)}\u001f${itemKey(name)}`;
}

function entries(state) {
    const list = [];
    for (const category of normalizeRows(state).categories) {
        for (const item of category.items) {
            list.push({ key: rowKey(category.name, item.name), nameKey: itemKey(item.name), category: category.name, item });
        }
    }
    return list;
}

function describeValues(item) {
    return [item?.quantity, item?.remark].filter(Boolean).join(' · ') || '—';
}

/**
 * Compare two full states. Rows are matched by category + name; a row that disappears
 * from one category and appears under the same name in another is a move. Besides the
 * shared Change fields, each change keeps `before`/`after` rows and categories so the
 * tree display can describe it the way Inventory Block did.
 */
export function diff(previous, next) {
    if (!previous || !next) return [];
    const before = entries(previous);
    const after = entries(next);
    const beforeByKey = new Map(before.map(entry => [entry.key, entry]));
    const afterKeys = new Set(after.map(entry => entry.key));

    const changes = [];
    const added = [];
    for (const entry of after) {
        const old = beforeByKey.get(entry.key);
        if (!old) {
            added.push(entry);
            continue;
        }
        if (old.item.quantity !== entry.item.quantity || old.item.remark !== entry.item.remark) {
            changes.push({
                type: 'changed', label: entry.item.name, path: entry.category,
                from: describeValues(old.item), to: describeValues(entry.item),
                before: old.item, after: entry.item,
            });
        }
    }

    const removed = before.filter(entry => !afterKeys.has(entry.key));
    for (const entry of added) {
        const index = removed.findIndex(candidate => candidate.nameKey === entry.nameKey);
        if (index >= 0) {
            const [old] = removed.splice(index, 1);
            changes.push({
                type: 'moved', label: entry.item.name, path: entry.category, previousPath: old.category,
                from: old.category, to: entry.category, before: old.item, after: entry.item,
            });
        } else {
            changes.push({ type: 'added', label: entry.item.name, path: entry.category, to: describeValues(entry.item), after: entry.item });
        }
    }
    for (const entry of removed) {
        changes.push({ type: 'removed', label: entry.item.name, path: entry.category, from: describeValues(entry.item), before: entry.item });
    }

    const order = { added: 0, changed: 1, moved: 2, removed: 3 };
    return changes.sort((a, b) => order[a.type] - order[b.type]);
}

function nestingRule(maxDepth) {
    const depth = Math.min(5, Math.max(1, Number.parseInt(maxDepth, 10) || 3));
    if (depth <= 1) return 'Do not nest sections; never use ">" inside a section header.';
    return `Section headers may nest sub-sections with " > " (for example [Wagon > Food]), at most ${depth} levels deep. ` +
        'Write the full path in every header, keep existing section paths spelled exactly as they appear in the current state, and only add a sub-section when it keeps a large section organized.';
}

export function rules(def) {
    const [first, second, third] = columnsOf(def);
    return `One row per line: ${first} | ${second} | ${third}. Rows before any header belong to the general section; ` +
        `group the rest under section headers [Section] on their own line. ${nestingRule(def?.maxDepth)} ` +
        'Write each section header once and each name once per section; merge duplicates into a single row. ' +
        'Never put "|" inside a cell (write "/" instead).';
}

export function skeleton(def) {
    const [first, second, third] = columnsOf(def);
    const row = `(${first}) | (${second}) | (${third})`;
    return `${row}\n\n[Section]\n${row}`;
}
