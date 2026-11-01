# Playing v2 in Ersveil

This page sets up a v2 chat in the Ersveil world with the **Ersveil example pack 2.3.0, the open world**
([`examples/packs/ersveil/pack.json`](../../examples/packs/ersveil/pack.json)) and its lorebook
([`examples/packs/ersveil/ersveil-lore.json`](../../examples/packs/ersveil/ersveil-lore.json)). A new
story begins in Bluewatch Village, at the Adventurer Guild office, with four silver.

The pack holds the world's structure: the map (320 places, 350 routes), the calendar, 84 weather tables,
136 world events (a hidden history from CY 611 onward), the coins, the start, four data modules and an RPG skill set. It has **no items, shops, prices, foes,
jobs, classes or rules**: the narrator makes those up in the story from the lore, and Story Block keeps
what the story hands out (the bag, the purse, the place). The lorebook holds what only the narrator uses.

The pack works with Story Block and Story Director (2.3.0 or newer: the world events record lasting changes in its chronicle). NPC State Delta is optional.

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

1. Story Suite settings → **Tabs & Packs** → **Packs** → **Import pack file** → `examples/packs/ersveil/pack.json`.
   The message says "Installed Ersveil (open world)." and the list shows "136 events, 320 places, 350 routes,
   1 skill set, 2 cast members, start state, 4 coins, a calendar, 84 weather tables". The 4 data modules are not in that line; they
   stay off until you enable them (§5). Without Story Director 2.3.0 the pack is refused: it needs the
   `chronicle-lasting` capability.
2. Switch off any other pack with a start state or a currency (for example `riverside-starter`).
3. Start a **new chat**. A chat takes the pack it begins with and keeps that copy.

Importing 2.3.0 replaces an installed pack with the same id. Start a new chat to use its starting state.
2.3.0 adds two sample cast entries, Fenna the ferrywoman and Sera the river scout (`content.cast`, see PACKS.md "The cast"); a Story Block that knows the cast kind (after 2.14) reads them, and Story Director's cast brings them into a story. 2.2.1 (needs Story Block 2.10) adds the Guild rank line; 2.2.0 added the world's hidden history (§6), the Court favour module (§5), the Sealwarden recruit skill set for the RPG,
and 56 notable people to the lorebook. Re-import the lorebook too.
2.1.0 changes only lore and names: Auvoth is the Guild's city, its Depths sealed by Veyr the Unbound in CY 384; the Guild Grand Hall ward is Sealcrown (was Delver's Crown) and Rimeglass Delve is the Rimeglass Galleries. The old names stay as aliases, so a chat already at one of those places still finds it, and the data modules are unchanged. Re-import the lorebook too.

## 3. Import the lorebook

* SillyTavern → World Info → **Import World Info** → `examples/packs/ersveil/ersveil-lore.json`, a book
  named **Ersveil Lore** with 227 entries. Make it active for the chat (attach it to the narrator card or
  set it as a global book).
* It is lore, not rules: Soul Class, the Guild letters F to S (with what a contract of each pays), the ten
  peoples, the thirteen callings, prices and wages, the bestiary, factions and places, and 56 notable people
  (rulers, champions, saints, famous adventurers), each told to the narrator only when named. The people
  are as they stand when the story starts; what happens to them later comes from the story and its events, which
  win over the lorebook. Edit it freely; no code reads it.

## 4. Narrator card and first message

* **Character card:** a narrator card, for example `Ersveil` with "{{char}} narrates Ersveil and plays
  every person in it except {{user}}."
* **Persona:** your own character; their people, calling and Soul Class are what you write.
* **First message:** your own opening at Bluewatch Village, at the Guild office.

## 5. The four data modules

None is on by default. Story Suite settings → **Tabs & Packs** → **Data modules**, find the module and
press **Enable for this chat**.

| Module | What it keeps |
|---|---|
| Standing with the powers | Your standing, -100 to 100, with each of ten powers (kinds `gain` and `loss`). Screen: Standing. |
| Fame by region | How well known you are, 0 to 100, in each of sixteen regions (kinds `deed` and `spread`). Screen: Fame. |
| Adventurer Guild membership | Registration, your letter (F to S), dues and years as a member (kinds `register`, `dues`, `contract`, `promote`, `yearend`). Screen: Guild. |
| Court favour | How much favour each claimant to Highmark's throne holds at court, 0 to 100 (kinds `back` and `undermine`, small or great). The narrator moves it only when your own deeds clearly help or hurt a claimant. No screen: it is the story's to keep, and the world's events read it when the throne is decided. Without it the throne goes as the law expects. |

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
  chronicle (World → News and the Journal); the big ongoing ones (a new reign, Auvoth under the Tide, the Tide held at the Last Wall) are kept in mind on every reply. What you do can change who
  wins Highmark's throne (with Court favour on), and the throne changes what follows. Nothing in this page or the
  lorebook spoils it. **Settings → Diagnostics → Events** lists every event, and does spoil it.
* **RPG.** With the RPG on (Settings → RPG), the New character window offers the pack's **Sealwarden recruit** skill
  set: Gate spear, Ward-reading, Lamp-keeping, Breach drill and Gate challenge.

## 7. Updating the pack

Import the new file (same id `ersveil`: it replaces the old one and keeps its switch), then start a new
chat. Changing values in the pack: keep this page, `tests/v2/packs/ersveil-pack.test.js`,
`tests/v2/packs/ersveil-timeline.test.js` and the pack's version in step.
