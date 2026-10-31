// A minimal stand-in for the command bus (§3.2) to test module handlers without the real one:
// read (deep-frozen copy), draft (own domains only, else NOT_OWNER), call (sub-command, same
// transaction), claim, query (over the transaction's state, drafts included), rng (seeded,
// deterministic), roll, fail, settings, time, receiptId, rev, cause and caller. `run` mimics the commit step: handler on drafts, then every touched domain's
// validator; any throw or validation error rejects the whole command and keeps nothing.

const clone = value => JSON.parse(JSON.stringify(value));

function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        Object.values(value).forEach(deepFreeze);
    }
    return value;
}

// mulberry32: enough for tests (the real bus uses sfc32).
function seeded(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function failure(code, message) {
    return Object.assign(new Error(message), { code });
}

function assertPlain(value, path) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new Error(`not a finite number at ${path}`);
        return;
    }
    if (typeof value !== 'object') throw new Error(`not plain JSON at ${path}: ${typeof value}`);
    for (const [key, item] of Object.entries(value)) assertPlain(item, `${path}/${key}`);
}

export function initialState(modules) {
    const state = { v: 2, meta: { rev: 0, claims: {} }, domains: {} };
    for (const module of modules) {
        for (const [name, domain] of Object.entries(module.domains ?? {})) state.domains[name] = domain.initial();
    }
    return state;
}

/**
 * modules: module definitions (the first is the one under test); settings: { [moduleId]: object }; returns
 * { state, run(type, payload, opts), capture(line, opts), query(name, args) }.
 */
export function createHarness(modules, { state, settings = {} } = {}) {
    const list = Array.isArray(modules) ? modules : [modules];
    let current = deepFreeze(clone(state ?? initialState(list)));
    let receipts = 0;
    const owners = new Map();
    const commands = new Map();
    const queries = new Map();
    for (const module of list) {
        Object.keys(module.domains ?? {}).forEach(domain => owners.set(domain, module));
        Object.entries(module.commands ?? {}).forEach(([type, fn]) => commands.set(type, { module, fn }));
        Object.entries(module.queries ?? {}).forEach(([name, fn]) => { if (!queries.has(name)) queries.set(name, fn); });
    }
    // A query is called (state, args, tools) with tools.query over the same state (MODULES.md F3).
    const runQuery = (state, name, args) => {
        const fn = queries.get(name);
        if (!fn) throw failure('NOT_FOUND', `There is no query called "${name}".`);
        const frozen = deepFreeze(clone(state));
        return clone(fn(frozen, deepFreeze(clone(args ?? {})), { query: (other, more) => runQuery(frozen, other, more) }));
    };

    // `extra`: more ctx fields for the handler (`feature`, `carrier`, `chat`), as a newer host gives them.
    function execute(module, body, { cause = 'ui', seed = 1, caller = null, extra = {} } = {}) {
        const working = clone(current);
        const touched = new Set();
        const rng = seeded(seed);
        receipts += 1;
        const receiptId = `rc_${String(receipts).padStart(8, '0')}`;
        const makeCtx = (self, callerId) => ({
            cause,
            caller: callerId,
            receiptId,
            rev: current.meta.rev + 1,
            read: domain => deepFreeze(clone(working.domains[domain] ?? null)),
            draft: domain => {
                if (owners.get(domain) !== self) throw failure('NOT_OWNER', `${self.id} does not own ${domain}.`);
                touched.add(domain);
                return working.domains[domain];
            },
            call: (type, payload) => {
                const entry = commands.get(type);
                if (!entry) throw failure('UNKNOWN_COMMAND', `There is no command ${type}.`);
                return entry.fn(makeCtx(entry.module, self.id), payload);
            },
            // Appends to a list that are a set's (SPEC §2.2 rule e): the fake bus stores whole domains, so nothing to mark.
            unique: () => {},
            claim: key => {
                if (working.meta.claims[key]) return false;
                working.meta.claims[key] = true;
                return true;
            },
            query: (name, args) => deepFreeze(runQuery(working, name, args)),
            rng,
            roll: () => ({ total: 1 + Math.floor(rng() * 6), dice: [] }),
            settings: (id = self.id) => deepFreeze(clone(settings[id] ?? {})),
            time: () => null,
            fail: (code, message) => {
                throw failure(code, message);
            },
            ...extra,
        });
        let result;
        try {
            result = body(makeCtx(module, caller));
        } catch (error) {
            return { ok: false, code: error.code ?? 'FAILED', message: error.message };
        }
        const errors = [...touched].flatMap(domain => owners.get(domain).domains[domain].validate(working.domains[domain], working));
        if (errors.length) return { ok: false, code: 'INVALID', message: errors.join(' '), errors };
        // Plain JSON only (§2.1): an undefined or a non-finite number would not survive the save.
        assertPlain(working, '');
        working.meta.rev += 1;
        current = deepFreeze(working);
        return { ok: true, result, receiptId, state: current };
    }

    return {
        get state() { return current; },
        set state(value) { current = deepFreeze(clone(value)); },
        run(type, payload, opts = {}) {
            const entry = commands.get(type);
            if (!entry) return { ok: false, code: 'UNKNOWN_COMMAND', message: `There is no command ${type}.` };
            return execute(entry.module, ctx => entry.fn(ctx, payload), opts);
        },
        capture(line, opts = {}) {
            const module = list.find(item => item.capture?.kinds?.[line.kind]);
            if (!module) return { ok: false, code: 'UNKNOWN_KIND', message: `No module handles ${line.kind}.` };
            return execute(module, ctx => module.capture.apply(ctx, line), { cause: 'story', ...opts });
        },
        query(name, args) {
            return runQuery(current, name, args);
        },
    };
}

/** A parsed change line as SB-turn's parseChanges gives it (§12). */
export function line(op, kind, name, labels = {}, text = '') {
    return { op, kind, name, text, labels, raw: `${op} ${kind} ${name}`, index: 0 };
}
