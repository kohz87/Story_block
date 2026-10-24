# Guarded replay: span metadata and the owner API

How a module makes a block of changes depend on what came before it, and what the host stores and checks so
that swipes, Re-reads, deletes and reloads give the same story. The frozen contract is
[contract/RB_CONTRACT.md](contract/RB_CONTRACT.md) §4 (identity), §6 (replay recording) and §10 E (the host
rows); this page says what the host does with them and how an owner uses it. Nothing here changes a module that
does not call the new APIs: its blocks, its spans and its replay are what they were.

Code: `src/v2/replay.js` (hashes, ids, shapes), `store.js` (replay, source map, chains, Re-read, reconcile),
`commands.js` (`ctx.replayGuard`, `ctx.source`, `ctx.hash`, the guard check), `persist.js` (`trimReceipts`),
`turn.js` (Re-read and replan only). Tests: `tests/v2/replay-guard.test.js`, `replay-source.test.js`,
`replay-chain.test.js`, with the test-only module in `tests/v2/helpers/guarded.js`.

## What a module does

```js
export default {
  id: 'my-rules',
  hooks: {
    // Pure: look at the state before the block, answer. Never write, roll or call a model.
    replayGuard({ state, query, hash }, { guard, source, block, operation, recorded, payload }) {
      const quest = state.domains.mine.quests[guard.predicate.quest];
      if (!quest || quest.state !== 'open') return { ok: false, reason: 'the quest is not open any more' };
      return hash({ ... }) === guard.inputHash ? { ok: true } : { ok: false, reason: 'its inputs changed' };
    },
  },
  commands: {
    'quest.settle'(ctx, payload) {
      // ... draft the changes, claim once ...
      ctx.replayGuard({ owner: 'my-rules', version: 2, epoch, rulesHash, inputHash: ctx.hash(inputs), predicate }, recorded);
      return { summary, data: { v2: { key: 'settle:...', result: { ... } } } };
    },
  },
};
```

* `ctx.replayGuard(guard, recorded?)` attaches the owner's requirements to the command's **root** transaction.
  Nested `ctx.call`s share it: the same guard again is a no-op, another one is `CONFLICT`. The guard's `owner`
  must be the module calling (`REFUSED` otherwise) and that module must have a `hooks.replayGuard`. A guard that
  is not a Guard (contract §4: `owner`, `version: 2`, `epoch`, `rulesHash`, `inputHash`, `predicate`) is
  `INVALID`. `recorded` (plain JSON, optional) is the durable inputs and draws the hook is given back.
  A command that fails after attaching one stores nothing: the block, its claims and its changes go together.
* `ctx.source` is the Source the block will carry (`{ sid, swipeKey, evidence, ordinal }`, `null` with no
  reply). It is there so an owner can put it in its `inputHash` (the B5 recommendation); the host stamps the
  same one on the block. Never a numeric message or swipe index.
* `ctx.hash(value)` and, in the hook's first argument, `hash(value)`: the contract's Hash, SHA-256 of normalized
  JSON (sorted keys, array order kept), 64 lowercase hex characters. Plain JSON only; it throws on anything else.
* `hooks.replayGuard({ state, query, hash }, { guard, source, block, operation, recorded, payload })` →
  `{ ok: true } | { ok: false, reason: string }`. `state` is the state **before** the block, `query` reads it,
  `operation` is the root `{ type, payload }`, `recorded` the second argument of `ctx.replayGuard`, and
  `payload` is `{ saved, current }`: the hash of the reply's text when the block was stored and the hash of it now
  (they differ after an edit or a Continue; the host does not drop a block for that, the owner may). A throw, a
  promise, no answer, `{ ok: false }` without a reason, or anything else **fails closed**. It is asked whatever
  the module's features say now: replay does not depend on settings.
* Claims: `ctx.claim(key)` as before. The host reads the keys a block adds from its `/meta/claims/…` ops and
  lists them on the span. The block's ops and claims are applied together or not at all.
* `receipt.data.v2` is stamped by the host: `schema: 2`, `epoch`/`rulesHash` from the guard, the host's `source`
  and `guard`. The owner's own fields (`key`, `result`, `evidence`, …) stay; it cannot set `source` or `guard`.

## The span

`record.spans` stays `[{ n, story }]` for legacy blocks (`n` ops each). A guarded block's span adds (contract §6 P12):

