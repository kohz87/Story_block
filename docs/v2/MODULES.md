# Story Suite v2: module layouts (companion to SPEC.md)

Exact data layouts and command ownership for the phase 2 and 3 modules, so agents working in parallel on
the same module agree on shapes. SPEC.md rules apply throughout (IDs, integers, one writer per domain, pure
synchronous handlers, capture as `story` commands, no JSON in prompts).

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

**Capabilities.** A module definition may declare `capabilities: ['rb-rules-v2', …]`: the names a pack can list in
`requires.capabilities` that this module provides (PACKS.md). Each is a slug (lowercase words joined by `-`, at most 64
characters), the list holds at most 32 names, and a malformed list is refused when the module registers. Duplicates are
dropped. `sdk.modules()` shows the list on each entry as a frozen `capabilities` array (empty when the module declares
none), also while the module is dormant: a pack is installed into the library whatever its peers are doing.

## B. RPG Battle (module id `rpg-battle`)

### B1. `party` (part **party**, agent RB-party)
```js
party = {
  pc: 'ac_xxxxxxxx' | null,
  order: ['ac_…'],                                  // display order, pc first
  actors: { [id]: {
    id, name, kind: 'pc' | 'companion', control: 'player' | 'auto', role: '',
    level: 1, xp: 0, points: 0,
    hp: { cur, max, lost? }, mp: { cur, max, lost? }, sp: { cur, max, lost? },  // lost: see below (RB #100)
    stats: { STR, VIT, AGI, DEX, INT, LUK, CHA },     // base stats (ints); gear bonuses are derived, never stored
    skills: [{ name, level, uses, active: true }],   // names from the skill library or party.custom
    conditions: [{ kind: 'poisoned' | 'bleed' | …, stacks: 1 }],
    npc: null | 'NSD name',                          // the NPC this companion is, if any
  } },
  custom: { [skillName]: skillDef },                 // story-taught skills, built by v1 skillFromTemplate
}
```
A pool may hold `lost` (RPG Battle #100): how far it is below `max`, a count (Story Block's `counters`, SPEC
§2.2), so a wound, heal, fight or level-up adds its own step on replay and a middle delete takes back only its
reply's change. `cur` stays as written for readers of the raw state; the pool's number now is `max − lost`
held to 0…max (no `lost`: `cur` held to its max, a full pool keeps none). Read pools through `party.actors` /
`party.actor` (fitted), not the raw `cur`. Level, XP, points and stats are counts too (`PARTY_COUNTERS`).
Commands: `party.create` (ui; v1 newSheet rules), `party.addCompanion` (from a `join` line or the join
offer's button), `party.edit`, `party.spend`, `party.learnSkill`, `party.setSkillActive`, `party.forgetSkill`,
`party.rest` ({ kind: 'short' | 'long' }), `party.applyResult` (internal, from combat.end), `party.grantXp`
(internal; levels up with v1 growth rules), `party.heal` / `party.restore` (internal, from item.use),
`check.resolve`.
Kinds: `wound` (`~ wound Ren — fell into the weir | harm: scratch|wound|grave` and
`~ wound Ren — a poultice | heal: scratch|wound|grave`, `~ wound Astra — cure poisoned`; v1 Wounds rules:
one blow per person per reply, shares of max HP), `join` (`+ join Lyra — the archer | level: 3 | role: ranger`
→ an offer the reader accepts, not an automatic member), `skill` (`+ skill Ren — Shadow Cut | taught by: Kael`
→ offered, learned by the reader), `check` (`? check stealth — slipping past the guard | dc: hard`; the roll
uses ctx.roll, the stat named or mapped from the skill word; result in the receipt summary), `rest`
(`! rest long — a night at the inn`).
Queries: `party.actors`, `party.actor({ id | name })`, `party.pc`, `party.combatNumbers({ id })` (stats
with gear from `inventory.items({ owner: id })` equipped stacks).
Tab: **Party** (actors with HP/MP/SP meters, stats, skills; spend points; set aside/swap skills).

### B2. items (part **items**, agent RB-items)
No domain of its own: items live in Story Block's `inventory`; their actors in `party`.
Hooks: `item.define(def, { note, owner, scale })` (`scale`: the money scale, F104) → sets `kind`, `rarity`, `value` (smallest unit), `slot`,
`stats`, `effect` (`{ heal, mp, cure: [] }`), `tags` (elements) using v1 describeRow / gear enrichment /
effectByName / materialAffinity / capItem rules; `currency()` → `{ tiers: [{ name, rate }], single }` from
the rules (v1 `rules.currency`).
Commands: `item.use` ({ stack, target }; consumables only; full HP refuses without consuming; calls
`inventory.consume` and `party.heal`/`party.restore`), `item.equip` / `item.unequip` (checks slot limits and
level caps; calls `inventory.equip`), `item.give` (to a companion: `inventory.transfer`).
Queries: `items.usable({ actor })`, `items.gear({ actor })` (equipped with capped stats).
Tab page: **Items** (on the Party tab: Use / Equip / Give per row; several clicks = several doses).

### B3. `combat` and `bestiary` (part **combat**, agent RB-combat)
```js
combat = {
  offers:  [{ id, foes: [{ name, count, tier: 'weak'|'even'|'strong'|'deadly' }], stakes: 'normal'|'death',
              place: '', rev }],                      // from `encounter` lines; dismissed or fought → removed
  session: null | { id, setup, actions: [], status: 'active'|'won'|'lost'|'fled' },  // v1 startFight setup;
                                                      // the fight itself is rebuilt with v1 replay(setup, actions)
  beaten:  [{ rev, foes: [{ name, count }], won: true }],   // last 200; read by Story Director quests
  last:    null | { summary, moments: [] },          // what the next reply narrates
}
bestiary = { creatures: { [slug]: template } }       // v1 templates.js, kept per chat
```
Commands: `combat.start` ({ offer }), `combat.act` ({ action }) — one player action; auto turns advance
deterministically with the session seed —, `combat.flee`, `combat.end` (applies results: `party.applyResult`,
loot via `inventory.grant` with the receipt as its cause, XP via `party.grantXp`, `beaten` entry, `last`),
`combat.dismiss` ({ offer }).
Kinds: `encounter` (`! encounter 6 Cellar Rat Swarm — boiling out of the bins | tier: even | stakes: normal`;
v1 threat-word rules: a threat word is never a creature).
Queries: `combat.offers`, `combat.session` (the rebuilt fight view), `combat.foesBeaten({ sinceRev })`.
Tab: **Fight** (offer cards, the battle screen, result). Fight narration: `combat.end`'s receipt summary
plus `last.moments`; the static instruction keeps v1's "stop at the first blow" rule.

### B4. `trade` (part **trade**, agent RB-trade)
```js
trade = {
  orders: { [id]: { id, piece: itemDef, materials: [{ def, qty }], fee, ready: minutes, crafter: '', place: '' } },
  shops:  { [key]: { day, bought: [defId] } },        // v1 stock rules, per trader kind and place
}
```
Commands: `trade.sell` ({ stack, qty }), `trade.buy` ({ shop, def, qty }), `craft.commission`
({ piece, materials, crafter }), `craft.collect` ({ order }); all check the market rule (v1 marketHere on
`scene.place` and `scene.present`), price with v1 pricing (`itemWorth`, place prices from settings), pay or
receive with `wallet.pay` / `wallet.receive`, move goods with inventory commands.
Queries: `trade.market`, `trade.stock({ kind })`, `trade.quote({ … })`, `trade.orders`.
Tab page: **Trade** (on the Party tab, one-line rows, as v1 0.5.46).

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

### C2. quests (part **quests**, agents SD-quests, SD-quests2)
Same `director` domain (the module owns it; this part touches only `taken`, `ended`, `target` and `reward`,
and an older chat's offers).
**No offers (Story Director #99).** The story's `+ quest` is the acceptance: the quest is active and taken
on from that reply. There is no Offered list, no Take on / Turn down step and no offer cooldown; a job the
story only mentions stays in the story (a `+ hook` at most, an open thread). An older chat's offers
(`offer: true`) still load, are shown nowhere, and become the quest when the story writes `+ quest` for one.
**The story leads, code referees (F94, F95).** The reader accepts and turns in a quest in their own words;
the story writes it (`~ quest Granary Rats | met: yes`, a turn-in closing it), and the tracker asks
`quest.finish({ id | key, by: 'story' })` in the same reply. Code checks the target (foes from
`combat.foesBeaten({ sinceRev: taken.rev })`, one fight per kill quest, F7; items from `inventory.items`; a
goal code cannot count is met once `ready`) and the place rule (a settlement or the giver present), pays the
parsed reward held inside its rank's range (F87) with `ctx.call('wallet.receive')` under claim
`quest:<id>:paid`, takes fetch items with `inventory.consume`, gives XP through `party.grantXp` when that
command exists, and records `by: 'story'` in the receipt; a refusal tells the story why. There are no
Take, Finish or other quest buttons any more: `quest.take`, `quest.decline`, `quest.abandon` and
`quest.finish` stay as commands for templates, packs and tests.
Targets from `target:` / `reward:` labels, else from the goal text ("at least 3 wolves", "1 silver each");
every quest needs a concrete goal (F82).
Queries: `quest.progress({ id | key })` → `{ have, need, met, ready, source, noun, label, reason, finish:
{ ok, reason } }`; `quest.details({ id | key })` → everything the details pop-up shows (goal, progress
note, terms, giver, due, rank, status, history; F84, F85); `quest.ranks` → `[{ id, title, levels, reward }]`,
lowest first (the first enabled pack's `ranks`, else RPG Battle's `party.ranks`, else F to S with its rewards
times `inventory.economy`'s `scale`; F86, F104). A rank the story writes (`rank:`, or a `difficulty:`) is
held to the party's own, whether code counts the goal or not, so it can only lower the reward; a pack's
rank is kept. Every reward but a pack quest's own is the story's money (`wallet.receive { story: true }`),
and one reply pays at most the party rank's top in such rewards, clicks after the reply included; a
turn-in past that waits, open and unpaid, for the next reply (RX-E-1). The budget is Story Block's one
per-reply tally (`inventory.storyBudget`, which honours the reader's `storyCoinPerReply` and counts the
reply's own `+ coin` lines too), and Story Director's own tally only on a Story Block without that query
(RX-E-2). One story-vouched turn-in a reply by default; Story Director's Quests setting **Story's-word
turn-ins per reply** (`quests.wordTurnIns`, 1 to 5) allows more. Quests code counts are not limited by it.
The story's own coin in the reply of a story or system turn-in (its `+ coin` lines: `inventory.storyBudget`
paid less vouched), when it is the reward's amount or the giver is present, counts as the reward and is
never paid on top of it (claim `storycoin:<sid>`); a `+ coin` written after the turn-in had paid is taken
back by the afterCapture step (`wallet.pay`). A click's turn-in is not affected.
A story turn-in refused only by the place waits until the end of the reply (`director.turn.now.pending`); a
later Director line of the same reply, else the `quest.settle` step of the tracker's `afterCapture` hook
(§F121: right after the reply's last line, in that reply), pays or refuses it on the scene after all the
reply's lines. On a Story Block without that hook the same step runs before the next reply (beforeGenerate,
replan; Story Director #112). A Continue is the same reply: a turn-in the place refused at the end of the
first part stays retriable (`turn.now.refused`) and the Continue's afterCapture step pays it once the party
reaches the giver, taking the refusal's Problem back (paid once; a later reply never pays it).
**Safeguard** (Story Director #114): the afterCapture step also turns a ready quest in from where things
stand (goal met by code or `met: yes`, never on the turn-in's word; the place rule holds at the reply's end)
when the reply shows it was turned in: a `~`/`!` quest line in turn-in words that does not close it, or, with
the giver present, the story's coin equal to the reward or the reward item given (`quest.autoTurnIns`).
While a quest is ready, the tail names it, its giver and where ("Ready to turn in: …", at most two).
Screen: **Quests** (status text per quest: Not yet / Ready / Ready to turn in here; finished quests kept).

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
   `inventory.unequip { stack }`, `inventory.grant { def | defId, qty, owner, note? }`,
   `party.heal { actor, hp, cure: [] }`, `party.restore { actor, mp?, sp? }`,
   `party.grantXp { actor?, amount?, quest?, difficulty? }` (no actor: the whole party by v1 rules).
   Queries: `inventory.items({ owner? })` → `[{ stack, def, name, kind, qty, owner, equipped, note }]`;
   `combat.foesBeaten({ sinceRev })` → `[{ rev, foes: [{ name, count }], won }]`; `party.pc` → actor or null.
6. **Equipment** defs have `stack: false`; `inventory.grant` of equipment makes one stack per piece (qty 1).
7. **One fight pays one kill quest.** (User decision.) Among quests whose target counts foes, `quest.finish`
   claims each `beaten` entry it counts (`beaten:<rev>`) and progress skips entries another kill quest
   claimed. Item quests (pelts, tails) count the Inventory and are independent: the same fight can feed a
   hunt quest and a pelt quest.
8. **Effects** may carry `damage` (combat items) besides `heal`, `mp`, `cure`.
9. **Widget names are namespaced** `<module-id>.<name>`; Story Block's standard widgets are `ss.meter`,
   `ss.radar`, `ss.map`, `ss.skill-tree`, `ss.portrait`, `ss.badge`, `ss.timeline`, `ss.stepper`; modules use
   their id (`rpg-battle.battle-board`, `fishing-activity.fishing`). Layout built-in node types (`meter`,
   `badge`, …) never clash with a namespaced widget.
10. **Themes** use §13.3's CSS custom properties (`theme: { '--ss-accent': '#7c5cff' }`) for screens; the
   layout renderer's `tokens` are mapped onto them at integration.
11. **Portraits.** The PC's portrait is the persona avatar; a companion or NPC's portrait comes from NSD
   (`npc.portrait({ name })` → URL or null, from its dossier/avatar data); packs may supply their own.
   No image generation.
12. **Character creation is mandatory.** A chat without a PC (`party.pc` null) cannot generate: Story Block
   asks the `canGenerate` hooks before each story generation; RPG Battle answers no until `party.create`
   ran, and opens its creation wizard (dialog mount, §13.6). The greeting may show before that. Before the
   first message the wizard is also one click away: Home's "Before you start" card (the module's reason and
   `action` button, which runs its `onBlocked` hook), and RPG Battle's "Create your character" on the Party
   tab, the status strip and the card under a reply.
13. **No model-written state blocks.** v2 never asks the model for World State, Inventory, Party or other
   state blocks; screens and the prompt's tail come from the state. The only block the model writes is
   `<Changes>`.
14. **Creation content.** (User decision.) RPG Battle ships a small built-in set (6 races, about 12
   talents) that packs replace or extend; with no race/talent content at all, creation is just a name and
   stat points and still works.
15. **Presets' own blocks** (World State, CYOA, Director…) are not read or handled by v2; presets that write
   them have their own switch to stop. Only `<Changes>` is v2's.
16. **d20 for every uncertain action.** (User decision.) The static instruction tells the model: any action
   whose outcome is uncertain gets a `? check <skill> — <what> | dc: …` line and the reply stops before the
   outcome. The check waits as a **pending check** (RPG Battle's `checks` domain, part src/v2/checks): the reader
   may add modifiers before rolling (a stat is applied automatically; the reader can add a skill or ability
   that fits, an item, or a custom ±n with a reason), then presses Roll (`check.roll { id }`, d20 + modifiers,
   seeded; party's `check.resolve` stays for direct rolls). If the reader sends the next message without rolling, the check is rolled with the automatic
   modifiers before that generation (`beforeGenerate`). The result is a receipt the next reply narrates.
   An optional setting (off) rolls before the reply via a cheap classifier call.
17. **Death is a return in time.** (User decision.) When the PC dies, RPG Battle offers **Return**: the chat
   goes back to the last point where the PC was alive before the fatal fight (the state just before
   `combat.start`), as a SillyTavern branch so the old timeline is kept; the fight's actions are not on the
   new branch. Story Block provides `sdk.rewind({ index, beforeRev })` (branch the chat at carrier `index`,
   dropping that carrier's receipts from `beforeRev` on; it answers `{ ok: false, code, message }`, never
   throws, also when the story cannot be saved first). A short cue tells the next reply the PC is back at
   that moment, with no memory rules imposed.
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
81. **NPC meters.** An NPC has several meters (NSD's trust, affection, desire, tension, −100..100) plus up to
    about 6 the reader defines (name, min, max, start), each an `ss.meter` bar on the NPC card and the Cast
    tab, changed by `~ npc Name | meter: +N` and clamped by code. Companions are NPCs (same dossier and
    meters); RPG Battle keeps only their fight side, linked by name.
82. Every quest needs a concrete goal; one without is refused or flagged.
83. **Uncountable quests**: the tail lists up to 3 open quests code cannot count; the story writes
    `~ quest X | met: yes`, the quest shows Ready, and code pays the parsed reward at turn-in. Finished
    quests are kept, never deleted.
84. A quest details pop-up: goal, progress, terms, giver, due, history (`quest.details`).
85. A rolling one-line progress note per quest.
86. **Rank ladder**: F, E, D, C, B, A, S by default; a pack's `ranks` content replaces it; a quest's
    difficulty may name a rank; query `quest.ranks`.
87. A quest's reward is held inside its rank's range by code; the receipt says when it was clamped. A
    written rank reaches no higher than the party's rank, and one reply pays at most that rank's top in
    rewards the story wrote (pack quests' own rewards aside).
88. Pacing: Director prompt lines (no quest spam, a passerby is a passerby, the world doesn't send
    trouble). ~~And an offer cooldown setting (a held offer is shown later, never refused).~~ The cooldown
    went with the offers (Story Director #99).
89. **Chronicle** (Story Director part): `world` and `faction` kinds, times from the clock, up to 3
    ongoing events picked into the tail per reply (seeded, stable on a swipe), a Chronicle screen.
90. NSD: meter stages (named thresholds, moved by code) and hidden dossier entries unlocked at a threshold.
91. RPG Battle: no second rank system: its level tiers are the ladder (uniform, or a named list with
    uneven bands), query `party.ranks`; a foe line takes `rank: D` besides weak/even/strong/deadly;
    companion stats by formula; a "points to spend" badge on the HUD.
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
94. **Turn-in follows the story**; code referees in the same reply: it pays when the checks pass, and
    refuses and tells the story when they fail (§C2).
95. **No quest buttons** (Accept, Decline, Take, Finish, Abandon); screens show status text; the commands
    stay for templates, Studio and tests; the `quests.turnIn` setting is dropped.
96. **Using a consumable is story-driven**: `! use X | on: Y`, or `- item X` marked used (SPEC §7), runs
    `item.use` by code in the same reply; a refusal keeps the item and tells the story. Equip, Take off and
    Give stay as bag management. *Changed in beta.1 (live test: "use item is missing"):* the Inventory has
    **Use on…** for a consumable too, bag management (rule 6): the members RPG Battle's `items.useOn` says a
    dose would help now, none while a fight has the party (the Fight screen's Item does it then).

**Screens and later work**
97. The UI overhaul waits until the base structure is ready; polish now is functional fixes only.
98. An interactive map: pan and zoom (wheel, drag, pinch, buttons, keys), search over places (undiscovered
    ones too, never hidden or secret ones), place details with code's travel time; the view is per reader.
99. Equipment as in MVU: an "equip on…" picker, one step `inventory.equipOn { stack, actor }` (a full slot
    sends its oldest piece back to that member's carry), a per-character Equipped list, accessories up to
    3 (built: SPEC §7 "Equip on…"; the counts from RPG Battle's `items.slots`, eligibility from `items.canWear`).
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
    * Money and items from the story: at most `storyCoinPerReply` and 20 of one item per reply, clamped with
      a Problem; signed amounts refused; owners must be in the party; the wallet caller rule (SPEC §7).
    * Pack events fire from their definition only, a repeating one once per reply, nothing on a Continue
      or a dry run (SPEC §4.1).
    * Reading change lines: linear; at most 150 per reply; a close tag counts only at a line's start or
      end; a cut-off last line is a Problem; `label:value` accepted; [Happened] collapses past half the
      budget; names flattened before budgets (SPEC §4.3, §4.4).
    * Screens: control names prefixed like ids; templates nest at most 64 deep and @-rules 8 deep; text
      settings keep their `max`.
104. **A pack sets the money scale** (the currency is only a name; lorebooks carry flavour for the model,
    never numbers). The pack's own numbers (ranks' `reward`, item `value`, shop `price`) are used exactly as
    written. Built-in defaults that come from no pack are gold-scale, so a pack may say `economy: { scale,
    note? }` (0.001–1000, default 1; PACKS.md). Story Block's query `inventory.economy` → `{ scale, source:
    'pack' | 'settings' | 'default' }`: the reader's `economyScale` setting (0 or blank: use the pack's), else
    the first enabled pack's, else 1. Every built-in default money number is multiplied by `scale`, rounded,
    at least 1: Story Block's 1000 × level story coin budget, Story Director's default ranks, RPG Battle's
    default loot, coin and prices. Modules read it with `tryQuery('inventory.economy')` and a fallback of
    `{ scale: 1 }`. Ersveil sets scale 8: its F rank tops at 400 marks against the built-in F top of 50, so
    the built-in defaults land in marks about right; its own ranks, values and prices stay as written.
    Crafting data in packs (F102): recipes' `craft`, `dc`, `station`, `stat`, `known`, `teaches`, the `crafts`
    kind and query `packs.crafts`; NPC meter presets: the `meterPresets` kind (PACKS.md).

### User decisions from the live tests (2026-10-22, F105–F108)

(F108 came with live test #4's terms2 work. F109–F114 are not used: the next decision is F115.)

105. **The reader names the world's words again** (v1 had them; v2 lost the settings). RPG Battle's settings,
    group Terms: **XP word** (`party.xpName`) and **Level word** (`party.levelName`), over a pack's `terms`,
    over XP and Level. **Rank ladder** (`party.ranks`, a `form: 'lines'` list of `{ rank }`, lowest first, a
    line optionally "Name: first level") and **Levels per rank** (`party.levelsPerRank`, 0–999: a rank with no
    first level of its own starts that many levels after the one before; a line's own first level wins when it
    rises), with a read-only preview of each rank's levels in the field's help (terms2, 2026-10-22: the ladder
    moved here from Story Block's Terms, since a ladder bands levels; a stored Story Block `ranks` value moves
    to RPG Battle once, when RPG Battle starts and has none). RPG Battle gives the lines to Story Block through
    the hook `ranks.reader()` → `{ lines, perRank }`; `packs.content({ kind: 'ranks' })` answers with the
    reader's ladder when a module gives one (records `{ id, title, levels?, reward?, pack: null, reader: true
    }`, levels from the lines and Levels per rank, else the first pack's at each place; its rewards kept by
    place), so Story Director's `quest.ranks`, RPG Battle's `party.ranks` (its level labels: "Soul Class III
    (Lv 24)", a foe's rank and a fight's tier, "Weir Rat ×8 · Soul Class I · weak") and Story Block's coin
    budget all use the same bands. Without such a module there is no reader's ladder: the pack's, then each
    module's built-in (Story Director's F to S). Static prompt text that names XP, levels or ranks takes the words from the settings: a changed
    setting may change the static part; otherwise it stays byte-identical reply to reply.
106. **Items add carry capacity**: a pack item's `carry` (1–1000) adds to its owner's capacity while owned (a
    member's thing to them, a shared-bag thing to the party), equipment only while worn; the reader may name
    such items in RPG Battle's settings (`items.carryItems`, "Name: capacity"). RPG Battle's `items.carry` adds
    it (`people[].bonus`, `bagBonus`, `bonuses: [{ stack, carry, owner }]`) and Story Block's Equip on… and loot
    checks ask the same query; Inventory shows "+N carry" (`inventory.items` rows' `carry`). Only `pack.` defs
    keep `carry`: the story never sets or raises it. Losing the item lowers capacity; nothing is dropped.
107. **Prices by place, in layers** (replaces v1's guess from words in a place's name, now the RPG Battle
    setting `trade.guessPrices`, off): a place's settlement type (hamlet, village, town, city, capital, outpost,
    camp: buy and sell factors and stock size) and environment tags (coastal, river, port, mountain, mining,
    forest, desert, farmland, frontier, swamp: a factor per item category, ±30 % per category in all) set its
    prices. Built-in in RPG Battle; a pack's `markets` content defines or overrides types and tags and its
    places' `market` and `tags` name them; a lorebook entry's `market: town; coastal, port` line names them for
    its place (read by Story Block when a chat opens, `packs.markets`). Order for a place: lorebook, pack, the
    scene's place kind, built-in; unknown means factor 1. The money scale (F104) multiplies the built-in prices
    and worths (shop stock, a story-made thing's worth through `item.define`'s new `scale`), never a pack's own.
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
118. **Settings → Diagnostics** (last before Versions; v1's RPG Battle had one): **Copy report** and **Save
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
    failures, a hook slower than 2.5 s and refused steps are Problems. Story Director settles its waiting
    turn-ins there (`quest.settle`), and keeps its beforeGenerate `quest.settle` as the fallback on an older
    Story Block, which never calls `afterCapture`.

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
    join or skill, no `?` line, no `heal:`/`reward:`/`price:` label. A turn-in (`- quest`) is still checked by
    its owner (goal, place, budget, F121); `- item` only moves or removes what the party holds (the owner
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
    rolls?"; RPG Battle's checks were only on its own status card, which is off by default). A module's hook
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

For a module's own call to a model, outside the story (Story Director's arc planner, RPG Battle's monster
flavour, companion skills, What next?). Story Block makes the call and keeps the rules; the module writes the
prompt and reads the text (src/v2/model-call.js).

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

### Lead decision after the beta live test (2026-10-22, F126)

126. **Other modules adjust RPG Battle's checks** (`ctx.gather` + hook `checkModifiers`). A command may ask
    every other module's hook of a name with **`ctx.gather(name, args)`** → `[{ module, answer }]` (SPEC §3.2):
    synchronous, on the state the command sees (a capture: the reply's, so a Re-read or a swipe asks the same
    state), frozen copies, and null-safe (no answer, a promise or a throw is left out). RPG Battle asks
    **`checkModifiers({ state, query }, { actor: { id, name }, skill, stat, target, dc })`** → `[{ mod, text }]`
    (or one `{ mod, text }`) before a check is resolved; `target` is the person the check is against (its
    `vs:` or `target:` label, else someone here whose name the line's text has). Each `mod` is held to −5…5,
    the sum to ±5 (RPG Battle's setting *Other modules' check modifiers, at most*), at most 4 entries; they
    show on the check's line with their module ("−2 Elula is wary (Delta)"). RPG Battle also asks NPC State
    Delta's query `npc.socialModifier({ name, skill })` → `{ mod, name, skill, reasons: [{ text, value }] } | null`
    (NSD #207; `mod` whole, ±5 by default, the reasons add up to it; null for a skill that is not social, an
    unknown person, its feature `npc-state-delta.social` off or Delta off) for a social skill (persuade,
    charm or seduce, intimidate, deceive, or a generic social one) against someone, on the check's reply
    state; each reason is one entry on the line ("−2 Elula is wary (Delta)"), so Delta needs no hook of its own.
