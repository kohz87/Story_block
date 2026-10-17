# Changelog

## 0.9.2

- **One switch look:** the block list's on/off switches are the Story Suite's Enabled/Disabled pills, as in NPC State Delta, Story Director and RPG Battle (a plain checkbox in browsers without `:has()`).

## 0.9.1

Kept blocks without a tab, chatter on NPC State Delta's cards, new built-in blocks offered, tokens per reply, and one look for the suite's settings panels.

- **`registerBlock({ kept: true, …, tab: false })`** registers a kept block that is written, stamped, kept, prompted read-only and dropped when the model writes it, exactly as before, but gets no tab of its own: none in the sidebar or the card, no tab badge, nothing in the turn strip or the edge handle's count. For an extension that draws the block in its own tab (RPG Battle's Party block in its Battle tab). `tab` defaults to `true`, so nothing changes for existing kept blocks; anything other than `true` or `false` is refused. `getBlock`, `blockForGeneration`, `blockInText` and `setBlockText` work on it as on any kept block.
- **Re-registering may flip it:** registering the same id again with another `tab` adds or removes the tab on the next refresh, which the registration triggers.
- **`listBlocks()` reports `tab`** for every block: whether it gets a tab once enabled and written (the reader's *Show tab* switch, a kept block's `tab`; `false` for transport-only blocks, and for chatter while another extension shows it). apiVersion stays 1.
- **Chatter on NPC State Delta's cards.** While an enabled extension of the suite announces `shows: ['chatter']` (NPC State Delta 1.2.2, on its Present NPC cards), every block with the Chatter display has no tab in the sidebar or the card; it is still prompted, written, kept and readable through `getBlock`, and the reader's *Show tab* switch still applies. When it stops, is switched off or leaves, the tab is back.
- **Chatter voices from NPC State Delta.** While NPC State Delta is installed and on, a Chatter block's prompt section gets one more line, *Voice each NPC as their NPC State Delta card describes.* The stored instructions are not changed; alone, the prompt is the same as before.
- **Tokens per reply.** Story Suite's Overview gets a section listing what each extension adds to an ordinary reply, the prompt it injects and what it asks the model to write back, with a total and, per extension, a fold with its parts; one that does not report (or fails) says *not reported*. Story Block reports through `api.manage.tokens()`: its whole block section, kept blocks under their owners' names (*Party (kept by RPG Battle)*), the chatter line, and the shared rules and envelope, at about 4 characters a token. Recomputed when the overlay opens or redraws and after each reply, never polled.
- **The Overview folds.** *Installed* (*4 on*), *Source of truth* (*Automatic*, *2 chosen by hand*, *1 mixed*) and *Tokens per reply* (*~3,400 in · ~650 out*) each fold with a one-line summary; Installed starts open, the others closed, and which are open is remembered in this browser and kept across redraws.
- **One look for the four settings panels.** `src/suite.css`, identical in all four, is linked once per page (`<link id="story-suite-css">`, the first extension to load adds it). Story Block's panel uses its markup: the *Manage all in Story Suite* line, a quickbar with Rescan, the status line and the version, then Display, Source of truth and Blocks as folds, with settings as rows and switches as Enabled/Disabled pills. The Overview uses the same markup. Story Block's own fold styles are gone; the block editor inside Blocks is unchanged.
- **"New built-in blocks."** Templates added after a first install (NPC Inner Chatter) were never offered. The Blocks section now shows one line for each template not in the list: *Add* puts it in the list switched off, *Dismiss* hides it. Either way it is remembered (`dismissedTemplates`) and not offered again. A built-in the reader deleted is offered once the same way.

## 0.9.0

Story Suite: one place to manage Story Block, Story Director, NPC State Delta and RPG Battle together ([docs/STORY_SUITE.md](docs/STORY_SUITE.md), "One place to manage them all").

