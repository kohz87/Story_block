This map covers files under `src/` that are not named by path or file name in the other repository documentation.
Files already mapped elsewhere are listed in `CLAUDE.md`, `AI-README.md`, `README.md`, and `docs/**/*.md`.
Last checked: 2026-11-07.

## src/v2/
- `src/v2/profile-field.js`: connection-profile picker for module model calls, using stored names and read-only text UI.
- `src/v2/public-api.js`: frozen read-only `StoryBlock.api` exposing current public story paths and change events.
- `src/v2/public-paths.js`: registry and guard for public API path prefixes contributed by modules.
- `src/v2/rpg-lazy.js`: lazy loader and stand-in part that keeps the optional Lean RPG unloaded until needed.
- `src/v2/sb-macro.js`: registers the `{{sb::path}}` macro for SillyTavern prompts, scripts and status bars.
- `src/v2/skill-slots.js`: skill-slot counts and signature-bit helpers kept outside Lean RPG for small startup.
- `src/v2/v1-copy.js`: detects an old Story Block v1 copy running alongside v2 and reports it once.

## src/v2/assist/
- `src/v2/assist/section.js`: read-only Settings Assist section showing helper switches and recent run outcomes.

## src/v2/data-modules/
- `src/v2/data-modules/block-builder.js`: builds and edits ordinary data-module definitions for the in-chat block editor.
- `src/v2/data-modules/block-layout.js`: chooses a preview layout and card roles for the block editor from its field shape.
- `src/v2/data-modules/block-screen.js`: turns a pinned block's show settings into a host screen or merged tab.
- `src/v2/data-modules/block-starters.js`: three built-in editable drafts offered at the top of the New block form.
- `src/v2/data-modules/block-templates.js`: stores reader-owned block templates and exports them as packs.
- `src/v2/data-modules/editable-layout.js`: adds inline editors to local fields in authored data-module screen layouts.
- `src/v2/data-modules/fields-widget.js`: defines the fields and heading layout nodes used to show a data module's values.
- `src/v2/data-modules/hash-basis-v1.js`: frozen interpreter-1 descriptors and limits kept as a historical identity contract.

## src/v2/events/
- `src/v2/events/calls.js`: allowlisted condition calls that read the before-generate state and queries.
- `src/v2/events/condition.js`: tokenizes, parses and safely evaluates pack-event conditions without JavaScript.
- `src/v2/events/section.js`: read-only Events diagnostics section showing past, due, waiting and invalid events.

## src/v2/lean-rpg/
- `src/v2/lean-rpg/ambush.js`: ambush checks and their opening-round edge or surprise rules.
- `src/v2/lean-rpg/charfile.js`: builds, validates and parses the saved-character file used by Party Import and Export.
- `src/v2/lean-rpg/cue.js`: writes compact narrator roll cues under the prompt budget.
- `src/v2/lean-rpg/join.js`: reads party join and leave lines, then builds companion definitions and offer cards.
- `src/v2/lean-rpg/templates-bars.js`: turns the old Character template into the doubled-bars one (`scale: 2`: size expressions, grow rules, bar maximum and default).
- `src/v2/lean-rpg/levels.js`: level, rank, level-cap and XP-rate helpers plus the RPG rank query.
- `src/v2/lean-rpg/noroll.js`: replay-only: shows and re-reads the per-reply receipt an old chat's retired roll planner left when it gave no usable plan.
- `src/v2/lean-rpg/open.js`: checks and fills new foes that the roll planner opens during a fight.
- `src/v2/lean-rpg/quiet.js`: trims combat and foe prompt grammar on replies where rolls cannot be used.
- `src/v2/lean-rpg/board/auto.js`: chooses deterministic Auto-fight actions by the party policy and decides why Auto stops.
- `src/v2/lean-rpg/board/auto-run.js`: plays Auto exchanges on the staged board fight until the cap, a won or lost fight or a badly hurt hero, and words why it stopped.
- `src/v2/lean-rpg/board/precheck.js`: pure foe pre-check prompt, tolerant JSON reader, group vetting and typed-attack test for opening a fight from a message.
- `src/v2/lean-rpg/board/view-bars.js`: the board's Health strip text ("Hurt · 5/10") and meter props.
- `src/v2/lean-rpg/board/precheck-run.js`: the pre-check's one Assist call (20 s limit) and the opening it records for a typed attack on new foes.
- `src/v2/lean-rpg/board/resume.js`: finds the last ended board fight's exact foe bars when the collapsed Foes block still matches them.
- `src/v2/lean-rpg/resolve.js`: prepares and rolls planned checks, acts and foe attacks into a replayable RPG receipt.
- `src/v2/lean-rpg/soul.js`: reads a renamed Soul Class field label and names, with stock fallbacks.
- `src/v2/lean-rpg/tail.js`: writes compact prompt-tail summaries for RPG role blocks.

