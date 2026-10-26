# Test-playing v2 in Ersveil: Wessel at Bluewatch

This page sets up a v2 test chat in the Ersveil world with the **Ersveil starter pack**
([`examples/packs/ersveil-bluewatch/pack.json`](../../examples/packs/ersveil-bluewatch/pack.json)).
Wessel, a runaway barge hand with a hidden cane-blade, comes ashore at Bluewatch Village, the
northernmost village in the known world. The Adventurer Guild office there has three small jobs on
its board.

The pack holds only what code uses: items with their numbers, creatures, shops, recipes and crafts, the
three jobs, a short chain of events, races, talents, Wessel's two skills, a ready-made character, the map
around Bluewatch, the Guild ranks, two NPC meter presets and the Compact Year calendar. The world's lore stays in your two Ersveil lorebooks;
nothing from them is copied into the pack.

Setup used for this guide: SillyTavern 1.19; Gemini most of the time, also GLM, Kimi and Gemma.

## 1. Extensions

Install these four (SillyTavern → Extensions → Install extension: paste the URL and install; there is no
branch to pick). If you have the v1 versions installed, remove them first or use a
separate SillyTavern profile; v2 doesn't read v1 chats or v1 blocks.

| Extension | URL |
|---|---|
| Story Block (the host) | https://github.com/kohz87/Story_block |
| RPG Battle | https://github.com/kohz87/rpg_battle |
| Story Director | https://github.com/kohz87/Story_director |
| NPC State Delta | https://github.com/kohz87/npc_state_delta |

## 2. Megumin

Keep Megumin Suite on with **only CoT and Writing Style** enabled. Turn everything else off: every
block (World State, Bonds, Character Sheet, Inner Chatter, CYOA, Story Tracker, Dice), Story Director,
NPC Bank, Combat, MVU, the Notebook.

You don't need the Megumin Story Director engine (`Megumin_V11_Story_Director_Engine.json`) for v2.
v2 never asks the model for World State, Director or other blocks (MODULES §F13, §F15). The only block
the model writes is `<Changes>`, and Story Block's own instruction asks for it.

## 3. The pack

Pack **1.5.0** keeps every existing content slug and adds twelve open quest templates: story tasks,
hunts and deliveries for ranks F through C. Import the single `pack.json` to install all of them.
Open a template with an explicit `like:` binding or the quest reader; the existing thirty quests keep
their fixed objectives and rewards.

1. Story Suite settings → **Packs** → **Import pack file** → `examples/packs/ersveil-bluewatch/pack.json`.
   The list shows "41 items, 6 creatures, 4 shops, 7 recipes, 6 events, 3 quests, 7 races,
   6 talents, 2 skills, 1 ready-made character, 54 places, 63 routes, 1 term set, 7 ranks, 2 crafts,
   2 meter presets, start state".
2. Switch off any other pack with a start state or a currency (for example `riverside-starter`). The
   first enabled pack that has one sets the start place and suggests the currency.
3. **Currency:** the pack suggests the lore's coins, counted in **copper** (silver 10, gold 100). Story
   Block uses them when you haven't named the chat's currency yourself. If you have, clear it, or set
   Story Block's **Coins** to `copper: 1`, `silver: 10`, `gold: 100`.

## 4. Lorebooks

* Import **Ersveil World Lore v1.24** and **Ersveil Map Lore v1.16** and make both active for the
  chat (or global). Leave Vector Storage's "Enabled for all entries" off.
* The World lorebook's **"[CORE] Currency"** entry stays as it is: its copper, silver and gold are the
  pack's coins ([§8](#8-currency-the-lores-coins-counted-in-copper)).

## 5. Persona and character card

* **Persona:** name `Wessel`. For the description, use only the persona part of
  `Ersveil_PC_Wessel_Persona_and_Kit.txt` (from "{{user}}: human man, early twenties…" to the line
  "Blade: …"). Leave out the RPG Battle section and the hidden blocks: in v2 the stats come from the
  creation wizard and the kit from the pack.
* **Character card:** a narrator card, for example name `Ersveil` with the description
  "{{char}} narrates Ersveil and plays every person in it except {{user}}."

## 6. First message

Paste this as the card's first message. It is the visible text of
`Wessel_First_Message_Bluewatch.txt` with two changes:

* The `<!-- STORY_BLOCKS_V1 … -->` hidden block at the end is removed. v2 doesn't read it: the start
  place, the kit and the purse come from the pack, the skills from the ready-made character.
