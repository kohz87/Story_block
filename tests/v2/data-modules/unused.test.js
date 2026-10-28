// Unpinned data definitions leave seeded stories unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { play, playMatrix } from './unused/play.js';
import { REPO, SCENARIOS } from './unused/scenarios.js';
import { fixture } from './helpers.js';

// Any installed pack changes a chat a little (its start, its words); the control carries an empty one.
const mini = () => ({ text: JSON.stringify({ id: 'mini', version: '1.0.0', requires: { storyBlock: '^2' }, content: {} }), origin: 'mini.json' });
const dataPack = () => ({ text: JSON.stringify(fixture('reputation')), origin: 'reputation.json' });

function firstDifference(want, got) {
    const at = want.steps.findIndex((hash, index) => hash !== got.steps[index]);
    return at >= 0 ? `first differing step ${at}` : want.steps.length !== got.steps.length ? `${want.steps.length} steps, then ${got.steps.length}` : 'steps agree';
}

// Compare the same seeded story with and without unpinned definitions for every scenario.
for (const [name, scenario] of Object.entries(SCENARIOS)) {
    for (const seed of scenario.seeds) {
        test(`an unpinned definition changes nothing: ${name}, seed ${seed}`, async () => {
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
const siblings = { sd: join(root, 'Story_director'), nsd: join(root, 'npc_state_delta') };
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

// The combination matrix's own chats (each module's scripted replies, actions, a swipe, a Re-read, a delete, a reload) on all the real
// modules that are beside this checkout, with an unpinned data module library: the same bytes at every step.
const anyBeside = ['sd', 'nsd'].some(key => existsSync(join(siblings[key], key === 'sd' ? 'src/v2/module.js' : 'src/storysuite-v2.js')));
test('the matrix chats are identical with an installed, inspected, never-enabled data module library', { skip: anyBeside ? false : 'no module checkout beside this one' }, async () => {
    const bare = await playMatrix({ root: REPO, siblings, packs: [], libraryOnly: [{ ...mini(), origin: 'mini.json' }] });
    const library = await playMatrix({ root: REPO, siblings, libraryOnly: [{ ...mini(), origin: 'mini.json' }, dataPack(), { text: JSON.stringify(fixture('survival')), origin: 'survival.json' }] });
    assert.ok(bare && library);
    assert.equal(bare.steps.length, 8);
    assert.deepEqual(library.steps, bare.steps);
    assert.equal(library.saves, bare.saves);
    assert.equal(library.draws, bare.draws);
});
