// R2-b7-combos-1: the `requires.storyBlock` handshake (#78) drops pre-release tags on BOTH sides
// (packs/version.js: "2.0.0-alpha.3 counts as 2.0.0"). For the whole v2 alpha, when module and host
// change together alpha by alpha, the handshake therefore cannot say "needs alpha.3": a module
// declaring `>=2.0.0-alpha.3` (or even the release, `2.0.0`) registers on an alpha.1 host, while
// `>2.0.0-alpha.1` is refused on alpha.1 for the wrong reason (it is read as `>2.0.0`).
// Seen for real: RPG Battle 2f52c80 needs ctx.carrier.sid (claims `s:<sid>`); on the alpha.1 host
// (a1cf5b1) it registers and quietly brings back B-b2-timeline-10 (a new reply's wound refused by an
// older reply's claim) and fails its own F80 dice test - and neither side can tell.
// Drop into Story_block/tests/v2/break/.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRegistry } from '../../../src/v2/registry.js';
import { satisfies } from '../../../src/v2/packs/version.js';

const mod = range => ({ id: 'zz-needs', name: 'Needs', queries: { 'zz.ping': () => 'pong' }, requires: { storyBlock: range } });
const quiet = { warn: () => {} };

test('a module needing a later alpha is refused by an earlier alpha host', () => {
    const registry = createRegistry({ hostVersion: '2.0.0-alpha.1', ...quiet });
    assert.throws(() => registry.register(mod('>=2.0.0-alpha.3')), /needs Story Block/);
});

test('a module needing the 2.0.0 release is refused by a 2.0.0 alpha host', () => {
    const registry = createRegistry({ hostVersion: '2.0.0-alpha.1', ...quiet });
    assert.throws(() => registry.register(mod('>=2.0.0')), /needs Story Block/);
});

test('a later alpha satisfies a range that names an earlier one', () => {
    assert.equal(satisfies('2.0.0-alpha.3', '>2.0.0-alpha.1'), true);
    assert.equal(satisfies('2.0.0-alpha.1', '>=2.0.0-alpha.3'), false);
});
