// Persistent chat-local ancestry. Copies share immutable nodes/bodies; a head selects
// one swipe branch. Prefix archival preserves ancestors; an interior gap is ambiguous.
import { randomId } from './id.js';

export const JOURNAL_VERSION = 1;

export function journalKey(value) {
    const text = String(value ?? '');
    let a = 5381, b = 2166136261;
    for (let i = 0; i < text.length; i++) {
        a = Math.imul(a, 33) ^ text.charCodeAt(i);
        b = Math.imul(b ^ text.charCodeAt(i), 16777619);
    }
    return `${text.length}:${a >>> 0}:${b >>> 0}`;
}

function ancestors(journal, id) {
    const path = [], seen = new Set();
    while (id) {
        const node = journal.nodes[id];
        if (!node || seen.has(id)) throw new Error('Saved checkpoint ancestry is incomplete.');
        seen.add(id); path.push(node); id = node.parent;
    }
    return path.reverse();
}

export function journalState(saved, frames, { scope = '', uuid = randomId } = {}) {
    if (saved && saved.version !== JOURNAL_VERSION) return { availability: 'incomplete', reason: 'Unsupported checkpoint version.' };
    const previous = saved ?? { version: JOURNAL_VERSION, id: uuid(), scope, head: null, nodes: {}, bodies: {} };
    const journal = { ...previous, nodes: { ...previous.nodes }, bodies: { ...previous.bodies } };
    if (previous.scope !== scope) Object.assign(journal, { id: uuid(), scope, forkOf: previous.id });
    const fail = reason => ({ availability: 'incomplete', reason, journal: previous, entries: [], prefix: [] });
    const intern = text => {
        const key = journalKey(text);
        let id = key, suffix = 0;
        while (id in journal.bodies && journal.bodies[id] !== text) id = `${key}:${++suffix}`;
        journal.bodies[id] = text;
        return id;
    };
    const body = id => {
        if (typeof journal.bodies[id] !== 'string') throw new Error('A saved checkpoint body is missing.');
        return journal.bodies[id];
    };
    const decode = node => ({ ...node,
        blocks: Object.fromEntries(Object.entries(node.blocks).map(([tag, id]) => [tag, body(id)])),
        extra: Object.fromEntries(Object.entries(node.extra).map(([name, id]) => [name, JSON.parse(body(id))])),
    });
    try {
        const oldPath = ancestors(journal, previous.head);
        if (!frames.length) return previous.head ? fail('No retained reply anchors the saved quest history.')
            : { availability: 'available', journal, entries: [], prefix: [], offset: 0, key: '' };
        const nodes = Object.values(journal.nodes);
        const byOwner = new Map();
        for (const node of nodes) {
            if (!byOwner.has(node.owner)) byOwner.set(node.owner, []);
            byOwner.get(node.owner).push(node);
        }
        const first = frames[0];
        const anchor = [...oldPath].reverse().find(node => node.owner === first.owner && node.signature === first.signature)
            ?? [...nodes].reverse().find(node => node.owner === first.owner && node.signature === first.signature)
            ?? [...oldPath].reverse().find(node => node.owner === first.owner);
        if (previous.head && !anchor) return fail('No retained reply matches the saved quest history.');
        const prefix = anchor ? ancestors(journal, anchor.parent) : [];
        const offset = anchor ? anchor.position - first.index : 0;
        let parent = prefix.at(-1) ?? null;
        for (const frame of frames) {
            const variants = byOwner.get(frame.owner) ?? [];
            let node = variants.find(entry => entry.signature === frame.signature && entry.parent === (parent?.id ?? null));
            if (!node) {
                if (variants.length && frame !== frames.at(-1)) {
                    return fail('An earlier reply changed or was removed while its later effects remain. Restore that branch or rewind its suffix.');
                }
                // A known unchanged child with a different parent proves an interior gap.
                if (variants.some(entry => entry.signature === frame.signature)) {
                    return fail('A reply is missing inside the retained history. Restore it or rewind the dependent suffix.');
                }
                const blocks = { ...(parent?.blocks ?? {}) };
                for (const [tag, text] of Object.entries(frame.blocks ?? {})) blocks[tag] = intern(text);
                node = { id: uuid(), owner: frame.owner, parent: parent?.id ?? null,
                    position: frame.index + offset, signature: frame.signature, blocks,
                    extra: Object.fromEntries(Object.entries(frame.extra ?? {}).map(([name, value]) => [name, intern(JSON.stringify(value))])),
                };
                journal.nodes[node.id] = node; nodes.push(node);
                variants.push(node); byOwner.set(frame.owner, variants);
            }
            parent = node;
        }
        journal.head = parent.id;
        return { availability: 'available', journal, entries: ancestors(journal, parent.id).map(decode),
            prefix: prefix.map(decode), offset, key: prefix.at(-1)?.id ?? '' };
    } catch (error) {
        return fail(error.message);
    }
}
