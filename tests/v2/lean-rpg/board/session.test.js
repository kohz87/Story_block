// Opening a board fight marks its setup for members and keeps the exact bars a matching committed fight left.

import test from 'node:test';
import assert from 'node:assert/strict';
import { boardSession, openBoard } from '../../../../src/v2/lean-rpg/board/session.js';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';
import { character, foeBlock, sheetDomain } from '../helpers.js';

const RULES = { ...STANDARD_FORMULA, levelDivisor: 5 };
const state = (foes = [['Rats', 2, 1, 3]]) => ({ meta: { claims: {} }, domains: { dataModules: sheetDomain({
    hero: { role: 'character', fields: character('Astra') }, foes: { role: 'foes', fields: foeBlock(foes) },
}) } });
const member = (n, value, size = 5, group = 1) => ({ slot: group * 10 + n, group, n, name: n === 1 ? 'Rats' : `Rats ${n}`, value, size, pack: false, count: 1, standing: value > 0 });
const pack = (n, value, count, size = 8, group = 1) => ({ slot: group * 10 + n, group, n, name: `Rats pack ${n}`, value, size, pack: true, count, standing: value > 0 });
const receipt = (members, key = 'board-1') => ({ receipt: { type: 'rpg.resolve', data: { v2: { result: {
    board: { id: key, groups: [1] }, members,
} } } } });

test('every new board fight is marked for members; kept is omitted when no committed bars match', () => {
    const value = state();
    const opened = openBoard({}, value, { sid: 'reply-1', rules: RULES });
    assert.equal(opened.error, undefined, opened.error);
    assert.equal(opened.session.setup.members, 1);
    assert.equal(Object.hasOwn(opened.session.setup, 'kept'), false);
});

test('kept bars come from the newest committed board result that still matches the block', () => {
    const value = state();
    const opened = openBoard({}, value, { sid: 'reply-1', rules: RULES, receipts: [receipt([member(1, 5), member(2, 5)], 'older'), receipt([member(1, 2), member(2, 3)], 'newer')] });
    assert.deepEqual(opened.session.setup.kept, { 1: [2, 3] });
});

test('a newer result that no longer collapses to the block is skipped for that slot', () => {
    const value = state();
    const opened = openBoard({}, value, { sid: 'reply-1', rules: RULES, receipts: [receipt([member(1, 2), member(2, 3)], 'matching'), receipt([member(1, 2), member(2, 2)], 'changed')] });
    assert.deepEqual(opened.session.setup.kept, { 1: [2, 3] });
});

test('kept packs use their own final bars and are copied, not shared with the receipt', () => {
    const value = state([['Rats', 12, 1, 4]]), bars = [pack(1, 8, 12, 8)];
    const history = receipt(bars, 'pack');
    const opened = openBoard({}, value, { sid: 'reply-1', rules: RULES, receipts: [history] });
    assert.deepEqual(opened.session.setup.kept, { 1: [8] });
    opened.session.setup.kept[1][0] = 0;
    assert.equal(history.receipt.data.v2.result.members[0].value, 8);
});

test('the branch history skips a result whose claim is no longer on this branch', () => {
    const value = state();
    value.meta.claims = { 'rpg:resolve:b:board-old:reply:reply-1': true };
    const meta = { rpgFightHistory: [
        { claim: 'rpg:resolve:b:board-gone:reply:reply-1', members: [member(1, 2), member(2, 3)] },
        { claim: 'rpg:resolve:b:board-old:reply:reply-1', members: [member(1, 3), member(2, 3)] },
    ] };
    const opened = openBoard(meta, value, { sid: 'reply-1', rules: RULES });
    assert.deepEqual(opened.session.setup.kept, { 1: [3, 3] });
});

test('a pending new-foe opening is stored in the setup for the narrator note', () => {
    const value = state(), meta = { rpgFightStart: { anchor: 'reply-1', result: { opened: [{ name: 'Rats', count: 3, level: 1 }] } } };
    const opened = openBoard(meta, value, { sid: 'reply-1', rules: RULES });
    assert.deepEqual(boardSession(meta).setup.opened, [{ name: 'Rats', count: 3, level: 1 }]);
    assert.deepEqual(opened.session.setup.opened, meta.rpgFightStart.result.opened);
});
