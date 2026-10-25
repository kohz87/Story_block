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
* **Guards are pure, per §6.** On replay a guard is asked in a context that depends on the prefix alone: `state` (before the
  block), `recorded` (what the owner handed to `ctx.replayGuard` when it planned the block), `payload`, `hash`, and `query`
  limited to the queries the owner lists as `replayQueries: ['name', …]` on its module (they must depend on the state and
  their arguments only: not on settings, the clock or other messages), and `story.evidence`, the host's own, which any guard may ask (it
  reads the pins in the state and the proof of the blocks before this one, nothing else; EVIDENCE.md). Any other query, and `receipts()` inside one, throws,
  which fails the guard closed. What a guard needs from outside (a setting, a currency rule) is read **when the block is
  planned** and passed as `recorded`; it then comes back from the record, is hashed with the prefix, and cannot change an
  answer later. The host asks the same guard, in the same context, when the block is first stored (`append`, a Re-read's
  lines, a step planned again): a block whose guard would not hold on replay is **not stored** (the command fails), so a
  state built live and one built again by replay cannot disagree about it. **A `replayQueries` entry is a purity promise by the
  module, not isolation.** The host cannot see inside a query: one that reads a setting, the clock or any closure state of its
  own breaks its owner's contract (a settings change then moves the answer behind a trusted checkpoint, and a full replay
  disagrees with it). Modules are trusted code, so that is the module's bug to avoid, not something the host can stop; the
  registry checks only that each name is one of the module's own queries. The same goes for a hook that reads a global
  itself.
* Claims: `ctx.claim(key)` as before. The host reads the keys a block adds from its `/meta/claims/…` ops and
  lists them on the span. The block's ops and claims are applied together or not at all.
* `receipt.data.v2` is stamped by the host: `schema: 2`, `epoch`/`rulesHash` from the guard, the host's `source`
  and `guard`, and the `evidence` the command gave. The owner's own fields (`key`, `result`, …) stay; it cannot set
  `source`, `guard` or `evidence`. A command that gives proof (EVIDENCE.md) without attaching a guard makes a block
  too, with `guard: null`.

## The span

`record.spans` stays `[{ n, story }]` for legacy blocks (`n` ops each). A guarded block's span adds (contract §6 P12):

| Field | Meaning |
|---|---|
| `id` | `bl_` + 8 base36, stamped by the host; kept when the block is planned again |
| `module` | the root command's module |
| `source` | `{ sid: sr_…, swipeKey: sw_…, evidence: ev_…, ordinal }` of the carrier and swipe it was stored on |
| `guard` | the owner's Guard, or `null` |
| `claims` | the keys the block's ops add under `/meta/claims`, read by the host |
| `evidence` | the Proofs the command gave (`ctx.proof`, [EVIDENCE.md](EVIDENCE.md)); `[]` when it gave none |
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
into a legacy block by a Re-read. When the spans are gone or do not add up, the record's ops are one block that stands for
every receipt of the record: if any of those receipts is marked guarded, the whole block is inactive (and says so), not
classified from the last receipt alone.

**Quarantine.** A guarded receipt that names none of its record's changes (an older build renumbered the changes apart from
it) means what it guarded cannot be told. That is decided once per record, **on the record as it is stored, before any
filtering, rebasing or renumbering**, and the record applies **nothing** and is never filtered, renumbered or rewritten by
a Re-read or reconcile: every block of it, whether its span survived or not, stays stored and inactive (`REPLAY_PREREQUISITE`). It is
never planned again, nothing is added to it, a Re-read of it is refused and `truncate` (so a rewind) refuses to cut it down
rather than keep changes it cannot attribute.

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

