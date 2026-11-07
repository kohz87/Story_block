// RPG round 8: a skill can count when you defend (B) and the Soul Class field's own name (C). (A, "Stat adds: full above 10", went with the Classic rules.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { hostAvailable } from '../../../testkit/index.js';
import { setupDom } from '../view/mounts/helpers.js';
import { STANDARD, prepare, readSheet, rollPrepared, validatePlan } from '../../../src/v2/lean-rpg/index.js';
// (The Character block here is one made before levels, 2.17.0: it has the Soul Class field a pack may rename.)
import { STANDARD_TEMPLATES } from './fixtures/templates-2.16.js';
import { readJoin, soulNaming, joinCard } from '../../../src/v2/lean-rpg/join.js';
import { soulReading } from '../../../src/v2/lean-rpg/soul.js';
import { readParty } from '../../../src/v2/lean-rpg/view/party-data.js';
import { createPartyWidget } from '../../../src/v2/lean-rpg/view/party.js';
import { renderRpgSettings } from '../../../src/v2/lean-rpg/view/settings.js';
import { renderSkills } from '../../../src/v2/lean-rpg/view/skills.js';
import { rpgReplyLines } from '../../../src/v2/lean-rpg/view/changes-lines.js';
import { buildPanel, panelModel, readResolve } from '../../../src/v2/lean-rpg/view/battle-log.js';
import { oddsView, soulLabelFor } from '../../../src/v2/lean-rpg/view/settings-data.js';
import { cueOf, PARTY, PLAN_ANSWER, character, foeBlock, rollReceipt, setup, sheetDomain, skillBlock } from './helpers.js';
import { fakeState, roleOf as viewRoleOf } from './view/helpers.js';

const available = await hostAvailable();
const skip = available.ok ? false : available.reason;

const sheetOf = (blocks = PARTY()) => readSheet({ domains: { dataModules: sheetDomain(blocks) } });
// Scripted dice for the Standard roll: every action's stream gives these values in turn, then 10.
const dice = (...values) => () => { const list = [...values]; return () => (list.length ? list.shift() : 10); };
const defend = (over = {}) => ({ slot: 1, target: 'Wessel', defend: 'agi', ...over });
const plan = (foes, over = {}) => ({ formula: 'standard', pace: 'careful', acts: [], foes, checks: [], ...over });
const roll = (foes, sheet = sheetOf(), rules = STANDARD, ...values) => {
    const p = plan(foes);
    return rollPrepared(p, prepare(p, sheet, rules), dice(...values), rules);
};

// ---- B: a skill can count when you defend -------------------------------------------------------------------------------

test('B: a defending skill brings its own stat and rank; the line names it in the cue', () => {
    // Wessel (soul II, STR 14, AGI 12) defends with Iron Breath (Adept, STR, a block): the skill's stat with half of AGI, the class, the rank.
    const [line] = roll([defend({ skill: 'Iron Breath' })], sheetOf(), STANDARD, 10, 10).rounds[0].lines;
    assert.deepEqual(line.pc, { who: 'Wessel', type: 'defence', stat: 'str', second: 'agi', mainValue: 14, secondValue: 12, statBonus: 10, style: 'block', classValue: 2, classBonus: 4, rank: 1, window: { min: -1, max: 3 }, situation: 0, edge: 0, die: 10, total: 25 });
    assert.equal(line.skill, 'Iron Breath');
    assert.equal(line.outcome, 'success');
    const cue = roll([defend({ skill: 'Iron Breath' })], sheetOf(), STANDARD, 10, 10).text;
    assert.match(cue, /Sluice Rats attacks Wessel \(Iron Breath\): SUCCESS for Wessel \(25 vs 17\)/);
});

