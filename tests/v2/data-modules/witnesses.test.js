// The two silent-state regressions from review 111, including replay from stored spans
// with checkpoints removed. Equality of live/cold alone would miss both original bugs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../../src/v2/store.js';
import { createCommandBus } from '../../../src/v2/commands.js';
import { definition, int, pack, world, pin, reply, success, inactive, spansOf, directorStub } from './helpers.js';

function assertCold(host, check) {
    check(host.store);
    const chat = structuredClone(host.ctx.chat);
    const first = chat.findIndex(message => !message.is_user && message.extra?.storySuite);
    for (const [index, message] of chat.entries()) {
        if (index === first) continue; // The native baseline precedes the first saved operation.
        for (const holder of [message.extra, ...(message.swipe_info ?? []).map(info => info.extra)]) {
            if (!holder?.storySuite) continue;
            delete holder.storySuite.checkpoint; delete holder.storySuite.covers; delete holder.storySuite.coverHash;
        }
    }
    const store = createStore({ chat: () => chat, save: async () => {}, scratch: name => host.registry.scratch(name) });
    createCommandBus({ store, registry: host.registry, settings: host.settings });
    store.ensureInitial(host.registry.initialState());
    check(store);
    assert.deepEqual(store.head(), host.head());
    assert.deepEqual(store.problems(), host.store.problems());
    host.store.rebuild();
    check(host.store);
}
const fields = (store, module = 'pack.dm-test/counter') => store.head().domains.dataModules.instances[module].chat.fields;
const title = { bindings: {}, values: {}, when: ['ge', ['get', ['score']], 5], effects: [{ op: 'set', path: ['title'], value: true }] };

for (const [name, effect] of [
    ['set', { op: 'set', path: ['score'], value: 5 }],
    ['clamped add', { op: 'add', path: ['score'], value: 1, bounds: 'clamp' }],
    ['clamp', { op: 'clamp', path: ['score'], min: 1, max: 5 }],
]) test(`a no-op ${name} witnesses its original destination before using the internal value for a reward`, async t => {
    const d = definition(); d.state = { score: int(1, 1, 5), title: { type: 'bool', default: false } };
    d.rewards = { title };
    d.kinds = {
        prime: { op: '!', labels: {}, effects: [{ op: 'set', path: ['score'], value: 5 }] },
        repeat: { op: '!', labels: {}, when: ['ge', ['get', ['score']], 1], effects: [effect, { op: 'reward', template: 'title', bind: {} }] },
    };
    const host = await world(t, pack([d])); await pin(host);
    await host.send('A.', reply('! dm counter — A | kind: prime'));
    const source = host.ctx.chat.length - 1;
    await host.send('B.', reply('! dm counter — B | kind: repeat'));
    assertCold(host, store => assert.deepEqual(fields(store), { score: 5, title: true }));
    await host.st.deleteMessage(source);
    assertCold(host, store => {
        assert.deepEqual(fields(store), { score: 1, title: false });
        assert.equal(store.problems().filter(problem => problem.code === 'REPLAY_PREREQUISITE').length, 1);
    });
    assert.match(inactive(host)[0].reason ?? inactive(host)[0].message, /Re-read/);
    success(await host.turn.reread(host.ctx.chat.length - 1));
    assert.equal(inactive(host).length, 0);
    assert.equal(fields(host.store).title, name === 'set');
});

test('repeated writes witness the original prefix, never an intermediate draft value', async t => {
    const d = definition(); d.kinds.gain.effects = [2, 3, 3].map(value => ({ op: 'set', path: ['points'], value }));
    const host = await world(t, pack([d])); await pin(host);
    await host.send('Write.', reply('+ dm counter — several writes | kind: gain'));
    assert.equal(inactive(host).length, 0);
    assertCold(host, store => assert.equal(fields(store).points, 3));
});

for (const mode of ['recorded', 'prefix']) for (const gate of ['kind', 'rule', 'reward']) {
    test(`${mode} clock used by a ${gate} needs a prefix witness after deleting its advance`, async t => {
        const d = definition(); d.state = { title: { type: 'bool', default: false } };
        d.imports = { clock: { query: 'director.time', mode, projection: ['minutes'] } };
        const when = ['ge', ['input', 'clock', 'minutes'], 1060];
        const effects = [{ op: 'set', path: ['title'], value: true }];
        d.kinds = { gain: { op: '!', labels: {}, effects: gate === 'kind' ? effects : [] } };
        if (gate === 'kind') d.kinds.gain.when = when;
        if (gate === 'rule') d.rules = [{ id: 'late', when, then: effects }];
        if (gate === 'reward') {
            d.rewards = { title: { bindings: {}, values: {}, when, effects } };
            d.kinds.gain.effects = [{ op: 'reward', template: 'title', bind: {} }];
        }
        const p = pack([d]); p.requires.capabilities.push('story-director');
        const host = await world(t, p, [directorStub()]); await pin(host);
        await host.send('Advance.', reply('! time 60'));
        const source = host.ctx.chat.length - 1;
        await host.send('Title.', reply('! dm counter — late enough | kind: gain'));
        assertCold(host, store => assert.equal(fields(store).title, true));
        await host.st.deleteMessage(source);
        assertCold(host, store => {
            assert.equal(store.head().domains.director.time.minutes, 1000);
            assert.equal(fields(store).title, false);
            assert.equal(store.problems().filter(problem => problem.code === 'REPLAY_PREREQUISITE').length, 1);
        });
        success(await host.turn.reread(host.ctx.chat.length - 1));
        assert.equal(fields(host.store).title, false);
        assert.equal(inactive(host).length, 0);
    });
}

