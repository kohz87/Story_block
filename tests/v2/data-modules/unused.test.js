// "Unused means byte-identical" (DATA_MODULES.md section 4): with the data modules capability present and nothing pinned,
// a chat is the chat it was before the capability existed.
//
//  1. Differential against the baseline: seeded random chats (replies of every kind, swipes, Continues, deletes, Re-reads,
//     reloads, rebuilds, chat switches, save points, features, shipped example packs, checkpoints on long chats) are played
//     here and compared step by step, as one hash of the exact serialized messages and extras, chat metadata, head
//     state, next prompt and Problems, with the trace the same script made on main at cc0b793 (before this work;
//     scripts/dm-unused-golden.mjs writes it). Also compared: the number of saves, the RNG draws, the installed packs'
//     normalized form. A line that names a data module in a chat that has none is an unknown kind, as it was.
//  2. In-tree: the same chats with data module definitions installed and inspected (library discovery, Setup queries) but
//     never enabled are identical to the chats without them, with the real Story Director beside when it is there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { play } from './unused/play.js';
import { REPO, SCENARIOS } from './unused/scenarios.js';
import { fixture } from './helpers.js';

const baseline = JSON.parse(readFileSync(new URL('fixtures/unused-baseline.json', import.meta.url), 'utf8'));
// Any installed pack changes a chat a little (its start, its words); the control carries an empty one.
const mini = () => ({ text: JSON.stringify({ id: 'mini', version: '1.0.0', requires: { storyBlock: '^2' }, content: {} }), origin: 'mini.json' });
const dataPack = () => ({ text: JSON.stringify(fixture('reputation')), origin: 'reputation.json' });

function firstDifference(want, got) {
    const at = want.steps.findIndex((hash, index) => hash !== got.steps[index]);
    return at >= 0 ? `first differing step ${at}` : want.steps.length !== got.steps.length ? `${want.steps.length} steps, then ${got.steps.length}` : 'steps agree';
}

for (const [name, scenario] of Object.entries(SCENARIOS)) {
    for (const seed of scenario.seeds) {
        test(`unused is byte-identical to the baseline: ${name}, seed ${seed}`, async () => {
            const want = baseline.scenarios[name][seed];
            assert.ok(want, `no baseline trace for ${name} ${seed}: regenerate it (scripts/dm-unused-golden.mjs)`);
            const { detailed, ...got } = await play({ root: REPO, seed, steps: scenario.steps, packs: scenario.packs() });
            assert.equal(got.steps.length, want.steps.length);
            assert.equal(firstDifference(want, got), 'steps agree', `${name} ${seed}`);
            assert.equal(got.saves, want.saves, 'the same number of saves');
            assert.equal(got.draws, want.draws, 'the same RNG draws');
            assert.equal(got.packs, want.packs, 'the same normalized packs');
            assert.equal(got.final, want.final, 'the same final chat and head');
        });
    }
}

for (const [name, scenario] of Object.entries({ plain: SCENARIOS.plain, riverside: SCENARIOS.riverside })) {
    for (const seed of scenario.seeds.slice(0, 3)) {
        test(`definitions installed, inspected and never enabled change nothing: ${name}, seed ${seed}`, async () => {
            const bare = await play({ root: REPO, seed, steps: scenario.steps, packs: [...scenario.packs(), mini()] });
            const library = await play({ root: REPO, seed, steps: scenario.steps, packs: [...scenario.packs(), mini(), dataPack()], libraryOnly: [{ ...dataPack(), origin: 'again.json' }] });
            assert.equal(firstDifference(bare, library), 'steps agree');
            assert.equal(library.saves, bare.saves);
            assert.equal(library.draws, bare.draws);
            assert.equal(library.final, bare.final);
        });
    }
}

// The same with the real Story Director beside (time lines, clocks, its checks and hooks), when the checkouts are there.
const root = process.env.STORY_SUITE_ROOT ?? dirname(REPO);
const siblings = { sd: join(root, 'Story_director'), rb: join(root, 'rpg_battle'), nsd: join(root, 'npc_state_delta') };
const beside = existsSync(join(siblings.sd, 'src/v2/module.js'));
for (const seed of [41, 42]) {
    test(`with Story Director beside, an installed but unpinned definition changes nothing: seed ${seed}`, { skip: beside ? false : 'no Story Director checkout beside this one' }, async () => {
        const only = { sd: siblings.sd };
        const bare = await play({ root: REPO, seed, steps: 40, siblings: only, packs: [mini()] });
        const library = await play({ root: REPO, seed, steps: 40, siblings: only, packs: [mini(), { text: JSON.stringify(fixture('survival')), origin: 'survival.json' }], libraryOnly: [dataPack()] });
        assert.equal(firstDifference(bare, library), 'steps agree');
        assert.equal(library.final, bare.final);
        assert.equal(library.saves, bare.saves);
        assert.equal(library.draws, bare.draws);
    });
}
