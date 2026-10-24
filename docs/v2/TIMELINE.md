# The timeline: save points, restore and participants

How the host keeps save points, installs one absolutely when a character dies and comes back, and lets a module with native state
beside the story (NPC dossiers and their history) take part. The frozen contract is
[contract/RB_CONTRACT.md](contract/RB_CONTRACT.md) §8 (death and return), §2 (lifecycle), §3 (receipt envelope), §6 (replay
recording) and §10 E (the timeline row); this page says what the host does with them. It is the first half of the E6 package
(E6a): the active-history projection, the participants' head-selection barrier, `ctx.clockBoundary` and `savepoint.contract` are
the second (E6b) and are not here. Nothing here changes a module that does not use the timeline: its blocks, its spans, its
replay, its domains and its saves are what they were.

Code: `src/v2/timeline/` (`coordinator.js` the methods and the journal, `manifest.js` the all-domain payload and the restore plan,
`archive.js` the host archive, `participants.js`, `host-block.js` the blocks the host stores itself, `gate.js` the epoch and rules
check, `part.js` the core module's commands, query and replay guard). Wiring: `runtime.js` makes it, `sdk.js` exposes it
(`sdk.timeline`, `sdk.command('savepoint.make')`, recovery in `ensureModules`), `store.js` has `boundary()`, `touch()`, the
gate and the guard on the host's domain, `overlay.js` the rule-settings overlay. Tests: `tests/v2/timeline-make`, `-manifest`, `-restore`, `-crash`, `-replay`, `-native`, `-compat`, `-hardening`, `-principles` and `-fuzz`, with the
test-only modules in `tests/v2/helpers/timeline.js`.

## `sdk.timeline`

Every method is asynchronous and answers `{ ok: true, … }` or `{ ok: false, code, message }` (contract §3).

| Method | Who | Answers | Refused with |
|---|---|---|---|
| `head({})` | anyone | `{ headHash, cursor, epoch, prefixHash, source }` (`source`: the head reply's Source, the canonical `{ sid, swipeKey, evidence, ordinal }` of `store.sourceAt`, evidence included, given to every module that asks; a participant names it in `nativeMutation`) | `RESTORE_PENDING` while a restore or a native change is finishing |
| `make({ kind, name?, target?, day? })` | a reader: `manual` at the head; the host: also `initial`, `day-start` | `{ snapshot }` | `REFUSED` (another kind), `LIMITED` (the 11th manual), `STALE`, `CONFLICT`, `SNAPSHOT_UNAVAILABLE` |
| `list({})` / `status({})` | anyone | `{ points }` / `{ state, return, participants }` | |
| `history({ through? })` | anyone | `{ messages, faded }` (see "History" below) | |
| `forget({ snapshot })` | a reader | `{ forgotten }` | `NOT_FOUND`, `REFUSED` (an anchor, or the point of a return in progress) |
| `registerParticipant`, `prepare`, `activate`, `abort`, `recover`, `nativeEvent` | **the host capability** | as the contract | `REFUSED` without it |
| `recover({}, authority)` | **the host capability** | the same `{}` plus authority shape as the others | `REFUSED` without it |
| `nativeMutation` | **the participant's own handle** | `{ checkpoint, hash }` | `REFUSED` on `sdk.timeline` |

The capability is an object that only `createTimeline`'s caller holds (`runtime.timeline.capability`; the testkit's host
returns `timeline` with it and `timeline.host`, which has it bound). A module is given `sdk` and never the capability, so
`sdk.timeline.prepare(input, anything)` is `REFUSED`: a structural copy of the capability, its fields, a string are no better.
Nothing the caller says (a cause, a "prepared" id read out of the archive) stands for authority.

`savepoint.make` through `sdk.command` is the contract's host-action adapter: it waits for the participants' checkpoints,
then stores the descriptor and its receipt in one section if the head is where it was, and answers `{ ok: true, receipt }`
(the same envelope as any command). Straight at the command bus it is `REFUSED`, whoever asks, and cannot be previewed.
`savepoint.restore` is registered as an internal command whose handler always refuses; the restore itself is a block the
coordinator stores (below). `savepoint.list({})` is a query: the eligible points in target order.

## The savepoints domain and the archive

`state.domains.savepoints` is the contract's `SavepointsDomain` (`schema`, `epoch`, `points`, `dayStarts`, `previousDay`,
`returns`, `ruleSettings`). It belongs to **no module**: its name is **reserved** (a module cannot register a domain called `savepoints`, and the store refuses an
ordinary operation on it from any block that is not one of the host's own), no module can draft it, and it is made by the first save point
(a chat that never uses the timeline has none; it starts in the genesis epoch `ep_00000000`). Because it is part of the replayed
state, a save point is **carrier-bound**: it exists exactly while the block that made it is on the line of history, so a swipe, a
delete or a Re-read that changes the story under it takes it away (and showing the swipe again brings it back).

The bytes live outside the replayed domains, in the chat's metadata, `chatMetadata.storySuite.timeline` (saved with the chat
file by the store's save):

| Key | What |
|---|---|
| `payloads` | by hash, where **the key is `hashJson({ payload, proofs })`**, so the proof pins are bound to the descriptor's `payloadHash` and altering either is a payload that does not hash: `{ payload, proofs }`. The payload is the contract's `{ schema: 2, domains, storyClaims, effectiveSettings, domainVersions, participants }`; `proofs` is the story's proof pins at that point |
| `snapshots` | each descriptor as it was made (a restore overlays the target's from here: the payload was captured before its own descriptor existed) |
| `journal` | one entry per make, restore and native change, with its phase (below) |
| `pins` | `batchResults`: the batch result a restore was prepared for, with the manifest and the story as it stood |
| `prefix` | the participants' prefix map |
| `events` | the native events delivered, by id |

Bytes are checked against their hash when used; a payload that does not hash to its descriptor's `payloadHash` (lost, or altered in
the payload or in the proof pins) is as good as gone: `SNAPSHOT_UNAVAILABLE`. Nothing is ever deleted (see "Known limits").

## Making a save point

`reserved` → `checkpointed` → `archived` → `committed` (or `discarded`: the head moved; `aborted`: a participant could not save).
**Durable before it is told.** Nothing a make activates is durable before its commit section, and `make` (and `savepoint.make`
through the bus) answers success only after the final flush of the chat file. See "Durability, the chat and the participants
at the commit" below for the rules every operation keeps. The head is read first (`headHash` covers the story's prefix, the rev, the epoch and the native changes published), the
participants' checkpoints are asked for (`checkpoint({ cursor, headHash })`; each answer must carry the schema the participant
registered, the exact prepared checkpoint id and its hash, or the save is `SNAPSHOT_UNAVAILABLE`), the bytes are put in the archive and made
durable, and only then, **if the head, the source (the chat) and the story are what they were** (re-read in the same
synchronous section, with no `await` between the check and the writes, so an interleaved promise cannot slip between them), the
descriptor goes into the story, in one section with the journal's word that it did. A head that moved is `STALE`: nothing is stored and the bytes stay as an unreferenced cache.

