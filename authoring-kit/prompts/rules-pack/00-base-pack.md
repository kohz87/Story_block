# Rules pack, base pack (only if you do not have a pack yet)

The rules steps build on a **base pack**: the pack's identity, its money, its quest ranks, its places and its items.
If you already have a pack (made by hand or exported from Story Studio), use it as `{{BASE_PACK}}` and skip this
file. If you do not, send this once, after `00-master.md`, and keep the result as `work/base-pack.json`.

## Fill in

| Placeholder | What to put |
|---|---|
| `{{WORLD_NAME}}` | the name of your world |
| `{{LORE_FILES}}` | your lore files |
| `{{PACK_ID}}` | the pack id: lowercase letters, digits and dashes, at most 40 characters |
| `{{MONEY}}` | how your world counts money, for example "copper 1, silver 10, gold 100", or "decide from the lore" |
| `{{ITEM_COUNT}}` | roughly how many items you want to start with, for example 40 |

## The prompt

```
Write the base pack for {{WORLD_NAME}} from {{LORE_FILES}} as one JSON file, work/base-pack.json. Follow
PACK-FORMAT.md and LIMITS.md. It holds only these parts, and nothing else:

1. The envelope: "id": "{{PACK_ID}}", "version": "1.0.0", "name", "author" (leave it as "You" unless told),
   "description" (one or two sentences), "requires": {"storyBlock": "^2", "capabilities": ["rb-rules-v2"]}.
2. "currency": the world's money as {{MONEY}}. Name the smallest coin first with value 1; every price, value and reward
   in the pack is in that smallest coin. Add a "coins" list only when the world has coins of different worth.
3. content.ranks: the ladder of quest ranks the lore uses (or F, E, D, C, B, A, S if it has none), lowest first, each
   {"id", "title", "levels": [lo, hi], "reward": [lo, hi]}. The ranges follow the lore (a character's level
   cap is 99). The lowest rank's jobs pay a few days' wages; each rank pays more than the one below.
4. content.places: every place the lore names that a character can go to (settlements, wilds, dungeons, guild halls,
   temples): {"slug", "name", "region", "kind", "x", "y", "note"} plus "market" (a settlement type such as village,
   town or city) and "tags" (lowercase environment words) where the lore says. x and y are numbers on one map unit that
   you state in work/notes.md; use the lore's distances when it gives them.
5. content.items: about {{ITEM_COUNT}} items the lore names or implies, each {"slug", "name", "kind", "rarity",
   "value", "note"} plus "slot" for equipment, "stats", "effect" and "tags" where they matter. kind is one of goods,
   material, consumable, equipment, quest, money. Equipment slots are one of weapon, offhand, head, body, legs, feet,
   accessory-1, accessory-2. Include what later steps will need: a few weapons, armour pieces and charms, food, healing
   and other consumables, crafting materials, and the loot the monsters in the lore would drop. Values follow these
   rules: everyday goods keep the lore's own prices; a basic healing consumable costs no more than the lowest reward of
   the lowest rank; gear costs one to three jobs of its rank.
6. content.crafts only if recipes will use a craft other than smithing, alchemy, leather, cooking or enchanting.

Use the lore's names. Where the lore gives no price or distance, choose a sensible number and list your choices in
work/notes.md (a short list, not inside the JSON). Output the JSON file only; leave content.creatures, shops,
recipes, quests and rules out. Then run: node check.mjs work/base-pack.json
```

## Check

`node check.mjs work/base-pack.json` should print `OK`. If it reports `requires.capabilities` problems or unknown
fields, fix those first. A base pack with no `content.rules` is an ordinary pack, and that is fine at this point.
