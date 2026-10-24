# RB track B design backlog — phase 0 v4

Read with [the phase 0 contract](RB_CONTRACT.md) and [API ledger](RB_CONTRACT_APIS.md).
These are the four RB-internal findings from the last review, one entry per item.
They are **required design and acceptance work before track B's PR merges**, not additional
phase 0 blockers. Host interfaces, owner writes, pack transport and native participation remain
in phase 0; B must implement against E's tested host gates. Proposals below refer to numbered
questions in phase 0 §12: Approved recommendations, subject to the P11/P13 corrections in V2_LOG.md (USER, 2026-10-24); implementation remains pending. A missing decision cannot be filled silently.

Binding constraints throughout: exactly three current skills; swaps inherit nothing; permanent
paths/no respec; pack authors alone decide whether replacement skills are stronger; cap99;
xpPerLevel10..10000 in multiples of ten; retained combat maths including healing attack bonus
and variance; HP0 is downed; a wipe directly causes PC death/return without a lethal check;
PC return restores saved state and companions under the latest previous-day/manual-save rule.

## B3 — review item 3: complete rule inputs, proofs and generation bounds

**Problem.** Shape validation alone cannot decide rules. The v3 resolved table had ItemRules
without frozen ItemDefs, origin tags or trainer events, and stored generated forms without
generated foes/quest templates. Story objectives/rescues lacked enough identity to prove one
specific action. Narrative use payment, requirement scope and item/foe generation budgets were
undefined. An area ceiling cannot be enforced by an adapter that receives no area.

**Code touched** (repository paths, current evidence):

