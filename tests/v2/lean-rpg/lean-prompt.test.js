// The RPG's lean prompt (prompt diet step 2, 3 Nov): a numbered family of kinds is one template line, the health words are told once, the Standard
// blocks' descriptions are shorter, and the combat text, the Foes grammar and the party line are told only while a fight is open or when
// rolls were made for this reply. Text only: every kind is still declared and every line is read as before, so a fight the narrator opens without a
// plan parses, and the same reply rebuilt (a swipe that keeps its plan) tells the same prompt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, hostAvailable } from '../../../testkit/index.js';
import { createFakeModel } from '../../../testkit/model.js';
import { LEAN_RPG_FEATURE, QUIET_GRAMMAR, fightIsOpen, isQuiet, readSheet } from '../../../src/v2/lean-rpg/index.js';
import { STANDARD_TEMPLATES } from '../../../src/v2/lean-rpg/templates.js';
import { moduleGrammar } from '../../../src/v2/data-modules/grammar.js';
import { reply, success } from '../data-modules/helpers.js';
import { CORE_FEATURE } from '../../../src/v2/features.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
// The Standard blocks' text before this change: what a chat that pinned them then still holds.
const BEFORE = {
    character: "One character: who they are, health, stamina and mana (words, shown as bars of blocks that grow with VIT, AGI and INT), seven stats from 1 to 20, unspent points, Level 1 to 99 and XP to 100. The narrator sets health, mana, stamina and XP by words; the story cannot kill a character outright: they die only when they were already Down before a reply and are still Down at its end. The reader sets stats and points. XP at 100 raises the Level by one, up to the Level cap, and every third Level gives a point to spend on stats.",
    skills: "Up to five skills for one character. Each has a description, the stat it rolls with, what it uses (stamina or mana), a rank (Novice, Adept, Expert, Master) and practice from 0 to 100. The narrator names a skill with a learn line (name, what it does, stat, uses) and adds practice. At 100 practice the rank rises by one and practice starts again at 0; a Master stays at 100.",
    foes: "Up to four foe groups in the current fight. A group is one slot: its name, how many it has (count 0 means the slot is empty), its level from 1 to 99 and its health (words: a group of a higher level has more blocks of health). The narrator sets a slot when a group arrives, hurts it as the fight goes and clears it when the group is down, gone, fled, captured or has yielded.",
    rules: "[COMBAT SYSTEM]\nNo Plot Armor: combat follows physical reality and the lore. Size, skill, numbers, reach, armor, terrain, preparation and Level all matter. Against a stronger foe, {{user}} loses unless a believable edge exists: ambush, terrain, numbers, poison, preparation.\nExchanges: a fight is told exchange by exchange, each with clear cause, cost and consequence, in the order things happen. Most fights are short; never skip the moment that decides it.\nWeight & Risk: every strike, miss, wound and hesitation carries impact. Injury, fatigue, fear and pain carry into the next exchange and the next scene.\nBelievable Outcomes: fights end when logic demands it: death, surrender, retreat, capture or collapse. Victory must be earned; survival must be justified.\nRolls: attacks, spells, defence, talk and checks each pair a main stat with half of a second one. Health, stamina and mana are rows of blocks: a hit takes one, a Decisive hit two, and a foe of a higher Level has more. Tell the rolled result; code moves the bars for hits, heals, skill costs: never set those.\nXP guide: code gives XP for a won fight; write none for it. Other deeds 5 to 40. Code practises rolled skills.",
};
const staticOf = request => request.chat[0].content;
const definitionOf = (templates, role) => templates.find(entry => entry.definition.role === role).definition;
const fieldsOf = (host, slug = 'foes') => host.head().domains.dataModules.instances[`pack.chat/${slug}`].chat.fields;
const FOES = (n, extra = ' | name: Silt Hound | count: 2 | level: 5') => `+ dm foes — a pack attacks | kind: set-slot-${n}${extra}`;

