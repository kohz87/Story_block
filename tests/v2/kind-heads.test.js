// A kind spec may carry `heads` (['+ event', '~ event', ...]) and no grammar line: the registry keeps the kind for stray-line reading, the prompt
// gets no text for it. Without `heads` a kind with no grammar is still refused, and kinds with a grammar line behave exactly as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '../../src/v2/registry.js';
import { staticParts } from '../../src/v2/prompt.js';
import { extractBlock, grammarHeads, parseChanges } from '../../src/v2/capture.js';

const mod = (id, kinds) => ({ id, name: id, version: '1.0.0', domains: { [id]: { initial: () => ({}), validate: () => [] } }, capture: { kinds, apply: () => ({}) } });
const TALLY = { tally: { grammar: '+ tally Name' } };
const EVENT = { event: { grammar: '', heads: ['+ event', '~ event', '- event', '! event'] } };
const registryOf = (...mods) => { const registry = createRegistry(); for (const def of mods) registry.register(def); return registry; };
const heads = registry => grammarHeads(registry.contexts().flatMap(context => context.kinds));
const lines = body => (body === null ? [] : parseChanges(body).lines.map(line => line.raw));

test('a kind with an empty grammar and heads is kept by contexts(), and its heads are read', () => {
    const registry = registryOf(mod('a-tally', TALLY), mod('b-event', EVENT));
    const kinds = registry.contexts().flatMap(context => context.kinds);
    assert.deepEqual(kinds.map(entry => [entry.kind, entry.grammar]), [['tally', '+ tally Name'], ['event', '']]);
    assert.deepEqual(kinds[1].heads, ['+ event', '~ event', '- event', '! event']);
    assert.deepEqual([...heads(registry)].sort(), ['! event', '+ event', '+ tally', '- event', '~ event']);
});

test('a stray line of that kind written outside <Changes> is taken; without heads it is not', () => {
    const withEvent = heads(registryOf(mod('a-tally', TALLY), mod('b-event', EVENT))), without = heads(registryOf(mod('a-tally', TALLY)));
    const bell = 'The bell tolls over the square.\n\n! event Bell';
    assert.deepEqual(lines(extractBlock(bell, 'Changes', null, { heads: withEvent })), ['! event Bell']);
    assert.deepEqual(lines(extractBlock(bell, 'Changes', null, { heads: without })), [], 'no heads: the event line stays story');
    const rope = 'The rope is coiled.\n\n+ tally Rope';
    assert.deepEqual([withEvent, without].map(set => lines(extractBlock(rope, 'Changes', null, { heads: set }))), [['+ tally Rope'], ['+ tally Rope']], 'a kind with a grammar line reads as before');
    const spoofed = grammarHeads([{ kind: 'event', grammar: '', heads: ['+ other', 'event', '+ event extra'] }]);
    assert.equal(spoofed.size, 0, 'only "op kind" for the kind itself');
});

test('the prompt bytes are unchanged: no empty grammar line, and kinds without heads give the same static text', () => {
    const plain = staticParts(registryOf(mod('a-tally', TALLY)))[0].text;
    const withHeads = staticParts(registryOf(mod('a-tally', TALLY), mod('b-event', EVENT)))[0].text;
    assert.equal(withHeads, plain);
    assert.ok(!/\n\n|\n$/.test(withHeads));
});

test('a kind with no grammar and no heads is still refused', () => {
    const registry = createRegistry();
    assert.throws(() => registry.register(mod('c-bad', { thing: { grammar: '' } })), /no grammar line/);
    assert.throws(() => registry.register(mod('d-bad', { thing: { grammar: '', heads: ['thing'] } })), /no grammar line/);
});
