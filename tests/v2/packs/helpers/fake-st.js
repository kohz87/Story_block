// A fake `SillyTavern.getContext()` with a card, its lorebook and extension settings.
export function installFakeSillyTavern({ character = { name: 'Mara', data: { extensions: { world: 'Mara lore' } } }, books = {}, loadFails = false } = {}) {
    const calls = { saves: 0, loads: [] };
    const ctx = {
        extensionSettings: {},
        saveSettingsDebounced: () => { calls.saves += 1; },
        characters: character ? [character] : [],
        characterId: character ? 0 : undefined,
        loadWorldInfo: async name => {
            calls.loads.push(name);
            if (loadFails) throw new Error('network');
            return books[name] ?? null;
        },
    };
    globalThis.SillyTavern = { getContext: () => ctx };
    return { ctx, calls, uninstall: () => { delete globalThis.SillyTavern; } };
}

/** A world-info file as SillyTavern stores it: `{ entries: { [uid]: entry } }`. */
export function worldInfo(entries) {
    return { entries: Object.fromEntries(entries.map((entry, uid) => [uid, { uid, key: [], disable: true, ...entry }])) };
}
