import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHost } from '../../testkit/index.js';
import { rulesModule, clone, reload } from './helpers/timeline.js';
import { historyCompat } from './helpers/history-compat.js';
import { allRuleNames } from '../../src/v2/turn/rule-marks.js';
const main = JSON.parse(readFileSync(new URL('./helpers/fixtures/history-main.json', import.meta.url)));
for (const guarded of [false, true]) test(`no-timeline ${guarded ? 'guarded' : 'legacy'} chat is byte-identical to main at ${guarded ? main.mergedMain : main.branchPoint}`, async () => {
    const now = await historyCompat(guarded);
    // The one difference from main: every reply captured now carries its rule marks (turn/rule-marks.js), `foeCap: 20` and `rules` (every rule name).
    // The opening greeting is not captured by this code and has none. Swipe copies carry their reply's marks.
    let marked = 0;
    for (const message of now.chat) for (const record of [message.extra?.storySuite, ...(message.swipe_info ?? []).map(info => info.extra?.storySuite)]) {
        if (!record?.receipts || !('foeCap' in record)) continue;
        assert.equal(record.foeCap, 20);
        assert.deepEqual(record.rules, allRuleNames());
        delete record.foeCap; delete record.rules; marked++;
    }
    assert.ok(marked >= 2);
    assert.equal(JSON.stringify(now), JSON.stringify(main[guarded ? 'guarded' : 'plain']));
});

test('a guarded chat written at the branch point stays byte-identical on reload', async t => {
    const image = clone(main.oldGuarded);
    const host = await reload(createHost, image, [rulesModule()]);
    t.after(() => host.close());
    assert.equal(JSON.stringify(host.ctx.chat), JSON.stringify(main.oldGuarded.chat));
    assert.deepEqual(host.head(), main.oldGuarded.head);
    assert.equal(host.ctx.chatMetadata.storySuite?.timeline, undefined);
});
