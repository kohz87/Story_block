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
- `src/v2/lean-rpg/levels.js`: level, rank, level-cap and XP-rate helpers plus the RPG rank query.
- `src/v2/lean-rpg/noroll.js`: records a per-reply receipt when a live fight's roll planner gives no usable plan.
- `src/v2/lean-rpg/open.js`: checks and fills new foes that the roll planner opens during a fight.
- `src/v2/lean-rpg/quiet.js`: trims combat and foe prompt grammar on replies where rolls cannot be used.
- `src/v2/lean-rpg/resolve.js`: prepares and rolls planned checks, acts and foe attacks into a replayable RPG receipt.
- `src/v2/lean-rpg/soul.js`: reads a renamed Soul Class field label and names, with stock fallbacks.
- `src/v2/lean-rpg/tail.js`: writes compact prompt-tail summaries for RPG role blocks.

## src/v2/lean-rpg/view/
- `src/v2/lean-rpg/view/bars.js`: draws shared Health, Mana and Stamina stage bars and their edit payloads.
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
- `src/v2/screens/inventory-add.js`: places the inline form for adding an item to the reader's own inventory.

## src/v2/timeline/
- `src/v2/timeline/boundary.js`: hashes and checks logical clock markers against transactions and captured proofs.
- `src/v2/timeline/coordinator-block.js`: classifies blocked timeline selections and schedules retries for temporary failures.
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
- `src/v2/data-modules/part.js` → `data-modules/part/`: `factory.js` wires the data-module part; `core.js` shared lifecycle helpers; `shared.js` state access, caches and checked definitions; `views.js` read-only views; `blocks.js` Setup actions; `fields.js` field and host-step actions; `act.js` story and reader actions; `skills.js` the Skills block's slot rules; `party.js` companions; `prompt.js` prompt tail and reply cards; `timing.js` timer and reply-end costs.
- `src/v2/domains/gear.js` → `domains/gear/`: `stats.js` slots, rarity, stat budgets and story-made definitions; `conditions.js` condition words and prices; `carry.js` carry rules and the carry query; `views.js` query answers and the screen picture.
- `src/v2/events/condition.js` → `events/condition-tokenizer.js` the tokenizer; `condition-parser.js` the parser (a frozen AST); `condition-errors.js` size limits and error values.
- `src/v2/lean-rpg/resolve.js` → `lean-rpg/resolve/classic.js`: Classic sheet preparation and the roll primitives shared with Standard.
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
- `src/v2/view/widgets/editable/props.js`: the editable widget's prop schema and line-cutting helper.
- `src/v2/view/widgets/editable/fields.js`: the editable widget's field boxes, grouped layout, live refresh and readback.
- `src/v2/domains/inventory/commands/wallet.js`: the purse commands and the narrator's edit wording.
- `src/v2/timeline/coordinator-prepare/finish.js`: the participant activation and acknowledgement phase of a committed restore.
