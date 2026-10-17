# Story Block v0.6.2

A SillyTavern extension that keeps story trackers — an inventory, a character sheet, scene
notes, or any block you design — inside the chat itself, injects their current state into
every reply's prompt, and draws them as one tabbed card under the latest reply.

Every block is a definition you can edit. The built-ins are only templates.

## What it does

- **One engine, any block.** Inventory, World State, Choices, Dice, NPC Inner Chatter,
  Character Sheet and Scene Notes ship as templates.
  Add your own blocks with their own tag, prompt, format and display, or change the
  templates; **Reset to default** brings a template back.
- **State that sticks.** A *stateful* block's newest valid copy in the chat is its current
  state. It is sent with every reply's prompt and the model rewrites it in full, so it can't
  scroll out of context. A reply that leaves it out, cuts it off or writes it badly never
  replaces the last good state.
- **Per-turn blocks** describe the latest reply only and are never fed back.
- **A sidebar for your blocks.** Docked beside the chat on wide screens, a drawer on tablets
  and narrow desktops, a bottom sheet on phones. Each block gets a tab with a badge counting
  what the latest reply changed, and structured blocks list those changes. Other extensions
  can add tabs. Prefer the old layout? Switch to a card under the latest reply.
- **Optional "This turn" strip** under the latest reply: what it changed, at a glance.
- **Works with any preset.** The extension injects its own instructions; nothing has to be
  added to your preset.
- **Message-native.** Blocks are stored in the reply text as a hidden envelope, so swipes,
  edits, deletes and branches always show the right state. There is no separate database.

## Install

1. In SillyTavern, open **Extensions → Install extension** and paste
   `https://github.com/kohz87/Story_block`.
2. Reload. The settings live under **Extensions → Story Block**.

Requires a SillyTavern version with `setExtensionPrompt` and the `Popup` API (1.12+).

**Moving from Inventory Block:** disable Inventory Block. Story Block's Inventory template
reads Inventory Block's existing snapshots, so your current inventory carries over.

**Moving from Megumin Suite:** old `<Blocks>` in your chats are read by tag, so a block
with the same tag (for example `World_State`) picks up its last copy.

## Blocks

In the settings list, each block's switch turns it on or off, ✎ opens its editor, and ⋯ holds
the rest: show or hide its tab, move it up or down, duplicate, reset to default, delete.

Each block has:

| Setting | What it does |
|---|---|
| Enabled | Off: not prompted, not shown, costs nothing. |
| Shown | Off: still prompted and stored, but no tab in the card. |
| Kind | **Stateful** (kept and rewritten each reply), **Per-turn** (this reply only) or **First** (this reply only, written before the story). |
| Optional | Written only when something calls for it; a reply without it is not warned about. |
| Repeating | The model may write several tags in one reply (one per roll); they are read as one block. |
| Dice | Roll 0–10 dice (d4–d100) before each reply; the numbers replace `{{rolls}}`. |
| Format | **Rows** (`Item \| Qty \| Note` under `[Section > Sub]` headers), **Fields** (`Label: value` lines with meter, number, text and list types) or **Free text**. |
| Display | **Tree list** (rows: sections, drill-down, search), **Meters & fields**, **Scene board** (World State layout), **Choice buttons** (numbered list), or **Plain**. |
| Layout | Free-text blocks only: the skeleton the model fills in, as World State and Choices use. |
| Prompt | Your instructions for the block. `{{user}}` and `{{char}}` are filled in. |
| When | Every reply, every N replies, or only when a keyword appears in recent messages. |
| Tag, icon and tab label | The tag the model writes, the tab's icon, and a short label for the sidebar tab. |

### A new block from an example

The quickest way to add your own block: **Add block → From an example…**, paste the block
the way the model should write it, tags included, and press **Fill in the form**:

```
<Skill_Mastery>
Weapon Skill: [1-10]/10 | Weapon Skill XP: [0.00-9.99]/10 | Finesse: [1-10]/10 | Finesse XP: [0.00-9.99]/10

Last Gains: [what was gained and why / none: why no beat qualified]

[Add newly established skills in the same pairing, two skills per line. Use hyphens, not parentheses.]
</Skill_Mastery>
```

- The **tag** and **name** come from `<Skill_Mastery>` (*Skill Mastery*).
- The lines inside become the **layout**: the model copies it every reply and fills each
  `[placeholder]`, keeping your line breaks, pipes and wording.
- A paragraph written entirely in brackets that reads as sentences (the last one above) is a
  rule, not part of the skeleton: it becomes the **instructions**, said once instead of
  copied into every reply. Short brackets inside a line stay placeholders.
