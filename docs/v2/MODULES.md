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
  hooks:    { /* 'item.define' | 'currency' | 'beforeGenerate': fn */ },
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

## B. RPG Battle (module id `rpg-battle`)

### B1. `party` (part **party**, agent RB-party)
```js
party = {
  pc: 'ac_xxxxxxxx' | null,
  order: ['ac_…'],                                  // display order, pc first
  actors: { [id]: {
    id, name, kind: 'pc' | 'companion', control: 'player' | 'auto', role: '',
    level: 1, xp: 0, points: 0,
    hp: { cur, max }, mp: { cur, max }, sp: { cur, max },
    stats: { STR, VIT, AGI, DEX, INT, LUK, CHA },     // base stats (ints); gear bonuses are derived, never stored
    skills: [{ name, level, uses, active: true }],   // names from the skill library or party.custom
    conditions: [{ kind: 'poisoned' | 'bleed' | …, stacks: 1 }],
    npc: null | 'NSD name',                          // the NPC this companion is, if any
  } },
  custom: { [skillName]: skillDef },                 // story-taught skills, built by v1 skillFromTemplate
}
```
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
Hooks: `item.define(def, { note, owner })` → sets `kind`, `rarity`, `value` (smallest unit), `slot`,
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
    taken: null | { rev },                           // when the reader took it on (quests)
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

### C2. quests (part **quests**, agent SD-quests)
Same `director` domain (the module owns it; this part touches only `taken`, `ended`, `target`, `reward`
and quest offers).
Commands: `quest.take`, `quest.decline`, `quest.abandon`, `quest.finish` (target met — foes from
`combat.foesBeaten({ sinceRev: taken.rev })`, items from `inventory.items` — and the place rule: a settlement
or the giver present; pays with `ctx.call('wallet.receive')` under claim `quest:<id>:paid`, takes fetch items
with `inventory.consume`, XP through `party.grantXp` when that command exists).
Targets from `target:` / `reward:` labels, else from the goal text ("at least 3 wolves", "1 silver each").
Queries: `quest.progress({ id })` → `{ have, need, met, source: 'fights'|'inventory'|null }`.
Tab: **Quests** (offers with Take on / Turn down; active with progress and Finish; finished).

## D. NPC State Delta (agent NSD-hosted)
No domain. When `globalThis.StoryBlock?.sdk` (v2) is present, NSD registers module `npc-state-delta` with
queries `npc.present`, `npc.dossier({ name })`, `npc.known`, a **Cast** tab (its existing cards), and a
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
   → `{ name, short }`. `wallet.pay` / `wallet.receive` take `{ owner, amount, note? }`. Prices, rewards
   and loot are whole numbers of that currency (v1's copper-based numbers are kept as they are). The change
   line is `+ coin 30 | from: the sealer`; any coin words the model adds are ignored, only the number counts.
2. **`ctx.rev`** is the `meta.rev` this receipt will have. Use it for `taken.rev`, `ended.rev`, etc.
3. **Queries can use queries:** a query is called `(state, args, tools)` with `tools.query(name, args)`
   over the same state.
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
   ran, and opens its creation wizard (dialog mount, §13.6). The greeting may show before that.
13. **No model-written state blocks.** v2 never asks the model for World State, Inventory, Party or other
   state blocks; screens and the prompt's tail come from the state. The only block the model writes is
   `<Changes>`.