- **The Story Suite overlay.** With two or more of the suite announced (on or off), *Story Suite* in the Extensions menu, a gear in the sidebar's header and *Manage all in Story Suite* at the top of the settings panel open one full-screen dialog above SillyTavern and the sidebar (the whole screen on phones). Esc, the close button or a click outside close it, and focus goes back to what opened it. Alone, none of these appear and nothing else changes.
- **Overview:** every announced extension with its version, on or off, and its on/off switch where it shares one (`api.manage.setEnabled`). Then **one Source of truth table**, a row per area two or more can keep (scene, NPCs, calendar, timeline, stats, items, roll modifiers): *Automatic (who that is now)* or one owner. Picking an owner calls every extension's `setSource` so that one is *This extension* and the others *The other one*; *Automatic* sets them all back. Choices set by hand that no one owner describes show as *Mixed — set in each extension*. Under each row, who leads now under everyone's choices.
- **A tab per extension** that announces its `settings` panel, in suite order. The panel itself is moved into the tab, its SillyTavern drawer held open without its toggle, and put back exactly where it was (a hidden placeholder keeps its place) when the tab changes or the overlay closes, so every control keeps working. A panel not on the page says so.
- **Story Block's announcement** gains `settings: '#story_block_settings'` and, in its api, `manage` (its five areas, `sources()`, `setSource(area, choice)`, the same choice as its own select; no on/off switch, Story Block is always on) and `openSuite(tabId = 'overview')`, which other extensions call to open the overlay on their tab.

## 0.8.1

Many tabs and a tidier settings panel.

- **Every tab in reach:** the sidebar's tab rail (docked and drawer) wraps into rows instead of running off its right edge, scrolling down on its own past three rows. On phones the bottom sheet keeps its sideways row of pills; a mouse wheel scrolls it, the ends fade while tabs hide past them, and the picked tab always scrolls into sight (the first and last all the way to their end).
- **Settings in sections:** Display, Source of truth and Blocks fold, each one line with a summary until opened ("Sidebar", "Automatic", "5 of 8 on"); Blocks starts open. Which are open is remembered in this browser. The version moved under Rescan.

## 0.8.0

Story Suite: Story Block, Story Director, NPC State Delta and RPG Battle find each other and agree on who tracks what ([docs/STORY_SUITE.md](docs/STORY_SUITE.md)).

- **Announces itself** to the shared registry (`globalThis.StorySuite`, `src/suite.js`, the same file in all four) as `story-block`, with the areas its enabled blocks offer: `scene` and `timeline` while World State is on, `items` with Inventory, `stats` with Character Sheet, `rolls` with Dice. It announces again when a block is switched on or off, added or removed, and on a chat change, and shares `listBlocks` and `getBlock`.
- **"RPG Battle owns stats."** While another extension owns stats, the Character Sheet's tab says so, with that extension's name. The sheet is still drawn, prompted and editable; the reader decides whether to keep it.
- **Source of truth** in the settings: for scene, timeline, items, stats and rolls, *Automatic* (the specialist for each), *This extension* or *The other one*, with who has each now. Redrawn when another extension arrives or leaves. Alone, every choice works like Automatic.
- **Rolls.** The Dice block still takes a kept block's dice modifier (RPG Battle's Checks line), unless the reader picks *This extension* for rolls while another extension offers them; then the Dice block keeps its own −3 to +3 modifier.
- Alone, nothing changes: no notice, the same prompt.

## 0.7.0

Kept blocks: blocks another extension keeps and the model only reads.

- **`registerBlock({ kept: true, owner, … })`.** An extension (RPG Battle's Character and Party sheets) registers a block with its own tag, name, icon, format (`fields` or `text`), display (`fields` or `plain`) and fields, plus an optional one-line `promptNote` and `diceModifier`. The spec is checked like a block in the editor, and an error says what is wrong. `listBlocks()` reports these blocks as `kind: 'kept'` with their `owner`.
- **Read every reply, never written.** The newest copy the extension wrote is shown in each reply's prompt under `### Character — <Character> (kept by RPG Battle: read it, never write it)` with its note. It is left out of the envelope the model is asked to write, and a reply without it is not warned about.
- **Only the extension writes it.** `setBlockText` stores the extension's plain text in the message's hidden envelope, marked as the extension's copy, after checking that the block's format reads it (`HP: 58/62 | MP: 21/30` lines round-trip). If the model writes the tag anyway, it is taken out of the reply when the reply arrives and never becomes the current state. Copies added by hand in a message edit are taken out too. `getBlock` and `blockForGeneration` return kept blocks.
- **Dice modifier.** While the Dice block is prompted and a kept block with a `diceModifier` has been written, that text is added as one more line of the Dice instructions (for example, take the modifier from the sheet's Checks line). The stored Dice prompt is unchanged.
- **A tab of its own:** meters and fields or plain text, with a small *kept by RPG Battle* note and no Edit button. It appears once the extension has written the block.
- Registering a plugin block again under its own id now replaces it instead of failing.

## 0.6.3

Tidier editors.

- **Block editor in sections.** Name, tag, icon and tab label on top (with Enabled and Show a tab), then folding sections: *What the model writes* (instructions, format, layout / fields / rows; open), *How it is shown* (display) and *When and how often* (kind with a one-line explanation, timing, optional, repeating, dice). Shorter hints, a wrapped layout box, and Save / Cancel that stay in reach at the bottom.
- **Editing a block's content.** Lines wrap instead of running off the side; the format rules (the model's instruction) are folded under *How this block is written* instead of filling the top. World State blocks get **Time**, **Location** and **Weather** fields that write straight into the header line.

## 0.6.2

- **New block from an example.** *Add block → From an example…*: paste the block the way the model should write it (`<Skill_Mastery> … </Skill_Mastery>`) and the form fills itself in: tag and name from the tag, the lines inside as the layout, and a bracketed paragraph of rules as the instructions. It opens as a Stateful, Free text, Plain block for you to adjust and save.

## 0.6.1

- **Off-screen hidden until revealed.** The World State board's Off-Screen section now shows only how many entries there are and a **Reveal** button; like secrets, the entries are not in the page until revealed, and the reveal holds across replies until you hide it or reload. The block text is untouched, so NPC State Delta (and Story Director's Off-Screen mirror) work as before. Turn it off under Display → *Hide off-screen until revealed*.

