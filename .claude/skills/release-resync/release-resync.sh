#!/bin/bash
# Release re-sync (see SKILL.md): rebase Story Block's release branch on v2, then rebuild each module's
# release commit on its v2 with the testkit copied from the Story Block release head.
# Usage: release-resync.sh <sb release branch> <module release branch> [folder]
#   folder: holds the four checkouts (default the parent of this Story Block checkout); they are only read
#   and fetched. The work is done in git worktrees under a new temporary folder.
#   PUSH=1 pushes the results (force-with-lease on the branch's current remote commit); without it nothing
#   leaves the machine.
set -euo pipefail
sb_rel=${1:?Story Block release branch, e.g. v2-release-beta1}
mod_rel=${2:?module release branch, e.g. v2-release-beta1-r2}
here=$(cd "$(dirname "$0")" && pwd)
root=${3:-$(dirname "$(git -C "$here" rev-parse --show-toplevel)")}
work=$(mktemp -d)
echo "work folder: $work"

lease() { git -C "$1" ls-remote origin "refs/heads/$2" | cut -f1; }

# 1. Story Block: the release branch rebased on origin/v2.
git -C "$root/Story_block" fetch -q origin v2 "$sb_rel"
git -C "$root/Story_block" worktree add -q -B "resync-$sb_rel" "$work/Story_block" "origin/$sb_rel"
sb="$work/Story_block"
if ! git -C "$sb" rebase -q origin/v2; then
    echo "Story Block: the rebase on v2 stopped on a conflict in $sb. Resolve it there (git rebase --continue)"
    echo "and finish the steps by hand, or clean up (SKILL.md step 6) and run again once v2 is fixed."
    exit 1
fi
sbh=$(git -C "$sb" rev-parse --short HEAD)
echo "Story Block release $sbh on $(git -C "$sb" rev-parse --short origin/v2)"
if [ "${PUSH:-}" = 1 ]; then
    git -C "$sb" push -q origin "HEAD:$sb_rel" --force-with-lease="$sb_rel:$(lease "$sb" "$sb_rel")"
fi

# 2. Each module: the release commit's own changes (everything but tests/vendor) replayed on origin/v2,
#    the testkit synced from the Story Block release head, the message naming that head.
for repo in rpg_battle Story_director npc_state_delta; do
    git -C "$root/$repo" fetch -q origin v2 "$mod_rel"
    dir="$work/$repo"
    git -C "$root/$repo" worktree add -q -B "resync-$mod_rel" "$dir" "origin/$mod_rel"
    was=$(git -C "$dir" rev-parse --short HEAD)
    git -C "$dir" log -1 --format=%B | sed -E "s/Story Block [0-9a-f]{7,40}, /Story Block $sbh, /" > "$work/msg-$repo.txt"
    git -C "$dir" diff HEAD~1 HEAD -- . ':!tests/vendor' > "$work/patch-$repo.diff"
    git -C "$dir" reset -q --hard origin/v2
    if [ -s "$work/patch-$repo.diff" ] && ! git -C "$dir" apply --3way "$work/patch-$repo.diff"; then
        echo "$repo: the release patch does not apply on v2 ($dir). Resolve it there and finish the steps by"
        echo "hand, or clean up (SKILL.md step 6) and run again once the cause is fixed on v2."
        exit 1
    fi
    node "$sb/scripts/sync-testkit.mjs" --to "$dir" | tail -1
    git -C "$dir" add -A
    git -C "$dir" commit -q -F "$work/msg-$repo.txt"
    echo "$repo $(git -C "$dir" rev-parse --short HEAD) on $(git -C "$dir" rev-parse --short origin/v2) (was $was)"
    if [ "${PUSH:-}" = 1 ]; then
        git -C "$dir" push -q origin "HEAD:$mod_rel" --force-with-lease="$mod_rel:$(lease "$dir" "$mod_rel")"
    fi
done
echo "Next: run each repo's tests in $work/<repo> (npm run test:dot or npm test)."
echo "Clean up: SKILL.md step 6 (worktrees under $work, local branches resync-$sb_rel / resync-$mod_rel)."
