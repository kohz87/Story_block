// A capture kind marked `fallback: true` (Story Block's story-check `? check` line): it answers its word only while no module owns it, takes no ownership,
// leaves the grammar out once another module owns the word, never blocks that module's registration (before or after it), and is no "module keeps checks".
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '../../src/v2/registry.js';

const block = () => ({ id: 'story-block', capture: { kinds: { check: { fallback: true, grammar: '? check Name | skill | difficulty | die' } }, apply: () => ({}) } });
const director = () => ({ id: 'story-director', capture: { kinds: { check: { grammar: '? check skill — what | dc: easy' } }, apply: () => ({}) } });
const grammars = registry => registry.contexts().flatMap(context => context.kinds.map(kind => `${context.moduleId}: ${kind.grammar}`));

test('alone, the fallback kind answers the word and is told in the grammar, but nothing "keeps" it', () => {
    const registry = createRegistry();
    registry.register(block());
    assert.equal(registry.capture('check')?.moduleId, 'story-block');
    assert.deepEqual(grammars(registry), ['story-block: ? check Name | skill | difficulty | die']);
});

for (const order of [['story-block', 'story-director'], ['story-director', 'story-block']]) {
    test(`with Story Director's own check kind (${order.join(' then ')}): both register, the owner answers, the fallback's grammar is left out`, () => {
        const registry = createRegistry();
        for (const id of order) registry.register(id === 'story-block' ? block() : director());
        assert.equal(registry.capture('check')?.moduleId, 'story-director');
        assert.deepEqual(grammars(registry), ['story-director: ? check skill — what | dc: easy']);
    });
}
