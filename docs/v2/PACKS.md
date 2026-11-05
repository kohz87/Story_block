# Packs

A pack is a JSON file containing world data. It can provide places, routes, a calendar, weather, events, currency, starting state, screens and data modules. The [Ersveil open-world example](../../examples/packs/ersveil/pack.json) shows a larger pack; [Ersveil](ERSVEIL.md) describes how to play it.

A pack can give your character a **rank** with `"content": { "you": { "rank": { "label": "Guild rank" } } }` (the label is 1 to 30 plain characters). Only a story with such a pack has a Rank in Your look: Home shows it first under the label ("Guild rank"), Story Director's Status card has a row for it, and the narrator is told to write `~ you rank: …`. The first enabled pack that declares it wins. With no such pack there is no rank anywhere and `~ you rank:` is not used; a rank already kept stays and returns when the pack is on again. The Ersveil example uses "Guild rank".

Import a file under **Settings → Tabs & Packs → Import pack file**. A pack with an existing id replaces that installed pack. Start a new chat to use its starting state.

For the format and limits, see the [authoring-kit reference](../../authoring-kit/reference/PACK-FORMAT.md) and [limits](../../authoring-kit/reference/LIMITS.md). [Data modules](DATA_MODULES.md) covers their definitions and examples. The authoring kit's checker uses Story Block's own pack validation.

Rules packs for RPG Battle cannot be imported. Keep existing RPG Battle chats on the previous versions.

## The cast

`content.cast` lists the people of a world, written by hand. Each is a prepared person who starts somewhere with a goal and a routine and lives off-screen; Story Director brings them into the story by place and routine, or because their goal pulls them to the party, and NPC State Delta makes their dossier from the entry at the first meeting. Until then the reader sees nothing of them. Nameless extras stay the story's to invent. The Ersveil example has twelve (docs/v2/ERSVEIL.md, "The twelve"); the JSON below is a made-up one.

```json
{ "id": "fenna", "name": "Fenna", "aliases": ["the ferrywoman"],
  "about": "Runs the night ferry between Bluewatch and Ashford.",
  "look": "Late thirties, wiry, black hair tied back.",
  "wears": "A tar-stained coat.",
  "voice": "Dry and unhurried.", "personality": "Patient, watchful.", "history": "Lost her husband to the weir in 598.",
  "portrait": "fenna.webp",
  "start": { "place": "Bluewatch docks", "goal": "Find out who opened the weir.", "routine": "Works the night ferry from dusk." },
  "drawnTo": ["the weir", "a flood on the river"],
  "meters": { "preset": "companion", "trust": 10 },
  "stages": [{ "id": "regular", "name": "Regular passenger", "needs": [{ "meter": "trust", "at": 20 }] }],
  "fields": { "Trade": "Night ferry" },
  "secrets": [
    { "title": "Her husband's debt", "text": "He owed the smugglers.", "meter": "trust", "at": 20 },
    { "title": "Who she suspects", "text": "She has a name, but no proof.", "when": "the party learns who opened the weir" } ],
  "canDieUnmet": false }
```

- Required: `id` (lowercase letters, digits and dashes, unique in the pack; the person's key is `pack:id`), `name`, `about`, `look`, and `start` with `place` and `goal`. Everything else is optional. `look` is the body only (species, age, build, face, hair, eyes, ears, tail, scars, permanent marks, bearing); `wears` (optional) is what they usually wear and carry: clothes, armour, jewellery, gear on them, and how they wear it. NPC State Delta's dossier puts `look` in the physical appearance and `wears` in the outfit. An older Story Block refuses `wears` as an unknown cast field.
- Text is plain and one line (line breaks become spaces); `< > { }` are refused everywhere and `|` in names, places, goals, routines and phrases. `aliases` (at most 8) and a name may not repeat another person's in the pack.
- `meters` is `{ "preset"?: id, "<meter>": whole number }`: starting values for NPC State Delta's meters (trust, affection, desire, tension; loyalty, respect, rivalry and approval, which NPC State Delta's built-in presets companion, rival and mentor add; a preset of the pack's own or the reader's; or ones listed here; `preset` is any preset id, checked by NPC State Delta, not here: this host checks only that it is a well-formed id). The built-in preset ids are exported as `CAST_BUILT_IN_PRESETS` (`packs/limits.js`: `companion`, `rival`, `mentor`), for an editor that offers them; a test pins the list against NPC State Delta's own, -1000 to 1000. `stages` have the shape of a meter preset's stages (`id`, `name`, `needs: [{ meter, at }]`, `milestone`; at most 8). `fields` are at most 6 short facts (name up to 40, value up to 60 characters).
- A secret has a `title` and `text` and opens by a meter reaching a value (`meter` and `at`, like a stage), by a story event (`when`, up to 120 characters), or by both, in which case it opens at the meter value or on the story event, whichever comes first; it needs at least one of the two; at most 8. The story never rewrites them.
- `drawnTo`: up to 6 short phrases for what pulls the person to the party. `canDieUnmet`: true lets the story kill them before the party has met them (otherwise only a reader's setting does).
- `gear`: up to 6 of this pack's items (slug or name) the person is known for, kept as the items' ids. Each must be equipment with a gear slot (weapon, body, off-hand, head, cloak, feet, accessory), one item to a slot (an accessory may take two); an unknown item, a non-equipment item, a slot clash, a repeat or more than six is refused with the entry and item named. It does nothing while `story-block.gear` is off. With it on, the person's `+ party` line (or the Ask card's Add to party) also gives them these items, owned by them and put on, as part of the join's one receipt; see GEAR.md "Signature gear".
- Limits (`packs/limits.js` `CAST_LIMITS`): 64 people per pack; about 300, look 600, wears 300, voice 300, personality 600, history 1,200 characters; place 80, goal and routine 200.

