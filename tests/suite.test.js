// The Story Suite registry (src/suite.js, shared byte for byte with Story Director, NPC State
// Delta): announcements, owners, listeners, the upgrade path, and the reader's
// Source of truth choices. Every test starts from an empty globalThis.StorySuite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AREAS, SUITE_VERSION, isSourceOfTruth, storySuite } from '../src/suite.js';

function fresh() {
    delete globalThis.StorySuite;
    return storySuite();
}

const block = (owns = ['scene', 'items', 'stats', 'rolls']) => ({ id: 'story-block', name: 'Story Block', version: '0.8.0', owns });
const battle = (owns = ['stats', 'items', 'rolls']) => ({ id: 'sample-extension', name: 'Sample Extension', version: '1.0.0', owns });

test('the first caller creates the registry on globalThis; later callers join it', () => {
    const suite = fresh();
    assert.equal(globalThis.StorySuite, suite);
    assert.equal(storySuite(), suite, 'the same registry, not a second one');
    assert.equal(suite.version, SUITE_VERSION);
    assert.equal(suite.areas, AREAS);
    assert.ok(Object.isFrozen(suite));
});

test('announce: providers are copies, owns is deduplicated, an id is required, a second announce updates', () => {
    const suite = fresh();
    suite.announce({ ...block(['scene', 'scene', 'items']), api: { ping: () => 'pong' } });
    suite.announce({ name: 'Nameless', owns: ['scene'] });
    suite.announce({ id: '   ', owns: ['scene'] });
    const [only, ...rest] = suite.providers();
    assert.equal(rest.length, 0, 'no id, no announcement');
    assert.deepEqual([only.id, only.name, only.version, only.owns, only.enabled], ['story-block', 'Story Block', '0.8.0', ['scene', 'items'], true]);
    only.owns.push('stats');
    assert.deepEqual(suite.providers()[0].owns, ['scene', 'items'], 'callers cannot change the registry through a copy');
    assert.equal(suite.has('story-block'), true);
    assert.equal(suite.api('story-block').ping(), 'pong');
    assert.equal(suite.api('nobody'), null);

    suite.announce(block(['stats']));
    assert.equal(suite.providers().length, 1);
    assert.deepEqual(suite.providers()[0].owns, ['stats']);
    assert.equal(suite.api('story-block'), null, 'an announcement without an api shares none');
});

test('owner: the first in AREAS order that offers the area, whatever the load order', () => {
    const suite = fresh();
    suite.announce(battle());
    suite.announce(block());
    assert.equal(suite.owner('stats'), 'story-block', 'the listed owner wins');
    assert.equal(suite.owner('items'), 'story-block', 'though Sample Extension announced first');
    assert.equal(suite.owner('rolls'), 'story-block');
    assert.equal(suite.owner('scene'), 'story-block');
    assert.equal(suite.owner('calendar'), null, 'nobody offers it');
    assert.equal(suite.owner('no-such-area'), null);
});

test('owner falls back to any provider offering the area, also for an area AREAS does not list', () => {
    const suite = fresh();
    suite.announce({ id: 'weather-ext', name: 'Weather', owns: ['scene', 'weather'] });
    assert.equal(suite.owner('scene'), 'weather-ext', 'not in the list, but the only one offering it');
    assert.equal(suite.owner('weather'), 'weather-ext');
    suite.announce(block(['scene']));
    assert.equal(suite.owner('scene'), 'story-block', 'a listed owner comes first');
});

test('a disabled provider offers nothing and shares nothing', () => {
    const suite = fresh();
    suite.announce({ ...battle(), enabled: false, api: { members: () => [] } });
    suite.announce(block());
    assert.equal(suite.has('sample-extension'), false);
    assert.equal(suite.api('sample-extension'), null);
    assert.equal(suite.owner('stats'), 'story-block');
    assert.deepEqual(suite.offering('stats'), ['story-block']);
});

test('offering: everyone offering an area, owner first', () => {
    const suite = fresh();
    suite.announce(block());
    suite.announce({ id: 'npc-state-delta', name: 'NPC State Delta', owns: ['scene', 'stats'] });
    suite.announce(battle());
    assert.deepEqual(suite.offering('stats'), ['story-block', 'npc-state-delta', 'sample-extension']);
    assert.deepEqual(suite.offering('scene'), ['story-block', 'npc-state-delta']);
    assert.deepEqual(suite.offering('calendar'), []);
});

