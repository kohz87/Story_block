# Story Suite v2: storage performance

What v2's storage (docs/v2/SPEC.md §2.2, §3.3) costs on disk and in time over a long chat, measured
with a benchmark, and how it was tuned. The tuning described under "Storage tuning" is built (store.js,
persist.js); the rest of this page measures what it gives and what was left out.

Why it matters: SillyTavern rewrites the whole chat `.jsonl` on every save, and also writes a backup
copy of it, throttled by `backups.chat.throttleInterval`. On a weak server (a Raspberry Pi, a cheap VPS,
an SD card or network disk), what counts is the size of the file times the number of saves, not the
size of one change.

## How to run it

```sh
node scripts/bench-v2.mjs                   # 100, 1,000 and 3,000 replies (about 2 minutes)
node scripts/bench-v2.mjs --replies 500     # one length
node scripts/bench-v2.mjs --json out.json   # the raw numbers too
```

`npm test` runs a short version only (`tests/v2/bench/smoke.test.js`: 24 replies, plus checks that each
layout variant keeps the same head state). The harness is `tests/v2/bench/load.js`.

## What the benchmark does

* A whole host from the testkit (`createHost`: registry, real store, real command bus, sdk, turn) with
  Story Block's core module and a synthetic module, **Bench RPG**, shaped like RPG Battle and Story
  Director: a party of 4 (HP, MP, stats, skills), 40 Director threads (stage, tension, summary, cast)
  and a clock. The core inventory is stocked with 60 stacks by a `system` command at the start.
* Every reply is about 1,200 characters of prose plus a `<Changes>` block of **5 lines**: an item gained
  or used, coins in or out, an HP change, a thread moving, the clock moving 20 minutes.
* After every 4th reply, **3 UI commands** (heal, pay, pin a thread). "Burst": the three clicks within
  400 ms, so one save; "spread": each click saved on its own.
* Turns go through the host's own listeners in SillyTavern's order (interceptor, prompt ready,
  `MESSAGE_RECEIVED`, generation ended). For the long runs a lighter driver is used (`sendFast`) because
  the fake SillyTavern deep-copies the whole chat on every generation; the smoke test checks that both
  drivers store the same thing.
