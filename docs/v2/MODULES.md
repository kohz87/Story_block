# Story Suite v2: module layouts (companion to SPEC.md)

Exact data layouts and command ownership for the phase 2 and 3 modules, so agents working in parallel on
the same module agree on shapes. SPEC.md rules apply throughout (IDs, integers, one writer per domain, pure
synchronous handlers, capture as `story` commands, no JSON in prompts).

Data-defined modules use Story Block's trusted part rather than executable authored parts, merged into `story-block`
like any other part (`src/v2/data-modules/part.js`: domain `dataModules`, kind `dm`, the `dm.*` commands, the
`dataModules.*` queries, `afterCapture` / `beforeGenerate` hooks, a replay guard for `dm.*` predicates behind the host-owned
dispatcher, tail and static context): see [DATA_MODULES.md](DATA_MODULES.md) and its approved decisions. The
[implementation notes](DATA_MODULES_IMPLEMENTATION.md) record the delivery and the simulator's entry points.

## A. How a module with several agents is put together

Each agent writes a **part** in its own folder and exports it from `src/v2/<part>/index.js`:

```js
export const part = {
  domains:  { /* name: { initial, validate } */ },
  commands: { /* type: handler(ctx, payload) */ },
  queries:  { /* name: (state, args) => plain data */ },
  kinds:    { /* kind: { grammar: 'one line', apply(ctx, line) } */ },   // change-line kinds
  context:  { static: () => '' /* may be '' */, tail: view => ({ lines: [], optional: [] }), budget: 0 },
  hooks:    { /* 'item.define' | 'currency' | 'beforeGenerate' | 'afterCapture': fn */ },
  settings: { section: 'Combat', defaults: {}, schema: {} },
  tabs:     [ /* { id, title, icon, render(el, view, api) } */ ],
};
```

The coordinator writes `src/v2/module.js`, which merges the parts into the one `registerModule` definition
(capture `apply` dispatches by `line.kind` to the part's `kinds[kind].apply`; statics are joined in part
order; tails concatenated; budgets summed). Parts never import each other's internals; they use
`ctx.read`/`ctx.call`/`ctx.query`-style access through queries and commands, even inside one module.
Shared pure helpers that more than one part needs live in v1's existing `src/*.js` files (imported, not
copied); a part may *add* a new pure helper file under its own folder only.

Tests for a part use a fake ctx implementing SPEC §3.2 (`read`, `draft`, `call`, `claim`, `rng`, `roll`,
`settings`, `time`, `fail`, `receiptId`) plus `query(name, args)`; keep it in `tests/v2/helpers/` of your part
(`tests/v2/<part>/helpers/fake-ctx.js`).

**Capabilities.** A module definition may declare `capabilities: ['example-capability', …]`: the names a pack can list in
`requires.capabilities` that this module provides (PACKS.md). Each is a slug (lowercase words joined by `-`, at most 64
characters), the list holds at most 32 names, and a malformed list is refused when the module registers. Duplicates are
dropped. `sdk.modules()` shows the list on each entry as a frozen `capabilities` array (empty when the module declares
none), also while the module is dormant: a pack is installed into the library whatever its peers are doing.

## C. Story Director (module id `story-director`)

### C1. `director` (part **tracker**, agent SD-tracker)
```js
director = {
  time: { minutes: null | int },                     // story clock on the reader's calendar (settings)
  threads: { [id]: {
    id, kind: 'agenda'|'event'|'hook'|'quest'|'clock'|'beat'|'secret', key, summary: '',
    fields: { /* label: value as written, e.g. giver, step, goal, due, reward, type */ },
    status: 'active' | 'resolved',
    offer: false | true,                             // a job offered, not yet taken
    shown: null | { turn },                          // a held offer (F88) is shown from this Director turn
    ready: false | true,                             // the story said a goal code cannot count is met (F83)
    taken: null | { rev },                           // when the story (or the reader) took it on
    ended: null | { rev, reason, outcome: 'done'|'failed'|'abandoned'|'declined'|'superseded' },
    target: null | { noun, count, kind: 'foes'|'items' },
    reward: null | { amount: int|null, each: false|true, unit: '', text: '' },
    rev,                                             // last touched
  } },
  keys: { [lowercase key or alias]: id },
  problems: [{ rev, kind, text }],                   // last 50
}
```
Kinds: `agenda`, `event`, `hook`, `quest`, `clock`, `beat`, `secret` (v1 grammar and tracker rules: v1
`src/tracker.js` behaviour ported to these records), `time` (`~ time Goldwane 12, 12:45 pm` or
`! time +2h`). Context: static = the Director's change-line rules; tail = the Director note (v1 `note.js`
rules: due, relevant, checks), budget ~500. Queries: `director.time`, `director.threads({ kind, status })`,
`director.thread({ key })`. Tab: **Director** (threads, problems).

### C2. Story-told quests

Quests are tracked as Director threads. The story tells their goals and rewards; older quest
extensions remain visible but read-only. The Quests screen reads the Director's threads.

## D. NPC State Delta (agent NSD-hosted)
No domain. When `globalThis.StoryBlock?.sdk` (v2) is present, NSD registers module `npc-state-delta` with
queries `npc.present`, `npc.dossier({ name })`, `npc.known`, a **Dossiers** tab (id `cast`: its dossier list;
the present cast's cards are on Story Director's World screen, F119, or at the top of Dossiers without it), and a
settings `section` that mounts its existing settings panel; its drawer copy is hidden while hosted and
comes back if the host goes away. NSD's own storage, capture and prompt keys are unchanged.

## E. Story Block phase 3 parts (in `src/v2/<part>/`)
* **packs** (agent SB-packs): `pack.json` validation (SPEC §9), import from a file and from a card lorebook
  entry tagged `[storysuite:pack]`, installed list in `extension_settings.storySuite.packs`; pack item defs
  resolve before story defs (`pack.<id>/<slug>`); a pack's `start` merges into the initial state; queries
  `packs.list`, `packs.content({ kind })`.
