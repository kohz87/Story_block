# Story Suite v2: implementation status

The single place to see what is built, merged, in progress and decided. Updated by the coordinator with every
merge. Contract: [SPEC.md](SPEC.md), [MODULES.md](MODULES.md) (§F = binding decisions).

Legend: ✅ merged into `v2` · 🔧 in progress · ⏳ planned

Where things stand: **2.0.0-alpha.2 is the baseline** (notes: [RELEASES.md](RELEASES.md), #93). Three break
rounds ran and their findings are fixed. **Beta is being built now in waves A–E**: the Features toggles (F100)
and storage tuning first, then the queued features in parallel. Breakers attack each wave PR as it opens and
merges. The beta.1 notes are drafted at the top of RELEASES.md as features land.

## Story Block (host)
| Piece | State | PR |
|---|---|---|
| State store: per-reply ops, checkpoints, replay, swipe/delete rollback, save batching | ✅ | #53 |
| Command bus: drafts→ops, validators, claims, receipts, seeded rng, preview/commit | ✅ | #54 |
| Registry, change-line capture, prompt assembly (cache layout), turn pipeline, sdk, settings/tab host, testkit | ✅ | #62 |
| Core domains: scene, inventory (one currency), commands, capture, queries, tabs | ✅ | #57, #59 |
| Packs: validation, file + lorebook import, installed list, lookups | ✅ | #60 |
| Events: safe condition language, engine, status | ✅ | #58 |
| Layouts: JSON screen renderer | ✅ | #56 |
| Mounts: screen registry, tab / full screen / card under reply / HUD / dialog | ✅ | #61 |
| Widgets: ss.meter, radar, map, skill-tree, portrait, badge, timeline, stepper | ✅ | #63 |
| Fishing example activity (public SDK only) | ✅ | #55 |
| HTML templates with bindings, scoped CSS | ✅ | #64 |
| Integration: index.js bootstrap, host fixes (ctx.caller/rev/id/carrier/chat), rewind, wiring | ✅ | #67 |
| Default screens (Inventory, Scene, changes card, home) + player guide | ✅ | #66 |
| Assist (optional pre-roll classifier, after-reply extractor), off by default | ✅ | #65 |
| Performance benchmark + tuning proposals (docs/v2/PERFORMANCE.md) | ✅ | #68 |
| Ersveil starter pack; pack places, routes, calendar, skills, presets | ✅ | #69 |
| QA (state invariants, security, prompt) | ✅ | #70 |
| Security hardening (packs, templates, CSS, screens) from the QA findings | ✅ | #71 |
| Pack `terms` and `ranks` content kinds (§F25), sum() template helper | ✅ | #72 |
| UX: reply notes + Re-read (F40), refused lines (F41), Alt+G (F53), status strip (F54), strings (F56), reduced motion (F57), REVIEW.md | ✅ | #73 |
| Capture skips change blocks drafted inside reasoning | ✅ | #74 |
| UI fixes: Home first, calendar time, scene moves, no cards on the greeting | ✅ | #75 |
| Core fixes from QA: block-level replay, a failed save keeps the turn, internal commands, prototype keys, currency plural | ✅ | #76 |
| Break fixes: linear capture, one record write per reply, story coin/item limits, safe form names, depth caps | ✅ | #77 |
| Break fixes: a module that gains a domain keeps its data, version handshake, hook timeouts, boot order | ✅ | #78 |
| Follow-ups: sdk.reread, currency plural on screens and packs, story item use, pack events by definition, owners | ✅ | #79 |
| Counts move on replay (`was`); checkpoints know what they cover | ✅ | #80 |
| Docs: SPEC §2.2/§3.1/§4/§7, MODULES §C, F1, F81–F103 | ✅ | #81 |
| Saves follow their chat, refused saves seen, greeting delete keeps state, swipe marks, rewind dry run | ✅ | #82 |
| Continue finds its own block after SillyTavern's clean-up; an emptied stack's take moves on replay; this status | ✅ | #83 |
| Docs: SB-fix4 status, save cost per chat length | ✅ | #84, #85 |
| Round 2 fixes: story goods worth and kinds, story-vouched payouts, sid-keyed tally, replay checks, place kind | ✅ | #86 |
| Replay passes over a gone key's remove; pre-release version order; VERSION 2.0.0-alpha.2 | ✅ | #87 |
| b5b round 2: linear tag scans, whole-character cuts, settings list clamps, loop and props limits | ✅ | #88 |
| Speed: frozen views for reads and queries, no head replay for record-less messages | ✅ | #89, #90 |
| b2 round 2: dry runs, swipe marks, renamed chats, Re-read races, one write less per reply | ✅ | #91 |
| One notable story item per reply, outside the goods budget | ✅ | #92 |
| The notable item is one key item: its own stack, usable, never sold (RPG Battle) | ✅ | (this PR) |
| 2.0.0-alpha.2 release notes | ✅ | #93 |
| Packs: installed modules satisfy a pack's capabilities (Ersveil imports) | ✅ | #94 |
| A card edit or rename before the first reply keeps the greeting's state | ✅ | #95 |
| Player guide: checks, story item use, quests, economy and currency, Ersveil import, backup interval | 🔧 | |
| Features: reader switches for optional mechanics (F100) | ✅ | #96 |
| Storage tuning: checkpoint 100/128 KB, ride on SillyTavern's save, op compaction (one record copy done in #77) | 🔧 | |

## RPG Battle (module)
| Piece | State | PR |
|---|---|---|
| Party: actors, growth, wounds, rests, companions, offers, portraits, canGenerate | ✅ | #68 |
| Items: item.define rules, use / equip / give | ✅ | #65 |
| Combat: encounters, v1 engine replayed from stored actions, settlement, foes beaten | ✅ | #67 |
| Trade: sell, buy, commission, collect, market rule, prices per place | ✅ | #66 |
| Integration: module.js, one currency, payload fixes, index.js bootstrap | ✅ | #71 |
| Pending d20 checks with reader modifiers (§F16; replaced by same-reply checks, F80, in #79) | ✅ | #70 |
| Character creation: built-in races/talents, wizard, persona (§F12, §F14, §F22) | ✅ | #73 |
| Return in time after death (§F17) | ✅ | #69 |
| Battle board widget + Fight screen | ✅ | #72 |
| Default screens (Party HUD, Items, Trade, HUD, status card) | ✅ | #74 |
| QA (conservation, fuzz, v1 parity, cross-part payloads) | ✅ | #75 |
| Wiring pass: board, creation, screens, presets, terms, companions on death/leaving (§F25, §F26) | ✅ | #76 |
| RB-A: fights always settle, draughts taken at use, companion toggles, party size, character file | ✅ | #77 |
| RB-A follow-up: one HP in every view during a fight, loot from known/pack items, seeded fight ids | ✅ | #78 |
| RB-B: same-reply checks (F80), carry limit (F39), shortages (F36), pack shops, story use (F96) | ✅ | #79 |
| The host's hook arguments handed on to every part | ✅ | #80 |
| Break fixes (b4 combat, b1 capture, b3 economy, b5b, b2 claims) | ✅ | #82 |
| Balance: a tier is a threat budget for the whole group (B-b4-11) | ✅ | #83 |
| Story Block testkit at da54eaf (carrier sid), b2-timeline claims | ✅ | #84 |
| Round 2: a character file's things held to a worth | ✅ | #85 |
| Round 2: b4-combat fixes (opening draught, return cue, per-tier budget, boss level) | ✅ | #86 |
| Round 2: keyed bookkeeping that survives a middle delete, fuzz-delete CI, requires alpha.2 | ✅ | #87 |
| v1 (`main`) 0.5.52: steps aside next to Story Block 2 | ✅ (main) | #81 |

## Story Director (module)
| Piece | State | PR |
|---|---|---|
| Tracker: director domain, v1 rules, story clock, note | ✅ | #74 |
| Quests: take / turn down / abandon / finish, targets, progress, payouts | ✅ | #73 |
| Integration: module.js, one currency, one fight per kill quest, typed acceptance, v2 bootstrap | ✅ | #75 |
| Atlas: places, routes, travel, map | ✅ | #77 |
| Default screens (Quests, Director, status card, HUD) | ✅ | #76 |
| Deadlines that lapse on time jumps + "while away" recap (§F21) | ✅ | #78 |
| Wiring: time, atlas and screens parts in the module | ✅ | #79 |
| Chronicle: world events and factions (F89) | ✅ | #80 |
| Quests follow the story, code referees (F82–F88, F94, F95) | ✅ | #81 |
| Atlas map: every known place, pan/zoom, search, details (F98) | ✅ | #82 |
| Break fixes (b1 capture, b3 economy, b4 combat, b5b robustness) | ✅ | #83 |
| Written quest ranks held to the party's, thread summaries capped | ✅ | #85 |
| Round 2: story-vouched quests one a reply, written rewards never raised, difficulty one rank up | ✅ | #86 |
| Round 2: keyed Director bookkeeping, atlas limits, live threads in the tail, fuzz-delete CI | ✅ | #87 |
| Quest payouts use the currency plural ("50 marks") | ✅ | #88 |
| v1 (`main`) 0.9.47: steps aside next to Story Block 2 | ✅ (main) | #84 |

## NPC State Delta (standalone, hosted when Story Block v2 is present)
| Piece | State | PR |
|---|---|---|
| Hosted adapter: queries, Cast tab, settings in the overlay | ✅ | #171 |
| Integration: npc.portrait, release zip, no v1 hookup on a v2 host | ✅ | #172 |
| Hosted mode: one sidecar look per new chat, launcher and in-chat cast step aside | ✅ | #173 |
| Meters in the per-reply state, stages, hidden notes (F81, F90) | ✅ | #175 |
| Hosted fixes from b7: the capture strip keeps `<Changes>`, Cast tab redraws, awaited registration | ✅ | #177 |
| Cleanup steps 0–11 (locks, caps, golden outputs, field registry, profileUpdates, gates, markers, merges, targeted passes, index.js split in three parts, dead code) | ✅ | #174, #176, #178–#189 |
| Round 2: Cast tab keeps to its own pane, failed loads say so, swipe guard, caller rules, requires alpha.2 | ✅ | #190 |
| Prompt alignment (audit steps 12–13, approved by the user) | ✅ | #191 |

## Break round (F103)
Seven break runs went at the merged wave 4 code; each wrote a report with failing tests. The findings below
are fixed in this round's PRs, each with the finding's test.

| Run | What it went at | Findings | Fixed in |
|---|---|---|---|
| b1-capture | change-line fuzz, limits, Continue | 17 (3 high, 7 med, 7 low) | SB #77, #79; RB #82; SD #83 |
| b2-timeline | swipes, deletes, chat switches, saves (live chaos) | 11 (1 crit, 2 high, 5 med, 3 low) | SB #77, #80, #82; RB #82, #84 |
| b3-economy | conservation of coin, goods and XP | 20 (3 crit, 9 high, 6 med, 2 low) | SB #76, #77, #79, #80, #83; RB #82; SD #83, #85 |
| b4-combat | fights, checks, changes mid-fight | 14 (2 high, 9 med, 3 low) | RB #82, #83; SD #83 |
| b5b-robust | form names, prompt hygiene, regex timing, sizes (b5-security stopped early) | 13 (3 high, 5 med, 5 low) | SB #77; RB #82; SD #83 |
| b6-soak | 1500 replies live | no report filed | |
| b7-combos | versions, NSD hosted, module upgrades | 12 (1 crit, 2 high, 6 med, 3 low) | SB #78; NSD #177; v1: RB #81, SD #84 |

87 findings from six reports. Left over from the live re-checks after #82 and fixed in #83: a Continue of a
reply that SillyTavern writes back cleaned up (spaces at line ends dropped, trimmed) left the continuation's
block bare, and a stack a later reply emptied came back empty after a middle reply that took from it was
deleted. The bare blocks the SB-fix3 chaos runs blamed on Continue were the harness's own edit step: a block
typed into a reply by hand stays shown until Re-read, by design.

## Open
- Two tabs on one chat: the last writer wins (documented; no lock across tabs).
- SillyTavern's own TypeError when the chat is switched mid-stream (`onProgressStreaming` reads `mes` of a
  message that is gone); seen in every live chaos run, not ours to fix.
- Save cost grows with the chat: the reader's actions are saved before sdk.command answers, and the
  whole chat file is written each time. Measured live (SillyTavern 1.19, messages of about 2.4 KB with
  their records): 50 messages 0.13 MB, 13 ms a save; 500 messages 1.2 MB, 97 ms; 3000 messages 7.3 MB,
  551 ms (55 ms of it building the body on the page). Actions made while a save is writing already share
  one more save; actions made one after another each wait for their own. Answering before the server
  has the save would trade that for a lost action when the page is closed mid-save (keepalive only
  carries 60 KB): a decision for after alpha.2, with the storage tuning.
- To watch: `src/v2/chat-file.js` mirrors SillyTavern's save body; check it on each SillyTavern release.

## Next
1. Beta waves A–E land (Features toggles and storage tuning first), each attacked by the rolling breakers.
2. Combined attack round and soak on the frozen beta candidate.
3. Version bumps to 2.0.0-beta.1 (draft PRs, merged at the beta candidate), then the user's own test.
4. No merge of `v2` into `main` until the user has tested.

## Milestones
- ✅ **2.0.0-alpha.1**: all four integrated, combined live test passing (creation → offer → fight → quest payout → swipe/delete rollback), tagged on each `v2` branch.
- ✅ **Wave 4**: the F28–F102 features and the QA fixes, merged in all four repos.
- ✅ **Break round (b1–b7)**: findings fixed.
- ✅ **2.0.0-alpha.2**: baseline after three break rounds (#93).
- 🔧 **2.0.0-beta.1**: waves A–E (Features toggles, storage tuning, equip picker, crafting, wear, TRS ideas 1–12), guide complete.
- ⏳ Studio (separate app): after beta.

## Decisions log
See [MODULES.md §F](MODULES.md) (F1–F103): one currency; ctx.rev; queries with tools; REFUSED; payloads; equipment
stacks; one fight per kill quest; namespaced widgets; one theme format; portraits; mandatory creation; no
model-written state blocks; creation content; presets' blocks ignored; same-reply d20 checks (F80); return in
time; default look; merging after green CI; quests follow the story with code as referee (F94, F95); story-driven
item use (F96); NPC meters (F81, F90); feature freeze for the break round (F103).
