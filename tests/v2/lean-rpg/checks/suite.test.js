// Story checks beside the real Story Director (needs a Story_director checkout beside this one, or STORY_SUITE_ROOT; skipped otherwise): both modules register,
// Story Director keeps `check` and Story Block's own word is `roll`, the dice note and Story Block's grammar line are told (Story Director's own check grammar is its feature's), and a `? roll` line makes its result.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHost, hostAvailable } from '../../../../testkit/index.js';
import { LEAN_RPG_FEATURE } from '../../../../src/v2/lean-rpg/index.js';
import { STANDARD_TEMPLATES } from '../../../../src/v2/lean-rpg/templates.js';
import { checksOf } from '../../../../src/v2/lean-rpg/practice.js';
import { success } from '../../data-modules/helpers.js';
import { tailOf } from '../helpers.js';
import { seedCrypto } from '../../qa/helpers/seeded.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = [process.env.STORY_SUITE_ROOT, path.resolve(here, '../../../../..')].filter(Boolean).map(root => path.join(root, 'Story_director', 'src', 'v2', 'module.js')).find(existsSync);
let SD = null;
if (file) { try { SD = await import(pathToFileURL(file).href); } catch { SD = null; } }
const available = await hostAvailable();
const skip = !available.ok ? available.reason : typeof SD?.createModule === 'function' ? false : 'no Story Director checkout beside this one (Story_director, or STORY_SUITE_ROOT)';
const definitionOf = name => structuredClone(STANDARD_TEMPLATES.find(entry => entry.name === name).definition);
const NOTE = /Dice for this reply, in order: (\d+), (\d+), (\d+)\./u;

test('with the real Story Director, `check` stays its word and `roll` is Story Block\'s: dice, the grammar line and a result', { skip }, async t => {
    t.after(seedCrypto(11));
    const host = await createHost({ modules: [SD.createModule()] });
    t.after(() => host.close());
    host.features.set(LEAN_RPG_FEATURE, true);
    await host.send('Begin.', 'Opening.');
    for (const name of ['Character', 'Skills']) success(await host.sdk.command('dm.define', { definition: definitionOf(name) }));
    success(await host.sdk.command('dm.set', { module: 'pack.chat/character', fields: { who: 'Astra', level: 20, dex: 12, cha: 10 } }));
    await host.send('I try.', { toString() { const found = NOTE.exec(tailOf(host.st.requests.at(-1))); return `Story.\n<Changes>\n? roll Astra | cha | normal | ${found?.[1]}\n</Changes>`; } });
    const request = JSON.stringify(host.st.requests.at(-1));
    assert.ok(NOTE.test(tailOf(host.st.requests.at(-1))), 'the dice note is told');
    assert.ok(request.includes('? roll Who | skill or stat'), 'Story Block\'s grammar line');
    assert.equal(checksOf(host.ctx.chat.at(-1).extra.storySuite.receipts).length, 1, 'the roll line made a result');
});