## src/v2/lean-rpg/view/
- `src/v2/lean-rpg/view/bars.js`: draws shared Health, Mana and Stamina stage bars and their edit payloads.
- `src/v2/lean-rpg/view/bars.css`: the smooth red, green and blue Health, Stamina and Mana strip, dulled in three steps as it empties.
- `src/v2/lean-rpg/view/changes-lines.js`: builds RPG lines for the Changed this reply card from receipts and state changes.
- `src/v2/lean-rpg/view/distribute.js`: draws the Spend points and Stats sheet with bars, stat steppers, radar and one save.
- `src/v2/lean-rpg/view/export.js`: draws the Export character dialog and creates its saved character file.
- `src/v2/lean-rpg/view/gear-card.js`: draws the Party Inventory slot card and the gear worn in each place.
- `src/v2/lean-rpg/view/lean-rpg.css`: styles the RPG Party, sheets, battle log and settings screens responsively.
- `src/v2/lean-rpg/view/party-data.js`: maps Character, Skills and Foes blocks into plain records and display words for RPG screens.
- `src/v2/lean-rpg/view/party.js`: draws Party tab cards and opens the spend, skills, gear, wizard and export views.
- `src/v2/lean-rpg/view/settings-data.js`: prepares combat-rule, odds and planner-prompt data for the RPG settings page.
- `src/v2/lean-rpg/view/skills.js`: draws the Skills sheet with ranks, mastery, roll previews and editable descriptions.
- `src/v2/lean-rpg/view/wizard-data.js`: works out New character drafts, budgets, problems and definitions without touching the DOM.
- `src/v2/lean-rpg/view/wizard.js`: drives the four-step New character and import dialog, then creates its blocks.

## src/v2/packs/
- `src/v2/packs/card-offer-ui.js`: draws pack card-offer notices and their actions at the top of the Story panel.
- `src/v2/packs/cast-gear.js`: reads a named cast member's signature gear from enabled packs for the cast entry line.
- `src/v2/packs/cast-skills.js`: reads a named cast member's signature skills from enabled packs for party joining.
- `src/v2/packs/kind.js`: classifies a pack as a World pack, Story Block pack or plain pack from its content.
- `src/v2/packs/portrait-fit.js`: shrinks and encodes portraits to stored size limits using browser image APIs.

## src/v2/screens/
- `src/v2/screens/block-fields.js`: registers the fields and heading widgets used by data-module screen layouts.
- `src/v2/screens/block-layouts.js`: draws block and data-module values as cards, number maps, record cards or previews.
- `src/v2/screens/blocks-editor.js`: provides the in-chat form for authoring a block from fields, starters, layout and preview.
- `src/v2/screens/rebuild-banner.js`: Home's dossier banner: blocked branch, start-from-chat dialog, catching-up progress with Skip, and the done or stopped notes.
- `src/v2/screens/inventory-add.js`: places the inline form for adding an item to the reader's own inventory.

## src/v2/timeline/
- `src/v2/timeline/boundary.js`: hashes and checks logical clock markers against transactions and captured proofs.
- `src/v2/timeline/coordinator-rebuild.js`: starts a blocked branch's dossiers again from the chat (last 40 replies or all) through the participant's rebuild.
- `src/v2/timeline/selection-fallback.js`: matches head prefixes and walks compatible earlier participant checkpoints, newest first, for a head selection; the Inspector note when a selection fell back.
- `src/v2/timeline/coordinator-block.js`: classifies blocked timeline selections and schedules retries for temporary failures.
- `src/v2/timeline/referenced.js`: the `timeline.referenced` query: checkpoint ids named by every chat SillyTavern lists (chats of deleted characters are not checked); any listed chat unreadable makes the answer incomplete. Not replay-safe.
- `src/v2/timeline/util.js`: holds shared timeline ids, error codes, crash and stale-chat helpers.

## src/v2/ui/
- `src/v2/ui/inventory-tab.js`: draws a minimal plain Inventory tab with item stacks and command buttons.
- `src/v2/ui/scene-tab.js`: draws a minimal plain read-only Scene tab with place and present people.

