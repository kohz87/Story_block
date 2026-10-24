# Inventory seams with the rules module

What Story Block's inventory and money do when a rules module (RPG Battle, module id `rpg-battle`) is ready, and
what they do when it is not. The contract is `docs/v2/contract/RB_CONTRACT.md` §3 (rows `purse.currency`,
`rules.moneyPolicy`, `inventory.definitions`, `inventory.registerDefinition`, `rules.registerItem`,
`rules.equipPlan`), §4, §5 and §10 (the three E rows for SB); this page only records how the host side is built
and where the contract left a detail open. Code: `src/v2/domains/inventory.js`, `money.js`, `digest.js`,
`src/v2/packs/content.js` (`itemDefsIn`). Tests: `tests/v2/domains/money-rules.test.js`, `definitions.test.js`,
`equip-plan.test.js`, `digest.test.js`, with a test-only rules stand-in in `tests/v2/domains/helpers/`.

**Rule of the whole page:** Story Block alone behaves exactly as before. Every seam is found by asking for a
query or command by name; a name nobody answers means "no rules module", and the old code runs. Nothing here
reads another module's state, and nothing calls a rules command that could call back (no `item.equip`).

## 1. Money (P14)

`resolveCurrency(settings, ask)` (money.js) is the one resolver. `ask(name, args)` is any query function.

1. Ask `purse.currency({})`. `null`, no such query, or a throw: the reader's / pack's / default currency
   (`currencyOf(settings)`), reason `none`.
2. An answer is used only when `validCurrency` accepts it: `{ name, plural, short, coins?, display? }`, name and
   plural 1..24 and short 1..6 code points, no controls, no `<`, `>` or `|`; at most 8 coins with different
   names (ignoring case), each `{ name, plural, value }` with value 1..1,000,000, names without digits, `:`,
   `#`, `/`; a non-empty table must hold a coin worth 1; `display` `mixed` or `base`; no other fields. Anything
   else is `invalid`: the fallback currency is used, nothing is repaired.
3. `currencyResolution(settings, ask)` also says why (`{ currency, source: 'rules'|'settings', reason }`), for
   diagnostics. Asked from inside its own answer it answers the fallback (`busy`), so a rules query that reads
   `inventory.currency` cannot loop.

It is used by every handler (`receive`, `pay`, story lines, loot), by `inventory.currency`, and by the core
module's static coin line, tail and tab (`createCoreModule` passes its `query` to the core part). The wallet is
`{ coin: <whole number of the smallest unit> }` and nothing converts it: a different currency only changes how an
amount is read and written. A coin line is read with the override's coins (`+ coin 3 silver`).

An answer that is present but invalid also **holds the rules module's own money**: `wallet.pay` and
`wallet.receive` called by `rpg-battle` fail `RULES_MISMATCH` until it answers properly; the reader, the story
and other modules go on with the fallback. A rules module that is only unavailable (null, throw) is not held.

`rules.moneyPolicy({ level })` -> `{ storyCreditCap, storyDebitCap }` (whole numbers >= 0; each cap stands alone,
a missing or wrong one is "no cap from the rules"). `level` is `party.pc.level`, 1 without a party module.

