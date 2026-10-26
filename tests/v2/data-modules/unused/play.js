// Seeded random chats for the "unused means byte-identical" property (DATA_MODULES.md section 4, differential property).
//
//   play({ root, seed, steps, siblings, pack }) -> { steps: [hash...], saves, draws, final }
//
// `root` is the Story Block tree to run on (its testkit, its src): the same scenario runs on today's tree and on the
// baseline commit this branch started from (main at 958021b, v2.1.0), whose trace is stored in fixtures/unused-baseline.json
// (scripts/dm-unused-golden.mjs writes it). `siblings` ({ sd?, rb?, nsd? } checkout folders) adds the real modules,
// scripted by the matrix's own module scripts. Everything random comes from `seed`: the choices below and the host's
// crypto (receipt ids, seeds), so two runs differ only if the code under test does.
//
// Per step the trace holds one hash over the exact serialized chat (messages and their extras), chat metadata, head
// state, the prompt the next reply would carry, and the problems list; the end holds the saves, the RNG draws and the
// installed packs' normalized form. No placeholder is ever added for a data module that nobody pinned.
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const at = (root, rel) => import(pathToFileURL(join(root, rel)).href);
const sha = text => createHash('sha256').update(text).digest('hex').slice(0, 16);

function mulberry(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// A deterministic stand-in for globalThis.crypto that counts what is drawn.
function seededCrypto(seed) {
    let x = seed | 0;
    const counter = { draws: 0 };
    const next = () => {
        counter.draws += 1;
        x = (x + 0x9E3779B9) | 0;
        let z = x;
        z = Math.imul(z ^ (z >>> 16), 0x85EBCA6B);
        z = Math.imul(z ^ (z >>> 13), 0xC2B2AE35);
        return (z ^ (z >>> 16)) >>> 0;
    };
    return {
        counter,
        source: {
            getRandomValues(array) {
                for (let i = 0; i < array.length; i += 1) {
                    const value = next();
                    array[i] = array instanceof Uint8Array ? value & 0xFF : value;
                }
                return array;
            },
            randomUUID: () => `00000000-0000-4000-8000-${String(next()).padStart(12, '0').slice(0, 12)}`,
        },
    };
}

const NAMES = ['Torch', 'Rope', 'Lantern', 'Flask', 'Key', 'Map'];
const PLACES = ['Bluewatch Village', 'Millbrook', 'Harrow', 'Old Quay', 'The Weir'];
const PEOPLE = ['Odda', 'Brecht', 'Corin', 'Mira'];
const WEATHER = ['cold drizzle', 'low fog', 'clear and still', 'hard wind'];

export function replyLines(pick, { time = false } = {}) {
    const lines = [];
    const count = Math.floor(pick() * 4);
    for (let i = 0; i < count; i += 1) {
        const roll = Math.floor(pick() * (time ? 11 : 9));
        const name = NAMES[Math.floor(pick() * NAMES.length)];
        const qty = 1 + Math.floor(pick() * 3);
        lines.push([
            `+ coin ${1 + Math.floor(pick() * 30)} | from: a stranger`, `+ item ${name} | qty: ${qty}`, `- item ${name} | qty: 1`,
            `~ place ${PLACES[Math.floor(pick() * PLACES.length)]} | kind: settlement`, `+ present ${PEOPLE[Math.floor(pick() * PEOPLE.length)]}`,
            `- present ${PEOPLE[Math.floor(pick() * PEOPLE.length)]}`, `~ weather ${WEATHER[Math.floor(pick() * WEATHER.length)]}`,
            `? loot ${name}, Coil of cord x2 — under the stairs`,
            // A line that looks like a data module's in a chat that has none: an unknown kind, as before.
            `+ dm reputation — a favour | kind: gain | faction: guild`,
            `! time +${1 + Math.floor(pick() * 5)}h`, `~ time June ${3 + Math.floor(pick() * 20)}, 1200, ${1 + Math.floor(pick() * 11)}:00 am`,
        ][roll]);
    }
    return lines;
}
export const asReply = (text, lines) => (lines.length ? `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);

/** Runs one seeded chat on the tree at `root`. `pack`: an object to install before the chat starts (null for none). */
export async function play({ root, seed = 1, steps = 40, siblings = {}, packs = [], libraryOnly = [], detail = false } = {}) {
    const { createHost } = await at(root, 'testkit/index.js');
    const matrix = await at(root, 'testkit/matrix/index.js');
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    const { counter, source } = seededCrypto(seed * 7919 + 13);
    Object.defineProperty(globalThis, 'crypto', { value: source, configurable: true, writable: true });
    const pick = mulberry(seed);
    const trace = [];
    const detailed = [];
    let host = null;
    try {
        const { loaded } = await matrix.loadModules(Object.fromEntries(Object.entries(siblings).filter(([, folder]) => folder)));
        const ref = { sdk: null };
        const modules = ['rb', 'sd', 'nsd'].filter(key => loaded[key]).map(key => loaded[key].make(ref));
        let settings = {};
        const seedPacks = [...packs];
        if (seedPacks.length) {
            const probe = await createHost({ settings: {} });
            for (const item of seedPacks) {
                const done = await probe.packs.packs.install(item.text, { origin: item.origin ?? 'pack.json' });
                if (!done.ok) throw new Error(`pack ${item.origin} did not install: ${JSON.stringify(done.errors)}`);
            }
            settings = structuredClone(probe.ctx.extensionSettings.storySuite);
            probe.close();
        }
        host = await createHost({ settings, modules });
        ref.sdk = host.sdk;
        const savedSB = globalThis.StoryBlock;
        globalThis.StoryBlock = { apiVersion: 2, ready: Promise.resolve(host.sdk), sdk: host.sdk };
        for (const key of ['rb']) if (loaded[key]?.setup) await loaded[key].setup(host);
        // Library only: definitions that are installed (and inspected, and previewed) but never enabled for this chat.
        const inspect = () => { for (const name of ['dataModules.offers', 'dataModules.setup', 'dataModules.presentation']) { try { host.sdk.query(name); } catch { /* an older tree has none of these */ } } };
        for (const item of libraryOnly) { await host.packs.packs.install(item.text, { origin: item.origin ?? 'pack.json' }); inspect(); }

        const snapshot = async label => {
            let prompt = '';
            try { prompt = JSON.stringify((await host.turn.preview?.()) ?? null); } catch (error) { prompt = `preview failed: ${error?.message}`; }
            const parts = {
                chat: JSON.stringify(host.ctx.chat), meta: JSON.stringify(host.ctx.chatMetadata ?? null), head: JSON.stringify(host.head()), prompt,
                problems: JSON.stringify(host.turn.problems().map(({ module, code, message, index, line }) => ({ module, code, message, index, line }))),
                saves: String(host.st.saves.length), draws: String(counter.draws),
            };
            trace.push(sha(Object.values(parts).join('\u0001')));
            if (detail) detailed.push({ label, parts });
        };

        const hasSD = Boolean(loaded.sd);
        const reply = (text = 'The story goes on.') => asReply(`${text} ${Math.floor(pick() * 1000)}`, replyLines(pick, { time: hasSD }));
        await host.send('Hello.', reply('Opening.'));
        await snapshot('open');
        for (let step = 0; step < steps; step += 1) {
            const roll = pick();
            const carriers = host.ctx.chat.map((message, index) => (message.is_user ? -1 : index)).filter(index => index >= 0);
            const any = () => carriers[Math.floor(pick() * carriers.length)];
            let label = 'send';
            try {
                if (roll < 0.34) { await host.send(`Turn ${step}.`, reply()); }
                else if (roll < 0.43) { label = 'swipe'; await host.swipe(reply('Another take.')); }
                else if (roll < 0.48) { label = 'regenerate'; await host.regenerate(reply('Once more.')); }
                else if (roll < 0.56) { label = 'continue'; await host.cont(asReply(' And then more.', replyLines(pick, { time: hasSD }))); }
                else if (roll < 0.64) { label = 'delete'; const index = any(); if (index !== undefined && index > 0) await host.st.deleteMessage(index); }
                else if (roll < 0.71) {
                    label = 'reread'; const index = any();
                    if (index !== undefined && index > 0) { host.ctx.chat[index].mes = reply('Edited.'); host.ctx.chat[index].swipes[host.ctx.chat[index].swipe_id ?? 0] = host.ctx.chat[index].mes; await host.turn.reread(index); }
                } else if (roll < 0.76) { label = 'reload'; await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat))); }
                else if (roll < 0.83) {
                    label = 'drop';
                    const stack = Object.values(host.head()?.domains?.inventory?.stacks ?? {})[0];
                    if (stack) await host.sdk.command('inventory.drop', { stack: stack.id, qty: 1 });
                } else if (roll < 0.88) { label = 'savepoint'; await host.sdk.timeline.make({ kind: 'manual', name: `Save ${step}` }); }
                else if (roll < 0.92) { label = 'inspect'; inspect(); }
                else if (roll < 0.94) { label = 'rebuild'; host.store.rebuild(); }
                else if (roll < 0.97) {
                    // A chat switch: another chat is opened, played once, and the first one comes back as it was.
                    label = 'switch';
                    const keep = JSON.parse(JSON.stringify(host.ctx.chat)), keepId = host.ctx.chatId;
                    await host.st.loadChat([], 'other-chat');
                    await host.send('Elsewhere.', reply('A different story.'));
                    await host.st.loadChat(keep, keepId);
                } else { label = 'feature'; host.features.set('story-block.loot', pick() < 0.5); }
            } catch (error) {
                trace.push(sha(`${label} threw ${error?.code ?? ''} ${error?.message ?? error}`));
            }
            await snapshot(label);
        }
        const finalPacks = JSON.stringify(host.packs.packs.packs().map(entry => entry));
        const result = { steps: trace, saves: host.st.saves.length, draws: counter.draws, final: sha(`${JSON.stringify(host.ctx.chat)}\u0001${JSON.stringify(host.head())}`), packs: sha(finalPacks), detailed };
        host.close();
        if (savedSB === undefined) delete globalThis.StoryBlock; else globalThis.StoryBlock = savedSB;
        host = null;
        return result;
    } finally {
        host?.close();
        if (saved) Object.defineProperty(globalThis, 'crypto', saved);
    }
}

/**
 * The combination matrix's own chats (testkit/matrix: each module's scripted replies A, B and C and its reader action) on the real
 * modules beside this tree, with `libraryOnly` packs installed and inspected but never enabled. The same hash per step as `play`.
 * Returns { steps, saves, draws } or null when no module is beside.
 */
export async function playMatrix({ root, siblings = {}, libraryOnly = [], seed = 1 } = {}) {
    const { createHost } = await at(root, 'testkit/index.js');
    const matrix = await at(root, 'testkit/matrix/index.js');
    const { loaded } = await matrix.loadModules(Object.fromEntries(Object.entries(siblings).filter(([, folder]) => folder)));
    const keys = ['rb', 'sd', 'nsd'].filter(key => loaded[key]);
    if (!keys.length) return null;
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    const { counter, source } = seededCrypto(seed * 104729 + 7);
    Object.defineProperty(globalThis, 'crypto', { value: source, configurable: true, writable: true });
    const trace = [];
    let host = null;
    const savedSB = globalThis.StoryBlock;
    const originalWarn = console.warn;
    try {
        console.warn = () => {};
        const ref = { sdk: null };
        host = await createHost({ modules: keys.map(key => loaded[key].make(ref)) });
        ref.sdk = host.sdk;
        globalThis.StoryBlock = { apiVersion: 2, ready: Promise.resolve(host.sdk), sdk: host.sdk };
        for (const item of libraryOnly) await host.packs.packs.install(item.text, { origin: item.origin });
        for (const key of keys) if (loaded[key].setup) await loaded[key].setup(host);
        const scripts = set => ['sb', ...keys].flatMap(key => matrix.MODULES[key][set]);
        const text = set => `The ${set} reply.\n\n<Changes>\n${scripts(set).join('\n')}\n</Changes>`;
        const snap = async label => {
            let prompt = '';
            try { prompt = JSON.stringify(await host.turn.preview()); } catch (error) { prompt = `preview ${error?.message}`; }
            trace.push(sha([label, JSON.stringify(host.ctx.chat), JSON.stringify(host.ctx.chatMetadata ?? null), JSON.stringify(host.head()), prompt,
                JSON.stringify(host.turn.problems().map(({ module, code, message, index }) => [module, code, message, index])), host.st.saves.length, counter.draws].join('\u0001')));
        };
        await host.send('Turn A.', text('A')); await snap('A');
        for (const key of ['sb', ...keys]) {
            const [type, payload] = await matrix.MODULES[key].action(host);
            await host.sdk.command(type, payload);
        }
        await snap('actions');
        await host.send('Turn B.', text('B')); await snap('B');
        await host.swipe(text('C')); await snap('swipe');
        const last = host.ctx.chat.length - 1;
        host.ctx.chat[last].mes = text('A'); host.ctx.chat[last].swipes[host.ctx.chat[last].swipe_id] = host.ctx.chat[last].mes;
        await host.turn.reread(last); await snap('reread');
        await host.st.deleteMessage(host.ctx.chat.length - 1); await snap('delete');
        host.store.rebuild(); await snap('rebuild');
        await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat))); await snap('reload');
        return { steps: trace, saves: host.st.saves.length, draws: counter.draws };
    } finally {
        console.warn = originalWarn;
        host?.close();
        if (savedSB === undefined) delete globalThis.StoryBlock; else globalThis.StoryBlock = savedSB;
        if (saved) Object.defineProperty(globalThis, 'crypto', saved);
    }
}
