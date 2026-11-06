// A new fight rebuilds from the Foes block; only one open fight's exact bars carry into its next segment.

import test from 'node:test';
import assert from 'node:assert/strict';
import { playBoard } from '../../../../src/v2/lean-rpg/board/engine.js';
import { settledNote } from '../../../../src/v2/lean-rpg/board/note.js';
import { boardSession, openBoard, receiveBoard, stageExchange } from '../../../../src/v2/lean-rpg/board/session.js';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';
import { character, foeBlock, sheetDomain } from '../helpers.js';

const RULES = { ...STANDARD_FORMULA, levelDivisor: 5 };
const state = (foes = [['Rats', 3, 1, 4]]) => ({ meta: { claims: {} }, domains: { dataModules: sheetDomain({
    hero: { role: 'character', fields: character('Astra', { str: 20, agi: 20, health: 8 }) }, foes: { role: 'foes', fields: foeBlock(foes) },
}) } });
const action = { actions: [{ who: 'Astra', kind: 'attack', target: 11 }] };

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
    assert.match(settledNote(first.preview.result), /New foes: Rats ×3 \(Lv 1\), each fought on its own\./);
    const staged = stageExchange(meta, value, action.actions);
    assert.equal(staged.error, undefined, staged.error);
    assert.equal(staged.preview.result.stop, 'open');
    assert.match(settledNote(staged.preview.result), /New foes:/, 'the staged preview and its committed note agree');

    const payload = { key: 'b:first', board: { id: first.session.id, anchor: 'reply-1', groups: first.session.groups,
        setup: structuredClone(staged.session.setup), exchanges: structuredClone(staged.session.exchanges) } };
    assert.equal(receiveBoard(meta, payload, staged.preview.result, 'reply-1', 'receipt-1', value), true);
    const nextSetup = boardSession(meta).setup;
    assert.equal(Object.hasOwn(nextSetup, 'opened'), false);
    const next = playBoard(value, nextSetup, []);
    assert.equal(next.error, undefined, next.error);
    assert.doesNotMatch(settledNote(next.result), /New foes:/, 'the next segment has only its own note');
});
