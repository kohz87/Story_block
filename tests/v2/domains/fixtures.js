// Shared states for the core domain tests.
import { createCoreModule } from '../../../src/v2/domains/index.js';
import { defaultDef } from '../../../src/v2/domains/inventory.js';
import { initialState } from './helpers/fake-ctx.js';

// Story Block's settings with the chat's currency renamed.
export const CROWNS = { currency: 'crowns', currencyShort: 'cr' };

/** A core module whose hooks are the given { name: fn[] } map, with the given settings. */
export function core(hookMap = {}, settings = {}) {
    return createCoreModule({ hooks: name => hookMap[name] ?? [], settings: () => settings });
}

export const def = (id, name, fields = {}) => ({ ...defaultDef(id, name), ...fields });
export const stack = (id, defId, qty, fields = {}) => ({ id, def: defId, qty, owner: 'party', equipped: null, note: '', from: '', ...fields });

/** A state with a few items: rope ×3, a sword, two potion lots, 125 copper. */
export function stocked(module = core()) {
    const state = initialState([module]);
    const inv = state.domains.inventory;
    const defs = [
        def('story/rope', 'Rope'),
        def('pack.fantasy/iron-sword', 'Iron Sword', { kind: 'equipment', slot: 'hand', rarity: 'uncommon', value: 50, stack: false }),
        def('pack.fantasy/dagger', 'Dagger', { kind: 'equipment', slot: 'hand', stack: false }),
        def('pack.fantasy/potion', 'Minor Healing Draught', { kind: 'consumable' }),
        def('story/lantern', 'Lantern', { stack: false }),
    ];
    for (const item of defs) {
        inv.defs[item.id] = item;
        inv.aliases[item.name.toLowerCase()] = item.id;
    }
    inv.stacks = {
        it_rope0001: stack('it_rope0001', 'story/rope', 3),
        it_sword001: stack('it_sword001', 'pack.fantasy/iron-sword', 1),
        it_dagg0001: stack('it_dagg0001', 'pack.fantasy/dagger', 1),
        it_pota0001: stack('it_pota0001', 'pack.fantasy/potion', 2),
        it_potb0001: stack('it_potb0001', 'pack.fantasy/potion', 1, { note: 'cloudy' }),
        it_lant0001: stack('it_lant0001', 'story/lantern', 1),
    };
    inv.wallets = { party: { coin: 125 } };
    return state;
}