test('B: no skill rolls the defend stat at rank 0, exactly as it always did (and an old plan has no skill key)', () => {
    const old = [{ slot: 1, target: 'Wessel', defend: 'agi' }];
    assert.equal(validatePlan(plan(old)).ok, true);
    const result = roll(old, sheetOf(), STANDARD, 10, 10);
    const [line] = result.rounds[0].lines;
    assert.deepEqual(line.pc, { who: 'Wessel', type: 'defence', stat: 'agi', second: 'vit', mainValue: 12, secondValue: 12, statBonus: 9, style: 'dodge', classValue: 2, classBonus: 4, rank: 0, window: { min: -1, max: 3 }, situation: 0, edge: 0, die: 10, total: 23 });
    assert.equal(line.skill, null);
    assert.match(result.text, /Sluice Rats attacks Wessel: SUCCESS for Wessel \(23 vs 17\)/);
    assert.ok(!/attacks Wessel \(/.test(result.text));
    const prepared = prepare(plan(old), sheetOf());
    assert.deepEqual(prepared.witness.foes[0], { kind: 'foe', actor: 'c:wessel', type: 'defence', skill: null, pc: { who: 'Wessel', type: 'defence', stat: 'agi', second: 'vit', mainValue: 12, secondValue: 12, statBonus: 9, style: 'dodge', classValue: 2, classBonus: 4, rank: 0, window: { min: -1, max: 3 }, situation: 0, edge: 0 }, foe: prepared.foes[0].foe });
});

test('B: a defending skill whose resource is Empty is rolled without it, with the plain note', () => {
    const blocks = PARTY();
    blocks.wessel.fields = character('Wessel', { stamina: 0 });
    const prepared = prepare(plan([defend({ skill: 'Iron Breath' })]), sheetOf(blocks));
    assert.equal(prepared.foes[0].skill, null);
    assert.equal(prepared.foes[0].pc.rank, 0);
    assert.equal(prepared.foes[0].pc.stat, 'agi', 'the defend stat of the plan stands in for the skill\'s');
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
    assert.equal(prepared.foes[0].pc.statBonus, 10, 'the hidden STR 14 still counts');
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

test('B: a foe line may carry a skill of up to 60 characters; other keys are still refused', () => {
    assert.equal(validatePlan(plan([{ slot: 1, target: 'Wessel', defend: 'agi', skill: 'Iron Breath' }])).ok, true);
    assert.equal(validatePlan(plan([{ slot: 1, target: 'Wessel', defend: 'agi', skill: 'x'.repeat(61) }])).ok, false);
    assert.equal(validatePlan(plan([{ slot: 1, target: 'Wessel', defend: 'agi', why: 'x' }])).ok, false, 'other keys are still refused');
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

// The roll's seed is fixed (the dice come from it), so the foe acts in the fight the same way every time.
async function seeded(options) {
    const real = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
    globalThis.crypto.getRandomValues = array => (array instanceof Uint32Array ? array.fill(SEED) : real(array));
    try {
        const game = await setup(options);
        await game.host.send('I hit the lead rat.', 'The rats scatter.');
        return game;
    } finally { globalThis.crypto.getRandomValues = real; }
}
const SEED = 12;

test('B: through the turn, the plan\'s defending skill is rolled, stored and told', { skip }, async () => {
    const answer = [PLAN_ANSWER.replace('defend: AGI', 'defend: AGI | skill: Iron Breath')].join('\n');
    const { host } = await seeded({ answers: [answer] });
    const receipt = rollReceipt(host, 2);
    const lines = receipt.data.v2.result.rounds.flatMap(round => round.lines).filter(line => line.kind === 'foe');
    assert.ok(lines.length >= 1);
    assert.ok(lines.every(line => line.skill === 'Iron Breath' && line.pc.stat === 'str' && line.pc.rank === 1));
    assert.match(cueOf(receipt), /Sluice Rats attacks Wessel \(Iron Breath\): /);
    assert.deepEqual(receipt.data.v2.result.summary.acts.find(act => act.kind === 'foe').skill, 'Iron Breath');
    host.close();
});

test('B: a payload made before (no skill on its foe lines) rolls and tells as it did', { skip }, async () => {
    const { host } = await seeded({});
    const receipt = rollReceipt(host, 2);
    const lines = receipt.data.v2.result.rounds.flatMap(round => round.lines).filter(line => line.kind === 'foe');
    assert.ok(lines.length >= 1);
    assert.ok(lines.every(line => line.skill === null && line.pc.stat === 'agi' && line.pc.rank === 0));
    assert.ok(!/attacks Wessel \(/.test(cueOf(receipt)));
    const before = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), before, 'a rebuild gives the same story');
    host.close();
});

// ---- C: the Soul Class field's own name -------------------------------------------------------------------------------

const template = role => structuredClone(STANDARD_TEMPLATES.find(entry => entry.definition.role === role).definition);
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

test('C (Levels): a block made before levels (its Soul Class III stands for level 25): the Party card, the roll line and the rise note read it whatever the field is called', () => {
    for (const [renamed, label, word] of [[false, 'Soul Class', 'III'], [true, 'Level', '3']]) {
        const state = world(renamed);
        const [first] = readParty(state, { own: 'Wessel', roleOf });
        assert.deepEqual([first.level, first.levelText], [25, 'Lv 25']);
        // the Party card
        const doc = setupDom(), el = doc.createElement('div');
        doc.body.appendChild(el);
        createPartyWidget({ headState: () => state, readerName: () => 'Wessel', roleOf }).render(el, {}, {});
        assert.ok(el.querySelectorAll('.ss-pill').some(node => node.textContent === 'Lv 25'), 'the card says "Lv 25"');
        // the Skills view roll line
        const view = doc.createElement('div');
        doc.body.appendChild(view);
        renderSkills(view, { character: first, api: {}, onBack: () => {} });
        assert.match(view.querySelector('.rpg-skill-roll').textContent, /· .* \+\d+$/);
        // the class-up note (an earlier block)
        const lines = rpgReplyLines({ state, before: world(renamed, { soul: 2, before: true }), record: { receipts: [] }, roleOf });
        const wording = [`Wessel: ${label} ${renamed ? '2' : 'II'} → ${word}`, `${label} ${word} (+3 points)`];   // (a block made before levels keeps its class rise wording)
        assert.deepEqual([lines[0].text, lines[0].summary], wording);
    }
});

test('C: the odds line and the "adds" label follow the player\'s Character block, else the default', () => {
    const renamed = world(true), plain = world(false);
    assert.equal(soulLabelFor(renamed, 'Wessel'), 'Level');
    assert.equal(soulLabelFor(plain, 'Wessel'), 'Soul Class');
    assert.equal(soulLabelFor(fakeState([]), 'Wessel'), 'Soul Class', 'no character: the default');
    assert.match(oddsView(renamed, 'Wessel', STANDARD).label, /^Wessel \(VIT 5 with DEX 5, Level 3, Adept\) against a Level 3 foe$/);
    assert.match(oddsView(plain, 'Wessel', STANDARD).label, /^Wessel \(VIT 5 with DEX 5, Soul Class III, Adept\) against a Class III foe$/);
    const doc = setupDom();
    const parent = doc.createElement('div');
    doc.body.appendChild(parent);
    const settings = Object.assign(() => ({ rpgDifficulty: 'custom', rpgStandard: { ...STANDARD } }), { set: () => {} });
    renderRpgSettings(parent, { settings, doc, headState: () => renamed, readerName: () => 'Wessel', roleOf });
    assert.deepEqual(parent.querySelector('[data-card="difficulty"]').querySelectorAll('.rpg-set-num > span').map(node => node.textContent).slice(0, 3), ['Foe\'s base', 'Foe adds per class', 'Level divisor'], 'the row that was "Soul Class adds" is the Level divisor');
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
    assert.equal(card.rows[0].text, 'Level 25', 'F12: the card says the level the class stands for');
    assert.equal(joinCard([{ name: 'Mara', about: '', soul: 3, best: '' }], fakeState([])).rows[0].text, 'Level 25');
});
