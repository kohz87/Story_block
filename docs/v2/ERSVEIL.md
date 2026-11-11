# Playing v2 in Ersveil

This page sets up a v2 chat in the Ersveil world with the **Ersveil example pack 2.9.5, the open world**
([`examples/packs/ersveil/pack.json`](../../examples/packs/ersveil/pack.json)) and its lorebook
([`examples/packs/ersveil/ersveil-lore.json`](../../examples/packs/ersveil/ersveil-lore.json)). A new
story begins in Bluewatch Village, at the Adventurer Guild office, with four silver.

The pack holds the world's structure: the map (320 places, 350 routes), the calendar, 84 weather tables,
136 world events (a hidden history from CY 611 onward), the coins, the start, three data modules, signature gear and an RPG skill set. It has **no shops, prices, foes,
jobs, classes or rules**: the narrator makes those up in the story from the lore, and Story Block keeps
what the story hands out (the bag, the purse, the place). The lorebook holds what only the narrator uses.

The pack needs Story Block 2.31.0 or newer and Story Director with the `chronicle-lasting` capability. NPC State Delta is optional. The names suggestions require a Director release that includes its names part.

## 1. Extensions

Install Story Block and Story Director (SillyTavern → Extensions → Install extension: paste the URL).
NPC State Delta is optional. If you have the v1 versions installed, remove them first or use a separate
SillyTavern profile.

| Extension | URL |
|---|---|
| Story Block (the host) | https://github.com/kohz87/Story_block |
| Story Director | https://github.com/kohz87/Story_director |
| NPC State Delta (optional) | https://github.com/kohz87/npc_state_delta |

## 2. Import the pack

1. Story Suite settings → **Tabs & Packs** → **Packs** → **Import pack file** → `examples/packs/ersveil.zip`. This is the one-step way:
   it holds `pack.json` and the twelve portraits ("12 portraits saved"). Picking `pack.json` alone imports no pictures.
   The message says "Installed Ersveil (open world)." and the list shows "16 items, 136 events, 320 places, 350 routes,
   1 skill set, 12 cast members, 14 name lists, start state, 4 coins, a calendar, 84 weather tables". The 3 data modules are not in that line; they
   stay off until you enable them (§5). Without Story Director 2.3.0 the pack is refused: it needs the
   `chronicle-lasting` capability.
2. Switch off any other pack with a start state or a currency (for example `riverside-starter`).
3. Start a **new chat**. A chat takes the pack it begins with and keeps that copy.

