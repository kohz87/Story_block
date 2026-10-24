# The RPG rules contract (rules v2)

The frozen contract for rebuilding RPG Battle on Story Block v2: who owns what, the queries and commands between the
modules, the host changes Story Block must make first (track E), the replay and restore rules, the rules pack format
(pack schema v2) and the work per track.

- [RB_CONTRACT.md](RB_CONTRACT.md): the contract.
- [RB_CONTRACT_APIS.md](RB_CONTRACT_APIS.md): the existing APIs it keeps, with their code.
- [RB_TRACK_B_DESIGN.md](RB_TRACK_B_DESIGN.md): RPG Battle's internal design backlog and the tests its rules core must pass.

Code links are pinned to the v2 heads the contract was checked against (Story Block 47b2806, RPG Battle c24e93d,
Story Director 8072d60, NPC State Delta b906544). The decisions behind it are in the suite's decisions log.
Nothing here is implemented yet; a change to the contract needs the suite lead and a decision logged first.
