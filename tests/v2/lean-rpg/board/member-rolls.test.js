// Board-specific Standard hooks keep pack damage, attack counts and shared defence out of the roll engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { playBoard } from '../../../../src/v2/lean-rpg/board/engine.js';
import { memberRolls } from '../../../../src/v2/lean-rpg/board/member-rolls.js';
import { splitFoes } from '../../../../src/v2/lean-rpg/board/members.js';
import { exchangePlan } from '../../../../src/v2/lean-rpg/board/plan.js';
import { openBoard, receiveBoard } from '../../../../src/v2/lean-rpg/board/session.js';
import { readSheet } from '../../../../src/v2/lean-rpg/read.js';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';
import { prepareStandard, rollStandard } from '../../../../src/v2/lean-rpg/standard.js';
import { character, levelFoeBlock, sheetDomain, skillBlock } from '../helpers.js';

test('a pack takes area blocks and only its current number of attacks', () => {
    const hooks = memberRolls({}), bar = { slot: 11, value: 4, size: 8, foe: { pack: true, count: 12 } };
    const entries = [11, 11, 11, 2].map(slot => ({ foe: { slot } }));
    assert.equal(hooks.attacks(entries, bar).length, 2);
    assert.equal(hooks.hitBlocks({ area: true }, bar, false), 3);
    assert.equal(hooks.hitBlocks({ area: true }, bar, true), 4);
    assert.equal(hooks.hitBlocks({}, bar, true), undefined);
    assert.equal(hooks.hitBlocks({ area: true }, { ...bar, foe: {} }, true), undefined);
});

test('rotation prepares each target with its own defence and preserves the original dice entry', () => {
    const hooks = memberRolls({ rotation: { number: 1, targets: [{ target: 'A', skill: 'Dodge' }, { target: 'B', skill: 'Ward' }] } });
    const base = { at: 0, actor: 'c:a', once: true, skill: 'Dodge' }, entry = { target: 'A', skill: 'Dodge', once: true };
    const out = {}, requests = [];
    hooks.prepareFoe(out, entry, base, 0, (foe, target, skill, at, options) => {
        requests.push({ foe, target, skill, at, options });
        return { at, actor: 'c:b', once: true, skill };
    });
    assert.equal(out.foeChoices[0][0], base);
    assert.equal(out.foeChoices[0][1].base, base);
    assert.deepEqual(requests.map(({ target, skill, options }) => [target, skill, options.note]), [['B', 'Ward', false]]);
    const calls = [], roll = use => { calls.push(use); return { lines: [{ skill: use.skill }] }; };
    hooks.startRound();
    hooks.foe(base, out, roll);
    hooks.foe(base, out, roll);
    hooks.foe(base, out, roll);
    assert.deepEqual(calls.map(use => [use.actor, use.skill, use.paid ?? false]), [
        ['c:a', 'Dodge', false], ['c:b', 'Ward', false], ['c:a', 'Dodge', true],
    ]);
});

test('an idle attack neither advances the rotation nor pays defence', () => {
    const hooks = memberRolls({ rotation: { number: 1, targets: [{ target: 'A' }] } });
    const base = { at: 0, actor: 'c:a', once: true, skill: 'Dodge' }, prepared = { foeChoices: [[base]] };
    const calls = [];
    hooks.startRound();
    hooks.foe(base, prepared, use => { calls.push(use); return { idle: 'beaten' }; });
    hooks.foe(base, prepared, use => { calls.push(use); return { lines: [{ skill: use.skill }] }; });
    assert.deepEqual(calls.map(use => use.paid ?? false), [false, false]);
});

test('skipping a fallen defender keeps the cyclic order of the survivors', () => {
    const guards = ['a', 'b', 'c'].map(target => ({ target }));
    const hooks = memberRolls({ rotation: { number: 1, targets: guards } });
    const choices = guards.map(({ target }) => ({ at: 0, actor: target, once: true }));
    const prepared = { foeChoices: [choices] }, standing = new Set(['a', 'b', 'c']), targets = [];
    const roll = entry => { targets.push(entry.actor); return { lines: [{}] }; };
    hooks.startRound();
    hooks.foe(choices[0], prepared, roll, id => standing.has(id));
    standing.delete('a');
    for (let n = 0; n < 4; n += 1) hooks.foe(choices[0], prepared, roll, id => standing.has(id));
    assert.deepEqual(targets, ['a', 'b', 'c', 'b', 'c']);
});

