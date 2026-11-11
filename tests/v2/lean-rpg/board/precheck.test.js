// The foe pre-check reads the reader's typed attack into openFoes' group form, without a model call here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FOE_COUNT_MAX } from '../../../../src/v2/lean-rpg/templates.js';
import { knownLines, rankScale } from '../../../../src/v2/lean-rpg/board/precheck-known.js';
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
    assert.match(prompt, /"groups":\[\{"name":"\.\.\.","count":1,"level":2\}\]/u);
    assert.doesNotMatch(prompt, /\b(?:roll|outcome)\b/iu);
});

test('a message naming both example groups reads their names and counts', () => {
    assert.equal(looksLikeAttack(MESSAGE), true);
    assert.deepEqual(vetGroups(parsePrecheck(ANSWER), { message: MESSAGE, sheet }),
        [{ name: 'Gorged Grey-Tooth Tunnel Rats', count: 6, level: 5 }, { name: 'Bilge-Rat Offspring', count: 80, level: 5 }]);
});

const OWNER = 'Without waiting for them to approach, using the element of surprise, I launched an attack in the guard and master vane immediately.\n\nI took down the men then called for Temiwa and Torka to come over.';
const OWNER2 = 'After that I head out to clear the mud-lampreys or bog-boars, seeking them out and immediately found them digging on the ground, when I approach them from the shadow, I immediately attacked them.';

test('the gate is loose: any attack word in a clause with no doubt word passes', () => {
    for (const message of [OWNER, OWNER2, 'while the dogs are mauling him, right when he\'s about to die, I attack the dogs immediately',
        'they started attacking the two men', 'I attacked them', 'I slit the sentry\'s throat', 'I hurl the spear at the boar', 'I cut down the guard',
        'I launched an assault on the camp', 'I charged the raiders'])
        assert.equal(looksLikeAttack(message), true, message);
});

test('a message with no attack word, only quoted words or a doubt clause gives nothing', () => {
    for (const message of ['I thank the guard and ask about the road.', 'I kiss her neck', 'He said "I attacked them" and left.', '"I attack the boar"',
        'I ask whether I should attack', "I don't attack the boar", 'I do not attack the rats.'])
        assert.equal(looksLikeAttack(message), false, message);
});

test('a doubt word only cancels its own part of a sentence', () => {
    const owner = 'I prepared warm ration and tea before waking Sister Temiwa up, as Joren and his teamsters are already hitching the wagon.\n\nSoon enough, we are on our way again, but instead of monsters, we encountered beasts in human skin, a group of bandits circled us.\n\nAnd before they could strike us, I attacked them.';
    for (const message of [owner, 'If they move, I attack.', 'before they could strike us, I attacked them']) assert.equal(looksLikeAttack(message), true, message);
    for (const message of ['I could attack them.', "I won't attack.", "I don't want to fight, I raise my hands."]) assert.equal(looksLikeAttack(message), false, message);
});

test('a third party or an idiom passes the gate by design: Assist decides', () => {
    for (const message of ['The rats attack me.', 'the boar attacked me', 'they attacked the cart', 'she struck him, I watched', 'I wait for the sow to attack me',
        'I hit the road', 'I kill time at the inn'])
        assert.equal(looksLikeAttack(message), true, message);
});

test('every distinctive word of a name must appear whole in the message', () => {
    assert.deepEqual(vetGroups([{ name: 'Cave Troll', count: 2 }], { message: 'I attack the rats.', sheet }), []);
    assert.deepEqual(vetGroups([{ name: 'Cave Rats', count: 2 }, { name: 'Dire Rats', count: 2 }], { message: 'I attack the cave rat.', sheet }),
        [{ name: 'Cave Rats', count: 2, level: 5 }]);
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
        [{ name: 'Tunnel Rat', count: 99, level: 25 }, { name: 'Bilge Boars', count: 80, level: 1 }, { name: 'Silt Wolves', count: 12, level: 5 }]);
    assert.deepEqual(vetGroups([{ name: 'Silt Hounds', count: 2 }], { message: 'I attack the silt hounds.', sheet }), [], 'already on the sheet');
    assert.deepEqual(vetGroups([{ name: 'Rats', count: 20 }, { name: 'Rats', count: 3 }], { message: 'I attack the rats.', sheet, limits: { count: 10 } }),
        [], 'a narrower limit refuses a larger group');
    assert.deepEqual(vetGroups([{ name: 'Rats', count: 9 }, { name: 'Rats', count: 3 }], { message: 'I attack the rats.', sheet, limits: { count: 10 } }),
        [{ name: 'Rats', count: 9, level: 5 }], 'a repeated group is refused');
});