for (const indirect of [false, true]) test(`recorded public eligibility ${indirect ? 'through a write' : 'in a condition'} needs its live value`, async t => {
    const source = definition(); source.exports = { score: { fields: ['points'] } };
    const d = definition(); d.slug = 'follower'; d.state.title = { type: 'bool', default: false };
    d.imports = { score: { query: 'dataModules.public', args: { module: 'pack.dm-test/counter', export: 'score' }, mode: 'recorded', projection: ['points'] } };
    const input = ['input', 'score', 'points'];
    d.kinds.gain.effects = indirect ? [{ op: 'set', path: ['points'], value: input }] : [];
    d.rules = [{ id: 'eligible', when: ['ge', indirect ? ['get', ['points']] : input, 1], then: [{ op: 'set', path: ['title'], value: true }] }];
    const host = await world(t, pack([source, d])); await pin(host); await pin(host, [], 1);
    await host.send('Source.', reply('+ dm counter — earned | kind: gain'));
    const index = host.ctx.chat.length - 1;
    await host.send('Title.', reply('+ dm follower — eligible | kind: gain'));
    assert.equal(fields(host.store, 'pack.dm-test/follower').title, true);
    await host.st.deleteMessage(index);
    assertCold(host, store => {
        assert.equal(fields(store, 'pack.dm-test/follower').title, false);
        assert.equal(store.problems().filter(problem => problem.code === 'REPLAY_PREREQUISITE').length, 1);
    });
});

test('recorded actor identities need the prefix that created the actor', async t => {
    const d = definition(); d.imports = { actors: { query: 'checks.policy', mode: 'recorded', projection: ['actors.id', 'actors.name'] } };
    const p = pack([d]); p.requires.capabilities.push('story-director');
    const host = await world(t, p, [directorStub({ actors: [] })]); await pin(host);
    await host.send('Actor.', 'Wessel arrives.');
    success(await host.sdk.command('test.actor', { id: 'ca_wessel01', name: 'Wessel' }));
    const source = host.ctx.chat.length - 1;
    await host.send('Action.', reply('+ dm counter — with Wessel | kind: gain'));
    assert.equal(fields(host.store).points, 1);
    await host.st.deleteMessage(source);
    assertCold(host, store => {
        assert.equal(fields(store).points, 0);
        assert.equal(store.problems().filter(problem => problem.code === 'REPLAY_PREREQUISITE').length, 1);
    });
});

for (const mode of ['recorded', 'prefix']) test(`${mode} public imports require their subject actor even when its exported value still exists`, async t => {
    const source = definition(); source.scope = 'character'; source.state.points.default = 7;
    source.exports = { score: { fields: ['points'] } };
    const d = definition(); d.slug = 'follower';
    d.imports = { score: { query: 'dataModules.public', args: {
        module: 'pack.dm-test/counter', export: 'score', who: 'ca_wessel01',
    }, mode, projection: ['points'] } };
    d.kinds.gain.effects = [{ op: 'set', path: ['points'], value: ['input', 'score', 'points'] }];
    const p = pack([source, d]); p.requires.capabilities.push('story-director');
    const host = await world(t, p, [directorStub()]);
    await pin(host, ['Wessel']); await pin(host, [], 1);
    await host.send('Away.', 'Wessel leaves.');
    success(await host.sdk.command('test.actor', { id: 'ca_wessel01', name: null }));
    await host.send('Return.', 'Wessel returns.');
    success(await host.sdk.command('test.actor', { id: 'ca_wessel01', name: 'Wessel' }));
    const restored = host.ctx.chat.length - 1;
    await host.send('Copy.', reply('+ dm follower — copy | kind: gain'));
    assert.equal(fields(host.store, 'pack.dm-test/follower').points, 7);
    await host.st.deleteMessage(restored);
    assertCold(host, store => {
        // Removing the actor does not erase its pinned instance or exported field. Availability
        // must therefore be witnessed separately from the projected import value, in both modes.
        assert.equal(store.head().domains.dataModules.instances['pack.dm-test/counter'].characters.ca_wessel01.fields.points, 7);
        assert.equal(fields(store, 'pack.dm-test/follower').points, 0);
        assert.equal(store.problems().filter(problem => problem.code === 'REPLAY_PREREQUISITE').length, 1);
    });
});

test('deleting an offer source invalidates its later award', async t => {
    const d = definition(); d.state = { score: int(5, 1, 5), title: { type: 'bool', default: false } }; d.rewards = { title };
    d.kinds = {
        offer: { op: '!', labels: {}, effects: [{ op: 'offer', key: 'title', template: 'title', bind: {} }] },
        award: { op: '!', labels: {}, effects: [{ op: 'award', offer: 'title' }] },
    };
    const host = await world(t, pack([d])); await pin(host);
    await host.send('Offer.', reply('! dm counter — earned | kind: offer'));
    const source = host.ctx.chat.length - 1;
    await host.send('Award.', reply('! dm counter — claim | kind: award'));
    assert.equal(fields(host.store).title, true);
    await host.st.deleteMessage(source);
    assertCold(host, store => {
        assert.equal(fields(store).title, false);
        assert.equal(store.problems().filter(problem => problem.code === 'REPLAY_PREREQUISITE').length, 1);
    });
    assert.ok(spansOf(host, 'dm.act').length);
});
