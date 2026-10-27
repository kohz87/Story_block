# Open trainer templates: implementation spec

Status: **approved 27 Oct.** Story Block 2.4.0 implements §3, §14 and §15; RPG Battle 2.2.0 and Story Studio follow. It turns the approved design into
exact, buildable work for Story Block (SB), RPG Battle (RB), Story Director (SD) and Story Studio, and checks
each claim against the code at these commits:

| Repo | Commit | Version |
|---|---|---|
| kohz87/Story_block | main `dd130d7` | 2.3.0 |
| kohz87/rpg_battle | main `1e01275` | 2.1.0 |
| kohz87/Story_director | main `8233c89` | 2.1.0 |
| kohz87/Story_studio | main `e327a73` (records-ux mockup: branch `mockup/records-ux` at `97b3e68`) | 0.1.0 |
| kohz87/npc_state_delta | main `80a4532` (read only; no change) | 1.3.0 |

Mockups of the Studio template editor: [mockups/open-trainers/editor-desktop.html](mockups/open-trainers/editor-desktop.html)
(1280 px wide, 3,749 px full page) and [mockups/open-trainers/editor-phone.html](mockups/open-trainers/editor-phone.html)
(390 px wide, 5,599 px full page). Both reuse the approved records-ux mockups' CSS and chrome, load nothing, have no
horizontal scroll and no control under 44 px (measured in headless Chromium).

## 0. The approved rules

These are the user's decisions. This spec does not change them; where the code pushes back, §19 says so.

1. **How one appears.** A narrator line such as `+ trainer Old Reka — blade drills | like: blade-trainer`, or a
   reader action **Make this a trainer** on an NPC. Both, like open quests.
2. **What it teaches.** The template lists the skills it can teach. The narrator may narrow that list but never
   add to it. A trainer still teaches the next form of a skill the character already has, as fixed trainers do.
3. **Fee.** A range by rank, rolled when the trainer is offered and recorded with the offer.
4. **Where.** The trainer is bound to the place where it was offered, and stays there.
5. **Replay.** Deleting the reply that created the trainer removes it. Nothing re-rolls on replay or rebuild.

Open quest templates (SB #204, SD #136, RB #151) are the pattern. Every part below names the open-quest part it
copies.

Choices this spec makes where the rules leave room (each is also in §19 with the alternative):

* A template is a trainer entry with `"open": true`, a pack `rank`, a fee range `{ coinMin, coinMax }` and no place, in
  the same `content.rules[0].trainers` array as fixed trainers (§3).
* RB owns the `trainer` line, the reader action, the offer record and the guard; SD and NSD are only read, once, at offer
  time (§2).
* "Rolled" is one seeded d1000 scaled into the range, recorded with the offer; replay and rebuild never roll (§5.2).
* The fee range is not bounded by the rank's quest reward range; the kit warns instead (§3.2, §14.3).
* One open trainer per name per chat, at most 100 per chat; the narrator is told of each offer (§4.2).
* A story line's offer is reply-bound; a reader click's is not (§6.3).
* The reader action lives in RB's Progress → Training and picks from the people present (§4.3, §10.2).

## 1. Baseline (run before writing this spec)

Node 24 (`npx -y node@24`, v24.22.1), as CI uses, on fresh clones:

| Suite | Command | Result |
|---|---|---|
| SB | `node --test "tests/*.test.js" "tests/v2/**/*.test.js" "examples/fishing/tests/*.test.js"` | 3,760 pass, 0 fail |
| RB | `node --test "tests/*.test.js" "tests/v2/**/*.test.js"` | 2,481 pass, 0 fail, 1 todo (`tests/v2/qa/currency.test.js:63`, "1 crown" plural) |
| SD | `node --test "tests/*.test.js" "tests/v2/**/*.test.js"` | 950 pass, 0 fail |
| Studio | `node --test` over the 42 non-browser `tests/*.test.js` (no Chromium here) | 778 pass, 0 fail |
| Matrix | SB `node scripts/matrix.mjs` with RB, SD, NSD side by side | 109 ok, 19 n/a, exit 0 |

The RB and SD runs had the sibling checkouts next to them, so the cross-repo tests that skip in CI also ran.

Two probes were run in a scratch copy, not committed:

* **SB schema prototype.** §3.1's schema and §3.2's two validator checks, applied to a copy of SB main. The
  Bluewatch pack with §15's four templates validates; export and re-import give the same resolved rules; every
  refusal in §3.6 comes back with the code and path listed there. The whole SB suite then fails in exactly the
  8 tests §3.7 lists (plus one artefact of the copy not being a git checkout), nothing else.
* **Vendoring probe.** SB main's testkit synced into copies of RB and SD (§17.1) to see what a re-vendor costs
  before any feature work (result in §17.1).

## 2. Who owns what

| Part | Owner | Copies (open quests) |
|---|---|---|
| Template schema, validator, limits, export, rules hash | SB `src/v2/packs/rules-v2*.{js,json}` | `openQuest`, `openReward`, the `open` discriminator (`rules-v2.js:1211`) |
| The `trainer` change-line kind (capture) | RB, training part | RB owns the `quest` kind (`quests/index.js:27`, `quests/capture.js`) |
| The offer: plan, fee roll, place, narrowed skills, record | RB, `training` domain | `quests/opening.js` `planOpening` / `commitOpening` |
| The reader action **Make this a trainer** | RB command `trainer.open` + widget | `quest.open` (`quests/commands.js:24`) + `rpg-battle.quest-binding` (`screens/rules/widgets.js:321`) |
| Replay guard | RB, `trainer.open` guard kind | `replayOpening` (`quests/opening.js:127`) |
| Training with a recorded offer | RB `training/`, `progress/assess.js`, `progress/session-step.js`, `progress/commands.js` | — (new) |
| Where the party is (canonical place id) | SD `atlas.canonical`, read once at offer time and recorded | quest `recordQuestInputs` place |
| Who is present (reader action) | SB `scene.present`, read once and recorded | — |
| NPC identity (display link only) | NSD `npc.identity` when installed; never used for a check | quest giver identity |
| Template editor | Studio | records-ux "Template / Fixed" chips and Quests filter |
| Author prompts, checker, limits page | SB `authoring-kit/`, copied into Studio by `sync-kit` | `06-quests.md` open-template paragraph |

SD gets no runtime change (§11). NSD gets no change at all; its prompts stay byte-identical (§12).

## 3. Story Block: the schema and the checker

### 3.1 Schema

`$defs.trainer` becomes a `oneOf` of a fixed trainer and an open trainer, exactly as `$defs.quest` is a `oneOf` of
`closedQuest` and `openQuest`. `properties.trainers` is unchanged (`maxItems: 100`, items `#/$defs/trainer`), so
fixed trainers and templates share the one array `content.rules[0].trainers`.

```json
"trainer": { "oneOf": [ { "$ref": "#/$defs/fixedTrainer" }, { "$ref": "#/$defs/openTrainer" } ] },

"fixedTrainer": {
  "type": "object", "additionalProperties": false,
  "required": ["slug", "name", "place", "skills", "fee", "minutes", "eventTemplates"],
  "properties": {
    "slug": { "$ref": "#/$defs/slug" },
    "name": { "$ref": "#/$defs/name" },
    "place": { "$ref": "#/$defs/id" },
    "skills": { "type": "array", "minItems": 1, "maxItems": 30, "items": { "$ref": "#/$defs/ref" }, "uniqueItems": true },
    "fee": { "type": "integer", "minimum": 1, "maximum": 1000000 },
    "minutes": { "const": 60 },
    "eventTemplates": { "type": "array", "minItems": 0, "maxItems": 8, "items": { "$ref": "#/$defs/ref" }, "uniqueItems": true },
    "open": { "const": false }
  }
},

"openTrainer": {
  "type": "object", "additionalProperties": false,
  "required": ["slug", "name", "open", "rank", "skills", "fee", "minutes", "eventTemplates"],
  "properties": {
    "slug": { "$ref": "#/$defs/slug" },
    "name": { "$ref": "#/$defs/name" },
    "open": { "const": true },
    "rank": { "type": "string", "minLength": 1, "maxLength": 20 },
    "skills": { "type": "array", "minItems": 1, "maxItems": 30, "items": { "$ref": "#/$defs/ref" }, "uniqueItems": true },
    "fee": { "$ref": "#/$defs/openFee" },
    "minutes": { "const": 60 },
    "eventTemplates": { "type": "array", "minItems": 0, "maxItems": 8, "items": { "$ref": "#/$defs/ref" }, "uniqueItems": true }
  }
},

"openFee": {
  "type": "object", "additionalProperties": false,
  "required": ["coinMin", "coinMax"],
  "properties": {
    "coinMin": { "type": "integer", "minimum": 1, "maximum": 1000000 },
    "coinMax": { "type": "integer", "minimum": 1, "maximum": 1000000 }
  }
}
```

* `fixedTrainer` is today's `trainer` def, byte for byte, plus the optional `"open": { "const": false }` (as
  `closedQuest` has). A pack that never writes `open` is read exactly as before.
