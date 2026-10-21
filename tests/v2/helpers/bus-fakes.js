// Small stand-ins for the store (SB-state) and the registry (SB-turn), shaped like SPEC §12, for the
// command bus tests. The fake store keeps an in-memory head and the list of what was appended.
import { apply, deepFreeze } from '../../../src/v2/ops.js';

export function fakeStore(initial) {
    let head = deepFreeze(structuredClone(initial));
    const appended = [];
    let saves = 0;
    return {
        head: () => head,
        headIndex: () => 0,
        append({ ops, receipt }) {
            head = deepFreeze(apply(head, ops));
            appended.push({ ops, receipt });
        },
        scheduleSave() {
            saves++;
        },
        // Test helpers, not part of the store interface.
        get appended() { return appended; },
        get saves() { return saves; },
        replaceHead(state) { head = deepFreeze(structuredClone(state)); },
    };
}

/** fakeRegistry([{ id, domains: { name: { validate? } }, commands: {}, queries: {} }]) */
export function fakeRegistry(modules) {
    const byId = new Map(modules.map(def => [def.id, def]));
    const owner = (field, name) => {
        for (const def of [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))) {
            if (def[field] && Object.hasOwn(def[field], name)) return def.id;
        }
        return null;
    };
    return {
        modules: () => [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
        domainOwner: domain => owner('domains', domain),
        commandOwner: type => owner('commands', type),
        command: type => {
            const id = owner('commands', type);
            return id ? byId.get(id).commands[type] : null;
        },
        validator: domain => {
            const id = owner('domains', domain);
            return id ? byId.get(id).domains[domain].validate ?? null : null;
        },
    };
}

/** A counter in place of crypto for receipt IDs and seeds, so runs are repeatable. */
export function counterIds() {
    let n = 0;
    return prefix => `${prefix}_${(++n).toString(36).padStart(8, '0')}`;
}
