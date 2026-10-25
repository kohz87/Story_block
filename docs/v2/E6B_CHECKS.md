# E6b verification and remaining integration work

Part 1: `5494fd9`, active history. Part 2: `e31667b`, participant head selection and callback bounds.
The resume merges `origin/main` at `fa1853d` with a merge commit; no rebase.

Part 3 adds logical clock markers and extends the existing timeline fuzz with actual SD-clock boundaries,
participant selection checks after every recovery, and full replay comparisons. `timeline-boundaries.test.js`
covers all-domain staged capture, rollback, undeclared guard queries, authority, multiday anchors, unchanged and
changed Re-reads, Continue, swipe back, delete, reload and delayed native-prefix publication. Removing the host
clockBoundary implementation makes the regression file fail. Source tests check a single identity/capture rule.

Post-fix full host suite: 3,384 tests, 3,373 pass, 10 skip, 1 existing todo, zero failures. Syntax check passes.
An earlier fully parallel run hit a V8 structuredClone abort in state-fuzz; its isolated 11 tests passed, and the
complete suite passed with test-concurrency=2. No expected-failure masking was added.

Refreshed module copies (outside the repo): SD 1,125 dot results, exit 0; NSD 1,439 dot results plus compatibility
and runtime smoke, exit 0. RB with both vendor trees refreshed: 1,674 tests, 1,650 pass, 13 skip, 6 todo, 5 failures.
The five failures are four money-scale fixtures registering a duplicate inventory.economy query and a QA registry
fixture omitting declared features. These files also fail against merged main's host. They are fixture/integration
follow-ups, not a green RB suite. Original module repositories are unchanged.

Real-module matrix: 77 ok, 2 gaps, 4 todo, 19 n/a, 26 failures. The failure list and counts match the required
merged main exactly. The available RB module still lacks the frozen dependency/activation migration and can veto
independent combinations with its character-creation hook. This package cannot claim the downstream RB bootstrap
or real SD/NSD marker/history integrations are finished. Follow the owners' contracts in HISTORY.md.

Extended part-3 fuzz: 8 seeds × 60 operations (480 mixed operations), all 8 pass. The 30 × 80 exploratory
run exceeded its 180-second wall bound and is not counted as passing; archive/prefix performance remains a
fails-safe follow-up. The ordinary eight-seed fuzz is also included in the green full host suite.

Part 4: savepoint.contract query, read-only capability calculation and in-flight participant readiness. The
contract/lifecycle/byte tests pass 39/39; all timeline and lifecycle tests pass 241/241. Removing only query
registration makes the regression file fail. Changed-source syntax and diff checks pass. Real RB consumer
migration is the integration gap described above, not an invented host registration interface.

Part 5: one chat-scoped timeout/quarantine runner covers native preparation as well as registered participant
callbacks. The 10-second bound releases the queue; late completion cannot race same-chat work or clear another
chat's slot. Follow-up/selection/contract/byte tests pass 30/30; all timeline+lifecycle tests pass 245/245.
Reverting only native preparation's use of that runner fails the follow-up file. Syntax and diff checks pass.
Retention is deliberately conservative: older day payloads and old pre-restore pins stay readable. Reachability
pruning/native checkpoint release is not a small change and remains a documented fails-safe performance follow-up.

Part 6: thrown guards now report a chat/source-bound store Problem through the shared guard check, including
owner, predicate kind and refused query. This covers a first live commit, replay after Re-read/reload, and a
rejected replacement whose valid old block remains. Reverting the exception routing fails all four new tests.
The focused replay/compatibility group passes 61/61. The core-module query inventory assertions were updated
for the savepoint.contract query added in part 4.

Final external checks use copies refreshed from this exact working tree, including both RB vendor locations:
SD 1,125 tests (1,124 pass, one skip); NSD 1,439 pass plus compatibility and runtime smoke. RB remains 1,674
(1,650 pass, five confirmed pre-existing fixture failures, 13 skip, six todo). The real-module matrix is unchanged
from merged main: 77 ok, two gaps, four todo, 19 n/a, 26 failures. Extended timeline fuzz: eight seeds × 60
operations, all pass. Replay CLI fuzz: 20 seeds × 120 operations, zero failures. Syntax and diff checks pass.

Final full host run: 3,407 tests, 3,396 pass, zero failures, 10 skips, one existing todo. The query inventory
assertions and new guard diagnostic tests are included. No README, CHANGELOG or frozen contract was edited.
