// The `inventory` domain (§7): item definitions, stacks, wallets and the alias index, with
// its validator, commands, capture kinds `item` and `coin`, queries and prompt view. Pure.
//
// Handlers follow §3.2: synchronous, everything through ctx (read/draft/call/claim/rng/fail).
// A stack whose count reaches 0 is removed, never kept at 0 (§2.5). Numbers are set by code:
// a change line proposes, these functions decide. Payloads, codes and money follow MODULES.md F:
// a rule refusal is REFUSED, a malformed payload INVALID; a wallet is { coin: n } in the smallest unit.

import { OWNER_RE, isPlainObject, clone } from './common.js';
import { resolveDef } from './names.js';
import { WALLET_KEY, resolveCurrency } from './money.js';
import { isId } from '../check.js';
import { createGearQueries } from './gear.js';
import {
    defErrors, isCount, nonBlank, COND_MAX, condLogErrors, keptErrors, condOf,
    FEATURE, KIND_ORDER, CARRY_MAX, condEvents,
} from './inventory/state.js';
import { slotLimits, canWear, legendEarned } from './inventory/validate.js';
import { pack, WALLET_NOTE } from './inventory/prompt.js';
import {
    definitionsOf, listItems, carryBonuses, gearIsOn, boundNames, equipmentView, encumbrance, defCarry,
    ENCUMBERED_PENALTY, gearWearers,
} from './inventory/queries.js';
import { economyOf } from './inventory/stacks.js';
import { lootErrors, lootItems } from './inventory/loot.js';
import { kitOpen } from './inventory/edit.js';
import { storedTally, clicksOf, tallied } from './inventory/lines.js';
export { TOLD, createInventoryCommands } from './inventory/commands.js';
export { USED_WORDS, GONE_WORDS, usedByLine, captureItem, captureCoin } from './inventory/story.js';
export { LOOT_ITEMS, LOOT_KEEP, LOOT_GUARD, LOOT_OFFER, LOOT_KINDS, captureLoot, lootTakeGuard } from './inventory/loot.js';
export { kitOpen, INVENTORY_EDIT_GUARD, inventoryEditGuard } from './inventory/edit.js';
export { ECONOMY_SCALE, economyOf, scaledDefault } from './inventory/stacks.js';
export { STORY_WEAR, wearWord } from './inventory/wear.js';
export { DEFINITIONS_MAX_IDS, carryBonuses, listItems, equipmentView, ENCUMBERED_PENALTY, defCarry, ENCUMBERED_STATS, encumbrance, encumbranceTail, definitionsOf } from './inventory/queries.js';
export { KINDS, RARITIES, KIND_ORDER, initialInventory, FEATURE, INVENTORY_FEATURES, gearOn, featureOn, COND_MAX, COND_LOG_MAX, condEvents, condOf, defaultDef, CARRY_MAX, packCarry } from './inventory/state.js';
export { itemText, legendEarned, MANY_SLOTS, MAX_MANY, baseSlot, slotLimits, canWear } from './inventory/validate.js';
export { promptNote, WALLET_NOTE, inventoryTail } from './inventory/prompt.js';

