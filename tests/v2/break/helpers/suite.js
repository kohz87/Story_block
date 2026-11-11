// Suite harness: Story Block's real testkit host with Story Director and NPC State Delta registered beside it and the
// Ersveil example pack installed (Lean RPG is Story Block's own part now, so the suite is three repos).
// Where the checkouts come from: SUITE_SB / SUITE_SD / SUITE_NSD (a folder each) win; else STORY_SUITE_ROOT
// (<root>/Story_director, <root>/npc_state_delta); else the folders beside this checkout. Story Block is this checkout.
// No folder found: loadSuite() answers { skip } and the test skips.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const SB = process.env.SUITE_SB ?? path.resolve(here, '../../../..');
const ROOTS = [process.env.STORY_SUITE_ROOT, path.resolve(SB, '..')].filter(Boolean);
const find = (env, name, rel) => [env, ...ROOTS.map(root => path.join(root, name))].filter(Boolean).find(dir => existsSync(path.join(dir, rel)));

export const roots = () => ({
    sb: SB,
    sd: find(process.env.SUITE_SD, 'Story_director', 'src/v2/module.js'),
    nsd: find(process.env.SUITE_NSD, 'npc_state_delta', 'src/storysuite-v2.js'),
});

export async function loadSuite() {
    const r = roots();
    if (!r.sd || !r.nsd) return { skip: 'no Story_director / npc_state_delta checkout beside this one (STORY_SUITE_ROOT, SUITE_SD, SUITE_NSD)', roots: r };
    const at = (dir, rel) => import(pathToFileURL(path.join(dir, rel)).href);
    const [kit, SD, NSD] = await Promise.all([at(r.sb, 'testkit/index.js'), at(r.sd, 'src/v2/module.js'), at(r.nsd, 'src/storysuite-v2.js')]);
    return { roots: r, createHost: kit.createHost, SD, NSD, at: rel => at(r.sb, rel), packText: readFileSync(path.join(r.sb, 'examples/packs/ersveil/pack.json'), 'utf8') };
}

/** A host with the two modules and the Ersveil pack installed before the chat starts. crypto is seeded while it lives. */
export async function suiteHost(loaded, { seed = 1, settings = null, nsdNpcs = [] } = {}) {
    // Receipt ids, seeds and reply ids follow the seed (the QA helper; its ids differ from the first character, unlike a counter's).
    const restoreCrypto = (await loaded.at('tests/v2/qa/helpers/seeded.js')).seedCrypto(seed);
    let sdk = null;
    const sd = loaded.SD.createModule({ host: { settings: id => sdk?.settings(id) ?? null, substitute: text => sdk?.substitute(text) } });
    // NPC State Delta connects the way the page does (adapter.start(): it registers itself with the host and learns the sdk it
    // reads Story Director's clock through); handing its bare definition to the host would leave its story day unknown.
    const adapter = loaded.NSD.createStorySuiteV2Adapter({ suiteApi: { npcs: () => nsdNpcs }, delta: () => ({ isEnabled: () => true, getNpc: () => null }), host: () => globalThis.StoryBlock, doc: null, timers: {}, logger: { warn() {} } });
    const probe = await loaded.createHost({ settings: settings ?? {} });
    const done = await probe.packs.packs.install(loaded.packText, { origin: 'pack.json' });
    if (!done.ok) throw new Error('pack install failed: ' + JSON.stringify(done.errors));
    const storySuite = structuredClone(probe.ctx.extensionSettings.storySuite);
    probe.close();
    const host = await loaded.createHost({ settings: storySuite, modules: [sd] });
    sdk = host.sdk;
    const savedSB = globalThis.StoryBlock;
    globalThis.StoryBlock = { apiVersion: 2, ready: Promise.resolve(sdk), sdk };
    adapter.start();
    const hosted = await adapter.settled();
    if (!hosted) throw new Error('NPC State Delta did not register with the host');
    const close = host.close;
    host.close = () => {
        adapter.stop?.();
        close();
        if (savedSB === undefined) delete globalThis.StoryBlock; else globalThis.StoryBlock = savedSB;
        restoreCrypto();
    };
    host.q = (name, args) => sdk.query(name, args);
    host.cmd = (type, payload = {}, opts) => sdk.command(type, payload, opts);
    host.reply = (text, lines = []) => (lines.length ? `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
    return host;
}
