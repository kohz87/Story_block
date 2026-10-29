// Capabilities a module declares (`capabilities: [slug, …]` on its definition): they show in sdk.modules(),
// stCapabilities() offers them, and a pack's requires.capabilities is checked against them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { MAX_CAPABILITIES, definitionProblems, definitionWarnings } from '../../../src/v2/registry.js';
import { stCapabilities } from '../../../src/v2/packs/st-adapter.js';
import { validatePack } from '../../../src/v2/packs/validate.js';

const PACK = { id: 'capability-demo', version: '1.0.0', requires: { storyBlock: '^2', capabilities: ['custom-ledger'] }, content: {} };
const mod = (id, extra = {}) => ({ id, name: id, version: '1.0.0', domains: { [`${id}-state`.replace(/[^a-z-]/g, '')]: { initial: () => ({}) } }, ...extra });

async function withHost(modules, fn) {
    const host = await createHost({ fakes: true, core: true, modules });
    const saved = globalThis.StoryBlock;
    globalThis.StoryBlock = { sdk: host.sdk };
    try {
        return await fn(host);
    } finally {
        if (saved === undefined) delete globalThis.StoryBlock; else globalThis.StoryBlock = saved;
        host.close?.();
    }
}

test('sdk.modules() lists a module\'s declared capabilities as a frozen, deduped list; empty when it declares none', async () => {
    await withHost([mod('rules-mod', { capabilities: ['custom-ledger', 'fights', 'custom-ledger'] }), mod('plain-mod')], async host => {
        const byId = Object.fromEntries(host.sdk.modules().map(module => [module.id, module]));
        assert.deepEqual(byId['rules-mod'].capabilities, ['custom-ledger', 'fights']);
        assert.ok(Object.isFrozen(byId['rules-mod'].capabilities));
        assert.deepEqual(byId['plain-mod'].capabilities, []);
        assert.ok(Object.isFrozen(byId['plain-mod'].capabilities));
        assert.deepEqual(byId['story-block'].capabilities, []);
    });
});

test('a dormant module still declares its capabilities (installing a pack is library-level)', async () => {
    const peer = { ...mod('waits-mod', { capabilities: ['custom-ledger'] }), requires: { peers: { 'absent-peer': '>=1.0.0' } } };
    await withHost([peer], async host => {
        const entry = host.sdk.modules().find(module => module.id === 'waits-mod');
        assert.equal(entry.status, 'dormant');
        assert.deepEqual(entry.capabilities, ['custom-ledger']);
        assert.ok(stCapabilities().includes('custom-ledger'));
    });
});

test('stCapabilities() includes the capabilities modules declare, read from a real host', async () => {
    await withHost([mod('rules-mod', { capabilities: ['custom-ledger'] })], async () => {
        const names = stCapabilities();
        for (const name of ['story-block', 'rules-mod', 'inventory', 'scene', 'custom-ledger']) assert.ok(names.includes(name), name);
    });
    await withHost([mod('plain-mod')], async () => {
        assert.ok(!stCapabilities().includes('custom-ledger'));
    });
});

test('validatePack accepts the a pack when a module declares custom-ledger, and refuses it with the exact message when none does', async () => {
    await withHost([mod('rules-mod', { capabilities: ['custom-ledger'] })], async () => {
        const result = validatePack(PACK, { capabilities: stCapabilities() });
        assert.equal(result.ok, true, JSON.stringify(result.errors));
    });
    await withHost([mod('plain-mod')], async () => {
        const result = validatePack(PACK, { capabilities: stCapabilities() });
        assert.equal(result.ok, false);
        const missing = result.errors.find(error => error.code === 'MISSING_CAPABILITY');
        assert.equal(missing.message, 'This pack needs custom-ledger, which no installed module provides.');
        assert.equal(missing.path, 'requires.capabilities');
    });
});

test('the registry refuses malformed capabilities and accepts a good list', () => {
    const problems = capabilities => definitionProblems({ id: 'x', capabilities }).join(' / ');
    assert.deepEqual(definitionProblems({ id: 'x', capabilities: ['custom-ledger', 'fights'] }), []);
    assert.deepEqual(definitionProblems({ id: 'x', capabilities: [] }), []);
    assert.deepEqual(definitionWarnings({ id: 'x', capabilities: ['fights'] }), [], 'a known field');
    assert.match(problems('custom-ledger'), /capabilities is not a list/);
    assert.match(problems({ 'custom-ledger': true }), /capabilities is not a list/);
    assert.match(problems([7]), /capabilities names 7, which is not a capability name/);
    assert.match(problems(['Has Space']), /capabilities names "Has Space"/);
    assert.match(problems(['UPPER']), /capabilities names "UPPER"/);
    assert.match(problems(['-lead']), /capabilities names "-lead"/);
    assert.match(problems(['a'.repeat(65)]), /capabilities names/);
    assert.match(problems(['']), /capabilities names ""/);
    assert.match(problems(Array.from({ length: MAX_CAPABILITIES + 1 }, (_, i) => `cap-${i}`)), /capabilities lists more than 32 names/);
    assert.deepEqual(definitionProblems({ id: 'x', capabilities: Array.from({ length: MAX_CAPABILITIES }, (_, i) => `cap-${i}`) }), []);
});