test('withdraw: removes the provider and notifies only when there was one', () => {
    const suite = fresh();
    let calls = 0;
    suite.onChange(() => { calls += 1; });
    suite.announce(battle());
    suite.announce(block());
    assert.equal(calls, 2);
    suite.withdraw('sample-extension');
    assert.equal(calls, 3);
    assert.equal(suite.owner('stats'), 'story-block', 'the next in line owns it');
    suite.withdraw('sample-extension');
    assert.equal(calls, 3, 'withdrawing twice notifies once');
    assert.equal(suite.has('sample-extension'), false);
});

test('onChange: every listener on each change, a throwing one skipped, unsubscribe works', () => {
    const suite = fresh();
    const seen = [];
    const warn = console.warn;
    console.warn = () => {};
    try {
        suite.onChange(() => { throw new Error('boom'); });
        const off = suite.onChange(() => seen.push(suite.owner('stats')));
        suite.announce(block(['stats']));
        suite.announce(battle(['stats']));
        assert.equal(off(), true);
        suite.withdraw('sample-extension');
    } finally {
        console.warn = warn;
    }
    assert.deepEqual(seen, ['story-block', 'story-block']);
});

test('upgrade: a newer registry takes over an older one and keeps its providers and listeners', () => {
    delete globalThis.StorySuite;
    // An older version's registry, as another extension may have left it on globalThis.
    const providers = new Map([['sample-extension', { ...battle(), enabled: true, owns: ['stats'] }]]);
    let heard = 0;
    globalThis.StorySuite = {
        version: 1,
        snapshot: () => [...providers.entries()],
        listenersSnapshot: () => [() => { heard += 1; }],
    };
    const suite = storySuite();
    assert.equal(suite.version, 2);
    assert.equal(globalThis.StorySuite, suite);
    assert.equal(suite.owner('stats'), 'sample-extension', 'the older registry\'s providers carry over');
    suite.announce(block(['stats']));
    assert.equal(heard, 1, 'the older registry\'s listeners carry over');

    // A registry of this version or newer is joined, never replaced.
    const newer = { version: SUITE_VERSION + 1 };
    globalThis.StorySuite = newer;
    assert.equal(storySuite(), newer);
    delete globalThis.StorySuite;
});

test('isSourceOfTruth alone: every choice says this extension', () => {
    const suite = fresh();
    for (const choice of ['auto', 'mine', 'theirs']) {
        assert.equal(isSourceOfTruth('story-block', 'stats', choice, suite), true, `${choice}, nobody announced`);
    }
    suite.announce(block(['stats']));
    for (const choice of ['auto', 'mine', 'theirs']) {
        assert.equal(isSourceOfTruth('story-block', 'stats', choice, suite), true, `${choice}, only Story Block announced`);
    }
    suite.announce(battle(['items']));
    assert.equal(isSourceOfTruth('story-block', 'stats', 'theirs', suite), true, 'another extension that does not offer the area does not count');
});

test('isSourceOfTruth with another extension: auto follows the owner, mine and theirs override it', () => {
    const suite = fresh();
    suite.announce(block());
    suite.announce(battle());
    // Stats: Story Block owns them by default.
    assert.equal(isSourceOfTruth('story-block', 'stats', 'auto', suite), true);
    assert.equal(isSourceOfTruth('story-block', 'stats', 'mine', suite), true);
    assert.equal(isSourceOfTruth('story-block', 'stats', 'theirs', suite), false);
    assert.equal(isSourceOfTruth('sample-extension', 'stats', 'auto', suite), false);
    // Items: Story Block owns them.
    assert.equal(isSourceOfTruth('story-block', 'items', 'auto', suite), true);
    assert.equal(isSourceOfTruth('story-block', 'items', 'theirs', suite), false);
    assert.equal(isSourceOfTruth('sample-extension', 'items', 'auto', suite), false);
    assert.equal(isSourceOfTruth('sample-extension', 'items', 'mine', suite), true);
    // The default choice is auto, and the default suite is the shared one.
    assert.equal(isSourceOfTruth('story-block', 'stats'), true);
    // Not offering an area itself, an extension is its source of truth only when nobody else is.
    assert.equal(isSourceOfTruth('story-block', 'calendar', 'auto', suite), true);
});
