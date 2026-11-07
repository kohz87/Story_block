// With the fight board OFF the RPG behaves as before the board existed: a regenerate is not blocked by a remembered fight,
// but a staged fight with exchanges still is (it cannot silently leave the story).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrecall } from '../../../../src/v2/lean-rpg/index.js';
import { LEAN_RPG_FEATURE } from '../../../../src/v2/lean-rpg/names.js';

const BOARD = 'story-block.fight-board';
const remembered = { key: 'b:x:a:0', board: { id: 'x', anchor: 'a', setup: { offset: 0 }, exchanges: [] } };
const make = meta => {
    const messages = [{ is_user: false, mes: 'The rats close in.' }, { is_user: true, mes: 'I hit the lead rat.', extra: { rpgFightLinks: { [remembered.key]: true } } }];
    return createPrecall({ chat: () => messages, metadata: () => meta });
};
const viewOf = board => ({ feature: id => id === LEAN_RPG_FEATURE || (board && id === BOARD), query: () => null, state: { domains: {} } });
const regenerate = { commit: true, type: 'regenerate' };

test('board OFF, no staged exchanges: a regenerate is allowed exactly as before the board existed', () => {
    const precall = make({ rpgFightLast: structuredClone(remembered) });
    assert.equal(precall.canGenerate(viewOf(false), regenerate), null);
});

test('board OFF, a live staged fight (exchanges): the regenerate stays blocked', () => {
    const precall = make({ rpgFightBoard: { id: 'x', anchor: 'zzz', setup: { offset: 0 }, exchanges: [{}] } });
    const refused = precall.canGenerate(viewOf(false), regenerate);
    assert.equal(refused?.ok, false);
    assert.match(refused.reason, /fight/i);
});