The descriptor's `target` is exactly the boundary its own block starts at (the cursor and prefix hash its span carries, which is
also its `lineage`); the block id is chosen before the block is stored. `eligibleFrom` equals `target`.

## The all-domain payload

`capture` takes **every domain of the state**, found by looking, never from a list: the registered domains, the domains of modules
that are gone (orphans, as data), and the host's savepoints. The domains are enumerated from the registry's names
(so a domain's `absent()` cannot be bypassed by a state that lacks its slice). A registered domain the state does not hold yet is
listed as absent and not invented. Each domain's version is `version` on its definition (a whole number from 1, default 1).

A domain definition may also have, for restores:

* `migrate(slice, { from, to })` → a slice: a save made at an older version goes through it; without it that save cannot be
  restored (`SNAPSHOT_UNAVAILABLE`); a save made at a newer version cannot be restored either;
* `absent()` → a slice: what a domain is brought to when it came **after** the save (the contract's "versioned default"); without
  it, a restore to a save that predates the domain is `SNAPSHOT_UNAVAILABLE`.

A module may name the settings that are rules with `settings.rules` (a list of keys; the registry knows the field and does not warn of it); their values are saved in
`effectiveSettings`, and a restore applies them (see "Rule settings").

Restoring a `day-start` point overlays that point's own `dayStarts` entry and recomputes `previousDay` from the days that remain, so
the savepoints domain of a restore to a day start is the one a save at that day would have had.

## Restore

`prepare({ snapshot, deathEvents, batchResult, expectedHead })` → `{ prepared, return, manifestHash }`
(`preparing` → `prepared`), then `activate({ prepared, expectedHead })` → `{ return, status }`
(`committed` → `acked` → `complete`), or `abort({ prepared })`.

**prepare** checks the head (`STALE`), that the point is on the line of history (`NOT_FOUND`), its bytes (`SNAPSHOT_UNAVAILABLE`),
and that the participants are the ones the save held: each registered now at the schema it was saved with, and none registered
now that the save never held ("installed native state still needs its participant"). A participant whose **registration failed**
(its module declared `participant` and the host could not register it) is not available: a make or a restore while it is missing
is `SNAPSHOT_UNAVAILABLE`, never a save that quietly leaves it out. The batch result is resolved and its bytes pinned before anything
else is written (see "Sealed batch results"). It plans the restore, which asks every
registered validator of the result, pins the batch result and the story as it stands (the dead timeline), writes the durable
journal entry with the manifest, and has each participant `prepare` (verify its bytes without switching what the reader sees).
The same prepare again returns the first answer; the same batch with another meaning is `CONFLICT`.

**activate** is once: it checks the head again (a moved head aborts the preparation and is `STALE`), plans again from the bytes
and compares the manifest hash to the prepared one, then re-reads head, source and chat **in the section itself** (no `await`
between the recheck and the writes), and in **one synchronous section** stores the restore block and writes the
journal's word that it is committed, raises the restore barrier (`registry.setRestore('pending')`), makes the chat file durable (a flush that fails is the failure of `activate`, and the journal decides what `recover` does),
and has each participant `activate`, acknowledging each in the journal as it answers. `savepoint.complete` is told only after the final flush. A participant that cannot is
`participants-pending`: the barrier stays up and a later `activate` or `recover` carries on. When every part has agreed the
barrier drops and the return is marked `complete` in the story by a small block of its own (with the barrier down, so every
module's blocks are asked again and the block sees the story whole).

**What the restore block installs**, every domain at its path with an `add` (no `was`, nothing relative), so replaying it on any
numbers leaves the saved ones:

* every captured domain, as saved (migrated if need be), whatever was there; a registered domain that came after the save: its
  `absent()` slice; an unregistered domain the save lacks: removed ("never silently keep post-save data");
* the story claims back to the saved set, and the proof pins back to the saved pins (the proof the faded story gave is no longer
  active, so a kill from the faded timeline cannot be counted twice). E5's pin rule lets only the block that owns a proof change the
  record of pins; the host's restore is the one exception, through the `erases` option of `proofWriteProblem`, and only to erase a pin
  or restore the saved one;
* the rule settings of the saved point (`ruleSettings` in the savepoints domain, see below);
* the savepoints domain: the saved one in a **new epoch**, with the selected point's descriptor (from the archive) and the new
  `ReturnRecord` added. Points made after the target are gone (they lose eligibility); points at or before it stay, because they
  are in the payload; earlier returns stay as the audit.

`meta.rev`, receipt ids, the archive, the journal and settings are **not** restored. The faded interval of the `ReturnRecord` is
`(target, restoreAt]`; `restoreAt` is where the restore block starts.

## The host's blocks, and when they stand

The make, forget, restore and complete blocks are guarded blocks of the module `story-block` (the guard's `inputHash` is the hash
of the story before the block). On replay the host's own `hooks.replayGuard` (in the core module) asks it again, so **a block
stands only on the story it was made on**: delete an earlier reply, or Re-read one so its lines come out different, and the save
points and the restore that stood on it stay off together, reported as `REPLAY_PREREQUISITE`; a Re-read that comes out the same
changes nothing. A restore carries what it installs in its own changes, so replaying it needs no archive. Swiping or deleting the
reply that holds the restore takes the restore (and its epoch) back with it, as it takes any block.

## Rule settings

A module that names `settings.rules` has its saved rule values restored by a restore. They are kept per chat in the savepoints
domain, `ruleSettings` (module id, then key, then value), so they follow the line of history: swiping or deleting the reply that holds
the restore takes them back with it. `runtime.js` wraps the settings function every module reads (`ctx.settings`, `sdk.settings`,
views) with `withRuleOverlay` (`src/v2/timeline/overlay.js`): for a key the module named as a rule, the chat's value is read in
preference to the global one; every other key, and every chat that never restored, reads as before. The user's global settings are
never written.

## Sealed batch results

A restore is prepared for a sealed batch result (RB's death batch). The schema is RB's, but the host no longer takes its hash on trust:
a module that owns such results declares `batchResults: { resolve({ id, state }) }` on its definition (synchronous and pure; `null`
when the result is not its, else `{ id, hash, bytes }`). `prepare` calls the resolvers of the live modules and:

* no resolver at all: `DEPENDENCY_UNAVAILABLE`; no module holds that id: `NOT_FOUND`;
* more than one module claims it, an answer that is not `{ id, hash, bytes }`, a hash that is not the one `prepare` was given, or
  bytes that do not hash to it: `CONFLICT`;
* otherwise the host pins the bytes (`pins.batchResults[id].bytes`) with the hash, so the result the restore was made for is the one
  that can be read back after the story it came from is faded. A second hash for the id is still `CONFLICT`.

## Reserved name, and who a participant is

The `savepoints` domain name is reserved in the registry, and the store refuses any operation on it unless the block is one of the
host's own, on a live append and on replay. The reserved thing is the **branch**: a write touches it when its `path` or its `from`
is the domain, anything below it, or anything that holds it (`/domains`, the root), for every op (add, replace, remove, move,
copy) and for a path that cannot be read. It is the rule E5 applies to `/meta/proofs` and is the same function
(`reachesBranch` in `evidence.js`). A participant's identity is stamped from the module that registered it
(`participant.module` cannot be claimed by another module), and a `npc.identity` answer is bound to the participant of the event:
`nativeEvent` resolves an npc only through the query of the participant it names.

## Durability, the chat and the participants at the commit

Three rules that every operation (make, forget, prepare, activate, abort, recover, nativeMutation, nativeEvent) keeps, once, in the
coordinator's helpers rather than at each site:

1. **One helper makes things durable (`durable`).** It flushes the chat file and throws when the flush fails: the caller's failure
   (`FAILED`), and nothing after it runs, is retried as if it had worked or is announced. Every write of the journal or the story
   that must reach the file goes through it. A block the host stored (`savepoint.make`, `.forget`, `.restore`, `.complete`) is
   *owed* to the `committed` listeners and told only when a flush has succeeded, so a failed save announces nothing the file lacks;
   a later flush that works tells it then. The journal of a native change is saved before the participant is asked to change
   (`finishNative` begins with the flush, so a retry or a `recover` after a failed save does it first), and a delivery or a change
   is told done only after the final flush; the same event again is not acknowledged until the file has it. The one exception is the
   clean-up after a failure that is already being reported (an abort): its journal word rides with the next save, and a restart
   reads the unsettled entry and does the same.
2. **Everything in memory belongs to one chat.** An operation captures the chat it began in (its metadata object), and every archive
   write, every block it stores and every barrier it raises or drops checks it; after every wait (a participant's answer, a phase
   boundary, a flush, a flush that was rejected) the operation looks again. If another chat is open the answer is `STALE` (a save
   that failed because the chat was left is not a failed save), and nothing is written or created in the chat that is open now.
   The state that outlives an operation is tagged the same way: an announcement owed carries its chat and its receipt, and the
   barrier the timeline raised carries the chat it was raised for. `settle` (the host calls it when a chat opens, and every
   operation and every look at the head begins with it) drops what belongs to another chat: the announcements, and the barrier
   (its own journal keeps what it was doing, and that chat's `recover` raises the barrier again when it is opened). Before an
   announcement is told, the chat and the receipt are checked once more: a receipt that left the chat (its reply was deleted) is
   never announced. The line of work is chat-bound the same way: work is stamped with its chat when it is queued, not when its turn
   comes, and one whose chat is no longer the open one is `STALE` and does not run. What counts operations is kept per chat (a
   chat's recovery is not suppressed by another chat's work), and a chat that is opened with an unfinished journal is barred at once
   (`settle` raises the barrier before its recovery has had its turn). The recovery never lowers the barrier to look: it
   reads the story with the modules not held in one synchronous step, inside the recovery, with commands still barred and nothing
   announced (no `modules` or `head` event; the guards are asked again and the barrier is put back before anything else can run),
   so no listener sees the host ready on a story whose native state has not caught up. Readiness is announced once, when the work is
   done. A journal that holds two unfinished changes at once (damaged: the API refuses a second while one is pending) is not touched: the
   chat stays barred, nothing is announced, and `recover` answers `FAILED` until the file is put right. The line itself is one for the host, so another chat's work that is held delays a chat's recovery,
   but never lets that chat's commands through meanwhile.
3. **The participants are looked at again in the commit section.** A make checks that the participants it asked are the participants
   there are (none failed to register, none registered, no schema changed) in the same synchronous section as the commit
   (`SNAPSHOT_UNAVAILABLE` otherwise, nothing stored); an activate does the same against the save's participants and the slots that
   were prepared, and aborts the preparation; a native change checks that its participant is still registered at the schema of its
   checkpoints before the journal is written.

## One change at a time

At most one change is outstanding in a chat (a restore committed and not complete, or a native event or change prepared and not done), and
the barrier stays up, and the host is not announced ready, until the journal holds none. `prepare`, `make`, `nativeEvent` and
`nativeMutation` already refuse while one is pending; **`activate` of a restore that is prepared refuses with `RESTORE_PENDING` while any
other change is outstanding** (a native event left half way, whatever order they were prepared in). The restore stays prepared and nothing
is committed. Every place that lets the barrier go (the end of a restore, of a native change, of a recovery) asks the journal first and
does nothing while another change is outstanding.

Two routes settle the outstanding change, both verified:

1. **In this run:** retry the identical `nativeEvent` (it answers from the journal and finishes the change) or `recover()`. The native
   change is part of the head, so the restore prepared before it is then `STALE` on `activate` (it is aborted); prepare it again on the new
   head and activate.
2. **After a restart:** opening the chat raises the barrier at once and `recover` finishes the native change from the journal; a restore that
   was only prepared is aborted (prepare it again).

A journal that holds two unfinished changes anyway (damaged) is not reachable through the API; recovery refuses it as described above.

## The epoch and rules gate

REPLAY.md left it to this package: on replay (a rebuild, a Re-read's kept blocks) and when a guarded block is stored,

The gate compares **only the fields the guard actually carries**:

* the guard's `epoch`, when it carries one, must be the epoch of the savepoints domain of the state before the block (when the story
  has one); a guard with no `epoch` is not compared, and neither is one when the story has no savepoints domain;
* the guard's `rulesHash`, when it names one, must be the `rulesHash` at the root of the state's `rules` slice (the marker
  `sdk.preflight` reads), when the state has one; a guard with no `rulesHash` is not asked.

A block that fails stays stored and inactive (`REPLAY_PREREQUISITE`); a block that would be stored with such a guard is refused
with the sentence ("it was recorded in epoch …"). A story with no savepoints domain or no rules marker has nothing to compare,
so old stores and modules that never use the timeline are not asked anything new.

## Participants

A module declares `participant` in its definition (`schema` and the callbacks of contract §8, `applyEvent?`, and `attach?`); the
host registers it when it registers the module (`registerParticipant`: duplicate `CONFLICT`, a missing callback `INVALID`) and gives
`attach(handle)` the module's own handle: `{ head(), nativeMutation(input) }`. The declaration may also have `current({ checkpoint, hash, schema })` → `{ ok: true, current: boolean }`, a **synchronous probe** (optional): is the module's native
state still the one it handed over in that checkpoint? A native change that lands after `checkpoint()` has answered and before the save point
commits is not in the head hash (it is published when its change finishes), so in the commit section of a make the host asks each participant
that has the probe, once, for the checkpoint it supplied. If any answers `current: false` (or throws, or answers anything but `{ ok: true, current }`, or a promise)
the commit is discarded with `STALE`: retryable, nothing written, nothing announced. A participant without the probe keeps the old behaviour (the
head hash alone). NSD answers `hashJson(readState()) === hash && no pending intent`. The callbacks are the module's own; each answers
`{ ok: true, …fields }` or the common failure, and whatever else it does (throws, answers nothing, the wrong shape, an
unknown code) is a `FAILED`.

`nativeMutation({ participant, source, expectedHead, prepare })`: checks the head (`STALE` cancels before anything is shown),
calls the module's `prepare()` (both checkpoints durable on its side), journals, raises the barrier, `activate`s with this
transaction's host-assigned id (`nm_…`), verifies the bytes, publishes the **prefix map** entry and drops the barrier. A failure
after the journal leaves the barrier up; `recover` finishes it to the journal's choice.
`nativeEvent({ event, participant, kind: 'confirmed-death', npc, expectedHead })`: the npc id is resolved with the participant's
`npc.identity({ id })` query (unknown: `REFUSED`, the death is held rather than guessed), the event is journaled before
`applyEvent`, the same event with the same meaning returns the durable prior ack, another meaning is `CONFLICT`.

The prefix map is keyed `(chat lineage, canonical sid, swipeKey, block, op, prefixHash)` per participant and holds
`{ before, after, selected }`; a native change adds one at the head it was made at, a restore adds one at the head it ended at.
`status()` lists each participant's selected checkpoint.

## Recovery

The journal decides. `recover({}, authority)` (the same argument shape as the other capability methods; the host calls it when a chat opens and before a generation, through `ensureModules`; it costs
one look when the chat has no timeline) walks the journal: a make that never committed is `aborted`; a restore that was only
prepared (by another run, or no longer at its head) is `aborted` and its participants released; a restore that was committed is
finished forward (barrier up, each participant that has not acknowledged is asked its `status` and `activate`d, then complete);
a native change that was journaled is finished. No target, clock or die is chosen again. Each synchronous section changes the
story and the journal together, so any crash leaves a chat file the next start reads whole; `tests/v2/timeline-crash.test.js`
stops the process at every phase (a fault hook, `timelineFaults`, takes what the last save wrote and throws a crash the timeline
rethrows from everywhere) and starts a new host over it.

## History

`history({ through? })` is the projection of the chat's messages: canonical `sid` and `swipeKey` of each carrier, `msg_` ids made
from where they stand for the reader's own messages, the text, and `active`. The faded intervals of the returns are applied
carrier-wide: the replies after the target's reply through the restoring one, and the reader's messages between. Excluding the
whole reply a target falls inside of, and the readers that must go through it, are E6b (history within a reply as well).

## Decisions where the contract is silent

1. **The savepoints domain is host-owned and unregistered**, made by the first save point, so no old store gains a domain, a
   receipt or a revision. Its genesis epoch is the constant `ep_00000000`; a restore makes a new one.
2. **Where the archive lives:** the chat's metadata, beside the source-map archive. Payloads are keyed by their hash. Nothing is
   deleted (see Known limits).
3. **The proof pins** at the target travel in the archive entry beside the payload (the payload keeps the contract's closed
   shape); a restore removes pins the save did not hold and refuses a save whose pins are gone.
4. **Domain versions:** `version`, `migrate` and `absent` on the domain definition (read from the module definition; the registry
   does not check them). `absent` is how an owner "records a versioned default"; the manifest says `saved`, `migrated`,
   `default`, `orphan`, `removed` or `host` per domain.
5. **A host block stands on the story it was made on** (its guard covers the hash of the state before it). Deleting or
   re-reading any earlier reply (the faded ones too) retracts the save points after it and a restore on it, together, until the
   host prepares another. The alternative (a restore that needs only its snapshot) would resurrect a deleted reply's effects.
6. **`forget`** removes a manual point from the line of history by a block; anchors (`initial`, `day-start`) are not forgettable
   by a reader; the point of a return in progress is `REFUSED`. The bytes stay.
7. **`initial`:** once per story (`CONFLICT` after); **`day-start`** needs its `day`, sets `dayStarts[day]` and `previousDay` to the
   start of the day before it; a non-head `target` is `STALE` (marker-time targets are E6b).
8. **ReturnRecord:** `memory` is `deja-vu` (the policy for `none` and `full` is the owner's, not given to prepare), `cue` is a new
   id, `status` is `committed` in the restore block and `complete` after the participants agree; `participants-pending` is
   the journal's, not the story's. The always-déjà-vu policy is enough for now; it must later honour a `none` or `full` policy when
   the owner passes one.
9. **Batch result pin:** the host keeps `{ id, hash, bytes, return, prepared, deathEvents, manifestHash }` and the **payload of the
   story it replaced**, so an owner can read its own death slice of the dead timeline after the restore. It checks the bytes against
   the hash through the owner's `batchResults.resolve` (the schema is RB's) and refuses a second hash for the id.
10. **`head()`** hashes the story's prefix, the rev, the epoch and the count of native changes published, so a native mutation
    moves the head though the story did not.
11. **Recovery of a prepared restore** aborts it unless it was prepared by this run and the head is where it was.
12. **The host's replay hook is no owner.** The core module's `replayGuard` carries `hostOwned`, which `guardMark` skips, so a chat
    that has a guarded module and never uses the timeline writes the same checkpoint metadata (`guardEnv`) as before; the compat test
    compares a guarded chat with no timeline.
13. **Faults:** `timelineFaults` on `createRuntime` and `createHost` is a test seam; production passes none.

## Known limits and what is left

* **No pruning.** Every make and every prepare adds a payload to the metadata, and nothing is deleted: not old day-starts (contract §8
  step 1), not the pre-restore payloads of old returns, not the proof pins of a point nothing refers to. A review measured 200 KB of
  story saved 40 times at 8.55 MB of archive, with a quadratic overhead in the descriptors (each carries the whole payload manifest).
  Archive and pin pruning come later.
* **No timeouts or cancellation** on a participant's callbacks: a callback that never answers holds the timeline's one queue, and the
  chat stays barred while it does (it fails safe: nothing goes through on a story whose native state is unknown). Timeouts and
  cancellation come with integration.
* **Participants after a swipe, delete or retraction** of a committed restore, and **history within a reply**, are E6b. If the reply
  holding a committed restore is swiped or deleted, the story goes back to before it and the participant stays on the restored
  checkpoint; switching it back to the checkpoint of the surviving prefix is the head-selection barrier. The journal entry is
  `complete` and nothing reports it.
* **Déjà vu is the only memory policy** (decision 8); `none` and `full` are the owner's and are not given to `prepare` yet.
* **The 11th manual point** counts the points on the line of history; points on other swipes do not count.