async function world(t, { answers = [], templates = STANDARD_TEMPLATES, settings = null, rpg = true } = {}) {
    const model = createFakeModel(answers);
    const host = await createHost({ callModel: model, ...(settings ? { settings } : {}) });
    t.after(() => host.close());
    host.features.set(LEAN_RPG_FEATURE, rpg);
    host.features.set(CORE_FEATURE.fightBoard, false);
    await host.send('Begin.', 'Opening.');
    for (const entry of templates) success(await host.sdk.command('dm.define', { definition: structuredClone(entry.definition) }));
    success(await host.sdk.command('dm.set', { module: 'pack.chat/character', fields: { who: 'Wessel', level: 15 } }));
    return { host, model };
}

test('a numbered family is one template line with N, and a closing line says what N is', () => {
    for (const [label, templates] of [['Standard', STANDARD_TEMPLATES]]) {
        const skills = moduleGrammar(definitionOf(templates, 'skills'), 'skills');
        assert.equal(skills.split('\n').filter(line => line.includes('kind: learn-N')).length, 1, label);
        assert.equal(skills.split('\n').filter(line => line.includes('kind: practice-N')).length, 1, label);
        assert.ok(skills.includes('N = 1..11 for learn-N and practice-N.'), label);
        assert.doesNotMatch(skills, /learn-(?:[1-9]|1[01])|practice-(?:[1-9]|1[01])/u, `${label}: no kind written eleven times`);
        const foes = moduleGrammar(definitionOf(templates, 'foes'), 'foes');
        for (const kind of ['set-slot-N', 'hurt-N', 'clear-N']) assert.equal(foes.split('\n').filter(line => line.includes(`kind: ${kind}`)).length, 1, `${label} ${kind}`);
        assert.ok(foes.includes('N = 1..4 for set-slot-N, hurt-N and clear-N.'), label);
        // The kinds themselves are as they were: the template is the text the narrator reads, never the definition.
        assert.deepEqual(Object.keys(definitionOf(templates, 'foes').kinds), [1, 2, 3, 4].flatMap(n => [`set-slot-${n}`, `hurt-${n}`, `clear-${n}`]));
        assert.equal(Object.keys(definitionOf(templates, 'skills').kinds).length, 22); // (11 learn + 11 practice: eight combat slots and three utility ones)
    }
});

test('a family needs three kinds numbered from 1; fewer, or a gap, are written kind by kind', () => {
    const labels = { amount: { type: 'int', min: 1, max: 9 } };
    const kind = { op: '+', labels, when: true, effects: [] };
    const make = names => ({ scope: 'chat', kinds: Object.fromEntries(names.map(name => [name, kind])), state: {} });
    assert.match(moduleGrammar(make(['tier-1', 'tier-2']), 'tiers'), /kind: tier-1[^]*kind: tier-2/u);
    assert.match(moduleGrammar(make(['tier-1', 'tier-3', 'tier-4']), 'tiers'), /kind: tier-1[^]*kind: tier-3[^]*kind: tier-4/u);
    const three = moduleGrammar(make(['tier-1', 'tier-2', 'tier-3']), 'tiers');
    assert.match(three, /kind: tier-N \| amount: 1\.\.9/u);
    assert.match(three, /N = 1\.\.3 for tier-N\./u);
    // Labels that differ keep a kind out of the family.
    const odd = make(['tier-1', 'tier-2', 'tier-3']);
    odd.kinds['tier-3'] = { ...kind, labels: { amount: { type: 'int', min: 1, max: 5 } } };
    assert.match(moduleGrammar(odd, 'tiers'), /kind: tier-1[^]*kind: tier-2[^]*kind: tier-3/u);
});

