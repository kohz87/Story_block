// A fake Story Block v2 sdk for the fishing tests: only the public surface of SPEC §3.1 and §6
// (registerModule, command, query, modules, on) plus a tiny transaction ctx (SPEC §3.2), a fake
// `inventory` owner (inventory.grant / inventory.consume as SPEC §7 names them) and carriers with
// swipes (SPEC §2.2), so swipe and narration behaviour can be checked. Not Story Block's real runtime.

const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
function freeze(value) {
    if (value && typeof value === 'object') {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
    }
    return value;
}

// sfc32 seeded through splitmix32, as SPEC §3.2 describes ctx.rng.
export function rng(seed) {
    let s = seed >>> 0;
    const split = () => {
        s = (s + 0x9e3779b9) >>> 0;
        let z = s;
        z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
        z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
        return (z ^ (z >>> 16)) >>> 0;
    };
    let a = split(), b = split(), c = split(), d = split();
    return () => {
        const t = (((a + b) >>> 0) + d) >>> 0;
        d = (d + 1) >>> 0;
        a = b ^ (b >>> 9);
        b = (c + (c << 3)) >>> 0;
        c = ((c << 21) | (c >>> 11)) >>> 0;
        c = (c + t) >>> 0;
        return t / 4294967296;
    };
}

class Fail extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

// The fake inventory module: defs by alias, stacks stamped with the receipt that made them.
function inventoryModule() {
    return {
        id: 'story-block',
        domains: {
            inventory: { initial: () => ({ defs: {}, stacks: {}, wallets: {}, aliases: {} }), validate: () => [] },
            scene: { initial: () => ({ place: { name: '', kind: '', region: '' }, present: [] }), validate: () => [] },
        },
        commands: {
            'inventory.grant'(ctx, { def, qty, owner }) {
                if (!def || typeof def.name !== 'string' || !Number.isInteger(qty) || qty < 1) ctx.fail('INVALID', 'Bad grant.');
                const inv = ctx.draft('inventory');
                const key = def.name.toLowerCase();
                let defId = inv.aliases[key];
                if (!defId) {
                    defId = `story/${key.replace(/[^a-z0-9]+/g, '-')}`;
                    inv.defs[defId] = { id: defId, stack: true, slot: null, stats: {}, effect: {}, tags: [], ...def };
                    inv.aliases[key] = defId;
                }
                let stack = Object.values(inv.stacks).find(s => s.def === defId && s.owner === owner);
                if (stack) stack.qty += qty;
                else {
                    const id = `it_${ctx.receiptId.slice(3, 7)}${String(Object.keys(inv.stacks).length).padStart(4, '0')}`;
                    stack = inv.stacks[id] = { id, def: defId, qty, owner, equipped: null, note: def.note ?? '', from: ctx.receiptId };
                }
                return { summary: '', data: { stack: stack.id } };
            },
            'inventory.consume'(ctx, { stack, qty }) {
                const inv = ctx.draft('inventory');
                const s = inv.stacks[stack];
                if (!s) ctx.fail('NOT_FOUND', 'No such stack.');
                if (s.qty < qty) ctx.fail('NOT_ENOUGH', 'Not enough left.');
                s.qty -= qty;
                if (s.qty === 0) delete inv.stacks[stack];
                return { summary: '' };
            },
        },
        queries: {
            'scene.place': state => clone(state.domains.scene.place),
        },
    };
}

/**
 * createFakeSdk({ seeds }) → the sdk plus test handles:
 *   calls          every command run: [{ type, payload, cause }] (top level and ctx.call)
 *   carriers       [{ swipes: [{ ops: state snapshot after, receipts, narrated }], swipe_id }]
 *   reply(), swipe(), setPlace(place), head()
 */
