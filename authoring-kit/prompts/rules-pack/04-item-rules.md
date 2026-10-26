# Step 4: item rules (every item in the pack)

## Fill in

| Placeholder | What to put |
|---|---|
| `{{BASE_PACK}}` | the pack whose items get rules (`work/pack.json` once it holds the items) |

## The prompt

```
Step 4. For every item in {{BASE_PACK}}'s content.items (all of them, same order), write one item rule:
{"def":"<item slug>","allowedSlots":[...],"hands":0|1|2,"requires":{},"weight":<whole number 0-10000>} and optionally
"unique": true. Slots are weapon, offhand, head, body, legs, feet, accessory-1, accessory-2.

Rules:
- Exactly one rule per item: no item without a rule, no rule for a slug that is not an item.
- Only an item whose kind is "equipment" has slots; every other item (food, potions, materials, loot, coins, quest
  items) has allowedSlots [] and hands 0.
- A weapon is hands 1 or 2 with allowedSlots ["weapon"]; a two-hander is hands 2 and ["weapon"] only. A shield or other
  off-hand item is hands 1 with ["offhand"] (a one-hander may also list ["weapon","offhand"]). Armour is hands 0 in its
  one body slot (head, body, legs or feet). A ring, amulet or charm is hands 0 with ["accessory-1","accessory-2"].
- If an equipment item names a standard slot of its own ("slot": "body"), its rule's allowedSlots must include it.
- "requires" lists only real minimum stats (each 1-99, for example {"STR": 8} for a heavy axe), otherwise {}.
- "weight" is a whole number 0-10000 in the pack's own unit (grams-ish); light things are small, armour and two-handers
  large.
Output {"itemRules":[...]}. In a file: put it at content.rules[0].itemRules of work/pack.json. List, outside the JSON (in
work/notes.md), any item whose slot you were unsure of.
```

## Check

```
node check.mjs work/pack.json --through 4
```

It should print `OK through step 4`. Typical problems: `item-rule-mismatch` (a count that is not one rule per item, a
non-equipment item with slots, hands that do not match the slots), `bad-ref` (a `def` that is not an item slug).
