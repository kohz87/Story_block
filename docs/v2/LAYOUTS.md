# Story Suite v2: layouts (reference for creators)

A **layout** is a screen written as JSON: a tree of a few node types whose text, numbers and lists come
from **queries** (read-only views of the story state that Story Block and its modules register) and whose
buttons run **commands**. Packs list their layouts in `pack.json` (`layouts: [...]`, SPEC §9) and each one
becomes a tab. A layout contains no HTML, no CSS and no script: Story Block draws it from its own parts,
puts every piece of text in as plain text, and checks every image URL.

Code: `src/v2/layout/` (`renderLayout`, `validateLayout`, `tabFromLayout`, `LAYOUT_CSS`).

## The layout

```json
{
  "id": "my-pack/inventory",
  "title": "Pack",
  "icon": "fa-box-open",
  "theme": { "tokens": { "accent": "#c8a24a" } },
  "root": { "type": "text", "value": "Hello" }
}
```

| Field | What it is |
|---|---|
| `id` | Short lowercase id: letters, digits and `. _ / -`, up to 64 characters. Also the tab's id. |
| `title` | The tab's name, 1 to 60 characters. |
| `icon` | A Font Awesome icon name, like `fa-box-open`. |
| `theme` | Optional. `{ "tokens": { name: value } }`, see [Theme tokens](#theme-tokens). |
| `root` | The node drawn first. |

Any other field is an error, so a misspelt field is caught instead of silently ignored.

## Values

Wherever a node shows something (`value`, `max`, `label`, `title`, `src`, `alt`, `tone`, `empty`), the
field takes one of three things:

* **A literal**: text, a number, `true`/`false` (shown as yes/no) or `null` (shown as nothing).
* **A binding**: `{ "query": "party.pc", "args": { … }, "path": "hp.cur" }`. Story Block runs the query
  with `args` (or `{}`), then follows `path` (names joined by dots; a number picks from a list, `skills.0`).
  A missing path shows nothing. Each query with the same args runs once per drawing.
* **A row reference**, inside a list's `item`: `"$item"` (the whole row), `"$item.name"` (a field of it),
  `"$index"` (the row's position, from 0). Rows of a list inside a list refer to the inner row. `args` of a
  binding may use row references too: `{ "query": "npc.dossier", "args": { "name": "$item.name" } }`.

Nodes with one main field also take **`bind`** for it: `{ "type": "text", "bind": { "query": "scene.place",
"path": "name" } }` is the same as putting the binding in `value`. Give the field or `bind`, not both.

## Nodes

Every node is an object with a `type`. Containers hold `children` (a list of nodes, up to 100).

| Type | Fields | Draws |
|---|---|---|
| `box` | `title?`, `children` | A framed panel with an optional heading. |
| `row` | `children` | Children side by side; wraps when there is no room. |
| `col` | `children` | Children stacked. |
| `grid` | `cols` (1–12), `children` | A grid of equal columns. **One column when the screen is under 480px wide.** |
| `text` | `value` or `bind`, `label?`, `variant?` | A line of text. `label` is shown before it, dimmed. `variant`: `body` (default), `title`, `label`, `muted`. |
| `meter` | `value` and `max`, or `bind`; `label?`, `tone?` | A bar with "cur / max". A bound pool like `hp: { cur, max }` fills both; `max` may be given separately. |
| `badge` | `value` or `bind`, `label?`, `tone?` | A small pill. Nothing is drawn when its text is empty. |
| `image` | `src` or `bind`, `alt?`, `size?` | A picture. `src` must be `https://…` or a base64 `data:image/png|jpeg|gif|webp|avif`. `size`: `small`, `medium` (default), `large`. |
| `list` | `bind`, `item`, `empty?`, `limit?` | One `item` per row of the bound list (a record keyed by ID is shown in stored order). `empty` is shown when there are no rows; at most `limit` rows (default and maximum 200), then "and N more". |
| `button` | `label`, `command`, `payload?`, `icon?`, `tone?` | Runs `command` with `payload` when clicked. See [Buttons](#buttons). |
| `tabs` | `pages: [{ "title", "node" }]` (1–12) | Page buttons and the chosen page. The choice is kept when the screen redraws. |
| `when` | `cond`, `children` | Its children only when the condition holds. See [Conditions](#conditions). |

**Tones** (`tone` of a badge, meter or button): `neutral`, `accent`, `good`, `warn`, `bad`, and the
rarities `common`, `uncommon`, `rare`, `epic`, `legendary`, so `"tone": "$item.rarity"` colours an item by
its rarity. A tone that comes out as anything else is drawn neutral.

### Buttons

```json
{ "type": "button", "label": "Use", "icon": "fa-flask", "command": "item.use",
  "payload": { "stack": "$item.id", "target": "$item.owner" } }
```

`payload` is plain JSON; any string that is a row reference is replaced by the row's value when the row is
drawn, so a click acts on what the reader saw. The command runs exactly as a click in any other Story Suite
tab: it is checked by its module and refused with a plain message when it can't happen ("There is no Minor
Healing Draught left."), which is shown next to the button. The button is disabled while the command runs,
and in places where nothing may change (a card showing the state at an older reply) it is drawn disabled.

### Conditions

```json
{ "type": "when", "cond": "item.points > 0", "children": [ … ] }
```

`cond` is written in the Story Suite condition language (the same one pack events use; numbers, text,
`== != < <= > >= && || !` and query calls such as `query('party.pc').level >= 30`). Inside a list's
`item`, the row is available as `item` and its position as `index`. A condition that can't be checked
(a typo, a missing query) counts as not met, so its part stays hidden.

### Widgets

Installed modules can offer their own parts (an actor card, a battle board) under a lowercase name, usually
with the module's id in front, like `rpg-battle.actor-card`. A layout places one like any node:

```json
{ "type": "rpg-battle.actor-card", "props": { "actor": "$item.id" }, "bind": { "query": "party.pc" } }
```

`props` is plain JSON (row references are filled in); a bound `bind` is passed to the widget as
`props.value`. A widget name that is not installed is an error, like any unknown type. A widget can never
replace a built-in node type.

## Theme tokens

`theme.tokens` sets these CSS variables on the layout's own root (`--ss-l-<name>`), so two layouts on one
page never affect each other. Unset tokens follow the SillyTavern theme.

| Token | Used for |
|---|---|
| `accent` | Headings, the active page, meters, accent badges |
| `bg`, `surface` | Background of the whole screen; of boxes |
| `fg`, `muted` | Text; muted text |
| `border`, `radius` | Borders; corner rounding |
| `gap`, `pad` | Space between parts; inside boxes |
| `font` | Font family |
| `good`, `warn`, `bad` | Tones |
| `meter`, `meter-bg` | Meter fill and track |

Values are colours (`#c8a24a`, `rgb(…)`, `rgba(…)`, `hsl(…)`, `hsla(…)`, colour names), lengths (`6px`,
`0.5rem`) or font names (`Georgia, serif`), up to 64 characters. `url(…)`, `var(…)` and anything with
`; { } < > / \ :` are refused.

## Limits and checks

`validateLayout` refuses a layout, and the screen shows the reasons instead of drawing it, when it has:

* a node `type` that is neither built in nor an installed widget, or a field a node doesn't have;
* a binding without a query name, with `args` that are not an object, or with a bad `path`;
* an image `src` that is not `https:` or a base64 raster `data:` image (no `http:`, `javascript:`, SVG, or
  `https://user:password@…`);
* a row reference outside a list's `item`;
* nodes nested more than 16 deep, more than 600 nodes, more than 100 children in one container, more than
  12 pages, or more than 256 KB of JSON; text over 2,000 characters; a `data:` image over 200 KB;
* anything that is not plain JSON.

While drawing, things that depend on the story can still go wrong: a query fails, a bound image URL is not
allowed, a condition can't be checked. Those parts are left out and listed in the `problems` that
`renderLayout` returns; the rest of the screen is drawn. At most 3,000 parts are drawn per screen.

## For hosts and modules

```js
import { renderLayout, validateLayout, tabFromLayout, LAYOUT_CSS } from './src/v2/layout/index.js';

validateLayout(layout, { widgets, meta })      // → string[], empty when fine
renderLayout(el, layout, { query, command, evaluate, widgets, preview, commit, on })
                                              // → { ok, errors, problems }; replaces el's content
tabFromLayout(layout, { widgets })             // → { id, title, icon, render(el, view, api) }
```

* `renderLayout` draws any element (a tab, a full screen, a card under a reply, a dialog) and also takes a
  screen's bare tree `{ root, theme? }` (SPEC §13.1), whose id, title and icon live on the screen.
  `validateLayout` asks for id, title and icon unless given `meta: false`; `tabFromLayout` always does.

* `query(name, args)` answers straight away with plain data (a view over the head state, or over the state
  at an older reply for a card under it). `command(type, payload)` may return a promise of
  `{ ok, message? }`. `evaluate(cond, { item, index, query })` returns true or false.
* `widgets` is `{ [name]: { render(el, props, api), validate?(props) → string[] } }`; `api` is
  `{ query, command, evaluate, preview?, commit?, on?, item, index }` (the last three when the host gives them).
* A tab made by `tabFromLayout` reads `view.query`, and `api.command`, `api.evaluate`, `api.preview`,
  `api.commit`, `api.on` and `api.widgets`.
* `LAYOUT_CSS` is the one stylesheet (put it in the page once; `ensureLayoutStyles(document)` does that).

## Example: inventory screen

The party's items with rarity, count, and Use / Drop buttons; consumables get a Use button only. Query and
command names follow MODULES.md (`inventory.items` rows joined with their item definitions).

```json
{
  "id": "example/inventory",
  "title": "Pack",
  "icon": "fa-box-open",
  "theme": { "tokens": { "accent": "#c8a24a", "radius": "8px" } },
  "root": {
    "type": "col",
    "children": [
      {
        "type": "row",
        "children": [
          { "type": "text", "variant": "title", "value": "Pack" },
          { "type": "badge", "label": "Silver", "tone": "accent",
            "bind": { "query": "inventory.wallet", "args": { "owner": "party" }, "path": "silver" } }
        ]
      },
      {
        "type": "list",
        "bind": { "query": "inventory.items", "args": { "owner": "party" } },
        "empty": "The pack is empty.",
        "item": {
          "type": "row",
          "children": [
            { "type": "image", "bind": "$item.icon", "size": "small", "alt": "$item.name" },
            { "type": "text", "value": "$item.name" },
            { "type": "badge", "value": "$item.rarity", "tone": "$item.rarity" },
            { "type": "text", "variant": "muted", "label": "×", "value": "$item.qty" },
            {
              "type": "when",
              "cond": "item.kind == 'consumable'",
              "children": [
                { "type": "button", "label": "Use", "icon": "fa-flask", "command": "item.use",
                  "payload": { "stack": "$item.id", "target": "$item.owner" } }
              ]
            },
            { "type": "button", "label": "Drop", "icon": "fa-trash", "tone": "bad", "command": "inventory.drop",
              "payload": { "stack": "$item.id", "qty": 1 } }
          ]
        }
      }
    ]
  }
}
```

## Example: character sheet

One sheet per party member: portrait, level, HP/MP/SP meters, then pages for stats and skills. Points to
spend show a button per stat.

```json
{
  "id": "example/character-sheet",
  "title": "Sheet",
  "icon": "fa-id-card",
  "theme": { "tokens": { "accent": "#7fb2e5", "meter": "#d9534f" } },
  "root": {
    "type": "list",
    "bind": { "query": "party.actors" },
    "empty": "No one in the party yet.",
    "item": {
      "type": "box",
      "title": "$item.name",
      "children": [
        {
          "type": "row",
          "children": [
            { "type": "image", "src": "https://example.com/portraits/default.png", "size": "small", "alt": "Portrait" },
            { "type": "badge", "label": "Level", "value": "$item.level", "tone": "accent" },
            { "type": "badge", "value": "$item.role" },
            { "type": "text", "variant": "muted", "label": "XP", "value": "$item.xp" }
          ]
        },
        {
          "type": "grid",
          "cols": 3,
          "children": [
            { "type": "meter", "label": "HP", "bind": "$item.hp", "tone": "bad" },
            { "type": "meter", "label": "MP", "bind": "$item.mp" },
            { "type": "meter", "label": "SP", "bind": "$item.sp", "tone": "good" }
          ]
        },
        {
          "type": "tabs",
          "pages": [
            {
              "title": "Stats",
              "node": {
                "type": "col",
                "children": [
                  {
                    "type": "grid",
                    "cols": 4,
                    "children": [
                      { "type": "text", "label": "STR", "value": "$item.stats.STR" },
                      { "type": "text", "label": "VIT", "value": "$item.stats.VIT" },
                      { "type": "text", "label": "AGI", "value": "$item.stats.AGI" },
                      { "type": "text", "label": "DEX", "value": "$item.stats.DEX" },
                      { "type": "text", "label": "INT", "value": "$item.stats.INT" },
                      { "type": "text", "label": "LUK", "value": "$item.stats.LUK" },
                      { "type": "text", "label": "CHA", "value": "$item.stats.CHA" }
                    ]
                  },
                  {
                    "type": "when",
                    "cond": "item.points > 0",
                    "children": [
                      { "type": "text", "variant": "label", "label": "Points to spend", "value": "$item.points" },
                      {
                        "type": "row",
                        "children": [
                          { "type": "button", "label": "+STR", "command": "party.spend", "payload": { "actor": "$item.id", "stat": "STR" } },
                          { "type": "button", "label": "+AGI", "command": "party.spend", "payload": { "actor": "$item.id", "stat": "AGI" } },
                          { "type": "button", "label": "+INT", "command": "party.spend", "payload": { "actor": "$item.id", "stat": "INT" } }
                        ]
                      }
                    ]
                  }
                ]
              }
            },
            {
              "title": "Skills",
              "node": {
                "type": "list",
                "bind": "$item.skills",
                "empty": "No skills yet.",
                "item": {
                  "type": "row",
                  "children": [
                    { "type": "text", "value": "$item.name" },
                    { "type": "badge", "label": "Lv", "value": "$item.level" }
                  ]
                }
              }
            },
            {
              "title": "Conditions",
              "node": {
                "type": "list",
                "bind": "$item.conditions",
                "empty": "Nothing ails them.",
                "item": { "type": "badge", "value": "$item.kind", "tone": "warn" }
              }
            }
          ]
        }
      ]
    }
  }
}
```
