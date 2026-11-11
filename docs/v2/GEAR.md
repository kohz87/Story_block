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
| Budget (total stat points) | by rarity: common 1, uncommon 2, rare 3, epic 4, legendary 5 (`GEAR.budget`, src/v2/domains/gear.js) |
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
  boot, shoe, sandal feet; ring, amulet, pendant, belt, gauntlet, glove, bracer, bracelet accessories (plurals too). A real compound word is read as a whole
  word too, from a fixed list: longsword, shortsword, broadsword, greatsword, bastardsword, warhammer, battleaxe, greataxe, handaxe, warstaff, quarterstaff, longbow, shortbow,
  crossbow, greatbow, warbow (weapons); breastplate, chainmail, platemail, ringmail (body). A word is never read by its ending, so Horseshoe, Snowshoes, Reboot, Windshield,
  Crossword and Flagstaff stay goods. A name ending in pack, satchel, bag or sack has
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
(the reader's pencil on Home, 1–1000, empty clears it) beats the kind's usual: pony 30, horse 40, mule/donkey/pack animal 50,
cart/barrow/hand-cart/sledge 60, carriage/coach 80, boat 100, barge/wagon 150, other 20 (`KIND_CARRY`; computed on read, nothing stored). A story item whose name says cart, barrow, hand-cart,
sledge, carriage, coach, barge or wagon gets that carry on its def and adds it while owned. `inventory.gear` carry also lists
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
  "Gear: Cane Sword, Oak Buckler." and `data.gear` lists them. A swipe or a delete of the reply takes the join and the
  gear away together (so does a Re-read when the reply's text no longer has the `+ party` line; an Ask card's Add to party is your own
  click and a Re-read keeps it); a rebuild gives the same. With the RPG on, their Character block is their actor (see "The roster (2.18.1)"). With no actor of their own (the RPG is off, or a roster of another make does not list them) **nothing is given**: the shared bag's worn gear counts for the reader's own Character, so the joiner's pieces would become the reader's. The join stands, one Problems line says "Harrak's gear stays with Harrak (no party roster)", and the narrator's `Gear:` line still describes them. Otherwise a slot already taken stays as it is and the piece is carried (a Problems line says so).
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

## The roster (2.18.1)

Members of the party own and wear their own gear, so something has to say who the members are. The RPG answers two queries from its Character blocks
(`src/v2/lean-rpg/roster.js`), only while the RPG is on **and** Gear in fights is on (with the gear switch off nothing answers: the inventory, its screens and commands are exactly as in 2.18.0, no members, pickers or Give to a member):

* `party.actors` → `[{ id, name, pc? }]`: one actor per Character block that is in the party (a companion who left is not on it), in block order; `pc: true` on the
  reader's own. (`party.levels` → `[{ id, name, level, left }]` lists the same ids with the sheet level and the members who left; MODULES.md §E; `null` with the RPG off, `[]` when there is no Character: a consumer treats `null` as "no answer".)
* `party.pc` → `{ id }`: the reader's own Character: the one named like the persona (the same name, or a first name that means only them), or the only Character; with several and
  none named so, null (nothing guesses who the reader is; the rolls fall back to the first block themselves, and the screens call the bag by the persona's name). Only the id: the
  header keeps the persona's name.

**The id is the block's, never the name's.** It is `ac_` and 8 base-36 characters worked out from the Character block's module id (`actorIdOf`, e.g. `pack.chat/mara`),
so a rename, a rebuild, a reload, a swipe or a Re-read give the same one. A pack's cast member that joins is a block like any other: `+ party Mara` makes `pack.chat/mara`,
and its actor is the owner of their signature gear, found by that id (`gearOwnerOf`, data-modules/part.js), on join, on leave (`inventory.stow`) and on return.

**Rolls that carry a gear record** ask `party.actors` and `party.pc` with `recorded: true` (as they ask `inventory.gear`), which answers whatever the switches say now, so a Re-read after
Gear in fights was switched off works the roll's gear out as it was made. **Gear off hides all of it by design:** with the switch off nothing answers, so no member, picker or
Give to a member appears, and a piece a member wears stays filed under them (the gear screens are off) until the switch is on again.

**A Character who is removed** (`dm.remove`) leaves nothing filed under their actor, or a block made later under the same name would inherit it: in the remove receipt
`inventory.release` takes their pieces off, moves them to the party bag, clears their bound mark, and gives what was set aside for them (`kept`) to the bag the same way
(plain items, condition kept; nothing runs when they held nothing).

**An older roster wins.** Both queries are registered as *fallbacks* (registry.js: `fallback: true` on the function): they take no ownership of the name, so a module that
answers `party.actors` itself (an old RPG Battle chat) is the one asked, whichever registered first; the RPG's own answers only when that module is held back, its feature is off,
or it answers null or an empty list. For such a module the join finds the actor
by the block's id when it lists one, else by the member's name (as 2.18.0 did).

**Existing chats.** Nothing is moved: stacks owned by `party` stay the party bag, which is the reader's own Character's (`party.pc`, shown as "the main character first" in Equipped
by). A member's gear becomes theirs only when it is equipped to them from Edit (`item.equip` with `transfer: true`) or granted on join. A chat made by 2.18.0 replays byte for byte
(the stored receipts are applied, not rerun; a join that gave nothing, "no party roster", stays as it was); the first new action runs on the new rules.

**In the rolls.** `planGear` files each Character's pieces under their actor (the one whose id is the block's; an actor of another roster by exact name, then first name or
alias) and, for the lead, the party bag too: `own: [<actor>, 'party']`. The lead is the one `party.pc` names; a roll made by 2.18.0 carries the reader's name as `lead`, which
still finds them when nothing answers `party.pc`. The guard (`gearMatches`) also checks the owners: an owner that is another Character's actor than the entry's does not match,
and the roll is rolled again on a Re-read; owners of a roster of another make cannot be told from the state and are not judged.

## Your own gear: the starting kit

With the switch on, the reader can set equipment up by hand. "+ Add item" opens the grouped form (Item: Name, Count, Kind, Note; and, when Kind is Equipment,
Gear: Slot, Rarity, Bonus, Equip on) and the Edit of a piece the reader added shows the same fields. With the switch off "+ Add item" is the inline row and Edit
is as before; the new words are refused ("Gear in fights is not switched on.") and nothing is marked.

* **`inventory.add { name, qty, note?, kind?, slot?, rarity?, stats?, equip? }`** (the reader's): `slot` is one of the eight places (an accessory takes the place named
  when free, else the other one), `stats` is `{ STR: 1 }` (at most 2 of the seven stats, whole numbers of at least 1), `equip` the owner who puts it on (the reader's
  actor or a party member; it is granted to them and worn through `item.equip` inside the same command, so a refusal adds nothing). A new def gets the words as given
  (the name's own guess of a slot gives way; a Kind other than Equipment has no slot or bonus) and is marked `hand: true`. A def that already exists (a pack's, the
  story's) keeps its own words; Equip on still works.
* **Kind = Equipment always makes equipment.** When the name already has a definition that is not equipment (or is the reader's own equipment with no slot, and a Slot is
  chosen), the reader's choice wins and the def is remade as equipment inside the same add (so a replay does the same): kind equipment, not stacking, the Slot chosen (else its own,
  else the name's), the Bonus chosen, marked `hand: true`. Allowed only for a `story/` def with no stack the story gave and none bound: a def marked `hand` while only the reader's stacks of
  it are held (each of one piece), and an older def not marked `hand` (made before the mark existed) only when no stack of it is left (the reader has deleted it). Never a pack's def, never
  one the story made while it is in use; those and a stack of two or more are refused: "<name> is already in your things as <kind>, … Remove it first and add it again, or give this one
  another name." Items saved as goods (for example a character file's): Remove the piece, then add it again as Equipment (Equip on works in the same add).
* **A slot is needed.** Equipment with no Slot chosen, no slot word in the name and no slot on its def is refused: "Choose a slot for <name>: its name does not say where it is worn."
  (a saved character's starting things are not held to it).
* **The budget** is the rarity's (common 1 … legendary 5), held by the command: "A rare piece gives at most 3 points.". A rare piece with no
  stat chosen gives the usual pick (the name's or the slot's stat) over the whole budget, as for the story's items.
* **The starting kit** is open while the line of history is only the opening greeting (`env.readers() === 0` and `env.greetingOnly() !== false`: no reader message and no other message after it; a swipe of the greeting keeps it open,
  deleting every message after it opens it again, deleting only the reader's messages while a reply stays does not; a chat with no greeting is closed). Closed: Rarity above Common and any Bonus are refused ("Rarity and bonuses come from the story after the first message.") by
  `inventory.add` and `inventory.edit`. A saved character's starting things (`starting: true`, the wizard's import) keep the kind, rarity, slot and bonus of their file only while the kit is open; later they are Common and a Problems line says so. After the kit a name that a non-hand story or pack piece has (equipment, or above Common) is made as the reader's own Common piece named "Your <name>". `gear.view` answers `kit: { open, empty? }` (`empty` for a chat with no message: "+ Add item" says why it cannot add).
* **`inventory.edit { stack, kind?, slot?, rarity?, stats? }`** changes a def marked `hand: true` that has no story-given stack (and is not bound or a pack's: "Kind, slot and rarity come from the pack." /
  "... the story."). Kind may change at any time: Equipment later means Common (or the words asked, while the kit is open) and a Count above 1 becomes separate pieces; leaving Equipment
  drops slot and bonus and takes the piece off. A slot that no longer fits takes the piece off. Words as they stand are no change.
* **Screens:** `gear.view` rows carry `hand`, `defSlot` and `stats` for such a piece; the item Edit takes `gear.row`, `gear.kit` and `gear.def`.
  The form is `view/gear-form.js` over `ss.editable` kind `fields` (field `showWhen`, `disabled`, and the entries `note` and `points`).

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