* `openTrainer` has **no `place`** (writing one is refused), `rank` like `openQuest.rank`, the fee as a range
  (`openFee`, named like `openReward`'s `coinMin`/`coinMax`), `minutes` const 60, the same skills and
  eventTemplates bounds as a fixed trainer. No `note`, as fixed trainers have none.
* Fee bounds: each 1 to 1,000,000, the fixed fee's own bounds. A fee of 0 stays impossible.
* Edit all three copies together: `src/v2/packs/rules-v2.schema.json`, `src/v2/packs/rules-v2.schema.js`
  (`rulesV2SchemaSource`), and the embedded block under "Machine-readable schema" in
  `docs/v2/contract/RB_CONTRACT.md` (one line of JSON at line 880 today). `tests/v2/packs/rules-v2/review-fixes.test.js`
  ("JSON schema: the JS module, the JSON file and the contract schema are deeply equal") holds them equal.
  Then copy the JSON to `authoring-kit/reference/rules-v2.schema.json` (`kit.test.js` "reference/ equals what Story Block ships").
* The existing `oneOf` error selection (`rules-v2.js:1211-1214`) already picks the branch by `open`; no change
  is needed there (prototype: a fixed trainer that writes `open: true` is reported against `openTrainer`'s
  fields, an open one without `open` against `fixedTrainer`'s).

### 3.2 Validator (`src/v2/packs/rules-v2.js`)

Only the trainer cross-reference loop changes (`rules-v2.js:2368-2384` today):

```js
for (let i = 0; i < (m.trainers ?? []).length; i++) {
    const trn = m.trainers[i];
    const p = `content.rules[0].trainers[${i}]`;
    if (trn.open === true) {
        if (!(cnt.ranks ?? []).some(row => row.id === trn.rank)) {
            errors.push({ code: BAD_SCHEMA, path: `${p}.rank`, message: 'An open trainer names a pack rank' });
        }
        if (trn.fee.coinMin > trn.fee.coinMax) {
            errors.push({ code: BAD_SCHEMA, path: `${p}.fee`, message: 'Open trainer fee bounds must be ordered (coinMin not above coinMax)' });
        }
    } else {
        // today's place check, unchanged
    }
    // today's skills and eventTemplates reference checks, unchanged, for both kinds
}
```

* The rank must be the id of a rank in the pack's own `content.ranks` (exact, as open quests compare,
  `rules-v2.js:2255`). Unlike open quests the fee range is **not** bounded by that rank's reward range: Bluewatch's
  fixed fees (40 to 150) sit below rank F's quest floor of 50. The authoring kit warns instead (§14.3). See §19 Q1.
* Slugs: templates share the id space with classes, skills, branches and fixed trainers (`rules-v2.js:1776-1788`),
  and the duplicate and form-id collision checks (`1769-1774`, `2005-2011`) cover them unchanged.
* Normalization (`1586-1595`) and export (`2624-2630`) already handle `skills` and `eventTemplates` for every entry;
  they need no change. `open`, `rank` and `fee` pass through as authored.
* `RULES_V2_LIMITS.trainers` stays `properties.trainers.maxItems` (100): fixed trainers and templates together.
  No new constant: the fee bounds live in the schema, where `limits.mjs` reads them.
* `src/v2/packs/validate.js` and `limits.js` need no change: the rules manifest is checked by `rules-v2.js`, and the
  host's `validatePack` passes the templates through (prototype: `validatePack` accepted the Bluewatch pack with
  templates).

### 3.3 What the resolved rules look like

`resolved.manifest.trainers` holds both kinds, each with `id` (`pack.<key>/<slug>`) and `pack`, skills as full refs.
A template resolves to, for example:

```json
{ "id": "pack.ersveil-bluewatch/open-hedge-lessons", "pack": "ersveil-bluewatch", "slug": "open-hedge-lessons",
  "name": "Hedge-magic lessons", "open": true, "rank": "E", "fee": { "coinMin": 80, "coinMax": 160 },
  "minutes": 60, "eventTemplates": [],
  "skills": ["pack.ersveil-bluewatch/spark-dart", "pack.ersveil-bluewatch/mana-shield", "…"] }
```

A consumer tells a template from a fixed trainer by `open === true` only.

### 3.4 Hashes

`rulesHash` and `packHash` include the schema (`computeRulesHash`, `rules-v2.js:2748`), so **every** pack's hashes
change with this release, templates or not, as they did when open quests landed. Pinned chats are not affected:
the pin keeps its own hash and guards compare against the pin, never the installed pack
(`rules/selection.js:30`, `progress/guard.js:76`). Known consumers of literal hashes:

| Where | What |
|---|---|
| SB `tests/v2/packs/rules-v2/coverage.test.js:592` | `GOLDEN.smallRulesPack`; with §3.1's schema exactly the new values are `rulesHash 73a9544b564fd03883162089690350a914c550c455b10ddfaf962c1d4e6b3d35`, `packHash 0e156cdbcfd8c02db87c44166582bee3071f8bc6d8fde51af66f31a63214cf63` (prototype). Recompute if the schema text differs in any way. |
| Studio `tests/export.test.js:32-33`, `tests/studio-browser.test.js:13-14`, `tests/golden.test.js:16-17,58` | the same golden pair, and the Bluewatch-based initial hash; update after `sync-sb` (§13) |

### 3.5 Contract text (`docs/v2/contract/RB_CONTRACT.md`)

Besides the embedded schema: §3's command table gains `trainer.open` and the two queries of §10.1; `skill.train`'s
`trainer` becomes `Ref | Id` (a pack trainer's ref, or an open trainer offer's `tn_` id); the "Training start" row
(line 649) adds "an open trainer offer is resolved from the `training` domain with the same checks"; §7's table row
`Trainer` (line 796) adds "`$defs.trainer` is `fixedTrainer | openTrainer`". Mark each as a 2.4.0 addition.

### 3.6 SB tests to add

New file `tests/v2/packs/rules-v2/open-trainers.test.js`, modelled on `open-templates.test.js`:

* `open trainer templates survive canonical roundtrip`: `smallRulesPack()` plus `content.ranks = [{ id: 'F', … }]`
  and one template; validate ok; export, re-validate, `resolved` deep-equal; a fixed trainer beside it is unchanged.
* `open trainer refuses <case>`, one test per row (codes and paths as the prototype returned them):

| Case | Change | Code | Path |
|---|---|---|---|
| a place | `place: 'pack.fixture/haven'` | `envelope-unknown` | `…trainers[i].place` |
| one number for the fee | `fee: 50` | `bad-schema` | `…trainers[i].fee` |
| inverted fee | `fee: { coinMin: 91, coinMax: 90 }` | `bad-schema` | `…trainers[i].fee` |
| fee 0 | `coinMin: 0` | `numeric-range` | `…trainers[i].fee.coinMin` |
| unknown rank | `rank: 'Z'` | `bad-schema` | `…trainers[i].rank` |
| no rank | delete `rank` | `bad-schema` | `…trainers[i].rank` |
| no ranks in the pack | delete `content.ranks` | `bad-schema` | `…trainers[i].rank` |
| unknown skill | `skills: ['fireball']` | `bad-ref` | `…trainers[i].skills[0]` |
| minutes 30 | `minutes: 30` | `bad-schema` | `…trainers[i].minutes` |
| `open` removed | delete `open` | `bad-schema` | `…trainers[i].place` (read as a fixed trainer) |
| slug of a skill | `slug: '<a skill slug>'` | `dup-id` | `…trainers[i].slug` |

* `a fixed trainer may write open: false and nothing else changes` (same `resolved` apart from the `open: false` key itself, which is kept and so is part of the hash).
* `100 trainers is still the limit, templates counted` (copy `coverage.test.js:416-422` with half templates).
* In `schema.test.js`: the def list (`:115-133`, `:380-395`) gains `fixedTrainer`, `openTrainer`, `openFee`
  ("all 29 defs" becomes 33+3=36 as the prototype counted); `:261-263` read `$defs.fixedTrainer` and add
  `openTrainer.properties.minutes.const === 60`, `openFee.properties.coinMin.minimum === 1`,
  `coinMax.maximum === 1000000`, and `openTrainer` has no `place` property.

### 3.7 SB tests that change

The first six rows are the prototype's exact failure list (8 tests); the last row follows the pack bump of §15.

| Test | Why | Change |
|---|---|---|
| `tests/v2/packs/rules-v2/review-fixes.test.js` "JSON schema … deeply equal" | contract copy | update the embedded schema |
| `tests/v2/packs/rules-v2/schema.test.js` "representative complete $defs…", "exact enums, bounds, and constants", "schema required and closed manifest and owned defs" | def names | as §3.6 |
| `tests/v2/packs/rules-v2/coverage.test.js` "golden: smallRulesPack exports these exact bytes and hashes" | hash | §3.4 values; `fixtures/golden-small-export.json` bytes do not change (the export has no schema) |
| `tests/v2/authoring-kit/kit.test.js` "reference/ equals what Story Block ships" | schema copy | copy the JSON |
| `tests/v2/authoring-kit/kit.test.js` "LIMITS.md is exactly what scripts/limits.mjs prints" | `limits.mjs:28` reads `defs.trainer.properties` | §14.4 |
| `tests/v2/authoring-kit/kit.test.js` "the master prompt and the steps state Story Block's current numbers" (`:350`) | same | read `defs.fixedTrainer`, add `openTrainer` lines |
| `tests/v2/packs/ersveil.test.js:57`, `tests/v2/packs/rules-v2/open-templates.test.js:36` (and its title at `:32`) | pack version | `1.6.0` (§15) |

## 4. The line and the reader action (RB)

### 4.1 Grammar