- It starts as a **Stateful** (kept and rewritten each reply), **Free text** block shown as
  **Plain** text, so every word of your example is kept. Change anything before **Save**.

The settings panel shows a rough token cost per block. Every enabled block adds its
instructions (and, for stateful blocks, its current state) to each prompt, plus what the
model writes back — pick the few blocks a story actually needs.

### World State and Choices

**World State** keeps the scene in Megumin Suite's World State layout, so NPC State Delta and
Megumin's readers understand it and existing Megumin chats carry over. The scene board shows
time, place and weather, a card per person (secrets hidden until revealed), what happens off-screen (hidden until
revealed, by default), threads and timers. Lines that pack several facts with pipes (`now Court | then: argues | on: noon`,
`visible: … | hidden: …`) are shown as short labelled rows. Write dates as `Year, Month Day` (for example `1042, Harvestmoon 14`) and NPC State
Delta's calendar picks them up.

**Choices** offers four next actions as buttons: click adds one to your message, Shift-click
(or the send button on touch screens) sends it. On phones and tablets the message box is
filled without being focused, so the keyboard doesn't pop up; tap the box to edit.

### NPC Inner Chatter

What the NPCs in the scene think and say behind {{user}}'s back: a whisper thread when two or
more are present, a pull quote for one. The instructions ask for every voice to come from
what the story has established about that NPC — personality, speech, history, relationships
from the character card, lorebook and NPC dossiers — and only what they could know. The
model writes the block in the same reply as the story, so all of that is in front of it;
the instructions tell it to use it. Edit them to taste.

### Dice

