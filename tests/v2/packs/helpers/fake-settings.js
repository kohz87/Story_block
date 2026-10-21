// In-memory `{ read, save }` over a storySuite settings object, counting saves.
export function fakeSettings(initial = {}) {
    const root = structuredClone(initial);
    const settings = { saves: 0, root, read: () => root, save: async () => { settings.saves += 1; } };
    return settings;
}