RB's training part declares the change-line kind `trainer` (no module owns it today; SD's thread kinds are
`agenda, event, hook, quest, clock, beat, secret`, `tracker/convert.js:17`).

```
+ trainer <Name>[ — <what they teach>] | like: <open trainer template slug or ref>[ | teaches: <skill>, <skill>…]
```

SB's parser (`capture.js:685`) already reads it as `{ op: '+', kind: 'trainer', name: 'Old Reka',
text: 'blade drills', labels: { like: 'blade-trainer', teaches: '…' } }`. Repeated `teaches:` labels arrive joined
by `; ` (`addLabel`), so entries are split on `,` and `;`.

The kind's grammar line, shown to the narrator (one line; `TRAINER_GRAMMAR` in `training/capture.js`):

```
+ trainer Name — what they teach | like: <template> [| teaches: <skill>, <skill>] (templates: open-blade-drills, open-spear-and-shield, open-street-craft, open-hedge-lessons). Code fixes the fee and the place.
```

The template list is the pinned rules' templates' slugs in pack order, at most 8, then `and N more`. It is built by
the kind's `grammarFor(settings, query)`; `module.js`'s `grammarOf` passes `staticQuery` as the new second
argument (`grammarFor(settings)` keeps working). The pin is frozen, so the line is byte-identical on every reply of
a chat.

**When the kind exists.** The kind is enabled only while the chat pins rules **and** the pin has at least one
template: `training.openTemplates({})` is non-empty. `module.js` today makes a rules part's kind `enabled` while
pinned (`whilePinned`, `module.js:368-369`); add a kind-spec field `when(query) → boolean` that `module.js` ANDs
into `enabled` on every host path (deferred and activated). A disabled kind is invisible to SB (`registry.js:662`,
`:929`): no grammar in the static prompt, and a stray `+ trainer` line gets SB's own `UNKNOWN_KIND` Problem
("No module keeps "trainer"…", `turn.js:893`). So unpinned chats and chats pinned to a pack without templates keep
their static prompt bytes (§9).

### 4.2 What a line does

`createTrainerCapture()` (new, `training/capture.js`), dispatched by RB's `capture.apply`. Checks run in this order;
the first that fails answers. "Refused" means the line returns
`{ summary: 'Trainer refused: <message>', problem: 'Trainer refused: <message>', narrate: false, data: { code, message, refused: true } }`
and changes nothing (open quests leave a plain goal; a trainer has no neutral half, so nothing is written).

| # | Condition | Result | Code |
|---|---|---|---|
| 1 | `op` is not `+` | refused: "Trainer lines only offer one: + trainer Name \| like: <template>." | `INVALID` |
| 2 | no `like:` label, and the name is a fixed trainer's name (case and spaces folded) | no-op, `narrate: false`: "<Name> is a trainer of this world." No Problem. | — |
| 3 | no `like:` label otherwise | refused: "An open trainer needs \| like: <template>." | `INVALID` |
| 4 | a label other than `like`, `teaches` | refused: "An open trainer cannot supply a fee, a place or other fields." | `INVALID` |
| 5 | name empty, over 80 characters, or with `<`, `>` or control characters; text over 240 | refused: "Name the trainer in at most 80 characters…" | `INVALID` |
| 6 | `like:` is not a template of the pin (by `id` or `slug`; a fixed trainer's slug counts as not a template) | refused: "Choose an open trainer template of this world's rules explicitly." | `RULES_MISMATCH` |
| 7 | a `teaches:` entry matches no skill of the template (by full ref, slug, or the skill's name, case folded), or matches two | refused: "<Template name> does not teach <entry>; a trainer teaches only what its template lists." | `REFUSED` |
| 8 | `teaches:` given but empty after splitting | refused | `INVALID` |
| 9 | the name is a fixed trainer's name | refused: "<Name> is already a trainer of this world." | `REFUSED` |
| 10 | an open trainer of that name exists at **this** place | no-op, `narrate: false`: "<Name> already teaches here." (a Continue or a repeated line never rolls twice) | — |
| 11 | an open trainer of that name exists at another place | refused: "<Name> already teaches at <where>; a trainer stays where it was offered." | `REFUSED` |
| 12 | `atlas.canonical({})` gives no `id` (no place, or an ambiguous one) | refused: "Where the party is cannot be told, so the trainer has no place to stand." | `DEPENDENCY_UNAVAILABLE` |
| 13 | the chat already holds 100 open trainers (`MAX_OFFERS`) | refused: "This chat has 100 story trainers; no more can be offered." | `REFUSED` |
| 14 | otherwise | the offer is made (§5), `narrate: true` | — |

Name key: NFKC, trimmed, inner whitespace collapsed to one space, lower case. Skills keep the **template's order**
whatever order `teaches:` wrote them in; duplicates collapse. Without `teaches:` the trainer teaches the whole list.

The summary of a made offer, told to the narrator (`narrate: true`; see §19 Q6):
`Old Reka will teach Swift Thrust, Parrying Turn and Poised Step at Bluewatch Village for 54 crowns a session.`
Skill names come from the pin; the amount is written with the chat's one currency (`inventory.currency`), as
trade summaries write it (`trade/core.js:399`).

### 4.3 The reader action **Make this a trainer**

Command `trainer.open` (training part), the twin of `quest.open`:

```
trainer.open { name, template, text?, skills? }   → { trainer: 'tn_…', fee, place }
```

* Reader only: `ctx.cause !== 'ui' || ctx.caller` → `REFUSED` "Make this a trainer is a reader action."
* Closed payload: any other key → `INVALID`. `name` and `template` strings; `text` ≤ 240; `skills` an array of
  1 to 30 refs (the narrowing; omitted means the whole list).
* `name` must be one of the people present: `scene.present` (SB's query, case folded). Otherwise `NOT_FOUND`
  "<name> is not here." This is what "on an NPC" means: the reader picks a person the scene lists.
* Then checks 5 to 13 of §4.2 with `skills` in place of `teaches:` (an entry that is not a template skill is
  `REFUSED` with the same message). Result: the same offer as a line makes, with `by: 'reader'`.
* `narrate: true`, with the summary of §4.2, so the story learns of it on the next reply.

Where the reader finds it: RB's **Progress** screen, the Training section of the reader's own character (§10.2),
a form like the Quests tab's "Make this a quest". Not on SB's Scene screen (SB would then draw an RB control) and
not in NSD (unchanged).

## 5. The offer record (RB `training` domain)

### 5.1 Shape

`training` stays schema 2 (`training/domain.js:17`). It gains an optional map `offers`, absent until the first
offer, so a pinned chat that never meets a story trainer keeps its bytes.

```
training = { schema: 2, sessions: { … }, offers?: { [tn_ id]: Offer } }

Offer = {
  id:             'tn_' + 8 base36                     // ctx.id('tn'), checked unused
  template:       DefId                                // the template's ref, e.g. pack.ersveil-bluewatch/open-blade-drills
  name:           string, 1-80                         // as written / picked
  text:           string, 0-240                        // "blade drills"; '' when none
  skills:         DefId[1..30]                         // the narrowed list, template order
  fee:            int 1..1,000,000                     // rolled once (§5.2)
  minutes:        60
  eventTemplates: DefId[0..8]                          // the template's, copied
  rank:           string 1-20                          // the template's
  place:          DefId | RecordId                     // SD's canonical id at offer time (pack.<id>/<slug> or pl_…)
  where:          string 0-80                          // the place's name then; display only
  npc:            RecordId | null                      // NSD np_ id when npc.identity answered by name; display only
  by:             'story' | 'reader'
}
```

`trainingProblems` (`domain.js:26`) adds: `offers` absent or an object of at most `MAX_OFFERS = 100` entries; each
whole as above (id shape `tn_` + 8, keyed by its id, every field's type and bound); no two with the same name key.
A session's `trainer` may now be a DefId **or** a `tn_` id (`isTrainerRef` in `rules/ids.js`), at `domain.js:35`
and in `skill.train`'s payload check (`request.js:19`).

### 5.2 The fee roll

```
die = ctx.roll('1d1000').total                         // SB's seeded dice, MAX_SIDES 1000 (rng.js:7)
fee = coinMin + floor((coinMax - coinMin) * (die - 1) / 999)
```

`die` 1 gives `coinMin`, 1000 gives `coinMax`. One roll per offer, after every check has passed, never on a
refusal or a no-op. Rolling one d1000 and scaling (rather than `1d(range)`) keeps ranges up to 1,000,000 inside
the dice's limit. Why a roll and not open quests' area-tier formula: rule 3 says "rolled" (§19 Q2).

What keeps it from re-rolling:

* **Replay and rebuild** apply the stored ops; nothing is planned and nothing rolls. The guard (§6) recomputes
  `fee` from the **recorded** `die` and checks it against the template range.
* **Re-read** of an unchanged line runs it with the **seed of the receipt it made before** (`turn.js` `storySeeds`,
  matched by the line's text), so the same die, fee and `tn_` id come back. An edited line is a new line with a fresh
  seed: a new offer (the old one goes with the old block).
* **Swipe** is another reply with its own seed: another offer, or none. Swiping back shows the stored one.
* `ctx.id('tn')` draws from the receipt's id stream (`commands.js:61`), separate from the dice, so the id is as
  stable as the die.

### 5.3 Where each fact is recorded

| Fact | Offer record | Guard `inputs` (hashed) | Guard `recorded` (handed back on replay) |
|---|---|---|---|
| template, name, text, by | yes | yes | — (in the guard payload) |
| narrowed skills | `skills` | yes | — |
| fee | `fee` | yes | `die` |
| place | `place`, `where` | yes | `place`, `where` |
| NPC id | `npc` | yes | `npc` |
| person present (reader) | — | yes (`present: true`) | `present` |
| offer id | key and `id` | yes | `id` |
| what was there before | — | `before: { offers: <count>, nameFree: true }` | — |

## 6. The guard and replay

### 6.1 Commit

`commitTrainer(ctx, plan)` (new, `training/opening.js`), shared by the line and the command:

1. `ctx.replayGuard({ ...buildGuard({ hash, owner: 'rpg-battle', epoch: epochOf(ctx), source: ctx.source,
   rulesHash: pin.hash, kind: 'trainer.open', payload: { binding, by }, inputs: plan.facts }),
   ...(by === 'story' ? { replyBound: true } : {}) }, plan.recorded)` using `progress/guard.js`'s `buildGuard`,
   the one guard builder (B5).
   `binding = { template, name, text, skills: <the narrowing as written, or null> }`.
2. `ctx.claim('rb:<epoch>:trainer:<first 16 hex of hash(nameKey)>')`; held → `CLAIMED` "That trainer was already offered."
3. `ctx.draft('training').offers ??= {}`; write the offer under its id.

A story line's block carries `replyBound: true`; a reader click's does not. See §6.3 and §19 Q3.

### 6.2 Replay guard

`replayTrainer({ state, query, hash }, info)` (new, `training/opening.js`), exported as the training part's
`hooks.replayGuard`; `module.js` already dispatches guards by kind, first part that answers. It answers
`undefined` for any other kind.

```
if guard.predicate.kind !== 'trainer.open'               → undefined
pin = pinned(state.domains.rules)
pin missing, pin.hash !== guard.rulesHash, guard.epoch !== epochOf(state), guard.version !== 2
                                                          → { ok: false, reason: 'The trainer rules or epoch changed.' }
