// The core module with its packs and events parts merged (MODULES §A, §E), on the real runtime
// through the testkit: a pack's start in the initial state, pack items before story items, the
// pack's currency name when the reader has none, and a pack event told before a reply.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHost } from '../../testkit/index.js';
import { mergeParts } from '../../src/v2/domains/index.js';

const sample = JSON.parse(readFileSync(new URL('../../examples/packs/riverside-starter/pack.json', import.meta.url), 'utf8'));
const installed = (pack, extra = {}) => ({ packs: [{ id: pack.id, version: pack.version, enabled: true, source: 'file', origin: 'test', pack }], ...extra });
const names = state => Object.values(state.domains.inventory.stacks).map(stack => state.domains.inventory.defs[stack.def].name).sort();

test('an enabled pack\'s start goes into the initial state; its currency names the money', async () => {
    const host = await createHost({ settings: installed(sample) });
    const head = host.head();
    assert.equal(head.domains.scene.place.name, 'Bluewatch Village');
    assert.deepEqual(head.domains.scene.present, ['Hollis']);
    assert.deepEqual(names(head), ['Hemp Line', 'Minor Healing Draught', 'Willow Rod']);
    assert.equal(head.domains.inventory.wallets.party.coin, 50);
    assert.ok(host.ctx.chat[0].extra.storySuite.checkpoint, 'the greeting holds it');
    assert.deepEqual(host.sdk.query('inventory.currency'), { name: 'pennies', short: 'p' });
    const { request } = await host.send('What do I carry?', 'Your rod.');
    assert.match(request.chat.at(-1).content, /50 pennies|50 p\b/);
    host.close();
});

test('the reader\'s own currency name wins over the pack\'s suggestion', async () => {
    const host = await createHost({ settings: installed(sample, { modules: { 'story-block': { currency: 'crowns' } } }) });
    assert.equal(host.sdk.query('inventory.currency').name, 'crowns');
    host.close();
});

test('without packs the initial state is the registry\'s and the money is gold', async () => {
    const host = await createHost();
    assert.equal(host.head().domains.scene.place.name, '');
    assert.deepEqual(names(host.head()), []);
    assert.equal(host.sdk.query('inventory.currency').name, 'gold');
    host.close();
});

test('a story item a pack defines uses the pack\'s def; an unknown one becomes story/<slug>', async () => {
    const host = await createHost({ settings: installed(sample) });
    await host.send('I fish.', 'A trout!\n<Changes>\n+ item moonveil trout | qty: 1\n+ item Old Boot\n</Changes>');
    const inv = host.head().domains.inventory;
    const trout = Object.values(inv.defs).find(def => def.name === 'Moonveil Trout');
    assert.match(trout.id, /^pack\.riverside-starter\//);
    const packTrout = sample.content.items.find(item => item.name === 'Moonveil Trout');
    if (packTrout.value !== undefined) assert.equal(trout.value, packTrout.value);
    if (packTrout.rarity !== undefined) assert.equal(trout.rarity, packTrout.rarity);
    assert.equal(inv.aliases['moonveil trout'], trout.id);
    assert.ok(inv.defs['story/old-boot']);
    host.close();
});

test('a pack event whose condition is met is told by the next reply, once', async () => {
    const pack = structuredClone(sample);
    pack.id = 'bells';
    pack.name = 'Bells';
    delete pack.start;
    pack.content = { items: [], events: [{ id: 'arrival', when: "query('scene.place').name == 'Bluewatch Village'", cue: 'Bells ring across Bluewatch.', once: true }] };
    const host = await createHost({ settings: installed(pack) });
    const quiet = await host.send('Walk.', 'You walk.\n<Changes>\n~ place Bluewatch Village | kind: settlement\n</Changes>');
    assert.ok(!quiet.request.chat.at(-1).content.includes('Bells ring'), 'not yet: the place changed in that reply');
    const { request } = await host.send('Listen.', 'Bells.');
    assert.ok(request.chat.at(-1).content.includes('[Happened]\nBells ring across Bluewatch.'));
    assert.equal(host.head().meta.claims['event:pack.bells/arrival'], true);
    const again = await host.send('More.', 'Quiet.');
    assert.ok(!again.request.chat.at(-1).content.includes('Bells ring'), 'told once');
    host.close();
});

test('mergeParts: name clashes throw; hooks of one name run in part order', async () => {
    assert.throws(() => mergeParts([{ commands: { 'a.b': () => {} } }, { commands: { 'a.b': () => {} } }]), /two parts both define the command "a\.b"/);
    const merged = mergeParts([
        { hooks: { pick: () => null, beforeGenerate: () => ['one'] } },
        { hooks: { pick: () => 'second', beforeGenerate: () => ({ lines: ['two'], commands: [{ type: 'x.y' }] }) } },
    ]);
    assert.equal(merged.hooks.pick(), 'second');
    assert.deepEqual(await merged.hooks.beforeGenerate({}), { lines: ['one', 'two'], commands: [{ type: 'x.y' }] });
    const budgets = mergeParts([{ context: { budget: 100 } }, { context: { budget: 50 } }]);
    assert.equal(budgets.budget, 150);
});
