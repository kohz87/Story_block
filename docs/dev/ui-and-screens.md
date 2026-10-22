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

## Key files and functions

- `src/v2/view/screens.js`: `validateScreen`, `resolveData`, `screenOrder`, `byNavOrder`, `DEFAULT_ORDER`,
  `DEFAULT_HIDDEN`, `SUITE_NAV`, `HOME_ID`.
- `src/v2/view/template/` (`render.js`, `sanitize.js`, `html.js`), `view/bind.js` (paths, `ratio`, `pct`, `len`),
  `view/css.js` (`scopeCss`, `filterDeclarations`, `isSafeCssUrl`, `themeVars`), `view/render-screen.js`.
- `src/v2/view/mounts/` (`tab`, `screen`, `card`, `hud`, `dialog`), `view/widgets/`, `view/tab-order.js`.
- `src/v2/layout/`: JSON layouts (Studio's format) and their checks.
- `src/v2/screens/`: host screens (home, inventory, scene, changes card, inspector, save points, hints).
  The changes card also draws modules' own lines for its reply (`hooks.replyCard`, `replyCardLines`, MODULES §F125).
- `src/v2/ui-host.js` (`mountUi`: bar, panel, drawer, mounts), `src/v2/host-ui.js` (settings overlay, folds).
- `testkit/purify.js`: `stPurify`, stands in for SillyTavern's DOMPurify (drops controls' `type` as the real one does).

## Tests that guard it

- `tests/v2/view/` (`template/`, `mounts/`, `widgets/`, `render-screen.test.js`, `tab-order.test.js`),
  `tests/v2/screens/`, `tests/v2/ux/`, `tests/v2/layout/`, `ui-host.test.js`, `host-ui.test.js`, `features-ui.test.js`.
- Security: `tests/v2/qa/template-security.test.js`, `layout-security`, `mounts-security`, `widgets-security`.
- Break findings: `rx-ui-*`, `b5b-deep-screens`, `b5b-form-names`, `b5b-r2-props-depth`, `c3-features-*`.

## When you change it

- Draw it in a test through the testkit with `stPurify`, so the test shows what SillyTavern draws.
- New screen: give it a Feature if optional, a place in the order, and a test at phone width if it has a layout.