plan = planTrainer({ pin, training: state.domains.training, binding, by, recorded: info.recorded })
!plan.ok                                                  → { ok: false, reason: plan.message }
inputHash of buildGuard({ …, inputs: plan.facts }) === guard.inputHash ? { ok: true } : { ok: false, reason: 'The trainer offer evidence changed.' }
```

`planTrainer` is the pure function the live path also calls (live: with `place`, `where`, `npc`, `present`, `die`
read or rolled first; replay: all from `recorded`). It reads only the pin, the `training` slice of the state before
the block, and `recorded`. **It asks no query**: the training part declares no `replayQueries` and needs none, which
is the open-quest rule ("a guard may only ask its own declared replayQueries, `story.evidence`, its state, or
`env.recorded`"). It re-checks: the template exists and is open; the narrowing is a subset; `fee` equals the
formula on `recorded.die`; `recorded.id` is not in `offers`; no offer holds the name key; fewer than 100 offers;
`place` is a string id.

### 6.3 What happens to what was built on an offer

A training request names the offer's `tn_` id. Its guard (`skill.train`, `progress/guard.js`) and the host's step
(`rules.settle { session }`) resolve the trainer from the state before them (§7). So:

* The creating reply is deleted (or swiped away): the offer block is gone; the request block on a later reply now
  fails its guard (`NOT_FOUND`, "That is not a trainer of this world.") and is **inactive** with
  `REPLAY_PREREQUISITE`, as the host keeps any guarded block whose prerequisite went (REPLAY.md "Replay"); the
  settlement step finds no waiting session and is removed by the turn's reconcile (`NO_LONGER_DONE`, a quiet
  `REPLANNED` Problem). A session that had **run** goes the same way: its fee, its sixty minutes and its credits
  were in the settle block (`progress/commands.js:146-160`). See §19 Q5.
* `replyBound: true` on a line-made offer makes it go even when deleting the first replies of a chat would otherwise
  carry their state forward (`store.js:670`, `carriedTo`). A Re-read of that reply drops the old block and runs the
  unchanged line again with its old seed (§5.2), so the offer comes back identical and what was built on it holds.
* A reader-made offer is not reply-bound: a Re-read of the reply it was clicked on keeps it as stored (a kept click,
  REPLAY.md "Re-read"). Deleting that reply removes it like any block of that reply. The one case it survives is
  deleting the chat's first replies while a session that saw them carries their state forward; open quests made
  with "Make this a quest" behave the same today. §19 Q3.

## 7. Training with a recorded offer

New `training/trainers.js`:

```js
// The trainer a ref names: a pack trainer (not a template), else a live open-trainer offer, else null.
export function trainerOf(ix, training, ref) {
    if (isDefId(ref)) return ix.trainer(ref);                      // fixed only (graph.js change below)
    const offer = isTrainerOfferId(ref) ? training?.offers?.[ref] : null;
    return offer ? { id: offer.id, name: offer.name, place: offer.place, skills: offer.skills, fee: offer.fee,
                     minutes: offer.minutes, eventTemplates: offer.eventTemplates, open: true,
                     template: offer.template, where: offer.where } : null;
}
```

`rules/graph.js:29` splits the manifest's trainers by `open === true`: `trainer(ref)`/`trainers` keep **fixed**
trainers only (a template is not someone you can train with, so asking for one is `NOT_FOUND`), and new
`trainerTemplate(ref)`/`trainerTemplates` hold the templates.

Every place that resolves a trainer goes through `trainerOf` with the state's `training` slice, and keeps its checks
word for word:

| Call site (today) | Check kept | Change |
|---|---|---|
| `progress/assess.js:78` `assessRequest` | unknown → `NOT_FOUND` "That is not a trainer of this world."; does not teach → `REFUSED`; one waiting request; exact next session id (`STALE`) | `trainerOf(ix, env.training, payload.trainer)` |
| `progress/session-step.js:51` `planSession` | gone or no longer teaches → refused; form held; clock (`CLOCK_UNSET`); place (`recorded.place` on replay) `!== trainer.place` → refused "<name> is not here."; purse (`recorded.coin`) `< fee` → refused; event die; credits | same, `trainerOf(ix, training, session.trainer)` |
| `progress/session-step.js:86` `rollEvent` | event templates and percent | takes `training`; an offer's `eventTemplates` are the template's |
| `progress/commands.js:150` `settle` | `wallet.pay` note, `director.advance` reason use the name | `trainerOf` |
| `training/queries.js:53,70` `rulesTraining` | offers per held skill; blocked reasons | lists fixed trainers then open offers (§10.1) |
| `training/session.js:78` `sessionView` | fee fallback | trainer from `trainerOf` |

Unchanged on purpose: `expectedSessionId` mixes `key.trainer` (a `tn_` id works as is); `trainingWindow`, the 60
minutes from the pinned constants, the event percent, the day caps, the request's claim
`rb:<epoch>:train-request:<session>` and the settle claim `rb:<epoch>:train:<session>`. "Teaches the next form": an
offer lists **skills**, and `rules.training` offers the character's held skill in its current form, exactly as for
a fixed trainer (`queries.js:54-56`).

## 8. Replay and rebuild: the tests

All in RB. Two harnesses exist and both are used:

* `tests/v2/progress/helpers/world.js` `realWorld(t, { given, sd: true })`: the vendored SB host with RB's rules parts
  and a small SD stand-in (`~ time`, `~ here <place id>`, `atlas.canonical`, `director.advance`). It runs in RB's CI.
  `createHost` registers SB's core module, so a person is made present with SB's own `+ present Old Reka` line
  (`domains/scene.js` `capturePresent`).
* `tests/v2/quests/helpers/real-host.js` `realQuestHost`: the real SD from a sibling checkout; **skips in CI**
  (`skip` when `../Story_director` is absent). Integration twins of the tests below go here.

Fixture: `trainerPack()` (`progress/helpers/fixture.js:33`) plus `content.ranks = [{ id: 'F', title: 'F', levels: [1, 10], reward: [10, 100] }]`
and one template `{ slug: 'drills', name: 'Drills', open: true, rank: 'F', skills: ['s00', 's01'], fee: { coinMin: 10, coinMax: 40 }, minutes: 60, eventTemplates: [] }`
as `openTrainersPin()`. Under seed `seeded(…)` the die is fixed, so each test asserts the exact fee once and then
asserts it never changes. `check()` below means: offer present with the same id, fee, place and skills; the session
in the expected state; coin and clock as expected; `w.problems()` as expected.

New file `tests/v2/training/open-trainers.test.js`:

| Test | Steps | Asserts |
|---|---|---|
| `a line offers a trainer at the place with a fee from the range` | `~ time`, `~ here haven`; `+ trainer Old Reka — drills \| like: drills` | one offer, `by: 'story'`, `place: 'pack.fixture/haven'`, `fee` in 10..40 and equal to the formula on the recorded die; summary names the fee; `narrate: true` |
| `teaches narrows and never adds` | `\| teaches: s01` then a second trainer with `\| teaches: s02` | first offer `skills: [ref('s01')]`; second refused `REFUSED`, nothing written |
| `every refusal of §4.2 is visible and writes nothing` | one sub-test per row 1, 3-9, 11-13 | the receipt's Problem says "Trainer refused" and the code; `training.offers` unchanged |
| `the same name here is a no-op and never rolls again` | the line twice, then `h.cont` with it | one offer, same fee; no Problem |
| `training with an open trainer pays its fee, takes 60 minutes and credits the form` | offer, `skill.train` with the offer's payload, reply | session `completed`, coin −fee, clock +60, `trainCredits` attempts, view fee = offer fee |
| `the trainer stays where it was offered` | offer at haven, `~ here mill`, ask | `blocked: ['Old Reka is not here.']` in `rules.training`; a request made anyway is refused at settle with that reason, no fee, no time |
| `delete the creating reply: the trainer and the pending session go` | offer on reply A; request on reply B (clock unset so it waits); delete A | no offer; session not in `training.sessions`; `store.problems()` has exactly one `REPLAY_PREREQUISITE` (the request block on B); coin and clock unchanged; `rules.training` has no open offers |
| `delete the creating reply after a session ran: fee, time and credits go with it` | offer A, request + settle on B; delete A | coin, clock, attempts and credits as before A; same Problems shape |
| `swipe away and back` | offer and request on the last reply; `h.swipe()` with a reply without the line; then `h.st.swipeTo(last, 0)` | after the swipe: no offer, no session, coin unchanged; after swiping back: the offer with the **same id and fee**, the session back |
| `Re-read of the unchanged creating reply keeps id, fee and what was built on it` | offer A, session ran on B; `h.turn.reread(A)` | offer deep-equal to before; session still completed; coin and clock unchanged; `problems()` empty |
| `Re-read after editing the line makes a new offer and turns the old one's session off` | edit A's line (`teaches:`), Re-read A | a new `tn_` id; the old session's blocks inactive (`REPLAY_PREREQUISITE`); nothing paid twice |
| `rebuild, reload and live agree` | a scripted chat with two offers (line and click), requests, settles, a delete and a Re-read | `structuredClone(h.head())` equals the head after `h.store.rebuild()` and after `h.st.loadChat(clone)`; same `problems()` |
| `the reader action needs a person present` | `trainer.open` for a name not in `scene.present` | `NOT_FOUND`; with the person present, an offer `by: 'reader'` |
| `the reader action is a reader action` | `trainer.open` with `cause: 'system'` and as a nested call | `REFUSED` both |
| `a reader-made trainer survives a Re-read of its reply` | click on reply A, Re-read A | offer unchanged |
| `the guard asks no query` | call `replayTrainer` with the stored guard, its `recorded`, the state before the block and a `query` that throws for every name | `{ ok: true }` (the guard reads the state and `recorded` only) |