| File:line | Design consequence |
|---|---|
| [SB packs/content.js:12](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/packs/content.js#L12), [content.js:106](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/packs/content.js#L106) | Item projection is partial and name lookup depends on installed packs; freeze complete definitions through the new owner APIs. |
| [SB packs/validate.js:243](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/packs/validate.js#L243) | Existing arbitrary integer stats/object effects do not enforce RPG budgets. |
| [RB checks/modifiers.js:207](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/checks/modifiers.js#L207) | Talent tags currently come from creation.content; remove this live-pack dependency for a running timeline. |
| [RB party/commands.js:162](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/party/commands.js#L162), [creation/commands.js:195](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/creation/commands.js#L195) | Freeze origins and class choice at creation; link SD check actor atomically. |
| [RB craft/make.js:209](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/craft/make.js#L209), [trade/core.js:463](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/trade/core.js#L463) | Generated item IDs/provenance must reach rules.registerItem before grant. |
| [RB templates.js:638](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/templates.js#L638), [templates.js:665](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/templates.js#L665), [combat/setup.js:1](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/combat/setup.js#L1) | Legacy cleaners cannot interpret ref-based skills/loot or preserve all v2 fields. |
| [SD quests/index.js:344](https://github.com/kohz87/Story_director/blob/8072d60fb23bd7f3de4f5dc0379b3f0135e35c07/src/v2/quests/index.js#L344), [tracker/quest-lines.js:127](https://github.com/kohz87/Story_director/blob/8072d60fb23bd7f3de4f5dc0379b3f0135e35c07/src/v2/tracker/quest-lines.js#L127) | Extracted mechanics must use SD writers and preserve accepted-thread identity. |

**Decision / proposed design.** B owns new RB rules/progress/training records and adapters;
A owns quest/item routing; D owns shared schema/checker data. Freeze one content closure per
timeline: complete ItemDef values and rules, race/talent tags, trainer event definitions,
foes, quest templates, generation templates and declared flag transitions. Add closed storage
for generated FormDef/FoeDef/QuestTemplate and def+rule provenance, keyed by SB definition ID.
Keep source template, canonical area snapshot, rules hash, source and unique acquisition claim.
No live installed-pack lookup may change a historical number. B and D must supply the closed
event/template/flag schemas and update the structural schema together before B merges.

Under P02/P04/P19, preserve the proposed baseline: play starts level1 after basic pick,
base stats5/start points10/4 per level/stat cap99; cumulative mastery [1,5,12,22,35] and
factor1+.1*mastery; each new class/form starts0/5. Only the oldest unconsumed milestone is
offered; no choices during active/unsettled combat. Promotions need level and all three5/5,
direct next-tier child; paths need advanced class, previous milestones and selected form5/5.
Choose any skill with fewer than two steps; consume one milestone and reset only its new form.
Retain previous forms/classes and all paid attempts for replay/caps; no revisit entitlement.
XP keeps flowing while choices wait. Use fitted public pools and earned-XP/level-step records,
with absolute owner resets and point debt after a removed award; do not invent a lost-only API.

P03 shares skill2/reply/10/day and actor6/reply/30/day caps across combat/narrative/training.
Keep every paid attempt, including zero-credit cap/mastered/clock-held results, with action
Source plus capSource, skill/form, minute/day, cost reference, award/reason and session reference.
Combat capSource is end settlement, narrative is its own boundary, training is completion;
day=floor(minutes/1440), never wall time. Derive form mastery and cap caches from surviving
attempts, including old classes/forms. A new form cannot reset actor/day caps.

Proposed training: skill.train only requests; trusted rules.settle validates trainer/place,
then atomically charges SB and advances SD60 minutes. One start/carrier and one running session
per actor; two completion credits subject to caps. Record the 10% event die and selected frozen
event/null once; interrupted sessions give no completion credit and no automatic refund.
Reject the whole start if actual SD advance differs. Store request/session/status/start/end,
fee, event/result, attempts and references; restoring a running paid session cannot charge again.

Publish closed proof payloads through SB's Proof envelope. Story objective proof must bind
thread ID + instance + objective ID + exact validated action/source. Rescue proof must bind
lethal event/batch, rescued actor, living rescuer, stable skill/form/effect, active source,
cost/payment reference and one-time consumption. A generic visible story line is insufficient.
Under **P25**, recommend narrative skill-use pays its normal pool/item cost in the same root
transaction, or references one surviving already-paid action; never both, never free mention.
Parent proof deletion must retract credit/flag/objective/rescue use and its claims.

P25's recommended requirement semantics, to encode in one shared evaluator:

| Requirement | Recommended meaning |
|---|---|
| class | Current class only, not ancestry; no inheritance implied. |
| quest | A surviving done instance of that template; offered/active/failed do not satisfy. |
| thread | Surviving resolved/done generic thread with that exact ID. |
| item | Party bag plus active durable members' owned stacks; exclude reserve/temporary; select exact consumption stacks. |
| stat / level | Subject actor's base stat/fitted level; gear cannot qualify itself. |
| place | Current SD canonical ID, never display name/node key. |
| flag | Declared boolean default false; only validated authorized event through rules.flagSet. |

P05/P06 propose area tiers0..9, level ceiling min(99,10*(tier+1)) and common/uncommon/rare/epic
ceilings at0–1/2–3/4–6/7–9. B must specify exact generated item-stat/effect and foe-stat budgets,
cost floors and clamp/rejection order from frozen templates; rarity/level limits alone fail.
P25 recommends template-derived ceilings, rejecting an unbudgeted template rather than guessing.
Publish those numbers and checker fixtures with D for review before merge.

Preserve the existing P06 candidate for forms: one/self/ally target factor1, all/allies3;
damage/heal/shield ceil(power/10), condition ceil(chance/25)*rounds, stat2*abs(amount)*rounds,
sum score×target factor plus unit12. Tier budgets12/24/36/48, +12/path step; costs do not refund
budget. Deterministic g clones the selected parent, adds20 to first numeric effect's power,
else +1 first stat magnitude, else +1 first condition round; preserve other fields. Invalid
bound/budget closure rejects the parent. Written a/b must change behavior, not only numbers.
There is no child-class strength comparison, including optional display-only replaces links.

Define `foeToEngine(foe,{rules,forms,items,area,ordinal})` with canonical AreaTier input. Validate
area/allowlists/budgets/refs; derive pools/attack/defence/crit with retained formulas and empty
gear; map skill refs to frozen base forms and loot refs to complete defs. Remap engine enemy,
wave, action and order IDs to collision-free fo_ records before storing. Keep per-member
foeXpWorth difficulty/level-gap calculation, and stored loot quantity ranges; no legacy cleaner
substitution. Private adapters are not additional public module APIs.

**Acceptance before B merges.**

- Remove/replace an installed pack and reload: unmaterialized items, origin modifiers, trainer
  events, generated foes/quests and historical outcomes stay byte/hash-identical.
- Exactly three skills after every swap; weaker child-class skills validate; predecessor
  strength is never checked. Complete 24-written/12-generated selected-parent graph passes.
- Uses0/1/5/12/22/35 project mastery0/1/2/3/4/5; caps span forms/classes; mastered uses award0,
  XP continues; deleted award fits level/points/pools and deactivates dependent picks.
- Narrative use charges once; already-paid reference never charges twice; insufficient cost,
  reused proof, wrong thread/instance/objective/event or dead rescuer refuses atomically.
- Table-test every requirement (especially ancestral class, active quest, reserve item, missing
  flag and ambiguous place). Flag mutation cannot be invented by a narrative number.
- Malicious generated huge stats/effects, wrong template, forbidden foe/tag, generated legendary,
  unknown area and exceeded closure all reject or clamp exactly as the published budget rules.
- Training crosses midnight, caps/interruption apply on recorded completion day; same request
  reuses event/null draw; failed SD advance leaves no fee, event or credit.
- xpPerLevel100/1010 round-trip unchanged;1001/fraction/overflow reject in checker, Studio and runtime.

## B4 — review item 4: combat actions, effects and condition records

**Problem.** The allowed form can hurt one foe and heal one ally, but today's action has one
target. Stable form IDs, random draws and effect-specific targets are not represented fully.
Regeneration strength, shield expiry, retained daze and the ending-minute condition anchor
must survive engine conversion, replay and settlement.

**Code touched:** [RB combat/index.js:143](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/combat/index.js#L143)
(cleanAction), [:549](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/combat/index.js#L549) (act adapter),
[combat.js:552](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/combat.js#L552) (single target),
[:165](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/combat.js#L165) (skillValue),
[:213](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/combat.js#L213) (daze),
[:616](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/combat.js#L616) (healing),
[combat/stored.js:26](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/combat/stored.js#L26) (rebuild),
[combat/view.js:140](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/combat/view.js#L140) (UI projection),
[party/pools.js:74](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/party/pools.js#L74) (ten-minute post-fight expiry).

**Decision / proposed design.** Keep /combat/fights/<id> setup/actions as the sole authority;
no second live combat store. B must replace shorthand EngineAction/condition types with closed,
versioned records. Recommend stable action ID/Source, actor/base-skill/form/rules hash, ordered
effect-index→target-ID selections, one paid-cost record, actor-turn cooldown/expiry counters,
recorded draws and resolved results. Automatic actions obey the same format. Keep old action
payloads only for the isolated old runtime; supply C's new target-selection/action projection
and migration tests with B's design. Every effect validates its own side/scope; preview target
from the first effect cannot control all effects. Pay cost/cooldown once before effects.

Numeric powers are hundredths; apply proposed mastery factor once. Preserve retained stat
substitution **and gear attack bonus**, mitigation/hit/crit, random variance, rounding, clamps,
turn order, flee/parley and companion AI. Healing specifically follows skillValue × power ×
mastery × each target's recorded variance and retained heal rounding/clamp. Do not replace it
with a naked2*stat formula. Shields/regeneration retain resolved strength from their source;
record shield remaining and exact expiry actor-turn, regen tick strength and applier/attack
at application. Preserve daze behavior after repeated stun. New stat-shift effects refresh
identical source/effect/target, distinct sources add with effective stats at least1; base stats
and gear requirements stay unchanged. Round/reply/minute expiries use their recorded boundary.
Post-fight rounds carry the exact SD ending minute: each remaining round lasts ten minutes,
as today, instead of resetting its anchor on read/reload. Unknown clock must follow an explicit
held policy in B's design, never wall time. No wave heal or free dual-wield action is added.

Temporary units use a separate combat roster; its cap is six. Owner-level/class/template, statShare/poolShare and
fight/round expiry are frozen inputs. They have no permanent awards, carry capacity or wipe rescue. Fight-end/downed
dismissal removes the combat sheet only; fight-end does not remove a narrative summon/pet presence, and neither
restriction caps narrative presence outside combat (USER, P11). Reserves cannot rescue a wipe. Test: a summon keeps
its narrative presence across fight end while its combat sheet is cleared.

**Acceptance before B merges.** Mixed foe-damage/ally-heal form selects two legal targets and
charges once; malformed/wrong-side/duplicate effects refuse atomically. Stable skill/form IDs
survive rename and reload. Golden retained attack/heal/defend/flee/parley/AI traces match with
gear bonuses and nontrivial variance. Daze, regen ticks, shield depletion/expiry, cooldowns and
post-fight condition3→2 at endingMinute+10 replay identically. Swiping/deleting an action obeys
B5 without shifting later draws silently. C gets real payload/projection fixtures before wiring.

## B5 — review item 5: settlement guards and complete replay recording

**Problem.** A surviving start/form does not prove that a combat settlement is still earned.
Deleting the winning action, a paid use or prerequisite can leave stale loot/XP/mastery unless
the terminal result and surviving prefix are bound. One sequential RNG stream also changes
later draws when an earlier action disappears. E's guarded transport alone cannot define this.

**Code touched:** [RB combat/index.js:580](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/combat/index.js#L580)
(reconstruct/settle), [combat.js:1013](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/combat.js#L1013) (RNG replay),
[party/recovery.js:180](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/party/recovery.js#L180),
[craft/commands.js:284](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/craft/commands.js#L284),
[trade/index.js:152](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/trade/index.js#L152),
[SB store.js:344](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/store.js#L344),
[:831](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/store.js#L831),
[persist.js:268](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/persist.js#L268). E owns SB edits.

**Decision / proposed design (P12).** Specify closed predicate/recorded-input schemas per
operation, not only a general Guard. Recommend Guard.inputHash = SHA-256 of canonical normalized
`{version,operation:{type,payload},source,rulesHash,epoch,inputs,proofs:[{id,payloadHash}]}`;
inputs is that operation's closed projection of the expected prefix prerequisites/results.
Sort object keys and proof IDs, preserve semantically ordered action/target arrays; exclude
receipt display text, live settings and irrelevant revision counters. Owner callback receives
saved operation/payload/recorded data through phase 0 §6 and recomputes inputs from surviving
prefix state. Exact fields per operation and hash fixtures are B deliverables.

Combat end must bind fight/start/setup/rules hashes, ordered surviving action IDs and payload/
cost/draw hashes, terminal status/outcome and result hash, paid-use attempts and loot draws.
Recompute or verify the terminal prefix before any grant. If no longer terminal or a cost/proof
is missing, deactivate the entire settlement with all SB costs/rewards, XP/mastery/pools/wear,
SD objective/closure effects and root claims/cue. No permanent mastery at act; combat.end alone
awards it and suppresses the old party.applyResult uses/XP path.

B must explicitly choose a draw strategy in its design. Recommended P12 baseline: retain
complete per-action draws/cost/results and predecessor hash; invalidate the dependent action
suffix when the predecessor no longer matches. Replanning reuses recorded draws by action ID,
never slides a shared RNG stream or rolls new dice. If an input makes that recorded action
illegal, hold it; never silently select a replacement action. Automatic actions are included.

| Operation | Mandatory retained inputs / replay predicate |
|---|---|
| Class/path/stat/roster/control | Player selection, expected predecessor/form/level/mastery/points/offer, rules hash; lost prerequisite deactivates full block. |
| Combat act/end | Full action/cost/draw record and exact predecessor; terminal ordered-prefix/outcome guard above. |
| Narrative uses/sinks/lethal/rescue | Proof parents, payment/consumption and attempted award even0; changed evidence reuses original draw. |
| Training request/start/completion | Request/session/form/trainer, fee, actual SD time, event die/pick/null, completion capSource; no double time/fee. |
| Recovery/rest | Selected actors, condition/pool state, SD minutes, last-rest boundary, expected absolute resets/credit; deletion retracts dependent benefit. |
| Craft/make/commission/collect | Frozen recipe/def/rule/station, material stacks, payment, roll, SD advanced minutes or ready minute; time/material/cost/result atomic. |
| Consumables | Exact stack/qty/owner/target, payment at use, effect and action proof; never consume again at end or refund a still-surviving use. |
| Condition/unit/quest expiry | Exact surviving SD minute or actor-turn/reply boundary; expiry before dependent action/settlement. |
| Quest progress/finish/repeat | Thread+instance+objective proof, acceptance prefix, consumed stacks, story credit, typed payout and nested SD writer hashes. |
| Save make/forget/day anchor | Source/cursor/ancestry/native prefix; deleting forget restores eligibility, never deletes pinned bytes; changed clock replans anchor. |
| Death/restore/wake | B6 sealed-result/outbox ref, proof hashes, original dice, exact save/prepared token and acknowledgments; stale restore/cue retract before replan. |

At each surviving boundary recompute minute/day/caps/zero awards and derived mastery. Remove old
system ops/claims before atomically replacing them. Do not retain orphan claims or choose new
player selections. Results, hashes and draws live in durable blocks/owner records, not only
trimmed receipt display data. All reset operations are absolute at the owning numeric path.

**Acceptance before B merges.** Delete the winning action: no old XP/loot/mastery/quest proof
or settlement claim survives. Delete a paid use and an earlier promotion prerequisite: dependent
actions/choices/results deactivate together. Delete an earlier action with recorded later draws:
no RNG stream shift. Exercise zero-credit becoming eligible after cap/time edits, midnight
training, recovery resets, crafting/commission time, consumable use/end deduplication and
save-forget deletion. Re-read/swipe/reload and >200-carrier trimming produce identical active
state/results; two quests at instance1 do not collide; E's multi-checkpoint invalidation tests pass.

## B6 — review item 6: durable death, return and native recovery records

**Problem.** The former DeathDomain had no outbox/prepared manifest. Restoring that slice erased
fatal checks while ReturnRecord retained only event IDs, leaving no durable dice/results/acks
for changed-evidence reconciliation. NSD meter commands cannot confirm death or restore dossiers.

**Code touched:** [RB return/index.js:62](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/return/index.js#L62),
[:76](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/return/index.js#L76),
[party/commands.js:609](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/party/commands.js#L609),
[NSD storysuite-v2.js:75](https://github.com/kohz87/npc_state_delta/blob/b906544cea3f1f3a678a1d21528968b3c0321606/src/storysuite-v2.js#L75),
[:348](https://github.com/kohz87/npc_state_delta/blob/b906544cea3f1f3a678a1d21528968b3c0321606/src/storysuite-v2.js#L348),
[SB rewind.js:178](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/rewind.js#L178),
[store.js:344](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/store.js#L344). New RB death files and NSD participant
files are B-owned; E owns host archive/barrier/restore and lead owns shared registration.

**Decision / proposed design (P10/P13).** Keep one host-assigned batch per capture/fight-end
boundary. Seal after all evidence/interventions, resolve the batch in actor-ID order and record
all checks/results before effects; any PC death requests one return. Wipe records outcome dead
with check:null and proceeds directly to return; no narrative VIT roll. Non-wipe outcomes use
the approved lethal-check policy. Unknown linked native identity holds instead of guessing.

Before coding, supply closed DeathDomain event/batch/outbox records plus immutable prepared
manifest and retained BatchResult. They must retain source/proof hashes, actor↔npc IDs, cause,
intervention/payment consumption, original dice/modifiers/DC/outcomes (including null wipe
check), selected snapshot/hash, prepare token/head, native before/after checkpoints, manifest
hash, one return/cue ID and per-participant acknowledgment state/result. Recommend per-entry
transitions pending→prepared→host-committed→participants-pending→complete, with aborted allowed
only precommit; same ID/different meaning conflicts. Identical retry returns the original result.

RB commits its outbox reference with the confirmed batch; the host durably pins BatchResult and
prepared manifest **outside restored domains** before activation. ReturnRecord.batchResult
points to it. The restored DeathDomain may replace old events, but coordinator history can still
retrieve every original result/ack for B5 reconciliation. No new rolls or save selection during
ordinary replay/recovery. After commit, failure must recover forward before unblocking reads.

Participant prefix keys are `(chat lineage,canonical sid,swipeKey,block ID,op ordinal,prefixHash)`;
never native name, numeric swipe index or revision alone. Persist prefix→before/after checkpoint,
schema/hash and selected active checkpoint. Use the new read-only timeline.head accessor for
expectedHead. Every native write, including hydration identity assignment, scan/manual/import,
meter synchronization and confirmed death, goes through timeline.nativeMutation before exposure.
Full NSD checkpoints include native history/evidence, surrogate identity map and applied death
IDs; restoring the map and dossiers is one selection. Post-target IDs stay reserved in audit.

The SB host still snapshots every registered domain and its settings/claims, verifies schemas,
restores absolutely, overlays new epoch/return/target descriptor, switches all native participants
and publishes one wake after all acks. Its prepared/commit journal survives crash and selection
changes. Raw chat remains, while active history excludes the faded interval. B supplies records
and participant behavior; it cannot replace E's protocol with a synchronous native command.

**Acceptance before B merges.** Crash/reload after each durable write: outbox, result archive,
participant prepare, host prepare, absolute restore, each native activation/ack and completion.
Before commit retain the old consistent head; after commit finish the exact prepared choice
before any generation/scan/mutable read. Duplicate delivery returns the original ack; changed
meaning conflicts. Simultaneous companion+PC death makes one return, wipe rolls no lethal die,
and another timeline death cannot reuse the cue. Change lethal/rescue evidence or swipe/delete
the restore: retract stale return/cue, recover matching native prefix using original results,
never roll again. Identity rename/reverse lookup and map restoration remain consistent. Day11
returns start day10 unless a later manual save wins; missing bytes hold rather than substitute.
