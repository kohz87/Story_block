// THEN-FIX: `then:` (the skill rounds 2 on use), the spent note naming only the pool that is spent, and a defender's skill only when the message asks for it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hostAvailable } from '../../../testkit/index.js';
import { prepare, readSheet, rollPrepared, validatePlan } from '../../../src/v2/lean-rpg/index.js';
import { parsePlanAnswer } from './legacy-planner.js';
import { STANDARD_FORMULA } from '../../../src/v2/lean-rpg/rules.js';
import { FIX_VERSION } from '../../../src/v2/lean-rpg/names.js';
import { cueOfResult, lineText } from '../../../src/v2/lean-rpg/cue.js';
import { usesOf } from '../../../src/v2/lean-rpg/practice.js';
import { character, foeBlock, rollReceipt, setup, sheetDomain, skillBlock } from './helpers.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;
const blocks = (mana = 3, stamina = 4) => ({
    astra: { role: 'character', fields: character('Astra', { health: 6, mana, stamina, str: 10, vit: 10, agi: 14, dex: 8, int: 10, luk: 9, cha: 5, soul: 2 }) },
    'astra-skills': { role: 'skills', fields: skillBlock('Astra', [['Shadow Cut', 1, 'agi', 'mana'], ['Iaijutsu', 1, 'agi', 'stamina'], ['Shadow Step', 1, 'agi', 'stamina']]) },
    foes: { role: 'foes', fields: foeBlock([['Rats', 12, 20, 5]]) },
});
const sheet = (...args) => readSheet({ domains: { dataModules: sheetDomain(blocks(...args)) } });
const rules = { ...STANDARD_FORMULA };
// Every act misses, so the fight is never won and the rounds go on to the cap.
const misses = () => Object.assign((kind, at) => { const list = kind === 'act' ? Array(30).fill(2) : []; return () => (list.length ? list.shift() : 10); }, { positional: true });
const CUT = 'act Astra | skill: Shadow Cut | type: magic | target: Rats | area';
const roll = (answer, { sheetArgs = [], fix = true, then = true } = {}) => {
    const s = sheet(...sheetArgs);
    const plan = parsePlanAnswer(['pace: all', answer].join('\n'), s, { formula: 'standard' }).plan;
    return { plan, result: rollPrepared(plan, prepare(plan, s, rules, { fix, then }), misses(), rules, { flow: 2, fix, then }) };
};
const actLines = result => result.rounds.map(round => round.lines.find(line => line.kind === 'act')).filter(Boolean);

test('then: parses and validates; a skill the character lacks, or the first skill again, is dropped', () => {
    const s = sheet();
    const { plan } = parsePlanAnswer(['pace: all', `${CUT} | then: Iaijutsu`].join('\n'), s, { formula: 'standard' });
    assert.deepEqual(plan.acts, [{ who: 'Astra', skill: 'Shadow Cut', then: 'Iaijutsu', type: 'magic', area: true, target: 'Rats' }]);
    assert.equal(validatePlan(plan).ok, true);
    assert.equal(validatePlan({ ...plan, acts: [{ ...plan.acts[0], then: '' }] }).ok, false);
    assert.equal('then' in parsePlanAnswer(['pace: all', `${CUT} | then: Nothing Known`].join('\n'), s, { formula: 'standard' }).plan.acts[0], false);
    assert.equal('then' in parsePlanAnswer(['pace: all', `${CUT} | then: shadow cut`].join('\n'), s, { formula: 'standard' }).plan.acts[0], false);
});

test('then: round 1 and the opening action use the first skill, rounds 2+ the follow-up (its own type, stat and resource); practice counts each skill rolled', () => {
    const { result } = roll(`${CUT} | then: Iaijutsu`);
    const lines = actLines(result);
    assert.ok(lines.length >= 5);
    assert.deepEqual([lines[0].skill, lines[0].type, lines[0].area === true], ['Shadow Cut', 'magic', true]);
    for (const line of lines.slice(1, 5)) assert.deepEqual([line.skill, line.type, line.area === true, line.pc.stat, line.cost.id.split(':').pop()], ['Iaijutsu', 'physical', false, 'agi', 'stamina']);
    const opening = (result.opening ?? []).map(line => line.skill);
    assert.ok(opening.every(skill => skill === 'Shadow Cut'), 'an opening action is round 1');
    const uses = Object.fromEntries(usesOf({ checks: result.checks, rounds: result.rounds, opening: result.opening }).map(use => [use.skill, use.n]));
    assert.deepEqual(uses, { 'Shadow Cut': 1 + opening.length, Iaijutsu: 4 }, 'Stamina 4 pays for four follow-ups');
    assert.match(result.text, /Round 1: Astra → Rats \(Shadow Cut\) \(area\)/);
    assert.match(result.text, /Round 2: Astra → Rats \(Iaijutsu\)/);
});