## src/v2/view/
- `src/v2/view/clock.js`: formats story minutes as calendar dates and times using the best available calendar.
- `src/v2/view/download.js`: saves text files through a temporary browser download link.
- `src/v2/view/scroll-cue.js`: marks which edge of a scroller has overflow and brings items into view.
- `src/v2/view/tab-merge.js`: merges screens that share a tab id into one tab with ordered sections.

## src/v2/view/mounts/
- `src/v2/view/mounts/hud.js`: mounts and refreshes the HUD strip above the message box.
- `src/v2/view/mounts/tab.js`: registers screen tabs and renders them from the current head state.

## src/v2/view/template/
- `src/v2/view/template/json.js`: compiles and fills JSON payloads with escaped template holes and a depth guard.

## src/v2/view/widgets/
- `src/v2/view/widgets/badge.js`: renders an icon with an optional counter and optional selection command.
- `src/v2/view/widgets/editable.js`: renders an inline reader edit for text, choice, number, money or meter values.
- `src/v2/view/widgets/map-math.js`: provides pure map viewport, zoom, pan, minimap and automatic node-layout maths.
- `src/v2/view/widgets/meter.js`: renders a labelled meter with segments, marks, warnings and spoken value text.
- `src/v2/view/widgets/portrait.js`: renders a safe framed portrait with initials when the image cannot load.
- `src/v2/view/widgets/props.js`: declares, coerces and validates widget props and creates widget definitions.
- `src/v2/view/widgets/radar.js`: renders an SVG radar chart with an optional earlier series and accessible values.
- `src/v2/view/widgets/skill-tree.js`: renders skill tiers with connectors, levels, active states and locked states.
- `src/v2/view/widgets/stepper.js`: renders a bounded numeric stepper that edits drafts against point budgets.

## Pointer to add
- `docs/dev/codemap.md`: map of `src/` files not already covered by the existing docs.