* **events** (agent SB-events): condition language (numbers, strings, `== != < <= > >= && || !`, calls to
  queries: `query('party.pc').level >= 30`, `quest('Granary Rats').status == 'resolved'`), event defs
  `{ id, when, cue, once, then: [{ command, payload }] }` from packs, evaluated in `beforeGenerate`; a met
  event commits a `system` receipt (claim `event:<id>`) whose summary is the cue; checkpoint chains
  (`after: <event id>`).
* **layouts** (agent SB-layouts): a declarative widget tree (`box`, `row`, `grid`, `text`, `meter`, `list`,
  `image`, `badge`, `button` → command, `tabs`) with bindings `{ query, args, path }`, theme tokens (CSS
  variables), rendered by the tab host; a pack's `layouts` add tabs. No HTML or script from packs.
* **fishing** (agent SB-fishing): a separate example extension in `examples/fishing/` (its own
  manifest.json, index.js) using only the public sdk: a cast/wait/hook/reel mini-game UI, the catch
  resolved by its own command `fishing.cast` (seeded), the fish granted via `inventory.grant` from that
  receipt, narrated once.

## F. Decisions from the first reports (coordinator)

These settle questions agents raised; the host changes they need are made at integration.

1. **Money: one currency.** (User decision, supersedes tiers.) A chat has one currency with one name
   (gold, Gil, denar…), set in Story Block's settings (default `gold`); the reader may rename it, never add a
   second. A wallet is one integer per owner: `wallets[owner] = { coin: n }`. The query `inventory.currency`
   → `{ name, plural, short }` (`name` is singular, "1 mark"; `plural` for any other amount, "44 marks",
   by default the name with an s, and gold stays gold; a pack may suggest all three). `wallet.pay` / `wallet.receive` take `{ owner, amount, note? }`. Prices, rewards
   and loot are whole numbers of that currency (v1's copper-based numbers are kept as they are). The change
   line is `+ coin 30 | from: the sealer`; the currency's own words around the number are ignored, only the
   number counts, and a coin word that is not this chat's money ("40 silver" where money is pennies) is refused
   (F122).
   The currency is only a name: the money **scale** comes from the pack (F104, query `inventory.economy`).
2. **`ctx.rev`** is the `meta.rev` this receipt will have. Use it for `taken.rev`, `ended.rev`, etc.
3. **Queries can use queries:** a query is called `(state, args, tools)` with `tools.query(name, args)`
   over the same state, and `tools.reply` (`{ index, sid }` or null): the reply the asking command is
   stored on, as its `ctx.reply` (SPEC §4.2), the head carrier for `sdk.query`.
4. **`REFUSED`** is the code for a rule refusal (full HP, wrong place, slot limit, not ready); `INVALID`
   stays for malformed payloads and failed validators.
5. **Command payloads** (callers use exactly these):
   `inventory.consume { stack, qty }`, `inventory.transfer { stack, to, qty }`, `inventory.equip { stack, slot }`,
   `inventory.unequip { stack }`, `inventory.grant { def | defId, qty, owner, note? }` (a module's command only,
   never a button), `wallet.receive { owner, amount, note?, story? }`, `wallet.pay { owner, amount, note? }`.
   Queries: `inventory.items({ owner? })` → `[{ stack, def, name, kind, qty, owner, equipped, note }]`;
   `inventory.wallet({ owner? })`; Story Director's `director.threads({ kind, status })` and `checks.policy`.
6. **Equipment** defs have `stack: false`; `inventory.grant` of equipment makes one stack per piece (qty 1).
7. **Quests are told by the story.** (User decision, Story Director 2.2.) A quest closes when the story says it
   is done (`- quest`); no fight, count or turn-in pays it, and its reward is what the story gives.
8. **Effects** may carry `damage` (combat items) besides `heal`, `mp`, `cure`.
9. **Widget names are namespaced** `<module-id>.<name>`; standard widgets use `ss.*`, while module widgets use their own id, such as `fishing-activity.fishing`.

10. **Themes** use §13.3's CSS custom properties (`theme: { '--ss-accent': '#7c5cff' }`) for screens; the
   layout renderer's `tokens` are mapped onto them at integration.
11. **Portraits.** The PC's portrait is the persona avatar; a companion or NPC's portrait comes from NSD
   (`npc.portrait({ name })` → URL or null, from its dossier/avatar data); packs may supply their own.
   No image generation.
12. **Generation blockers.** A module may use `canGenerate` to block generation with a reason and an optional action handled by its `onBlocked` hook.

13. **No model-written state blocks.** v2 never asks the model for World State, Inventory, Party or other
   state blocks; screens and the prompt's tail come from the state. The only block the model writes is
   `<Changes>`.
15. **Presets' own blocks** (World State, CYOA, Director…) are not read or handled by v2; presets that write
   them have their own switch to stop. Only `<Changes>` is v2's.
16. **Checks.** Story Director provides standalone evidence-backed checks. Assist can optionally classify a reader's attempt before generation and use the registered check kind.

17. **Rewind.** Story Block provides `sdk.rewind({ index, beforeRev })` to branch at a carrier while preserving the old timeline.

18. **Default look** follows the SillyTavern theme's colours (cards, meters, badges), restyled by packs/cards.
19. **Merging.** (User decision.) PRs into `main` merge after green CI at the coordinator's discretion.
20. **Ersveil currency** (user decision): the Ersveil pack's one currency is the **mark** (`mk`), 1 mark = the
   lore's old copper; all lore prices rescaled into marks.
21. **Story Director time features** (user decision): deadlines that slip or lapse when story time passes, and
   the "while away" recap of off-screen agendas after a time jump, both in the core (not deferred).
22. **Name and background from the persona** (user decision): the creation wizard takes the character's name
   and background from the SillyTavern persona (name, description) and the portrait from the persona avatar;
   race, talents and stats come from the wizard. Pack ready-made characters pre-fill race/talents/stats only.
23. **Test setup** (user): SillyTavern 1.19; Gemini mostly (also GLM, Kimi, Gemma); Megumin with only CoT and
   Writing Style on. The after-reply extractor stays off by default.
24. **Cards under replies** (user decision): the "changed this reply" card and Story Director's status card
   show under every reply by default, collapsed to one line; the reader can turn either off per screen.
25. **Pack terms** (user decision): packs may suggest terms (level name, XP name, tier titles) as they suggest a
   currency; the reader's own setting wins.
26. **Companions** (user decision): a companion who dies in a fight to the death is removed from the party
   permanently (no offer); when the story has a companion leave the group (`- join Lyra — leaves`, or a
   `leave` line), the reader is offered to remove them.
27. **Studio** (user decision): after the heavy tests and refinement are done, build Studio as a standalone
   HTML app and ship it inside Story Block as a download (a button in the Story Suite overlay saves the
   self-contained `story-suite-studio.html`); it uses the same renderer, validators and pack format.

### User decisions, batch 3 (F28–F77)

**Play and rules**
28. XP curve and level cap: v1's, adjustable in settings.
29. Companions' stat points auto-spent by default; a per-member toggle switches auto ↔ manual.
30. Healing: rests and items, and story heals (`~ wound X — heal …`) capped by v1's wound shares.
31. Checks: natural 20 always succeeds, natural 1 always fails, whatever the modifiers.
32. Up to 2 checks per reply, each rolled separately.
33. **Modifiers apply to the roll result**: the reader presses Roll, sees the d20 (fixed by the seed through
    preview), may still add modifiers (abilities, items, custom) to that result, then confirms; total =
    die + modifiers. No rerolls. If the reader sends the next message without confirming, it is confirmed
    with what is on it.
34. Fleeing a fight to the death is allowed (v1's chance).
35. Loot: v1's drop tables and rarity odds.
36. Shops restock daily on the story clock, unless the story marks a supply problem
    (`! market Bluewatch — blockade on the river | until: …` / `~ market Bluewatch — supplies back`):
    restock pauses and prices rise per v1 shortage rules until it is lifted.
37. Commission times: v1's crafter rules; the story may make them later, never sooner.
38. Buyer types (smith pays more for metal…): v1's.
39. **Carry limit**: added, on by default, toggle and size in settings (a per-member capacity from STR, v1
    item weights where known, else per-kind defaults); over the limit, actions that add weight are refused
    with the reason, nothing is lost.

**Story and the model**
40. A reply without `<Changes>` (extractor off): a small warning on the reply with a one-click Re-read.
41. Change lines the code refused are listed faintly in the reply's changes card ("not applied: …").
42. ~~Quests the story starts stay offers until the reader accepts (v1 rule).~~ Replaced (live test #3,
    Story Director #99): no offers. The story writes `+ quest` when the reader accepts, and the quest is active
    at once (§C2).
43. Off-screen agenda nudges: v1's frequency.
44. The story writes the clock; no automatic minutes per reply.
45. While-away recap threshold: 6 h, adjustable.
46. Lapsed quests are told briefly to the next reply.
47. NSD unchanged under v2 (own capture call and prompt part).

**Characters and party**
48. Party size: you + 3 companions by default, adjustable in settings.
49. Companions auto-controlled in fights by default, toggle per member.
50. Companion portraits without NSD: initials.
51. Respec: kept in view, not built yet.
52. One PC per chat.

**Screens and UI**
53. Full-screen game view: a button in Story Block's bar and Alt+G.
54. Status strip above the message box: on by default.
55. Phones: cards under replies collapsed, as on desktop.
56. English for now; all UI text kept in one place per repo for later translation.
57. Subtle animations; none when the system asks for reduced motion.
58. No sound.
59. The v1 sidebar look is replaced by v2's tabs.

**Packs and content**
60. Packs install from files and card lorebooks only (URLs later).
61. Packs may change rule numbers (damage, XP curve…) as plain settings values; never code.
62. Ersveil's lorebooks stay SillyTavern lorebooks.
63. A pack's screens apply when enabled; one click resets to default.
64. Readers can export their own screens/layouts as a pack (Studio).

**Saving and data**
65. The guide recommends raising SillyTavern's chat backup interval on slow disks, with the benchmark numbers.
66. **Export character**: carry the PC (level, stats, skills, gear, purse) into a new chat — included
    (a command that writes a portable character file; creation can import it instead of the wizard).
67. SillyTavern branches keep their own state (already true).

**Releases and process**
68. Versions are individual per extension (each bumps on its own changes).
69. v2 replaces v1 on `main` after beta and the user's test play, on the user's word only.
70. A `v1` branch is kept for v1 users.
71. GitHub pre-releases with notes for each alpha.
72. SillyTavern's official extension list: ask the user at release time.
73. A bug report template in the guide.
74. `docs/v2/REVIEW.md` for Astra before beta.

**Studio**
75. Studio edits packs first (items, creatures, quests, events), then screens and themes.
76. Studio previews by simulating a few turns with fake data and the same rules code, no model.
77. AI help in Studio ("generate 10 items for a desert town") with the reader's own API key: included.
78. **Checks resolve automatically** (user decision; supersedes the reader-modifier parts of F16 and F33).
    A `? check` line is rolled by code the moment the reply that wrote it is captured: d20 + automatic
    modifiers (the stat, plus the actor's skills, abilities/talents and carried items whose tags or words
    match the check, by a fixed rule in code). The reader cannot add or change modifiers; the only way to
    get a different result is to swipe or regenerate that reply (a new reply gets its own roll). The
    result shows on that reply's card at once and the next reply narrates it. With Assist's pre-roll
    classifier on (F16's option), the roll happens before the reply so the same reply narrates it.
79. Market shortages (F36) confirmed as written.
80. **Checks roll in the same reply, like v1's dice** (user decision; supersedes F16's "stop at the check"
    and F78's timing). Before every reply, swipe and regenerate, code rolls a fresh set of d20s (seeded, kept
    on that reply) and gives them to the model in the tail tied to attempts ("Roll 1 = 12 · Roll 2 = 5 — the
    first uncertain attempt takes Roll 1, the next Roll 2…", v1 `promptRolls`), together with the PC's and
    present companions' check modifiers as a short code-built table (stat modifiers, plus skills/talents/items
    that apply by code's rule). The model decides whether an attempt needs a roll and how hard it is, uses
    the next roll, and narrates the outcome **in the same reply**, writing `? check stealth — slipping past
    the guard | dc: hard | roll: 1 | result: success` in `<Changes>`. Code then recomputes the total from the
    given roll and its own modifiers against the DC (natural 20/1 rule, F31); that is the recorded result. If
    the model's stated result or narration disagrees, the reply's card flags it ("narrated as success, the
    dice say fail") — v1's verdict rule — and the recorded result stands. Modifiers are code's only; the
    reader can't change them; a swipe or regenerate brings fresh rolls. Up to 2 checks per reply (F32). The
    Assist pre-roll classifier is no longer needed for checks (kept as an option for typed actions).

### User decisions, batch 4 (F81–F103)

**Quests and the story**
81. **NPC meters.** NPC State Delta offers meters, stages and hidden dossier entries to other modules.

88. Pacing: Director prompt lines (no quest spam, a passerby is a passerby, the world doesn't send
    trouble). ~~And an offer cooldown setting (a held offer is shown later, never refused).~~ The cooldown
    went with the offers (Story Director #99).
89. **Chronicle** (Story Director part): `world` and `faction` kinds, times from the clock, up to 3
    ongoing events picked into the tail per reply (seeded, stable on a swipe), a Chronicle screen.
90. NSD: meter stages (named thresholds, moved by code) and hidden dossier entries unlocked at a threshold.
92. Story Block: a read-only state inspector tab (per-reply JSON, diff, receipts) for beta. As built: the
    screen `story-block/inspector` (screen and tab, feature `story-block.inspector`, off by default) over
    the host widget `story-block.inspector` (src/v2/screens/inspector.js, data in src/v2/inspect.js): a
    reply picker (newest first; the newest follows the story), what changed since the reply before
    (`diffStates` of `store.before(i)` and `store.at(i)`, and the stored ops), receipts, problems (replay
    blocks skipped, the turn's Problems, refused lines), and the state as a folding tree drawn on opening,
    with a search over keys and values (the hits and the way to them). Nothing in it writes.
93. Story Block: reader save points: a button makes a named SillyTavern branch (the rewind machinery),
    listed with Return to. As built (src/v2/rewind.js `createSavePoints`, feature `story-block.savepoints`,
    on): **Save point** on Home makes a branch at the head carrier with SillyTavern's `createBranch`
    (bookmarks.js; the reader stays in the chat), the entry kept in the chat's metadata,
    `chatMetadata.storySuite.savePoints[sp_…] = { name, index, branch, at, rev }` (name one line, ≤ 60;
    ≤ 50 per chat); **Return here** opens the branch; **Forget** takes the entry off the list only.
    Chat metadata, not story state: a save point is about the reader's chat files; in state it would be
    taken back by the swipe, delete or rewind a reader wants to go back from, cost a receipt and a rev,
    and be inside the branch it names. Metadata stays through swipes and deletes, and nothing in the story
    (prompt, replay, rev) changes. A branch carries a copy of the list as it was when it was made.
96. **Using a consumable.** A module may answer `item.use`; the Inventory can offer eligible targets when a module answers `items.useOn`.

97. The UI overhaul waits until the base structure is ready; polish now is functional fixes only.
98. An interactive map: pan and zoom (wheel, drag, pinch, buttons, keys), search over places (undiscovered
    ones too, never hidden or secret ones), place details with code's travel time; the view is per reader.
100. **Features**: optional mechanics are toggles in a Features subsection, declared by
    `registerModule({ features: [{ id, label, describe, default, prompt? }] })`; an off feature contributes
    no capture kind, context, command (`FEATURE_OFF`), screen or widget (after the freeze). Built as SPEC §6
    "Features": `feature: '<id>'` on kinds, commands, queries, hooks, the context or `context.parts`,
    screens, tabs and widgets; `ctx.feature` / `view.feature` / `sdk.feature`; the reader's choice in
    `extension_settings.storySuite.features`; Story Block's own `story-block.hud`, `.cards`, `.preroll`,
    `.extractor`.
101. All TRS ideas 1–24 are accepted: 1–12 before beta, 13–24 after it.
102. **Crafting with stats** (after the freeze): companions craft too; story-driven `! craft X | with: …`
    rolled with the reply's own d20 (F80) and a code-built modifier table; known recipes recorded per
    character in state; stations for smithing, alchemy and enchanting; a read-only Crafting screen.
103. **Feature freeze**: fix bugs and finish what was already decided; break round, fixes, re-break, then
    alpha.2. Decided while fixing:
    * Module life cycle: `requires: { storyBlock: range }` is checked against the host with one plain
      sentence; an unknown definition key is warned and ignored; a module that gains a domain keeps the
      others (SPEC §2.6, §6).
    * Replay is block by block; counts (`counters`, `was`) move when a middle reply is deleted; a
      checkpoint made over a deleted reply is passed over (SPEC §2.2).
    * `sdk.command` is the reader's action only; `sdk.reread` re-captures one reply (SPEC §3.1).
    * Money and items from the story have no automatic per-reply limit; an explicit `storyCoinPerReply` sets the budget and associated item limits. Signed amounts are refused (SPEC §7).
    * Pack events fire from their definition only, a repeating one once per reply, nothing on a Continue
      or a dry run (SPEC §4.1).
    * Reading change lines: linear; at most 150 per reply; a close tag counts only at a line's start or
      end; a cut-off last line is a Problem; `label:value` accepted; [Happened] collapses past half the
      budget; names flattened before budgets (SPEC §4.3, §4.4).
    * Screens: control names prefixed like ids; templates nest at most 64 deep and @-rules 8 deep; text
      settings keep their `max`.
104. **Money scale.** A pack may supply `economy.scale`, and the reader may override it. Automatic story money has no per-reply limit; an explicit setting caps it.

### User decisions from the live tests (2026-10-22, F105–F108)

(F108 came with live test #4's terms2 work. F109–F114 are not used: the next decision is F115.)

106. **Carry capacity.** A pack item may add capacity; a module can answer `items.carry` for capacity checks and the Inventory display.

107. **Markets.** Packs can provide market data through the generic `packs.markets` query.

108. **Coins** (terms2, 2026-10-22; the live test's "currency is pennies but the story says copper and
    silver": the lorebook and card named three coins, Story Suite knew one name). The one currency may have
    coins: Story Block's setting **Coins** (`coins`, lines `name: worth`, a plural after a slash, smallest
    first) beats a pack's `currency.coins: [{ name, plural?, value }]` (only while the pack's currency is in
    use), which beats the single name. `inventory.currency` gives `coins: [{ name, plural, value }]` (and
    `display: 'base'`) when there are any. The wallet holds the smallest unit (the coin worth 1). The static
    part gets one line naming the coins and their worth and saying a money line names one coin
    (`+ coin 3 silver`) or the smallest unit (`+ coin 35`); it changes only when the coins do. Capture reads
    `+ coin`, `+ item <coin> | qty`, and loot money with a known coin name and converts it before the reply's
    budget and caps (rule 1); with coins, an unknown coin word or two numbers in one line is refused (as strict
    as SB #118). Money words read the same on every path (beta-candidate break): an item or loot named as
    money (`+ item Silver Coins | qty: 3`, `+ item 3 silver coins`, `+ item Silvers`, `? loot 2 gold pieces`)
    goes to the wallet in the smallest unit, as `+ coin 3 silver coins` does. The bare money words are money
    too (final break FB-3), with coins or without: **coin**, **coins**, the currency's own name and its
    plural, each with `qty` or a number in front (`+ item Coins | qty: 5`, `+ item Coin`, `+ item 5 coins`,
    `+ item Gold Coins | qty: 4`, `- item Coins | qty: 2`, `? loot 3 coins`); "coin" or "coins" alone is the
    smallest unit, as `+ coin 5` is (`+ coin 5 coins` too), and a name with another word (`+ item Coin
    Purse`) is an item; and with coins the currency's
    own name is not a coin unless no coin is worth 1 (`+ coin 2 gold` with copper and silver is refused, "not
    a coin here: write copper, silver or a number of coppers", never paid as 2 copper; `+ item Gold` is then
    an item). Displays (`fmt.money`, receipts, the changes card, Inventory, Home) show mixed coins, "3
    silver 5 copper", or the smallest unit with **Coin display: base** (`coinDisplay`). Ersveil 1.4.0 counts
    in the lore's copper, silver and gold (1 gold = 10 silver = 100 copper; the old marks were copper, so no
    number changed).

### User decision: v1's Choices and Inner chatter come back in a v2 form (2026-10-22, F115)

115. **Choices and Inner chatter** (v1 audit #10, #12; F13 dropped the block engine, so both return as change
    lines). Story Block's features `story-block.choices` and `story-block.chatter`, both **off** by default
    (each adds a grammar line to the static part and asks the model for more lines every reply; off is also
    F100's rule for extras). Two **display kinds** (SPEC §4.4): `? choice Climb the wall` (at most 4 a reply,
    80 code points each) and `~ chatter Name: thought` (at most 3, a name of 40 and a thought of 140 code
    points). No command runs for them and nothing is stored: no receipt, no op, no `meta.rev`; they are read
    again from the reply's hidden block (its shown swipe) each time they are drawn, so the live reply, Re-read,
    swipes, deletes and a reload show the same. Lines past the cap and lines that do not read (no text, no
    name) are Problems on the card (the cap counts the whole reply: lines a Continue or the extractor adds
    count after the ones it already shows); a line of a feature that is off is a quiet `FEATURE_OFF` and stays unshown
    when the feature is turned on later, until a Re-read reads it again (SPEC §4.4, the comment's `off:`). Choices show as
    buttons under the **latest** reply only, until the reader answers; a click puts the text in SillyTavern's
    message box after what is typed there and **never sends** (no Shift-click send as in v1): it is not a
    story action (F95, F96). Chatter is **not drawn under replies** (beta-candidate live test, 2026-10-22:
    "inline inner chatter should be removed"; it was a folded "Inner chatter (N)" strip): each thought shows
    next to the person who had it, on Story Director's World → Now (`chatter.head`, F119), or, while
    `story-director/world` is not registered (no Story Director, or its World view off), on Story Block's Scene
    screen under each person present, the name then the thought (read-only query **`scene.chatter`** →
    `[{ name, text }]` in the scene's order, `name` as `scene.present` lists the person, one thought each (the
    thinker's last line), matched to a present name ignoring case; a thinker not present is left out; `[]` while
    World is there, `null` while `story-block.chatter` is off). Chatter never reaches a later prompt (the block is
    stripped from the history); the setting **Inner chatter: Send the last reply's thoughts back to the story**
    (`chatterInPrompt`, off) adds the thoughts of the reply the reader's latest message answered as one
    optional tail line. All text is drawn with textContent, flattened (no invisible or control characters).
    Read-only query **`chatter.head`** → the newest reply's chatter as `[{ name, text }]` (the last message
    that is not the reader's or a system one, after the reader's first; its shown swipe), read the same way
    every reply's display lines are read (extras.js displayLines); `[]` when it has none, `null` while `story-block.chatter` is
    off. Story Director's World screen puts each thought under the person who had it (F119).

### User decisions from live test #4 (2026-10-22, F116–F118)

116. **A module's own panel sits in its fold, not a sub-fold** (NPC State Delta's settings were three folds
    deep). In a module's fold: the features line, then its custom panel (`settings.section` / `render`; a
    titled section shows its title as a heading), then the schema's groups as sub-folds. A panel may have
    folds of its own (Delta's Scanning, Roster…), which are then the second level: never three. A panel that
    brings its own SillyTavern drawer (`.inline-drawer.story-suite-drawer`) has it held open with no header.
117. **The assist's connection profile is a dropdown** (it was a name typed in a text box). `assistProfile` is
    a `profile` field (§G) in Story Block's group **Assist**: *Same as chat*, then Connection Manager's profiles
    that can make a text call, by name; it stores the name ('' the chat's connection), so a name typed by an
    older version is the same value, and the pre-roll and extractor calls go through it. A stored profile that
    is gone stays picked and is named, and the calls fail with a sentence (never another profile quietly). No
    profile, or Connection Profiles off: a plain note. One list for every picker: `listProfiles()` in
    `src/v2/model-call.js`.
118. **Settings → Diagnostics** (last before Versions): **Copy report** and **Save
    report** (a .txt) of one plain report, shown first. It holds SillyTavern's, Story Block's and each module's
    version; the features on and off; each module's settings with every key naming a key, token, password,
    secret, address or session left out (named) and secret-looking values replaced; the prompt size panel's
    numbers and the context size; the last 20 Problems; saving (failing, unsaved, a read-back waiting, the
    failed saves this page load); the chat's message, reply and record counts and its size; the Story Suite
    console errors caught since the page loaded; and each module's own section from its optional
    `hooks.diagnostics()` (a string, a list of lines, or `{ lines, data }`; 2 s, else "no answer"; the same
    cleaning applies). Never chat text: no message is read for its words, and quoted text in a Problem or an
    error keeps only its length. NPC State Delta's section: scanner route and profile, call counts, the last
    call's outcome, dossier counts (no names). `src/v2/diagnostics.js`.

### User decisions from the beta live test (2026-10-22, F119)

119. **The people here are on the World screen; NPC State Delta's Cast becomes Dossiers, last** ("Cast becomes
    redundant when present is already present character in world tab"; "the World tab character part should
    inherit what Cast is doing and include the inner chatter"; "the NSD link doesn't refresh until I change
    tab"). Story Director's World → Now → Here (widget `story-director.people`, bound to
    `director.world.here`) draws, with NPC State Delta installed and on, NSD's own present-cast cards (the now
    lines, chatter bubbles and meters its Cast tab drew, NSD's markup and classes), through a small page API NSD
    offers (`globalThis.NPCStateDeltaCast`: `available()`, `render(el, { slot })`, `onChange(fn)` → off);
    without it, plain chips. Under each person, their thought from the newest reply's Inner chatter
    (`chatter.head`, F115), matched by name the way the chatter strip links a dossier (`npc.dossier` knows the
    name or alias, else the same name). The cards and dossier links follow NSD's changes (a scan that ends after
    the reply, a dossier added) through `onChange`, and the screen redraws on `head` and `committed` as before,
    so no tab switch is needed; a redraw is one query and the few cards, never a pass over the chat.
    NPC State Delta's Cast tab and screen are titled **Dossiers** and are the dossier browser (every dossier,
    with search, each opening its dossier view); their id stays `npc-state-delta/cast`, so a reader's saved
    tab order still finds it. Its default place is **last**, after the Director (`screens.js` DEFAULT_ORDER
    `cast: 210`); a saved order keeps the place it gives. Without Story Director, Dossiers keeps the present
    cast's cards at the top, so nothing is lost. (The chatter strip under each reply has since gone, F115.)
    **Scene is hidden by default while World is there** ("is Scene doing the same thing as World?": it is):
    Story Block's `story-block/scene` (place, kind, region, story time, the people with portraits) leaves the
    tab strip and the game view's navigation while `story-director/world` is registered (`screens.js`
    DEFAULT_HIDDEN), and World → Now → Here shows all of it: the place with its kind and region, "moved this
    reply" (new read-only query `scene.moved` → true while the head reply's receipts moved the place), the story time while Story Director keeps a clock, the people (portraits on NSD's cards, else names
    with their thought). Settings → Tabs still lists Scene, hidden, to show again; the reader's choice wins:
    `storySuite.tabs.shown` keeps one they showed, `hidden` one they hid, and an order saved before `shown`
    existed that names Scene counts as showing it. Without Story Director, Scene shows as before, now with each
    person's thought (`scene.chatter`, F115). Home's scene panel is unchanged.

### User decision from the beta-candidate live test (2026-10-22, F120)

120. **Weather is a scene line** ("weather on the reply Status card"; v1 kept it in a block the model wrote,
    which v2 dropped). Feature `story-block.weather` (label "Weather", **on** by default; F100): its grammar line
    `~ weather cold drizzle, low fog (only when the weather changes, not every reply; a few words, at most 60
    characters)` is in the static part only while it is on, so the static part changes once when it is turned
    on or off, as Choices and Inner chatter. A `~ weather` (or `+ weather`) line keeps **`scene.weather = {
    text, rev }`** in the scene domain (`rev`: the `meta.rev` of the receipt that wrote it); the text is the
    line's words with markdown, tags and anything inside `<…>` taken out, flattened to one line and cut at 60
    code points (never markup, never half a character). The same text again changes nothing; another op or a
    line with no words is refused (`INVALID`, nothing saved); a line while the feature is off is a quiet
    `FEATURE_OFF`. It is **descriptive only**: no mechanic reads it. Read-only query **`scene.weather`** → `{ text
    }`, or `null` when no reply wrote one and while the feature is off; Story Director's Status card reads it.
    `weather` is one of the scene's `scratch` fields (SPEC §2.2), so a later reply's weather replays whole after
    the reply that first wrote one is deleted; swipes, Re-read and a reload give what a rebuild gives, like the
    other scene fields. Shown on Scene (with the place) and Home's scene panel. The tail's Place line ends with
    it while the feature is on, cut to 26 code points (`Place: Vell Harbour (settlement); cold drizzle, low
    fog`, at most 28 characters more: about 8 tokens), and only when there is a place.

### User decision from the beta-candidate live test (2026-10-22, F121)

121. **A step after the reply's last story line** (live test: a turn-in sat at "checked where this reply ends
    up, before the next reply", which read as failing to complete). A module's hook **`afterCapture(view, {
    index, type })`** may return `{ commands: [{ type, payload }] }`; Story Block runs it once right after a
    reply's capture, after all its story lines, and runs the commands as `system` steps (SPEC §4.2 step 3):
    chained on the state the lines left, stored on that reply right after its story receipts (receipt
    `afterCapture: true`, with `replan: { payload }`), as part of that reply. Not run for an empty capture
    (nothing kept), for a click or for a system step. A **Continue** runs it again after the Continue's lines
    (a step that finds nothing to do refuses or does nothing, so it pays once). A **Re-read** asks the hook
    again after the new story lines, on the state as the Re-read has it, `ctx.reply` that reply, each new step
    at the seed of the old one of its type (SPEC §3.2), so a Re-read of unchanged text gives the live state.
    A swipe or delete of the reply takes its steps back; a rebuild applies their stored ops (§2.2). Hook
    failures, a hook slower than 2.5 s and refused steps are Problems. Story Director sets the day's weather
    there (`scene.weather`, F122).

### User decisions from beta live test 5 (2026-10-22, F122)

122. **Weather by rule, and no money in a coin the chat does not know** (live test: "weather is not working":
    the model wrote no `~ weather` lines, so the Status card never had one; a reward of "40 silver" showed as
    "40 pennies"). *Weather:* new command **`scene.weather({ text?, key? })`** (feature `story-block.weather`,
    causes `system` and `ui`, refused for the story, which writes `~ weather`): with `text`, the weather now
    (cleaned as a `~ weather` line is) marked with `key` (one line, at most 80 code points: what a module's
    rule chose it for, such as the story day and region); without `text`, the weather as it stands is marked
    with `key`, its words kept. `scene.weather` becomes `{ text, rev, key? }`; a story `~ weather` writes
    `{ text, rev }`, so its key goes. A module sets it as an `afterCapture` step (F121): Story Director picks
    the day's weather from its calendar's season and the region, seeded per story day and region, and keeps
    the story's own weather for the rest of that day and place by marking it. A pack may give a **`weather`**
    table (PACKS.md "Weather", query `packs.weather` → `{ pack, seasons, tables }` | null). *Money:* a chat
    without coins reads a coin line's number and refuses a coin word that is not its own currency (its name,
    plural or short form, "gp" for gold, a bare "coin"): `+ coin 40 silver` where money is pennies is a
    Problem naming the chat's money, never 40 pennies (money.js `foreignCoin`, `parseAmount`). With coins,
    a word that is not one of them was already refused (F108). Story Director reads rewards by the same rule.

### Beta request: Assist safety net and one queue per connection (2026-10-22, F123)

123. **The Assist extractor is a safety net for change lines the reply missed** (the reader plays on a fast,
    cheap model that narrates time passing, a move, an arrival, the weather, a quest handed in or an item
    handed over, and leaves them out of `<Changes>`). Feature `story-block.extractor` (F100, **off** by
    default; label "Safety net: read changes the reply forgot"), its own profile `assistExtractorProfile`
    (empty: the Assist profile). *When:* after **every** captured reply (not quiet, impersonate or a
    Continue), once per carrier and swipe: one cheap call per reply. *What it reads:* the reply's story text,
    its own change lines (sent so it proposes only what they miss) and the grammar of the allowed kinds.
    *What it may write:* only the kinds of the setting `assistExtractorKinds` (default
    `! time, ~ time, ~ place, + present, - present, ~ weather, ~ quest, - quest, ~ wound, - item`), and under
    any setting never value (src/v2/assist/safety.js): no coin kind, no `+` of item, coin, loot, XP, reward,
    join or skill, no `?` line, no
    `heal:`/`reward:`/`price:` label. A quest the story finished (`- quest`) is recorded by Story Director, which
    pays nothing for it; `- item` only moves or removes what the party holds (the owner
    refuses the rest). *No duplicates:* a line the reply's lines already hold (C-1's matching, capture.js
    `sameChangeLine`, or the same op, kind and name) is dropped. *How it applies:* as story lines on that
    reply after its own (cause `story`, same capture rules, claims and the reply's `maxChangeLines` cap),
    receipt `assist: 'now'` and `assistLine`; Problems they meet are marked `assist` and start "(assist)";
    the reply's changes card lists them with "(assist)" and its folded header counts them ("1 line from the safety net (assist)"; before, a reply whose only change was the safety net's said "No item, coin or place changes", the final live check's FL-3). *Stored with the reply:* the lines go to the hidden
    comment as `<Changes-assist>` (capture.js `withAssist`, `assistSections`), never read as the reply's own
    block. **Re-read uses the stored lines and never calls the model again**; replay applies stored ops; a swipe
    is a new reply (read once). *Timing:* a send waits for a run still reading the last reply at most
    `ASSIST_WAIT_MS` (1.5 s, turn.js); an answer within it applies on that reply before the next prompt is
    built. An answer after it is stored on that reply as `<Changes-assist-next>` through a stricter wall (no
    coin, not even as an item name; nothing added but `+ present`; no turn-in) and applied on the **next**
    reply right after its own lines, receipt `assist: 'late'`, shown "(assist, from the previous reply)"; Re-read
    and swipes of that next reply read them from the stored section again. An answer after the next reply
    was captured, or for a reply swiped or deleted meanwhile, is not used. (We used the existing assist path,
    story lines through the turn's capture, rather than an `afterCapture` system step, so the lines keep the
    story caps and claims and a turn-in step of F121 sees them.)
124. **One queue per connection for Story Suite's own model calls** (Delta's scan, the arc planner and Assist
    collided on single-slot local servers). `createCallQueue` (model-call.js): calls on the same named
    profile run one at a time in the order they came, each with its own time limit and signal (a call that
    times out or is cancelled while waiting leaves the queue and is never made; a running one frees its place
    when it ends or is cancelled); different profiles run side by side. The chat's connection has its own lane,
    entered only after the turn's `whenIdle` wait, so a reply in progress never holds it. The assist helpers'
    calls now go through `sdk.callModel`'s rules and this queue too (as the host's own call, without the idle
    wait). Host setting **`callQueue`** "Run extra calls one at a time per connection" (default on);
    Diagnostics → "Model calls" shows how many wait now and how long calls waited (counts and times only).

### User decision from the beta live test (2026-10-22, F125)

125. **A module's own lines on the "Changed this reply" card** (live test: "there's no way for us to know the
    rolls?"). A module's hook
    **`replyCard({ index, state, before, changes })`** answers that reply's lines, `[{ text, summary?, flag?,
    note?, icon? }]` (or plain strings), synchronously: `state` is the reply's state, `changes` the JSON
    Pointers its ops touched (as a card's `changed()`), so a module lists only what that reply did. Story Block
    draws them in the card's list (text, then the flag and the note on their own lines, escaped) and tells each
    by its `summary` (else its `text`) in the folded header after the rest ("+1 Rope · Wessel AGI 10 vs DC 10:
    success"); a card with module lines does not say "Nothing changed". Cleaned by `replyCardLines`
    (`src/v2/screens/changes-card.js`): one line each, text ≤ 200, summary ≤ 80, flag and note ≤ 160
    characters, at most 6 per module, an icon only as a plain `fa-…` name; a hook that throws or answers no
    list adds nothing. The card's scope has them as `moduleLines`, so a restyled card can draw them too. An
    older Story Block never calls the hook (the module's own screens still show the same).

## G. Model calls for modules (`sdk.callModel`, the `profile` settings field)

For a module's own call to a model outside the story, such as Story Director's arc planner, Story Block makes the call and keeps the rules; the module writes the prompt and reads the text (`src/v2/model-call.js`).

```js
const result = await sdk.callModel({
  profile: sdk.settings('story-director').arcProfile,   // a Connection Manager profile's name; '' or 'chat': the chat's connection
  system: 'You plan story arcs.',                         // optional
  prompt: 'Plan the next arc for …',
  maxTokens: 600,                                         // 1–8000, default 300
  signal: controller.signal,                              // optional AbortSignal
  feature: 'story-director.arc',                          // the calling module's feature: FEATURE_OFF while it is off
  // module: 'story-director',                            // optional: the module, when there is no feature
  // timeoutMs: 90_000,                                   // optional: 1 s – 10 min, default 60 s
});
// → { ok: true, text, error: null } | { ok: false, text: '', error: 'TIMEOUT', message: 'The model did not answer within 60 s.' }
```

- **Never posts to the chat and never touches its history**, the story state or the reader's connection. A
  profile is called directly with that profile's own settings (SillyTavern 1.19's
  `ConnectionManagerRequestService.sendRequest(profileId, messages, maxTokens, { signal })`: its API, model,
  preset and key stay in SillyTavern), so nothing is switched and there is nothing to switch back; the reader's
  selected profile and API are as they were. The chat's connection is called with `generateRaw` (the prompt
  as it is: no chat, card, lorebook or extension prompts). A named profile that is missing, or a Connection
  Manager that is off, is an error (`NO_PROFILE`), never the chat's connection in its place: the reader chose
  that model on purpose.
- **Never throws.** `error` is a code; `message` a plain sentence for the reader:
  `FEATURE_OFF` (the `feature` is off, or no module declares it; nothing was called), `BUSY` (this module
  already has a call on its way; nothing was called), `TIMEOUT`, `ABORTED` (the `signal` fired, also when it
  had before the call), `BAD_REQUEST` (no prompt text, or a system that is not text), `NO_PROFILE`, `EMPTY` (the
  model answered nothing), `UNAVAILABLE` (no SillyTavern, no generateRaw), `FAILED` (anything else; the message
  holds the first line of SillyTavern's reason, cut at 160, with key-like runs masked).
- **One call at a time per connection** (F124): calls on the same profile from different modules wait their
  turn in order (the wait counts toward the time limit); the host setting `callQueue` turns this off.
- **One call in flight per module**: a second while the first is on its way is refused with `BUSY`, not
  queued (retry when the first answers). The module is `module`, else the owner of `feature`; callers that
  name neither share one slot. Modules do not hold each other up.
- **Time limit**: 60 s unless the call's `timeoutMs` says otherwise (the runtime's `modelTimeoutMs` option
  sets the default). On a timeout or abort a profile's request is cut off; the chat's connection's cannot be
  (generateRaw takes no signal), so its late answer is dropped.
- **The reader's reply comes first on the chat's connection.** While a reply is being built or awaited (its
  generation interceptor ran; not yet received, ended, stopped or held back; at most 5 minutes), a call on
  the chat's connection waits and then runs; its time limit and `signal` count while it waits. A named
  profile's call does not touch SillyTavern's generation and goes at once. Every call on the chat's connection
  (the assist helpers' too) is marked as Story Suite's own, and the turn's prompt handlers skip its prompt
  (matched by the prompt's text outside macros, once, in a chat of at most three messages), so it is never
  taken for the reply's prompt and never gets Story Suite's notes.
- **Logged**: one console line per call with the module, the profile's name ('the chat's connection'), the
  time taken and the outcome code. Never the prompt, the answer, an error's words or anything of a profile
  (address, key, model).
- **The `profile` settings field** (`{ type: 'profile', label, help?, feature? }`, any module's schema): a
  dropdown of the Connection Manager's profiles that can make a text call (by name) plus **Same as chat**
  (stored `''`). It stores the profile's **name** (trimmed, at most 100 characters; `'chat'` is stored as
  `''`), so the value goes straight to `callModel({ profile })`. A stored name no profile has any more stays
  in the list as "Name (not found)" with a note, until the reader picks another. With no profiles, or no
  Connection Manager, or it turned off, the dropdown is Same as chat only and a plain note says why. On a
  Story Block before this field type, the field is hidden and its value kept (SPEC §6).
- **Alone**: nothing here needs another module. A module on a host without `sdk.callModel` checks
  `typeof sdk.callModel === 'function'` and says so plainly (no planner, the library fallback).
- **Tests**: the testkit's `createFakeModel(script)` is a scripted model for `createHost({ callModel })`
  (it also stands in for the assist helpers' call). Each call takes the next answer: a string, an `Error`, a
  function of the call, `{ text, delayMs }`, or `{ hang: true }` (no answer until aborted, for TIMEOUT and
  ABORTED). `model.calls` → `[{ prompt, maxTokens, profile, system }]`; `model.pending()`, `model.aborted`,
  `model.push(...answers)`. The host's real rules run around it.

### Gathering module hooks

A command may call `ctx.gather(name, args)` to ask other modules' hooks synchronously. The host supplies frozen state and arguments; absent answers, promises and errors are left out. The result identifies each responding module.
