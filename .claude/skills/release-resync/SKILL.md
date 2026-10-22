---
name: release-resync
description: Before a release candidate, rebase Story Block's release branch on v2 and rebuild each module's release commit on its own v2 with the testkit taken from the Story Block release head. Use when Story Block's v2 moved after the release draft PRs were opened.
---

# Release re-sync

A release is one draft PR per repo (Story Block first, then the modules): Story Block's release branch
(e.g. `v2-release-beta1`) carries the version bump; each module's release branch (e.g.
`v2-release-beta1-r2`) is one commit on its `v2`: version, `requires` Story Block, CHANGELOG, and the
Story Block testkit re-synced to the Story Block release head (its message names that head:
"Story Block <sha>, <version>"). When Story Block's `v2` moves, all four must be rebuilt.

1. Have the four checkouts side by side (`Story_block`, `rpg_battle`, `Story_director`, `npc_state_delta`,
   see the `suite-check` skill). The script only fetches in them; it works in git worktrees under a new
   temporary folder, so local work is never touched.
2. Dry run first (nothing is pushed):
   ```sh
   bash .claude/skills/release-resync/release-resync.sh <sb release branch> <module release branch> [folder]
   ```
   It prints the work folder, the new Story Block head, and per module the new commit and the one it
   replaces. It stops with the path to fix when the rebase or a module's patch conflicts.
3. Test every rebuilt worktree once: `npm run test:dot` (or `npm test` where there is no `test:dot`) in
   `<work>/Story_block` and each `<work>/<module>`; NSD also `npm run validate`. A red module after the
   re-sync is a real incompatibility with the new host: fix it on `v2` in that module first (its own PR),
   then re-run this.
4. Push: run again with `PUSH=1` (each branch is pushed with `--force-with-lease` on its current remote
   commit). The open release PRs update in place; wait for CI green on all four.
5. Do not merge them yourself: message the coordinator with the four PR links. Merge order is Story Block
   first, then the modules. NSD's `DEVELOPMENT.md` may name the testkit or version by hand: check it.
6. Clean up, in each checkout: `git worktree remove --force <work>/<repo>` and
   `git branch -D resync-<release branch>`; then delete the work folder. The proxy refuses tag creation:
   the user makes release tags.
