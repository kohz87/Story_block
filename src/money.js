// Money in a list block (0.9.12): the party's purse in one sum, so the model never lets the
// story pay more than the Inventory holds. A purse is any row named for money ("Coin Pouch",
// "Purse", "Coins") whose quantity or note is written in the currency's coins. Pure.
//
// A currency is { mode: 'tiers' | 'single', tiers: [{ name, rate }], single }: tiers smallest
// first, `rate` how many of the previous make one of this (RPG Battle's shape, so its currency
// can be used as it is). { mode: 'off' } turns the purse line off.

export const DEFAULT_CURRENCY = Object.freeze({
    mode: 'tiers',
    tiers: Object.freeze([
        Object.freeze({ name: 'copper', rate: 1 }),
        Object.freeze({ name: 'silver', rate: 10 }),
        Object.freeze({ name: 'gold', rate: 10 }),
    ]),
    single: 'coins',
});

const PURSE_NAME = /\b(?:coins?|purse|pouch|money|wallet|funds|coffer|strongbox|credits?)\b/i;
export const PURSE_NOTE_TAIL = 'nothing dearer can be paid for (the seller refuses, haggles or takes goods in trade).';

/** A currency read from settings or another extension, or null when it is off or unusable. */
export function normalizeCurrency(value) {
    if (!value || typeof value !== 'object' || value.mode === 'off') return null;
    if (value.mode === 'single') return { mode: 'single', tiers: [], single: String(value.single ?? '').trim() || 'coins' };
    const tiers = (Array.isArray(value.tiers) ? value.tiers : [])
        .map(tier => ({ name: String(tier?.name ?? '').trim(), rate: Math.max(1, Math.round(Number(tier?.rate) || 1)) }))
        .filter(tier => tier.name);
    return tiers.length ? { mode: 'tiers', tiers, single: 'coins' } : null;
}

/** "copper=1, silver=10, gold=10" (smallest first; each rate counts the one before), or null. */
export function parseTiersText(text) {
    const tiers = String(text ?? '').split(/[,;\n]/).map(part => part.trim()).filter(Boolean).map(part => {
        const m = /^([^=:]+?)\s*[=:]\s*(\d+)$/.exec(part);
        return m ? { name: m[1].trim(), rate: Number(m[2]) } : { name: part, rate: 1 };
    });
    return normalizeCurrency({ mode: 'tiers', tiers });
}

export function tiersText(currency) {
    return (normalizeCurrency(currency)?.tiers ?? []).map(tier => `${tier.name}=${tier.rate}`).join(', ');
}

// Each tier's value in the smallest coin.
function tierValues(currency) {
    let value = 1;
    return currency.tiers.map((tier, index) => {
        if (index > 0) value *= tier.rate;
        return { name: tier.name, value };
    });
}

function matchTier(word, tiers) {
    const w = String(word).toLowerCase();
    const forms = name => {
        const n = name.toLowerCase();
        return [n, `${n}s`, n.endsWith('s') ? n.slice(0, -1) : n];
    };
    const exact = tiers.find(tier => forms(tier.name).includes(w));
    if (exact) return exact;
    // Abbreviations: 1g 3s, 5gp.
    const short = w.length === 2 && w.endsWith('p') ? w[0] : w;
    return w.length <= 2 ? tiers.find(tier => tier.name.toLowerCase().startsWith(short)) ?? null : null;
}

function hasCoins(text, currency) {
    if (currency.mode === 'single') {
        const word = currency.single.toLowerCase().replace(/s$/, '');
        return new RegExp(`\\d[\\d,]*\\s*${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(String(text ?? ''));
    }
    const tiers = tierValues(currency);
    return [...String(text ?? '').matchAll(/(\d[\d,]*(?:\.\d+)?)\s*([A-Za-z]+)/g)].some(([, , word]) => matchTier(word, tiers));
}

/** An amount written in coins ("1 Gold, 35 Silver, 14 Copper") in the smallest coin. */
export function parseMoney(text, currency = DEFAULT_CURRENCY) {
    const c = normalizeCurrency(currency) ?? normalizeCurrency(DEFAULT_CURRENCY);
    const tiers = c.mode === 'single' ? [] : tierValues(c);
    let total = 0;
    for (const [, number, word] of String(text ?? '').matchAll(/(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([A-Za-z]+)?/g)) {
        const tier = c.mode === 'single' || !word ? null : matchTier(word, tiers);
        total += Number(number.replace(/,/g, '')) * (tier ? tier.value : 1);
    }
    return Math.round(total);
}

/** An amount in the smallest coin, written out: "4 gold, 6 silver, 4 copper". */
export function formatMoney(amount, currency = DEFAULT_CURRENCY) {
    const c = normalizeCurrency(currency) ?? normalizeCurrency(DEFAULT_CURRENCY);
    let left = Math.max(0, Math.round(Number(amount) || 0));
    if (c.mode === 'single') return `${left} ${c.single}`;
    const parts = [];
    for (const tier of [...tierValues(c)].reverse()) {
        const count = Math.floor(left / tier.value);
        left -= count * tier.value;
        // "1 crowns" reads wrong; copper, silver and gold have no plural to drop.
        if (count) parts.push(`${count} ${count === 1 && /[^s]s$/i.test(tier.name) ? tier.name.slice(0, -1) : tier.name}`);
    }
    return parts.length ? parts.join(', ') : `0 ${c.tiers[0].name}`;
}

/**
 * The purse in a list block's state ({ categories: [{ items: [{ name, quantity, remark }] }] }):
 * { total, rows } over every row named for money whose quantity or note is in coins; null when
 * there is none (or no currency).
 */
export function purseOf(state, currency) {
    const c = normalizeCurrency(currency);
    if (!c) return null;
    const rows = [];
    let total = 0;
    for (const category of Array.isArray(state?.categories) ? state.categories : []) {
        for (const item of Array.isArray(category?.items) ? category.items : []) {
            if (!PURSE_NAME.test(String(item?.name ?? ''))) continue;
            // One coin: "Coin Pouch | 1 | 50 crowns" (the note), or "Coins | 120" (a money row's count).
            const bareCount = c.mode === 'single' && /^(?:coins?|money|funds|credits?)$/i.test(String(item.name).trim()) && /^\s*\d[\d,]*\s*$/.test(String(item.quantity ?? ''));
            const cell = hasCoins(item.remark, c) ? 'note' : hasCoins(item.quantity, c) || bareCount ? 'quantity' : null;
            if (!cell) continue;
            total += parseMoney(cell === 'note' ? item.remark : item.quantity, c);
            rows.push({ name: String(item.name), cell });
        }
    }
    return rows.length ? { total, rows } : null;
}

/** The runtime line for an Inventory's prompt section: "Purse in all: …; nothing dearer…", or ''. */
export function purseLine(state, currency) {
    const purse = purseOf(state, currency);
    return purse ? `Purse in all: ${formatMoney(purse.total, currency)}; ${PURSE_NOTE_TAIL}` : '';
}
