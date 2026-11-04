// The only part of packs that touches SillyTavern. Everything is read when called, never at
// import, so the rest of the part (and its tests) loads without SillyTavern.
//
// What it uses of `SillyTavern.getContext()`: `extensionSettings` and `saveSettingsDebounced`
// (the installed list), `characters` and `characterId` (the open card), and `loadWorldInfo`
// (the card's linked lorebook). A card whose lorebook was never imported still carries it
// embedded as `data.character_book`; that copy is read when no lorebook is linked, and its [storysuite:…] entries also when the linked
// one lacks them or cannot be loaded.

import { isPackTitle, isPortraitsTitle, isSettingsTitle } from './lorebook.js';

const context = () => globalThis.SillyTavern?.getContext?.() ?? null;

// Without SillyTavern (tests, a page without the host) the list lives in memory only.
const memory = {};

/** `{ read, save }` over `extension_settings.storySuite`. */
export function stSettings() {
    return {
        read() {
            const settings = context()?.extensionSettings;
            if (!settings) return memory;
            if (!settings.storySuite || typeof settings.storySuite !== 'object') settings.storySuite = {};
            return settings.storySuite;
        },
        save() {
            context()?.saveSettingsDebounced?.();
        },
    };
}

/**
 * The open character's lorebook entries as plain objects:
 * `{ character, card, entries: [{ book, uid, title, keys, content }], problem }` (`problem` is '' or why
 * nothing could be read, in plain words).
 */
export async function readCharacterLorebook() {
    const ctx = context();
    if (!ctx) return { character: '', entries: [], problem: 'SillyTavern is not available.' };
    const character = ctx.characters?.[ctx.characterId];
    if (!character) return { character: '', entries: [], problem: 'Open a chat with a character first (group chats have no single card).' };
    const name = String(character.name ?? '');
    // Which card this is, for what is remembered about it (the card's own file name, else its name).
    const card = String(character.avatar || name);
    const linked = character.data?.extensions?.world;
    const book = character.data?.character_book;
    const embedded = book && Array.isArray(book.entries)
        ? book.entries.map((entry, index) => ({
            book: String(book.name || name),
            uid: entry?.id ?? index,
            title: String(entry?.comment || entry?.name || ''),
            keys: Array.isArray(entry?.keys) ? entry.keys.map(String) : [],
            content: String(entry?.content ?? ''),
        }))
        : null;
    if (linked && typeof ctx.loadWorldInfo === 'function') {
        let data = null;
        try {
            data = await ctx.loadWorldInfo(linked);
        } catch {
            data = null;
        }
        const entries = data ? Object.values(data.entries ?? {}).map(entry => ({
            book: linked,
            uid: entry?.uid ?? '',
            title: String(entry?.comment ?? ''),
            keys: Array.isArray(entry?.key) ? entry.key.map(String) : [],
            content: String(entry?.content ?? ''),
        })) : [];
        // A linked world that is stale, missing (SillyTavern may answer an empty one) or never imported from the card leaves the card's own
        // embedded copy unread: its [storysuite:…] entries are added for each tag the linked world lacks. The linked world still comes first
        // and everything else (market lines, the rest of the lorebook) is read from it exactly as before.
        const extra = embedded ? storysuiteFallback(entries, embedded) : [];
        if (!data && !extra.length) return { character: name, card, entries: [], problem: `The lorebook "${linked}" could not be loaded.` };
        return { character: name, card, entries: [...entries, ...extra], problem: '' };
    }
    if (embedded) return { character: name, card, entries: embedded, problem: '' };
    return { character: name, entries: [], problem: `${name || 'This character'} has no lorebook.` };
}

const TAGS = [isPackTitle, isPortraitsTitle, isSettingsTitle];
/** The embedded entries carrying a [storysuite:…] tag that no entry of the linked world carries. */
function storysuiteFallback(linkedEntries, embedded) {
    return embedded.filter(entry => TAGS.some(test => test(entry.title) && !linkedEntries.some(other => test(other.title))));
}

/**
 * Capability names the running Story Block offers (module ids and their domain names), or
 * null while the sdk is not up, in which case requires.capabilities is not enforced.
 */
export function stCapabilities() {
    const sdk = globalThis.StoryBlock?.sdk;
    if (!sdk || typeof sdk.modules !== 'function') return null;
    const names = new Set();
    for (const module of sdk.modules() ?? []) {
        if (module?.id) names.add(String(module.id));
        // sdk.modules() lists domains as names; a definition's domains are an object keyed by name.
        const domains = module?.domains ?? {};
        for (const domain of Array.isArray(domains) ? domains : Object.keys(domains)) names.add(String(domain));
        for (const name of Array.isArray(module?.capabilities) ? module.capabilities : []) names.add(String(name));
    }
    return [...names];
}

/** Story Block's version as the sdk reports it, if it does. */
export function stHostVersion() {
    const version = globalThis.StoryBlock?.sdk?.version ?? globalThis.StoryBlock?.version;
    return typeof version === 'string' ? version : null;
}

// base64 of bytes, in slices so a long picture does not overflow the argument list.
function base64Of(bytes) {
    let text = '';
    for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
    return btoa(text);
}

/**
 * Pack portraits on SillyTavern's user files (portraits.js): `{ put, remove, exists, url }`, or null where there is no
 * SillyTavern to ask. A file is written to `/api/files/upload` and shown at `/user/files/<name>`; the name is made by
 * portraits.js from the pack id and the picture's hash (letters, digits, dashes), which the server accepts as is.
 */
export function stPortraitFiles({ fetchImpl = (...args) => globalThis.fetch(...args) } = {}) {
    const ask = async (url, body) => {
        const ctx = context();
        if (typeof ctx?.getRequestHeaders !== 'function' || typeof fetchImpl !== 'function') throw new Error('SillyTavern is not available');
        return fetchImpl(url, { method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify(body) });
    };
    return {
        async put(name, bytes) {
            const response = await ask('/api/files/upload', { name, data: base64Of(bytes) });
            if (!response?.ok) throw new Error(`the server answered ${response?.status ?? 'nothing'}`);
        },
        async remove(name) {
            const response = await ask('/api/files/delete', { path: `user/files/${name}` });
            if (!response?.ok && response?.status !== 404) throw new Error(`the server answered ${response?.status ?? 'nothing'}`);
        },
        async exists(names) {
            const response = await ask('/api/files/verify', { urls: names.map(name => `user/files/${name}`) });
            if (!response?.ok) throw new Error(`the server answered ${response?.status ?? 'nothing'}`);
            const found = await response.json();
            return Object.fromEntries(names.map(name => [name, found?.[`user/files/${name}`] !== false]));
        },
        url: name => `/user/files/${name}`,
    };
}
