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
(`sdk.timeline`, `sdk.command('savepoint.make')`, recovery in `ensureModules`), `store.js` has `boundary()`, `touch()` and the
gate. Tests: `tests/v2/timeline-make`, `-manifest`, `-restore`, `-crash`, `-replay`, `-native`, `-compat` and `-fuzz`, with the
test-only modules in `tests/v2/helpers/timeline.js`.

## `sdk.timeline`

Every method is asynchronous and answers `{ ok: true, … }` or `{ ok: false, code, message }` (contract §3).

| Method | Who | Answers | Refused with |
|---|---|---|---|
| `head({})` | anyone | `{ headHash, cursor, epoch, prefixHash }` | `RESTORE_PENDING` while a restore or a native change is finishing |
| `make({ kind, name?, target?, day? })` | a reader: `manual` at the head; the host: also `initial`, `day-start` | `{ snapshot }` | `REFUSED` (another kind), `LIMITED` (the 11th manual), `STALE`, `CONFLICT`, `SNAPSHOT_UNAVAILABLE` |
| `list({})` / `status({})` | anyone | `{ points }` / `{ state, return, participants }` | |
| `history({ through? })` | anyone | `{ messages, faded }` (see "History" below) | |
| `forget({ snapshot })` | a reader | `{ forgotten }` | `NOT_FOUND`, `REFUSED` (an anchor, or the point of a return in progress) |
| `registerParticipant`, `prepare`, `activate`, `abort`, `recover`, `nativeEvent` | **the host capability** | as the contract | `REFUSED` without it |
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
`returns`). It belongs to **no module**: it is not registered, so no module can draft it, and it is made by the first save point
(a chat that never uses the timeline has none; it starts in the genesis epoch `ep_00000000`). Because it is part of the replayed
state, a save point is **carrier-bound**: it exists exactly while the block that made it is on the line of history, so a swipe, a
delete or a Re-read that changes the story under it takes it away (and showing the swipe again brings it back).

The bytes live outside the replayed domains, in the chat's metadata, `chatMetadata.storySuite.timeline` (saved with the chat
file by the store's save):

