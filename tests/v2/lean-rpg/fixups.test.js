// Review F follow-ups on the Standard formula: the tail's bars after the roll, a pack's Classic companion, the support wording, the wizard's
// Skills note, the planner's words for bars, and a new fight's order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, hostAvailable } from '../../../testkit/index.js';
import { LEAN_RPG_TEMPLATES, STANDARD_TEMPLATES } from '../../../src/v2/lean-rpg/templates.js';
import { readSheet } from '../../../src/v2/lean-rpg/read.js';
import { barFields, stageText } from '../../../src/v2/lean-rpg/blocks.js';
import { success } from '../data-modules/helpers.js';
import { tailOf } from './helpers.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;

const standard = name => structuredClone(STANDARD_TEMPLATES.find(entry => entry.name === name).definition);

// A whole host on the Standard formula with Wessel, his skills and a foe group of class IV, and a planner that keeps asking for a fight.
async function game(t, { answers, settings = { rpgFormula: 'standard' }, foes = [['Weir-drake', 1, 4]] } = {}) {
    const callModel = async () => (answers.length > 1 ? answers.shift() : answers[0]);
    const host = await createHost({ callModel, settings: { modules: { 'story-block': settings } } });
    t.after(() => host.close());
    host.features.set('story-block.rpg', true);
    await host.send('Begin.', 'Opening.');
    const character = standard('Character'); character.slug = 'wessel'; character.name = 'Wessel'; character.state.who.default = 'Wessel';
    const stats = { str: 10, vit: 10, agi: 10, dex: 10, int: 5, luk: 5, cha: 5 };
    for (const [key, value] of Object.entries(stats)) character.state[key].default = value;
    // (a new character's bars start full for its stats, as the wizard makes them)
    for (const [key, value] of Object.entries(barFields(stats))) character.state[key].default = value;
    const skills = standard('Skills'); skills.slug = 'wessel-skills'; skills.state.who.default = 'Wessel'; skills.state.skill1.default = 'Iron Breath'; skills.state.stat1.default = 'str';
    const block = standard('Foes');
    foes.forEach(([name, count, level], n) => { block.state[`foe${n + 1}`].default = name; block.state[`count${n + 1}`].default = count; block.state[`class${n + 1}`].default = level; });
    for (const definition of [character, skills, block]) success(await host.sdk.command('dm.define', { definition }));
    return host;
}
const FIGHT = ['pace: all', 'act Wessel | skill: Iron Breath | type: physical | target: Weir-drake', 'foe Weir-drake | target: Wessel'].join('\n');

test('1: the tail\'s block lines are the sheet after this reply\'s roll, the same bars the cue ends on', { skip }, async t => {
    const host = await game(t, { answers: [FIGHT] });
    let checked = 0;
    for (let n = 0; n < 8 && checked < 2; n += 1) {
        const before = readSheet(host.head());
        const { request } = await host.send(`I strike ${n}.`, `Told ${n}.`);
        const after = readSheet(host.head()), foe = after.foes[0], hero = after.characters[0];
        const changed = foe.hurt !== before.foes[0].hurt || hero.health !== before.characters[0].health;
        const tail = tailOf(request);
        if (foe.hurt < foe.size) assert.match(tail, new RegExp(`Weir-drake \\(Class IV, ${stageText('foe', foe.hurt, foe.size)}\\)`), `the foe's word after the roll (${foe.hurt} of ${foe.size})`);
        if (hero.health < hero.size.health) assert.match(tail, new RegExp(`Wessel — health ${stageText('health', hero.health, hero.size.health)};`), 'his word after the roll');
        if (changed) checked += 1;
    }
    assert.ok(checked >= 1, 'a roll hurt someone');
});

// (A party line means something once the story has a character: Wessel, from the stock Character template.)
async function hero(host) {
    const character = structuredClone(LEAN_RPG_TEMPLATES.find(entry => entry.name === 'Character').definition);
    character.slug = 'wessel'; character.name = 'Wessel'; character.state.who.default = 'Wessel';
    success(await host.sdk.command('dm.define', { definition: character }));
}

test('2: a pack that names Classic (the reader chose nothing) makes a Classic companion', { skip }, async t => {
    const callModel = async () => 'none';
    const host = await createHost({ callModel, settings: { modules: { 'story-block': { rpgJoin: 'auto' } } } });
    t.after(() => host.close());
    host.features.set('story-block.rpg', true);
    const pack = { id: 'old-rules', version: '1.0.0', name: 'Old rules', author: 'Test', description: 'Plays on Classic.', requires: { storyBlock: '^2' }, content: { rpg: { formula: 'classic' } } };
    assert.equal((await host.packs.packs.install(pack)).ok, true);
    await host.send('Begin.', 'Opening.');
    await hero(host);
    await host.send('Mara arrives.', '+ party Mara | about: a hedge-witch | class: I | best: int');
    const mara = host.sdk.query('dataModules.view', { module: 'pack.chat/mara' })?.chat;
    assert.ok(mara, 'the companion was made');
    assert.deepEqual([mara.str, mara.int, mara.health], [10, 14, 5], 'Classic: every stat 10, the best 14, Health a stage');
    // Without the pack the same line makes a Standard companion.
    const plain = await createHost({ callModel, settings: { modules: { 'story-block': { rpgJoin: 'auto' } } } });
    t.after(() => plain.close());
    plain.features.set('story-block.rpg', true);
    await plain.send('Begin.', 'Opening.');
    await hero(plain);
    await plain.send('Mara arrives.', '+ party Mara | about: a hedge-witch | class: I | best: int');
    const standardMara = plain.sdk.query('dataModules.view', { module: 'pack.chat/mara' })?.chat;
    assert.deepEqual([standardMara.str, standardMara.int], [5, 9]);
});

