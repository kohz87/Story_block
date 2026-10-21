// Coins: the currency the `currency` hooks name, amounts written in it, and the wallet line. Pure.
//
// A wallet holds one integer per owner in the smallest unit, always under `coin`:
// wallets[owner] = { coin: 386 } (MODULES.md F1). Coin names are display and parsing only. The
// `currency` hook answers v1's shape { mode?, tiers: [{ name, rate }], single }, smallest tier
// first, each tier's rate counting the tier before it (copper=1, silver=10, gold=10); with no tiers,
// `single` names the one coin. Inside, a currency is a list of coins with each one's worth in the
// smallest coin: [{ name: 'copper', rate: 1 }, { name: 'silver', rate: 10 }, { name: 'gold', rate: 100 }].

export const WALLET_KEY = 'coin';
export const DEFAULT_COINS = Object.freeze([Object.freeze({ name: 'coin', rate: 1 })]);

/** A currency from a hook's answer, or null when it is not usable. */
export function normalizeCoins(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.mode === 'off') return null;
    // Nameless and repeated tiers are dropped first, so they do not count towards the next one's worth.
    const seen = new Set();
    const tiers = (Array.isArray(value.tiers) ? value.tiers : [])
        .map(tier => ({ name: String(tier?.name ?? '').trim(), rate: Math.max(1, Math.round(Number(tier?.rate) || 1)) }))
        .filter(tier => {
            const key = tier.name.toLowerCase();
            if (!tier.name || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    let list;
    if (tiers.length && value.mode !== 'single') {
        let worth = 1;
        list = tiers.map((tier, index) => {
            if (index > 0) worth *= tier.rate;
            return { name: tier.name, rate: worth };
        });
    } else {
        const single = String(value.single ?? '').trim();
        list = single ? [{ name: single, rate: 1 }] : [];
    }
    if (!list.every(coin => Number.isSafeInteger(coin.rate))) return null;
    return list.length && list[0].rate === 1 ? list.map(coin => Object.freeze(coin)) : null;
}

/**
 * The `inventory.currency` query's answer: the hook's shape back ({ tiers: [{ name, rate }], single },
 * rate counting the tier before), each tier also with `worth`, its value in the smallest unit.
 */
export function currencyView(coins) {
    return {
        tiers: coins.map((coin, index) => ({ name: coin.name, rate: index ? coin.rate / coins[index - 1].rate : 1, worth: coin.rate })),
        single: coins.length === 1 ? coins[0].name : 'coins',
    };
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

/** One wallet ({ coin: amount }) as text. */
export function formatWallet(wallet, coins = DEFAULT_COINS) {
    return formatAmount(wallet?.[WALLET_KEY] ?? 0, coins);
}
