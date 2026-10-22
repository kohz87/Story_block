# Story Suite v2: the standard widgets

Story Block ships twelve widgets (SPEC §13.5) under the `ss.` namespace (MODULES §F9):
`ss.meter`, `ss.radar`, `ss.map`, `ss.skill-tree`, `ss.portrait`, `ss.badge`, `ss.timeline`,
`ss.stepper`, and the building blocks of Story Suite's look (the UI stage, `view/widgets/glass.js`):
`ss.tile`, `ss.bar`, `ss.status`, `ss.pill`. They live in `src/v2/view/widgets/`; `index.js` exports them as `standardWidgets`
(name → widget).

## The widget contract

```js
import { standardWidgets } from './src/v2/view/widgets/index.js';

const widget = standardWidgets['ss.meter'];
widget.props;            // { name: { type, required, default } }
widget.primary;          // the main prop a bound value fills ('value', 'nodes', 'axes', …)
widget.validate(props);  // → string[]: plain-words problems with the props' types ([] when fine)
const handle = widget.render(el, props, api);   // draws into el (adds one root element)
handle.update(nextProps);                        // redraws in place (a map keeps the reader's pan and zoom)
handle.destroy();                                // removes the root, its listeners and observers
```

* **`api`**: `{ query, command, preview, commit, on }` (§13.5) plus, in a dialog, `onDraft(name, value)`.
  Widgets use only `command` (a click on a map place, a skill, a badge) and `onDraft` (the stepper). Each
  is optional: without `command`, places and skills are not buttons; without `onDraft`, the stepper still
  steps. A widget never throws at the reader: bad props fall back to defaults and an empty state is shown.
* **Props** are plain JSON. A number or boolean prop also takes its string form (`"77"`, `"true"`), so
  `{{ }}` interpolation in `data-props` works. A wrong-typed prop falls back to its default.
* **Bound values.** When the renderer passes bound data as `props.value` (a layout node's `bind`,
  LAYOUTS.md), an object is unfolded into props (`{ nodes, edges, current }` for a map; `{ cur, max }`
  for a meter), and a list or plain value fills the widget's `primary` prop. Props given beside it win.
* **`validate`** reports wrong types only. Required data often arrives through a binding the validator
  cannot see; `propProblems(props, input)` (exported) also lists missing required props.
* **Safety.** Every widget builds its DOM with `createElement` / `createElementNS` and `textContent`;
  nothing from data is parsed as markup, and no `on*` attributes are set. Data never picks a class name:
  tones, frames and sizes come from fixed lists, and kinds go into `data-kind` attributes.
* **Images** (portraits, icons) are accepted only as `https:` URLs, base64 raster `data:image/png|jpeg|
  gif|webp|avif` URLs, or same-origin paths from the site root (SillyTavern's avatars:
  `/thumbnail?type=avatar&file=…`, `/User Avatars/…`; MODULES §F11). `http:`, `javascript:`,
  protocol-relative `//host`, `/\host`, other relative paths, SVG data and URLs with credentials are refused.
* **Icons** are a Font Awesome class name (`fa-map`, `fa-solid fa-map`, `fas fa-map`; SillyTavern ships
  Font Awesome, and `fa-solid` is added when no style is named), one of the image URLs above, or a short
  glyph of up to three characters (an emoji).

## Styling

The first widget drawn in a document adds one `<style data-ss-widgets>` with the base look. Every rule
in it is wrapped in `:where()`, so it has no specificity: a screen's scoped CSS (§13.3) overrides any of
it. Everything is `ss-w-` classes, `data-*` attributes and custom properties:

| Property | Default | Used for |
|---|---|---|
| `--ss-w-fg`, `--ss-w-muted` | SillyTavern's body colour | text |
| `--ss-w-bg`, `--ss-w-raised`, `--ss-w-border` | SillyTavern's tint and border colours | surfaces |
| `--ss-w-accent` | `--ss-accent`, else SillyTavern's quote colour | highlights, the current place, the active layer |
| `--ss-w-good`, `--ss-w-warn`, `--ss-w-bad`, `--ss-w-info` | green, amber, red, blue | tones |
| `--ss-w-tone` | set by `.ss-w-tone-<tone>` | a widget's tone colour |
| `--ss-w-radius`, `--ss-w-gap` | `6px`, `0.4em` | shape and spacing |
| `--ss-w-meter-height` | `0.6em` | the meter bar |
| `--ss-w-radar-size` | `22em` | the radar's largest width |
| `--ss-w-map-aspect`, `--ss-w-map-bg`, `--ss-w-map-route` | `4 / 3`, the surface, muted | the map stage |
| `--ss-w-portrait-size` | `4em` (set by the size classes) | the portrait frame |

