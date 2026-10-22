# Story Suite v2: specification

Status: **draft 1, the contract for the v2 build.** Every v2 agent builds against this file. A change to it
goes through the coordinator (a PR to `docs/v2/SPEC.md` on Story Block's `v2` branch), never a local
workaround in one repo.

## 0. Principles

1. **Code first, narration second.** Everything that is arithmetic, a lookup, a rule or a roll is done in
   JavaScript on structured JSON before the model writes. The model narrates what happened, voices
   people, names things and *proposes* new facts; code validates every proposal and sets every number.
2. **State lives in replies.** Each reply carries the changes it made. Swiping or deleting a reply takes
   them back. Re-narrating (swiping the reply that *tells* an action) never repeats the action.
3. **One writer per domain.** Each piece of state has exactly one owning module; everyone else reads it or
   asks the owner through a command.
4. **The model never sees JSON.** Modules render compact text views. The prompt keeps the cache layout:
   a byte-identical static part early, everything that changes at depth 0.
5. **One model call per turn by default.** Extra calls (an after-reply extractor, an action classifier) are
   opt-in.
6. **Plain extensions.** No server plugin, no build step: ES modules SillyTavern loads as they are, Node's
   test runner, no runtime dependencies.
7. **Fresh start.** v2 does not read v1 chats or v1 blocks. A v1 chat opened with v2 is treated as a chat
   with no state (the greeting gets a fresh initial state).

## 1. Products and repositories

| Product | Repo | v2 role |
|---|---|---|
| Story Block | kohz87/Story_block | The host: state store, persistence, commands, capture, prompt assembly, module registry, settings overlay, tabs. Core domains `scene` and `inventory`. Works alone. |
| RPG Battle | kohz87/rpg_battle | Module (requires Story Block): `party`, `combat`, `trade`, `bestiary`; item effects, checks, crafting. |
| Story Director | kohz87/Story_director | Module (requires Story Block): `director` (time, quests, threads, events). |
| NPC State Delta | kohz87/npc_state_delta | Stays a standalone engine with its own storage. When Story Block v2 is present it registers queries, a widget and its settings (phase 2). Not rewritten. |

Work happens on a **`v2` branch in each repo** (created from `main`). `main` stays v1 until v2 is released.
Versions on `v2`: `2.0.0-alpha.N` (manifest, package.json, `VERSION`, README header). Feature work is a
branch off `v2` and a PR into `v2` (CI runs on every PR).

v2 keeps v1's **pure logic** where it fits (combat maths, growth, skills, pricing, crafting maths, the
Director's change-line grammar and tracker rules, NSD's engine) and replaces the glue: no state in
model-written blocks, no envelope parsing, no text repair.

RPG Battle and Story Director declare `"dependencies": ["third-party/Story_block"]` in `manifest.json`
(SillyTavern 1.19 checks it) and also check at runtime (`globalThis.StoryBlock?.sdk`); without the host
they show one line in their drawer saying Story Block v2 is needed, and do nothing else.

## 2. State

### 2.1 The document

```js
State = {
  v: 2,
  meta: { rev: 0, claims: { /* key: true */ } },
  domains: { scene: {...}, inventory: {...}, party: {...}, director: {...}, /* module domains */ },
}
```

* Plain JSON only: objects, arrays, strings, finite numbers, booleans, null. No `undefined`, Dates, Maps.
* Integers for quantities, money (smallest unit), HP/MP, minutes. Reject NaN/Infinity/negative where a count
  is meant (validators, §2.5).
* Records keyed by **ID** (`{ [id]: record }`), never by name or array position. Names are display fields.
* IDs: `<prefix>_<base36>` from `sdk.id(prefix)` (crypto random, 8 base36 chars), e.g. `it_k3f9a2qz`.
  Definition IDs are namespaced slugs: `story/moonveil-trout`, `pack.fantasy/iron-sword`.
* `meta.rev` increments on every committed change. `meta.claims` holds one-time keys
  (`quest:q_ab12cd34:paid`) so a reward can never be granted twice on the same line of history.

### 2.2 Where it is stored

Only **carriers** hold state: non-user messages (the greeting and every assistant reply; system/narrator
messages too). User messages hold nothing.

```js
message.extra.storySuite = {
  v: 2,
  checkpoint: State | undefined,   // full state at the START of this carrier (before its ops)
  ops: Op[],                       // what changed in and after this carrier, in order
  receipts: Receipt[],             // the committed actions whose ops are in `ops`
  narrated: string[],              // receipt IDs this reply told (§4.3)
}
```

As built (store.js), the record also carries `sid` + `swipe` (which swipe wrote it, so a record SillyTavern
copied into a new swipe is ignored there), `mark` (`{ t, d }`: a hash of the swipe's opening text and its
send_date; a copy that slid into a deleted swipe's index has the other swipe's text and date, and is ignored
too; only both parts differing tells a copy, so an edit or a Continue never costs a reply its record),
`spans` (`[{ n, story }]`: how many ops each stored receipt added, and whether it was a `story` capture),
`rev` (`meta.rev` after its last write, for save verification) and, with a checkpoint, `covers` (the `sid`s
of the records from the checkpoint before it up to this one). A checkpoint must be a whole State (`v: 2`,
object `meta` with a whole-number `rev`, object `domains`); a damaged record is skipped and listed as a
Problem. `head()`/`at()` return `null` for a chat with no v2 state.

SillyTavern copies `message.extra` per swipe (`swipe_info[n].extra`), so each swipe has its own changes.
Story Block writes `message.extra`. It keeps the shown swipe's copy, `swipe_info[swipe_id].extra`, in step
only where SillyTavern can read it back: on the last carrier (the one the reader swipes) and on a carrier
with more than one swipe (a branch from a swipe picked in the swipe list reads it). On the others it drops
it, so each record is stored once; when a deletion makes an earlier carrier the last one, it gets the copy
back on the rebuild. SillyTavern's own copies of the other swipes are left as they are. (SillyTavern 1.19
reads `extra` back only in `syncSwipeToMes`: a swipe, which first copies the shown swipe itself, and a
branch from the swipe picker; see persist.js.) Readers accept either shape: replay reads `message.extra`.

* **The greeting** (first carrier) always holds a checkpoint: the initial state (§2.6). When the first
  carrier is deleted, the new first carrier gets the state the deleted ones ended with as its checkpoint and
  keeps its own changes; a record already there is never replaced.
* A carrier gets a checkpoint when 100 carriers have passed since the last one, or the ops since then
  exceed 128 KB of JSON and twice the last checkpoint's own size, at least 10 carriers after it (one domain
  that rewrites a big list on every reply cannot bring a checkpoint every few replies). The checkpoint is
  the state *before* that carrier's own ops. A checkpoint is read wherever it is (chats written before
  this rule have one every 20 carriers / 32 KB).
* **Old receipts (a contract for modules).** Receipt `data` older than 200 carriers may be dropped;
  modules must not rely on it. Story Block drops it from receipts 200 or more carriers before the head;
  every other field stays (`id`, `type`, `module`, `cause`, `seed`, `summary`, `narrate`, Re-read's `line`,
  a system step's `replan`, `rev`). What a module needs from its own past receipts later (a clock, a day's facts, a history) it
  keeps in its own state.
* **State at carrier N** = the latest checkpoint at or before N that still holds, then every carrier's `ops`
  from there through N. A checkpoint holds when its `covers` matches the records the chat has now since the
  checkpoint before it; one made over a reply since deleted (or another swipe) is passed over. A checkpoint
  without `covers` is trusted; when none holds, the latest is used.
* **Block-level replay.** A carrier's ops are replayed block by block (`spans`: one block per stored
  receipt, one for a Re-read's story changes). A block that no longer applies (a middle reply deleted, a
  hand-edited chat) is skipped and reported alone, its receipts' revs still counted; the blocks before and
  after it, and their claims, still apply.
* **Counts move.** A domain may declare `counters` (number paths inside it, `*` for one key; the inventory
  has `wallets/*/coin` and `stacks/*/qty`). A `replace` of a counter keeps the number it replaced (`was`).
  On replay, when the path holds another number (an earlier reply was deleted), the op adds its change
  (`value − was`) instead of writing its number, and the moved domains' validators run; a refusal skips
  that block as above. A `remove` of a thing that holds a counter (a stack a reply emptied) keeps that
  counter's number (`was`) and where it sits inside the thing (`count`, e.g. `/qty`); on replay, when the
  thing holds another number, `was` is taken from it instead (the rest stays; less than `was` there goes
  below zero and the validator refuses the block). A moved count named `qty` that comes to exactly 0
  removes the thing holding it (a stack is never kept at 0). A count that is not there at all (the reply
  that made it was deleted) counts from 0: it is added as the op's change alone, and its holder is made for
  it only when holders there are nothing but that count (a wallet `{ coin }`, never a stack). Ops without
  `was` apply as written. A command that **sets** a count to a number rather than moving it (Story
  Director's `~ time <date>`) calls `ctx.absolute(domain, path)` (`path` inside the domain, like
  `/time/minutes`) before it returns: that write keeps no `was`, so replay applies it as a set, exact
  whatever an earlier deleted reply did, and later moves (with `was`) add on top of it. It is written even
  when the count already holds that number, so a replay that finds another number there sets it too.
* **Replayed blocks are checked.** After each replayed block the validators of the domains it touches run
  (§2.5); a block that brings a problem the state did not have before it (a stack whose definition a
  deleted reply made, a route to a deleted place) is skipped and reported like one that does not apply.
