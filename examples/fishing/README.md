# Story Suite Fishing (example activity)

A small fishing mini-game for **Story Block v2**, and the reference for writing your own activity: a
separate SillyTavern extension that adds a domain, a few commands and a tab, and talks to Story Block
**only through its public sdk** (`globalThis.StoryBlock.ready`). No model calls, no message parsing:
code decides the catch, the next reply tells it.

Version `2.0.0-alpha.1`. Needs Story Block v2.

## Install

Copy this folder into SillyTavern as its own third-party extension, for example
`public/scripts/extensions/third-party/story-suite-fishing/`, next to Story Block
(`third-party/Story_block`). The manifest declares `"dependencies": ["third-party/Story_block"]`, so
SillyTavern loads it after Story Block. Without Story Block v2 it logs one line and stays off.

## Playing

Open the **Fishing** tab in Story Block's tab bar.

1. **Where.** The spot comes from the scene (`scene.place`): a place whose name, kind or region names
   water ("Moonfall Lake", "Saltmarsh Harbour", "the Old Weir") is fished as a lake, the sea or a river.
   Anywhere else, pick the water yourself ("the sea by Bluewatch Village").
2. **Cast**, then watch the float. When it dips (**A bite!**), press **Reel** before it springs back.
   Too early spooks the fish; too late and it gets away. Rarer fish give you less time.
3. A landed fish goes into the party's inventory as goods with its rarity, weight, quality and value.
   The next reply narrates it once: *"Astra lands a rare 4.2 kg silver-violet trout at Moonfall Lake."*
4. The log keeps the last 20 catches. **Release** puts one back into the water (and out of the pack).

The story may later rename a fish or add flavour (Story Block keeps the old name as an alias); its value,
rarity and weight never change.

## How it is built (copy this for your own activity)

```
manifest.json      its own extension; "dependencies": ["third-party/Story_block"]
index.js           await StoryBlock.ready → sdk.registerModule(fishingModule(sdk))
src/rules.js       pure rules: fish tables, the catch, the bite timing, the sentences
src/module.js      the module: domain, validator, commands, queries, tab
src/widget.js      renderFishing(el, props, api): the mini-game as one self-contained widget
tests/             node --test with a fake sdk and a fake DOM (no SillyTavern, no Story Block)
```

**1. One domain, one writer.** The module owns `fishing` and nobody else writes it:

```js
fishing = {
  sessions: { [id]: { id, spot: { name, kind }, bait, startedRev, status: 'waiting'|'landed'|'lost',
                      n, bite: { bite, window }, catch: { name, rarity, grams, quality, value } } },
  log: [ /* the last 20 landed: { id, session, name, rarity, grams, quality, value, spot, stack, def, released } */ ],
}
```

Its `validate(slice)` checks every number is a whole number, every enum is known and only one line is
in the water. A command that breaks a rule is rejected whole and nothing is saved.

**2. Code decides, with the receipt's seed.** Handlers are synchronous and use only `ctx`:

| Command | Payload | What it does |
|---|---|---|
| `fishing.cast` | `{ spot?: { name, kind } \| 'name', bait? }` | Opens a line. `ctx.rng` decides the fish (species from the water's table by rarity odds, weight in grams, quality, value in the smallest coin) and then the bite time and reel window, in that order. Grants nothing; not narrated. `spot` defaults to the scene place. |
| `fishing.reel` | `{ session, hooked: boolean }` | The reader's press as a flag. Hooked: `ctx.call('inventory.grant', { def: { name, kind: 'goods', rarity, value, note }, qty: 1, owner: 'party' })`, logs the catch, narrates it. Missed: grants nothing. It draws no randomness, so the outcome depends only on the cast's seed and the flag. Claim `fishing:<session>:reeled`. |
| `fishing.release` | `{ catch }` | `ctx.call('inventory.consume', { stack, qty: 1 })` for that catch and marks it released. Claim `fishing:<catch>:released`. |

Rejections: `INVALID` (no water, a line already out, `hooked` missing), `NOT_FOUND` (no such line or
catch, or the fish already left the pack), `CLAIMED` (reeled or released already).

Queries: `fishing.log` (the log), `fishing.session` (the open line `{ id, spot, bait, bite, window }` or
null), `fishing.rev` (`meta.rev`, which the cast stores as `startedRev`). The prompt gets nothing static;
while a line is out the tail has one optional line.

**3. The UI only shows what code decided.** The bite time and window shown by the widget come from
the `fishing.cast` receipt (or the open session in state); the widget just times the press and sends
`hooked`. It never reads message text, and re-rendering it (the host re-renders tabs after every
commit) keeps the line's clock and never casts again. `renderFishing(el, props, api)` takes
`props = { place, spot, session, log, last, currency }` and `api = { command, query }`, so it can be
placed by itself as a widget in any layout: the module registers it as `widgets.fishing` (SPEC §13.5),
and every prop left out is looked up by query. The Fishing tab simply calls it with props from the head
state.

**4. Story state lives in replies.** Story Block stores each command's changes on the current reply.
Swiping the reply that *tells* the catch does not repeat it (the commands ran once, from the clicks; the
new swipe narrates the same receipt again). Swiping or deleting the reply the catch was made on takes
the fish back with it.

**5. Values in the smallest coin.** Values are whole numbers of the smallest coin (on the default
copper / silver / gold scale a common fish is a few copper, a legendary one a few gold). When a module
offers the `currency` hook, the log shows values in its coins.

## Tests

```
node --test tests/*.test.js
```

Same seed gives the same catch, a failed reel grants nothing, one cast is one fish even when the
narrating reply is swiped, release, every rejection leaves the state as it was, and the widget's
timing (fake timers, fake DOM).
