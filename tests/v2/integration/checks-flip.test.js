// The send flow keeps its pre-roll when Story Director supplies standalone checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createHost } from '../../../testkit/index.js';

const path = new URL('../../../../Story_director/src/v2/module.js', import.meta.url);
const director = existsSync(path) ? (await import(path.href)).createModule : null;

test('a pre-roll uses Director checks without a battle module and replays with the reply', { skip: director ? false : 'Story Director checkout not present' }, async t => {
    let sdk;
    let calls = 0;
    const module = director({ host: { settings: id => sdk?.settings(id) ?? {}, substitute: text => text } });
    const host = await createHost({ modules: [module], callModel: async () => { calls += 1; return '? check Stealth — sneak past | dc: hard'; },
        settings: { modules: { 'story-block': { assistClassifier: true } } } });
    sdk = host.sdk;
    t.after(() => host.close());
    const created = await sdk.command('checks.actor', { write: 'wr_00000001', name: 'Mara', expectedHash: sdk.query('checks.policy').hash });
    assert.equal(created.ok, true, created.message);
    await host.send('I sneak past.', 'A shadow passes.');
    assert.equal(calls, 1);
    const checks = Object.values(host.head().domains.checks.log);
    assert.equal(checks.length, 1);
    assert.equal(checks[0].source, 'standalone');
    assert.deepEqual(host.turn.problems(), []);
    const before = structuredClone(host.head());
    host.store.rebuild();
    assert.deepEqual(host.head(), before);
});
