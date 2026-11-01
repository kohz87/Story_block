// RPG round 8: a skill can count when you defend (B), "Stat adds: full above 10" (A), and the Soul Class field's own name (C).
import test from 'node:test';
import assert from 'node:assert/strict';
import { hostAvailable } from '../../../testkit/index.js';
import { setupDom } from '../view/mounts/helpers.js';
import {
    STANDARD, STAT_ABOVE, normalizeRules, parsePlanAnswer, prepare, readSheet, rollPrepared, statShare, validatePlan,
} from '../../../src/v2/lean-rpg/index.js';
import { PRECALL_HEAD, precallPrompt } from '../../../src/v2/lean-rpg/precall.js';
import { LEAN_RPG_TEMPLATES } from '../../../src/v2/lean-rpg/templates.js';
import { oddsFor, subjectOdds } from '../../../src/v2/lean-rpg/rules.js';
import { readJoin, soulNaming, joinCard } from '../../../src/v2/lean-rpg/join.js';
import { soulReading } from '../../../src/v2/lean-rpg/soul.js';
import { readParty } from '../../../src/v2/lean-rpg/view/party-data.js';
import { createPartyWidget } from '../../../src/v2/lean-rpg/view/party.js';
import { renderSkills } from '../../../src/v2/lean-rpg/view/skills.js';
import { rpgReplyLines } from '../../../src/v2/lean-rpg/view/changes-lines.js';
import { buildPanel, panelModel, readResolve } from '../../../src/v2/lean-rpg/view/battle-log.js';
import { oddsView, soulLabelFor } from '../../../src/v2/lean-rpg/view/settings-data.js';
import { renderRpgSettings } from '../../../src/v2/lean-rpg/view/settings.js';
import { PARTY, PLAN_ANSWER, character, foeBlock, rollReceipt, setup, sheetDomain, skillBlock } from './helpers.js';
import { fakeState, roleOf as viewRoleOf } from './view/helpers.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;

const sheetOf = (blocks = PARTY()) => readSheet({ domains: { dataModules: sheetDomain(blocks) } });
const dice = (...values) => () => {
    if (!values.length) throw new Error('the script ran out of dice');
    return values.shift();
};
const defend = (over = {}) => ({ slot: 1, target: 'Wessel', defend: 'agi', ...over });
const plan = (foes, over = {}) => ({ pace: 'careful', acts: [], foes, checks: [], ...over });
const roll = (foes, sheet = sheetOf(), rules = STANDARD, ...values) => {
    const p = plan(foes);
    return rollPrepared(p, prepare(p, sheet, rules), dice(...values), rules);
};

// ---- B: a skill can count when you defend -------------------------------------------------------------------------------

test('B: a defending skill brings its own stat and rank; the line names it in the cue', () => {
    // Wessel (soul II, STR 14, AGI 12) defends with Iron Breath (Adept, STR): 10 + 7 + 4 + 1 against 10 + 5 + 2.
    const [line] = roll([defend({ skill: 'Iron Breath' })], sheetOf(), STANDARD, 10, 10).rounds[0].lines;
    assert.deepEqual(line.pc, { who: 'Wessel', stat: 'str', statBonus: 7, classValue: 2, classBonus: 4, rank: 1, edge: 0, die: 10, total: 22 });
    assert.equal(line.skill, 'Iron Breath');
    assert.equal(line.outcome, 'success');
    const cue = roll([defend({ skill: 'Iron Breath' })], sheetOf(), STANDARD, 10, 10).text;
    assert.match(cue, /Sluice Rats attacks Wessel \(Iron Breath\): SUCCESS for Wessel \(22 vs 17\)/);
});

