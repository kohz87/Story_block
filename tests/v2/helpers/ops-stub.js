// A small, faithful stand-in for ops.js `apply(state, ops)` (SPEC §2.3, §12), owned by SB-commands.
// JSON Patch add / replace / remove on JSON Pointers; pure (copy on write); throws on a bad path.
// The store tests inject it, so they do not depend on when ops.js lands.

const isObject = value => !!value && typeof value === 'object';

function parse(path) {
    if (path === '') return [];
    if (typeof path !== 'string' || !path.startsWith('/')) throw new Error(`Bad path: ${path}`);
    return path.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function index(arr, key, allowEnd) {
    if (allowEnd && key === '-') return arr.length;
    if (!/^(0|[1-9][0-9]*)$/.test(key)) throw new Error(`Bad array index: ${key}`);
    const at = Number(key);
    if (at > arr.length || (!allowEnd && at === arr.length)) throw new Error(`Array index out of range: ${key}`);
    return at;
}

function change(node, keys, op) {
    const [key, ...rest] = keys;
    if (!isObject(node)) throw new Error(`No container at ${key}`);
    const copy = Array.isArray(node) ? [...node] : { ...node };
    if (rest.length) {
        const at = Array.isArray(node) ? index(node, key, false) : key;
        if (!Array.isArray(node) && !Object.hasOwn(node, key)) throw new Error(`Missing ${key}`);
        copy[at] = change(node[at], rest, op);
        return copy;
    }
    if (Array.isArray(node)) {
        const at = index(node, key, op.op === 'add');
        if (op.op === 'add') copy.splice(at, 0, structuredClone(op.value));
        else if (op.op === 'replace') copy[at] = structuredClone(op.value);
        else copy.splice(at, 1);
        return copy;
    }
    if (op.op !== 'add' && !Object.hasOwn(node, key)) throw new Error(`Missing ${key}`);
    if (op.op === 'remove') delete copy[key];
    else copy[key] = structuredClone(op.value);
    return copy;
}

export function apply(state, ops) {
    let next = state;
    for (const op of ops) {
        if (!isObject(op) || !['add', 'replace', 'remove'].includes(op.op)) throw new Error(`Bad op: ${JSON.stringify(op)}`);
        if (op.op !== 'remove' && op.value === undefined) throw new Error(`Op without value at ${op.path}`);
        const keys = parse(op.path);
        if (!keys.length) {
            if (op.op === 'remove') throw new Error('Cannot remove the whole state.');
            next = structuredClone(op.value);
            continue;
        }
        next = change(next, keys, op);
    }
    return next;
}