2.9.5 (content only, with the throne following your deeds) adds `content.names`: given names (30 to 45) and family names (20 to 27) for fourteen peoples and regions (Highmark, the River Confederacy and Shornmarch, the Flame Lands, the Border and Valegard, the Frostbound, the dwarves, the Chieftainates, Ardelia, the Emerald Coast, the Tidebound, Atlantis, the Verdantleaf elves, the Fairy Court and Ashkar), written in the sound of Names: Human Cultures and Names: Other Peoples and sharing no name with the cast or the lorebook's examples, and a short banned list of overused fantasy names. A Story Director release with its names part can offer them for new people met in a matching region. The pack requires Story Block 2.31.0 or newer, so an older host refuses the whole pack on its version check.
2.9.5 restores the throne branches. Director's Ripples can score matching completed quests and victories against the named groups; Ersveil has no directed world events or claimant standing, and NPC trust is not scored. When Ripples is absent or cannot safely identify Ersveil's table, Hasse is broken and Wendhild is crowned over Corvin. A chat already crowned keeps its reign. A decision is kept as it was while the story before it is unchanged, even when the scoring later changes (a Director update, a swipe or delete of a later reply, a Re-read after the crown); only changing an earlier deed or reply reselects it at that point in the story. Version 2.9.3 removed Court favour; chats that enabled it keep the block and its values.
2.9.4 shows the Adventurer Guild card as tiles (Rank, Standing, Dues); a chat that pinned the old guild screen offers Migrate.
2.9.3 removed the Court favour data module; a chat that had enabled it keeps its block.
2.9.2 (content only) makes every cast look physical features only (the kind word and the height first; no age, no "looks about N", no impressions that are not physical), names no real-world breed or brand (Temiwa is a "Dogfolk woman"), puts the age in `fields.People` for all twelve ("Dogfolk woman, 21", "Dwelf, 58 (looks about 25)"), and cuts each personality to its core (at most 320 characters; what a behaviour lever or a mannerism says is not repeated). Temiwa's look, personality and Presentation lever were approved by the owner.
2.9.1 (content only) turns four "with you" lines into first-meeting stances (Temiwa, Ysmeth, Nysseth, Harrak; Nysseth's last stage milestone starts "she has chosen you") and writes each cast member's height ("about N cm") into the look right after the kind and age.
2.8.0 gave each of the twelve exactly two signature skills, makes Sister Temiwa a dogfolk healer (Lv 4, a shy dandere with waterfall black hair, soft and weary, no cruelty or possessiveness), makes Nerissa deredere and Nysseth yandere, and sets Rika to Lv 8 and Torka to Lv 6; 2.9.0 sets each skill's `type` (utility: Gentle Word, Silver Patter, Toast and Tell, Pilot's Hand, Flower-Speech, Quiet Step, Lockwork, Chain Cell Craft, Silver Rain Veil, Mother's Hand; every other skill combat, Mending Prayer the combat heal), gives the new Binding Rune the rank of Lockwork (expert), Flower-Speech that of Quiet Step (adept) and Dirty Trick that of Silver Patter (adept), adds Temiwa's stockings with garters and buckled belt, and gives her a new portrait (800×1200). It needs Story Block 2.28.0 (`requires.storyBlock` ^2.28.0), the release that carries pack skill types.
2.7.0 lays Standing, Fame, Guild and Court favour out as sections of one Reputation tab and needs Story Block 2.22.0 (a running chat moves by migrating the four modules: see "Moving a running chat to 2.7.0" below).
2.6.1 trims the always-on lore and makes Classification, Currency, Naming and Knowledge keyword entries (the story sends them when the topic comes up).
2.6.0 adds sixteen signature items (each cast member's own gear, given and bound to them when they join the party while Gear in fights is on) and needs Story Block 2.18.0.
2.5.0 adds the guild rank bands and the guild letter as the party's rank (§6, Ranks), turns the cast's Soul Class field into Level (each of the twelve set by role, 8 to 56), and needs Story Block 2.17.0.
2.4.0 replaced the two sample cast entries with twelve people (§6, "The twelve"), each with a portrait; import `examples/packs/ersveil.zip` (`pack.json` and `portraits/`; rebuild it with `node scripts/build-example-zip.mjs`) or pick `pack.json` and the twelve `.webp` files together; `pack.json` alone leaves the portraits unset. 2.3.0 added the cast kind (`content.cast`, see PACKS.md "The cast"); a Story Block that knows it (after 2.14) reads the people, and Story Director's cast brings them into a story. 2.2.1 (needs Story Block 2.10) adds the Guild rank line; 2.2.0 added the world's hidden history (§6), the Court favour module (§5), the Sealwarden recruit skill set for the RPG,
and 56 notable people to the lorebook. Re-import the lorebook too.
2.1.0 changes only lore and names: Auvoth is the Guild's city, its Depths sealed by Veyr the Unbound in CY 384; the Guild Grand Hall ward is Sealcrown (was Delver's Crown) and Rimeglass Delve is the Rimeglass Galleries. The old names stay as aliases, so a chat already at one of those places still finds it, and the data modules are unchanged. Re-import the lorebook too.

Importing 2.9.5 replaces an installed pack with the same id. Start a new chat to use its starting state.

## 3. Import the lorebook

* SillyTavern → World Info → **Import World Info** → `examples/packs/ersveil/ersveil-lore.json`, a book
  named **Ersveil Lore** with 227 entries. Make it active for the chat (attach it to the narrator card or
  set it as a global book).
* It is lore, not rules: levels, the Guild letters F to S (with what a contract of each pays), the ten
  peoples, the thirteen callings, prices and wages, the bestiary, factions and places, and 56 notable people
  (rulers, champions, saints, famous adventurers), each told to the narrator only when named. The people
  are as they stand when the story starts; what happens to them later comes from the story and its events, which
  win over the lorebook. Edit it freely; no code reads it.

## 4. Narrator card and first message

* **Character card:** a narrator card, for example `Ersveil` with "{{char}} narrates Ersveil and plays
  every person in it except {{user}}."
* **Persona:** your own character; their people, calling and level are what you write. The RPG starts you at level 1 unless you set a starting level.
* **First message:** your own opening at Bluewatch Village, at the Guild office.

## 5. The three data modules

None is on by default. Story Suite settings → **Tabs & Packs** → **Data modules**, find the module and
press **Enable for this chat**.

| Module | What it keeps |
|---|---|
| Standing with the powers | Your standing, -100 to 100, with each of ten powers (kinds `gain` and `loss`). Section: Standing with the powers (Reputation tab). |
| Fame by region | How well known you are, 0 to 100, in each of sixteen regions (kinds `deed` and `spread`). Section: Fame by region (Reputation tab). |
| Adventurer Guild membership | Registration, your letter (F to S), dues and years as a member (kinds `register`, `dues`, `contract`, `promote`, `yearend`). Section: Adventurer Guild (Reputation tab). |

Once a module is enabled the narrator is told its `dm …` lines; a refused line changes nothing. See
[DATA_MODULES.md](DATA_MODULES.md).

## 6. Playing

* **Start.** Bluewatch Village / Guild Office, with **40 copper** (shown as "4 silver") and an empty bag:
  the pack has no items, so the story gives your kit (`+ item Bedroll`, `+ item Knife`).
* **Clock.** The Compact Year: era `CY`, twelve months of 30 days, starting **CY 611, Goldwane 12, 06:40**.
  Story Director reads it (`packs.calendar`); the first reply shows the date. The time-based events wait
  until the story clock is set.
* **Coins.** Copper (1, also called bronze), silver (10) and gold (100). The wallet counts copper and the
  narrator may write `+ coin 3 silver`. Prices are the story's, from the lore's wages and prices; there is
  no money scale. The story decides what a reply pays.
* **Items, shops and foes** are made in the story: `+ item Rope | qty: 1`, `- item Rope`, a merchant the
  narrator names, a beast from the lore's bestiary. Code still counts the bag and the purse.
* **Map.** Story Director's Map and Region list show the 320 places; the story moves you with
  `~ place Bluewatch Village`. Places are kept as their names, routes give the distances.
* **Events.** The world has a hidden history from CY 611 onward: floods out of the north, politics, war and the
  underworld, on their own dates whether or not you are there. When something happens where you are, the narrator
  gets the scene; elsewhere, word reaches you days or weeks later as news. Lasting changes go into Story Director's
  chronicle (World → News and the Journal); the big ongoing ones (a new reign, Auvoth under the Tide, the Tide held at the Last Wall) are kept in mind on every reply. Highmark's throne follows the available claimant sway or the fallback,
  and the throne changes what follows. Nothing in this page or the
  lorebook spoils it. **Settings → Diagnostics → Events** lists every event, and does spoil it.
* **RPG.** With the RPG on (Settings → RPG), the New character window offers the pack's **Sealwarden recruit** skill
  set: Gate spear, Ward-reading, Lamp-keeping, Breach drill and Gate challenge.
* **Ranks.** The pack's rank bands name a foe's level band: F for levels 1 to 9, E 10 to 19, D 20 to 29, C 30 to 39, B 40 to 49, A 50 to 59, S 60 to 69, SS 70 to 79 and SSS 80 to 99. A foe reads "Rank F · Lv 7". Your guild letter (§5, Adventurer Guild membership) shows beside your level once you are registered ("Lv 14 · Guild F"; "Lv 14" alone before that). The level cap is 99 (`rpg.levelCap`).

### The twelve

`content.cast` holds twelve people, each met by place or because what they want pulls them to the party. What each one hides
opens as Trust or Affection grows or when the story reaches it; none of it is told before.

| Person | Where they begin | One line |
|---|---|---|
| Sister Temiwa | Bluewatch Village | A dogfolk saintess candidate exiled to the frontier, a shy, soft, weary, dryly sarcastic healer who keeps the dead at rest. |
| Ysmeth | Shackles City / Chainmarket | A dwelf rune-collar artificer held by the Grey Ledger, cold, exact and planning every exit. |
| Nysseth | Shackles City / Knifeglass Alley | A soft-spoken, sweet, obsessively devoted elf who runs a Broken Chain cell from a knife-grinder's stall and teaches by asking what you missed. |
| Rika | Auvoth / Pale Market | A white-haired barge-girl mage with huge, unrefined power who cannot read and will not say so. |
| Harrak | Varnhold Watch | The orc captain of the Long Watch, old and tired, who sings while he fights. |
| Torka | Bluewatch Village | A loud, hot-blooded young orc berserker hunting the Wildzone for a deed-name. |
| Sir Lothar | Highmark Capital | A gentle, poetic Iron Guard knight sworn to Princess Wendhild. |
| Gorm Kettlebright | Highmark Capital | Ardelia's jolly, hugging envoy, who plays the fool because fools hear everything. |
| Nerissa | Abysswatch | A sunny, clingy-sweet, still prankish Atlantean pilot of the privateer Gannet, called a deserter by her own people. |
| Hush | Vargate | A spirit of silver rain who lights the night lamps and guides the lost. |
| Asphodel | Corrowen | A calm, watchful stranger who sells secrets in the harbor taverns. |
| Barney Thimblewick | Thousand Sails | A halfling barge gambler and con man, the cast's grandfather figure (not a romance). |

Starting levels (rank band): Temiwa 4 (F), Torka 6 (F), Rika 8 (F), Barney 14 (E), Gorm 22 and Nerissa 24 (D), Asphodel 30, Lothar 32 and Ysmeth 36 (C), Nysseth 44 and Hush 48 (B), Harrak 56 (A).

The eleven who can be romanced use NPC State Delta's companion meters (Trust, Affection, Desire, Tension); Barney uses the mentor's, with no Desire. Everyone starts at 0 on every meter: a relationship is built in play, not given at the first meeting.

### Signature gear

`content.items` holds sixteen pieces of equipment the cast are known for, each worn from the owner's `wears` text. Their numbers follow
Story Block's gear rules (`story-block.gear`, GEAR.md): the stats stay inside the budget of the rarity (common 1, uncommon 2, rare 3, epic 4,
legendary 5; the listed numbers were set at the older, lower budgets and are kept, so they use less than the whole) and a piece raises two stats at most. Fang Charm lists none: the slot's pick gives its one point.