| Field | Meaning |
|---|---|
| `id` | `bl_` + 8 base36, stamped by the host; kept when the block is planned again |
| `module` | the root command's module |
| `source` | `{ sid: sr_…, swipeKey: sw_…, evidence: ev_…, ordinal }` of the carrier and swipe it was stored on |
| `guard` | the owner's Guard, or `null` |
| `claims` | the keys the block's ops add under `/meta/claims`, read by the host |
| `evidence` | `[]` for now (a placeholder for proofs) |
| `boundaries` | `[{ cursor: { sid, swipeKey, block, op, rev }, prefixHash, payloadHash }]`: where the block starts (ops before it on this carrier, meta.rev before it), the hash of everything before it, the hash of the reply's text |
| `operation` | the root `{ type, payload }` |
| `recorded` | the owner's second argument to `ctx.replayGuard` (or `null`) |
| `result` | `data.v2.result` when the command gave one, else its `data` |
| `replan` | `{ type, payload, seed }` of a system step that asked for `replan: true`, else `null` |

Ops stay flat. `n` delimits one atomic root transaction. A span with no `id` is a legacy block and replays on the
legacy path: it is never asked a guard, never reported as one, and cannot be made into a guarded one.

## Replay

Blocks replay one by one on the state before them. A guarded block is applied only when

1. its span is whole (`replay.js` `spanProblem`) and its `source` is the carrier's own pair;
2. the claims it lists are the claims its ops add;
3. its owner's `hooks.replayGuard` says `{ ok: true }` on the state before it;
4. none of the claims it lists is already held on that state (a retried settlement, or a block that woke up after its
   twin was stored, is never paid twice: `claim already held`);
5. its ops (claims among them) apply and every domain they touch still validates.

Guarded blocks fail closed on validators too: every domain the block touches must pass outright (a legacy block still
has an error that was already there forgiven; a guarded one does not).

A guarded block whose metadata was lost or cut down is **damaged, not legacy**. The host marks a guarded block itself:
its span has an `id` and its receipt carries `guarded: true` (a module cannot set it; a module's own `data.v2` never makes
a block guarded). One classifier serves replay, Re-read, reconcile and rewind: a block that is marked guarded but has no
whole span, or whose receipt kept another guard than the span's, is inactive (`REPLAY_PREREQUISITE`) and is never healed
into a legacy block by a Re-read.

Otherwise **neither the ops nor the claims** are applied. The block stays stored and inactive, and is reported
by `store.problems()` with `code: 'REPLAY_PREREQUISITE'`; it is asked again on the next replay, so a block turned
off by a Re-read comes back when its prerequisite does. The host never picks a replacement. A Re-read does not
refuse because a guarded block is inactive; it does refuse when a legacy block no longer applies, as before.
Where there is no module or hook to ask (the owner is not registered), the block is inactive too. So is a block
whose owner is held back (dormant, or the restore barrier is up): it is not asked until the module is ready. When
a module turns ready or dormant (the `modules` event) the turn calls `store.lifecycleChanged()`, which drops the
cached heads, so the block is asked again and applies once (and the screens get a `head` event); the store also
notices a change of which owners are ready on its next read.

## Source map and ids