## 0.6.0

A plugin API for other extensions, and World State's World and Hooks sections.

- **Plugin API** on `globalThis.StoryBlock` (`apiVersion: 1`): read any block's newest valid copy (or the one before a message, or the one the next generation will be shown), read a block from one message's text, replace a block in a message, register a hidden transport-only block, and listen for replies and refreshes. Plugin tabs can now say when their pane is unchanged (`key`) and show a count (`badge`). Story Director builds on this.
- **World State board:** a `World` (or `World events`) section is its own list, `Hooks` reads as threads, and list items written `Key — what it is | then: …` show the key as their heading.
## 0.5.6

A tidier settings panel, and a guide to the markup each display reads.

- **Settings, redesigned.** Each block is a two-line card: its name, then one quiet line with the tag, kind, format and token cost (no more pills of different sizes). On the right: an on/off switch, Edit, and ⋯, which folds out Show tab, Up, Down, Duplicate, Reset and Delete as labelled buttons, instead of eight controls on every row. A block without a tab says "no tab".
- **Display options grouped** under a Display heading: the "Show blocks in" choice, the strip and compatibility switches (marked "card only"), and Rescan with a line saying what it does. The version sits in the heading.
- **Fixed: on phone-width settings drawers the block names were squeezed** by a leftover rule that made the row's buttons take the full width.
- **README: "Writing a layout each display can draw"** — the markdown the scene board understands (headings, person fields, Mood, Secret, off-screen, threads, phases, `|` facts and labels), and the formats of the fields, tree, choices, whisper-thread and dice displays. A test keeps the scene example parsing.
## 0.5.5

A calmer World State board for busy scenes.

- **Many-part lines become labelled rows.** Off-screen entries, threads and person fields that pack several facts with pipes (`District Bailiff Court | then: argues with magistrates | on: Haywane 12, 05:45 pm`) were one run-on paragraph. Each part is now its own short row with a small label (now / then / on, visible / hidden), and a name written as `Geva — now:` shows as just the name.
- **Off-screen entries are separated:** the name on its own line, its facts under it, a thin line between entries.
- **Threads with long or many-part items are listed as rows** instead of pills stretched over several lines; short ones stay pills.
- **Map coordinates in the location (`[59.0, 110.0]`) are dimmed.**
- Display only: the World State text, what the model is sent and what the change marks compare are unchanged.
## 0.5.4

- **Dice only when there's a roll.** Optional blocks (Dice, Dice: Everyone, NPC Inner Chatter) no longer sit in the sidebar as empty tabs; a block's tab appears when the latest reply has one and goes away when it doesn't. Other blocks still show from the first message.
- **No keyboard from Choices on phones and tablets.** Tapping a choice fills the message box without focusing it, so the keyboard no longer pops up and shoves the page up; tap the box when you want to edit. Sending a choice never focuses the box. On a mouse screen a click still leaves the caret at the end, ready to extend.
## 0.5.3

Fixed: the sidebar knocked SillyTavern's page out of place on phones and tablets.

