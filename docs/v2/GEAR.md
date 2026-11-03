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
* Rarity limits for story items: common to epic anywhere. Legendary only once earned (it lasts: see "In the rolls"), in or before this reply: a quest completed or a
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

## The screens

While the feature is on (and only then; off, every screen below is as it was, byte for byte), `gear.view { owner?, who?, own? }` (null while off)
answers everything the screens draw: `carry` (`load`, `capacity`, `level` normal | heavy | over, the breakdown line, mounts left elsewhere),
`rows` (per stack: the stat bonus text, the condition word, where it is worn and by whom), `owners` (who can wear: the main character first) and
`slots` (what `owner` has on, by place).

* **Settings → RPG**: the "Gear in fights" card, On / Off, after the Stat formula card.
* **Inventory tab**: a Carry card first (a row-style card: "58 / 74", the state word, a bar, the breakdown): normal under 80 %, yellow "Heavy load" from
  80 %, red "Encumbered: AGI and DEX −2" only when the load is over the capacity (the same test as the encumbered condition, so exactly at the limit
  is still Heavy). Then Equipment, Consumables, Goods, Quest items (Materials and Valuables follow). Rows show the rarity, the slot, "Equipped · Name", the
  stat bonus and a condition bar with its word (Broken: "no bonus"). Equip / Unequip buttons give way to the item Edit.
* **Item Edit** (equipment): Slot (the eight places, or none) and Equipped by (the main character, a member, or none). A change runs
  `inventory.transfer` (to a member), `item.equip { stack, owner, slot }`, or `inventory.unequip` (none), in that order.
* **Party card**: an Inventory button (Stats, Skills, Inventory, Export in one row) opens the slot card: the eight places in two columns, each a tile
  with a 3px condition line along its bottom (yellow Worn, orange Torn, red Broken, none when Good). No carry there.

## Signature gear

A pack's cast entry may list `gear` (PACKS.md "The cast"): up to 6 of the pack's equipment items, one to a slot (two accessories at most),
checked when the pack is read. With the switch on:

