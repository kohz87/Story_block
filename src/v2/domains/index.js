// Story Block's core module (§6, §7): the `scene` and `inventory` domains as one plain module
// definition for `sdk.registerModule`. Pure: no SillyTavern, no DOM outside the tab renderers.
//
// The handler ctx (§3.2) has no hooks accessor, so the hooks this module calls (`item.define`
// for story-introduced items, `currency` for coin names and rates) come in through the factory:
//   registry.register(createCoreModule({ hooks: name => registry.hooks(name) }))
// createCorePart gives the same thing as a MODULES.md part, for a host that merges parts.

import { createInventoryCommands, createInventoryQueries, captureCoin, captureItem, initialInventory, inventoryTail, validateInventory } from './inventory.js';
import { capturePlace, capturePresent, initialScene, sceneCommands, sceneQueries, sceneTail, validateScene } from './scene.js';
import { currencyFrom } from './money.js';
import { renderInventoryTab } from '../ui/inventory-tab.js';
import { renderSceneTab } from '../ui/scene-tab.js';

export const CORE_MODULE_ID = 'story-block';
export const CORE_BUDGET = 400;

// One line for the static prompt part: no names, counts or coins, so it is byte-identical every reply.
export const CORE_STATIC = 'Code keeps the inventory, the wallet, the place and who is present: use or pay only what the '
    + 'lists below hold, and write a change line for every item or coin gained, used or lost and every arrival, departure or move.';

export const CORE_KINDS = Object.freeze({
    item: Object.freeze({ grammar: '+ item Name | qty: 1 | note: short detail (- item Name | qty: 1 when used up or lost; ~ item Name | note: … when it changes)' }),
    coin: Object.freeze({ grammar: '+ coin <amount in the wallet\'s coins> | from: who (- coin <amount> | to: who when paid)' }),
    place: Object.freeze({ grammar: '~ place Name | kind: settlement|wild|dungeon|… | region: wider area' }),
    present: Object.freeze({ grammar: '+ present Name when someone arrives, - present Name when they leave' }),
});

/**
 * The core part in MODULES.md A's shape ({ domains, commands, queries, kinds, context, tabs }),
 * for a host that merges parts. `hooks(name) → fn[]` in module-id order (the registry's `hooks`);
 * without it no hooks run and the currency is one coin, 'coin'.
 */
export function createCorePart({ hooks = () => [] } = {}) {
    const hookList = name => {
        const fns = hooks(name);
        return Array.isArray(fns) ? fns.filter(fn => typeof fn === 'function') : [];
    };
    const env = { hooks: hookList, coins: () => currencyFrom(hookList('currency')) };
    const kind = (grammar, apply) => ({ grammar, apply });
    return {
        domains: {
            scene: { initial: initialScene, validate: slice => validateScene(slice) },
            inventory: { initial: initialInventory, validate: slice => validateInventory(slice) },
        },
        commands: { ...createInventoryCommands(env), ...sceneCommands },
        queries: { ...createInventoryQueries(env), ...sceneQueries },
        kinds: {
            item: kind(CORE_KINDS.item.grammar, (ctx, line) => captureItem(ctx, line, env)),
            coin: kind(CORE_KINDS.coin.grammar, (ctx, line) => captureCoin(ctx, line, env)),
            place: kind(CORE_KINDS.place.grammar, (ctx, line) => capturePlace(ctx, line)),
            present: kind(CORE_KINDS.present.grammar, (ctx, line) => capturePresent(ctx, line)),
        },
        context: {
            static: () => CORE_STATIC,
            // Half the budget for the lines that always go, half for the optional overflow.
            tail(view) {
                const chars = CORE_BUDGET * 4;
                const scene = sceneTail(view?.state);
                const used = scene.reduce((sum, line) => sum + line.length + 1, 0);
                const inventory = inventoryTail(view?.state, { coins: env.coins(), chars: chars / 2 - used, optionalChars: chars / 2 });
                return { lines: [...scene, ...inventory.lines], optional: inventory.optional };
            },
            budget: CORE_BUDGET,
        },
        tabs: [
            { id: 'inventory', title: 'Inventory', icon: 'fa-box-open', render: (el, view, api) => renderInventoryTab(el, view, api, { coins: env.coins() }) },
            { id: 'scene', title: 'Scene', icon: 'fa-map-location-dot', render: (el, view, api) => renderSceneTab(el, view, api) },
        ],
    };
}

/** The core module definition for `sdk.registerModule` (§6), built from the core part. */
export function createCoreModule({ hooks = () => [], version = '2.0.0-alpha.1' } = {}) {
    const part = createCorePart({ hooks });
    return {
        id: CORE_MODULE_ID,
        name: 'Story Block',
        version,
        domains: part.domains,
        commands: part.commands,
        queries: part.queries,
        capture: {
            kinds: CORE_KINDS,
            apply(ctx, line) {
                const kind = part.kinds[line?.kind];
                if (!kind) return ctx.fail('INVALID', `Story Block does not handle "${line?.kind}" lines.`);
                return kind.apply(ctx, line);
            },
        },
        context: part.context,
        tabs: part.tabs,
    };
}
