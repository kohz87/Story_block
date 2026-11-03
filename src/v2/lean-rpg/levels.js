// SHIM (LV-UI): the real file belongs to LV-C (ranks, `levelLabel`, `rank`). The lead merges the branches and removes this copy; the view
// code calls only the names below, with the contract's signatures. Pure: no DOM.

/** The Levels numbers the views state (the contract's LEVEL, names.js, owned by LV-A). */
export const LEVEL_VIEW = Object.freeze({ divisor: 5, pointEvery: 3, xpPerLevel: 100, max: 99, defaultCap: 99 });

/** The rank whose band holds `level`: `{ name } | null` (`ranks` is `[{ name, from, to }]`). */
export function rankAt(level, ranks) {
    const found = (Array.isArray(ranks) ? ranks : []).find(rank => rank && level >= rank.from && level <= rank.to);
    return found ? { name: String(found.name) } : null;
}

/**
 * "Rank E · Lv 14", or "Lv 14" when no rank names the level. For a party member, `options.playerRank` (`{ label, value }`, the pack's
 * `rpg.playerRank` read from the story) says "Lv 14 · Guild F" (the value is the field's current value; empty: "Lv 14" alone).
 * No `playerRank` option: the level band's rank (a foe, or a story with no player-rank source).
 */
export function levelLabel(level, ranks, options = {}) {
    const lv = `Lv ${level}`;
    if (options && Object.hasOwn(options, 'playerRank') && options.playerRank !== undefined) {
        const given = options.playerRank, value = typeof given?.value === 'string' || typeof given?.value === 'number' ? String(given.value).trim() : '';
        return value && given?.label ? `${lv} · ${given.label} ${value}` : lv;
    }
    const rank = rankAt(level, ranks);
    return rank ? `Rank ${rank.name} · ${lv}` : lv;
}