- **Phones: the message box no longer gets stranded mid-screen.** The closed bottom sheet waited just below the screen, and that made SillyTavern's whole page scrollable (about 1.6× the screen height). Opening the sheet, or the keyboard opening for the message box, then scrolled the page and left the send form and chat shifted up with an empty band below.
- **Tablets: the drawer no longer snaps shut on the first tap.** The closed drawer made the page scroll sideways when it opened; the chat column appeared to move, the sidebar re-measured, decided it should dock and closed itself, so it only stayed open on the next tap.
- The sidebar, its scrim and edge handle now sit in one screen-sized layer that clips them, so the page itself can never scroll, and focusing the panel never scrolls anything. Checked in a live SillyTavern at phone, tablet and desktop sizes; a test guards the rule.
## 0.5.2

The phone sheet is always easy to close.

- **Full height steps back to half.** Dragging a full-height sheet down now returns it to half height instead of needing an exact drag to close it; a long drag still closes it.
- **The header drags too,** not just the thin bar above it, so the sheet can be grabbed where a finger naturally lands. Its buttons still tap.
- **Full height leaves a strip of chat above the sheet** (12% of the screen, or more below a notch or status bar). Tapping it closes the sheet, and the header with its × never ends up under the browser's or phone's own bars.
## 0.5.1

Calmer displays, and tablets get the drawer.