**Dice** (your attempts) and **Dice: Everyone** (anyone's) are rolled by Story Block, not by
the model: fresh numbers before every reply, swipe and regenerate, handed over in order. The
model decides whether an attempt needs a roll and how hard it is, then writes one line per
roll before the scene:

```
🎲 Climb the wet wall — d20+2 vs 15 → 12+2 = 14 · success, at a cost
```

The card checks the model used the numbers it was given, in order, and that the sums add up,
and says so — or names what went wrong.

### Writing a layout each display can draw

A block's **Prompt** says what to track; its **Layout** (free-text blocks) or **Fields** and
**Columns** (structured blocks) say how it is written. The model copies the layout, and the
display reads what comes back. You can change all of it. If a reply does not read cleanly,
the block is drawn as plain text instead, so nothing the model wrote is ever hidden.

**Scene board** (World State). Markdown the board understands:

```
**📅 Time:** 1042, Harvestmoon 14, dusk | **🌤 Loc:** Mill Yard | Low Ward | **🌡 Wx:** Rain, cold
---
**🧍 {{user}}:**
* *Outfit:* Wet cloak
* *Guild Rank:* F (Lance Leader)
**👥 NPCs Present:**
**Brenn (miller):**
* *Mood:* Wary, tired
* *Secret:* Owes the guild money
**📡 Off-Screen:**
* **Geva — now:** Bailiff Court | then: argues the warrant | on: Harvestmoon 14, 18:00
**🔥 Unresolved Threads:**
* Who tipped off the bailiff | then: warrants at dawn
**🌱 Planted Seeds:** The cracked millstone, 2 turns
**⏳ Consequence Timers:** Guild collector arrives, 3 turns
**🎯 Arc Phase:** Escalation
**🎬 Scene Phase:** Building
```

| You write | The board shows |
|---|---|
| `Time` / `Date`, `Loc` / `Location` / `Place`, `Wx` / `Weather` labels on the first line | Time, place and weather rows (pipes inside a value read as ` · `) |
| `**🧍 Name:**` (or `PC:`, `Player:`, `You:`) | Your card, tagged *you* |
| A heading such as `NPCs Present`, then `**Name:**` or `**Name (role):**` | A card per person |
| `* *Field:* value` under a person | A labelled row. Outfit, Position, Agenda, Visible Condition and Carrying come first; any other field you invent follows as written |
| `Mood:` | A mood pill next to the name |
| `Secret:` | Hidden behind a *Reveal secret* button |
| `Off-Screen` / `Elsewhere` heading, then `* **Name:** what` | One entry per person or event; hidden behind *Reveal* (with a count) unless *Hide off-screen until revealed* is off |
| `Unresolved Threads`, `Planted Seeds`, `Consequence Timers` | Lists (short items as pills, long ones as rows) |
| `Arc Phase` / `Scene Phase` set to Setup–Resolution / Early Simmer–Breather | A progress rail (other values are shown as written) |
| `a \| label: b \| label: c` anywhere | One short row per part; a `label:` of up to three words becomes the small label |
| `**Name — now:** …` | The name, with *now* as the first part's label |
| `[59.0, 110.0]` in the location | Dimmed coordinates |

Headings are matched on their words, not their emoji, and `---` lines are ignored.

**Meters & fields** (Fields format): one `Label: value` line per field. Each field's type is
set in the block editor: a meter is written `HP: 7/10`, a number `Gold: 85`, a list
`Skills: Climb, Swim`, text as it is. Bold labels, bullets and several fields on one line
split by ` | ` all read.

**Tree list** (Rows format): `[Section > Sub]` headers, then one `Item | Qty | Note` line per
item (the columns are the block's own).

**Choice buttons**: a numbered or bulleted list (`1. Follow her out`). A line of prose in
between turns the buttons off for that reply.

**Whisper thread** (NPC Inner Chatter): `Name: line`, one per line. Two or more speakers
make a thread, one makes a pull quote.

**Dice cards**: one roll line per roll, as shown under Dice above.

### How a reply carries its blocks

The model ends its reply with one hidden envelope:

```
<!-- STORY_BLOCKS_V1
<Blocks>
<Inventory>
Coin Pouch | 1 | 85 Gold
[Wagon > Food]
Salt Pork | 3 | Barrel
</Inventory>
</Blocks>
-->
```

A bare `<Blocks>…</Blocks>` (or a bare block tag) is accepted too and hidden on receive.

## Where blocks are shown

**Settings → Show blocks in:**

- **Sidebar** (default). Every enabled block gets a tab from the first message, except
  optional ones (Dice, NPC Inner Chatter): their tab appears only when the latest reply has
  one. Wide screens with room beside the chat dock it there, always open;
  the pin button in its header switches between docked and drawer. Tablets and narrow
  desktops get a drawer from the right; phones a bottom sheet (tap or drag its handle or
  header to resize; drag down, tap the dimmed chat above it or tap × to close — from full
  height a short drag down goes back to half). While closed, a handle on the right edge shows this turn's
  change count.
- **Card under the latest reply**, as in v0.1. Extensions that add a tab to Megumin Suite's
  card (NPC State Delta) show up in this card unchanged.

**"This turn" strip** (off by default) adds one line under the latest reply listing what it
changed; tap it to open the sidebar on that block.

**Hide off-screen until revealed** (on by default) keeps the scene board's Off-Screen section
behind the scenes: it shows how many entries there are and a **Reveal** button, and the
entries are not put on the page until you press it (it stays open for that chat until you
hide it or reload). Only the board is affected: the block text is unchanged, so NPC State
Delta and Story Director's mirror still read and write it.

## Editing and recovery

- **Edit** on a tab edits that block's current content; it is checked by the block's own
  parser and saved into the latest reply.
- **Story Block: Rescan** (Extensions menu) hides raw blocks left visible in the narration
  and reports where each block's current state comes from.
- The settings panel's status line says whether the last reply's prompt got the block
  instructions, and how they were found.

## For other extensions

`globalThis.StoryBlock` lets other extensions add tabs and read blocks:

```js
const sb = globalThis.StoryBlock;            // sb.apiVersion >= 1 since v0.6
sb.registerTab({
    id: 'my-tab', label: 'My Tab', icon: '🧭',
    render(pane, { messageId, message }) { pane.textContent = '…'; },
    isAvailable: ({ messageId }) => true,
    key: () => 'unchanged-until-this-changes',   // optional: skip re-rendering
    badge: () => 2,                              // optional: count on the tab
});
sb.getBlock('World_State');                  // { text, state, messageIndex } of the newest valid copy
sb.blockForGeneration('World_State', 'swipe'); // the copy the next reply will be shown
sb.registerBlock({ id: 'my-plugin', tag: 'My_Block' });  // hidden, kept, never prompted
sb.onReply(({ messageIndex }) => { /* a reply arrived */ });
```

The full list is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (Plugin API). Registered tabs
appear in the sidebar and the card. The card also carries Megumin Suite's card classes, so
extensions that already add a tab to Megumin's card (NPC State Delta) show up in Story Block's
card unchanged; to appear in the sidebar they need `registerTab`.

## Development

Plain ES modules, no dependencies, Node.js 24:

```sh
npm run check   # syntax check of index.js and src/
npm test        # node:test suites
```

The module contract is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License

GPL-3.0. Story Block's engine is ported from Inventory Block by the same author.