Fuzz: extend `tests/v2/progress/fuzz.test.js` with trainer steps (line offer, click offer, request, settle, delete,
swipe, Re-read, reload, rebuild) and its existing property: after every step the head and Problems equal a replay from
the first record. Keep the seed count the file uses today.

## 9. Pinned packs and legacy chats

| Chat | What it sees | Test (file) |
|---|---|---|
| Unpinned (legacy, or never chose a pack) | Training part not registered or deferred; no `trainer` kind, no grammar, no `offers` key. A `+ trainer` line is SB's `UNKNOWN_KIND` Problem, the same as today. | extend `tests/v2/rules/selection.test.js:122` ("no pack: bare boot and a legacy module produce byte-identical chat, domains and prompt…") to also send a `+ trainer Old Reka \| like: x` line in both sessions; still `deepEqual` |
| Pinned to a pack version **without** templates (every Bluewatch ≤ 1.5.0 pin) | Kind disabled (`when` is false), static prompt byte-identical to RB 2.1.0 for that pin, `training` slice unchanged. Updating the installed pack to 1.6.0 changes nothing: the pin is frozen and repinning is refused (`docs/dev/progress.md:30-32`). | `tests/v2/training/open-trainers-pins.test.js`: `staticParts(h.registry)` equal with and without the new code path for `trainersPin()`; and a chat **recorded with RB 2.1.0 / SB 2.3.0** (new fixture `tests/v2/training/fixtures/pinned-2.1.0.json`, made in RB-M1 before any feature change) replays under the new code with the same head and no Problems |
| Pinned to a pack version **with** templates | Kind enabled with the template list; offers resolve from the pin. Disabling, removing or updating the installed pack changes nothing. | same file: disable and remove the pack after an offer; rebuild; offer and training unchanged |
| Pinned under SB 2.3.0, opened with SB 2.4.0 | The pin's `rulesHash` is its own; the installed pack's new hash (§3.4) is never compared to it after pinning. | the fixture test above |

## 10. RB queries and screens

### 10.1 Queries (training part; deferred until pinned like the rest of the part)

* `rules.training({ actor })` (`training/queries.js`): `offers` = the fixed trainers' rows as today, **then** one row
  per live open offer × held skill it teaches, sorted by `where`, then `name`, then `id`. Each row gains
  `open: boolean` and `where: string | null` (fixed: `null`). Blocked reasons are the same five. Additive: the
  contract test `tests/v2/screens/rules/contract.test.js` keeps passing; add the two fields to its fixture.
* `training.openTemplates({})` → `[{ id, name, rank, fee: { coinMin, coinMax }, skills: [{ id, name }] }]` in pack
  order. The kind's `when` and grammar, and the reader form, read it.
* `training.trainers({})` → `{ fixed: [{ id, name, place, fee, skills }], story: [Offer…] }`, story sorted as above.
* `rules.names({ refs })` (`rules/queries.js:102`) also answers `tn_` ids with the offer's name.

### 10.2 Progress screen (`screens/rules/progress.js`, `screens.js:157-170`)

* Offer rows: an open trainer's row reads "Swift Thrust with Old Reka" and its detail
  "fee 54, 1 hour, at Bluewatch Village" (fixed rows as today). The button is the same `skill.train` command button.
