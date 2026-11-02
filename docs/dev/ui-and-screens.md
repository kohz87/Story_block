# UI and screens

How every screen, card and tab is drawn. Detail: SPEC §13 (screen definition, templates, CSS, mounts,
widgets, wizards, precedence), TEMPLATES.md, WIDGETS.md, LAYOUTS.md; MODULES §F (F9 widget names, F92 Inspector,
F93 save points, F95/F96 story-driven, F100 Features); REVIEW.md risky part §4. Reader's view: GUIDE.md "Screens".

## Rules

- Every screen is **data**: `{ id, title, icon, mounts, template | layout, css, theme, data, steps }`. Modules
  register defaults with `registerModule({ screens })`; packs and cards override by `id`. Precedence per id:
  reader's choice, card, pack, module default.
- Code enters only through **widgets** (`registerModule({ widgets })`, names `<module>.<name>`); Story Block
  ships `meter`, `radar`, `map`, `skill-tree`, `portrait`, `badge`, `timeline`, `stepper`.
- **No markup or script from text.** Templates are an HTML subset sanitised by SillyTavern's DOMPurify plus
  Story Block's allow-list; values are bound as text only; URLs checked again after binding; ids and form names
  prefixed per screen; reserved SillyTavern classes and control names refused. Styling from data goes through
  CSS variables (`data-bind-var`).
- CSS is scoped to `[data-ss-screen="<id>"]`, filtered (`@import`, `position: fixed` dropped; `url()` only
  `data:`/`https:`), 64 KB limit. Form controls take SillyTavern's theme colours (`view/controls.css`).