* **Per-reply bookkeeping** (design rule): what each reply writes for itself (a budget tally, a "seen this
  reply" mark) is kept under the reply's record ID (`ctx.carrier.sid`, which stays with the reply when an
  earlier message is deleted), written with `add` and dropped by later replies, or derived from receipts.
  Never a positional list append (`add /x/N`), and never a `replace` of a field of a shared object an
  earlier reply created: replayed after that reply is deleted, such an op fails and its block is lost. A
  domain may name such fields `scratch` (a list of top-level fields, the inventory's `perReply`): on
  replay a `remove` inside one of something already gone is passed over, missing objects on the way are
  made, and a `replace` of something not there becomes an `add`. A list inside a scratch field
  is not fitted: an append (`/-`) or a list position in it applies as written, as anywhere else.
* **Four replay rules that keep such bookkeeping bounded.** (a) On replay (never for a live command), a
  `remove` of an object key that is not there (the reply that added it was deleted) does nothing instead
  of failing its block; a `remove` that carries a counted `was` (a take of a stack) still fails, so a sale
  of a thing that is gone is not paid. A later reply may so prune what earlier replies added: an entry
  the deleted reply had already pruned may come back until the next prune. (b) When a list only grew at
  its end, `diff` stores each new element as `add /path/-`, which appends at the end as the list stands
  on replay. Other list changes replace the list whole. A `replace` of a list element by its position
  is still positional, so a module keeps records it changes later under keys, not in a list. (c) On replay
  (never for a live command), a `replace` of an object key inside a domain that is not there, because only
  a deleted reply had added it, is applied as an `add` when its parent object is there: the value is the one the later
  reply set, so the result is the same (a later `~ hook X | now: …` survives deleting the reply that first
  set `now`). Not for counted ops (`was`), which keep the counter rules above; with no parent object (or
  a list position) the op stays as written and its block fails.
  (d) A command whose writes inside one thing only make sense while that thing is there (Story Director's
  `time.settle` closing a thread time ran past) calls `ctx.ifThere(domain, path)` (`path` inside the
  domain, like `/threads/th_x`): its ops inside that path are stored with `within: <the thing's full
  path>`. On replay (never for a live command), when the thing is not there (the reply that made it was
  deleted) and no earlier op of the block put it there, those ops are passed over and the rest of the
  block applies; an `add` of the thing itself is never passed over. An older Story Block ignores
  `within` (the block fails as before).
* **Head state** = state at the last carrier. Actions taken after reply N are appended to reply N's `ops`
  (so deleting or swiping reply N takes them back too).
* Story Block caches the head state and the most recent checkpoint in memory and rebuilds on chat change,
  message deletion, swipe, and branch/checkpoint load. Rebuilding replays stored ops only; it never runs a
  command handler again.

### 2.3 Ops

A subset of JSON Patch (RFC 6902): `{ op: 'add' | 'replace' | 'remove', path, value?, was?, count? }` (`was`:
the number a counter's `replace` replaced, or the counter's number in a thing a `remove` took away, `count`
naming that counter inside it, §2.2). Paths are JSON
Pointers into the State (`/domains/inventory/stacks/it_k3f9a2qz/qty`). No `move`, `copy`, `test`.
Ops are produced only by Story Block's commit step from what a handler wrote (§3.2); modules never write ops
by hand.

### 2.4 Receipts

```js
Receipt = {
  id: 'rc_xxxxxxxx',
  type: 'item.use',                 // the command
  module: 'rpg-battle',             // owner of the command
  cause: 'ui' | 'story' | 'system', // a click, a captured change line, the host itself
  seed: 123456789,                  // uint32; the handler's only source of randomness
  summary: 'Ren drinks a Minor Healing Draught: +20 HP (now 77/82).', // code-written, for narration
  narrate: true,                    // tell the next reply?
  data: { /* small, command-specific: what the UI shows; may be dropped 200 carriers on (§2.2) */ },
  rev: 41,                          // meta.rev after this receipt
}
```

### 2.5 Validation

Each domain registers `validate(slice, state) → string[]` (empty when fine). After a command's changes are
applied to a draft, every touched domain's validator runs; any error rejects the whole command (nothing is
saved). Story Block also checks generic rules on every op: integers stay integers, no NaN/Infinity, no
negative `qty`, IDs well-formed. A shared helper `sdk.check` offers small schema checks
(`check.int(v, {min})`, `check.str(v, {max})`, `check.oneOf(v, list)`, `check.id(v, prefix)`); full
JSON Schema is not required.

### 2.6 Initial state

