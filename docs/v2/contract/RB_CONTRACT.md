# RB rebuild, phase 0: contract draft v4

Status: accepted by the user; frozen after the 021 fixes; not implemented. Sources: [V2_LOG.md](https://github.com/kohz87/inventory-block/blob/d2bc01118703e20c3a8c03d3480d9d0e9b1a2e2e/suite-notes/V2_LOG.md),
lines 747–816. Later USER entries win. §12: Approved recommendations, subject to the P11/P13 corrections in V2_LOG.md (USER, 2026-10-24); implementation remains pending. (P20/P21 retired).
All choices beyond §11, including the typed interfaces and fixtures, are the approved recommendations indexed in §12
(USER, 2026-10-24, with the P11/P13 corrections). They are implementation targets, not claims about shipped capabilities. The confirmed
three-skill swap and 24 written + 12 generated pathway graph are decisions, not proposals.

The [API appendix](RB_CONTRACT_APIS.md) lists retained names, payloads, projections and file:line.
Code paths are relative to the named repository; SB, RB, SD and NSD mean the four modules. Citations refer
to §2's pinned heads. “New” means work to build, not an API available at those heads.
RB-internal design for review items 3–6 is the [track B backlog](RB_TRACK_B_DESIGN.md).
Phase 0 fixes ownership, public seams and host guarantees; B must close that backlog before its PR merges.

## 1. Ownership

| Authoritative area | Owner | Boundary |
|---|---|---|
| Reply records, operations, receipts, claims, replay, snapshots, save points, faded intervals, hub and sockets | SB | SB coordinates restoration; other owners participate. |
| Stacks, quantities, ownership, equipped-slot records, base-unit wallet balances | SB | RB supplies item rules, effects, legality, prices, rewards and sinks. Actor gear is a derived view of SB stacks. |
| Current scene place, presence and displayed weather | SB | Keep `scene.place/present/weather` (SB `src/v2/domains/scene.js:202`). SD owns world/weather policy and calls these commands. |
| World, atlas, area danger, clock, weather policy, agendas, arcs, goals, threads, journal, optional factions/reputation, non-combat rolls | SD | Genre-neutral. No RPG rewards, class requirements or quest settlement. |
| Classes, three current skills, pathways, stats, XP, pools, conditions, gear legality, combat, bestiary, crafting, markets, currency policy, quests, party, temporary units, death checks | RB | Requires SB and SD. Shops use SD place IDs; training uses SD time. |
| Dossiers, relationships, trust, stages, traits, presets, native history/checkpoints | NSD | Stable NPC ID links companion to dossier. RB cannot draft NSD storage. |

SB refuses duplicate names and limits drafts to their owner (SB `src/v2/registry.js:411`,
`src/v2/commands.js:227`). Domains are keyed by name and initialization never resets an existing
domain (`registry.js:558`). Cross-owner reads are not isolated: `ctx.read` and SDK views expose
state (`commands.js:223`, `sdk.js:217`). Query-only cross-owner reads are this contract's rule,
not an existing access-control guarantee.

Complete mechanics ownership register. UI, prompts and hooks follow their mechanics owner.
A capture kind has one registered owner, even when its feature is off.

| Domain(s) after rebuild | Owner | Commands / capture kinds | Disposition |
|---|---|---|---|
| `inventory`, `scene` | SB | `inventory.*`, `wallet.*`, `scene.*`; item/coin/loot/place/present/weather and display-only choice/chatter | Keep storage; add policy delegation and definition-ID transport. |
| `savepoints` | SB | New `savepoint.make/restore`, host day-boundary step | New replay-owned snapshots; branch bookmarks remain separate. |
| `director`, `atlas`, `chronicle`, `arc`, `checks` | SD | `director.*`, `atlas.*`, `chronicle.*`, new `threads.offer/accept/link/questWrite/close`, `checks.roll`; time/agenda/event/hook/clock/beat/secret/route/landmark/world/faction/check | Move checks from RB; keep the single director.threads store, including the RB-computed rpg extension; remove SD RPG calculation/capture/payout. |
| `rules`, `party`, `progress`, `training`, `death` | RB | Creation/party/progression/quest/death commands in §3; retained party capture, wound/join/skill/rest/leave/xp, new skill-use/lethal/intervention, transferred quest | New rules state; no implicit reset of old `party`. |
| `creation`, `effects`, `gear`, `combat`, `bestiary`, `trade`, `craft` | RB | Retained creation/effect/item/combat/trade/craft APIs; effect/use/encounter/recipe/craft/market/repair/refine | Keep creation flow, timed effects, wear/refinement and engines. Replace sheet adapters. `gear` stores wear/refinement, not equipped slots. |
| `npc` meters and NSD native store | NSD | npc.adjust/set/refresh/milestone/tick; npc/milestone capture; new checkpoint participant | Full native restoration participation, not only SB meter rollback. |

Existing RB registration: `src/v2/party/index.js:38`, `creation/index.js:54`,
`checks/index.js:116`, `items/index.js:53`, `combat/index.js:941`, `trade/index.js:107`,
`craft/domain.js:1`; market/repair/refine capture: `trade/index.js:365`. SD quest commands/payout: `src/v2/quests/index.js:1041`;
tracker settlement: `tracker/quest-lines.js:335`. All are assigned above; no second check,
quest, equipment or wallet authority remains enabled.

The capture list is exhaustive for mechanics in scope: RB retains wound/join/rest/leave/xp,
turns skill into a class-constrained offer, and relinquishes check to SD (RB
`src/v2/party/capture.js:224`). SB display-only choice/chatter remain presentation, never class
or path authority (SB `src/v2/extras.js:86`). NSD alone owns npc/milestone
(`src/npc-meters.js:1321`). SB retains pack/event/assist, dice and module-init/capture dispatch as hub services.
The appendix records the retained interfaces used here; §3 enumerates additions and migrations.

## 2. Dependencies and CI matrix

Reference pins, not claims that the rebuild exists:

| Repository | Branch | Exact reference commit | Package version (`package.json:3`) |
|---|---|---|---|
| SB | v2 | `47b280668474b9ef056a58453b304435f0624660` | `2.0.0-beta.1` |
| RB | v2 | `c24e93d7283a2dcc66e9963f140a1baa786916e3` | `2.0.0-beta.1` |
| SD | v2 | `8072d60fb23bd7f3de4f5dc0379b3f0135e35c07` | `2.0.0-beta.1` |
| NSD | v2 | `b906544cea3f1f3a678a1d21528968b3c0321606` | `1.2.20` |

The lead's release manifest replaces these pins with exact tested implementation commits,
schema hash and fixture hash. A floating branch is not a pin. Baseline CI does not validate new APIs.

| Combination | Expected | Repositories testing this integration row |
|---|---|---|
| SB | Works | SB |
| SB + SD | Works | SB, SD |
| SB + NSD | Works | SB, NSD |
| SB + SD + NSD | Works | SB, SD, NSD |
| SB + SD + RB | Works | SB, SD, RB |
| SB + SD + RB + NSD | Works | All four |
| SB + RB; SB + RB + NSD | RB blocked; other modules work | SB, RB; NSD for second row |

Each row boots real module definitions in `createHost` (SB `testkit/host.js:40`), registers once,
runs a scripted reply, executes an action and replays it. Positive subsets: SB six, SD four,
NSD three, RB two. Add missing-query, malformed-answer, feature-off, unset-clock, disabled-SD,
late-registration, duplicate-name, swipe, re-read and delete cases. Do not test only query stubs.

Put the shared runner/loaders under new SB `testkit/matrix/`; `scripts/matrix.mjs` in each repo
is a wrapper. Reuse `scripts/sync-testkit.mjs`: it copies `testkit`, runtime roots and imports,
not arbitrary scripts, and writes the SB commit to `VERSION` (SB `scripts/sync-testkit.mjs:17`,
`:63`, `:80`). Current vendor pins are older: RB `tests/vendor/story-block/VERSION:2` is
`8d97d3f…`; SD/NSD are `10c6c93…`. Refresh to the tested implementation pin. Also remove or
synchronize RB's separate `tests/v2/qa/vendor` copy before claiming complete coverage.

RB gates through `sdk.query`, `view.query` or `ctx.query`; never import SB's internal query
runner. Only `requires.storyBlock` is enforced today; other dependency keys are ignored with
warnings (SB `src/v2/registry.js:301`, `:405`). Do not claim `requires.storyDirector` works.

Approved (USER, §12): **P22 — dependency lifecycle.** Track E adds
`requires.peers:{'story-director':range}` to RB, checking registered module IDs/versions,
including prereleases. Keep requires.storyBlock; do not pretend requires.storyDirector works.
Missing/disabled/incompatible peers reserve names but leave RB dormant. Cycles refuse activation.

New synchronous `sdk.preflight({module:'rpg-battle',rulesVersion:2})` is read-only, available
before registration: `{hostApi:2,hostVersion:string,storeVersion:number|null,
classification:'empty'|'current'|'legacy'|'mixed'|'future'|'damaged',domains:string[],
rulesVersion:number|null,rulesHash:Hash|null,peers:[{module,version:string|null,enabled:boolean}],
restore:'idle'|'pending'|'failed'}`. Unreadable data means damaged, never empty. No initialization,
receipt or save write. If sdk.preflight/host lifecycle support is absent, RB bootstrap refuses
before registering its mechanics definition; it must not invoke old ensureModules and then
try to undo initialization. Track E interposes the same classification before today's
sdk.registerModule invokes ensureModules (SB src/v2/sdk.js:300).

New SD `director.contract({}) -> {api:2,enabled,clock,tiers,threads,journal,checks}` and SB
`savepoint.contract({}) -> {api:2,snapshots,retainedChatRestore,participantsReady}` have boolean
capabilities; all must be true for ready RB. Journal means recap data independent of its UI.
Probe through public sdk.query/view.query/ctx.query at activation, before generation/mutation.
Thrown missing-query, null/undefined, malformed/version mismatch or false capability yields RB
DEPENDENCY_UNAVAILABLE. Unset director.time.minutes permits creation/views; timed actions yield
CLOCK_UNSET. Unknown atlas.canonical/tier blocks dependent content, not activation.

| State | Required behavior |
|---|---|
| preflight | Preserve legacy/mixed/future/damaged stores; §9. |
| dormant | Register/reserve once; no RB domain init, capture, prompts, AI, rule hooks or generation veto. Views show reason; actions refuse. Other modules continue. |
| ready | Initialize missing slices once on fresh/current stores; enable RB dispatch. Retry late/reenabled peer on next view/action/generation cycle, never register twice/reset. |
| ready→dormant | Preserve state; suppress RB hooks/capture when peer disappears/disables. |
| restore-pending | Host-wide barrier blocks generation/capture/scanning/mutable reads until every participant agrees (§8). |

New `sdk.modules()` keeps its existing fields and adds
`status:'dormant'|'ready'|'restore-pending'` and `reason:string|null`. `commands/kinds/domains`
remain the declared inventory; **availability requires status==='ready'**. With a restore
barrier, no mechanics module is advertised as ready. Registry lookup/dispatch likewise refuses
dormant commands and suppresses capture/hooks/context; safe diagnostic views may show the reason.
SD's `fightRunner(view=null)` must require a ready entry before inspecting `combat.*`; on a
lifecycle-capable host it must not fall back to query presence for a dormant entry. On older
hosts, preserve the existing command/query probe for old modules only. A missing, dormant or
restore-pending RB produces no encounter requests. Late SD activation refreshes discovery
before the next prompt, without registering RB twice (SB sdk.js:372; SD module.js:194).

Today canGenerate refusal blocks the whole story (SB turn.js:379); dormancy must therefore
suppress that hook, not return false. Optional NSD/social and journal UI may be off. Installed
native state still needs its participant on restoration; absent saved participant bytes hold it.

## 3. Interface: existing and new

The [appendix](RB_CONTRACT_APIS.md) replaces the old “kept `*`” shorthand. Every old draft name
is resolved here. Draft-only aliases are documentation mappings, not additional registrations.

Keep shipped names/payloads in the appendix. Draft aliases world.place/threads.list/
stats.spend/quest.accept/quest.turnIn/companion.recruit/dismiss/control map respectively to
atlas.place/here, director.threads/thread, party.spend, quest.take/finish and shipped party
roster commands; no alias registrations. savepoint.* is new. return.point/status/cue are
shipped, but rules-v2 restoration is an explicit §8 migration. New rules.* queries do not
replace existing party.* wire shapes. All typed API/state changes below are approved implementation targets (§12), not shipped yet.

Approved (USER, §12): **P01 — pack and definition transport.** Add registered
`content.rules` (§7); pin one resolved ruleset per character timeline. Link extra item rules
by SB `def.id` into RB's immutable definition table, not copied stack metadata. Replacing an
installed pack at the same version cannot change a running timeline.

New projection types (unknown actor/quest → null; empty collection → `[]`):

```ts
type Clock = {minutes:Minute|null; text:string}; // existing wire shape; never replaced
// world.areaTier({place:Id})
type AreaPolicy = {tier:Int<0,9>; allowedFoes:Ref[]; allowedTags:string[]; lore:Text240[]};
type AreaTier = {place:Id; tier:Int<0,9>|null;
  source:'place'|'region'|'world'|'unknown'; sourceId:Id|null;
  allowedFoes:Ref[]; allowedTags:string[]; lore:Text240[]};
// New SD atlas.danger:{world:AreaPolicy|null,regions:Record<Id,AreaPolicy>,places:Record<Id,AreaPolicy>}.
// Initial world:null/maps:{}; region keys are SD-assigned stable IDs, not display labels.
// First matching complete policy wins; unknown has null sourceId/tier and empty lists.
// At most 1000 foes, 32 tags (1..40 chars), 16 lore lines per policy.
// Consumed view of director.threads with proposed additive rpg extension.
// Preserve their other existing fields; this is not a replacement wire shape.
type ThreadProjection = {id:Id; key:Text120; kind:string; summary:Text600;
  fields:Record<string,string>; status:'active'|'resolved'; offer:boolean;
  taken:{rev:Count}|null; ended:{rev:Count; reason:string; outcome:string}|null;
  acceptance?:{source:Source;cursor:Cursor;minute:Minute|null;proof:RecordId}|null; rpg?:Quest};
// journal.day({day:Day,snapshot?:Id}); at most 12 visible lines
type JournalDay = {day:Day; title:Text80; lines:Text240[];
  source:'digest'|'facts'|'snapshot'; missing:boolean};
// rules.modifier({actor:Id,stat:Stat,skill?:Text80,craft?:{recipe:Ref,at?:'campfire'}}); no die, no relationship bonus
type RulesModifier = {actor:Id; stat:Stat; amount:Int<-30,30>;
  parts:{source:'stat'|'skill'|'talent'|'item'|'effect'|'encumbrance'|'rank'|'station'|'materials'|'cap'; ref:Id|null; reason:Text120; amount:Int<-30,30>}[]};
type SkillView = {skill:Ref; form:Ref; name:Text80; mastery:Int<0,5>;
  uses:Int<0,35>; nextAt:Int<1,35>|null; steps:Int<0,2>; formMastery:Record<Ref,{uses:Count; mastery:Int<0,5>}>};
type SheetView = {id:Id; name:Text80; role:Text80; portrait:string|null; background:Text2000; origin:OriginView; kind:'pc'|'companion'|'summon'|'pet'; npcId:RecordId|null;
  level:Int<1,99>; xp:Count; xpToNext:Count|null; stats:Stats; unspent:Int<-1000000,1000000>;
  hp:PoolView; mp:PoolView; sp:PoolView; life:'alive'|'downed'|'gravely-injured'|'dead'; conditions:ConditionView[];
  class:Ref; tier:0|1|2|3; skills:[SkillView,SkillView,SkillView];
  gear:Record<Slot,Id|null>; control:'player'|'auto'};
type PartyView = {pc:Id|null; active:SheetView[]; reserve:SheetView[];
  temporary:SheetView[]; activeLimit:3};
type ProgressView = {actor:Id; level:Int<1,99>; class:Ref; tier:0|1|2|3;
  checklist:{skill:Ref; form:Ref; mastery:Int<0,5>; needed:5}[];
  promotions:{milestone:10|20|30; eligible:boolean; choices:Ref[]; why:Text240[]}[];
  pathways:{milestone:40|50|60|70|80|90; eligible:boolean;
    skills:{skill:Ref; fromForm:Ref; step:1|2; options:[Ref,Ref,Ref]}[]; why:Text240[]}[]};
type QuestView = Quest & {ready:boolean; blocked:Text240[]; remainingMinutes:Count|null};
// rules.sheet({actor?:Id}) -> SheetView|null; default PC.
// rules.party({}) -> PartyView; rules.quests({state?:Quest['state']}) -> QuestView[].
// rules.progress({actor?:Id}) -> ProgressView|null.
```

Approved (USER, §12): **P23 — SD thread writers and neutral acceptance.** SD owns
`director.threads`, `director.keys` and a new `director.writes` retry ledger. RB never drafts
them. `ThreadKind` is the shipped agenda/event/hook/quest/clock/beat/secret union (SD
tracker/convert.js:18). Generic goals may use hook; a thread with `rpg` is selected by that
extension, regardless of kind. No second quest ID/store is introduced.

All five new writers take `write:RecordId`, allocated and persisted by the host before dispatch.
The ledger retains `{fingerprint:Hash,result:Json}` for the normalized command type/payload
excluding write. Same write and fingerprint returns the saved result **before** stale checks;
reuse with changed meaning is CONFLICT. Replay restores the ledger with the thread. A new write
uses optimistic comparison against `director.thread`'s canonical public projection, including
rpg/rev and excluding only private track. Hash is SHA-256 of normalized JSON with sorted object
keys and preserved array order. New `threads.hash({thread:RecordId}) -> Hash|null` supplies it.
No writer accepts caller-selected rev/taken stamp, payout ops or private track. fields accepts
only the retained genre-neutral SD fields; reward/target/met mechanics are not generic edits.

| New SD writer payload (all include write) | Issuer → result; behavior / failures |
|---|---|
| `threads.offer {thread:RecordId,kind:ThreadKind,key:Text120,summary:Text600,fields:Record<string,string>,expectedHash:null,quest?:Quest}` (`quest` only from RB: see the note under this table) | SD capture/system or nested RB repeat/chain offer → `{thread,hash}`. SD inserts fresh th_ ID, key index, active/offer:true, taken/ended/target/reward:null, acceptance:null, host rev/order; optional quest must have id=thread and state offered. Unknown fields INVALID, occupied ID/key CONFLICT, thread limits LIMITED. |
| `threads.accept {thread:RecordId,expectedHash:Hash,acceptance?:RecordId,quest?:Quest}` (`quest` only from RB) | Player UI command (including templates/tests), SD validated player-intent capture, or nested RB quest.take inheriting that authority → `{thread,hash,accepted:true,linked:boolean}`. Atomically clears offer, stamps taken/rev and acceptance Source/cursor/minute/proof, optionally installs active Quest with matching id and acceptance cursor/minute. No separate link call after acceptance. |
| `threads.link {thread:RecordId,quest:Quest,expectedHash:Hash}` | Nested RB only → `{thread,instance,hash}`. Only an already accepted, active generic thread without rpg; quest must be active and inherit its original acceptance cursor/minute. An unaccepted offer uses accept instead. |
| `threads.questWrite {thread:RecordId,quest:Quest,expectedHash:Hash}` | Nested RB only → `{thread,instance,hash}`. Replaces only the existing extension, preserving id/template/instance; outer target/reward/ready/owed become compatibility projections, never independently editable payouts. |
| `threads.close {thread:RecordId,expectedHash:Hash,instance:Int<1,1000000>,outcome:'done'\|'failed'\|'expired'\|'abandoned',reason:Text240,settlement:RecordId}` | Nested RB only → `{thread,instance,outcome,settlement,hash}`. Requires matching terminal rpg settlement in the shared transaction; resolves outer thread, stamps ended/rev and appends one outcome journal entry. expired maps to outer failed; rpg/journal retain expired. |

For existing-thread writes: unknown thread NOT_FOUND, stale expectedHash STALE, terminal or
ineligible transition REFUSED, changed extension/settlement identity CONFLICT. SD validates
closed extension shape, references and caller; RB computes RPG requirements/rewards. All changes,
SB wallet/stack calls, XP and journal writes commit in one root transaction or none. Identical
semantic terminal closure with the same settlement is also a no-op; another outcome conflicts.
Repeat/chain offers allocate a **fresh** th_ ID/write and may reuse a display key only after its
previous thread is terminal; the key index then points to the new thread and old IDs remain queryable.

Neutral acceptance works with **SB+SD alone**: player `threads.accept` or SD's typed-intent
adapter accepts an offered hook/goal without reading party/rules/quest APIs. It writes no rpg,
target/reward/owed remain null, and generic SD progress/closure/journal continue. No new quest
buttons: story-only acceptance remains the ordinary quest flow; commands remain for templates/tests.
Quest extensions: on threads.offer and threads.accept, `quest` is allowed only when `ctx.caller === 'rpg-battle'` and RB
is ready; otherwise the command is REFUSED before any mutation. SD capture/system and player-UI callers send neutral
payloads or delegate to RB's quest.take. Tests (track E/A): a forged `quest` from SD capture, from the UI and from a
third module is refused with RB ready and with RB absent; RB's own quest.take still links.

Story cause alone is insufficient: SD records an active `acceptance` proof bound to this thread
and the reader's explicit words (ctx.chat.lastUser / active history); accept verifies that proof.
UI acceptance publishes proof of the selected player action; story acceptance proves the reader's
explicit words. Narration cannot create it. Upgrading an accepted thread retains that proof/cursor;
without surviving acceptance evidence, hold REFUSED rather than invent a start time.
With ready RB, its player-intent adapter calls quest.take → threads.accept with the computed
Quest. On a thread already carrying rpg, accept requires RB's matching active Quest; otherwise
REFUSED (DEPENDENCY_UNAVAILABLE if RB dormant). Without rpg, accept without quest remains
a neutral acceptance for later upgrade.
SD generic edits preserve rpg and route terminal RPG transitions through RB; dormant RB holds
those transitions DEPENDENCY_UNAVAILABLE while neutral threads keep working.

`journal.day` works independently of digest/journal UI switches. Filter hidden facts, then use
visible digest, visible facts, then saved visible scene. Missing day returns `missing:true`,
title `Day <day>`, saved-scene line or `[]`; no hidden-event recap. Current digest queries can
return null when disabled (SD `chronicle/queries.js:13`), so this adapter is new work.

Approved (USER, §12): **P09 — independent checks.** Transfer the checks domain,
check capture and shipped check interfaces to SD. Merely moving files is insufficient: RB
checks/commands.js:106 requires party.actor/pc, and checks/modifiers.js:5 includes topic
skills/talents/items, effects and burden. SD gets its own settings and new state
`checks.policy:{actors:Record<Id,{id:Id,name:Text80,bonuses:Record<string,Int<-30,30>>}>,
defaultActor:Id|null,rbActors:Record<Id,ActorId>}`.
Initialize maps empty/default null. Effective rbModifiers/social come from SD settings (default true), not duplicated stored booleans. Existing checks interfaces transfer once;
new `checks.policy({}) -> {actors,defaultActor,rbActors,rbModifiers,social,hash:Hash}` is read-only.
Hash covers the projected policy including effective settings, excluding hash itself.
SD adds checks.writes/atlas.writes ledgers initialized {}; those retry records are excluded
from policy hashes. With no SD actor/default, checks.roll returns NOT_FOUND and SD offers
neutral actor creation; this never becomes an RB dependency. All new policy writes require player UI
or the explicitly allowed creation caller, never narration-selected links/bonuses.

Approved (USER, §12): **P24 — populate identities and rule inputs through their owners.**
These are new APIs, not reinterpretations of shipped payloads. Mutating entries below use the
same host-persisted write/fingerprint retry rule as P23, in their owner's ledger; no-op retries
precede hash checks. Unknown fields INVALID, unknown refs NOT_FOUND, wrong issuer REFUSED,
stale expectedHash STALE, changed immutable identity/definition CONFLICT. Returned hashes come
from the same normalized projection used for comparison. No query assigns IDs or edits state.

| New SD check writer | Issuer → result; contract |
|---|---|
| `checks.actor {write:RecordId,id?:RecordId,name:Text80,bonuses?:Record<string,Int<-30,30>>,makeDefault?:boolean,expectedHash:Hash}` | Player UI; nested RB creation may create a missing actor only → `{actor:RecordId,hash:Hash}`. Allocate ca_ when id omitted; bonuses default {}, makeDefault false, first actor becomes default. Editing preserves rbActors. |
| `checks.link {write:RecordId,actor:RecordId,rbActor:ActorId\|null,expectedHash:Hash}` | Player UI or nested RB creation.finish/creation.import → `{actor,rbActor,hash}`. Non-null target must resolve via ready RB rules.sheet; require PC or durable companion, and a one-to-one SD↔RB link. null explicitly unlinks. No same-name inference. |

Creation.finish/import gains optional `checkActor:RecordId`. Within the creation transaction,
use that actor, else the existing SD default, else create an SD actor and default it; link the
new PC via checks.link. Preserve standalone names/bonuses. An already-linked different PC is
CONFLICT and rolls back creation, rather than silently relinking. The UI may choose another
actor. Companions are linked explicitly through checks.link; recruitment does not guess.
RB removal leaves a stale link retained for replay; the resolver uses standalone bonuses when
the linked actor no longer resolves. RB absent/dormant/off also falls back; reactivation uses
the saved link. Query throws/null/malformed answers contribute no RB subtotal and record the
fallback reason; do not read party state as a substitute.
`checks.roll.targetNpc` resolves through npc.identity({id}) to its current name before the
single npc.socialModifier call; unknown identity is NOT_FOUND, optional NSD absent/off adds zero.

SD checks.roll resolves SD actor/default, optional explicit rbActors link and one
rules.modifier({actor,stat,skill}) projection. Retain RPG base-stat modifier plus topic skill+2,
talent+1, one item+1, extras together cap+3, effects cap±3, burden−2 outside caps. Do not add
gear stat modifiers again. Standalone SD policy bonuses apply when RB supplies no modifier;
never sum two stat bases. SD combines at most one NSD npc.socialModifier({name,skill}) result
`{mod,name,skill,reasons:[{text,value}]}` or null (NSD src/storysuite-v2.js:524); no target,
missing/off social or absent RB contributes zero. Do not also gather old checkModifiers.
Standalone bonus = bonuses[resolvedStat] (default0) plus each distinct matching
`topic:<name>` bonus once, using the transferred topic table; no implicit item/talent/party read.
Resolve explicit stat first, else transferred statForCheck(skill) (unknown→LUK). With a valid RB
link/projection, replace that entire standalone subtotal with RB parts. Add one optional NSD
part, clamp final modifier to −30..30 and append a policy-cap adjustment part if clamped, so
recorded parts sum exactly to mod. SD settings defaultDc:15 (range1..40), costMargin:2 (0..5),
rbModifiers:true and social:true are SD-owned; no RB settings lookup. checks.roll dc omitted
uses defaultDc. One SD d20: natural20 crit, natural1 critfail, else total>=dc success,
>=dc−costMargin cost, else fail.

Stage 5 lead decisions: SD alone registers `checks` and captures `? check`. The narrator omits
`| result:`; old labels are ignored without flags or Problems. Check outcomes appear in receipts
and the next tail, with no status-card check rows. RB crafting calls SD `checks.roll` with the
recipe context (only RB may supply `craft`), recipe DC and linked actor. `rules.modifier` returns
the recipe stat-modifier sum, craft rank, tools, station and material quality; SD rolls once and
RB decides the existing quality bands. No RB table or supplied die. A check using a held RB
skill records one practice attempt through internal `rules.practiceCheck`, success or failure;
stat-only checks count nothing. The existing two-per-skill/six-per-reply/thirty-per-day caps and
unset-clock behavior apply. The attempt shares the check transaction and retracts with a
Re-read, swipe or deletion. Guards read state, declared replay queries, story.evidence and
recorded external facts according to the replay rule.

New/extended payloads. Optional fields have the stated default. Refuse unknown fields. Retain
shipped payload variants through adapters; see appendix. In particular, `party.spend` still
accepts its existing points map, and `party.edit` retains its existing non-progression fields.

```ts
type Commands = {
  'class.choose':{actor:Id; milestone:10|20|30; class:Ref; expectedClass:Ref; rulesHash:Hash};
  'path.choose':{actor:Id; milestone:40|50|60|70|80|90; skill:Ref; fromForm:Ref; option:Ref; rulesHash:Hash};
  'skill.train':{actor:Id; skill:Ref; form:Ref; trainer:Ref|Id; session:Id}; // 2.4.0: trainer is a pack trainer's Ref, or an open trainer offer's tn_ Id
  'trainer.open':{name:Text80; template:Ref; text?:Text240; skills?:Ref[]}; // 2.4.0: reader action; the offer's fee is rolled, never sent
  'party.spend':{actor?:Id; points:Partial<Record<Stat,Int<0,99>>>}; // shipped map retained
  'quest.take':{id?:Id; key?:Text120}; // same SD thread, not a second RB offer store
  'quest.abandon':{id?:Id; key?:Text120};
  'quest.finish':{id?:Id; key?:Text120; by?:'story'}; // omitted by = player; story trusted only
  'party.addCompanion':{name:Text80; class?:Ref; offer?:Id}; // additive fields; all shipped fields retained by adapter
  'party.removeCompanion':{actor:Id};
  'party.edit':{actor:Id; control?:'player'|'auto'; name?:Text80; role?:Text80; npc?:string; portrait?:string|null; growth?:'manual'};
  'party.setActive':{actors:Id[]}; // new, 1..3 durable actors, includes PC, no active fight
  'party.summon':{owner:ActorId; template:Ref; fight:Id}; // trusted paid form/pet event only
  'summon.end':{actor:Id; reason:'expired'|'dismissed'|'downed'|'fight-ended'};
  'death.resolve':{event:Id}; // never caller-selected outcome or snapshot
  'checks.roll':{actor?:Id; stat?:Stat; skill:Text80; targetNpc?:Id; dc?:Int<1,40>; evidence:Id; craft?:{recipe:Ref;at?:'campfire'}};
  'rules.settle':{boundary:Source}; // trusted rule boundary; internals in track B
  'item.equip':{stack:Id; to?:Id; actor?:Id; targetSlot?:Slot}; // slot is the only new field
  'savepoint.make':{name?:Text80}; // default "Save point", player only
  'savepoint.restore':{snapshot:Id; deathEvent:Id; prepared:Id}; // authenticated host/RB only
};
```

`creation.finish` gains required player-selected `class:Ref`. It atomically creates the actor
and records the milestone-0 Choice with its three base skills. A standalone class.choose cannot
create an actor or choose the basic class on someone's behalf. Preserve existing creation fields.

`savepoint.list({}) -> Snapshot[]` returns eligible points in target order. `items.slots({actor?})`
adds `{slots:[{key:Slot,label:Text80,blockedBy:Id|null}]}` in the fixed eight-slot order, retaining
compatibility counts `{accessory:2,worn:4}`. `items.canWear` accepts new `targetSlot?:Slot` and
keeps `{ok,why?}`. Neither query writes equipment.

Training completion, use credit, expiry and daily saves are trusted hook steps, not UI buttons.
The rules.training view and its internal request/session records are a B3 handoff to C.
2.4.0 additions to the queries: `training.openTemplates({})` lists a pinned pack's open trainer templates in pack
order (`{id,name,rank,fee:{coinMin,coinMax},skills:[{id,name}]}`); `training.trainers({})` returns
`{fixed,story}`, the pack's fixed trainers and the offers made in the chat. `rules.training` rows gain
`open:boolean` and `where:string|null`.
Path option arrays are ordered [g,a,b].
New capture payloads, with host-supplied Source: skill-use `{actor:Id,skill:Ref,form:Ref}`;
lethal `{actor:Id,cause:"narrative"|"execution",evidence:Id[]}`; intervention
`{event:Id,evidence:Id}`. Capture may propose evidence, never a death outcome, class/path choice
or numeric mastery. New grammars are
`! skill-use <actor ID> | skill: <def ID> | form: <def ID>`,
`! lethal <actor ID> | cause: narrative|execution | evidence: <comma-separated IDs>`,
`! intervention <event ID> | evidence: <ID>`. Active visible proofs must resolve through
story.evidence; invalid/ambiguous references are REFUSED. Paid use/rescue validation and
training records are [B3/B6](RB_TRACK_B_DESIGN.md); capture never chooses death/return outcomes.
`party.addCompanion` accepts the existing payload, but resolves its v2 class from the accepted
recruitment offer when omitted; old free-form skill grants cannot bypass the three-skill rule.
The lead removes SD quest registrations before RB registers their retained names.

Approved (USER, §12): **P14 — currency and money policy.** `purse.currency({})` returns
`Currency|null`. SB validates and gives an enabled RB override precedence, then falls back to
its existing settings/pack/default resolver. Invalid RB data blocks RB money mutations while
SB fallback display remains usable. RB settings override pack currency in its resolved policy.
Keep one integer base-unit balance; never convert it when display changes. SB formats coins.
The RB query reads its frozen policy, never inventory.currency, avoiding resolver recursion.
New RB `rules.moneyPolicy({level}) -> {storyCreditCap:Count,storyDebitCap:Count}` supplies
RPG caps to SB's capture/tally code. Proposed caps both default to
`max(1,round(1000*level*inventory.economy().scale))`, preserving the current level fallback
(SB `inventory.js:1193`, `:1227`, `:1251`). Missing RB keeps SB-alone behavior. Explicit pack prices,
fees and rewards are already base units; do not scale twice.

New SD identity/catalog state extends atlas with `regions:Record<RecordId,Region>`,
`placeRegions:Record<Id,RecordId>` and `placeRefs:Record<RecordId,Id>` (all initially {}).
`Region={id:RecordId,name:Text80,aliases:Text80[]}`; region IDs use rg_, never display text.
`atlas.policy({}) -> {regions:Region[],placeRegions:Record<Id,RecordId>,placeRefs:Record<RecordId,Id>,danger,hash:Hash}`
is the read-only, region-ID-sorted policy projection; hash covers those fields except hash.
Display `place.region` remains text; it never silently changes policy membership.

| New SD place/region seam | Issuer → result; contract |
|---|---|
| `atlas.region {write:RecordId,id?:RecordId,name:Text80,aliases?:Text80[],expectedHash:Hash}` | Player settings UI → `{region:RecordId,hash:Hash}`. Create rg_ or rename known ID; aliases default [], max16; unique normalized names/aliases, collision CONFLICT. No implicit creation from story region text. |
| `atlas.placeRegion {write:RecordId,place:Id,region:RecordId\|null,expectedHash:Hash}` | Player settings UI → `{place:Id,region:RecordId\|null,hash:Hash}`. Resolve canonical place and known region; null removes membership. Pack labels may suggest a selection, never assign one by text. |
| `atlas.dangerSet {write:RecordId,scope:'world'\|'region'\|'place',key:Id\|null,policy:AreaPolicy\|null,expectedHash:Hash}` | Player settings UI → `{scope,key,hash:Hash}`. World key=null, region key known rg_, place key canonical; null removes override. Does not also change membership. |
| `atlas.canonical({id?:string,name?:Text80})` | Read-only → `{id:Id,name:Text80,atlasId:RecordId\|null,regionId:RecordId\|null,source:'pack'\|'atlas'}\|null`. id wins, omitted both means current scene; unknown/ambiguous ref returns null. |

Canonical resolution inspects every pack candidate before name de-duplication (today SD atlas/world.js:49 drops
duplicates); test: two packs sharing a place name resolve to two distinct canonical ids.
For pack places, canonical id is the normalized content.places definition ID **before and
after materialization**. SD packWorld must retain SB's id (today it drops it), and ensurePlace
records pl_→pack.<id>/<slug> in placeRefs on visit/edit/landmark/route creation. Non-pack places
use their pl_ ID, mapped to itself. Existing atlas.place/here/map keep their shipped node IDs,
including `pack:<key>`; only the additive canonical query is used by RB's area/shop/trainer/
quest/save seams. Resolve node/name aliases to a unique content ID, never turn `pack:<key>`
into a guessed slug. If an existing own place matches multiple packs, hold CONFLICT until an
explicit player `atlas.placeBind {write,place:RecordId,definition:Ref,expectedHash:Hash}`
selects its content.places ID; result `{place,definition,hash}`. Include placeRefs in policy/hash.
Binding requires a known pl_ and unique target (not already bound elsewhere), cannot change a
previously established canonical identity, and is refused with CONFLICT on mismatch. Renames
preserve identity. Pack deletion leaves the saved mapping and policy IDs intact; unresolved
content holds dependent generation. Dangling region membership is invalid. No region-delete API.
world.areaTier({place:Id}) uses this canonical resolver, then place→region→world policy; it never
uses string region labels. See the appendix for unchanged atlas.visit/edit signatures.

Current SB pack projection/grant omit hands/requires/weight (packs/content.js:12;
domains/inventory.js:450). New `rules.item({def:Ref}) -> ItemRule|null` reads the pinned RB rule.
`inventory.definitions({ids?:Ref[]}) -> ItemDef[]` returns complete immutable SB definitions,
default all, ID-sorted; unknown omitted, malformed args []. RB activation registers the frozen
pack ItemDefs as well as generated ones, so this query never depends on current pack installation.
It reads committed definitions and transaction-local drafts, without materializing them on lookup.

| New item/flag seam | Issuer → result; contract |
|---|---|
| SB `inventory.registerDefinition {write:RecordId,def:ItemDef,hash:Hash}` | Nested ready RB registration only → `{def:Ref,hash:Hash,created:boolean}`. Hash must equal the normalized complete def. Register without granting a stack; same id/bytes no-op, changed bytes CONFLICT. SB validates its owned shape, RB validates RPG semantics. |
| RB `rules.registerItem {write:RecordId,def:ItemDef,rule:ItemRule,template:Ref,area:AreaTier,rulesHash:Hash}` | Trusted SB item capture or RB craft/trade/loot adapter → `{def:Ref,hash:Hash,ruleHash:Hash,created:boolean}`. Resolve immutable source template, current canonical area and frozen rules hash; recompute bounds, never trust caller numeric approval. Store frozen def/rule/provenance and nested-call inventory.registerDefinition atomically with grant/buy/craft; failed validation/spend/grant rolls all back. |
| RB `rules.flags({keys?:Text80[]})` | Read-only → `{values:Record<string,boolean>,hash:Hash}`; default all declared flags, unknown keys omitted, malformed args null. Hash covers the entire declared flag map. |
| RB `rules.flagSet {write:RecordId,key:Text80,value:boolean,evidence:RecordId,expectedHash:Hash}` | Trusted SD event adapter or RB rule event only → `{key,value,hash:Hash}`. Declared key and active code-validated event must authorize exactly this transition. No arbitrary story/UI flag setting. Evidence is consumed once with the flag write; deleted proof deactivates both. |

Pack activation registers defs from the frozen ruleset via inventory.registerDefinition.
Runtime items keep story/<slug>, craft/<slug> or craft/<order-suffix>, trade/<slug>[-rarity-l<level>]
IDs already used by their adapters. rules.registerItem is the single generated registration
route, including SB narrative grants while RB is ready. Existing inventory.grant full-def paths
must refuse conflicting definitions and route unknown RPG content through that validation; the
existing item.define mutation hook alone is insufficient. Registration never infers rules from
a name; split/merge/restore preserve IDs. Missing source template, flag transition, area or
budget holds REFUSED/RULES_MISMATCH. Generated foe/quest storage, frozen origins/events,
requirements, proof payloads and generation clamps belong to [B3](RB_TRACK_B_DESIGN.md),
which must finish their schemas/shared checker before B merges.

Under P07, new read-only RB `rules.equipPlan({stack:RecordId,actor:ActorId,targetSlot?:Slot})`
returns `{ok:true,plan:{actor,stack,def:Ref,slot:Slot,unequip:RecordId[],
move:{stack:RecordId,from:Owner,to:Owner}[],rulesHash:Hash,inputHash:Hash}}` or Failure.
`inputHash` covers normalized rulesHash, actor base stats/life, requested slot, selected stack
and every affected owner/equipped-slot record. SB queries this once inside its transaction,
checks those inputs and all stack/slot/ownership refs, then holds the validated plan privately
and applies it to its own draft. Caller payloads cannot supply a trusted plan/token/bypass flag.
RB item.equip calls SB inventory.equipOn (additive targetSlot); SB inventory.equip/equipOn and
item capture invoke the same planner without recursively calling item.equip. A direct equip
uses the stack's durable actor owner; party-bag pieces require equipOn with an explicit actor.
Without ready RB, retain SB's existing storage behavior and hide RPG equipment UI. With ready
RB, absent/malformed/refused plan fails closed; atomically transfer/equip/clear displaced slots.
Existing command result keys stay intact; new targetSlot is additive.

Receipt/error wire shapes retain the bus envelope (SB `src/v2/commands.js:467`, `:473`). The
`v2` data extension and §6 guards are new. Critical metadata must survive display-data trimming
(SB persist.js:268; preservation is new track E work). New result fields are required exactly as listed per entry; omitted optional fields stay omitted.

```ts
type ErrorCode = 'INVALID'|'REFUSED'|'NOT_FOUND'|'NOT_ENOUGH'|'CLAIMED'|'STALE'|
  'FEATURE_OFF'|'LIMITED'|'FAILED'|'NOT_OWNER'|'UNSUPPORTED'|'UNKNOWN_COMMAND'|'DEPENDENCY_UNAVAILABLE'|'CLOCK_UNSET'|
  'RULES_MISMATCH'|'CONFLICT'|'SNAPSHOT_UNAVAILABLE'|'RESTORE_PENDING'|'REPLAY_PREREQUISITE';
type Failure = {ok:false; code:ErrorCode; message:string};
type ResultData = {[key:string]:Json}; // exact closed per-entry shape in §3 tables, not arbitrary extension keys
type Receipt = {id:Id; type:string; module:string; cause:'ui'|'story'|'system';
  seed:Int<0,4294967295>; summary:string; narrate:boolean; rev:Count;
  data:{v2?:{schema:2; key:string; epoch:Id; source:Source; rulesHash:Hash|null;
    guard:Guard; evidence?:Proof[]; result:ResultData}}; afterCapture?:true; replan?:{payload:object; line?:object}};
type Success = {ok:true; receipt:Receipt};
```

Existing data stays alongside v2. New mechanics require v2. Retry uses the same persisted
action ID and returns the original result; failures apply no partial payout/spend/claim.
The shipped receipt has replan:{payload,line?} and sibling afterCapture:true (SB commands.js:467,
turn.js:720; neither has the review's nested afterCapture shape).

| New entry | Allowed issuer; receipt.data.v2.result | Extra refusal |
|---|---|---|
| class.choose / path.choose | Player UI only, no module caller; `{actor,milestone,previous,selected,skills?:[Ref,Ref,Ref]}` | REFUSED ineligible; STALE expected class/form; invalid replay REPLAY_PREREQUISITE. |
| skill.train | Player request; `{session,status:'requested'}` | REFUSED running/pending session, unknown trainer NOT_FOUND. No fee/time at UI. 2.4.0: `trainer` may be an open trainer offer's `tn_` Id; a template's Ref is NOT_FOUND. |
| trainer.open | Player UI only, no module caller (2.4.0); `{trainer:Id,fee,place}` | REFUSED not a reader action; INVALID unknown payload field; NOT_FOUND person not present; the template and offer refusals of OPEN_TRAINERS_SPEC §4.2. |
| rules.settle | Host system only; `{started:Id[],completed:Id[],expired:Id[],credited:Id[]}` | Replan=true; CLOCK_UNSET when required; atomic time/fee; no duplicate boundary. |
| party.setActive | Player outside combat; `{actors,reserve}` | REFUSED >3, lacks PC, duplicate/dead/temporary actor or active fight. |
| party.summon | Authenticated paid form/pet event; `{actor,fight,template}` | REFUSED limit6 or wrong owner/fight; no arbitrary stat/class payload. |
| summon.end | Host/RB rule; player owner may dismiss only; `{actor,reason}` | REFUSED durable actor/wrong reason/caller; identical dismissal returns prior result. |
| checks.roll | SD capture/precheck/system; RB recipe crafting only; `{check,actor,die,modifiers,mod,total,dc,outcome}` | NOT_FOUND unknown actor/evidence; REFUSED inactive/used evidence; no supplied die/outcome. |
| death.resolve | RB/host system only; `{event,batch,outcome,snapshot:Id\|null}` | REFUSED unsealed/invalid evidence; no caller-picked outcome/target; native protocol §8. |
| savepoint.make / restore | Player asynchronous host adapter / authenticated coordinator; `{snapshot}` / `{return,status:'committed'}` | SNAPSHOT_UNAVAILABLE missing bytes/participant; STALE prepared head; RESTORE_PENDING barrier. |
| return.cue v2 | Host complete-token only; `{return,cue}` | REFUSED before complete; same wake idempotent, conflicting cue CONFLICT. Legacy payload only in legacy runtime. |

Common failures: INVALID bad/unknown fields, NOT_FOUND unknown IDs, REFUSED authority/eligibility,
DEPENDENCY_UNAVAILABLE, CLOCK_UNSET, RULES_MISMATCH, STALE, RESTORE_PENDING. All singular new
queries return null on unknown references; lists []. New types such as Clock, AreaTier,
JournalDay, PoolView and SkillView are projections, not changes to shipped query results.

## 4. Boundary data and identity

P16 retains public pools `{cur,max}`; P17 keeps the Quest extension in SD's single thread store;
P18 retains party.grantXp variants. These projections and cross-owner records are the contract.
Private Actor/Progress/Training/Death storage, requirement evaluation and combat records are
[track B items 3–6](RB_TRACK_B_DESIGN.md), with validators/tests due before B merges.

`Int<L,H>` is a safe inclusive integer; Count is nonnegative safe integer. Detect overflow.
Required fields have no guessed defaults. All domain initializers return objects; initialization
never resets existing slices. Hash means SHA-256 of normalized JSON, sorted keys, array order
preserved. Record IDs and definition IDs keep SB's exact regexes (src/v2/check.js:7/:9).

```ts
type RecordId = string; // /^[a-z][a-z0-9]*_[0-9a-z]{8}$/
type DefId = string; // /^[a-z0-9]+(?:[._-][a-z0-9]+)*\/[a-z0-9]+(?:[_-][a-z0-9]+)*$/
type Id = RecordId|DefId; type Ref = DefId;
type ActorId = string; // /^ac_[0-9a-z]{8}$/
type Owner = 'party'|ActorId;
type Count = Int<0,9007199254740991>;
type Json = null|boolean|number|string|Json[]|{[key:string]:Json};
type Hash = string; // 64 lowercase hex characters
type Errors = {ok:false;errors:{code:string;path:string;message:string}[]};
type Text80 = string; type Text120 = string; type Text240 = string; type Text600 = string; type Text2000 = string;
// Text aliases: plain Unicode, 0..suffix code points, no controls/markup; names nonempty.
type Minute = Int<-9007199254740991,9007199254740991>;
type Day = Int<-6254999482460,6254999482459>; // floor(minutes/1440)
type Stat = 'STR'|'VIT'|'AGI'|'DEX'|'INT'|'LUK'|'CHA';
type Stats = Record<Stat,Int<1,99>>;
type Slot = 'weapon'|'offhand'|'head'|'body'|'legs'|'feet'|'accessory-1'|'accessory-2';
type Rarity = 'common'|'uncommon'|'rare'|'epic'|'legendary';
type OriginView = {race:{id:Ref;name:Text80}|null;talents:{id:Ref;name:Text80}[]};
type PoolView = {cur:Count;max:Count};
type ConditionKind = 'poison'|'burn'|'bleed'|'stun'|'daze'|'slow'|'weaken'|'shield'|'regen'|'guard'|'injury'|'stat-shift';
type ConditionView = {kind:ConditionKind;stacks:Count;rounds?:Count;at?:Minute};
type Currency = {name:string;plural:string;short:string;
  coins:{name:string;plural:string;value:Int<1,1000000>}[];display:'mixed'|'base'};
// name/plural 1..24, short 1..6; 0..8 coins, unique case-folded names.
// P14: nonempty coin table includes value1; values are base units, not ratios.
type Constants = {
  levelCap:99;startLevel:1;startStat:5;startPoints:10;pointsPerLevel:4;statCap:99;
  xpPerLevel:Int<10,10000>; // divisible by10, default100
  masteryAt:[1,5,12,22,35];usePerSkillReply:2;usePerSkillDay:10;
  usePerActorReply:6;usePerActorDay:30;trainMinutes:60;trainCredits:2;trainEventPercent:10;
  promotionMilestones:[10,20,30];pathMilestones:[40,50,60,70,80,90];
  classBudget:[12,24,36,48];pathBudgetIncrement:12;
  deathDc:15;injuryMinutes:1440;injuryCheckPenalty:-2;temporaryLimit:6;
  promptChars:Int<500,8000>;difficulty:'normal';clockMinutesPerDay:1440;
}; // approved defaults P02/P03/P06/P10/P11/P15/P19 (§12; P11 combat-only)
type RulesIdentity = {packKey:string;packVersion:string;packHash:Hash;
  schema:2;engine:'rb-rules-2';constantsHash:Hash};
type Source = {sid:RecordId;swipeKey:RecordId;evidence:RecordId;ordinal:Int<0,1000000>};
// Host transport; predicate/recorded payload schemas belong to the registered owner.
type Guard = {owner:string;version:2;epoch:RecordId;rulesHash:Hash|null;inputHash:Hash;predicate:Json};
type Proof = {id:RecordId;source:Source;owner:string;
  kind:'kill'|'visit'|'story'|'rescue'|'use'|'acceptance'|'event';payload:Json;payloadHash:Hash;parents:RecordId[]};
type Requirement = {kind:'class'; classes:Ref[]}|{kind:'flag'; key:string; value:boolean}|{kind:'level'; min:Int<1,99>}|{kind:'stat'; stat:Stat; min:Int<1,99>}|
  {kind:'quest'; template:Ref}|{kind:'item'; def:Ref; qty:Int<1,999>}|
  {kind:'place'; place:Id}|{kind:'thread'; thread:Id};
type Objective = {id:Id; kind:'kill'; foe:Ref; count:Int<1,999>}|
  {id:Id; kind:'collect'; def:Ref; count:Int<1,999>; consume:boolean}|
  {id:Id; kind:'visit'; place:Id}|{id:Id; kind:'story'; text:Text240};
type Reward = {coin:Count; xp:Count; items:{def:Ref; qty:Int<1,999>}[]};
type Quest = {id:Id; template:Ref; instance:Int<1,1000000>; title:Text80;
  category:'main'|'side'|'bounty'; giver:Id|null; turnInPlace:Id|null;
  requirements:Requirement[]; objectives:Objective[];
  evidence:Record<RecordId,{objective:Id; proof:RecordId; amount:Int<0,999>}>; reward:Reward;
  storyCredit:{coin:Count; claims:string[]};
  acceptedAt:Minute|null; acceptedCursor:Cursor|null; deadline:Minute|null;
  repeat:null|{cooldownMinutes:Int<0,525600>; nextOfferAt:Minute|null};
  chain:null|{previous:Ref|null; next:Ref|null};
  state:'offered'|'active'|'done'|'failed'|'expired'|'abandoned';
  settlement:null|{id:Id; source:Source; outcome:'done'|'failed'|'expired'|'abandoned';
    coinPaid:Count; xpPaid:Count; itemsPaid:{def:Ref; qty:Int<1,999>}[]; claim:string}};
// Quest lives only at director.threads[Quest.id].rpg; no QuestsDomain or second quest ID.
type Cursor = {sid:RecordId; swipeKey:RecordId; block:RecordId; op:Count; rev:Count};
type Participant = {module:string; checkpoint:Id; hash:Hash; schema:Count};
type Snapshot = {capturedAtRev:Count; label:Text80; id:Id; kind:'initial'|'manual'|'day-start'; name:Text80; epoch:Id;
  target:Cursor; eligibleFrom:Cursor; minute:Minute|null; day:Day|null;
  scene:{place:Id|null; text:Text240}; journal:JournalDay|null;
  payloadHash:Hash; participants:Participant[]; lineage:Hash; available:boolean};
type ReturnRecord = {id:Id; deathEvents:Id[]; batchResult:{id:RecordId;hash:Hash}; snapshot:Id; target:Cursor; restoreAt:Cursor;
  oldEpoch:Id; newEpoch:Id; faded:{after:Cursor; through:Cursor};
  memory:'deja-vu'|'none'|'full'; cue:Id;
  status:'prepared'|'committed'|'participants-pending'|'complete'};
type SavepointsDomain = {schema:2; epoch:Id; points:Record<Id,Snapshot>;
  dayStarts:Record<string,Id>; previousDay:Id|null; returns:Record<Id,ReturnRecord>};
// initial new epoch, empty maps, previousDay:null; immutable payloads in SB snapshot store.
type ItemDef = {id:Ref; name:Text80; kind:'goods'|'material'|'consumable'|'equipment'|'quest'|'money';
  rarity:Rarity; value:Count; stack:boolean; slot:string|null; stats:Record<string,number>;
  effect:Record<string,Json>; tags:string[]; note:string; carry?:Int<1,1000>};
```

Carrier compatibility under P12/P22: today's `newRecordId()` produces `sw_<12 hex>`
(SB persist.js:53; src/id.js:2). It is a carrier-storage key, **not** an SB domain RecordId.
Keep existing stored SIDs/covers/receipt references byte-for-byte; do not truncate them or widen
sdk.check. E adds a durable host source map outside replayed domains: within chat lineage,
each owned stored SID maps to `{sid:sr_<8 base36>,swipeKey:sw_<8 base36>}`. Different swipes
of the same logical message share canonical sid and have distinct swipeKey; an existing valid
8-character SID may map to itself, with a separate swipeKey. New carrier records may keep the
current storage format; every new rules-v2 Source/Cursor uses the canonical pair only.

Assign/collision-check and persist the mapping before dispatch. Recognize owned versus copied
records with readRecord/restamp first; a copied swipe receives a new stored key and canonical
swipeKey. Never use numeric message/swipe indexes as durable keys. Continue/re-read/edit retain
the pair, changing payload/prefix hashes; a new swipe gets a new swipeKey. Reload/deletion/index
shifts preserve surviving pairs. Deleted mappings remain archived but confer no eligibility.
Legacy ops remain on their legacy replay path; canonicalization does not rewrite old characters.
Snapshots/native prefix maps/claims refer to the canonical pair and retain the source map.

Inputs at seams come from public queries: SB definitions/stacks/wallet and active proof;
SD canonical place/area, clock, threads and visible journal; NSD identity/presence and participant
checkpoint. No consumer reads another owner's raw domain or narration as rule evidence. Unset
time never falls back to real time. Unknown policy/identity holds only dependent actions.
Every reset is absolute at the owner's paths; host restoration installs all captured domains,
never replays a reset as a negative delta. SB savepoints starts with schema2, new epoch, empty
maps and previousDay:null. Owner validators check references and participate in host snapshots.

## 5. Rules at the seams

Binding decisions are in §11. Numeric proposals are indexed in §12 and developed in the
[track B backlog](RB_TRACK_B_DESIGN.md); they do not authorize a second interpretation in UI
or Studio. Frozen definitions/constants and their hash travel with the timeline, including
ItemDef values, origin tags and event templates. Replacing an installed pack cannot change them.

- Classes at 0/10/20/30 swap all three skills, with no inheritance. “Already stronger” is
  entirely the pack author's choice: **no checker comparison** of class totals, replacements
  or mastered predecessors. A weaker replacement is legal. Promotion still requires level
  and three 5/5 forms; 40–90 evolves advanced skills twice using the selected-parent graph.
- Keep combat maths, including healing's attack bonus, declared-stat substitution, mastery,
  per-target seeded variance, rounding and max-HP clamp (RB combat.js:165/:616). The typed
  interpreter must reproduce it; do not use the draft's bare `2*stat*power` healing formula.
- `xpPerLevel` is a safe integer 10..10000 **and divisible by 10**, default100 under P02.
  The retained adapter sets xpBase=xpPerLevel, xpExponent=0, maxLevel=99; xpToNext's rounding
  then preserves exactly the configured cost (RB rules.js:372). Shared schema/checker,
  Studio, import and runtime all enforce this constraint. No XP payload migration (P18).
- HP0 means downed. A wipe (all active durable members including PC downed/dead) directly
  causes PC death and one return request: **no narrative lethal check or intervention gate**.
  Reserves and temporary units cannot prevent it. Other validated lethal events use the
  code-run narrative check; a surviving fight revives downed companions with injury.

| Cross-owner operation | Boundary contract / proposed numbers |
|---|---|
| Use / training (P03) | Combat, narrative and training share proposed skill2/reply/10/day and actor6/reply/30/day caps; all paid attempts, even zero-credit ones, survive replay. RB owns payment/credit proof. SD owns time; SB owns fees. |
| Training start | skill.train records a request only. Trusted rules.settle validates trainer/form/place/funds, then wallet.pay + director.advance atomically. Proposed60 minutes, two completion credits, 10% interruption from frozen event list, no automatic refund. Roll back fee if advance.data.advanced differs. Never pass UI cause to advance. 2.4.0: an open trainer offer is resolved from the `training` domain with the same checks. |
| Area generation (P05) | world.areaTier({place}) resolves canonical place→explicit region membership→world. Tiers0..9; unknown holds generation. Proposed foe ceiling min(99,10*(tier+1)); common at0–1, uncommon2–3, rare4–6, epic7–9. Generated legendary refused; pack legendary allowed. Lore/allowlists/budget validation precedes rules.registerItem/offer. |
| Equipment (P07) | Eight slot IDs in §4; weapon labels Main hand. A 2H piece has one SB record and clears/blocks offhand. targetSlot chooses legal slot; omit → first legal empty slot, else explicit first-slot swap receipt. Base-stat requirements, no class locks, no self-qualification; use §3 equipPlan for every write. |
| Carry (P07) | Weight×quantity including worn gear; capacity floor((20+4*baseSTR)*carrySize/100)+validated carry bonuses (RB items/carry.js:7). Only active durable members add capacity. Capacity loss marks encumbered; no item deletion. New buys/rewards remain at source when blocked; transfers validate receiver. |
| Quest take (P08/P23) | Visible SD thread, explicit player acceptance, requirements/cooldown met; accept + rpg atomic. Already accepted neutral thread may be linked. No automatic acceptance or separate quest domain. |
| Quest progress / finish | Kills after acceptance, SB collect stacks, SD visit proof, validated story proof. At now>=deadline expire before turn-in; unset clock holds timed actions. Recheck giver/place/requirements. Consume items, pay SB wallet/stacks and RB XP, update rpg and SD close/journal in one transaction. Overweight reward holds all payout. |
| Rewards / repeat | Story credit reduces only the same reward's remaining coin. party.grantXp uses {quest,amount,claim}; zero XP omits the call; retain {quest,difficulty} legacy and {actor,amount} combat variants. Epoch/thread/instance settlement key. Fresh th_ for each repeat/chain offer; cooldown starts terminal minute, next chain only after done, no auto-accept. |
| Lethal / recovery (P10) | Propose d20+VIT modifier vs15 for non-wipe lethal events: success gravely injured, failure dead; validated intervention saves. Propose1HP/1440-minute injury/−2 STR+AGI checks after recovery. RB records sealed batch/results before native effects; PC death restores via SB protocol §8. |
| Party / summons (P11) | PC+2 durable active; excess recruits reserve; summons/pets temporary and outside that limit/carry/wipe rescue. In combat: cap 6, fight-end/downed dismissal (USER). Outside combat a summon/pet may remain in the narrative as story presence, with no combat sheet until a fight starts. Only a trusted paid form/pet event can summon; no narrative stat payload. |
| Currency / sinks (P14) | SB owns base-unit balances/formatting, ready RB supplies validated optional currency override and RPG caps; missing/invalid data uses the fallback described in §3. No conversion on display change. |

No respec; stat/class/path choices are player-issued, including companions. AI/manual is combat
control only. Crafting stays open to anyone with materials/recipe/station and declared-stat
scaling; keep crafting/commission maths. Narrate each level/promotion/step once. SD checks have
standalone actors/settings and optional RB/NSD contributions (§3), with no mandatory party lookup.
Internal progression/power formulas, requirement/proof semantics, condition timing and temporary
unit materialization are B3/B4. Settings P15 and mastery P19 are approved in §12. P20's
revisit and P21's wave-heal alternatives are settled by the existing no-respec/keep-maths decisions.

## 6. Replay recording

Shipped SB stores flat `record.ops` and `record.spans:[{n,story}]` (persist.js:16), not the
review's span.ops object. replayRecord applies saved operations without handlers (store.js:344).
Re-read replans marked steps on its carrier, then replays later carriers (store.js:786, :831).
trimReceipts removes **all** data after 200 carriers (persist.js:262, :268). No current host
mechanism checks these guards. The following P12/P13 changes are mandatory track E gates.

Approved (USER, §12): **P12 — guarded blocks and suffix reconciliation.** Extend
transaction spans to `{n,story,id:RecordId,module:string,source:Source,guard:Guard|null,
claims:string[],evidence:Proof[],boundaries:{cursor:Cursor,prefixHash:Hash,payloadHash:Hash}[],
operation:{type:string,payload:Json},recorded:Json,result:Json,
replan:null|{type:string,payload:Json,seed:number}}`. Ops remain flat; n delimits one atomic
root transaction. Nested cross-owner calls share that root's guard/claims/operation metadata.
New `ctx.replayGuard(guard:Guard) -> void` attaches owner requirements; host alone stamps source,
block ID and authority. New pure owner callback
`hooks.replayGuard({state,query},{guard,source,block:RecordId,operation:{type:string,payload:Json},
recorded:Json}) -> {ok:true}|{ok:false,reason:string}` gets the saved operation **and** durable
recorded inputs/draws. Throws/malformed response fails closed. Host checks epoch/rules/source
integrity; owner checks its versioned predicate and inputHash. The exact RB closed records,
canonical inputHash and combat terminal-prefix predicate are [B5](RB_TRACK_B_DESIGN.md), not
unfinished host assumptions. No handlers, content generation or fresh rolls in ordinary replay.

Proof submission (new SB, track E): `ctx.proof({kind, payload, parents?}) -> {id, payloadHash}`, callable only by the
owner of `kind` (SD: visit/acceptance/event; RB: kill/use/rescue/story) inside a command's root transaction. Payloads are
closed per kind (SD acceptance: `{thread, selection|words}`; SD check: `{check, actor, stat, dc}`); SB stamps id, Source
and payloadHash. An identical retry in the same root returns the same id; the same key with a changed payload is
CONFLICT. Failures: INVALID (shape), NOT_FOUND (parent), REFUSED (wrong owner or kind, or reader intent the host did not
see). Nested commands in the same root resolve its validated pending proofs; public queries see committed proofs only.
A rolled-back root publishes nothing. Tests: accept and roll each succeed once in one root; a rollback publishes no
proof; a forged reader intent is refused.

New SB `story.evidence({ids?:RecordId[]}) -> Proof[]` returns active visible code-validated
proof, default all in source order, unknown omitted, malformed args []. Owners submit typed
proof through their root block metadata; SB stamps id/Source/payloadHash and verifies declared
owner/kind: SD visit/acceptance/event, RB kill/use/rescue/story. `acceptance` binds a player UI selection or the reader's
explicit words; raw narration cannot grant it. Proof becomes visible only on commit and only
while its parents/block remain active; skipped blocks publish nothing. Snapshots pin proof
and parent refs; guards never read inactive raw text. RB proof payload schemas are B3/B6.

The host extracts **claim additions per block** from /meta/claims ops. Apply block ops and its
claims together only after guard and all touched-domain validators pass; otherwise neither
applies. Do not merge carrier-wide claims after skipping a block. Legacy blocks remain on the
legacy path and cannot masquerade as guarded rules-v2 blocks. Invalid UI choices stay stored
but inactive with REPLAY_PREREQUISITE; never choose replacement classes/forms/rewards/saves.
Cache/checkpoint identity includes the prefix hash of block/evidence contents and active
swipeKey, not just carrier SID. In chain (store.js:289), stop trusting subsequent checkpoints
at the **first** failed covers/hash window; remove the fallback to a later unverified checkpoint.
Retained blocks in replaceStory call step(state,ops,{replayed:true}), not the shipped call at
store.js:810. Validate skipped whole blocks rather than leave individual orphan operations.

Persist immutable swipeKey/action/evidence IDs before dispatch; numeric swipe indices are
presentation only (persist.js:6 allows index shifts). Edits/re-read preserve the logical key
but change evidence hashes; a new swipe gets a fresh key. Claims use
`rb:<epoch>:<operation>:<stable-key>`. Quest settlement key is
`rb:<epoch>:quest:<thread-id>:<instance>:settled`, not instance alone. No double grant across
retries, and different quests with instance1 cannot collide. Receipt data retention keeps
`data:{v2:old.data.v2}` when trimming other display data; guards/results also live on blocks,
so replay never depends on receipts surviving. Pin referenced evidence and snapshot bytes.

Owner reconciliation must recompute dependent system blocks after swipe/re-read/delete/rollback
when time, caps or prerequisites change. Remove the old ops/claims before replacing them atomically;
keep a player answer only while still valid. Reuse saved seeds/draws by stable operation ID.
RB's complete operation recording table, including combat action prefix/outcome, zero awards,
recovery, crafting/commission time and consumables, belongs to [B5](RB_TRACK_B_DESIGN.md).
E supplies transport/reconciliation; B supplies and tests every owner predicate before merging.

| Cross-owner block | Required atomicity / replay boundary |
|---|---|
| Quest accept / settle | SD acceptance/rpg/closure/journal + SB costs/rewards + RB XP and root claim; invalid proof removes all together. |
| Item registration / equip | RB frozen rule + SB definition/grant or equipped-record plan; guard source/rules/affected stacks. |
| Training / craft / recovery time | SB fee/materials + SD actual advance + RB result; never retain payment without its validated time/evidence. |
| Save make / forget / daily anchor | Carrier-bound eligibility, ancestry/prefix and participant bytes; forget retracts eligibility only, never pinned bytes. |
| Death / return / wake | RB sealed-result reference + authenticated absolute host restore + native acknowledgments; changed evidence retracts stale restore/cue before replanning. Ordinary replay never reselects a save or die. |

Each reset uses ctx.absolute at the **owner's** numeric paths (SB commands.js:270, :391);
restoration is a host absolute installation, never ordinary delta replay. Example: removing
10 earlier damage before a reset cannot turn lost0 into −10 or create extra HP. Suffix planning
and participant switching finish before a new head is exposed; crash/retry follows §8 journal.

## 7. Pack schema v2

### Envelope and registered kinds

Keep SB's envelope. Only top-level `id/version/name/author/description/requires/currency/economy/
calendar/weather/content/start/layouts/screens/theme` are accepted (SB `packs/limits.js:33`,
`validate.js:69`). No top-level kind/schema/classes/branches/foes object. Pack `requires` accepts
only storyBlock/capabilities (`validate.js:158`), not new module keys.

Today's registered kinds: items/creatures/shops/recipes/events/quests/races/talents/skills/
presets/places/routes/terms/ranks/crafts/meterPresets/markets (`limits.js:27`). Unknown kinds
are refused (`validate.js:90`). Item/skill fields are closed (`validate.js:226`, `:718`).
Creatures/quests use openRecord (:95/:102/:220), not the review’s nonexistent
checkCreature/checkQuest functions. Rules checks are opt-in by manifest; old packs keep old checks.

Under **P01**, lead adds `rules` to CONTENT_KINDS/OPTIONAL_KINDS, checker, lookup/count/
classification support and capability `rb-rules-v2`. It is **not registered today**. Old SB rejects rules with UNKNOWN_KIND. Missing capability yields MISSING_CAPABILITY only
when capabilities is supplied; null checks syntax only (validate.js:174).
This is an explicit host prerequisite, while keeping the existing envelope and other kinds.

```json
{
  "id":"standard-rules", "version":"2.0.0", "name":"Standard rules",
  "requires":{"storyBlock":"^2","capabilities":["story-director","rpg-battle","rb-rules-v2"]},
  "content":{
    "rules":[{"slug":"rules","name":"Standard rules","schema":2,"statLabels":{},
      "memory":"deja-vu","classes":[],"skills":[],"branches":[],"itemRules":[],"trainers":[]}],
    "items":[],"creatures":[],"quests":[],"shops":[],"recipes":[]
  }
}
```

This is an envelope skeleton, not a playable valid fixture: empty classes/skills must fail.
Exactly one rules manifest per rules pack. Existing `content.skills` remains its strict old
template format; v2 skills live inside content.rules[0].skills. Foes use content.creatures;
quest templates use content.quests. Items/shops/recipes keep their existing kinds and IDs.

### Typed definitions

Raw records use slug; SB assigns outer id/slug/pack wrappers and the new checker resolves
nested IDs/refs. The JSON Schema below defines fields/bounds once; it is the proposed authoring
boundary, not a second item or skill format. Schema2 does not widen existing content.skills.

| Normalized type | Raw schema / normalization |
|---|---|
| RulesManifest | Root schema; strip only known host wrappers before checking; defaults note='', statLabels={}, memory=deja-vu, replaces=null, unique=false, recipe known=true. |
| ClassDef / SkillDef / BranchDef | $defs.class/skill/branch; retain slug, assign pack.<id>/<slug>, resolve refs. FormDef expands base/ordered transforms plus id/skill/name/note/step/fromForm/origin. |
| ItemRule | $defs.itemRule; def is SB definition ID; non-equipment slots[]/hands0, hand items hands1/2, 2H only weapon. No class locks. |
| Trainer / FoeDef / QuestTemplate | $defs.trainer/foe/quest (2.4.0: `$defs.trainer` is `fixedTrainer \| openTrainer`, see Stage 7); resolve refs and canonical external place/NPC IDs. Frozen events/generation/flag schemas are B3/D merge deliverables. |
| ShopDef / RecipeDef | $defs.shop/recipe; retain stock/material/reference order and base-unit prices; absent station/teaches omitted. |
| ResolvedRules | Immutable manifest/forms/items(ItemRules)/foes/quests/shops/recipes/constants tables. B3 adds complete ItemDefs, origins/events/templates/generated content storage; no live pack fallback. |

Effect semantics: damage requires physical/magic damageType and one/all targets;
heal/shield requires null damageType and self/ally/allies. Positive stat effects target friends,
negative target foes. Harmful poison/burn/bleed/stun/daze/slow/weaken target foes; regen/guard
target friends. Numeric shield uses the shield effect only. Physical forms use SP and MP0;
others MP and SP0. Each form has1..4 effects; non-null unit scores12, spawns once per paid action,
candidate cap6. Raw bounds/list limits are structural; B3/B4 own interpreter/proof completion.

Every content.items ID needs one matching rule. Missing requirement keys mean no requirement;
weight is mandatory. Existing envelope currency normalizes to §4 Currency, coins default `[]`,
plural through SB's formatter, display mixed. Existing item stats/effects still pass SB validation;
the rule transports hands/weight/requirements; inventory.definitions supplies frozen item stats/effects. Generated content
uses the same types/budgets and frozen story/craft/trade runtime namespaces. Raw pack refs cannot name runtime story/craft/trade IDs; runtime validation binds them against the
frozen rule table using SB DEF_ID syntax. Internal graph refs must resolve within
one rules pack; no cross-pack rules mixing in this format. Place/NPC refs are explicitly external
SD/NSD IDs, resolved at activation; unresolved required refs block eligibility. Lore truth and
current equipment eligibility remain runtime checks.

### Branch graph, normalization and validator contract

Decided graph (log 800): each advanced skill base has three step-1 children g/a/b. **Each chosen
form** has its own g/a/b step-2 children. Per skill: 2+6 = 8 written and 1+3 = 4 generated;
per advanced class: **24 written + 12 generated**. Only one path is taken; no third step.
Earlier tiers have no pathway nodes.

Base form ID: `pack.<id>/skill-x-base`; step 1 appends `-g/-a/-b`; step 2 appends another
`-g/-a/-b` to that selected parent. Written BranchDef.id must equal that expansion for its
choice. `fromForm` names exact parent, including generated parents. Reserve suffixes and refuse
collisions. Base skill slug maximum 52 leaves room within SB's 64-character slug limit.
Written branches clone parent then apply ordered typed transforms; generated uses the proposed deterministic P06 transform in B3.

Check roots parent=null/tier0; all other parents exactly tier−1; no cycles/orphans; three distinct
skills per class; one owning class per base skill. All leaves advanced. Advanced skills have
exactly two written branches for base and for each first-step form. No earlier-tier branches.
Resolve every internal ref and validate every generated descendant/transform index/type/budget.
Do not compare child/parent skill or class strength. Optional replaces links are display-only;
weaker new-class skills pass when structurally valid and within their own budget (§11).

Normalize nested local slugs into `pack.<id>/<slug>`, following SB `validate.js:185`. Canonical
raw export uses local slugs for internal refs; resolved runtime uses full IDs. Preserve authored
class/skill/branch display order and effect/transform order; sort object keys for hash/export.
Text: NFC, trim outer whitespace, normalize line endings, reject controls/markup. Refuse unsafe
keys, unknown fields, duplicates, nonfinite/fractional integers and unresolved refs. Export UTF-8,
two-space indent, final newline; no timestamps/random IDs/self-hash. Export authored bases and
transforms, not duplicate expanded forms. Hash normalized authored data + schema + constants;
retain resolved result immutably in timeline storage. Repeated import/export yields identical
bytes/IDs/forms/hash. Budget/closure uses the same pure functions in import, runtime and Studio.

SB limits stay: 512 KiB/pack, 2 MiB installed, depth16, 200 keys/object, 1000 entries/array,
4000 chars/string (`packs/limits.js:5`). Expanded limits: 2048 forms, 1000 branches, 1000 item
rules, 100 trainers, 2 MiB resolved ruleset. 2048 covers 1092 forms for 40 classes/27 advanced (120 bases +27*36 descendants).
Raw pack limits remain unchanged; expanded maps are not pack input. Reject oversized graphs, never truncate. Source form
origin/provenance determines generated-legendary prohibition; a runtime flag cannot relabel it.

### Runtime adapter handoff

RB retains the old creature/loot path for packs without a rules manifest. Rules-v2 uses the
frozen content IDs and typed forms, with its internal form/foe/loot interpreter specified by
[B3/B4](RB_TRACK_B_DESIGN.md), including canonical area input and ID remapping. Do not send
reference-based skills/loot through legacy cleaners (RB templates.js:638/:665).
SD creates threads through §3 writers; RB computes only their rpg extension. Legacy creature
moves/template/boss/look/aliases and quest difficulty/detail/giver/place/objective remain legal
without the manifest. Schema2 conflicts require explicit reauthoring, never silent field loss.

### Machine-readable schema

The JSON schema below is the proposed structural baseline for the manifest and owned content.
B3 must complete frozen-event/flag/template inputs and semantic checks with D before B merges;
this schema is not proof that those internal interpreters are complete.
It supplements SB's envelope validator, not replaces it. Structural checks run first; shared
semantic checks then enforce references, graph counts, budgets, Unicode bounds and slot/target
compatibility. Schema defaults are annotations; normalization must actually apply them. The checker also
validates its Constants.xpPerLevel argument with $defs.xpPerLevel, including multipleOf10.
The root is a raw `content.rules[0]` manifest. The new checker runs before SB record wrapping;
normalization keeps host-added id/pack metadata outside the closed manifest. Runtime lookup
unpacks only those known wrapper fields, never silently drops arbitrary unknown input fields. `$defs` also covers owned creature/quest/shop/
recipe lists only when a rules-v2 manifest is present; it does not replace old-pack checks. No external `$ref` is
needed. Track D packages this data as new `src/v2/packs/rules-v2.schema.json` and exports it
from new `rules-v2.js`; this notes-only revision does not create runtime files.

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"urn:story-suite:rb-rules-v2:manifest","type":"object","additionalProperties":false,"required":["slug","name","schema","classes","skills","branches","itemRules","trainers"],"properties":{"slug":{"const":"rules"},"name":{"$ref":"#/$defs/name"},"schema":{"const":2},"statLabels":{"type":"object","additionalProperties":false,"required":[],"properties":{"STR":{"$ref":"#/$defs/name"},"VIT":{"$ref":"#/$defs/name"},"AGI":{"$ref":"#/$defs/name"},"DEX":{"$ref":"#/$defs/name"},"INT":{"$ref":"#/$defs/name"},"LUK":{"$ref":"#/$defs/name"},"CHA":{"$ref":"#/$defs/name"}},"default":{}},"memory":{"enum":["deja-vu","none","full"],"default":"deja-vu"},"classes":{"type":"array","minItems":1,"maxItems":40,"items":{"$ref":"#/$defs/class"}},"skills":{"type":"array","minItems":3,"maxItems":120,"items":{"$ref":"#/$defs/skill"}},"branches":{"type":"array","minItems":0,"maxItems":1000,"items":{"$ref":"#/$defs/branch"}},"itemRules":{"type":"array","minItems":0,"maxItems":1000,"items":{"$ref":"#/$defs/itemRule"}},"trainers":{"type":"array","minItems":0,"maxItems":100,"items":{"$ref":"#/$defs/trainer"}},"offerWords":{"$ref":"#/$defs/offerWords"}},"$defs":{"xpPerLevel":{"type":"integer","minimum":10,"maximum":10000,"multipleOf":10,"default":100},"id":{"type":"string","minLength":1,"maxLength":160,"pattern":"^(?:[a-z][a-z0-9]*_[0-9a-z]{8}|[a-z0-9]+(?:[._-][a-z0-9]+)*/[a-z0-9]+(?:[_-][a-z0-9]+)*)$"},"ref":{"type":"string","minLength":1,"maxLength":110,"pattern":"^(?:pack\\.[a-z0-9]+(?:-[a-z0-9]+)*/)?[a-z0-9]+(?:-[a-z0-9]+)*$"},"slug":{"type":"string","minLength":1,"maxLength":64,"pattern":"^[a-z0-9]+(?:-[a-z0-9]+)*$"},"name":{"type":"string","minLength":1,"maxLength":80},"note":{"type":"string","minLength":0,"maxLength":240,"default":""},"stat":{"enum":["STR","VIT","AGI","DEX","INT","LUK","CHA"]},"target":{"enum":["one","all","self","ally","allies"]},"element":{"enum":["none","fire","ice","lightning","poison","holy"]},"slot":{"enum":["weapon","offhand","head","body","legs","feet","accessory-1","accessory-2"]},"stats":{"type":"object","additionalProperties":false,"required":["STR","VIT","AGI","DEX","INT","LUK","CHA"],"properties":{"STR":{"type":"integer","minimum":1,"maximum":99},"VIT":{"type":"integer","minimum":1,"maximum":99},"AGI":{"type":"integer","minimum":1,"maximum":99},"DEX":{"type":"integer","minimum":1,"maximum":99},"INT":{"type":"integer","minimum":1,"maximum":99},"LUK":{"type":"integer","minimum":1,"maximum":99},"CHA":{"type":"integer","minimum":1,"maximum":99}}},"requires":{"type":"object","additionalProperties":false,"required":[],"properties":{"STR":{"type":"integer","minimum":1,"maximum":99},"VIT":{"type":"integer","minimum":1,"maximum":99},"AGI":{"type":"integer","minimum":1,"maximum":99},"DEX":{"type":"integer","minimum":1,"maximum":99},"INT":{"type":"integer","minimum":1,"maximum":99},"LUK":{"type":"integer","minimum":1,"maximum":99},"CHA":{"type":"integer","minimum":1,"maximum":99}}},"cost":{"type":"object","additionalProperties":false,"required":["mp","sp","cooldown"],"properties":{"mp":{"type":"integer","minimum":0,"maximum":999},"sp":{"type":"integer","minimum":0,"maximum":999},"cooldown":{"type":"integer","minimum":0,"maximum":10}}},"effect":{"oneOf":[{"type":"object","additionalProperties":false,"required":["op","target","power","element","damageType"],"properties":{"op":{"enum":["damage","heal","shield"]},"target":{"$ref":"#/$defs/target"},"power":{"type":"integer","minimum":1,"maximum":1000},"element":{"$ref":"#/$defs/element"},"damageType":{"enum":["physical","magic",null]}}},{"type":"object","additionalProperties":false,"required":["op","target","kind","chance","rounds"],"properties":{"op":{"const":"condition"},"target":{"$ref":"#/$defs/target"},"kind":{"enum":["poison","burn","bleed","stun","daze","slow","weaken","regen","guard"]},"chance":{"type":"integer","minimum":1,"maximum":100},"rounds":{"type":"integer","minimum":1,"maximum":6}}},{"type":"object","additionalProperties":false,"required":["op","target","stat","amount","rounds"],"properties":{"op":{"const":"stat"},"target":{"$ref":"#/$defs/target"},"stat":{"$ref":"#/$defs/stat"},"amount":{"type":"integer","minimum":-10,"maximum":10,"not":{"const":0}},"rounds":{"type":"integer","minimum":1,"maximum":6}}}]},"base":{"type":"object","additionalProperties":false,"required":["type","stat","cost","effects","unit"],"properties":{"type":{"enum":["physical","magic","heal","buff","debuff"]},"stat":{"$ref":"#/$defs/stat"},"cost":{"$ref":"#/$defs/cost"},"effects":{"type":"array","minItems":1,"maxItems":4,"items":{"$ref":"#/$defs/effect"}},"unit":{"oneOf":[{"type":"null"},{"$ref":"#/$defs/unit"}]}}},"class":{"type":"object","additionalProperties":false,"required":["slug","name","tier","parent","skills"],"properties":{"name":{"$ref":"#/$defs/name"},"tier":{"type":"integer","minimum":0,"maximum":3},"parent":{"oneOf":[{"type":"null"},{"$ref":"#/$defs/ref"}]},"skills":{"type":"array","minItems":3,"maxItems":3,"items":{"$ref":"#/$defs/ref"},"uniqueItems":true},"note":{"$ref":"#/$defs/note"},"slug":{"$ref":"#/$defs/slug"}}},"skill":{"type":"object","additionalProperties":false,"required":["slug","name","base"],"properties":{"name":{"$ref":"#/$defs/name"},"note":{"$ref":"#/$defs/note"},"replaces":{"oneOf":[{"type":"null"},{"$ref":"#/$defs/ref"}],"default":null},"base":{"$ref":"#/$defs/base"},"slug":{"$ref":"#/$defs/slug"}}},"transform":{"oneOf":[{"type":"object","additionalProperties":false,"required":["op","at","value"],"properties":{"op":{"const":"set-target"},"at":{"type":"integer","minimum":0,"maximum":3},"value":{"$ref":"#/$defs/target"}}},{"type":"object","additionalProperties":false,"required":["op","at","value"],"properties":{"op":{"const":"set-element"},"at":{"type":"integer","minimum":0,"maximum":3},"value":{"$ref":"#/$defs/element"}}},{"type":"object","additionalProperties":false,"required":["op","at","value"],"properties":{"op":{"const":"set-power"},"at":{"type":"integer","minimum":0,"maximum":3},"value":{"type":"integer","minimum":1,"maximum":1000}}},{"type":"object","additionalProperties":false,"required":["op","at","value"],"properties":{"op":{"const":"replace-effect"},"at":{"type":"integer","minimum":0,"maximum":3},"value":{"$ref":"#/$defs/effect"}}},{"type":"object","additionalProperties":false,"required":["op","value"],"properties":{"op":{"const":"add-effect"},"value":{"$ref":"#/$defs/effect"}}},{"type":"object","additionalProperties":false,"required":["op","at"],"properties":{"op":{"const":"remove-effect"},"at":{"type":"integer","minimum":0,"maximum":3}}},{"type":"object","additionalProperties":false,"required":["op","value"],"properties":{"op":{"const":"set-cost"},"value":{"$ref":"#/$defs/cost"}}},{"type":"object","additionalProperties":false,"required":["op","value"],"properties":{"op":{"const":"set-stat"},"value":{"$ref":"#/$defs/stat"}}},{"type":"object","additionalProperties":false,"required":["op","value"],"properties":{"op":{"const":"set-type"},"value":{"enum":["physical","magic","heal","buff","debuff"]}}}]},"branch":{"type":"object","additionalProperties":false,"required":["slug","skill","fromForm","step","choice","name","transforms"],"properties":{"skill":{"$ref":"#/$defs/ref"},"fromForm":{"$ref":"#/$defs/ref"},"step":{"enum":[1,2]},"choice":{"enum":["a","b"]},"name":{"$ref":"#/$defs/name"},"note":{"$ref":"#/$defs/note"},"transforms":{"type":"array","minItems":1,"maxItems":8,"items":{"$ref":"#/$defs/transform"}},"slug":{"$ref":"#/$defs/slug"}}},"itemRule":{"type":"object","additionalProperties":false,"required":["def","allowedSlots","hands","requires","weight"],"properties":{"def":{"$ref":"#/$defs/ref"},"allowedSlots":{"type":"array","minItems":0,"maxItems":2,"items":{"$ref":"#/$defs/slot"},"uniqueItems":true},"hands":{"enum":[0,1,2]},"requires":{"$ref":"#/$defs/requires"},"weight":{"type":"integer","minimum":0,"maximum":10000},"unique":{"type":"boolean","default":false}}},"trainer":{"oneOf":[{"$ref":"#/$defs/fixedTrainer"},{"$ref":"#/$defs/openTrainer"}]},"fixedTrainer":{"type":"object","additionalProperties":false,"required":["slug","name","place","skills","fee","minutes","eventTemplates"],"properties":{"name":{"$ref":"#/$defs/name"},"place":{"$ref":"#/$defs/id"},"skills":{"type":"array","minItems":1,"maxItems":30,"items":{"$ref":"#/$defs/ref"},"uniqueItems":true},"fee":{"type":"integer","minimum":1,"maximum":1000000},"minutes":{"const":60},"eventTemplates":{"type":"array","minItems":0,"maxItems":8,"items":{"$ref":"#/$defs/ref"},"uniqueItems":true},"slug":{"$ref":"#/$defs/slug"},"open":{"const":false}}},"openTrainer":{"type":"object","additionalProperties":false,"required":["slug","name","open","rank","skills","fee","minutes","eventTemplates"],"properties":{"name":{"$ref":"#/$defs/name"},"open":{"const":true},"rank":{"type":"string","minLength":1,"maxLength":20},"skills":{"type":"array","minItems":1,"maxItems":30,"items":{"$ref":"#/$defs/ref"},"uniqueItems":true},"fee":{"$ref":"#/$defs/openFee"},"minutes":{"const":60},"eventTemplates":{"type":"array","minItems":0,"maxItems":8,"items":{"$ref":"#/$defs/ref"},"uniqueItems":true},"slug":{"$ref":"#/$defs/slug"}}},"openFee":{"type":"object","additionalProperties":false,"required":["coinMin","coinMax"],"properties":{"coinMin":{"type":"integer","minimum":1,"maximum":1000000},"coinMax":{"type":"integer","minimum":1,"maximum":1000000}}},"requirement":{"oneOf":[{"type":"object","additionalProperties":false,"required":["kind","min"],"properties":{"kind":{"const":"level"},"min":{"type":"integer","minimum":1,"maximum":99}}},{"type":"object","additionalProperties":false,"required":["kind","stat","min"],"properties":{"kind":{"const":"stat"},"stat":{"$ref":"#/$defs/stat"},"min":{"type":"integer","minimum":1,"maximum":99}}},{"type":"object","additionalProperties":false,"required":["kind","template"],"properties":{"kind":{"const":"quest"},"template":{"$ref":"#/$defs/ref"}}},{"type":"object","additionalProperties":false,"required":["kind","def","qty"],"properties":{"kind":{"const":"item"},"def":{"$ref":"#/$defs/ref"},"qty":{"type":"integer","minimum":1,"maximum":999}}},{"type":"object","additionalProperties":false,"required":["kind","place"],"properties":{"kind":{"const":"place"},"place":{"$ref":"#/$defs/id"}}},{"type":"object","additionalProperties":false,"required":["kind","thread"],"properties":{"kind":{"const":"thread"},"thread":{"$ref":"#/$defs/id"}}},{"type":"object","additionalProperties":false,"required":["kind","classes"],"properties":{"kind":{"const":"class"},"classes":{"type":"array","minItems":1,"maxItems":40,"uniqueItems":true,"items":{"$ref":"#/$defs/ref"}}}},{"type":"object","additionalProperties":false,"required":["kind","key","value"],"properties":{"kind":{"const":"flag"},"key":{"type":"string","minLength":1,"maxLength":80},"value":{"type":"boolean"}}}]},"objective":{"oneOf":[{"type":"object","additionalProperties":false,"required":["id","kind","foe","count"],"properties":{"id":{"$ref":"#/$defs/id"},"kind":{"const":"kill"},"foe":{"$ref":"#/$defs/ref"},"count":{"type":"integer","minimum":1,"maximum":999}}},{"type":"object","additionalProperties":false,"required":["id","kind","def","count","consume"],"properties":{"id":{"$ref":"#/$defs/id"},"kind":{"const":"collect"},"def":{"$ref":"#/$defs/ref"},"count":{"type":"integer","minimum":1,"maximum":999},"consume":{"type":"boolean"}}},{"type":"object","additionalProperties":false,"required":["id","kind","place"],"properties":{"id":{"$ref":"#/$defs/id"},"kind":{"const":"visit"},"place":{"$ref":"#/$defs/id"}}},{"type":"object","additionalProperties":false,"required":["id","kind","text"],"properties":{"id":{"$ref":"#/$defs/id"},"kind":{"const":"story"},"text":{"type":"string","minLength":1,"maxLength":240}}}]},"reward":{"type":"object","additionalProperties":false,"required":["coin","xp","items"],"properties":{"coin":{"type":"integer","minimum":0,"maximum":9007199254740991},"xp":{"type":"integer","minimum":0,"maximum":9007199254740991},"items":{"type":"array","minItems":0,"maxItems":8,"items":{"type":"object","additionalProperties":false,"required":["def","qty"],"properties":{"def":{"$ref":"#/$defs/ref"},"qty":{"type":"integer","minimum":1,"maximum":999}}}}}},"quest":{"oneOf":[{"$ref":"#/$defs/closedQuest"},{"$ref":"#/$defs/openQuest"}]},"foe":{"type":"object","additionalProperties":false,"required":["slug","name","tier","level","stats","skills","loot","loreTags"],"properties":{"slug":{"$ref":"#/$defs/slug"},"name":{"$ref":"#/$defs/name"},"tier":{"type":"integer","minimum":0,"maximum":9},"level":{"type":"integer","minimum":1,"maximum":99},"stats":{"$ref":"#/$defs/stats"},"skills":{"type":"array","minItems":1,"maxItems":3,"items":{"$ref":"#/$defs/ref"},"uniqueItems":true},"loot":{"type":"array","minItems":0,"maxItems":8,"items":{"type":"object","additionalProperties":false,"required":["def","chance","qty"],"properties":{"def":{"$ref":"#/$defs/ref"},"chance":{"type":"integer","minimum":0,"maximum":100},"qty":{"type":"integer","minimum":1,"maximum":99}}}},"loreTags":{"type":"array","minItems":0,"maxItems":8,"items":{"type":"string","minLength":1,"maxLength":40},"uniqueItems":true},"aliases":{"type":"array","minItems":0,"maxItems":8,"items":{"type":"string","minLength":1,"maxLength":80},"uniqueItems":true}}},"shop":{"type":"object","additionalProperties":false,"required":["slug","name","place","kind","stock"],"properties":{"slug":{"$ref":"#/$defs/slug"},"name":{"$ref":"#/$defs/name"},"place":{"$ref":"#/$defs/id"},"kind":{"$ref":"#/$defs/slug","maxLength":40},"stock":{"type":"array","minItems":1,"maxItems":100,"items":{"type":"object","additionalProperties":false,"required":["item","qty","price"],"properties":{"item":{"$ref":"#/$defs/ref"},"qty":{"type":"integer","minimum":1,"maximum":999},"price":{"type":"integer","minimum":0,"maximum":9007199254740991}}}}}},"recipe":{"type":"object","additionalProperties":false,"required":["slug","name","craft","makes","qty","materials","fee","minutes","dc","stat"],"properties":{"slug":{"$ref":"#/$defs/slug"},"name":{"$ref":"#/$defs/name"},"craft":{"$ref":"#/$defs/slug"},"makes":{"$ref":"#/$defs/ref"},"qty":{"type":"integer","minimum":1,"maximum":99},"materials":{"type":"array","minItems":1,"maxItems":8,"items":{"type":"object","additionalProperties":false,"required":["item","qty"],"properties":{"item":{"$ref":"#/$defs/ref"},"qty":{"type":"integer","minimum":1,"maximum":99}}}},"fee":{"type":"integer","minimum":0,"maximum":9007199254740991},"minutes":{"type":"integer","minimum":0,"maximum":1440},"dc":{"type":"integer","minimum":5,"maximum":40},"stat":{"type":"string","pattern":"^(STR|VIT|AGI|DEX|INT|LUK|CHA)(\\+(STR|VIT|AGI|DEX|INT|LUK|CHA)){0,2}$"},"station":{"$ref":"#/$defs/slug"},"known":{"type":"boolean","default":true},"teaches":{"type":"string","minLength":1,"maxLength":120}}},"unit":{"type":"object","additionalProperties":false,"required":["kind","class","statShare","poolShare","rounds"],"properties":{"kind":{"enum":["summon","pet"]},"class":{"$ref":"#/$defs/ref"},"statShare":{"type":"integer","minimum":10,"maximum":100},"poolShare":{"type":"integer","minimum":10,"maximum":100},"rounds":{"type":"integer","minimum":1,"maximum":60}}},"closedQuest":{"type":"object","additionalProperties":false,"required":["slug","name","category","giver","turnInPlace","requirements","objectives","reward","durationMinutes","repeat","chain"],"properties":{"slug":{"$ref":"#/$defs/slug"},"name":{"$ref":"#/$defs/name"},"category":{"enum":["main","side","bounty"]},"giver":{"oneOf":[{"type":"null"},{"$ref":"#/$defs/id"}]},"turnInPlace":{"oneOf":[{"type":"null"},{"$ref":"#/$defs/id"}]},"requirements":{"type":"array","minItems":0,"maxItems":16,"items":{"$ref":"#/$defs/requirement"}},"objectives":{"type":"array","minItems":1,"maxItems":8,"items":{"$ref":"#/$defs/objective"}},"reward":{"$ref":"#/$defs/reward"},"durationMinutes":{"oneOf":[{"type":"null"},{"type":"integer","minimum":1,"maximum":525600}]},"repeat":{"oneOf":[{"type":"null"},{"type":"object","additionalProperties":false,"required":["cooldownMinutes"],"properties":{"cooldownMinutes":{"type":"integer","minimum":0,"maximum":525600}}}]},"chain":{"oneOf":[{"type":"null"},{"type":"object","additionalProperties":false,"required":["previous","next"],"properties":{"previous":{"oneOf":[{"type":"null"},{"$ref":"#/$defs/ref"}]},"next":{"oneOf":[{"type":"null"},{"$ref":"#/$defs/ref"}]}}}]},"open":{"const":false}}},"openObjective":{"oneOf":[{"type":"object","additionalProperties":false,"required":["id","kind","count"],"properties":{"id":{"$ref":"#/$defs/id"},"kind":{"const":"kill"},"foe":{"$ref":"#/$defs/ref"},"count":{"type":"integer","minimum":1,"maximum":999},"countMin":{"type":"integer","minimum":1,"maximum":999},"countMax":{"type":"integer","minimum":1,"maximum":999},"allowVariants":{"type":"boolean"}}},{"type":"object","additionalProperties":false,"required":["id","kind","count","consume"],"properties":{"id":{"$ref":"#/$defs/id"},"kind":{"const":"collect"},"def":{"$ref":"#/$defs/ref"},"count":{"type":"integer","minimum":1,"maximum":999},"countMin":{"type":"integer","minimum":1,"maximum":999},"countMax":{"type":"integer","minimum":1,"maximum":999},"consume":{"type":"boolean"}}},{"type":"object","additionalProperties":false,"required":["id","kind"],"properties":{"id":{"$ref":"#/$defs/id"},"kind":{"const":"visit"},"place":{"$ref":"#/$defs/id"}}},{"type":"object","additionalProperties":false,"required":["id","kind"],"properties":{"id":{"$ref":"#/$defs/id"},"kind":{"const":"story"},"text":{"type":"string","minLength":1,"maxLength":240}}}]},"openReward":{"type":"object","additionalProperties":false,"required":["coinMin","coinMax","xpMin","xpMax","items"],"properties":{"coinMin":{"type":"integer","minimum":0,"maximum":1000000000},"coinMax":{"type":"integer","minimum":0,"maximum":1000000000},"xpMin":{"type":"integer","minimum":0,"maximum":1000000000},"xpMax":{"type":"integer","minimum":0,"maximum":1000000000},"items":{"type":"array","maxItems":0}}},"openQuest":{"type":"object","additionalProperties":false,"required":["slug","name","category","giver","turnInPlace","requirements","objectives","reward","durationMinutes","repeat","chain","open","rank"],"properties":{"slug":{"$ref":"#/$defs/slug"},"name":{"$ref":"#/$defs/name"},"category":{"enum":["main","side","bounty"]},"giver":{"oneOf":[{"type":"null"},{"$ref":"#/$defs/id"}]},"turnInPlace":{"oneOf":[{"type":"null"},{"$ref":"#/$defs/id"}]},"requirements":{"type":"array","minItems":0,"maxItems":16,"items":{"$ref":"#/$defs/requirement"}},"objectives":{"type":"array","minItems":1,"maxItems":8,"items":{"$ref":"#/$defs/openObjective"}},"reward":{"$ref":"#/$defs/openReward"},"durationMinutes":{"oneOf":[{"type":"null"},{"type":"integer","minimum":1,"maximum":525600}]},"repeat":{"type":"null"},"chain":{"type":"null"},"open":{"const":true},"rank":{"type":"string","minLength":1,"maxLength":20}}},"offerWords":{"type":"object","additionalProperties":false,"required":[],"properties":{"hunt":{"$ref":"#/$defs/offerWordList"},"cull":{"$ref":"#/$defs/offerWordList"},"gather":{"$ref":"#/$defs/offerWordList"},"deliver":{"$ref":"#/$defs/offerWordList"},"explore":{"$ref":"#/$defs/offerWordList"},"escort":{"$ref":"#/$defs/offerWordList"},"task":{"$ref":"#/$defs/offerWordList"},"easy":{"$ref":"#/$defs/offerWordList"},"normal":{"$ref":"#/$defs/offerWordList"},"hard":{"$ref":"#/$defs/offerWordList"},"nightmare":{"$ref":"#/$defs/offerWordList"}}},"offerWordList":{"type":"array","minItems":0,"maxItems":40,"items":{"type":"string","minLength":1,"maxLength":24}}}}
```

| Entry point | Required result; all new except validatePack |
|---|---|
| `rulesV2Schema` | Frozen schema data, identical to the packaged schema artifact; B3 additions reviewed with D. |
| `normalizeRulesV2(raw,{packKey,constants})` | `{ok:true,manifest}` or Errors; raw JSON plus valid raw pack key/constants, normalize defaults/slug IDs/refs without mutation. |
| `expandRulesV2(manifest,content,constants)` | `{ok:true,resolved:ResolvedRules,hash:Hash}` or Errors; expand selected-parent graph and bind content, no writes. |
| `validateRulesV2(manifest,content,constants)` | `{ok:true,resolved,warnings}` or `{ok:false,errors:[{code,path,message}]}`. |
| `powerScore(form)` | `{ok:true,score:Count}` or Errors; B3/P06 score including unit12; no state reads/caller limits. |
| `generatePowerUp(form)` | `{ok:true,form:FormDef}` or Errors; clone validated parent, derive id=parent.id+'-g', step+1/origin generated/fromForm parent.id, apply B3/P06, validate bounds/budget; parent step2 or invalid closure BAD_RULES. |
| Existing `validatePack(input,options)` | Envelope/safety plus registered v2 checker; existing signature SB `packs/validate.js:40`. |
| `exportRulesV2(document)` | `{ok:true,text:string,hash:Hash}` or Errors; full validated normalized document→canonical raw envelope, strip assigned wrapper fields and shorten same-pack refs. |

## 8. Death and return

PC death restores state/companions while retaining raw chat, with faded history and a waking
scene. The latest decision fixes the target: **START of the previous narrative day**, unless
a manual save is more recent, in which case use the most recent save. Death on day11 returns
to start day10; §11 records both. Current bookmarks create/open branches (SB rewind.js:231,
:269); RB returnInTime uses sdk.rewind at the fatal fight (RB return/index.js:76). Neither is
this retained-chat restore. There are no shipped return.save/load/checkpoint/clear/back or
sdk.rewindTo APIs at the pins.

Approved (USER, §12): **P13 — snapshot/participant mechanics and edge cases.** All APIs
in this section are new track E/NSD work, not permission for RB to draft other owners' state.
Clock-boundary markers are new host work too. New synchronous
`ctx.clockBoundary({minute:Minute,source:Source}) -> {cursor:Cursor,prefixHash:Hash}` is callable
only by SD clock commands (wrong owner/cause REFUSED, non-crossed boundary INVALID). SD emits
one marker per crossed midnight while its draft clock equals that boundary. The host captures
all transaction drafts **at that logical point**, including already-staged training session/fee,
not an arbitrary index in opsOf's domain-sorted diff. Markers/payloads are staged on the root
block, discarded with its failure/guard, and only become eligible after root commit. The async
coordinator obtains each participant's checkpoint **as of that marker's native event prefix**,
not its later live state, before publishing snapshot readiness. Re-read regenerates markers in
order from the saved seed. No native I/O occurs in the synchronous clock handler. This extra
logical-boundary metadata/participant prefix materialization is an E gate; current SB cannot
supply it. Restoring an in-progress paid training snapshot resumes its running session, without
charging again. A snapshot payload is `{schema:2,domains:Record<DomainName,Json>,storyClaims:Record<string,true>,
effectiveSettings:Record<string,Json>,domainVersions:Record<string,number>,participants:Participant[]}`.
Capture **every registered domain**, including director/atlas/chronicle/arc/checks, all RB
slices, inventory/scene, npc, death **and savepoints**; no hand-maintained five-domain allowlist.
Immutable payload bytes and native checkpoints live in a host archive outside replayed domains
(to avoid recursively embedding snapshots). Descriptor.payloadHash locates/verifies them.
Restore all captured slices absolutely, validate all registered validators and participant
schemas (historical choices/guards inside the payload are saved state, not handlers to rerun), then overlay the new epoch/current ReturnRecord and the selected target descriptor from the
archive (capture precedes inserting its own descriptor, so it may not be in its payload).
Snapshot.epoch records provenance: prior points at/before target remain eligible across the
new epoch only when restored ancestry/prefix hashes prove them; post-target points lose
eligibility. Repeated deaths may therefore use the same restored save without accepting a
faded future save. Do not require epoch equality as a substitute for ancestry. Story claims reset to the saved
set; host monotonic revision/receipt IDs, archive, restore audit and UI preferences stay outside
that restored payload. Saved effective rule settings are restored; current UI settings are not.
Newly registered domain absent from snapshot requires its owner's versioned default/migration
recorded in the manifest, otherwise SNAPSHOT_UNAVAILABLE. Never silently keep post-save data.

New host-local coordinator `sdk.timeline` exposes the following asynchronous methods. Public
UI may call make/forget/list/status/history only. Prepare/activate/abort/native methods require an
unforgeable host capability, never caller-supplied cause or an asserted prepared ID. All promises
resolve `{ok:true,...fields below}` or `{ok:false,code,message}`; no native I/O in synchronous
command handlers. E adds an SDK host-action adapter for sdk.command('savepoint.make',payload):
it reserves the immutable action/source/target, awaits timeline.make checkpoint preparation,
then atomically commits the descriptor/receipt if expectedHead still matches. Direct bus calls
to make refuse REFUSED; module async handlers are not introduced. On stale head discard the
uncommitted descriptor and preserve bytes only as an unreferenced cache. The public adapter
returns the same receipt envelope as §3. Internal savepoint.restore commits only a validated
prepared token, synchronously installing the host block after preparation.

| Method | Input → success fields | Refusal/authority |
|---|---|---|
| registerParticipant | `{module,schema,checkpoint,prepare,activate,abort,status,applyEvent?}` → `{module}` | Host registration callback only; duplicate CONFLICT, bad callbacks INVALID. |
| make | `{kind:'initial'\|'manual'\|'day-start',name?,target?:Cursor,day?:Day}` → `{snapshot:Snapshot}` | UI may manual only/current head; host boundary may others; stale cursor STALE, missing bytes SNAPSHOT_UNAVAILABLE. Public savepoint.make calls this, not a synchronous snapshot shortcut. |
| list / status | `{}` → `{points:Snapshot[]}` / `{state:'idle'\|'pending'\|'failed',return:Id\|null,participants:Participant[]}` | Read-only, only eligible ancestry targets, ordered by target cursor. |
| head | `{}` → `{headHash:Hash,cursor:Cursor,epoch:RecordId,prefixHash:Hash}` | Read-only accessor, same committed head used by nativeMutation; pending returns RESTORE_PENDING. |
| prepare | `{snapshot:Id,deathEvents:Id[],batchResult:{id:RecordId,hash:Hash},expectedHead:Hash}` → `{prepared:RecordId,return:RecordId,manifestHash:Hash}` | Host authenticated sealed batch; hashes/availability/version checked, stale head STALE; emits durable prepared record. This produces §3's prepared ID. |
| activate | `{prepared:Id,expectedHead:Hash}` → `{return:Id,status:'complete'\|'participants-pending'}` | Host only, once; commit SB absolute restore then activate participants. Unknown token NOT_FOUND; stale head aborts preparation. |
| abort | `{prepared:Id}` → `{status:'aborted'}` | Host only/precommit; idempotent; postcommit REFUSED (must finish recovery). |
| recover | `{}` → `{state:'idle'\|'pending'\|'failed',return:Id\|null}` | Host startup/head-selection; resume committed work, abort stale uncommitted prepare. No clock/target reselection. |
| history | `{through?:Cursor}` → `{messages:[{sid,swipeKey,text,active:boolean}],faded:[{after:Cursor,through:Cursor}]}` | Host/UI read projection, ordered source messages including user messages; host gives projection-only msg_ identities
for messages without carrier IDs. No hidden facts. |
| nativeEvent | `{event:Id,participant:string,kind:'confirmed-death',npc:RecordId,expectedHead:Hash}` → `{event,checkpoint:Id,hash:Hash,ack:true}` | Host outbox only after code-confirmed death; unknown/mismatched native target REFUSED, stale head STALE; barrier until durable ack. |

Every native mutation (scan, manual dossier edit, meter/native synchronization and confirmed
death) records Source/prefix hash → immutable checkpoint in the coordinator journal before
exposing its new head. No snapshot-only participant can handle an arbitrary selected swipe.
New host-bound `timeline.nativeMutation({participant,source,expectedHead,prepare})`
returns `{ok:true,checkpoint:Id,hash:Hash}` or the common failure envelope. Only the registered
participant may call; obtain expectedHead from timeline.head, never from meta.rev alone; prepare is an async local callback returning
`{before:Participant,after:Participant,prepared:Id}` with both checkpoints durable, without
exposing after. Host raises the barrier, checks expectedHead, persists its journal, calls that
participant’s activate/abort using this transaction’s host-assigned ID, then publishes the prefix
mapping. STALE cancels before activation; postactivation failure recovers to the journal
choice before unblocking. NSD scanner/manual editor/meter synchronization use this entry.
Participant history must support checkpoint lookup for each surviving source prefix; edits and
re-read rebuild that mapping before native scanners resume.

Participant callbacks (bound to module, no cross-owner draft rights):
`checkpoint({cursor,headHash}) -> {checkpoint:Id,hash:Hash,schema:number}` persists full native
state/history/evidence/identity map and applied death IDs;
`prepare({return:Id,checkpoint:Id,hash:Hash}) -> {prepared:Id,hash:Hash}` verifies bytes without
switching visible state; `activate({return:Id,prepared:Id}) -> {checkpoint:Id,hash:Hash}` switches
idempotently; `abort({return:Id,prepared:Id}) -> {aborted:true}` releases precommit work;
`status({return:Id}) -> {checkpoint:Id,hash:Hash,status:'prepared'|'active'|'aborted'}`.
Each callback resolves `{ok:true,...listed fields}` or the common failure envelope; unavailable bytes SNAPSHOT_UNAVAILABLE,
conflicting return/hash CONFLICT. NSD additionally supplies host-bound
`applyEvent({event,nativeKey,kind:'confirmed-death'}) -> {event,checkpoint,hash,ack:true}`;
no existing npc.adjust/set/refresh/milestone/tick can stand in for it (NSD storysuite-v2.js:75).
New read-only `npc.identity({name?:string,id?:RecordId}) ->
{id:RecordId,nativeKey:string,name:Text80}|null` requires exactly one selector. id is an np_
surrogate and resolves the active native key/name for checks.roll.targetNpc; name resolves a
unique native name/alias/key. Unknown/ambiguous/malformed selector returns null, never creates.
Native keys are not renamed or accepted as SB RecordId fields.

Under P24, NSD's native mutation wrapper assigns np_ IDs for every admitted dossier **before**
its new native head is published: initial hydration, import, creation, scan and manual edits all
use the same persisted nativeKey↔np_ map. Host-issued eight-base36 IDs are collision-checked;
renames preserve the pair, deletion archives it without reuse. A query on a not-yet-assigned
legacy dossier returns null until the host-coordinated hydration mutation finishes. No RB or
SD caller assigns a surrogate. Ambiguous merge/rekey holds CONFLICT until NSD explicitly
reconciles identity; do not remap companions by name. With NSD absent, npcId may be null; with
an unresolved linked identity, death/social/recruit actions requiring it hold NOT_FOUND.
Full native checkpoints include the map, aliases and applied event IDs. Restore selects the
saved map and matching dossier bytes together; post-target allocations remain audit-reserved
but inactive and cannot resolve through queries.

Same event ID/meaning returns its durable prior ack; conflicting meaning is CONFLICT.
Unknown native identity holds death rather than guesses. RB outbox/batch/prepared-result and
ack record design is [B6](RB_TRACK_B_DESIGN.md). The host protocol still requires durable
sealed-result references, before/after participant checkpoints, prefix mappings and recoverable
acknowledgments before exposing a consistent head; E/NSD cannot delegate this to meter commands.

Coordinator procedure:

1. Retain initial snapshot after character creation. At every SD clock advance crossing midnight,
   host splits at each boundary, installs that exact clock value, settles boundary expiry then
   checkpoints before subsequent actions. At day D, eligible automatic is start D−1; retain start D
   for the next day. Visible journal for the target day is attached later without changing payload.
   Multi-day jumps materialize each boundary using state before later actions; unset/midday-first
   clock has no invented earlier day. Proposed initial fallback is P13, not a decided save rule.
2. On a sealed lethal batch choose latest eligible target **before death** in active ancestry:
   previous-day start or more-recent manual. Manual wins exact cursor tie. Cursor order uses surviving
   carrier/block/op order, not revision alone; swipes and deleted saves lose eligibility. If no
   previous-day anchor exists, proposed initial fallback; missing saved bytes/participant holds
   SNAPSHOT_UNAVAILABLE, never substitutes another save. Cap 10 manual descriptors (USER); at the limit make returns LIMITED (test: ten saves succeed, the eleventh returns LIMITED). New UI host
   timeline.forget({snapshot:Id}) -> {ok:true,forgotten:Id} records carrier-bound loss of eligibility;
   unknown target NOT_FOUND, pinned active return REFUSED. It never deletes still-referenced
   payload/native bytes. No forget/replan may move the death target silently.
3. Prepare exact head/snapshot/participant hashes durably. Validate every slice; prepare NSD full
   native checkpoint. Stale head aborts precommit. Commit one authenticated SB restore block;
   apply saved state and claims absolutely, append durable ReturnRecord/new epoch and fade interval.
4. Activate each prepared native participant and verify hashes. Failure leaves participants-pending
   barrier; reload/retry completes from the durable journal. No partial success or living RB actor
   beside a dead dossier. Mark complete only after all acknowledgments, then one return.cue.
5. Swipe/delete/re-read changing the selected timeline invokes recover and switches NSD to the
   matching active checkpoint before scan/read/generation. Precommit cancellation restores the
   unchanged pre-prepare view; postcommit rollback uses another authenticated absolute selection,
   never inverse deltas or partial native abort. Death dice/results remain retrievable by immutable batchResult reference (B6), even after restoring the death domain.

Faded operation interval is exactly `(target,restore]`. For **text** exclusion, a target inside a
reply excludes that entire carrier from active history; saved visible scene/journal supplies the
replacement recap. Raw text stays readable. Boundary cursors between messages exclude only later
messages. All prompt assembly, extraction, journal facts, NPC scanning and native evidence readers
must use history's active messages and checkpoint, including their out-of-band paths; no direct
raw-chat scan may resurrect faded facts. Wake uses saved scene and permitted memory (default vague
déjà vu, setting none, pack full); full memory grants no retained inventory/XP/objective proof.

`return.point` adds snapshot/target to its old index/beforeRev/place/fight projection; fight may be
null for narrative death. `return.status` retains dead/point and adds pending/memory/lastReturn.
Old `{fight,place}` return.cue and branch rewind stay legacy-only. New rules-v2 callers are
return card, returnInTime adapter and host completion; all must migrate together (appendix).
Companion death is permanent on the active timeline; PC return restores its saved living state.

## 9. Migration

Fresh start is decided (log 749). Detect host version and RB rules version separately **before
module registration/initialization or mutation**, using a new SB read-only preflight probe.
Host v2 is not proof of rules v2. Registration otherwise adds missing slices but never replaces
old party data (SB `src/v2/registry.js:558`). No old character conversion is authorized.

| Input | Behavior |
|---|---|
| No RB character in a valid new/empty timeline | Initialize fresh rules-v2 domains, choose basic class. |
| Supported old host/rules save | Keep compatible old reader/runtime where available; offer read/export and new character in a new timeline. Do not mutate old save. |
| Host v2 with old party and no rulesVersion:2 | Legacy, not empty. No implicit reset or v2 initialization of party. |
| Partial/mixed v2 markers, future schema, bad hash | Refuse mutation with mismatch notice; preserve original. |
| Pack missing/changed | Use retained resolved definitions only if hash matches; otherwise RULES_MISMATCH, never newest pack substitution. |

Content/command adapters, not character migration: `mainhand/main-hand -> weapon`,
`off-hand -> offhand`, `armour/armor -> body`, accessory-1/2 unchanged. Generic worn/hands/
waist/bare accessory is ambiguous: require an explicit v2 slot during authoring/import.
Never guess. Keep old runtime compatibility isolated; never register two owners for the same
names/domains in one host. Rules schema 2 is distinct from SB's state/envelope version.

## 10. Deliverables per track

This revision supplies a reviewable contract and embedded schema. Runtime files, validators,
tests and fixtures below remain implementation deliverables. Freeze only after the user's
answers and fresh review; no track may invent a missing rule to unblock itself.

| Folder/file | Owner during implementation | Integration rule |
|---|---|---|
| SD quest-only mechanics; new RB `src/v2/quests/`; RB item slot planners; NSD preset audit | A | Extraction map below; lead applies shared registration/settings edits. |
| RB new `src/v2/rules/`, `progress/`, `training/`, `death/`; party/combat sheet consumers; SD checks/tiers; NSD restore participant | B | Name one owner per subfolder; SB/SD/NSD changes are reviewed with their owners. |
| RB `src/v2/screens/`, `board/`, creation/progression UI components | C | Query projections/commands only; no rule duplication. Coordinate creation engine files with B. |
| SB store/persist/commands/sdk/registry/turn/rewind, pack host integration, new testkit/matrix | E | E owns host gates below; D supplies pure checker/schema. |
| SB new `src/v2/packs/rules-v2.js`, schema artifact, `tests/v2/studio/` | D, pure schema/checker | E integrates host validator dispatch; no overlapping edits. |
| Separate `Story_studio` repository: engine/export/undo/fixtures/docs | D | Later split (log 798) wins over earlier all-in-SB plan. Pin implementation commit at integration. |
| Module definitions/entry points, registration, settings/features, shared testkit/matrix, manifests, release notes | Lead | Tracks deliver patches; lead alone integrates shared files. |

RB/SD `src/v2/module.js`, SB registry/domain aggregator/pack kind tables, feature/setting maps
and NSD `src/storysuite-v2.js` stay lead-owned even when a track needs a small edit. Assignments below are fixed: A owns quest extraction and item command/slot routing; B owns
party/sheets/pools, combat setup/view/interpreter, progress/training/death and SD checks/danger;
C owns screens/board/creation UI; D owns pure schema/export; E owns host internals. A supplies
item rules to B through the §3/§4 seam queries; B does not edit A item command files. A identifies no remaining
NSD preset runtime to move: NSD already owns it, so that seam is an audit/no-op unless code is
identified. B owns new NSD checkpoint/death participant files; lead applies its registration
patch. Shared definitions/settings stay lead-integrated from reviewed patches, without writers
editing each other’s folders.

### E. Story Block host changes — merges first

These P01/P12/P13/P22 host extensions are prerequisites, not work hidden in B. E implements
and tests their public contracts before downstream wiring; A–D may build pure fixtures in parallel.

| Change / concrete API and source to extend | Required tests | Tracks waiting |
|---|---|---|
| Per-op-block metadata in record.spans, ctx.replayGuard and hooks.replayGuard (§6); extract claim ops and gate claims with ops; store.js:344 / persist.js:16 / commands.js:447 | Invalid guard removes payout+closure+claim together, two instance1 quests, nested cross-owner rollback, old blocks isolated | A settlement, B progression, C action wiring |
| persist.trimReceipts keeps data.v2 at >200 carriers; canonical carrier source map (§4), swipeKey/block/action/evidence IDs; prefix hashes/pins (§6) | Trim/reload retains results/guards/seed; deleted earlier swipe shifts index but identity stable; edited same SID invalidates payload hash; sw_12hex maps stably to sr_8/sw_8 without rewriting legacy refs or widening regex | A/B, C replay fixtures |
| chain stops first invalid covers/hash and never falls back across gap; replaceStory step uses {replayed:true}; atomic suffix reconciler (§6) | Delete between three checkpoints; change clock before zero-credit attempt; re-read missing target; replacement system claims once; full recovery never negative-delta heals | A/B, C |
| sdk.preflight + requires.peers + lifecycle dispatch before ensureModules; sdk.modules status/reason and SD fightRunner migration (§2; sdk.js:372; SD module.js:194) | Old party untouched before registration; missing/late/off/wrong-version peer; cyclic peers; dormant discovery produces no SD encounters and hooks do not block SB/NSD generation; late activation advertises once | A/B/C activation |
| sdk.timeline head/methods/participant registry, internal savepoint.restore host block, all-domain payload/version manifest, batch-result pin and canonical participant prefix map (§8/B6) | Enumerate every registry domain incl. new test domain; absolute restore of time/wallet/pools/XP/gear/combat/training/npc; unauthorized/forged token; stale head; missing native bytes; crash at each phase | B/NSD, C return wiring |
| Active-history projection + participant head-selection barrier; ctx.clockBoundary logical markers inside SD clock transactions (§8) | Intra-reply exclusion, midnight/multiday anchors, new day/removed time, faded extraction/journal/native scans, swipe/delete restore and reload before scans | B, SD/NSD, C |
| SB inventory policy delegation: purse.currency/moneyPolicy fallback (§3/P07/P14) | SB alone still works, direct equip cannot bypass RB, 2H/offhand/swap, invalid override fallback and integer balance unchanged | A item routing, B trade/craft, C |
| Register content.rules in CONTENT_KINDS/OPTIONAL_KINDS (limits.js:27/:30); normalize via records(name+slug) at validate.js:185, invoke D checker before wrapper; add lookup/count/installed classification and rb-rules-v2 capability | Old host UNKNOWN_KIND; supplied missing capability MISSING_CAPABILITY; valid small graph; malformed nested field; old packs unchanged; name+slug ID wrapping | D import, A/B pack activation |
| Validator opt-in scope: preserve openRecord creatures/quests without manifest (:95/:102); with schema2 validate their owned definitions plus shop/recipe refs; keep strict old items/skills; normalize nested slug IDs/refs (§7) | Legacy moves/template/difficulty/detail packs pass unchanged; schema2 rejects conflicts, numeric branch-only copy, graph mismatch, unknown fields/refs, unsafe/oversized content; complete advanced graph 24/12 | A/B adapters, D content |
| Shared testkit/matrix runner and versioned vendor sync (§2) | Every positive/negative combination with real modules and new host tests; synchronize RB's second QA vendor too | All integration |
| `inventory.definitions` + `inventory.registerDefinition` + ready-RB `rules.registerItem` routing (§3; inventory.js:443/:936, packs/content.js:12) | Frozen unmaterialized pack defs survive pack removal; generated grant registers matching rule atomically; conflicting ID/bytes refused; failed craft/buy/grant leaves neither def nor rule | A items, B rules, D checker |
| `rules.equipPlan` host validation in inventory.equip/equipOn/item capture (§3; inventory.js:1039/:1145), private transaction plan | Direct equip cannot bypass rules; spoofed plan rejected; no recursive RB call; changed owner/stats STALE; 2H/offhand/swap and SB-alone fallback | A item routing, B sheet, C |
| `story.evidence` projection + proof metadata/owner checks/parent pins (§6; commands.js:447, store.js:344, persist.js:268) | Active visible proof only; wrong owner/kind refused; deleted/skipped parent hides proof; trim/reload and snapshots retain it; reader intent cannot be narration-forged | A quests, B rules/SD checks |
| `savepoint.contract({})` capability projection (§2; new query) | Report false until retained-chat/all-domain/installed-native participants ready; missing/malformed/off blocks RB activation; independent SB/SD/NSD stay usable | B activation/return |
| SB assist checks migration (§3; assist/classifier.js:140/:147/:152) | capture.check resolves via SD checks.roll once with/without RB; no legacy check.roll probe or supplied die/outcome; missing capture rolls back precheck claim; re-read/swipe no double die/claim | B SD checks, all matrix rows |

No checkRecordHead exemption or checkCreature/checkQuest patch is needed: those functions do
not exist at the pinned SB head. Nested branches live in rules[0], not a new content.branches
kind. Every host validator change is in this table; no envelope widening or relaxed SB ID regex.

### A: extraction map

| Existing source | Destination/seam | Retire or redirect |
|---|---|---|
| SD `src/v2/quests/index.js:1041`, parse/progress/ranks | RB `src/v2/quests/`; retain quest.take/abandon/finish/payOwed and progress/details/ranks/owed queries | Remove SD registration and afterCapture payOwedHook (`index.js:1064`); transfer director.retriable and quest.board adapters to RB. One reward transaction. |
| SD `tracker/quest-lines.js:127`, `:335` | RB quest met/turn-in/settlement adapter using SD-owned thread writers | Remove SD quest.settle registration and beforeGenerate/afterCapture payout paths. Keep neutral thread capture/journal; add SD offer/accept/link/write/close and retry ledger (§3/P23). |
| SD `tracker/capture.js:269`, `tracker/index.js:20` quest branch | RB owns quest capture; SD owns offer/accept/link/write/close, including neutral acceptance | Remove RPG reward/ready/target parsing in SD. The same thread carries its rpg extension; no second ledger. |
| RB `combat/quest.js`, `party/commands.js:654`; SD reward calls `quests/index.js:418` | RB objective events + one party.grantXp/SB wallet settlement | Retire double fight/quest XP and coin hooks; preserve story-credit/owed deduplication. |
| SB `inventory.js:1227`, `:1768`, money.js | Stay SB; add rules.moneyPolicy/purse.currency delegation | **No money move** after log 796. Keep SB-alone budgeting fallback. |
| RB `items/commands.js:285`, `queries.js:185`, rules.js:38; SB inventory.js:1039 | RB eight-slot planner; E installs SB equipped record/definition-ID delegation | Replace six-slot limits consistently in rules, packs, prompt and UI; retain stack/to, add targetSlot. |
| NSD `src/npc-meters-presets.js:139`, `src/storysuite-v2.js:368`; SB meterPresets checker | NSD remains runtime preset owner; packs retain meterPresets kind | No preset engine to invent in RB. Move only any identified old RPG preset glue; do not displace existing NSD catalog. |

A supplies the pure quest planner over §4 public seam inputs and the rules.equipPlan projection
in §3. These perform no writes/narration; only owners commit their results. Explicit fixtures cover aliases and retired
payout hooks. For SD standalone, generic accepted goals/threads remain usable without RPG quests.

### B: rules and return core

Deliver the [four-entry design backlog](RB_TRACK_B_DESIGN.md), including its closed records,
shared-checker amendments and acceptance tests **before B's PR merges**. Review items 3–6 are
B's design responsibility; host guard/restore transport remains E's. B also implements §3 SD
check links/region/canonical-place adapters and NSD identity/participant integration, reviewed
with those owners; lead applies shared registration. First slice: 5/5 cap, promotion/class swap
and deleted-prerequisite replay. Public seams must match this contract. C receives B's internal
combat/training projections after B4/B3, and D receives semantic schema amendments after B3.

### C: query/payload fixtures

Build against §3 views/payloads with SB widgets/tokens. Keep lean slot tiles, tap to arm then
unequip, collapsible companions (log 734–742). Party checklist and exactly three skills are
visible. Fixtures assert query outputs and command payloads, not screenshots alone.

| Fixture | Assertion |
|---|---|
| C01 fresh | Basic picker; created level1 PC, exactly three 0/5 skills. |
| C02 promotion | Level10 5/5,5/5,4/5 blocks; last credit enables child; atomic three-skill swap. |
| C03 max mastery | All 5/5; further uses zero; XP still advances. |
| C04 waiting | Level90 basic class: only promotion10, then ordered promotions, then six waiting paths without auto-picks. |
| C05 selected parent | Written step1; its own a/b/g step2; missing parent invalidates choice. |
| C06 training midnight | Day4 minute1410 → day5 minute30; day5 cap; re-read removes jump/completion/event. |
| C07 expiry | Deadline7200: 7199 active, 7200 expired before turn-in; repeat/chain displayed. |
| C08 roster | PC+2 active, 2 reserves, 2 temporary; temporary outside limit/carry/wipe rescue. |
| C09 hands | 2H clears offhand; offhand beside 2H refused; explicit dual-wield target; no self-qualifying gear. |
| C10 fight | Offer/manual active turn/finish, retained projections and stale board refusal. |
| C11 death | Pending/intervention/permanent companion death/wipe batch/missing snapshot. |
| C12 complete return | Faded interval, both RB/NSD companion alive, one wake, no retained duplicate reward. |
| C13 dependencies | Missing/late SD, unset clock, unknown tier, optional journal/social off; distinct UI states. |
| C14 replay | Swipe/re-read/middle deletion invalidates dependent choices/rewards/saves without substitutes. |
| C15 neutral threads | SB+SD only: offer hook→reader acceptance→generic progress/close; no party/quest lookup. RB repeat/chain creates fresh th_; accept+link stale/retry/failure is atomic. |
| C16 check links | Standalone bonus; create PC links chosen/default/new ca_ atomically; player unlink/relink; stale/duplicate target conflict; missing/dormant RB fallback; npcId reverse lookup. |
| C17 world identity | rg_ create/rename; explicit place membership; pack node canonical ID stable before/after materialization; ambiguous names/binding hold; world/region/place override precedence. |
| C18 generated inputs | Generated story/craft/trade def+rule+grant transaction; immutable conflict/no source refused; authorized flag event and deleted evidence; queries never assign IDs. |
| C19 native identity | Hydration/scan/import/manual mutation assigns one np_; rename stable, unknown/ambiguous lookup null; checkpoint restores map and reverse lookup with dossier bytes. |

### D: schema and Studio engine

Deliver §7 schema/checker/normalization/export shared with SB import and RB activation. Valid
fixtures: small complete tree with 24/12 graph, each effect variant, generated-parent step2,
seven renamed stat labels, 2H/dual-slot items, trainer events and typed quest/shop/recipe.
Round-trip twice with identical bytes/hash. Invalid fixtures: unknown top-level field, old SB
unknown kind/capability, duplicate/generated ID collision, tier/cycle/orphan, missing reference,
12-versus-24 written graph, non-three skills, numerical/transform/budget closure failure,
markup/unsafe key, generated legendary, oversized graph/file. Include fixtures for defaults
and foreign place/NPC refs that pass structure but block runtime eligibility.

Later log 798 puts schema/checker in SB and engine/export/undo/docs in Story_studio. Part 1:
schema data, validator, document state, stable export, edits with undo, unstyled development
page/smoke, fixtures, docs. Styled UI waits for approved mocks; then SB widgets/tokens
(log 777, 797–798). Engine fixtures do not approve styled UI. Dependent work waits for freeze.

### Golden fixture seed and end-to-end trace

These constructors define public query/command fixtures; owner initializers and the B backlog
supply private storage records. They do not claim that internal combat/death design is complete. `H` is the SHA-256 of the normalized fixture pack+schema+constants;
`payloadHash`/lineage are recomputed by E from the full host payload/prefix, not arbitrary IDs.
Runtime fixtures add unchanged domain slices from real module initializers, then host-snapshot
**all** registry entries; never hand-construct only five slices. NSD uses synthetic native data.

```js
function smallRulesPack() {
  const classes=[], skills=[], branches=[];
  for (let tier=0;tier<4;tier++) {
    const names=[0,1,2].map(n=>`s${tier}${n}`);
    classes.push({slug:`c${tier}`,name:`Class ${tier}`,tier,parent:tier?`c${tier-1}`:null,skills:names});
    for (const slug of names) {
      skills.push({slug,name:slug,base:{type:'physical',stat:'STR',unit:null,
        cost:{mp:0,sp:1,cooldown:0},effects:[{op:'damage',target:'one',power:20*(tier+1),element:'none',damageType:'physical'}]}});
      if (tier!==3) continue; // no starter branching
      const base=`${slug}-base`;
      for (const parent of [base,...['g','a','b'].map(c=>`${base}-${c}`)]) {
        const step=parent===base?1:2;
        for (const choice of ['a','b']) {
          const transforms=step===1
            ? [{op:'set-element',at:0,value:choice==='a'?'fire':'ice'}]
            : [choice==='a'?{op:'set-target',at:0,value:'all'}:{op:'set-element',at:0,value:'lightning'}];
          branches.push({slug:`${parent}-${choice}`,name:`${parent}-${choice}`,skill:slug,fromForm:parent,step,choice,transforms});
        }
      }
    }
  }
  return {id:'fixture',version:'2.0.0',name:'Fixture',requires:{storyBlock:'^2',capabilities:['rb-rules-v2']},
    content:{rules:[{slug:'rules',name:'Fixture rules',schema:2,classes,skills,branches,itemRules:[],trainers:[]}],
      items:[],creatures:[],shops:[],recipes:[],quests:[],places:[{slug:'haven',name:'Haven',x:0,y:0},{slug:'mill',name:'Mill',x:1,y:0}]}};
}
function goldenSeed(H,payloadHash,lineage) {
  const source={sid:'sr_00000010',swipeKey:'sw_00000010',evidence:'ev_00000010',ordinal:0};
  const cursor={sid:source.sid,swipeKey:source.swipeKey,block:'bl_00000010',op:0,rev:10};
  const actor={id:'ac_00000001',name:'Astra',kind:'pc',npc:null,npcId:null,role:'traveller',portrait:null,
    background:'',origin:{race:null,talents:[]},tags:[],createdAtMinute:14400,growth:'manual',
    control:'player',life:'alive',level:1,earned:0,levelSteps:{},points:0,
    stats:{STR:15,VIT:5,AGI:5,DEX:5,INT:5,LUK:5,CHA:5},
    hp:{cur:74,max:74},mp:{cur:32,max:32},sp:{cur:40,max:40},conditions:{},
    class:'pack.fixture/c0',classPath:['pack.fixture/c0'],
    skills:[0,1,2].map(n=>({skill:`pack.fixture/s0${n}`,form:`pack.fixture/s0${n}-base`,steps:0})),temporary:null};
  const friend={...structuredClone(actor),id:'ac_00000002',name:'Lyra',kind:'companion',
    npc:'Lyra',npcId:'np_00000001',control:'auto'};
  const quest={id:'th_job00001',template:'story/walk',instance:1,title:'Visit the mill',
    category:'side',giver:null,turnInPlace:'pack.fixture/haven',requirements:[],
    objectives:[{id:'ob_00000001',kind:'visit',place:'pack.fixture/mill'}],evidence:{},
    reward:{coin:30,xp:25,items:[]},storyCredit:{coin:0,claims:[]},acceptedAt:null,acceptedCursor:null,
    deadline:null,repeat:null,chain:null,state:'offered',settlement:null};
  const snapshot={id:'sp_00000010',capturedAtRev:10,label:'Day 10 start',kind:'day-start',name:'Day 10 start',
    epoch:'ep_00000001',target:cursor,eligibleFrom:cursor,minute:14400,day:10,
    scene:{place:'pack.fixture/haven',text:'Haven at dawn'},journal:null,payloadHash,
    participants:[],lineage,available:true};
  return {H,source,cursor,actor,friend,quest,snapshot,
    publicOnly:true};
}
```

Query fixtures are deterministic projections of that seed. The following constructor supplies
full sheet/progress/quest/return outputs and action payloads for C's critical states without B.
Other cases apply the explicit C01–C19 mutations above to these builders; pinned combat views
come from the retained sessionView shape in the appendix, not invented session fields.

```js
function queryFixtures(seed) {
  const {H,actor,quest,cursor}=seed, ref=x=>`pack.fixture/${x}`;
  const slots=['weapon','offhand','head','body','legs','feet','accessory-1','accessory-2'];
  const thresholds=[1,5,12,22,35];
  const masteryOf=uses=>thresholds.filter(at=>uses>=at).length;
  const skill=(key,form=`${key}-base`,uses=35,steps=0)=>({skill:ref(key),form:ref(form),name:key,
    mastery:masteryOf(uses),uses,nextAt:thresholds.find(at=>uses<at)??null,steps,
    formMastery:{[ref(form)]:{uses,mastery:masteryOf(uses)}}});
  const sheet={id:actor.id,name:actor.name,role:actor.role,portrait:null,background:'',origin:actor.origin,
    kind:'pc',npcId:null,control:'player',life:'alive',level:10,xp:0,xpToNext:100,stats:actor.stats,
    unspent:36,hp:{cur:110,max:110},mp:{cur:50,max:50},sp:{cur:58,max:58},conditions:[],
    class:ref('c0'),tier:0,skills:[0,1,2].map(n=>skill(`s0${n}`)),
    gear:Object.fromEntries(slots.map(k=>[k,null]))};
  const progress={actor:actor.id,level:10,class:ref('c0'),tier:0,
    checklist:sheet.skills.map(s=>({skill:s.skill,form:s.form,mastery:s.mastery,needed:5})),
    promotions:[{milestone:10,eligible:true,choices:[ref('c1')],why:[]}],pathways:[]};
  const restoreAt={sid:'sr_00000015',swipeKey:'sw_00000015',block:'bl_00000015',op:0,rev:15};
  const lastReturn={id:'rt_00000015',deathEvents:['de_00000015'],batchResult:{id:'br_00000015',hash:H},snapshot:'sp_00000010',target:cursor,
    restoreAt,oldEpoch:'ep_00000001',newEpoch:'ep_00000002',faded:{after:cursor,through:restoreAt},
    memory:'deja-vu',cue:'cu_00000015',status:'complete'};
  return {
    C02:{queries:{'rules.sheet':sheet,'rules.progress':progress},command:['class.choose',
      {actor:actor.id,milestone:10,class:ref('c1'),expectedClass:ref('c0'),rulesHash:H}]},
    C03:{queries:{'rules.sheet':sheet},attempt:{expectedAward:0,reason:'mastered'}},
    C05:{queries:{'rules.progress':{...progress,level:50,class:ref('c3'),tier:3,promotions:[],
      checklist:[0,1,2].map(n=>({skill:ref(`s3${n}`),form:ref(`s3${n}-base${n===0?'-a':''}`),mastery:5,needed:5})),
      pathways:[{milestone:50,eligible:true,skills:[0,1,2].map(n=>{const f=`s3${n}-base${n===0?'-a':''}`;
        return {skill:ref(`s3${n}`),fromForm:ref(f),step:n===0?2:1,options:['g','a','b'].map(c=>ref(`${f}-${c}`))};}),why:[]}]}},
      command:['path.choose',{actor:actor.id,milestone:50,skill:ref('s30'),fromForm:ref('s30-base-a'),option:ref('s30-base-a-g'),rulesHash:H}]},
    C07:{queries:{'director.time':{minutes:7200,text:'Day 5 start'},'rules.quests':[{...quest,state:'expired',acceptedAt:7100,
      acceptedCursor:{sid:'sr_00000007',swipeKey:'sw_00000007',block:'bl_00000007',op:0,rev:7},
      deadline:7200,settlement:{id:'st_00000007',source:seed.source,outcome:'expired',coinPaid:0,xpPaid:0,itemsPaid:[],
        claim:'rb:ep_00000001:quest:th_job00001:1:settled'},ready:false,blocked:['Expired'],remainingMinutes:0}]}},
    C12:{queries:{'return.status':{dead:false,point:null,pending:false,memory:'deja-vu',lastReturn}},
      command:['return.cue',{return:lastReturn.id}],expectedCaller:'host-complete-token'},
    C14:{result:{ok:false,code:'REPLAY_PREREQUISITE',message:'The earlier prerequisite was removed.'}}
  };
}
```

Constructor output is input to owner initialization, not permission to draft other modules.
Resolve fixture refs and initialize B's private records through its validators. Register the
story/walk template through B3, then call SD threads.offer with write wr_00000011,
thread th_job00001, kind hook, key/summary "Visit the mill", fields:{}, expectedHash:null and
quest. No direct director.keys/thread writes. quest.take then invokes atomic threads.accept.
Snapshot precedes that offer. NSD hydration assigns np_00000001 to synthetic native data through
its native mutation wrapper; use its real checkpoint/hash in participants. Restore enumerates
all registered slices, including a synthetic extra domain, rather than a hand-picked list.

| Source cursor/input | Expected state/record |
|---|---|
| sr_00000010: day10 start minute14400 at pack.fixture/haven, coin100 | Snapshot sp_00000010: both actors alive, coin100, XP0, no thread/payout claim. |
| sr_00000011: visible th_job00001 offer | quest.take {id:'th_job00001'} accepts extension instance1; coin100. |
| sr_00000012: visit pack.fixture/mill, then giver/settlement in Haven | quest.finish {id:'th_job00001'} pays coin30/XP25 once, closes same thread/journal; retry unchanged. |
| sr_00000013: day11 boundary minute15840 | Eligible automatic target is sp_00000010, not day11. Attach visible day10 recap without altering payload. |
| sr_00000014: companion lethal ev_00000014, sealed db_00000014, die2/mod0/DC15 | RB death + NSD confirmed-death durable ack; target snapshot unchanged. |
| sr_00000015: PC/all durable down, summons standing | Single wipe db_00000015; check:null, direct PC death; no recent manual → sp_00000010. |
| sr_00000015: authenticated host restoration | Time14400/Haven/coin100/XP0; thread absent, training/gear/combat/effects/native state as saved; both alive. Old reward claims gone; monotonic revision/new epoch/audit retained. |
| sr_00000016: waking passage | Exactly one cue; vague déjà vu; faded text/ops excluded from active prompt/extraction/native scanning, raw messages still readable. |

Variants: manual sp_00000012 after reward outranks automatic and retains coin130/done on death;
removing its carrier removes eligibility. Delete reward carrier: payout/closure/claim vanish
together. Two thread IDs instance1 never collide. Re-read clock across midnight or cap exhaustion,
including a zero-award attempt; >200-carrier trim; shifted swipe index; deletion between three
checkpoints; missing target/checkpoint; native failure and crash after every prepare/commit/ack;
swipe away from restore before native scanning. C01–C19 are mutations of this seed with exact
query/command/receipt assertions, including error codes, not screenshot-only descriptions.

All tracks need lead-owned registration/settings, exact integration pins, error/receipt fixtures
and this scenario passing. Required merge order: phase0 freeze → **E host gates** → A → B → C wiring →
integration/matrix → user test. D’s pure schema may proceed in parallel; host import waits for E. D's schema gates content/import/UI fixtures; balancing follows the
approved formulas, not a divergent validator.

## 11. Decided: the user's answers

| Retained decision | Log lines, later correction where relevant |
|---|---|
| SB hub/inventory; SD genre-neutral world/clock/threads/checks; RB RPG rules; NSD relationships; item defs RB/pack, stacks SB | 748, 752–756, 773 |
| Save points stay SB | 752 replaces initial move in 748 |
| Purse stays SB and works without RB; RB prices/rewards/sinks and optional currency override | 796 replaces 795(1) and money move in 778 |
| Fresh start; fixed structure, generated content validated for lore/area; standard pack Studio baseline | 749–750, 755 |
| Cap99; classes at 0/10/20/30; always exactly three skills; class change swaps all three, nothing inherited; pack alone defines "already stronger", checker does not enforce it | 758, 800 replaces inherited/active split748; latest USER814 |
| Promotion needs level and three 5/5; combat/narrative/training uses, paid SD time/events, reply/day caps, XP continues, Party checklist | 759; new skills 0/5 is implication recorded at 800; form resets P02, mastery schedule P19 |
| 40–90: one step each ten levels, three advanced skills twice, current form5/5, 1 generated+2 written, step2 from selected step1 | 758–759, confirmed800: 24 written+12 generated per advanced class |
| Keep seven keys STR/VIT/AGI/DEX/INT/LUK/CHA; pack labels only | 795(4) supersedes six-stat wording |
| Player stat spending, no respec; eight slots after beta; 2H/dual wield; stat requirements, no class locks; weight | 742, 748, 764, 771 |
| Full companion sheets, code AI/manual toggle, PC+2 active, relationship NSD | 748, 756, 773 |
| Pets/summons temporary combat units; summons outside PC+2 | 762, 795(3) |
| Optional SD factions/reputation, area rarity through epic, pack-only legendary, unique named items, validated sinks | 761, 765–766 |
| All quest types, SD-clock expiry; crafting for everyone scaled by stats | 767, 769 |
| Narrated level-ups/promotions/steps, situation-dependent adjustable prompt cap, difficulty if cheap | 768, 770, 772 |
| Battle HP0 downed; wipe directly causes PC death/return, bypassing narrative lethal check; companion recovery with injury; code decides permanent companion death | 763, 774, 800; latest USER814 |
| Non-wipe narrative lethal check: dead or gravely injured unless intervention | 774, 814 |
| Healing keeps current combat maths, including attack bonus and seeded variance | Keep-maths748; clarified814 |
| xpPerLevel is a multiple of ten, matching retained adapter | Clarified814 |
| PC death restores saved state/companions; retained chat/faded marker/waking scene | 774–775 |
| Manual saves plus automatic target at the **START of the previous narrative day** (death day11→start day10), tied to journal | 795(2), latest USER save correction809; replaces danger-point saves775 |
| If a manual save is more recent than the automatic one, death returns to the most recent save | Latest USER save correction809 and this revision request |
| Default déjà vu; setting none; full memory pack option | 776 |
| Upgraded thread stays SD journal, closed with quest outcome | 795(5) |
| Separate tracks/folders; lead shared integration; later Studio repo split and hold for freeze | 777–782, 797–802 |

§12's approved recommendations sit under these decisions and never override them; a later change to one of their
numbers needs a USER line in V2_LOG.md and does not reopen an accepted rule.

## 12. For the user

DECIDED (USER, 2026-10-24): every proposal below is approved as recommended, with two changes: P11, the six-unit
limit and the fight-end dismissal apply to combat; outside combat a summon or pet may still exist in the narrative if the
story needs it. P13, the manual-save cap is 10 (not 20).

These were the remaining proposals, with recommendations. B-only
record/interpreter work is in the [backlog](RB_TRACK_B_DESIGN.md) and must pass its merge tests.
P20 (revisit) and P21 (wave healing) are retired: no respec and retained combat maths settle them.
There is no question about wipe checks, class-swap strength, healing maths or XP divisibility.

| ID | Proposal needing the user | Recommendation |
|---|---|---|
| P01 | Pack transport/schema/limits, one content.rules manifest, immutable timeline closure and SB definition-ID lookup/registration | Approve; E capability/registration first; B3/D complete semantic inputs before B merges. |
| P02 | Play level1 after basic pick, base5/start10/4 points per level/cap99, default100 XP, new forms0/5 | Approve; any xpPerLevel10..10000 must be divisible by10 (decided). |
| P03 | Shared skill2/10 and actor6/30 reply/day caps; 60-minute/two-use training; recorded10% interruption/no refund | Approve; retain all paid attempts, including award0. |
| P04 | Oldest milestone first; any eligible advanced skill; 1..40 classes/up to6 roots and6 children; optional display-only replaces | Approve; no strength comparison, inheritance or automatic picks. |
| P05 | Danger tiers0..9; place→region→world; unknown holds; proposed foe/rarity ceilings | Approve; B3 specifies template budgets, never ceiling-only validation. |
| P06 | Typed form budgets12/24/36/48, +12/step; deterministic g transform and closure validation | Approve B3 baseline; retain existing attack/heal maths. |
| P07 | Slot IDs, targetSlot/swap, dual-wield bonuses, active-member carry and host-validated equipment plan | Approve; SB owns equipped records; no payload bypass. |
| P08 | Expiry at now>=due before settlement; atomic rewards/closure; overweight hold; repeat/chain fresh offers | Approve. |
| P09 | Standalone SD check actors/settings, explicit optional RB links and at most one RB/NSD contribution | Approve; preserve topic/talent/item/effect/burden adapter; RB absence uses standalone policy. |
| P10 | Non-wipe DC15 VIT lethal check,1HP/24-hour/−2 STR+AGI injury and sealed simultaneous batches | Approve; wipe bypass is decided and excluded from this proposal. |
| P11 | Reserve/active roster commands, six temporary units, fight-end dismissal, reserves/temporary excluded from wipe rescue | DECIDED with a change: the six-unit limit and fight-end dismissal apply in combat; outside combat a summon/pet may remain in the narrative. |
| P12 | Guarded root blocks, canonical source map, suffix reconciliation and retained recorded draws/results | Approve host guarantees in §6 and B5 predicate design; no automatic replacement choices/dice. |
| P13 | Initial fallback without previous-day anchor, skipped-day anchors, cap 10 manual saves (USER), tie/ancestry order and full native protocol/text exclusion | Approve; decided previous-day/more-recent-manual policy stays fixed; missing bytes hold. |
| P14 | Ready RB currency override through SB formatting and level-based credit/debit caps, no balance conversion | Approve; cap=max(1,round(1000*level*inventory.economy().scale)); SB fallback remains. |
| P15 | Normal-only first release; situation-dependent prompt cap500..8000/default2000 | Recommend normal-only and stated cap; memory options stay as decided. |
| P16 | Keep shipped public {cur,max} pools and private loss bookkeeping | Approve; numeric resets absolute. |
| P17 | Keep director.threads[id].rpg as sole quest store | Approve; SD writes, RB computes mechanics. |
| P18 | Keep party.grantXp shipped selectors and difficulty ownership | Approve; no who alias or payload change. |
| P19 | Cumulative mastery [1,5,12,22,35], numeric factor1+.1*mastery, retained per-form history | Approve; explicit replacement for incremental schedule. |
| P22 | Preflight/peer semver and dormant/ready/restore-pending lifecycle, including discovery and SD fight probe | Approve; E gates activation and suppresses dormant encounter requests. |
| P23 | SD offer/accept/link/write/close contracts, expected hashes/retry ledger and neutral player acceptance | Approve §3; acceptance+rpg and settlement+closure atomic, story cannot auto-accept. |
| P24 | Explicit check links/creation behavior; SD region/membership/canonical place identities; NSD native surrogate assignment/reverse lookup; generated item/rule and authorized flag writers | Approve §3/§8; queries read-only, no name guesses, owner writes and replay-safe ledgers. |
| P25 | Internal narrative-use payment, requirement scope and template-based generation bounds | Recommend pay once or reference surviving payment; current class/done quest+thread/active-party items/declared event flags per B3; publish exact numeric template budgets for review before B merges. |

### Stage 5: open quest templates

`content.quests` also accepts `open:true` with an explicit `rank` naming `content.ranks[].id`.
Its `reward` is exactly `{coinMin,coinMax,xpMin,xpMax,items:[]}`; both ordered ranges must lie
inside that rank's published `reward:[min,max]` range. Closed templates retain numeric rewards
and complete objectives. Open objectives retain their kind, ID, count and consumption policy;
only `foe`, `def`, `place` or `text` may be omitted for explicit offer binding. A kill may carry
`allowVariants:boolean`. Repeat and chain are null for open templates: another offer requires
another explicit binding. Runtime extensions always carry complete objectives and fixed numeric
rewards. RPG Battle records the area evidence and computes each reward as
`min + floor((max-min)*areaTier/9)`. The schema hash changes; existing timeline pins keep their bytes.

### Stage 7: open trainer templates (2.4.0)

`content.rules[0].trainers` also accepts a template: `open:true`, a `rank` naming `content.ranks[].id`,
`skills` (1 to 30), `fee:{coinMin,coinMax}` (each 1 to 1,000,000, `coinMin` not above `coinMax`),
`minutes:60` and `eventTemplates`. A template has no `place`: writing one is refused. A fixed trainer is
unchanged and may write `open:false`. Fixed trainers and templates share the one list (100 entries at most) and
one slug space. Unlike an open quest, the fee range is not held inside the rank's reward range; the authoring
kit's checker notes a range above the rank's reward maximum. The schema is `$defs.trainer = fixedTrainer |
openTrainer`, with `openFee` for the range. A consumer tells a template from a fixed trainer by `open === true`
only. Story Block validates and exports templates and nothing more: RPG Battle 2.2.0 owns the `trainer` line,
the reader action, the offer (the fee is rolled once when the trainer is offered and recorded with it) and the
guard. The schema hash changes; existing timeline pins keep their bytes. Story Block 2.4.0 and RPG Battle 2.2.0
ship together.

### Stage 8: generative offers (2.5.0)

Three optional additions to the rules schema; a pack that writes none of them reads exactly as before.
`$defs.openObjective` kill and collect branches take `countMin` and `countMax` (integers 1 to 999); when given, the
checker requires `countMin <= count <= countMax` and refuses a count outside them as `bad-schema` at
`…objectives[i].count` (an inverted range as one `bad-schema` at `…countMax`). `$defs.foe` takes `aliases` (0 to 8 unique
strings of 1 to 80 UTF-16 units: other names the story may use for the creature); the checker also refuses, as `bad-schema`
at the alias, one that equals (folded: capitals ignored, white space collapsed) its own foe's name or slug, any other foe's
name or slug, an earlier foe's alias or an earlier alias of its list, or has no visible character. The resolved foes keep them. The rules manifest takes `offerWords` (`$defs.offerWords`, eleven
optional lists named `hunt, cull, gather, deliver, explore, escort, task, easy, normal, hard, nightmare`, each 0 to 40
lower-case words of 1 to 24 UTF-16 units; a capital letter is `bad-schema` at the word). Story Block validates, exports and
resolves them and nothing more: RPG Battle 2.3.0 reads them when the narrator offers a job in its own words. The Assist
safety net never writes `+ quest` or `+ trainer` under any `assistExtractorKinds` (`assist/safety.js` `refusedWhy`); `~ quest`
and `- quest` are unchanged. The schema hash changes; existing timeline pins keep their bytes. Story Block 2.5.0 and
RPG Battle 2.3.0 ship together.
