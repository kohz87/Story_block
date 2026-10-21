# Story Suite: working alone and together

Story Block, Story Director, NPC State Delta and RPG Battle each work on their own. When several
are installed, they find each other through a small shared registry (`globalThis.StorySuite`,
created by whichever loads first; `src/suite.js`, identical in all four) and agree on **who is the
source of truth** for each area, so the model is not told the same thing twice and two
extensions never contradict each other.

## Areas and owners

The specialist for an area wins; the next one listed owns it when the first is not installed.

| Area | What it covers | Owner, in order |
|---|---|---|
| `scene` | Who is in the scene now: presence, outfit, mood, position, place | Story Block (World State) → NPC State Delta |
| `npc` | Who an NPC is: identity, personality, voice, relationships, goals | NPC State Delta → Story Director |
| `calendar` | The calendar and story time | Story Director → NPC State Delta |
| `timeline` | Off-screen agendas, quests, clocks, arcs | Story Director → Story Block (World State's lists) |
| `stats` | HP, MP, stats, skills, fights | RPG Battle → Story Block (Character Sheet) → NPC State Delta (custom fields) |
| `items` | What the player carries | Story Block (Inventory) → RPG Battle |
| `rolls` | Roll modifiers for checks | RPG Battle (Checks) → Story Block (Dice) |

An extension offers an area only while it actually provides it (for example Story Block offers
`stats` only while its Character Sheet block is on, and `rolls` only while a Dice block is on).

## What each does when it is not the owner

| Extension | Defers when another owns… |
|---|---|
| Story Block | `stats`: its Character Sheet is marked "RPG Battle owns stats" (the reader decides whether to keep it). `rolls`: the Dice block takes RPG Battle's modifier (since 0.7). |
| Story Director | `npc`: agenda lines describe only an NPC's plan and timing, never who they are. Shares its calendar (`StoryDirector.calendar()`), story time (`timeAt`) and encounters (`encountersAt`). |
| NPC State Delta | `scene`: present-NPC cards leave out the live mood and current outfit that World State already gives. `calendar`: uses Story Director's months and era instead of its own. `stats`: warns when its custom fields name game stats (Level, HP, Class…) that RPG Battle keeps. Reads World State inside Story Block's hidden envelope. |
| RPG Battle | `items` is Story Block's: reads gear, writes loot. Offers its party (`api.members()`). |

## The reader decides

Each extension's settings have **Source of truth** choices for the areas it shares: **Automatic**
(the table above), **This extension**, or **The other one**. With one extension installed, every
choice behaves like Automatic.

## One place to manage them all

With two or more installed, **Story Suite** (in the extensions menu, and the gear in Story Block's
sidebar header) opens one overlay for all of them. Story Director and RPG Battle need Story Block,
so any two of the four include it, and Story Block hosts the overlay:

- **Overview:** each installed extension with its version and, where it has one, its on/off
  switch; and **one Source of truth table**, a row per shared area with one owner: Automatic, or
  one of the extensions that can keep it. Picking one sets every extension's own choice to match
  (that one *This extension*, the others *The other one*), so two can never both claim an area.
- **A tab per extension** showing its own settings panel, moved into the overlay while it is
  open and put back when it closes, so every control keeps working.

- **Tokens per reply:** each extension's estimate of what it adds to an ordinary reply (the
  prompt it injects, and what it asks the model to write back), with a total and a breakdown.

Each panel stays in the Extensions drawer as before, with a *Manage all in Story Suite* link
while the overlay is available. Alone, nothing changes.

## Shown in one place

With NPC State Delta installed, the **Present NPCs** cards show each NPC as they are this moment:
a *now* line (mood, condition, outfit: from World State when Story Block keeps the scene) and
their **NPC Inner Chatter** line as a speech bubble beside the card (a thought bubble when only
one NPC has a line). Story Block then hides its own Chatter tab; the block is still written and
kept as before, and its instruction points the model at NPC State Delta's cards.

## For developers

### Coordinated writes (unreleased)

