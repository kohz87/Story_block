// ctx.gather(name, args) (MODULES §F126): every other module's answer to a hook, on the state the command
// sees, null-safe (no answer, a promise or a throw is left out), frozen; RPG Battle asks `checkModifiers`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';

const asker = seen => ({
    id: 'asker', name: 'Asker', version: '0.0.1',
    domains: { notes: { initial: () => ({ n: 0 }), validate: () => [] } },
    commands: {
        'asker.ask': (ctx, payload) => {
            ctx.draft('notes').n = 5;
            const got = ctx.gather(payload.hook, { skill: 'persuade' });
            seen.push(got);
            assert.ok(Object.isFrozen(got) && Object.isFrozen(got[0]?.answer ?? {}));
            return { summary: 'asked', narrate: false };
        },
    },
    hooks: { checkModifiers: () => [{ mod: 9, text: 'my own' }] },
});
const answering = { id: 'b-mod', name: 'B', version: '0.0.1', hooks: { checkModifiers: (view, args) => [{ mod: view.state.domains.notes.n === 5 ? -2 : 0, text: `wary of ${args.skill}` }] } };
const throwing = { id: 'c-mod', name: 'C', version: '0.0.1', hooks: { checkModifiers: () => { throw new Error('no'); } } };
const late = { id: 'd-mod', name: 'D', version: '0.0.1', hooks: { checkModifiers: async () => [{ mod: 1 }] } };
const silent = { id: 'e-mod', name: 'E', version: '0.0.1', hooks: { checkModifiers: () => null } };

test('gather: the other modules\' answers on the command\'s own state; throws, promises and nulls left out; not its own', async () => {
    const seen = [];
    const host = await createHost({ modules: [asker(seen), answering, throwing, late, silent] });
    try {
        const result = await host.sdk.command('asker.ask', { hook: 'checkModifiers' });
        assert.equal(result.ok, true, result.message);
        assert.deepEqual(JSON.parse(JSON.stringify(seen[0])), [{ module: 'b-mod', answer: [{ mod: -2, text: 'wary of persuade' }] }], 'sees the draft (n = 5)');
        await host.sdk.command('asker.ask', { hook: 'nobodyAnswers' });
        assert.deepEqual(seen[1], []);
        assert.equal((await host.sdk.command('asker.ask', { hook: '' })).code, 'INVALID');
    } finally {
        host.close();
    }
});