// (the Character's says what each rest kind restores, so it only has to stay shorter than before)
test('the Standard descriptions are shorter', () => {
    for (const role of ['character', 'skills', 'foes', 'rules']) {
        const lean = definitionOf(STANDARD_TEMPLATES, role).prompt;
        assert.ok(lean.length < BEFORE[role].length * (role === 'character' ? 1 : 0.85), `${role}: ${lean.length} against ${BEFORE[role].length}`);
        assert.ok(lean.length <= 1200, `${role} fits the block's room`);
    }
    for (const heading of ['No Plot Armor:', 'Exchanges:', 'Weight & Risk:', 'Believable Outcomes:', 'Rolls:']) assert.ok(definitionOf(STANDARD_TEMPLATES, 'rules').prompt.includes(heading), heading);
});

test('the health words are told once: a later list that is the same is "same words as" the first', { skip }, async t => {
    const { host } = await world(t);
    await host.send('One.', FOES(1) && reply(FOES(1)));
    const { request } = await host.send('Two.', 'The hound circles.');
    const text = staticOf(request), words = 'Down|Badly wounded|Wounded|Hurt|Scratched|Unhurt (0..5)';
    assert.equal(text.split(words).length - 1, 1, 'the words once');
    assert.match(text, /kind: hurt-N \| to: same words as character set-health/u);
});

test('"same words as" names only a line that is in the prompt: a first line the budget cuts leaves the words to the next module', () => {
    const mood = { type: 'enum', values: ['calm and quiet', 'tense and watchful', 'angry and loud', 'afraid and small'] };
    const kind = labels => ({ op: '+', labels, when: true, effects: [] });
    const filler = Object.fromEntries(Array.from({ length: 60 }, (_, n) => [`filler${String.fromCharCode(97 + (n % 26))}${String.fromCharCode(97 + Math.floor(n / 26))}`, kind({ x: { type: 'enum', values: ['a', 'b'] } })]));
    const first = { scope: 'chat', kinds: { ...filler, mood: kind({ mood }) }, state: {} };
    const second = { scope: 'chat', kinds: { mood: kind({ mood }) }, state: {} };
    const seen = new Map();
    const cut = moduleGrammar(first, 'first', { seen });
    assert.doesNotMatch(cut, /kind: mood/u, 'the budget cut the mood line');
    assert.match(moduleGrammar(second, 'second', { seen }), /mood: calm and quiet\|tense and watchful\|angry and loud\|afraid and small$/u, 'the words in full');
    // A first line that is in the prompt is still referred to.
    const kept = new Map();
    moduleGrammar({ scope: 'chat', kinds: { mood: kind({ mood }) }, state: {} }, 'first', { seen: kept });
    assert.match(moduleGrammar(second, 'second', { seen: kept }), /mood: same words as first mood/u);
});

test('a quiet reply leaves out the combat text, the Foes description, hurt and clear; the party line and the opening Foes line stays', { skip }, async t => {
    const { host } = await world(t);
    const { request } = await host.send('I walk on.', 'The road is quiet.');
    const text = staticOf(request);
    assert.doesNotMatch(text, /\[COMBAT SYSTEM\]/u);
    assert.doesNotMatch(text, /kind: hurt-N|kind: clear-N|foe groups in the fight/u);
    assert.match(text, /^\+ party /mu, 'the party line stays on every reply: companions join in calm scenes');
    assert.match(text, /\+ dm foes — reason \| kind: set-slot-N \| name: text \| count: 1\.\.99 \| level: 1\.\.99/u);
    assert.match(text, /N = 1\.\.4 for set-slot-N\./u);
    // What the narrator needs on every reply stays.
    assert.match(text, /kind: set-health/u);
    assert.match(text, /kind: learn-N/u);
    // Practice comes only from rolled uses (the RPG on, Rolls automatic): no practice-N line is offered.
    assert.doesNotMatch(text, /practice-N/u);
    assert.match(text, /N = 1\.\.11 for learn-N\./u);
});

