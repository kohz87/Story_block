// A new fight rebuilds from the Foes block; only one open fight's exact bars carry into its next segment.

import test from 'node:test';
import assert from 'node:assert/strict';
import { playBoard } from '../../../../src/v2/lean-rpg/board/engine.js';
import { settledNote } from '../../../../src/v2/lean-rpg/board/note.js';
import { boardPayload, boardSession, openBoard, receiveBoard, reconcileBoard, stageExchange } from '../../../../src/v2/lean-rpg/board/session.js';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';
import { character, foeBlock, sheetDomain } from '../helpers.js';

const RULES = { ...STANDARD_FORMULA, levelDivisor: 5 };
const state = (foes = [['Rats', 3, 1, 4]]) => ({ meta: { claims: {} }, domains: { dataModules: sheetDomain({
    hero: { role: 'character', fields: character('Astra', { str: 20, agi: 20, health: 8 }) }, foes: { role: 'foes', fields: foeBlock(foes) },
}) } });
const action = { actions: [{ who: 'Astra', kind: 'attack', target: 11 }] };
const bits = result => ({ rounds: result.rounds, members: result.members, hurts: result.hurts, stop: result.stop });

test('every new board fight is marked for members and never reads a cross-fight kept cache', () => {
    const value = state(), meta = { rpgFightHistory: [{ claim: 'old', members: [{ slot: 11, group: 1, n: 1, value: 1, pack: false, count: 1 }] }] };
    const opened = openBoard(meta, value, { sid: 'reply-1', rules: RULES });
    assert.equal(opened.error, undefined, opened.error);
    assert.equal(opened.session.setup.members, 1);
    assert.equal(Object.hasOwn(opened.session.setup, 'kept'), false);
    assert.equal(Object.hasOwn(meta, 'rpgFightHistory'), true, 'an old cache is left alone, not rewritten');
});

test('a continuation carries exact member values and original counts, and drops the opening list', () => {
    const value = state(), opened = [{ name: 'Rats', count: 3, level: 1 }];
    let first;
    for (let seed = 0; seed < 100 && !first; seed += 1) {
        const setup = { seed, offset: 0, rules: RULES, members: 1, opened, flags: {}, weapons: {} };
        const run = playBoard(value, setup, [action]);
        if (run.result.stop === 'open') first = { setup, run };
    }
    assert.ok(first, 'found an open first segment');
    const meta = {}, board = { id: 'origin:0', anchor: 'origin', groups: [1], setup: first.setup, exchanges: [action] };
    assert.equal(receiveBoard(meta, { key: 'b:first', board }, first.run.result, 'reply1', 'receipt1', first.run.state), true);
    const setup = boardSession(meta).setup;
    assert.deepEqual(setup.carriedMembers.values, Object.fromEntries(first.run.result.members.map(member => [member.slot, member.value])));
    assert.deepEqual(setup.carriedMembers.counts, { 1: 3 });
    assert.equal(Object.hasOwn(setup, 'opened'), false, 'the next segment does not repeat New foes');
    assert.equal(Object.hasOwn(setup, 'kept'), false);
    assert.equal(Object.hasOwn(meta, 'rpgFightHistory'), false);
});

test('the in-place continuation path also refreshes carried bars and drops opened', () => {
    const value = state(), baseSetup = { offset: 0, rules: RULES, members: 1, flags: {}, weapons: {}, opened: [{ name: 'Rats', count: 3 }] };
    let run;
    for (let seed = 0; seed < 100 && !run; seed += 1) {
        const attempt = playBoard(value, { ...baseSetup, seed }, [action]);
        if (attempt.result.stop === 'open') run = { seed, result: attempt.result };
    }
    assert.ok(run, 'found an open result');
    const board = { id: 'origin:0', anchor: 'origin', groups: [1], setup: { ...baseSetup, seed: run.seed }, exchanges: [action] };
    const meta = { rpgFightBoard: { id: board.id, origin: 'origin', anchor: 'origin', groups: [1], setup: { ...board.setup, offset: 1 }, exchanges: [],
        base: { offset: 0, order: null }, carriedKey: 'b:first' } };
    assert.equal(receiveBoard(meta, { key: 'b:first', board }, run.result, 'reply1', 'receipt1', value), true);
    assert.deepEqual(boardSession(meta).setup.carriedMembers.values, Object.fromEntries(run.result.members.map(member => [member.slot, member.value])));
    assert.equal(Object.hasOwn(boardSession(meta).setup, 'opened'), false);
});

