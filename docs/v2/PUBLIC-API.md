# Public API v1 and the `{{sb::…}}` macro

For card authors and third-party scripts: a small read-only surface over the story state, with a promise that it does not change. It is separate from `StoryBlock.sdk`, which is for modules and may change between releases.

```js
const api = StoryBlock.api;
await api.ready;
api.get('scene.place');            // "Vell Harbour"
api.get('money.text');             // "6 silver 5 copper"
api.get('party.me.health');        // "Hurt"
const off = api.on('story:changed', ({ index, changes }) => console.log(changes));
```

## The promise

Within API version 1 the names, arguments and payload shapes on this page do not change. New paths, new fields and new events may be added. A removal or a change needs API version 2, announced one minor release ahead, with version 1 kept working for at least two minor releases. Values are read from the story state as it is after the latest reply on screen, so a swipe, a delete or a reload is seen the same way as in the game itself. Version 1 only reads: a card changes the story through the narrator's change lines or the screens.

## The object

`StoryBlock.api` is frozen.

| Member | What it is |
|---|---|
| `version` | `1` |
| `host` | The Story Block version, as text (like `"2.19.0"`). |
| `ready` | A frozen promise that resolves, to the api, once the host is up and the first chat has been read. A chat opened later is told by `story:chat`. |
| `get(path)` | The value at a path, a frozen plain copy, or `undefined`. A path is not case-sensitive. A list or object you get back cannot be changed. |
| `paths()` | The paths that have a value in this chat right now (a frozen list), for authors and pickers. |
| `on(event, fn)` | Listens to an event; returns `off()`. An unknown event or a `fn` that is not a function throws. |

## Paths

| Path | Value |
|---|---|
| `scene.place` | The place's name (text), or `undefined` while none is set. |
| `scene.place.kind`, `scene.place.region` | The place's kind and region (text). |
| `scene.time`, `scene.date` | The story clock as text, only with Story Director (`"06:40 am"`, `"Goldwane 12, 611"`); `undefined` until the story sets a time. |
| `scene.weather` | The weather (text), only while the Weather feature is on and one was written. |
| `scene.present` | Who is present: a list of names (empty when nobody). |
| `money` | The party's money, a whole number in the chat's smallest coin. |
| `money.text` | The same as the chat writes it (`"6 silver 5 copper"`, `"7 gold"`). |
| `items` | The party's things, a list of `{ name, qty, kind, note }`. The stacks of one name add up. |
| `items.<name>`, `items.<name>.qty`, `.kind`, `.note` | One thing (the name as in the bag, any case); `note` only when it has one. |
| `party` | While the RPG is on: the party's members, a list of `{ name, level, xp, health, mana, stamina, stats }`, in block-id order. A companion who left is not in it. |
| `party.<name>`, `party.<name>.<field>`, `party.<name>.stats.<stat>` | One member, one field, one stat (`str vit agi dex int luk cha`). |
| `party.me`, `party.me.<field>` | The reader's own Character: the one named like the persona, else the only Character. `undefined` when it is not clear who the reader is. |
| `blocks` | The ids of the data-module blocks in the chat (pack blocks included). |
| `blocks.<blockId>`, `blocks.<blockId>.<field>` | A chat block's visible fields, or one field as it is stored (numbers as numbers, text as text, a `map` field as an object, and `….<field>.<key>` for one key; a List of entries field as a list of objects). A block for characters is read by who: `blocks.<blockId>.<who>.<field>`. |