test('attacks keep rotating among standing party members after one falls during the exchange', () => {
    const blocks = {
        hero: { role: 'character', fields: character('Astra', { vit: 20, health: 8, stamina: 4 }) },
        ally: { role: 'character', fields: character('Ren', { vit: 20, health: 8, stamina: 4 }) },
        heroSkills: { role: 'skills', fields: skillBlock('Astra', [['Dodge', 3, 'agi', 'stamina', 'evasion']]) },
        allySkills: { role: 'skills', fields: skillBlock('Ren', [['Duck', 3, 'agi', 'stamina', 'evasion']]) },
        foes: { role: 'foes', fields: levelFoeBlock([['Boar', 3, 1, 4]]) },
    };
    const base = readSheet({ domains: { dataModules: sheetDomain(blocks) } });
    const sheet = { ...base, foes: splitFoes(base.foes), characters: base.characters.map((actor, at) => ({ ...actor, health: at ? 8 : 1 })) };
    const plan = exchangePlan(sheet, sheet.characters.map(actor => ({ who: actor.who, kind: 'attack', target: 11 })), {}, 1, { members: true }).plan;
    const rules = { ...STANDARD_FORMULA, levelDivisor: 5 }, hooks = memberRolls(plan);
    const prepared = prepareStandard(plan, sheet, rules, { lv: true, fix: true, then: true, memberRolls: hooks });
    const source = (kind, at) => {
        const dice = kind === 'foe' ? (at === 0 ? [1, 20] : [20, 1]) : [];
        return () => dice.shift() ?? (kind === 'init' ? (at >= 16 ? 20 : 1) : 10);
    };
    const result = rollStandard(plan, prepared, source, rules, { flow: 2, fix: true, then: true, board: true, memberRolls: hooks });
    const lines = result.rounds[0].lines.filter(line => line.kind === 'foe');
    const [first, second] = plan.rotation.targets;
    assert.deepEqual(lines.map(line => line.pc.who), [first.target, second.target, second.target]);
    assert.equal(lines[0].damage?.to, 0, 'the first defender goes Down');
    assert.deepEqual(lines.slice(1).map(line => line.skill), [second.skill, second.skill]);
    assert.deepEqual(lines.slice(1).map(line => line.cost ? [line.cost.from, line.cost.to] : null), [[4, 3], null]);
});

test('new member fights rotate among standing targets, replay and continue without a rule flag', () => {
    const blocks = {
        hero: { role: 'character', fields: character('Astra', { vit: 20, health: 8, stamina: 4 }) },
        ally: { role: 'character', fields: character('Ren', { vit: 20, health: 1, stamina: 4 }) },
        heroSkills: { role: 'skills', fields: skillBlock('Astra', [['Dodge', 3, 'agi', 'stamina', 'evasion']]) },
        allySkills: { role: 'skills', fields: skillBlock('Ren', [['Duck', 3, 'agi', 'stamina', 'evasion']]) },
        foes: { role: 'foes', fields: levelFoeBlock([['Boar', 3, 20, 4]]) },
    };
    const state = { domains: { dataModules: sheetDomain(blocks) } }, rules = { ...STANDARD_FORMULA, levelDivisor: 5 };
    const setup = { seed: 2, offset: 0, rules, members: 1 };
    const exchanges = [{ actions: [{ who: 'Astra', kind: 'attack', target: 11 }, { who: 'Ren', kind: 'attack', target: 11 }] }];
    const meta = {}, opened = openBoard(meta, state, { sid: 'origin', rules });
    assert.equal(Object.hasOwn(opened.session.setup, 'standingTargets'), false);
    const freshSetup = setup;
    const fresh = playBoard(state, freshSetup, exchanges);
    assert.deepEqual(fresh.result.rounds[0].lines.filter(line => line.kind === 'foe').map(line => line.pc.who), ['Ren', 'Astra', 'Astra']);
    assert.deepEqual(playBoard(state, freshSetup, exchanges), fresh, 'the recorded rule replays the same result');
    const board = { ...opened.session, setup: freshSetup, exchanges };
    assert.equal(fresh.result.stop, 'open');
    assert.equal(receiveBoard(meta, { key: 'b:origin', board }, fresh.result, 'reply-1', 'receipt-1', fresh.state), true);
    assert.equal(Object.hasOwn(meta.rpgFightBoard.setup, 'standingTargets'), false, 'the next segment needs no rule flag');
});

test('the shared Standard roll engine stays split into small files', () => {
    const lines = name => {
        const source = readFileSync(new URL(`../../../../src/v2/lean-rpg/${name}`, import.meta.url), 'utf8');
        return source.split('\n').length - (source.endsWith('\n') ? 1 : 0);
    };
    const standard = lines('standard.js');
    assert.ok(standard <= 60, `standard.js has ${standard} lines`);
    for (const name of ['standard/roster.js', 'standard/prepare.js', 'standard/roll.js']) {
        const count = lines(name);
        assert.ok(count <= 300, `${name} has ${count} lines`);
    }
});