test('OPENING_NOTE: the preview names the new foes, and the next segment does not repeat them', () => {
    const value = state(), opened = [{ name: 'Rats', count: 3, level: 1 }];
    const meta = { rpgFightStart: { anchor: 'reply-1', result: { opened } } };
    const first = openBoard(meta, value, { sid: 'reply-1', rules: RULES });
    assert.equal(first.error, undefined, first.error);
    assert.match(settledNote(first.preview.result, first.session.setup), /New foes: Rats ×3 \(Lv 1\), each fought on its own\./);
    const staged = stageExchange(meta, value, action.actions);
    assert.equal(staged.error, undefined, staged.error);
    assert.equal(staged.preview.result.stop, 'open');
    assert.match(settledNote(staged.preview.result, staged.session.setup), /New foes:/, 'the staged preview and its committed note agree');

    const payload = { key: 'b:first', board: { id: first.session.id, anchor: 'reply-1', groups: first.session.groups,
        setup: structuredClone(staged.session.setup), exchanges: structuredClone(staged.session.exchanges) } };
    assert.equal(receiveBoard(meta, payload, staged.preview.result, 'reply-1', 'receipt-1', value), true);
    const nextSetup = boardSession(meta).setup;
    assert.equal(Object.hasOwn(nextSetup, 'opened'), false);
    const next = playBoard(value, nextSetup, []);
    assert.equal(next.error, undefined, next.error);
    assert.doesNotMatch(settledNote(next.result, nextSetup), /New foes:/, 'the next segment has only its own note');
});

test('NEW4: an ordinary opening with no prior carry restages its first segment unchanged', () => {
    const value = state(), meta = {}, sid = 'origin';
    let found = null;
    for (let attempt = 0; attempt < 200 && !found; attempt += 1) {
        meta.rpgFightAttempts = { [sid]: attempt };
        delete meta.rpgFightBoard;
        const opened = openBoard(meta, value, { sid, rules: RULES });
        assert.equal(opened.error, undefined, opened.error);
        const target = opened.preview.result.members.find(member => member.standing)?.slot;
        if (!target) continue;
        const staged = stageExchange(meta, value, [{ who: 'Astra', kind: 'attack', target }]);
        if (staged.error || staged.preview.result.stop !== 'open') continue;
        found = { staged, target };
    }
    assert.ok(found, 'found an open first segment');
    for (const key of ['carriedMembers', 'opening', 'approach', 'drop', 'opened']) assert.equal(Object.hasOwn(found.staged.session.setup, key), false);
    receiveBoard(meta, { key: 'b:first', board: boardPayload(found.staged.session) }, found.staged.preview.result, 'reply1', 'receipt1', value);
    reconcileBoard(meta, id => id !== 'receipt1');
    const restored = boardSession(meta);
    assert.equal(restored.setup.offset, 0);
    for (const key of ['carriedMembers', 'opening', 'approach', 'drop', 'opened']) assert.equal(Object.hasOwn(restored.setup, key), false);
    const restaged = stageExchange(meta, value, [{ who: 'Astra', kind: 'attack', target: found.target }]);
    assert.equal(restaged.error, undefined, restaged.error);
    assert.deepEqual(bits(restaged.preview.result), bits(found.staged.preview.result));
});

