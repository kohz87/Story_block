// Off means fully off: with the RPG off (the default), and also on in a chat that has no Character block, a plain
// Story Block chat builds the same prompts, draws the same randomness, makes no model call and stores the same receipts
// as 2.7.2 (fixtures/off-2.7.2.json is the fingerprint of off-flow.js made from the code before the RPG).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHost, hostAvailable } from '../../../testkit/index.js';
import { LEAN_RPG_FEATURE, createLeanRpgPart } from '../../../src/v2/lean-rpg/index.js';
import { fingerprint } from './off-flow.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const baseline = JSON.parse(readFileSync(new URL('fixtures/off-2.7.2.json', import.meta.url), 'utf8'));

test('the RPG off: the prompts, the draws of randomness and the receipts are those of 2.7.2', { skip }, async () => {
    assert.deepEqual(await fingerprint(createHost), baseline);
});

test('the RPG on but no Character block in the chat: the same, and no model call', { skip }, async () => {
    const on = await fingerprint(createHost, host => host.features.set(LEAN_RPG_FEATURE, true));
    assert.equal(on.calls, 0);
    assert.deepEqual(on, baseline);
});

test('the hook asks for nothing while the feature is off: no chat read, no model, no settings', async () => {
    const boom = () => { throw new Error('touched'); };
    const part = createLeanRpgPart({ callModel: boom, chat: boom, chatId: boom, metadata: boom, problem: boom });
    const view = { feature: () => false, state: new Proxy({}, { get: boom }), settings: boom, chat: { length: 0, lastUser: '' } };
    assert.equal(await part.hooks.beforeGenerate(view, { type: 'normal', commit: true }), null);
    assert.equal(await part.hooks.beforeGenerate({}, {}), null, 'a view with no feature check is off too');
    assert.equal(part.hooks.afterCapture(view, { index: 1, type: 'normal' }), undefined);
});
