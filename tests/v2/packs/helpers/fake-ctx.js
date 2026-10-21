// A small fake command ctx (SPEC §3.2 plus query), for checking how another part reaches
// the packs part: only through `ctx.query`, never by importing its internals.
export function fakeCtx({ state = { v: 2, meta: { rev: 0, claims: {} }, domains: {} }, queries = {}, settings = {} } = {}) {
    const claims = new Set(Object.keys(state.meta.claims));
    return {
        receiptId: 'rc_testtest',
        read: domain => Object.freeze(structuredClone(state.domains[domain])),
        draft: domain => state.domains[domain],
        call: () => { throw new Error('fake ctx: call is not used by packs tests'); },
        claim: key => (claims.has(key) ? false : (claims.add(key), true)),
        rng: () => 0.5,
        roll: () => ({ total: 7, dice: [3, 4] }),
        settings: id => settings[id] ?? {},
        time: () => null,
        fail: (code, message) => { throw Object.assign(new Error(message), { code }); },
        query: (name, args) => {
            if (!queries[name]) throw new Error(`fake ctx: no query ${name}`);
            return queries[name](state, args);
        },
    };
}
