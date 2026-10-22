// C3-1: a feature that owns the whole context (`context.feature`) whose static text sits in a
// `context.parts` entry (no feature of its own) changes the static prompt part when it flips, but is not
// marked as changing it: registry.feature(id).prompt is false, the `feature` event says prompt: false and
// the overlay shows no "Changes the fixed prompt once" hint (SPEC §5 / §6 Features, invariant 5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { STATIC_KEY } from '../../../src/v2/turn.js';

const whole = () => ({
    id: 'wy', name: 'Whole Y', version: '0.0.1',
    features: [{ id: 'wy.all', label: 'Y all' }],
    domains: { wyd: { initial: () => ({}) } },
    context: { feature: 'wy.all', parts: [{ static: () => 'WY static part text.' }], budget: 100 },
});
const lastStatic = host => host.st.promptLog.filter(entry => entry.key === STATIC_KEY && entry.value).at(-1)?.value ?? '';

test('a whole-context feature whose static is in a part is marked as changing the static part', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ modules: [whole()] });
    t.after(() => host.close());
    const events = [];
    host.sdk.on('feature', event => events.push(event));
    await host.send('One.', 'Reply one.');
    const before = lastStatic(host);
    assert.ok(before.includes('WY static part text.'));
    host.features.set('wy.all', false);
    await host.send('Two.', 'Reply two.');
    const after = lastStatic(host);
    // The static part did change with this feature ...
    assert.notEqual(after, before);
    // ... so the feature must say it changes it (hint, event).
    assert.equal(host.registry.feature('wy.all').prompt, true, 'registry.feature().prompt');
    assert.equal(events.at(-1)?.prompt, true, 'the feature event');
});