Every record carries `source: { logical, swipeKey, evidence, next }` (contract §4's source map). It is worked
out from the record's stored `sid` and saved with it:

* The stored `sid` (`sw_` + 12 hex) is never rewritten, truncated or reinterpreted, and no id regex is widened.
  `logical` is `sr_` + 8 base36, shared by every swipe of one message (taken from a swipe that has one, else
  derived from the stored id of the swipe the new one was copied from). `swipeKey` and `evidence` are this
  swipe's own, derived from its stored id and stepped past any that another record already holds.
* A deleted earlier swipe shifts the index (`record.swipe`) and nothing else: the pair stays. A copied swipe
  (SillyTavern copies `extra`) is not the owner of the copied record: it gets a new stored id and a new swipe
  key, and the same `logical`. Continue, Re-read and edit keep the pair.
* The pair is worked out from the stored id, so what `ctx.source` shows during a command is what the record is
  written with, in the same write as the block that carries it. A record stored before this existed gets its
  entry (the same one `store.sourceAt` already showed) with its next write.
* `store.sourceAt(index)` → the Source of a carrier; `store.payloadHashAt(index)` → the hash of the shown swipe's
  text up to its `<Changes>` block (or the hidden comment that holds it once read): markup in the prose, such as a
  status panel or reasoning tags, is part of it; stray change lines that hiding moves out of the prose are too, so a
  reply that had some reads as changed once it is hidden. An edit or a Continue changes the hash and not the pair;
  the hash a block recorded in `boundaries[0].payloadHash` then no longer matches (the owner's hook is given both).
  That does not by itself take a block back: Re-read is how an edit reaches the story, and it plans the blocks again.
* Deleted mappings are archived (see "The archive of deleted ids"); saves and snapshots (a later package) keep their own copy too.

The ids a record may not take (another record's swipe key or evidence id, another message's canonical sid, a block
id) are looked up in an index found once per chat array, so a reply does not read the whole chat. A story line's block
id is named by the line (its command and text as written) and which time that line is read, so a Re-read of an
unchanged line keeps its id; other blocks are named by their receipt.

## What survives trimming

Receipt `data` goes past 200 carriers as before, **except** `data.v2`, which stays as `data: { v2 }` (guard, source,
result). Guards, results, operations and seeds also live on the block (`span`), and the receipt keeps its `seed`, so
replay never depends on a receipt's display data.

## Checkpoints

A checkpoint lists the records it covers (`covers`, as before). The first window that fails (a covered reply
was deleted, another swipe is shown) is a gap: a checkpoint with no `covers` after it cannot be checked and is not
trusted either, and when no checkpoint holds there is **no state to start from** (`head()` is `null` until
`ensureInitial` starts the chat again from the state the deleted replies ended with); the latest checkpoint is no
longer taken unchecked. A checkpoint made after the gap, over the records as they stand, holds again.
If the replies before the first reply that is left are gone and this session never saw them (a reload) and a checkpoint
is left, that checkpoint cannot be checked: `ensureInitial` does **not** adopt it or reset the story. The saved history is
kept as it is, the chat is read-only on an empty story (`store.readOnly().kind === 'unresolved'`) and a Problem offers
two actions, each asked twice: "Keep the story state from the earliest saved point" (`keepEarliest`: that checkpoint is
trusted as the start, with whatever the deleted replies left in it) and "Start this chat's story state over"
(`startOver`: the numbers begin again, the checkpoints after it go, the replies that are left replay on top). A session
that did see the deleted replies carries what they ended with, as before.
A checkpoint made after guarded blocks (anywhere before it) also carries `guardEnv`: the owners that were ready, with
their versions, when it was made. Its state holds what their guards allowed and a replay does not ask them again from
there, so it is trusted only while `guardEnv` is what the owners are now; a different set (an owner went dormant or
is absent, a new version of its guard code) fails it and the prefix is replayed with the guards asked. A readiness change
(`store.lifecycleChanged()`) replays from before such checkpoints, finds the guarded blocks a checkpoint hid, and only
then does the turn publish a head. When a covered record has guarded blocks the checkpoint also carries `coverHash`: the hash of those records' swipe
keys, every block's complete metadata (guard, recorded inputs, evidence, claims, boundaries, result), op digests and text.
A reply edited since, or a block changed, fails the window the same way.
Windows with no guarded block carry nothing new, and checkpoints of older chats are read as before.

## Re-read and reconciling

* `store.replaceStory` replays the blocks it keeps as a rebuild does (`step(…, { replayed: true })`). A kept
  guarded block is asked again on the new story, and its boundary is where it stands now.
* Guarded story lines are blocks of their own (`replaceStory`'s `blocks`: one `{ n, block, receipt }` per line);
  lines without a guard stay one block, as before. Ordinals are numbered on from `record.source.next`.
* A guarded system step with a `replan` (the span's, from a command that returned `replan: true`) is **planned
  again** by `rerun(state, receipt, { index, span })` on the state as it stands at its place, on this reply and
  on later ones: the old block (ops, claims, receipt) is not applied, the new one takes its place with the same
  block id, source ordinal, receipt id and seed (no new roll), and it claims again on the state without the old
  claim, so it claims once. If it is not done any more, the block, its claims and its receipt all go. All or
  nothing: a later legacy change that no longer applies throws and nothing is written.
* The step is asked again with what its **span** saved (`info.replan`: `type`, `payload`, `seed`); the receipt is only
  what was shown. Only an owner that answers **`NO_LONGER_DONE`** (`ctx.fail('NO_LONGER_DONE', …)`, exported as
  `NO_LONGER_DONE` from `store.js`) removes the block. When the step cannot be asked (the command is gone, the owner
  is held back or a feature is off, it threw, any other refusal) the old block is left exactly as it is and replayed as
  it was, so its guard decides: it stays off with `REPLAY_PREREQUISITE` when its guard fails. A step planned again to
  what it was changes nothing and writes nothing.
* `store.reconcile(index, { rerun })` does the same from carrier `index` to the head without a Re-read and returns
  `{ changed, planned, removed }`. **The turn calls it by itself** after a delete or swipe (not when a chat opens), from
  the first carrier that holds such a step, in the same save window, never while the story record is read-only, and only
  when a guarded step with a `replan` has been seen (`store.replansFrom()`, kept while replaying; no scan). What was
  planned again or taken back is a quiet Problem (`REPLANNED`).
* Revs after a planned-again block are numbered on from its rev, on the same reply and on every reply after it, so no
  two receipts share one and the order never goes back. The boundaries (`prefixHash`) of steps planned again follow
  what the reconcile has staged, not the chat as it stands (`store.boundaryProblems()` lists any that do not match).
  Delete and swipe publish one head, after the steps that follow were planned again.

## Preserved records

A stored `storySuite` value is **absent**, **ours** (a whole v2 record), or one Story Block never writes over: **newer**
(`v` above 2), **older** (v1, or no version) or **damaged** (a v2 record that is not whole, or not a record). Opening a
chat never writes over one, and neither does any command, capture, click or `setNarrated` (`take` and `write` refuse:
"kept as it is and not written over"), on the first reply or any other.

If the chat's first record is one of those, `ensureInitial` leaves it exactly as it is (no write, no repair). Until it
can be read the head is an empty state (the one `ensureInitial` was given), **read-only**: `store.readOnly()` says
`{ index, kind: 'future' | 'legacy' | 'damaged' | 'unresolved', why }`, every writer (`append`, `setNarrated`,
`replaceStory`, `reconcile`, `truncate`) throws a message that says so, and `ensureInitial` returns one note for the
Problems list (`DAMAGED`) that carries the reader's actions. A newer version shows "Update Story Block" and has no action.
The others offer **"Start this chat's story state over"** (and, for an unresolved start, "Keep the story state from the
earliest saved point"), **only on the reader's say**: Settings → Diagnostics shows them with a two-step confirmation;
`turn.repair(id, { confirmed: true })` (`store.startOver`, `store.keepEarliest`). Starting over sets an older or damaged
record aside, on every reply that has one, beside where it was (`extra.storySuiteAside`; nothing is deleted) and starts
the story's numbers from their beginning, the replies after it replaying on top. Nothing does this automatically.

## The archive of deleted ids

When a rebuild finds that the canonical sid, swipe key or evidence id of a reply or swipe this session knew has left the
chat, it archives them in the chat's metadata (`chatMetadata.storySuite.sourceArchive.deleted`, saved with the chat file by
SillyTavern's own save after the delete; not a change to save on its own). The index of ids is rebuilt from the chat plus
the archive after a reload, an archived id is never handed out again, and it confers no eligibility
(`store.archived(id)`, `store.archiveList()`). A delete made while the page was closed is not seen.

## Resets

A number an owner sets rather than moves goes through `ctx.absolute(domain, path)`: its op carries no `was` and
replays as written, so a reply deleted before it never turns a reset into a negative change. `ctx.absolute`
also covers a count written by removing the thing that holds it (an emptied stack). A reset written as a plain
change on a counter still moves the count by its difference on replay; the domain's validator refuses what that
would make negative, and the block is skipped, never applied half.

## Decisions where the contract is silent

* Block metadata is written only for blocks whose command called `ctx.replayGuard`; every other span is
  `{ n, story }`, so modules that do not use the API store and replay exactly as before. (A span with metadata
  and `guard: null` is valid: its claims are checked and nothing is asked.)
* `epoch` and `rulesHash` of a guard are carried and covered by `inputHash`; the host checks their shape, the owner
  checks their meaning. The host does not compare `epoch` with a state field (the savepoint epoch arrives with the
  timeline package).
* TODO (E6, timeline and restore): the host's comparison of a guard's `epoch` and `rulesHash` with the active savepoint
  epoch and frozen rules is a tracked gate of that package; E1 only checks their shape.
* A stale payload hash is evidence for the owner and for checkpoint identity, not a reason to drop a block.
* `Source.ordinal` is the next block ordinal of the swipe's record, never reused; `boundaries` holds the boundary
  the block starts at.
* `hooks.replayGuard` gets `hash` next to `state` and `query` in its first argument; `ctx.source` and `ctx.hash`
  are additions to ctx.
