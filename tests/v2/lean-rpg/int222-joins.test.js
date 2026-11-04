// INT-222: where two sides of the 2.22.0 merge changed the same logic, the joined behaviour is pinned here.
//  - 2.21.0 "practice comes only from rolls" x 2.22.0 extra skill slots: practice-6/7/8 on a new reply is refused like practice-1..5;
//  - 2.21.0 FIGHT-FIX (a spent skill falls back) x 2.22.0 extra slots: a skill in slot 6-8 that runs out falls back to its `else:` skill, else to a plain attack.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, hostAvailable } from '../../../testkit/index.js';
import { createFakeModel } from '../../../testkit/model.js';
import { LEAN_RPG_FEATURE, parsePlanAnswer, prepare, readSheet, rollPrepared } from '../../../src/v2/lean-rpg/index.js';
import { STANDARD_FORMULA } from '../../../src/v2/lean-rpg/rules.js';
import { LEAN_RPG_TEMPLATES } from '../../../src/v2/lean-rpg/templates.js';
import { reply } from '../data-modules/helpers.js';
import { character, foeBlock, sheetDomain } from './helpers.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const definitionOf = name => structuredClone(LEAN_RPG_TEMPLATES.find(entry => entry.name === name).definition);
const LEARN = (n, name) => `~ dm skills — learned | kind: learn-${n} | name: ${name} | about: x. | stat: str | uses: stamina`;
const NAMES = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'];
const fieldsOf = host => host.head().domains.dataModules.instances['pack.chat/skills'].chat.fields;
const REFUSED = 'Practice comes from rolled skill uses';
const refusals = host => host.turn.problems().filter(problem => problem.message.includes(REFUSED));

async function world(t, rolls) {
    const host = await createHost({ callModel: createFakeModel(['none', 'none', 'none', 'none']), settings: { modules: { 'story-block': { rpgFormula: 'classic', rpgRolls: rolls } } } });
    t.after(() => host.close());
    host.features.set(LEAN_RPG_FEATURE, true);
    await host.send('Begin.', 'Opening.');
    for (const name of ['Character', 'Skills', 'Foes']) assert.equal((await host.sdk.command('dm.define', { definition: definitionOf(name) })).ok, true);
    assert.equal((await host.sdk.command('dm.set', { module: 'pack.chat/character', fields: { who: 'Astra', level: 60 } })).ok, true);
    assert.equal((await host.sdk.command('dm.set', { module: 'pack.chat/skills', fields: { who: 'Astra' } })).ok, true);
    await host.send('Learn.', reply(...NAMES.map((name, i) => LEARN(i + 1, name))));
    assert.equal(NAMES.filter((name, i) => fieldsOf(host)[`skill${i + 1}`] === name).length, 8, 'eight skills held at Lv 60');
    return host;
}

test('INT-222: with Rolls automatic a story practice-6, practice-7 and practice-8 are refused on a new reply, with a Problems line and the reply marked', { skip }, async t => {
    const host = await world(t, 'automatic');
    await host.send('Train.', reply(...[6, 7, 8].map(n => `+ dm skills — practised ${NAMES[n - 1]} | kind: practice-${n} | amount: 12`)));
    const f = fieldsOf(host);
    assert.deepEqual([f.practice6, f.practice7, f.practice8], [0, 0, 0], 'nothing credited');
    assert.equal(refusals(host).length, 3, 'one Problems line for each refused line');
    assert.equal(host.ctx.chat.at(-1).extra.storySuite.practiceRule, 'rolls', 'the reply is marked, so a Re-read refuses them again');
    const at = host.ctx.chat.length - 1;
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.deepEqual([fieldsOf(host).practice6, fieldsOf(host).practice7, fieldsOf(host).practice8], [0, 0, 0], 'a Re-read refuses again');
});