test('then: a spent follow-up goes on with the `else:` skill if its resource lasts, else as the plain attack', () => {
    const withElse = actLines(roll(`${CUT} | then: Iaijutsu | else: Shadow Cut`, { sheetArgs: [3, 1] }).result);
    assert.deepEqual(withElse.slice(0, 4).map(line => line.skill), ['Shadow Cut', 'Iaijutsu', 'Shadow Cut', 'Shadow Cut'], 'Stamina 1: Iaijutsu once, then the else skill (Mana)');
    assert.equal(withElse[2].without, 'Iaijutsu');
    const plain = actLines(roll(`${CUT} | then: Iaijutsu`, { sheetArgs: [3, 1] }).result);
    assert.deepEqual(plain.slice(0, 3).map(line => line.skill ?? null), ['Shadow Cut', 'Iaijutsu', null]);
    assert.deepEqual([plain[2].type, plain[2].area ?? false, plain[2].without, plain[2].withoutUses], ['physical', false, 'Iaijutsu', 'stamina']);
});

test('then: the user\'s case: Mana emptied in round 1 by Shadow Cut, Iaijutsu follows in rounds 2-3 on Stamina', () => {
    const lines = actLines(roll(`${CUT} | then: Iaijutsu`, { sheetArgs: [1, 4] }).result);
    assert.deepEqual(lines.slice(0, 3).map(line => line.skill), ['Shadow Cut', 'Iaijutsu', 'Iaijutsu']);
});

test('fix 2 replays exactly: a plan with `then:` rolled under the earlier mark is the roll without it, byte for byte; a current roll without `then:` differs only by the pool note', () => {
    const strip = result => JSON.stringify(result).replace(/,"otherUp":true/g, '').replace(/, (Stamina|Mana) is not;/g, ';');
    for (const sheetArgs of [[3, 4], [1, 4], [0, 4], [3, 1], [0, 0]]) {
        const current = roll(CUT, { sheetArgs, then: true }), earlier = roll(CUT, { sheetArgs, then: false });
        assert.equal(strip(current.result), strip(earlier.result), 'the dice, outcomes and bars are the same under either mark');
        const withThen = roll(`${CUT} | then: Iaijutsu`, { sheetArgs, then: false });
        assert.equal(JSON.stringify(withThen.result), JSON.stringify(earlier.result), 'mark 2 does not read `then:`');
        const witness = (plan, then) => JSON.stringify(prepare(plan, sheet(...sheetArgs), rules, { fix: true, then }).witness);
        assert.equal(witness(withThen.plan, false), witness(earlier.plan, false), 'the witness is the earlier one');
    }
});

