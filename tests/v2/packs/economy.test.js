// A pack's money scale (MODULES §F104): the optional `economy: { scale, note }` field, packs.economy,
// Story Block's `inventory.economy` query (settings, then the pack, then 1) and the scaled built-in
// default (the 1000 × level coin budget). Numbers a pack writes itself are never scaled.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validatePack } from '../../../src/v2/packs/validate.js';
import { economyOf as packEconomyOf } from '../../../src/v2/packs/content.js';
import { createPacksPart } from '../../../src/v2/packs/index.js';
import { ECONOMY_LIMITS, PACK_FIELDS } from '../../../src/v2/packs/limits.js';
import { createInventoryQueries, economyOf, scaledDefault } from '../../../src/v2/domains/inventory.js';
import { CORE_SETTINGS } from '../../../src/v2/domains/index.js';
import { createHost } from '../../../testkit/index.js';
import { fakeSettings } from './helpers/fake-settings.js';
import { pack } from './helpers/fixtures.js';

function ok(value) {
    const result = validatePack(value);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    return result.pack;
}

function refused(value, code, path) {
    const result = validatePack(JSON.stringify(value));
    assert.equal(result.ok, false, `${path} should be refused`);
    const hit = result.errors.find(error => error.path === path);
    assert.ok(hit, `no error at ${path}: ${JSON.stringify(result.errors)}`);
    assert.equal(hit.code, code, hit.message);
    assert.ok(hit.message.length > 20, 'a sentence the reader can act on');
}

test('economy is an optional top-level field: { scale 0.001–1000 (default 1), note }', () => {
    assert.ok(PACK_FIELDS.includes('economy'));
    assert.equal(ok(pack()).economy, null, 'left out: no scale');
    assert.deepEqual(ok(pack({ economy: {} })).economy, { scale: 1, note: '' });
    assert.deepEqual(ok(pack({ economy: { scale: 0.01, note: ' One coin is a copper. ' } })).economy, { scale: 0.01, note: 'One coin is a copper.' });
    for (const scale of [ECONOMY_LIMITS.min, 1, 2.5, ECONOMY_LIMITS.max]) assert.equal(ok(pack({ economy: { scale } })).economy.scale, scale);
    for (const scale of [0, -1, 0.0009, 1001, '1', null, true]) refused(pack({ economy: { scale } }), 'BAD_ECONOMY', 'economy.scale');
    for (const economy of [1, 'copper', [], null]) refused(pack({ economy }), 'BAD_ECONOMY', 'economy');
    for (const note of [7, 'x'.repeat(501)]) refused(pack({ economy: { note } }), 'BAD_ECONOMY', 'economy.note');
    refused(pack({ economy: { scale: 1, coin: 'mark' } }), 'UNKNOWN_FIELD', 'economy.coin');
});

test('numbers the pack writes stay exactly as written', () => {
    const made = ok(pack({ economy: { scale: 0.01 }, content: { items: [{ name: 'Draught', value: 30 }], shops: [{ name: 'Shop', stock: [{ item: 'Draught', price: 45 }] }], ranks: [{ id: 'F', reward: [50, 400] }] } }));
    assert.equal(made.content.items[0].value, 30);
    assert.equal(made.content.shops[0].stock[0].price, 45);
    assert.deepEqual(made.content.ranks[0].reward, [50, 400]);
});

test('packs.economy: the first enabled pack that sets one; scales are not mixed', async () => {
    const plain = ok(pack({ id: 'plain' }));
    const copper = ok(pack({ id: 'copper', economy: { scale: 0.01, note: 'copper' } }));
    const rich = ok(pack({ id: 'rich', economy: { scale: 10 } }));
    assert.equal(packEconomyOf([]), null);
    assert.equal(packEconomyOf([plain]), null);
    assert.deepEqual(packEconomyOf([plain, copper, rich]), { pack: 'copper', scale: 0.01, note: 'copper' });
    const { part, packs, economy } = createPacksPart({ settings: fakeSettings() });
    assert.equal(part.queries['packs.economy'](), null);
    await packs.install(JSON.stringify(pack({ id: 'copper', economy: { scale: 0.01 } })));
    assert.deepEqual(economy(), { pack: 'copper', scale: 0.01, note: '' });
    await packs.setEnabled('copper', false);
    assert.equal(part.queries['packs.economy'](), null, 'a switched-off pack sets nothing');
});

test('inventory.economy: the reader\'s setting, else the pack\'s, else 1', () => {
    assert.deepEqual(economyOf({}, null), { scale: 1, source: 'default' });
    assert.deepEqual(economyOf({ economyScale: '0' }, { scale: 0.01 }), { scale: 0.01, source: 'pack' });
    assert.deepEqual(economyOf({ economyScale: '' }, { scale: 0.01 }), { scale: 0.01, source: 'pack' });
    assert.deepEqual(economyOf({ economyScale: ' 0.5 ' }, { scale: 0.01 }), { scale: 0.5, source: 'settings' });
    assert.deepEqual(economyOf({ economyScale: 3 }, null), { scale: 3, source: 'settings' });
    for (const bad of ['abc', '-1', '1e9', '0.0001', null]) assert.deepEqual(economyOf({ economyScale: bad }, null), { scale: 1, source: 'default' }, String(bad));
    assert.deepEqual(economyOf({}, { scale: 5000 }), { scale: 1, source: 'default' }, 'a pack scale out of range is not used');
    const queries = createInventoryQueries({ settings: () => ({ economyScale: '0' }), economy: () => ({ scale: 0.1 }) });
    assert.deepEqual(queries['inventory.economy'](), { scale: 0.1, source: 'pack' });
    assert.deepEqual(createInventoryQueries({ settings: () => ({}) })['inventory.economy'](), { scale: 1, source: 'default' }, 'no packs part: 1');
    assert.deepEqual(createInventoryQueries({ settings: () => ({}), economy: () => { throw new Error('x'); } })['inventory.economy'](), { scale: 1, source: 'default' });
    assert.equal(CORE_SETTINGS.defaults.economyScale, '0');
    assert.equal(CORE_SETTINGS.schema.economyScale.type, 'text');
});

test('a scaled default is a whole number of at least 1', () => {
    assert.equal(scaledDefault(1000, 1), 1000);
    assert.equal(scaledDefault(1000, 0.01), 10);
    assert.equal(scaledDefault(1000, 0.0015), 2);
    assert.equal(scaledDefault(1000, 0.001), 1);
    assert.equal(scaledDefault(10, 0.001), 1, 'never 0');
    assert.equal(scaledDefault(1000, 2.5), 2500);
    assert.equal(scaledDefault(1000, 'bad'), 1000);
});

const reply = (text, lines) => `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const coin = host => host.head().domains.inventory.wallets.party?.coin ?? 0;

async function fresh(t) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    return host;
}

test('money scale does not set the story budget', async t => {
    const host = await fresh(t);
    assert.equal((await host.packs.packs.install(pack({ id: 'copper', economy: { scale: 0.01 } }))).ok, true);
    await host.send('Chest.', reply('Coins.', ['+ coin 500']));
    assert.equal(coin(host), 500);
    host.settings.set('story-block', 'storyCoinPerReply', 7);
    await host.send('A purse.', reply('Coins.', ['+ coin 500']));
    assert.equal(coin(host), 507);
});