test('B: no skill rolls the defend stat at rank 0, exactly as it always did (and an old plan has no skill key)', () => {
    const old = [{ slot: 1, target: 'Wessel', defend: 'agi' }];
    assert.equal(validatePlan(plan(old)).ok, true);
    const result = roll(old, sheetOf(), STANDARD, 10, 10);
    const [line] = result.rounds[0].lines;
    assert.deepEqual(line.pc, { who: 'Wessel', stat: 'agi', statBonus: 6, classValue: 2, classBonus: 4, rank: 0, edge: 0, die: 10, total: 20 });
    assert.equal(line.skill, null);
    assert.match(result.text, /Sluice Rats attacks Wessel: SUCCESS for Wessel \(20 vs 17\)/);
    assert.ok(!/attacks Wessel \(/.test(result.text));
    const prepared = prepare(plan(old), sheetOf());
    assert.deepEqual(prepared.witness.foes[0], { kind: 'foe', skill: null, pc: { who: 'Wessel', stat: 'agi', statBonus: 6, classValue: 2, classBonus: 4, rank: 0, edge: 0 }, foe: prepared.foes[0].foe });
});

test('B: a defending skill whose resource is Empty is rolled without it, with the plain note', () => {
    const blocks = PARTY();
    blocks.wessel.fields = character('Wessel', { stamina: 0 });
    const prepared = prepare(plan([defend({ skill: 'Iron Breath' })]), sheetOf(blocks));
    assert.equal(prepared.foes[0].skill, null);
    assert.equal(prepared.foes[0].pc.rank, 0);
    assert.equal(prepared.foes[0].pc.stat, 'str', 'the skill\'s stat is kept, as for an act');
    assert.deepEqual(prepared.refused.map(entry => entry.text), ['Wessel cannot use Iron Breath (Stamina Empty): rolled without it.']);
});

test('B: a skill the defender lacks is rolled untrained with the named stat, and says so', () => {
    const prepared = prepare(plan([defend({ skill: 'Parry' })]), sheetOf());
    assert.deepEqual([prepared.foes[0].skill, prepared.foes[0].pc.stat, prepared.foes[0].pc.rank], [null, 'agi', 0]);
    assert.deepEqual(prepared.refused.map(entry => entry.text), ['Wessel has no skill called Parry: rolled untrained.']);
});

test('B: a hidden skill stat on defence counts for the rules and is never named; the witness has no visibility flag', () => {
    const domain = sheetDomain(PARTY());
    const pin = Object.values(domain.pins).find(item => item.definition.slug === 'wessel-skills');
    pin.definition.state = { stat1: { type: 'text', prompt: false } };
    const sheet = readSheet({ domains: { dataModules: domain } });
    const prepared = prepare(plan([defend({ skill: 'Iron Breath' })]), sheet);
    assert.equal(prepared.foes[0].pc.statHidden, true);
    assert.equal(prepared.foes[0].pc.statBonus, 7, 'the hidden STR 14 still counts');
    assert.equal('statHidden' in prepared.witness.foes[0].pc, false);
    // The character lacks the hidden stat: the refusal does not name it, and the measuring refusal does.
    const blocks = PARTY();
    blocks.wessel.fields = character('Wessel', { str: null });
    const domain2 = sheetDomain(blocks);
    Object.values(domain2.pins).find(item => item.definition.slug === 'wessel-skills').definition.state = { stat1: { type: 'text', prompt: false } };
    const refused = prepare(plan([defend({ skill: 'Iron Breath' })]), readSheet({ domains: { dataModules: domain2 } }));
    assert.deepEqual(refused.foes, []);
    assert.deepEqual(refused.refused.map(entry => entry.text), ['Sluice Rats attacks Wessel: not rolled (Wessel lacks the skill\'s stat).']);
    assert.ok(!/STR/i.test(refused.refused[0].text));
    assert.match(refused.plainRefused[0], /has no STR on the sheet/);
});

test('B: the planner may write skill: on a foe line; the plan keeps it only when written, and "none" is no skill', () => {
    const sheet = sheetOf();
    const read = text => parsePlanAnswer(text, sheet).plan.foes[0];
    assert.deepEqual(read('foe Sluice Rats | target: Wessel | defend: AGI | skill: Iron Breath'), { slot: 1, target: 'Wessel', defend: 'agi', skill: 'Iron Breath' });
    assert.deepEqual(read('foe Sluice Rats | target: Wessel | defend: AGI | skill: iron breath drill'), { slot: 1, target: 'Wessel', defend: 'agi', skill: 'Iron Breath' });
    assert.deepEqual(read('foe Sluice Rats | target: Wessel | defend: AGI | skill: Parry'), { slot: 1, target: 'Wessel', defend: 'agi', skill: 'Parry' }, 'a skill they lack is kept, to be rolled untrained');
    assert.deepEqual(read('foe Sluice Rats | target: Wessel | defend: AGI | skill: none'), { slot: 1, target: 'Wessel', defend: 'agi' });
    assert.deepEqual(read('foe Sluice Rats | target: Wessel | defend: AGI'), { slot: 1, target: 'Wessel', defend: 'agi' }, 'an answer from before: unchanged');
    assert.equal(validatePlan(plan([{ slot: 1, target: 'Wessel', defend: 'agi', skill: 'x'.repeat(61) }])).ok, false);
    assert.equal(validatePlan(plan([{ slot: 1, target: 'Wessel', defend: 'agi', why: 'x' }])).ok, false, 'other keys are still refused');
});

test('B: the planner is told the foe line takes a skill, and when', () => {
    assert.match(PRECALL_HEAD, /\nfoe <foe> \| target: <who> \| defend: <stat> \| skill: <skill>\?\n/);
    assert.match(PRECALL_HEAD, /A foe line may name a skill of the defender, only when one plausibly fits defending \(a parry, a dodge, a shield, a counter-draw\); otherwise write no skill\./);
});

test('B: the battle log names the defending skill; a foe line recorded before it reads as it did', () => {
    const pc = (extra = {}) => ({ who: 'Astra', die: 10, stat: 'str', statBonus: 5, classValue: 2, classBonus: 4, rank: 0, edge: 0, total: 19, ...extra });
    const foe = { slot: 1, name: 'Rat', die: 9, base: 5, classValue: 1, classBonus: 2, total: 16 };
    const result = { v: 1, key: '3-abc', checks: [], refused: [], rounds: [{ n: 1, decisive: false, lines: [
        { kind: 'foe', outcome: 'success', skill: 'Iaijutsu', pc: pc({ rank: 2, total: 21 }), foe },
        { kind: 'foe', outcome: 'fail', skill: null, pc: pc({ die: 3, total: 12 }), foe: { ...foe, name: 'Gull' } },
    ] }] };
    const doc = setupDom();
    const model = panelModel({ resolve: readResolve(result), state: fakeState([]), before: null, roleOf: viewRoleOf });
    const [named, plain] = buildPanel(doc, model).querySelectorAll('.rpg-act-text').map(node => node.textContent);
    assert.equal(named, 'Rat attacks Astra (Iaijutsu) — Blocked (16 vs 21)');
    assert.equal(plain, 'Gull attacks Astra — Hit (16 vs 12)');
    assert.match(model.rounds[0].lines[0].breakdown, /Expert 2/, 'the skill\'s rank is in the roll behind the line');
    assert.ok(!/Expert|Adept/.test(model.rounds[0].lines[1].breakdown));
});

test('B: through the turn, the plan\'s defending skill is rolled, stored and told', { skip }, async () => {
    const answer = [PLAN_ANSWER.replace('defend: AGI', 'defend: AGI | skill: Iron Breath')].join('\n');
    const { host } = await setup({ answers: [answer] });
    await host.send('I hit the lead rat.', 'The rats scatter.');
    const receipt = rollReceipt(host, 2);
    const lines = receipt.data.v2.result.rounds.flatMap(round => round.lines).filter(line => line.kind === 'foe');
    assert.ok(lines.length >= 1);
    assert.ok(lines.every(line => line.skill === 'Iron Breath' && line.pc.stat === 'str' && line.pc.rank === 1));
    assert.match(receipt.summary, /Sluice Rats attacks Wessel \(Iron Breath\): /);
    assert.deepEqual(receipt.data.v2.result.summary.acts.find(act => act.kind === 'foe').skill, 'Iron Breath');
    host.close();
});

test('B: a payload made before (no skill on its foe lines) rolls and tells as it did', { skip }, async () => {
    const { host } = await setup();
    await host.send('I hit the lead rat.', 'The rats scatter.');
    const receipt = rollReceipt(host, 2);
    const lines = receipt.data.v2.result.rounds.flatMap(round => round.lines).filter(line => line.kind === 'foe');
    assert.ok(lines.length >= 1);
    assert.ok(lines.every(line => line.skill === null && line.pc.stat === 'agi' && line.pc.rank === 0));
    assert.ok(!/attacks Wessel \(/.test(receipt.summary));
    const before = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), before, 'a rebuild gives the same story');
    host.close();
});