On a chat with no v2 state, Story Block builds the initial state: `meta` plus each registered domain's
`initial()`. Phase 3 adds pack start states and character creation on top. A module registered later (enabled
mid-chat) gets its `initial()` slice added by a `system` receipt on the head carrier; so does a domain a
chat lacks (a newer module version's), and only that domain. A domain whose `initial()` throws is left
out (logged once) and tried again at the next turn; the other domains are not affected.

## 3. Commands

### 3.1 Calling

```js
const sdk = await globalThis.StoryBlock.ready;           // resolves when the host is up
const result = await sdk.command('item.use', { stack: 'it_k3f9a2qz', target: 'ac_7h2m9x4q' });
// → { ok: true, receipt } | { ok: false, code: 'NOT_ENOUGH', message: 'There is no Minor Healing Draught left.' }

const preview = await sdk.preview('trade.sell', payload);  // runs the handler on a copy, nothing saved
// → { ok, receipt, token }   then   await sdk.commit(preview.token)  // commits exactly that result
//   (rejected with code 'STALE' if the head state changed since the preview)
```

**`sdk.command` runs the reader's own action only (cause `ui`).** Screens, widgets, layouts and modules
all come through it, so an option naming another cause is refused (`REFUSED`), and so is an internal
command (`capture.*`, `module.init.*`, `events.fire`). `story` and `system` are Story Block's own steps
(capture, cues, set-up) and go to the command bus directly; a module's handler that needs another
module's command uses `ctx.call` (§3.2), which keeps the cause of the action it runs in.

`sdk.reread(index)` reads reply `index`'s `<Changes>` block again (as its shown swipe has it now) and
replaces the `story` changes stored on it the way a fresh capture would: the reader's actions and system
steps on that reply stay after them, with their claims, and later replies are checked again on top (if one
no longer fits, nothing changes, `CONFLICT`). → `{ ok: true, receipts, problems } | { ok: false, code,
message }`; refused for the reader's messages, system messages, messages without a record and while a reply
is being written. It emits `turn` with `{ index, type: 'reread', problems }` and saves once. Each story
receipt keeps a mark of the line that made it (`line`, a hash of its text); a line read again gets the seed
of the receipt its unchanged text made before (in order, by kind), so what it makes keeps its IDs and the
reader's later actions on them still fit; a changed or new line gets a fresh seed.

### 3.2 Handlers

```js
commands: {
  'item.use'(ctx, payload) {
    const inv = ctx.read('inventory');                  // frozen copy of any domain
    if (!ctx.claim(`use:${payload.stack}:${ctx.receiptId}`)) ...  // one-time keys (§2.1)
    ctx.call('inventory.consume', { stack: payload.stack, qty: 1 }); // sub-command, same transaction
    const party = ctx.draft('party');                   // mutable draft: OWN domains only
    party.actors[payload.target].hp.cur = Math.min(max, cur + 20);
    return { summary: 'Ren drinks …', data: { healed: 20 }, narrate: true };
  },
}
```

* `ctx.read(domain)` deep-frozen copy; `ctx.draft(domain)` mutable draft, **only for domains the module owns**
  (otherwise `NOT_OWNER`). `ctx.call(type, payload)` runs another module's command inside the same
  transaction (its changes land in the same receipt chain; its summary is not narrated separately).
* `ctx.rng()` → float in [0, 1) from the receipt's seed (sfc32). `ctx.roll('2d6+1')` helper. No `Math.random`.
* `ctx.claim(key)` → false if already claimed on this line of history, else claims it.
* `ctx.absolute(domain, path)`: this command's write of the counter at `path` is a set, not a move (§2.2);
  `ctx.ifThere(domain, path)`: its writes inside the thing at `path` are passed over on replay when that
  thing is gone (§2.2 rule d). Both only for a domain the module owns (`NOT_OWNER`), `path` a pointer
  inside it (`INVALID`).
* `ctx.query(name, args)` runs a registered query against the transaction's current state (drafts included).
* `ctx.settings(moduleId?)`, `ctx.time()` (the Director's minutes, or null), `ctx.feature(id)` (whether the reader has
  that feature on, §6), `ctx.fail(code, message)` throws.
* A failed `ctx.call` fails the whole command even if the caller catches it, except `UNKNOWN_COMMAND`
  and `FEATURE_OFF` (nothing ran), which a handler may catch to treat another module's command as optional.
* A handler may add `problem: 'sentence'` to its result: done, but not all of what was asked (a clamp).
  For a capture the sentence goes to the Problems list (`LIMITED`); it is not kept in the receipt.
* A system step (cause `system`, a beforeGenerate cue) may add `replan: true` to its result: what it did is
  planned from the story state it ran on (RPG Battle's story-time heal). Its receipt keeps `replan: {
  payload }`, and a Re-read of the reply it is kept on runs it again on the new story changes, at its place
  and with its seed, instead of applying its old ops; a step that is then refused leaves its block out.
* `ctx.call(type, payload, { as: 'event:<id>' })`: the events part's steps run with that `ctx.caller`.
* Every committed receipt bumps `meta.rev`. A preview goes `STALE` if `meta.rev`, the head index or the head
  state changed, or a feature was turned on or off; its command's feature is checked again (`FEATURE_OFF`). ID rule (check.js): `<prefix>_<8 base36>` or a namespaced slug (`story/moonveil-trout`).
* `bus.run(type, payload, { cause, seed, state, capture })` (used by capture) runs a handler without
  appending; `state` chains the lines of one reply; `capture` passes `registry.capture(kind)` as is.
* Handlers are synchronous and pure apart from `ctx`: no network, no model calls, no DOM, no awaits.
* Commit: run the handler on drafts → diff drafts into ops → validate (§2.5) → bump `meta.rev` → append ops
  and receipt to the head carrier → save (§3.3) → emit `committed`. Any throw rejects the whole command.

### 3.3 Saving

A reader's action (`sdk.command`, `sdk.commit`) is saved at once, before its result comes back; Story Block's
own steps (events, a module set up) save 400 ms after the last one; a generation starting flushes the
pending save first; the after-reply capture (§4.2) saves once at its end. Cues committed before a reply
(§4.1 step 3) are saved with that reply's save, not on their own (each save writes the whole chat file); a
generation that ends without the reply (GENERATION_ENDED / GENERATION_STOPPED), or a chat opened meanwhile,
saves them then.

Each change remembers the chat it was made in (the chat ID and the head carrier). Right before a save starts
writing, in the same tick, the store checks that this chat is still the one open: SillyTavern opens another
chat by emptying the shared `chat` array, then naming the new file, then reading it, so a save in between
would write the wrong chat. An empty chat (one being opened) is not saved, and tried again shortly; when
another chat is open, the open chat is not saved and the change goes into its own chat's file (read back
from the server; only its records are put onto the same messages). The same chat read again (a reload)
takes the change onto its messages as read back.

In SillyTavern, Story Block writes the chat file itself (`/api/chats/save`, the body SillyTavern's own
saveChat sends) instead of `ctx.saveChat`, which waits at least 100 ms before reading the chat and swallows
errors and timeouts. A refused save throws: the state stays marked unsaved, the reader is told once, and it
is tried again (1, 2, 4, 8, 15 s). A save (or a rescue) the server does not answer within 20 s counts as
refused (the request is given up), so it never holds later saves, the reader's command or the next reply.
A request given up that way may still be written: its body can already be at the server, which writes it
when it gets to it, after the retry that carried a newer change (both carry the same integrity token). So
after a timeout of a save or a rescue, that chat is *suspect*, by its chat ID: each later write of it (a
save or a rescue) carries a rising number in `chat_metadata.storySuiteSave`, the page keeps a copy of what
it wrote, and once one is answered the file is read back (`/api/chats/get`) after 10, 20, 40, 80 and 160 s
(about five minutes, past which a server drops a request whose body has not arrived), whether that chat is
still open or not. A file holding a lower number (or none) is put right at once: the open chat is saved
again when it holds that write or a newer one (its newest record, by `sid` and `rev`), otherwise the copy is
written back into that chat's file (the reader is told to reload when that chat is open). A rename moves
the read-backs with the chat; they are kept in the browser's storage too, so a reload of the page goes on
with them (without the copy: if the file is then found older, the reader is told). Without a timeout
nothing is stamped, kept or read, and the read-backs never hold a save, a command or the next reply (each
is given up after 20 s too). A late write more than five minutes later is not found.

A chat being opened is waited for however long it takes (every 200 ms for 10 s, then every 15 s); the
change is never dropped for it. It verifies the head carrier's `extra.storySuite.rev` after each save (as
v1's coordinated writes did), finding the record by its `sid` when a deleted swipe moved it. A save that
was on its way while the chat was renamed does not count: the change is saved again into the renamed
chat's file (the copy the late request made under the old name stays on the server). A rescue finds each
message in the other chat's file by its record's `sid` (or its story text), skips one the file already
holds as it is, and marks the file as used (`chat_metadata.tainted`), as a save of the open chat does. Without such a file (the testkit, a
temporary chat) it is `ctx.saveChat()`.

When the page is hidden (a tab switch, a phone putting the browser away: `visibilitychange`), hidden for
good (`pagehide`) or closed (`beforeunload`) with something unsaved, the newest state goes out with
keepalive at once, even while an earlier save is still on its way (it is not queued behind it; on hidden a
save on its way that already carries the newest change is not sent again). A browser sends keepalive only
for a body up to 64 KiB, counted in bytes as sent (UTF-8, so a chat in Japanese or with emoji is 2-4 bytes a
character; Story Block measures with TextEncoder and allows 60 KiB for the headers), which most real chats are over, and SillyTavern 1.19 cannot write part of a chat
file: so on `beforeunload` the browser asks first whenever the unsaved body is too big for keepalive, as it
does while saves are failing or one is still on its way. On a phone, where a page often goes from hidden to
gone, the save on hidden is what keeps the change.

Not covered: two tabs on one chat are still last writer wins (the file's head is not compared before a
save).

## 4. A turn

### 4.1 Before the reply (generation interceptor; normal, swipe, regenerate, continue only)

1. Flush pending saves.
2. Collect **untold receipts**: receipts with `narrate: true` on carriers after the last reply that told
   them (`narrated`), i.e. what happened since the last narration, oldest first.
3. Each module's `beforeGenerate(view, { type, dryRun, commit })` may return cues (due events, met
   conditions) as receipts of cause `system` (committed now, on the head carrier) or as plain tail lines.
   On a Continue or a dry run (SillyTavern counting tokens) `commit` is false and nothing is committed.
   (SillyTavern 1.19 runs no interceptor for a dry run, so the interceptor never takes its own generation
   for one; it is not read from GENERATION_STARTED, which another caller's dry run can send in between.)
   A pack event fires only from its own definition (the payload names its id); a repeating one at most
   once per reply (claim `event:<id>:<reply index>`).
4. Assemble the prompt (§5).

Quiet and impersonate generations get nothing (both slots emptied) and capture nothing.

### 4.2 After the reply (MESSAGE_RECEIVED for the new carrier)

1. Read the `<Changes>` block from the reply (hidden by Story Block like v1 blocks). Each line is a proposal.
2. Parse lines with the shared grammar (§4.4) and hand each to the module that owns its `kind`, in reply
   order. The module's `capture(ctx, line)` runs **as a command** with cause `story` (same rules as §3.2):
   it resolves names to IDs, sets numbers by code, and rejects what it cannot accept (logged in the
   module's Problems list, never thrown at the reader).
3. Record `narrated` = the untold receipt IDs given to this reply.
4. One save.

A capture runs with `ctx.carrier = { index, swipe, sid, key }` (frozen; `String(ctx.carrier)` is `key`,
`"<index>:<swipe>"`) and `ctx.chat = { lastUser, reply }`. `sid` is the reply's record ID (its shown swipe's;
handed out before the record is first written): unlike `index`, it stays with the reply when an earlier
message is deleted, so a claim a module keys on a reply should use `sid`. `null` when unknown.
During a Re-read the capture runs on the state before the reply, and `ctx.standing` is the reply's state
as it stood before the Re-read (frozen; `null` otherwise), so per-reply bookkeeping that the reply's kept
blocks (its clicks) wrote can still be counted.
Every command also has `ctx.reply = { index, sid }` (frozen, or `null` with no reply yet): the reply its
changes are stored on, the capture's carrier during a capture, else the head carrier (a click's ops go
to the last reply, §2.2). A query gets the same as `tools.reply` (for `sdk.query`, the head carrier), so
per-reply bookkeeping can be kept and read for a click after the reply as well (RX-E-2).

A swipe of that reply is a new carrier swipe: it gets its own capture; the receipts it told are told again
because the new swipe's `narrated` starts empty. Editing a reply's text does not re-capture; a **Re-read**
action in Story Block (`sdk.reread`, §3.1) replaces that carrier's `story` receipts with a fresh capture
(its `ui` and `system` receipts stay after them; a system step marked `replan`, §3, runs again on them).

### 4.3 What the model is told

The tail starts with `[Happened]` and one `summary` line per untold receipt. Receipt summaries are written
by code with the code's numbers. The first five are always kept; past half the tail budget the rest are told
as one counted line, "…and N more things happened." `{{user}}` and `{{char}}` are filled in (one line of at
most 80 characters) before any budget is counted. The static instruction says: tell these as they happen in the scene, keep
the numbers, do not repeat them as changes.

### 4.4 The change-line grammar

One hidden block at the end of the reply:

```
<Changes>
+ item Moonveil Trout | qty: 1 | note: violet-streaked, from the lake
- item Rope | qty: 1
~ quest Granary Rats | step: the cellar is cleared
! event Dragon sighted — smoke over the eastern ridge
? check stealth — slipping past the gate guard | dc: hard
</Changes>
```

* `op kind Name[ — text][ | label: value]*`, one per line. `op`: `+` new or gained, `-` gone or lost,
  `~` changed, `!` happened, `?` asks code to decide (a check, a roll).
* `kind` decides the owner module (registered in `capture.kinds`). Unknown kinds are logged, not guessed.
* Names are resolved to IDs by the owner through its alias index (NFC, without zero-width or bidi
  characters); an ambiguous name is held as a Problem.
* Reading is lenient and linear: bullets, bold and either dash are decoration; `label:value` without a
  space is a label when the label is one word of letters (`09:00` stays text); a line over 2,000
  characters is a Problem. Nested `<Changes>` are counted. A close tag ends the block only at the start of
  a line, or at the end of a line that is a whole change line before it (`+ item Rope</Changes>`); one in
  a line (`| who: </Changes>`, a label with no value, or story text after it) belongs to that line, so
  nothing after it is dropped unseen or shown (C-3); an open tag opens one only there too, or with a change line after it on its line (`a <Changes>
  word` in the story is a mention, and the story after it stays visible). Reasoning in the reply
  (`<think>`, `<thinking>`, `<reasoning>`) is not read: a closed pair, and an open tag with no close after
  it, which is reasoning to the end of the reply (it was cut off mid-thought), so nothing drafted inside
  it applies; a block before it is kept. Hiding a block leaves reasoning that sat inside it in the story,
  as written. A copy of the hidden comment's marker in the model's own text is defanged when the reply is
  read (`STORY_SUITE_V2_`), so only the comment Story Block writes is the hidden one and Re-read of an
  unchanged reply reads what was applied. In a block the reply left open, a last line with no line break
  after it is never applied, whether the reader stopped the reply or the length limit cut it ("+ item Ro"
  of "+ item Rope"; a block the model forgot to close loses its last line the same way): it is a Problem
  (`CUT_OFF`), and it is kept in the hidden comment, so a Continue that goes on with the block reads the
  Continue's text up to its first line break joined onto it, as one line, once (B-a1-14). A reply holds at most `maxChangeLines` lines (host setting, 150),
  counting every non-blank line written, change line or not; the rest are one Problem (`TOO_MANY`).
  Reasoning tags and the hidden comment are found open by open, close by close, in one pass, so unclosed
  tags cost no more than the text's length. Every cut Story Block makes (names, settings text, currency,
  quoted lines) keeps whole characters: a surrogate pair is never split. A Continue reads only the bare blocks it adds; where its text starts is found
  past the whitespace SillyTavern drops when it writes the continued reply back. A block whose open tag
  the cut-off reply had begun (`<Chan` + `ges>…`) is read with it. A reply cut off inside its block keeps
  it hidden with `open` after the comment's marker; a Continue that goes on with that block (a close tag
  before any open one, or a change line first) has its lines read and hidden too, and story text that
  goes on is left as it is.
* **Change lines written in the story** (fix-encounter, narrowed by the beta-candidate break). A model now
  and then writes a line in the story, on its own line just before the block (or with no block at all):
  `! encounter 8 Weir Rat — cellar pack | tier: weak`. Such a line is read as one of the reply's changes and
  hidden like the block, but only when all of these hold; when in doubt the line stays story, with a Problem:
  * it starts exactly as a kind's grammar line does (its head: the op, one space, the kind in lower case,
    as the kind's `grammar` writes it, so `! encounter`, `+ present`, `- present`; bold and backticks around
    it are decoration) and parses **completely**: nothing after the head reads as prose (no quote marks, no
    sentence end `. ! ? …` at its end or before another word, no `, she said` / `, and …` speech or sentence
    going on) and no `<Changes>` tag sits in it;
  * it stands alone: its paragraph is made only of change lines (any op; a change line inside a story
    paragraph is story);
  * it is not someone's words: not inside a quotation left open in an earlier paragraph (a paragraph that
    starts with a quote mark opens a new one, as speech over several paragraphs is written);
  * it is not something shown: not in a fenced (```` ``` ````, `~~~`, one left open to the end) or indented
    code block, a `>` quote, a `<details>`, `<style>`, `<pre>`, `<script>`, `<code>` or `<textarea>` element
    over several lines, or a multi-line `<!-- … -->` comment;
  * it sits near the end: in the last 3 story paragraphs before the first block (a paragraph made only of
    change lines is not counted), or after it.

  A line close to one that is not taken is a Problem (`STRAY`, with the line) and stays in the story: another
  op or an op look-alike (`–`, `—`, `−`, `＋`), a capital, no space or a colon after the op or kind, the kind
  in the plural (`+ coins 5`), prose after the head, a tag in it, inside code, a quote or a quotation, too
  far up, part of a story paragraph, the last line of a reply the reader stopped. A mention in a sentence
  ("He shouted "! encounter"") is neither. A story line equal to a line the reply's blocks hold (without
  decoration and extra spaces) is the same change written twice: it is taken out of the story but read
  once, from the block (C-1).

  **One rule for live and Re-read.** The lines taken are read after the blocks and kept after them in the
  hidden comment (before them when the last block was left open). Every line with a change line's shape
  that a read leaves in the story is listed in the hidden comment (`<Changes-story>`), and a later read
  (Re-read) leaves each listed line again (the nearest one above that comment, not claimed by an earlier
  one); so what the live read knew and the text does not say (the reader stopped the reply, a Continue
  reads only its own text and counts its distance from its own block, a tag that shared the line before the
  block was hidden) never makes a Re-read read differently. A Re-read lists what it leaves the same way.
  Re-read of a reply saved before this takes such a line too and hides it. Kinds of a feature that is off
  have no head. Reasoning is never read.
