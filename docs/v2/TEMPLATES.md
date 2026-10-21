# Story Suite v2: screen templates (creator reference)

A **screen** (SPEC §13.1) is data: an id, where it may appear (`mounts`), the queries it reads (`data`), a
`template` (or a JSON `layout`), its `css` and a `theme`. This page is the reference for templates and their
CSS: the HTML you may write, how it reads the story's state, and how buttons and forms run commands. Three
complete screens close the page.

```js
{
  id: 'rpg-battle/hud', title: 'Hero', icon: 'fa-heart',
  mounts: ['hud', 'tab'],
  data: { pc: { query: 'party.pc' } },          // → q.pc in the template
  theme: { '--ss-accent': '#c9a227' },          // custom properties on the screen root
  template: '<div class="hud">…</div>',
  css: '.hud { … }',
}
```

A template is compiled once and then rendered again whenever the state changes. A second render with the
same data changes nothing on the page; a changed value changes only its own text, attribute, class or
variable, and list items are kept (and moved, not rebuilt) by their `id`.

## 1. What a template reads (the scope)

| Name | What it is |
|---|---|
| `state.<domain>.…` | The state at the mount's reply, read-only: `state.scene.place.name`, `state.inventory.stacks`, `state.meta.rev`. A `card` shows **that reply's** state; every other mount the latest. |
| `q.<alias>` | The screen's `data` queries: `data: { pc: { query: 'party.pc' } }` gives `q.pc`. |
| `draft.…` | A dialog's draft (forms, §6). |
| `settings.…` | The settings of the screen's module. |
| loop names | The names `data-each` gives its items (§3). |
| helpers | `ratio`, `pct`, `changed`, `len`, `fmt.money`, `fmt.time` (§2.2). |

### 1.1 Paths

`a.b.c`, `list[0]`, `defs['story/moonveil-trout']` (keys with `/` or `-` need quotes), and keys read from
another path: `state.inventory.defs[s.def].name`. A path that runs into something missing is empty, never an
error. Only the data's own fields are read (`constructor`, `__proto__`, `toString` and the like are
always empty). Lists have `length`; records do not (use `len(x)`).

### 1.2 Expressions

Anything that is not a plain path is an expression in the **events condition language** (src/v2/events):

* numbers, `'words'`, `true`, `false`, `null`;
* `!  ==  !=  <  <=  >  >=  &&  ||` and parentheses;
* calls: the helpers, and the language's own (`query('party.pc').level`, `quest('Granary Rats').status`,
  `has('Rope', 2)`, `count(list)`).

The language has **no truthiness**: `&&`, `||` and `!` take `true`/`false`. Write `q.pc != null`, not
`q.pc && …`; write `settings.compact == true`, not `!settings.compact`, when the setting may be unset. It has
no arithmetic either (no `+ - * /`); counting and sums come from queries, or from `len()` and `sum()`.

Three short forms are read without the language, so they always work and cost nothing: a plain path, a
literal, `!path` (here `!` does use truthiness: empty, `0`, `false`, `null` and `''` are false), and a
helper call whose arguments are those (`ratio(q.pc.hp.cur, q.pc.hp.max)`, `fmt.money(q.purse)`).

An expression that cannot be read shows as empty (or false) and adds a line to the screen's warnings, which
the Story Suite overlay shows.

### 1.3 Helpers

| Helper | Result |
|---|---|
| `ratio(a, b)` | `a / b`, clamped to 0…1 (4 decimals); 0 when `b` is not above 0. For meters: `--hp: ratio(hp.cur, hp.max)`. |
| `pct(a, b)` | The same as a whole percentage, 0…100. |
| `len(x)` | Items in a list, keys in a record, characters in a word; 0 otherwise. |
| `contains(a, b)` | Does text `a` hold `b`, ignoring case? An empty `b` matches everything; a list matches when one item does. For filter boxes: `data-if="contains(state.inventory.defs[s.def].name, draft.find)"`. |
| `sum(list, field?)` | The numbers in a list, or a record's values, added up; with `field`, each item's field (`sum(q.rows, 'base')`, or a dotted path: `sum(state.party.actors, 'hp.cur')`). Anything that is not a number counts as 0. For a points-buy total: `sum(draft.points)`. |
| `changed(path)` | True when **this reply's** changes touched the path: a change at it, inside it, or one that replaced something above it. Write the path bare (`changed(s.qty)`), quoted (`changed('state.scene.place')`), or as a JSON Pointer (`changed('/domains/scene')`). Loop items know where they came from, so `changed(s)` inside `data-each="state.inventory.stacks as s"` asks about that one stack. Query results (`q.…`) are copies and are never "changed". |
| `fmt.money(n)` | Money in the smallest unit as the rules write it (`3 silver 4 copper`). |
| `fmt.time(m)` | Story minutes on the reader's calendar. |