**A checkpoint is trusted only over the exact prefix it was made over.** It stores `prefix`: a hash chained over every
record in front of it as it is shown now, from the first. A link is the hash of `replayInputsOf(record)` (`replay.js`), the
one function that lists **everything replay reads from a record**: its `ops` and `spans` in full, every receipt but its display
`data` (and the `data.v2` a trim keeps, with the guard the receipt kept), the source identity (`logical`, `swipeKey`,
`evidence`) and the `sid`; plus the text of a record that holds guarded blocks and the first record's own starting point.
A test reads replay through a recording proxy and fails if replay touches a record field that is neither listed there nor
bookkeeping, so what replay reads and what trust covers cannot drift apart. A replay reads the chain as it goes (a lookup per record; a change costs the records from it on) and
starts from the latest checkpoint whose stored `prefix` equals the hash in front of it now. So a reply deleted, edited,
read again or swiped before a checkpoint fails it, and so does the checkpoint of a swipe that is not shown: it needs no
rewriting, it just no longer matches. **A checkpoint with no `prefix` (older records, hidden swipes') is never trusted**
except as the first record there is; the replay starts from the nearest trusted one or from the start. A Re-read or
reconcile that rewrites a checkpoint stores the prefix it has now. `covers` (the records between it and the checkpoint
before it), `coverHash` (for guarded windows) and `guardEnv` (the owners) are further checks when they are there. When
no checkpoint holds there is **no state to start from** (`head()` is `null` until `ensureInitial` starts the chat again
from the state the deleted replies ended with); the latest checkpoint is never taken unchecked.
A checkpoint also **carries the Problems of the blocks that are off in front of it** (`carried`: the sid of the record, the
block's position, why and its code), so a reload that starts from it still tells the reader that a block no longer applies;
the message index is looked up again from the sid, so it follows a deleted user message. A Re-read or reconcile that rewrites
a checkpoint rewrites what it carries. The Problems after a rebuild are those of a full replay.
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
Windows with no guarded block carry nothing new. The checkpoints of an older chat (written before `prefix`) are **not** read as before: none of them is trusted except one that is the first record there is, so the first load of such a chat replays it from its start (about a second for 2,000 replies) and the replay writes nothing; the next checkpoint a new reply makes, or a Re-read or reconcile that rewrites one, carries the prefix and is trusted from then on.
A Re-read or reconcile that rewrites a checkpoint gives it the window it has now (the records from the checkpoint before it
up to the carrier before it), not the one it had, so a later delete cannot line the old window up again over a state that
includes a record the window no longer names.

## Re-read and reconciling

**A Re-read moves a kept block's position and nothing else.** A block it keeps (a click, a step it does not plan again) keeps
its saved payload hash, evidence, claims, guard, source, recorded inputs and results exactly as stored; only its boundary's
cursor and prefix hash follow where it stands now. So a reply edited since is still seen as edited by a pure
`saved === current` guard, and a block whose integrity metadata is damaged (claims that are not its changes' claims, another
reply's source, a receipt that kept another guard) is **not** healed: it stays exactly as stored and off.

* `store.replaceStory` replays the blocks it keeps as a rebuild does (`step(…, { replayed: true })`). A kept
  guarded block is asked again on the new story, and its boundary is where it stands now.
* Guarded story lines are blocks of their own (`replaceStory`'s `blocks`: one `{ n, block, receipt }` per line);
  lines without a guard stay one block, as before. Ordinals are numbered on from `record.source.next`.
* A guarded system step with a `replan` (the span's, from a command that returned `replan: true`) is **planned
  again** by `rerun(state, receipt, { index, span })` on the state as it stands at its place, on this reply and
  on later ones: the old block (ops, claims, receipt) is not applied, the new one takes its place with the same
  block id, source ordinal, receipt id and seed (no new roll), and it claims again on the state without the old
  claim, so it claims once. If it is not done any more, the block, its claims and its receipt all go. A Re-read or
  reconcile writes all of its records or none: if a later legacy change no longer applies, that call throws and writes
  nothing, which also means the steps after the change are **not** planned again then (the turn reports it as a Problem
  and they stay as they were, possibly out of date, until a later change lets the walk through).
* The step is asked again with what its **span** saved (`info.replan`: `type`, `payload`, `seed`); the receipt is only
  what was shown. Only an owner that answers **`NO_LONGER_DONE`** (`ctx.fail('NO_LONGER_DONE', …)`, exported as
  `NO_LONGER_DONE` from `store.js`) removes the block. When the step cannot be asked (the command is gone, the owner
  is held back or a feature is off, it threw, any other refusal) the old block is left exactly as it is and replayed as
  it was, so its guard decides: it stays off with `REPLAY_PREREQUISITE` when its guard fails. A step planned again to
  what it was changes no ops, receipt or result; its stored boundaries are rewritten when where it stands has moved.
  A block that is not intact on its own (its record damaged, the receipt kept another guard than the span's, it was recorded
  for another reply, its claims are not what its changes make) is not planned again: planning would bring back what replay
  keeps off.
* `store.reconcile(index, { rerun })` does the same from carrier `index` to the head without a Re-read and returns
  `{ changed, planned, removed }`. **The turn calls it by itself** after a delete or swipe (not when a chat opens), from
  the first carrier that holds such a step, in the same save window, never while the story record is read-only, and only
  when a guarded step with a `replan` has been seen (`store.replansFrom()`, kept while replaying; no scan). What was
  planned again or taken back is a quiet Problem (`REPLANNED`).
* Revs after a planned-again block are numbered on from its rev, on the same reply and on every reply after it, so no
  two receipts share one and the order never goes back. The boundaries (`prefixHash`) of steps planned again follow
  what the reconcile has staged, not the chat as it stands (`store.boundaryProblems()` lists any that do not match; it
  is clean for the steps planned again from where the walk started, not for guarded blocks without a `replan`, whose
  `prefixHash` is not rewritten when something before them changes, nor for a step before a still-valid checkpoint, which
  `store.replansFrom()` does not know of until a replay reaches it),
  and that holds also for a step planned again to the same result: its ops, receipt and result stay, its boundaries are
  stored as they now are. A Re-read or a reconcile also numbers the revs after the replies it rewrote on from the rev
  they ended on, so receipt revs are strictly increasing along the chat and the head's rev is the last. A swipe made
  before a Re-read and shown after it is numbered on the same way (a replay that meets a block numbered at or below the rev
  before it makes `store.replansFrom()` name that carrier, and the turn's reconcile after the swipe rewrites it). Every receipt a
  block stands for follows its ops through every rev they move to (not only the last), so a guarded receipt is never
  detached from its block; a record whose guarded receipt names none of its ops (an older build's) is quarantined (see above).
  Delete and swipe publish one head, after the steps that follow were planned again. Deleting the swipe that is shown
  is one change: SillyTavern tells of the deletion before it shows the next swipe. The shown swipe is told by whose
  record `extra` holds (stamped with the deleted index, or another swipe's own record in the slot), not by its text;
  until the swipe is loaded (`MESSAGE_SWIPED`) nothing is rebuilt, restamped, reconciled or published and no record is
  written, and a record is never mirrored over a slot that holds another swipe's own record. The load then does it once.

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
record aside, on every reply that has one, beside where it was (`extra.storySuiteAside`, a list of `{ kind, record }`
that only grows: a later repair adds to it and no entry is ever replaced or dropped) and starts
the story's numbers from their beginning, the replies after it replaying on top. Nothing does this automatically.

## The archive of deleted ids

When a rebuild finds that the canonical sid, swipe key or evidence id of a reply or swipe this session knew has left the
chat, it archives them in the chat's metadata (`chatMetadata.storySuite.sourceArchive.deleted`, saved with the chat file by
SillyTavern's own save after the delete; not a change to save on its own). The index of ids is rebuilt from the chat plus
the archive after a reload, an archived id is never handed out again, and it confers no eligibility
(`store.archived(id)`, `store.archiveList()`). The index of the ids a chat holds is built when the store first rebuilds over
it (and on every rebuild after), so a reply deleted before anything was written is archived too; it belongs to one chat
(its id): opening another chat in the same message array starts a new index and never puts the first chat's ids in the
second's archive. A delete made while the page was closed is not seen; the archive rides the next save.

## Resets

A number an owner sets rather than moves goes through `ctx.absolute(domain, path)`: its op carries no `was` and
replays as written, so a reply deleted before it never turns a reset into a negative change. `ctx.absolute`
also covers a count written by removing the thing that holds it (an emptied stack). A reset written as a plain
change on a counter still moves the count by its difference on replay; the domain's validator refuses what that
would make negative, and the block is skipped, never applied half.

## Where a block is: `ctx.cursor()` and `ctx.epoch`

Two facts about the block a command makes, for an owner that records them (an acceptance, a claim key) and checks them in its guard.

**`ctx.cursor()`** → `{ sid, swipeKey, block, op, rev }`, the contract's `Cursor`. It has two parts of different kinds.

* **Who the block is: `sid`, `swipeKey`, `block`.** The reply's canonical pair (the source map above) and the block's id, which is the hash of
  the pair, the block's operation (`evidence.js` `operationKey`: the command and the line or payload it was made with) and its **occurrence**
  (`replay.js` `blockIdOf`). The occurrence is a whole number given to a block **once, when it is first stamped**, and kept in its span
  (`span.occurrence`); it is never worked out again, compressed or reused. A new block takes the next number nobody has used in that reply for
  its operation (`record.source.taken` keeps the numbers of blocks that have gone, so an earlier block that goes does not hand its number to a
  later one), and every caller that plans a block that exists already (a step planned again, a reconcile, a rebuild, afterCapture's) passes
  the one it has. A Re-read gives the blocks it reads again the numbers of the blocks they replace **only while an operation has as many
  blocks as before**; when the count changes, none of that operation's old numbers is given again (EVIDENCE.md, the occurrence rules, which here apply to every
  guarded block, not only to those that give proof).
  Nothing else goes into the id: no counter, no receipt, no id the chat or the process happened to hold. What that keeps: the same block has
  the same id live, when run again by a Re-read of unchanged text, when planned again, after a reload, and when an earlier identical block goes
  (it keeps its own number). **What it does not keep:** a line (or step) that is removed and then added again is a new block with the next
  number; when a Re-read changes how many blocks an operation has, every block of it is new (a survivor does not take a deleted block's
  identity, and what stood on the old ones is hidden with a Problem: EVIDENCE.md); a block
  stored before occurrences existed keeps the id it was stamped with. Two identical clicks in one reply are two blocks. The id is the one the
  host stamps (it is handed to the block), and the store refuses to store a block under another sid, swipe key or id than its command read.
* **Where it sits: `op`, `rev`.** The changes before the block on the reply and the `meta.rev` before it, as they stand when it is read. These
  move: a Re-read that puts a line before a kept block shifts its `op`, and a saved cursor keeps what it was. **Anything that compares a saved
  cursor with a block (an acceptance cursor, a claim anchored at a block) compares `{ sid, swipeKey, block }`, never `op` or `rev`.** The block's
  first boundary (`boundaries[0].cursor`) is the cursor as it stands now.

A command that reads its cursor makes a guarded block or fails (`ctx.replayGuard`): no id is handed out that is never stored.

**`ctx.epoch`** is the epoch of the savepoints domain when the state has one (it is made by the first save point), else the genesis epoch
`ep_00000000`, so it works before there is a timeline and follows a restore's new epoch after. It is a property, read from the state the command
starts on.

*What "pure" means here.* Both are functions of the chat before the block and the state before it, nothing outside them, so a rebuild, a reload
and the other swipe's prefix give them the same. That holds for the identity (`sid`, `swipeKey`, `block`, as above: it depends on the occurrences the reply's
record holds, which are part of what replay reads) and for the epoch. `op` and `rev` are
pure too, but of the prefix as it is at the moment they are read, which is why a Re-read changes them for a kept block and why they are not an
identity. Nothing new is stored for any of it (the span already holds the boundary), so there is no new replay input: what an owner writes from
a cursor into its changes or `recorded` is already an input.

## Decisions where the contract is silent

* Block metadata is written only for blocks whose command called `ctx.replayGuard`; every other span is
  `{ n, story }`, so modules that do not use the API store and replay exactly as before. (A span with metadata
  and `guard: null` is valid: its claims are checked and nothing is asked.)
* `epoch` and `rulesHash` of a guard are carried and covered by `inputHash`; the host checks their shape, the owner
  checks their meaning. The host also compares them with the timeline (a guard's `epoch` with the savepoints domain's, its
  `rulesHash` with the `rules` slice's marker), when the state has them, on replay and when a block is stored: see
  [TIMELINE.md](TIMELINE.md) "The epoch and rules gate".
* A stale payload hash is evidence for the owner and for checkpoint identity, not a reason to drop a block.
* `Source.ordinal` is the next block ordinal of the swipe's record, never reused; `boundaries` holds the boundary
  the block starts at.
* `hooks.replayGuard` gets `hash` next to `state` and `query` in its first argument; `ctx.source` and `ctx.hash`
  are additions to ctx.

## Checking it

`node scripts/fuzz-replay.mjs <seed> <steps> [checkpointEvery]` is the property fuzz of this package: random chats of a guarded
test module (commands, swipes of any reply, deletes, edits, reloads, Re-reads, reconciles, rewinds, and records damaged on
purpose: stripped spans, legacy checkpoints, an orphaned receipt, an edited receipt guard or source identity, a changed outside
setting), and after every step the head, the state at sampled replies and the Problems must be what a replay from the first
record gives, revs strictly increasing, no guarded effect without its guard, no effect from a quarantined record. Example:
`for s in $(seq 1 300); do node scripts/fuzz-replay.mjs $s 120 $(( (s % 2) * 3 + 4 )); done | grep -v '"fails":\[\]'` prints
nothing when it holds.

A thrown replay guard is also a store Problem when its block was only a tentative plan and was never stored.
The shared guard check names the module, predicate kind (or explicitly missing kind), and the exception text,
including the refused query for an undeclared replayQueries access. It refuses the new changes/claims. E1's rule
for failed replacement plans still applies: a valid old block may stay, but the failed replacement is diagnosed.
Diagnostics for an unstored plan are held in memory for its chat/source and survive a rebuild in that session;
stored inactive blocks use the usual replay Problems and checkpoint retention. No diagnostic writes chat bytes.