* "twenty copper a day" stays as written: copper is the pack's smallest coin.

```text
Eighteen days of poling up the Bluewatch Branch from Glassdock, and the *Kettle Wife* finally came out of the mist. Your hands had split on the tenth day and again on the fifteenth. This morning they would barely let go of the pole.

Bluewatch rose out of the grey: a signal tower trailing brazier smoke, a stone river-gate with its chain across the water, wet roofs behind a palisade. North of the tower there was nothing at all, and everyone on the walls was facing that way.

Your walking stick leaned against the cargo within reach. It was ash with an iron ferrule, and nobody aboard had asked why a man without a limp carried one. Six weeks of river lay behind you, back to Hulkrow's rotting barges and the morning a man in a good coat had come asking for the name on your bond.

Marrit, the bargemaster, came down the deck slapping her crew list against her palm. "Line up. Inspector names every hand before a boot touches stone, and nobody's paid till he's done." That was eighteen days at twenty copper a day, still in her purse.

The inspector worked down the line with his ledger open and a spearman at his back. Past him, notices curled on a board in the damp: *Salvage convoy to Auvoth, guards wanted, ask at the Stray Oar.* Auvoth was four or five days down the Frontier Road, and there no Confederacy claim was heard. By the salt sheds, two men who weren't unloading anything watched each hand come ashore and counted.

The inspector stopped in front of you. His eyes went to the stick, then back to your face.

"Not on my last list for this boat." He wet his pen. "Name. Where from. Where bound."
```

The v1 Director block also seeded six records (the bond quest, the collector, Marrit, the wages, the
road to Auvoth, the salt crew). v2 doesn't read that block. Story Director picks these up when the
story writes them as change lines, so let the first replies bring them in.

## 7. Playing

**Character creation.** Before the first reply RPG Battle asks you to create your character
(MODULES §F12). Pick **Wessel (kit)**: Human, the talents *Shadow-bent* and *River-born*, and the kit
file's stats (STR 5, VIT 6, AGI 8, DEX 8, INT 7, LUK 6, CHA 5: 2 points go to the talents, 8 to the
stats). The name and background come from the persona. The preset also names his two skills:

| Skill | Type | Stat | Target | What it is |
|---|---|---|---|---|
| Cane Draw | physical | DEX | one | The hidden blade drawn and cut in one motion. |
| Shadow Cut | magic | INT | all | The draw-cut carried past the blade as a thin arc of cold shadow, cutting every foe within a pace or two. |

If your RPG Battle build doesn't offer pack skills in the wizard yet, let the story teach them with
`+ skill Wessel — Cane Draw` and `+ skill Wessel — Shadow Cut` lines, or add them on the Party tab.
RPG Battle Terms as in `START_HERE.txt`: Soul Class / Soul Growth, tier titles on (size 10, Roman),
level cap 90.

