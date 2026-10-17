# Story Block v0.2.0

A SillyTavern extension that keeps story trackers — an inventory, a character sheet, scene
notes, or any block you design — inside the chat itself, injects their current state into
every reply's prompt, and draws them as one tabbed card under the latest reply.

Every block is a definition you can edit. The built-ins are only templates.

## What it does

- **One engine, any block.** Inventory, Character Sheet and Scene Notes ship as templates.
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

Each block has:

| Setting | What it does |
|---|---|
| Enabled | Off: not prompted, not shown, costs nothing. |
| Shown | Off: still prompted and stored, but no tab in the card. |
| Kind | **Stateful** (kept and rewritten each reply) or **Per-turn** (this reply only). |
| Format | **Rows** (`Item \| Qty \| Note` under `[Section > Sub]` headers), **Fields** (`Label: value` lines with meter, number, text and list types) or **Free text**. |
| Display | **Tree list** (rows: sections, drill-down, search), **Meters & fields**, or **Plain**. |
| Prompt | Your instructions for the block. `{{user}}` and `{{char}}` are filled in. |
| When | Every reply, every N replies, or only when a keyword appears in recent messages. |
| Tag and icon | The tag the model writes and the tab's icon. |

The settings panel shows a rough token cost per block. Every enabled block adds its
instructions (and, for stateful blocks, its current state) to each prompt, plus what the
model writes back — pick the few blocks a story actually needs.

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

- **Sidebar** (default). Wide screens with room beside the chat dock it there, always open;
  the pin button in its header switches between docked and drawer. Tablets and narrow
  desktops get a drawer from the right; phones a bottom sheet (tap or drag its handle to
  resize, drag down to close). While closed, a handle on the right edge shows this turn's
  change count.
- **Card under the latest reply**, as in v0.1. Extensions that add a tab to Megumin Suite's
  card (NPC State Delta) show up in this card unchanged.

**"This turn" strip** (off by default) adds one line under the latest reply listing what it
changed; tap it to open the sidebar on that block.

## Editing and recovery

- **Edit** on a tab edits that block's current content; it is checked by the block's own
  parser and saved into the latest reply.
- **Story Block: Rescan** (Extensions menu) hides raw blocks left visible in the narration
  and reports where each block's current state comes from.
- The settings panel's status line says whether the last reply's prompt got the block
  instructions, and how they were found.

## For other extensions

```js
globalThis.StoryBlock.registerTab({
    id: 'my-tab', label: 'My Tab', icon: '🧭',
    render(pane, { messageId, message }) { pane.textContent = '…'; },
    isAvailable: ({ messageId }) => true,
});
```

Registered tabs appear in the sidebar and the card. The card also carries Megumin Suite's
card classes, so extensions that already add a tab to Megumin's card (NPC State Delta) show
up in Story Block's card unchanged; to appear in the sidebar they need `registerTab`.

## Development

Plain ES modules, no dependencies, Node.js 24:

```sh
npm run check   # syntax check of index.js and src/
npm test        # node:test suites
```

The module contract is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License

GPL-3.0. Story Block's engine is ported from Inventory Block by the same author.