* **The hidden comment.** `<!-- STORY_SUITE_V2[ open][ off:word,…]` then each block's body in
  `<Changes>…</Changes>`, then, when there are any, the lines left in the story (`<Changes-story>`), an open
  block's unfinished last line (`<Changes-cut>`) and the story lines that echoed a block line
  (`<Changes-echo>`, never read). An HTML comment ends at `--`, so each `--` in it is written with a word
  joiner (U+2060) between and a word joiner already there is written twice; reading the comment undoes
  both, so a Re-read reads exactly what the live capture read (B-a1-11). A comment written before this broke
  `--` up as `- -` and reads as it always did. Each comment's blocks are read inside it (a nested tag never
  runs past its end). `off:` names the display kinds (written words) whose lines were read while their
  feature was off (below).
* **Display kinds** (MODULES §F115). A kind may be `display: true | { perReply?, noun?, read?(line) → { value } |
  { error } }`: its lines are for the reader alone. No command runs for them and nothing is stored (no receipt,
  no op, no `meta.rev`); they stay in the reply's hidden comment, and what is shown is read from there each time
  it is drawn (`extras.js displayLines`, the same rule as at capture: `readDisplayLine`), so the live reply,
  Re-read, swipes, deletes and a rebuild agree. At capture a line `read` refuses is a Problem (`INVALID`), one
  past `perReply` too (`LIMITED`, the first ones kept, counted over the whole reply: a Continue's lines
  count after the ones it already shows); a line of a feature that is off is a quiet `FEATURE_OFF`, and its
  hidden comment marks that kind `off:`, so turning the feature on later does not show what the reader was
  told was not used; a Re-read reads it again and marks every comment of the reply as it found them. Story Block's two: `? choice Text` (4 a reply, 80 code points; buttons under the latest reply
  that only fill the message box) and `~ chatter Name: thought` (3 a reply, 40 + 140 code points; a folded
  strip under each reply, never sent back unless the reader's `chatterInPrompt` setting adds the answered
  reply's thoughts as one optional tail line).
* The Director's v1 grammar (agenda, event, hook, quest, clock, beat, secret, labels, `—` reasons) is
  kept as is under this envelope.
* Each module contributes its kinds' one-line grammar to the static instruction (§5).

### 4.5 Actions written in free text

* **Buttons first.** Anything the UI offers (use, equip, fight, trade, craft, fish) is a command; no model
  needed to decide it.
* **Stop at the check.** For a risky attempt typed in the message, the model writes `? check <skill> — <what>
  | dc: easy|normal|hard|<number>` and stops before the outcome. RPG Battle resolves it after the reply
  (a `story` receipt with the roll), and the next reply narrates the result.
* **Optional classifier** (phase 3, off by default): a cheap call before the reply turns the message into a
  check so the reply can narrate the result directly.

## 5. The prompt

Story Block is the only v2 code that calls `setExtensionPrompt` for the host and its modules:

| Key | Where | Content |
|---|---|---|
| `story_suite_static` | IN_PROMPT, system | The change-line instruction (header + each module's kind grammar, in module-id order) + each module's `context.static()` in module-id order. **Byte-identical every reply** of a chat (no names, counts, times, dice). |
| `story_suite_tail_1` | IN_CHAT depth 0, system | `[Happened]` lines, then each module's `context.tail(view)` in the fixed order scene, inventory, party, combat, trade, director, then other modules by id. |

* `context.tail` returns `{ lines: string[], optional: string[] }`; each module has a `budget` (tokens,
  estimated chars/4); optional lines drop first. The host's total tail budget is a setting (default 1,500).
* **The context size.** SillyTavern fits the extension prompts first and drops the conversation when the
  rest no longer fits, so the static part and the tail together are held to a share of the room the prompt
  has: the interceptor's context size (SillyTavern 1.19 hands it less the reply's length; a size that still
  holds it, as the API settings tell, has the reply taken off) times `contextShare` (a host setting, 10–90 %,
  default 40). Only the tail is cut for it (optional lines first, then from the last module back, as for
  the tail budget), never below 200 tokens, and never past the tail budget. The static part is never
  trimmed: when it alone is over the share, the reader is told once per chat (a toast and the Problems list,
  `CONTEXT_SMALL`: "Your context size (N tokens) is too small for Story Suite's instructions (about M
  tokens). Raise the context size or turn features off.") and the reply still goes out with it. The
  settings' prompt size shows the context size, the share and that notice. No context size known: the
  tail budget alone.
* NSD keeps its own keys (`story_suite_tail_4_npc_state_delta…`) and sorts after `story_suite_tail_1`.
  A module that sends text with the reply under its own keys says what through its `ownPrompt(view)`
  hook: `[{ label, text }]` (one `{ label, text }` or a string also do), answered at once (a promise is
  not waited for; one that throws counts nothing), at most 8 parts of 200,000 characters each. Story
  Block never sends it; it counts it (about four characters a token) toward the share of the context:
  the tail gets what the static part and the modules' own text leave, never below 200 tokens, and
  `CONTEXT_SMALL` still speaks of the instructions alone. `turn.previewFit()` gives `{ parts, fit, own }`
  (`own`: `[{ module, label, place: 'own', text, tokens }]`, `fit.own` their tokens), and the settings'
  prompt size shows each such module as a row of its own, counted in the total.
* The settings' **Show what's sent** (under the prompt size) lists the exact text of every part the next
  reply would get (static, tail and the modules' own), per module with its size and the lines dropped to
  fit, and copies it all; it only reads (`turn.previewFit()`), nothing is sent or stored.
* If the preset leaves out the Main Prompt (SillyTavern then drops IN_PROMPT text), the static part is put
  back at the start of the tail for the story's own prompt only (v1 rule).
* Old v1 keys are cleared on load.
* Tests: the static part of two consecutive replies with different state is byte-identical; a
  logged prompt of two consecutive live requests reports its shared-prefix %.
* The static part depends on the code and on the reader's **features** (§6) only: turning a feature that
  owns a capture kind or static text on or off changes it once, for the next reply (one reply without
  the provider's prompt cache); it is byte-identical again from then on.

## 6. Modules

```js
sdk.registerModule({
  id: 'rpg-battle', name: 'RPG Battle', version: '2.0.0-alpha.1',
  domains: {
    party: { initial: () => ({ actors: {}, order: [] }), validate: (slice, state) => [] },
  },
  commands: { 'item.use': handler, /* … */ },
  queries:  { 'party.actors': (state, args) => [...] },          // read-only, plain copies
  capture:  { kinds: { wound: { grammar: '~ wound Name — how | harm: scratch|wound|grave' }, check: {…} },
              apply(ctx, line) { /* runs as a story command */ } },
  context:  { static: () => '…', tail: view => ({ lines: [], optional: [] }), budget: 400 },
  hooks:    { beforeGenerate(view) {}, canGenerate(view) {}, 'item.define'(def) {}, diagnostics() {} },
  settings: { defaults: {…}, schema: {…}, section?: (el, api) => {} },
  tabs:     [{ id: 'party', title: 'Party', icon: 'fa-users', render: (el, view, api) => {} }],
  features: [{ id: 'rpg-battle.wear', label: 'Wear', describe: 'Gear wears out and breaks.', default: false }],
});
```

* `view` = `{ state (frozen head), query, settings, feature(id), chat: { length, lastUser } }`.
* **Hooks** let a module shape another's work without writing its domain: `item.define` (RPG Battle sets
  rarity, value, stats, effects of an item the story introduced), `canGenerate` (any `false` or
  `{ ok: false, reason, action? }` blocks a story generation, with a reason; MODULES §F12; Home's "Before you
  start" card shows the reason with a button that runs the module's `onBlocked(reason, moduleId)` hook,
  labelled `action` (≤ 40 characters), else "Get started"; `action: false` for none), `beforeGenerate`, `ranks.reader()` (→ `{ lines, perRank }`: the reader's rank ladder lines and levels per rank, which `packs.content({ kind: 'ranks' })` answers with; MODULES §F105),
  `ownPrompt` (what the module sends with the reply under its own prompt keys, §5) and `diagnostics()` (optional: the module's own section of Settings → Diagnostics, a string, a list of
  lines or `{ lines, data }`, a promise of one answered within 2 s; MODULES §F118). Money is one currency (MODULES §F1), counted in its smallest coin when it has coins (§F108).
* **Settings**: `schema` fields (`bool`, `int{min,max}`, `choice[]`, `text`, `list of {…}`, `profile`) render in the
  Story Suite overlay; `section` renders a custom panel for what a schema can't express, right in the
  module's fold under its features line (never a sub-fold; MODULES §F116), the schema's groups below it as
  sub-folds. Values are stored
  under `extension_settings.storySuite.modules[id]`. `settings.set` stores a value as its field allows it:
  text cut at its `max` (200 when it sets none), whole numbers inside `min`/`max`, a choice among its
  options, a list as at most 100 rows of records, each sub-field held the same way (other keys dropped), a
  `profile` as a Connection Manager profile's name (a dropdown with "Same as chat", stored `''`; MODULES §G).
  A field's optional `readOnly` (`true`, or a function of the module's current values, `values => boolean`;
  one that throws counts as false) draws it disabled with its value and help shown, and the overlay stores
  nothing from it; a function's rows are drawn again when another field of the module changes (Story
  Director's calendar fields while Calendar is `pack`). `settings.set` from code is not limited by it.
  While a field is read-only, its optional `shows` (`values => value`) gives the value the row shows
  instead of the stored one, for display only: the stored value is kept and is shown again once the field
  is editable (one that throws or returns `undefined` shows the stored value).
  No module has its own drawer panel in v2 (NSD keeps its standalone one and hides it when hosted).
  The overlay is one centred column of folds: Story Suite (the tail budget, the share of the context and
  the prompt size, with the context size and the share used), the
  modules' own folds (`settings.folds: [{ id, title, hint?, render(el, api) }]`; Story Block's Packs),
  Features (a filter box, then a sub-fold per module by name, "N of M on"), a fold per module with
  settings, Versions. A module with features but no settings has no fold of its own. Inside a module's
  fold one line says how many of its features are on and opens Features at that module; then a sub-fold
  per settings group: a field's optional `group` (text), else its label's prefix ("Calendar: Era" → group
  Calendar, label Era), else General; then its `section`. A `list` field draws one compact line per item.
  A list whose fields are all `text` and `int` also has a text form, a textarea with one item per line
  and the fields in order split by ":" (`Frostmoon: 30`), with an **Edit as text** / **Edit as rows**
  switch; the field's optional `form: 'lines'` starts it there (any other `form` is ignored). The text is
  read when it changes: a line that does not read (missing a field, not a whole number, outside
  `min`/`max`, past 100 lines) is named under it and nothing is stored until every line reads. With one
  `text` field, extra colons belong to it (`Day: of Ash: 30`).
* **Features** (MODULES §F100): the optional mechanics a reader switches on and off.
  * `features: [{ id, label, describe?, default?, prompt?, needs? }]`. `id` is `<module-id>.<name>` (lowercase
    letters, digits, `_`, `-` after the dot); `label` is text of at most 60 characters, `describe` at most
    240; `default` is `true` (when left out) or `false`; `prompt: true` says the feature changes the
    static part through the module's own code. A feature that owns a capture kind or static text is
    marked so without it. A wrong entry, an id named twice, or a `feature` that names no feature of the
    same module refuses the module with a plain sentence; an unknown field on an entry is warned and
    ignored.
  * `needs: { kinds?, commands?, queries?, why? }` names what another module must register for the
    feature to work at all (Story Block's pre-roll needs the `check` kind). While any of it is not
    registered (by any module, whatever that module's features say), the feature is **unavailable**: off
    whatever the reader chose (their choice is kept), drawn off and disabled in the overlay with `why`
    (at most 120 characters; "Needs a module that is not installed." when left out). `sdk.features()`
    gives `available` and `why`.
  * What a feature owns says `feature: '<id>'`:
    * a capture kind: `kinds: { wear: { grammar, feature } }`;
    * a command: `{ handler, feature }`, or a handler function with a `feature` property;
    * a query or a hook: a function with a `feature` property
      (`Object.assign(fn, { feature: 'rpg-battle.wear' })`), so an older host, which takes only
      functions there, still takes it;
    * the context: `context.feature` covers the whole context; `context.parts: [{ feature?, static?,
      tail? }]` adds static text and tail lines of their own to the module's, under its `budget`;
    * a screen, a tab or a widget: `{ …, feature }`;
    * a settings schema field: `{ type, …, feature }`; the custom settings panel: a `section` or `render`
      function with a `feature` property.
  * **Off means fully off.** Its kinds leave the static grammar, and a line of one is not used: it gets a
    quiet Problem (`FEATURE_OFF`, "… is turned off (feature off)"), not a refusal on the reply's card.
    Its context (parts) leaves the static and the tail. Its commands are refused with `FEATURE_OFF`, at
    the top or through `ctx.call`; as with `UNKNOWN_COMMAND` nothing ran, so a caller may catch it. Its
    queries answer `null`. Its hooks are not called. Its screens (whoever restyled them: a pack, the
    card, the reader), tabs and widgets are hidden; a template that names an off widget draws nothing
    there. A dialog for an off screen does not open (`sdk.dialog.open` gives `null`, as for an id no one
    has), and one already open closes when its feature is turned off. Its settings fields and custom
    panel leave the overlay (their stored values are kept) and come back with it. **Its state is never touched**: turning the feature on again brings everything back as it was.
    A Re-read while it is off runs again each line that made a change before (matched by its receipt's
    `line`, as for seeds) as if its features were on, so the reply keeps what it made; a line that made
    none is not used (`FEATURE_OFF`). A preview of its command cannot be committed once it is off
    (`FEATURE_OFF`), and a preview from before any feature was turned on or off is `STALE`. Home's
    blockers (`turn.blockers`, `turn.unblock`) and a held-back generation run only an `onBlocked` hook
    whose feature is on. A feature that owns a whole `context` changes the static part (`prompt: true`)
    when that context or any of its parts has a `static`.
  * `ctx.feature(id)`, `view.feature(id)` and `sdk.feature(id)` say whether a feature is on; an id no
    registered module declares is `false`. `sdk.features()` lists every feature with `on`;
    `sdk.modules()` lists each module's feature ids; `sdk.on('feature', ({ id, on, prompt }) => …)` fires
    on each change.
  * The choice is the reader's, not the chat's: `extension_settings.storySuite.features[<id>] = true |
    false`, kept for a module that is not installed now. A feature without a choice takes its `default`.
    Packs do not suggest feature defaults.
  * The settings overlay shows a "Features" subsection at the top of each module's fold (a switch, the
    label, the description) and one "Features" overview of every module's; a feature that changes the
    static part says "Changes the fixed prompt once (one slower reply)."
  * Story Block's own: `story-block.hud` (the status strip, on), `story-block.cards` (the cards under
    replies, on; each card screen keeps its own switch), `story-block.preroll` (needs the `check` kind)
    and `story-block.extractor` (the assist helpers, off), `story-block.choices` and `story-block.chatter`
    (the display kinds `choice` and `chatter`, off; §4.4, MODULES §F115). The older switches (`storySuite.hud`, the
    `assistClassifier` and `assistExtractor` settings) are the choice until the reader sets the feature.
  * A module without `features` behaves as before. On a host older than features, `features` and the
    `feature` keys are warned about and ignored (everything is on), and `context.parts` is ignored too:
    a module that must run there checks `sdk.feature?.(id) ?? true` and keeps its core text in
    `context.static` / `context.tail`.
* **Tabs** render into Story Block's tab bar from the head state; they never read message text.
* **Events**: `sdk.on('committed' | 'head' | 'turn' | 'feature', fn)`; `head` fires after any rebuild.
* `sdk.query(name, args)`, `sdk.modules()`, `sdk.id(prefix)`, `sdk.check`, `sdk.settings(id)`, `sdk.feature(id)`,
  `sdk.features()`.
* **Model calls** (MODULES §G): `sdk.callModel({ profile, system, prompt, maxTokens, signal, feature })` →
  `Promise<{ ok, text, error }>`, a module's own call outside the story, on a Connection Manager profile (called
  directly with its settings, the reader's connection never switched) or the chat's connection (`profile` `''`
  or `'chat'`, generateRaw). Never posts to the chat or touches its history; never throws (`error` is a code:
  `FEATURE_OFF`, `BUSY`, `TIMEOUT`, `ABORTED`, `BAD_REQUEST`, `NO_PROFILE`, `EMPTY`, `UNAVAILABLE`, `FAILED`,
  with a plain `message`); one call in flight per module (a second is `BUSY`); 60 s limit (`timeoutMs`); the
  log holds only the module, the profile's name, the time and the outcome. On the chat's connection it waits
  while a reply is being built or awaited (`turn.replyBusy()`, `turn.whenIdle()`), and its prompt is marked as
  Story Suite's own so the turn's prompt handlers never take it for the reply's (createTurn's `ownPrompt`).