* **Story trainers** (the reader's own character only, under the offers): one line each, "Old Reka · Blade drills
  (rank F) · Bluewatch Village · fee 54 · teaches Swift Thrust, Parrying Turn, Poised Step". Hidden when there are none.
* **Make this a trainer** (the reader's own character only, when `training.openTemplates` is non-empty):
  new widget `rpg-battle.trainer-binding` (`screens/rules/widgets.js`, beside `rpg-battle.quest-binding`). Props
  `{ people, templates }`: `people` = `scene.present` minus names that are already trainers. Controls: a person
  select, a template select, one checkbox per template skill (all checked; unchecking narrows; nothing can be
  added), an optional "What they teach" text (max 240), and the shared command button labelled "Make this a trainer"
  sending `trainer.open`. Disabled until a person and a template are chosen; a refusal shows beside the button
  through `failureLine`, as the quest form does. No one present: the form says "Nobody is here to make a trainer."
* Screen tests: `tests/v2/screens/rules/trainer-binding.test.js` (copy `quest-binding.test.js`: exact payload sent,
  refusal shown, unchecking narrows, a skill not in the template cannot be sent) and progress view rows in
  `tests/v2/screens/rules/progress.test.js`.

## 11. Story Director

No runtime change. RB reads SD's `atlas.canonical({})` once, at offer time, and records the id and name (§5.3);
SD's canonical identity rules (`atlas/canonical.js:3-9`: a pack place is its `pack.<id>/<slug>` before and after it is
materialized, an own place is its `pl_` id, an established identity never changes) are what make "stays there"
hold. SD's work is a testkit refresh (§17.1) and one paragraph in `docs/dev/track-a-threads.md` naming RB's trainer
offers as a consumer of the canonical place.

## 12. NPC State Delta

No change. RB asks `npc.identity({ name })` at offer time only to record `npc` for display; with NSD absent or not
answering, `npc` is `null`. No check depends on it, no NSD prompt changes, and NSD's vendored testkit is left as it is.

## 13. Story Studio

Base: Studio main `e327a73`, with Story Block vendored at 2.2.0 (`vendor/story-block/VERSION`, commit `a482fd0`). The
Fixed/Template chips and the Quests filter exist only in the approved mockup (`mockup/records-ux`,
`docs/mockups/records-ux/{desktop,phone}.html`); Studio's `src/screens/records.js` has neither yet.

### 13.1 Sync

`npm run sync-sb -- --from ../Story_block` at the SB 2.4.0 release commit (it also runs `sync-kit`). Then:

* update the golden hashes of §3.4 (`export.test.js`, `studio-browser.test.js`, `golden.test.js`);
* `tests/authoring-kit.test.js` checks the kit stamp; it passes after a clean `sync-kit`;
* keep `tests/fixtures/ersveil-bluewatch.json` (1.4.0) as it is (the golden tests use it); add
  `tests/fixtures/ersveil-bluewatch-1.6.0.json`, a copy of SB's example pack, for the new tests.

### 13.2 Trainers screen

Follow the records-ux mockup's Quests treatment, applied to Trainers:

* Each card carries a chip: **Template** (`chip chip-template`) when `open === true`, else **Fixed** (`chip chip-fixed`).
* A filter row under the header, `role="group"` `aria-label="Show trainers"`: **All** *n*, **Fixed** *n*, **Templates** *n*
  (`skill-tab-btn`, `aria-pressed`), counts from the pack, with the help line "Templates have no place: the story offers
  one with `| like: <slug>`, or the reader uses Make this a trainer. The fee is rolled from the range then."
  The filter choice is per session (not saved in the pack).
* The header note (`records-note`): "Fixed trainers stand at one place with set skills and a fee. Templates are open:
  a skill list and a fee range by rank; RPG Battle places them where the story offers them."
* **+ Add Trainer** opens a two-item menu: *Fixed trainer* (today's default record) and *Trainer template*
  (`{ slug, name, open: true, rank: <first pack rank>, skills: [], fee: { coinMin: 1, coinMax: 1 }, minutes: 60, eventTemplates: [] }`;
  disabled with "Add a rank in Pack settings first." when the pack has no `content.ranks`).
* If the records-ux work for Quests lands first, reuse its chip and filter component; if not, build the component in
  this milestone so Quests and Foes can take it later.

### 13.3 Template editor

A dedicated inspector for `open === true` records (new `src/screens/trainer-template.js`, chosen in
`src/screens/records.js` before the generic `renderForm`); fixed trainers keep the generic form. Fields, in order
(see the mockups):

1. Title row: name, chips `Trainers` and `Template`.
2. Note: "Template: the fee is rolled from this range when a trainer is offered with `| like: <slug>`, and the trainer
   stays where it was offered."
3. `slug`, `name`.
4. `rank`: a select of `content.ranks` (`F — Registered`), with the hint "Rank F quests pay 50–400."
5. Fee range: `coinMin`, `coinMax` side by side, with a live sentence "A session costs between 40 and 90 crowns; the
   narrator never sets it." Inline errors: "Lowest fee must not be above the highest." (path `…fee`), "1 to 1,000,000".
   A warning (not an error) when `coinMax` is above the rank's reward maximum, worded as the checker's note (§14.3).
6. `minutes`: read-only "60 minutes (fixed by the rules)".
7. Skills: a search box and checkboxes grouped by class (tier label and class name as headings, skills in class
   order), the count "6 selected of 30 at most", and the line "The story may narrow this list, never add to it."
   Unknown refs already in the record are listed in a warning row with a remove button.
8. Event templates: checkboxes of `content.events` (0 to 8).
9. Narrator line: a read-only code line `+ trainer <Name> — <what they teach> | like: open-blade-drills` and the narrowing
   example `| teaches: swift-thrust, parrying-turn`, with a **Copy** button.
10. Actions: **Convert to fixed trainer…** (a dialog asking a place, default fee `coinMin`; writes `place`, `fee`,
    drops `open`/`rank`) and **Delete**. A fixed trainer's inspector gets **Convert to template** (drops `place`,
    `fee: n` becomes `{ coinMin: n, coinMax: n }`, `rank` = first pack rank).

Every edit goes through `src/edits.js` / `apply-edit.js` like other records, so undo, Problems and export work
unchanged. `src/model.js:401-404` (`addRef` for a trainer's `place`) skips records with `open === true`.
`src/form-schema.js` `refTarget` for `trainers` already maps `skills` and `eventTemplates`; no change.

Phone (390 px): the columns stack as in records-ux's phone mockup (pack parts row, list, then inspector); the fee
inputs stack below 420 px; every control is at least 44 px tall; no horizontal page scroll.

### 13.4 Studio tests

* `tests/trainers.test.js` (new): chips and filter counts on the 1.6.0 fixture (All 11, Fixed 7, Templates 4); Add menu
  defaults; conversion both ways round-trips through `exportRulesV2` with `ok: true`; an inverted fee shows its error
  on the fee field from the vendored validator's path; editing a template keeps the other records' bytes.
* `tests/studio-browser.test.js`: open Trainers at 1280 and 390, filter to Templates, select one, check no horizontal
  scroll and 44 px controls (the file's existing helpers).
* `npm run build` and the committed `dist/story-studio.html` updated (CI's last step diffs it).

## 14. Authoring kit (SB `authoring-kit/`, copied into Studio)

### 14.1 Prompt `prompts/rules-pack/07-trainers-shops-recipes.md`

Keep (a) and (b) as they are. Insert after (a):

```
(c) Optional, trainer templates: teachers the story may meet anywhere (a wandering swordsman, a retired sergeant,
a hedge witch), from {{TRAINER_SOURCES}}. Each {"slug","name","open":true,"rank":"<a rank id from content.ranks>",
"skills":[1-30 skill slugs],"fee":{"coinMin":<at least 1>,"coinMax":<at most 1000000, not below coinMin>},
"minutes":60,"eventTemplates":[]}. A template has no "place": it stands where the story offers it, with
"+ trainer Name | like: <slug>". Its name says what kind of teaching it is ("Blade drills"), never who teaches.
List the skills of one class and the class above it on the same line; the story may narrow the list, never add to
it. Keep the fee range near the fixed trainers' fees for the same tiers; code rolls the fee inside it when a trainer
is offered. Write two to four templates, or none.
```

Change the Output line to "trainers (fixed ones and templates in the same list) go to content.rules[0].trainers".
Add to Typical problems: "`envelope-unknown` on a template's `place` (templates have none), `bad-schema` on a
template whose fee is one number, whose coinMin is above coinMax, or whose rank is not in content.ranks." The kit
names no world and no model (`kit.test.js:428`).

### 14.2 Checker hints (`authoring-kit/check.mjs` `hintFor`)

Sharper lines, before the code table, keyed on the error's `path` and message (the codes are the prototype's):

| Code and where | Hint |
|---|---|
| `envelope-unknown` at `…trainers[i].place` | "A trainer template has no place: it stands where the story offers it. Remove "place", or remove "open" to make a fixed trainer." |
| `bad-schema` at `…trainers[i].fee`, message "Expected object" | "A trainer template's fee is a range: {"coinMin": 30, "coinMax": 80}." |
| `bad-schema` at `…trainers[i].fee`, message "must be ordered" | "coinMin must not be above coinMax." |
| `bad-schema` at `…trainers[i].rank` | "Name a rank id from content.ranks, such as "F"." |

Fixed trainers never produce the first two (they have a place and an integer fee), so the keys are unambiguous.

### 14.3 Checker note (advice, exit code unchanged)

`checkPack` adds a `note:` (the existing notes list) for each template whose `fee.coinMax` is above its rank's
`reward[1]`: "content.rules[0].trainers[i]: a lesson can cost up to <coinMax>, more than a whole rank <id> quest pays
(<reward max>). Check the range." Notes print after OK and never fail the check.

### 14.4 `LIMITS.md` (generated)

`authoring-kit/scripts/limits.mjs`: read `defs.fixedTrainer`, `defs.openTrainer` and `defs.openFee` instead of
`defs.trainer` (`:28`). Rows:

* sizes table: "Trainers (fixed and templates together)" — `0 to 100 entries`.
* "Trainer (fixed)": `place a full place id; skills 1 to 30; fee 1 to 1,000,000 (never 0); minutes exactly 60; up to 8 eventTemplates`.
* "Trainer template": `` `open: true`, a `rank` that names a pack rank, no `place`; skills 1 to 30; fee `{ coinMin, coinMax }`, each 1 to 1,000,000, coinMin not above coinMax; minutes exactly 60; up to 8 eventTemplates ``.

Every number from the defs. Regenerate with `node authoring-kit/scripts/limits.mjs > authoring-kit/reference/LIMITS.md`.

### 14.5 Kit tests (`tests/v2/authoring-kit/kit.test.js`)

* "the master prompt and the steps state…" (`:323`): read `defs.fixedTrainer`, and assert step 07 states
  `"minutes":60`, `"open":true`, `"coinMin"`, `"coinMax"`, `at most 1000000` for both kinds.
* "a grid of the exact rules the prompts promise is enforced by the checker" (`:363`): add rows: a template with a
  place is refused; an inverted range is refused; an unknown rank is refused; a one-number fee is refused.
* "every error code … gets a hint" (`:78`) unchanged; add a test that the four sharper hints of §14.2 come back for
  the prototype's errors.
* Studio picks all of this up through `npm run sync-kit` (stamp in `authoring-kit/VERSION`).

## 15. Ersveil: Bluewatch Starter 1.6.0

`examples/packs/ersveil-bluewatch/pack.json`: `version` `1.5.0` → `1.6.0`; append four templates to
`content.rules[0].trainers` after the seven fixed trainers. No other record changes; every existing slug stays.

| slug | name | rank | skills (class lines, tiers 0 and 1) | fee |
|---|---|---|---|---|
| `open-blade-drills` | Blade drills | F | swift-thrust, parrying-turn, poised-step (Blade Initiate); riposte-lunge, flickering-guard, duelists-mark (Mirage Fencer) | 40–90 |
| `open-spear-and-shield` | Spear and shield drills | F | brace-spear, shield-bash, watchmans-grit (Militiaman); iron-breathing, guard-cleave, stalwart-line (Iron Cadet) | 35–80 |
| `open-street-craft` | Street craft | F | river-skiff-footwork, hidden-shiv, slum-instinct (Barge Drifter); cane-draw, gutter-feint, low-strike (Slum Stalker) | 30–70 |
| `open-hedge-lessons` | Hedge-magic lessons | E | spark-dart, mana-shield, attunement-pulse (Hedge Apprentice); frost-shard, force-pulse, arcane-barrier (Spell Weaver) | 80–160 |

Each is `{ "slug", "name", "open": true, "rank", "skills": [6 slugs], "fee": { "coinMin", "coinMax" }, "minutes": 60, "eventTemplates": [] }`.
The flame line has no template: its teachers are temple people the pack already places (Brother Kadren, Inquisitor
Valeria). Fees sit beside the fixed trainers' 40 to 150; all are under rank F's (400) and E's (3,000) reward maximums,
so §14.3's note stays quiet. Prototype: the pack validates with them (`ok`, no warnings); its rules hash under §3.1's
schema is `2a56f0cf…` (Studio's top bar fingerprint in the mockups), and 1.5.0's becomes `54e84627…` (from `93ba9d4e…`).

Docs and tests:

* `docs/v2/ERSVEIL.md` §3: "Pack **1.6.0** adds four open trainer templates (blade, spear and shield, street craft,
  hedge magic)…", and the import line's counts if they list trainers.
* `README.md:73`: name 1.6.0 and the templates.
* `tests/v2/packs/ersveil.test.js:57` and `rules-v2/open-templates.test.js:32,36`: `1.6.0`.
* New in `open-trainers.test.js`: `Ersveil 1.6.0 ships four bounded trainer templates matching its class lines`
  (the four slugs; each template's skills are exactly the six skills of a tier-0 class and its tier-1 child; ranks F,
  F, F, E; fees as above; every fixed trainer unchanged from 1.5.0).
* Studio and RB keep their own older copies of the pack as fixtures; only Studio adds the 1.6.0 copy (§13.1).

## 16. Milestones

Order: **SB first** (the schema everyone vendors), then SD and RB in parallel on SB 2.4.0, then Studio (it needs only
SB 2.4.0, so it can run beside RB). One PR per milestone; each passes its repo's CI (`git diff --check`, `npm run check`,
`npm test` on Node 24).

### Story Block (2.4.0)

| # | Work | Done when |
|---|---|---|
| SB-M1 | §3: schema in three copies + kit reference copy, validator, contract text, tests §3.6, updates §3.7 | the §3.6 tests pass; the full SB suite passes; the Bluewatch 1.5.0 pack and every example pack still validate; `exportRulesV2` round-trips a pack with templates |
| SB-M2 | §14: prompt 07, `hintFor`, checker note, `limits.mjs`, regenerated `LIMITS.md`, kit tests | `node authoring-kit/check.mjs` on a pack with each §3.6 mistake prints the §14.2 hint; `LIMITS.md` equals `limits.mjs` output; kit tests pass |
| SB-M3 | §15: Bluewatch 1.6.0, ERSVEIL.md, README, tests | `node authoring-kit/check.mjs examples/packs/ersveil-bluewatch/pack.json` prints OK with no notes; the 1.6.0 test passes |
| SB-M4 | `docs/v2/PACKS.md` "Rules packs" paragraph on templates, `docs/v2/GUIDE.md` reader line, CHANGELOG 2.4.0 with upgrade notes (§17.3), `package.json` 2.4.0 | release PR merged; `npm run matrix` green with RB and SD main beside it (they ignore templates) |

### Story Director (no version change)

| # | Work | Done when |
|---|---|---|
| SD-M1 | `node ../Story_block/scripts/sync-testkit.mjs --to .` at the SB 2.4.0 commit; `docs/dev/track-a-threads.md` paragraph (§11) | `tests/vendor/story-block/VERSION` names the SB 2.4.0 commit; SD suite passes; no file under `src/` changed |

### RPG Battle (2.2.0)

| # | Work | Done when |
|---|---|---|
| RB-M1 | Re-vendor SB 2.4.0 (`npm run sync-testkit`) and SD (`npm run sync-director`); record the `pinned-2.1.0.json` fixture **with the RB 2.1.0 code** first; `graph.js` split (fixed vs templates); `trainerOf`; `training` validator with `offers`; `isTrainerRef` | RB suite passes with no behaviour change for fixed trainers; `rules.training` for a pin with templates lists no template as a trainer; the fixture replays identically |
| RB-M2 | `trainer` kind (§4.1-4.2) with `when` and `grammarFor(settings, query)` in `module.js`; `trainer.open` (§4.3); `planTrainer`/`commitTrainer`/`replayTrainer` (§5, §6); queries §10.1 | the line and command tests of §8 (offer, narrowing, every refusal, no-op, reader-only, needs presence, guard asks no query) pass |
| RB-M3 | §7 call sites; the replay tests of §8; §9 tests; fuzz | every §8 and §9 test passes; `npm test` with Story_director beside it passes (the real-host twins run) |
| RB-M4 | §10.2 screens and widget; screen tests | widget and progress tests pass; the Progress screen shows offer rows, Story trainers and the form in the screen fixtures |
| RB-M5 | `docs/dev/progress.md` "Open trainers" section, `README.md`, CHANGELOG 2.2.0 with upgrade notes, version 2.2.0 in `package.json`, `manifest.json`, `src/v2/module.js` `VERSION` | release PR merged; SB `npm run matrix` green with RB 2.2.0 |

### Story Studio (0.1.0 unchanged; see §19 Q10)

| # | Work | Done when |
|---|---|---|
| ST-M1 | §13.1 sync; golden hashes; `model.js` skip | Studio suite (unit and browser) passes on the new vendor; the kit stamp test passes |
| ST-M2 | §13.2 chips, filter, Add menu | `tests/trainers.test.js` chip and filter tests pass |
| ST-M3 | §13.3 editor and conversions; §13.4 tests; `npm run build` | browser tests at 1280 and 390 pass; `dist/story-studio.html` committed and CI's diff step is clean |

### Cross-repo order

```
SB-M1 → SB-M2 → SB-M3 → SB-M4 (release 2.4.0)
                                  ├─ SD-M1
                                  ├─ RB-M1 → RB-M2 → RB-M3 → RB-M4 → RB-M5 (release 2.2.0)
                                  └─ ST-M1 → ST-M2 → ST-M3
final: suite-check (§18) with SB 2.4.0, RB 2.2.0, SD main, NSD main side by side
```

## 17. Vendoring, versions and upgrade notes

### 17.1 How the repos vendor each other (verified)

* **RB vendors SB** in `tests/vendor/story-block/` with SB's `scripts/sync-testkit.mjs` (`npm run sync-testkit`, which
  runs `node ${STORY_BLOCK:-../Story_block}/scripts/sync-testkit.mjs --to .`). It copies `testkit/`, `src/v2/`,
  `src/id.js` and what they import, and writes `VERSION` (`Story Block <package version>`, `commit`, `files`,
  `matrix`). Today RB's copy is from SB `46cd7b9` (labelled 2.0.0, before 2.1.0's release), not from main.
