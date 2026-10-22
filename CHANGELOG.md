# Changelog

## 2.0.0-alpha.1 (in progress, `v2` branch)

Story Suite v2: a fresh start. State is JSON stored in each reply, every action is a command with a receipt, modules register through an SDK, screens are templates/layouts with widgets. Built so far: the state store, command bus, registry and turn pipeline, core scene and inventory (one currency), packs, events, layouts, mounts, widgets and the fishing example. Status: [docs/v2/STATUS.md](docs/v2/STATUS.md).

- **Radios and checkboxes work in SillyTavern** (live test: RPG Battle's race cards were white boxes showing `pack.ersveil-bluewatch/human`). SillyTavern's DOMPurify drops the `type` of a template's `<input>` and `<button>`, so radios and checkboxes drew as text boxes showing their value (Story Block's own inventory filters and loot picks too) and a `type="button"` in a form became a submit. compileTemplate now renames the attribute to `data-ss-type` before DOMPurify (`markControlTypes`, a linear scan) and the allow-list reads it back as `type`, held to the same allowed types as a written one (`file` and `image` still refused, anything unknown a text box, one type per control). New testkit export `stPurify`, a stand-in for SillyTavern's DOMPurify for screen tests. The other v2 repos' templates (Story Director's Days search, RPG Battle's trade field and wizard submit) need no change.
- **"Before you start" on Home** (first live test: no visible way to make a character before sending). While a module's `canGenerate` holds the story back, Home's first panel (host widget `story-block.ready-hint`) shows each such module's name and reason and a button that runs its `onBlocked` hook (RPG Battle's opens the character wizard). The button's words are the answer's optional `action` (flattened, at most 40 characters), else "Get started"; `action: false`, or no `onBlocked` hook, means no button. Nothing shows with Story Block alone or once the module is ready. New on the turn: `blockers()` (every canGenerate asked, nothing logged) and `unblock(moduleId, reason)`. The bar's "held back" notice now goes as soon as that module no longer holds the story back (not only at the next reply).
- **`sdk.dialog.current()`** (and the widget api's `dialog.current()`): the open dialog's handle, so a module with several ways into one wizard never opens it twice.
- **Settings screen, after the first live test.** The folds keep their size (a closed fold no longer turns into a thin bar when another opens) and the whole screen scrolls, on a phone too; Esc closes it and the focus stays in it. One centred column: Story Suite, Packs, Features, one fold per module, Versions. Inside a module, its Features, then a sub-fold per group of settings (a field's `group`, else its "Calendar: …" label prefix, else General). Lists are one line per entry (`[January] [31] ×`, Add at the end). Labels left and controls right on wide screens, stacked on phones.
- **Prompt size** in the Story Suite fold: what Story Suite adds to the next reply's prompt (instructions and this reply's part, per module and in all) against the tail budget, with SillyTavern's tokenizer when there is one, else about four characters a token. Read-only.
- **Small contexts keep the conversation.** SillyTavern fits extension prompts first, so at its default 4,095-token context most requests reached the model with no chat history. Story Suite now holds its instructions and notes together to a share of the context (**Share of the context**, 40 % by default, less the reply's length): the notes are cut to fit, optional lines first; the instructions are never cut and stay the same every reply. When they alone are too big, you are told once per chat and in the prompt size, which also shows the context size and the share.
- **A late save no longer undoes a newer one.** A save given up after 20 s can still reach the server and be written after the retry. After such a timeout, later saves carry a rising number in the chat's metadata and the file is read back a few times over five minutes; an older file is saved again. Normal saves read nothing back.
- **Packs are easy to find:** the Packs fold is second, shown with no pack installed, and Home offers **Import a pack** while none is.
- **Lists as text.** A list of names and numbers (a calendar's months) can be typed in a box, one entry per line, parts split by ":" (`Frostmoon: 30`), any number of lines up to 100: **Edit as text** / **Edit as rows**, and a schema list field's `form: 'lines'` starts there. The text is read on leaving the box; a line that does not read (0, negative or no days, a missing part) is named under it and the list stays as it was until every line reads.
- **Re-read keeps one budget with the clicks after a reply** (final breaker cell, a2-3). A Re-read of a reply after a story-vouched click (a quest Finish) paid the reply's coin lines and the click in full. A click now keeps its payout as its own key under the reply (`storyClicks`, add-only), and the re-read lines are paid only what the clicks left.
- **Fixes from the beta fuzz and matrix cells.** A reply cut off mid-reasoning (an open `<think>` with no close) applies nothing drafted inside it; a block before it is kept. Hiding a block leaves reasoning that sat inside it in the message (it was written back as spaces), and a `<Changes>` mentioned in the middle of a story line no longer hides the story after it. A copy of the hidden comment's marker in the model's own text is defanged when the reply is read, so Re-read of an unchanged reply gives what was applied. Turning a feature off never takes away what it made: Re-read runs again each line that made a change before (a new line of that feature is still not used), a preview can't be committed once its feature is off (`FEATURE_OFF`, or `STALE` after any feature flipped), and Home's "Before you start" button and a held-back generation skip an `onBlocked` hook whose feature is off. A feature that owns a whole module context now says it changes the fixed prompt when only its parts have static text. `+ coin` refuses every dash or minus sign (‐ ‑ ‒ ⁻ ₋ ﹣ －) and amounts with fractions, superscripts, other digits or a leading decimal point. When the after-reply extractor's call fails, the reply's "No change lines" note shows again.
- **Features in one place.** The Features fold has a sub-fold per module, A to Z, each saying "N of M on", and a **Find a feature** box that filters by name and description across modules (kept while the folds redraw). The modules' folds no longer repeat the switches: one line, *Features: N of M on — change*, opens the Features fold at that module; a module with features and no settings has no fold of its own.

## 0.9.31

- **Recover the saved reply even when earlier replies have acquired IDs.** A journal beginning at reply #6 could stay disconnected because an unrecorded reply #4 was mistaken for its boundary. Automatic recovery now targets the saved position and includes earlier replies that have no structured journal effects. Reopening resumes queued Take on choices without another generation or reconnect click.
- Preserve original snapshots, receipts and nodes when adding these earlier identities; discarded-variant battle proof stays inactive. Unverified earlier evidence, missing archived parents and ambiguous interior changes remain blocked.

## 0.9.30

- **Regenerate recovery runs automatically.** Reconnect an eligible lost root when opening the chat, before generation or while saving a reply. The repair also works after more replies were sent: verify the saved header, retain old variants and resume the latest reply's bookkeeping so injected Take on choices become accepted quests.
- Clear the finished generation session before recovery so a blocked save cannot prevent its own repair. Failed or uncertain automatic reconnection stops until reload; missing archived parents, moved roots and known dependent branches remain blocked.
- With RPG Battle **0.5.51**, an eligible blocked battle reconnects and saves its stored result without a button or combat replay.

## 0.9.29

- **Regenerate keeps its journal link.** Replacing the only tracked reply in an older chat could leave the new reply unrecognized, blocking battle evidence with `No retained reply matches the saved quest history`. Record replacement ownership before SillyTavern removes the old reply, and recognize saved swipe variants. The new branch keeps proven parents, excluding the discarded reply's defeats, payouts and XP.
- **Archived state stays available while regenerating.** Inventory and kept Party state can be read from proven archived parents during generation and carried onto the new reply when omitted. Prompt previews do not advance the saved journal.
- **Targeted recovery for an already blocked battle.** With RPG Battle **0.5.50**, an explicit reconnect action can repair a lost sole-root link at the same reply position. It verifies the save, retains old variants and lets the existing battle resume. Missing archived ancestry and ambiguous edits remain blocked; no journal reset or reward subtraction is attempted.

## 0.9.28

- **Chat checkpoints work over plain HTTP.** Some LAN browser sessions do not expose `crypto.randomUUID`, which prevented journal reads and could hide Director's Quests tab. Message and journal IDs now use a compatible UUID generator with `getRandomValues` when needed. Existing IDs, quest records and checkpoints are preserved; no chat reset or HTTPS change is required.

## 0.9.27

- **Shared chat checkpoints.** Inventory, Party/XP and structured quest evidence share a branch-aware journal in SillyTavern's existing chat JSONL metadata. Hidden replies and removed old prefixes retain proven history; tail rollback restores the earlier branch. Unchanged state bodies are deduplicated. Keep chat metadata when exporting or archiving.
- **One verified quest reward save.** Transactions can include secondary extra namespaces and verify the journal header alongside the message. Rejected saves restore both only if untouched; uncertain outcomes require recovery. Kept Party state carries into later replies, and reply callbacks run sequentially in priority order.
- Interior edits or removals with dependent replies retained require recovery. Restore that branch or rewind its suffix; this does not reconstruct arbitrary edited history.

## 0.9.26

- **Coordinated quest saves.** Extensions can validate and save Inventory, quest completion and receipt together, then read the saved chat back before reporting success. Rejected saves restore an untouched candidate; ambiguous saves require recovery. Retrying a confirmed transaction does not write it again.
- **Evidence belongs to its reply and swipe.** Stable message identities and synchronized swipe extras keep quest receipts and battle records with the variant that earned them. A new narration swipe drops copied transactions while preserving the original variant and unrelated extras.
- Provides the persistence API used by Story Director **0.9.43** and RPG Battle **0.5.48**.

## 0.9.25

- **Change lines inside the Inventory no longer wipe it.** When the model wrote its changes inside `<Inventory>` itself instead of `<Inventory_Changes>`, e.g. `+ Even Trophy | 2` / `- Minor Healing Draught | 1`, Story Block took those lines as the whole Inventory. Every other row, the Coin Pouch included, vanished from that reply, and RPG Battle's Trade showed *Purse: 0 copper*. Now a list block whose body has any `+`, `~` or `=` line is read as changes to the state before the reply, whether the block is changes-only or rewritten whole. The rows it doesn't mention stay, a plain row beside them reads as `~`, and a list of `- ` bullets alone is still a list. A change naming no row is reported as before. The change rules also say not to write these lines inside the block itself, about 13 tokens in the fixed part.

## 0.9.24

- **The "Changed this turn" row stays one line until you open it.** Since 0.9.22 the Inventory's finds sat in that row as chips, so before you opened it they already filled the top of the list, and on a narrow sidebar they broke apart ("Leav e", "Cellar Rat Tail ×6" over two lines). Folded, the row now reads *Changed this turn · 8   5 found*; open it and the chips are there, with Leave, above the list of changes. A chip never breaks a word: a long name ends in "…" (the full name on hover), Leave stays one word, and chips wrap as whole chips.

## 0.9.23

- **Tidier code, no change in behaviour.** Small helpers written out more than once now live in one place: the one-line, comparison-key and word-count text helpers in `src/text.js`, and making an element and tidying a tab list in `src/ui/dom.js` (the body editor, the prompt preview, the Story Suite window and the settings now make their elements with it).

## 0.9.22

- **Shorter rules, every reply.** The five lines about the envelope, keeping blocks out of the story and escaping `-->` are now three, saying the same: the always-sent rules go from about 472 to 412 tokens (with Inventory, World State and Dice on).
- **Faster in long chats.** Reading a block out of a reply is now done once per reply text and remembered: an edit, a swipe or a deleted message is a different text, so it is never answered from an old read. In a test chat of 800 messages, 20 refreshes of four blocks took 48 ms instead of 415 ms.
- **A cheaper token estimate.** Story Suite's token figures came from building Story Block's section once for every block (to see what each one adds). Now it is built once and each block's share is read from its own sections' lengths, rules it alone needs included: about 2.5 times faster, within a few tokens of the old figures.
- **One row for this turn's changes.** *Found this turn* chips (with **Leave**) now sit in the *Changed this turn* row, in place of its preview, instead of a second row under it.

## 0.9.21

- **Cache-friendly prompt.** Story Block's section held the rules and every block's current state in one piece, early in the prompt. Since a state changes in most replies, a provider's prompt cache (which keeps the longest identical start of a prompt) ended there on almost every reply, and the whole chat history after it was paid for again. Now the section comes in two parts:
  - **the instructions** (rules, each block's prompt and format, the envelope to write): the same text reply after reply while your blocks stay the same, sent early;
  - **this reply's part** (current states, kept blocks' copies, dice rolls, the purse line, a block asked for only now and then, a block left out this reply): sent last, at depth 0.

  The Dice prompt's `{{rolls}}` now points at the rolls in the tail, and on a reply that tells a fight the Dice block is told to stay out (*Leave <Dice> out of this reply*) instead of disappearing from the instructions. A block asked for only now and then (*when: every* or *keyword*) comes whole in the tail, with its skeleton. The two parts are registered under `story_suite_static_story_block` and `story_suite_tail_1_story_block`; the old `story_block` key is cleared. **What's sent** shows both parts. A preset that uses the old placeholder still works.
- **One layout for Story Suite.** docs/STORY_SUITE.md (*Prompt cache*) describes the convention the other three extensions follow: instructions early and byte-identical, each extension's per-reply text at depth 0 under `story_suite_tail_N_<ext>`, cleared once used.

## 0.9.20

- **The tab row is always one line.** With every extension on, the sidebar's tabs wrapped onto two rows and cut their labels. Now:
  - while the labels fit, each tab shows its icon over a short label;
  - when they wouldn't (a docked sidebar with seven tabs), the row shows icons only, badges kept, and a tab's name appears on hover, keyboard focus or a long press;
  - labels come back as soon as there is room, and the row re-checks when the sidebar is resized, docked or undocked;
  - if even the icons don't fit, the row scrolls sideways instead of wrapping.

  The phone's sheet keeps its sideways row of pills. The pane keeps its full width.
- **Each extension's tabs sit together.** Story Block's own come first, then each extension's, with a thin divider between them, so one switched off leaves no gap among the others. Extensions may pass `group` when they register a tab; the suite's own are recognised without it.
- **No two tabs look alike.** RPG Battle's Party and NPC State Delta's Present NPCs both used 👥. A tab whose icon is already taken (or that has none) now shows two letters of its label (**PN**). docs/STORY_SUITE.md asks each extension for an icon of its own.
- **Esc clears a search box before it closes the panel.** In the drawer or sheet, Esc in a text field with text in it (Story Director's Journal search) used to close the whole panel. It now leaves the key to the field; the next Esc, once the field is empty, closes the panel.

## 0.9.19

Cleanup. Nothing you see changes, except a token estimate that is now right.

- **One save per reply.** When a reply came in, the chat was saved up to three times: after hiding the blocks' transport, after stamping the dice, and after carrying the state into the reply. It is now saved once, after all three.
- **The Inventory's token estimate counts change lines.** Since 0.9.16 the model writes only what changed, but *Tokens per reply* still counted the whole list as its output (about 700 tokens for a long Inventory, against about 25 now).
- **Dead styles removed.** The fields and scene displays' old change marks (`story-block-field-change`, `story-block-fields-removed`, `story-block-scene-change`, `story-block-scene-delta`, `story-block-scene-removed`) were no longer drawn by any code. About 70 lines of CSS are gone.
- **One token counter.** *What's sent* (0.9.18) had its own copy of the four-characters-a-token count; it now uses the one Tokens per reply uses.

## 0.9.18

- **See exactly what is sent.** Story Block's settings end with a **What's sent** fold. It shows the context the next reply gets: the rules, each block's section with its current state, and the layout to write back. It shows the size and has a **Copy** button, and it is read when you open it. In Story Suite's overlay, a new **What's sent** section does the same for every extension that offers it, through a new optional `api.manage.preview()` (documented in docs/STORY_SUITE.md). Story Block offers its own; the others can add theirs.
- **Leave a find behind.** When the latest reply adds something to a list (a new row, or more of one), the Inventory shows it above the tree as a chip: *Found this turn: Brood-Mother Skull ×1 [Leave]*. It is kept unless you press **Leave**, which takes that gain back out of that reply's copy, so a swipe or a deleted reply still rolls it back. Nothing is shown when the reply found nothing.
- **Rarity colours.** A rarity word in a note tints the item's name: *common* grey, *uncommon* green, *rare* blue, *epic* purple, *legendary* gold. The classes (`story-block-rarity is-rare`…) and colours (`--sb-rarity-rare`…) are there for other extensions to use too.
- **A short list opens up.** An Inventory of 20 rows or fewer now opens at *All* with every item under its section's title, with quantity and note on the row. Before, a narrow sidebar showed only a row per section, and the items sat one tap away.
- **Tab labels fit.** A built-in block saved before short labels existed now shows its short label in the sidebar (*Items*, not *Invento…*). Tabs other extensions add may pass their own short label, and a long one without it shows its first word. **Settings → Display → Hide empty tabs** leaves out blocks with nothing in them yet.
- **The Blocks list in settings is one line per block again.** The tag, kind, format and cost no longer wrap. A long tag is cut with an ellipsis, and shown whole on hover.

## 0.9.17

- **Every reply holds the whole state.** In 0.9.16 a reply that changed nothing in the Inventory carried no copy, so after a quiet stretch the state lived only in an older reply, and deleting that reply lost it. The same happened when the model simply left a block out. Now Story Block writes each of your stateful blocks into every new reply, as they stood before it, whenever the reply does not write them itself. Every reply stands alone: hide or delete older messages and nothing is lost. The model writes nothing more, and old copies are kept out of what it is sent, so this costs no tokens. Blocks another extension keeps (RPG Battle's Party) are left to that extension. A block the model wrote but cut off or garbled is still warned about and left for you to fix.

## 0.9.16

- **The Inventory is written as changes only.** The model rewrote the whole Inventory every reply, and rows it never meant to touch drifted (`heal 20` became *weak restorative fluid*). Now it writes only what changed, in a hidden `<Inventory_Changes>`, with Story Director's signs:
  - `+ Brood-Mother Skull | 1 | uncommon material` for something gained;
  - `- Minor Healing Draught | 1` for something lost or used;
  - `~ Coin Pouch | 1 | 5 Silver` for a row that now reads differently.

  Story Block applies them to the Inventory as it stood before the reply and writes the whole new `<Inventory>` into that reply. Every reader still sees the full block, a swipe or a deleted reply still goes back to the one before, and untouched rows stay exactly as they were. A reply that changes nothing carries no copy. A reply that writes the full block (a big reorganisation) keeps it. A change naming no row is reported, not guessed. The model also writes fewer tokens per reply.
- **Your choice per block.** **Edit → Rows → The model writes** is *Only the changes* or *The whole list*. Your Inventory switches to changes only unless you set it otherwise. Other list blocks keep the whole list.
- **The copy-exactly line moved.** The 0.9.15 line ("copy every row this reply does not change … word for word") is now part of the list format's own rules, so it reaches every block rewritten whole. An Inventory instruction left as 0.9.15 wrote it goes back to the built-in one.

## 0.9.15

- **Unchanged Inventory rows stay exactly as they were.** The model writes the Inventory again every reply. It reworded notes it had no reason to touch, and over many replies they drifted: `heal 20` became *Weak restorative fluid (heals minor wounds)*, and RPG Battle could no longer use the potion. The Inventory's instruction now says to copy every row the reply does not change word for word, to keep the note when only the quantity changes, and never to reword a note's numbers and tags (`heal 20`, `uncommon · ATK +4`). That is about 55 tokens more per reply.
- **Instructions you never edited stay up to date.** Each block's instruction is saved in your settings, so a new built-in wording never reached an existing setup. If your Inventory instruction is still the built-in one, it now updates to the new wording by itself. If you edited it, your version is kept; add the line yourself if you want it.

## 0.9.14

- **"No human NPCs present" no longer breaks the World State card.** An aside under *NPCs Present* saying nobody is there, such as *(No NPCs present; wolves engaged)*, is skipped. Since one unreadable line sends the whole World State back to plain text, an aside with a word between "No" and who (*(No human NPCs present; EG1 swarm of granary rats in active hostility)*) turned the card into a wall of text. Now a word or two may stand in between (*No human NPCs*, *No other named characters*, *No hostile people*), and *persons* and *humans* count too. Other lines that are not part of the layout still send it back, as before.

## 0.9.13

- **Hidden replies still hold the state.** A reply hidden from the model (SillyTavern's hide, or a memory extension such as Summarybook hiding old messages to save context) was skipped when Story Block looked back for the newest Inventory, Party or World State. If the newest replies were hidden, it fell back on an older copy, or on none at all. Hiding now only changes what the model sees: a hidden reply's blocks are still read. A copy in your own message never counts, hidden or not.

## 0.9.12

- **The Inventory says what the purse holds in all.** Every row named for money (*Coin Pouch*, *Purse*, *Coins*…) with its coins in the quantity or the note is now added up, and the Inventory's part of the prompt ends with *Purse in all: 4 gold, 6 silver, 4 copper; nothing dearer can be paid for (the seller refuses, haggles or takes goods in trade).* A purse kept as "1 Gold, 35 Silver, 14 Copper" is hard to add up mid-scene, and without the sum a model let a tanner take six gold from a purse that held four and a half.
- **Settings → Money** picks the coins: coins with rates (copper=1, silver=10, gold=10 by default, or your own, such as bits=1, marks=12, crowns=20), one coin, or off.
- **With RPG Battle:** its currency is used instead, so the two never disagree. Only one purse line is sent: Story Block's while it keeps the items, RPG Battle's (0.5.26) otherwise.

## 0.9.11

- **No dice for a fight RPG Battle already settled.** The reply that tells the result of an RPG Battle fight used to get a fresh set of dice like any other reply. The model then rolled for the blows it was narrating ("Astra parries Brecht's tiller swing … fail") and could tell a different fight from the one you played. With RPG Battle 0.5.22, that one reply gets no dice block. The reply after it rolls as usual, and so does a swipe of anything else.

## 0.9.10

- **An "(empty)" line no longer breaks a list block.** A model sometimes keeps a section header for later and writes `(empty)`, `*(None)*` or `—` under it, as in `[Loot]` / `(empty)`. That line is not an `Item | Qty | Note` row, so the whole Inventory was rejected ("couldn't be read … Showing the last valid state") and the reply's changes were lost. Such a line is now read as "nothing here": the section shows empty and the rest of the block is read as usual. An item really called *Nothing* still counts when it has a quantity.

## 0.9.9

- **Narration written inside the hidden block is moved out.** A model sometimes put its narration inside the `<!-- STORY_BLOCKS_V1 … -->` envelope: after the last block, between two blocks, or before `<Blocks>`. Everything there is hidden, so the reply showed nothing, and another extension could take over the message. When a reply arrives, each run of finished prose found inside the envelope but outside every block is moved out next to it: before the envelope if it came before every block, after it otherwise. The blocks stay as they were. Only prose of eight words or more with a finished sentence counts. Scraps, lines shaped like block content (numbered choices, bullets, `**Label:**` fields, `|` rows) and other extensions' tag pairs stay hidden, and text inside a block's own body is left alone.
- **Hidden blocks stand apart from the story.** A reply arrived with an empty hidden block at the top (the optional Dice block left out, but its envelope written anyway), the story glued straight after it (`-->The silver coin…`), and the real envelope glued to the last line (`…going to be?"<!-- STORY_BLOCKS_V1`). SillyTavern shows that correctly, but another extension reading the raw reply could hide the story or show its own block. Now, on receive, an empty envelope is dropped and every closed envelope gets a blank line between it and story text on the same line. The model is also told to keep each envelope on its own lines and to leave out a first envelope that has nothing in it.

## 0.9.8

- **An empty cast written as an aside keeps the scene board.** A World State with `*(No NPCs present in direct engagement; wolves engaged)*` under NPCs Present was shown as raw text, because the board would not drop a line it could not place. A line under a heading that says nobody or nothing is there (`None`, `Nobody`, `No one`, `No NPCs …`, in brackets or not) now means that section is empty. Any other line the board cannot place still sends the text back to the plain display.

## 0.9.7

- **Blocks written as their own HTML comment are read.** A model wrote its Story Director lines as `<!-- Director … -->` after the envelope instead of a `<Director>` tag inside it, so nothing read them (no quest was captured). A comment named after a known block (`<!-- Director`, `<!-- World_State:`, any case, the name then a line break) now becomes that block and is folded into the reply's envelope like any bare block the model wrote. Other comments (unnamed, one-line, anyone else's) are left alone; an empty named one is dropped.

## 0.9.6

- **Each roll tied to its attempt.** `{{rolls}}` handed the dice as a list (`2, 13, 18, 16, 1, 6`), and a model read it as a pool: it skipped the 2 against DC 10 and took the 13 for a success. Now it reads `Roll 1 = 2 · Roll 2 = 13 · … (the first attempt takes Roll 1, the next Roll 2, and so on, whatever they say)`. It is the substitution that changed, so saved Dice instructions get it too. The card's "Rolled by Story Block" list is unchanged.
- **The card shows what the die said.** A roll that is not the die handed for its place (out of order or made up) now shows what the right die gives with the same modifier and DC, read by the rules alone (*The die said 2: 2 vs DC 10 → fail (the story told success)*), and its pill and colour are that outcome, not the model's verdict. The story is not rewritten.

## 0.9.5

- **The timeline in one place.** While another extension keeps the timeline (Story Director, on *Automatic*, or chosen under Source of truth), the World State is asked for without Unresolved Threads, Planted Seeds, Consequence Timers and Arc Phase: its layout, its instructions ("what is still unresolved", "drop threads once they resolve") and the current state shown to the model leave them out, so the model no longer keeps a second list of the hooks, clocks and arc Story Director tracks. Off-Screen stays (Story Director mirrors its agendas into it; NPC State Delta reads it), as does Scene Phase. The saved layout, the editor, the stored replies and the scene board are unchanged; alone, or with the timeline kept here, the prompt is the same as before. The Timeline row under Source of truth says so. Goes with Story Director 0.9.3.

## 0.9.4

- **Dice leave fights to RPG Battle.** Given fresh rolls, a model resolved a fight with them (*natural 20, the beast goes down*), so RPG Battle never offered it. While RPG Battle is announced and on, the Dice and Dice: Everyone blocks get one runtime line under their instructions: *Never roll a fight: when blows are about to land, stop there; RPG Battle runs it.* (about 20 tokens). The stored instructions are not changed; alone, or with RPG Battle off, the prompt is the same as before. Rolls for everything else (spotting an ambush, a climb, a lie) are unchanged.

## 0.9.3

- **One hidden section per reply.** A block the model wrote as a bare tag right next to its own hidden section (a `<Director>` after the envelope) was wrapped in a second section, and later writes (RPG Battle's Party block) went into that second one, so a reply could carry two `<!-- STORY_BLOCKS_V1 -->` envelopes. Envelopes with only whitespace between them now become one, their blocks in the same order; replies that already have two merge the next time Story Block tidies them (an edit, or a plugin writing its block). Envelopes with story text between them stay apart. Reading was never affected: every envelope in a reply was already read.

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
