// ctx.epoch against the real timeline (save points and restores). It runs once the timeline is in the tree; until then the
// savepoints domain is only simulated in ctx-seams.test.js and this file is skipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createHost } from '../../testkit/index.js';
import { GENESIS_EPOCH } from '../../src/v2/replay.js';

const have = existsSync(new URL('../../src/v2/timeline/index.js', import.meta.url)) && existsSync(new URL('./helpers/timeline.js', import.meta.url));
const helpers = have ? await import('./helpers/timeline.js') : null;
const skip = have ? false : 'needs the timeline (docs/v2/TIMELINE.md), which is not in this tree yet';
const reply = (text, lines = []) => (lines.length ? `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);

// A click that reads the epoch, and what the guard of its block carries.
const reader = () => ({
    id: 'cs-epoch', name: 'Epoch reader', version: '0.0.1',
    domains: { csepoch: { initial: () => ({ read: {} }) } },
    commands: {
        'cs.read'(ctx, { id }) {
            ctx.draft('csepoch').read[id] = ctx.epoch;
            ctx.replayGuard({ owner: 'cs-epoch', version: 2, epoch: ctx.epoch, rulesHash: null, inputHash: ctx.hash({ id }), predicate: { kind: 'read', id } });
            return { summary: `Read ${id}.`, narrate: false };
        },
    },
    hooks: { replayGuard: () => ({ ok: true }) },
});

test('ctx.epoch follows the real timeline: genesis before and at the first save point, the restore\'s new epoch after, and a replay keeps what was read', { skip }, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { BATCH, nativeModule, rulesModule, restore, seal } = helpers;
    const native = nativeModule();
    const host = await createHost({ modules: [rulesModule(), native.def, reader()] });
    t.after(() => host.close());
    const read = async id => assert.equal((await host.sdk.command('cs.read', { id })).ok, true, id);
    await host.send('Go.', reply('A.', ['+ coin 10']));
    assert.equal(host.head().domains.savepoints, undefined, 'no save point yet');
    await read('before');
    const saved = (await host.sdk.timeline.make({ kind: 'manual', name: 'Save' })).snapshot;
    assert.equal(host.head().domains.savepoints.epoch, GENESIS_EPOCH);
    await read('first');
    await host.sdk.command('tl.xp', { amount: 100 });
    await seal(host, BATCH);
    const done = await restore(host, saved.id);
    assert.equal(done.activated.ok, true, done.activated.message);
    const epoch = host.head().domains.savepoints.epoch;
    assert.notEqual(epoch, GENESIS_EPOCH, 'a restore makes a new epoch');
    await read('after');
    const reads = () => host.head().domains.csepoch.read;
    assert.deepEqual(reads().after, epoch, 'the click read the restore\'s epoch');
    host.store.rebuild();
    assert.equal(reads().after, epoch);
    assert.equal(host.head().domains.savepoints.epoch, epoch);
    assert.equal(host.store.problems().length, 0);
});
