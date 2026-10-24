# Proof and evidence: ctx.proof and story.evidence

How a module that owns a kind of proof gives it, and how anyone reads it. The frozen contract is
[contract/RB_CONTRACT.md](contract/RB_CONTRACT.md) §6 ("Proof submission", `story.evidence`), §3 (P23, the acceptance
rules) and §10 E (the `story.evidence` row); this page says what the host does with them. It builds on the span
metadata of [REPLAY.md](REPLAY.md): a proof lives on the block (span) of the command that gave it. A module that
does not call `ctx.proof` stores and replays exactly as before.

Code: `src/v2/evidence.js` (everything pure: kinds, payloads, pins, visibility, the query), `commands.js`
(`ctx.proof`, the block), `store.js` (stamping, replay check, `store.proofs()`), `domains/index.js` (the query is
registered by the core module). Tests: `tests/v2/evidence-proof.test.js`, `evidence-query.test.js`,
`evidence-turn.test.js`, `evidence-fuzz.test.js`, `evidence-turn-fuzz.test.js`, with the test-only owners in `tests/v2/helpers/evidence.js`.

## Giving proof

```js
commands: {
  'threads.accept'(ctx, { thread, selection, words }) {
    const made = ctx.proof({ kind: 'acceptance', payload: selection ? { thread, selection } : { thread, words } });
    // made = { id: 'pf_k3f9a2qz', payloadHash }; keep `made.id` where the thread needs it.
  },
}
```

`ctx.proof({ kind, payload, parents? }) → { id, payloadHash }`, inside any command (and its nested commands, which
share the root). The host checks, in this order, and a failure fails the whole root:

| Check | Code |
|---|---|
| The call is `{ kind, payload, parents? }` and nothing else; `kind` is text | `INVALID` |
| `kind` is one of the seven and the calling module owns it (table below); an unknown kind belongs to no one | `REFUSED` |
| The payload is the kind's closed payload; `parents` are up to 8 different proof ids | `INVALID` |
| Reader intent the host did not see (below) | `REFUSED` |
| The same key was given in this root with other contents (or other parents) | `CONFLICT` |
| A root gives at most 32 proofs | `LIMITED` |
| A parent is not a visible proof (stored, or pending in this root) | `NOT_FOUND` |
| There is no reply yet to hold the block | `FAILED` |

