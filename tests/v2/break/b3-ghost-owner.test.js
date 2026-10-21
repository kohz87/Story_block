// B-b3-7: inventory.transfer (and the wallet commands) take any well-formed actor id, so a click
// moves goods to "ac_zzzzzzzz", who is nobody: the stack leaves everyone's reach, and nothing ever
// hands it back (the party's hand-off runs only for members who leave).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../testkit/index.js';
import { reply } from './helpers/econ.js';

const partyModule = () => ({
    id: 'b3-party', name: 'B3 party', version: '0.0.0',
    domains: { party: { initial: () => ({ actors: { ac_wessel01: { id: 'ac_wessel01', name: 'Wessel' } } }) } },
});

test('a transfer to an owner that is not in the party is refused', async () => {
    const host = await createHost({ modules: [partyModule()] });
    try {
        await host.send('Supplies.', reply('Rope.', ['+ item Rope | qty: 2']));
        const rope = host.sdk.query('inventory.items', {}).find(item => item.name === 'Rope');
        const r = await host.sdk.command('inventory.transfer', { stack: rope.stack, to: 'ac_zzzzzzzz', qty: 1 });
        assert.equal(r.ok, false, r.receipt?.summary);
    } finally { host.close(); }
});
