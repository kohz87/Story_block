#!/bin/bash
# Suite check (see SKILL.md): the four Story Suite repos side by side in one folder, each tested in turn.
# Usage: suite-check.sh [folder] [branch]   (folder: default the parent of this Story Block checkout)
set -u
here=$(cd "$(dirname "$0")" && pwd)
sb=$(git -C "$here" rev-parse --show-toplevel)
root=${1:-$(dirname "$sb")}
branch=${2:-main}
mkdir -p "$root"
root=$(cd "$root" && pwd)
logs=$(mktemp -d)
status=0
for repo in Story_block rpg_battle Story_director npc_state_delta; do
    dir="$root/$repo"
    if [ ! -d "$dir/.git" ] && [ ! -f "$dir/.git" ]; then
        git clone -q -b "$branch" "https://github.com/kohz87/$repo.git" "$dir" || { echo "$repo: clone failed"; status=1; continue; }
        how="cloned $branch"
    elif [ -z "$(git -C "$dir" status --porcelain)" ] && [ "$(git -C "$dir" branch --show-current)" = "$branch" ]; then
        git -C "$dir" pull -q --ff-only origin "$branch" && how="fast-forwarded $branch" || how="on $branch (fast-forward failed)"
    else
        how="as it is: $(git -C "$dir" branch --show-current || echo detached)$( [ -n "$(git -C "$dir" status --porcelain)" ] && echo ', local changes')"
    fi
    script=test
    grep -q '"test:dot"' "$dir/package.json" && script=test:dot
    start=$(date +%s)
    (cd "$dir" && npm run -s "$script" > "$logs/$repo.log" 2>&1)
    code=$?
    [ $code -ne 0 ] && status=1
    printf '%-16s %s  exit %s  %ss  (%s at %s)\n' "$repo" "$( [ $code -eq 0 ] && echo green || echo RED )" "$code" \
        "$(( $(date +%s) - start ))" "$how" "$(git -C "$dir" rev-parse --short HEAD)"
done
echo "logs: $logs"
exit $status