`StoryBlock` and its Suite API expose `transactionVersion: 1`, `messageIdentity(index)`
and `commitBlocks({id, chatId, messageIndex, expectedText, expectedExtra, changes,
namespace, value, extras?})`. `expectedExtra` is JSON text; `changes` is `[{tag, text}]`;
`extras` maps additional namespaces to values in the same transaction.
The API validates the base, saves blocks, extras and the journal together, then
reads the actual saved character/group chat. It returns `{status, reason?}` where status
is durable, failed or uncertain. Stop/reconcile uncertain outcomes; never replay a delta.
Use one immutable operation per ID. Retries verify without saving again; rejected writes
restore only untouched candidates. Arbitrary external-writer isolation is not guaranteed.

Message identities and `extra.storyBlockCommits` are swipe-owned; active swipe text/extras
stay synchronized and copied transactions are cleared on new variants. This supports
RPG `rpgBattleEvidence` and Director `storyDirectorQuest` without model-visible metadata.

`journalVersion: 1` and `journal()` expose an active-branch view:
`{availability, reason?, entries, prefix, offset, key}`. Nodes contain stable owner/parent
IDs, logical positions, full stateful block text and supported extension extras. `prefix`
contains proven ancestors removed from the live chat; `offset` maps live message indexes
to logical positions. The backing `chatMetadata.storyBlockJournal` retains inactive
variants and deduplicated bodies in the native chat JSONL. Never inject it into prompts.
Prefix archival requires a recognized retained reply; missing anchors, missing bodies or
ambiguous interior edits return incomplete. Keep metadata in exports and archive operations.
ID allocation supports plain-HTTP hosts without `crypto.randomUUID`; existing identities
are retained, and new UUIDs use `getRandomValues` when available.

Regenerate captures the replaced owner before the host deletes its reply. The new
`storyBlockIdentity.replaces` link and saved swipe variants prove the shared parent;
discarded-variant evidence/rewards are excluded. In-flight reads may preview that parent
without saving a placeholder node. Archived state also supplies omitted prompt/carried blocks.

The global `StoryBlock` API offers `regeneratedReplyRecovery()` and
`recoverRegeneratedReply(plan)` for legacy lost-root cases. The unknown replacement must
be at the saved parentless head's position in the same chat; no retained owner may match
a saved node. Earlier replies may have acquired IDs since the journal was installed.
They can precede its original root only when unknown and without supported journal extras;
unchanged verified suffix snapshots and receipts are preserved when attaching that prefix.
Later unknown replies may remain. Revalidate the plan before applying; the action records
`storyBlockReplacement`, verifies message/journal readback and keeps inactive nodes.
Missing archived ancestry is never adopted.

`reconnectRegeneratedReply()` performs this repair automatically, then resumes the latest
reply's callbacks under `replyBusy()`. Chat loading and foreground generation call it;
receive also repairs before notifying plugins. RPG Battle can call it before saving a
blocked result and must wait for `replyBusy()` to clear. Healthy chats do not replay callbacks.
A failed or uncertain automatic attempt blocks further journal writes until page reload.

`onReply(callback, {priority: 0})` awaits callbacks in ascending order, isolating failures.
`replyBusy()` covers normalization and callbacks so scheduled awards can wait for completion.
RPG updates Party at -10, Director settles at 0, and RPG handles later story awards at 10.

```js
import { storySuite, isSourceOfTruth } from './src/suite.js';
const suite = storySuite();
suite.announce({ id: 'my-ext', name: 'My Extension', version: '1.0.0', owns: ['scene'], api: { … } });
suite.owner('scene');                       // → 'story-block'
isSourceOfTruth('my-ext', 'scene', 'auto'); // → false while Story Block is announced
suite.onChange(() => refresh());            // installs, uninstalls and switches
suite.api('story-director')?.calendar?.();  // what another extension shares
```

Two optional announcement fields let Story Suite's overlay manage an extension (no change to
`suite.js`; announcements keep any extra fields):

```js
suite.announce({
    id: 'my-ext', name: 'My Extension', version: '1.0.0', owns: ['scene'],
    settings: '#my_ext_settings',          // the root of its panel under Extensions, moved into the overlay
    api: {
        manage: {
            areas: ['scene'],              // every area it can keep, offered now or not
            sources: () => ({ scene: 'auto' }),           // its Source of truth choices now
            setSource: (area, choice) => { … },           // save and apply, like its own select
            enabled: () => true,           // optional: its on/off switch
            setEnabled: on => { … },       // optional
        },
    },
});
suite.api('story-block')?.openSuite?.('my-ext');  // open the overlay on a tab ('overview' by default)
```