## 2. Bindings

| Syntax | Meaning |
|---|---|
| `{{ expr }}` | Text. In text nodes and in attribute values (not `style`). Always text: `<b>` in data shows as `<b>`. |
| `data-bind="expr"` | The element's whole text (whatever the template had inside is replaced). |
| `data-bind-attr="src: expr; title: expr"` | Attributes. `null`, `false` or empty data removes the attribute; `true` sets a boolean one (`disabled`, `hidden`, `checked`, `open`). Not `class` (use `data-class`), `style` (use `data-bind-var`), `on…` or `data-…`. |
| `data-bind-var="--hp: ratio(hp.cur, hp.max)"` | CSS custom properties on the element. Styling from data always goes through variables. |
| `data-each="list as item"` / `"list as item, i"` | Repeat the element per item. Lists give `i` = 0, 1, 2…; records (state is keyed by ID) give their items in key order and `i` = the key. One render draws at most 5,000 elements through its loops (the rest of a list is left out, with a warning), and a pack's loops nest at most 3 deep. |
| `data-if="expr"` | The element is there only while the expression is true. With `data-each` it applies per item. |
| `data-class="hurt: expr; low: expr"` | Toggle classes. |
| `data-command="item.use" data-payload='{"stack":"{{ s.id }}"}'` | A click runs the command. |
| `data-draft="name"` | An input fills the dialog's draft (§6). |
| `data-submit="party.create"` | A form's submit (or this element's click) sends the draft as one command. |
| `<ss-widget name="ss.meter" data-props='{"bind":"q.pc.hp"}'></ss-widget>` | A registered widget (§5). Always write the closing tag. |

Separate several entries with `;`. A `:` or `;` inside quotes or brackets is part of the expression.

### 2.1 Lists, records and loops in loops

```html
<ul>
  <li data-each="state.inventory.stacks as s, id" data-if="s.qty > 0">
    {{ state.inventory.defs[s.def].name }} ×{{ s.qty }}
  </li>
</ul>
<section data-each="q.actors as a, i">
  <h3>{{ a.name }}</h3>
  <span data-each="a.skills as sk, j" data-class="first: j == 0">{{ sk.name }}</span>
</section>
```

An inner loop sees the outer names (`a` above). Names may not be `state`, `q`, `draft`, `settings`,
`query`, `fmt` or a helper. Items that carry an `id` keep their element when the list changes order.

### 2.2 Commands

```html
<button data-command="item.use" data-payload='{"stack":"{{ s.id }}","target":"{{ q.pc.id }}"}'>Use</button>
<button data-command="trade.sell" data-payload='{"stack":"{{ s.id }}","qty":{{ s.qty }}}'>Sell all</button>
```

* `data-payload` is JSON with `{{ }}` holes. A hole **inside quotes** is filled with the value's text,
  escaped, so data can never end the string or add keys. A hole **outside quotes** takes the value as JSON
  (a number, true/false, null, a list or a record). The payload must come out as a record; if it does not
  parse, the button does nothing and the warning says why. No payload sends `{}`.
* The command runs with cause `ui`. While it runs the button has the class `ss-busy` and
  `aria-busy="true"`, and further clicks are ignored. What it returns (a receipt or a plain refusal such as
  "There is no Minor Healing Draught left.") is shown by the mount.
* A `<button>` with `data-command` and no `type` is `type="button"`, so it never submits a form.

## 3. What a template may contain

Templates are sanitised: SillyTavern's DOMPurify first, then Story Block's own allow-list (the same rules
hold with or without DOMPurify).

* **Elements**: layout and text (`div`, `span`, `p`, `section`, `header`, `h1`–`h6`, `b`, `em`, `small`,
  `details`/`summary`, `figure`…), lists, tables, forms (`form`, `input`, `select`, `option`, `textarea`,
  `button`, `label`, `fieldset`, `output`, `progress`, `meter`), `img`, `a`, inline SVG (shapes, text,
  gradients, `use href="#…"`, `image`), and `ss-widget`.
