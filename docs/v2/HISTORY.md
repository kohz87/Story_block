# Active history and clock boundaries (E6b)

Parts 1 and 2 implement the retained-chat history and native head barrier. `sdk.timeline.history({through?})`
returns the frozen §8 shape. A restore whose target is inside a reply fades that entire reply, through the
restore carrier, including intervening reader messages. Raw chat stays readable. Prompt/extraction/journal/native
consumers must use the active projection; this host package cannot migrate consumers in other repositories.

Every head change runs one participant selection rule over exact surviving prefix witnesses and replayed state.
Until native participants acknowledge that selection the host returns `RESTORE_PENDING`. It settles before heads,
mutable commands, scanning or generation are exposed; checkpoint recovery and full replay must agree.

`ctx.clockBoundary({minute,source}) -> {cursor,prefixHash}` is synchronous. Only Story Director's existing
`capture.time`, `director.seed`, `time.settle` and `director.advance` handlers, under story/system cause, may call it.
The source must be the root's actual Source. Emit each successive midnight while the transaction's draft clock
is exactly there, after expiry settlement. An unset initial clock creates no earlier day. No native I/O runs here.

The marker captures all current drafts, claims, proof pins, registered-domain versions and effective rule settings.
Thus a paid training session already staged at midnight is captured running/paid, before subsequent completion.
A prefix-only host check rejects markers on a changed root input, even if the owner guard only checks time.
The root stores `clockBoundaries` only on successful commit. Its event proofs use E5's allocator; marker cursor
identity derives from the root cursor returned by ctx-seams and the captured logical state/minute, with no second occurrence allocator.
Its cursor's op is a logical offset within the root, not an offset into the final domain-sorted diff. It is suitable
for history exclusion and target ordering; `store.prefixWitness` continues to describe physical block boundaries.

The async coordinator materializes day-start descriptors from committed markers, through the same durable make
path as other saves. It uses native prefix mappings at the root boundary, never a later native mutation. Where no
mapping exists it asks for a checkpoint and probes that live checkpoint again at commit. Historical selections
are checked again at commit. Publication is deferred until recovery/turn completion; an unpublished marker is not
an eligible snapshot. A failed root/guard publishes none. Re-read regenerates markers from the saved seed; a
changed capture gets a new marker identity and proof; old dependents retire. Reusing an already-published marker identity with different bytes fails `CONFLICT`.
The ordinary E5 limit of 32 proofs per root bounds a single advance's marker count (other root proofs count too).

Compatibility is checked against saved bytes from main: `c36b355` (the original branch point) for legacy chat and
reload of an old guarded chat, and `fa1853d` (the required merge) for newly-created guarded chat. The merged
ctx-seams work adds occurrences and changes IDs for newly-created guarded blocks; E6b adds no further bytes to
chats that never use the timeline. The fixtures exercise Continue, Re-read and swipe back.

Contract gaps and owner follow-ups:

- SD must emit markers and settle expiry at each boundary; this package supplies the host seam, not SD changes.
- NSD must journal every native mutation through its handle and retain immutable historical bytes. A module that
  changes native state outside that protocol violates the checkpoint guarantee.
- Consumers outside this repo must adopt active history for prompts, extraction, journal facts and native scanning.
- The frozen contract supplies no public RB activation-registration callback. RB owns its public query probes.
- Memory `none`/`full` and automatic death-target choice remain owner integration work; E6a's limitations apply.