**Start state.** A new chat begins at Bluewatch Village (settlement), with Marrit and the quay
inspector present. Wessel carries the Cane-Blade, the Patched Oilcloth Coat, a Knife ("For work, not
fights") and a Whetstone ("Worn thin"), and has **44 copper**, shown as "4 silver 4 copper".

**Clock.** The pack's calendar is the Compact Year: era `CY`, Dawnwane … Yearsend, 30 days each, and the
story starts at **CY 611, Goldwane 12, 06:40 am**. Story Director's atlas and clock read it with the
query `packs.calendar`. If your Story Director build doesn't read it yet, set its Calendar settings by
hand (custom, era CY, the twelve months of 30 days). The time-based events below wait until the story
clock is set. If the Director tab shows no time after the first reply, let the story write
`~ time Goldwane 12, 06:40 am`.

**The jobs.** All three are F-letter jobs from **Fenna**, the Guild clerk at the Guild Office. The
targets and rewards are written the way Story Director reads them (`target:` / `reward:`):

| Job | Where | Target | Reward | Due |
|---|---|---|---|---|
| Granary Rats | Watch Granary | 6 cellar rats | 50 copper | — |
| East Bluff Wolves | East Bluff | 4 crag wolves | 200 copper | — |
| Culvert Leeches | North Culvert | 8 sluice leeches | 120 copper | Goldwane 14, 07:00 pm |

The foes are pack creatures: Cellar Rat Swarm, Starved Crag Wolf (and their Crag Wolf Matriarch),
Sluice Leech. A fight with them counts toward the job whose target names them.

**Events** (once each, in this order):

| Event | When | What the next reply is told |
|---|---|---|
| guild-board | in Bluewatch, from Goldwane 12, 08:00 am | Fenna pins the three notices. |
| wolves-at-dusk | after the board, from Goldwane 12, 07:00 pm, wolves not done | The crag wolves howl from the east bluff. |
| culvert-rising | after the board, from Goldwane 13, 06:00 pm, culvert not done | Rain in the hills; the culvert runs high. |
| culvert-floods | after it rises, from Goldwane 14, 07:00 pm, culvert not done | The culvert backs up and floods the storehouse lane. |
| culvert-cleared | culvert job done before Goldwane 14, 07:00 pm | Watch-Captain Rorke sends **20 copper** on top (paid by code). |
| granary-cleared | rats job done | The quartermaster takes notice. |

**Shops** at Bluewatch: **Watch Stores** (general goods), **Salt-and-Ash Dispensary** (apothecary; the
lay sealer), **Gate Forge** (smith) and the **Stray Oar** (inn).

**Crafting.** Seven recipes, with the crafting data RPG Battle's crafting reads (MODULES §F102). Four are
basics every character knows from the start; the other three are taught.

| Recipe | Craft | DC | Station | Makes from | Known / taught by |
|---|---|---|---|---|---|
| Leech-salt Pouch | fieldcraft | 6 | anywhere | 2 coarse salt, 1 burlap sack → 2 pouches | known |
| Pitch Torches | fieldcraft | 5 | anywhere | 1 lamp oil, 1 burlap sack → 2 torches | known |
| Camp Stew | cooking | 5 | campfire | 1 trail rations, 1 coarse bread → 2 hot meals | known |
| Healing Salve | alchemy | 10 | alchemy-table | 2 bluecap moss, 1 lamp oil | known |
| Minor Healing Draught | alchemy | 16 | alchemy-table | 3 bluecap moss, 1 cleansing spirits | the lay sealer at the Salt-and-Ash Yard |
| Completion Salts | alchemy | 18 | alchemy-table | 3 coarse salt, 1 iron filings | the lay sealer, as licensed work |
| Wolf-pelt Mantle | leather | 14 | workbench | 3 crag wolf pelts (60 copper at the Gate Forge) | the Watch smith at the Gate Forge |

The pack's **crafts** change one default and add one: Ersveil **alchemy** rolls INT+DEX (the lore calls it
a craft, not spellcasting, where a slip poisons or burns the alchemist), and **fieldcraft** (DEX, done
anywhere) covers frontier makeshift work. The other crafts keep the defaults (smithing STR+DEX, leather
DEX, cooking VIT, enchanting INT+LUK).

**NPC meters.** Two meter presets for NPC State Delta:

* **Frontier Regard**, for Bluewatch folk and other frontier locals: *Regard* (-100 to 100, strangers
  start at -20: hostile, wary, guarded, civil, trusting, sworn) and *Owed* (0 to 100, favours they owe
  you, fading by 1 a day). Stages: *Marked as trouble* (regard -60 or below), *Known face* (regard 20),
  *Vouched for* (regard 50 and owed 20).
* **Road Companion**, for someone who travels with Wessel: *Loyalty* (-100 to 100) and *Nerve* (0 to 100,
  starting at 50 and coming back toward it by 5 a day). Stages: *Wavering* (loyalty -30 or below) and
  *Shield-mate* (loyalty 60 and nerve 40).

**Map.** 54 places (Bluewatch and its nine spots, Auvoth and its wards, the Auvoth Depths, Shornmarch,
the Ledger and Grand Vein river towns, and the cities on the main corridors as far as Highmark
Capital and the Holy City) and 63 routes with km. Inside Bluewatch and Auvoth the routes are walking
times in hours. These are only the places within about 700 km by route from Bluewatch, plus the
major corridor cities. The full map stays in the Map lorebook and `Ersveil_Routes.json`.

**The after-reply extractor (Assist).** Leave it **off** for Gemini, GLM and Kimi: large models
follow the `<Changes>` instruction well enough, and the extractor costs a second call per reply. Turn it **on** for
smaller local models such as Gemma if you see replies where something clearly changed (an item
picked up, coin paid, a place left) but no `<Changes>` lines came with it.

## 8. Currency: the lore's coins, counted in copper