`health`, `mana` and `stamina` are the words the Party card shows (`"Hurt"`, `"Fresh"`; a Standard block bar's word is spread over its blocks). `level` and `xp` are numbers. A name with dots in it (`items.Mr. Fox's Pie.qty`, `blocks.pack.chat/tracker.hope`) is fine: the path is matched against the names in the chat, not split at every dot. `npc.<name>.<meter>` for NPC State Delta is planned as an NPC State Delta change; it is not in this release.

### What is never returned

A value that is hidden reads as `undefined`, and its path is not in `paths()`, in a change list or in a macro:

- A data-module field the pack marks `prompt: false` (hidden from the story): in `blocks.*`, and in `party.*` (a member's hidden level, xp, bar or stat is left out; a hidden Who is the block's name).
- A block the Blocks screen lists as **Hidden**: no tab and no card (a block with no `show` at all is the same) and no screens or layouts of its own, and not an RPG role block. Such a block has no `blocks.*` path, no change in an event and no macro value.
- The RPG's role blocks and the party while the RPG is off (off means fully off).

Items, money and the scene have no hidden marks. A value you get is a copy: changing it changes nothing in the story.

## Events

`api.on(event, fn)`; each payload is a frozen plain copy. Listeners run after Story Block has saved what the reply changed. An error in a listener is caught and logged once; it never breaks a reply. Events arrive in order.

| Event | Payload | When |
|---|---|---|
| `story:changed` | `{ index, changes: [{ path, from, to }] }` | After a live reply's changes are applied (and after lines added to it afterwards, such as the safety net's): the difference of the public paths before and after, sorted by path. `from` and `to` are `null` for "none". Not sent when nothing public changed. |
| `story:reply` | `{ index, summary }` | After a reply is fully captured. `summary` is one line of text built from the public changes (empty when there are none; at most 500 characters). |
| `story:rebuilt` | `{ reason }` | After the state was rebuilt and not a new reply: `"swipe"`, `"delete"`, `"reread"`, `"repair"`, `"rewind"` (a take-back), `"module"` (a module became ready or dormant) or `"reload"` (the open chat was read again). Read the paths again. |
| `story:chat` | `{ chatId }` | When the chat changes and its state is ready. |

`index` is the message's position in the chat. A swipe sends `story:rebuilt` and then, when the new swipe is generated, the usual `story:changed` and `story:reply`. A message edit sends nothing.

```js
StoryBlock.api.on('story:changed', ({ changes }) => {
  const money = changes.find(c => c.path === 'money');
  if (money && money.to > money.from) toastr.success('Richer by ' + (money.to - money.from));
});
```

## The `{{sb::path}}` macro

In SillyTavern prompts, character cards, regex scripts and status bars:

| Macro | Result |
|---|---|
| `{{sb::scene.place}}` | The value as text. |
| `{{sb::money.text}}` | `6 silver 5 copper` |
| `{{sb::party.me.health}}` | `Hurt` |
| `{{sb::items.Healing Draught.qty}}` | `2` |
| `{{sb::scene.present}}` | `Ren, Mara` (a list is a comma list) |
| `{{sb::party.me.health::unknown}}` | The fallback (`unknown`) when the path is empty or hidden. This `::` form is the safe one. |
| `{{sb::party.me.health\|unknown}}` | The same with `\|`; it works, but SillyTavern's engine reads `\|` in a few places of its own, so prefer `::`. |

The same paths and the same hidden-value rule as `api.get`. An object has no text (use a leaf path, or give a fallback). Output is cut at 300 characters, line breaks become spaces, and `{{` in a value is written with a zero-width space so it is not run again. No expressions, no functions, read-only.

It works with SillyTavern 1.19's macro engine (the default). With the old macro engine, only a fixed set of paths has a macro (no fallback): `scene.place`, `scene.time`, `scene.date`, `scene.weather`, `scene.present`, `money`, `money.text`, `party.me.name`, `.level`, `.xp`, `.health`, `.mana`, `.stamina`.

Story Block's own text in the prompt is not touched by macros: every `{{` in a name the story introduced is written with a zero-width space before SillyTavern sees it, so `{{sb::money}}` inside a place name stays text.

A ready-made example is in [examples/cards/status-bar](../../examples/cards/status-bar/README.md). A status bar as a regex script: find `\[STATUS\]`, replace with `{{sb::scene.place::somewhere}} · {{sb::money.text::0}} · HP {{sb::party.me.health::?}}`.

## Not in version 1

Writes (an allow-list of commands may come in a version 2) and `npc.<name>.<meter>`. Blocks defined on a character card's worldbook are a separate follow-up. For a first walk-through, see [BUILD-A-CARD.md](BUILD-A-CARD.md).
