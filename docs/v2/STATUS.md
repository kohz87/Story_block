# Story Suite v2: implementation status

The single place to see what is built, merged, in progress and decided. Updated by the coordinator with every
merge. Contract: [SPEC.md](SPEC.md), [MODULES.md](MODULES.md) (§F = binding decisions).

Legend: ✅ merged into `v2` · 🔧 in progress · ⏳ planned

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
| Integration: index.js bootstrap, host fixes (ctx.caller/rev/id/carrier/chat), rewind, wiring | 🔧 | |
| Default screens (Inventory, Scene, changes card, home) + player guide | 🔧 | |
| Assist (optional pre-roll classifier, after-reply extractor) | 🔧 | |
| QA (state invariants, security, prompt) · performance benchmarks | 🔧 | |

## RPG Battle (module)
| Piece | State | PR |
|---|---|---|
| Party: actors, growth, wounds, rests, companions, offers, portraits, canGenerate | ✅ | #68 |
| Items: item.define rules, use / equip / give | ✅ | #65 |
| Combat: encounters, v1 engine replayed from stored actions, settlement, foes beaten | ✅ | #67 |
| Trade: sell, buy, commission, collect, market rule, prices per place | ✅ | #66 |
| Integration: module.js, one currency, payload fixes, index.js bootstrap | 🔧 | |
| Pending d20 checks with reader modifiers (§F16) | 🔧 | |
| Character creation: built-in races/talents, wizard (§F12, §F14) | 🔧 | |
| Return in time after death (§F17) | ✅ | #69 |
| Battle board widget, default screens (Party HUD, Items, Trade, HUD, status card) | 🔧 | |
| QA (conservation, fuzz, v1 parity, cross-part payloads) | 🔧 | |

## Story Director (module)
| Piece | State | PR |
|---|---|---|
| Tracker: director domain, v1 rules, story clock, note | ✅ | #74 |
| Quests: take / turn down / abandon / finish, targets, progress, payouts | ✅ | #73 |
| Integration: module.js, one currency, one fight per kill quest, typed acceptance | 🔧 | |
| Atlas: places, routes, travel, map | 🔧 | |
| Default screens (Quests, Director, status card, HUD) | 🔧 | |
| Deadlines that lapse on time jumps + "while away" recap (§F21) | 🔧 | |
| Ersveil starter test pack (places, routes, calendar, Bluewatch jobs, marks) | 🔧 | |

## NPC State Delta (standalone, hosted when Story Block v2 is present)
| Piece | State | PR |
|---|---|---|
| Hosted adapter: queries, Cast tab, settings in the overlay | ✅ | #171 |
| Integration: npc.portrait, release zip, no v1 hookup on a v2 host | ✅ | #172 |

## Milestones
- ⏳ **2.0.0-alpha.1**: all four integrated, combined live test passing (creation → offer → fight → quest payout → swipe/delete rollback), tagged on each `v2` branch.
- ⏳ **2.0.0-beta**: QA findings fixed, performance tuned, screens polished, guide complete.
- ⏳ Studio (separate app): after beta.

## Decisions log
See [MODULES.md §F](MODULES.md) (F1–F19): one currency; ctx.rev; queries with tools; REFUSED; payloads; equipment
stacks; one fight per kill quest; namespaced widgets; one theme format; portraits; mandatory creation; no
model-written state blocks; creation content; presets' blocks ignored; d20 checks with modifiers; return in
time; default look; merging after green CI.
