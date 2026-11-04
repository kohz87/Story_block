// FIGHT-FIX 2-4: a skill that runs out of Mana or Stamina falls back to its `else:` skill, else to a plain physical single-target attack; the cue says which,
// puts the verdict word first, and tells the groups a roll opened.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hostAvailable } from '../../../testkit/index.js';
import { parsePlanAnswer, prepare, readSheet, rollPrepared, validatePlan } from '../../../src/v2/lean-rpg/index.js';
import { STANDARD_FORMULA } from '../../../src/v2/lean-rpg/rules.js';
import { PRECALL_HEAD_STANDARD } from '../../../src/v2/lean-rpg/precall.js';
import { cueOfResult, cueText, lineText } from '../../../src/v2/lean-rpg/cue.js';
import { usesOf } from '../../../src/v2/lean-rpg/practice.js';
import { character, foeBlock, rollReceipt, setup, sheetDomain, skillBlock } from './helpers.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const blocks = (mana = 2, stamina = 4) => ({
    astra: { role: 'character', fields: character('Astra', { health: 6, mana, stamina, str: 10, vit: 10, agi: 14, dex: 8, int: 10, luk: 9, cha: 5, soul: 2 }) },
    'astra-skills': { role: 'skills', fields: skillBlock('Astra', [['Shadow Cut', 1, 'agi', 'mana'], ['Iaijutsu', 1, 'agi', 'stamina']]) },
    foes: { role: 'foes', fields: foeBlock([['Rats', 12, 20, 5]]) },
});
const sheet = (...args) => readSheet({ domains: { dataModules: sheetDomain(blocks(...args)) } });
const rules = { ...STANDARD_FORMULA };
// Every act misses, so the fight is never won and the rounds go on to the cap: 5 rounds are told.
const misses = () => Object.assign((kind, at) => { const list = kind === 'act' ? Array(30).fill(2) : []; return () => (list.length ? list.shift() : 10); }, { positional: true });
const CUT = 'act Astra | skill: Shadow Cut | type: magic | target: Rats | area';
const roll = (answer, options = {}) => {
    const s = sheet(...(options.sheet ?? []));
    const plan = parsePlanAnswer(['pace: all', answer].join('\n'), s, { formula: 'standard' }).plan;
    return { plan, result: rollPrepared(plan, prepare(plan, s, rules), misses(), rules, { flow: 2 }) };
};
const actLines = result => result.rounds.map(round => round.lines.find(line => line.kind === 'act')).filter(Boolean);

