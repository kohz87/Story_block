# Data modules implementation status

`stage6/data-modules` starts at main `cc0b793` and first merges the approved design branch
at `073404f`. [DATA_MODULES.md](DATA_MODULES.md), especially its approved decisions, is the contract.
This page says what shipped, where the code and tests are, how the runtime differs from the design text,
and which calls Story Studio's simulator makes. Scope is decision 7's **v1**; v1.1 (SD checks inside a `dm`
root, `grantCoin` / `grantItem` / `grantXp`) is refused at import with "needs data-modules v1.1".

## What is delivered

| Step | Delivered | Code | Tests (`tests/v2/data-modules/`) |
|---|---|---|---|
| 1 | Shared schema 1 checker, descriptors, limits, diagnostics, hashes, migration comparison | `check.js`, `expressions.js`, `schema.js` | `check.test.js`, `fixtures/` (both worked examples, one refusal per `DM_*` code) |
| 2 | Runtime part merged into `story-block`: deferred `dataModules` domain, host kind `dm`, `dm.pin` / `dm.attach` / `dm.act` / `dm.migrate` (+ internal `dm.capture`, `dm.tick`), timers on SD minutes, rewards and offers, ordered rules, exports, budgets, refusals on the reply card, Setup card, screens | `part.js`, `interpreter.js`, `adapters.js`, `grammar.js`, `setup.js` | `runtime.test.js`, `budgets-ui.test.js`, `scopes.test.js`, `ui.test.js`, `example-a.test.js`, `example-b.test.js` |
| 3 | Guard dispatch for `dm.*` through the host-owned dispatcher, prefix witnesses, reply-bound pin/attach/migrate, tick re-planning, frozen pins, restore barrier, save points, per-chat isolation, unused means byte-identical | `part.js` (`dataModuleGuard`, `replayInputs`), `domains/index.js`, `registry.js`, `store.js` | `lifecycle.test.js`, `restore.test.js`, `unused.test.js` (+ `unused/`, `fixtures/unused-baseline.json`, `scripts/dm-unused-golden.mjs`) |
| 4 | Both worked examples end to end (example B on the real Story Director), replay-purity fuzz, whole suite and matrix | | `example-a.test.js`, `example-b.test.js`, `fuzz.test.js` (+ `fuzz/`, `scripts/fuzz-data-modules.mjs`) |

Example B and the "Story Director beside" differentials skip when `Story_director` is not next to this checkout
(CI has only this repo); everything else runs alone.

## Calls for Story Studio's simulator

The simulator runs the real host on an in-memory chat: `createHost` from `testkit/index.js` (vendored with the rest of
`testkit/`, which includes `src/v2`), the pack in `settings.packs` or installed with `host.packs.packs.install(pack)`, Story
Director (or a stand-in that owns the same published state) in `modules`. Nothing below needs a network or a sibling checkout
other than the module that owns the clock.

