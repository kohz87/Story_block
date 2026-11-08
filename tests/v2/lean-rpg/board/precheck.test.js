// The foe pre-check reads the reader's typed attack into openFoes' group form, without a model call here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeAttack, parsePrecheck, precheckPrompt, vetGroups } from '../../../../src/v2/lean-rpg/board/precheck.js';

const MESSAGE = 'I creep down the culvert and attack the six Gorged Grey-Tooth Tunnel Rats with 4 scores of Bilge-Rat Offspring.';
const ANSWER = 'The foes are:\n```json\n{"groups":[{"name":"Gorged Grey-Tooth Tunnel Rats","count":6},{"name":"Bilge-Rat Offspring","count":80}]}\n```';
const sheet = {
    characters: [{ who: 'Astra', level: 5, alive: true }],
    foes: [{ name: 'Silt Hound', filled: true, hurt: 3 }],
};

test('the prompt names the message, the sheet and JSON groups only', () => {
    const prompt = precheckPrompt({ message: MESSAGE, sheet, roster: { actors: [{ name: 'Astra' }] } });
    assert.match(prompt, /I creep down the culvert/u);
    assert.match(prompt, /Foes already on the Foes block: Silt Hound/u);
    assert.match(prompt, /Party: Astra \(level 5\)/u);
    assert.match(prompt, /"groups":\[\{"name":"\.\.\.","count":1\}\]/u);
    assert.doesNotMatch(prompt, /\b(?:roll|outcome|story)\b/iu);
});

test('a message naming both example groups reads their names and counts', () => {
    assert.equal(looksLikeAttack(MESSAGE), true);
    assert.deepEqual(vetGroups(parsePrecheck(ANSWER), { message: MESSAGE, sheet }),
        [{ name: 'Gorged Grey-Tooth Tunnel Rats', count: 6 }, { name: 'Bilge-Rat Offspring', count: 80 }]);
});

test('a message that is not an attack gives nothing', () => {
    for (const message of ['I thank the guard and ask about the road.', 'I do not attack the rats.', 'The rats attack me.'])
        assert.equal(looksLikeAttack(message), false, message);
});

test('every distinctive word of a name must appear whole in the message', () => {
    assert.deepEqual(vetGroups([{ name: 'Cave Troll', count: 2 }], { message: 'I attack the rats.', sheet }), []);
    assert.deepEqual(vetGroups([{ name: 'Cave Rats', count: 2 }, { name: 'Dire Rats', count: 2 }], { message: 'I attack the cave rat.', sheet }),
        [{ name: 'Cave Rats', count: 2 }]);
    assert.deepEqual(vetGroups([{ name: 'Gorged Grey-Tooth Tunnel Rats', count: 6 }], { message: 'I attack six rats.', sheet }), []);
});

test('malformed JSON gives null', () => {
    assert.equal(parsePrecheck('{"groups":[oops'), null);
    assert.equal(parsePrecheck('I found no foe groups.'), null);
    assert.equal(parsePrecheck('{"groups":{"name":"Rats"}}'), null);
});

test('plural whole words, the sheet, count bounds and clamped levels follow the Foes rules', () => {
    const groups = [
        { name: 'Tunnel Rat', count: 1200, level: 150 },
        { name: 'Bilge Boars', count: '4 scores', level: 0 },
        { name: 'Silt Wolves', count: 'a dozen' },
        { name: 'Tunnel Rats', count: 2 },
    ];
    assert.deepEqual(vetGroups(groups, { message: 'I attack the tunnel rats with 4 scores of bilge boars and a dozen silt wolves.', sheet }),
        [{ name: 'Tunnel Rat', count: 999, level: 15 }, { name: 'Bilge Boars', count: 80, level: 1 }, { name: 'Silt Wolves', count: 12 }]);
    assert.deepEqual(vetGroups([{ name: 'Silt Hounds', count: 2 }], { message: 'I attack the silt hounds.', sheet }), [], 'already on the sheet');
    assert.deepEqual(vetGroups([{ name: 'Rats', count: 20 }, { name: 'Rats', count: 3 }], { message: 'I attack the rats.', sheet, limits: { count: 10 } }),
        [{ name: 'Rats', count: 10 }], 'the count limit holds and a repeated group is refused');
});
