// The fishing rules: what lives in each kind of water, how a catch is decided and how it is told.
// Pure. Every random choice takes `rng` (a () => float in [0, 1) such as a command's ctx.rng), and the
// draws happen in one fixed order (species, weight, quality, bite, window), so one seed always gives
// the same fish and the same timing.

export const WATERS = Object.freeze(['river', 'lake', 'sea']);
export const RARITIES = Object.freeze(['common', 'uncommon', 'rare', 'epic', 'legendary']);

// Quality: odds out of 100 and the value it is worth, in percent of the base.
export const QUALITIES = Object.freeze([
    Object.freeze({ id: 'poor', odds: 15, worth: 60 }),
    Object.freeze({ id: 'fair', odds: 45, worth: 100 }),
    Object.freeze({ id: 'fine', odds: 30, worth: 130 }),
    Object.freeze({ id: 'prime', odds: 10, worth: 180 }),
]);

// What bites where. `odds` are relative weights; `min`/`max` the weight in grams; `perKg` the base value
// of one kilogram in the smallest coin (on the default copper / silver = 10 / gold = 10 scale, a common
// fish is a few copper and a legendary one a few gold).
const fish = (name, rarity, odds, min, max, perKg) => Object.freeze({ name, rarity, odds, min, max, perKg });
export const SPECIES = Object.freeze({
    river: Object.freeze([
        fish('Perch', 'common', 60, 150, 900, 6),
        fish('Brown Trout', 'common', 50, 300, 2500, 8),
        fish('Grayling', 'uncommon', 30, 300, 1500, 14),
        fish('Barbel', 'uncommon', 24, 1000, 6000, 10),
        fish('Spotted Salmon', 'rare', 12, 3000, 12000, 22),
        fish('River Sturgeon', 'epic', 4, 10000, 60000, 18),
        fish('Ghostfin Eel', 'legendary', 1, 1000, 5000, 180),
    ]),
    lake: Object.freeze([
        fish('Roach', 'common', 60, 100, 600, 5),
        fish('Bream', 'common', 50, 500, 4000, 6),
        fish('Tench', 'uncommon', 30, 500, 3500, 12),
        fish('Pike', 'uncommon', 24, 1500, 12000, 9),
        fish('Silver-violet Trout', 'rare', 12, 1500, 6000, 30),
        fish('Deepwater Char', 'epic', 4, 2000, 9000, 55),
        fish('Moonveil Carp', 'legendary', 1, 8000, 30000, 40),
    ]),
    sea: Object.freeze([
        fish('Mackerel', 'common', 60, 200, 900, 7),
        fish('Sea Bream', 'common', 50, 300, 2500, 9),
        fish('Cod', 'uncommon', 30, 1000, 12000, 8),
        fish('Sea Bass', 'uncommon', 24, 1000, 6000, 14),
        fish('Silverjack', 'rare', 12, 2000, 10000, 24),
        fish('Swordfish', 'epic', 4, 20000, 90000, 12),
        fish('Abyssal Lanternfish', 'legendary', 1, 500, 3000, 600),
    ]),
});

// The bite: when it comes (ms after the cast) and how long the reader has to press Reel. Rarer fish
// give a shorter window.
const BITE_MIN = 1500;
const BITE_SPREAD = 4000;
const WINDOW_BASE = Object.freeze({ common: 1100, uncommon: 950, rare: 800, epic: 650, legendary: 500 });
const WINDOW_SPREAD = 200;

const WATER_WORDS = Object.freeze({
    sea: /\b(?:sea|seas|ocean|coast|coastal|shore|beach|harbou?r|bay|port|pier|cove|strand|reef|gulf|wharf|docks?)\b/i,
    lake: /\b(?:lake|lakes|lakeside|mere|loch|lough|pond|pool|tarn|reservoir|lagoon)\b/i,
    river: /\b(?:river|riverside|riverbank|stream|brook|creek|burn|beck|ford|falls|weir|rapids|canal|rill)\b/i,
});

/** 'river' | 'lake' | 'sea' named by the words of a place, or null. Sea words win over lake over river. */
export function waterOf(...texts) {
    const text = texts.filter(t => typeof t === 'string').join(' ');
    for (const kind of ['sea', 'lake', 'river']) if (WATER_WORDS[kind].test(text)) return kind;
    return null;
}

/** A spot { name, kind } from a scene place ({ name, kind, region }), or null when no water is named. */
export function spotFromPlace(place) {
    if (!place || typeof place !== 'object') return null;
    const name = String(place.name ?? '').trim();
    const kind = waterOf(place.name, place.kind, place.region);
    if (!kind) return null;
    return { name: name || `the ${kind}`, kind };
}

/** The spot's display name when the reader picks the water by hand: "the lake by Bluewatch Village". */
export function pickedSpotName(kind, placeName = '') {
    const place = String(placeName ?? '').trim();
    return place ? `the ${kind} by ${place}` : `the ${kind}`;
}