`api.manage.tokens()` (optional) → `{ input, output, parts: [{ label, input, output }] }`: the
extension's estimate, at about four characters a token, of what it adds to the next ordinary
reply: `input` the prompt it injects, `output` what it asks the model to write back. Each counts
only what it injects itself; Story Block counts kept blocks under their owners' names. Quiet
calls (summaries, planning, flavour) are not counted.

`api.manage.preview()` (optional, v0.9.18) → `[{ label, text }]` (one `{ label, text }`,
`{ parts: [{ label, text }] }`, a plain string, or an object of named texts such as
`{ injection, capture }`, each a part named for its key, are read too; extra fields are
ignored): the exact text the extension adds to the next ordinary reply's prompt, as it
would be sent (macros filled in), one part per thing it injects (a note, a rules block, a kept
block's state). Story Suite's overlay lists every extension that offers it under **What's
sent**, read only when the reader opens its fold (so it may build the text then, but must
return it synchronously, never a promise), with each part's size and a Copy button. An empty
`text` means nothing is sent right now. It must not change anything: no rolls kept, no state
written, no model call. Story Block's own is its two parts (v0.9.21): `[{ label: 'Story Blocks:
instructions (same every reply)', text }, { label: 'Story Blocks: this reply', text }]`.

```js
manage: {
    tokens: () => ({ input: 420, output: 0, parts: [{ label: 'Director note', input: 420, output: 0 }] }),
    preview: () => [{ label: 'Director note', text: buildNoteForNextReply() }],
},
```

`api.manage.pending()` is **reserved** (not built yet): a later shared strip at the top of the
sidebar, *The next reply will tell…*, would list what each extension has queued for the next
reply to narrate (a trade, an offer taken on or turned down, a quest given up), each with
**Undo**. The intended shape is `[{ id, text, undo() }]`: `text` one plain line (*Ren sells the
carcass to the apothecary for 3 silver*), `undo` taking that choice back before the reply. Do
not use the name for anything else.

Tabs registered with `registerTab({ id, label, icon, short, group, … })`:

- `icon`: give each tab **its own**. Since v0.9.20 the tab row is always one line: when the
  labels would not fit the sidebar's width it shows icons only (the label on hover, keyboard
  focus and long-press), so the icon is what tells tabs apart. A tab whose icon an earlier tab
  already uses (or that has none) shows a two-letter monogram of its label instead (*Present
  NPCs* → **PN**), which works but reads worse than an icon of its own.
- `short` (v0.9.18): the label under the icon when the full one is long (*Present NPCs* →
  *Cast*); without it a long label is cut to its first word.
- `group` (v0.9.20, optional): the extension the tab belongs to (*RPG Battle*). Story Block's
  own tabs come first, then each group's together, a quiet divider before the next, so an
  extension switched off leaves no gap. Without it the suite's own tab ids are recognised
  (`rpg-…`, `story-director…`, `npc-state-delta…`), and any other id groups by its first word.

**One look for the four settings panels**, NPC State Delta's. `src/suite.css` (identical in all
four, loaded once as `<link id="story-suite-css">`) styles the shared parts:

```html
<div class="inline-drawer-content story-suite-panel">                     <!-- the drawer content -->
  <div class="story-suite-manage" data-story-suite-link hidden>           <!-- first -->
    <button class="menu_button"><i class="fa-solid fa-layer-group"></i> Manage all in Story Suite</button>
  </div>
  <div class="story-suite-quickbar">                                      <!-- switches and main actions -->
    <label class="story-suite-row" for="my_enabled"><span><b>Enable My Extension</b></span><input id="my_enabled" type="checkbox"></label>
    <div class="story-suite-actions"><button class="menu_button">…</button></div>
  </div>
  <div class="story-suite-folds">
    <details class="story-suite-fold" data-fold="money">                  <!-- each section -->
      <summary><b>Money</b><small>copper / silver / gold</small></summary>
      <div class="story-suite-fold-body">
        <label class="story-suite-row" for="my_currency">                  <!-- each setting -->
          <span><b>Currency</b><small>Loot is written in it. · Now: …</small></span>
          <select id="my_currency" class="text_pole">…</select>
        </label>
      </div>
    </details>
  </div>
</div>
```

