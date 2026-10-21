// Coins: the currency the `currency` hooks name, amounts written in it, and the wallet line. Pure.
//
// A currency is a list of coins, smallest first, each with its worth in the smallest coin:
//   [{ name: 'copper', rate: 1 }, { name: 'silver', rate: 10 }, { name: 'gold', rate: 100 }]
// A hook may also return RPG Battle's v1 shape { mode: 'tiers', tiers: [{ name, rate }] }, where
// each tier's rate counts the tier before it; it is converted. With no usable hook there is one
// coin, 'coin'. A wallet keeps money as one integer in the smallest coin (§2.1), under that coin's
// name: { party: { copper: 386 } }.

export const DEFAULT_COINS = Object.freeze([Object.freeze({ name: 'coin', rate: 1 })]);

/** A currency from a hook's return value, or null when it is not usable. */
export function normalizeCoins(value) {
    let list = null;
    if (Array.isArray(value)) {
        list = value.map(coin => ({ name: String(coin?.name ?? '').trim(), rate: Number(coin?.rate) }));
    } else if (value && typeof value === 'object' && value.mode !== 'off' && Array.isArray(value.tiers)) {
        let worth = 1;
        list = value.tiers.map((tier, index) => {
            if (index > 0) worth *= Math.max(1, Math.round(Number(tier?.rate) || 1));
            return { name: String(tier?.name ?? '').trim(), rate: worth };
        });
    }
    if (!list) return null;
    const seen = new Set();
    list = list.filter(coin => {
        const key = coin.name.toLowerCase();
        if (!coin.name || seen.has(key) || !Number.isSafeInteger(coin.rate) || coin.rate < 1) return false;
        seen.add(key);
        return true;
    }).sort((a, b) => a.rate - b.rate);
    return list.length && list[0].rate === 1 ? list.map(coin => Object.freeze(coin)) : null;
}

/** The currency from the `currency` hooks (module-id order): the first usable answer wins. */
export function currencyFrom(fns) {
    for (const fn of Array.isArray(fns) ? fns : []) {
        let coins = null;
        try {
            coins = normalizeCoins(fn());
        } catch {
            coins = null;   // a broken hook must not take the wallet with it
        }
        if (coins) return coins;
    }
    return DEFAULT_COINS;
}

/** The wallet key: the smallest coin's name. */
export const baseCoin = coins => coins[0].name;

function matchCoin(word, coins) {
    const w = word.toLowerCase();
    const exact = coins.find(coin => {
        const name = coin.name.toLowerCase();
        return w === name || w === `${name}s` || w === `${name}es` || (name.endsWith('s') && w === name.slice(0, -1));
    });
    if (exact) return exact;
    if (/^coins?$/.test(w)) return coins[0];
    // Abbreviations: 3s, 5gp, when only one coin starts with that letter.
    if (w.length <= 2 && (w.length === 1 || w.endsWith('p'))) {
        const hits = coins.filter(coin => coin.name.toLowerCase().startsWith(w[0]));
        if (hits.length === 1) return hits[0];
    }
    return null;
}

/**
 * An amount written in coins ("3 silver, 8 copper", "1g 5s", "30") in the smallest coin:
 * { amount } or { error } with a plain sentence. A bare number counts smallest coins.
 */
export function parseAmount(text, coins = DEFAULT_COINS) {
    const source = String(text ?? '').trim();
    const parts = source.replace(/\band\b/gi, ',').split(/,(?!\d{3}\b)|[+;]/).map(part => part.trim()).filter(Boolean)
        .flatMap(part => part.split(/(?<=[\p{L}])\s+(?=\d)/u));
    if (!parts.length) return { error: 'No amount of coins was written.' };
    let amount = 0;
    for (const part of parts) {
        const m = /^(\d{1,3}(?:,\d{3})+|\d+)\s*(.*)$/u.exec(part);
        if (!m) return { error: `"${part}" is not an amount of coins.` };
        const words = m[2].trim().replace(/\s+(?:coins?|pieces?)$/i, '');
        const coin = words ? matchCoin(words, coins) : coins[0];
        if (!coin) return { error: `There is no coin called "${m[2].trim()}".` };
        amount += Number(m[1].replace(/,/g, '')) * coin.rate;
    }
    if (!Number.isSafeInteger(amount) || amount <= 0) return { error: 'The amount must be more than nothing.' };
    return { amount };
}

/** An amount in the smallest coin, written out: "3 silver, 8 copper" (largest coin first). */
export function formatAmount(amount, coins = DEFAULT_COINS) {
    let left = Math.max(0, Math.round(Number(amount) || 0));
    const parts = [];
    for (const coin of [...coins].reverse()) {
        const count = Math.floor(left / coin.rate);
        left -= count * coin.rate;
        if (count) parts.push(`${count} ${coin.name}`);
    }
    return parts.length ? parts.join(', ') : `0 ${coins[0].name}`;
}

/** One wallet ({ [currency]: amount }) as text; keys other than the base coin are shown as they are. */
export function formatWallet(wallet, coins = DEFAULT_COINS) {
    const base = baseCoin(coins);
    const parts = [formatAmount(wallet?.[base] ?? 0, coins)];
    for (const key of Object.keys(wallet ?? {}).sort()) {
        if (key !== base && wallet[key]) parts.push(`${wallet[key]} ${key}`);
    }
    return parts.join(', ');
}