// ---- A: "Stat adds: full above 10" --------------------------------------------------------------------------------------

test('A: full above 10 adds the stat − 5 (10 → +5, 14 → +9, 20 → +15, 8 → +3); half and a third are as they were', () => {
    const full = { ...STANDARD, statDivisor: STAT_ABOVE };
    assert.deepEqual([10, 14, 20, 8].map(value => statShare(value, full)), [5, 9, 15, 3]);
    assert.deepEqual([10, 15, 7].map(value => statShare(value, STANDARD)), [5, 7, 3]);
    assert.deepEqual([10, 15, 7].map(value => statShare(value, { ...STANDARD, statDivisor: 3 })), [3, 5, 2]);
    assert.deepEqual(normalizeRules(full), full, 'the choice is kept as it is');
    assert.deepEqual(Object.keys(normalizeRules(full)), Object.keys(STANDARD), 'the same six keys');
});

test('A: checks, attacks and defence all roll with it, and the line records the rule it used', () => {
    const rules = normalizeRules({ ...STANDARD, statDivisor: STAT_ABOVE });
    const p = { pace: 'careful', acts: [{ who: 'Wessel', skill: 'Iron Breath', target: 'Sluice Rats' }], foes: [defend()], checks: [{ who: 'Ren', stat: 'int', difficulty: 'normal' }] };
    const result = rollPrepared(p, prepare(p, sheetOf(), rules), dice(10, 10, 10, 10, 10), rules);
    const [act, against] = result.rounds[0].lines;
    assert.equal(act.pc.statBonus, 9, 'STR 14');
    assert.equal(against.pc.statBonus, 7, 'AGI 12');
    assert.equal(result.checks[0].pc.statBonus, 11, 'INT 16');
    assert.equal(act.pc.total, 10 + 9 + 4 + 1);
});