test('a quiet reply (Standard, marked Character) tells no XP line, and the combat text does not show', { skip }, async t => {
    // (the marked Character: XP is the code's alone, so the quiet reply says nothing about XP lines, and the rest of the combat text does not show)
    const { host } = await world(t, { templates: STANDARD_TEMPLATES });
    const { request } = await host.send('I walk on.', 'The road is quiet.');
    const text = staticOf(request);
    assert.doesNotMatch(text, /XP guide|Other deeds|add-xp|XP line/u);
    assert.doesNotMatch(text, /\[COMBAT SYSTEM\]|No Plot Armor/u);
    host.close();
});

test('a fight the narrator opens without a plan still parses; from the next reply the combat text and the whole grammar are told', { skip }, async t => {
    const { host } = await world(t);
    const { request: first } = await host.send('A hound growls.', reply(FOES(2)));
    assert.doesNotMatch(staticOf(first), /\[COMBAT SYSTEM\]/u, 'the opening reply was quiet');
    assert.deepEqual(host.store.problems(), []);
    assert.deepEqual([fieldsOf(host).foe2, fieldsOf(host).count2, fieldsOf(host).level2], ['Silt Hound', 2, 5], 'the line was read');
    assert.equal(fightIsOpen(host.head()), true);
    const { request: next } = await host.send('I draw my blade.', reply('~ dm foes — it is cut | kind: hurt-2 | to: Wounded'));
    const text = staticOf(next);
    assert.match(text, /\[COMBAT SYSTEM\]/u);
    assert.match(text, /kind: hurt-N/u);
    assert.match(text, /kind: clear-N/u);
    assert.match(text, /\+ party /u);
    assert.deepEqual(host.store.problems(), []);
    assert.ok(fieldsOf(host).hurt2 < 4, 'the hurt line was read');
    // (PINNED CHANGE, FIGHT-FIX 1: a block of Down groups alone is a won fight, not an open one: the next reply is quiet and the combat text is not told; a
    // new fight takes the Down group's slot, so the narrator no longer needs the clear kind. A clear line written all the same still parses.)
    const { request: down } = await host.send('I finish it.', reply('~ dm foes — it falls | kind: hurt-2 | to: Down'));
    assert.match(staticOf(down), /kind: clear-N/u, 'the reply that wrote the Down line was told the full grammar');
    const { request: cleared } = await host.send('I move on.', reply('- dm foes — it is down | kind: clear-2 | why: down'));
    assert.doesNotMatch(staticOf(cleared), /\[COMBAT SYSTEM\]|kind: clear-N/u, 'Down groups alone are no open fight: the quiet reply');
    assert.equal(fightIsOpen(host.head()), false);
    assert.equal(fieldsOf(host).count2, 0);
    assert.deepEqual(host.store.problems(), []);
    const { request: after } = await host.send('Quiet again.', 'Dawn.');
    assert.doesNotMatch(staticOf(after), /\[COMBAT SYSTEM\]|kind: clear-N/u, 'the fight is over: quiet');
});

test('every foe kind of every slot is read on a quiet reply, the same as with the full grammar', { skip }, async t => {
    const { host } = await world(t);
    const lines = [1, 2, 3, 4].map(n => FOES(n, ` | name: Foe ${n} | count: ${n} | level: 5`));
    const { request } = await host.send('A crowd.', reply(...lines));
    assert.doesNotMatch(staticOf(request), /kind: hurt-N/u, 'the opening prompt had no hurt line');
    assert.deepEqual(readSheet(host.head()).foes.filter(foe => foe.filled).map(foe => [foe.slot, foe.name, foe.count]), [[1, 'Foe 1', 1], [2, 'Foe 2', 2], [3, 'Foe 3', 3], [4, 'Foe 4', 4]]);
    await host.send('Hit.', reply(...[1, 2, 3, 4].map(n => `~ dm foes — hit | kind: hurt-${n} | to: Hurt`)));
    await host.send('Done.', reply(...[1, 2, 3, 4].map(n => `- dm foes — gone | kind: clear-${n} | why: fled`)));
    assert.deepEqual(readSheet(host.head()).foes.filter(foe => foe.filled), []);
    assert.deepEqual(host.store.problems(), []);
});