- **Tablets get the drawer again.** Any touch screen up to 800 px wide was treated as a phone and got the bottom sheet; now only screens 640 px wide or narrower do.
- **One "Changed this turn" section.** World State, Character Sheet and the other fields displays no longer put a before → after note under every changed field or a coloured border on every changed chip. Changed things carry a small dot, and all the changes are worded once in a folded "Changed this turn · N" section at the top (Inventory's change strip uses the same wording).
- **World State reads as one board:** time, place and weather are plain rows in one box instead of separate bordered chips of different lengths; every person card has the same border, with "you" as a tag; the "Left the scene" and "No longer written" lines moved into the changes section.
- **Short labels on the phone sheet's tabs** too, so none is cut off ("Dice: Ever…").
- **The open drawer and sheet sit above other extensions' floating buttons**, which covered the Edit button. SillyTavern's own popups still open above it.

## 0.5.0

NPC Inner Chatter, and dice written one tag per roll.

- **NPC Inner Chatter template** (off by default, tag `NPC_Inner_Chatter`): what the NPCs in the scene think and say where {{user}} can't hear. Two or more NPCs are drawn as a whisper thread, one colour per speaker that stays the same from reply to reply; one NPC as a pull quote. Its instructions ask for each voice to come from the NPC's established personality, speech, history and relationships (character card, lorebook, NPC dossiers) and limit them to what they could know. NPC State Delta reads this tag as story evidence.
- **Choices grounded in the story:** the template now asks for options that fit {{user}}'s persona and relationships, {{char}}'s personality and the setting's rules, with at least one using something already in play, and none repeating the last reply's.
- **Fixed: on phones and tablets the edge handle and the bottom sheet were off screen.** SillyTavern gives the page root a transform and zero height, which made every fixed position measure from a zero-height box: the handle sat behind the top bar and the sheet opened above the screen. The sidebar, sheet, drawer, scrim and handle are now placed with viewport units only (checked in a live SillyTavern 1.19 at phone, tablet and desktop sizes), and a test guards the rule.
- **Fixed: no sidebar until a block had content.** The sidebar (and its handle) now lists every enabled block from the first message, each with an empty state that says it fills in as the story goes.
- **Tab labels:** blocks have an optional short label for the sidebar tab (the templates use Items, World, Choices, Dice, Chatter, Sheet, Notes), instead of a cut-off first word.
- **Repeating blocks:** a block can be marked Repeating, so a reply may write it as several tags (one `<Dice>` per roll, as models often do). The copies are read as one block, folded into one tag when the reply arrives, and checked as one — previously only the last tag counted, so earlier rolls were lost. Both Dice templates repeat.

## 0.4.0

Dice.

- **Dice templates** (off by default): **Dice** rolls for {{user}}'s attempts, **Dice: Everyone** for anyone's. Story Block rolls the dice before the reply is written (a fair die from the browser's crypto source, rolled again on every swipe and regenerate) and hands the numbers to the model; the model only decides whether an attempt needs a roll and how hard it is, and writes the roll line before the scene.
- **Dice cards:** the die spins to its number the first time a reply's rolls are shown, then each card shows the total against the DC, the outcome (success, success at a cost, fail, critical success or fail) and any note.
- **Honesty check:** the rolls handed over are recorded on the reply itself, so every swipe keeps its own. The card says "Rolled by Story Block" when the model used them in order and the sums add up, and names the problem when it didn't (an invented number, a roll out of order, a sum that doesn't add up).
- **Roll results in the "This turn" strip** when it is on.
- **New block options**, usable by any block: kind **First** (written before the story, in its own hidden envelope), **Optional** (written only when something calls for it; no warning when left out) and **Dice** (roll 0–10 dice of d4–d100 before each reply into `{{rolls}}`).

## 0.3.0

World State and Choices.

- **World State template** (off by default): a kept block in Megumin Suite's World State layout, label for label — time, place and weather; {{user}}'s outfit, position and condition; everyone present with outfit, position, mood, agenda and secret; off-screen activity; unresolved threads, planted seeds, consequence timers, arc and scene phase. Chats that already carry Megumin World States pick up their last one.
- **Scene board display:** chips for time, place and weather, a card per person (yours marked), secrets hidden until you reveal them, threads and timers, and arc and scene phase as a small rail. Its badge and the "This turn" strip report who joined or left and which moods, positions or outfits changed — never secrets. Anything the board can't read falls back to plain text.
- **Choices template** (off by default, tag `CYOA`): four suggested actions each reply, as buttons. A click adds the choice to what you have typed in the message box; Shift-click (or the row's send button on touch screens) sends it. A choice starting with "/" is never sent automatically.
- **Layouts for free-text blocks:** a text block can carry a layout — the skeleton the model fills in — editable under Layout in the block editor. `{{user}}` and `{{char}}` are filled in there as in prompts.
- **NPC State Delta:** reads story dates from Story Block's World State. Its scan cleaner does not yet see the World State text inside Story Block's hidden envelope (a fix on NPC State Delta's side is needed); a test tracks it.

## 0.2.0

The blocks move into a sidebar.

- **Sidebar.** On wide screens it docks in the free space beside the chat and stays open (unpin it to use it as a drawer). On tablets and narrower desktops it slides in from the right over a dimmed chat; on phones it is a bottom sheet that opens at about two-thirds height and drags up to full height. Esc, the close button, a tap outside or a swipe closes it, and an edge handle with this turn's change count opens it again.
- **Change badges.** Each block's tab shows how many things the latest reply changed in it.
- **"This turn" strip** (off by default; Settings → "This turn" strip): one line under the latest reply listing what it changed — losses and gains coloured, problems flagged — and tapping it opens the sidebar on that block.
- **Display setting.** "Show blocks in" switches between the sidebar and v0.1's card under the latest reply. The card keeps the Megumin-compatible markup, so extensions that mount into Megumin Suite's card (NPC State Delta) still work there; in the sidebar they need Story Block's tab API.

## 0.1.0

First release: Inventory Block's engine generalized to any number of user-defined blocks.

- **Block definitions.** Every block — template or custom — has a name, icon, tag, kind
  (stateful or per-turn), format (rows, fields, free text), display (tree list, meters &
  fields, plain), prompt, and a "when" rule (every reply, every N replies, keyword).
- **Templates:** Inventory (enabled), Character Sheet and Scene Notes (off by default).
- **One hidden `<Blocks>` envelope per reply**, with bare `<Blocks>` and bare block tags
  accepted and hidden on receive. Cut-off envelopes are hidden and rejoined by Continue.
- **Stateful blocks** inject their newest valid state into every reply's prompt; invalid,
  missing or cut-off copies never replace it, and the reader is warned.
- **Prompt lifecycle from Inventory Block v0.6.7:** placeholder-based detection of the
  reply's own prompt (in-chat for chat completion, so presets without a Main Prompt work),
  fallback, watchdog, and a status line in settings. Other extensions' background prompts
  are left untouched.
- **Card:** one tabbed card under the latest reply, change strip for rows and fields, Edit
  per block, a public tab API (`globalThis.StoryBlock.registerTab`) and Megumin-compatible
  markup for extensions that already mount into Megumin Suite's card.
- **Settings editor:** enable, show, reorder, edit, duplicate, delete, reset templates, add
  blocks, import/export JSON, token estimate per block.
- **Compatibility:** reads Inventory Block `INVENTORY_BLOCK_V05` snapshots and Megumin
  Suite `<Blocks>` already in a chat.
