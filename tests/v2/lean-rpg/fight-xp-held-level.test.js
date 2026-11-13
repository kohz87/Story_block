// 2.17.0 final review: a narrator XP line that raises a level in the reply that wins the fight is held back, and the fight pays at the level before it.
import test from 'node:test';
import assert from 'node:assert/strict';
const { createHost } = await import('../../../testkit/index.js');
const { createFakeModel } = await import('../../../testkit/model.js');
const { LEAN_RPG_FEATURE } = await import('../../../src/v2/lean-rpg/index.js');
const { STANDARD_TEMPLATES, characterV1For } = await import('../../../src/v2/lean-rpg/templates.js');
const { reply, success } = await import('../../../tests/v2/data-modules/helpers.js');

const SLOT = '+ dm foes — why | kind: set-slot-1 | name: Mud Crawlers | count: 6 | level: 1';
const DOWN = '~ dm foes — why | kind: hurt-1 | to: 0';
const XP = amount => `+ dm character — why | kind: add-xp | amount: ${amount}`;

async function world(t, { level = 2, xp = 0, rate, cap } = {}) {
    const host = await createHost({ callModel: createFakeModel(['none']), settings: { modules: { 'story-block': { ...(rate === undefined ? {} : { rpgXpRate: rate }) } } } });
    t.after(() => host.close());
    host.features.set(LEAN_RPG_FEATURE, true);
    await host.send('Begin.', 'Opening.');
    // (the narrator's XP line and the hold belong to the Character made before the marked one)
    const def = name => (name === 'Character' ? characterV1For() : structuredClone(STANDARD_TEMPLATES.find(e => e.name === name).definition));
    success(await host.sdk.command('dm.define', { definition: def('Character') }));
    success(await host.sdk.command('dm.set', { module: 'pack.chat/character', fields: { who: 'Astra', level, xp, ...(cap ? { cap } : {}) } }));
    success(await host.sdk.command('dm.define', { definition: def('Foes') }));
    return host;
}
const f = host => host.head().domains.dataModules.instances['pack.chat/character'].chat.fields;
const same = async host => {
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, 'rebuild');
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(JSON.stringify(host.head()), live, 'reload');
};

{
    test(`narrator +80 (rise 2->3, +1 point) in the winning reply is put back, code XP paid`, async t => {
        const host = await world(t, { level: 2, xp: 90 });
        await host.send('A swarm.', reply(SLOT));
        const before = { ...f(host) };
        await host.send('I finish them.', reply(XP(80), DOWN));
        const a = f(host);

        // 6*1*2*90%*2 = 21.6 -> 21: 90+21 = 111 -> level 3, xp 11, +1 point.
        assert.deepEqual([a.level, a.xp, a.points], [3, 11, 1]);
        await same(host);
        assert.equal((await host.turn.reread(4)).ok, true);
        assert.deepEqual([f(host).level, f(host).xp, f(host).points], [3, 11, 1]);
    });
}

test('narrator XP across two lines in one reply, multi-level with rate 300', async t => {
    const host = await world(t, { level: 1, xp: 0, rate: 300 });
    await host.send('Quest done.', reply(XP(100)));
    const a = f(host);

    assert.deepEqual([a.level, a.xp, a.points], [4, 0, 1]);
    await same(host);
});

test('cap: level 4 cap 5, narrator +100 x2 -> level 5, xp 100', async t => {
    const host = await world(t, { level: 4, xp: 50, cap: 5 });
    await host.send('Quest done.', reply(XP(100)));
    const a = f(host);

    assert.deepEqual([a.level, a.xp], [5, 50]);
    await same(host);
});
