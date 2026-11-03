# Gear in fights: the inventory side

Feature `story-block.gear` ("Gear in fights"), off by default: one switch for gear stats, wear, encumbrance, condition words and
prices. The switch is in Settings → RPG (not the Features list) and counts only while the RPG is on. This is the inventory half;
the rolls that read it come later. With the switch off nothing here runs: items, receipts, prompts and queries are exactly as
without it, and stored state is never touched by turning it on or off.

## Gear gives stats, nothing else

An equipped item gives +N to one or more of the seven stats (STR, VIT, AGI, DEX, INT, LUK, CHA); there is no separate attack or
defence term. Every slot gives them: weapon, body (armour), off-hand (shield), head, cloak, feet and the two accessory places
(`accessory-1`, `accessory-2`). A bag is no slot: it adds its carry while owned.

| | |
|---|---|
| Budget (total stat points) | by rarity: common 0, uncommon 1, rare 2, epic 3, legendary 4 (`GEAR.budget`, src/v2/domains/gear.js) |
| Pack override | a pack item's `bonus` 0–6 is its budget instead (pack.json, validated; a `pack.` def only; the story and a renamed copy never keep it) |
| Which stats | a pack item's `stats: { DEX: 2 }`, held to the budget; with none listed, the pick below |
| Effective stats | part 2 adds `statBonus` to the stats the rolls and bars use; the result may pass 20 but never `GEAR.effectiveMax` (30) |
| Broken | a piece at condition 0 gives no stats |
| Capacity | per member 10 + 2 × STR (STR 1–20, a missing STR counts as 10) + the `carry` of what they own |
| Load | 1 per item unit; coins weigh nothing (there is no `weight` field) |

The pick when nothing names a stat (the name's last matching noun, else the slot's own): blade, sword, dagger, bow → DEX; axe,
hammer, club, spear → STR; staff, wand, tome → INT; mail, leather, plate, cuirass, robe, shield, buckler, helmet, helm, cap, hood →
VIT; boot, shoe, sandal, cloak, cape, mantle → AGI; ring, amulet, pendant → LUK. Slot defaults: weapon STR, body/off-hand/head VIT,
cloak/feet AGI, accessory LUK. The whole budget goes on the one stat.

## What a story item gets