- Mounts: `tab` (head), `screen` (game view), `card` (that reply's state, under each reply), `hud`, `dialog`
  (head + draft). Wizards fill a draft; the last step submits one command; a random button uses
  `preview` / `commit(token)` so the roll shown is the roll kept.
- **Story-driven:** no buttons for story actions (fight, travel, talk); bag management (use, equip, sell) is fine.
- `data-command` buttons run a command through the public sdk with cause `ui`; internal commands
  (`capture.*`, `module.init.*`, `events.fire`) are never callable from a screen.
- Navigation order (tabs and game view): Home first, then `SUITE_NAV` in `DEFAULT_ORDER` (party, inventory,
  quests, world, map, fight, crafting, trade, scene, chronicle, director, then NSD's Dossiers, id
  `npc-state-delta/cast`, last), others by `order` (`REST_ORDER` 150 without one). `DEFAULT_HIDDEN`: Scene is
  hidden by default while the screen that shows the same and more is registered (F119). The reader's order and hidden tabs
  (`extension_settings.storySuite.tabs`, `view/tab-order.js`) win over both.
- Every optional screen carries its Feature; off, it is not drawn.

## The look: tokens, theme bridge, building blocks (UI stage, step 1a)

One look for every Story Suite screen: glass panels over SillyTavern's background, light or dark, in
Nunito (the approved concept; accent `#7b6cf0`). Three parts:

- **Tokens** (`src/v2/view/theme.js` `themeTokens`): custom properties on every Story Suite root
  (`THEME_ROOTS`, the same list as controls.css: `.story-suite-overlay`, `.story-suite-sheet`, `.ss-gameview`,
  `.ss-dialog`, `.ss-cards`, `.ss-card`, `.ss-hud`, `[data-ss-screen]`, and since step 4a `.story-suite-bar`,
  `.story-suite-extras`, `.story-suite-reply-note`: the bar, the Choices strip and the notes, which sit in the chat), always under `:where()`.
  Colours: `--ss-glass`, `--ss-glass-strong`, `--ss-tile`, `--ss-border` (the edge of a control and a card), `--ss-rule` (the rule of a section label: the concept's colour per scheme, `rgba(255,255,255,.22)` dark and `rgba(35,37,58,.22)` light, from SillyTavern's text colour in Follow SillyTavern; at least 1.5:1 against the card in all six looks, measured), `--ss-shadow` (a whole
  box-shadow), `--ss-text`, `--ss-muted`, `--ss-track`, `--ss-accent`, `--ss-accent-soft`, `--ss-pill`,
  `--ss-pill-text`, `--ss-badge`, `--ss-badge-text`, `--ss-field`, `--ss-overlay`, `--ss-good`, `--ss-chatter`,
  `--ss-blur` (a backdrop-filter value). Bars `--ss-hp`, `--ss-mp`, `--ss-sp`, `--ss-exp`; `--ss-tick`, `--ss-bad`,
  `--ss-warn`, `--ss-info`; rarities `--ss-uncommon`, `--ss-rare`, `--ss-epic`, `--ss-legendary`; `--ss-on-ring`.
  Sizes `--ss-radius-s|m|l|xl|xxl|pill` (10/14/18/22/26 px, 999px), `--ss-space-1…5` (4/8/12/16/24 px),
  `--ss-font`, `--ss-motion` (0.2s; 0s under reduced motion), `--ss-scheme` (`dark`, `light` or `sillytavern`).
  The legacy names `--ss-text`, `--ss-border`, `--ss-accent`, `--ss-muted`, `--ss-shadow` (mounts.css `:root`) are
  now these tokens inside the roots, so existing screens take the look's colours; with Panel style "Follow
  SillyTavern only" they are SillyTavern's again, exactly as before. A screen's `theme` still wins (inline).
- **Theme bridge** (`createThemeBridge`, started by `ui-host.js` `mountUi`): one `<style data-ss-theme>` in the
  head (`themeCss({ scheme, panel, font })`). Light or dark from SillyTavern's `--SmartThemeBodyColor` against
  `--SmartThemeBlurTintColor` (`decideScheme`: lighter text than tint is dark; a tint under 35% alpha leaves it
  to the text; nothing readable: dark); a share (30%) of the tint's COLOUR is mixed into the glass, never its
  opacity: the glass's alpha is the reader's **Glass strength** (`glassStrength`, a slider 30–90%, default 50; at
  50% the concept's: dark 0.50 / strong 0.66, light 0.55 / 0.72, `glassAlphas`), so the page behind always shows
  (the mix uses relative colours, `@supports`; without them the plain concept colour). Solid and Follow
  SillyTavern ignore it. Blur is `blur(16px) saturate(1.2)`. Re-read when
  SillyTavern changes `<html>`'s style (a MutationObserver). Host settings (Settings → Story Suite):
  **Panel style** `panelStyle` = `glass` (default) | `solid` (no blur, opaque glass) | `sillytavern` (its own
  colours and blur); **Font** `font` = `nunito` (default) | `theme` (`--mainFontFamily`). Nunito ships with the extension
  (`assets/fonts/nunito/`, woff2 latin and latin-ext in 400/600/700/800, SIL OFL in `OFL.txt`, `@font-face` in
  `view/fonts.css`), so it is the same offline and with "Forbid external media" on; nothing is fetched. Fallback
  `system-ui`. A parent that sets its own background or a filter hides the page from the glass inside it, so the
  legacy surfaces (the side sheet `.story-suite-sheet`, the game view `.ss-gameview`) are glass themselves under Glass:
  the theme sets `--ss-sheet-bg` (the dense glass, so Glass strength reaches it), `--ss-sheet-blur` and
  `--ss-sheet-layers: none`, and host.css / mounts.css paint `var(--ss-sheet-bg, <the old tint>)`. Solid and Follow
  SillyTavern leave the three unset (and `prefers-reduced-transparency` resets them to `initial`), so those surfaces
  keep SillyTavern's tint exactly as before. The settings window's layer (`.story-suite-overlay`) is only a scrim now.
  Since step 4a the HUD strip and the dialog mount are glass under Glass as well: their background and blur come from `--ss-sheet-bg`
  and `--ss-sheet-blur`, their shape from `--ss-sheet-radius`, `--ss-sheet-edge` and `--ss-sheet-shadow` (set under Glass only, each read
  with the old value as fallback, so Solid and Follow SillyTavern keep those frames). `prefers-reduced-transparency` turns Glass into Solid; `prefers-reduced-motion`
  sets `--ss-motion: 0s`. SillyTavern's own "No blur effect" (`body.no-blur`) still removes every blur. The
  class `ss-scheme-light` / `ss-scheme-dark` inside a root forces a scheme there (`data-ss-*` attributes are
  reserved by the sanitiser, so it is a class). Nothing is set on SillyTavern's elements.
- **Building blocks** (`src/v2/view/glass.css`, loaded by host.css): plain classes any template can use, every
  rule `:where(<roots>) .ss-…` (one class of weight, so `[data-ss-screen="id"] .x` in a screen's CSS wins):
  `.ss-glass` (card: glass, blur, hairline, shadow, radius l; children in a column, gap 12px),
  `.ss-glass-strong` (denser, radius xl), `.ss-label` (section label: small caps, spaced, muted),
  `.ss-pill` (+ `.ss-pill-soft`, `.ss-pill-outline`), `.ss-bar` > `.ss-bar-head` (`.ss-bar-label`,
  `.ss-bar-value`) + `.ss-bar-track` > `.ss-bar-fill` (width from `--ss-fill` 0–1; colour `.ss-bar-hp|mp|sp|exp`),
  `.ss-tile` > `.ss-tile-box` (`.ss-tile-icon`, `.ss-tile-count` [+ `.ss-tile-corner`], `.ss-tile-mark`) +
  `.ss-tile-label`, states `.ss-tile-ready`, `.ss-tile-locked`, `[aria-pressed="true"]`; `.ss-status` >
  `.ss-status-icon` + `.ss-status-left`; ring colours `.ss-tone-<neutral|accent|good|warn|bad|info|uncommon|rare|epic|legendary>`
  (they set `--ss-ring`). The same as widgets: `ss.tile`, `ss.bar`, `ss.status`, `ss.pill` (WIDGETS.md).
  A template uses either:

  ```html
  <section class="ss-glass">
    <p class="ss-label">Party</p>
    <ss-widget name="ss.bar" data-props='{"label":"HP","kind":"hp","value":{{ q.pc.hp.cur }},"max":{{ q.pc.hp.max }}}'></ss-widget>
    <div class="ss-bar ss-bar-mp"><div class="ss-bar-track" data-bind-var="--ss-fill: ratio(q.pc.mp.cur, q.pc.mp.max)"><div class="ss-bar-fill"></div></div></div>
  </section>
  ```
- **Type scale** (the concept's): section label 15px / 600 / 1.4px spacing / uppercase / muted; bar head 13px /
  600 / 0.8px / uppercase, label muted and value 700 in the text colour; names 800; body 14px / 400–600; pill
  3px 10px, 14px / 600; status badge 44px with a 12px / 700 counter chip; bar track 7px, fully round, flat fill.
- **Blocks built from them** (step 1b; the widgets' props and keys are in WIDGETS.md): `ss.hero` (`.ss-hero`, `-body`,
  `-portrait`, `-who`, `-name`, `-pill`, `-corner`, `-vitals`, `-pools`, `-exp`, `-statuses`, `-compact`): the
  portrait from a safe URL or a `portraitQuery` (Delta's `npc.portrait`), the initial as fallback, the Terms' word on the
  experience bar, a container query at 600 px for the wide layout; `ss.tiers` (`.ss-tiers`, `-tier`, `-link`, `-dot`,
  `-line`, `-label`, `-grid`: `ss.tile`s in a glass grid of `--ss-cols` columns, a connector between tiers);
  `ss.listcard` (`.ss-listcard`, `-head`, `-rows`, `-row`, `-item`, `-icon`, `-main`, `-title`, `-sub`, `-value`,
  `-tag` + `.ss-tone-*`); `ss.tabs` and `ss.navbar` (`.ss-tabs`, `-list`, `-item`, `-icon`, `-label`, `-count`; the same
  for `ss-navbar`; `nav.js`: roving tabindex, arrows/Home/End, `revealItem` scrolls the row, not the page);
  `ss.dialog` (`.ss-modal`, `-panel`, `-head`, `-title`, `-close`, `-text`, `-foot`, `-action` + `-primary|plain|danger`;
  a fixed panel placed from the top with `100dvh`, `--ss-scrim` behind it; the dialog mount keeps `ss-dialog*` until step 2).
  A new token, `--ss-scrim`. `[hidden]` inside a Story Suite root is `display: none !important`, so a block can hide a part
  whatever display it gives it. One thing to remember when adding a block with a tone: a block must not set `--ss-ring`
  itself (it would beat the `.ss-tone-*` rules, which come earlier); read `var(--ss-ring, <default>)` (a test guards it).
- **The UI sample** (`src/v2/screens/ui-sample.js`, developers): Settings → Diagnostics → **Show the UI
  sample** draws every block in a light and a dark pane (no background of their own, over see-through colour
  blobs and stripes on SillyTavern's background), through DOMPurify and
  the allow-list like any screen. Not a tab or a game-view screen. For checking a theme and for screenshots.
- Conventions for the next blocks: class names `ss-<block>` and `ss-<block>-<part>`, states as
  `ss-<block>-<state>` classes or ARIA attributes, colours and sizes only from the tokens, every rule under
  `:where(<roots>)` at one class; a widget for a block with structure or ARIA (`ss.<block>` in
  `view/widgets/glass.js` style: `shell()`, the block's class on the root, tones from a fixed list, spoken text).

## The form engine (UI stage, step 1b PR B)

`src/v2/view/form/` draws a module's settings from the schema the registry holds (`registry.settingsDefs()`; SPEC §6) in
the look, and writes through the same settings store the settings window writes through. The settings window (below)
draws every section with it (steps 3b to 3g). The UI sample shows a demo form
(`mountDemoForm`, `UI_SAMPLE_FORM`).

```js
import { renderSettingsForm, renderModuleForm } from './src/v2/view/form/index.js';

const form = renderSettingsForm(parent, {
    moduleId: 'example-module',          // null: the host's own schema (HOST_SETTINGS_SCHEMA)
    schema,                          // { key: field } as registered
    settings,                        // createSettings(): settings(id) → values, settings.set(id, key, value) → stored or undefined
    doc, title, hint,
    featureOn: id => registry.featureOn(id),   // a field with `feature` shows while this says true
    profiles: () => listProfiles(),            // the Connection Manager answer for `profile` fields (default: the page's)
    search: true,                              // a search box on top
    onChange: ({ moduleId, key, value }) => {}, // after a value was stored (apply the look, redraw a size)
    memo: new Map(), disabled: false,
});
form.filter('coin');     // → how many rows are shown; label, help, group and key are searched
form.refresh();          // read every value and feature again
form.setDisabled(true);  form.field('days');  // { row, handle, kind, f, setError }
form.destroy();
renderModuleForm(parent, def, { settings, doc });   // def = one settingsDefs() entry
```

- **Kinds** (`fieldKind(field)`): `bool` → switch; `int` → number, or slider with `form: 'slider'` and whole-number
  `min` < `max` (a `unit` text is shown after the value; a `format(n)` function says the value in words instead, and
  `sliderMax` < `max` is the range the slider offers, which grows to a larger stored value so it is never shown wrong); `choice` → select, chips (one of them) with `form: 'chips'`, or one joined row of buttons (the same radio group) with `form: 'segmented'` (Text size);
  `text` → text box (`multiline`: a text area with a character count when it has a `max`); `profile` → the Connection
  Manager select (`profileChoices`: "Same as chat", the profiles, a gone one kept as "(not found)", the note under the
  label; with nothing to pick but "Same as chat" the select is disabled and the note says why); `text` with `form: 'chips'` and `options`
  → `chipset`: several chips over the comma-separated text (`read(text)` → the entries; entries the options do not list are kept, never drawn
  and never dropped by a change); `list` → rows with Add and Remove, or one line per item for text and whole-number fields (`form: 'lines'`
  starts there; "Edit as text" / "Edit as rows"; `linesToList` / `listToLines`, the overlay's reader, so "Day: of Ash: 30"
  reads the same and a bad line is named). Several-of chips (`multiple: true`, a list of values) are a renderer of their own
  (`chipsField`); the store has no multi-valued type yet, so the form does not map a schema field to them. A type the
  engine does not know is not drawn and its value is kept.
- **Renderers** (`fields.js`): each `(ctx) → { el, input, get, set, setDisabled, setReadOnly, destroy }`; they report
  a choice through `ctx.onChange(value, { typed })` (a click, a change on blur or Enter, the end of a slider drag; never
  while typing) and never store anything. The row (`form.js`) writes with `settings.set(moduleId, key, value)`, shows the
  value stored (`set(stored)`), and says under the field what the store did to it (`changeNote`: "Set to 12, the most this
  allows.", "Cut to 8 characters…"; a refused value: "That could not be saved. The setting stays …"; text in a number
  box: "Enter a whole number. The setting stays 5."). In a list, a row's own number box that moved or refused a value is
  named by row and field ("Row 3, Worth: Set to 1000000, the most this allows."), and rows the store left out are counted
  ("Only 100 of the 120 rows could be kept."). A field's own `check(value)` adds what only its module knows after the value is
  stored (the Coins field: "Coin 4 (silver) is named like an earlier coin, so it is not used."), a sentence or nothing. Options
  `quiet` (no "N settings shown" or "No settings match" line: a window around the form says it) and `className` (another class
  on the form) are for a form inside such a window. **`sources`** (`{ key: { get(), set(value) } }`) puts a field's value somewhere other than the module's
  settings (the Assist page's switches live in the feature store): the row reads with `get()` (a throw reads as empty) and writes with `set(value)`, whose
  answer is the stored value, or `undefined` for a refusal, which shows the old value again. A field with a `format` function follows the other values after any change.
- **Rows**: `.ss-field` with `.ss-field-label` (a `label` for the controls that can be named by `for`, a `span` plus
  `aria-labelledby` for chips and lists), `.ss-field-help`, `.ss-field-note`, `.ss-field-tag` ("Read only", or the field's `lockText`, a sentence or a function of the values, which says why it is locked; `.ss-field-tag-why`), the control, and
  `.ss-field-error` (`role="alert"`). The control carries `aria-describedby` (help, note, read-only tag, error) and
  `aria-invalid` while there is an error. Groups are the overlay's (`groupFields`: a field's `group`, else the label's
  "Group: " prefix, else General): a `.ss-section` glass card each, no heading when there is only one.
- **States**: `readOnly` (true, or a function of the module's values) locks the control (text and numbers `readonly`
  + `aria-readonly`, the rest `disabled`) and shows "Read only"; `shows(values)` is what a read-only row displays, the
  stored value kept; rows that depend on the values follow after any change; `disabled` on the whole form.
- **Keyboard and screen readers**: a switch is a `button` with `role="switch"` and `aria-checked`; one-of chips a radio
  group with arrow keys, Home and End (one Tab stop); several-of chips toggle buttons with `aria-pressed`; a slider a native
  range with `aria-valuetext`; the list's Remove names the item ("Remove Frostmoon"), the focus goes to the next
  Remove or to Add after a removal and to the new row's first field after an Add; the search box is `role="search"` with a
  hidden label, Escape clears it, and the count of rows shown is a polite live region.
- **How much to track** (`presets.js`, drawn at the top of the features form): a `role=radiogroup` of three `role=radio` tiles (Lean, Standard,
  Full: what each tracks, and "≈ N tokens of rules each reply" from `staticTextWith(registry, switches)`, built through
  `registry.withFeatures` so nothing is switched or stored; estimated at once, then counted by SillyTavern's tokenizer when it answers;
  left out when it cannot be built), a "Custom" tag (`role=status`) when no tile matches, the note under them, and a "Fine-tune" label
  over the module groups. The selected tile is derived from the switches on every paint (`selectedPreset`), never stored. A pick runs
  `applyPreset(store, name)`: the ordinary `set` for each in-preset, available feature not already as the preset says, and the usual
  `PROMPT_HINT` once when a changed feature alters the fixed prompt. Arrow keys move the focus (one Tab stop); Space, Enter or a click picks.
  The search hides the group. Features declare their part with `presets` (SPEC §Features).
- **The features form** (`features.js`, step 3b): `renderFeaturesForm(parent, { features, doc, onChange })`, Features (MODULES §F100) as
  switch tiles through the feature store (`list()`, `set(id, on)`; the settings store is not involved): one group per module by name
  (a labelled `section`, an `h4` and "N of M on" beside it, `data-fold="story-suite-features::<module id>"`, the heading
  `tabindex=-1` for `focusGroup(moduleId)`), a grid of tiles in it (`ss-features-grid`: two columns where there is room, one on a
  phone). A tile (`ss-feature`) is the name (a `label` for the switch), the description, a note when the feature changes the fixed prompt
  (`PROMPT_HINT`) and, for a feature whose `needs` no module meets, its reason with the switch off and disabled; the switch is the engine's
  `switchField`. `refresh()` updates in place (the focus stays on the switch) unless the set of features changed; `filter(text)` searches
  name, description, module name and id, leaves out groups with no match, returns the count. → `{ el, filter, refresh, field(id),
  group(moduleId), focusGroup(moduleId), setDisabled, keys, destroy }`. Classes: `ss-features`, `-group`, `-grid`, `ss-feature`
  (+ `-text`, `-name`, `-help`, `-cost`, `-why`, `-unavailable`). `sectionBlock` takes `level` (the heading's, default 3).
- **Looks that SillyTavern would spoil** (glass.css): every slider rule is `.ss-slider .ss-slider-input…` (a class heavier), because SillyTavern
  paints every `input[type="range"]` with a bar in its body colour (black on a light theme), a thumb in its tick colour and a hover filter,
  which beat a one-class rule. What clears the input's own box (background, border, box-shadow, filter, outline) is also `!important`, so a theme's lighter `!important` rule on `input[type="range"]` cannot paint a coloured box behind the track (`tests/v2/ux/glass-css.test.js`). The unfilled track is the `--ss-track` token (a faint tint of the text colour in a light scheme). A select
  ends in an ellipsis instead of clipping (`.ss-select`); the Look choices are short words ("Glass", "Solid", "Follow SillyTavern") whose
  help says what each is.
- **Classes** (glass.css): `ss-form`, `ss-section` (+ `-head`, `-title`, `-hint`, `-body`), `ss-field` (+ `-inline`,
  `-text`, `-label`, `-help`, `-note`, `-tag`, `-control`, `-error`, `-count`, `-readonly`, `-disabled`), `ss-input` (+ `ss-text`,
  `ss-number`, `ss-select`), `ss-switch` (+ `-on`, `-knob`), `ss-slider` (+ `-input`, `-value`; the fill is `--ss-fill`),
  `ss-chips`, `ss-chip` (+ `-on`), `ss-lines` (+ `-row`, `-cell`, `-remove`, `-add`, `-toggle`, `-text`, `-error`),
  `ss-search`. New tokens `--ss-off` (the switch's off track) and `--ss-knob`.
- The helpers shared with the settings window's folds (`groupFields`, `fieldReadOnly`, `rowValue`, `linesToList`, …) are
  imported from `host-ui.js` through `view/form/schema.js`: they move there when the last section leaves the folds.

## The settings window (UI stage, steps 3a to 3g)

`src/v2/view/settings/` is the settings window; `ui-host.js` `openSettings({ fold })` calls `openSettingsWindow`. It replaced
`openSettingsOverlay` (host-ui.js). Step 3a was the shell, with every section still drawing today's folds and rows; **step 3b made
Look and Features the form engine's, step 3c Money, step 3d Assist, step 3e Tabs & Packs, Blocks (`view/settings/blocks.js`: the page itself is `screens/blocks.js` `page`, shared with the block cards' Edit fields; the game view has no Blocks tab), step 3f Modules, step 3g Diagnostics** (below): every section has a body, and the legacy fold host (`renderSettingsHost`) is only used by tests.

- **Frame** (`window.js`; `settings.css`, imported by host.css after glass.css, every rule under `:where(<roots>)`): the layer
  `.story-suite-overlay#story_suite_v2_overlay` (a see-through scrim, **no** filter or background of its own, so the page reaches
  the window's glass) holds the window `.ss-settings` (`role="dialog"`, `aria-modal`, labelled by its title). Its children, in
  tab order: Close (`.ss-settings-close.story-suite-close`, **absolute at the window's top right on every width**), the side
  (`.ss-settings-side`: the `h2` "Story Suite", **the search box under it**, the rail) and the page (`.ss-settings-content`). From 760px
  a centred 1120 × 780 window, 26px radius, a grid of the 250px side and the page, a hairline between; on a phone full screen, the
  side stacked above the page (title row with Close, the search, then the rail as a row that scrolls sideways; no horizontal
  overflow at 390px: checked live). A page: a heading (`h3`, 22/26px, 800) and a line under it, then the body's pane; from 760px the
  heading row leaves room for Close.
- **Sections** (`sections.js`): `SETTINGS_SECTIONS`: **Look**, Features, Money, Assist, Tabs & Packs, Blocks, Modules, Diagnostics (id,
  label, Font Awesome icon, title, sub). Look is first in the rail; the window opens on Features (`DEFAULT_SECTION`). The **rail** is the `ss.tabs` block (`view/widgets/nav.js`, rendered with a
  command that selects): a `nav` of buttons, `aria-current="page"` on the chosen one, roving tabindex (one Tab stop, arrows, Home,
  End), `revealItem` on a phone. While a search is on, its count badge shows each page's matches.
- **Where today's folds go** (`routeOf`): Story Block's **Assist panel and Assist group → Assist** (both are the form engine's Assist page now,
  below, and so is its General group's Money page; the route is unused);
  the Story Suite fold (the budgets, Prompt size, its Tabs sub-fold) and Story Block's **Packs** fold → Tabs & Packs, which the
  form engine draws now (below; the Story Suite fold is gone, and `renderSettingsHost` leaves out an own fold whose section has a body of
  its own); every module's settings (what is left of Story Block's: the line to its features and
  its Inner chatter group) and **Versions** → Modules, which the form engine draws now (below; `renderSettingsHost` does not build
  a module's parts whose pages have a body of their own); Diagnostics (with Events) → Diagnostics. Fold ids did not change:
  `openSettings({ fold: PACKS_FOLD })` shows the section that holds the fold (found in the DOM, not in a table), opens it
  and focuses its summary; a module's features are a **group** on the Features page (key `story-suite-features::<module id>`, the
  old `"<id>::features"` too, the bare `story-suite-features` the page): the page shows and the group's heading takes the focus.
  Bodies answer `has(key)` / `open(key)` for such keys (`openFold` in window.js asks them first, then the folds). `renderSettingsHost(root,
  { sections })` does the placing (`sections: { ids, place(id), route(piece), defaultOpen(key), hostKeys(key), show(id), open(key),
  afterRefresh() }`); a section with no pane (Look, Features) is not drawn by it (`hostKeys` leaves the look settings out of the Story
  Suite fold, the Features fold is not built); without `sections` it draws the one column of folds as before (the tests of the folds
  use that).
- **Bodies** (`bodies.js`): `SECTION_BODIES`, a map **section id → `(pane, ctx) → { filter(text) → number, refresh?(), destroy?(),
  has?(key), open?(key) }`**; `ctx` is `{ doc, openState, label, legacy, options, changed() }` (`changed()`: a setting this page drew changed
  and other pages draw what depends on it: they are drawn again). Steps 3c–3g replace one entry each (Money and Assist are done), e.g. `SECTION_BODIES.money =
  (pane, ctx) => { const form = renderSettingsForm(pane, { … }); return { filter: t => form.filter(t), refresh: () => form.refresh(),
  destroy: () => form.destroy() }; }`; a section with its own body never gets drawn by the shared legacy host (it gets no pane), and
  `openSettingsWindow({ bodies })` takes another map (tests). `createLegacySettings` is the shared host behind the default entries.
- **Look** (`lookBody`): `renderSettingsForm` over the host schema's `panelStyle`, `glassStrength` and `font` (`LOOK_KEYS`; `moduleId:
  null`, so `settings.set(null, key, value)` as the Story Suite fold wrote), and a change calls `theme.apply()` so the look follows at
  once. **Features** (`featuresBody`): `renderFeaturesForm` (view/form/features.js) over the feature store. Both are searched with the
  engine's own `filter`.
- **Money** (`money.js`, step 3c): Story Block's General group (the world's coins, the money words) in the
  concept's Money page: `moneySchema(schema)` takes the registry's General fields and regroups them into cards (`MONEY_CARDS`:
  **Coins** (the coins list, the coin display), **Money words** (the three
  currency words), **Advanced** (the money scale, folded); a General field the cards do not name goes in a card of its own at the end), then `renderSettingsForm` draws them
  (`quiet`, `className: 'ss-money'`; two columns from 900px with the Coins card down the left, one column below; fields stacked in
  the cards) and writes through `settings.set('story-block', key, value)`, so what the story pays does not change with where the setting
  is drawn. **Coins** are name and worth rows (`form: 'lines'` is dropped so rows come first) with "+ Add" and "Edit as text" (a bad
  line is named: `Line 2 ("silver: lots"): …`); `coinProblems(rows)` is its `check` and says what the story will not use (no name, a number
  in a name, a worth outside 1–1,000,000, a name an earlier coin has, a coin past the eighth). There is no card for how much the story may pay: the story decides, and an old saved `storyCoinPerReply` is not in the schema (it is neither drawn nor used). The General group's fold key
  (`MONEY_FOLD`, `story-block::group:General`) opens the Money page with its first field focused (`has`/`open` on the body).
- **Assist** (`assist.js`, step 3d): Story Block's two optional helpers in the concept's Assist page, four cards: **Extra calls** (the Connection
  Manager profile both helpers use, `assistProfile`, and the host's "one call at a time per connection" switch `callQueue`, which moved here
  from the Story Suite fold: `ASSIST_HOST_KEYS` keeps it out of that fold), **Checks** (the pre-roll, "Roll checks before the reply": the check is rolled first, from the reader's message), **Safety net** ("Read changes the reply forgot", its own profile
  `assistExtractorProfile`, and the allowed kinds `assistExtractorKinds`) and **Recent runs** (the old Assist panel, `renderAssistSection`, with
  its Refresh). `assistSchema({ featureOn…})` builds the page's schema; `renderSettingsForm` draws it (`quiet`, `className: 'ss-assist-page'`;
  two columns from 900px with the Safety net card down the right, one column below; fields stacked). **The two switches are Features**
  (`story-block.preroll`, `story-block.extractor`): they live in the form's **`sources`** (below), not in the settings store, so the
  Features page and this one agree (a switch here redraws the other pages through `ctx.changed()`, and the Features page's switch redraws this
  one). **A row that cannot work is drawn and locked, with the reason, never hidden** (`lockText`): the pre-roll says what the feature says
  ("Needs a module that keeps checks.") while no module keeps checks; the safety net's profile and kinds say "Off while the
  safety net is off"; the shared profile says "Off while both helpers are off"; a profile select with only "Same as chat" to pick is disabled
  and its note says why (no Connection Manager, it is off, no profiles yet). The kinds are **chips** (`chipsetField` over the stored text,
  one chip per `KIND_CHOICES` entry in assist/safety.js: time set, time moves on, place, someone arrives or leaves, weather, quest progress
  and turn-in, wounds, an item handed over); an entry the chips do not list stays in the stored text. **The value wall is stated plainly and
  has no chips**: coin, new items, XP, loot, healing are never written, whatever is stored (`refusedWhy`, the code, not a setting), and if
  the net finishes after the reader has already sent the next message its lines wait for the next reply and may not add anything new
  but someone arriving. There is no "late lines" setting; the page only says it. A test keeps every chip on the right side of the wall.
  The fold key `story-block::group:Assist` (`ASSIST_FOLD`) opens the page with its first control focused.
- **Tabs & Packs** (`tabs-packs.js`, step 3e): three cards on the form engine's look (`ss-tabspacks`: one column, two from 900px with Prompt across
  both) in place of the Story Suite fold and the Packs fold.
  * **Tabs** (`tabs-list.js`, `renderTabsCard`): every tab and screen once, in the reader's order, as a row (`ss-tabrow`, `data-tab-id`: icon, name,
    where it shows) with Up and Down (`ss-iconbutton`, real buttons named "Move Party up") and a show/hide switch (the engine's `switchField`);
    no dragging. It writes through the same tabs control as before (`ui-host.js` `tabsControl`: `rows()`, `move(id, delta)`, `setHidden(id, hidden)`,
    `reset()`, `isDefault()`, stored in `extension_settings.storySuite.tabs`), so the Story panel's tab strip and the game view follow at once.
    A change redraws the list only; the focus stays on the same control of the same row, or on its neighbour when that one is now disabled; a status
    line says what changed. **Home's switch is locked** (drawn on and disabled, "Always shown" beside it, `lockText` as in the Assist page, the switch
    described by it). **Hiding the last tab that is shown is refused with a message** (`ss-tabrows-refusal`, `role="alert"`, above the list); Home is always
    shown, so this is the card's own guard for any other tab, whatever the control is.
  * **Packs**: Story Block's own `packs` fold (`settings.folds`, `packs/panel.js` `renderPacksPanel`) drawn into a card: Import pack file and Read from
    character lorebook, then the installed packs as `ss.listcard` rows (`ss-listcard-row`: name and version, what it adds, author and origin, a
    switch, Remove). **What it adds** is its content lists, a start state and `extras` (`installed.js` `extrasOf`: coins or a money word, a money scale,
    a calendar, weather tables, screens, layouts, a theme). Remove asks first (the row shows the question with Remove and Cancel, the focus on
    Cancel; Escape cancels the question, not the window); after a removal the focus goes to Import. Import and the lorebook read work as before.
  * **Prompt** (`prompt.js`): the budgets (`PROMPT_SCHEMA` over `HOST_SETTINGS_SCHEMA`: Notes per reply a slider in steps of 50 that stretches to a
    larger stored value, Share of the context a slider in steps of 5, Change lines per reply a number; the engine's `step` option), then the prompt's
    size (the estimate at once, SillyTavern's tokenizer's count when it answers: the context size and Story Suite's share, the instructions, this
    reply's part against its budget with a meter, what modules send themselves, the total, a table per module) and "Show what's sent" (the exact
    texts, Copy). `createPromptReader({ registry, settings, promptParts, countTokens })` is the one reader of all this: `read()` (the estimate, or null with
    no chat) and `readExact(read)` (a promise of the counted one); the card and the footer both use it.
  * **The footer bar** (`footer.js`, in `window.js`: the window's last child, under the pages, on every page): "What's sent each reply", a meter and
    "N of M tokens" (this reply's part against its budget, "· T in all" on a wide window); over its budget it turns to the warn colour; pressing it opens
    this page with the first budget focused. It is read when the window opens, after a setting changes (`win.refresh()`, and any page's `changed()`) and when
    the story moves (`win.refreshSize()`, which `ui-host.js` calls on a new head, a commit and a turn), never per keystroke in the search box:
    reading assembles the prompt. With no chat open it says "Open a chat to see it".
  * **Fold ids**: `story-suite` (the old Story Suite fold) and `story-suite::tabs` focus the Tabs card, `story-block/packs`
    the Import button, `story-suite::size` the first budget and `story-suite::sent` open "Show what's sent" (the first budget with no chat).
  `bodies.js`'s `tabs` entry is `tabsPacksBody`; bodies may also answer `refreshSize()`.
- **Modules** (`modules.js`, step 3f): one card per installed module (`registry.modules()`, by id; `ss-modules`: **one column of full-width cards on every width**; inside a wide card the fields run in two columns from 900px, a `data-wide` row (a list, text area, group) spans both) in place of the module folds and the Versions fold. A card (`ss-module-card`, `data-module`, `data-fold = <module id>`) is: the
  module's name and `v<version>` (the section hint), a line on what it does (its `description`; Story Suite's own three get one from
  `KNOWN_DESCRIPTIONS` when they say nothing), **"Features: N of M on — change"** (a button; `ctx.open(featuresFoldOf(id))` goes to that module's
  group on the Features page; hidden with no features), its **custom panel** (`settings.section`/`render`, drawn by the module into a `story-suite-section`
  with its title as a heading, hidden while its feature is off, drawn again on a refresh) and **own folds** (`settings.folds`, a sub-card each,
  `data-fold = <id>/<fold id>`) as they were drawn in the old fold, then its **settings** drawn by `renderModuleForm` from the registry's schema (a
  group each, as sub-sections without a card of their own). `moduleSchema` leaves out the groups other pages draw (`routeOf`: Story Block's General →
  Money, Assist → Assist; its panel → Assist, its Packs fold → Tabs & Packs); a module whose settings are placed in Diagnostics has its card
  without them. **A module with more than `FOLD_ABOVE` (6) settings and more than one group folds its groups** (the form's `fold: { prefix, state,
  openFirst }`: each group a `details`, `ss-section-fold` (its chevron is the window's one, `ss-section-fold-open` turns it), keyed `<module id>::group:<name>`, the first open, the state in the window's `openState`, so
  the reader's choice is kept across redraws; a search opens the groups with a match and gives the reader's choice back; `form.openGroup(name)`,
  `form.groups()`). **Versions** is a small card at the end (`ss-versions-card`, `story-suite-versions`): Story Block and each module, one row each: name, version, **"needs ≥X" once** ("needs: not said" when the module names no requirement) and the state; a note and a fix only for a state other than in step (compat.js `compatReport`/`renderCompat`), its hint "all in step" or "N out of step". Fold keys that still work: `<module id>`
  (the card's heading focused), `<module id>::group:<name>` (that group opened, its summary or heading focused), `<module id>/<fold id>`, the Versions
  fold. A module's name in a search shows all its settings; a setting shows only itself. Names, versions and descriptions are cut (60, 40, 300
  characters).
- **Diagnostics** (`diagnostics-page.js`, step 3g): the **Report card** (`story-suite-diagnostics`): the plain-text report in a `pre`, built when the page is
  first shown (not while the window opens) and again on Refresh, Copy and Save; **Copy report** (the clipboard, else the text is selected for copying by
  hand), **Save report** (a `.txt` download), Refresh, and **Show the UI sample** when the page offers one. `diagnostics.js` `buildReport` scrubs it:
  no key, token, address or chat text (`tests/v2/diagnostics-scrub.test.js` and the page's own test). Below it, what modules place here with
  `settings.place: 'diagnostics'`: their own folds (Story Block's **Events**, a collapsible card, folded because it can spoil the story, `ss-diagnostics-fold`)
  and a module whose settings are placed here (`createModuleCard` from modules.js with `placed: 'diagnostics'`, collapsible; its card is then not on
  the Modules page). Fold keys: `story-suite-diagnostics` (the Report card), `<module id>/<fold id>` (opened), `<module id>` (the card). The window calls a
  body's `show()` when its page is shown. Built with DOM calls and `textContent` only.
- **The Close corner** (3g): from 760px the page's heading is a sticky strip (`.ss-settings-page-head`, `top: -20px` to reach the scroller's edge past its padding,
  a dense layered tint, Close in its right end), so a page scrolled under it never shows content under Close; on a phone Close sits in the title row above the
  scroller. Checked at 1440 and 390 on every page, at the top and scrolled.
- **A phone is never scrolled around the window** (`view/scroll.js`, the phone hotfix). `scrollIntoView()` and a plain `focus()` scroll every scrollable
  ancestor, including the fixed layer, the window (`overflow: hidden` does not stop a script), the document and the browser's visual viewport: on a real
  phone the window's header, search and rail were pushed off the top with an empty band below the footer. So inside the window: **`revealIn(scroller,
  node, block)`** sets the page scroller's `scrollTop` and nothing else (it leaves room for the sticky heading strip; `scroller` null finds
  `.ss-settings-content`), **`focusNode`** is `focus({ preventScroll: true })`, **`showAndFocus`** is both (every `open(key)` of a body uses it), `holdPage(doc)`
  keeps the document where it was and sets `overscroll-behavior: none` on `<html>` while the window is open, and on a phone `followViewport(doc, layer)`
  keeps the layer over the visual viewport (the keyboard shrinks it, a pan moves it). The layer and the window are `overflow: clip` (a script cannot
  scroll them) and a scroll that happens anyway is undone (`window.js`). **Never call `scrollIntoView` or a bare `focus()` in `view/settings/` or
  `view/form/`** (a source test checks). The nav widget's `revealItem` only moves its own row sideways.
- **Folds** (hotfix): on the **Features** page each module's group is a fold (`renderFeaturesForm(..., { fold: { state } })`: a `details`, chevron, the name and "N of M on"
  in its summary), on the **Modules** page each module card is one (`createModuleCard(..., { collapsible: true })`); both closed by default, the state kept in
  the window's `openState` (key `story-suite-features::<module id>`, the module id), a fold id or "Features: N of M on — change" opens the one it names, and a search
  opens the ones with a match and gives the reader's choice back (a toggle during a search is not remembered).
- **Dense on a phone** (hotfix): below 760px the window (and the game view) is full screen, so its tint is layered over itself (`settings.css`, `mounts.css`): the story
  behind cannot be read through it at any Glass strength, and with the browser's blur switched off. From 760px it floats and keeps the reader's strength.
- **Search** (`search.js`, the header's box = the form engine's `searchField`): typing filters **every section at once**. Each body
  answers `filter(text)` with how many matches it shows; a page with none is left out, the others show with their heading, the rail shows
  the counts, and the total is said in a polite live region in the form engine's words (`FORM_TEXT.shown` "N settings shown",
  `shownOne`, `none` "No settings match …"). The folds' rows, features and panels are search entries (`renderSettingsHost(...).entries()`:
  label, help, group and key, the same `matchesSearch`); a fold with no match is hidden, one with a match opens for the search and goes
  back as the reader left it when it ends. A panel that matches (Packs, Tabs, Diagnostics) shows whole and counts once. Escape in
  the box empties it first; choosing a section ends the search. (The old Features filter box went with the Features fold.)
- **Keyboard and focus**: the window opens with the focus on the rail's current item (or on the summary of the fold asked for);
  Tab and Shift+Tab stay inside it (the reachable controls: not hidden, not in a closed fold, not `tabindex=-1`), a focus that lands on the
  page behind comes back, Escape closes it, and the focus returns to what had it (the bar's Suite button). A click on the dimmed
  page beside the window closes it, a text selection dragged out of it does not. `<body>` carries `story-suite-open` while it is open.
- **The folds in the look** (settings.css, `.ss-settings …`, a class heavier than host.css): folds and sub-folds as tile cards, rows with
  token borders, fields and buttons on the tokens, the browser's checkbox drawn as the switch. This is temporary: it goes with the
  folds (step 3b removed what only the old Features fold needed). The form engine's sections inside the window are tiles, not glass on
  glass.

## The surfaces on the glass (UI stage, step 4a)

The hand-built surfaces of Story Block's own UI, moved onto the glass design (Main.dc.html, Reply.dc.html and Panel.dc.html
are the approved mockups; the spacing, type and glass are the tokens above, no new colours). Each keeps its markup, its ids,
its data attributes, its keys and its commands; what changed is how it is drawn and the few places named below.

- **The story panel** (`ui-host.js` `openPanel`, `host-ui.js` `createTabHost`). The tab bar is the **`ss.tabs` block**: a `nav`
  of buttons (`.ss-tabs-item`, aria-current on the chosen tab, one Tab stop, the arrows, Home and End, a click chooses; the
  choice runs `story-suite.tab` with `{ tabs: id }`, which the host takes as its own `select`). The host draws the block with
  `renderTabStrip({ max: 100, labelMax: 200 })` (`view/widgets/nav.js`, the same render with the host's limits) and keeps the names
  the tests and modules use on its buttons: `story-suite-tab`, `story-suite-tab-label`, `data-tab-id`; the pane keeps
  `story-suite-pane`. The block is drawn once and updated on each draw, so the focus stays on its tab. The head keeps its title and
  Close and takes Panel.dc.html's 12px gutters with no rule; Close is a 40px glass tile. The scroll fade is on the block's list
  (`.ss-tabs-list`). The sheet's glass background is unchanged (`--ss-sheet-*`).
- **The bar above the message box and its notice** (`ui-host.js`, `host.css`). Story, Game view and Suite are glass pills (the
  SillyTavern `menu_button` class is kept, the look is on top); the held-back notice is a glass card with the accent hairline and
  the dismiss pill. The bar and the notice are theme roots (`.story-suite-bar`). The notice's class is shared with NPC State Delta's
  own warning (`#npc_state_delta_custom_fields_stats_warning` carries `story-suite-notice`); the look follows the class.
- **The notes under a reply** (`reply-notes.js`, `host.css`). One glass row: the note's icon in a 28px tile, the line in the muted
  colour, Re-read as a pill, the error line in the accent. A note is not folded and was not folded before; it stays one row.
- **The card under a reply: "This reply"** (`view/mounts/card.js`, `reply-cards.js`, `screens/changes-card.js`, `mounts.css` `.ss-card`).
  There is one card under a reply, not one per module: every card screen the reader has on is a section of it. Closed, the header is
  "This reply" and one line, each section's part joined with " · " (Changes first, then the registry's order; `deps.first`); the full
  line is the summary's `title`. A card screen tells its own part with an optional `summary` on its screen: a template of text
  (at most 500 characters, `validateScreen`), read in the card's scope at that reply's state like its body ('{{ q.status.summary }}';
  the scope has `summary: true`); a card with none adds nothing (Story Block's changes card is worded by the host's `summary` hook). Open, each section is its body
  under a small heading: the screen's own `title`. Story Block holds no other module's words or ids for this. The reader's own edits
  are in the opened Changes section, not in the line. The bodies are drawn the first time the card is opened, all together. A screen's
  switch (`cards[id]`) takes its section away; with one on the card is still "This reply"; "Cards under replies" off takes the card away.
  The card is a glass card (the frame is a
  theme root, `.ss-card`): the header is the title (bolder) and the one-line summary on the right (muted, one line that ends in an ellipsis), the body is padded, the rows have their icons in 34px tiles (`--ss-tile`) with hairline separators. It is
  folded by default, as before (the card mount's fold, unchanged).
  **Kept in view:** SillyTavern scrolls the chat to a new reply and the card is drawn just after, so it would sit under the fold. When a
  draw or pass (a reply landing, an edit, a rebuild, a chat opened), a module's reply card arriving, or the reader opening the card changes
  the card box of the newest message, and the reader was at the bottom of the chat before the change (within half of what the chat shows,
  at most 400 px: other extensions add to a reply after SillyTavern scrolls), the chat is taken to its bottom again
  (`view/scroll.js` `keepAtBottom`: `scrollTop` of `#chat` only). A reader who had scrolled up is never moved, and a card under an
  older message never moves the chat. Story Director's own follow (`src/v2/cast/follow.js`) is no longer needed once this is in.
  SillyTavern's swipe row (the arrows and the 1/1 counter) is drawn at the bottom right of the last message only; the last message's
  cards keep clear of it with a bottom margin (`.last_mes .ss-cards`), which was already overlapping before step 4a.
- **The Choices strip** (`extras-ui.js`, `host.css`). The strip is a `details` element, **folded by default** (the beta test's
  request): its summary is a glass row with the signpost, "Choices", the count and a chevron that turns when open. Opened, the
  options are one per row, each a full-width glass button (`.story-suite-choice`); a click still only fills the message box, never
  sends. A new reply's strip starts folded; a refresh of the same reply keeps the reader's choice. The Chatter strip the brief names
  is not drawn under replies in this checkout (inner chatter reads on World and on the Scene screen), so nothing changed for it.
- **The game view's navigation and the Story panel's tabs: the screen bar** (`view/screen-bar.js`, `mounts.css` `.ss-gameview-nav`,
  `host.css` `.story-suite-sheet-bar`, `glass.css` `.ss-screenbar*`). One component: a phone (under 760px) gets a floating glass pill
  at the foot with five slots (the first four screens that are in the bar, in the reader's order, then More); More opens a glass
  sheet over the bar (a scrim, the hint, a four-column grid of the rest). From 760px the game view draws the screens that are in
  the bar in one row (`row: true`) and More after them, while any screen is under it (its sheet opens centred over the window's foot).
  The Story panel's tabs use the same bar at its foot: the pill's four slots, and on the side sheet (from 760px) as many as its width holds at about 60px a slot (five at 398px and up, six at most; `screen-bar.js` `slotsForWidth`, `host-ui.js` `createTabHost({ slots })`, laid out again on a window resize). **What is in the bar** (`view/tab-order.js` `isInBar`,
  `screens.js` `inDefaultBar`): the screens and tabs that say `bar: true` on their own registration (Story Block's Home and Inventory;
  another module declares its own, `screens.declaredBar(id)` and the registered tabs are read in `ui-host.js` `barDeclared`); with the RPG on Party,
  and Fight while a fight is on (it is a tab only then); every other screen is under More. When more are in the bar than there are slots,
  the reader's order decides who gets them and the rest go under More. The reader's
  choice per screen (Settings → Tabs & Packs → Tabs, "In the bar" / "Under More") is kept in `extension_settings.storySuite.tabs` as
  `inBar` / `underMore` beside `order`, `hidden` and `shown`; Home is always in the bar. An item that is not in the bar has
  `moreOnly: true` for the bar; the game view reads `deps.inBar(screenId)` and the Story panel `createTabHost({ inBar })`. The current item is the accent icon and label with a dot;
  icons are `iconFor` from `view/icons` (the solid weight for the current one). Keys: each slot is a button in Tab order; Tab stays
  in the open sheet, Escape closes it first (the game view's own Escape waits while More is open), and the focus goes back to More.
  The panel's names (`story-suite-tab`, `data-tab-id`) and the game view's `data-ss-target` are kept on each slot and tile.
- **The HUD strip and the dialog mount** (`mounts.css` `.ss-hud`, `.ss-dialog`, `mounts/dialog.js`). Glass under Glass only (the
  `--ss-sheet-*` tokens; the shape tokens are set under Glass too). The dialog's backdrop keeps its dim and light blur, so the page
  behind the translucent panel is already blurred. The dialog's own buttons (Back, Random, Next, Done, Accept) keep their classes
  and take `ss-modal-action` (and `ss-modal-primary` on Done and Accept): the `ss.dialog` action pills. The wizard steps and the
  receipt are the mount's own.

Solid draws each of these with the palette's opaque glass (the same tokens with no blur); Follow SillyTavern draws them with
SillyTavern's own colours. The dialog's buttons take the action pills under every panel style; the dialog panel and the HUD strip keep their old look under Solid and Follow SillyTavern (the glass is Glass only).

## The inspector and the map on the glass (UI stage, step 4b)

Two screens and one widget, on the look's tokens; each keeps its markup, its keys, its commands and its data.

- **The State inspector** (`src/v2/screens/inspector.js`). Each card is a glass card (`ss-glass`, the card title is `ss-label`);
  the reply picker is a `ss-select`, the search an `ss-text` input, and the heading carries a soft pill ("starts a checkpoint") when the reply starts one. The diff, operations, receipts
  and problems rows are the list-card rows (`ss-listcard-row`, `ss-listcard-item`, the tile, title and sub line). The tree keeps its
  folding and its search (a node on the way to a hit opens; a hit stays shut until opened). Its buttons (`sb-insp-btn`) are glass
  pills with 40px targets: rest, hover and focus-visible take the accent over the glass, the active state the same fill, disabled is
  45% opacity and no pointer. Monospace is kept for the raw values only (`sb-insp-str`, `-num`, `-bool`, `-null`). There is no tab
  switch on the screen, so `ss.tabs` is not used. Nothing on the screen scrolls the page (see below).
- **The map** (`src/v2/view/widgets/map.js`, `styles.js`). `ss.map` is the shared map widget; packs and other modules use it. It is
  restyled: the stage on the glass tokens (`--ss-glass`, `--ss-blur`), the zoom and layer controls as glass pills, the legend as a
  strong-glass list card (`ss-glass-strong ss-listcard`, the title in the text colour), the pins and name plates on the glass.
  **Story Director's own atlas map is a separate widget (`story-director.map`, `sd-map-*`); this step does not change it.** It moves
  to step 4c, which restyles the module screens in their own repositories.
- **The UI sample** (`screens/ui-sample.js`, Settings → Diagnostics → Show the UI sample) draws one `ss.map` with sample data:
  four places, a route, the reader's place and one place not yet found (the fog, drawn muted). The sample has no command, so its
  places are not buttons.

The buttons (`.ss-button`, `.ss-button-primary`, `view/glass.css`) have their states written in the look: hover and pressed are
(0,5,1) with SillyTavern's own `:not()` chain, so they beat `.menu_button` on the same element; the label stays `--ss-text`.
The HUD strip on a phone under Glass takes the tint layered over itself (`--ss-sheet-hud-layers`); Solid and Follow SillyTavern
do not.

The type of a control: the widget's rules are under `:where()` (no specificity), but SillyTavern's own `button { font-family;
font-size; color }` rule (0,0,1) would beat them. The map's controls, and its selectable places (buttons), therefore set their type
at class level: `.ss-w-map-btn, .ss-w-map-layer`, `.ss-w-map-zoom .ss-w-map-btn` and `button.ss-w-map-node`. These are the only
rules of the widget outside `:where()`, and the widget invariant (`tests/v2/view/widgets/common.test.js`) names them. Any other
button in a widget needs the same care.

**Phones.** A `scrollIntoView`, or a plain `focus()`, scrolls the page behind a fixed window; on a phone that pushes the window
off-screen. The inspector, the map, the list card and the dialog never call `scrollIntoView`, and their focus goes through
`focusNode` (`view/scroll.js`, `preventScroll`). The guard for this is `tests/v2/ux/inspector-map-scroll.test.js`: a source scan
that catches a new bare call in those four files. It is a guard, not proof. The behaviour was checked on a phone profile in the
live instance: after older, latest and search, the page's scroll and the visual viewport's offset did not move. Long unbroken names
wrap (`overflow-wrap: anywhere`) in the heading, the branch summaries, the leaves and the map's layer pills, and the inspector's
body is one column that may shrink (`minmax(0, 1fr)`); `tests/v2/ux/inspector-glass-css.test.js` pins those rules.

**Contrast.** A label on translucent glass is measured on the pixels behind it: the label is hidden, and the fill inside the border
is sampled, inset 3px so a 1px border on a round control is not counted. A plate with an opaque fill is read from its computed
colours (WCAG ratio). The inspector's labels and buttons were measured this way in Glass, Solid and Follow SillyTavern, dark and
light; the map's controls and plates were measured the same way and read from computed colours where the fill is opaque.

Tests: `tests/v2/ux/inspector-glass-ui.test.js` (the rows, the search, the tree's folding and the buttons' keys),
`tests/v2/ux/inspector-glass-css.test.js` (the tokens, the states, the monospace rules), `tests/v2/ux/inspector-map-scroll.test.js`
(no `scrollIntoView`, every `focus()` with `preventScroll`), `tests/v2/ux/map-glass-ui.test.js` (the legend's structure, the
current place, zoom in, out and reset, no control disabled), `tests/v2/ux/map-glass-css.test.js` (the stage, the controls and
their states, the plates, the class-level exceptions and their specificity), `tests/v2/screens/ui-sample.test.js` (the sample's map).

## The game view and the screens (UI stage 5a)

- **The header** (`view/game-header.js`, `mounts/screen.js`): above every screen of the game view, the `ss.hero` block
  (`.ss-gameview-hero`, shown only when the head state gives one; no chat, no header). `gameHeroProps({ state, query, context,
  formatTime, weatherOn, rpgLead })` is the one place that reads the lead and the scene: `party.pc` (HP, MP, SP with a maximum, `level`, `role`,
  `conditions`), `party.terms` (the level's word), `scene.place`, `scene.weather`, `director.time` (formatted by the host's
  `fmt.time`). With the RPG on and no party module answering, `rpgLead` (`lean-rpg/view/hero-data.js`, the reader's own Character
  block) gives the header its Health, Mana and Stamina stage bars and the XP bar. The header's corner is **the scene's one place**
  (the `ss.hero` `where` prop): time, place, weather and "Here: people", the place, weather and Here each with the pencil Home's
  Where card had (`scene.place`, `scene.weather`, `scene.present`); the words wrap, they are never cut. The game view tells its screen
  that the header is up (`settings._heroShown`), and Home leaves its Where card out then (it keeps it where no header is above Home). The lead's name falls back to the persona's. The portrait is `portraitOf`: the persona avatar
  (`/thumbnail?type=persona&file=…`), else the card's (`/thumbnail?type=avatar&file=…`), else `npc.portrait` asked with
  `{ name }` (a string, or an answer `{ url }` / `{ src }`), else the initial. The hero keeps the pictures in order (`portraits`,
  then `portrait`): an image that fails to load is skipped and the next one tried, and the initial shows past the last. A failed
  picture is remembered for the widget, so a redraw does not ask for it again. Every read is a query, every failed read is an empty part. The mount calls `deps.heroOf(state)`
  (ui-host.js) on open, on a screen change, on each redraw and when the 760px breakpoint changes (`compact` on a phone).
- **The layout** (`mounts.css`): the bar, the header and the body are the game view's own flex items (`.ss-gameview-main` is
  `display: contents`). A phone (under 760px): title bar, header (compact), screen (room at its foot for the bar), the floating bar.
  From 760px: title bar, header (wide, the hero's 600px container query), the one row of screens, then the body. A screen that asks
  for a side column gets the body's room; no screen asks for one yet.
- **The screens** (`screens/style.js`, `home.js`, `inventory.js`, `scene.js`, `savepoints.js`, `ready-hint.js`, `show-more.js`):
  the base CSS reads the glass tokens (`--sb-surface` = `--ss-glass-strong`, `--sb-raised` = `--ss-tile`, `--sb-border` =
  `--ss-border`), a panel is a glass card, every heading is `ss-section-label`, and actions are `ss-button` (`ss-button-primary`,
  `ss-button-danger`) so they take the look's states. Home has no hero card (the header draws the lead), no Where card under the header and no Packs card (the
  import is Settings → Tabs & Packs). Home keeps the Purse and pack, Quests and Mounts cards, then the Save points row (and Party and Fight when
  their modules are there).
- **The Inventory's rows** (`inventory.js` CSS): the tile, then a grid of the name line, the note and the item detail on the left
  (`min-width: 0`, `overflow-wrap: anywhere`: a long name breaks, the chips wrap, nothing runs under the actions; a module's
  item detail is held to the column by the Inventory's CSS: its chips wrap and its condition bar shrinks)
  and the actions on the right (`fit-content(50%)`, a group that wraps on the right when the row is narrow), on every width; the
  text and the actions are centred on each other (the actions span the text's rows and a `1fr` row above and below), and an open
  fold (Equip on…, Use on…, Drop) is the last row, under both.
- **Home's cards** (`home.js` CSS): the cards size to their content (`align-items: start`), three to a row from 760px and one column
  on a phone; the Save points are one slim full-width row at the end (a wrapping flex row: the label, the button, the words or the list
  under them). A long list is capped: `.sb-cap[data-capped="true"]` is at most 15em (about two normal cards) with no scrollbar,
  and a "Show all" / "Show less" button (`capToggle` in `screens/show-more.js`, the widget `story-block.show-more` for a template's
  card, and the same helper on Save points' list) opens it. The button is there only while the list is taller than the cap, and
  shows `aria-expanded`. The open state is kept per card (a page-level map keyed by card, e.g. `story-block/home:quests`), so a
  redraw or a new head or commit does not fold it back. The button's list watches its own size (a ResizeObserver, guarded), and
  the Save points list disconnects its observer on each redraw and on destroy.
- **The section label** (`glass.css`, `.ss-section-label`): documented in WIDGETS.md. Use it for any heading of a part of a screen. Its line is `var(--ss-rule, var(--ss-border))`; a module that draws its own rule uses the same.
- Tests: `tests/v2/view/game-header.test.js` (the lead, the scene, the fallbacks, the portrait order, the avatar paths),
  `tests/v2/view/mounts/game-header.test.js` (the slot on open, a head change, a screen change, no state, a throwing `heroOf`),
  `tests/v2/screens/home-layout.test.js`, `tests/v2/screens/render.test.js`, `tests/v2/screens/show-more.test.js` (the toggle, the stretch, no Packs card).

## Layers, the modal stack and the game view window (fix 8a)

- `view/modal-stack.js` is the one stack of modal layers per document: the game view (`mounts/screen.js`), the dialogs
  (`mounts/dialog.js`, `widgets/dialog.js`), the More sheet (`screen-bar.js`) and the settings window (`settings/window.js`).
  A layer is `{ name, root, onEscape(event) → boolean, reveal?(node) }`. Only the topmost takes Escape (bubble phase: a field
  that clears its own text stops the key first) and holds Tab; a closed layer hands the focus back to its `opener`. New
  modals push a layer; they do not add their own document listeners.
- A dialog is closed on a chat change (ui-host.js listens to CHAT_CHANGED); a submit, roll or accept after the chat or the story
  head changed is refused (`chatScope` in the mount's deps). A typed field keeps its focus: a template's view is updated in
  place (`drawScreen`'s `keep`), and a rebuilt field gets the focus back by its `data-draft` (`keepFocus` in dialog.js).
- From 760px the game view is a window: the layer (`.ss-gameview`) is the scrim, `.ss-gameview-main` the window (24px radius,
  the glass or solid surface). From 1024px it is `min(1200px, 92vw)` by `min(900px, 90vh)`; 760 to 1023px keeps 16px around it.
  A click on the scrim (a press that began there too) closes it, and `body.ss-gameview-open` locks the page behind. A phone is
  full screen, as before.
- A dialog or a tab pane disposes its widgets when it closes or is drawn again (`dispose` in mounts/common.js; the tab host
  calls what its tab's render returned). Tests: `tests/v2/view/modal-stack.test.js`, `mounts/dialog-chat.test.js`,
  `mounts/dialog-focus.test.js`, `mounts/dispose.test.js`, `mounts/window.test.js`.

## The size (2.5.2)

- Everything Story Suite draws is at `--ss-zoom` (0.8, what used to be 80%), with CSS `zoom` on its roots (`view/size.css`): the
  cards, Choices and notes under a reply, the bar and the HUD above the message box, the story panel's and the game view's contents
  (`.story-suite-sheet > *`, `.ss-gameview-main > *`: the frames keep their size), the settings window, the dialog mount and the UI
  sample's contents. SillyTavern's chat text, top bar and message box are not touched. `zoom` and not a scale on every length,
  because it reaches every screen inside the roots, the modules' and the packs' CSS included, without any of them taking part.
- Text size (2.10.0, Settings → Look, host setting `textSize`): Normal leaves everything as it is. 110% and 120% add one rule to the
  theme sheet (`view/theme.js` `TEXT_SIZES`): `html:root { --ss-zoom: 0.88 }` or `0.96` (0.8 times the size), which every root above
  already follows, so the content grows and reflows with the frames unchanged, in every screen and dialog, with no attribute or style
  on any element. `--ss-zoomed` follows, so the 44px tap areas and the full-screen layers stay right.
- A zoomed root also sets `--ss-zoomed`; outside one it is unset. Inside a root, vw, vh and px are all zoomed, so a length that must
  stay the screen's divides by it: `calc(100vw / var(--ss-zoomed, 1))` for ss.dialog's full-screen layer, `calc(44px / var(--ss-zoomed, 1))`
  for a tap area. A root must never sit inside another root (the zoom would multiply).
- Scripts: `getBoundingClientRect()` and a pointer's `clientX` are drawn pixels; `style.left`, `scrollTop` and a node's own sizes are
  not. Divide a measured distance by `zoomOf(node)` (`view/scroll.js`: `currentCSSZoom`, else drawn width over `offsetWidth`) before
  it moves a scroller or places something (`revealIn`, `revealItem`; Story Director's map does the same). Code that only compares
  measured rects with each other, or places things in percentages, needs nothing (Story Block's map widget, the skill-tree
  lines, whose SVG viewBox is the measured box).
- A phone or a touch screen (`(max-width: 759.98px), (pointer: coarse)`): every button, tab, link, summary and field inside a root is
  at least 44px on the screen (`!important`, over screens' own 36–40px minimums; `role="button"` elements too, a text one such as a
  module's "more" as a 44px inline block); fields are 44px wide too. A switch keeps its look with a 44px `::after` tap area
  inside a margin of its own; a checkbox or radio in a label, at any depth, is pressed through the label (44 × 44, no `::after`:
  it would reach the next label; an inline label becomes an inline block at no weight), one with no label gets a 44px `::after`
  inside a margin of its own (the whole room above and below: stacked block checkboxes' margins collapse); a slider's box is 44px
  tall (another range keeps its bar in 44px of padding, `background-clip: content-box`); every link (any parent, any role) and
  every text element with `role="button"` or `role="tab"` is an inline block of at least 44 × 44 with real padding and no negative
  margin, at no weight so a flex, grid or block control keeps its display (the line grows where one sits); a search box's text stops short of its 44px clear button. No tap area may reach over a
  neighbour's: no negative margins, no pseudo-element larger than the room around it. A control
  that draws its own tap area (a map marker) is left alone: `.ss-w-map-node`, or any control marked `data-ss-hit`.
- Compact pills: a segmented choice or a small pill action opts in with the class `ss-tap-pill` (on the button itself; a module
  adds it to its own pill buttons). On a phone it is drawn about 30px tall (`30px / --ss-zoomed`) with an invisible 44px-tall tap area
  (`::after`, as wide as the pill) instead of the 44 × 44 minimum. Room for the area is made by margin: 7px on the row (`.ss-chips`
  holding pills), 14px between rows when they wrap, so two areas never meet; a joined `.ss-segmented` row shows the area outside it
  (`overflow: visible`) and its end pills round their own corners. A pill must sit in such a row (or have the room: 7px above and below
  it) and never overlap a neighbour. Story Block's chips (`chipsField`, `segmentedField`) opt in; off a phone nothing changes.
- The UI sample's dialog sits in a wrapper of its own on the page (`.ss-sample-dialog`), a root beside the sample, not inside it.
- Checked live (ST 1.19, Chromium) at 1280 × 900 and 390 × 844: no control under 44px on a phone but the switches and map dots
  (their tap areas are 44px), the Map's drag, wheel and clicks land on the right place, the settings window's Close has its own row.
  Tests: `tests/v2/ux/ui-size.test.js`, `tests/v2/view/scroll.test.js` (`zoomOf`, `revealIn` zoomed), `widgets/blocks.test.js` (`revealItem` zoomed).

## Key files and functions

- `src/v2/view/screens.js`: `validateScreen`, `resolveData`, `screenOrder`, `byNavOrder`, `DEFAULT_ORDER`,
  `DEFAULT_HIDDEN`, `SUITE_NAV`, `HOME_ID`.
- `src/v2/view/template/` (`render.js`, `sanitize.js`, `html.js`), `view/bind.js` (paths, `ratio`, `pct`, `len`),
  `view/css.js` (`scopeCss`, `filterDeclarations`, `isSafeCssUrl`, `themeVars`), `view/render-screen.js`.
- `src/v2/view/mounts/` (`tab`, `screen`, `card`, `hud`, `dialog`), `view/widgets/`, `view/tab-order.js`.
- `src/v2/view/theme.js` (`themeTokens`, `themeCss`, `decideScheme`, `createThemeBridge`), `view/glass.css`,
  `view/widgets/glass.js` (`tile`, `bar`, `status`, `pill`), `view/form/` (`fields.js`, `form.js`, `schema.js`), `view/widgets/hero.js`, `tiers.js`, `listcard.js`, `nav.js`
  (`tabs`, `navbar`), `dialog.js`, `src/v2/screens/ui-sample.js` (`openUiSample`), `view/settings/` (`window.js`, `sections.js`,
  `bodies.js`, `search.js`, `money.js`, `assist.js`, `tabs-packs.js`, `tabs-list.js`, `prompt.js`, `footer.js`, `modules.js`, `diagnostics-page.js`), `view/scroll.js` (`revealIn`, `focusNode`, `showAndFocus`, `holdPage`, `followViewport`) and `view/settings.css`.
- `src/v2/layout/`: JSON layouts (Studio's format) and their checks.
- `src/v2/screens/`: host screens (home, inventory, scene, changes card, inspector, save points, hints).
  The changes card also draws modules' own lines for its reply (`hooks.replyCard`, `replyCardLines`, MODULES §F125).
- `src/v2/ui-host.js` (`mountUi`: bar, panel, drawer, mounts), `src/v2/host-ui.js` (`renderSettingsHost`: the settings folds, drawn into the settings window's sections), `src/v2/view/settings/window.js` (the window).
- Step 4a: `src/v2/host-ui.js` `createTabHost` (the story panel's tab bar, on `renderTabStrip` in `view/widgets/nav.js`), `src/v2/extras-ui.js` (the Choices strip), `src/v2/reply-notes.js` (the notes), `src/v2/screens/changes-card.js` (the card's CSS), `src/v2/view/mounts.css` and `host.css` (the frames and the furniture).
- `testkit/purify.js`: `stPurify`, stands in for SillyTavern's DOMPurify (drops controls' `type` as the real one does).

## Tests that guard it

- `tests/v2/view/` (`template/`, `mounts/`, `widgets/`, `render-screen.test.js`, `tab-order.test.js`),
  `tests/v2/screens/`, `tests/v2/ux/`, `tests/v2/layout/`, `ui-host.test.js`, `host-ui.test.js`, `features-ui.test.js`.
- The settings window: `tests/v2/ux/settings-window.test.js` (frame, rail, sections, Look, Features, folds, keyboard, search, bodies),
  `tests/v2/view/form/features.test.js` (the features form), `tests/v2/ux/settings-money.test.js` (the Money page: cards, coins, slider words, validation, a story `+ coin` paying after edits),
  `tests/v2/ux/settings-modules.test.js` (the Modules page: cards, the Features line, groups and folds, panels and own folds, Story Block's share, Versions),
  `tests/v2/ux/settings-tabs-packs.test.js` (the Tabs & Packs page: the Tabs rows and their refusals, the Packs card, the budgets, the size and tokenizer, the footer bar, the fold ids), `tests/v2/ux/tabs-ui.test.js` (the tab order through the real UI), `tests/v2/packs/panel.test.js`, `tests/v2/whats-sent.test.js` ("Show what's sent" in the Prompt card),
  `tests/v2/view/scroll.test.js` (the scroll and focus helpers), `tests/v2/screens/home-layout.test.js` (Home's hero row, tags that wrap),
  `tests/v2/ux/settings-diagnostics.test.js` (the Diagnostics page: the report card built on first show, Copy, Save, the sample button, Events, placed modules, search, the scrub),
  `tests/v2/ux/settings-assist.test.js` (the Assist page: cards, the switches in the feature store, locked rows with reasons, kind chips and the value wall, profile selects, the call queue),
  `tests/v2/ux/settings-css.test.js` (settings.css, the legacy surfaces' glass), `tests/v2/qa/settings-window-security.test.js`.
- The inspector and the map of step 4b: `tests/v2/ux/inspector-glass-ui.test.js`, `inspector-glass-css.test.js`, `inspector-map-scroll.test.js`, `map-glass-ui.test.js`, `map-glass-css.test.js` (see the section above).
- The surfaces of step 4a: `tests/v2/ux/surfaces-css.test.js` (the bar, notes, Choices, card, HUD, dialog, game view nav, the Glass-only shape tokens),
  `tests/v2/ux/surfaces-ui.test.js` (the story panel's tab bar keys and focus, the Choices fold), `tests/v2/qa/surfaces-security.test.js`.
- The look: `tests/v2/view/theme.test.js`, `tests/v2/ux/glass-css.test.js`,
  `tests/v2/view/widgets/glass.test.js`, `tests/v2/view/widgets/blocks.test.js`, `tests/v2/view/form/fields.test.js`, `tests/v2/view/form/form.test.js`, `tests/v2/screens/ui-sample.test.js`.
- Security: `tests/v2/qa/template-security.test.js`, `layout-security`, `mounts-security`, `widgets-security`, `form-security`, `settings-window-security`.
- Break findings: `rx-ui-*`, `b5b-deep-screens`, `b5b-form-names`, `b5b-r2-props-depth`, `c3-features-*`.

## When you change it

- Draw it in a test through the testkit with `stPurify`, so the test shows what SillyTavern draws.
- New screen: give it a Feature if optional, a place in the order, and a test at phone width if it has a layout.