* **Removed with what is inside**: `script`, `style`, `iframe`, `object`, `embed`, `link`, `meta`, `base`,
  `template`, `noscript`, `audio`, `video`, `canvas`, `dialog`, MathML, SVG `foreignObject` and the SVG
  animation elements. Other unknown elements are removed and their content kept.
* **Attributes**: each element's usual ones, `class`, `id`, `title`, `role`, `aria-*`, `data-*`. Never
  `on…` (no inline handlers), `action`, `formaction`, `srcdoc`, `srcset`, `data-ss-*` (Story Block's own).
  `input type="password" | "file" | "image"` are not available.
* **URLs**: images (`src`) `https:` or `data:image/…`; links `https:` or `#…` (with `target="_blank"` they
  get `rel="noopener noreferrer"`); SVG `href` `#…`. A bound URL is checked again after it is filled, so data
  holding `javascript:` never reaches the page. A URL attribute that is only a hole (`src="{{ x }}"`) is
  removed by the sanitiser: write `data-bind-attr="src: x"`, or start it with `https:`
  (`src="https://cdn.example/{{ x }}.png"`).
* **Inline `style`** goes through the same checks as screen CSS (§4) and is never bound: `{{ }}` inside
  `style` is dropped. Use `data-bind-var` and CSS variables.
* **Tables**: write `<tbody>` yourself and keep text inside cells; browsers move stray text out of tables.

### 3.1 Ids, names and reserved classes

A screen shares the page with SillyTavern and with other screens, so a few things are renamed or refused:

* **Ids** are drawn as `ss-t-<screen>-<id>` (`id="hp"` in `rpg-battle/party` becomes `ss-t-rpg-battle-party-hp`).
  What points at an id is rewritten to match: `#id` selectors in the screen's CSS, `for`, `aria-*` id lists
  (`aria-labelledby`, `aria-describedby`, …), `href="#id"` and `url(#id)` in SVG paint. Attribute selectors
  such as `[id="hp"]` are **not** rewritten and match nothing: write `#hp`. A screen drawn more than once at
  a time (a card under every reply, a tab and a hud) gives each other copy its own ids and control names
  (`ss-t-rpg-battle-party-hp--c2`), so a label or a radio group stays in its own copy; the screen's `#id`
  CSS reaches every copy.
* **Form names**: a `<form name="…">` gets the same prefix, so it never takes over a `document.<name>`.
  Control names SillyTavern reads as its own radio groups (`character_names`, `continue_postfix`,
  `extension_default_position`, `extension_floating_char_position`, `extension_floating_position`) are
  removed, written or bound; use your own names.
* **Reserved classes**: the classes SillyTavern's own handlers and lookups act on (`mes`, `mes_text`,
  `swipe_left`, `swipe_right`, `mes_edit`, `select_chat_block` and the rest of `RESERVED_CLASSES` in
  `src/v2/view/template/sanitize.js`) are refused in `class`, bound class lists and `data-class`, so a
  template button can't edit, swipe or delete a message. `menu_button` (SillyTavern's button look, with no
  handler of its own) is allowed for styling.
* **CSS URLs**: write every quoted URL in screen CSS (custom properties included) as `https:` or a raster
  `data:` image (PNG, JPEG, GIF, WebP). Other schemes drop the declaration, and a pack whose text holds a
  `data:image/svg` or `data:text/html` URL is refused at install.

## 4. CSS and themes

A screen's `css` is scoped to its root, `[data-ss-screen="<id>"]`:

* every selector gets the root in front, inside `@media`, `@supports`, `@container` and `@layer` too;
  `:root`, `html`, `body`, `:host` and `:scope` mean the root itself (`:root { --gap: 4px }`);
* `@keyframes pulse` becomes `@keyframes ss-<id>-pulse`, and `animation` / `animation-name` in the same
  sheet are renamed with it;
* dropped: `@import`, `@charset`, `@namespace`, `@page`, other at-rules, `position: fixed`, `behavior`,
  `-moz-binding`, `expression(…)`, and any declaration with a `url()` that is not `https:` or `data:`;
* `@font-face` is allowed with `https:`/`data:` sources;
* at most 64 KB; a larger sheet is not used at all.