| Item | Owner | Slot | Rarity | Stats |
|---|---|---|---|---|
| Long Watch Great Axe | Harrak | weapon | legendary | STR +2, VIT +2 |
| White-Fur Watch Cloak | Harrak | cloak | rare | VIT +2 |
| Carved Beacon-Horn | Harrak | accessory | uncommon | CHA +1 |
| Rain-Veil Hood | Hush | cloak | epic | AGI +2, LUK +1 |
| Cell-Runner's Knives | Nysseth | weapon | epic | DEX +2, AGI +1 |
| Rune-Collar Hammer | Ysmeth | weapon | rare | STR +1, INT +1 |
| Iron Guard Plate | Sir Lothar | body | rare | VIT +2 |
| Iron Guard Longsword | Sir Lothar | weapon | rare | STR +1, DEX +1 |
| Gold-Thread Hooded Cloak | Asphodel | cloak | rare | CHA +1, AGI +1 |
| Rune-Marked Dwarven War-Hammer | Gorm Kettlebright | weapon | rare | STR +1, VIT +1 |
| Atlantean Breathing Sheath | Nerissa | accessory | rare | VIT +1, AGI +1 |
| Huge Spiked Iron Maul | Torka | weapon | uncommon | STR +1 |
| Fang Charm | Torka | accessory | common | none |
| Startrace Travelling Coat | Rika | body | uncommon | INT +1 |
| Three Walnut Shells | Barney Thimblewick | accessory | uncommon | LUK +1 |
| Flame-Cross Pendant | Sister Temiwa | accessory | uncommon | CHA +1 |

## 7. Updating the pack

Import the new file (same id `ersveil`: it replaces the old one and keeps its switch), then start a new
chat. Changing values in the pack: keep this page, `tests/v2/packs/ersveil-pack.test.js`,
`tests/v2/packs/ersveil-timeline.test.js` and the pack's version in step.

### Moving a running chat to 2.7.0 (Reputation tab)

Ersveil 2.7.0 lays Standing, Fame, Guild and Court favour out as sections of one Reputation tab and needs Story Block 2.22.0. A chat that is
already running keeps its old modules and keeps working: nothing changes until you choose to migrate. To take the new layout in a running chat,
migrate each of the four modules, one at a time:

1. Import the 2.7.0 file (Settings → Tabs & Packs → Packs). The four modules show "Migration available".
2. Open Settings → Tabs & Packs → Data modules.
3. For each of Standing, Fame, Adventurer Guild membership and Court favour: **Migrate**, read the preview, then confirm. That is four times (two clicks each).

A migration changes only how the module is drawn; its values stay as they are, and it is saved with the latest reply (a swipe or a delete of that
reply takes it back). A new chat starts on 2.7.0 with nothing to migrate.
