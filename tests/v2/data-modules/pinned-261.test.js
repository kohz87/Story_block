// A chat saved by 2.6.1 is a wire-compatibility fixture, including its original guards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHost } from '../../../testkit/index.js';
import { renderDataModules } from '../../../src/v2/data-modules/setup.js';
import { installFakeDom } from '../../ui-fake-dom.js';

const chat = () => readFileSync(new URL('../fixtures/fixture-2.6.1-pinned-ersveil.jsonl', import.meta.url), 'utf8')
    .trim().split('\n').slice(1).map(line => JSON.parse(line));
// The chat was saved with Ersveil 2.0.0; 2.1.0 (the example pack now) changed only lore and place names.
const pack = () => JSON.parse(readFileSync(new URL('../fixtures/ersveil-2.0.0-pack.json', import.meta.url), 'utf8'));
const current = () => JSON.parse(readFileSync(new URL('../../../examples/packs/ersveil/pack.json', import.meta.url), 'utf8'));
const hashes = {
    'pack.ersveil/standing': '208561d9520010fca4d537a520be3ab4b735711a12614846e7dd201050e0a627',
    'pack.ersveil/fame': '208a5fa654a78c475a7820154bc8630f5ccd643ac1cbdd41a7d9dec99b3a9d8a',
    'pack.ersveil/guild-membership': '6938a74e11fd618cb0fba021a0011f3c6872e32aa1c8b80104bd6a828c27f62f',
};
const packHash = '2d25e224ca30e1a0a77693f31f19ce31f03b4c5be9045d1972e23f0936004623';
const expected = {
    'pack.ersveil/standing': { standing: { highmark: 0, confederacy: 0, shornmarch: 0, church: 0, auvoth: 0, guild: 2, nightingale: 0, hand: 0, veil: 0, 'broken-chain': 0 } },
    'pack.ersveil/fame': { fame: { bluewatch: 4, shornmarch: 0, auvoth: 0, confederacy: 0, highmark: 0, aurelion: 0, 'border-kingdoms': 0, ironanvil: 0, chieftainates: 0, ardelia: 0, shackles: 0, vargate: 0, tidebound: 0, verdantleaf: 0, ashkaran: 0, startrace: 0 } },
    'pack.ersveil/guild-membership': { registered: true, letter: 'F', standing: 'probation', dues: 50, 'unpaid-years': 0, 'idle-years': 0, 'member-years': 0 },
};

function assertPinned(host, offerPackHash = packHash) {
    const domain = host.head().domains.dataModules;
    for (const [module, hash] of Object.entries(hashes)) {
        assert.equal(domain.active[module].hash, hash, module);
        assert.equal(domain.pins[hash].packHash, packHash, module);
        assert.deepEqual(host.sdk.query('dataModules.view', { module }), { chat: expected[module] }, module);
        const offer = host.sdk.query('dataModules.offers').find(row => row.module === module);
        assert.equal(offer.hash, hash, `fresh offer for ${module}`);
        assert.equal(offer.packHash, offerPackHash, `fresh pack identity for ${module}`);
        const row = host.sdk.query('dataModules.setup').find(row => row.module === module);
        assert.equal(row.status, 'Pinned', module);
    }
    assert.deepEqual(host.store.problems().filter(problem => problem.code === 'REPLAY_PREREQUISITE'), []);
}

test('2.6.1 Ersveil pins, values and identities survive replay, rebuild and reload', async t => {
    const host = await createHost({ st: { chat: chat() } });
    t.after(() => host.close());
    const installed = await host.packs.packs.install(pack());
    assert.equal(installed.ok, true, installed.message);
    assertPinned(host);
    const live = structuredClone(host.head().domains.dataModules);
    host.store.rebuild();
    assert.deepEqual(host.head().domains.dataModules, live);
    assertPinned(host);
    const loaded = await createHost({ st: { chat: structuredClone(host.ctx.chat), extensionSettings: structuredClone(host.ctx.extensionSettings) } });
    t.after(() => loaded.close());
    assert.deepEqual(loaded.head().domains.dataModules, live);
    assertPinned(loaded);
    const doc = installFakeDom();
    const root = doc.createElement('div');
    renderDataModules(root, host.sdk).refresh();
    assert.equal((root.textContent.match(/Pinned/g) ?? []).length, 3);
    assert.doesNotMatch(root.textContent, /Migration available|Available/);
});