| Key | What |
|---|---|
| `payloads` | by hash: `{ payload, proofs }`. The payload is the contract's `{ schema: 2, domains, storyClaims, effectiveSettings, domainVersions, participants }`; `proofs` is the story's proof pins at that point |
| `snapshots` | each descriptor as it was made (a restore overlays the target's from here: the payload was captured before its own descriptor existed) |
| `journal` | one entry per make, restore and native change, with its phase (below) |
| `pins` | `batchResults`: the batch result a restore was prepared for, with the manifest and the story as it stood |
| `prefix` | the participants' prefix map |
| `events` | the native events delivered, by id |

Bytes are checked against their hash when used; a payload that does not hash to its descriptor's `payloadHash` is as good as gone.
Nothing is ever deleted (see "Open points").

## Making a save point

`reserved` → `checkpointed` → `archived` → `committed` (or `discarded`: the head moved; `aborted`: a participant could not save).
The head is read first (`headHash` covers the story's prefix, the rev, the epoch and the native changes published), the
participants' checkpoints are asked for (`checkpoint({ cursor, headHash })`), the bytes are put in the archive and made
durable, and only then, **if the head is where it was**, the descriptor goes into the story, in one synchronous section with the
journal's word that it did. A head that moved is `STALE`: nothing is stored and the bytes stay as an unreferenced cache.

The descriptor's `target` is exactly the boundary its own block starts at (the cursor and prefix hash its span carries, which is
also its `lineage`); the block id is chosen before the block is stored. `eligibleFrom` equals `target`.

## The all-domain payload

`capture` takes **every domain of the state**, found by looking, never from a list: the registered domains, the domains of modules
that are gone (orphans, as data), and the host's savepoints. A registered domain the state does not hold yet is listed as absent
and not invented. Each domain's version is `version` on its definition (a whole number from 1, default 1).

A domain definition may also have, for restores:

* `migrate(slice, { from, to })` → a slice: a save made at an older version goes through it; without it that save cannot be
  restored (`SNAPSHOT_UNAVAILABLE`); a save made at a newer version cannot be restored either;
* `absent()` → a slice: what a domain is brought to when it came **after** the save (the contract's "versioned default"); without
  it, a restore to a save that predates the domain is `SNAPSHOT_UNAVAILABLE`.

A module may name the settings that are rules with `settings.rules` (a list of keys); their values are saved in
`effectiveSettings`.

## Restore

`prepare({ snapshot, deathEvents, batchResult, expectedHead })` → `{ prepared, return, manifestHash }`
(`preparing` → `prepared`), then `activate({ prepared, expectedHead })` → `{ return, status }`
(`committed` → `acked` → `complete`), or `abort({ prepared })`.

**prepare** checks the head (`STALE`), that the point is on the line of history (`NOT_FOUND`), its bytes (`SNAPSHOT_UNAVAILABLE`),
and that the participants are the ones the save held: each registered now at the schema it was saved with, and none registered
now that the save never held ("installed native state still needs its participant"). It plans the restore, which asks every
registered validator of the result, pins the batch result and the story as it stands (the dead timeline), writes the durable
journal entry with the manifest, and has each participant `prepare` (verify its bytes without switching what the reader sees).
The same prepare again returns the first answer; the same batch with another meaning is `CONFLICT`.

**activate** is once: it checks the head again (a moved head aborts the preparation and is `STALE`), plans again from the bytes
and compares the manifest hash to the prepared one, then in **one synchronous section** stores the restore block and writes the
journal's word that it is committed, raises the restore barrier (`registry.setRestore('pending')`), makes the chat file durable,
and has each participant `activate`, acknowledging each in the journal as it answers. A participant that cannot is
`participants-pending`: the barrier stays up and a later `activate` or `recover` carries on. When every part has agreed the
barrier drops and the return is marked `complete` in the story by a small block of its own (with the barrier down, so every
module's blocks are asked again and the block sees the story whole).

**What the restore block installs**, every domain at its path with an `add` (no `was`, nothing relative), so replaying it on any
numbers leaves the saved ones:

* every captured domain, as saved (migrated if need be), whatever was there; a registered domain that came after the save: its
  `absent()` slice; an unregistered domain the save lacks: removed ("never silently keep post-save data");
* the story claims back to the saved set, and the proof pins back to the saved pins (the proof the faded story gave is no longer
  active, so a kill from the faded timeline cannot be counted twice);
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

## The epoch and rules gate

REPLAY.md left it to this package: on replay (a rebuild, a Re-read's kept blocks) and when a guarded block is stored,

* the guard's `epoch` must be the epoch of the savepoints domain of the state before the block (when the story has one);
* the guard's `rulesHash`, when it names one, must be the `rulesHash` at the root of the state's `rules` slice (the marker
  `sdk.preflight` reads), when the state has one.

A block that fails stays stored and inactive (`REPLAY_PREREQUISITE`); a block that would be stored with such a guard is refused
with the sentence ("it was recorded in epoch …"). A story with no savepoints domain or no rules marker has nothing to compare,
so old stores and modules that never use the timeline are not asked anything new.

## Participants

A module declares `participant` in its definition (`schema` and the callbacks of contract §8, `applyEvent?`, and `attach?`); the
host registers it when it registers the module (`registerParticipant`: duplicate `CONFLICT`, a missing callback `INVALID`) and gives
`attach(handle)` the module's own handle: `{ head(), nativeMutation(input) }`. The callbacks are the module's own; each answers
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

The journal decides. `recover()` (the host calls it when a chat opens and before a generation, through `ensureModules`; it costs
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
whole reply a target falls inside of, and the readers that must go through it, are E6b.

## Decisions where the contract is silent

1. **The savepoints domain is host-owned and unregistered**, made by the first save point, so no old store gains a domain, a
   receipt or a revision. Its genesis epoch is the constant `ep_00000000`; a restore makes a new one.
2. **Where the archive lives:** the chat's metadata, beside the source-map archive. Payloads are keyed by their hash. Nothing is
   deleted (see Open points).
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
   the journal's, not the story's.
9. **Batch result pin:** the host keeps `{ id, hash, return, prepared, deathEvents, manifestHash }` and the **payload of the
   story it replaced**, so an owner can read its own death slice of the dead timeline after the restore. It cannot check
   `batchResult.hash` against bytes (the schema is RB's); it keeps the hash it was given and refuses a second hash for the id.
10. **`head()`** hashes the story's prefix, the rev, the epoch and the count of native changes published, so a native mutation
    moves the head though the story did not.
11. **Recovery of a prepared restore** aborts it unless it was prepared by this run and the head is where it was.
12. **Faults:** `timelineFaults` on `createRuntime` and `createHost` is a test seam; production passes none.

## Open points (contract gaps)

* **Participants after a swipe or delete of a committed restore.** If the reply holding a committed restore is swiped or deleted,
  the story goes back to before it and the participant stays on the restored checkpoint; switching it back to the checkpoint of the
  surviving prefix is the head-selection barrier (E6b). The journal entry is `complete` and nothing reports it.
* **`effectiveSettings`** are captured and hashed in the manifest but not applied on restore: module settings live in the user's
  extension settings, not in the chat, and the ruleset a timeline plays under is frozen in the module's own `rules` domain.
* **No pruning.** Every make and every prepare adds a payload to the metadata. Day-start points older than the day before the
  newest (contract §8 step 1) and the pre-restore payloads of old returns could be dropped once nothing refers to them.
* **No timeouts** on a participant's callbacks: a callback that never answers holds the timeline's one queue.
* **`BatchResult` bytes** are RB's; the host cannot validate the hash it pins.
* **The 11th manual point** counts the points on the line of history; points on other swipes do not count.
