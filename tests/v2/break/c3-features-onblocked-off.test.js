// C3-2: an `onBlocked` hook under a feature the reader turned off is still called when that module's
// canGenerate holds a generation back (turn.js block() reads registry.module(id).hooks.onBlocked directly,
// not through the off-aware hook lists). SPEC §6 Features: "Its hooks are not called."
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

test('an onBlocked hook whose feature is off is not called', async t => {
    t.mock.method(console, 'warn', () => {});
    const calls = [];
    const onBlocked = Object.assign(() => { calls.push('onBlocked'); }, { feature: 'gate.notes' });
    const gate = {
        id: 'gate', name: 'Gate', version: '0.0.1',
        features: [{ id: 'gate.notes', label: 'Notes', default: false }],
        hooks: { canGenerate: () => ({ ok: false, reason: 'Wait.' }), onBlocked },
    };
    const host = await createHost({ modules: [gate] });
    t.after(() => host.close());
    assert.equal(host.registry.featureOn('gate.notes'), false);
    const result = await host.send('Go.', 'never');
    assert.equal(result.aborted, true);
    assert.deepEqual(calls, []);
});
