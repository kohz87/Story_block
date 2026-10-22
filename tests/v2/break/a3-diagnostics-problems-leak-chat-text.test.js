// Breaker a3 (v2 pass 2): Settings -> Diagnostics promises "no chat text" (diagnostics.js header, CHANGELOG,
// MODULES F116-F118), but a Problem's message is only scrubbed of text inside straight/curly quotes.
// Real Problems name what the story wrote outside quotes ("There is no <item> in the inventory.") and a
// story line holding a quote mark breaks the quote pairing, so the text between two quoted runs is kept.
// Live (SillyTavern 1.19, SB+SD+NSD): Settings -> Diagnostics -> Copy report / Save report held the item name
// from the reply (scripts/diag.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { buildReport } from '../../../src/v2/diagnostics.js';

const R = (text, lines) => `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;

async function reportAfter(t, lines) {
    t.mock.method(console, 'warn', () => {});
    t.mock.method(console, 'error', () => {});
    const h = await createHost();
    t.after(() => h.close());
    await h.send('hi', R('The quay is wet.', lines));
    const problems = h.turn.problems();
    assert.ok(problems.length > 0, 'the reply made Problems');
    return buildReport({ problems: () => problems });
}

test('a refused line naming a story item: the item name is not in the report', async t => {
    const text = await reportAfter(t, ['- item SecretAmuletOfMira | qty: 1']);
    assert.ok(!text.includes('SecretAmuletOfMira'), `chat text in the report:\n${text.split('\n').filter(l => l.includes('SecretAmuletOfMira')).join('\n')}`);
});

test('a refused line holding a quote mark: no chat text survives between the quoted runs', async t => {
    const text = await reportAfter(t, ['- item Bob\'s "Lucky" mug of LeakyWords | qty: 1']);
    assert.ok(!/Lucky|LeakyWords/.test(text), `chat text in the report:\n${text.split('\n').filter(l => /Lucky|LeakyWords/.test(l)).join('\n')}`);
});