test('INT-222: with Rolls off practice-6..8 still work as before (and the reply is not marked)', { skip }, async t => {
    const host = await world(t, 'off');
    await host.send('Train.', reply(...[6, 7, 8].map(n => `+ dm skills — practised ${NAMES[n - 1]} | kind: practice-${n} | amount: 12`)));
    const f = fieldsOf(host);
    assert.deepEqual([f.practice6, f.practice7, f.practice8], [12, 12, 12]);
    assert.equal(refusals(host).length, 0);
    assert.equal(host.ctx.chat.at(-1).extra?.storySuite?.practiceRule, undefined);
});

// ---- a spent skill in an extra slot (FIGHT-FIX) -----------------------------------------------------------------------------

const pad = (prefix, list) => Object.fromEntries(Array.from({ length: 8 }, (_, n) => [`${prefix}${n + 1}`, list[n] ?? '']));
const eight = (mana = 0, stamina = 4) => {
    const names = ['Fencing', 'Dodge', 'Climb', 'Haggle', 'Lore', 'Shadow Cut', 'Iaijutsu', 'Spark'];
    const uses = ['stamina', 'stamina', 'stamina', 'stamina', 'stamina', 'mana', 'stamina', 'mana'];
    const stats = ['dex', 'agi', 'str', 'cha', 'int', 'agi', 'agi', 'int'];
    return {
        astra: { role: 'character', fields: character('Astra', { health: 6, mana, stamina, str: 10, vit: 10, agi: 14, dex: 8, int: 10, luk: 9, cha: 5, soul: 2 }) },
        'astra-skills': { role: 'skills', fields: { who: 'Astra', ...pad('skill', names), ...pad('rank', names.map(() => 1)), ...pad('practice', names.map(() => 0)), ...pad('stat', stats), ...pad('uses', uses), ...pad('about', names.map(() => '')) } },
        foes: { role: 'foes', fields: foeBlock([['Rats', 12, 20, 5]]) },
    };
};
const sheet = (...args) => readSheet({ domains: { dataModules: sheetDomain(eight(...args)) } });
const rules = { ...STANDARD_FORMULA };
const misses = () => Object.assign((kind) => { const list = kind === 'act' ? Array(30).fill(2) : []; return () => (list.length ? list.shift() : 10); }, { positional: true });
const roll = (answer, s) => {
    const plan = parsePlanAnswer(['pace: all', answer].join('\n'), s, { formula: 'standard' }).plan;
    return { plan, result: rollPrepared(plan, prepare(plan, s, rules, { fix: true }), misses(), rules, { flow: 2, fix: true }) };
};
const actLines = result => result.rounds.map(round => round.lines.find(line => line.kind === 'act')).filter(Boolean);

test('INT-222: Shadow Cut in slot 6 with the Mana spent falls back to its `else:` skill held in slot 7, else to a plain physical single-target attack', () => {
    const CUT = 'act Astra | skill: Shadow Cut | type: magic | target: Rats | area';
    const s = sheet(0, 4);
    const withElse = roll(`${CUT} | else: Iaijutsu`, s);
    assert.equal(withElse.plan.acts[0].else, 'Iaijutsu', 'a skill in slot 7 is a valid backup');
    for (const line of actLines(withElse.result).slice(0, 3)) assert.deepEqual([line.skill, line.type, line.area ?? false, line.without, line.withoutUses], ['Iaijutsu', 'physical', false, 'Shadow Cut', 'mana']);
    const plain = roll(CUT, s);
    for (const line of actLines(plain.result).slice(0, 3)) assert.deepEqual([line.skill ?? null, line.type, line.area ?? false, line.pc.stat, line.pc.second], [null, 'physical', false, 'str', 'dex']);
    // an eighth-slot skill is known to the planner too: Spark (slot 8, Mana) with the Mana spent falls back as well
    const spark = roll('act Astra | skill: Spark | type: magic | target: Rats | else: Iaijutsu', s);
    for (const line of actLines(spark.result).slice(0, 3)) assert.deepEqual([line.skill, line.without, line.withoutUses], ['Iaijutsu', 'Spark', 'mana']);
});