`theme: { '--ss-accent': '#7c5cff' }` sets custom properties on the screen root. Story Block's default theme
follows SillyTavern's colours (`--SmartThemeBodyColor`, `--SmartThemeBlurTintColor`, …), so a screen that
writes `color: var(--ss-accent, var(--SmartThemeQuoteColor))` fits any theme.

Every drop adds a plain sentence to the screen's warnings.

## 5. Widgets

```html
<ss-widget name="ss.meter" data-props='{"bind":"q.pc.hp","label":"HP","tone":"hp"}'></ss-widget>
<ss-widget name="ss.badge" data-props='{"label":"{{ c.kind }}","counter":{{ c.turns }},"unit":"turns left"}'></ss-widget>
```

* `name` is namespaced: Story Block's `ss.meter`, `ss.radar`, `ss.map`, `ss.skill-tree`, `ss.portrait`,
  `ss.badge`, `ss.timeline`, `ss.stepper`; modules' own use their id (`rpg-battle.battle-board`).
* `data-props` is JSON with holes, filled like a payload, nested at most 16 deep (as `data-payload`); a pack
  screen with deeper JSON is refused, and a deeper one drawn shows the widget's "failed" line. `"bind": "<path or expression>"` adds the bound
  data as `value` (a record's fields become the widget's props, e.g. `{ cur, max }` for a meter; see the
  widget reference for each widget's props).
* The `ss-widget` element belongs to the widget. It is drawn again only when its props change. An unknown or
  failing widget shows one line saying so (class `ss-widget-missing`) and the rest of the screen still works.
* Inside a dialog, widgets read and write the draft (`ss.stepper` does).

## 6. Forms and the draft

Inputs never write the state. They fill a **draft** held by the dialog (SPEC §13.6); a wizard's steps share
it; the last step sends it as **one command**, and that command's code checks every rule (points budget,
allowed picks) and refuses with a plain sentence when one is broken.

| Input | Draft value |
|---|---|
| `<input>` (text, search, email…), `<textarea>` | the text |
| `<input type="number">`, `type="range"` | a number; an empty field is `null`; text that is not a number leaves the draft as it was |
| `<select>` | the chosen option's `value` |
| `<input type="radio" value="…">` | the checked one's `value` (a word) |
| `<input type="checkbox">` | `true` / `false` |
| `<input type="checkbox" value="…">` (several with the same `data-draft`) | the list of checked values |

* `data-draft="stats.STR"` writes `draft.stats.STR` (a leading `draft.` is allowed and means the same).
  Keys can come from a loop: `data-draft="stats[k]"` inside `data-each="q.rules.stats as k"`.
