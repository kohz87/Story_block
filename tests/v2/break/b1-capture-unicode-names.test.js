// B-b1-capture-11: Story Block keys item and present names without Unicode normalization, so the
// same name written precomposed (NFC "Rópe") and decomposed (NFD "Rópe") is two items and two
// people that look identical, and a `- item` in the other form is NOT_FOUND. Story Director
// normalizes the same names into one thread, so the modules disagree about who is who.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';

const reply = (text, lines) => `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const NFC = 'Rópe';
const NFD = 'Rópe';

async function fresh(t) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Hello.', 'The road.');
    return host;
}

test('an item gained in NFC and lost in NFD is the same item', async t => {
    const host = await fresh(t);
    await host.send('I take it.', reply('Rope.', [`+ item ${NFC}`]));
    await host.send('I drop it.', reply('Gone.', [`- item ${NFD}`]));
    assert.deepEqual(host.sdk.query('inventory.items'), []);
    assert.deepEqual(host.turn.problems().map(problem => problem.code), []);
});

test('the same person written in NFC and NFD is present once', async t => {
    const host = await fresh(t);
    await host.send('Who is here?', reply('Two arrive.', [`+ present ${NFC}`, `+ present ${NFD}`]));
    assert.equal(host.sdk.query('scene.present').length, 1, JSON.stringify(host.sdk.query('scene.present')));
});