export function validateInventory(slice) {
    if (!isPlainObject(slice)) return ['The inventory is not a record.'];
    const parts = ['defs', 'stacks', 'wallets', 'aliases'].filter(part => !isPlainObject(slice[part]));
    if (parts.length) return parts.map(part => `The inventory has no ${part} record.`);
    const { defs, stacks, wallets, aliases } = slice;
    const errors = [];
    for (const [key, def] of Object.entries(defs)) errors.push(...defErrors(key, def));
    const worn = new Set();
    for (const [key, stack] of Object.entries(stacks)) {
        if (!isPlainObject(stack)) {
            errors.push(`Item stack ${key} is not a record.`);
            continue;
        }
        const def = isPlainObject(defs[stack.def]) ? defs[stack.def] : null;
        const label = def?.name ?? key;
        if (stack.id !== key) errors.push(`Item stack ${key} is filed under the wrong ID.`);
        if (!isId(key, 'it')) errors.push(`"${key}" is not a well-formed item stack ID.`);
        if (!def) errors.push(`Item stack ${key} refers to an item definition that does not exist (${stack.def}).`);
        if (!isCount(stack.qty, 1)) errors.push(`${label} has quantity ${stack.qty}; a stack holds a whole number of at least 1 (an empty stack is removed).`);
        else if (def && def.stack === false && stack.qty !== 1) errors.push(`${label} does not stack, so each one is its own stack of 1.`);
        if (typeof stack.owner !== 'string' || !OWNER_RE.test(stack.owner)) errors.push(`${label} has an owner that is neither the party nor an actor ID.`);
        if (stack.equipped !== null) {
            if (!nonBlank(stack.equipped)) errors.push(`${label} has an equipped slot that is neither empty nor a name.`);
            else {
                if (def && def.kind !== 'equipment') errors.push(`${label} is worn in "${stack.equipped}" but is not equipment.`);
                const place = `${stack.owner}\u0000${stack.equipped}`;
                if (worn.has(place)) errors.push(`Two items are worn in the same slot "${stack.equipped}" by the same owner.`);
                worn.add(place);
            }
        }
        if (typeof stack.note !== 'string') errors.push(`${label} has a note that is not text.`);
        if (typeof stack.from !== 'string') errors.push(`${label} has an origin that is not a receipt ID.`);
        if (stack.cond !== undefined && !(Number.isSafeInteger(stack.cond) && stack.cond >= 0 && stack.cond <= COND_MAX)) {
            errors.push(`${label} has a condition of ${stack.cond}; it is a whole number from 0 to ${COND_MAX}.`);
        }
        if (stack.key !== undefined && stack.key !== true) errors.push(`${label} is marked as a key item with something other than true.`);
        if (stack.story !== undefined && stack.story !== true) errors.push(`${label} is marked as the story's with something other than true.`);
        if (stack.bound !== undefined && !(typeof stack.bound === 'string' && stack.bound !== 'party' && OWNER_RE.test(stack.bound))) errors.push(`${label} is bound to something that is not a party member's ID.`);
    }
    for (const [owner, wallet] of Object.entries(wallets)) {
        if (!OWNER_RE.test(owner)) errors.push(`A wallet belongs to "${owner}", who is neither the party nor an actor ID.`);
        if (!isPlainObject(wallet)) {
            errors.push(`The wallet of ${owner} is not a record.`);
            continue;
        }
        for (const [key, amount] of Object.entries(wallet)) {
            if (key !== WALLET_KEY) errors.push(`The wallet of ${owner} holds "${key}"; a wallet keeps one amount, under ${WALLET_KEY}.`);
            else if (!isCount(amount, 0)) errors.push(`The wallet of ${owner} holds ${amount}; money is a whole number of at least 0.`);
        }
    }
    for (const [key, id] of Object.entries(aliases)) {
        if (!key || key !== key.trim().toLowerCase()) errors.push(`The item name "${key}" is not written in lowercase.`);
        if (!isPlainObject(defs[id])) errors.push(`The item name "${key}" points to a definition that does not exist (${id}).`);
    }
    if (slice.loot !== undefined) errors.push(...lootErrors(slice.loot));
    if (slice.condLog !== undefined) errors.push(...condLogErrors(slice.condLog));
    if (slice.kept !== undefined) errors.push(...keptErrors(slice.kept));
    return errors;
}

// ---------- shared pieces of the handlers ----------

// ---------- bound signature gear (`story-block.gear`, GEAR.md "Signature gear") ----------
//
// A cast member's signature pieces, granted on join, carry `bound: <actor id>`: they stay with that member. With the switch on, no command moves,
// unequips, sells, drops, uses up, edits, splits or merges such a stack ("Bound to Mara: Cane Sword stays with them."); wear and repair are the
// condition's and go on as ever. Switched off, the mark is only kept: every command acts as in 2.17.0.

// ---------- equipment: who can wear what ----------

// ---------- gear condition (`cond`) ----------

// ---------- loot to pick from (`story-block.loot`) ----------

// The guard of a take, as the core module's replayGuard asks it (domains/index.js) on the state before the take's block,
// on a rebuild, a reload, a delete, a swipe and a Re-read alike. Pure: the state before the block and the guard's own
// predicate, nothing else. The take holds while the reply's offer is there under the same claim and lays out, by the
// tolerant name, at least as many of each thing as was taken (and at least the coin taken). The names are matched as the
// inventory looks a name up (resolveDef over the offer's things: the exact name first, then singular and plural, the
// name without portion words, then the word-order key), so "Torches" still offers what "Torch" took; a name that matches
// none of them, or two, or the thing another taken name matches, does not hold. A Re-read that leaves the
// offer as it was, or still offering what was taken, keeps the take; a deleted reply, or a Re-read that drops a taken
// thing or lowers it below what was taken, turns the take off with its claim (the block stays stored, inactive, and the
// Problems say why). The changes it made were decided when the reader took, and are replayed as they were. The offer's
// reply-bound guard (`loot.offer`) is answered here too.

