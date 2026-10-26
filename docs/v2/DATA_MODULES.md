# Data-defined modules — Studio Part 5, Stage 1

Status: design for review; no runtime or authoring implementation in this change.
`content.dataModules`, capability `data-modules-v1`, and APIs named below are **proposed**.
Today's importer refuses this content kind. The JSON examples specify the proposed format, not
files claimed to pass today's checker. Existing pack formats and runtime contracts remain authoritative.

Read with [SPEC](SPEC.md) §§2–6/13, [MODULES](MODULES.md) §A/F121,
[PACKS](PACKS.md), [REPLAY](REPLAY.md), [LIFECYCLE](LIFECYCLE.md),
[LAYOUTS](LAYOUTS.md), [TEMPLATES](TEMPLATES.md), and
[Studio Part 4](../../../Story_studio/docs/STUDIO.md#part-4-settings-defaults-and-screen-builder).
Implementation references: SB `src/v2/{registry,commands,turn}.js`, RB
`src/v2/{module.js,quests/opening.js,fight/foes.js}`, SD
`src/v2/{module.js,checks,tracker}`. Current SD owns `check` and `checks.roll`;
the older RB check ownership described in parts of SPEC/MODULES is superseded by the shipped code.

## 1. Boundary and host placement

A data module is a closed JSON definition interpreted by trusted Story Block code. It can own
bounded fields, accept declared story proposals, evaluate conditions, change its fields, request
an approved check/reward, advance timers, expose public views, and present existing screens/layouts.
It cannot register executable parts. RB/SD's parts merge domains, kinds, commands, queries,
context and hooks into one native module; this runtime supplies that glue on the author's behalf.

Add a trusted SB part at `src/v2/data-modules/`, merged into **`story-block`**, with:

| Surface | Proposed registration |
|---|---|
| Domain | `dataModules`, `deferred: true`; absent until an explicit pin |
| Capture | One host-owned kind `dm`, enabled only when this chat has pins |
| Commands | `dm.pin`, `dm.attach`, `dm.act`, `dm.migrate`; internal `dm.capture`, `dm.tick` |
| Queries | `dataModules.offers`, `.view`, `.public`, `.replayInputs` |
| Context | Pinned grammar/static instructions; bounded state summaries in the tail |
| Hooks | `afterCapture`, `beforeGenerate`, `replyCard`, replay guard dispatch for `dm.*` |
| Presentation | Pinned definitions' screens/layouts through the existing renderer |

Use one owner and one wire kind: the registry's kind names are global and cannot contain `/`.
An authored kind is local to a definition, selected by `kind:`; two packs can both declare `rest`.
No per-chat registration/unregistration, no aliases that steal `rest`, `check`, `quest` or `time`.
Merge replay guards by predicate kind, preserving the existing timeline guard and its `hostOwned`
behavior. Unrecognized predicates fail closed; the new dispatcher must not change old answers.
Dependencies follow declared adapters; a chat-scoped module with local fields needs no SD or RB.
Static text depends only on pins: enable/migration changes it once; field/time changes never do.

**OUT:** author loops, recursion, functions, arbitrary JavaScript, `eval`, regex grammars, network,
filesystem, DOM, wall-clock time, background intervals, dynamic code/imports, unrestricted commands,
raw JSON Patch, arbitrary query names or state paths, reading another module's private state,
writing another owner's domain, and inventing actors/items/check outcomes. Other modules' data is
available only through explicitly declared public queries and reviewed adapters. Bounded host
iteration over declared rules, attached characters, and rendered lists is not an author loop.
Part 4's existing presentation repetition remains available; it cannot execute game effects.

## 2. Definition and expression contract

Add `content.dataModules: []` to PACKS; require `data-modules-v1` in `requires.capabilities`.
Definitions use `slug`, `name`, `schema: 1`, `stateVersion`, `scope`, `state`, `kinds`; optional
`imports`, `rules`, `timers`, `rewards`, `exports`, `screens`, `layouts`, `migrations` default empty
**inside this format only**. Unknown keys at every level are errors. ID: `pack.<pack-id>/<slug>`.
The shared SB checker exports descriptors, limits and diagnostics for Studio; no second schema.

`scope` is `chat` (one instance) or `character` (one instance per explicitly attached SD `ca_` ID).
SD's public actor projection supplies names and optional RB links; an `ac_` ID is never silently
treated as a `ca_` ID. Attach through Setup, not narration. A missing/ambiguous/removed actor
refuses a new action; its saved instance stays. No global persona state and no data shared by chats.

| Field type | Required constraints/default |
|---|---|
| `int` | Inclusive safe-integer `min`, `max`, `default` within them |
| `bool` | Boolean `default` |
| `enum` | 1–32 distinct literal `values`, `default` among them |
| `text` | `max` 1–240, literal `default`; display text only, never an expression |
| `map` | 1–16 fixed enum `keys`, scalar `values` schema; each key gets that default |

No growing authored arrays/maps, nullable arithmetic, coercion, floats or implicit field creation.
Field/key slugs are at most 40 characters; unsafe prototype keys and Unicode-normalized collisions
are refused. Names/reasons use the host's text safety rules. Fields not declared are invalid state.

Expressions are JSON AST arrays, not strings to execute. Literals are JSON scalars; every operation
has fixed arity. The checker resolves field paths, checks types and interval bounds before import.

| Expression | Meaning |
|---|---|
| `["get", path]` | This instance's declared field; `path` is a segment array |
| `["arg", name]`, `["bind", name]` | Typed line label; typed reward binding |
| `["input", alias, field]` | A declared scalar field of that public query projection |
| `["reward", name]`, `["check", name]` | Fixed reward value; recorded SD check result field |
| `["timer", "periods"]` | Number of whole elapsed periods in this timer invocation |
| `["eq"/"ne"/"lt"/"le"/"gt"/"ge", a, b]` | Same-type comparison; ordered comparisons require ints |
| `["and"/"or", a, b]`, `["not", a]` | Boolean logic, left-to-right short circuit |
| `["add"/"sub"/"mul"/"min"/"max", a, b]` | Integer arithmetic |
| `["floorDiv", a, positiveLiteral]`, `["clamp", n, lo, hi]` | Integer division; inclusive clamp |

A path segment is a literal key or an enum expression whose entire range resolves to declared keys.
No arbitrary property lookup, concatenated paths, query calls inside expressions, dynamic dispatch,
or expression-valued text. An absent input, type mismatch, unsafe intermediate or division by zero
refuses the transaction. Arithmetic intermediates must fit ±1,000,000,000; literal clamps can prove
a result fits a field. Import refuses a statically impossible range; runtime checks actual values.

Effects, in array order: `set {path,value}`, `add {path,value,bounds?}`, `clamp {path,min,max}`,
`reward {template,bind}`, `offer {template,key,bind}`, `award {offer}`, and approved adapter effects
described below. Each object has `op` and exactly the named fields. `bounds` is `reject` (default)
or `clamp` to the field's schema bounds; a clamp reports requested and applied amounts.
Conditions do not mutate. A kind has optional `when` and `refusal`; false refuses the whole line.
Then its effects run, followed by `rules: [{id,when,then}]` **once in authored order**, each seeing
the prior effects. Rules do not trigger more rules or re-enter kinds. A false rule is simply skipped.
For an enduring title use a boolean/enum latch in the condition, as in example A.

## 3. Lines, checks, templates and time

The exact envelope remains SPEC §4.4:

```text
op dm pack.<pack-id>/<module-slug> — reason | kind: local-kind | label: value
```

Kinds declare one `op`, typed `labels`, effects, optional check/condition/refusal, and
`oncePerReply` (a list of enum labels; default `[]`). Host fields `kind` and, for character scope,
`who` are reserved. Resolve `who` to one attached canonical ID; chat scope rejects `who`.
Kinds are story-only unless `ui: true` explicitly permits `dm.act` from a screen; that command
uses the same typed inputs/effects/claims, without a checked kind's story-only roll authority.
Pin/attach/migrate accept direct reader actions only, never narration or another module's caller.
`oncePerReply` creates a host claim per source pair, module, kind, subject and those enum values;
`[]` means once for that kind/subject per reply, including Continues. Reasons do not change the key.
Labels are one lowercase word, as the shared parser expects. Unknown/duplicate/missing labels,
bad ops, values outside bounds, ambiguous names and unused trailing text are refused, not guessed.
This needs duplicate-label diagnostics before the parser collapses labels; change that path only
for `dm` lines so existing kinds retain their behavior. Grammar/help is generated from declarations,
never an author regex or a second `<Changes>` parser. The narrator sees text instructions, not JSON.

**Checks.** A kind may declare `check: {skill,stat,dc}` (literal skill/stat, DC 1–40).
The trusted SB capture adapter calls SD `checks.roll` once, with the resolved actor and this Source's
evidence; no author die, modifier or outcome. It records actor, skill/stat, DC, policy/modifiers,
die, total and outcome; `check.outcome` is `crit|success|cost|fail|critfail`. Conditions/effects can
read that result. Re-read keeps the old seed for an unchanged line; ordinary replay never rolls.
The check, practice consequences, module fields and claims must be one atomic root transaction.
SD currently restricts issuers and nested transactions allow only one root guard: use SB's trusted
issuer, and provide an owner-reviewed adapter that joins prerequisites to the `dm` root guard.
Do not spoof SD's caller or swallow a conflicting RB practice guard. Until that composition is
implemented/tested, a checked kind is unavailable with `DEPENDENCY_UNAVAILABLE`, never a local die.

**Rewards.** The narrator chooses a declared template/binding, code chooses the number. A reward
template has bounded named int `values` (`min,max,pick`), typed `bindings`, and effects.
V1 `pick` is `min`, `max`, or `midpoint` (`min + floor((max-min)/2)`); no independent dice language.
An enum binding can select a declared finite range table, checked exhaustively. `reward` freezes
and settles immediately at capture; `offer` freezes into a keyed pending offer at its capture.
An `award` can only settle that stored offer when its template's declared `when` holds; it cannot
reselect a template, recipient or amount. Keys are bounded slugs, unique per module/subject; a
settled key cannot be reused. Store template hash, binding, concrete values, recipient, Source,
offer cursor and settlement claim durably; never rerange at award time or consult installed packs.

This extends the open-quest/foe pattern: RB binds an explicit open template/base, bounds it with
recorded area inputs, fixes concrete objectives/reward or foe stats, and records that decision.
It does not fuzzy-match a new system from prose. Data rewards follow the same boundary, using a
smaller closed picker. `reward` in example A is an immediate offer-and-award with value 3.
Delayed offers survive receipt display-data trimming; an invalidated offer makes its award inactive.

Local fields/titles need no foreign writer. Optional economic effects are typed adapters only:
`grantCoin {amount}`, `grantItem {def,qty}`, `grantXp {amount}`. Recipients come from the fixed scope;
items must be resolved pinned definitions. These map to the owner's commands, enforce carry/rules/
story budgets, and join the same root guard/claim; no raw `command`/`payload` escape hatch.
Story-vouched coin uses the host's shared reply budget, including ordinary `+ coin` and Continues;
it cannot acquire an unlimited system payout by passing through `dm.tick`. No payout timer in v1.
Preflight an exact grant; a partial owner payout refuses the entire award, leaving its claim free.
Never duplicate a reward as both a module award and a narrator coin/item line. Owner adapters are
an implementation dependency, not permission for a pack to call arbitrary existing commands.

**Timers.** A timer declares `id`, `clock` (an imported SD minute projection), `every` (1–525600
minutes) and effects. Per attached subject, the runtime stores `lastMinute` and fractional remainder.
On pin/attach, a set clock is the baseline; if unset, the first set minute establishes it and gives
no accumulated penalty. For positive elapsed time, `periods = floor((elapsed+remainder)/every)`;
apply effects once using `timer.periods`, advance the baseline, retain the remainder. No catch-up loop.
Standalone ticks then run the module's rules once; an action runs them once after all its effects.
Timer effects must be additive field changes, optionally clamped, with no checks/rewards/offers;
clamp once after the aggregate change. The checker proves multiplication fits the host interval.
Allow at most 525600 elapsed minutes per settlement; a larger jump refuses without moving the cursor.

Synchronize due timers before a module action, inside its transaction. Also queue `dm.tick` through
`afterCapture` after all lines, including a later SD time line; its system steps belong to that reply.
`beforeGenerate` catches time changed through UI/system commands, using the same no-op-if-settled
planner and `commit:false` rules. `afterCapture` does not run on empty capture/clicks; do not rely on
it alone. Ticks return `replan:true`; Re-read/reconcile can recompute them with saved identity/seed.
Repeated Continue, pre-generation and after-capture calls cannot charge an interval twice.
An absolute backwards time edit accrues nothing and keeps the high-water minute/remainder; time
must pass that minute before accrual resumes. Retraction/restore instead rebuilds the old cursor.
A rest action settles elapsed time first, then applies recovery; it never advances SD's time itself.
Narration writes the actual elapsed time separately. Without a clock/dependency, show Waiting, not
a fabricated zero. Timers cannot change HP, kill characters or impose undeclared cross-module penalties.

## 4. Capture, replay, isolation and limits

Persist only under `state.domains.dataModules`, owned by Story Block:

```text
{ pins: { definitionHash: { definition, packId, packVersion, packHash, interpreter: 1 } },
  active: { moduleId: { hash, generation, subjects } },
  instances: { moduleId: { chat: instance OR characters: { canonicalActorId: instance } } },
  perReply: { sourceKey: { roots, visits, actions } } }
instance = { fields, timers, offers, settled }
```

`pins` contains checked, detached definitions with their presentation and referenced reward defs.
`definitionHash` covers normalized mechanics, local grammar, imports, presentation, interpreter
semantics/limits and referenced defs; no installed-pack pointer is executable history.
`packHash` is a separate envelope/content identity, not a substitute for the definition hash.
No timestamp or global random ID is needed. IDs/claims use host Source/cursor occurrences, never
message indices. Subjects/offers are maps by canonical key, not positional list appends.
`perReply` is declared scratch, written/pruned by Source key with SPEC's replay rules; it is not
created by inspection or an empty hook. `.view` returns `{chat: fields}` or `{characters: [...]}`
with canonical IDs/names and flattened fields; `.public` returns only the named export's fields.

Capture order: parse/resolve → validate pin, dependencies, labels and budget → settle timers on
a draft → check/choose template values → kind effects → rules → validate every touched domain →
attach guard → commit diff/receipt/claims through the existing bus. Any refusal discards the whole
root, including a proposed timer advance, die log or external payout. The host alone makes ops.

Every `dm` root uses Guard version 2, `owner: story-block`, the prefix epoch, and a `dm.*` predicate
with module ID, definition hash/generation, subject and operation. `guard.rulesHash` is the current
RB rules marker (or null), **not** the data definition hash: the timeline gate compares it to `rules`.
Pinning uses `replyBound:true`; its guard verifies the recorded checked definition against the empty
selection in the prefix. Later guards require that active pin and hash. Store durable inputs,
concrete reward/check results and planned write facts in the span's `recorded` / `result` and
`receipt.data.v2`; receipt display `data` alone is insufficient past 200 carriers.

The input hash covers Source, definition/generation, relevant field/timer/offer reads, chosen bindings,
prefix query projections and frozen outside policy. Use absolute field writes, not counter rebasing:
a clamped add or threshold depends on its starting value. If a relevant earlier field changes,
the later captured action is inactive with `REPLAY_PREREQUISITE`, pending Re-read; do not silently
recalculate its reward or preserve a title earned from missing reputation. Unrelated fields are
excluded from the read set. System ticks are re-planned by the host's existing reconcile path.
V1 deliberately favors explicit stale-action diagnostics over inventing a new semantic patch engine.

**Replay read boundary.** Only prefix state, declared replay queries, `story.evidence`, operation/
Source and `env.recorded` are inputs; never current settings, installed packs, text from other
messages, wall time, `receipts()`, RNG, handlers or effects. The guard runs a bounded pure predicate
over recorded decisions, verifies the read hash, then allows saved ops; it never executes a payout.
It is checked at first append as well as rebuild. Missing/throwing/malformed guards fail closed.

`replayQueries` currently allows only an owner's own queries. Register SB's
`dataModules.replayInputs` as that bridge, not foreign query names in SB's list. Reviewed adapter
projectors implement published, state-only public views: SD minute, SD actor identities, approved
reward eligibility, and another data module's declared export. SD's existing `director.time` includes
settings-based formatted text; use only its `minutes` projection. `checks.policy` also includes
settings: actor identities are prefix input, effective roll policy is frozen in `recorded`.
An import declares `{query,args?,mode,projection}`: `prefix` is allowed only for a registered pure adapter;
`recorded` snapshots a public result at planning and never rereads it in a guard. A live prerequisite
such as time/actor/offer existence must have a prefix witness; recording a clock value alone is
insufficient after deleting its source. New adapters need owner review and capture/replay parity
tests. Authors cannot supply projectors or raw paths into foreign domains. The trusted bridge ships
with the interpreter and reads the published state contracts without consulting peer readiness;
live dependency checks gate new work, not the meaning of saved history. Unsupported adapters refuse.
`args` is literal bounded JSON checked by that adapter. `projection` selects only its advertised
public fields, not raw state paths; the actor adapter recognizes `actors.id`/`actors.name` over
the public actor map. Cross-data imports use `dataModules.public` with `{module,export,who?}`.
Reject cycles between these imports; each query is read-only and cannot initialize a missing module.

Delete/swipe removes the reply's ops, claims, checks, timer advances and rewards. Reply-bound pins
cannot be carried forward when the earliest reply disappears; dependent blocks go inactive.
Re-read replaces story actions and asks `afterCapture` again; unchanged lines keep seeds/occurrences
under REPLAY's rules. A Re-read of the pin's own reply retracts its pin; it does not silently pin
again. A text edit alone changes no state. Rebuild applies stored ops only; ordinary replay does
not re-offer, resettle or call capture/timer hooks. Quarantine, checkpoint prefix trust and savepoint
epochs stay the host's. Keep frozen interpreter semantics for old pins; never reinterpret v1 as v2.

Installing/updating/disabling/removing a pack changes the library, never existing pins. A pinned
chat uses its definition/grammar/screens/reward defs like frozen rules. No unpin/switch mid-history;
retract its source or start a new timeline. Missing peers stop new actions/timers with the same
plain dependency reason as LIFECYCLE; existing slices replay, and unrelated data modules keep running.
The restore barrier blocks all new `dm` work. Inspect damaged/unknown-version pins read-only;
never initialize over them. SD's actor/time ownership and RB's rules remain unchanged.

**Unused means byte-identical.** Without a pin: no domain/default `{}`, receipt, claim, seed draw,
checkpoint metadata, save, prompt whitespace/grammar, tail, card line or mounted module screen.
Discovering library offers is read-only. Do not normalize an absent `content.dataModules` to `[]`
in raw exports or add fields to old normalized packs/hashes. Existing pack fingerprints retain
their values; only packs containing data definitions include the new content in their new hashes.
Do not add a global guard owner/guard-environment entry: reuse SB's existing host-owned dispatcher.
Interpreter caches key by chat identity + definition hash, contain no mutable game state, and clear
on chat change. Switching chats while saving uses SB's existing target-bound save machinery.

Proposed limits are exported host constants and are part of interpreter version 1:

| Budget | Limit |
|---|---|
| Pack / nesting / installed library | Existing 512 KiB / 16 / 2 MiB, no increase |
| Definitions per pack / pins per chat / subjects per module | 8 / 16 / 16 |
| Definition / all retained pins / one instance | 32 KiB / 256 KiB / 16 KiB UTF-8 JSON |
| Fields / kinds / rules / timers / templates per definition | 32 / 16 / 32 / 8 / 16 |
| Expr depth / AST nodes per expression / effects per list | 6 / 64 / 16; pack depth 16 still wins |
| Imports / outstanding plus settled offer keys per instance | 8 / 64; never evict settlement claims |
| Eval visits per root / data roots per reply / visits per reply | 2048 / 32 / 16384 |
| Emitted patch ops / durable span data per action root | 128 / 8 KiB, foreign adapter writes included |
| Pin/migration span data | 128 KiB, including the recorded frozen definition; no gameplay effects |
| Module static / tail | 2000 characters / 100 tokens each; normal host fit rules apply |

Charge every AST visit, rule test, subject/timer visit and adapter cost before its work; count
generated patch ops and serialized data before append. Reply budgets include Continues; use
Source-keyed scratch bookkeeping, not indices, with Re-read's kept-click accounting. When empty,
hooks emit nothing and consume nothing. A budget failure is atomic; prior successful lines stay.
No partial tick cursor or half reward. Size exhaustion requires author cleanup/migration/new
timeline; the runtime never drops old pins or claims to make room.

Refusals use `{code,path,message}` with module/kind and line reference: `DM_SCHEMA`, `DM_BOUNDS`,
`DM_LABEL`, `DM_CONDITION`, `DM_BUDGET`, or existing `STALE`, `CLAIMED`, `DEPENDENCY_UNAVAILABLE`,
`RESTORE_PENDING`, `REPLAY_PREREQUISITE`. Import lists up to 20 as PACKS does. Capture Problems and
the reply's changes card show an escaped, bounded reason, e.g. “Reputation: faction must be guild,
watch or compact; nothing applied.” Screens show it beside the action. A limited clamp says
“Requested +3; applied +1 (100/100).” No refusal becomes a story fact or invisible fallback.

## 5. Pack updates, migration and Setup

Separate pack semver, definition `schema` (language), `stateVersion` (instance shape), and content
hash. Changing behavior without changing semver still changes the hash and cannot replace a pin.
Publish a patch for text/presentation fixes, minor for additive definitions, major for incompatible
state/mechanics; hashes, not semver guesses, decide identity. Unknown language versions refuse.

Setup adds **Data modules** alongside the existing rules selection, available without RB. Show
pack/module/version, scope, fields/bounds, line examples, checks/rewards, peer needs, budgets and
screens; each starts unselected. “Enable for this chat” previews the exact hashes/subjects/baseline,
then `dm.pin` rechecks the installed offer hashes (`STALE` on any change) and records that choice
on the current carrier. Cancel/inspect writes nothing. No narrator line or pack install auto-enables.
Character scope selects public SD actors; allow explicit attachment later with defaults and the
current clock baseline, no retroactive hunger. A new `dm.attach` is reply-bound as well.
Setup displays Pinned / Waiting / Migration available / Unsupported with a reason and source link.
It cannot change global module settings or feature defaults; Part 4 supplies no such pack transport.

V1 migration is explicit, additive only: `migrations: [{from,to,add:{field:schema}}]`, adjacent
`stateVersion`s, at most four steps, no cycles. Only add fields with defaults; every old field,
kind, rule, timer, reward, export and referenced definition must retain identical semantics.
No rename/drop/retype, narrower bound, reset, payout or author migration expression. The checker
compares the old pinned definition with the target; a claimed additive change that alters old
mechanics refuses and needs a new timeline. Studio can explain this incompatibility before export.
`dm.migrate` previews every subject diff, then records the new pin/generation and defaults in one
guarded, reply-bound transaction. Preserve old pins, offer values, timers and settlement keys;
old blocks validate against their historical prefix, later blocks use the new generation. Deleting/
Re-reading the migration retracts it and invalidates dependent suffix blocks. Downgrade refuses;
undo through history retraction. No automatic migration on pack update, load, replay or restore.

## 6. Worked example A: Ersveil faction reputation

Complete proposed pack JSON. Guild, Watch and Auvoth Compact are Ersveil labels; the reputation
numbers and “Guild Friend” title are example game rules, not asserted lore. No new faction kind
is added to ordinary PACKS content. This scope tracks the chat's shared standing.

```json
{
  "id": "ersveil-factions",
  "version": "1.0.0",
  "name": "Ersveil faction standing",
  "requires": { "storyBlock": "^2", "capabilities": ["data-modules-v1"] },
  "content": { "dataModules": [{
    "slug": "reputation", "name": "Reputation", "schema": 1, "stateVersion": 1,
    "scope": "chat",
    "state": {
      "standing": { "type": "map", "keys": ["guild", "watch", "compact"],
        "values": { "type": "int", "min": -100, "max": 100, "default": 0 } },
      "title": { "type": "enum", "values": ["none", "Guild Friend"], "default": "none" }
    },
    "rewards": {
      "favour": {
        "bindings": { "faction": { "type": "enum", "values": ["guild", "watch", "compact"] } },
        "values": { "amount": { "min": 1, "max": 5, "pick": "midpoint" } },
        "effects": [{ "op": "add", "path": ["standing", ["bind", "faction"]],
          "value": ["reward", "amount"], "bounds": "clamp" }]
      }
    },
    "kinds": {
      "gain": {
        "op": "+", "oncePerReply": ["faction"],
        "labels": { "faction": { "type": "enum", "values": ["guild", "watch", "compact"] } },
        "effects": [{ "op": "reward", "template": "favour", "bind": { "faction": ["arg", "faction"] } }]
      },
      "loss": {
        "op": "-", "oncePerReply": ["faction"],
        "labels": { "faction": { "type": "enum", "values": ["guild", "watch", "compact"] } },
        "effects": [{ "op": "add", "path": ["standing", ["arg", "faction"]], "value": -5, "bounds": "clamp" }]
      }
    },
    "rules": [{ "id": "guild-title",
      "when": ["and", ["ge", ["get", ["standing", "guild"]], 6], ["eq", ["get", ["title"]], "none"]],
      "then": [{ "op": "set", "path": ["title"], "value": "Guild Friend" }]
    }],
    "exports": { "standing": { "fields": ["standing", "title"] } },
    "screens": [{
      "id": "ersveil-reputation", "title": "Reputation", "icon": "fa-flag", "mounts": ["tab", "card"],
      "layout": { "root": { "type": "col", "children": [
        { "type": "text", "label": "Guild", "bind": { "query": "dataModules.view", "args": { "module": "pack.ersveil-factions/reputation" }, "path": "chat.standing.guild" } },
        { "type": "text", "label": "Watch", "bind": { "query": "dataModules.view", "args": { "module": "pack.ersveil-factions/reputation" }, "path": "chat.standing.watch" } },
        { "type": "text", "label": "Compact", "bind": { "query": "dataModules.view", "args": { "module": "pack.ersveil-factions/reputation" }, "path": "chat.standing.compact" } },
        { "type": "badge", "label": "Title", "bind": { "query": "dataModules.view", "args": { "module": "pack.ersveil-factions/reputation" }, "path": "chat.title" } }
      ] } }
    }]
  }] }
}
```

Pin from Setup. Send these blocks on three separate replies (not three copies of one reply):

```text
<Changes>
+ dm pack.ersveil-factions/reputation — repaired the Guild's weir | kind: gain | faction: guild
</Changes>

<Changes>
+ dm pack.ersveil-factions/reputation — brought back the register | kind: gain | faction: guild
</Changes>

<Changes>
- dm pack.ersveil-factions/reputation — broke the Watch's seal | kind: loss | faction: watch
</Changes>
```

Guild: 0 → 3 → 6, title `none` → `Guild Friend`; Watch: 0 → -5; Compact remains 0.
The second gain records template `favour`, range `[1,5]`, picker `midpoint`, amount 3, binding
`guild`, the pin hash and Source with its title effect. Later ordinary losses do not revoke this
earned title. Delete that gain: its +3 and title both retract. Delete the first gain instead:
the second's starting-value guard fails; Re-read it to apply +3 without a title. `faction: crown`
refuses. Repeating a gain for Guild in a Continue of that same reply is `CLAIMED`.

## 7. Worked example B: hunger/fatigue on SD story time

Complete independent pack; requires SD and one attached actor. Public import adapters below pick
only the published fields listed in `projection`; `.view` flattens instance fields for rendering.

```json
{
  "id": "ersveil-survival",
  "version": "1.0.0",
  "name": "Ersveil survival meters",
  "requires": { "storyBlock": "^2", "capabilities": ["data-modules-v1", "story-director"] },
  "content": { "dataModules": [{
    "slug": "survival", "name": "Survival", "schema": 1, "stateVersion": 1,
    "scope": "character",
    "imports": {
      "clock": { "query": "director.time", "mode": "prefix", "projection": ["minutes"] },
      "actors": { "query": "checks.policy", "mode": "prefix", "projection": ["actors.id", "actors.name"] }
    },
    "state": {
      "hunger": { "type": "int", "min": 0, "max": 100, "default": 0 },
      "fatigue": { "type": "int", "min": 0, "max": 100, "default": 0 }
    },
    "timers": [{ "id": "needs", "clock": "clock", "every": 60,
      "effects": [
        { "op": "add", "path": ["hunger"], "value": ["mul", ["timer", "periods"], 2], "bounds": "clamp" },
        { "op": "add", "path": ["fatigue"], "value": ["timer", "periods"], "bounds": "clamp" }
      ]
    }],
    "kinds": {
      "meal": { "op": "!", "labels": {},
        "effects": [{ "op": "add", "path": ["hunger"], "value": -20, "bounds": "clamp" }]
      },
      "rest": { "op": "!", "labels": { "hours": { "type": "int", "min": 1, "max": 8 } },
        "when": ["ge", ["arg", "hours"], 1], "refusal": "Rest needs 1 to 8 hours already narrated.",
        "effects": [{ "op": "add", "path": ["fatigue"], "value": ["mul", ["arg", "hours"], -10], "bounds": "clamp" }]
      }
    },
    "exports": { "needs": { "fields": ["hunger", "fatigue"] } },
    "screens": [{
      "id": "ersveil-survival", "title": "Survival", "icon": "fa-campground", "mounts": ["tab", "hud"],
      "layout": { "root": { "type": "list", "empty": "Attach a character in Setup.",
        "bind": { "query": "dataModules.view", "args": { "module": "pack.ersveil-survival/survival" }, "path": "characters" },
        "item": { "type": "box", "title": "$item.name", "children": [
          { "type": "meter", "label": "Hunger", "value": "$item.hunger", "max": 100, "tone": "warn" },
          { "type": "meter", "label": "Fatigue", "value": "$item.fatigue", "max": 100, "tone": "warn" }
        ] }
      } }
    }]
  }] }
}
```

Create/select SD actor Wessel in Setup, set SD time to any valid minute `T`, then pin and attach
Wessel. Start at hunger/fatigue `0/0`; the needs timer baseline is `T`. On one reply:

```text
<Changes>
! time +6h
! dm pack.ersveil-survival/survival — slept at the camp | kind: rest | who: Wessel | hours: 6
</Changes>
```

Before rest: six periods → `12/6`; recovery -60 fatigue clamps to 0 → `12/0`. Timer baseline
becomes `T+360`, remainder 0. `afterCapture` finds no further interval. A later `! time +2h`
alone gives `16/2` through that reply's tick; a meal line then gives `0/2`. All values are integers.
The meal's exact line is `! dm pack.ersveil-survival/survival — ate supper | kind: meal | who: Wessel`.
`hours: 9` refuses the entire rest line. The rest's hours are a bounded story-vouched proposal;
v1 does not prove sleep or consume food. It does not heal RB pools. A stricter pack can require a
declared public rest/meal evidence adapter; no prose classifier or private inventory inspection.
Swiping away the six-hour reply removes its SD advance, timer settlement and recovery together.
An earlier clock edit that changes a later tick's interval re-plans that tick; it never re-rolls.

## 8. Studio authoring and verification

Add Data modules to content navigation. Forms cover identity/version/scope, typed fields/defaults,
fixed map keys, public import adapters, local kinds/ops/labels/claims, AST conditions/effects,
reward ranges/pickers/bindings, timers, exports and additive migration. Offer bounded controls
from SB descriptors and a whole-record JSON repair view; preserve unknown fields in safe invalid
drafts until explicitly fixed. Show generated narrator grammar and representative refusals live.
Index typed module/export/template/field/item references for rename/remove; never string-replace.

Run vendored SB `validatePack` on every candidate/debounced draft and on Apply/export; surface
its exact codes/paths/messages/order. Include SB's checker, interpreter and simulator entry points
in the normal `sync-sb` transport, record the commit, never hand-edit vendor files. Validity comes
from SB, not Studio interval heuristics. Draft errors preserve the saved pack/history; Apply is one
undoable edit. Opening/exporting an untouched pack and edit/undo preserve original UTF-8 bytes.

Reuse Part 4 screen/layout builders, sanitizer, renderer and isolated script-disabled preview.
Module-bound presentation mounts only with its pin; precedence remains reader → card → pinned
pack presentation → default. `.view` is for the module's own UI/inspection; imports of another
data module use `.public` with a named export. Templates must not become a state-access escape
for effects. Current layout importer acceptance and renderer warnings remain distinct; new module
checking validates its own declared references without changing ordinary pack layout acceptance.

The simulator runs SB's actual store/bus/capture/interpreter on a disposable in-memory chat.
Inputs: pin/attached actors, sample public query answers, initial story minute, seed, sample
`<Changes>` replies; controls for Continue, edit/Re-read, swipe, delete and reload. Output: parsed
labels, fixed offer values/draws, evaluated conditions, before/after fields, timer remainder,
receipts/claims/ops, budget usage and inactive/refused blocks. Run a full replay comparison.
Clock samples must update the simulated prefix, not just stub a new query answer; owner adapters
must use their real pure planners or mark the fixture unsupported. No “success” placeholder for
coin/check/practice eligibility. Simulation edits neither pack nor real chat; sample scenarios can
export separately from pack JSON. Offline Studio has no network or dependency on sibling repos.

Required implementation tests (this design does not add product tests):

1. Checker vectors: both complete examples; every unknown key/operator/ref; all type/range/depth/
   UTF-8 limits at ±1; duplicate labels, normalized collisions, hostile text, missing capabilities.
   Compare Studio and SB acceptance and exact diagnostic arrays. Old golden packs stay unchanged.
2. Runtime: each effect/refusal atomic; rewards frozen before award; retries/Continues claim once;
   clamp/overflow; public import isolation; peer missing/late/dormant; restore barrier; two chats
   using the same definition with different subjects/state and a save completing during chat switch.
3. Time: unset/seeded clocks, 59/60/61 minutes, remainder, simultaneous timers, later time lines,
   large/backwards/absolute jumps, rest order, empty captures, UI advances, repeated hooks, and
   deleting a clock advance before/after checkpoint. Reject catch-up beyond budget without drift.
4. Cross-owner adapters: SD check/die/practice/root guard; wallet/story budget and partial refusal;
   item carry and pinned definitions; XP/rules eligibility. Each root commits all domains or none.
5. Property/fuzz: generate valid bounded definitions plus malformed ASTs, then random capture/UI/
   Continue/edit/Re-read/swipe/delete/reload/reconcile/restore sequences. After **every** step compare
   incremental and cold full replay state, sampled carriers, Problems, monotone revs and claims.
   Vary checkpoint frequency, trim past 200 carriers, damage spans/source/guard metadata, remove
   pin/offer/actor evidence, mutate installed packs/settings, and retain minimized failing seeds.
   Assert guards never query outside declarations, execute effects, allocate IDs or roll on replay;
   recorded inputs alone cannot keep an award alive after its prefix witness is removed.
6. Differential byte-identity property: same seeded chat/events on the baseline and new host with
   no pin, including installed unused definitions, library inspect/cancel, features, old guarded
   blocks, checkpoints and chat switches. Compare exact serialized messages/extras, metadata,
   prompts, normalized pack/hash goldens, save count and RNG consumption; no placeholders added.
7. Studio browser: offline forms/JSON repair, live diagnostics, simulation and replay trace,
   narrow/wide screens, refusal rendering, Undo/Redo/reload, and unchanged export bytes. Unexpected
   requests, console/page errors or simulation writing to the author document fail the suite.

## 9. Work estimate, risks and decisions

A job is one bounded implementation/review/test unit, roughly 1–2 developer days; estimates include
integration tests, not parallelism promises. No implementation is authorized by this design commit.

| Area | Jobs | Deliverable |
|---|---:|---|
| SB schema/checker | 2 | Closed descriptors, interval checker, references, capability/hash compatibility |
| SB interpreter/capture | 2 | Fields, AST/effects, kinds, deterministic guards/claims and refusals |
| SB pin/lifecycle/Setup | 2 | Deferred state, presentation gating, subject attachment, additive migration |
| SB timers/templates/adapters | 3 | Aggregated timers, frozen offers, SD/RB owner seams and atomic guards |
| SB property/regression tests | 2 | Replay fuzz, unused-chat differential bytes and budgets |
| Studio authoring | 2 | Forms, reference edits, validation and history/presentation integration |
| Studio simulator/browser proof | 2 | Real host simulation, replay trace, offline UI tests |
| Docs/examples | 1 | Format/API reference, author guide and tested example fixtures |
| Total | **16** | **11 SB/runtime + owner integration, 4 Studio, 1 docs; ~16–32 days** |

Highest risks: joining SD checks/RB practice under one root guard; accidentally admitting an impure
query bridge; stale threshold writes after deletion; frozen definitions exhausting chat size;
silent differences between Studio's stubs and runtime; and changing unused prompts/checkpoints.
Mitigate with adapters before UI, conservative read guards, retained interpreter versions, measured
budgets, real-host simulation and byte-level differential tests. Story-vouched rest/standing can
be narrated dishonestly; bounds limit it, while stronger proof requires explicit owner evidence.

Open questions (the design above uses the recommended answers):

1. Should local narrator kinds use the shared `dm` envelope? Recommended: yes; keep `kind:` local to each module and reserve no additional global kind names.
2. May readers enable a module in an existing chat? Recommended: yes, explicitly in Setup; attach selected characters at the current story minute with no retroactive effects.
3. How much migration should v1 support? Recommended: explicit additive fields with defaults only; changed mechanics or destructive state changes require a new timeline.
4. What should an absolute backwards story-time edit do to survival timers? Recommended: accrue nothing and keep the high-water minute; history retraction or restore rebuilds the earlier cursor.
5. Should a captured action automatically recompute after an earlier prerequisite changes? Recommended: re-plan system ticks only; mark dependent story actions inactive and require Re-read, preserving recorded reward and check decisions.

## Decisions (approved 26 Oct)

1. Narrator kinds: one host wire kind `dm`; authored kinds stay local to their definition (selected by `kind:`); no global kind names reserved.
2. A reader may enable a module in an existing chat, explicitly in Setup; it attaches at the current story minute with no retroactive effects.
3. Migration in v1 is additive only (new fields with defaults); changed mechanics or destructive state changes need a new timeline.
4. A backwards story-time edit accrues nothing on timers and keeps the high-water minute; retraction or restore rebuilds the earlier cursor.
5. When an earlier change invalidates a later action: system ticks are re-planned; dependent story actions go inactive with `REPLAY_PREREQUISITE` and need a Re-read; recorded rewards and checks are kept, never recalculated.
6. Short module references: a `dm` line may name a module by its bare slug (`+ dm reputation — … | kind: gain | faction: guild`) when that slug is unique among the chat's active pins; the full `pack.<pack-id>/<slug>` ID always works; an ambiguous bare slug is refused with both candidates named. The generated narrator grammar uses the short form whenever it is unique.
7. Delivery in two steps. **v1:** fields, kinds, conditions, rules, rewards/offers into the module's own fields, timers on SD minutes, exports between data modules, screens/layouts, Setup enable/attach, additive migration. **v1.1:** owner-reviewed adapters — SD skill checks inside a `dm` root, and `grantCoin` / `grantItem` / `grantXp`. In v1 a definition using a v1.1 feature is refused at import with a clear "needs data-modules v1.1" message (not accepted and left unavailable).
