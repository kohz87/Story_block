# Packs

Ready-made content as one JSON file of plain data. Detail: PACKS.md (format, content kinds, value guide,
calendar, start state, screens, safety rules, limits, error codes, "For module authors"), ERSVEIL.md (the
starter pack), SPEC §9 and §13, MODULES §E and §F.

## Rules

- A pack is **plain data**; nothing in it runs. Validation at install: JSON only, no unsafe keys, tags,
  attributes or URLs, size and depth limits (`packs/limits.js`). Every text goes through the safety walls
  (`unsafeText`, `checkPlain`); pack CSS through `unsafeCss` and the screen CSS scoper.
- Ids are `pack.<pack>/<slug>`; references inside a pack are checked at install.
- Code still sets the numbers: pack values are read through the rules (value guide, budgets, caps); a pack
  may raise a cap only where PACKS.md says so.
- Content reaches modules only through queries of Story Block's core module: `packs.list`,
  `packs.content({ kind, pack? })`, `packs.markets`, `packs.crafts`, `packs.calendar`, `packs.economy`,
  `packs.item({ name })` (and hook `item.resolve`), `packs.start` (and hook `start()`).
- Lorebook packs: entries tagged as a pack (`PACK_TAG`) and `market:` lines are read from the lorebook
  (`packs/lorebook.js`); a lorebook line only tags a place, it never adds goods.
- Currency, coins, calendar and ranks come from the first enabled pack that has them, under the reader's own
  settings (the reader's words always win). Turning a pack on or off may change the static part once.
- A start state (`start`) applies only to a new chat's initial state (`applyStart`).
- Modules stand alone: a module without packs works with its defaults.

## Key files and functions

- `src/v2/packs/index.js`: `createPacksPart`, `part`, `packs`, `resolveItem`, `startState`, `economy`, `refreshLore`, `marketsOf`.
- `src/v2/packs/validate.js`: `validatePack`, `slugify`, `unsafeCss`, `HOST_VERSION`.
- `src/v2/packs/safety.js` (`unsafeText`, `checkPlain`, `byteLength`), `limits.js`, `version.js`.
- `src/v2/packs/content.js`: `itemDef`, `contentOf`, `calendarOf`, `economyOf`, `craftsOf`, `resolveItemIn`,
  `mergeStart`, `applyStart`.
- `src/v2/packs/installed.js` (where packs are kept), `panel.js` (the Packs fold), `st-adapter.js`, `lorebook.js`.
- `examples/packs/ersveil/pack.json` (Ersveil 2.2.0, the open world, with its lorebook `ersveil-lore.json`),
  `examples/packs/riverside-starter/pack.json`.

## Tests that guard it

- `tests/v2/packs/` (`validate`, `harden`, `content`, `economy`, `crafting`, `calendar` via `holidays-world`,
  `ranks`, `terms`, `world-terms`, `lorebook`, `installed`, `panel`, `version`, `ersveil*`, `meter-presets`).
- `tests/v2/qa/packs-security.test.js`, `tests/v2/layout/docs-examples.test.js` (PACKS/LAYOUTS examples parse).
- `packs/terms.test.js` and `packs/holidays-world.test.js` use sibling checkouts and skip without them.

## When you change it

- A new field or kind: validator + safety + limit + PACKS.md section + a test that a hostile value is refused.
- Changing Ersveil values: keep ERSVEIL.md and `ersveil-pack.test.js` in step; bump the pack's version. The Bluewatch fixture
  (`ersveil-values.test.js` and the other tests that load it) must never change: its bytes are pinned by the unused-chat baseline.