## Split files (7 Nov: files over 450 lines split into small parts; each original keeps its path and public exports)
- `src/v2/store/chains.js`: cached hashes of record bodies, replay chains and checkpoint windows.
- `src/v2/ui-host/shared.js`: shared DOM helpers, reader choices and public UI checks.
- `src/v2/ui-host/setup.js`: widgets, renderer and screen-registry setup for the page host.
- `src/v2/ui-host/screens.js`: synchronization of module, pack and pinned-block screens.
- `src/v2/ui-host/replies.js`: reply-card scopes, scans, rendering and actions.
- `src/v2/ui-host/mounts.js`: screen, card, HUD and dialog mount wiring.
- `src/v2/ui-host/navigation.js`: tab source and Settings navigation controls.
- `src/v2/ui-host/panel.js`: panel creation, opening, closing and live tab-host access.
- `src/v2/ui-host/settings.js`: settings overlay, diagnostics and theme inputs.
- `src/v2/ui-host/events.js`: runtime and chat listeners with their teardown callbacks.
- `src/v2/commands/shared.js`: limits, error helpers, reply and ID helpers; `commands.js` re-exports the public names.
- `src/v2/commands/state.js`: drafts, frozen reads, queries, Source, cursor and proof.
- `src/v2/commands/guards.js`: replay guards and their mark.
- `src/v2/commands/ctx.js`: the command handler's context.
- `src/v2/commands/transact.js`: one transaction.
- `src/v2/store/write/saving.js`: touch, lifecycle changed and the idle/late saves.
- `src/v2/store/write/story.js`: append and before.
- `src/v2/store/write/replace.js`: replaceStory and reconcile.
- `src/v2/store/write/records.js`: narrated, practice rule, receipts, truncate, untold and work.
- `src/v2/store/write/lifecycle.js`: rebuild, archive, batch and renamed.
- `src/v2/data-modules/part.js` → `data-modules/part/`: `factory.js` wires the data-module part; `core.js` shared lifecycle helpers; `shared.js` state access, caches and checked definitions; `views.js` read-only views; `blocks.js` Setup actions; `fields.js` field and host-step actions; `act.js` story and reader actions; `skills.js` the Skills block's slot rules; `party.js` companions; `prompt.js` prompt tail and reply cards; `timing.js` timer and reply-end costs.
- `src/v2/domains/gear.js` → `domains/gear/`: `stats.js` slots, rarity, stat budgets and story-made definitions; `conditions.js` condition words and prices; `carry.js` carry rules and the carry query; `views.js` query answers and the screen picture.
- `src/v2/domains/scene.js` → `domains/scene/`: `constants.js` name, presence, weather and look limits and feature names; `shared.js` the told rule, name lists, the edit mark and the letter test; `present.js` who is present and their changes; `place.js` the place and its moves; `weather.js` the weather line and the `scene.weather` command; `you.js` {{user}}'s look, its Rank label and the look ask.
- `src/v2/events/condition.js` → `events/condition-tokenizer.js` the tokenizer; `condition-parser.js` the parser (a frozen AST); `condition-errors.js` size limits and error values.
- `src/v2/lean-rpg/resolve.js` → `lean-rpg/resolve/dice.js`: the flow version, outcome rule and per-action dice streams shared by the Standard roll and its guard.
- `src/v2/lean-rpg/strings.js` → `lean-rpg/strings/`: `character.js` sheets, party, gear, skills and the wizard; `story.js` saved characters, companions, first send, bars and the sheet; `fight.js` fights, change lines and RPG settings.
- `src/v2/lean-rpg/view/wizard.js` → `wizard/`: `who.js` the Who step and import; `stats.js` the Stats step; `skills.js` the Skills step; `review.js` Review and Create.
- `src/v2/registry.js` → `registry/`: `registration.js` registration checks and ownership; `commands.js` command, capture, context and initial-state lookups; `features.js` feature lookups; `lifecycle.js` peers, cycles and the restore barrier.
- `src/v2/runtime.js` → `runtime/start.js` start helpers; `runtime/saving.js` saving helpers.
- `src/v2/screens/blocks-editor.js` → `blocks-editor/`: `constants.js` labels and types; `editor.js` form state and controls; `draw.js` the sections; `layout.js` layout chips, card roles, colours and preview.
- `src/v2/screens/blocks.js` → `screens/blocks/page.js` the page's list, Show as, row menu and template chooser; `screens/blocks/shared.js` words and format helpers.
- `src/v2/strings.js` → `strings/messages.js` inline edits and refusals; `strings/page.js` bar, panel, drawer, menu, features and reply cards; `strings/screens.js` Story Block's own screens.
- `src/v2/view/bind.js` → `view/bind/`: `paths.js` path syntax and reads; `scope.js` scopes; `expressions.js` compiled expressions; `helpers.js` helpers and formatters; `text.js` text and interpolation; `changes.js` change checks.
- `src/v2/view/css.js` → `view/css/`: `parse.js` limits and tokenizing; `names.js` scope names; `selectors.js` selector scoping; `values.js` value filtering and theme properties; `scoping.js` the scoper.
- `src/v2/view/widgets/map.js` → `view/widgets/map/data.js`: map data cleaning and layer visibility.
- `src/v2/data-modules/check/shape.js`: the message table `E`, the shape validators shared by every section, and the display names of an int field.
- `src/v2/data-modules/check/names.js`: `dataModuleDefaults`, the defaults a checked definition starts from.
- `src/v2/data-modules/check/effects.js`: reward types, the line a List of entries field is worked by, and the effects a rule may write.
- `src/v2/data-modules/check/imports.js`: the imports a definition declares and the offers collected from them.
- `src/v2/data-modules/check/migration.js`: the migrations a definition declares and `validateDataMigration`.
- `src/v2/data-modules/check/screens.js`: the presentation a definition declares (editable props, screens, action and template payloads, view paths).
- `src/v2/data-modules/check/layout.js`: the block layout keys, the stage-bar fields and the block functions (cards, rules, hidden fields).
- `src/v2/data-modules/check/validate.js`: `validateDataModules`, the entry point that checks a pack's definitions, catalog and capabilities.
- `src/v2/data-modules/check/hash.js`: the memoised text hash and the hashes of a checked definition and of a whole pack.
- `src/v2/evidence/constants.js`: proof owners, stat names, structural caps, the stored key list, and the shared readers `isObject`, `whole` and `occurrenceOf`.
- `src/v2/evidence/payloads.js`: checks that a proof payload is closed and well formed for its kind, its payload key, and the intent check.
- `src/v2/evidence/stored.js`: whether a stored proof is whole and owned, its pin, the pins written with a block's ops, and the proof write checks.
- `src/v2/evidence/visible.js`: recorded entries, the visible proofs and the `story.evidence` query.
- `src/v2/evidence/submit.js`: `newRoot` and `submitProof`, which check a `ctx.proof` call and build its proof.
- `src/v2/ops/constants.js`: shared op names and JSON Pointer list index.
- `src/v2/ops/paths.js`: JSON Pointer escaping, parsing and value reads.
- `src/v2/ops/json.js`: plain-object test, JSON check, defensive copies and deep equality.
- `src/v2/ops/freeze.js`: deep freezing, frozen checks and frozen copies sharing a base.
- `src/v2/ops/diff.js`: minimal JSON Patch changes between two states.
- `src/v2/ops/apply.js`: applying JSON Patch changes to a state without changing it.
- `src/v2/ops/counters.js`: counter path detection and the pointer inside a counter holder.
- `src/v2/ops/rebase.js`: counter rebasing, per-reply scratch fitting and replay rules.
- `src/v2/ops/check.js`: generic op validation and forbidden key rules.
- `src/v2/sdk/constants.js`: sdk event names, host settings, limits and preflight patterns.
- `src/v2/sdk/shared.js`: the sdk's shared non-array object test.
- `src/v2/sdk/ids.js`: crypto-backed ids with a module prefix.
- `src/v2/sdk/events.js`: the sdk's named event bus.
- `src/v2/sdk/settings.js`: schema coercion and settings over extension_settings.storySuite.
- `src/v2/sdk/queries.js`: query tools, mounted queries, module views and missing-domain checks.
- `src/v2/sdk/lifecycle.js`: lifecycle announcements, initial domains and read-only preflight.
- `src/v2/lean-rpg/view/battle-log.js` → `battle-log/constants.js`: battle words, panel ids, marker line and fold/recent constants.
- `src/v2/lean-rpg/view/battle-log.js` → `battle-log/util.js`: record checks, list reads and word cutting.
- `src/v2/lean-rpg/view/battle-log.js` → `battle-log/read.js`: Classic and Standard recorded rolls as panel lines, and receipt lookup.
- `src/v2/lean-rpg/view/battle-log.js` → `battle-log/model.js`: consequence arrows, turn-order levels, Status rows and the Foes line.
- `src/v2/lean-rpg/view/battle-log.js` → `battle-log/draw.js`: the panel, its line nodes and the no-rolls note.
- `src/v2/lean-rpg/view/battle-log.js` → `battle-log/marker.js`: marker finding and hiding, panel release and marker placement.
- `src/v2/lean-rpg/view/battle-log.js` → `battle-log/follow.js`: the fold store and the live chat controller.
- `src/v2/lean-rpg/view/settings.js` → `settings/constants.js`: shared words, ids, card search words and Custom fields.
- `src/v2/lean-rpg/view/settings.js` → `settings/controls.js`: cards, chips, fields, number rows and pack notes.
- `src/v2/lean-rpg/view/settings.js` → `settings/sections.js`: Formula, Rolls, Levels, Companions and Gear.
- `src/v2/lean-rpg/view/settings.js` → `settings/difficulty.js`: Difficulty, Custom numbers and odds.
- `src/v2/lean-rpg/view/settings.js` → `settings/combat.js`: the Combat box, saves and reset.
- `src/v2/lean-rpg/view/settings.js` → `settings/page.js`: the live page closure and card order.
- `src/v2/view/mounts/card.js` → `card/summary.js`: the closed-line summary helpers and recent-carrier default.
- `src/v2/view/mounts/card.js` → `card/context.js`: document lookup, carrier readers, caches, sets and observer.
- `src/v2/view/mounts/card.js` → `card/follow.js`: keeping the newest reply's card in view.
- `src/v2/view/mounts/card.js` → `card/build.js`: the reply card, its sections, mounts and open state.
- `src/v2/view/mounts/card.js` → `card/draw.js`: card drawing, cache reuse, strip sync and carrier passes.
- `src/v2/view/mounts/card.js` → `card/events.js`: open/close, story and SillyTavern event wiring.
- `src/v2/view/mounts/card.js` → `card/mount.js`: wires the parts into the public controller.
- `src/v2/view/widgets/editable/props.js`: the editable widget's prop schema and line-cutting helper.
- `src/v2/view/widgets/editable/fields.js`: the editable widget's field boxes, grouped layout, live refresh and readback.
- `src/v2/domains/inventory/commands/wallet.js`: the purse commands and the narrator's edit wording.
- `src/v2/timeline/coordinator-prepare/finish.js`: the participant activation and acknowledgement phase of a committed restore.
- `src/v2/view/template/render/view.js`: the renderer's view lifecycle, draft scope, element budget and the renderTemplate/destroyTemplate entry points.
- `src/v2/view/template/render/blocks.js`: the text, if and each blocks and the block factory.
- `src/v2/view/template/render/elements.js`: the element block for attributes, variables, classes, text, drafts, commands and form submits.
- `src/v2/view/template/render/widgets.js`: the widget block, its props, api and instance cleanup.
- `src/v2/view/form/fields/shared.js`: the field renderers' shared element, button, label and disabled helpers and fresh ids.
- `src/v2/view/form/fields/basic.js`: the switch, text, number and slider field renderers.
- `src/v2/view/form/fields/choice.js`: the select, profile, chips, segmented and chipset field renderers.
- `src/v2/view/form/fields/lines.js`: the editable list field in rows or lines form.
- `src/v2/view/form/fields/page.js`: the settings search box and grouped section block.
- `src/v2/view/form/fields/renderers.js`: the frozen renderer table by field kind.
- `src/v2/persist/carrier.js`: carrier identities, record keys and the record shape check.
- `src/v2/persist/marks.js`: swipe marks, opening hashes and the evidence payload text.
- `src/v2/persist/copies.js`: the kept `swipe_info` record copy and swipe-delete loading checks.
- `src/v2/persist/records.js`: reading, restamping and writing the shown swipe's record.
- `src/v2/persist/receipts.js`: receipt retention and the guarded `data.v2` exception.
- `src/v2/persist/carry.js`: carrying a rescued record to the same message read from its file.
- `src/v2/persist/saver/constants.js`: save batching and timed-out-save read-back intervals.
- `src/v2/persist/saver/io.js`: the save timeout wrapper and one-write-at-a-time gate.
- `src/v2/persist/saver/suspects.js`: the suspect-chat watch, read-backs, rename and resume.
- `src/v2/persist/saver/api.js`: the saver's public methods in their original order.
- `src/v2/persist/saver/core.js`: the saver's live state, timers, save loop and rescue flow.
- `src/v2/domains/core/constants.js`: the core module id, static text, features, settings and gear grammar.
- `src/v2/domains/core/kinds.js`: the core change-line kinds and the `~ you` grammar line.
- `src/v2/domains/core/part.js`: the core part's domains, commands, queries, kinds, context and tabs.
- `src/v2/domains/core/merge.js`: merging module parts, hooks and settings without changing part order.
- `src/v2/domains/core/extra.js`: the Inner chatter tail and `scene.moved` helpers.
- `src/v2/domains/core/module.js`: the core module assembly, host-owned replay guard and queries.
- `testkit/matrix/run/host.js`: matrix host setup, seeded crypto, module keys, reply text, facts and peer queries.
- `testkit/matrix/run/checks.js`: matrix state checks, cold replay, the fresh-host oracle, dormancy and registration.
- `testkit/matrix/run/basics.js`: the matrix basic row, action, replay, prompt and dormancy cases.
- `testkit/matrix/run/cases.js`: the matrix missing-query, malformed, feature, clock, disabled, late and duplicate cases.
- `testkit/matrix/run/revisions.js`: the matrix swipe, re-read and delete cases.

## tests/v2/ (combat replay corpus)
- `tests/v2/qa/combat-corpus.test.js`: replays the D0 combat chats and pins state, Problems, Re-read, cues and battle-log models.
- `tests/v2/qa/state-fuzz-1..4.test.js`: four balanced shards of the seeded whole-chat fuzz (same seeds and steps as the old single file; a QA_FUZZ_* override runs in shard 1).
- `tests/v2/qa/helpers/state-fuzz-run.js`: the fuzz run function, the seed lists and the shard split; `state-fuzz-gen.js`: its seeded generators (change lines, replies, UI commands) and the bonus-paid counter.
- `tests/v2/fixtures/combat-corpus/corpus.mjs`: captures one combat chat's full-replay golden.
- `tests/v2/fixtures/combat-corpus/make.mjs`: builds the Standard-rules planner, fight-start, board, noroll and practice chats and writes their goldens.
- `tests/v2/fixtures/combat-corpus/chats.json`: the ten pinned combat chats and their replay setup.
- `tests/v2/fixtures/combat-corpus/goldens.json`: the golden state, Problems, cues, battle-log models and Re-read results.
