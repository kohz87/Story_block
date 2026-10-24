# Module lifecycle: peers, dormant modules, the restore barrier, `sdk.preflight`

Story Block decides, for every registered module, whether it is running. This page is the behaviour the
host has (src/v2/registry.js, src/v2/sdk.js, a few lines of src/v2/turn.js). Its source is the frozen
contract in `docs/v2/contract/RB_CONTRACT.md` §2 (P22) and §9; where they differ, the contract wins.
A module that names no peers is untouched by all of it.

## `requires.peers`

```js
requires: { storyBlock: '>=2.0.0-beta.2', peers: { 'story-director': '>=2.0.0-beta.1' } }
```

`peers` maps a module id to a version range (the same ranges as `requires.storyBlock`, pre-releases
included: `^2` admits `2.0.0-beta.2`, `>=2.0.0` does not). It is checked against the modules that are
registered, by id and `version`. A definition whose `peers` is not an object of ids and ranges is
refused when it registers, like a bad `requires.storyBlock`. `requires.storyBlock` is unchanged. Any other
`requires` key is still ignored, with the same warning as before ("is not a requires field this Story
Block knows; it is ignored"): `requires.storyDirector` does not work and is not made to.

## Status

`registry.lifecycle(id)` and `sdk.modules()` give one of three states and a reason.

| Status | When | Reason |
|---|---|---|
| `ready` | no peers named, or every peer is registered, in range and itself ready; the module is not switched off | `null` |
| `dormant` | a peer is missing, of another version (or has none), not ready itself, or switched off; or the peers need each other (a cycle, a module that names itself); or the host switched the module off | a plain sentence, for example `Needs story-director >=2.0.0-beta.1, which is not installed.` |
| `restore-pending` | the restore barrier is up (below); it trumps the other two | the barrier's reason |

The status is worked out when it is asked, from what is registered now. Nothing is cached across a
registration, so a peer that registers late, comes back or is switched on is seen at the next view,
action or generation.

### What dormant means

The module is registered once and its names (domains, commands, queries, capture kinds and aliases, tabs,
screens, widgets, features) stay reserved: nobody else can take them. Beyond that it does nothing:

| Surface | Dormant |
|---|---|
| domains | not set up: `initialState()` and `ensureModules` leave them out; a slice the chat already has is kept as it is |
| capture | `registry.capture(kind)` finds nothing: its lines are told as unknown kinds, never run; its grammar is not in the prompt |
| prompts | `contexts()` leaves it out (no static part, tail, budget or kinds) |
| hooks | `hooks()` and `hookEntries()` leave it out: no `beforeGenerate`, `afterCapture`, `afterReply`, `ownPrompt`, `onBlocked`; `ctx.gather` skips it |
| `canGenerate` | suppressed: the hook is not called and not answered `false`, because a refusal stops the whole story (turn.js) |
| cards under replies | left out |
| commands | `registry.command(type)` finds nothing, so the bus says `UNKNOWN_COMMAND` (a caller of `ctx.call` can catch that); the reader's action through `sdk.command` / `sdk.preview` gets `DEPENDENCY_UNAVAILABLE` with the reason first |
| queries | answer `null`, like a query whose feature is off |
| tabs, screens, widgets | stay, so a view can show the reason (`sdk.modules()` has it) |
| replay, validators, counters, scratch | unchanged: a dormant module's saved slices still replay and validate |

Other modules go on. A module that goes from ready to dormant (its peer disappears or is switched off)
keeps its state; its hooks, capture and context stop. When it is ready again it is not set up a second
time: `ensureModules` adds only slices the chat lacks, and a slice the chat has is never reset.

### Activation

Late and re-enabled peers activate on the next cycle, and never register twice:

* `sdk.registerModule` registers, then `ensureModules` announces what changed and sets up the modules that
  are ready now (the peer's own registration wakes the module that waited for it).
* `sdk.command`, `sdk.preview` and `sdk.view` look again first; if a status changed since the last look
  the module is set up before the action runs.
* The turn calls `ensureModules` before each generation and when a chat opens.

Each change is announced once, as the `modules` event: `{ changes: [{ id, status, reason, from }] }` (`from`
is the status it had, `null` when new; a new module that is ready is not news).

### Cycles

If module A needs B and B needs A (through any number of modules, or a module that names itself) none of
them can start: each is dormant with `Its peers need each other (a → b → a), so none of them can start.`
A module that needs one of them waits too. Unrelated modules and the host are not affected.

## The restore barrier

`restore-pending` is one host-wide flag, driven by the save-point package. This package has the flag and
its effects; nothing here raises it except `registry.setRestore` (host-internal, for that package and for
tests).

```js
registry.setRestore('pending', 'Restoring a save point.');   // 'idle' | 'pending' | 'failed'
registry.restore();                                          // { state, reason }
```

While `pending`:

* every module in `sdk.modules()` has status `restore-pending` (so none is advertised ready);
* every module but Story Block's own is held like a dormant one: no commands (`RESTORE_PENDING` for the
  reader), capture, hooks, context, cards, queries or new domains. Story Block's own commands and its
  steps stay available, because the restore itself is one of them;
* a generation is held back with the barrier's reason (`canGenerate` for the host itself; it shows in
  Home's "Before you start" with no button);
* `ensureModules` changes nothing.

`failed` is only reported (`sdk.preflight().restore`); it holds nothing in this package.

## `sdk.modules()`

Keeps `id, name, version, domains, commands, kinds, tabs, features`, and adds `status` and `reason`.
`domains`, `commands` and `kinds` are the declared inventory, also for a dormant module. **A module is
available only while `status === 'ready'`.** Callers that discover each other through `sdk.modules()`
(Story Director's fight runner) must check it; older hosts have no `status`.

## `sdk.preflight({ module, rulesVersion })`

Synchronous, read-only and available before the module registers (and before `markReady`). It reads the
chat as it is; it sets nothing up, repairs nothing, writes no receipt and saves nothing. It throws
`TypeError` for a call that is not `{ module: '<id>' }` or a `rulesVersion` that is not a whole number from
1: a bad call is never answered `empty`.

```js
{ hostApi: 2, hostVersion: '2.0.0-beta.2', storeVersion: 2 | null,
  classification: 'empty' | 'current' | 'legacy' | 'mixed' | 'future' | 'damaged',
  domains: string[], rulesVersion: number | null, rulesHash: string | null,
  peers: [{ module, version: string | null, enabled: boolean }],
  restore: 'idle' | 'pending' | 'failed' }
```

* `storeVersion`: the highest record or state version in the chat (this host writes 2); `null` when nothing is stored.
* `domains`: the module's domain names that the chat holds.
* `peers`: `version` is the registered version (`null` when not registered or without one); `enabled` is
  "registered and not dormant".
* `restore`: the barrier's state.

Which domains and peers are the module's: its definition, when registered; else the lists in the options
(`domains`, `peers`); else, for the suite's own modules, the table `SUITE_MODULES` (`rpg-battle`: its
domains and `story-director`). A module that is none of those has no domains here and reads `empty`.

**The rules marker.** A module marks its rules generation with `rulesVersion` (a whole number from 1) and
`rulesHash` (non-empty text, or absent or `null`) at the root of any of its domain slices. Story Block only
reads them.

| Classification | When |
|---|---|
| `damaged` | anything unreadable: the chat is not a list or throws, a record that is not an object, has no list of changes or a bad checkpoint, an old or non-numeric record version, records that do not replay into a state, a state that is not `{ v, domains }`, a slice that is not an object, a marker that is not a marker. Unreadable is never `empty` |
| `future` | a record or state version above 2, or (with a `rulesVersion` asked) a marker above it |
| `empty` | nothing stored, or the chat holds none of the module's slices |
| `current` | the module's slices are there and (no `rulesVersion` asked, or) every one carries the marker `rulesVersion` and one hash |
| `legacy` | slices without any marker (host v2 with an old party is legacy, not empty), or a marker below the version asked |
| `mixed` | some slices marked and some not, two generations, or two hashes (`rulesVersion`/`rulesHash` are `null` when they disagree) |

The order is damaged, future, then the module's own slices. A slice the chat lacks while others are
marked is not "mixed": `ensureModules` adds missing slices, and never replaces an old party's data.

Limit: Story Block starts a chat up when it opens it (a damaged first record is started over, with a
Problems note), so preflight tells what is there after that.

## Host-internal API (not for modules)

`registry.lifecycle(id)`, `lifecycles()`, `held(id)`, `refusal(type)`, `peers(id)`, `restore()`,
`setRestore(state, reason)`, `setEnabled(id, on, reason)` (switch a module off to dormant; Story Block's
own cannot be switched off). `setEnabled` has no screen: it is for the host's settings and for tests.

## Tests

`tests/v2/lifecycle.test.js` (peers, missing / late / off / wrong-version peer, chains, cycles, dormant
discovery, dormant hooks and the veto, late activation announced once, restore barrier, modules without
peers) and `tests/v2/preflight.test.js` (the shape, each classification, damaged inputs, inputs checked,
before registration, read-only for every kind of store, an old party untouched by registration).
