// D0 combat replay corpus: every chat replays to the pinned state, Problems, Re-read result,
// narrator cue and battle-log model recorded from this tree by ../../fixtures/combat-corpus/make.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setup } from '../lean-rpg/helpers.js';
import { seedCrypto } from './helpers/seeded.js';
import { firstDifference } from './helpers/replay-diagnostics.js';
import { capture } from '../fixtures/combat-corpus/corpus.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', 'fixtures', 'combat-corpus');
const chats = JSON.parse(readFileSync(join(ROOT, 'chats.json'), 'utf8'));
const goldens = JSON.parse(readFileSync(join(ROOT, 'goldens.json'), 'utf8'));
const names = Object.keys(chats).sort();
const EXPECTED = [
    'board-fled', 'board-members', 'board-open', 'board-packs', 'board-won', 'noroll',
    'planner-fight-start-board', 'planner-fight-start-held', 'planner-standard-opened', 'practice',
];

function same(actual, expected, label) {
    const difference = firstDifference(actual, expected);
    assert.equal(difference, null, `${label}: first difference ${JSON.stringify(difference)}`);
}

test('the corpus holds every D0 combat category', () => {
    assert.deepEqual(names, EXPECTED);
    for (const name of names) assert.ok(goldens[name], `${name} has a golden`);
});

for (const name of names) {
    test(`combat corpus: ${name}`, async t => {
        const fixture = chats[name], golden = goldens[name];
        const restore = seedCrypto(fixture.seed);
        const { host } = await setup({ blocks: structuredClone(fixture.blocks), board: fixture.board, settings: structuredClone(fixture.settings) });
        t.after(() => {
            try { host.close(); } finally { restore(); }
        });
        host.ctx.chatMetadata = structuredClone(fixture.chatMetadata);
        await host.st.loadChat(structuredClone(fixture.chat), `combat-corpus-${name}`);
        const actual = await capture(host, fixture.rereadIndex);
        same(actual.state, golden.state, `${name}: state after full replay`);
        same(actual.problems, golden.problems, `${name}: Problems`);
        same(actual.cues, golden.cues, `${name}: narrator cue rebuilt from records`);
        same(actual.battle, golden.battle, `${name}: battle log model`);
        same(actual.reread, golden.reread, `${name}: Re-read result`);
    });
}
