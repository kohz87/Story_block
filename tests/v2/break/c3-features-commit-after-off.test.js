// C3-3: a preview taken while a feature is on can be committed after the reader turned that feature off:
// bus.commit() checks only that the head did not move (a toggle never moves it), so the command's ops are
// stored although the command is now refused with FEATURE_OFF at the top (SPEC §6 Features).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

const poke = () => ({
    id: 'pk', name: 'Poke', version: '0.0.1',
    features: [{ id: 'pk.cmd', label: 'Pokes' }],
    domains: { pkd: { initial: () => ({ pokes: 0 }) } },
    commands: { 'pk.poke': { handler: ctx => { ctx.draft('pkd').pokes += 1; return { summary: 'Poked.', narrate: false }; }, feature: 'pk.cmd' } },
});

test('a preview of a feature command cannot be committed once the feature is off', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ modules: [poke()] });
    t.after(() => host.close());
    await host.send('One.', 'Reply one.');
    const preview = await host.sdk.preview('pk.poke', {});
    assert.equal(preview.ok, true);
    host.features.set('pk.cmd', false);
    assert.equal((await host.sdk.command('pk.poke', {})).code, 'FEATURE_OFF');
    const result = await host.sdk.commit(preview.token);
    assert.equal(result.code, 'FEATURE_OFF');
    assert.equal(host.head().domains.pkd.pokes, 0);
});
