// The prelude list (turn.js runCues, registry.isPrelude): any command a module marks `prelude` goes the way Assist's
// pre-roll goes: asked for by beforeGenerate, previewed with a seed for the prompt, stored on the generated reply before
// its story lines with that seed, kept by a Re-read, rolled anew by a swipe. Shown here with a made-up module.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, hostAvailable } from '../../../testkit/index.js';
import { createRegistry, definitionProblems, definitionWarnings } from '../../../src/v2/registry.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;

// `zz.roll` rolls a d20 from its seed and says so; `zz.plain` is the same without the mark (an ordinary cue command).
function dice({ prelude = true, object = false } = {}) {
    const roll = (ctx, { key }) => {
        if (!ctx.claim(`zz:roll:${key}`)) ctx.fail('CLAIMED', 'Already rolled.');
        const die = ctx.roll('d20').total;
        ctx.draft('zz').rolls += 1;
        return { summary: `Die: ${die}.`, narrate: true, replan: true };
    };
    const command = object ? { handler: roll, prelude } : Object.assign(roll, prelude ? { prelude: true } : {});
    return {
        id: 'zz-dice', name: 'Dice', version: '0.0.1',
        domains: { zz: { initial: () => ({ rolls: 0 }) } },
        commands: { 'zz.roll': command },
        hooks: {
            beforeGenerate(view, info) {
                if (info.commit === false) return null;
                return { commands: [{ type: 'zz.roll', payload: { key: String(view.chat.lastUser).length.toString(36) + String(view.chat.length) } }] };
            },
        },
    };
}

const tailOf = request => request.chat.filter(message => message.role === 'system').map(message => message.content).join('\n');
const dieOf = host => host.ctx.chat.flatMap(message => message.extra?.storySuite?.receipts ?? []).filter(receipt => receipt.type === 'zz.roll');

test('registry.isPrelude: a handler function or an object marked prelude, nothing else', () => {
    const registry = createRegistry();
    const flagged = () => ({ summary: 'x' });
    flagged.prelude = true;
    registry.register({ id: 'host-steps', domains: { steps: { initial: () => ({}) } }, commands: { 'steps.object': { handler: () => ({}), prelude: true }, 'steps.flag': flagged, 'steps.open': { handler: () => ({}) }, 'steps.off': { handler: () => ({}), prelude: false } } });
    assert.deepEqual(['steps.object', 'steps.flag', 'steps.open', 'steps.off', 'no.such', undefined].map(type => registry.isPrelude(type)), [true, true, false, false, false, false]);
    assert.deepEqual(definitionProblems({ id: 'bad', commands: { 'bad.a': { handler: () => {}, prelude: 'yes' } } }), ['command "bad.a" prelude is not true or false']);
    assert.deepEqual(definitionWarnings({ id: 'ok', commands: { 'ok.a': { handler: () => {}, prelude: true, internal: true } } }), []);
});

for (const object of [false, true]) {
    test(`a prelude command (${object ? 'object' : 'function'} form) is previewed, stored on the reply, kept by a Re-read, rolled anew by a swipe`, { skip }, async () => {
        const host = await createHost({ core: false, modules: [dice({ object })] });
        const { request } = await host.send('Roll for me.', 'You roll.');
        const [roll] = dieOf(host);
        assert.ok(roll, 'stored on the generated reply');
        assert.equal(roll.beforeGenerate, true);
        assert.equal(host.ctx.chat.indexOf(host.ctx.chat.find(message => message.extra?.storySuite?.receipts?.includes?.(roll))) > 0, true);
        assert.ok(tailOf(request).includes(`[Happened]\n${roll.summary}`), 'the preview is what the reply was told');
        assert.deepEqual(host.ctx.chat[2].extra.storySuite.narrated, [roll.id]);

        assert.equal((await host.turn.reread(2)).ok, true);
        const [kept] = dieOf(host);
        assert.equal(kept.seed, roll.seed, 'a Re-read keeps the dice');
        assert.equal(kept.summary, roll.summary);

        await host.swipe('Again.');
        const seeds = new Set([roll.seed, dieOf(host)[0].seed]);
        await host.regenerate('Once more.');
        seeds.add(dieOf(host)[0].seed);
        assert.equal(seeds.size, 3, 'a new generation, a new seed');
        assert.equal(dieOf(host).length, 1);
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live);
        host.close();
    });
}

test('a command that is not marked prelude is committed when the cue is built, as before', { skip }, async () => {
    const host = await createHost({ core: false, modules: [dice({ prelude: false })] });
    await host.send('Roll for me.', 'You roll.');
    const [roll] = dieOf(host);
    assert.ok(roll);
    assert.equal(roll.beforeGenerate, undefined, 'not a prelude');
    assert.equal(host.ctx.chat[0].extra.storySuite.receipts.includes(roll) || host.ctx.chat[0].extra.storySuite.receipts.some(receipt => receipt.id === roll.id), true, 'it went on the reply before');
    host.close();
});

test('two preludes of different kinds each keep their own seed through a Re-read', { skip }, async () => {
    const second = dice();
    second.id = 'zz-dice2';
    second.domains = { zz2: { initial: () => ({ rolls: 0 }) } };
    second.commands = { 'zz.roll2': Object.assign((ctx, { key }) => {
        ctx.claim(`zz:roll2:${key}`);
        ctx.draft('zz2').rolls += 1;
        return { summary: `Second die: ${ctx.roll('d20').total}.`, narrate: true, replan: true };
    }, { prelude: true }) };
    second.hooks = { beforeGenerate: (view, info) => (info.commit === false ? null : { commands: [{ type: 'zz.roll2', payload: { key: String(view.chat.length) } }] }) };
    const host = await createHost({ core: false, modules: [dice(), second] });
    await host.send('Roll for me.', 'You roll.');
    const types = () => host.ctx.chat[2].extra.storySuite.receipts.filter(receipt => receipt.beforeGenerate).map(receipt => [receipt.type, receipt.seed, receipt.summary]);
    const before = types();
    assert.deepEqual(before.map(entry => entry[0]).sort(), ['zz.roll', 'zz.roll2']);
    assert.equal((await host.turn.reread(2)).ok, true);
    assert.deepEqual(types().sort(), before.sort());
    host.close();
});