test('5: the planner\'s words for bars come from the block\'s own size and value, whatever formula the chat plays', { skip }, async t => {
    const planner = async (formula, makeBlock) => {
        const asked = [];
        const host = await createHost({ callModel: async prompt => { asked.push(prompt); return 'none'; }, settings: { modules: { 'story-block': { rpgFormula: formula } } } });
        t.after(() => host.close());
        host.features.set('story-block.rpg', true);
        await host.send('Begin.', 'Opening.');
        for (const definition of makeBlock()) success(await host.sdk.command('dm.define', { definition }));
        await host.send('I look around.', 'Told.');
        return asked.at(-1);
    };
    const hero = (templates, over) => () => {
        const character = structuredClone(templates.find(entry => entry.name === 'Character').definition);
        character.slug = 'wessel'; character.name = 'Wessel'; character.state.who.default = 'Wessel';
        for (const [key, value] of Object.entries(over)) character.state[key].default = value;
        return [character];
    };
    // Classic blocks under Standard, VIT 10 (a size of 6 by the formula): a full 5 of 5 stages is Unhurt, not Scratched.
    const classicBlocks = await planner('standard', hero(LEAN_RPG_TEMPLATES, { vit: 10, health: 5 }));
    assert.match(classicBlocks, /Health Unhurt/);
    // Standard blocks read by a Classic chat: 8 blocks of a 0..8 bar is its own word, not "?".
    const standardBlocks = await planner('classic', hero(STANDARD_TEMPLATES, { vit: 20, health: 8, 'health-blocks': 8 }));
    assert.match(standardBlocks, /Health Unhurt/);
    assert.doesNotMatch(standardBlocks, /Health \?/);
    const hurt = await planner('classic', hero(STANDARD_TEMPLATES, { vit: 20, health: 6, 'health-blocks': 8 }));
    assert.match(hurt, /Health (Scratched|Hurt)/, '6 of 8 blocks is a word of the bar');
});

// ---- 6: a new group after a fight that ended ---------------------------------------------------------------------------------

import { prepare, rollPrepared, readSheet as readSheetOf, STANDARD_FORMULA as RULES } from '../../../src/v2/lean-rpg/index.js';
import { character, foeBlock, sheetDomain, skillBlock } from './helpers.js';

const rats = (hurt, extra = {}) => ({
    wessel: { role: 'character', fields: character('Wessel', { health: 6, str: 10, vit: 10, agi: 10, dex: 6, soul: 2, ...extra }) },
    'wessel-skills': { role: 'skills', fields: skillBlock('Wessel', [['Iron Breath', 2, 'str']]) },
    foes: { role: 'foes', fields: foeBlock([['Sluice Rats', 6, 2, hurt]]) },
});
const scripted = table => (kind, at) => { const list = [...(table[`${kind}${at}`] ?? [])]; return () => (list.length ? list.shift() : 10); };
const fightOf = (hurt, carried, table = {}) => {
    const sheet = readSheetOf({ domains: { dataModules: sheetDomain(rats(hurt)) } });
    const plan = { formula: 'standard', pace: 'careful', acts: [{ who: 'Wessel', skill: 'Iron Breath', target: 'Sluice Rats' }], foes: [{ slot: 1, target: 'Wessel' }], checks: [] };
    return rollPrepared(plan, prepare(plan, sheet, RULES), scripted(table), RULES, { carried });
};
const old = left => [{ id: 'f:1', name: 'Sluice Rats', total: 30, agi: 0, party: false, left }, { id: 'c:wessel', name: 'Wessel', total: 12, agi: 10, party: true }];

test('6: a same-named group that arrives after the fight ended is a new fight: a new order and a quick start; one still hurt goes on', () => {
    // The fight ended with the rats beaten (left 0); a full group (4 blocks) arrives under the same name.
    const next = fightOf(4, old(0), { init0: [20], init1: [20], init17: [1] });
    assert.ok(next.order.every(entry => entry.fresh), 'every total is rolled again');
    assert.deepEqual(next.quickStart, [{ who: 'Wessel', against: 'Sluice Rats' }], 'and a quick start applies');
    // It ended with the group at 2 blocks (fled or yielded); a full one arriving is new, one still at 2 is the same group.
    assert.ok(fightOf(4, old(2)).order.every(entry => entry.fresh));
    const goes = fightOf(2, old(2));
    assert.deepEqual(goes.order.map(entry => [entry.id, entry.fresh]), [['f:1', false], ['c:wessel', false]]);
    assert.deepEqual(goes.quickStart, []);
    // An order recorded before groups were followed (no `left`) goes on as it did.
    assert.equal(fightOf(4, old(undefined)).order.find(entry => entry.id === 'f:1').fresh, false);
    // What a roll records: where each foe group stands when the reply ends.
    const recorded = fightOf(1, null, { act0: [20, 10], init1: [10], init17: [1] });
    assert.equal(recorded.order.find(entry => entry.id === 'f:1').left, 0);
    assert.equal(recorded.order.find(entry => entry.id === 'c:wessel').left, undefined, 'only foes');
});
