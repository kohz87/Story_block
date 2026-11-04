// "+ Add item" with Kind = Equipment always makes equipment (docs/v2/GEAR.md "Your own gear"): a name this chat already has as something else is
// remade only when it is the reader's own and nobody else has a claim on it; a pack's or the story's (in use) is never changed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, hostAvailable } from '../../testkit/index.js';
import { addPlan } from '../../src/v2/view/gear-form.js';
import { validatePack } from '../../src/v2/packs/validate.js';
import { pack } from './packs/helpers/fixtures.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const reply = (...lines) => `The tide turns.\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const ACTORS = { id: 'zz-party', version: '0.0.0', queries: { 'party.actors': () => [{ id: 'ac_astra001', name: 'Astra', pc: true }], 'party.pc': () => ({ id: 'ac_astra001' }) } };
const READER = 'ac_astra001';

async function world(t, { packs = false } = {}) {
    t.mock.method(console, 'warn', () => {});
    const settings = { features: { 'story-block.gear': true, 'story-block.rpg': true } };
    if (packs) {
        const raw = pack({ content: { items: [{ name: 'Pack Rope', kind: 'goods' }] } });
        const built = validatePack(raw);
        assert.equal(built.ok, true, JSON.stringify(built.errors));
        settings.packs = [{ id: built.pack.id, version: built.pack.version, enabled: true, source: 'file', origin: 'test', pack: raw }];
    }
    const host = await createHost({ modules: [ACTORS], settings });
    t.after(() => host.close());
    return host;
}
// The payload "+ Add item" builds for Kind = Equipment (gear-form.js addPlan), so the test goes through the form's own plan.
const formAdd = (host, fields) => {
    const plan = addPlan({ kit: false })({}, { count: 1, kind: 'equipment', ...fields });
    assert.equal(plan.error, undefined);
    return host.sdk.command(plan.steps[0].command, plan.steps[0].payload);
};
const rowOf = (host, name) => host.sdk.query('inventory.items').find(item => item.name === name);
const defOf = (host, name) => Object.values(host.head().domains.inventory.defs).find(item => item.name === name);
const refused = (out, pattern) => { assert.equal(out.ok, false, 'should be refused'); assert.match(out.message ?? out.error?.message ?? JSON.stringify(out), pattern); };
// A reader's piece from before hand-made defs were marked (`hand`): added with gear off, as goods.
async function legacyGoods(host, name) {
    host.features.set('story-block.gear', false);
    const out = await host.sdk.command('inventory.add', { name, qty: 1, kind: 'goods' });
    assert.equal(out.ok, true);
    host.features.set('story-block.gear', true);
    assert.equal(defOf(host, name).hand, undefined);
    assert.equal(defOf(host, name).kind, 'goods');
}

test('a fresh add as Equipment is equipment, at the start and after the first message', { skip }, async t => {
    const host = await world(t);
    for (const name of ['Cane Sword', 'Traveling Robe']) assert.equal((await formAdd(host, { name })).ok, true);
    assert.deepEqual([defOf(host, 'Cane Sword').kind, defOf(host, 'Cane Sword').slot], ['equipment', 'weapon']);
    await host.send('Hello.', 'The road.');
    for (const name of ['Rusty Cane Sword', 'Old Traveling Robe']) assert.equal((await formAdd(host, { name })).ok, true);
    assert.equal(defOf(host, 'Rusty Cane Sword').kind, 'equipment');
    assert.equal(defOf(host, 'Old Traveling Robe').slot, 'body');
});

test('Equip on works in the same add as Equipment', { skip }, async t => {
    const host = await world(t);
    assert.equal((await formAdd(host, { name: 'Traveling Robe', equip: READER })).ok, true);
    assert.equal(rowOf(host, 'Traveling Robe').equipped, 'body');
});

test('a name with no slot word and no Slot chosen is refused with what to do; with a Slot it works', { skip }, async t => {
    const host = await world(t);
    refused(await formAdd(host, { name: 'Linen Clothes' }), /Choose a slot for Linen Clothes/);
    assert.equal(defOf(host, 'Linen Clothes'), undefined, 'nothing is left half made');
    refused(await formAdd(host, { name: 'Linen Clothes', equip: READER }), /Choose a slot for Linen Clothes/);
    assert.equal((await formAdd(host, { name: 'Linen Clothes', slot: 'body', equip: READER })).ok, true);
    assert.equal(rowOf(host, 'Linen Clothes').equipped, 'body');
});

test('the USER\'s sequence: saved as goods → delete → add again as Equipment with Equip on → worn', { skip }, async t => {
    const host = await world(t);
    await legacyGoods(host, 'Cane Sword');
    refused(await formAdd(host, { name: 'Cane Sword', equip: READER }), /Remove it first/);
    assert.equal(defOf(host, 'Cane Sword').kind, 'goods', 'a refusal changes nothing');
    assert.equal((await host.sdk.command('inventory.drop', { stack: rowOf(host, 'Cane Sword').stack })).ok, true);
    assert.equal((await formAdd(host, { name: 'Cane Sword', equip: READER })).ok, true);
    assert.deepEqual([defOf(host, 'Cane Sword').kind, defOf(host, 'Cane Sword').stack, defOf(host, 'Cane Sword').hand], ['equipment', false, true]);
    assert.equal(rowOf(host, 'Cane Sword').equipped, 'weapon');
});

test('a def the reader made by hand, with only the reader\'s stacks, is remade as equipment', { skip }, async t => {
    const host = await world(t);
    assert.equal((await host.sdk.command('inventory.add', { name: 'Linen Clothes', qty: 1, kind: 'goods' })).ok, true);
    assert.equal(defOf(host, 'Linen Clothes').hand, true);
    assert.equal((await formAdd(host, { name: 'Linen Clothes', slot: 'body', equip: READER })).ok, true);
    assert.deepEqual([defOf(host, 'Linen Clothes').kind, defOf(host, 'Linen Clothes').slot], ['equipment', 'body']);
    assert.equal(host.sdk.query('inventory.items').filter(row => row.name === 'Linen Clothes').length, 2);
});

test('a def the reader made by hand with a stack of two is refused, not split', { skip }, async t => {
    const host = await world(t);
    assert.equal((await host.sdk.command('inventory.add', { name: 'Linen Clothes', qty: 2, kind: 'goods' })).ok, true);
    refused(await formAdd(host, { name: 'Linen Clothes', slot: 'body' }), /Remove it first/);
    assert.equal(defOf(host, 'Linen Clothes').kind, 'goods');
});

test('a pack item of the same name is never changed', { skip }, async t => {
    const host = await world(t, { packs: true });
    assert.equal((await host.sdk.command('inventory.add', { name: 'Pack Rope', qty: 1 })).ok, true);
    const before = JSON.stringify(defOf(host, 'Pack Rope'));
    refused(await formAdd(host, { name: 'Pack Rope', slot: 'weapon' }), /Remove it first/);
    assert.equal(JSON.stringify(defOf(host, 'Pack Rope')), before);
});

test('a def the story made that is in use is never changed', { skip }, async t => {
    const host = await world(t);
    await host.send('Hello.', reply('+ item Tin Whistle | kind: goods'));
    const before = JSON.stringify(defOf(host, 'Tin Whistle'));
    assert.equal(defOf(host, 'Tin Whistle').kind, 'goods');
    refused(await formAdd(host, { name: 'Tin Whistle', slot: 'accessory-1' }), /Remove it first/);
    assert.equal(JSON.stringify(defOf(host, 'Tin Whistle')), before);
});
