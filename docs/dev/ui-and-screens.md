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
  `system-ui`. A parent that sets its own background or a filter hides the page from the glass inside it: the
  legacy panels (`.story-suite-sheet`, `.story-suite-overlay`, the game view's surface) still have theirs until
  their screens move to the look (steps 2 and 3). `prefers-reduced-transparency` turns Glass into Solid; `prefers-reduced-motion`
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

## Key files and functions

- `src/v2/view/screens.js`: `validateScreen`, `resolveData`, `screenOrder`, `byNavOrder`, `DEFAULT_ORDER`,
  `DEFAULT_HIDDEN`, `SUITE_NAV`, `HOME_ID`.
- `src/v2/view/template/` (`render.js`, `sanitize.js`, `html.js`), `view/bind.js` (paths, `ratio`, `pct`, `len`),
  `view/css.js` (`scopeCss`, `filterDeclarations`, `isSafeCssUrl`, `themeVars`), `view/render-screen.js`.
- `src/v2/view/mounts/` (`tab`, `screen`, `card`, `hud`, `dialog`), `view/widgets/`, `view/tab-order.js`.
- `src/v2/view/theme.js` (`themeTokens`, `themeCss`, `decideScheme`, `createThemeBridge`), `view/glass.css`,
  `view/widgets/glass.js` (`tile`, `bar`, `status`, `pill`), `view/widgets/hero.js`, `tiers.js`, `listcard.js`, `nav.js`
  (`tabs`, `navbar`), `dialog.js`, `src/v2/screens/ui-sample.js` (`openUiSample`).
- `src/v2/layout/`: JSON layouts (Studio's format) and their checks.
- `src/v2/screens/`: host screens (home, inventory, scene, changes card, inspector, save points, hints).
  The changes card also draws modules' own lines for its reply (`hooks.replyCard`, `replyCardLines`, MODULES §F125).
- `src/v2/ui-host.js` (`mountUi`: bar, panel, drawer, mounts), `src/v2/host-ui.js` (settings overlay, folds).
- `testkit/purify.js`: `stPurify`, stands in for SillyTavern's DOMPurify (drops controls' `type` as the real one does).

## Tests that guard it

- `tests/v2/view/` (`template/`, `mounts/`, `widgets/`, `render-screen.test.js`, `tab-order.test.js`),
  `tests/v2/screens/`, `tests/v2/ux/`, `tests/v2/layout/`, `ui-host.test.js`, `host-ui.test.js`, `features-ui.test.js`.
- The look: `tests/v2/view/theme.test.js`, `tests/v2/ux/glass-css.test.js`, `tests/v2/ux/look-settings.test.js`,
  `tests/v2/view/widgets/glass.test.js`, `tests/v2/view/widgets/blocks.test.js`, `tests/v2/screens/ui-sample.test.js`.
- Security: `tests/v2/qa/template-security.test.js`, `layout-security`, `mounts-security`, `widgets-security`.
- Break findings: `rx-ui-*`, `b5b-deep-screens`, `b5b-form-names`, `b5b-r2-props-depth`, `c3-features-*`.

## When you change it

- Draw it in a test through the testkit with `stPurify`, so the test shows what SillyTavern draws.
- New screen: give it a Feature if optional, a place in the order, and a test at phone width if it has a layout.