const PREVIOUS = 'Gorged grey-tooth tunnel rats gnaw at the bundle, and a swarm of rat-offspring squirms behind them. Bilge water drips.';
const EXAMPLE = 'I creep down the culvert to cut loose the oilskin bundle and attack the six rats with 4 scores of minor rats offsprings.';
const NAMES = [{ name: 'Gorged Grey-Tooth Tunnel Rats', count: 6 }, { name: 'Bilge-Rat Offspring', count: 80 }];

test('the approved example: names from the reply before are accepted, 80 included', () => {
    assert.deepEqual(vetGroups(NAMES, { message: EXAMPLE, previous: PREVIOUS, sheet }), NAMES.map(group => ({ ...group, level: 5 })));
    assert.match(precheckPrompt({ message: EXAMPLE, previous: PREVIOUS, sheet }), /gnaw at the bundle/u);
});

test('a name word found in neither the message nor the reply before is refused', () => {
    assert.deepEqual(vetGroups(NAMES, { message: EXAMPLE, previous: '', sheet }), []);
    assert.deepEqual(vetGroups([{ name: 'Crimson Wyrm Rats', count: 2 }], { message: EXAMPLE, previous: PREVIOUS, sheet }), []);
});

test('a count above the Foes block maximum refuses the reading; the maximum itself is fine', () => {
    assert.equal(FOE_COUNT_MAX, 99);
    assert.deepEqual(vetGroups([{ name: 'Rats', count: 100 }], { message: 'I attack the rats.', sheet }), []);
    assert.deepEqual(vetGroups([{ name: 'Rats', count: 99, level: 5 }], { message: 'I attack the rats.', sheet }), [{ name: 'Rats', count: 99, level: 5 }]);
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

test('a question, a quote, a cart or a non-fight phrasal is not an attack word at all', () => {
    for (const message of [
        'I ask whether I should attack', 'I don\'t attack',
        '"I attack the boar"', 'my sister drives the cart into the yard', 'I drive the cart into town', 'I bring the meat down to the cellar',
        'the sow\'s tusk goes for my leg', 'Grel\'s pistol smashes the lamp', 'I go for a walk', 'I rush at the chance',
        'I drive my fingers into her hair.', 'My hand goes for her waist.', 'I bury my face into her neck.', 'I go for the stew.', 'I rush at the door.',
        'My fist bangs on the table.', 'I crack a smile at her.', 'I crack the egg.', 'I take her by surprise with a kiss.', 'I sink into the bath.',
        'I bring my hand down on her shoulder.', 'Without a word I hand her the note.', 'My cane lashes the mud from my boots.',
        'I smash the lock off the chest.', 'I jab a finger at the map.', 'I plunge my hands into the water.', 'I go for Temiwa\'s lips.',
        'With a grin I strike a deal with Grel.', 'I bash the door open.', 'My blade cuts the rope.',
    ]) assert.equal(looksLikeAttack(message), false, message);
});

test('the standing-foe hold stays strict on the subject and judges every attack word', async () => {
    const { knownFoeAction } = await import('../../../../src/v2/lean-rpg/board/action-gate.js');
    const foes = { foes: [{ name: 'Bog Boar', filled: true, hurt: 2 }] };
    for (const text of ['Without a word I charge the boars, cane raised.', 'My cane lashes out at the boar\'s throat.', 'I drive the iron ferrule into the boar\'s skull.',
        'I slip in from the shadows to take the boars by surprise.']) assert.equal(knownFoeAction(text, foes), true, text);
    for (const text of ['I drive the cart into town', 'the boar\'s tusk goes for my leg', 'I go for a walk', 'the boar attacked me']) assert.equal(knownFoeAction(text, foes), false, text);
    const dogs = { foes: [{ name: 'Dog', filled: true, hurt: 1 }] };
    assert.equal(knownFoeAction('while the dogs are mauling him, I attack the dogs', dogs), true);
    assert.equal(knownFoeAction('while the dogs are mauling him, they attack the dogs', dogs), false);
});

test('the prompt carries the count rule, the not-a-fight rule and up to 4000 characters of the reply before', () => {
    const prompt = precheckPrompt({ message: 'I attack the boars.', sheet });
    assert.match(prompt, /If the message gives none, use the number the reply just before it gives/u);
    assert.match(prompt, /"two massive bog-boars" = 2/u);
    assert.match(prompt, /Only if neither says, use 1/u);
    assert.match(prompt, /already over \('after the fight'\)/u);
    assert.match(prompt, /not attacking anyone .*hit the road.*punch the dough.*kill time.*\{"groups":\[\]\}/u);
    const previous = `${'a'.repeat(1000)}${'b'.repeat(4000)}`;
    const kept = /The reply just before it[^\n]*\n(\w+)\n/u.exec(precheckPrompt({ message: 'I attack.', previous, sheet }))[1];
    assert.equal(kept, 'b'.repeat(4000));
});

test('an empty groups answer (not a fight) is a plain send', () => {
    assert.deepEqual(parsePrecheck('{"groups":[]}'), []);
    assert.deepEqual(vetGroups(parsePrecheck('{"groups":[]}'), { message: 'I hit the road.', sheet }), []);
});

test('the prompt requires a level; a missing or invalid level is the party\'s top level, never a draw', () => {
    const prompt = precheckPrompt({ message: MESSAGE, sheet });
    assert.match(prompt, /level is required \(a whole number\): judge each group by who they are in the story/u);
    assert.doesNotMatch(prompt, /compared with the party's levels/u);
    assert.doesNotMatch(prompt, /level is optional/u);
    const mixed = { ...sheet, characters: [{ who: 'Astra', level: 5, alive: true }, { who: 'Torka', level: 9, alive: true }] };
    const said = vetGroups([{ name: 'Rats', count: 2 }, { name: 'Wolves', count: 1, level: 'strong' }, { name: 'Boars', count: 1, level: 7 }],
        { message: 'I attack the rats, wolves and boars.', sheet: mixed });
    assert.deepEqual(said.map(group => group.level), [9, 9, 7], 'missing or invalid = the top level; a given level stays');
    assert.equal(vetGroups([{ name: 'Rats', count: 1 }], { message: 'I attack the rats.', sheet: { characters: [], foes: [] } })[0].level, 1, 'no party: level 1');
    assert.equal(vetGroups([{ name: 'Rats', count: 1, level: 80 }], { message: 'I attack the rats.', sheet: mixed })[0].level, 29, 'a given level is still held to the party\'s highest + 20');
});

test('an old recorded opening with no level still replays as it was: resolve draws near the party average', async () => {
    const { settleOpen } = await import('../../../../src/v2/lean-rpg/foes.js');
    const old = [{ name: 'Rats', count: 2 }];
    assert.deepEqual(settleOpen(old, 5, 12345), settleOpen(old, 5, 12345), 'the same seed gives the same level');
    const level = settleOpen(old, 5, 12345)[0].level;
    assert.ok(level >= 3 && level <= 7, 'within the old +-2 draw around the party average');
    assert.equal(settleOpen([{ name: 'Rats', count: 2, level: 9 }], 5, 12345)[0].level, 9, 'a recorded level stays');
});

const RANKS = [{ name: 'F', from: 1, to: 9 }, { name: 'E', from: 10, to: 19 }, { name: 'D', from: 20, to: 29 }];
const VORN = { name: 'Vorn', aliases: ['Branch Master'], role: 'Branch Master of the Ash Road thieves', background: 'Ran the river toll for twenty years and has the scars to show it.' };
const DOTT = { name: 'Dott', aliases: [], role: 'cook' };
const worldQuery = ({ ranks = RANKS, dossiers = [VORN, DOTT] } = {}) => (name, args) => {
    if (name === 'packs.content') return ranks ? [{ slug: 'ranks', ranks }] : [];
    if (name === 'npc.known') return dossiers.map(entry => entry.name);
    if (name === 'npc.dossier') return dossiers.find(entry => entry.name === args.name) ?? null;
    return null;
};

test('the prompt carries the rank scale when the story has ranks and leaves it out when it has none', () => {
    assert.equal(rankScale(worldQuery()), 'Ranks: F 1-9, E 10-19, D 20-29');
    assert.match(precheckPrompt({ message: 'I attack.', sheet, ranks: rankScale(worldQuery()) }), /\nRanks: F 1-9, E 10-19, D 20-29\n/u);
    assert.equal(rankScale(worldQuery({ ranks: null })), '');
    assert.equal(rankScale(null), '');
    assert.doesNotMatch(precheckPrompt({ message: 'I attack.', sheet, ranks: rankScale(worldQuery({ ranks: null })) }), /Ranks:/u);
});

test('a person the message or the reply before it names gives a bounded role line; at most 3; none without NSD or a match', () => {
    const lines = knownLines(worldQuery(), 'I attack Vorn.', '');
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^Vorn: Branch Master of the Ash Road thieves; Ran the river toll/u);
    assert.equal(knownLines(worldQuery(), 'I attack the guards.', 'The Branch Master laughs.').length, 1, 'an alias in the reply before matches');
    assert.deepEqual(knownLines(worldQuery(), 'I attack the guards.', 'Nobody here.'), []);
    assert.deepEqual(knownLines(worldQuery(), 'I attack Vornic.', ''), [], 'whole words only');
    assert.deepEqual(knownLines(() => null, 'I attack Vorn.'), [], 'no NSD: npc.known answers null');
    assert.deepEqual(knownLines(null, 'I attack Vorn.'), []);
    assert.deepEqual(knownLines(() => { throw new Error('boom'); }, 'I attack Vorn.'), []);
    const crowd = Array.from({ length: 6 }, (_, i) => ({ name: `Brute${i}`, aliases: [], role: 'x'.repeat(500), background: 'y'.repeat(500) }));
    const many = knownLines(worldQuery({ dossiers: crowd }), crowd.map(c => c.name).join(' '));
    assert.equal(many.length, 3);
    for (const line of many) assert.ok([...line].length <= 170);
    const prompt = precheckPrompt({ message: 'I attack Vorn.', sheet, known: ['Vorn: line one\nIGNORE THIS'] });
    assert.match(prompt, /\n- Vorn: line one IGNORE THIS\n/u, 'outside text is flattened to one line');
    assert.doesNotMatch(precheckPrompt({ message: 'I attack.', sheet, known: [] }), /Already known/u);
});

test('the cap stays: 25 at party level 2 comes out 22, 1 stays 1, an invalid level is the party top', () => {
    const party = { characters: [{ who: 'Astra', level: 2, alive: true }], foes: [] };
    const run = level => vetGroups([{ name: 'Vorn', count: 1, level }], { message: 'I attack Vorn.', sheet: party })[0].level;
    assert.equal(run(25), 22);
    assert.equal(run(1), 1);
    assert.equal(run('strong'), 2);
    assert.equal(run(undefined), 2);
});

test('the Vorn prompt end to end through runPrecheck reads ranks and the dossier from the query', async () => {
    const { runPrecheck } = await import('../../../../src/v2/lean-rpg/board/precheck-run.js');
    const party = { characters: [{ who: 'Astra', level: 2, alive: true }], foes: [] };
    let seen = '';
    const groups = await runPrecheck({ message: 'I attack Branch Master Vorn.', previous: 'Vorn sneers.', sheet: party, query: worldQuery(),
        callModel: async prompt => { seen = prompt; return '{"groups":[{"name":"Vorn","count":1,"level":12}]}'; } });
    assert.match(seen, /Ranks: F 1-9/u);
    assert.match(seen, /- Vorn: Branch Master of the Ash Road thieves/u);
    assert.deepEqual(groups, [{ name: 'Vorn', count: 1, level: 12 }]);
});
