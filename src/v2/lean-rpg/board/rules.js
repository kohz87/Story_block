// Pure board choices for weapon attacks and automatic defence.
// They read a character's effective stats, skills and equipped weapon; they write no sheet state.
// The ordinary roll code still performs the dice and spends any resource.

import { statPart } from '../formula.js';
import { skillFlags } from './flags.js';
import { charId, rosterOf } from '../standard/roster.js';

const finite = value => (Number.isFinite(value) ? value : 0);
const LIGHT = /\b(?:light[ -]?(?:blade|sword|weapon)|finesse|rapier|dagger|dirk|stiletto|short[ -]?sword|cane[ -]?sword)\b/iu;

/** A weapon's eligible stats compete on the wielder's sheet; ties favour STR, then AGI, then DEX. */
export function attackStat(character, weapon = null) {
    const words = [weapon?.name, weapon?.kind, weapon?.type, weapon?.slot, ...(Array.isArray(weapon?.tags) ? weapon.tags : [])].filter(Boolean).join(' ');
    const stats = weapon?.stats && typeof weapon.stats === 'object' ? weapon.stats : {};
    const keyed = Object.fromEntries(Object.entries(stats).map(([key, value]) => [key.toLowerCase(), value]));
    const light = LIGHT.test(words), options = ['str'];
    if (light || finite(keyed.agi) > 0) options.push('agi');
    if (light || finite(keyed.dex) > 0) options.push('dex');
    return options.reduce((best, stat) => finite(character?.stats?.[stat]) > finite(character?.stats?.[best]) ? stat : best, 'str');
}

/** The strongest available evasion skill, measured by the bonus its defence roll would use. */
export function bestDefence(character, flagsFor = () => null, { againstMagic = false } = {}) {
    const skills = Array.isArray(character?.skills) ? character.skills : [];
    let best = null;
    for (const skill of skills) {
        if (!skillFlags(skill, flagsFor(skill)).defence) continue;
        const resource = skill.uses === 'mana' ? 'mana' : 'stamina';
        if (character?.[resource] === 0) continue;
        const bonus = statPart('defence', character?.stats, { skillStat: skill.stat, againstMagic }).value + finite(skill.rank);
        if (!best || bonus > best.bonus) best = { skill, bonus };
    }
    return best?.skill ?? null;
}

// ---- consumables (owner 14 Nov): one rule for the inventory's Use on…, the story's `used: yes` and the fight board ----------------------------------------
// A consumable (inventory kind `consumable`) gives back blocks of one pool: Mana for mana/ether/arcane/focus words, Stamina for stamina/tonic/ration/food/
// drink/bread/tea/ale words, else Health; a tag `restores:mana|stamina|health` decides instead. The amount is by rarity, capped at the pool's size.
// Checked in this order, so "Mana tea" is Mana. A legendary item gives what an epic does; an item with no rarity gives what a common one does.
const MANA_WORDS = /\b(?:mana|ether|arcane|focus)\b/iu;
const STAMINA_WORDS = /\b(?:stamina|tonic|rations?|food|drinks?|bread|tea|ale)\b/iu;
export const RECOVERY_BLOCKS = Object.freeze({ common: 2, uncommon: 3, rare: 4, epic: 5, legendary: 5 });
export const RECOVERY_POOLS = Object.freeze(['health', 'mana', 'stamina']);

/** What a consumable restores: { pool: 'health' | 'mana' | 'stamina', blocks } from its name, rarity and tags (the item as `listItems` gives it, or its def). */
export function recoveryOf(item) {
    const tagged = (Array.isArray(item?.tags) ? item.tags : []).map(tag => /^restores:(health|mana|stamina)$/iu.exec(String(tag).trim())?.[1]?.toLowerCase()).find(Boolean);
    const name = String(item?.name ?? '');
    const pool = tagged ?? (MANA_WORDS.test(name) ? 'mana' : STAMINA_WORDS.test(name) ? 'stamina' : 'health');
    return { pool, blocks: RECOVERY_BLOCKS[item?.rarity] ?? RECOVERY_BLOCKS.common };
}

/**
 * Restores `character`'s pool on `bar` (the roster bar of that pool, `{ value, size }`): up to `blocks`, never past its size, never below what it is.
 * → { pool, from, to, size, gained } (gained 0 when the pool was full, or the character has no such bar).
 */
export function recoverBar(bar, pool, blocks) {
    if (!bar || !Number.isFinite(bar.size) || bar.size <= 0) return { pool, from: 0, to: 0, size: 0, gained: 0 };
    const from = Math.max(0, Math.min(bar.size, bar.value)), to = Math.min(bar.size, from + blocks);
    return { pool, from, to, size: bar.size, gained: to - from };
}


/** The most a block's own field holds (a block of an older definition holds at most 5): `maxOf(domain)(module, field)`, Infinity when the pins do not say. */
export const maxOf = domain => (module, field) => {
    const max = domain?.pins?.[domain?.active?.[module]?.hash]?.definition?.state?.[field]?.max;
    return Number.isSafeInteger(max) ? max : Infinity;
};

/**
 * Restores a pool of `character` (a sheet character) on `domain` (the dataModules domain, written in place): up to `blocks`, capped at the bar's size.
 * → the bar's move as the board records it: { id, kind, name, module, field, from, to, size, blocks: -gained, pool, gained }.
 */
export function recoverPool(domain, sheet, character, pool, blocks) {
    const bars = rosterOf(sheet, maxOf(domain)), id = pool === 'health' ? charId(character) : `${charId(character)}:${pool}`;
    const bar = (pool === 'health' ? bars.characters : bars.resources).find(entry => entry.id === id);
    const moved = recoverBar(bar, pool, blocks), fields = domain?.instances?.[character.module]?.chat?.fields;
    if (moved.gained > 0 && fields && Object.hasOwn(fields, pool)) fields[pool] = moved.to;
    return { id, kind: 'char', name: character.who, module: character.module, field: pool, from: moved.from, to: moved.to, size: moved.size, blocks: -moved.gained, pool, gained: moved.gained };
}

/** The consumables a fight may offer from the bag: [{ stack, name, qty, pool, blocks }] by name, minus the units `taken` (stack ids already chosen this exchange); bound pieces are left out. */
export function consumablesIn(inventory, taken = []) {
    const out = [];
    for (const stack of Object.values(inventory?.stacks ?? {})) {
        const def = inventory.defs?.[stack.def], qty = stack.qty - taken.filter(id => id === stack.id).length;
        if (def?.kind !== 'consumable' || qty < 1 || (typeof stack.bound === 'string' && stack.bound)) continue;
        out.push({ stack: stack.id, name: def.name, qty, ...recoveryOf(def) });
    }
    return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.stack < b.stack ? -1 : 1));
}

/** The allies an item may go to, with the pool it would fill: [{ who, value, size }] for the characters not gone from the party (a Down one too). */
export function allyBars(sheet, domain, pool) {
    const bars = rosterOf(sheet, maxOf(domain)), list = pool === 'health' ? bars.characters : bars.resources.filter(bar => bar.field === pool);
    return list.filter(bar => (bar.character ?? sheet.characters.find(entry => entry.who === bar.name))?.alive !== false).map(bar => ({ who: bar.name, value: bar.value, size: bar.size }));
}