Also: `story-suite-number` (a number with its unit), `story-suite-subhead`, `story-suite-muted`,
`story-suite-notice` (a gold-edged line) and `story-suite-danger`. Checkboxes in a row show as an
Enabled/Disabled pill. Sections start closed and the open ones are remembered in the browser;
*Source of truth* is one section of rows like the above.

An announcement may carry `shows: ['chatter']`: this extension displays Story Block's NPC Inner
Chatter, so Story Block hides its own Chatter tab while that extension is announced and on.

`setSource` and `setEnabled` update the extension's own panel too, and re-announce when what it
offers changes. Switched off, an extension with `setEnabled` announces again with
`enabled: false` rather than withdrawing, so the overlay can switch it back on (`owner`, `has`
and `api` already skip it; the overlay reads `providers()`). Story Block's overlay is shown
while two or more extensions are announced, on or off.
While it is open, `<body>` carries the class `story-suite-open`: hide floating buttons that would
sit over it (`body.story-suite-open #my-launcher { display: none !important; }`). Each
extension's *Manage all in Story Suite* link carries `data-story-suite-link`, so the overlay
hides it while that panel is shown inside it.

## Prompt cache (v0.9.21)

Most providers keep the longest identical *start* of a prompt between requests (OpenAI,
DeepSeek and Gemini on their own; Claude where the connection sets cache breakpoints) and charge
less, and answer sooner, for it. Every character that differs from the last request ends the
cached part there. So the four extensions put their text in two places:

1. **Instructions: early, and the same every reply.** Rules, formats, skeletons, grammar,
   capture instructions: anything that does not change from reply to reply. Register it with
   `setExtensionPrompt('story_suite_static_<ext>', text, extension_prompt_types.IN_PROMPT, 0,
   false, extension_prompt_roles.SYSTEM)`. In chat completion SillyTavern places in-prompt
   extension prompts next to the Main Prompt; in text completion inside the story string. Keep it
   **byte-identical**: no dice rolls, dates, clocks, names that come and go, counts or token
   figures; a fixed order (sort lists; never rely on Set or Map order); stable whitespace.
   *(Story Block itself places its instructions after the leading system messages at
   prompt-ready instead, because a preset with the Main Prompt off drops in-prompt extension
   prompts in chat completion; the place is just as early and just as stable.)*
2. **This reply's part: last.** Current states, the Director's note, a fight's or a trade's
   hand-off, reminders, dossiers. Register it in-chat at depth 0, role system, under a key that
   sorts into this order (SillyTavern joins the depth-0 system prompts into one message, keys
   sorted, after the last message):

   | Key | Extension |
   |---|---|
   | `story_suite_tail_1_story_block` | Story Block: states, kept blocks' copies, rolls, this reply's notes |
   | `story_suite_tail_2_story_director` | Story Director's note |
   | `story_suite_tail_3_rpg_battle` | RPG Battle's hand-off and trade note |
   | `story_suite_tail_4_npc_state_delta` | NPC State Delta's dossiers |
   | `story_suite_tail_5_npc_state_delta_capture` | NPC State Delta's capture reminder |

   Empty it once its reply is in, so a spent note never reaches a later prompt.

Three more rules keep the cached start long:

- **Something only sometimes needed** does not move in and out of the instructions (that
  changes the start on those replies): keep it there always if it is small and harmless, else put
  it in this reply's part. Story Block puts a block asked for only now and then (*when: every* or
  *keyword*) whole in its tail, and says *Leave <Dice> out of this reply* rather than dropping the
  Dice block from its instructions on a reply that tells a fight.
- **Never rewrite the visible text of older messages**, and strip hidden blocks from the history
  the same way every time, so the history part of the start stays identical.
- **Clear your old keys on load** (set them to `''`), so a copy an older version set never
  lingers. Story Block clears `story_block`, its one key before 0.9.21.

Prove it the way Story Block does: a test that builds your text for two replies in a row (with
the state changed in between) and checks the instructions are identical, and, live, two
consecutive requests compared for how much of the prompt is an identical start.

Announce again whenever what you offer changes (a block switched on or off), and `withdraw(id)`
when the extension is turned off (or announce `enabled: false`, below). Ids: `story-block`, `story-director`, `npc-state-delta`,
`rpg-battle`.
