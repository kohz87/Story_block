# Story Suite v2: pack format (pack.json)

A **pack** adds ready-made content to Story Suite: items with their numbers, creatures, shops,
crafting recipes, events, quests, a start state for new chats, screens, layouts and a theme. A pack is one
JSON file of plain data. Nothing in a pack runs as code. This page is the reference for people who
make packs; the contract behind it is [SPEC.md §9 and §13](SPEC.md) and [MODULES.md §E and §F](MODULES.md).

A complete small example is [`examples/packs/riverside-starter/pack.json`](../../examples/packs/riverside-starter/pack.json).

## Installing

* **From a file**: Story Suite settings → **Packs** → **Import pack file**.
* **From a character card**: put the pack JSON in a lorebook entry of the card and add
  `[storysuite:pack]` to the entry's title (the *Title/Memo* field), for example
  `Riverside [storysuite:pack]`. The JSON can be wrapped in a ```` ```json ```` fence. **Disable the
  entry** (or give it no keys) so SillyTavern never puts the JSON into a prompt; Story Suite reads
  disabled entries too. The reader then clicks **Read from character lorebook** in the Packs
  section. Nothing from a card is installed without that click. Story Suite reads the lorebook
  linked to the card, or the one embedded in the card if it was never imported.

Installed packs are a library shared by every chat (`extension_settings.storySuite.packs`). Each can
be switched off or removed. Installing a pack with an id that is already installed replaces it in
place (an update) and keeps its on/off switch.

What a pack gives a chat is copied into that chat when used: an item's definition when the story
first names it, and the start state when the chat begins. Switching a pack off later doesn't change
a story already told.

## The file

```json
{
  "id": "riverside-starter",
  "version": "1.0.0",
  "name": "Riverside Starter",
  "author": "You",
  "description": "A small river village to begin in.",
  "requires": { "storyBlock": "^2", "capabilities": ["inventory", "scene"] },
  "content": { "items": [], "creatures": [], "shops": [], "recipes": [], "events": [], "quests": [] },
  "start": { "scene": { … }, "inventory": { … } },
  "screens": [],
  "layouts": [],
  "theme": {}
}
```

| Field | Required | Rules |
|---|---|---|
| `id` | yes | 1–40 lowercase letters, digits or dashes, starting with a letter or digit. Unique among installed packs. |
| `version` | yes | Semantic version, like `1.0.0` or `1.1.0-beta.1`. |
| `name`, `author` | no | Text, at most 80 characters. `name` defaults to the id. |
| `description` | no | Text. |
| `requires.storyBlock` | yes | A version range: `^2`, `~2.1`, `2.x`, `>=2.0.0 <3`, `^1 \|\| ^2`. Story Block's alpha versions count as their release (2.0.0-alpha.3 counts as 2.0.0). |
| `requires.capabilities` | no | Names the pack needs, like `inventory`, `scene`, `party`, `combat`, `director`: a module id or a state area a module owns. If Story Block knows a name is missing, the pack is refused at install. If a module is switched off later, the list shows what is missing. |
| `content` | no | Lists of records by kind (below). No other kinds. |
| `start` | no | The start state (below). |
| `screens` | no | Screens the pack adds, or restyles by id (below). |
| `layouts` | no | A list of layout objects for the layouts renderer (MODULES §E *layouts*). They are checked here as safe plain data only. |
| `theme` | no | CSS custom properties (SPEC §13.3): `{ "--ss-accent": "#3f7f8f" }`. Names start with `--`; values are plain CSS values. |

Any other top-level field is refused, so a misspelled field doesn't get silently ignored.

## IDs and references

Every content record gets an ID `pack.<pack id>/<slug>`, for example
`pack.riverside-starter/willow-rod`. The slug is the record's `slug` field if given, otherwise made
from its name ("Iron Sword (old)" → `iron-sword-old`). Events use their `id` field as the slug. Two
records of the same kind can't share a slug.

Inside a pack, an item is referred to (in shop stock, recipes, the start) by its **slug** or its
**name** or alias from the same pack, or by a full def ID: `pack.other-pack/iron-sword` or
`story/rope`. References are stored as full IDs.

## Content kinds

### items

These are inventory definitions (SPEC §7). Only these fields are allowed:

| Field | Default | Rules |
|---|---|---|
| `name` | required | 1–80 characters. |
| `slug` | from name | Lowercase letters, digits, dashes. |
| `aliases` | `[]` | Other names the story may use ("trout" for "Moonveil Trout"). |
| `kind` | `goods` | `goods`, `material`, `consumable`, `equipment`, `quest`, `money`. |
| `rarity` | `common` | `common`, `uncommon`, `rare`, `epic`, `legendary`. |
| `value` | `0` | Whole number ≥ 0, in the smallest coin. |
| `stack` | `true` (`false` for equipment) | `false` keeps each piece as its own stack. Equipment never stacks. |
| `slot` | `null` | A short slot name (`weapon`, `tool` …) for equipment. |
| `stats` | `{}` | Names to whole numbers: `{ "STR": 2 }`. |
| `effect` | `{}` | An object, like `{ "heal": 20 }` (RPG Battle reads it). |
| `tags` | `[]` | Short words (`fish`, `fire`). |
| `note` | `""` | At most 500 characters. |

**When the story names an item**, Story Block looks it up in this order:
1. an item the chat already has (by name or alias);
2. the enabled packs, in list order: first a full ID (`pack.x/slug`), then a name or alias match
   (case-insensitive), then a slug match ("Willow-Rod" → `willow-rod`); the pack higher in the list
   wins when two packs define the same name;
3. otherwise a new story item `story/<slug>` with default numbers.

### creatures, quests

These are free-form records for RPG Battle's bestiary and Story Director's quests: a `name`
(required), an optional `slug`, and any other plain fields those modules read (see their docs).

### shops

`{ "name", "slug"?, "kind"?, "place"?, "stock": [ … ] }`, plus any other plain fields. Each
`stock` entry is an item reference, or `{ "item": ref, "qty"?: ≥1, "price"?: ≥0 }`.

### recipes

`{ "name", "slug"?, "makes": ref, "qty"?: ≥1 (default 1), "materials": [{ "item": ref, "qty"?: ≥1 }],
"fee"?: ≥0, "minutes"?: ≥0 }`, plus any other plain fields. `materials` can't be empty.

### events

```json
{ "id": "rat-trouble", "after": "market-day", "when": "query('scene.place').name == 'Bluewatch Village'",
  "cue": "Hollis grumbles that weir rats have been at his nets again.", "once": true,
  "then": [{ "command": "wallet.receive", "payload": { "owner": "party", "amount": 5 } }] }