* **RB vendors SD** in `tests/vendor/story-director/` with RB's own `scripts/sync-director.mjs`
  (`npm run sync-director`, `--from ${STORY_DIRECTOR:-../Story_director}`): `src/v2/` plus what it imports and
  `tests/v2/checks/roll.test.js`. Today from SD `8fe62a5`; only `src/v2/module.js` differs from SD main (its version).
* **SD vendors SB** the same way (no npm script; run SB's script from SD's root). Today from SB `c23df16`.
* **Studio vendors SB** in `vendor/story-block/` with `npm run sync-sb` (and the kit with `sync-kit`). Today SB 2.2.0 `a482fd0`.
* RB's fixtures validate packs with the **vendored** SB (`progress/helpers/fixture.js:4`), so RB cannot test templates
  until its vendored SB has the new schema: RB-M1 re-vendors first.
* Probe: SB main `dd130d7` synced into copies of RB and SD with `sync-testkit`: RB 2,481 pass (+ the same todo), SD 950
  pass, so bringing the vendored copies up to SB main costs nothing before the feature work. The real-host
  quest tests and the `break` suites import the **sibling** `../Story_director`, not the vendored copy, and skip in CI.

### 17.2 Versions

| Repo | From | To | Why |
|---|---|---|---|
| SB | 2.3.0 | **2.4.0** | schema, validator, kit, example pack |
| RB | 2.1.0 | **2.2.0** | new kind, command, queries, screens |
| SD | 2.1.0 | unchanged | vendored testkit and a doc paragraph only |
| Studio | 0.1.0 | unchanged | §19 Q10 |
| NSD | 1.3.0 | unchanged | no change |
| Bluewatch pack | 1.5.0 | **1.6.0** | four templates |

RB's `requires.storyBlock` (`>=2.0.0-beta.2`, `module.js:358`) can stay: on SB 2.3.0 no pack with templates installs
(SB 2.3.0 refuses `open` on a trainer), so RB 2.2.0 never sees one there. The other way round, RB 2.1.0 pins a 1.6.0
pack without complaint (its `rules/pin.js` `manifestProblems` does not look at trainers) and then lists each template
as a trainer who is never here (no `place`), whose fee is not shown; nothing can be trained with one.

### 17.3 Upgrade notes (draft text)

SB CHANGELOG 2.4.0:

> - **Open trainer templates:** a rules pack can list trainers with `"open": true`, a rank and a fee range instead of a
>   place and a fee. With RPG Battle 2.2.0 the narrator offers one with `+ trainer Name | like: <template>` (optionally
>   `| teaches: …` to narrow its skills), or the reader uses **Make this a trainer** on someone present. The fee is rolled
>   from the range when the trainer is offered and recorded with the offer; the trainer stays where it was offered.
> - Ersveil: Bluewatch Starter 1.6.0 adds four templates. The authoring kit's step 7 and checker know templates.
>
> ### Upgrading from 2.3
>
> Update RPG Battle to 2.2.0 with this release. Every rules pack's fingerprint (rules hash) changes because the rules
> schema changed; chats already pinned to a pack keep their own copy and play on unchanged. Existing pins never gain
> templates: start a new character timeline to pin 1.6.0. Story Director and NPC State Delta need no update.