* **Joining.** When that person joins the party (a `+ party` line or the Ask card's Add to party; the name or an alias matches the
  cast entry), each item is added to the inventory owned by them (the party's actor of that name; a party module must list one) and put on in its slot through `item.equip`, condition Good, as part of the join's own receipt: the summary ends
  "Gear: Cane Sword, Oak Buckler." and `data.gear` lists them. A swipe, a delete or a Re-read of the reply takes the join and the
  gear away together; a rebuild gives the same. With no actor of their own (no party module answers `party.actors`) **nothing is given**: the shared bag's worn gear counts for the reader's own Character, so the joiner's pieces would become the reader's. The join stands, one Problems line says "Harrak's gear stays with Harrak (no party roster)", and the narrator's `Gear:` line still describes them. Otherwise a slot already taken stays as it is and the piece is carried (a Problems line says so).
  Everything that could be refused is checked first, never tried: a piece is looked up and granted by its definition ID (a story item of the same name, or
  two of that name, cannot get in the way), so a join never fails for its gear.
* **Bound.** The granted stacks carry `bound: <actor id>` (`inventory.grant { bound: true }`): they stay with that member. The rows of `inventory.items` and `gear.view` (rows and slots) carry `bound: { who: "Mara" }` for the screens' chip. No path moves or unequips one: `item.equip` to another owner or slot, `inventory.equip` into another slot or over it, `inventory.unequip`, `transfer`, `drop`, `consume`, `edit` (the Edit form's commands), `split`, `merge`, and the narrator's `- item` and `~ item … | qty:` are refused with "Bound to Mara: Cane Sword stays with them." (the story's line goes to the Problems list). Wear and repair go on (`gear.wear`, `inventory.wear/repair`, `~ item … | wear:` and `repair:`). Bound stacks never join another stack. With the switch off the mark is only kept and every command acts as in 2.17.0.
* **Leaving.** `- party` sets their bound pieces aside (`inventory.stow`: the inventory's `kept[<actor>]`) in the same receipt: they leave the party's inventory, the summary adds "Their bound gear leaves with them: ...", and `data.gear.away` lists them.
* **Coming back.** `+ party` brings them back once (`inventory.restore`, then the grant for any piece they do not own): bound again, in the condition they left in (the wear is kept), worn in the slot they had when it is free (else carried). Nothing is duplicated; a piece they own unbound is not given again. If the switch was off when they left, the pieces never left and stay where they are.
* **The narrator's cast entry.** While the person is not in the party the query `packs.castGear { name }` answers
  `{ name, line: "Gear: Cane Sword, Oak Buckler", items }`; the cast entry that names the person (NPC State Delta's) adds `line` as one
  short line in its static part. It answers null once they are in the party, with no gear, or while the switch is off, so the prompt
  is byte-identical then.
* **Off.** Nothing runs: a join is exactly as it was, with identical receipts.

## Replay

Everything is derived from the inventory slice and its condition events; a swipe, a delete, a Re-read, a rebuild and a reload
give the same answers (tests/v2/gear-inventory.test.js).

## In the rolls (part 2)

While the switch is on, the roll's payload carries only the mark, `gear: { v: 1, lead: '<reader name>' }` (`lead` is who the shared bag meant, used when no party module names the main character; a mark without it falls to the first block). `rpg.resolve` works the gear out itself from the state before the roll
(lean-rpg/gear.js `planGear`, over the inventory's own answers) into the record `gear: { v: 1, who: { <member>: { own, add?, enc?, items? } } }`: `own` the owners
the member's pieces are filed under (their party actor, and `party` for the lead), `add` the summed stat bonus (broken pieces give none), `enc` the encumbered
penalty (-2), `items` the pieces that give something. The record is hashed with the roll (predicate and result), so a rebuild and a reload roll with it and
equipping something later never moves a roll that was made. A change **before** the roll does change its gear: the guard asks the state before the roll for the same
pieces and load (`gearMatches`), so deleting, or editing and Re-reading, the reply that gave and equipped the gear takes the roll off and it is rolled again
without it. A roll with no `gear` (made before) is exactly as before, and off nothing asks the inventory.

* Stats: effective = stat + bonus, held to 30, then AGI and DEX -2 while encumbered (never under 1). Both formulas, the turn order and the Settings odds read
  these; the bars' sizes (blocks) follow the block's own stats, never the gear.
* Whose bag is `party`: the reader's own Character, found by the party module's main character (`party.pc`), else the Character named like the persona; only
  when none matches is it the first block (a companion who sorts first is not the reader).
* A party member is a Character when the names are the same, or one is the first name of the other ("Ren" is "Ren Ashby"), or an alias of the member says so
  (`sameWho`, lean-rpg/read.js). An exact name wins, and a first name or alias counts only when it means exactly one Character: with "Ren Ashby" and "Ren Holt"
  a member "Ren" is neither. `packs.castGear` asks the same question for "already in the party".
* Encumbered is at 100 % and over (load at or over the capacity; an empty load never) **only with gear on**; with gear off the limit is as it always was
  (more than the capacity: exactly 5 of 5 is not encumbered). The roll penalty, `inventory.encumbrance`, and the Carry card
  (red "Encumbered" from 100 %, yellow "Heavy load" from 80 % to below 100 %).
* Wear: a decisive hit taken wears the member's body armour (else off-hand) one step; a decisive miss of their own act wears the weapon one step
  (`gear.wear`, called by the roll, so it is in the roll's receipt and undone with it). Told rounds only; a broken or absent piece wears nothing. The result
  has `wear: [{ n, who, item, from, to }]`; the cue and the log say "Boiled Leather Jerkin is worn (Torn)". The wear lines count inside the cue budget (the
  rounds told are fitted with the wear they would cause), and the cue a reader gets from the receipt is rebuilt from the record, wear included. A roll
  that is planned again (Re-read, rebuild) wears by its stored `gear` record, never by today's switch, so switching gear off does not take wear away.
  `gear.wear { recorded: true }` is accepted only from the RPG's own nested call in `rpg.resolve`; a pack event step or a top-level call is refused it.
* A later delete, equip or unequip never changes a stored roll's bonus: the record in the roll wins (and a later repair or wear does not rewrite what it
  said), so what a roll rolled with is what it keeps.
* `wear: ruin` from the story breaks the piece in one step (condition 0); scuff and tear are as before.
* Log: a roll line names the gear that was in it ("Astra uses Iaijutsu (Cane Sword +2 DEX)"), from `pc.gear` of the line.
* Legendary is a lasting flag: a roll that won a fight against a group at least 10 levels above the party's highest carries `legend: 1`, and from then on
  (that reply and every later one) the narrator's legendary item lines stand; likewise once a quest is completed (a Director thread of kind quest that ended
  `done`). `inventory.legendEarned` derives it from the chat's record (rolls up to the reply asking, threads), so a swipe or delete of the winning reply takes
  it back and a rebuild gives the same. `story.legendaryEarned` is still asked first, so another module can answer it.
* The item Edit's Equipped by is one command (`item.equip` with `transfer: true`): if the slot is refused, the item stays with its owner.
* The mount pencil's Carry field and the Carry card exist only with gear on; with gear off every screen is as it was (six fields).
