// A fake Story Block for the events tests: one in-memory state, a command bus with the SPEC §3.2 ctx
// (read, draft, call, claim, fail, query, rng, roll, settings, time, receiptId) and receipts. A command
// runs on a copy and commits only when it does not throw (nothing saved on rejection). `snapshot` and
// `restore` stand in for swiping or deleting the carrier that held a change.

const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

function deepFreeze(value) {
    if (value && typeof value === 'object') {
        for (const item of Object.values(value)) deepFreeze(item);
        Object.freeze(value);
    }
    return value;
}

export function baseState(domains = {}) {
    return { v: 2, meta: { rev: 0, claims: {} }, domains: clone(domains) };
}

export function createFakeHost({ state = baseState(), commands = {}, queries = {} } = {}) {
    let current = clone(state);
    const receipts = [];
    const calls = [];
    let counter = 0;

    function failure(code, message) {
        return Object.assign(new Error(message), { code });
    }

    function command(type, payload, { cause = 'ui' } = {}) {
        calls.push({ type, payload: clone(payload), cause });
        if (!commands[type]) return { ok: false, code: 'UNKNOWN_COMMAND', message: `There is no command "${type}".` };
        const draft = clone(current);
        counter += 1;
        const receiptId = `rc_${counter.toString(36).padStart(8, '0')}`;
        const ctx = {
            receiptId,
            read: name => deepFreeze(clone(draft.domains[name] ?? null)),
            draft: name => (draft.domains[name] ??= {}),
            call(subType, subPayload) {
                if (!commands[subType]) throw failure('UNKNOWN_COMMAND', `There is no command "${subType}".`);
                return commands[subType](ctx, subPayload);
            },
            claim(key) {
                if (draft.meta.claims[key] === true) return false;
                draft.meta.claims[key] = true;
                return true;
            },
            fail(code, message) { throw failure(code, message); },
            query: (name, args) => queries[name](deepFreeze(clone(draft)), args),
            rng: () => 0.5,
            roll: () => ({ total: 7, dice: [3, 4] }),
            settings: () => ({}),
            time: () => draft.domains.director?.time?.minutes ?? null,
        };
        let out;
        try {
            out = commands[type](ctx, clone(payload)) ?? {};
        } catch (error) {
            return { ok: false, code: error.code ?? 'FAILED', message: error.message };
        }
        draft.meta.rev += 1;
        const receipt = {
            id: receiptId, type, module: 'story-block', cause, seed: 0,
            summary: out.summary ?? '', narrate: out.narrate ?? false, data: out.data ?? {}, rev: draft.meta.rev,
        };
        current = draft;
        receipts.push(receipt);
        return { ok: true, receipt };
    }

    return {
        command,
        calls,
        receipts,
        state: () => deepFreeze(clone(current)),
        setState(next) { current = clone(next); },
        snapshot: () => ({ state: clone(current), receipts: receipts.length }),
        restore(snap) {
            current = clone(snap.state);
            receipts.length = snap.receipts;
        },
        query: (name, args) => {
            if (!queries[name]) throw new Error(`There is no query "${name}".`);
            return queries[name](deepFreeze(clone(current)), args);
        },
        view() {
            const frozen = deepFreeze(clone(current));
            return {
                state: frozen,
                query: (name, args) => {
                    if (!queries[name]) throw new Error(`There is no query "${name}".`);
                    return queries[name](frozen, args);
                },
                settings: {},
                chat: { length: 3, lastUser: 'We go on.' },
            };
        },
    };
}
