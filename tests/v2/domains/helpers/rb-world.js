// Story Block's core module and the test-only rules stand-in (rb-stub.js) on the real command bus, over a
// small stocked state, for the seam tests: commands run as the host runs them, a refusal anywhere rolls the
// whole transaction back, and queries (the stand-in's too) see the transaction's drafts.
import { createCommandBus } from '../../../../src/v2/commands.js';
import { createCoreModule } from '../../../../src/v2/domains/index.js';
import { counterIds, fakeRegistry, fakeStore } from '../../helpers/bus-fakes.js';
import { stocked } from '../fixtures.js';
import { createRbStub } from './rb-stub.js';

export const REN = 'ac_ren00001';
export const MIRA = 'ac_mira0001';
export const REPLY = { index: 1, sid: 'sr_reply001' };

/**
 * options: { rb?: createRbStub options, noRb?: true (Story Block alone), hooks?: { name: fn[] }, settings?: Story
 * Block's settings, edit?(state) (change the stocked state before it is stored), modules?: more module defs,
 * registry?: members laid over the fake registry (featureOn, commandFeature, feature) }.
 * Returns { bus, store, module, stub, query(name, args), command(type, payload, cause?), capture(line, carrier?),
 * head(), inv(), rules() }.
 */
export function world({ rb = {}, noRb = false, hooks = {}, settings = {}, edit = null, modules = [], registry = {} } = {}) {
    const stub = createRbStub(rb);
    let ask = () => { throw new Error('not ready'); };
    const module = createCoreModule({ hooks: name => hooks[name] ?? [], settings: () => settings, query: (name, args) => ask(name, args) });
    const all = [module, ...(noRb ? [] : [stub.module]), ...modules];
    const state = stocked(module);
    if (!noRb) state.domains.rbrules = stub.module.domains.rbrules.initial();
    for (const extra of modules) for (const [name, domain] of Object.entries(extra.domains ?? {})) state.domains[name] ??= domain.initial();
    // The player character and one more member, so equipment has someone to be worn by.
    state.domains.party = { pc: REN, order: [REN, MIRA], actors: { [REN]: { id: REN, name: 'Ren' }, [MIRA]: { id: MIRA, name: 'Mira' } } };
    edit?.(state);
    const store = fakeStore(state);
    const bus = createCommandBus({
        store, registry: { ...fakeRegistry(all), featureOn: () => true, ...registry }, settings: id => (id === module.id ? settings : {}), id: counterIds(), seed: () => 42,
    });
    const queries = new Map();
    for (const def of all) for (const [name, fn] of Object.entries(def.queries ?? {})) if (!queries.has(name)) queries.set(name, fn);
    const query = (name, args = {}) => {
        const fn = queries.get(name);
        if (!fn) throw Object.assign(new Error(`There is no query called "${name}".`), { code: 'NOT_FOUND' });
        return JSON.parse(JSON.stringify(fn(store.head(), args, { query })));
    };
    ask = query;
    return {
        bus, store, module, stub, query, modules: all,
        command: (type, payload, cause = 'ui', options = {}) => bus.command(type, payload, { cause, ...options }),
        // One change line through the real capture path, kept in the store when it works.
        capture(line, carrier = REPLY) {
            const result = bus.run(`${line.kind}.capture`, line, { cause: 'story', seed: 7, state: store.head(), carrier, capture: { moduleId: module.id, apply: module.capture.apply } });
            if (result.ok) store.replaceHead(result.state);
            return result;
        },
        head: () => store.head(),
        inv: () => store.head().domains.inventory,
        rules: () => store.head().domains.rbrules?.rules ?? {},
    };
}
