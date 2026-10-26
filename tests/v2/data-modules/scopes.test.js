// Character scope, actors, absent peers and recorded imports (DATA_MODULES.md sections 2, 3 and 4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { refusedFrom } from '../../../src/v2/reply-notes.js';
import { fixture, reply, int, definition, pack, success, world, pin, view, rebuilt, inactive, directorStub } from './helpers.js';

const MEAL = who => `! dm survival — ate | kind: meal | who: ${who}`;
const hunger = (host, id = 'ca_wessel01') => host.head().domains.dataModules.instances['pack.ersveil-survival/survival'].characters[id].fields.hunger;
// The refusals on the reply card (a clamp's "Requested -20; applied +0" note is not one).
const reasons = host => refusedFrom(host.turn.problems(), host.ctx.chat.length - 1).map(row => row.reason).filter(reason => /nothing applied/.test(reason));

async function camp(t, actors) {
    const host = await world(t, fixture('survival'), [directorStub({ actors })]);
    await host.send('Begin.', 'Opening.');
    return host;
}

test('who is one attached SD actor by name or ca_ id; an ac_ id, an unknown name and an unattached actor are refused', async t => {
    const host = await camp(t, [{ id: 'ca_wessel01', name: 'Wessel', bonuses: {} }, { id: 'ca_odda0001', name: 'Odda', bonuses: {} }]);
    await pin(host, ['ca_wessel01']);
    await host.send('Raise.', reply('! time 600'));
    assert.equal(hunger(host), 20);
    await host.send('By name.', reply(MEAL('wessel')));
    assert.equal(hunger(host), 0, 'names match without case or width');
    await host.send('Again.', reply('! time 600', MEAL('ca_wessel01')));
    assert.equal(hunger(host), 0);
    for (const who of ['ac_12345678', 'Nobody', 'Odda']) {
        await host.send('Refused.', reply(MEAL(who)));
        assert.match(reasons(host)[0], /^Survival: who must be an attached character \(Wessel\)|^Survival: who must name a Story Director actor/, who);
        assert.match(reasons(host)[0], /nothing applied\.$/);
    }
    await host.send('Chat scope has no who.', reply('! dm survival — ate | kind: meal'));
    assert.match(reasons(host)[0], /who is missing|who must/);
    rebuilt(host);
});

test('two attached actors with the same name are ambiguous and both are named; a removed actor refuses new work and its saved instance stays', async t => {
    const host = await camp(t, [{ id: 'ca_wessel01', name: 'Wessel', bonuses: {} }, { id: 'ca_wessel02', name: 'Wessel', bonuses: {} }]);
    await pin(host, ['ca_wessel01', 'ca_wessel02']);
    await host.send('Which?', reply(MEAL('Wessel')));
    assert.match(reasons(host)[0], /Survival: who is ambiguous: Wessel \(ca_wessel01\) and Wessel \(ca_wessel02\) both fit/);
    await host.send('By id.', reply(MEAL('ca_wessel02')));
    assert.deepEqual(reasons(host), []);
    success(await host.sdk.command('test.actor', { id: 'ca_wessel02', name: null }));
    await host.send('Gone.', reply(MEAL('ca_wessel02')));
    assert.equal(reasons(host).length, 1);
    assert.ok(host.head().domains.dataModules.instances['pack.ersveil-survival/survival'].characters.ca_wessel02, 'the saved instance stays');
    assert.equal(view(host, 'pack.ersveil-survival/survival').characters.find(row => row.id === 'ca_wessel02').name, 'ca_wessel02', 'listed by its id once the name is gone');
    // No timer step is made for it either, and nothing complains every reply.
    await host.send('Time.', reply('! time 120'));
    assert.equal(hunger(host, 'ca_wessel01'), 4);
    assert.equal(hunger(host, 'ca_wessel02'), 0);
    rebuilt(host);
});

test('without Story Director the survival module waits with a plain reason: Setup says so, enabling and lines are refused, nothing is written', async t => {
    const host = await world(t, fixture('survival'));
    await host.send('Begin.', 'Opening.');
    const [row] = host.sdk.query('dataModules.setup');
    assert.equal(row.status, 'Waiting');
    assert.match(row.reason, /Story Director/);
    const before = JSON.stringify(host.head());
    const result = await host.sdk.command('dm.pin', { module: row.module, hash: row.hash, packHash: row.packHash, subjects: [] });
    assert.equal(result.code, 'DEPENDENCY_UNAVAILABLE');
    assert.equal(JSON.stringify(host.head()), before);
});

test('a recorded import is a snapshot: a guard never reads it again, so the source can change without staling the action', async t => {
    const source = definition(); source.exports = { score: { fields: ['points'] } };
    const follower = definition(); follower.slug = 'follower';
    follower.imports = { score: { query: 'dataModules.public', args: { module: 'pack.dm-test/counter', export: 'score' }, mode: 'recorded', projection: ['points'] } };
    follower.kinds.gain.effects = [{ op: 'set', path: ['points'], value: ['input', 'score', 'points'] }];
    const live = definition(); live.slug = 'watcher'; live.exports = {};
    const prefixFollower = definition(); prefixFollower.slug = 'prefixed';
    prefixFollower.imports = { score: { ...follower.imports.score, mode: 'prefix' } };
    prefixFollower.kinds.gain.effects = follower.kinds.gain.effects;
    const host = await world(t, pack([source, follower, prefixFollower]));
    await host.send('Begin.', 'Opening.');
    for (const index of [0, 1, 2]) await pin(host, [], index);
    await host.send('One.', reply('+ dm counter — a | kind: gain'));
    const first = host.ctx.chat.length - 1;
    await host.send('Copy.', reply('+ dm follower — copy | kind: gain', '+ dm prefixed — copy | kind: gain'));
    assert.equal(view(host, 'pack.dm-test/follower').chat.points, 1);
    assert.equal(view(host, 'pack.dm-test/prefixed').chat.points, 1);
    await host.st.deleteMessage(first);
    // The recorded copy stays as it was recorded; the prefix copy needed the live value and waits for a Re-read.
    assert.equal(view(host, 'pack.dm-test/follower').chat.points, 1);
    assert.equal(view(host, 'pack.dm-test/prefixed').chat.points, 0);
    assert.equal(inactive(host).length, 1);
    void live; void int;
});

test('a peer that registers late wakes the module: Waiting becomes Available and enabling works, with no restart', async t => {
    const host = await world(t, fixture('survival'));
    await host.send('Begin.', 'Opening.');
    assert.equal(host.sdk.query('dataModules.setup')[0].status, 'Waiting');
    await host.sdk.registerModule(directorStub());
    const [row] = host.sdk.query('dataModules.setup');
    assert.notEqual(row.status, 'Waiting', row.reason);
    success(await host.sdk.command('dm.pin', { module: row.module, hash: row.hash, packHash: row.packHash, subjects: ['Wessel'] }));
    await host.send('Rest.', reply('! time 120'));
    assert.equal(hunger(host), 4);
    rebuilt(host);
});