Commands, through `host.sdk.command(type, payload)` (reader actions; `ctx.cause` is `ui`, never a module's call):

| Command | Payload | Notes |
|---|---|---|
| `dm.pin` | `{ module, hash, packHash, subjects? }` | `hash` / `packHash` as displayed by `dataModules.setup`; a changed library answers `STALE`. `subjects`: SD actors (name or `ca_` ID) for character scope. Reply-bound. |
| `dm.attach` | `{ module, who }` | one actor; baseline is the current clock; reply-bound. |
| `dm.act` | `{ module, kind, labels?, who? }` | only kinds with `ui: true`; same labels, effects and claims as the story line. |
| `dm.migrate` | `{ module, hash, packHash }` | additive only; reply-bound. |

A story line is the ordinary `<Changes>` line `op dm <slug or pack.<id>/<slug>> — reason | kind: … | label: value`; the host
sends it to `dm.capture`. Timers run as `dm.tick { module, subject }` system steps the host plans (`afterCapture`, `beforeGenerate`)
and plans again after a change before them. Do not call `dm.capture` or `dm.tick` yourself.

Queries, through `host.sdk.query(name, args)`:

| Query | Answer |
|---|---|
| `dataModules.offers()` | `[{ module, definition, hash, packId, packVersion, packHash, interpreter: 1, origin }]`, the installed library; read-only |
| `dataModules.setup()` | the offers plus pinned modules the library no longer has: `{ …offer, status: 'Available' \| 'Pinned' \| 'Waiting' \| 'Migration available' \| 'Unsupported', reason, additions, available, pinned, subjects, actors, baseline, budgets }` |
| `dataModules.view({ module })` | `{ chat: fields }` or `{ characters: [{ id, name, …fields }] }`, `null` without a pin |
| `dataModules.public({ module, export, who? })` | the named export's fields, `null` when not active |
| `dataModules.presentation({ kind: 'screens' })` | the pinned definitions' screens (`pack: 'dm:<module>'`) |
| `dataModules.actors()` | SD's public actors `{ ca_id: { id, name } }` |
| `dataModules.replayInputs(selector)` | the replay bridge a guard asks; do not call it from a screen |

Named exports for a simulator that wants more than the host gives (`src/v2/data-modules/`):

- `part.js`: `createDataModulesPart({ packs, state, lifecycle, restore })`, `dataModuleGuard(view, info)`, `replayInputs(state, selector)`,
  `moduleView(state, { module })`, `pinnedPresentation(state, kind)`, `grammarFor(state)`, `summaryOf(state, module)`,
  `validateDomain(domain)`, `resolveModule(state, reference)`.
- `interpreter.js`: `createEvaluation(definition, instance, { inputs, source, cursor, subject })` (`evaluate`, `condition`, `effects`,
  `timers`, `rules`, `finish() → { reads, visits, notes, decisions, conds }`), `conditionHolds(definition, record, prefixFields, inputs)`,
  `parseLabels(definition, kind, labels, { text })`, `DataModuleError`.
- `adapters.js`: `activeDefinition`, `instanceOf`, `publicView`, `projectImport`, `inputsOf`, `actorsOf`, `resolveActor`.
- `grammar.js`: `referenceOf`, `kindGrammar`, `kindExample`, `moduleGrammar` (the narrator lines and Setup's examples).
- `setup.js`: `renderDataModules(root, { sdk })`, `describe(row)`.

For a replay comparison, build a second store over a copy of the chat the way `tests/v2/data-modules/fuzz/run.js` does
(`createStore` + `createCommandBus` on the same registry), once with the chat's checkpoints and once with them stripped.

## How the runtime differs from the design text

- **Conditions are recorded as answers.** DATA_MODULES.md says the input hash covers "relevant field reads". A field a kind's
  `when`, a rule's `when` or a reward's `when` reads is *not* in the read set; the condition's answer is recorded (with the
  values of fields the same root had already written) and the guard asks the same pure expression again on its prefix. A change
  before the action that leaves every answer as it was leaves the action in force; one that flips an answer makes it inactive with
  `REPLAY_PREREQUISITE`. Values an effect uses (an `add` target, a `get` in a value) are still value reads. Example A: deleting
  the second gain keeps the later loss; deleting the first gain makes only the second gain inactive.
- **Setup** is a "Data modules" card on Settings → Tabs & Packs, below Packs, drawn only when the library holds a definition or the
  chat has a pin. RPG Battle's rules selection is RPG Battle's own screen; Setup here does not depend on it.
- **A capture kind or query with `enabled: false` is not declared** (LIFECYCLE.md): a `dm` line in a chat with no pin is told as
  an unknown kind ("No module keeps "dm""), byte for byte as before the kind existed. It used to be told as "feature off".
- **Ticks answer `NO_LONGER_DONE`** when the story before them leaves nothing to settle (the pin, the subject or the elapsed time
  is gone), so the host takes the step back; a pin this build cannot read is a plain refusal and the old block stays.
- **Problems keep a block's number** when a step planned again is taken out of its record (`store.js replayBlocks`), so the
  Problems after a reconcile are those of a full replay.
- **Tail room**: 100 tokens for each pinned module on top of the core's own (`context.budget` is a getter); none without a pin.
- **Refusal text** is "Module name: what was expected; nothing applied." (bounded, shown escaped). The `path` of `{code,path,message}`
  is in the sentence, not a separate field: `ctx.fail` carries a code and a message.
- **Reader bare slug** is matched in lower case only; any other difference is refused.
- **Testkit**: `createHost({ storeOptions })` passes the real store's thresholds (`checkpointEvery`, `receiptKeep`) so tests can make
  checkpoints and trimmed receipts early.

## Format clarification

The approved design permits enum-selected reward range tables without specifying their JSON spelling.
The shared descriptor uses the following alternative to a plain `{min,max,pick}` value:

```json
{"binding":"tier","table":{"low":{"min":1,"max":2,"pick":"min"},"high":{"min":3,"max":5,"pick":"midpoint"}}}
```

`binding` names a declared enum binding; `table` must cover its values exactly once, with each
branch checked as a normal range. Table keys use the scalar binding's string representation.
This is a wire-format clarification, not an additional effect or picker. It is shared with Studio
through `DM_DESCRIPTORS.rangeTable`; no separate editor schema is introduced.

## Checking it

- `npm test` (about 3,700 tests; `tests/v2/data-modules/` holds this feature's), `npm run check`, `git diff --check origin/main HEAD`.
- `node scripts/fuzz-data-modules.mjs <seed> <steps>`: the replay-purity fuzz (`for s in $(seq 1 200); do node scripts/fuzz-data-modules.mjs $s 60; done | grep -v '"fails":\[\]'`
  prints nothing when it holds). `DUMP=<file>` writes the chat at the first failure and the chat before the failing step.
- `node scripts/dm-unused-golden.mjs --self` says whether this tree reproduces the stored baseline trace; to rewrite it, run the script with
  the path of a checkout of main at the commit named in `tests/v2/data-modules/unused/scenarios.js`.
- `npm run matrix` with the other checkouts beside (no data module cases of its own: the unused differential plays the matrix's
  chats with and without an unpinned library).

## Not done

- v1.1: SD checks inside a `dm` root and `grantCoin` / `grantItem` / `grantXp` (refused at import).
- The Studio side (forms, simulator UI, browser proof) is Story Studio's.