// ---------- commands ----------


// ---------- capture (§4.4): runs as a story command ----------

// What one reply's story lines give. The story decides what it pays: there is no per-reply cap on coin,
// items or goods (only a thing that does not stack, a stack per piece, is held to MAX_UNSTACKED a line).
// Code's own payouts (a module's wallet.receive or inventory.grant through ctx.call) are not counted
// here, except a payout a module says the story alone vouched for (`wallet.receive { story: true }`), during
// the reply's capture or by a click after it (counted against the reply the click is stored on, ctx.reply;
// RX-E-2). `inventory.storyBudget` tells a module what has been given (createInventoryQueries).
// What was given is still counted, for modules that tell a reply whose coin lines paid from one whose
// quest payouts did: the inventory slice keeps `perReply[<sid>]` = { coin, vouched?, debit? }, under the
// reply's record ID (ctx.carrier.sid, which stays with the reply when earlier messages are deleted), so it
// rolls back with the reply and starts again on the next one or another swipe. A reply adds its own entry
// and drops the others; `perReply` is the domain's `scratch` (ops.js): on replay a drop of an entry already
// gone (its reply deleted) is passed over, so no reply's gains hang on another's. An older chat's entries
// also hold `worth`, `made`, `items` and `notable`: they are ignored, and a stored reply replays as it was
// written (its ops hold what it gave).
// A click's vouched payout (a2-3) adds its own key instead, `storyClicks[<sid>][<receipt id>] = paid`
// (scratch too, add-only, on the same carrier), and never writes the reply's entry: a swipe or delete of
// the reply takes it back with the reply. The reply's money given is its entry's `coin` plus its clicks.

// ---------- queries (read-only, plain copies) ----------

/**
 * The inventory queries; `env.settings()` gives the currency for `inventory.currency` and the reader's
 * money scale, `env.economy()` the enabled pack's ({ scale } or null) for `inventory.economy`.
 */
