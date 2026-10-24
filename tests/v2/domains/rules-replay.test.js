// Replay == live with a ready rules module: a reply that registered a definition (and its rule), and a reply
// that equipped a piece through a plan, are deleted and swiped like any other, and a cold rebuild from the chat
// says what the live state says. The rules module is the test-only stand-in (helpers/rb-stub.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { REN } from './helpers/rb-world.js';
import { createRbStub } from './helpers/rb-stub.js';

const reply = (text, lines) => `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
// A party of one and "Sunblade" made as a weapon, as a pack or a gear module would.
const gear = {
    id: 'zz-gear',
    queries: { 'party.actors': () => [{ id: REN, name: 'Ren' }], 'party.pc': () => ({ id: REN, level: 1 }) },
    hooks: { 'item.define': def => (def.name === 'Sunblade' ? { kind: 'equipment', slot: 'weapon', stack: false } : undefined) },
};

async function fresh(t) {
    t.mock.method(console, 'warn', () => {});
    const stub = createRbStub();
    const host = await createHost({ modules: [stub.module, gear] });
    t.after(() => host.close());
    return { host, stub };
}
const inv = host => host.head().domains.inventory;
const rules = host => Object.keys(host.head().domains.rbrules.rules).sort();
const stackOf = (host, def) => Object.values(inv(host).stacks).find(stack => stack.def === def);

test('deleting or swiping replies that registered a definition or equipped through a plan replays as it ran', async t => {
    const { host } = await fresh(t);
    await host.send('Find.', reply('A blade.', ['+ item Sunblade']));
    const first = host.ctx.chat.length - 1;
    const put = await host.sdk.command('inventory.equipOn', { stack: stackOf(host, 'story/sunblade').id, actor: REN });
    assert.equal(put.ok, true, put.message);
    assert.equal(stackOf(host, 'story/sunblade').equipped, 'weapon');
    await host.send('Then.', reply('A torch.', ['+ item Torch']));
    assert.deepEqual(rules(host), ['story/sunblade', 'story/torch']);

    // A swipe of the last reply: its definition and rule go with it, the earlier ones stay.
    await host.swipe(reply('A lantern.', ['+ item Lantern']));
    assert.deepEqual(rules(host), ['story/lantern', 'story/sunblade']);
    assert.equal(Object.hasOwn(inv(host).defs, 'story/torch'), false);
    assert.equal(stackOf(host, 'story/sunblade').equipped, 'weapon');
    let live = host.head();
    host.store.rebuild();
    assert.deepEqual(host.head(), live, 'a cold rebuild says the same');

    // Deleting the reply that registered the blade and carried the equip takes the definition, rule, stack and
    // worn slot with it, and keeps the later reply's own.
    await host.st.deleteMessage(first);
    await host.st.deleteMessage(first - 1);
    assert.equal(Object.hasOwn(inv(host).defs, 'story/sunblade'), false);
    assert.equal(stackOf(host, 'story/sunblade'), undefined);
    assert.deepEqual(rules(host), ['story/lantern']);
    assert.deepEqual(host.store.problems(), []);
    live = host.head();
    host.store.rebuild();
    assert.deepEqual(host.head(), live);
    assert.equal(Object.hasOwn(inv(host).defs, 'story/lantern'), true);
});

test('an equip click kept on a later reply survives the deletion of the reply that registered the piece', async t => {
    const { host } = await fresh(t);
    await host.send('Find.', reply('A blade.', ['+ item Sunblade']));
    const first = host.ctx.chat.length - 1;
    await host.send('On.', reply('Onward.', ['+ item Torch']));
    const put = await host.sdk.command('inventory.equipOn', { stack: stackOf(host, 'story/sunblade').id, actor: REN });
    assert.equal(put.ok, true, put.message);
    await host.st.deleteMessage(first);
    await host.st.deleteMessage(first - 1);
    assert.equal(stackOf(host, 'story/sunblade'), undefined, 'the piece went with its reply');
    assert.equal(Object.values(inv(host).stacks).filter(stack => stack.equipped !== null).length, 0, 'and nothing is worn by a ghost');
    assert.deepEqual(rules(host), ['story/torch']);
    const live = host.head();
    host.store.rebuild();
    assert.deepEqual(host.head(), live);
});