While the feature is on, a `+ item` line that makes a new item gets (before any module's `item.define` hook):

* **slot** from the line's `kind:` or `slot:` word (weapon, body/armour/armor, off-hand/shield, head, cloak, feet, accessory),
  else from the name's last matching word: sword, blade, axe, hammer, club, bow, dagger, spear, staff, wand, tome are weapons;
  mail, leather, plate, cuirass, robe body; shield, buckler off-hand; helmet, helm, cap, hood head; cloak, cape, mantle cloak;
  boot, shoe, sandal feet; ring, amulet, pendant, belt accessories (plurals too). A name ending in pack, satchel, bag or sack has
  no slot. Goods that get a slot become equipment, so they can be worn.
* **rarity** from a `rarity:` or `quality:` word: crude/poor/plain are common, fine/good/sturdy uncommon, superior/masterwork
  rare, heroic/magnificent epic, legendary/fabled legendary. Default common.
* **stats**: the narrator may name any stat on any item (`| rarity: rare | AGI: +1 | DEX: +1` on a blade); code holds the total to
  the budget and to at most 2 different stats, and picks the default above only when none is named.
* Other numbers on the line (`atk: 9`, `bonus: 5`, `carry: 50`) are not read.
* Rarity limits for story items: common to epic anywhere. Legendary only when the same reply also completes a quest or wins a
  fight against a group at least 10 levels above the party; otherwise it is held to epic with one Problems line. Whoever knows
  that (the quests, the fights) answers the query `story.legendaryEarned` for the reply; nothing answering counts as no. A
  module's own reward (`inventory.grant`) and a pack's item keep the rarity they are given.
* A pack place may carry `loot: { maxRarity }` (one of the five words, validated) to lower that ceiling for the area the party is
  at (matched by the place's name or alias); absent means no extra limit.
* A bag from the story has no capacity of its own (only a pack's item has `carry`).

## Queries and commands

* `inventory.gear { owner }` (default `party`) answers `{ on, owner, slots, statBonus, carry }`: `slots` has the eight places,
  each `{ name, stats, cond, broken }` or `null`; `statBonus` is `{ STR, VIT, AGI, DEX, INT, LUK, CHA }` summed over what is worn
  (broken left out); `carry` is `{ load, capacity, encumbered, penalty, sources }` (penalty -2 while encumbered). `inventory.statBonus
  { owner }` answers the sum alone. Both answer null while the feature is off.
* `gear.carry` answers what `items.carry` asks (`{ on, people, bag, load, capacity, bonuses }`, or `{ ok, message }` for
  `add`). It is not registered as `items.carry`, which would clash with a carry module's: a module that answers `items.carry`
  is asked first, and Story Block's own answer is used only when none does. So encumbrance (`inventory.encumbrance`, the
  existing -2 AGI/DEX path) fires from the load, and the story's lines past the limit are kept as before. The reader's own
  takes past the limit are refused.
* `gear.wear { owner, slot, steps }` (`weapon`, `body`, `off-hand`, or `defence`: the body armour, else the off-hand; `steps`
  1–3, default 1): the system's or a module's call, never a button or a story line. The piece goes down `steps` condition words
  (good to 69, worn to 39, torn to 0) through the same condition events as `inventory.wear` (so swipes, deletes and rebuilds
  take exactly its wear back). Part 2: a decisive hit taken wears the defender's `defence` one step, a decisive miss of the
  attacker their `weapon`. At 0 it is broken.
* Equipping: with gear on, a `+ item` line's `equipped: <slot>` puts the item on (equipment that fits; one item per slot per
  owner, so what was there is put away; a second accessory takes the second place), and its `slot:` / `rarity:` words take
  effect. `item.equip { stack, owner, slot }` is the reader's command (the gear UI calls it). `inventory.items` rows carry
  `equippedBy` (the owner) for what is worn.

## Condition: words and prices

A piece's condition (0–100) reads as Good (70 and up), Worn (40–69), Torn (1–39) or Broken (0) (`condWord`, gear.js). With the
switch on, an item below Good shows its word after the name in the prompt ("Cane Sword (worn) [weapon]", "Oak Buckler (broken)";
Good stays unmarked), so selling or showing it to an NPC reflects it. The price `inventory.items` and `inventory.find` give
(`value`) is the def's value times 100% (Good), 75% (Worn), 50% (Torn) or 20% (Broken) (`CONDITION`, `valueByCond`); `baseValue`
is the def's own. `inventory.definitions` stays the def as stored. Off: prompts and rows are as before.

## Repair in the story

With gear on, `~ item Cane Sword — the smith reground it | repair: mend|restore` mends the piece worn (else the most worn lot):
`mend` (mended, patched, fixed) is one condition word up (broken to torn, torn to worn, worn to Good), `restore` (restored,
reforged, as new) is back to Good. It goes through the same condition events as `inventory.repair`, once per piece per reply. A
repaired piece gets its stats back and the prompt word follows. The coin for the repair stays the narrator's own `- coin` line.
Off: the word does nothing.

## Mounts and carts carry too

The party's capacity adds each Mount row's carry × count while the mount travels with the party: its `where` is empty, names the
party's place, or says it is ridden, led or pulled; a mount left elsewhere ("stabled at …") adds nothing. The row's own `carry`
(the reader's pencil on Home, 1–1000, empty clears it) beats the kind's usual: horse/pony 20, mule/donkey/pack animal 40,
cart/barrow/hand-cart 60, wagon 150, boat 100, other 20 (`KIND_CARRY`). A story item whose name says cart, barrow, hand-cart,
wagon or sledge gets that carry on its def (sledge counts as a cart) and adds it while owned. `inventory.gear` carry also lists
`sources: [{ name, carry }]` (each member's 10 + 2 × STR, bags, carts, mounts).

## Signature gear

A pack's cast entry may list `gear` (PACKS.md "The cast"): up to 6 of the pack's equipment items, one to a slot (two accessories at most),
checked when the pack is read. With the switch on:

* **Joining.** When that person joins the party (a `+ party` line or the Ask card's Add to party; the name or an alias matches the
  cast entry), each item is added to the inventory owned by them (the party's actor of that name when a party module lists one, else
  the party's bag) and put on in its slot through `item.equip`, condition Good, as part of the join's own receipt: the summary ends
  "Gear: Cane Sword, Oak Buckler." and `data.gear` lists them. A swipe, a delete or a Re-read of the reply takes the join and the
  gear away together; a rebuild gives the same. In the party's bag a slot already taken stays as it is and the piece is carried.
* **Coming back.** Someone who left and comes back (`- party`, then `+ party`) keeps what they own: only a piece no longer owned is
  given again, and nothing is duplicated.
* **The narrator's cast entry.** While the person is not in the party the query `packs.castGear { name }` answers
  `{ name, line: "Gear: Cane Sword, Oak Buckler", items }`; the cast entry that names the person (NPC State Delta's) adds `line` as one
  short line in its static part. It answers null once they are in the party, with no gear, or while the switch is off, so the prompt
  is byte-identical then.
* **Off.** Nothing runs: a join is exactly as it was, with identical receipts.

## Replay

Everything is derived from the inventory slice and its condition events; a swipe, a delete, a Re-read, a rebuild and a reload
give the same answers (tests/v2/gear-inventory.test.js).