- Credit: the reply's `+ coin` budget. Order: the reader's `storyCoinPerReply` (> 0), then `storyCreditCap`,
  then the old chain (quest ranks, the pack's ranks, 1000 x level x money scale). `inventory.storyBudget` and the
  goods-worth cap follow it.
- Debit: with `storyDebitCap`, the story's `- coin` lines (and `- item <money>`) of one reply are held to it
  (`perReply[<sid>].debit`, kept only once there is some): past it a line pays what is left with a Problems
  note, then is REFUSED. Without a cap nothing is counted, as before. A module's own `wallet.pay` is never counted.

## 2. Item definitions (P01, P24)

- `inventory.definitions({ ids? }) -> ItemDef[]`: ID-sorted copies of `inventory.defs`, default all; unknown IDs
  left out, each once; malformed arguments (`ids` not a list of at most 1000 definition IDs, args not a record)
  give `[]`. It reads the asking transaction's state, so a draft shows; it makes nothing. It does not look at packs.
- `inventory.registerDefinition { write, def, hash }`: only a call made by `rpg-battle` (`ctx.caller`); a button,
  a change line, `system` or any other module is REFUSED. Closed payload; `def` is a closed ItemDef (the
  validator's field rules, plain data, `carry` only on a `pack.` ID); `hash` must be the Hash of the def.
  Same ID and same bytes: no-op (`created: false`). Same ID, other bytes: CONFLICT, nothing changes. No stack,
  no alias is made (the story's name still finds it by the definition's own name). `write` is checked as a
  RecordId and not stored: sameness of bytes is the idempotency.
- `rules.registerItem` routing. A definition new to the chat (a `story/<slug>` from a `+ item` line or a grant
  by name, a pack item through the `item.resolve` hook, a full def handed to `inventory.grant`) is built as
  before (item.define hooks run, caps apply) and then, **if a command `rules.registerItem` exists**, sent to it
  with `ctx.call`: `{ write, def, rule: null, template, area: null, rulesHash: null }`. `write` is `wr_` + 8 hex
  characters of the receipt id and the def id (no randomness drawn, so chats without the module make the same ids).
  `template` is the pack item's own ID for a pack item, else null. The module registers the definition itself by
  calling `inventory.registerDefinition`; Story Block then uses `inv.defs[id]`, i.e. what the module registered,
  and fails `RULES_MISMATCH` if there is none, or if it is under another ID. Everything is one transaction: a
  later refusal (a goods limit, the carry limit, a failed payment, an unfit quantity) removes the definition
  and the rule together. Loot on offer (`? loot`) registers nothing; taking it does. With the command
  absent (`UNKNOWN_COMMAND`) the definition is stored directly, exactly as before.
- A full def handed to `inventory.grant` for an ID the chat already has: alone, "the existing def wins". While
  a rules module answers `rules.item`, a field it states (kind, rarity, value, stack, slot, stats, effect, tags,
  note, carry; not the name) that differs is CONFLICT.
- `itemDefsIn(packs, ids?)` (packs/content.js) is the read side for "register the frozen pack ItemDefs": the
  enabled packs' items as ItemDefs, ID-sorted, each ID once. After they are registered the chat's copies answer
  `inventory.definitions` whatever happens to the pack.

## 3. Equipment (P07)

While `rules.equipPlan` is answered, `inventory.equip` (direct), `inventory.equipOn` and, through it, the rules
module's own `item.equip` take **one** plan per call:

1. The piece must be equipment. A payload may not carry `plan`, `token`, `bypass`, `trusted`, `force`,
   `skipRules`, `rules`, `rulesHash`, `inputHash`, `unequip` or `move` (INVALID). `targetSlot` (and the old
   `slot`, which must agree) must be one of the eight slots. Direct equip: the wearer is the stack's owner; a
   piece in the party's bag needs `inventory.equipOn` with a member (REFUSED).
2. `rules.equipPlan({ stack, actor, targetSlot? })` is asked once. Its own failure is carried (its code if it
   is an ErrorCode, else REFUSED; a throw: its code or DEPENDENCY_UNAVAILABLE); no answer: DEPENDENCY_UNAVAILABLE.
3. The plan is checked, nothing is trusted: exactly the contract's eight fields; `actor`, `stack`, `def` are the
   request's; `slot` is a slot (and the one asked for); both hashes are Hashes; `unequip` and `move` are
   well-formed (no repeats, no unrelated pieces, targets only the wearer or, for a displaced piece, the party).
   Shape failures are `RULES_MISMATCH`. Then the records: a displaced piece not worn by the actor now, or a
   piece that is no longer with the `from` owner, is `STALE`.
4. `inputHash`. The contract says what it covers, not its bytes; Story Block recomputes it as
   `Hash({ rulesHash, actor: { id, stats, life }, slot: targetSlot | null, stack: piece, affected: [piece…] })`
   with `piece = { id, def, qty, owner, equipped }`, `affected` = the other stacks in `unequip` and `move`
   sorted by ID, and `stats`/`life` taken from `rules.sheet({ actor })`. A mismatch is `STALE`; no sheet is
   DEPENDENCY_UNAVAILABLE. `equipInputHash()` (inventory.js) is the reference; the test pins its bytes.
5. After the plan nobody wears two pieces in one slot (else `RULES_MISMATCH`). It is applied to the draft in one
   step: moves, `unequip` cleared, the piece put on in `plan.slot`. A hand-over into someone's carry follows
   `items.carry` as `equipOn` always did.

Two-handed, off-hand, swap and accessory choices are the plan's; Story Block applies them. `canWear` and the
slot counts of `items.slots` are not consulted under a plan. Results keep their keys; `targetSlot` is added when
one was asked for, and a direct equip adds `replacedAll` when more than one piece came off.

"Ready" is "something answers `rules.equipPlan`". Without it: today's code, `targetSlot` and plan-like fields in
the payload are ignored, no query is made beyond the one that found nothing. Story Block's change-line
grammar has no equip line, so `item` capture does not equip; a capture that ever does must call the same
`equipByRules` path.

## Left open by the contract (decided here, flagged for review)

- The bytes of `inputHash` (above), and that `stats`/`life` come from `rules.sheet`.
- What Story Block puts in `rules.registerItem` for fields only the rules module can resolve: `rule`, `area`,
  `rulesHash` are null; `template` is null for story items. The module must derive them for a story item.
- "Ready RB" detection: queries/commands answering by name (`purse.currency`, `rules.moneyPolicy`, `rules.item`,
  `rules.equipPlan`, `rules.registerItem`), not `sdk.modules` status (E2). A dormant module whose names are
  suppressed is therefore "not there".
- Precedence of the reader's `storyCoinPerReply` over `storyCreditCap`; `storyDebitCap` applies only to the
  story's own payment lines.
- `registerDefinition` keeps no ledger: a retry reports `created: false`.
- Invalid `purse.currency` holds `rpg-battle`'s `wallet.pay` / `wallet.receive` (RULES_MISMATCH).
- Hooks wanted in files this package does not own: a `packs.itemDefs` query in `packs/index.js` over
  `itemDefsIn` (so the module can read the frozen pack defs through a public query); the settings fold's coin
  preview (`view/settings/money.js`) still shows Story Block's own currency.