* The draft shows in the inputs (seed it with defaults: the dialog's starting draft). A field the reader is
  typing in is never overwritten.
* After each change the screen renders again, so text that reads the draft (`{{ draft.name }}`) follows.
* `<form data-submit="party.create">`: Enter or a submit button sends the draft; the page never navigates.
  `data-submit` on another element sends it on click. In a dialog, the dialog runs the submit (and
  "Next" on earlier steps).

## 7. For hosts (wiring)

```js
import { compileTemplate, renderTemplate } from './src/v2/view/template/index.js';
import { conditionEvaluator, makeScope } from './src/v2/view/bind.js';
import { compile, evaluate } from './src/v2/events/index.js';

const compiled = compileTemplate(screen.template, { sanitize: SillyTavern.libs.DOMPurify.sanitize });
const view = renderTemplate(el, compiled, scope, {
  evaluate: conditionEvaluator({ compile, evaluate }),
  widgets,                                  // { 'ss.meter': { render(el, props, api) } } | Map | name => def
  command: sdk.command, api: { query, preview, commit, on },
  onDraft: (path, value, draft) => {}, onResult: (result, { type, payload }) => {}, onWarn: message => {},
  onSubmit: (type, draft) => {},            // optional: a dialog that runs submits itself (wizard steps)
  formatters: { money: n => '…', time: m => '…' },
});
view.warnings; view.draft(); view.update(nextScope); view.destroy();
```

* `scope` is `makeScope({ state, q, draft, settings, query, changed | ops, formatters })`, or those fields as
  a plain object (the mounts' `{ state, q, draft, settings, changes, mount, index, screenId, api }` works
  as it is; `api.command` runs the buttons when no `command` is given).
* Rendering again into the same element with the same compiled template patches it; another template
  replaces it.
* A draft given as a plain (unfrozen) record is filled in place, so the dialog always holds the reader's
  input; a frozen one is copied and kept by the view (`view.draft()`).
* `css.js`: `scopeCss(css, screenId) → { css, warnings }`, `themeVars(theme) → { vars, warnings }`.

---

## Example 1: character HUD card

A strip above the message box (and a tab) with the hero's portrait, HP and EXP bars drawn by CSS variables,
status badges with turns left, and the time and place. Mounts: `hud`, `tab`.

```js
{
  id: 'rpg-battle/hud', title: 'Hero', icon: 'fa-heart', mounts: ['hud', 'tab'],
  data: {
    pc: { query: 'party.pc' },                               // the actor record (MODULES B1)
    xp: { query: 'party.xpToNext', args: { actor: '$pc.id' } },   // { have, need }: your rules' query
  },
  theme: { '--ss-accent': '#c9a227', '--ss-hp': '#d9534f', '--ss-xp': '#5bc0de' },
  template: /* below */, css: /* below */,
}
```

```html hud-card
<div class="hud" data-if="q.pc != null"
     data-class="hurt: ratio(q.pc.hp.cur, q.pc.hp.max) < 0.3; down: q.pc.hp.cur == 0"
     data-bind-var="--hp: ratio(q.pc.hp.cur, q.pc.hp.max); --xp: ratio(q.xp.have, q.xp.need)">
  <ss-widget name="ss.portrait" class="face"
             data-props='{"src":"{{ q.pc.portrait }}","name":"{{ q.pc.name }}","frame":"rounded","size":"lg"}'></ss-widget>
  <div class="main">
    <div class="who">
      <b data-bind="q.pc.name"></b>
      <span class="lv">Lv {{ q.pc.level }}</span>
      <span class="role" data-if="q.pc.role != ''">{{ q.pc.role }}</span>
    </div>
    <div class="bar hp" title="HP {{ q.pc.hp.cur }} / {{ q.pc.hp.max }}">
      <i></i><span>HP {{ q.pc.hp.cur }} / {{ q.pc.hp.max }}</span>
    </div>
    <div class="bar xp" title="EXP {{ q.xp.have }} / {{ q.xp.need }}">
      <i></i><span>EXP {{ pct(q.xp.have, q.xp.need) }}%</span>
    </div>
    <div class="status">
      <span class="badge" data-each="q.pc.conditions as c" data-class="long: c.turns != null && c.turns > 3">
        {{ c.kind }}<small data-if="c.stacks > 1">×{{ c.stacks }}</small><em data-if="c.turns != null">{{ c.turns }}</em>
      </span>
      <span class="none" data-if="len(q.pc.conditions) == 0">No conditions</span>
    </div>
  </div>
  <div class="where">
    <span class="time" data-if="state.director.time.minutes != null">{{ fmt.time(state.director.time.minutes) }}</span>
    <span class="place" data-class="moved: changed('state.scene.place')">{{ state.scene.place.name }}</span>
  </div>
</div>
```

```css hud-card
.hud { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: center;
       padding: 6px 10px; border-radius: 10px; color: var(--SmartThemeBodyColor, #ddd);
       background: var(--SmartThemeBlurTintColor, rgba(20, 20, 30, .8));
       border: 1px solid color-mix(in srgb, var(--ss-accent) 40%, transparent); }
.who { display: flex; gap: 6px; align-items: baseline; }
.who b { color: var(--ss-accent); }
.lv, .role { font-size: .8em; opacity: .75; }
.bar { position: relative; height: 12px; margin: 3px 0; border-radius: 6px; overflow: hidden;
       background: rgba(255, 255, 255, .08); }
.bar > i { position: absolute; inset: 0 auto 0 0; border-radius: inherit; transition: width .4s ease; }
.bar.hp > i { width: calc(var(--hp, 0) * 100%); background: var(--ss-hp); }
.bar.xp > i { width: calc(var(--xp, 0) * 100%); background: var(--ss-xp); }
.bar > span { position: relative; display: block; padding: 0 6px; font-size: 9px; line-height: 12px; }
.hurt .bar.hp > i { animation: pulse 1s ease-in-out infinite; }
.down { filter: grayscale(1); }
.status { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
.badge { display: inline-flex; gap: 3px; align-items: center; padding: 0 6px; border-radius: 9px;
         font-size: 10px; background: rgba(255, 255, 255, .1); }
.badge em { font-style: normal; min-width: 14px; text-align: center; border-radius: 7px;
            background: var(--ss-accent); color: #000; }
.badge.long em { background: #888; }
.none { font-size: 10px; opacity: .5; }
.where { text-align: right; font-size: 11px; line-height: 1.5; }
.where .moved { color: var(--ss-accent); }
@keyframes pulse { 50% { opacity: .55; } }
@media (max-width: 600px) { .where { display: none; } .hud { grid-template-columns: auto 1fr; } }
```

`q.pc.conditions` is the actor's list (`{ kind, stacks }`, MODULES B1); a counter shows when the rules record
`turns` on a condition. `q.pc.portrait` is whatever the host gives the PC (the persona avatar, MODULES F11);
without one, `ss.portrait` draws initials.

## Example 2: inline status card under each reply

A small card under each reply showing **that reply's** state: time, place, the next event, the current goal
and its progress. Things that reply changed are marked; with the reader's "only what changed" setting the
card shows only those lines. Mount: `card`.

```js
{
  id: 'story-director/status', title: 'Status', icon: 'fa-compass', mounts: ['card'],
  data: {
    events: { query: 'director.threads', args: { kind: 'event', status: 'active' } },
    quests: { query: 'director.threads', args: { kind: 'quest', status: 'active' } },
    progress: { query: 'quest.progress', args: { id: '$quests.0.id' } },   // { have, need, met }
  },
  theme: { '--ss-accent': '#7c5cff' },
  template: /* below */, css: /* below */,
}
```

```html status-card
<div class="status-card" data-class="quiet: settings.onlyChanged == true">
  <div class="row" data-if="settings.onlyChanged != true || changed('state.director.time')"
       data-class="new: changed('state.director.time')">
    <span class="k">Time</span><span class="v">{{ fmt.time(state.director.time.minutes) }}</span>
  </div>
  <div class="row" data-if="settings.onlyChanged != true || changed('state.scene.place')"
       data-class="new: changed('state.scene.place')">
    <span class="k">Place</span>
    <span class="v">{{ state.scene.place.name }}<small data-if="state.scene.place.region != ''"> · {{ state.scene.place.region }}</small></span>
  </div>
  <div class="row" data-if="len(q.events) > 0 && settings.onlyChanged != true">
    <span class="k">Next</span>
    <span class="v">{{ q.events[0].summary }}<small data-if="q.events[0].fields.due != null"> — due {{ q.events[0].fields.due }}</small></span>
  </div>
  <div class="row goal" data-if="len(q.quests) > 0 && (settings.onlyChanged != true || changed('state.director.threads'))"
       data-bind-var="--done: ratio(q.progress.have, q.progress.need)"
       data-class="met: q.progress.met == true">
    <span class="k">Goal</span>
    <span class="v">
      <b>{{ q.quests[0].key }}</b> — {{ q.quests[0].fields.goal }}
      <span class="track" data-if="q.progress.need > 0"><i></i></span>
      <small data-if="q.progress.need > 0">{{ q.progress.have }} / {{ q.progress.need }}</small>
    </span>
  </div>
</div>
```

```css status-card
.status-card { margin: 4px 0; padding: 6px 10px; border-left: 3px solid var(--ss-accent);
               border-radius: 6px; font-size: 12px; background: rgba(127, 127, 127, .08); }
.row { display: flex; gap: 8px; line-height: 1.6; }
.k { flex: 0 0 44px; opacity: .6; text-transform: uppercase; font-size: 10px; }
.v { flex: 1; }
.v small { opacity: .7; }
.new .v { color: var(--ss-accent); }
.new .k::after { content: " •"; color: var(--ss-accent); }
.track { display: inline-block; vertical-align: middle; width: 80px; height: 6px; margin: 0 4px;
         border-radius: 3px; background: rgba(127, 127, 127, .25); overflow: hidden; }
.track > i { display: block; height: 100%; width: calc(var(--done, 0) * 100%); background: var(--ss-accent); }
.goal.met .track > i { background: #5cb85c; }
```

`changed('state.director.time')` is true only on the reply whose changes moved the clock, so the card under
an older reply keeps its own highlights. `settings.onlyChanged` is the reader's toggle from the module's
settings; written as `!= true` it also works while the setting has never been set.

## Example 3: points-buy character form

The character-creation dialog: a name, a race, steppers for each stat, a short note, and **Create**, which
sends the whole draft to `party.create`. The steppers keep each stat between the rules' minimum and maximum;
`party.create` checks the points budget and every pick, and refuses with a sentence the dialog shows
("You spent 14 points; you have 12."). Mount: `dialog`.

```js
{
  id: 'rpg-battle/create', title: 'New character', icon: 'fa-user-plus', mounts: ['dialog'],
  data: { rules: { query: 'party.creation' } },
  // → { points: 12, min: 1, max: 8, stats: ['STR','VIT','AGI','DEX','INT','LUK','CHA'],
  //     races: [{ id, name, note }], talents: [{ id, name }] }
  template: /* below */, css: /* below */,
}
// The dialog starts with a draft that has every stat at the minimum:
// { name: '', race: '', stats: { STR: 1, VIT: 1, … }, talents: [] }
```

```html points-buy
<form class="create" data-submit="party.create">
  <label class="field">Name
    <input data-draft="name" placeholder="Who are you?" maxlength="40" required>
  </label>
  <label class="field" data-if="len(q.rules.races) > 0">Race
    <select data-draft="race">
      <option value="">Choose…</option>
      <option data-each="q.rules.races as r" data-bind-attr="value: r.id; title: r.note">{{ r.name }}</option>
    </select>
  </label>
  <fieldset class="stats">
    <legend>Stats <small>{{ q.rules.points }} points to spend · {{ q.rules.min }}–{{ q.rules.max }} each</small></legend>
    <div class="stat" data-each="q.rules.stats as k">
      <ss-widget name="ss.stepper"
                 data-props='{"name":"stats.{{ k }}","label":"{{ k }}","value":{{ draft.stats[k] }},"min":{{ q.rules.min }},"max":{{ q.rules.max }}}'></ss-widget>
    </div>
  </fieldset>
  <fieldset class="talents" data-if="len(q.rules.talents) > 0">
    <legend>Talents</legend>
    <label data-each="q.rules.talents as t">
      <input type="checkbox" data-draft="talents" data-bind-attr="value: t.id"> {{ t.name }}
    </label>
  </fieldset>
  <label class="field">Note
    <textarea data-draft="note" rows="2" placeholder="Anything the story should know"></textarea>
  </label>
  <button type="submit" class="menu_button">Create {{ draft.name }}</button>
</form>
```

```css points-buy
.create { display: grid; gap: 10px; }
.field { display: grid; gap: 3px; font-size: 12px; }
.stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px;
         border: 1px solid rgba(127, 127, 127, .3); border-radius: 8px; padding: 8px; }
.stats legend small { opacity: .7; font-weight: normal; }
.talents label { display: inline-flex; gap: 4px; margin-right: 10px; }
button[type="submit"] { justify-self: end; }
```

Each `ss.stepper` writes its stat into the draft (`api.onDraft('stats.STR', 5)`), and the form renders
again from the draft. Without the widget, a plain number field does the same job:
`<input type="number" data-draft="stats[k]" data-bind-attr="min: q.rules.min; max: q.rules.max">`.

**Points left.** When the draft keeps the points spent on each stat (`points: { STR: 0, VIT: 0, … }`,
the way RPG Battle's creation wizard does), `sum(draft.points)` is what is spent so far. Give it to each
stepper as `spent` with the budget as `pool`: the stepper shows "Points left: 5" and stops at the budget,
and the legend gets the class `over` once more is spent than the budget. The rule itself still lives in `party.create`.

```html
<fieldset class="stats">
  <legend data-class="over: sum(draft.points) > q.rules.points">
    Stats <small>{{ sum(draft.points) }} of {{ q.rules.points }} points spent</small>
  </legend>
  <div class="stat" data-each="q.rules.stats as k">
    <ss-widget name="ss.stepper"
               data-props='{"name":"points.{{ k }}","label":"{{ k }}","value":{{ draft.points[k] }},"min":0,"max":{{ q.rules.max }},"pool":{{ q.rules.points }},"spent":{{ sum(draft.points) }}}'></ss-widget>
  </div>
</fieldset>
```