export function createFakeSdk({ seeds = [], extraQueries = {} } = {}) {
    const modules = [inventoryModule()];
    const listeners = { committed: [], head: [], turn: [] };
    const calls = [];
    let seedQueue = seeds.slice();
    let counter = 0;
    let rev = 0;

    const owners = {};
    const commands = {};
    const queries = { ...extraQueries };
    const register = def => {
        for (const name of Object.keys(def.domains ?? {})) owners[name] = def.id;
        for (const [type, handler] of Object.entries(def.commands ?? {})) commands[type] = { module: def.id, handler };
        Object.assign(queries, def.queries ?? {});
    };
    register(modules[0]);

    const blankState = () => {
        const state = { v: 2, meta: { rev: 0, claims: {} }, domains: {} };
        for (const mod of modules) for (const [name, d] of Object.entries(mod.domains ?? {})) state.domains[name] = d.initial();
        return state;
    };
    // The greeting is carrier 0, holding the initial state.
    const carriers = [{ swipe_id: 0, swipes: [{ state: blankState(), receipts: [], narrated: [] }] }];
    const current = carrier => carrier.swipes[carrier.swipe_id];
    const head = () => current(carriers[carriers.length - 1]).state;

    function run(type, payload, cause) {
        const seed = seedQueue.length ? seedQueue.shift() : (12345 + counter * 7919) >>> 0;
        const receiptId = `rc_${(++counter).toString(36).padStart(8, '0')}`;
        const work = clone(head());
        const random = rng(seed);
        const ctxFor = moduleId => ({
            receiptId,
            read: name => (name in work.domains ? freeze(clone(work.domains[name])) : null),
            draft: name => {
                if (owners[name] !== moduleId) throw new Fail('NOT_OWNER', `${moduleId} does not own ${name}.`);
                return work.domains[name];
            },
            call: (subType, subPayload) => {
                const sub = commands[subType];
                if (!sub) throw new Fail('UNKNOWN_COMMAND', `No command ${subType}.`);
                calls.push({ type: subType, payload: clone(subPayload), cause, sub: true });
                return sub.handler(ctxFor(sub.module), freeze(clone(subPayload)));
            },
            claim: key => (work.meta.claims[key] ? false : (work.meta.claims[key] = true)),
            rng: random,
            roll: () => ({ total: 0, dice: [] }),
            query: (name, args) => {
                if (!queries[name]) throw new Fail('NOT_FOUND', `There is no query called "${name}".`);
                return freeze(clone(queries[name](freeze(clone(work)), args)));
            },
            settings: () => ({}),
            time: () => null,
            fail: (code, message) => {
                throw new Fail(code, message);
            },
        });
        const entry = commands[type];
        if (!entry) return { ok: false, code: 'UNKNOWN_COMMAND', message: `There is no ${type} command.` };
        calls.push({ type, payload: clone(payload), cause });
        try {
            const out = entry.handler(ctxFor(entry.module), freeze(clone(payload) ?? {})) ?? {};
            for (const mod of modules) {
                for (const [name, d] of Object.entries(mod.domains ?? {})) {
                    const errors = d.validate(work.domains[name], work);
                    if (errors.length) throw new Fail('INVALID', errors[0]);
                }
            }
            work.meta.rev = ++rev;
            const receipt = {
                id: receiptId, type, module: entry.module, cause, seed, summary: out.summary ?? '',
                narrate: out.narrate === true, data: clone(out.data ?? {}), rev: work.meta.rev,
            };
            const holder = current(carriers[carriers.length - 1]);
            holder.state = work;
            holder.receipts.push(receipt);
            listeners.committed.forEach(fn => fn(receipt));
            return { ok: true, receipt };
        } catch (error) {
            return { ok: false, code: error.code ?? 'FAILED', message: error.message };
        }
    }

    // Untold receipts (SPEC §4.1): narrate:true receipts on carriers after the last one that told them.
    function untold() {
        const told = new Set(carriers.flatMap(c => current(c).narrated));
        return carriers.flatMap(c => current(c).receipts).filter(r => r.narrate && !told.has(r.id));
    }

    const sdk = {
        registerModule(def) {
            modules.push(def);
            register(def);
            const state = head();
            for (const [name, d] of Object.entries(def.domains ?? {})) if (!state.domains[name]) state.domains[name] = d.initial();
        },
        command: async (type, payload, { cause = 'ui' } = {}) => run(type, payload, cause),
        query: (name, args) => (queries[name] ? queries[name](clone(head()), args) : null),
        modules: () => modules.slice(),
        on: (event, fn) => listeners[event]?.push(fn),
        id: prefix => `${prefix}_${(++counter).toString(36).padStart(8, '0')}`,
    };

    return {
        sdk,
        calls,
        carriers,
        head: () => freeze(clone(head())),
        untold,
        view: () => ({ state: freeze(clone(head())), query: sdk.query, settings: {}, chat: { length: carriers.length, lastUser: '' } }),
        setPlace(place) {
            head().domains.scene.place = { name: '', kind: '', region: '', ...place };
        },
        // A new reply: it tells what is untold, and carries the head state on.
        reply() {
            const told = untold().map(r => r.id);
            carriers.push({ swipe_id: 0, swipes: [{ state: clone(head()), receipts: [], narrated: told }] });
            listeners.turn.forEach(fn => fn());
            return told;
        },
        // Swipe the last reply: a new swipe starting from the state before it, told afresh.
        swipe() {
            const last = carriers[carriers.length - 1];
            const before = current(carriers[carriers.length - 2]).state;
            last.swipes.push({ state: clone(before), receipts: [], narrated: [] });
            last.swipe_id = last.swipes.length - 1;
            const told = untold().map(r => r.id);
            current(last).narrated = told;
            listeners.head.forEach(fn => fn());
            return told;
        },
        nextSeeds(list) {
            seedQueue = list.slice();
        },
    };
}
