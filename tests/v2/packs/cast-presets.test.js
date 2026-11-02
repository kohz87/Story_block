// The built-in NPC State Delta meter presets a cast entry's `meters.preset` may name (limits.js CAST_BUILT_IN_PRESETS), exported for
// Story Studio's vendored copy. The list is pinned here, and against NPC State Delta's own BUILT_IN_PRESETS when its checkout is
// there (NPC_STATE_DELTA_PATH, or STORY_SUITE_ROOT/npc_state_delta, or a sibling folder named npc_state_delta); skipped otherwise.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CAST_BUILT_IN_METERS, CAST_BUILT_IN_PRESETS, METER_LIMITS, SLUG } from '../../../src/v2/packs/limits.js';
import { validatePack } from '../../../src/v2/packs/validate.js';
import { pack } from './helpers/fixtures.js';

const person = preset => ({ id: 'fenna', name: 'Fenna', about: 'About.', look: 'Look.', start: { place: 'Docks', goal: 'A goal.' }, meters: { preset } });

test('the built-in preset ids are one frozen list: companion, rival, mentor', () => {
    assert.deepEqual([...CAST_BUILT_IN_PRESETS], ['companion', 'rival', 'mentor']);
    assert.ok(Object.isFrozen(CAST_BUILT_IN_PRESETS));
    for (const id of CAST_BUILT_IN_PRESETS) assert.ok(SLUG.test(id) && id.length <= METER_LIMITS.id, `${id} is a well-formed preset id`);
    assert.equal(new Set(CAST_BUILT_IN_PRESETS).size, CAST_BUILT_IN_PRESETS.length);
});

test('every built-in preset id is accepted in a cast entry\'s meters.preset, and a made-up one is accepted too (this host checks the shape only)', () => {
    for (const id of [...CAST_BUILT_IN_PRESETS, 'a-preset-of-the-pack']) assert.equal(validatePack(pack({ content: { cast: [person(id)] } })).ok, true, id);
    assert.equal(validatePack(pack({ content: { cast: [person('Not A Slug')] } })).ok, false);
});

const here = dirname(fileURLToPath(import.meta.url));
const candidates = [process.env.NPC_STATE_DELTA_PATH, process.env.STORY_SUITE_ROOT && join(process.env.STORY_SUITE_ROOT, 'npc_state_delta'), join(here, '../../../../npc_state_delta')].filter(Boolean);
const delta = candidates.find(folder => existsSync(join(folder, 'src/npc-meters-presets.js')));

test('the list is NPC State Delta\'s own built-in preset ids, in its order, and the meters they add are known to the cast checks', { skip: delta ? false : 'NPC State Delta checkout not found' }, async () => {
    const { BUILT_IN_PRESETS } = await import(pathToFileURL(join(delta, 'src/npc-meters-presets.js')).href);
    assert.deepEqual([...CAST_BUILT_IN_PRESETS], BUILT_IN_PRESETS.map(preset => preset.id));
    // the meter each preset adds (its name, lowercased) is one a secret or stage may name without the entry listing it
    const added = BUILT_IN_PRESETS.flatMap(preset => preset.meters.map(meter => meter.name.toLowerCase()));
    for (const meter of added) assert.ok(CAST_BUILT_IN_METERS.includes(meter), `${meter} is in CAST_BUILT_IN_METERS`);
});