test('the same reply rebuilt tells the same prompt: a swipe that keeps its plan, a quiet one, an open fight', { skip }, async t => {
    const { host } = await world(t);
    const { request: rolled } = await host.send('I pick the lock on the door.', 'It gives.');
    const { request: swiped } = await host.swipe('It sticks.');
    assert.equal(staticOf(swiped), staticOf(rolled), 'rolls: swipe');
    const { request: quiet } = await host.send('I look around.', 'Nothing.');
    const { request: again } = await host.swipe('Still nothing.');
    assert.equal(staticOf(again), staticOf(quiet), 'quiet: swipe');
    assert.doesNotMatch(staticOf(quiet), /\[COMBAT SYSTEM\]/u);
    await host.send('A hound!', reply(FOES(1)));
    const { request: fight } = await host.send('I strike.', 'It yelps.');
    const { request: fightAgain } = await host.swipe('It snarls.');
    assert.equal(staticOf(fightAgain), staticOf(fight), 'fight: swipe');
    assert.match(staticOf(fight), /\[COMBAT SYSTEM\]/u);
    // A cold rebuild of the story gives the same state, so the same prompt.
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live);
});

test('the full text stays where quiet does not apply: Rolls off, the RPG off, and a count with no reply in hand', { skip }, async t => {
    const off = await world(t, { settings: { modules: { 'story-block': { rpgRolls: 'off' } } } });
    const { request: rollsOff } = await off.host.send('I walk on.', 'Quiet.');
    assert.match(staticOf(rollsOff), /\[COMBAT SYSTEM\]/u, 'Rolls off: the fight is the narrator\'s');
    const plain = await world(t, { rpg: false });
    const { request: rpgOff } = await plain.host.send('I walk on.', 'Quiet.');
    assert.match(staticOf(rpgOff), /\[COMBAT SYSTEM\]/u, 'the RPG off: the blocks are told like any other');
    assert.match(staticOf(rpgOff), /kind: hurt-N/u);
    // No hint (the Features page counting the static part): in full.
    const counted = off.host.registry.contexts().find(row => row.moduleId === 'story-block').static();
    assert.match(counted, /\[COMBAT SYSTEM\]/u);
    assert.equal(isQuiet(undefined, off.host.head(), {}), false);
    assert.equal(isQuiet({ view: { state: off.host.head(), feature: () => true }, rolled: false }, off.host.head(), {}), true);
    assert.deepEqual(Object.keys(QUIET_GRAMMAR), ['rules', 'foes']);
});

test('an older chat keeps the text its blocks were pinned with; only a block made now has the shorter text', { skip }, async t => {
    // A Standard Foes and Combat rules block pinned before this change (the long texts) are told in full while a fight is open, word for word.
    const old = (role, prompt) => ({ definition: { ...structuredClone(definitionOf(STANDARD_TEMPLATES, role)), prompt } });
    const { host } = await world(t, { templates: [STANDARD_TEMPLATES[0], old('foes', BEFORE.foes), old('rules', BEFORE.rules)] });
    await host.send('A hound!', reply(FOES(1)));
    const { request } = await host.send('I strike.', 'It yelps.');
    const text = staticOf(request);
    assert.ok(text.includes(BEFORE.foes), 'the pinned description, unchanged');
    assert.ok(text.includes('Tell the rolled result; code moves the bars for hits, heals, skill costs: never set those.'), 'the pinned combat text, unchanged');
    // (the family template applies to what is told, whatever the pin)
    assert.match(text, /kind: hurt-N/u);
    assert.doesNotMatch(text, /kind: hurt-2/u);
});