test('the spent note names what is spent and says the other pool is untouched; a line without the other pool\'s mark (a roll before) is told as it was', () => {
    const pc = { who: 'Astra', die: 14, stat: 'agi', second: 'dex', statBonus: 5, classBonus: 4, rank: 1, edge: 0, total: 24 };
    const act = extra => ({ kind: 'act', type: 'physical', skill: null, pc, foe: { slot: 1, name: 'rats', die: 6, base: 5, classBonus: 3, total: 14 }, outcome: 'success', ...extra });
    assert.match(lineText(act({ without: 'Shadow Cut', withoutUses: 'mana', otherUp: true }), {}), /\(no skill: Shadow Cut's Mana is spent, Stamina is not; a plain weapon attack — name no skill\)/);
    assert.match(lineText(act({ without: 'Iaijutsu', withoutUses: 'stamina', otherUp: true }), {}), /\(no skill: Iaijutsu's Stamina is spent, Mana is not; a plain/);
    assert.match(lineText(act({ without: 'Shadow Cut', withoutUses: 'mana' }), {}), /\(no skill: Shadow Cut's Mana is spent; a plain weapon attack — name no skill\)/);
    // the roll: Mana spent, Stamina left -> says so; both spent -> does not claim the other is fine
    const left = actLines(roll(CUT, { sheetArgs: [0, 4] }).result)[0];
    assert.equal(left.otherUp, true);
    assert.match(roll(CUT, { sheetArgs: [0, 4] }).result.text, /Shadow Cut's Mana is spent, Stamina is not; a plain weapon attack/);
    const none = roll(CUT, { sheetArgs: [0, 0] });
    assert.equal(actLines(none.result)[0].otherUp, undefined);
    assert.doesNotMatch(none.result.text, /is not;/);
    const earlier = roll(CUT, { sheetArgs: [0, 4], then: false });
    assert.doesNotMatch(earlier.result.text, /is not;/, 'a roll of mark 2 keeps its earlier bytes');
});

test('a defender\'s skill goes on the foe line only when the message asks for it: the plan keeps what is written', () => {
    const s = sheet();
    const asked = parsePlanAnswer('pace: all\nact Astra | skill: Iaijutsu | type: physical | target: Rats\nfoe Rats | target: Astra | skill: Shadow Step', s, { formula: 'standard' }).plan;
    assert.equal(asked.foes[0].skill, 'Shadow Step', 'asked: "I Shadow Step past their bites" -> the line carries the skill');
    const plain = parsePlanAnswer('pace: all\nact Astra | skill: Iaijutsu | type: physical | target: Rats\nfoe Rats | target: Astra', s, { formula: 'standard' }).plan;
    assert.equal('skill' in plain.foes[0], false, 'not asked: no skill on the foe line');
    // an old reply replays as it was made: its plan is recorded, so the roll of a plan that names a defender's skill is the same under both marks
    const withDefence = roll('act Astra | skill: Iaijutsu | type: physical | target: Rats\nfoe Rats | target: Astra | skill: Shadow Step', { then: true });
    const earlier = roll('act Astra | skill: Iaijutsu | type: physical | target: Rats\nfoe Rats | target: Astra | skill: Shadow Step', { then: false });
    assert.equal(JSON.stringify(withDefence.result), JSON.stringify(earlier.result));
    assert.ok(withDefence.result.rounds[0].lines.some(line => line.kind === 'foe' && line.skill === 'Shadow Step'));
});

test('then: on the real host, a 3-round fight "Shadow Cut then Iaijutsu" rolls Shadow Cut first and Iaijutsu after; the roll is marked 3, and a rebuild, a Re-read and a reload agree', { skip }, async () => {
    const answer = ['pace: all', `${CUT} | then: Iaijutsu`].join('\n');
    const { host } = await setup({ blocks: blocks(1, 4), answers: [answer], settings: {} });
    await host.send('Shadow Cut first, then follow up with Iaijutsu on the swarm.', 'Steel flashes.');
    const at = host.ctx.chat.length - 1;
    const result = rollReceipt(host, at).data.v2.result;
    assert.equal(result.fix, FIX_VERSION);
    const named = result.rounds.flatMap(round => round.lines).filter(line => line.kind === 'act').map(line => line.skill);
    assert.equal(named[0], 'Shadow Cut');
    assert.deepEqual(named.slice(0, 3), ['Shadow Cut', 'Iaijutsu', 'Iaijutsu'], named.join());
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, 'a rebuild gives the live story');
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.equal(JSON.stringify(rollReceipt(host, at).data.v2.result), JSON.stringify(result), 'a Re-read keeps the dice');
    assert.equal(cueOfResult(result, rollReceipt(host, at).data.v2.shape).includes('(Iaijutsu)'), true);
    const afterReread = JSON.stringify(host.head());
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.equal(JSON.stringify(host.head()), afterReread, 'a reload agrees');
    host.close();
});

test('the pool note is read from the bars as the line is rolled: Mana empty at the start, the else/then skill spends the Stamina, and from then on no line says Mana is not spent', () => {
    for (const answer of [`${CUT} | else: Iaijutsu`, `${CUT} | then: Iaijutsu`]) {
        const { result } = roll(answer, { sheetArgs: [0, 2] });
        const lines = actLines(result);
        const late = lines.filter(line => line.without === 'Iaijutsu');
        assert.ok(late.length >= 2, answer);
        assert.ok(late.every(line => line.otherUp === undefined), answer);
        assert.doesNotMatch(result.text, /Iaijutsu's Stamina is spent, Mana is not/, answer);
        assert.match(result.text, /Shadow Cut's Mana is spent, Stamina is not/, answer);
    }
});

test('then: the follow-up rolls as its own skill: not the act\'s area, planner type or resource hint (single foe, the skill\'s own type, stat and resource)', () => {
    const { result } = roll('act Astra | skill: Shadow Cut | type: magic | target: Rats | area | then: Iaijutsu', { sheetArgs: [3, 4] });
    const lines = actLines(result);
    assert.deepEqual([lines[0].skill, lines[0].type, lines[0].area === true], ['Shadow Cut', 'magic', true]);
    for (const line of lines.slice(1, 4)) assert.deepEqual([line.skill, line.type, line.area ?? false, line.cost.id.split(':').pop(), line.pc.stat], ['Iaijutsu', 'physical', false, 'stamina', 'agi']);
    assert.doesNotMatch(result.text.split('\n').filter(line => /^Round [234]:/.test(line)).join('\n'), /\(area\)/);
    // a plain fallback of the follow-up is a physical single-target attack as well
    const plain = actLines(roll('act Astra | skill: Shadow Cut | type: magic | target: Rats | area | then: Iaijutsu', { sheetArgs: [3, 1] }).result);
    assert.deepEqual([plain[2].skill ?? null, plain[2].type, plain[2].area ?? false], [null, 'physical', false]);
});
