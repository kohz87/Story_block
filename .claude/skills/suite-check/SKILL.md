---
name: suite-check
description: Put the four Story Suite repos (Story_block, rpg_battle, Story_director, npc_state_delta) side by side, clone or fast-forward them, and run each repo's tests, so the cross-repo suite tests that skip in CI actually run. Use after a change to testkit/, src/v2/ or anything another module reads.
---

# Suite check: all four repos side by side

The cross-repo tests (Story Block `tests/v2/break/helpers/suite*.js`, RPG Battle's copies of them, the
packs terms/holidays tests) look for a folder holding `Story_block`, `rpg_battle`, `Story_director` and
`npc_state_delta` (exact names) above the test file, or `STORY_SUITE_ROOT=<folder>`. Without it they skip.

1. Pick the folder. The default is the parent of this checkout, which works when this repo is checked
   out as `Story_block` next to the others. Otherwise pass a folder; missing repos are cloned there.
2. Run the script from the Story Block checkout:
   ```sh
   bash .claude/skills/suite-check/suite-check.sh                  # parent folder, branch main
   bash .claude/skills/suite-check/suite-check.sh <folder> [branch]
   ```
   For each repo it clones `<branch>` if the folder has none; a clean checkout already on `<branch>` is
   fast-forwarded from origin; any other checkout (a feature branch, local changes) is tested as it is and
   says so. Then it runs `npm run test:dot` (or `npm test` where the repo has no `test:dot` yet), one repo
   after another (NSD's synthetic-host timing tests are flaky when suites run in parallel), and prints one
   line per repo and the logs' folder. About 8–10 minutes for all four.
3. Read a red repo's log (path printed): the `Failed tests:` section at the end, as in `run-tests`.
4. A module red only here, after a Story Block change, usually needs its testkit re-synced
   (`node ../Story_block/scripts/sync-testkit.mjs --to .` in the module) and a PR there; the vendored copy
   in each module is what its CI tests against.
