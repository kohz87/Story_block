// The saved two-boar fight: shared initiative, recorded member damage and the timing of stamina costs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { playBoard } from '../../../../src/v2/lean-rpg/board/engine.js';
import { settledNote } from '../../../../src/v2/lean-rpg/board/note.js';
import { memberOrderLine } from '../../../../src/v2/lean-rpg/board/view-data.js';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';
import { buildPanel, panelModel, readResolve } from '../../../../src/v2/lean-rpg/view/battle-log.js';
import { setupDom } from '../../view/mounts/helpers.js';
import { character, levelFoeBlock, skillBlock } from '../helpers.js';
import { characterDefinition, fakeState, foesDefinition, skillsDefinition } from '../view/helpers.js';

const roles = definition => definition.role;
const rules = { ...STANDARD_FORMULA, levelDivisor: 5 };
const seed = 2561213965; // The pair's recorded rpgFightLast.board.setup.seed.
const steps = [
    { who: 'Astra', kind: 'skill', skill: 'Iaijutsu', target: 11 },
    { who: 'Astra', kind: 'skill', skill: 'Iaijutsu', target: 12 },
    ...[11, 11, 12, 12, 12].map(target => ({ who: 'Astra', kind: 'attack', target })),
].map(action => ({ actions: [action] }));

function ownerState(stamina = 3, count = 2) {
    const hero = characterDefinition('astra', 'Astra');
    hero.state.stamina.max = 5;
    return fakeState([
        { definition: { ...hero, role: 'character' }, fields: character('Astra', { level: 1, str: 9, vit: 5, agi: 10, dex: 6, int: 5, luk: 5, cha: 5, health: 5, mana: 0, stamina }) },
        { definition: { ...skillsDefinition('astra-skills', 'Astra'), role: 'skills' }, fields: skillBlock('Astra', [
            ['Iaijutsu', 0, 'agi', 'stamina', 'Draws and cuts in one motion from the sheath'],
            ['Shadow Step', 1, 'agi', 'stamina', 'Slips through shadow to dodge a blow'],
        ]) },
        { definition: { ...foesDefinition(), role: 'foes' }, fields: levelFoeBlock([['Bristle-boar', count, 2, 4]]) },
    ]);
}
const setup = { seed, offset: 0, rules, members: 1, flags: {}, weapons: {} };
const run = (state, choices) => {
    const played = playBoard(state, setup, choices);
    assert.equal(played.error, undefined);
    return played;
};
const modelOf = (state, played) => panelModel({ resolve: readResolve({ ...played.result, lv: 1, rules, board: {} }), state: played.state, before: state, roleOf: roles });

test('the recorded pair shares a grouped initiative in the board and battle log even after a member falls', () => {
    const state = ownerState(), played = run(state, steps), result = played.result;
    assert.equal(result.stop, 'won');
    assert.deepEqual(result.order.map(entry => [entry.id, entry.total]), [['c:astra', 24], ['f:12', 10]]);
    const model = modelOf(state, played), node = buildPanel(setupDom(), model);
    assert.equal(node.querySelector('.rpg-bl-order').textContent, 'Turn order: Astra (Lv 1) 24 > Bristle-boars (1, 2) (Lv 2) 10');
    assert.equal(memberOrderLine(result.order, result.members, [{ slot: 1, name: 'Bristle-boar' }]), 'Order: Astra · Bristle-boars (1, 2)');
});

test('a single pack keeps a real name ending in pack and a number in both order views', () => {
    const members = [{ slot: 11, group: 1, n: 1, name: 'Troll pack 2', value: 8, size: 8, pack: true, count: 12, attacks: 3, standing: true }];
    const order = [{ id: 'f:11', name: 'Troll pack 2', total: 10, party: false }];
    const line = { kind: 'act', outcome: 'success', pc: { who: 'Astra', total: 20 }, foe: { name: 'Troll pack 2', slot: 11, total: 10 } };
    const read = readResolve({ members, order, rounds: [{ n: 1, lines: [line] }] });
    assert.equal(read.orderEntries[0].name, 'Troll pack 2s');
    assert.equal(memberOrderLine(order, members, [{ slot: 1, name: 'Troll pack 2' }]), 'Order: Troll pack 2s · 3 attacks on you each exchange');
});

