import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHost } from '../../testkit/index.js';
import { rulesModule, clone, reload } from './helpers/timeline.js';
import { historyCompat } from './helpers/history-compat.js';
const main = JSON.parse(readFileSync(new URL('./helpers/fixtures/history-main.json', import.meta.url)));
for (const guarded of [false, true]) test(`no-timeline ${guarded ? 'guarded' : 'legacy'} chat is byte-identical to main at ${guarded ? main.mergedMain : main.branchPoint}`, async () => {
    assert.equal(JSON.stringify(await historyCompat(guarded)), JSON.stringify(main[guarded ? 'guarded' : 'plain']));
});

test('a guarded chat written at the branch point stays byte-identical on reload', async t => {
    const image = clone(main.oldGuarded);
    const host = await reload(createHost, image, [rulesModule()]);
    t.after(() => host.close());
    assert.equal(JSON.stringify(host.ctx.chat), JSON.stringify(main.oldGuarded.chat));
    assert.deepEqual(host.head(), main.oldGuarded.head);
    assert.equal(host.ctx.chatMetadata.storySuite?.timeline, undefined);
});
