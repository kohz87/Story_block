# Story Suite v2: storage performance

What v2's storage (docs/v2/SPEC.md §2.2, §3.3) costs on disk and in time over a long chat, measured
with a benchmark, and what could be tuned. Nothing here changes the runtime yet: the tuning below is a
**proposal** for the coordinator.

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
tuning variant keeps the same head state). The harness is `tests/v2/bench/load.js`.

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
  (the chat's header line is left out). Timings are one machine's (Node 22, x64 Linux): read them as
  orders of magnitude, and expect a phone or an old laptop to be several times slower.
* **v1 for comparison:** the same story text, with a ~3 KB state block at the end of each reply. In
  SillyTavern a reply's text is stored twice (`mes` and its swipe in `swipes`), so v1 costs ~6 KB per
  reply. Note that 3 KB is less state than v2 keeps here: the v2 head state of this load is 37 KB.

## Results

### Chat size

| Replies | Chat file | storySuite records | share | v1 (3 KB block per reply) | v2 / v1 |
|---|---|---|---|---|---|
| 100 | 1.13 MB | 896.7 KB | 78% | 817.4 KB | 1.41× |
| 1000 | 10.37 MB | 7.87 MB | 76% | 7.98 MB | 1.30× |
| 3000 | 30.96 MB | 23.47 MB | 76% | 23.94 MB | 1.29× |

As built, v2's records are three quarters of the file, and the file is about 1.3 times v1's.

### Bytes added per reply

Both copies of each record are counted: SPEC §2.2 writes the record to `message.extra` and keeps
`swipe_info[swipe_id].extra` in step, and SillyTavern writes both to the file.

| Replies | All | checkpoints | ops | receipts | (of which data) | (of which summary) | other fields | hidden change text | v1 block (mes + swipe) |
|---|---|---|---|---|---|---|---|---|---|
| 100 | 9.0 KB | 4.0 KB | 1.9 KB | 2.5 KB | 0.5 KB | 0.4 KB | 0.5 KB | 0.4 KB | 6.0 KB |
| 1000 | 8.1 KB | 3.7 KB | 1.3 KB | 2.6 KB | 0.5 KB | 0.4 KB | 0.5 KB | 0.4 KB | 6.0 KB |
| 3000 | 8.0 KB | 3.7 KB | 1.3 KB | 2.6 KB | 0.5 KB | 0.4 KB | 0.5 KB | 0.4 KB | 6.0 KB |

"Other fields" are `sid`, `swipe`, `spans`, `narrated`, `rev` and the keys. The hidden change text is the
`<Changes>` block kept in the reply's text (in `mes` and in its swipe) for Re-read; it is not part of the
record. A reply's 5 changes plus a quarter of 3 UI commands come to about 6 receipts and ~13 ops.

### Checkpoints

| Replies | Count | Median size | Largest | All (one copy) | Head state | Carriers replayed at load |
|---|---|---|---|---|---|---|
| 100 | 6 | 37.0 KB | 37.0 KB | 202.0 KB | 37.0 KB | 16 |
| 1000 | 51 | 37.0 KB | 37.0 KB | 1.82 MB | 37.0 KB | 16 |
| 3000 | 151 | 37.0 KB | 37.0 KB | 5.44 MB | 37.0 KB | 16 |

A checkpoint is the whole state (37 KB here), every 20 carriers: 1.85 KB per reply, 3.7 KB with both
copies, the largest single part. The 32 KB ops rule never fires first with this load (the ops of 20
replies are ~13 KB).

### Saves

| UI clicks | Story Suite saves per reply (mean) | Most in one reply | Capture saves | UI saves |
|---|---|---|---|---|
| burst (3 clicks within 400 ms) | 1.25 | 2 | 1 per reply | 1 per UI round, flushed when the next generation starts |
| spread (each click saved alone) | 1.72 | 4 | 1 per reply | 3 per UI round |

These are Story Suite's own saves (§3.3: one per UI burst, one at the end of the after-reply capture).
SillyTavern also saves the chat itself after each reply, so as built a reply costs at least
**2.25 full-file writes** plus the backup copies.

### Time

The last 100 replies before each length; "before reply" is the interceptor (flush, cues, untold
receipts, prompt assembly), "capture" is the `MESSAGE_RECEIVED` handler for 5 lines (run, append,
narrated, one save).

| Replies | Before reply (median / p95) | Capture of 5 lines (median / p95) | UI command (median / p95) | JSON.parse of the chat | Head rebuild at load | Longest replay (a whole interval) | Rebuild after swipe | Swipe back | Swipe rolls back |
|---|---|---|---|---|---|---|---|---|---|
| 100 | 3.86 ms / 5.86 ms | 5.94 ms / 10.26 ms | 0.70 ms / 2.06 ms | 12.09 ms | 1.86 ms | 4.02 ms | 2.06 ms | 1.81 ms | yes |
| 1000 | 2.64 ms / 4.36 ms | 3.16 ms / 5.63 ms | 0.37 ms / 0.84 ms | 67.97 ms | 1.30 ms | 2.20 ms | 1.13 ms | 0.97 ms | yes |
| 3000 | 3.53 ms / 7.74 ms | 3.15 ms / 6.23 ms | 0.39 ms / 1.16 ms | 239.37 ms | 1.91 ms | 20.52 ms | 0.94 ms | 1.01 ms | yes |

* Capture and commands do not slow down as the chat grows: they touch the head carrier only. The
  interceptor grows slightly (untold receipts scan every carrier), still a few milliseconds at 3,000.
* A rebuild replays at most one checkpoint interval, so it is flat too (1–2 ms; the 20 ms in one cell is
  most likely a garbage-collection pause: the same chat measures 6 ms in the tuning table).
* Parsing the chat's JSON grows with the file (240 ms at 31 MB) and dwarfs the rebuild: on load, the
  file size matters more than the replay.

### Memory of the caches

| Replies | Heap held by a built store (head + checkpoint copy) | Head state JSON | Checkpoint JSON |
|---|---|---|---|
| 100 | 66.0 KB | 37.0 KB | 37.0 KB |
| 1000 | 74.2 KB | 37.0 KB | 37.0 KB |
| 3000 | 88.4 KB | 37.0 KB | 37.0 KB |

The store's own caches stay under 100 KB. The chat array SillyTavern holds is the real memory cost, and
the record copies in it are 76% of it.

## Tuning experiments

Run on the finished 3,000-reply chat by rewriting where checkpoints are, or what records hold, then
replaying through a fresh store; every variant gives exactly the same head state ("Same head").

### Checkpoint rule

| Rule (every / ops bytes) | Checkpoints | Checkpoint bytes per reply | Chat file | Rebuild at load | Longest replay (a whole interval) | Rebuild after swipe | Same head |
|---|---|---|---|---|---|---|---|
| 20 replies / 32 KB (as built) | 151 | 3.7 KB | 30.96 MB | 1.30 ms | 6.08 ms | 1.00 ms | yes |
| 50 replies / 32 KB | 62 | 1.5 KB | 24.52 MB | 0.62 ms | 5.90 ms | 0.66 ms | yes |
| 50 replies / 64 KB | 61 | 1.5 KB | 24.44 MB | 0.63 ms | 6.39 ms | 0.51 ms | yes |
| 100 replies / 64 KB | 31 | 0.8 KB | 22.27 MB | 3.11 ms | 8.50 ms | 2.50 ms | yes |
| 100 replies / 128 KB | 31 | 0.8 KB | 22.27 MB | 0.56 ms | 13.58 ms | 5.10 ms | yes |
| 200 replies / 256 KB | 16 | 0.4 KB | 21.19 MB | 0.76 ms | 13.47 ms | 13.45 ms | yes |

"Rebuild at load" depends on where the last checkpoint happens to fall; the longest replay is the
worst case. Going from 20 to 100 carriers saves 8.7 MB of a 31 MB file and costs at most ~10 ms more per
rebuild, on the client, where it is cheap; disk writes are on the server, where it is not.

### Other reductions

| Variant | Chat file | storySuite records | per reply | vs v1 file | Same head |
|---|---|---|---|---|---|
| as built | 30.96 MB | 23.47 MB | 8.0 KB | 1.29× | yes |
| ops compacted (one /meta/rev per carrier, no replace overwritten later) | 28.94 MB | 21.45 MB | 7.3 KB | 1.21× | yes |
| receipts older than 200 replies: data emptied | 29.67 MB | 22.18 MB | 7.6 KB | 1.24× | yes |
| receipts older than 200 replies: data and summary emptied | 28.50 MB | 21.02 MB | 7.2 KB | 1.19× | yes |
| record kept once (swipe_info copy only on the last reply) | 19.23 MB | 11.74 MB | 4.0 KB | 0.80× | yes |
| checkpoint 100 / 128 KB | 22.27 MB | 14.79 MB | 5.0 KB | 0.93× | yes |
| all of the above (data only stripped) | 13.27 MB | 5.78 MB | 2.0 KB | 0.55× | yes |
| all but "kept once" | 18.97 MB | 11.48 MB | 3.9 KB | 0.79× | yes |

### Bytes written per reply

SillyTavern rewrites the whole file on every save, so a reply costs the file size times the saves.

| At reply 3000 | File | Story Suite saves | + SillyTavern's own save | + one backup copy | Total per reply |
|---|---|---|---|---|---|
| v1 (3 KB block) | 23.94 MB | – | 23.94 MB | 23.94 MB | 47.89 MB |
| v2 as built | 30.96 MB | 38.69 MB | 30.96 MB | 30.96 MB | 100.60 MB |
| v2 tuned (checkpoints, compaction, receipts), capture save folded into SillyTavern's | 18.97 MB | 4.74 MB | 18.97 MB | 18.97 MB | 42.67 MB |

## Proposals (not implemented)

### 1. Checkpoints: every 100 carriers or 128 KB of ops

Change `CHECKPOINT_EVERY` from 20 to 100 and `CHECKPOINT_BYTES` from 32 KB to 128 KB (SPEC §2.2). That
cuts checkpoint bytes per reply from 3.7 KB to 0.8 KB (−28% of the file at 3,000 replies). The worst
replay is ~14 ms here, maybe 50–100 ms on a slow phone, once per chat load or swipe. The bytes rule is a
guard for heavy chats: replay time follows the op bytes (~0.1 ms per KB here), so 128 KB keeps the worst
rebuild bounded whatever the load. An option for later: size the interval by the state, for example
"ops since the last checkpoint exceed 3 times the checkpoint's size", so a small state checkpoints more
often and a large one less.

Old chats need no migration: reading accepts checkpoints anywhere; only new carriers follow the new rule.

### 2. Keep each record once

The biggest single saving (−38% of the file, records 23.5 → 11.7 MB). Each record is written twice
because SPEC §2.2 keeps `swipe_info[swipe_id].extra` in step with `message.extra`. SillyTavern only
restores `extra` from `swipe_info` when the reader swipes, and only the last message can be swiped, so
the shown swipe's copy is only needed on the last carrier. Proposal: write the `swipe_info` copy only for
the last carrier; when a deletion makes an earlier carrier the last one, copy its record into its shown
swipe then (the store already rebuilds on `MESSAGE_DELETED`). Other swipes keep their own records as now.
Before adopting it, check in SillyTavern that nothing else restores `extra` from `swipe_info` on an
earlier message (branches, checkpoints, swipe deletion, any "swipe any message" option).

### 3. Op compaction

When a carrier's ops are written, drop every `/meta/rev` replace but the last and any `replace` that a
later op of the same carrier replaces again (`compactCarrierOps` in the harness): −7% of the file. It
is safe because `diff` only ever appends to arrays or replaces them whole, so no later op shifts an
earlier one's path. It has to keep `spans` right (story ops and kept ops compacted separately), and
receipts keep their own `rev`, so nothing that reads revs changes. Cheaper still: one `/meta/rev` op per
capture instead of one per line, since the capture writes one carrier in one go.

### 4. Receipts: strip `data` after 200 replies

Receipts are the largest part after checkpoints (2.6 KB per reply with both copies), but `data` is only
0.5 KB of it and `summary` 0.4 KB: the rest is the fixed fields. Emptying `data` of receipts older than
200 carriers saves 4%, plus `summary` 8%. Narration only needs untold receipts, Re-read re-runs a
reply's text, and claims live in `meta.claims`, so nothing in the runtime needs old `data`; only a
history view would show less. Worth doing only together with the rest, and as a background trim of
carriers that are at least 200 back (the head carrier is never touched), saved with the next ordinary
save rather than as a save of its own. A larger and riskier gain would be a shorter receipt for story
captures with `narrate: false`: their change line is already in the reply's hidden text.

### 5. Saves

* The after-reply capture save comes right before SillyTavern's own after-reply save: two full-file
  writes within the same second. Proposal: mark the store dirty and let SillyTavern's save carry the
  change, then check `extra.storySuite.rev` of the head carrier (as §3.3 does today) and save only if it
  is not on disk. To check before changing it: that SillyTavern's after-reply save always follows
  `MESSAGE_RECEIVED` (streaming and non-streaming, and when another extension stops the generation).
* Keep the 400 ms UI burst: in "spread" use (each click alone) saves go from 1.25 to 1.72 per reply. A
  longer delay (1.5–2 s) would catch more clicks in one save; the generation start flushes anyway, so
  nothing is lost when the reader sends right after clicking.

### SillyTavern's `backups.chat.throttleInterval`

The backup is a full copy of the chat, throttled: at most one copy per interval (plus one at the end
of the interval when saves came during it). The default, 10 seconds, is shorter than a reply, so in
practice each reply costs one or two more full copies of the file on top of the saves.
For weak servers, set it to **300000 (5 minutes)** in `config.yaml`:

```yaml
backups:
  chat:
    throttleInterval: 300000
```

That brings backup writes to about one per 5 minutes, whatever Story Suite and SillyTavern save in
between, and still keeps a recent copy. With long chats also look at how many backups are kept
(`backups.common.numberOfBackups`): each one is a full copy, 20–30 MB for a 3,000-reply chat. Check the
names against your SillyTavern version's `default/config.yaml`; older versions used other keys.

## Recommended order

1. **Checkpoints every 100 carriers / 128 KB** (spec number change only, no migration): −28% file.
2. **Record kept once** (the `swipe_info` copy only on the last carrier): −38% file, after the
   SillyTavern check above.
3. **Fewer full-file writes**: fold the capture save into SillyTavern's own after-reply save, and set
   `backups.chat.throttleInterval` to 300000 on weak servers.

Together with op compaction and stripping old receipts' data, the file at 3,000 replies goes from 31.0 MB
to 13.3 MB (0.55× v1's), and the bytes written per reply from ~100 MB to ~30 MB.