The lore names three coins: copper (also called bronze), silver and gold, 1 gold = 10 silver = 100
copper. Since pack 1.4.0 the pack names the same coins (MODULES §F108):
`currency: { "name": "copper", "coins": [copper 1, bronze 1, silver 10, gold 100] }`. The wallet counts
copper; every item value, shop price, reward and the starting purse is a whole number of copper (the
old "marks" were copper, so no number changed). The model is told the coins, may write `+ coin 3 silver`
(30 copper), and amounts show as "3 silver 5 copper".

The lorebook's **"[CORE] Currency"** entry needs no change: it already speaks of copper, silver and
gold. (Before 1.4.0 this section gave a one-coin "mark" replacement for it; if you pasted that in, put the
original entry back, or keep it and set Story Block's **Coins** to `mark: 1`.)

### The value scale

The pack keeps the lore's prices for everyday goods, gear and loot, read in copper: coarse bread 2, a hot
meal 8, rope 40, a spear 150, a gambeson 600, a wolf pelt 30, a Soul Class I core 50. The F-rank jobs pay
50 to 400 copper (the pack's `ranks`), a few days of a guard's pay.

**Potions are the exception.** The lore asks 1 to 60 gold for them (a minor healing potion 10-30 gold,
1,000-3,000 copper), so one draught would cost five to forty F jobs. Shops, loot and Story Director's rewards
would never line up with that. The pack prices the consumables a fight uses on the play scale instead: each
one costs no more than the poorest F job, keeping the lore's order.

| Item | Lore price | Pack value | Bluewatch price |
|---|---|---|---|
| Healing Salve | 1-3 gold | 12 copper | 18 |
| Common Antidote | 6-20 gold | 24 copper | 36 |
| Minor Healing Draught | 10-30 gold | 30 copper | 45 |
| Mana Draught | 20-60 gold | 50 copper | — |

The Granary Rats job (50 copper) buys one draught at the frontier price, and the wolf hunt (200 copper) four.
If you want the lore's rare, costly healing in the story, leave the potion line of the World lorebook as it
is: the narration keeps the price talk, and the code uses the play scale. PACKS.md's
[value guide](PACKS.md#value-guide) gives the rules for pack makers.

The pack sets the money scale to **8** (`economy: { scale: 8 }`, MODULES §F104): copper is small coin, about
8 copper to a gold of the built-in defaults. Its F jobs top out at 400 copper where the built-in F rank tops
out at 50. The scale multiplies only the built-in defaults: RPG Battle's default loot coin, Story Director's
default rewards, and Story Block's fallback coin budget of 1000 × level. The pack's own ranks, item values and
shop prices stay exactly as written. With these ranks the story coin budget per reply still comes from the
player character's rank (400 copper at F). Change the scale in Story Block's settings (**Money scale**) if
the built-in defaults feel too rich or too poor in copper.

About 35 other World lore entries give prices in copper, silver and gold (the Prices and Wages
entries, the Guild, mana stones and cores, slavery, the mercenary companies…). They need no change: the
pack's coins are the same, and "3 silver" in a money line is read as 30 copper.

## 9. What this pack made up

The lore and the first message give most of the pack. These small mechanical gaps were filled in
here; change them freely.

* **The Guild office and Fenna.** The lore gives Bluewatch no Guild hall. The pack adds a one-room
  Guild Office beside the Watchhouse, with **Fenna** as its clerk. Fenna and the three jobs come
  from your earlier Bluewatch play: Story Director's tests and changelog record "Granary Rats — kill
  6 cellar rats, 5 silver" and "EastBluffWolves — hunt the starved crag wolf pack, giver Fenna,
  claimed 2 gold".
* **Job numbers.** Granary Rats: 6 cellar rats, 50 copper (from that play). East Bluff Wolves:
  200 copper (from that play), the count of **4** wolves is new. Culvert Leeches is new: 8 sluice
  leeches, 120 copper, due Goldwane 14 at dusk.
* **Places inside Bluewatch.** The lore names the Watchhouse and signal tower, the inspection quay,
  the storehouses, the Stray Oar and the salt-and-ash yard. The Guild Office, Watch Granary, Gate
  Forge, North Culvert and East Bluff are new, and so are the coordinates of all nine spots (a few
  hundred metres around `[64, 110]`; the bluff about 2.5 km east). Auvoth's wards sit at the lore's
  km offsets from Auvoth. Walking times inside a settlement assume about 4 km an hour.
* **Place kinds** (city, town, fort, lock town, depot…) are read from the map lore's descriptions.
* **Shops.** The names Watch Stores, Salt-and-Ash Dispensary and Gate Forge are new, and so are the
  keepers' roles and the stock counts. Prices are the lore's Northern Belt prices in copper. Imported
  pieces (a backpack, healing salve, minor healing draughts, antidotes) cost half again as much at the
  frontier, as the lore's currency rule says.
* **Item numbers.** The Cane-Blade (ATK +4) and the coat (DEF +1) are from the kit. Their values
  (600 and 60 copper) are new, and so are the other gear stats, the Leech-salt Pouch (damage 6), and
  the healing amounts (minor draught 20, salve 10).
* **Potion values** are on the play scale, not the lore's (see [§8](#the-value-scale)): salve 12, antidote
  24, minor healing draught 30, mana draught 50 copper.
* **Crafting.** Bluecap Moss (a pale moss off the culvert stones, 4 copper) and Iron Filings (2 copper) are
  new; Cleansing Spirits are the lore's (5-15 copper, 8 copper). The four new recipes (Camp Stew, Healing
  Salve, Minor Healing Draught, Completion Salts), every recipe's craft, DC, station and teacher, the
  fieldcraft craft and Ersveil alchemy's INT+DEX are the pack's.
* **Meter presets.** Frontier Regard and Road Companion, their meters, words and stages are new; they
  follow the lore's tone (strangers are suspected, nothing is free, nerve wears down).
* **Creatures.** Starved Crag Wolf, Crag Wolf Matriarch, Cellar Rat Swarm and Sluice Leech are local
  variants of the lore's wolves, plague rats and giant leeches (Soul Class I). The River Drake is from
  the lore (Soul Class II), and the Salt-crew Tough stands for Brecht's smugglers from the first
  message. Levels, traits, moves and loot chances are new.
* **Races.** The lore lists ten peoples and doesn't say which ones are playable. The pack offers the
  seven who live in bodies of ordinary size among people (Human, Elf, Dwarf, Halfling, Beastfolk,
  Orc, Goblin). It leaves out spiritfolk (no separate body), fairies (10-20 cm tall) and the Sea Folk
  (rarely above water). Human changes no stat, so the kit's stats come out as written. Each other
  people moves one stat up and one down by 1.
* **Talents.** Shadow-bent and River-born come from the persona; Hulkrow-raised, Hidden Draw,
  Inward Bent and Frontier Tracker come from the lore. Each costs 1 point (Inward Bent 2).
* **Events** and the Watch-Captain's 20-copper thanks are new.
* **Wages.** The first message says eighteen days at twenty a day (360 copper). The old hidden
  Director block said "3 silver 6 copper" (36). The pack pays no wages: Marrit's pay stays the
  story's hook.
* **Burlap sacks** are sold at the Watch Stores and used in the Leech-salt Pouch. They aren't in
  Wessel's kit, because the kit file doesn't list them.

## 10. Pack format additions (for pack makers)

The pack uses five content kinds and one top-level field that were added for it.
[PACKS.md](PACKS.md) describes the rest of the format.

| Kind | Fields |
|---|---|
| `places` | `{ name, slug?, aliases?, region?, kind?, layer?, x, y, note? }`: `x`, `y` are numbers (map units; Ersveil: x east, y north, 1 unit = 10 km); `layer` is a plane such as `underground` ('' on the surface). |
| `routes` | `{ from, to, kind, km?, hours?, corridor?, slug?, note? }`: `from` and `to` name places of the same pack (by name, alias or slug) and are kept as their names; `km` and `hours` are numbers above 0. The id is made from from, to and kind unless a `slug` is given. |
| `skills` | RPG Battle skill templates `{ name, slug?, type?, stat?, target?, element?, note?, tags? }`: type `physical`, `magic`, `heal`, `buff` or `debuff`; target `one`, `all`, `self`, `ally` or `allies`. No numbers: RPG Battle's rules set them. |
| `presets` | Ready-made characters `{ id?, name, note?, race?, talents?, points?, skills? }`: `race`, `talents` and `skills` name this pack's records (kept as full ids); `points` are the stat points spent on top of race and talents (`{ "DEX": 3 }`, whole numbers ≥ 0). |
| top-level `calendar` | `{ era?, months: [{ name, days }], start?: { year, month, day, hour?, minute? } }`: `start.month` is a name or a number (1 = the first month) and is kept as the name. Problems are `BAD_CALENDAR`. |

Queries: `packs.content({ kind: 'places' | 'routes' | 'skills' | 'presets' })` like every kind, and
`packs.calendar` → `{ pack, era, months, start }` from the first enabled pack with a calendar, or
null. A pack without these kinds normalizes exactly as before.