test('A: rolls made with the old rules replay with their own numbers; a recorded set with a half or a third reads as before', () => {
    for (const statDivisor of [2, 3]) {
        const recorded = { foeBase: 5, classWeight: 2, statDivisor, costMargin: 2, decisiveMargin: 8, roundCap: 5 };
        assert.deepEqual(normalizeRules(recorded), recorded);
        const [line] = roll([defend()], sheetOf(), normalizeRules(recorded), 10, 10).rounds[0].lines;
        assert.equal(line.pc.statBonus, Math.floor(12 / statDivisor));
    }
    assert.equal(normalizeRules({ foeBase: 5, classWeight: 2, costMargin: 2, decisiveMargin: 8, roundCap: 5 }).statDivisor, 2, 'a set without it is Standard\'s half');
    assert.equal(normalizeRules({ ...STANDARD, statDivisor: 1 }).statDivisor, 2, 'a number that is not a choice is held');
});

test('A: the odds use the chosen option', () => {
    const subject = { who: 'W', stat: 'str', statValue: 14, soul: 2, rank: 1, foeClass: 2 };
    assert.equal(subjectOdds(STANDARD, subject).bonus, 7 + 4 + 1);
    const full = subjectOdds({ ...STANDARD, statDivisor: STAT_ABOVE }, subject);
    assert.equal(full.bonus, 9 + 4 + 1);
    assert.deepEqual({ success: full.success, cost: full.cost, fail: full.fail }, oddsFor(STANDARD, { bonus: 14, foeClass: 2 }));
});

