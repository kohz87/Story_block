// B-b5b-robust-r2-6: the new clamps cut strings by UTF-16 code units, so they can split a surrogate pair and
// leave a lone surrogate (invalid Unicode) in the prompt on every reply:
// - sdk.js:37 settingValue `text.slice(0, f.max)`: currency "a" + 12 × "💰" (25 units, max 24) is stored
//   as "a💰…💰\ud83d", and the tail's Wallet line carries it ("Wallet: 5 a💰…\ud83ds");
// - turn.js:80 flatName `flat.slice(0, MAX_NAME - 1)`: a persona name of 78 letters + "🐉🐉" ends "\ud83d…".
// (Story Director's oneLine cuts by code points, Array.from, and is fine.)
//
// B-b5b-robust-r2-7: settings.set keeps top-level text and int fields to their schema, but a `list` field's
// rows are stored as given: sub-field max / min / max are not applied, nor is a row count.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '../../../src/v2/registry.js';
import { createSettings } from '../../../src/v2/sdk.js';
import { flatName, MAX_NAME } from '../../../src/v2/turn.js';
import { createHost } from '../../../testkit/index.js';

const wellFormed = text => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);

test('B-b5b-robust-r2-6: flatName never cuts a character in half', () => {
    const name = flatName(`${'B'.repeat(MAX_NAME - 2)}🐉🐉🐉`);
    assert.ok(wellFormed(name), `flatName gave ${JSON.stringify(name.slice(-6))}`);
});

test('B-b5b-robust-r2-6: a clipped text setting never ends in half a character, and neither does the tail', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    try {
        const stored = host.settings.set('story-block', 'currency', `a${'💰'.repeat(12)}`);
        assert.ok(wellFormed(stored), `stored ${JSON.stringify(stored.slice(-4))}`);
        await host.send('hi', 'We find coin.\n\n<Changes>\n+ coin 5 | from: a purse\n</Changes>');
        await host.send('next', 'Quiet.');
        for (const message of host.st.requests.at(-1).chat) assert.ok(wellFormed(message.content), `a ${message.role} message holds a lone surrogate`);
    } finally {
        host.close();
    }
});

test('B-b5b-robust-r2-7: settings.set applies a list field\'s sub-field limits', () => {
    const registry = createRegistry();
    registry.register({
        id: 'shop', name: 'Shop',
        settings: {
            defaults: { stops: [] },
            schema: { stops: { type: 'list', of: { place: { type: 'text', max: 80 }, days: { type: 'int', min: 1, max: 400 } } } },
        },
    });
    const es = {};
    const settings = createSettings({ root: () => es, registry, save: () => {} });
    settings.set('shop', 'stops', [{ place: 'x'.repeat(1_000_000), days: 1e9 }]);
    const [row] = es.storySuite.modules.shop.stops;
    assert.ok(row.place.length <= 80, `place stored at ${row.place.length} characters (max 80)`);
    assert.ok(row.days <= 400, `days stored as ${row.days} (max 400)`);
});
