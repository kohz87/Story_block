// Review F follow-ups on the Standard formula: the tail's bars after the roll and a new fight's order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, hostAvailable } from '../../../testkit/index.js';
import { STANDARD_TEMPLATES } from '../../../src/v2/lean-rpg/templates.js';
import { readSheet } from '../../../src/v2/lean-rpg/read.js';
import { barFields, stageText } from '../../../src/v2/lean-rpg/blocks.js';
import { success } from '../data-modules/helpers.js';
import { tailOf } from './helpers.js';
import { legacyPlanner } from './legacy-planner.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;

const standard = name => structuredClone(STANDARD_TEMPLATES.find(entry => entry.name === name).definition);

// A whole host on the Standard formula with Wessel, his skills and a foe group of level 35, and a planner that keeps asking for a fight.
async function game(t, { answers, settings = {}, foes = [['Weir-drake', 1, 35]] } = {}) {
    const callModel = async () => (answers.length > 1 ? answers.shift() : answers[0]);
    let host = null;
    // (the real host with the test-only legacy planner behind the RPG part's hook: the planner itself is gone)
    const rpgLoad = async () => { const lib = await import('../../../src/v2/lean-rpg/index.js'); return { ...lib, createLeanRpgPart(deps) { const part = lib.createLeanRpgPart(deps); part.hooks.beforeGenerate = legacyPlanner(part, { callModel, chat: () => host.ctx.chat, metadata: () => host.ctx.chatMetadata ?? null }); return part; } }; };
    host = await createHost({ callModel, lazyRpg: true, rpgLoad, settings: { modules: { 'story-block': settings } } });
    t.after(() => host.close());
    host.features.set('story-block.rpg', true);
    host.features.set('story-block.fight-board', false);
    await host.send('Begin.', 'Opening.');
    const character = standard('Character'); character.slug = 'wessel'; character.name = 'Wessel'; character.state.who.default = 'Wessel';
    const stats = { str: 10, vit: 10, agi: 10, dex: 10, int: 5, luk: 5, cha: 5 };
    for (const [key, value] of Object.entries(stats)) character.state[key].default = value;
    // (a new character's bars start full for its stats, as the wizard makes them)
    for (const [key, value] of Object.entries(barFields(stats))) character.state[key].default = value;
    const skills = standard('Skills'); skills.slug = 'wessel-skills'; skills.state.who.default = 'Wessel'; skills.state.skill1.default = 'Iron Breath'; skills.state.stat1.default = 'str';
    const block = standard('Foes');
    foes.forEach(([name, count, level], n) => { block.state[`foe${n + 1}`].default = name; block.state[`count${n + 1}`].default = count; block.state[`level${n + 1}`].default = level; });
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
        if (foe.hurt < foe.size) assert.match(tail, new RegExp(`Weir-drake \\(Lv 35, ${stageText('foe', foe.hurt, foe.size)}\\)`), `the foe's word after the roll (${foe.hurt} of ${foe.size})`);
        if (hero.health < hero.size.health) assert.match(tail, new RegExp(`Wessel — health ${stageText('health', hero.health, hero.size.health)};`), 'his word after the roll');
        if (changed) checked += 1;
    }
    assert.ok(checked >= 1, 'a roll hurt someone');
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
