import test from 'node:test';
import assert from 'node:assert/strict';
import { definition, directorStub, pack, pin, reply, view, world, reload } from '../data-modules/helpers.js';

for (const mode of ['prefix', 'recorded']) test(`field edits witness ${mode} inputs used by rules`, async t => {
    const d = definition();
    d.state.title = { type: 'bool', default: false };
    d.imports = { clock: { query: 'director.time', mode, projection: ['minutes'] } };
    d.rules = [{ id: 'late', when: ['ge', ['input', 'clock', 'minutes'], 1060], then: [{ op: 'set', path: ['title'], value: true }] }];
    const p = pack([d]); p.requires.capabilities.push('story-director');
    const host = await world(t, p, [directorStub()]);
    const offer = await pin(host);
    await host.send('Advance.', reply('! time 60'));
    const source = host.ctx.chat.length - 1;
    await host.send('Set.', 'The road.');
    const result = await host.sdk.command('dm.set', { module: offer.module, field: 'points', value: 5 });
    assert.equal(result.ok, true, result.message);
    assert.equal(view(host, offer.module).chat.title, true);
    await reload(host);
    await host.st.deleteMessage(source);
    assert.equal(view(host, offer.module).chat.points, 0);
    assert.equal(view(host, offer.module).chat.title, false);
    assert.ok(host.store.problems().some(problem => problem.code === 'REPLAY_PREREQUISITE'));
    await reload(host);
});