test('A: Settings → RPG offers it in Custom, keeps it as 0 and moves the odds bar; the presets stay at half', () => {
    const doc = setupDom();
    const stored = { rpgFormula: 'classic' };
    const settings = Object.assign(id => ({ ...stored }), { set: (_id, key, value) => { stored[key] = value; } });
    const state = fakeState([{ definition: viewCharacter(), fields: { who: 'Wessel', str: 14, soul: 2 } }]);
    const parent = doc.createElement('div');
    doc.body.appendChild(parent);
    stored.rpgDifficulty = 'custom';
    stored.rpgCustom = { ...STANDARD };
    renderRpgSettings(parent, { settings, doc, headState: () => state, readerName: () => 'Wessel', roleOf: viewRoleOf });
    const select = parent.querySelector('[data-rule="statDivisor"]');
    assert.deepEqual(select.querySelectorAll('option').map(node => node.textContent), ['half the stat', 'a third of the stat', 'full above 10']);
    const bar = () => parent.querySelector('.rpg-odds-legend').textContent;
    const half = bar();
    select.value = '0';
    select.dispatch('change');
    assert.equal(stored.rpgCustom.statDivisor, STAT_ABOVE);
    assert.notEqual(bar(), half, 'the odds bar follows');
    const subject = { statValue: 14, soul: 2, rank: 0, foeClass: 2 };
    const expected = subjectOdds({ ...STANDARD, statDivisor: STAT_ABOVE }, subject);
    assert.equal(bar(), `Success ${expected.success}%At a cost ${expected.cost}%Fail ${expected.fail}%`);
});

// ---- C: the Soul Class field's own name -------------------------------------------------------------------------------

const template = role => structuredClone(LEAN_RPG_TEMPLATES.find(entry => entry.definition.role === role).definition);
const NINE = Object.fromEntries(Array.from({ length: 9 }, (_, n) => [String(n + 1), String(n + 1)]));
function viewCharacter(renamed = false) {
    const definition = template('character');
    definition.slug = 'wessel';
    if (renamed) { definition.state.soul.label = 'Level'; definition.state.soul.names = NINE; }
    return definition;
}
const world = (renamed, { soul = 3, before = false } = {}) => fakeState([
    { definition: viewCharacter(renamed), fields: { who: 'Wessel', str: 14, soul, xp: before ? 85 : 0, points: before ? 0 : 3 } },
    { definition: { ...template('skills'), slug: 'wessel-skills' }, fields: { who: 'Wessel', skill1: 'Iron Breath', stat1: 'vit', uses1: 'stamina', rank1: 1 } },
]);
const roleOf = definition => definition.role ?? null;

test('C: the default keeps "Soul Class III" everywhere; a renamed field shows "Level 3" on the Party card, the roll line, the class-up note and the planner', () => {
    for (const [renamed, label, word] of [[false, 'Soul Class', 'III'], [true, 'Level', '3']]) {
        const state = world(renamed);
        const [first] = readParty(state, { own: 'Wessel', roleOf });
        assert.deepEqual([first.soulLabel, first.soulName], [label, word]);
        // the Party card
        const doc = setupDom(), el = doc.createElement('div');
        doc.body.appendChild(el);
        createPartyWidget({ headState: () => state, readerName: () => 'Wessel', roleOf }).render(el, {}, {});
        assert.ok(el.querySelectorAll('.ss-pill').some(node => node.textContent === `${label} ${word}`), `the card says "${label} ${word}"`);
        // the Skills view roll line
        const view = doc.createElement('div');
        doc.body.appendChild(view);
        renderSkills(view, { character: first, api: {}, onBack: () => {} });
        assert.match(view.querySelector('.rpg-skill-roll').textContent, new RegExp(`· ${label} ${word} \\+6$`));
        // the class-up note
        const lines = rpgReplyLines({ state, before: world(renamed, { soul: 2, before: true }), record: { receipts: [] }, roleOf });
        const wording = renamed ? ['Wessel: Level 2 → 3', 'Level 3 (+3 points)'] : ['Wessel: Soul Class II → III', 'Soul Class III (+3 points)'];
        assert.deepEqual([lines[0].text, lines[0].summary], wording);
        // the planner's sheet text
        const prompt = precallPrompt({ sheet: readSheet(state), message: 'hi' });
        assert.match(prompt, renamed ? /^Wessel \(Level 3\): /m : /^Wessel \(class III\): /m);
    }
});