* Sizes are exact and deterministic: each message is measured as the JSON line SillyTavern writes for it
  (the chat's header line is left out). Every reply here has one swipe. Timings are one machine's
  (Node 22, x64 Linux): read them as orders of magnitude, and expect a phone or an old laptop to be
  several times slower.
* **v1 for comparison:** the same story text, with a ~3 KB state block at the end of each reply. In
  SillyTavern a reply's text is stored twice (`mes` and its swipe in `swipes`), so v1 costs ~6 KB per
  reply. Note that 3 KB is less state than v2 keeps here: the v2 head state of this load is 37 KB.

## Storage tuning: before and after

"Before" is v2 at e44039b (alpha.2): a checkpoint every 20 carriers or 32 KB of ops, every record also
copied into `swipe_info[swipe_id].extra`, every receipt kept whole. "After" is this layout:

1. **Checkpoints every 100 carriers, or 128 KB of ops** (with `covers`, as before). The bytes rule also
   waits for twice the last checkpoint's own size of ops and 10 carriers: one domain that rewrites a
   large list whole on every reply cannot make every few replies write the whole state again (the b6
   soak saw the 32 KB rule fire every ~4 carriers for that reason).
2. **Each record kept once.** The shown swipe's copy in `swipe_info` stays on the last carrier and on
   carriers with more than one swipe; it is dropped on the others (see below for why that is safe).
3. **Old receipts drop `data`.** A receipt 200 or more carriers back keeps every field but `data`.

| | 1,000 replies before | after | 3,000 replies before | after |
|---|---|---|---|---|
| Chat file (= bytes per save) | 11.01 MB | **5.13 MB** (−53%) | 32.89 MB | **15.12 MB** (−54%) |
| storySuite records in it | 8.52 MB | 2.63 MB (−69%) | 25.41 MB | 7.63 MB (−70%) |
| Records per reply | 8.7 KB | 2.7 KB | 8.7 KB | 2.6 KB |
| Checkpoints | 51 | 11 | 151 | 31 |
| Story Suite bytes written per reply (1.25 saves) | 13.8 MB | 6.4 MB | 41.1 MB | 18.9 MB |
| + SillyTavern's own save + one backup copy | 35.8 MB | 16.7 MB | 106.9 MB | 49.1 MB |

### Time

Load and swipe timings for this layout come with the beta soak numbers. The method below is how they are measured.

Timings: the median of 15 alternating before/after rounds on the same machine (each round 3 tries), so
both sides met the same load. "Rebuild at load" depends on where the last checkpoint falls: exactly at
1,000 or 3,000 replies there is one on the head carrier now (both are multiples of 100), so the rows at
1,050 and 2,950 replies (half an interval from one) show a typical load. The **longest replay** is the
worst case: the carrier just before a checkpoint, replayed from the one before it (a whole interval).
"Rebuild after swipe" is a new swipe of the last reply, then the rebuild (swipe back: the same with the
old swipe shown again); both versions roll back exactly.

What it means: the file and every save are about half the size (0.63× v1's file instead of 1.37×), and a
reply writes about as much as v1 did (49 MB against v1's 48 MB at 3,000 replies, counting SillyTavern's
own save and one backup). A rebuild replays up to 100 carriers instead of 20, which costs a few
milliseconds more on the client, once per chat load or swipe; the disk writes saved are on the server.
JSON.parse of the chat, which SillyTavern does on every load, shrinks with the file.

### Why keeping each record once is safe (SillyTavern 1.19)

SillyTavern sets `message.extra` from `swipe_info` in one function only, `syncSwipeToMes`, and calls it:

* when a message is swiped (`swipe` → `loadFromSwipeId`). The reader can swipe only the last message
  (`isMessageSwipeable`). Before moving away from the shown swipe SillyTavern copies `extra` into that
  swipe's `swipe_info` itself (`syncMesToSwipe(mesId)`), on every path but two: deleting the shown swipe
  (it then moves to another swipe, whose copy is that swipe's own) and turning back a failed swipe (to
  the swipe it has just copied). Swipe deletion from the swipe list on an older message is allowed only
  for swipes that are not shown;
* when a branch is made from a swipe picked in the **swipe list** (bookmarks.js
  `getBranchChatSnapshot`). The list opens on any message with more than one swipe, older ones included,
  and does not copy the shown swipe first: a branch from the shown swipe takes `extra` from its
  `swipe_info` copy. So a carrier with more than one swipe keeps its copy.

Nothing else reads it back: deleting messages, editing, Continue, the normal Branch button (it copies
`message.extra`) and loading a chat all use `extra` itself. The store drops the copy of the carrier before
a new reply when that reply gets its record, and on a rebuild it drops the copies it no longer keeps and
gives the last carrier its copy back when a deletion made an earlier one the last. That copy is written
only for a message at rest: SillyTavern tells of a deleted swipe (`MESSAGE_SWIPE_DELETED`) before it
shows the next one, and the slot under `swipe_id` is then the next swipe's own copy, which is never
written over. The swipe marks and copied-record checks (persist.js `readRecord`) read other swipes'
copies only, which stay as SillyTavern made them. Tests: `tests/v2/storage-once.test.js` (swipe
right/left, swipe deletion shown and not, swipe-list branch from the shown and the other swipe, delete
of the last reply, reload, a chat written before).

**Older chats** need no migration: replay reads `message.extra` only, and accepts checkpoints anywhere.
The first rebuild of an older chat (opening it) drops the copies it no longer keeps and old receipts'
`data`, in memory; the next save writes the smaller file. It changes no state at any message.

### Old receipts' `data`

The contract (SPEC §2.2): **receipt `data` older than 200 carriers may be dropped; modules must not rely
on it.** What a module needs from its past receipts later it keeps in its own state. Story Block itself
never reads it then: claims live in `meta.claims`; Re-read matches a line by the receipt's `line` and
`seed`; narration uses `summary` and `narrate`; story-vouched payouts and the per-reply budgets are kept
in state (`perReply`, `director.turn.vouched`). On v2 at e44039b no module's query read `tools.receipts()`;
Story Director's day digest (in progress on its own branch) read old receipts' `data` for the clock and
the day's facts, and keeps them in its own state instead (RX-TL-3). So `data` goes, everything else stays
(`id`, `type`, `module`, `cause`, `seed`, `summary`, `narrate`, `line`, `rev`). Summaries stay because
they feed quest history.

### What was left out

| Variant (on the 3,000-reply chat, as built) | Chat file | Same head |
|---|---|---|
| as built | 15.12 MB | yes |
| before: a copy in `swipe_info` on every reply | 22.66 MB | yes |
| before: checkpoints every 20 / 32 KB | 19.43 MB | yes |
| not adopted: ops compacted (one `/meta/rev` per carrier, no replace overwritten later) | 14.10 MB (−7%) | yes |
| not adopted: old receipts' `summary` emptied too | 14.71 MB (−3%) | yes |

* **One `/meta/rev` per reply** would leave the head state the same, but not the rest of what reads
  ops: Return in time (`store.truncate`, MODULES §F17) cuts a carrier's changes at each receipt's
  `/meta/rev` op, so a return to a receipt in the middle of a reply's capture would take the whole
  capture back; a skipped block names its receipts by those revs (Problems); a Re-read renumbers kept
  blocks by them. Not worth 7%. A lossless form (the rev implied by the block's span) could come later.
* **Folding the capture save into SillyTavern's own save** is not done: SillyTavern 1.19's `saveChat`
  swallows errors (a toast, no throw, no event when it ends), so Story Block could not tell that the
  change reached the file and could not keep "a failed save never drops a turn" (SPEC §3.3, B-1/B-2).
  Since #91 a reply costs Story Block one write of its own (the capture's; cues ride on it), plus one per
  burst of the reader's clicks; with the file halved each write is half the size.

## Checkpoint rule (on the 3,000-reply chat, each record once)

| Rule (every / ops bytes) | Checkpoints | Checkpoint bytes per reply | Chat file | Same head |
|---|---|---|---|---|
| 20 replies / 32 KB (before) | 151 | 1.9 KB | 19.43 MB | yes |
| 50 replies / 64 KB | 61 | 0.7 KB | 16.16 MB | yes |
| **100 replies / 128 KB (as built)** | 31 | 0.4 KB | 15.12 MB | yes |
| 200 replies / 256 KB | 16 | 0.2 KB | 14.57 MB | yes |

Past 100 the file barely shrinks (−0.5 MB for 200) while the longest replay doubles.

## Saves

| UI clicks | Story Suite saves per reply (mean) | Most in one reply | Capture saves | UI saves |
|---|---|---|---|---|
| burst (3 clicks within 400 ms) | 1.25 | 2 | 1 per reply | 1 per UI round, flushed when the next generation starts |
| spread (each click saved alone) | 1.72 | 4 | 1 per reply | 3 per UI round |

These are Story Suite's own saves (§3.3: one per UI burst, one at the end of the after-reply capture;
cues before a reply are saved with it). SillyTavern also saves the chat itself after each reply.

### SillyTavern's `backups.chat.throttleInterval`

The backup is a full copy of the chat, throttled: at most one copy per interval (plus one at the end
of the interval when saves came during it). The default, 10 seconds, is shorter than a reply, so in
practice each reply costs one or two more full copies of the file on top of the saves (the b6 soak saw a
43 MB copy every 10 s). For weak servers, set it to **300000 (5 minutes)** in `config.yaml`:

```yaml
backups:
  chat:
    throttleInterval: 300000
```

That brings backup writes to about one per 5 minutes, whatever Story Suite and SillyTavern save in
between, and still keeps a recent copy. With long chats also look at how many backups are kept
(`backups.common.numberOfBackups`): each one is a full copy, about 15 MB for a 3,000-reply chat. Check
the names against your SillyTavern version's `default/config.yaml`; older versions used other keys. The
guide says the same (docs/v2/GUIDE.md, "Slow disk?").

## Memory of the caches

The store's own caches (the head state and the frozen copy of the checkpoint it started from) stay under
100 KB at every length (62–92 KB here). The chat array SillyTavern holds is the real memory cost, and it
is half the size it was.

## Possible later steps

* Size the checkpoint interval by the state ("ops since the last checkpoint exceed 3 times its size"),
  so a small state checkpoints more often and a large one less; the 2× rule above is a first step.
* A shorter receipt for story captures with `narrate: false` (their change line is already in the
  reply's hidden text).
* The lossless op compaction above (−7%).
