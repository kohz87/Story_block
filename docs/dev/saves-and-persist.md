# Saves and persistence

Where state lives, how it is replayed and how it reaches the chat file. Detail: SPEC §2.2 (records,
checkpoints, replay rules a–d, counters), §2.4 receipts, §3.3 saving; PERFORMANCE.md ("Storage tuning",
"Checkpoint rule", "Saves"); REVIEW.md risky part §1.

## Rules

- Only **carriers** hold state (greeting, assistant and system replies): `message.extra.storySuite =
  { v: 2, checkpoint?, ops, receipts, narrated, sid, swipe, mark, spans, rev, covers? }`. User messages hold nothing.
- **State at N** = latest checkpoint that still holds (`covers` matches) + every carrier's ops through N,
  replayed block by block (`spans`). A block that no longer applies is skipped and reported alone.
- Checkpoints: the greeting always; then every `CHECKPOINT_EVERY` (100) carriers, or when ops exceed
  `CHECKPOINT_BYTES` (128 KB) and twice the last checkpoint, at least `CHECKPOINT_MIN_GAP` (10) after it.
- **Counters** (`counters` paths, e.g. `wallets/*/coin`, `stacks/*/qty`) keep `was`; on replay a moved count
  adds its change. `ctx.absolute(domain, path)` stores a set without `was` (`~ time <date>`).
  `ctx.ifThere(domain, path)` stores writes `within` a thing, passed over when it is gone (rule d).
- Per-reply bookkeeping under `ctx.carrier.sid` with `add`; domains may name `scratch` fields. Never a
  positional append or a `replace` of a field another reply created.
- Receipt `data` older than `RECEIPT_KEEP` (200) carriers is dropped; keep what you need in your own state.
- A copied swipe record is ignored (`sid` + `swipe` + `mark`); Story Block mirrors the shown swipe's copy only
  where SillyTavern reads it back (`keepsCopy`, `mirrorCopy`, `dropCopy`).
- Rebuilding replays stored ops only, never a handler. The head cache is checked against the chat on each read.
- **Saving:** the turn's save goes 1.5 s after the last change (`IDLE_MS`), never later than 8 s
  (`IDLE_MAX_MS`); a generation starting folds it into the reply's save. In SillyTavern Story Block writes the
  chat file itself (`chat-file.js`, `/api/chats/save`); without one (testkit) it saves at once via `ctx.saveChat`.
- A save checks the open chat in the same tick; a change made in another chat goes to that chat's file
  (rescue). Refused saves retry (1, 2, 4, 8, 15 s); 20 s without an answer counts as refused and marks the
  chat suspect: rising `chat_metadata.storySuiteSave` stamps and read-backs over about five minutes.
- Page hidden or closed with unsaved changes: keepalive send at once, within `KEEPALIVE_MAX` (60 KiB of UTF-8
  bytes); bigger, `beforeunload` asks first.
- Not covered: two tabs on one chat (last writer wins).

## Key files and functions

- `src/v2/persist.js`: `KEY`, `isCarrier`, `readRecord`, `writeRecord`, `restamp`, `swipeMark`, `markFits`,
  `keepsCopy` / `mirrorCopy` / `restoreCopy` / `dropCopy`, `trimReceipts`, `carryRecord`, `createSaver`,
  `IDLE_MS`, `IDLE_MAX_MS`, `RECHECK_MS`.
- `src/v2/store.js`: `createStore` (`head`, `at`, `append`, `replaceStory`, `rebuild`, `scheduleSave`,
  `saveSoon`, `flush`, `saveIdle`, `truncate`, `work`), checkpoint constants, `deepFreeze`.
- `src/v2/chat-file.js`: `createChatFile`, `utf8Bytes`, `KEEPALIVE_MAX` (mirrors SillyTavern 1.19's save body).
- `src/v2/runtime.js`: `storeSaving`, `saveOnUnload`, `markUsed`, `SAVE_SEQ_KEY`, `MEMO_PREFIX`.
- `src/v2/ops.js`: `diff`, `apply`, `checkOps`. `src/v2/rewind.js`: rewinds and save points (ST branches).

## Tests that guard it

- `tests/v2/store.test.js`, `persist.test.js`, `saving.test.js`, `storage-once.test.js`, `store-head-cache.test.js`,
  `counters.test.js`, `replay-fit.test.js`, `long-chat.test.js`, `rewind.test.js`, `savepoints.test.js`, `ops.test.js`.
- `tests/v2/qa/state-fuzz.test.js` (replay equals rebuild wherever checkpoints fall), `qa/delete-fuzz.test.js`,
  `qa/state-directed.test.js`.
- Break findings: `b2-timeline-*`, `b6-record-stored-once`, `b6-saves-per-reply`, `c1-*`, `c4-rename-midsave`,
  `c4-rescue-*`, `c4-save-hang`, `a1-late-save-*`, `a1-late-rescue-write`, `a1-unload-behind-hung-save`,
  `a3-keepalive-counts-chars-not-bytes`, `f1-late-save-overwrites-newer`, `final-stale-*`, `final-unload-big-chat`,
  `replay-new-key`, `r2-b3-*`.
- Benchmarks (not in `npm test` beyond `tests/v2/bench/smoke.test.js`): `scripts/bench-v2.mjs`,
  `scripts/bench-long.mjs`, see PERFORMANCE.md "How to run it".

## When you change it

- Any new op shape or bookkeeping: add it to the fuzz generator and prove replay == live after swipe,
  middle delete, rewind and reload. Old chats must still read (checkpoints are read wherever they are).
- Re-check `chat-file.js` against SillyTavern's own `saveChat` body on each SillyTavern release.
