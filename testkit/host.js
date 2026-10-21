// createHost(): a whole Story Block v2 host on a fake SillyTavern context, the way index.js
// wires it (registry, settings, store, command bus, sdk, turn), for module tests (docs/v2/SPEC.md
// §10). The store and the command bus are imported lazily from ../src/v2/, so the testkit loads
// in a checkout that does not have them yet; `hostAvailable()` says whether they are there, for
// `test(..., { skip })`. `fakes: true` uses the small stand-ins in fakes.js instead.
//
// Vendored into a module's tests/vendor/story-block/ (npm run sync-testkit), the layout is kept:
// testkit/ next to src/v2/, so the relative imports below work there too.

import { createFakeContext } from './fake-st.js';
import { createFakeBus, createFakeStore } from './fakes.js';
import { createRegistry } from '../src/v2/registry.js';
import { createEvents, createSdk, createSettings } from '../src/v2/sdk.js';
import { createTurn } from '../src/v2/turn.js';

const RUNTIME = { store: '../src/v2/store.js', commands: '../src/v2/commands.js' };
const DOMAINS = '../src/v2/domains/index.js';

async function load(path) {
    try { return { module: await import(path) }; } catch (error) {
        return { error };
    }
}

/**
 * { ok, reason, missing }: whether the real store and command bus are in this checkout.
 * `reason` is a sentence for `test(name, { skip: reason })`.
 */
export async function hostAvailable() {
    const missing = [];
    for (const [name, path] of Object.entries(RUNTIME)) {
        const { module, error } = await load(path);
        if (!module) missing.push(`${name}.js (${error?.code === 'ERR_MODULE_NOT_FOUND' ? 'not in this checkout yet' : error?.message})`);
    }
    return {
        ok: !missing.length,
        missing,
        reason: missing.length ? `the Story Block v2 runtime is incomplete here: ${missing.join(', ')}` : '',
    };
}

// The core module (scene, inventory) when src/v2/domains/ exists: createCoreModule({ hooks }) with
// the registry's hooks, else its `modules` (or default) list, or every exported module definition.
async function coreModules(registry) {
    const { module } = await load(DOMAINS);
    if (!module) return [];
    if (typeof module.createCoreModule === 'function') return [module.createCoreModule({ hooks: name => registry.hooks(name) })];
    const list = module.modules ?? module.default;
    if (Array.isArray(list)) return list;
    if (list && typeof list === 'object' && list.id) return [list];
    return Object.values(module).filter(value => value && typeof value === 'object' && typeof value.id === 'string' && value.domains);
}

/**
 * Builds a host. `options`: { modules?: def[] (registered after the core ones), core?: true
 * (register src/v2/domains/ when present), fakes?: false (use fakes.js), st?: options for
 * createFakeContext (plus onBlocked?), settings?: initial extension_settings.storySuite }.
 * Returns { st, ctx, registry, settings, store, bus, events, sdk, turn, send(text, reply),
 * swipe(reply), regenerate(reply), cont(reply), quiet(), head(), close() }; `st` is the fake
 * SillyTavern (fake-st.js), with `st.notices` = [{ reason, moduleId }] for held-back generations. Throws when the runtime is missing and `fakes` is not set.
 */
export async function createHost(options = {}) {
    const { modules = [], core = true, fakes = false, st: stOptions = {}, settings: initialSettings = null } = options;
    let createStore = createFakeStore;
    let createCommandBus = createFakeBus;
    if (!fakes) {
        const available = await hostAvailable();
        if (!available.ok) throw new Error(`testkit: ${available.reason}.`);
        ({ createStore } = await import(RUNTIME.store));
        ({ createCommandBus } = await import(RUNTIME.commands));
    }
    const extensionSettings = stOptions.extensionSettings ?? {};
    if (initialSettings) extensionSettings.storySuite = structuredClone(initialSettings);
    const st = createFakeContext({ ...stOptions, extensionSettings });
    // What the reader was told when a generation was held back (a toastr warning live).
    st.notices = [];
    const ctx = st.ctx;

    const registry = createRegistry();
    for (const def of core ? await coreModules(registry) : []) registry.register(def);
    for (const def of modules) registry.register(def);

    const settings = createSettings({ root: () => ctx.extensionSettings, registry, save: () => ctx.saveSettingsDebounced() });
    const store = createStore({ chat: () => ctx.chat, save: () => ctx.saveChat() });
    const bus = createCommandBus({ store, registry, settings });
    const events = createEvents();
    const { sdk, markReady } = createSdk({ store, bus, registry, settings, events, chat: () => ctx.chat });
    const turn = createTurn({ ctx, store, bus, registry, settings, events, onBlocked: stOptions.onBlocked ?? null, notify: (reason, moduleId) => st.notices.push({ reason, moduleId }) });
    turn.install({ globalName: null });
    st.interceptor = turn.interceptor;
    await turn.onChatChanged();
    markReady();

    return {
        st, ctx, registry, settings, store, bus, events, sdk, turn,
        send: (text, reply = '') => st.send(text, { reply }),
        swipe: (reply = '') => st.generate('swipe', { reply }),
        regenerate: (reply = '') => st.generate('regenerate', { reply }),
        cont: (reply = '') => st.generate('continue', { reply }),
        quiet: (reply = '') => st.generate('quiet', { reply }),
        head: () => store.head(),
        close: () => turn.uninstall({ globalName: null }),
    };
}