test('C: the odds line and the "adds" label follow the player\'s Character block, else the default', () => {
    const renamed = world(true), plain = world(false);
    assert.equal(soulLabelFor(renamed, 'Wessel'), 'Level');
    assert.equal(soulLabelFor(plain, 'Wessel'), 'Soul Class');
    assert.equal(soulLabelFor(fakeState([]), 'Wessel'), 'Soul Class', 'no character: the default');
    assert.match(oddsView(renamed, 'Wessel', STANDARD).label, /^Wessel \(VIT 10, Level 3, Adept\) against a Level 3 foe$/);
    assert.match(oddsView(plain, 'Wessel', STANDARD).label, /^Wessel \(VIT 10, Soul Class III, Adept\) against a Class III foe$/);
    const doc = setupDom();
    const parent = doc.createElement('div');
    doc.body.appendChild(parent);
    const settings = Object.assign(() => ({ rpgFormula: 'classic', rpgDifficulty: 'custom', rpgCustom: { ...STANDARD } }), { set: () => {} });
    renderRpgSettings(parent, { settings, doc, headState: () => renamed, readerName: () => 'Wessel', roleOf });
    assert.deepEqual(parent.querySelectorAll('.rpg-set-num > span').map(node => node.textContent).slice(0, 2), ['Foe\'s base', 'Level adds']);
});

test('C: the battle log says "Class II" by default and the field\'s own word when it is renamed', () => {
    const pc = { who: 'Wessel', die: 10, stat: 'str', statBonus: 7, classValue: 3, classBonus: 6, rank: 0, edge: 0, total: 23 };
    const foe = { slot: 1, name: 'Rat', die: 9, base: 5, classValue: 1, classBonus: 2, total: 16 };
    const result = { v: 1, key: '3-abc', checks: [], refused: [], rounds: [{ n: 1, decisive: false, lines: [{ kind: 'act', outcome: 'success', skill: null, pc, foe }] }] };
    const breakdown = soulOf => readResolve(result, { soulOf }).rounds[0].lines[0].breakdown;
    assert.equal(breakdown(undefined), 'd20 10 + STR 7 + Class III 6 = 23 vs d20 9 + 5 + Class I 2 = 16');
    assert.equal(breakdown(() => soulReading(viewCharacter(false).state.soul)), breakdown(undefined), 'the default words are the old ones');
    assert.equal(breakdown(() => soulReading(viewCharacter(true).state.soul)), 'd20 10 + STR 7 + Level 3 6 = 23 vs d20 9 + 5 + Level 1 2 = 16');
});

test('C: a companion\'s class is read with the story\'s own names, and the refusal names the field', () => {
    const naming = soulReading({ label: 'Rank', names: { 1: 'Pup', 2: 'Hound', 3: 'Wolf', 4: 'Alpha', 5: 'a', 6: 'b', 7: 'c', 8: 'd', 9: 'e' } });
    assert.equal(readJoin({ op: '+', name: 'Mara', labels: { class: 'Wolf' } }, naming).soul, 3);
    assert.equal(readJoin({ op: '+', name: 'Mara', labels: { class: 'III' } }, naming).soul, 3, 'I to IX are always understood');
    assert.equal(readJoin({ op: '+', name: 'Mara', labels: { class: '4' } }, naming).soul, 4);
    assert.equal(readJoin({ op: '+', name: 'Mara', labels: { class: 'X' } }, naming).error, 'class must be a Rank from Pup to e');
    assert.equal(readJoin({ op: '+', name: 'Mara', labels: { class: 'X' } }).error, 'class must be a Soul Class from I to IX', 'the default words are the old ones');
    assert.equal(soulNaming(world(true)).label, 'Level');
    assert.equal(soulNaming(fakeState([])).label, 'Soul Class');
    const card = joinCard([{ name: 'Mara', about: '', soul: 3, best: '' }], world(true));
    assert.equal(card.rows[0].text, 'Level 3');
    assert.equal(joinCard([{ name: 'Mara', about: '', soul: 3, best: '' }], fakeState([])).rows[0].text, 'Soul Class III');
});

test('C: the planner text is byte-identical with the default names', () => {
    const sheet = sheetOf();
    assert.match(precallPrompt({ sheet, message: 'hi' }), /^Wessel \(class II\): STR 14 /m);
    assert.equal(sheet.characters[0].soulLabel, 'Soul Class');
});