test('open member hits are attached to their own lines and the narrator note without changing real foe fields', () => {
    const state = ownerState(), played = run(state, steps.slice(0, 3)), result = played.result;
    assert.equal(result.stop, 'open');
    assert.deepEqual(result.hurts.filter(hurt => hurt.kind === 'foe'), []);
    assert.deepEqual(played.state.domains.dataModules.instances['pack.chat/foes'].chat.fields,
        state.domains.dataModules.instances['pack.chat/foes'].chat.fields);
    const model = modelOf(state, played), first = model.rounds[0].lines[0], third = model.rounds[2].lines[0];
    assert.deepEqual(first.arrows.filter(arrow => arrow.startsWith('Bristle-boar')), ['Bristle-boar 1 Hurt']);
    assert.deepEqual(third.arrows, ['Bristle-boar 1 Badly wounded']);
    const note = settledNote(result);
    assert.match(note, /Bristle-boar 1 health Unhurt → Hurt/u);
    assert.match(note, /Bristle-boar 1 health Hurt → Badly wounded/u);
});

test('a member hit is still shown when both block counts have the same health word', () => {
    const state = ownerState(), played = run(state, steps.slice(0, 1));
    const result = structuredClone(played.result), hit = result.rounds[0].lines.find(line => line.damage?.id === 'f:11');
    hit.damage = { ...hit.damage, from: 4, to: 3, size: 6 };
    const read = readResolve({ ...result, lv: 1, rules, board: {} });
    assert.deepEqual(read.rounds[0].lines[0].arrows.filter(arrow => arrow.startsWith('Bristle-boar')), ['Bristle-boar 1 Hurt']);
    assert.doesNotMatch(settledNote(result), /health Hurt → Hurt/u, 'the narrator note omits unchanged words');
});

test('the saved seed pays each recorded stamina cost on its actual line, and Empty forces plain defence', () => {
    const state = ownerState(), played = run(state, steps.slice(0, 2)), rounds = played.result.rounds;
    const first = rounds[0].lines, second = rounds[1].lines;
    assert.deepEqual(first.map(line => [line.kind, line.skill, line.cost && [line.cost.from, line.cost.to]]), [
        ['act', 'Iaijutsu', [3, 2]], ['foe', 'Shadow Step', [2, 1]], ['foe', 'Shadow Step', undefined],
    ]);
    assert.deepEqual(second.map(line => [line.kind, line.skill, line.cost && [line.cost.from, line.cost.to]]), [
        ['act', 'Iaijutsu', [1, 0]], ['foe', null, undefined], ['foe', null, undefined],
    ]);
    const model = modelOf(state, played);
    assert.ok(!model.rounds[0].lines.some(line => line.arrows.includes('Astra Stamina Empty')));
    assert.ok(model.rounds[1].lines[0].arrows.includes('Astra Stamina Empty'));
    const empty = run(ownerState(1), steps.slice(0, 1)).result.rounds[0].lines;
    assert.deepEqual(empty.filter(line => line.kind === 'foe').map(line => [line.skill, line.without, line.cost]), [
        [null, 'Shadow Step', undefined], [null, 'Shadow Step', undefined],
    ]);
    const paid = run(ownerState(2), steps.slice(0, 1)).result.rounds[0].lines;
    assert.deepEqual(paid.filter(line => line.kind === 'foe').map(line => [line.skill, line.cost && [line.cost.from, line.cost.to]]), [
        ['Shadow Step', [1, 0]], ['Shadow Step', undefined],
    ], 'the first executed defence pays and still covers the second attack after the pool reaches Empty');
    const alreadyEmpty = run(ownerState(0), [{ actions: [{ who: 'Astra', kind: 'attack', target: 11 }] }]).result.rounds[0].lines;
    assert.deepEqual(alreadyEmpty.filter(line => line.kind === 'foe').map(line => [line.skill, line.cost]), [
        [null, undefined], [null, undefined],
    ], 'an exchange that starts Empty uses plain defence');
});
