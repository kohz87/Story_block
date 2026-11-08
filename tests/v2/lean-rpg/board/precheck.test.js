// The foe pre-check reads the reader's typed attack into openFoes' group form, without a model call here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FOE_COUNT_MAX } from '../../../../src/v2/lean-rpg/templates.js';
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

test('the owner message and adverb or comma subjects read as attacks', () => {
    const owner = 'I head out to clear the bog-boars, seeking them out and immediately found them digging on the ground, when I approach them from the shadow, I immediately attacked them.';
    for (const message of [owner, 'I immediately attacked them', 'As I crept closer, I attacked the boars', 'then I quickly struck the boar',
        'we finally charged', 'I just also swung at the boar', 'The wind rose: I attacked the boars'])
        assert.equal(looksLikeAttack(message), true, message);
});

test('other subjects, doubts and quotes still give no attack', () => {
    for (const message of ['the boar attacked me', 'they attacked the cart', 'she struck him, I watched', 'I ask whether I should attack',
        "I don't attack the boar", 'He said "I attacked them" and left.', 'I quietly slowly really attacked them'])
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
        { name: 'Tunnel Rat', count: 99, level: 150 },
        { name: 'Bilge Boars', count: '4 scores', level: 0 },
        { name: 'Silt Wolves', count: 'a dozen' },
        { name: 'Tunnel Rats', count: 2 },
    ];
    assert.deepEqual(vetGroups(groups, { message: 'I attack the tunnel rats with 4 scores of bilge boars and a dozen silt wolves.', sheet }),
        [{ name: 'Tunnel Rat', count: 99, level: 15 }, { name: 'Bilge Boars', count: 80, level: 1 }, { name: 'Silt Wolves', count: 12 }]);
    assert.deepEqual(vetGroups([{ name: 'Silt Hounds', count: 2 }], { message: 'I attack the silt hounds.', sheet }), [], 'already on the sheet');
    assert.deepEqual(vetGroups([{ name: 'Rats', count: 20 }, { name: 'Rats', count: 3 }], { message: 'I attack the rats.', sheet, limits: { count: 10 } }),
        [], 'a narrower limit refuses a larger group');
    assert.deepEqual(vetGroups([{ name: 'Rats', count: 9 }, { name: 'Rats', count: 3 }], { message: 'I attack the rats.', sheet, limits: { count: 10 } }),
        [{ name: 'Rats', count: 9 }], 'a repeated group is refused');
});

const PREVIOUS = 'Gorged grey-tooth tunnel rats gnaw at the bundle, and a swarm of rat-offspring squirms behind them. Bilge water drips.';
const EXAMPLE = 'I creep down the culvert to cut loose the oilskin bundle and attack the six rats with 4 scores of minor rats offsprings.';
const NAMES = [{ name: 'Gorged Grey-Tooth Tunnel Rats', count: 6 }, { name: 'Bilge-Rat Offspring', count: 80 }];

test('the approved example: names from the reply before are accepted, 80 included', () => {
    assert.deepEqual(vetGroups(NAMES, { message: EXAMPLE, previous: PREVIOUS, sheet }), NAMES);
    assert.match(precheckPrompt({ message: EXAMPLE, previous: PREVIOUS, sheet }), /gnaw at the bundle/u);
});

test('a name word found in neither the message nor the reply before is refused', () => {
    assert.deepEqual(vetGroups(NAMES, { message: EXAMPLE, previous: '', sheet }), []);
    assert.deepEqual(vetGroups([{ name: 'Crimson Wyrm Rats', count: 2 }], { message: EXAMPLE, previous: PREVIOUS, sheet }), []);
});

test('a count above the Foes block maximum refuses the reading; the maximum itself is fine', () => {
    assert.equal(FOE_COUNT_MAX, 99);
    assert.deepEqual(vetGroups([{ name: 'Rats', count: 100 }], { message: 'I attack the rats.', sheet }), []);
    assert.deepEqual(vetGroups([{ name: 'Rats', count: 99 }], { message: 'I attack the rats.', sheet }), [{ name: 'Rats', count: 99 }]);
});