* **Versions**: `requires: { storyBlock: '>=2.1.0' }` says which Story Block a module needs, as a version
  range in the packs' form (`^2`, `>=2.0.0 <3`, `>=2.0.0-alpha.2`, alternatives with `||`). Pre-releases
  order the semver way (2.0.0-alpha.1 < 2.0.0-alpha.3 < 2.0.0): a bound written as a release
  (`>=2.0.0`) is not met by an alpha, while a bound a range only implies (`^2`, `2.x`, `<3`) takes in
  that version's pre-releases, so `^2` holds on 2.0.0-alpha.2 and ends before 3.0.0-alpha. A module that
  needs this alpha's changes says `>=2.0.0-alpha.2`. A host that does not meet it refuses the module with
  one sentence, "Name needs Story Block ≥ 2.1.0; this is 2.0.0-alpha.2. Update Story Block to use it.",
  and keeps nothing of it (the registry remembers the refusal, `registry.refusals()`, until that module
  registers). The Story Suite overlay's **Versions** fold (src/v2/compat.js) lists every module with its
  version and `requires`, and each one out of step (refused for the version, a clash, a second copy, or
  one with fields this host does not know) with one plain sentence on how to fix it. A definition field the host does not know (one a newer module added, as
  MODULES §F100's `features` was to hosts before it, or another key under `requires`) is logged as a warning and ignored, never
  a refusal; one level down the same: an unknown command option, `settings.*` part, or settings field
  type (that field is hidden in the settings and its value kept as stored). A module whose domains grow keeps the data of the domains a chat already has: only the
  missing ones get their `initial()` (§2.6).

## 7. Core domains (Story Block)

### scene
```js
{ place: { name: '', kind: '' /* settlement|wild|dungeon|… */, region: '' }, present: [ /* names */ ] }
```
Capture kinds `place` (`~ place Bluewatch Village | kind: settlement`) and `present`
(`+ present Fenna`, `- present Fenna`). Without `kind:`, the same place (same name, any case) keeps its
stored kind, and a move to another place takes the kind a pack gives a place of that name or alias
(`packs.content({ kind: 'places' })`), else none: never the old place's. The region is kept unless the line
gives one. Only an explicit empty value (`kind:` with nothing after it) clears one. After a move only those
named in `with:` are present.

### inventory
```js
{
  defs:   { [defId]: { id, name, kind: 'goods'|'material'|'consumable'|'equipment'|'quest'|'money',
                       rarity: 'common'|'uncommon'|'rare'|'epic'|'legendary', value: 0 /* smallest unit */,
                       stack: true, slot: null, stats: {}, effect: {}, tags: [], note: '' } },
  stacks: { [stackId]: { id, def, qty, owner: 'ac_…' /* actor */ | 'party', equipped: null | slot,
                         note: '', from: '' /* receipt id */, cond?: 0–100 /* older chats only: where the condition starts */ } },
  wallets:{ [owner]: { coin: 0 } },                // one currency, smallest unit (MODULES §F1)
  aliases:{ [lowercase name]: defId },
  perReply?: { [sid]: { coin, worth, made, items, notable? } },   // scratch: a reply's story tally
  condLog?: { [stackId]: { ['<sid>#<n>']: { d, n } } },          // scratch: gear condition events
  loot?:   { [sid]: { sid, n, where, claim, items: { "0": { name, qty }, … } } },   // scratch: loot on offer
}
```
Commands: `inventory.grant`, `inventory.consume`, `inventory.transfer`, `inventory.drop`, `inventory.equip`,
`inventory.unequip`, `inventory.split`, `inventory.merge`, `inventory.equipOn`, `inventory.wear`,
`inventory.repair`, `inventory.lootTake`, `wallet.pay`, `wallet.receive`. Capture kinds `item`
(`+ / - / ~ item`), `coin` (`+ coin 30 | from: the sealer`; the op is the only sign, so an amount
written with one, any dash or minus sign, is refused, and so is one with other than plain digits: a
fraction, a superscript, other scripts' digits or a decimal point in front) and `loot` (`? loot A, B x2 — where`, feature `story-block.loot`). Queries
`inventory.currency`, `inventory.items`, `inventory.wallet`, `inventory.find`, `inventory.equipment`,
`inventory.encumbrance`, `inventory.loot`, `inventory.condition`. Features (MODULES §F100): `story-block.loot` and `story-block.encumbrance`, both
on by default; a host without the Features API keeps them on. Query `inventory.economy` → `{ scale, source: 'pack' | 'settings' | 'default' }` (MODULES §F104): the money scale
that every built-in default money number is multiplied by (rounded, at least 1). The reader's `economyScale`
setting wins (0 or blank: the pack's), then the first enabled pack's `economy.scale`, then 1. Numbers a pack
writes are never scaled. Modules read it with `tryQuery('inventory.economy')`, falling back to a scale of 1.
* **The caller rule.** What makes items or money out of nothing (`inventory.grant`, `wallet.receive`) and
  `wallet.pay` run for the story, the host, or another module's command (`ctx.call`, which sets
  `ctx.caller`); the same command at the top with cause `ui` is `REFUSED`. A shop's `trade.buy` pays, a
  quest's `quest.finish` receives.
* **Owners** are the party or a member: a grant, transfer or `wallet.receive` to an `ac_` id that
  `party.actors` (or the `party` domain) does not list is `REFUSED`.
* **Money-named items.** An item named exactly the currency, singular or plural (`+ item Marks | qty: 44`,
  `- item mark`), is money: it goes to or from the party's wallet like `+ coin` / `- coin`.
* **Story limits.** One reply's story lines pay at most `storyCoinPerReply` (setting; 0 = the top reward of
  the player character's rank from `quest.ranks`, else 1000 × level × the money scale, rounded, at least 1), give at most 20 of one item, give goods
  worth at most 2 × that coin budget in all (Σ def `value` × count given), and bring in at most 10 new item
  definitions. Past a limit a line is clamped with a `LIMITED` Problem; once it is spent, a line is `REFUSED`
  (a refused line makes no definition). **One notable item per reply, given as a key item:** the first
  `+ item` line whose one item is worth more than the goods budget has left gives one of it outside the worth
  tally, when it is worth at most 5 × the goods budget (a count over 1 is clamped to 1 with a `LIMITED`
  Problem: the rest is over the goods budget). Its receipt says "<name>, given as a key item" and its data
  has `notable: true, key: true`. An item worth more than 5 × the goods budget on its own is not notable.
  A **key item** is a stack of its own marked `key: true` (also on `inventory.items` rows; the Inventory
  screen tags it "Key"): used, equipped, given away and consumed like any other, but with no cash value. It
  never joins another stack of the item, nor another stack it (a grant, a transfer, a story line; `inventory.merge`
  is `REFUSED`), and a part given away or split off stays a key item. Modules that buy things back or count
  what they are worth treat it as worth 0 (RPG Battle's trade refuses to buy it: "<name> is a key item; it
  can't be sold"; its crafting and commissions count it as 0), so story text never sells for more than a
  reply's goods. **The story's own:** every stack a `+ item` line gives is marked `story: true` (also on
  `inventory.items` rows), whatever its def (a pack item the story names too); a stack it joins, or that
  joins it (a grant, a transfer, `inventory.merge`), is the story's too, and a part given away or split off
  stays the story's. Its worth was counted in the reply's goods budget, so a module that buys things back
  holds what it pays for it to its worth at the sell rate (RPG Battle's trade). Later lines over the budget
  are held as above, and the 20-of-one and 10-new-definitions limits still apply. A `~ item` raise is never notable. A `~ item … | qty:` that raises a count is a gain, held to
  the same limits and to the carry limit when a module answers `items.carry`
  (`{ owner, add: [{ defId, qty }] }` → `{ ok: false, message }` refuses it); lowering a count is free. The
  tally is `inventory.perReply[<sid>]` (scratch, §2.2; `notable: true` once the reply's notable item is given), so a
  swipe or a deleted reply takes it back. Code's own payouts are not counted, except:
* **Story-vouched payouts.** `wallet.receive { owner, amount, note?, story: true }`, called by a module
  (`ctx.call`) while a reply is captured, is money the story alone vouched for (a quest the story closed
  that no code could count). It counts against the same per-reply coin budget as the story's coin lines and
  is never refused for it: over the budget what is left is paid, which may be 0; the receipt data's
  `amount` is what was paid, and the result's `problem` says why (a `LIMITED` note when the module passes
  it on). Called outside a capture (a quest Finish click after the reply), it counts against the reply the
  click is stored on (`ctx.reply`, the head carrier) in the same budget, so one reply's `+ coin` lines and
  the clicks after it (a Continue's lines too) give at most one budget (RX-E-2). A click keeps what it paid
  as its own key, `storyClicks[<sid>][<receipt id>]` (scratch, add-only), and never writes the reply's
  tally; a Re-read counts the kept clicks from `ctx.standing`, so its lines are paid only what the clicks
  left, live, on replay and on a cold rebuild alike (a2-3). Without the flag, or with
  no module caller, a payout is not counted. `story` that is not true or false is `INVALID`.
* **`inventory.storyBudget`** → `{ budget, paid, left, vouched }`: the story money the current reply
  (`tools.reply`: the asking command's reply, else the head carrier) may give, has given (`+ coin` lines and
  vouched payouts, clicks included) and has left; `vouched` is the part of `paid` that vouched payouts gave
  (kept in the tally as `vouched` once there is some). `budget` is the coin budget above, so it honours the
  reader's `storyCoinPerReply`. A module that holds its own story payouts to the budget (Story Director's quest
  turn-ins) reads it with `tryQuery`, falling back to its own tally on an older Story Block.
* **A used consumable** (`- item Draught | used: yes`, or a used-word such as drank or applied, and no
  lost/sold/given word) goes to `item.use { name, on, qty, story: true }` when a module answers it.
* **Gear condition**: a whole number 0 (broken) … 100 (as new), **derived, never stored as the truth**.
  Each wear or repair is an event of its own, `condLog[<stack>]['<sid>#<n>'] = { d, n }` (`d` the change
  asked for, −100…100; `n` the rev it was written at; keyed by the carrier sid, or the receipt id outside a
  reply, and only added). The condition is the start (100, or an older chat's plain `stack.cond`, read as the
  starting point) folded through the events in rev order, held to 0…100 at each step. A middle delete takes
  exactly that reply's events away, and nothing can go out of range, so no block is refused for it.
  `condLog` is scratch (on replay missing records are made, a drop of something gone is passed over). Back
  at 100, a stack's events (and an old `cond`) are dropped **by key**; the records holding them are never
  removed while their stack exists (a record a later reply found missing would be written whole, and that
  whole write replayed after a delete would drop or bring back other replies' events). Past 40 events a
  stack's are folded into one. A stack's log goes once the stack is gone. Read it with
  `inventory.condition { stack }` → `{ stack, cond, events: [{ key, d, n }] }` (null for no such stack), or
  the `cond` of `inventory.items` rows (there while below 100); never from the stack. Stacks in different
  condition never merge or pile together; a split or part hand-over starts the new lot where the old one
  stands. Two commands, **another module's calls only** (`ctx.call`, so `ctx.caller` is set; at the top,
  whatever the cause, `REFUSED`), for RPG Battle's wear rules:
  * `inventory.wear { stack, amount }`: `amount` a whole number ≥ 1 (more than 100 counts as 100); an event
    of −amount. → `data: { stack, def, amount, before, now, broken }`. Wearing a broken piece changes
    nothing and does not fail.
  * `inventory.repair { stack, amount }`: `amount` a whole number ≥ 1 (more than 100 counts as 100); an
    event of +amount, held at 100. → `data: { stack, def, amount, before, now }`. RPG Battle keeps a piece's
    own maximum (below 100 after field patches) and asks for the difference.
  A malformed amount is `INVALID`; neither is narrated.
  The story's word for wear, `~ item Coat — torn by brambles | wear: scuff|tear|ruin` (or a word for one of
  them: scratched, ripped, shattered…), goes to `item.wear { name, wear, why, story: true }` when a module
  answers it (RPG Battle's gear rules); without one Story Block wears the piece (the worn one, else the first
  lot) by 5, 15 or 40, once per piece per reply (claim `wear:<sid>:<stack>`, else `CLAIMED`). With `item.wear`
  there Story Block writes nothing for the line itself: RPG Battle's gear rules own it (and write through
  `inventory.wear` / `inventory.repair`).
* **Equip on…** (MODULES §F99). `inventory.equipOn { stack, actor }` (`actor` a party member's `ac_` id)
  hands the piece to that member and puts it on in one step. It must be equipment with a slot that member
  can wear: a slot this chat's rules count, and what `items.canWear({ actor, defId })` says when a module
  answers it (`{ ok: false, message }` refuses). Slots `accessory` and `worn` hold several pieces, each copy
  under its own key (`accessory-1`, `accessory-2`, as RPG Battle keys them); their counts come from
  `items.slots` (`{ accessory | accessories, worn }`, RPG Battle's rules), held to 0…3, else 2 accessories
  and 1 worn piece. Every other slot holds one piece. What sits in the slot goes back into that member's own
  carry: for a one-piece slot the piece there (a two-handed weapon also puts the off-hand away; an off-hand
  is refused while a two-handed weapon is held); for a full many-piece slot the oldest (keys are renumbered
  in the order pieces went on, the new one last). A piece the shared bag holds counts as the main
  character's (`party.pc`). A piece someone else wears comes off them. The hand-over follows the carry limit
  (`items.carry` with `move: true`), and so do the pieces going back into that member's carry from the
  shared bag: when they do not fit along with the new piece, it is refused with the module's reason. The receipt names both pieces: `data: { stack, def, actor, from, slot,
  replaced: [stack ids], replacedNames }`. `inventory.unequip` leaves the piece in its wearer's carry.
  `inventory.equipment` → `{ members, worn: [{ id, name, items }], wearers: { [stack]: [{ id, name }] },
  givers: { [stack]: [{ id, name }] }, limits, detail }` is what the Inventory screen's Equipped section,
  "Equip on…" and "Give…" pickers draw (`detail`: RPG Battle's `rpg-battle.itemDetail` is answered, so its
  `rpg-battle.item-detail` widget is drawn in each row). A reader's `inventory.transfer` (cause `ui`, Give)
  is refused when the taker cannot carry it (`items.carry`, `move: true`).
* **Loot to pick from** (`story-block.loot`). `? loot Rusty Key, Lantern Oil x2, Torn Map — on the cellar
  shelf | qty: 1` lays things out without giving them (a count per thing as `Name x2`, of any length, else `qty:`, else 1; a count is never part of a name).
  The offer is held to the reply's story limits when it is read, each thing as a `+ item` line would be but
  never the notable one (so the chips show what can be taken); things the party already carries (tolerant
  names) are left out with a `LIMITED` note; at most 8 things per reply. It makes no definition. Money in the
  line ("1000 gold", "Gold x500", the chat's currency) is one coin offer in that loot (`{ name, qty: 1, coin }`),
  held to the reply's coin budget like a `+ coin` line (`LIMITED` past it) and paid into the party's wallet on
  Take; never an item.
  One offer per reply, `inventory.loot[<sid>] = { sid, n, where, claim, items: { "0": { name, qty }, … } }`
  (a record keyed by position, not a list, so a second loot line of the reply adds keys); `loot` is scratch
  like `perReply`, and a reply keeps the 5 newest offers. The reply's card shows them as chips with **Take
  selected**, and so does the Inventory screen's **To pick up** section (query `inventory.loot` → the offers
  not taken yet, newest first, `[{ sid, where, n, items }]`), so loot works with the cards off:
  `inventory.lootTake { sid, pick: [index…] }` (cause `ui`, the reader's) claims `loot:<sid>`
  (each reply's loot is taken once; a second take is `REFUSED`), skips what is carried by then, and puts the
  rest in the party's bag as the offer held it, making the definitions then; past the carry limit it is
  `REFUSED` and the claim stays free. An offer no longer there is `NOT_FOUND`; an empty or bad pick `INVALID`.
* **Encumbered** (`story-block.encumbrance`). A story `+ item`, or a `~ item | qty:` raise, past the carry
  limit (`items.carry … → { ok: false }`) is kept, and its receipt says the party is encumbered
  (`data.encumbered: true`). The condition is derived from the load, never stored: `inventory.encumbrance`
  → `{ on, encumbered, party, who: [{ id, name, load, capacity }], load, capacity, penalty, stats }` reads
  `items.carry` without `add` (`who`: members over their own capacity, named through the party module;
  `party`: the whole load over the whole capacity). While encumbered `penalty` is −2 on checks of `stats`
  (AGI, DEX), for the checks module to add; the tail carries one line ("Encumbered (carrying more than they
  can): Mira (9/8); AGI and DEX checks -2 until something is put down."). The reader's own takes, buys and
  hand-overs past the limit are still refused. With the feature off, the story's line past the limit is
  refused with the carry module's reason (MODULES §F39).
* **Tolerant names.** When a name's exact alias, def name and singular/plural all miss, the lookup tries
  it without portion words ("a handful of", "pieces of", "a pair of", "some", "a few", a part in
  parentheses), then a word-order key (stop and portion words out, each word singular, sorted: "alloy of
  sulfur (piece)" = "Sulfur Alloy"). A key two defs share is ambiguous. Fetch quests (`inventory.find`),
  `- item` lines and loot use the same lookup.
Story-introduced items: `+ item Name` resolves an existing def by alias, else creates `story/<slug>` with
defaults (`goods`, `common`, value 0), then calls the `item.define` hooks (`(def, { note, owner, scale })`,
`scale` the money scale of `inventory.economy`) so RPG Battle can set its rules' numbers. A later rename
changes `name` and adds an alias; it never changes value, rarity or effects.
* **Carry capacity** (MODULES §F106). A def may hold `carry` (whole, 1–1000): the capacity it adds while
  owned (equipment: while worn), which the carry module (`items.carry`) adds and the Inventory shows as
  "+N carry" (`inventory.items` rows' `carry`, the carry module's `bonuses` when it answers). Only a `pack.`
  def keeps `carry` (from its pack's item); a story-made def never has one, whatever a hook or the story
  writes, and the validator holds it to 1–1000.

## 8. Module domains (phase 2, outline)

* **RPG Battle**: `party.actors[id] = { name, level, xp, hp:{cur,max}, mp, sp, stats, skills, conditions,
  equipped }`; `combat.session`; `trade.orders`; `bestiary`. Commands: `item.use`, `party.equip`,
  `party.spend`, `combat.start|act|end`, `trade.buy|sell`, `craft.commission|collect`, `check.resolve`.
  Capture kinds: `wound`, `check`, `encounter`, `join` (companions), `skill`. Battle evidence (foes beaten)
  is a receipt with `data.foes` that the Director's quest progress reads by query.
* **Story Director**: `director = { time: { minutes, calendar }, threads: { [id]: { kind, key, fields,
  status, … } }, problems: [] }`; its v1 tracker rules apply ops through capture; quest progress and turn-in
  (story-led, MODULES §C2) read `inventory` and RPG Battle's battle receipts by query; payouts use `ctx.call('wallet.receive')` with a
  claim. Capture kinds: `agenda`, `event`, `hook`, `quest`, `clock`, `beat`, `secret`, `time`.
* **NSD**: registers queries `npc.present`, `npc.dossier`, a Cast widget and its settings; keeps its own
  storage and history rules.

## 9. Packs, activities, layouts (phase 3, outline)

* **Pack** = `pack.json` `{ id, version, requires: { storyBlock: '^2', capabilities: ['inventory', …] },
  content: { items, creatures, shops, recipes, events, quests }, start: {…}, layouts: [...], theme: {…} }`,
  imported in Story Block or read from a card's lorebook entry tagged `[storysuite:pack]`. Data only.
* **Events**: `{ id, when: <condition>, cue: 'text', once: true, then: [ops via commands] }` with a small
  condition language over queries (`party.level >= 30 && quest('Granary Rats').step == 'done'`).
* **Activities**: trusted modules (installed extensions) using `sdk.command`; fishing is the reference.
* **Layouts**: declarative widget trees bound to queries, rendered by Story Block's tab renderer.

## 10. Testing

* `node --test` in every repo; no network; no real SillyTavern in unit tests.
* Story Block ships `testkit/` (a fake SillyTavern context: chat array with swipes and extras, `saveChat`,
  `setExtensionPrompt`, event source, interceptor) plus the real runtime. Modules vendor it into
  `tests/vendor/story-block/` with `npm run sync-testkit` (copies from a Story Block checkout; records the
  commit in `tests/vendor/story-block/VERSION`). CI uses the committed copy. `stPurify` (testkit) stands
  in for SillyTavern's DOMPurify as compileTemplate calls it (`{ sanitize: stPurify }`): it drops controls'
  `type`, as the real one does, so a screen test shows what SillyTavern draws.
* Required tests per module: commands (success, each rejection, nothing saved on rejection), capture of
  each kind, validators, replay (state at N equals state rebuilt from scratch), swipe and delete rollback,
  re-narration not repeating, claims, static prompt byte-identical across replies.
* Live checks in a private SillyTavern instance per agent (see the agent brief), with screenshots for UI.

## 11. Phases and agents

| Phase | Work (agent → files) | Depends on |
|---|---|---|
| 1a | **SB-state**: State, carriers, checkpoints, replay, head cache, save batching, swipe/delete rebuild (`src/v2/store.js`, `src/v2/persist.js`) | spec |
| 1a | **SB-commands**: command bus, drafts and diff to ops, validators, claims, receipts, sfc32 rng, preview/commit (`src/v2/commands.js`, `src/v2/ops.js`, `src/v2/rng.js`, `src/v2/check.js`) | spec |
| 1a | **SB-turn**: module registry, change-line parser and dispatch, turn pipeline, prompt assembly, settings overlay host, tab host, testkit (`src/v2/registry.js`, `src/v2/capture.js`, `src/v2/turn.js`, `src/v2/prompt.js`, `src/v2/host-ui.js`, `testkit/`) | spec |
| 1b | **SB-domains**: `scene` and `inventory` domains, commands, capture, Inventory and Scene tabs (`src/v2/domains/`) | 1a interfaces |
| 1c | Coordinator: integrate 1a/1b on `v2`, live check, `2.0.0-alpha.1` | 1a, 1b |
| 2 | **RB-party** (party, checks, wounds, growth), **RB-items** (item.use, equip, item.define, currency), **RB-combat** (encounters, battle, evidence), **RB-trade** (trade, craft); **SD-tracker** (director domain, capture, time), **SD-quests** (progress, Finish, tabs); **NSD-hosted** | 1c |
| 3 | **Packs** (format, import, lorebook), **Events** (condition engine, cues), **Layouts** (renderer), **Fishing** (reference activity), optional classifier and after-reply extractor | 2 |
| 4 | Studio (separate app) | 3 |

Agents in the same phase write disjoint files. Interfaces between them are this spec; anything missing is
asked of the coordinator, not invented.

## 12. Phase 1 internal interfaces (Story Block `src/v2/`)

The three phase-1a agents code against these signatures and test against fakes of each other. All
modules are pure ES modules with no SillyTavern import except `host.js` (coordinator) and `turn.js`.

```js
// ops.js (SB-commands)
diff(before, after, basePath = '') → Op[]          // minimal add/replace/remove, deterministic key order
apply(state, ops) → State                           // pure: returns a new state; throws on a bad path
checkOps(ops) → string[]                            // generic rules (§2.5): ints, no NaN, qty >= 0, ids

// rng.js (SB-commands)
seed() → uint32 (crypto)                            // rng(seed) → () => float in [0,1)
roll(rng, '2d6+1') → { total, dice: [..] }

// check.js (SB-commands): int, str, oneOf, id, bool, arrayOf, record — each returns '' or an error string

// store.js + persist.js (SB-state)
createStore({ chat: () => Message[], save: async (target, { keepalive }) => void, now?: () => number,
  chatId?: () => string, place?: () => any, rescue?: async (target, [{ message, index }]) => void,
  validate?: (state, domains) => string[], scratch?: (domain) => string[] }) → {
  head() → State,                      // frozen
  at(index) → State,                   // state after carrier `index` (frozen)
  headIndex() → number,                // index of the last carrier (-1 if none)
  ensureInitial(initialState) → string[], // the first carrier's checkpoint when the chat has none (notes: damaged records set up again)
  carrierSid(index) → string | null,   // the record ID of carrier `index` (ctx.carrier.sid)
  append({ ops, receipt }) → void,     // onto the head carrier; bumps nothing (ops already carry meta.rev)
  replaceStory(index, { ops, receipts }) → void   // Re-read: swap a carrier's cause:'story' receipts
  setNarrated(index, ids) → void,
  untold() → Receipt[],                // §4.1 step 2
  rebuild() → void,                    // after chat change, delete, swipe
  scheduleSave(ms = 400) → void, saveSoon() → Promise<boolean>, flush() → Promise<void>, dirty() → boolean,
  failing() → boolean, truncate(index, beforeRev, { dryRun?, chat? }) → { dropped, rev },
                                       // truncate replays the kept blocks by the replay rules (§2.2)
}

// registry.js (SB-turn)
createRegistry() → {
  register(def) → void,                // validates the module definition (§6); throws on a clash
  modules() → def[],                   // sorted by id
  domainOwner(domain), commandOwner(type), captureOwner(kind) → moduleId | null,
  command(type) → handler, capture(kind) → { moduleId, apply }, validator(domain) → fn,
  initialState() → State,              // meta + every domain's initial()
  hooks(name) → fn[],                  // in module-id order
  tabs() → [...], settingsDefs() → [...], contexts() → [...],
}

// commands.js (SB-commands)
createCommandBus({ store, registry, settings: id => object }) → {
  command(type, payload, { cause = 'ui' } = {}) → { ok, receipt } | { ok: false, code, message },
  preview(type, payload) → { ok, receipt, token }, commit(token) → same as command,
  run(type, payload, { cause, seed }) → { ok, ops, receipt }   // no append; used by capture
}

// capture.js (SB-turn)
parseChanges(text) → { lines: [{ op, kind, name, text, labels: {}, raw, index }], problems: string[] }
extractBlock(mes, tag = 'Changes') → string | null ; stripBlock(mes) → string   // for display/hide

// prompt.js (SB-turn)
assemble({ registry, view, untold, settings }) → { staticText, tailText, parts: [{ module, label, text }] }

// sdk.js (SB-turn): builds the public sdk (§3, §6) from store + bus + registry; turn.js wires SillyTavern
```

Error codes: `UNKNOWN_COMMAND`, `NOT_OWNER`, `INVALID` (validator), `NOT_ENOUGH`, `NOT_FOUND`, `CLAIMED`,
`STALE`, `FEATURE_OFF` (the command's feature is off, §6), `FAILED` (handler threw). Messages are plain sentences for the reader.

## 13. UI: screens, templates, widgets, mounts

Every screen, the modules' own included, is data: a **screen definition** rendered by Story Block. Cards and
packs can restyle or replace any screen; code enters only through **widgets** from installed modules.

### 13.1 Screen definition
```js
Screen = {
  id: 'rpg-battle/party', title: 'Party', icon: 'fa-users',
  mounts: ['tab', 'screen', 'card', 'hud', 'dialog'],      // where it may appear (§13.4)
  template: '<div class="sheet">…</div>',                  // HTML template (§13.2)  — or —
  layout: { root: Node },                                  // JSON tree (Studio's format, src/v2/layout/)
  css: '.sheet { … }',                                     // scoped (§13.3)
  theme: { '--ss-accent': '#7c5cff', … },                  // CSS custom properties
  data: { pc: { query: 'party.pc' }, gear: { query: 'items.gear', args: { actor: '$pc.id' } } },
  steps: [ { id, title, template } ],                      // dialog wizards only (§13.6)
}
```
Modules register default screens with `registerModule({ screens: [...] })`; packs and cards add or override
screens by `id`.

### 13.2 Templates
An HTML subset, sanitised with SillyTavern's DOMPurify (`SillyTavern.libs.DOMPurify`; a strict allow-list
fallback in tests): layout, text, list, table, form, image and inline SVG elements; no `script`, `iframe`,
`object`, `embed`, `link`, `meta`, `base`, `form action`, no `on*` attributes, no `javascript:`/`vbscript:`
URLs; images only `data:` or `https:`. Bindings are attributes and `{{ }}` interpolation:

| Syntax | Meaning |
|---|---|
| `{{ path }}` | text (escaped) in text nodes and in allowed attributes |
| `data-bind="path"` | the element's text |
| `data-bind-attr="src: path; title: path"` | attributes |
| `data-bind-var="--pct: ratio(hp.cur, hp.max)"` | CSS custom properties (styling from data goes through variables) |
| `data-each="path as name"` | repeat the element per item |
| `data-if="expr"` / `data-class="hurt: expr"` | show/hide; toggle classes |
| `data-command="item.use" data-payload='{"stack":"{{ s.id }}"}'` | a button runs a command |
| `data-draft="name"` on inputs, `data-submit="party.create"` | forms fill a draft; submit sends it as one command |
| `<ss-widget name="map" data-props='{"bind":"q.places"}'></ss-widget>` | a registered widget |

Paths: `state.<domain>.…` (the state at the mount's carrier, read-only), `q.<alias>` (the screen's `data`
queries), loop names, `draft.…`, `settings.…`. Expressions use the events condition language
(src/v2/events) plus helpers `ratio(a,b)`, `pct(a,b)`, `changed(path)` (true when this carrier's ops touched
the path — the "only what changed" toggle), `len(x)`, `fmt.money(n)`, `fmt.time(m)`.

### 13.3 CSS and themes
A screen's `css` is scoped by prefixing every selector with `[data-ss-screen="<id>"]`; `@import` and
`position: fixed` are dropped; `url()` only `data:`/`https:`; `@font-face` allowed with those URLs; 64 KB
limit. `theme` sets custom properties on the screen root. Story Block's default theme follows SillyTavern's
own colours.

### 13.4 Mounts
| Mount | Where | State shown |
|---|---|---|
| `tab` | Story Block's tab bar | head |
| `screen` | a full-screen game view with its own navigation between screens | head |
| `card` | inline under each reply (collapsed by default; per-screen opt-in by the reader) | **that reply's** state |
| `hud` | a thin strip above the message box | head |
| `dialog` | a modal; wizards | head + draft |

The `tab` and `screen` mounts share one navigation order: Home first, then the suite's own screens in their
default order (Party, Inventory, Quests, World, Map, Fight, Crafting, Trade, Cast, Scene, Chronicle, Director
last), other screens by their `order` (a number, lower first). The reader's own order and hidden tabs
(Settings → Story Suite → Tabs, `extension_settings.storySuite.tabs = { order, hidden }`) apply to both; a
module tab goes by `<module>/<tab id>` there. Form controls inside any mount take SillyTavern's theme colours
(`controls.css`); a screen's own CSS for its fields still wins.

### 13.5 Widgets
`registerModule({ widgets: { name: { props, render(el, props, api) } } })`; `api` has `query`, `command`,
`preview`, `commit`, `on`. Story Block ships: `meter`, `radar`, `map` (nodes, routes, layers, zoom/pan,
minimap, legend), `skill-tree`, `portrait`, `badge` (icon + counter), `timeline`, `stepper` (number input
under a budget). Modules add their own (`battle-board`, `fishing`). The page adds two host widgets that
need the store and the chat, `story-block.inspector` (the Inspector screen, MODULES §F92) and
`story-block.savepoints` (on Home, §F93); outside the page (a test, a preview) they are not there.

### 13.6 Wizards and forms
Inputs fill a draft held by the dialog, never the state. Steps share the draft; the last step submits one
command, and code enforces every rule (points budget, picks allowed). A random button calls `preview` and
shows that result; accepting calls `commit(token)`, so the roll shown is the roll kept.

### 13.7 Precedence
Per screen id: the reader's choice (settings), then the card's, then a pack's, then the module default. The
reader can always reset a screen to its default. A screen that fails validation falls back to the next one
and the reason is shown in the overlay.
