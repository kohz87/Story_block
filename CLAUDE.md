# Story Block: notes for coding agents

Story Block is the **host** of Story Suite v2 for SillyTavern 1.19: state store, persistence, command bus,
`<Changes>` capture, prompt assembly, module registry, settings window, tabs and screens, packs. Its core
domains are `scene` and `inventory` (one currency). The other three repos are **modules** that register
through Story Block's sdk (`globalThis.StoryBlock.sdk.registerModule`):

| Repo | Module id | Role |
|---|---|---|
| kohz87/Story_block (this) | `story-block` | host + core domains |
| kohz87/Story_director | `story-director` | story clock, quests, threads, map, chronicle, World, arc |
| kohz87/npc_state_delta | `npc-state-delta` | standalone NPC engine; registers queries, Cast/Dossiers, `npc` meters when hosted |

Work happens on `main`, the development branch (v1 is on branch `v1`). Every module must also work with any other module
absent (no hard dependency: read another module only through a query guarded with a fallback, the
modules' `tryQuery` helpers, or an optional command; degrade to a sensible default and say so).

## Directory map

- `index.js`: wires SillyTavern to the v2 runtime and mounts the UI. `index.v1.js` and `src/*.js` are v1, not loaded.
- `src/v2/runtime.js`: builds registry, settings, store, command bus and turn, once (SillyTavern and testkit).
- `src/v2/store.js`, `src/v2/persist.js`: carriers, checkpoints, replay, head cache; record read/write, saver.
- `src/v2/chat-file.js`: writes the chat file itself (mirrors SillyTavern's save body; recheck on ST releases).
- `src/v2/ops.js`, `check.js`, `rng.js`, `commands.js`: draft to ops, validators, sfc32 rng, bus, claims, receipts.
- `src/v2/capture.js`: the `<Changes>` grammar, block extract/hide, stray lines in the story, Continue text.
- `src/v2/turn.js`: interceptor, prompt keys, MESSAGE_RECEIVED capture, swipes/deletes, `reread`.
- `src/v2/prompt.js`: static part + tail assembly, tail budget, context share.
- `src/v2/registry.js`, `src/v2/sdk.js`, `src/v2/features.js`: module definitions, the public sdk, Features (F100).
- `src/v2/domains/`: `scene`, `inventory`, `money`, name matching: the reference module.
- `src/v2/packs/`: pack validation, safety walls, lorebook packs, content queries, ranks.
- `src/v2/events/`, `src/v2/assist/`: pack events and conditions; optional classifier and extractor.
- `src/v2/view/`: screens registry, template renderer + sanitiser, CSS scoper, binding, mounts, widgets, tab order.
- `src/v2/screens/`: the host's own screens (home, inventory, scene, changes card, inspector, save points).
- `src/v2/ui-host.js`, `src/v2/host-ui.js`: page furniture (bar, panel, drawer) and the settings folds; `src/v2/view/settings/`: the settings window (shell, sections, search).
- `src/v2/extras.js`, `extras-ui.js`: display kinds `? choice` and `~ chatter`.
- `src/v2/rewind.js`, `reply-notes.js`, `diagnostics.js`: rewinds and save points, per-reply notes, Diagnostics fold.
- `testkit/`: fake SillyTavern (`createFakeContext`) and a whole host on it (`createHost`); vendored by modules.
- `scripts/`: `check.mjs` (syntax), `sync-testkit.mjs`, `bench-v2.mjs` / `bench-long.mjs` (PERFORMANCE.md).
- `examples/packs/`: `ersveil` (the open-world pack and lorebook) and `riverside-starter` (small). `examples/fishing/`: reference activity.
- `tests/*.test.js`: v1 tests (still run). `tests/v2/`: v2 tests; `qa/` (fuzz, ownership, security, prompt layout),
  `break/` (one file per break finding, named after the finding id), `domains/`, `packs/`, `view/`, `screens/`, `ux/`.
- `docs/v2/`: the specs (below). `docs/dev/`: short area notes for agents.

## Commands

Node 24 in CI (node ≥ 22 works locally). No dependencies, no install step.

```sh
npm test                                   # what CI runs (with npm run check and git diff --check)
npm run test:dot                           # same files, one dot per test, failures listed at the end
npm run check                              # syntax check of index.js, src/, testkit/, examples/, scripts/
node --test --test-reporter=dot tests/v2/capture.test.js            # one file
node --test --test-name-pattern="Re-read" tests/v2/stray-reread.test.js  # tests whose name matches
git diff --check origin/main               # CI fails on trailing whitespace in what the PR adds
```

Full suite: about 2,100 tests, 1.5–3 minutes. Skills in `.claude/skills/`: `run-tests`, `suite-check`
(all four repos side by side), `release-resync`.

## Non-negotiables (every PR keeps them)

1. **Code sets numbers; the story proposes.** Clamp, cap per reply, claim once. Model text never mints coin,
   items, XP, HP or meter values beyond the rules.
2. **Per-reply bookkeeping** is keyed by carrier `sid` / id with add-only ops (or derived from receipts);
   never positional list appends or a `replace` of another reply's fields (SPEC §2.2). Prune with key removes.
3. **Replay == live** after swipes, middle deletes, rewinds, reloads (SPEC §2.2 and the replay rules a–d).
   The fuzz-delete / state-fuzz tests must pass; add new kinds and commands to the fuzz generator.
4. **Static prompt part byte-identical** reply to reply (no names, counts, times, dice). New static lines only
   via a Feature or a setting. Tail additions short and within budget (SPEC §5).
5. **Every optional mechanic is a Feature (F100):** `features: [{ id, label, describe, default }]`, tag kinds,
   commands, queries, context, hooks and screens with `feature:`; check `ctx.feature(id)` where needed.
6. **Story-driven:** no buttons for story actions (F95/F96); bag-management buttons are fine.
7. **No markup or script from text:** use templates and widgets; names flattened; cut by code points.
8. **Tests for every rule,** run once after the fix (no before/after runs on old code). `npm test` and
   `npm run check` green; docs (SPEC/GUIDE/MODULES/PACKS) updated with behaviour.
9. **Deterministic:** no `Math.random`, no `Date.now()` in state or ordering; randomness from `ctx.rng`.

## Conventions

- No model names anywhere in the repo. Commit trailers and PR attribution: the lines the session gives.
- Branch off `main`, PR into `main`. Agents never merge their own PR; the coordinator reviews and merges.
- Rebase on `origin/main` before pushing; on conflicts keep both sides, never edit another agent's files.
- Module repos vendor this repo's testkit in `tests/vendor/story-block/` (VERSION names the commit). After a
  change to `testkit/` or `src/v2/`, modules re-sync with `scripts/sync-testkit.mjs` and re-run their tests.
- Each file opens with a comment that says what it does and why; keep that style and plain-words messages.
- Kill processes by PID, never with a broad `pkill -f`.

## Specs (docs/v2/)

- `SPEC.md`, the contract: §0 principles; §2.2 storage, replay, counters, per-reply bookkeeping, rules a–d;
  §3.1–3.3 commands and saving; §4.1–4.4 the turn and the change-line grammar; §5 the prompt; §6 modules,
  `requires`, Features; §7 core domains; §10 testing; §12 internal interfaces; §13 UI.
- `MODULES.md`: §A part layout, §C Story Director, §D NSD, **§F decisions (override older text)**, §G `sdk.callModel`.
- `PACKS.md` (pack format, safety, limits, module-author queries), `TEMPLATES.md`, `WIDGETS.md`, `LAYOUTS.md`.
- `PERFORMANCE.md` (benchmarks, storage tuning, checkpoints, saves), `REVIEW.md` (where to start, risky parts).
- `GUIDE.md` (reader's guide), `STATUS.md`, `ERSVEIL.md`.
- History and decisions (F81+, user decisions, after-beta list): `suite-notes/` in kohz87/inventory-block,
  branch `claude/hopeful-babbage-tipaw8` (README.md, WAVE_BRIEF.md, V2_LOG.md newest at the end).

Area notes in `docs/dev/`: `capture-and-reread.md`, `saves-and-persist.md`, `prompt-and-context.md`,
`ui-and-screens.md`, `packs.md`.

## Known traps

- Suite tests (`tests/v2/break/helpers/suite.js`, `suite-final.js`, `packs/terms.test.js`,
  `packs/holidays-world.test.js`) need the four checkouts side by side in one folder, named exactly
  `Story_block`, `Story_director`, `npc_state_delta` (or `STORY_SUITE_ROOT=<folder>`).
  Without them they **skip** (CI has only this repo), so a green CI does not cover them: run `suite-check`.
- A `test.todo` that fails prints `X` / `⚠` in the dot output but does not fail the run; it is a known open problem.
- The testkit has no chat file of its own, so saves there are immediate (`ctx.saveChat`); the 1.5 s / 8 s
  turn save of SPEC §3.3 only happens in SillyTavern.
- A change to `testkit/` or `src/v2/` can turn module tests red after their next re-sync (e.g. RB's fuzz after
  money-named items, #139): say so in the PR and re-sync the modules.
- `MODULES.md §F` and later decisions override older SPEC text; read them before "fixing" a contradiction.
- NSD's prompts are byte-identical by contract (its C10); Story Block never sends NSD's own prompt keys.
- The GitHub proxy refuses tag creation and branch deletion: leave branches, the user makes tags.
