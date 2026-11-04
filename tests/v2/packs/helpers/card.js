// A card on the page for the card-offer tests: the real runtime and UI over a fake SillyTavern, with the card's lorebook entries injected.
import { createFakeContext } from '../../../../testkit/fake-st.js';
import { createRuntime } from '../../../../src/v2/runtime.js';
import { createPacksPart } from '../../../../src/v2/packs/index.js';
import { mountUi } from '../../../../src/v2/ui-host.js';
import { setupDom } from '../../view/mounts/helpers.js';
import { fixture } from '../../data-modules/helpers.js';
import { fakeFiles, webp } from './portraits.js';

export const tick = () => new Promise(resolve => setTimeout(resolve, 0));
export const settle = async () => { for (let i = 0; i < 8; i += 1) await tick(); };

/** The Sealcrown-like pack: one data module (the shipped reputation fixture), a cast with portraits when `portraits` is set. */
export function cardPack({ version = '1.0.0', id = 'sealcrown', capabilities = ['data-modules-v1'], portraits = [] } = {}) {
    // (the fixture names its own pack id inside its screens: the new id replaces it everywhere)
    const base = JSON.parse(JSON.stringify(fixture('reputation')).replaceAll('ersveil-factions', id));
    const person = file => ({ id: file.replace(/\W/g, ''), name: file.replace(/\..*/, ''), about: 'About.', look: 'Look.', start: { place: 'Docks', goal: 'A goal.' }, portrait: file });
    return { ...base, id, name: 'Sealcrown Blocks', version, requires: { storyBlock: '^2', capabilities }, content: { dataModules: base.content.dataModules, ...(portraits.length ? { cast: portraits.map(person) } : {}) } };
}

export const packEntry = (pack, title = `${pack.name} [storysuite:pack]`) => ({ book: 'card', uid: 1, title, keys: [], content: JSON.stringify(pack) });
export const dataUri = (bytes, type = 'webp') => `data:image/${type};base64,${Buffer.from(bytes).toString('base64')}`;
export const portraitsEntry = (pack, files, { v = 1, version = pack.version } = {}) => ({ book: 'card', uid: 2, title: 'Portraits [storysuite:portraits]', keys: [], content: `\`\`\`json\n${JSON.stringify({ v, pack: pack.id, version, files })}\n\`\`\`` });
export const settingsEntry = settings => ({ book: 'card', uid: 3, title: 'Settings [storysuite:settings]', keys: [], content: JSON.stringify({ v: 1, settings }) });
export const goodPortrait = (name = 'fenna.webp', seed = 1) => ({ [name]: dataUri(webp(300, seed)) });

/**
 * `entries`: the card's lorebook entries (a function is read at each read); `installed`: packs to install first;
 * `group`: a group chat. → { doc, st, ui, runtime, offer, files, reads, box() }.
 */
export async function cardWorld(t, { entries = [], installed = [], group = false, rpg = undefined, settings = {}, errors = null } = {}) {
    t.mock.method(console, 'warn', () => {});
    const doc = setupDom();
    const st = createFakeContext({ extensionSettings: { storySuite: structuredClone(settings) } });
    if (group) st.ctx.groupId = 'group-1';
    const files = fakeFiles();
    let runtime = null;
    // The capability names the running modules offer (what st-adapter.js stCapabilities reads from the sdk on a page).
    const capabilities = () => {
        const names = new Set();
        for (const module of runtime?.sdk.modules() ?? []) { names.add(module.id); module.domains.forEach(name => names.add(name)); module.capabilities.forEach(name => names.add(name)); }
        return [...names];
    };
    const part = createPacksPart({
        settings: { read: () => st.ctx.extensionSettings.storySuite, save: () => st.ctx.saveSettingsDebounced?.() },
        portraitFiles: files,
        capabilities,
    });
    let ui = null;
    runtime = createRuntime({ ctx: st.ctx, packs: part, onRegister: () => ui?.syncScreens() });
    // `reads.queue`: reads a test holds back: `{ gate: Promise, entries }` is taken by the next read, which answers `entries` after `gate`.
    const reads = { count: 0, queue: [] };
    const readLorebook = async () => {
        reads.count += 1;
        if (errors) throw errors;
        const held = reads.queue.shift();
        if (held) { await held.gate; return { character: 'Ilsa', card: 'ilsa.png', entries: held.entries, problem: '' }; }
        return { character: 'Ilsa', card: 'ilsa.png', entries: typeof entries === 'function' ? entries() : entries, problem: '' };
    };
    ui = mountUi({ runtime, ctx: st.ctx, doc, readLorebook });
    runtime.turn.install({ globalName: null });
    st.interceptor = runtime.turn.interceptor;
    t.after(() => runtime.turn.uninstall({ globalName: null }));
    runtime.markReady();
    await runtime.turn.onChatChanged();
    for (const pack of installed) { const result = await runtime.packs.packs.install(pack); if (!result.ok) throw new Error(JSON.stringify(result.errors)); }
    await settle();
    if (rpg !== undefined) runtime.features.set('story-block.rpg', rpg);
    await ui.cardOffer.refresh();
    await settle();
    return {
        doc, st, ui, runtime, files, reads, offer: ui.cardOffer,
        box: () => doc.querySelector('.ss-card-offers'),
        notices: () => doc.querySelectorAll('.ss-card-offer'),
        dot: () => doc.querySelector('.ss-card-offer-dot'),
        button: (node, text) => node.querySelectorAll('button').find(item => item.textContent === text),
    };
}