Who owns what (the module id the host's table names, `evidence.js` `OWNERS`):

| Module | Kinds |
|---|---|
| `story-director` | `visit`, `acceptance`, `event` |
| `rpg-battle` | `kill`, `use`, `rescue`, `story` |

The caller is the module whose handler runs `ctx.proof` (so a nested command gives its own module's proof, never
its caller's). The host stamps the **id**, the **Source** (the block's: `{ sid, swipeKey, evidence, ordinal }`) and the
**payloadHash** (the contract's Hash of the payload). An owner cannot set any of them, nor `data.v2.evidence` of its
receipt: the host writes that too.

### Identity

A proof is named by its **key**: an acceptance by its thread, a check by its check id, any other payload by the
payload itself. In one root, the same kind and key with the same contents (and parents) returns the same `id`; with
other contents it is `CONFLICT`. Two identical opaque payloads in one root are **one proof**, not two: a kind whose
payloads can repeat (two kills of the same foe in one reply) must carry a field that tells them apart (a counter, the
target's id). Note for RPG Battle's payloads (B3/B6).

The `id` is derived from the reply's evidence id (`Source.evidence`) and the key, then salted past an id that another
block of the chat holds (so the second proof of one key on a reply is its next occurrence). It does not depend on the
block or its ordinal, so:

* a new swipe has a new evidence id, so **fresh proof ids**;
* an edit alone changes no id; a Re-read that finds the same line gives the same id back (the ids of the blocks it
  replaces are free to be given again), so a guarded click that was built on the proof is still built on it. If the
  line's payload changed, the id is the same and the bytes are not: the pin differs, and what was built on the old
  bytes is hidden;
* two roots that give the same key are two proofs with two ids (a second click is a second proof).

The Source (and its `ordinal`) of a proof is that of the block that gave it, so a block planned again has a new ordinal
and the same proof id.

### Closed payloads

| Kind | Payload |
|---|---|
| `acceptance` | `{ thread: RecordId, selection: Text120 }` or `{ thread: RecordId, words: Text240 }`, exactly one of the two |
| `event` with a `check` key | `{ check: RecordId, actor: Id, stat: 'STR'\|'VIT'\|'AGI'\|'DEX'\|'INT'\|'LUK'\|'CHA', dc: 1..40 }` |
| every other payload (`visit`, `kill`, `use`, `rescue`, `story`, `event` without `check`) | a plain JSON object, not empty, at most 4096 bytes of normalized JSON |

A payload is plain JSON: no list with a gap in it, no object that contains itself, nothing nested more than 64 levels
deep (`INVALID`). Text is plain: no space at either end, no control character, counted in code points. The last row is the host's
placeholder for payloads the contract leaves to others (B3/B6 for RPG Battle, Story Director's own for visits and
events): the owner checks what they mean. When their shapes are frozen the table and `payloadProblem` grow; nothing
else changes.

### Reader intent

`acceptance` is the one kind that records what the reader did, so the host checks it (`intentProblem`):

* `selection` is the reader's own pick in a screen: the command must come from the reader (`cause: 'ui'`), not from a
  story line or a system step.
* `words` must be **a whole sentence of the reader's message the host gave this reply**: the message right before the
  reply (a system message aside), and only when it is the reader's, so a reply that follows another reply has none.
  Sentences end at `.` `!` `?` `...` `;` and line breaks (not at commas), cut before anything is folded. The words are compared after folding case,
  spacing and the marks at the ends (quotes, commas, dashes), and must be **at least two words**. A piece of a sentence
  ("take it" out of "I will not take it"), a single word ("No", "I", "Yes"), words that only the narration
  (`ctx.chat.reply`) says, a reply with no message from the reader and a click (it has no `ctx.chat`) are `REFUSED`.

**The host proves quoting, not meaning.** It guarantees that the words are something the reader wrote in that message;
it does not know that "No. I refuse the job, and I will not take it." is a refusal. Story Director's acceptance must
still judge that the quoted sentence accepts (its accept/decline check), and "No" or any refusal sentence must never
accept. Do not treat an `acceptance` proof with `words` as consent without that check.

## Where a proof lives, and when it is active

A command that gave proof stores a block even when it attached no guard (`guard: null`). The proof is kept in
`span.evidence` (the Proof of the contract: `id, source, owner, kind, payload, payloadHash, parents`, in this key order),
in short in `receipt.data.v2.evidence` (`{ id, kind, payloadHash }` each; `trimReceipts` keeps it with the rest of
`data.v2`; the span holds the bytes), and **pinned** in the state: the block's ops add `meta.proofs[id] = pin`.

* The pin is the SHA-256 of the lines `pin`, id, kind, owner, payload hash, then `parent id=parent's pin` for each
  parent. A proof stored as another kind or owner, or under another id, or with a parent given again with other bytes,
  no longer matches the pin it was committed with, and what was built on it is hidden with it.
* The pin is written by the same ops as the block, so it is there exactly when the block applied. A block that was
  skipped on replay (a guard that no longer holds, a reply deleted, a domain validator), a rolled-back root, a swipe that
  is not shown, a deleted reply: no pin, no proof. Checkpoints carry `meta.proofs` like any other state.
* **Only the block that owns a proof changes the record of pins.** Any change whose path (or `from`) is the document
  root, `/meta`, `/meta/proofs` or anything under it is a change to that record, whatever it is (add, replace, remove,
  move, copy; a whole record or an empty one). A block with no proof of its own (a legacy block) that makes one is not
  applied on replay (`REPLAY_PREREQUISITE`). A guarded block may make only the writes of its own pins, exactly the ones its
  span says (one per id, or the whole record with just those); anything else, an erase, a pin of another block, a rewrite
  of `/meta` or of the root, a move or a copy, and the block is not applied. A record lists the proof of a block only if
  replay could apply that block (it has changes, whole metadata that is the record's own, and exactly the proof its
  changes pin). What is shown is read from the state replay applied (`meta.proofs`), never from the spans alone: a
  hand-edited record cannot publish a proof through a span replay never applies, nor erase one that stands.
* On replay a block is applied only if its span holds exactly the proofs its ops pin, each whole, closed, of an owner
  that owns its kind and carrying the span's Source (`REPLAY_PREREQUISITE` otherwise, like a damaged claim list).
  A block's ids, kinds, owners, payload hashes and parents are part of the hash that says whether a block (and so a
  checkpoint window) is the one that was stored, and of whether a block planned again came out the same.
  The record `meta.proofs` is made when the state has none, and a write of the whole record becomes a write per id, so a
  block that stays never wipes the pins before it (a Re-read puts new lines ahead of the blocks it keeps).

## story.evidence

`story.evidence({ ids?: RecordId[] }) → Proof[]`, a public query (`sdk.query`, `view.query`, `ctx.query`).

* Shows a proof only when it is **active** (its pin is in the state), **visible** (its parents are shown, a cycle is
  not) and **code-validated** (whole and closed, its owner owns its kind, `payloadHash` is the hash of its payload, its
  pin matches its bytes and its parents' pins). A proof given twice (by two blocks) is shown by neither.
* Default: all, in source order (chat order, block order, the order given in the block). With `ids`: those, in the order
  asked, once each; only those proofs and their parents are looked at, not the whole chat's (the stored index is kept until anything is
  written), by a loop, so a chain of any length is read and a cycle is not shown. Unknown ids are left out. Malformed arguments (not a record, other keys, `ids` not a list, or with a gap in it, of at
  most 500 record ids) give `[]`.
* A deleted or skipped parent, or a parent given again with other bytes, hides its children; their blocks and changes
  stay as they are, only the proof is not shown. A skipped block publishes nothing.
* **Committed only, except in the root and in a Re-read.** A public query reads the stored blocks and the head's pins. Inside a command,
  `ctx.query('story.evidence', …)` also sees the proof this root has given so far (`tools.pendingProofs`), which is how a
  nested command "resolves its validated pending proofs"; nothing outside the root sees them before the commit, and a
  failed root leaves nothing. A Re-read stores nothing until all its lines and steps are planned, so the lines, the
  `afterCapture` hooks' views and the steps see the proof planned so far as if it were stored. The same holds while the
  store plans blocks again (`replaceStory`, `reconcile`): a step planned again, and the guards asked on the way, see
  the proof of the blocks planned before it (`store.proofs()` lays them over the stored bytes of the same id) and not the
  old bytes of the blocks they replace.
* Guards never read inactive raw text: an owner's `hooks.replayGuard` asks `query('story.evidence', …)` on the state
  before its block, which shows only what that state pins.

## Retention

| What | How |
|---|---|
| `trimReceipts` (200 carriers back) | keeps `data.v2` whole, `evidence` included; the span never loses it |
| Reload, branch, rewind | the proof is part of the record's span; a rewind keeps the blocks it keeps, with their proof |
| Checkpoints | the state they hold has `meta.proofs`; a window's identity covers the blocks' contents |
| Snapshots (timeline, a later package) | the same: the state and the spans; nothing here needs a second copy |
| Swipes | the other swipe's record is not the shown one's, so its proof is not active; showing it again brings it back |

## Decisions where the contract is silent

* **Kinds and owners** are a table in the host (`story-director`, `rpg-battle`); the contract names them by owner
  ("SD", "RB"). A third module cannot be added without the table.
* **Opaque payloads**: see above. Their key is the whole payload, so a different payload is a different proof, never a
  `CONFLICT`; a kind that needs `CONFLICT` on a changed payload needs a key in `payloadKey` when its shape is frozen.
* **The SD check** (`{ check, actor, stat, dc }`) is an `event` proof, since the contract's kind list has no `check`.
  Any `event` payload with a `check` key must be exactly that shape.
* **`selection`** is a text of the reader's pick (at most 120 characters), valid only from a reader's action.
* **Caps**: 4096 bytes for an opaque payload, 8 parents, 32 proofs per root, 500 ids per query. The contract names
  none.
* **A proof-only block** (no guard) is a metadata block with `guard: null`; its receipt's `data.v2` has `guard: null`,
  `rulesHash: null` and no `epoch` unless the owner sets one. **Such a block is not planned again by a reconcile**
  (`store.reconcile` plans the blocks that carry a guard and a `replan`): an owner whose proof must follow the story
  after a delete or swipe gives its step a guard.
* **Ids** are `pf_` + 8 base36, a RecordId as the contract says.
* **Identical payloads** of an opaque kind in one root merge into one proof (see Identity).
* **Edit**: an edit alone changes the text's hash (`store.payloadHashAt`) and, as in REPLAY.md, no block and no proof;
  a Re-read is how it reaches the story.
* **Checkpoint identity**: a window's hash covers each block's ops (which hold the pins) and the ids, kinds, owners,
  payload hashes and parents of its proof. The payload bytes are checked against their hash and pin when shown.
* **Rewinds and savepoints** (E6): the host's restore installs captured state; `meta.proofs` is part of `state.meta` like
  `claims`, and the bytes are in the spans a restore keeps. A restore removes the pins the save did not hold, so the proof the
  faded story gave is no longer active ([TIMELINE.md](TIMELINE.md) "Restore").

## What this does not do

It does not decide what a proof means. Whether a kill is a kill, a visit a visit or a rescue a rescue, and what an
`acceptance` is worth to a thread, is the owner's: Story Director's `threads.accept` verifies its acceptance with
`story.evidence`, and RPG Battle's rules read kills, uses, rescues and story steps the same way.