/** One entry of `list`, chosen by its `odds`. */
export function pickWeighted(rng, list) {
    const total = list.reduce((sum, entry) => sum + entry.odds, 0);
    let roll = rng() * total;
    for (const entry of list) {
        roll -= entry.odds;
        if (roll < 0) return entry;
    }
    return list[list.length - 1];
}

/** The fish: { name, rarity, grams, quality, value } (grams and value whole numbers, value >= 1). */
export function decideCatch(rng, water) {
    const table = SPECIES[water];
    if (!table) throw new Error(`There are no fish tables for "${water}".`);
    const species = pickWeighted(rng, table);
    const r = rng();
    const grams = species.min + Math.floor((species.max - species.min) * r * r);   // big ones are rarer
    const quality = pickWeighted(rng, QUALITIES);
    const value = Math.max(1, Math.round(species.perKg * grams * quality.worth / 100000));
    return { name: species.name, rarity: species.rarity, grams, quality: quality.id, value };
}

/** When it bites and for how long it can be hooked, in whole milliseconds. Drawn after decideCatch. */
export function decideBite(rng, rarity) {
    const bite = BITE_MIN + Math.floor(rng() * BITE_SPREAD);
    const window = (WINDOW_BASE[rarity] ?? WINDOW_BASE.common) + Math.floor(rng() * WINDOW_SPREAD);
    return { bite, window };
}

/** True when a press `elapsed` ms after the cast lands inside the bite window. */
export function inWindow(elapsed, timing) {
    return elapsed >= timing.bite && elapsed <= timing.bite + timing.window;
}

/** "640 g", "4.2 kg", "38 kg". */
export function formatWeight(grams) {
    if (grams < 1000) return `${grams} g`;
    const kg = grams / 1000;
    return kg >= 10 ? `${Math.round(kg)} kg` : `${(Math.round(kg * 10) / 10).toFixed(1)} kg`;
}

/** "a" or "an" for the word or number that follows. */
export function article(next) {
    return /^(?:[aeiou]|8|1[18](?!\d))/i.test(String(next)) ? 'an' : 'a';
}

/** "a rare 4.2 kg silver-violet trout" (a common fish leaves its rarity out). */
export function describeCatch(c) {
    const words = [c.rarity === 'common' ? '' : c.rarity, formatWeight(c.grams), c.name.toLowerCase()].filter(Boolean).join(' ');
    return `${article(words)} ${words}`;
}

/** "the 4.2 kg silver-violet trout" (for a fish already named). */
export function theCatch(c) {
    return `the ${formatWeight(c.grams)} ${c.name.toLowerCase()}`;
}

/** The item note: "Caught at Moonfall Lake; 4.2 kg, fine." */
export function catchNote(c, spotName) {
    return `Caught at ${spotName}; ${formatWeight(c.grams)}, ${c.quality}.`;
}

/** "Astra lands a rare 4.2 kg silver-violet trout at Moonfall Lake." */
export function landedLine(who, c, spotName) {
    return `${who} ${landsVerb(who)} ${describeCatch(c)} at ${spotName}.`;
}

/** "Something takes the bait at Moonfall Lake and gets away from Astra." */
export function lostLine(who, spotName) {
    return `Something takes the bait at ${spotName} and gets away from ${who}.`;
}

/** "Astra lets the 4.2 kg silver-violet trout go back into Moonfall Lake." */
export function releasedLine(who, c, spotName) {
    return `${who} ${who === 'You' ? 'let' : 'lets'} ${theCatch(c)} go back into ${spotName}.`;
}

function landsVerb(who) {
    return who === 'You' ? 'land' : 'lands';
}

/**
 * A value in the smallest coin as words, using a currency shaped like Story Block's and RPG Battle's
 * ({ tiers: [{ name, rate }] smallest first, each rate counting the tier before; or { single }):
 * 672 → "6 gold 7 silver 2 copper". Without a currency: "672 coin".
 */
export function formatValue(value, currency) {
    const tiers = Array.isArray(currency?.tiers) ? currency.tiers.filter(t => t && t.name) : [];
    if (currency?.mode !== 'single' && tiers.length) {
        let unit = 1;
        const worth = tiers.map((tier, i) => {
            if (i > 0) unit *= Math.max(1, Math.round(Number(tier.rate) || 1));
            return { name: tier.name, unit };
        });
        let rest = value;
        const parts = [];
        for (const tier of worth.reverse()) {
            const n = Math.floor(rest / tier.unit);
            rest -= n * tier.unit;
            if (n) parts.push(`${n} ${tier.name}`);
        }
        return parts.join(' ') || `0 ${worth[worth.length - 1].name}`;
    }
    return `${value} ${String(currency?.single ?? '').trim() || 'coin'}`;
}