```

| Field | Rules |
|---|---|
| `id` | Required slug, unique in the pack. |
| `when` | The condition, 1–500 characters, in the events condition language (MODULES §E *events*). |
| `cue` | What the next reply is told when the event fires, 1–1000 characters. |
| `once` | `true` (default) or `false`. |
| `after` | Optional id of another event in this pack that has to fire first. Loops are refused. |
| `then` | Up to 20 `{ "command": "module.action", "payload": { … } }` steps run as commands. |

Only these fields are allowed. Whether a command exists, and what its payload means, is checked
when the event runs.

## Start state

When a new chat begins, the enabled packs' start states are merged into the initial state:

```json
"start": {
  "scene": { "place": { "name": "Bluewatch Village", "kind": "settlement", "region": "the Lowmere" },
             "present": ["Hollis"] },
  "inventory": { "items": ["willow-rod", { "item": "Hemp Line", "qty": 3, "note": "spare" }],
                 "money": 50 }
}
```

* `scene.place`: `name` (required), `kind`, `region`. The first enabled pack with a place sets it.
* `scene.present`: names. Every name is listed once across packs.
* `inventory.items`: references to items **defined by a pack** (not `story/…`), with `qty` ≥ 1 and an
  optional `note`. They go to the party. The same item with the same note adds up across packs. An
  item that doesn't stack gets one stack per piece.
* `inventory.money`: a whole number in the smallest coin, like item values (with copper, silver and gold
  at 1, 10 and 100, `50` is 5 silver). It goes into the party's wallet. Amounts from several packs add up.

## Screens

A pack can add screens or restyle a module's screen by giving its id (SPEC §13; the reader's own
choice and the card's come first). Fields:

| Field | Rules |
|---|---|
| `id` | A module's screen id to restyle (`rpg-battle/party`), or the pack's own (`riverside-board`). Unique in the pack. |
| `title`, `icon` | Text, at most 80 characters (`icon` is a Font Awesome name like `fa-users`). |
| `mounts` | Any of `tab`, `screen`, `card`, `hud`, `dialog`. |
| `template` | The HTML template (SPEC §13.2), up to 64 KB. Either it or `layout` is required. |
| `layout` | A layout tree `{ "root": … }` instead of a template. |
| `css` | Up to 64 KB. `url()` only to `https:` or image data; no `@import`, `expression()`, `behavior`, `-moz-binding`, `<` or backslashes. |
| `theme` | CSS custom properties, as the pack's `theme`. |
| `data` | Named queries: `{ "pc": { "query": "party.pc" } }`. |
| `steps` | Dialog wizard steps: `[{ "id", "title", "template" }]`. |

Templates follow the same safety rules as all pack text (below). Story Block sanitises them again
when it renders them.

## Safety rules

A pack is untrusted data. It is refused if anywhere in it (values and field names):

* something is not plain JSON data: a function, a class instance, a getter, `undefined`, NaN or
  Infinity, or an object that contains itself;
* a field is named `__proto__`, `constructor` or `prototype`;
* text contains a tag that can run code or load a page (`<script`, `<iframe`, `<frame`, `<object`,
  `<embed`, `<applet`, `<link`, `<meta`, `<base`, `<style`), a form with an `action`, an event
  attribute inside a tag (`<img onerror=…>`), or a script link (`javascript:`, `vbscript:`,
  `data:text/html`, `data:image/svg`), also when hidden with entities or spaces. Inline SVG and
  plain form fields are allowed;
* a `src`, `href`, `url`, `image`, `img` or `background` field is anything other than an `https:` link
  or a PNG, JPEG, GIF or WebP `data:` URL;
* a theme value contains `url(`, `expression(`, `@import`, `<`, `>`, braces, `;` or `\`.

Plain text may still contain `<` and `>` (conditions compare with them, and `<b>` is shown as text).
Story Suite shows every pack string as text and never as HTML.

## Limits

| What | Limit |
|---|---|
| One pack | 512 KB |
| All installed packs | 2 MB, at most 32 packs |
| Nesting | 16 levels |
| One list (records of a kind included) | 1000 entries |
| One object | 200 fields |
| One text | 4000 characters (field names 80); a screen's `template` or `css` 64 KB |

## Error codes

The importer lists up to 20 problems per pack, each in plain words with where it was found.

| Code | Meaning |
|---|---|
| `NOT_JSON`, `NOT_OBJECT`, `TOO_LARGE` | Not one JSON object of an allowed size. |
| `NOT_PLAIN`, `UNSAFE_KEY`, `UNSAFE_HTML`, `UNSAFE_URL` | Breaks the safety rules. |
| `TOO_DEEP`, `TOO_LONG`, `TOO_MANY` | Over a limit. |
| `UNKNOWN_FIELD`, `UNKNOWN_KIND` | A field or content kind that doesn't exist. |
| `BAD_ID`, `BAD_VERSION`, `BAD_FIELD` | Top-level fields. |
| `BAD_REQUIRES`, `HOST_VERSION`, `MISSING_CAPABILITY` | `requires`. |
| `BAD_CONTENT`, `BAD_RECORD`, `DUPLICATE`, `UNKNOWN_REF` | Content records and references. |
| `BAD_START`, `BAD_SCREENS`, `BAD_LAYOUTS`, `BAD_THEME` | `start`, `screens`, `layouts`, `theme`. |

## For module authors

The packs part (`src/v2/packs/index.js`) offers these through Story Block's core module:

* query `packs.list` → the installed packs: `{ id, version, name, author, description, enabled,
  source, origin, counts, hasStart, missing, problem }[]`;
* query `packs.content({ kind, pack? })` → records of a content kind from the enabled packs, each
  with `id`, `slug` and `pack` (also `kind: 'screens'`, `kind: 'layouts'`, and `kind: 'theme'` →
  `[{ pack, tokens }]`);
* query `packs.item({ name })` and hook `item.resolve(name)` → the pack item def (SPEC §7 fields)
  for a story name, or `null`;
* query `packs.start` and hook `start()` → the merged start: `{ scene: { place, present },
  inventory: { items: [{ def, aliases, qty, note }], money }, packs, problems }`, and
  `applyStart(state, start, { id, coin })` to write it into an initial state.