test('NEW1: a rewind restores the segment\'s prior carried bars for members and packs', () => {
    for (const count of [3, 12]) {
        const value = state([['Rats', count, 1, 4]]), meta = {}, sid = 'origin';
        let found = null;
        for (let attempt = 0; attempt < 200 && !found; attempt += 1) {
            meta.rpgFightAttempts = { [sid]: attempt };
            delete meta.rpgFightBoard;
            const opened = openBoard(meta, value, { sid, rules: RULES });
            assert.equal(opened.error, undefined, opened.error);
            const preview = playBoard(value, boardSession(meta).setup, []);
            const target = preview.result.members.find(member => member.standing)?.slot;
            if (!target) continue;
            const first = stageExchange(meta, value, [{ who: 'Astra', kind: 'attack', target }]);
            if (first.error || first.preview.result.stop !== 'open') continue;
            const state1 = first.preview.state;
            receiveBoard(meta, { key: 'b:first', board: boardPayload(first.session) }, first.preview.result, 'reply1', 'receipt1', state1);
            const firstCarry = structuredClone(boardSession(meta).setup.carriedMembers);
            const secondPreview = playBoard(state1, boardSession(meta).setup, []);
            const target2 = secondPreview.result.members.find(member => member.standing)?.slot;
            if (!target2) { delete meta.rpgFightBoard; continue; }
            const secondAction = [{ who: 'Astra', kind: 'attack', target: target2 }];
            const second = stageExchange(meta, state1, secondAction);
            if (second.error || second.preview.result.stop !== 'open') { delete meta.rpgFightBoard; continue; }
            receiveBoard(meta, { key: 'b:second', board: boardPayload(second.session) }, second.preview.result, 'reply2', 'receipt2', second.preview.state);
            const session = boardSession(meta);
            assert.deepEqual(session.base.carriedMembers, firstCarry, `count ${count}: the segment saved the carry it started from`);
            found = { state1, secondAction, second, firstCarry, secondCarry: structuredClone(session.setup.carriedMembers) };
        }
        assert.ok(found, `count ${count}: found two open segments`);

        const stagedMeta = structuredClone(meta);
        const thirdPreview = playBoard(found.second.preview.state, boardSession(stagedMeta).setup, []);
        const thirdTarget = thirdPreview.result.members.find(member => member.standing)?.slot;
        assert.ok(thirdTarget, `count ${count}: a target remains for a third choice`);
        const stagedAgain = stageExchange(stagedMeta, found.second.preview.state, [{ who: 'Astra', kind: 'attack', target: thirdTarget }]);
        assert.equal(stagedAgain.error, undefined, `count ${count}: a third choice can be staged`);
        reconcileBoard(stagedMeta, id => id !== 'receipt2');
        assert.equal(boardSession(stagedMeta).setup.invalidated, true, `count ${count}: a staged choice is invalidated while its receipt is gone`);
        reconcileBoard(stagedMeta, () => true);
        assert.equal(boardSession(stagedMeta).setup.invalidated, undefined, `count ${count}: the returning receipt clears the invalidation`);

        reconcileBoard(meta, id => id !== 'receipt2');
        const restored = boardSession(meta);
        assert.equal(restored.setup.offset, 1, `count ${count}: the rewind returns to the prior segment`);
        assert.deepEqual(restored.setup.carriedMembers, found.firstCarry, `count ${count}: the prior carry is back`);
        const restaged = stageExchange(meta, found.state1, found.secondAction);
        assert.equal(restaged.error, undefined, `count ${count}: the original target can be chosen again`);
        assert.deepEqual(bits(restaged.preview.result), bits(found.second.preview.result), `count ${count}: fresh restaging uses the same bars and dice`);
        receiveBoard(meta, { key: 'b:second', board: boardPayload(found.second.session) }, found.second.preview.result, 'reply2', 'receipt2', found.second.preview.state);
        assert.deepEqual(boardSession(meta).setup.carriedMembers, found.secondCarry, `count ${count}: regenerating the saved receipt restores its carry`);
    }
});
