// Category tree for rows blocks (ported from Inventory Block's tree.js).
import { ROOT_CATEGORY, normalizeRows, rowKey, splitCategoryPath } from './rows.js';
import { foldKey as segmentKey } from '../text.js';

export const DEFAULT_MAX_DEPTH = 3;
export const MIN_MAX_DEPTH = 1;
export const MAX_MAX_DEPTH = 5;
export const ROOT_NODE_ID = '';

const ID_SEPARATOR = '\u001f';
const FOLDED_SEPARATOR = ' › ';

export function clampDepth(value) {
    const depth = Number.parseInt(value, 10);
    if (!Number.isFinite(depth)) return DEFAULT_MAX_DEPTH;
    return Math.min(MAX_MAX_DEPTH, Math.max(MIN_MAX_DEPTH, depth));
}

/**
 * Tree levels for a category path. Levels beyond `maxDepth` are folded into the
 * last visible level instead of being rejected, so no item is ever hidden and the
 * stored category name is never rewritten.
 */
export function displaySegments(name, maxDepth = DEFAULT_MAX_DEPTH) {
    const segments = splitCategoryPath(name);
    if (!segments.length) return [ROOT_CATEGORY];
    const depth = clampDepth(maxDepth);
    if (segments.length <= depth) return segments;
    return [...segments.slice(0, depth - 1), segments.slice(depth - 1).join(FOLDED_SEPARATOR)];
}

export function nodeIdForCategory(name, maxDepth = DEFAULT_MAX_DEPTH) {
    return displaySegments(name, maxDepth).map(segmentKey).join(ID_SEPARATOR);
}

export function ancestorIds(id) {
    if (!id) return [];
    const keys = id.split(ID_SEPARATOR);
    return keys.map((_, index) => keys.slice(0, index + 1).join(ID_SEPARATOR));
}

export function parentId(id) {
    if (!id) return null;
    const keys = id.split(ID_SEPARATOR);
    return keys.slice(0, -1).join(ID_SEPARATOR);
}

// Same key as rows.js uses for diffs, so a change can be matched to its tree row.
export function itemKeyFor(category, name) {
    return rowKey(category, name);
}

function makeNode(parent, name) {
    const key = segmentKey(name);
    const keys = parent ? [...parent.keys, key] : [];
    return {
        id: keys.join(ID_SEPARATOR),
        name,
        keys,
        path: parent ? [...parent.path, name] : [],
        depth: keys.length,
        children: [],
        items: [],
        total: 0,
    };
}

function computeTotals(node) {
    node.total = node.items.length + node.children.reduce((sum, child) => sum + computeTotals(child), 0);
    return node.total;
}

export function buildTree(state, { maxDepth = DEFAULT_MAX_DEPTH } = {}) {
    const inventory = normalizeRows(state);
    const root = makeNode(null, 'All');
    for (const category of inventory.categories) {
        let node = root;
        for (const segment of displaySegments(category.name, maxDepth)) {
            const key = segmentKey(segment);
            let child = node.children.find(candidate => candidate.keys.at(-1) === key);
            if (!child) {
                child = makeNode(node, segment);
                node.children.push(child);
            }
            node = child;
        }
        for (const item of category.items) node.items.push({ ...item, category: category.name });
    }
    computeTotals(root);
    return root;
}

export function walkTree(node, visit) {
    visit(node);
    for (const child of node.children) walkTree(child, visit);
}

/**
 * Resolve a remembered selection. When the model removed or renamed that
 * category, fall back to the deepest ancestor that still exists.
 */
export function resolveNode(root, id) {
    if (!id) return root;
    let node = root;
    for (const key of id.split(ID_SEPARATOR)) {
        const child = node.children.find(candidate => candidate.keys.at(-1) === key);
        if (!child) break;
        node = child;
    }
    return node;
}

/**
 * Items for a selected node, grouped by the sub-category they live in.
 * The node's own items come first, then every descendant in tree order.
 */
export function groupItems(node) {
    const groups = [{ node, label: node.children.length ? node.name : '', own: true, items: node.items }];
    const visit = child => {
        if (child.items.length) {
            groups.push({ node: child, label: child.path.slice(node.depth).join(' › '), own: false, items: child.items });
        }
        child.children.forEach(visit);
    };
    node.children.forEach(visit);
    return groups.filter(group => group.items.length || (group.own && !node.children.length));
}

export function searchItems(root, query) {
    const tokens = String(query ?? '').normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return [];
    const results = [];
    walkTree(root, node => {
        const path = node.path.join(' ').normalize('NFKC').toLowerCase();
        for (const item of node.items) {
            const haystack = `${item.name} ${item.quantity} ${item.remark}`.normalize('NFKC').toLowerCase() + ` ${path}`;
            if (tokens.every(token => haystack.includes(token))) results.push({ item, node });
        }
    });
    return results;
}
