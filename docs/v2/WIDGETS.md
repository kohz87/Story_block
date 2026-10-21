# Story Suite v2: the standard widgets

Story Block ships eight widgets (SPEC §13.5) under the `ss.` namespace (MODULES §F9):
`ss.meter`, `ss.radar`, `ss.map`, `ss.skill-tree`, `ss.portrait`, `ss.badge`, `ss.timeline`,
`ss.stepper`. They live in `src/v2/view/widgets/`; `index.js` exports them as `standardWidgets`
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
`--ss-w-segments`, `--ss-w-count` (skills in a tier), `--ss-w-x` / `--ss-w-y` (a map place, percent of
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

`role="meter"` with `aria-valuenow/min/max/text`. A bound pool `{ cur, max }` fills `value` and `max`.

```html
<ss-widget name="ss.meter" data-props='{"value":"{{ q.pc.hp.cur }}","max":"{{ q.pc.hp.max }}","label":"HP","tone":"good","icon":"fa-heart"}'></ss-widget>
<ss-widget name="ss.meter" data-props='{"value":"{{ q.clock.filled }}","max":4,"segments":4,"label":"Alarm"}'></ss-widget>
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
