import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../testkit/index.js';
import { rulesModule, restore } from './helpers/timeline.js';

test('history excludes the entire intra-reply target, reader messages and the restoring reply from all active readers', async t => {
    const host = await createHost({ modules: [rulesModule()] });
    t.after(() => host.close());
    await host.send('Begin.', 'Before.');
    await host.send('Accept the job.', 'Target, with facts that must fade.');
    await host.sdk.command('tl.xp', { amount: 2 });
    const point = await host.sdk.timeline.make({ kind: 'manual' });
    await host.cont(' Continued facts.');
    await host.send('These words must fade too.', 'Death.');
    assert.equal((await restore(host, point.snapshot.id)).activated.status, 'complete');
    const history = await host.sdk.timeline.history({});
    assert.deepEqual(history.messages.map(x => x.active), [true, true, true, true, false, false, false]);
    for (const reader of ['extraction', 'journal', 'native scan']) {
        const active = history.messages.filter(x => x.active).map(x => x.text).join('\n');
        assert.equal(active.includes('facts'), false, reader);
        assert.equal(active.includes('must fade too'), false, reader);
    }
    const head = await host.sdk.timeline.head();
    assert.equal((await host.sdk.timeline.history({ through: { ...head.cursor, swipeKey: 'sw_zzzzzzzz' } })).code, 'NOT_FOUND');
    host.store.rebuild();
    assert.deepEqual(await host.sdk.timeline.history({}), history);
});

test('history on an empty chat has an empty projection', async t => {
    const host = await createHost({ st: { chat: [] } });
    t.after(() => host.close());
    host.ctx.chat.length = 0;
    host.store.rebuild();
    assert.deepEqual(await host.sdk.timeline.history({}), { ok: true, messages: [], faded: [] });
});