export const createInventoryQueries = env => ({
    // { scale, source: 'pack' | 'settings' | 'default' } (MODULES §F104): multiply built-in money defaults by scale.
    'inventory.economy': () => {
        let pack = null;
        try { pack = typeof env.economy === 'function' ? env.economy() : null; } catch { /* no packs: none */ }
        return economyOf(env.settings(), pack);
    },
    // { name, plural, short }: the chat's one currency (MODULES.md F1); name singular ("mark").
    // The reader's currency, the pack's, or gold.
    'inventory.currency': () => resolveCurrency(env.settings()),
    // Each row's `carry` (the capacity the thing adds, PACKS.md "Carry capacity") is the carry module's
    // (`items.carry` → bonuses by stack: a pack's `carry` or the reader's own) when one answers, else the def's.
    // [def copies], ID-sorted: every definition the inventory holds (default) or those of `ids` that it
    // has; unknown IDs are left out, malformed arguments give []. It reads the definitions as the asking
    // transaction has them (drafts included), makes nothing and does not depend on a pack being installed:
    // a pack's item registered by the rules module stays here after the pack is removed.
    'inventory.definitions': (state, args) => definitionsOf(state?.domains?.inventory, args),
    'inventory.items': (state, args = {}, tools) => listItems(state?.domains?.inventory, args?.owner ?? null, carryBonuses(tools), gearIsOn(env), boundNames(state, tools, env)),
    'inventory.counts': state => {
        const inventory = state?.domains?.inventory, stacks = Object.values(inventory?.stacks ?? {}), totals = new Map();
        for (const stack of stacks) {
            const key = JSON.stringify([stack.def, stack.owner]);
            totals.set(key, (totals.get(key) ?? 0) + stack.qty);
        }
        return Object.fromEntries(stacks.map(stack => [stack.id, inventory.defs?.[stack.def]?.stack === false
            ? totals.get(JSON.stringify([stack.def, stack.owner])) : stack.qty]));
    },
    // { budget, paid, left, vouched }: the story money (`+ coin` lines and modules' `wallet.receive { story:
    // true }`) the current reply has given (RX-E-2); `vouched` is the part of `paid` that modules' vouched
    // payouts gave (quest rewards), so a module can tell a reply whose money its own payouts gave from one
    // whose coin lines did. There is no per-reply limit (the story decides what it pays), so `budget` and
    // `left` are always null; they stay in the answer for modules written when a limit could be set. The
    // current reply is the one the asking command is stored on (tools.reply: a capture's carrier, else the
    // head carrier); with none known, nothing is counted as given yet.
    'inventory.storyBudget': (state, args, tools) => {
        const stored = storedTally(state?.domains?.inventory, tools?.reply?.sid);
        const clicks = tools?.reply?.sid ? clicksOf(state?.domains?.inventory, tools.reply.sid) : 0;
        const paid = tallied(stored?.coin) + clicks;
        return { budget: null, paid, left: null, vouched: Math.min(paid, tallied(stored?.vouched) + clicks) };
    },
    'inventory.wallet': (state, args = {}) => ({ ...(state?.domains?.inventory?.wallets?.[args?.owner ?? 'party'] ?? {}) }),
    // { status: 'found' | 'ambiguous' | 'none', defs: [def copies], stacks: [items of the found def] }
    'inventory.find': (state, args = {}, tools) => {
        const inventory = state?.domains?.inventory;
        const found = resolveDef(inventory, args?.name ?? '');
        return {
            status: found.status,
            defs: found.ids.map(id => clone(inventory.defs[id])),
            stacks: found.status === 'found' ? listItems(inventory, null, null, gearIsOn(env), boundNames(state, tools, env)).filter(item => item.def === found.id) : [],
        };
    },
    'inventory.equipment': (state, args, tools) => equipmentView(state, tools),
    // The loot laid out and not taken yet, newest first: [{ sid, where, n, items: [{ name, qty }] }].
    'inventory.loot': Object.assign((state) => {
        const inventory = state?.domains?.inventory;
        const claims = state?.meta?.claims ?? {};
        return Object.values(isPlainObject(inventory?.loot) ? inventory.loot : {})
            .filter(offer => isPlainObject(offer) && typeof offer.sid === 'string' && !Object.hasOwn(claims, offer.claim || `loot:${offer.sid}`) && lootItems(offer)?.length)
            .sort((a, b) => (b.n ?? 0) - (a.n ?? 0) || (a.sid < b.sid ? -1 : 1))
            .map(offer => ({ sid: offer.sid, where: offer.where, n: offer.n, items: clone(lootItems(offer)) }));
    }, { feature: FEATURE.loot }),
    // { stack } → { stack, cond, events: [{ key, d, n }] } (the events as they apply), or null.
    'inventory.condition': (state, args = {}) => {
        const inventory = state?.domains?.inventory;
        const stack = typeof args?.stack === 'string' && isPlainObject(inventory?.stacks?.[args.stack]) ? inventory.stacks[args.stack] : null;
        return stack ? { stack: stack.id, cond: condOf(stack, inventory), events: condEvents(inventory, stack.id) } : null;
    },
    'inventory.legendEarned': Object.assign((_state, _args, tools) => legendEarned(tools), { feature: FEATURE.gear }),
    'inventory.encumbrance': Object.assign((state, args, tools) => encumbrance(state, tools, gearIsOn(env)), { feature: FEATURE.encumbrance }),
    // `story-block.gear`: { owner } → { on, owner, weapon, armour, shield: { name, bonus, cond, broken } | null, carry: { load, capacity,
    // encumbered, penalty } } (part 2's rolls read it), and `gear.carry`, `items.carry`'s answer when no carry module gives one.
    ...createGearQueries({
        on: () => gearIsOn(env), kit: () => kitOpen(env), empty: () => { try { return env?.chatEmpty?.() === true; } catch { return false; } },
        condOf, carryOf: defCarry, penalty: ENCUMBERED_PENALTY, feature: FEATURE.gear,
        names: (state, tools, id) => gearWearers(state, tools, env).names.get(id) ?? (id === 'party' ? 'The party' : String(id)),
        owners: (state, tools) => gearWearers(state, tools, env).owners,
    }),
});

// ---------- prompt view (§5) ----------