test('2: with Mana 2 an area Shadow Cut is used twice, then the plain roll is a physical, single-target attack with the physical pair', () => {
    const { result } = roll(CUT);
    const lines = actLines(result);
    assert.ok(lines.length >= 5, 'five rounds');
    assert.deepEqual(lines.slice(0, 2).map(line => [line.skill, line.type, line.area === true]), [['Shadow Cut', 'magic', true], ['Shadow Cut', 'magic', true]]);
    for (const line of lines.slice(2, 5)) {
        assert.deepEqual([line.skill ?? null, line.type, line.area ?? false, line.without, line.withoutUses], [null, 'physical', false, 'Shadow Cut', 'mana']);
        assert.deepEqual([line.pc.stat, line.pc.second], ['str', 'dex'], 'the physical pair, not the magic one');
    }
    assert.match(result.text, /Round 3: Astra → Rats \(no skill: Shadow Cut's Mana is spent; a plain weapon attack — name no skill\): FAIL/);
    assert.doesNotMatch(result.text.split('\n').filter(line => /^Round [345]:/.test(line)).join('\n'), /\(area\)/, 'no "(area)" for the plain roll');
});

test('2/3: with the Mana already empty at the start the action goes on with its `else:` skill, else as a plain physical single-target attack (a roll made before keeps its own)', () => {
    const withElse = actLines(roll(`${CUT} | else: Iaijutsu`, { sheet: [0, 4] }).result);
    assert.ok(withElse.length >= 5);
    for (const line of withElse.slice(0, 3)) assert.deepEqual([line.skill, line.type, line.area ?? false, line.without, line.withoutUses], ['Iaijutsu', 'physical', false, 'Shadow Cut', 'mana']);
    const plain = actLines(roll(CUT, { sheet: [0, 4] }).result);
    for (const line of plain.slice(0, 3)) assert.deepEqual([line.skill ?? null, line.type, line.area ?? false, line.pc.stat, line.pc.second], [null, 'physical', false, 'str', 'dex']);
    // (a payload without `fix` is prepared as it was: the plan's own type and area, no backup)
    const s = sheet(0, 4);
    const plan = parsePlanAnswer(['pace: all', `${CUT} | else: Iaijutsu`].join('\n'), s, { formula: 'standard' }).plan;
    const old = rollPrepared(plan, prepare(plan, s, rules, { fix: false }), misses(), rules, { flow: 2 });
    assert.deepEqual(actLines(old).slice(0, 2).map(line => [line.skill ?? null, line.type, line.area === true]), [[null, 'magic', true], [null, 'magic', true]]);
});

test('3: `else:` parses and validates; a backup the character lacks is dropped; the Standard head asks for it in few words', () => {
    const s = sheet();
    const { plan } = parsePlanAnswer(['pace: all', `${CUT} | else: Iaijutsu`].join('\n'), s, { formula: 'standard' });
    assert.deepEqual(plan.acts, [{ who: 'Astra', skill: 'Shadow Cut', else: 'Iaijutsu', type: 'magic', area: true, target: 'Rats' }]);
    assert.equal(validatePlan(plan).ok, true);
    assert.equal(validatePlan({ ...plan, acts: [{ ...plan.acts[0], else: '' }] }).ok, false);
    assert.equal('else' in parsePlanAnswer(['pace: all', `${CUT} | else: Nothing Known`].join('\n'), s, { formula: 'standard' }).plan.acts[0], false);
    assert.equal('else' in parsePlanAnswer('pace: all\nact Astra | type: physical | target: Rats | else: Iaijutsu', s, { formula: 'standard' }).plan.acts[0], false, 'no skill, no backup');
    assert.ok(PRECALL_HEAD_STANDARD.includes('- A skill that spends Mana or Stamina may run out: add `else:` with the skill to use then.'));
});

test('3: with `else: Iaijutsu` rounds 3+ are named Iaijutsu (its own type and stat, spending Stamina), practice goes only to the skill rolled; the cue names the backup', () => {
    const { result } = roll(`${CUT} | else: Iaijutsu`, { sheet: [2, 3] });   // Mana 2, Stamina 3
    const lines = actLines(result);
    assert.deepEqual(lines.slice(0, 2).map(line => line.skill), ['Shadow Cut', 'Shadow Cut']);
    for (const line of lines.slice(2, 5)) {
        assert.deepEqual([line.skill, line.type, line.area ?? false, line.pc.stat, line.without], ['Iaijutsu', 'physical', false, 'agi', 'Shadow Cut']);
        assert.match(line.cost.id, /:stamina$/, 'it spends its own resource (Stamina)');
    }
    assert.match(result.text, /Round 3: Astra → Rats \(Iaijutsu\) \(Shadow Cut's Mana is spent; Iaijutsu instead\)|Round 3: Astra → Rats \(Iaijutsu\)/);
    const uses = usesOf({ checks: result.checks, rounds: result.rounds, opening: result.opening });
    assert.deepEqual(uses.map(use => [use.skill, use.n]), [['Iaijutsu', 3], ['Shadow Cut', 2]], 'Shadow Cut twice, Iaijutsu three times (its Stamina): practice only for what was rolled');
    // with both resources spent the act is the plain attack again
    const both = roll(`${CUT} | else: Iaijutsu`, { sheet: [2, 1] });
    const bothLines = actLines(both.result);
    assert.deepEqual(bothLines.slice(2, 3).map(line => line.skill), ['Iaijutsu'], 'Iaijutsu while its Stamina lasts');
    assert.deepEqual([bothLines[3].skill ?? null, bothLines[3].type, bothLines[3].area ?? false], [null, 'physical', false], 'then the plain attack');
});

test('3 on the real host: the `else` roll, its practice step and a rebuild, a Re-read and a reload agree', { skip }, async () => {
    const answer = ['pace: all', `${CUT} | else: Iaijutsu`].join('\n');
    const { host } = await setup({ blocks: blocks(), answers: [answer], settings: { rpgFormula: 'standard' } });
    await host.send('I cut them down.', 'Steel flashes.');
    const at = host.ctx.chat.length - 1;
    const result = rollReceipt(host, at).data.v2.result;
    const named = result.rounds.flatMap(round => round.lines).filter(line => line.kind === 'act').map(line => line.skill);
    assert.ok(named.includes('Shadow Cut'));
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, 'a rebuild gives the live story');
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.equal(JSON.stringify(rollReceipt(host, at).data.v2.result), JSON.stringify(result), 'a Re-read keeps the dice');
    const afterReread = JSON.stringify(host.head());
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(JSON.stringify(host.head()), afterReread, 'a reload agrees');
    host.close();
});

const pc = { who: 'Astra', die: 14, stat: 'agi', second: 'dex', statBonus: 5, classBonus: 4, rank: 1, edge: 0, total: 24 };
const act = extra => ({ kind: 'act', type: 'physical', skill: 'Iaijutsu', pc, foe: { slot: 1, name: 'rats', die: 6, base: 5, classBonus: 3, total: 14 }, outcome: 'success', ...extra });

test('4: the verdict word comes first ("DECISIVE SUCCESS", "FAIL, DECISIVE"), the head says to name only the skill a line names, and a fallback says why', () => {
    assert.match(lineText(act({ decisive: true, damage: { to: 0 } }), {}), /: DECISIVE SUCCESS \(24 vs 14\), a hit$/);
    assert.match(lineText(act({ outcome: 'fail', decisive: true }), {}), /: FAIL, DECISIVE \(24 vs 14\)$/);
    assert.match(lineText(act({ outcome: 'cost' }), {}), /: SUCCESS AT A COST \(24 vs 14\)$/);
    const text = cueText({ checks: [], rounds: [{ n: 1, decisive: false, lines: [act({})] }], refused: [], decisive: false });
    assert.match(text, /Tell them in this order and as given\. Name only the skill a line names, and never invent a roll/);
    assert.match(lineText(act({ skill: null, without: 'Shadow Cut', withoutUses: 'mana' }), {}), /\(no skill: Shadow Cut's Mana is spent; a plain weapon attack — name no skill\)/);
    assert.match(lineText(act({ without: 'Shadow Cut', withoutUses: 'mana' }), {}), /\(Iaijutsu\) \(Shadow Cut's Mana is spent; Iaijutsu instead\)/);
});

test('4: one line for the groups a roll opened ("New foes: rats ×12 (Lv 2)"), so the prose uses the rolled count; none when nothing opened', () => {
    const record = { v: 1, key: 'k', pace: 'all', stop: 'pace', checks: [], rounds: [{ n: 1, decisive: false, lines: [act({})] }], refused: [], opened: [{ slot: 1, module: 'pack.chat/foes', name: 'rats', count: 12, level: 2 }, { slot: 2, name: 'eels', count: 3 }] };
    assert.match(cueOfResult(record), /\nNew foes: rats ×12 \(Lv 2\), eels ×3\.\n/);
    assert.doesNotMatch(cueOfResult({ ...record, opened: undefined }), /New foes/);
});
