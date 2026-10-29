import test from 'node:test';
import assert from 'node:assert/strict';
import { currencyOf, parseMixedAmount } from '../../../src/v2/domains/money.js';
import { createHost } from '../../../testkit/index.js';
import { core, stocked } from '../domains/fixtures.js';
import { createHarness } from '../domains/helpers/fake-ctx.js';

const currency = currencyOf({ coins: [{ name: 'copper', value: 1 }, { name: 'silver', value: 10 }, { name: 'gold', value: 100 }] });

test('mixed coins are converted safely to the smallest unit', () => {
    assert.deepEqual(parseMixedAmount('3 silver 5 copper', currency), { amount: 35 });
    assert.deepEqual(parseMixedAmount('0', currency), { amount: 0 });
    assert.deepEqual(parseMixedAmount('0 copper', currency), { amount: 0 });
    for (const value of ['-1 copper', '3 silver and 5 copper', '9007199254740992 copper', '2 unknown', '1.5 silver']) assert.ok(parseMixedAmount(value, currency).error, value);
});

test('wallet.set is reader only, allows zero, and reports the from and to', () => {
    const module = core();
    const h = createHarness(module, { state: stocked(module) });
    for (const options of [{ cause: 'story' }, { cause: 'system' }, { cause: 'ui', caller: 'another-module' }]) assert.equal(h.run('wallet.set', { amount: 5 }, options).code, 'REFUSED');
    for (const amount of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '5']) assert.equal(h.run('wallet.set', { amount }).code, 'INVALID');
    const result = h.run('wallet.set', { amount: 0 });
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(result.result.data, { edit: true, from: 125, to: 0 });
});

test('a purse edit is a counted difference and survives rebuild, reload and unchanged Re-read', async t => {
    const host = await createHost();
    t.after(() => host.close());
    await host.send('Find money.', 'Found.\n\n<Changes>\n+ coin 10\n</Changes>');
    const result = await host.sdk.command('wallet.set', { amount: 15 });
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(result.receipt.data, { edit: true, from: 10, to: 15 });
    const live = structuredClone(host.head());
    host.store.rebuild();
    assert.deepEqual(host.head(), live);
    const loaded = await createHost({ st: { chat: structuredClone(host.ctx.chat), extensionSettings: structuredClone(host.ctx.extensionSettings) } });
    t.after(() => loaded.close());
    assert.deepEqual(loaded.head(), live);
    assert.equal((await host.turn.reread(host.store.headIndex())).ok, true);
    assert.equal(host.sdk.query('inventory.wallet').coin, 15);
    await host.swipe('Nothing.');
    assert.equal(host.sdk.query('inventory.wallet').coin ?? 0, 0);
});

test('the purse pencil parses mixed coins before sending the command', async () => {
    const { homeScreen } = await import('../../../src/v2/screens/home.js');
    const { queries, show, settle } = await import('../screens/helpers.js');
    const module = core({}, { coins: [{ name: 'copper', value: 1 }, { name: 'silver', value: 10 }] });
    const state = stocked(module);
    const { el, calls } = show(homeScreen, { state, query: queries(module, state) });
    const pencil = el.querySelector('.wallet .ss-w-editable-pencil');
    pencil.click();
    const input = el.querySelector('.wallet .ss-w-editable-form input');
    input.value = '3 silver 5 copper';
    el.querySelector('.wallet .ss-w-editable-save').click();
    await settle();
    assert.deepEqual(calls.at(-1).slice(0, 2), ['wallet.set', { amount: 35 }]);
    assert.deepEqual(parseMixedAmount('0 gold'), { amount: 0 });
});
