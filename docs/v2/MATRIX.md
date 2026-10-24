# The combination matrix

Story Suite promises that every module combination in `contract/RB_CONTRACT.md` §2 works (or, for RB without
SD, that RB stands aside and the others work). The matrix is the one runner that tests that promise with the
real modules: it boots their real definitions in the testkit's `createHost`, registers them once, plays a
scripted reply, runs an action and replays the chat. It lives in `testkit/matrix/` so every repo runs the same
rows through its vendored testkit (`npm run sync-testkit`).

```sh
npm run matrix                                 # from Story Block, the other checkouts next to it
node scripts/matrix.mjs --rows SB+SD,SB+SD+RB  # some rows
node scripts/matrix.mjs --only rb              # the rows that include RB
node scripts/matrix.mjs --cases swipe,delete   # some columns
node scripts/matrix.mjs --strict               # a known gap fails the run
node scripts/matrix.mjs --json                 # results as data
```

Module checkouts, in this order: `--rb`, `--sd`, `--nsd <path>`; `$MATRIX_RB`, `$MATRIX_SD`, `$MATRIX_NSD`;
the folders `rpg_battle`, `Story_director`, `npc_state_delta` next to this checkout or in `--root` /
`$STORY_SUITE_ROOT`. A row whose module is not found is **skipped** (said in the table), a checkout that does
not import **fails** its rows. Exit code 0 when nothing failed, 1 when something did, 2 for a bad command line.

## Rows

| Row | Expected | Scripts that run |
|---|---|---|
| SB | works | SB |
| SB+SD | works | SB, SD |
| SB+NSD | works | SB, NSD |
| SB+SD+NSD | works | SB, SD, NSD |
| SB+SD+RB | works | SB, SD, RB |
| SB+SD+RB+NSD | works | all four |
| SB+RB | RB dormant, others work | SB |
| SB+RB+NSD | RB dormant, others work | SB, NSD |

Positive subsets as the contract counts them: SB six, SD four, NSD three, RB two. A dormant module is
registered (its names reserved) but its script does not run.

## Results

`ok`, `FAIL`, and three that are not failures:

* `gap`: a **known gap**, the current host result of something another package will change. It fails with
  `--strict`.
* `todo`: the case applies but today's host cannot express it yet.
* `n/a`: the case does not apply to the row (no SD, so no clock). `skip`: a module is not checked out.

**The negative rows.** RB does not yet refuse without SD: it registers, creates its domains and holds the
reader's first message back ("Create your character first.") until a party exists, so SB and NSD cannot work
beside it either. That is the lifecycle package's job (`sdk.preflight`, `requires.peers`, `sdk.modules()`
`status`). Until then every result of these rows that cannot pass because of it is a `gap` with that reason
(`--verbose` shows the failure each one would have). The gap closes by itself: once `sdk.modules()` entries
have a `status`, the `RB dormant` column checks `status === 'dormant'` with a `reason`, that RB's setup command
is refused, and no step is excused any more. Positive rows then also expect `status === 'ready'`.

## Cases (columns)

Each case boots its own host(s); none of them uses a stub for the module under test.

| Case | What it checks |
|---|---|
| registers once | every module of the row is listed once in `sdk.modules()`; nothing held back at boot |
| scripted reply | one reply with every module's change lines: each module's facts changed, no store problems, no console errors |
| action | each module's reader action succeeds and changes what it keeps (SB `inventory.drop`, SD `quest.abandon`, NSD `npc.set`, RB `party.rest`) |
| replay | a cold rebuild (a second store over the same chat, set up like a reload) equals the live state |
| static prompt | the static part of the prompt is byte-identical from reply to reply |
| RB dormant | negative rows only: see above |
| missing query | every query of an absent peer is unknown (`no module answers the query`); a reply after them still works |
| malformed answer | a stand-in for each absent peer (SD, NSD) answers its real query names three ways (throws, null, wrong shape); the modules present carry on, replay holds; with an SD stand-in an RB row also checks dormancy. The stand-ins stand for a peer only; the note says how often the modules asked |
| feature off | all Features of each module off in turn: a reply still works for the others, replay holds, back on works |
| unset clock | SD rows: replies without `~ time` leave the clock unset and quests still work; with RB, a timed action (`party.rest`) should be refused `CLOCK_UNSET` (`gap` until RB does) |
| SD disabled | `todo`: the host cannot disable a registered module (only its Features), so there is no "SD present but off" |
| late registration | the last module registered after a reply: listed once, earlier state unchanged, ends where a boot with all of them does |
| duplicate name | the same id twice, and a second owner of a name each module owns (`already registered`, `already belongs to "…"`), nothing changed |
| swipe | a swipe, then back: the state is that of a fresh host that played only the replies left |
| re-read | an edited reply re-read (`sdk.reread`): same oracle |
| delete | deleting the last, a middle and the first reply: same oracle, replay holds |

