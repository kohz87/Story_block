// The known-foe hold requires a clear attack; all ambiguous phrases use the usual send path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { knownFoeAction } from '../../../../src/v2/lean-rpg/board/action-gate.js';
import { character, foeBlock, setup, skillBlock } from '../helpers.js';

const sheet = { foes: [{ name: 'Rat swarms', filled: true, hurt: 4 }], characters: [{ skills: [
    { name: 'Shadow Cut', about: 'Slash a foe with a blade.' }, { name: 'Obscure', about: 'Hide from sight.' },
] }] };

test('only an explicit attack on a standing known foe holds the send', () => {
    for (const text of ['I attack the rats.', 'I strike the rat swarms.', 'I stab them.', 'I shoot the rats.', 'I swing my sword at the rats.', 'I use Shadow Cut on the rats.', 'Slash the rats.'])
        assert.equal(knownFoeAction(text, sheet), true, text);
    for (const text of ['I talk to the rats about an attack.', 'I tell the rats I will attack.', 'I walk away from the rats.', 'I run past the rats.',
        'The rats attack me.', 'I do not attack the rats.', 'If they attack, I will flee.', 'I attack the door and greet the rats.',
        'I hit the ground near the rats.', 'I shoot into the air near the rats.', 'I practise Shadow Cut near the rats.', 'I use Obscure on the rats.', 'I attack the bandits.', 'I say "attack the rats".', 'I draw my sword.'])
        assert.equal(knownFoeAction(text, sheet), false, text);
    assert.equal(knownFoeAction('I attack the rats.', { ...sheet, foes: [{ ...sheet.foes[0], hurt: 0 }] }), false);
});

test('known-foe phrases pause or send through the real host', async () => {
    for (const [text, pause] of [['I attack the rats.', true], ['I stab them.', true], ['I use Shadow Cut on the rats.', true],
        ['I talk to the rats.', false], ['I walk away from the rats.', false], ['I do not attack the rats.', false], ['The rats attack me.', false]]) {
        const blocks = { hero: { role: 'character', fields: character('Astra') },
            skills: { role: 'skills', fields: skillBlock('Astra', [['Shadow Cut', 2, 'agi', 'stamina', 'Slash a foe with a blade']]) },
            foes: { role: 'foes', fields: foeBlock([['Rats', 1, 1, 5]]) } };
        const { host, callModel } = await setup({ blocks, board: true, answers: ['none'] });
        try {
            const result = await host.send(text, 'A reply.');
            assert.equal(result.aborted === true, pause, text);
            assert.equal(callModel.calls.length, pause ? 0 : 1, text);
        } finally { host.close(); }
    }
});