Set by the widgets (read them in CSS, don't set them): `--ss-w-ratio` (meter fill, 0–1),
`--ss-w-ceiling`, `--ss-w-warn-lo`, `--ss-w-warn-hi`, `--ss-w-at` (meter marks, 0–1), `--ss-w-segments`, `--ss-w-count` (skills in a tier), `--ss-w-x` / `--ss-w-y` (a map place, percent of
the stage), `--ss-w-zoom` (map zoom relative to "fit").

Tones: `neutral`, `accent`, `good`, `warn`, `bad`, `info` (anything else is `neutral`).

Every root has `ss-w` and `ss-w-<name>` (`ss-w-meter`, `ss-w-skill-tree`, …). A screen restyles a
widget with ordinary selectors, e.g. `.ss-w-map-node[data-kind="town"] .ss-w-map-dot { border-radius: 2px }`.

## Usage in templates

The snippets use the template syntax of §13.2. How `data-props` is read (literal JSON with `{{ }}`
interpolation, or a `bind` path whose value is passed as `props.value`) is the template renderer's
contract; the widget receives the resulting plain object.

---

## `ss.meter`

A labelled bar for a value out of a maximum, with an optional icon, or a row of cells (`segments`).

| Prop | Type | Default | |
|---|---|---|---|
| `value` | number | `0` | required; clamped into the range for drawing |
| `max` | number | `100` | |
| `min` | number | `0` | |
| `label` | string | `''` | shown and used as the accessible name |
| `tone` | string | `neutral` | |
| `segments` | number | `0` | draw this many cells (at most 64); `ss-w-on` full, `ss-w-part` partly full |
| `icon` | string | `''` | |
| `text` | string | `''` | the value as shown and spoken (default `77 / 82`) |
| `showValue` | boolean | `true` | |
| `ceiling` | number | `null` | a notch where the value can go no higher for now (max HP lowered by a wound); the track above it is shaded |
| `ticks` | list | `null` | stage marks `[{ at, label }]` (at most 16, labels one line of up to 40 characters); the stage reached, the last tick at or below the value, is named in the head |
| `delta` | number | `null` | the change since the last reply, shown `▲3` / `▼5` (`ss-w-up` / `ss-w-down`); `0` shows nothing |
| `warnBelow` | number | `null` | a value below it is critical: the low band is drawn and the meter gets `ss-w-critical`, `data-warn="low"` |
| `warnAbove` | number | `null` | a value above it is critical: the high band, `ss-w-critical`, `data-warn="high"` |

`role="meter"` with `aria-valuenow/min/max/text`. A bound pool `{ cur, max }` fills `value` and `max`.
Each mark is left out when it is not given, not a number, or outside `min`–`max` (a ceiling at `max`, a
band at the very end). The spoken value names the marks in words: "35 / 100, Friendly, down 5 since the
last reply, can go up to 60 for now, critically low". The marks are placed by custom properties of the
track (0–1 of the range): `--ss-w-ceiling`, `--ss-w-warn-lo`, `--ss-w-warn-hi`, and `--ss-w-at` on each
`.ss-w-meter-tick` (the stage reached has `ss-w-on`). The meter does not work out a delta itself; the
screen passes the number (a query's `before`, `changed()`), so code still sets every number.

```html
<ss-widget name="ss.meter" data-props='{"value":"{{ q.pc.hp.cur }}","max":"{{ q.pc.hp.max }}","label":"HP","tone":"good","icon":"fa-heart"}'></ss-widget>
<ss-widget name="ss.meter" data-props='{"value":"{{ q.clock.filled }}","max":4,"segments":4,"label":"Alarm"}'></ss-widget>
<ss-widget name="ss.meter" data-props='{"value":"{{ q.pc.hp.cur }}","max":"{{ q.pc.hp.max }}","ceiling":"{{ q.pc.hp.cap }}","warnBelow":"{{ q.pc.hp.low }}","delta":"{{ q.pc.hp.delta }}","label":"HP","tone":"bad"}'></ss-widget>
<ss-widget name="ss.meter" data-props='{"value":"{{ m.value }}","min":-100,"max":100,"delta":"{{ m.delta }}","ticks":[{"at":-50,"label":"Hostile"},{"at":0,"label":"Wary"},{"at":30,"label":"Friendly"},{"at":70,"label":"Close"}],"label":"{{ m.name }}"}'></ss-widget>
```

## `ss.radar`

A polygon chart over three or more axes (stats, affinities), with an optional "before" series drawn
dashed underneath (a level-up preview, gear compared). Values that went up or down get `ss-w-up` /
`ss-w-down` dots. A visually hidden list reads the numbers out ("STR: 12 of 20 (was 10)").

| Prop | Type | Default | |
|---|---|---|---|
| `axes` | list | `[]` | required; `[{ label, value, max, before }]` (at most 24) |
| `before` | list | `null` | numbers by axis index (an axis's own `before` wins) |
| `max` | number | `0` | the max for axes without one (`0`: the largest value shown) |
| `levels` | number | `4` | grid rings (1–10) |
| `label` | string | `''` | caption and accessible name |
| `tone` | string | `accent` | |
| `showValues` | boolean | `true` | numbers next to the axis labels |

```html
<ss-widget name="ss.radar" data-props='{"bind":"q.statAxes","label":"Ren","before":[10,8,15,9,7,5,6]}'></ss-widget>
```

## `ss.map`

Places and routes in an SVG, with:

* **pan**: drag with a pointer (mouse, pen, one finger) or the arrow keys;
* **zoom**: the wheel (about the cursor), a two-finger pinch, the `+` / `−` buttons or keys, and `↺` or
  `0` to show the whole map; from ½× to 8× of "fit";
* **layers**: a switcher (shown with two or more layers); places with no `layer` show on every layer;
* **minimap**: the whole layer with a box for the part on screen; a press on it centres the view there;
* **legend**: the kinds of places and routes on show, "You are here" and "Unexplored";
* **fog**: with `discovered`, other places are hidden, or (fog `unknown`) shown as a nameless "?" when
  a route leads there from a known place; the current place always counts as discovered;
* **selection**: with `onSelect`, each known place is a button; a click (not a drag) runs
  `api.command(onSelect, { node: <place id> })`.

Places without `x`/`y` are laid out deterministically: on a grid beside the placed ones, then — if routes
reach them — a fixed number of force-directed steps with the placed nodes pinned. The same data always
gives the same map. A state update keeps the reader's pan and zoom; changing the `layer` prop refits.

| Prop | Type | Default | |
|---|---|---|---|
| `nodes` | list | `[]` | required; `[{ id, name, x, y, icon, layer, kind }]` (at most 2000; first of each id) |
| `edges` | list | `[]` | `[{ from, to, kind }]` between known ids |
| `layers` | list | `null` | `['surface', …]` or `[{ id, name }]`; default: the nodes' layers in order |
| `layer` | string | `''` | the layer shown first (else the current place's, else the first) |
| `current` | string | `''` | the reader's place: `ss-w-current`, `aria-current="location"` |
| `discovered` | list | `null` | known place ids; `null`: everything is known |
| `fog` | string | `hide` | `hide` or `unknown` |
| `kinds` | object | `null` | `{ town: { label: 'Town', icon: 'fa-house' } }` for the legend and for nodes without an icon |
| `onSelect` | string | `''` | the command a place click runs |
| `label` | string | `Map` | accessible name |
| `minimap` | boolean | `true` | |
| `legend` | boolean | `true` | |

```html
<ss-widget name="ss.map" data-props='{"bind":"q.places","onSelect":"scene.travel","fog":"unknown","kinds":{"town":{"label":"Town","icon":"fa-house"},"road":{"label":"Road"}}}'></ss-widget>
```

where the screen's `data` has `places: { query: 'scene.map' }` returning
`{ nodes, edges, layers, current, discovered }`.

## `ss.skill-tree`

Tiers top to bottom, skills in equal columns, connectors between tiers: from each skill named in a
skill's `requires` (in the tier above) to it, or one trunk line when no skill names requirements. Each
skill shows its icon, name, a level badge (`3` or `3/5`), a check mark when active and a lock when locked.
`data-state` is `active`, `learned` (level above 0), `available` or `locked`. With `onSelect`, unlocked
skills are buttons running `api.command(onSelect, { skill: <id> })`.

| Prop | Type | Default | |
|---|---|---|---|
| `tiers` | list | `[]` | required; `[{ title, skills: [{ id, name, icon, level, max, active, locked, requires }] }]` |
| `onSelect` | string | `''` | |
| `label` | string | `Skills` | accessible name |

```html
<ss-widget name="ss.skill-tree" data-props='{"bind":"q.tree","onSelect":"party.learnSkill"}'></ss-widget>
```

## `ss.portrait`

A picture in a frame, with the name's initials when there is no picture, the URL is refused, or it fails
to load. The PC's picture is the persona avatar; others' come from NSD's `npc.portrait({ name })`
(MODULES §F11).

| Prop | Type | Default | |
|---|---|---|---|
| `src` | string | `''` | see Images above |
| `name` | string | `''` | initials and the accessible name ("Portrait of Ren Avel") |
| `frame` | string | `circle` | `circle`, `rounded`, `square`, `hex`, `diamond`, `none` |
| `size` | string | `md` | `sm`, `md`, `lg`, `xl` |
| `tone` | string | `neutral` | the frame's colour |
| `caption` | string | `''` | |

```html
<ss-widget name="ss.portrait" data-props='{"src":"{{ q.portrait }}","name":"{{ q.pc.name }}","frame":"hex","size":"lg"}'></ss-widget>
```

## `ss.badge`

An icon with an optional counter: a status effect with the turns it has left, a stack count. The label
is spoken ("Poisoned: 3 turns left") and shown as a tooltip; it is shown as text too with `showLabel` or
when there is no icon. With `onSelect` it is a button running `api.command(onSelect, { badge: id || label })`.

| Prop | Type | Default | |
|---|---|---|---|
| `label` | string | `''` | required |
| `icon` | string | `''` | |
| `counter` | number | `null` | `null`: no counter |
| `max` | number | `99` | a larger counter shows as `99+` |
| `unit` | string | `''` | spoken after the counter |
| `tone` | string | `neutral` | |
| `showLabel` | boolean | `false` | |
| `id`, `kind` | string | `''` | `kind` goes to `data-kind` |
| `onSelect` | string | `''` | |

```html
<span data-each="q.pc.conditions as c">
  <ss-widget name="ss.badge" data-props='{"icon":"fa-skull-crossbones","label":"{{ c.kind }}","counter":"{{ c.turns }}","unit":"turns left","tone":"bad","kind":"{{ c.kind }}"}'></ss-widget>
</span>
```

## `ss.timeline`

Events top to bottom in the order given, the current one marked (`ss-w-current`, `aria-current="step"`,
a "Now" tag), those before it `ss-w-past`, after it `ss-w-future`.

| Prop | Type | Default | |
|---|---|---|---|
| `events` | list | `[]` | required; `[{ id, time, title, text, kind, icon }]` (at most 500); `time` is shown as given |
| `current` | string or number | `null` | an event's `id`, or its index |
| `label` | string | `Timeline` | accessible name |

```html
<ss-widget name="ss.timeline" data-props='{"bind":"q.journal","current":"{{ q.journalNow }}"}'></ss-widget>
```

## `ss.stepper`

A number input with − / + under a points budget, for wizards (§13.6). It fills the dialog's draft:
every change calls `api.onDraft(name, value)`; it never touches state, and the submit command checks the
rules again in code.

`budget` is the points left now, with the stepper at `value`. Each step up costs `cost` and each step
down refunds it; + is disabled when the budget cannot pay for a step (or at `max`), − at `min`. Typed
values are snapped to the step grid and kept within what the budget allows. Keys: ↑/↓ one step,
PageUp/PageDown ten, Home/End the limits. New props (the dialog's recomputed budget after any stepper
moved) start the count again from them.

| Prop | Type | Default | |
|---|---|---|---|
| `name` | string | `''` | required; the draft field |
| `value` | number | `0` | |
| `min` | number | `0` | |
| `max` | number | `null` | `null`: no maximum |
| `step` | number | `1` | |
| `budget` | number | `null` | points left; `null`: no budget |
| `pool` | number | `null` | a budget the steppers share, used when `budget` is `null`: points left = `pool − spent` |
| `spent` | number | `0` | points spent from the pool, this stepper's included: `{{ sum(draft.points) }}` |
| `cost` | number | `1` | points per step up |
| `label` | string | `''` | shown and used in the buttons' names ("Increase Strength") |
| `budgetLabel` | string | `Points left` | the note under it ("Points left: 3", `aria-live`) |
| `tone` | string | `neutral` | |
| `disabled` | boolean | `false` | |

```html
<ss-widget name="ss.stepper" data-props='{"name":"STR","label":"Strength","value":"{{ draft.STR }}","min":1,"max":20,"budget":"{{ draft.pointsLeft }}"}'></ss-widget>
<!-- or one pool shared by every stat's stepper (TEMPLATES.md, Example 3) -->
<ss-widget name="ss.stepper" data-props='{"name":"points.DEX","label":"Dexterity","value":"{{ draft.points.DEX }}","pool":"{{ q.rules.points }}","spent":"{{ sum(draft.points) }}"}'></ss-widget>
```

---

## The look's building blocks: `ss.tile`, `ss.bar`, `ss.status`, `ss.pill`

These draw the classes of `view/glass.css` (docs/dev/ui-and-screens.md "The look"), not `ss-w-*` ones:
they take the theme tokens (`--ss-glass`, `--ss-accent`, …), so they follow the reader's Panel style and
light or dark. Every root also has `ss-w ss-w-<name>`. Ring colours (`tone`) come from a fixed list:
`neutral`, `accent`, `good`, `warn`, `bad`, `info` and the rarities `uncommon`, `rare`, `epic`,
`legendary` (class `ss-tone-<tone>`; anything else: no ring class, or the default named below).

### `ss.tile`

An icon in a rounded square, a label under it, a number badge, a tick or a lock. With `onSelect` it is a
button (`aria-pressed` = `selected`) running `api.command(onSelect, { tile: id || label })`: choosing a
skill to read or an item to manage, never a story action (F95/F96). A locked tile is never a button.
Spoken: "Moonlight Slash, Lv 3, ready".

| Prop | Type | Default | |
|---|---|---|---|
| `label` | string | `''` | required |
| `icon` | string | `''` | none: the label's first letter |
| `count` | string | `''` | the badge ("3", "–"); `''`: none |
| `countStyle` | string | `badge` | `badge` (under the icon) or `corner` (a bag's count) |
| `state` | string | `none` | `none`, `ready` (a tick), `locked` (a lock, dimmed) |
| `tone` | string | `''` | the ring; `''`: the hairline |
| `selected` | boolean | `false` | ring in the accent |
| `showLabel` | boolean | `true` | |
| `hint` | string | `''` | spoken after the label instead of the count ("Lv 3") |
| `id`, `kind` | string | `''` | |
| `onSelect` | string | `''` | |

```html
<ss-widget data-each="q.skills as k" name="ss.tile" data-props='{"label":"{{ k.name }}","icon":"{{ k.icon }}","count":"{{ k.level }}","state":"{{ k.state }}","id":"{{ k.id }}"}'></ss-widget>
```

### `ss.bar`

A labelled bar: label left, "50 / 82" right, a 7 px track. `kind` `hp`, `mp`, `sp` or `exp` picks the
suite's bar colour (else the accent). ARIA `meter`. Sets `--ss-fill` (0–1) on `.ss-bar-track`.

| Prop | Type | Default | |
|---|---|---|---|
| `value` | number | `0` | required |
| `max` | number | `100` | |
| `label` | string | `''` | |
| `kind` | string | `''` | `hp`, `mp`, `sp`, `exp` |
| `text` | string | `''` | the value as shown (default "value / max") |
| `showValue` | boolean | `true` | |

```html
<ss-widget name="ss.bar" data-props='{"label":"HP","kind":"hp","value":{{ q.pc.hp.cur }},"max":{{ q.pc.hp.max }}}'></ss-widget>
```

### `ss.status`

A status effect: its icon in a square tinted with its tone, the time left in the corner. `unit` `turns`
("2t"), `rounds` ("2r") or `minutes` (story minutes: "40m", whole hours "3h" from an hour, whole days
"2d" from 48 hours); `left` `null` or empty: "∞". More than 99: "99+". Spoken in words: "Bleeding: 40
story minutes left", "Blessed: no set end". `tone` defaults to `accent`.

| Prop | Type | Default | |
|---|---|---|---|
| `label` | string | `''` | required |
| `icon` | string | `''` | none: the label's first letter |
| `left` | number | `null` | |
| `unit` | string | `turns` | `turns`, `rounds`, `minutes` |
| `tone` | string | `accent` | |
| `id`, `kind` | string | `''` | |

```html
<ss-widget data-each="q.pc.conditions as c" name="ss.status" data-props='{"label":"{{ c.label }}","icon":"{{ c.icon }}","left":"{{ c.left }}","unit":"minutes","tone":"bad"}'></ss-widget>
```

### `ss.pill`

Short text in a pill, with an optional icon; `style` `solid` (default), `soft` (the accent, soft) or
`outline`.

```html
<ss-widget name="ss.pill" data-props='{"text":"{{ q.pc.class }} · Lv {{ q.pc.level }}"}'></ss-widget>
```