**The oracle.** Nothing is compared with a hand-written number. After a swipe, a re-read or a delete, a
module's *facts* must equal those of a fresh host that played only the replies that remain. Facts
(`testkit/matrix/modules.js`) are what a module keeps that does not depend on the replies before it: SB place
and items, SD time and quests, NSD one NPC per reply, RB conditions. HP and meter values are left out on
purpose: they move with story time and with earlier replies (a meter is stored as the value it reached, so a
delete in the middle keeps later values), which the rules a-d of SPEC §2.2 do not promise to undo.

## Vendoring and the module repos

`scripts/sync-testkit.mjs` copies the whole of `testkit/`, `testkit/matrix/` with it, and writes the commit and
the runner's version into `tests/vendor/story-block/VERSION`:

```
Story Block 2.0.0-beta.2
commit <sha>
files <n>
matrix 1
```

`matrix none` means the Story Block it was copied from has no runner. `MATRIX_VERSION`
(`testkit/matrix/version.js`) goes up when the rows, the cases or a module's script change in a way a module's
wrapper or its recorded results would notice. Refresh the vendor to the tested pin before claiming a row (the
contract's §2); RB's separate `tests/v2/qa/vendor` copy has to be synchronized or removed the same way, it is
not touched by this runner.

A module runs its own rows with a small wrapper over its vendored testkit. Until each repo has its own
`scripts/matrix.mjs` (a lead task), this is the whole file; `mine` is `'rb'`, `'sd'` or `'nsd'`:

```js
// scripts/matrix.mjs: the rows that include this module, with the other checkouts next to it.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeTestkit, discoverRoots, formatDetails, formatTable, loadModules, runMatrix, summaryLine } from '../tests/vendor/story-block/testkit/matrix/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const mine = 'rb';
const roots = { ...discoverRoots(resolve(here, '..', '..')), [mine]: resolve(here, '..') };
const { loaded, missing, broken } = await loadModules(roots);
const out = await runMatrix({ loaded, missing, broken, only: mine, strict: process.argv.includes('--strict') });
console.log(describeTestkit());
console.log(formatTable(out.results));
console.log(formatDetails(out.results));
console.log(summaryLine(out));
process.exitCode = out.ok ? 0 : 1;
```

The sibling folders must be named as in `FOLDERS` (`Story_block` or `sb`, `rpg_battle`, `Story_director`,
`npc_state_delta`). A module whose wiring moved can say where its definition is built with
`loadModules(roots, { rb: 'src/v2/other.js' })` (the file must export what `MODULES.rb.make` calls, see
`modules.js`).

## Changing the matrix

* A new module combination or a negative row: `rows.js`. A new case: a function in `run.js` that records
  through `rec.step(id, fn)` (throw to fail, return `gap(...)`, `na(...)` or `todo(...)`), and its column in
  `CASES`.
* A module's script, facts and action: `modules.js`. Keep a module's three replies (A, B, C) independent of
  each other, as above.
* When the lifecycle lands: the negative rows turn strict by themselves (see above); replace `SD disabled`'s
  `todo` with a real case; add `requires.peers` / `sdk.preflight` cases and raise `MATRIX_VERSION`.
* The runner's own tests: `tests/v2/matrix/runner.test.js` (a toy checkout stands in only to test the runner;
  the real modules run through `npm run matrix`, like the suite helpers they need the checkouts side by side
  and CI of this repo alone does not run them).

## Results on the main branches

The first run, Story Block, RPG Battle, Story Director and NPC State Delta at their `main`:

| Combination | registers once | scripted reply | action | replay | static prompt | RB dormant | missing query | malformed answer | feature off | unset clock | SD disabled | late registration | duplicate name | swipe | re-read | delete |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| SB | ok | ok | ok | ok | ok | n/a | ok | ok | ok | n/a | n/a | n/a | ok | ok | ok | ok |
| SB+SD | ok | ok | ok | ok | ok | n/a | ok | ok | ok | ok | todo | ok | ok | ok | ok | ok |
| SB+NSD | ok | ok | ok | ok | ok | n/a | ok | ok | ok | n/a | n/a | ok | ok | ok | ok | ok |
| SB+SD+NSD | ok | ok | ok | ok | ok | n/a | n/a | n/a | ok | ok | todo | ok | ok | ok | ok | ok |
| SB+SD+RB | ok | ok | ok | ok | ok | n/a | ok | ok | ok | gap | todo | ok | ok | ok | ok | ok |
| SB+SD+RB+NSD | ok | ok | ok | ok | ok | n/a | n/a | n/a | ok | gap | todo | ok | ok | ok | ok | ok |
| SB+RB | ok | gap | gap | gap | gap | gap | gap | gap | gap | n/a | n/a | gap | gap | gap | gap | gap |
| SB+RB+NSD | ok | gap | gap | gap | gap | gap | gap | gap | gap | n/a | n/a | gap | gap | gap | gap | gap |

Heads: Story Block 1843d44, RPG Battle d5b67da, Story Director 0a76324, NPC State Delta 1684b11. The 28 `gap` results are the negative rows (RB holds the first message back) and RB's timed action with the clock unset; the four `todo` are `SD disabled`. Nothing fails.
