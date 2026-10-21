// B-b3-3: "module.init.<id>" from a click resets a module's domains. With a party module that
// owns actors, every stack and purse its members held is left with an owner id nobody has: the
// value is out of reach and no receipt says where it went.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { reply } from './helpers/econ.js';

const partyModule = () => ({
    id: 'b3-party', name: 'B3 party', version: '0.0.0',
    domains: { party: { initial: () => ({ actors: {} }) } },
    commands: {
        'b3.join'(ctx, { id }) {
            ctx.draft('party').actors[id] = { id, name: 'Lyra' };
            return { summary: 'Lyra joins.' };
        },
    },
});

test('module.init.<id> cannot be run from a click', async () => {
    const host = await createHost({ modules: [partyModule()] });
    try {
        await host.send('We camp.', reply('A fire.', ['+ item Torch | qty: 3', '+ coin 20']));
        assert.equal((await host.sdk.command('b3.join', { id: 'ac_lyra0001' })).ok, true);
        const torch = host.sdk.query('inventory.items', {}).find(item => item.name === 'Torch');
        assert.equal((await host.sdk.command('inventory.transfer', { stack: torch.stack, to: 'ac_lyra0001', qty: 3 })).ok, true);
        const wiped = await host.sdk.command('module.init.b3-party', {});
        assert.equal(wiped.ok, false, `a click reset the party: ${wiped.receipt?.summary}`);
        const actors = host.head().domains.party.actors;
        const orphans = Object.values(host.head().domains.inventory.stacks).filter(stack => stack.owner !== 'party' && !actors[stack.owner]);
        assert.deepEqual(orphans, [], 'no stack is held by someone who is not there');
    } finally { host.close(); }
});