RB CHANGELOG 2.2.0:

> - **Open trainers:** a pinned pack's trainer templates can be offered by the narrator (`+ trainer Name — what they
>   teach | like: <template>`) or by the reader (**Make this a trainer** in Progress → Training). Code checks the
>   template, narrows its skills only as asked, rolls the fee from the template's range, binds the trainer to the place
>   it was offered and records all of it. Training with one has the same fee, place, clock and session checks as a fixed
>   trainer. Deleting the reply that offered a trainer removes it and what was trained with it.
>
> ### Upgrading from 2.1
>
> Needs Story Block 2.4.0 for packs with templates. Chats without a pinned pack, and chats pinned to a pack without
> templates, are byte-identical. With RPG Battle 2.1.0 and Story Block 2.4.0 together, a pack's templates show in the
> training list as trainers who are never "here"; update RPG Battle.

## 18. Risks and the checks a reviewer should run

| Risk | Check |
|---|---|
| Every rules hash changes (§3.4) | SB golden updated with the recomputed value; Studio's three test files updated; the pinned 2.1.0 fixture (§9) replays clean |
| RB 2.1.0 on SB 2.4.0 lists templates as trainers (§17.3) | read the upgrade note; optionally run RB 2.1.0's suite against SB 2.4.0's testkit: it should still pass (no fixture has templates) |
| A template mistaken for a trainer in RB 2.2.0 | `graph.js` split test: `ix.trainer(<template ref>)` is null; `skill.train` with a template ref is `NOT_FOUND` |
| Re-roll on replay | the guard test that throws on every query; the Re-read and rebuild tests compare the fee and id deep-equal |
| A trainer moving | the "stays where it was offered" test; place compared by canonical id only |
| Static prompt drift in unpinned or template-less chats | §9 tests; `staticParts` equality; SB `npm run matrix` "static prompt" column |
| Guard reading something outside the replay rule | `planTrainer` imports no query; code review: `replayTrainer` passes `query` nowhere |
| Reader-made trainer surviving deletion of a chat's first replies (§6.3) | accepted gap, documented; §19 Q3 |
| Studio filter built twice (records-ux) | ST-M2 reuses or creates one component |
| Kit and Studio copy drift | `kit.test.js` reference and LIMITS tests; Studio's kit stamp test |
| `replyBound` on a story line's block is new use (today only `rules.pin` and `dm.pin`/`dm.attach`/`dm.migrate`, all commands) | RB-M3's Re-read tests: the unchanged line comes back with the same id and fee, and what was built on it holds |

Commands for a reviewer, all on Node 24 with the repos side by side:

```sh
# each repo
npx -y node@24 --test "tests/*.test.js" "tests/v2/**/*.test.js"            # RB, SD (SB adds examples/fishing/tests)
npm run check
git diff --check origin/main...HEAD
# Story Block
node authoring-kit/check.mjs examples/packs/ersveil-bluewatch/pack.json   # OK, no notes
node authoring-kit/scripts/limits.mjs | diff - authoring-kit/reference/LIMITS.md
npx -y node@24 scripts/matrix.mjs                                         # all rows ok
bash .claude/skills/suite-check/suite-check.sh <folder>                   # SB, RB, SD, NSD, cross-repo tests that skip in CI
for s in $(seq 1 50); do node scripts/fuzz-replay.mjs $s 120 4; done | grep -v '"fails":\[\]'   # prints nothing
# Studio
npm ci && npx playwright install chromium && npm run check && npm test && npm run build && git diff --exit-code -- dist/
```

Manual checks in SillyTavern with SB 2.4.0, SD, RB 2.2.0 and Bluewatch 1.6.0 pinned:

1. Narrator writes `+ trainer Old Reka — blade drills | like: open-blade-drills | teaches: swift-thrust, parrying-turn`.
   The reply card shows the offer and fee; Progress → Training lists Swift Thrust with Old Reka.
2. Ask for training at the same place: fee paid once, an hour passes, credits given. Walk elsewhere: "Old Reka is not here."
3. Swipe the offer reply: Old Reka is gone. Swipe back: the same fee.
4. Re-read the offer reply: nothing changes. Delete it: Old Reka and the training go; a Problem names the request.
5. Make this a trainer on someone present with Hedge-magic lessons and two skills unchecked: only four skills offered.

## 19. Open questions, each with a recommendation

| # | Question | Recommendation |
|---|---|---|
| Q1 | Should a template's fee range be bounded by its rank's reward range, as an open quest's reward is? | **No hard bound.** Lesson fees are an order below quest pay (Bluewatch's fixed fees 40–150 under rank F's 50–400; a bound would refuse fees under 50 at F). The rank labels the template and drives the checker note (§14.3) and Studio's hint. |
| Q2 | "Rolled" (seeded die, recorded) or open quests' formula (`min + floor((max-min)·tier/9)` from the recorded area tier)? | **Seeded d1000, recorded**, as the rule says "rolled". It never re-rolls (§5.2). If fees should rise with danger instead, swap `die` for the area tier in `planTrainer`; the record, guard and tests keep their shape. |
| Q3 | Reply-bound for reader-made trainers too? | **Story lines only.** Reply-bound clicks would vanish on a Re-read of the reply they were clicked on (REPLAY.md "Reply-bound guards"). The cost: deleting a chat's first replies can carry a reader-made trainer forward, as it carries a reader-opened quest today. |
| Q4 | Let the narrator retire a trainer (`- trainer Name`)? | **Not now.** Rule 4 says it stays; only deleting the reply removes it. A later release can add `- trainer` with its own guard. |
| Q5 | Does a session that already ran survive deleting its trainer's reply? | **No.** A guarded block whose prerequisite is gone is off; the fee, the hour and the credits go with the session, as with every other prerequisite in RB. Tested (§8). |
| Q6 | Tell the narrator about the offer (`narrate: true`)? Open quests use `narrate: false`. | **Yes**, so the story quotes the right fee and place. It is one short sentence on the next reply. |
| Q7 | One open trainer per name per chat? | **Yes.** A person teaches at one place; a second offer elsewhere is refused with where they are. |
| Q8 | Can the reader make a trainer of someone not present (typed name)? | **No.** The action is "on an NPC": the people `scene.present` lists. |
| Q9 | Limit on story trainers per chat? | **100** (`MAX_OFFERS`), the same as a pack's trainer list. |
| Q10 | Studio version? | **Leave 0.1.0**; the vendored SB stamp records the change. Bump when Studio starts numbered releases. |
| Q11 | A fifth template for the flame line? | **No.** Its teachers are temple people the pack already places as fixed trainers. Easy to add later. |
| Q12 | A capability (`rb-open-trainers`) on packs with templates, so RB 2.1.0 refuses them? | **No.** It would refuse the whole pack on RB 2.1.0 for the sake of four records. Ship SB 2.4.0 and RB 2.2.0 together and say so in the notes. |
| Q13 | Where does "Make this a trainer" live? | **RB Progress → Training**, beside the offers it creates. SB's Scene screen stays module-neutral and NSD stays unchanged. |
| Q14 | Should templates be per rank (one range for each rank) rather than one rank and one range? | **One rank, one range**, as `openQuest` has one `rank` and one `openReward`. An author who wants a ladder writes one template per rank (Bluewatch's quests do). |

## Appendix: probe results

* Prototype (scratch copy of SB `dd130d7` with §3.1-3.2): Bluewatch with the four templates validates (`ok`, no warnings);
  resolved 11 trainers; export round-trip equal; host `validatePack` ok. Unchanged Bluewatch 1.5.0 still validates.
  `smallRulesPack` hashes: see §3.4.
* SB suite against the prototype: the 8 failures of §3.7, and `tests/v2/scripts/sync-testkit.test.js` "sync into a module
  checkout…", which only fails because the scratch copy is not a git checkout (it passes on the real clone).
* Vendoring probe: SB `dd130d7` synced into scratch copies of RB (from `46cd7b9`) and SD (from `c23df16`): RB 2,481 pass,
  1 todo, 0 fail; SD 950 pass, 0 fail.
* Mockups: generated from `docs/mockups/records-ux/{desktop,phone}.html` on Studio's `mockup/records-ux` branch (their
  `<style>`, top bar and pack-parts rail reused as they are), measured in headless Chromium: desktop 1280 × 3,749 px,
  phone 390 × 5,599 px, page width equal to the viewport, every button, input, select and summary at least 44 px tall.

## Decisions (approved 27 Oct)

- The editor mockups in `docs/v2/mockups/open-trainers/` are approved as drawn.
- All open questions in §19 are accepted as recommended: the fee range is not held inside the rank's quest reward range
  (the checker warns); a seeded roll with the die recorded; click-made trainers are not reply-bound; no `- trainer` line in
  this release; a session already run goes with its trainer's reply; the narrator is told about each offer; one trainer per
  name per chat; only people present can be picked; at most 100 per chat; Studio stays 0.1.0; no fifth template; no
  capability flag (Story Block 2.4.0 and RPG Battle 2.2.0 ship together, stated in both release notes); "Make this a
  trainer" lives in RPG Battle's Progress screen; one rank and one fee range per template.
- Build order: Story Block 2.4.0 (M1–M4) first; then RPG Battle 2.2.0, Story Director's re-vendor and Studio in parallel;
  the four-repo suite check last. Test on Node 24 (CI's version) as well as Node 22.