test('the 2.6.1 pin and action guards retain their recorded inputs and rules markers', async t => {
    const messages = chat();
    const guarded = messages.flatMap(message => message.extra?.storySuite?.spans ?? []).filter(span => span.guard?.predicate?.kind?.startsWith('dm.'));
    assert.equal(guarded.length, 6);
    assert.deepEqual(guarded.map(span => span.guard.inputHash), [
        '3e50995950b2bfc34593902c4b9a769ba755fa71c69e0c29ee76e74b4603ebc0',
        'd7ef258fd202bb4b0658c6410d20fa55f92f52e794a329f5cea3c82868c651ea',
        '401c3dea397cf2c6a4971881a926fda92e66aff699277aa68413128674cbd0fc',
        '9ba0a8ab9ca489665ed7a844436dde70a31db4795364c5a048c9841d6b8dd837',
        '1d1ee5e1ef6b04301683dcabb778f09d5eed79df7517ee1d2781f6d93f585507',
        'fae113593a728d817a7e9a5b0fb832802d5b901907e7af2473e706f8466896dd',
    ]);
    assert.ok(guarded.every(span => span.guard.rulesHash === null));
    const host = await createHost({ st: { chat: messages } });
    t.after(() => host.close());
    assert.equal((await host.packs.packs.install(pack())).ok, true);
    host.store.rebuild();
    assertPinned(host);
});

test('a 2.6.1 chat with a rules hash keeps its pin and guarded action', async t => {
    // Generated by d5fdb46 with a small rules owner; both guards carry its non-null marker.
    const saved = JSON.parse(readFileSync(new URL('../fixtures/fixture-2.6.1-rules-hash.json', import.meta.url), 'utf8'));
    const rulesHash = 'a'.repeat(64);
    const rules = { id: 'test-rules', version: '1.0.0', domains: { rules: { initial: () => ({ rulesVersion: 1, rulesHash }) } } };
    const host = await createHost({ modules: [rules], st: { chat: saved.chat } });
    t.after(() => host.close());
    assert.equal((await host.packs.packs.install(saved.pack)).ok, true);
    const module = 'pack.history/counter';
    const hash = '2c257b2d20fbf6589343e316b5c0330733386fa127aeac673855ec2b753eb4ee';
    const packHash = 'ccbd291fcf2e58951e48c7b008d05964aa3ac1b260f42b245decf0cecd528187';
    const guards = saved.chat.flatMap(message => message.extra?.storySuite?.spans ?? []).filter(span => span.guard?.predicate?.module === module);
    assert.deepEqual(guards.map(span => span.guard.rulesHash), [rulesHash, rulesHash]);
    assert.deepEqual(guards.map(span => span.guard.inputHash), [
        '7ea78f3ced80bbfd9f4a2e06adc1beca1ec882ffc3ccbef00dd9e4da2ea3791c',
        '6b99c6a8ee83a64cbf4015f2db9e6a7ce69938c8fec1f3b159fc7e6f415e75b0',
    ]);
    const check = () => {
        assert.equal(host.head().domains.rules.rulesHash, rulesHash);
        assert.equal(host.head().domains.dataModules.active[module].hash, hash);
        assert.equal(host.head().domains.dataModules.pins[hash].packHash, packHash);
        assert.deepEqual(host.sdk.query('dataModules.view', { module }), { chat: { points: 1 } });
        assert.equal(host.sdk.query('dataModules.offers')[0].hash, hash);
        assert.equal(host.sdk.query('dataModules.offers')[0].packHash, packHash);
        assert.equal(host.sdk.query('dataModules.setup')[0].status, 'Pinned');
        assert.deepEqual(host.store.problems().filter(problem => problem.code === 'REPLAY_PREREQUISITE'), []);
    };
    check();
    host.store.rebuild();
    check();
    await host.st.loadChat(structuredClone(host.ctx.chat));
    check();
});

test('re-importing the example pack as 2.2.0 keeps the 2.6.1 pins, values and status', async t => {
    // 2.2.0's world events record lasting changes in Story Director's chronicle: a stand-in gives the capability.
    const host = await createHost({ st: { chat: chat() }, modules: [{ id: 'chronicle-stand-in', version: '1.0.0', capabilities: ['chronicle-lasting'] }] });
    t.after(() => host.close());
    assert.equal((await host.packs.packs.install(pack())).ok, true);
    const updated = current();
    assert.equal(updated.version, '2.2.0');
    const installed = await host.packs.packs.install(updated);
    assert.equal(installed.ok, true, installed.message);
    const fresh = host.sdk.query('dataModules.offers').find(row => row.module === 'pack.ersveil/standing').packHash;
    assert.notEqual(fresh, packHash);
    assertPinned(host, fresh);
    host.store.rebuild();
    assertPinned(host, fresh);
});