- `skills`: 1 to 8 signature skills, `[{ "name", "about", "stat", "uses", "rank" }]`; leave the key out for none (an empty list is refused). `name` 1 to 40 characters, `about` 1 to 120 (one line, no `< > { } |`), `stat` one of `str vit agi dex int luk cha` (required), `uses` `stamina` (default) or `mana`, `rank` `novice` (default), `adept`, `expert` or `master`. A name once for each person (case and spacing ignored); any other key is refused (`UNKNOWN_FIELD`); the entry and index are named. No rank cap by level: the author decides. With the RPG on, they are put in the person's skill slots **when they join**, as written and marked signature; see RPG.md "Signature skills".

`packs.castGear({ name })` gives the "Gear:" line for the narrator's cast entry (GEAR.md "Signature gear"). `packs.content({ kind: "cast" })` gives the enabled packs' people in pack order, each as above with `pack` (the pack's id) and `packVersion`, and with no `slug`. The pack list shows "n cast members".

### Portraits

`portrait` names an image file beside the pack. Pick `pack.json` and its images together in **Import pack file** (several files at once), or pick the pack as one `.zip` made by Story Studio (`pack.json` and a `portraits/` folder). Each image must be a WebP, PNG or JPEG of at most 10 MB, named by a cast entry; a pack names at most 32 different files. What is stored is at most 150 KB a picture (NPC State Delta keeps a copy per chat): an image of 150 KB or less is stored exactly as it came, byte for byte; a larger one is decoded in the browser, drawn with its long side at most 1200 px and saved as WebP, with the quality stepped down (then the size) until it is 150 KB or less. An image the browser cannot read, one that is still over 150 KB at the lowest step, one with more than 64 million pixels, one over 10 MB, the wrong type (checked from its first bytes, not its name), not named by the pack or empty is refused with a reason naming the file, and the rest of the import goes ahead. Importing a newer version replaces the portraits it brings; one not picked again stays while the pack still names it, and one the pack no longer names is removed. Removing the pack removes its portraits.

Portraits are kept outside settings, as SillyTavern user files (`user/files/storysuite-portrait-<pack>-<hash>.<ext>`; the hash makes a changed picture a new file, so no browser shows an old one). The pack is stored on the server, so its portraits are too, and follow it to every device; SillyTavern's Data Maid lists them as unused files, so do not delete them there. A portrait file that has gone missing shows as no portrait until the pack is imported with it again. A module reads one with the query `packs.portrait({ pack, file })`: a safe image URL (`/user/files/…`), or null when the pack is not installed, does not name the file, no picture was imported or the file is gone.

### In a character card

A card can carry a pack, its portraits and recommended settings in disabled lorebook entries tagged in their Title/Memo; Story Block offers them when a chat opens (BUILD-A-CARD.md, "Ship your whole world inside the card"). The formats (JSON, plain or in a ```json fence):

- `[storysuite:pack]`: the pack, as `pack.json`. Installed through the same checker and limits as an import (`source: lorebook`); an offer shows for a pack that is not installed or is a newer version than the installed one.
- `[storysuite:portraits]`: `{ "v": 1, "pack": "<id>", "version": "<version>", "files": { "<file>": "data:image/<webp|png|jpeg>;base64,…" } }`. `pack` and `version` must equal the pack's. At most 24 files, 200 KB each, 3 MB together (decoded); each name must be a portrait the pack's cast names and the bytes must be the picture type the address says. They go to the same portrait store as a zip import (so the 150 KB stored limit and the shrinking apply). A file that fails is skipped with a Diagnostics line; more than 24 files or more than 3 MB refuses the entry.
- `[storysuite:settings]`: `{ "v": 1, "settings": { "<owner>.<key>": value } }`, from the allow-list `story-block.rpg`, `story-block.gear`, `story-block.rpgXpRate` (50 to 300, steps of 25), `npc-state-delta.portraitPromptFormat`, `npc-state-delta.scanEvery`. Each owner checks its own values; an unknown key or a value that fails is skipped with a Diagnostics line.

In the Packs list, a pack of data modules and nothing else countable reads "N data modules".

### As a zip

A pack `.zip` holds `pack.json` at its top and the images in `portraits/`, nothing else: a file that is neither is refused and nothing is imported. Also refused, in plain words: encrypted, zip64 or multi-disk zips, a path with `..` (or starting with `/` or `\`), a zip over 322 MB (32 portraits of 10 MB and a pack), more than 322 MB unpacked, a file in it over 10 MB, a `pack.json` over 512 KB, a deflated file over 256 KB that unpacks to more than 100 times its packed size, or more than 40 entries. Stored and deflate are supported; the browser's own decompression unpacks them.
