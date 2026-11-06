// A staged fight is resolved by the production command on a test host.
// The recorded dice, bars and narrator note must match the pre-reply view.

import test from 'node:test';
import assert from 'node:assert/strict';
import { playBoard } from '../../../../src/v2/lean-rpg/board/engine.js';
import { settledNote } from '../../../../src/v2/lean-rpg/board/note.js';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';
import { character, foeBlock, setup } from '../helpers.js';

test('the reply resolver commits exactly the staged exchange and refuses a duplicate claim', async () => {
    const blocks = { hero: { role: 'character', fields: character('Astra') }, foes: { role: 'foes', fields: foeBlock([['Rats', 1, 1, 5]]) } };
    const { host } = await setup({ blocks });
    try {
        const setup = { seed: 24, offset: 0, rules: { ...STANDARD_FORMULA, levelDivisor: 5 } };
        const exchanges = [{ actions: [{ who: 'Astra', kind: 'attack', target: 1 }] }];
        const staged = playBoard(host.head(), setup, exchanges);
        assert.equal(staged.error, undefined);
        const payload = { key: '1-abc', board: { id: 'fight-one', groups: [1], setup, exchanges } };
        const result = host.bus.run('rpg.resolve', payload, { cause: 'system' });
        assert.equal(result.ok, true, result.message);
        const recorded = result.receipt.data.v2.result;
        assert.deepEqual(recorded.rounds, staged.result.rounds);
        assert.deepEqual(recorded.hurts, staged.result.hurts);
        assert.equal(result.receipt.summary, settledNote(recorded));
        for (const hurt of staged.result.hurts) assert.equal(result.state.domains.dataModules.instances[hurt.module].chat.fields[hurt.field], hurt.to);
        const twice = host.bus.run('rpg.resolve', payload, { cause: 'system', state: result.state });
        assert.equal(twice.ok, false);
        assert.equal(twice.code, 'CLAIMED');
    } finally { host.close(); }
});
