// Off means fully off: with the RPG off (the default), and also on in a chat that has no Character block, a plain
// Story Block chat builds the same prompts, draws the same randomness, makes no model call and stores the same receipts
// as before the RPG (fixtures/off-2.11.0.json is the fingerprint of off-flow.js: 2.7.2's, made from the code before the
// RPG, until 2.9.4 added one clause to the `present` grammar line (fixtures/off-2.9.4.json is that one), 2.10.0 put Your look's
// `~ you` grammar line and tail line in and 2.11.0 the Mounts grammar line, both on by default. With the old clause and
// `story-block.you` and `story-block.mounts` both off the code still gives 2.9.4's exactly; with them on only the prompt hashes differ).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHost, hostAvailable } from '../../../testkit/index.js';
import { LEAN_RPG_FEATURE, createLeanRpgPart } from '../../../src/v2/lean-rpg/index.js';
import { MOUNTS_FEATURE } from '../../../src/v2/domains/mounts.js';
import { YOU_FEATURE } from '../../../src/v2/domains/scene.js';
import { fingerprint } from './off-flow.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const baseline = JSON.parse(readFileSync(new URL('fixtures/off-2.11.0.json', import.meta.url), 'utf8'));
const before = JSON.parse(readFileSync(new URL('fixtures/off-2.9.4.json', import.meta.url), 'utf8'));

test('the RPG off: the prompts, the draws of randomness and the receipts are those from before the RPG (2.11.0 grammar, Your look and Mounts on)', { skip }, async () => {
    assert.deepEqual(await fingerprint(createHost), baseline);
});

test('the RPG on but no Character block in the chat: the same, and no model call', { skip }, async () => {
    const on = await fingerprint(createHost, host => host.features.set(LEAN_RPG_FEATURE, true));
    assert.equal(on.calls, 0);
    assert.deepEqual(on, baseline);
});

test('Your look and mounts off: the fingerprint is the one from 2.9.4, exactly (only the prompt hashes differ with them on)', { skip }, async () => {
    const off = await fingerprint(createHost, host => { host.features.set(YOU_FEATURE, false); host.features.set(MOUNTS_FEATURE, false); });
    assert.deepEqual(off, before);
    const on = await fingerprint(createHost);
    assert.notDeepEqual(on.prompts, before.prompts);
    assert.deepEqual({ ...on, prompts: null }, { ...before, prompts: null }, 'draws, calls, receipts, domains and rev are the same');
});

test('the hook asks for nothing while the feature is off: no chat read, no model, no settings', async () => {
    const boom = () => { throw new Error('touched'); };
    const part = createLeanRpgPart({ callModel: boom, chat: boom, chatId: boom, metadata: boom, problem: boom });
    const view = { feature: () => false, state: new Proxy({}, { get: boom }), settings: boom, chat: { length: 0, lastUser: '' } };
    assert.equal(await part.hooks.beforeGenerate(view, { type: 'normal', commit: true }), null);
    assert.equal(await part.hooks.beforeGenerate({}, {}), null, 'a view with no feature check is off too');
    assert.equal(part.hooks.afterCapture(view, { index: 1, type: 'normal' }), undefined);
});
