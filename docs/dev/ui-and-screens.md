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
  hidden by default while Story Director's World is registered (F119). The reader's order and hidden tabs
  (`extension_settings.storySuite.tabs`, `view/tab-order.js`) win over both.
- Every optional screen carries its Feature; off, it is not drawn.

## The look: tokens, theme bridge, building blocks (UI stage, step 1a)

One look for every Story Suite screen: glass panels over SillyTavern's background, light or dark, in
Nunito (the approved concept; accent `#7b6cf0`). Three parts:

- **Tokens** (`src/v2/view/theme.js` `themeTokens`): custom properties on every Story Suite root
  (`THEME_ROOTS`, the same list as controls.css: `.story-suite-overlay`, `.story-suite-sheet`, `.ss-gameview`,
  `.ss-dialog`, `.ss-cards`, `.ss-card`, `.ss-hud`, `[data-ss-screen]`), always under `:where()`.
  Colours: `--ss-glass`, `--ss-glass-strong`, `--ss-tile`, `--ss-border` (the hairline), `--ss-shadow` (a whole
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
  Still opaque, for steps 2 and later: the HUD strip and the dialog mount (`.ss-hud`, `.ss-dialog`). `prefers-reduced-transparency` turns Glass into Solid; `prefers-reduced-motion`
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
draws Look and Features with it (step 3b) and still draws today's folds elsewhere; steps 3c–3g move the other sections one by one. The UI sample shows a demo form
(`mountDemoForm`, `UI_SAMPLE_FORM`).

```js
import { renderSettingsForm, renderModuleForm } from './src/v2/view/form/index.js';

const form = renderSettingsForm(parent, {
    moduleId: 'rpg-battle',          // null: the host's own schema (HOST_SETTINGS_SCHEMA)
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
  `min` < `max` (a `unit` text is shown after the value); `choice` → select, or chips (one of them) with `form: 'chips'`;
  `text` → text box (`multiline`: a text area with a character count when it has a `max`); `profile` → the Connection
  Manager select (`profileChoices`: "Same as chat", the profiles, a gone one kept as "(not found)", the note under the
  label); `list` → rows with Add and Remove, or one line per item for text and whole-number fields (`form: 'lines'`
  starts there; "Edit as text" / "Edit as rows"; `linesToList` / `listToLines`, the overlay's reader, so "Day: of Ash: 30"
  reads the same and a bad line is named). Several-of chips (`multiple: true`, a list of values) are a renderer of their own
  (`chipsField`); the store has no multi-valued type yet, so the form does not map a schema field to them. A type the
  engine does not know is not drawn and its value is kept.
- **Renderers** (`fields.js`): each `(ctx) → { el, input, get, set, setDisabled, setReadOnly, destroy }`; they report
  a choice through `ctx.onChange(value, { typed })` (a click, a change on blur or Enter, the end of a slider drag; never
  while typing) and never store anything. The row (`form.js`) writes with `settings.set(moduleId, key, value)`, shows the
  value stored (`set(stored)`), and says under the field what the store did to it (`changeNote`: "Set to 12, the most this
  allows.", "Cut to 8 characters…"; a refused value: "That could not be saved. The setting stays …"; text in a number
  box: "Enter a whole number. The setting stays 5.").
- **Rows**: `.ss-field` with `.ss-field-label` (a `label` for the controls that can be named by `for`, a `span` plus
  `aria-labelledby` for chips and lists), `.ss-field-help`, `.ss-field-note`, `.ss-field-tag` ("Read only"), the control, and
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
- **Classes** (glass.css): `ss-form`, `ss-section` (+ `-head`, `-title`, `-hint`, `-body`), `ss-field` (+ `-inline`,
  `-text`, `-label`, `-help`, `-note`, `-tag`, `-control`, `-error`, `-count`, `-readonly`, `-disabled`), `ss-input` (+ `ss-text`,
  `ss-number`, `ss-select`), `ss-switch` (+ `-on`, `-knob`), `ss-slider` (+ `-input`, `-value`; the fill is `--ss-fill`),
  `ss-chips`, `ss-chip` (+ `-on`), `ss-lines` (+ `-row`, `-cell`, `-remove`, `-add`, `-toggle`, `-text`, `-error`),
  `ss-search`. New tokens `--ss-off` (the switch's off track) and `--ss-knob`.
- The helpers shared with the settings window's folds (`groupFields`, `fieldReadOnly`, `rowValue`, `linesToList`, …) are
  imported from `host-ui.js` through `view/form/schema.js`: they move there when the last section leaves the folds.

## The settings window (UI stage, steps 3a and 3b)

`src/v2/view/settings/` is the settings window; `ui-host.js` `openSettings({ fold })` calls `openSettingsWindow`. It replaced
`openSettingsOverlay` (host-ui.js). Step 3a was the shell, with every section still drawing today's folds and rows; **step 3b made
Look and Features the form engine's** (below). 3c–3g replace the other bodies.

- **Frame** (`window.js`; `settings.css`, imported by host.css after glass.css, every rule under `:where(<roots>)`): the layer
  `.story-suite-overlay#story_suite_v2_overlay` (a see-through scrim, **no** filter or background of its own, so the page reaches
  the window's glass) holds the window `.ss-settings` (`role="dialog"`, `aria-modal`, labelled by its title). Its children, in
  tab order: Close (`.ss-settings-close.story-suite-close`, **absolute at the window's top right on every width**), the side
  (`.ss-settings-side`: the `h2` "Story Suite", **the search box under it**, the rail) and the page (`.ss-settings-content`). From 760px
  a centred 1120 × 780 window, 26px radius, a grid of the 250px side and the page, a hairline between; on a phone full screen, the
  side stacked above the page (title row with Close, the search, then the rail as a row that scrolls sideways; no horizontal
  overflow at 390px: checked live). A page: a heading (`h3`, 22/26px, 800) and a line under it, then the body's pane; from 760px the
  heading row leaves room for Close.
- **Sections** (`sections.js`): `SETTINGS_SECTIONS`: **Look**, Features, Money, Assist, Tabs & Packs, Modules, Diagnostics (id,
  label, Font Awesome icon, title, sub). Look is first in the rail; the window opens on Features (`DEFAULT_SECTION`). The **rail** is the `ss.tabs` block (`view/widgets/nav.js`, rendered with a
  command that selects): a `nav` of buttons, `aria-current="page"` on the chosen one, roving tabindex (one Tab stop, arrows, Home,
  End), `revealItem` on a phone. While a search is on, its count badge shows each page's matches.
- **Where today's folds go** (`routeOf`): Story Block's **General group → Money**, its **Assist panel and Assist group → Assist**;
  the Story Suite fold (the budgets, Prompt size, its Tabs sub-fold: Panel style, Glass strength and Font moved to Look) and
  Story Block's **Packs** fold → Tabs & Packs; every module's fold (what is left of Story Block's: the line to its features and
  its Inner chatter group) and **Versions** → Modules; Diagnostics (with Events) → Diagnostics. Fold ids did not change:
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
  and other pages draw what depends on it: they are drawn again). Steps 3c–3g replace one entry each, e.g. `SECTION_BODIES.money =
  (pane, ctx) => { const form = renderSettingsForm(pane, { … }); return { filter: t => form.filter(t), refresh: () => form.refresh(),
  destroy: () => form.destroy() }; }`; a section with its own body never gets drawn by the shared legacy host (it gets no pane), and
  `openSettingsWindow({ bodies })` takes another map (tests). `createLegacySettings` is the shared host behind the default entries.
- **Look** (`lookBody`): `renderSettingsForm` over the host schema's `panelStyle`, `glassStrength` and `font` (`LOOK_KEYS`; `moduleId:
  null`, so `settings.set(null, key, value)` as the Story Suite fold wrote), and a change calls `theme.apply()` so the look follows at
  once. **Features** (`featuresBody`): `renderFeaturesForm` (view/form/features.js) over the feature store. Both are searched with the
  engine's own `filter`.
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

## Key files and functions

- `src/v2/view/screens.js`: `validateScreen`, `resolveData`, `screenOrder`, `byNavOrder`, `DEFAULT_ORDER`,
  `DEFAULT_HIDDEN`, `SUITE_NAV`, `HOME_ID`.
- `src/v2/view/template/` (`render.js`, `sanitize.js`, `html.js`), `view/bind.js` (paths, `ratio`, `pct`, `len`),
  `view/css.js` (`scopeCss`, `filterDeclarations`, `isSafeCssUrl`, `themeVars`), `view/render-screen.js`.
- `src/v2/view/mounts/` (`tab`, `screen`, `card`, `hud`, `dialog`), `view/widgets/`, `view/tab-order.js`.
- `src/v2/view/theme.js` (`themeTokens`, `themeCss`, `decideScheme`, `createThemeBridge`), `view/glass.css`,
  `view/widgets/glass.js` (`tile`, `bar`, `status`, `pill`), `view/form/` (`fields.js`, `form.js`, `schema.js`), `view/widgets/hero.js`, `tiers.js`, `listcard.js`, `nav.js`
  (`tabs`, `navbar`), `dialog.js`, `src/v2/screens/ui-sample.js` (`openUiSample`), `view/settings/` (`window.js`, `sections.js`,
  `bodies.js`, `search.js`) and `view/settings.css`.
- `src/v2/layout/`: JSON layouts (Studio's format) and their checks.
- `src/v2/screens/`: host screens (home, inventory, scene, changes card, inspector, save points, hints).
  The changes card also draws modules' own lines for its reply (`hooks.replyCard`, `replyCardLines`, MODULES §F125).
- `src/v2/ui-host.js` (`mountUi`: bar, panel, drawer, mounts), `src/v2/host-ui.js` (`renderSettingsHost`: the settings folds, drawn into the settings window's sections), `src/v2/view/settings/window.js` (the window).
- `testkit/purify.js`: `stPurify`, stands in for SillyTavern's DOMPurify (drops controls' `type` as the real one does).

## Tests that guard it

- `tests/v2/view/` (`template/`, `mounts/`, `widgets/`, `render-screen.test.js`, `tab-order.test.js`),
  `tests/v2/screens/`, `tests/v2/ux/`, `tests/v2/layout/`, `ui-host.test.js`, `host-ui.test.js`, `features-ui.test.js`.
- The settings window: `tests/v2/ux/settings-window.test.js` (frame, rail, sections, Look, Features, folds, keyboard, search, bodies),
  `tests/v2/view/form/features.test.js` (the features form),
  `tests/v2/ux/settings-css.test.js` (settings.css, the legacy surfaces' glass), `tests/v2/qa/settings-window-security.test.js`.
- The look: `tests/v2/view/theme.test.js`, `tests/v2/ux/glass-css.test.js`, `tests/v2/ux/look-settings.test.js`,
  `tests/v2/view/widgets/glass.test.js`, `tests/v2/view/widgets/blocks.test.js`, `tests/v2/view/form/fields.test.js`, `tests/v2/view/form/form.test.js`, `tests/v2/screens/ui-sample.test.js`.
- Security: `tests/v2/qa/template-security.test.js`, `layout-security`, `mounts-security`, `widgets-security`, `form-security`, `settings-window-security`.
- Break findings: `rx-ui-*`, `b5b-deep-screens`, `b5b-form-names`, `b5b-r2-props-depth`, `c3-features-*`.

## When you change it

- Draw it in a test through the testkit with `stPurify`, so the test shows what SillyTavern draws.
- New screen: give it a Feature if optional, a place in the order, and a test at phone width if it has a layout.