// Attacks blended into the reader's own narration (strict word patterns, no model call).
test('an attack blended into narration is read', () => {
    for (const message of [
        'After that I head out to clear the bog-boars, and when I approach them from the shadow, I immediately attacked them. Then I field-dressed the carcasses.',
        'I slip along the peat-wall, cane in hand, and strike the larger sow before she can turn.',
        'Drawing the shadow around me, I lunge at the sow and drive the ferrule into her eye, then haul the cart home.',
        'I creep closer and attack the boars from behind the turf-stack, then load the meat onto the handcart.',
        'Once they\'re distracted, I quickly stab the nearest boar.',
        'Without a word I charge the two boars, cane raised.',
        'My cane lashes out at the sow\'s throat.',
        'I drive the iron ferrule into the boar\'s skull.',
        'I creep up and, the moment the sow lifts her head, I bring my cane down on her.',
        'I slip in from the shadows to take the boars by surprise.',
        'I smash the boar\'s snout.',
    ]) assert.equal(looksLikeAttack(message), true, message);
});

test('a third party, a question, a quote or a cart is not the reader attacking', () => {
    for (const message of [
        'the boar attacked me', 'they attacked the cart', 'she struck him, I watched', 'I ask whether I should attack', 'I don\'t attack',
        '"I attack the boar"', 'my sister drives the cart into the yard', 'I drive the cart into town', 'I bring the meat down to the cellar',
        'the sow\'s tusk goes for my leg', 'Grel\'s pistol smashes the lamp', 'I go for a walk', 'I rush at the chance',
        'I wait for the sow to attack me',
        'I drive my fingers into her hair.', 'My hand goes for her waist.', 'I bury my face into her neck.', 'I go for the stew.', 'I rush at the door.',
        'My fist bangs on the table.', 'I crack a smile at her.', 'I crack the egg.', 'I take her by surprise with a kiss.', 'I sink into the bath.',
        'I bring my hand down on her shoulder.', 'Without a word I hand her the note.', 'My cane lashes the mud from my boots.',
        'I smash the lock off the chest.', 'I jab a finger at the map.', 'I plunge my hands into the water.', 'I go for Temiwa\'s lips.',
        'With a grin I strike a deal with Grel.', 'I bash the door open.', 'My blade cuts the rope.',
    ]) assert.equal(looksLikeAttack(message), false, message);
});

test('the standing-foe hold reads the same shapes', async () => {
    const { knownFoeAction } = await import('../../../../src/v2/lean-rpg/board/action-gate.js');
    const foes = { foes: [{ name: 'Bog Boar', filled: true, hurt: 2 }] };
    for (const text of ['Without a word I charge the boars, cane raised.', 'My cane lashes out at the boar\'s throat.', 'I drive the iron ferrule into the boar\'s skull.',
        'I slip in from the shadows to take the boars by surprise.']) assert.equal(knownFoeAction(text, foes), true, text);
    for (const text of ['I drive the cart into town', 'the boar\'s tusk goes for my leg', 'I go for a walk']) assert.equal(knownFoeAction(text, foes), false, text);
});

test('the prompt carries the count rule, the not-a-fight rule and up to 4000 characters of the reply before', () => {
    const prompt = precheckPrompt({ message: 'I attack the boars.', sheet });
    assert.match(prompt, /If the message gives none, use the number the reply just before it gives/u);
    assert.match(prompt, /"two massive bog-boars" = 2/u);
    assert.match(prompt, /Only if neither says, use 1/u);
    assert.match(prompt, /not attacking anyone .*hit the road.*punch the dough.*kill time.*\{"groups":\[\]\}/u);
    const previous = `${'a'.repeat(1000)}${'b'.repeat(4000)}`;
    const kept = /The reply just before it[^\n]*\n(\w+)\n/u.exec(precheckPrompt({ message: 'I attack.', previous, sheet }))[1];
    assert.equal(kept, 'b'.repeat(4000));
});

test('an empty groups answer (not a fight) is a plain send', () => {
    assert.deepEqual(parsePrecheck('{"groups":[]}'), []);
    assert.deepEqual(vetGroups(parsePrecheck('{"groups":[]}'), { message: 'I hit the road.', sheet }), []);
});
