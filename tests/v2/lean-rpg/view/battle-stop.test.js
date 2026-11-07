import test from 'node:test';
import assert from 'node:assert/strict';
import { readResolve } from '../../../../src/v2/lean-rpg/view/battle-log/read.js';
import { stopHint, stopLine } from '../../../../src/v2/lean-rpg/view/battle-log/stop.js';

const model = (stop, extra = {}) => ({ stop, pace: 'normal', flow: 2, cap: 8, board: false, rules: { roundCap: 8, decisiveMargin: 10 }, ...extra });

test('stop-line-per-reason', () => {
    assert.equal(stopLine(model('won')), 'Ended: every foe is down.');
    assert.equal(stopLine(model('lost')), 'Ended: the party is down.');
    assert.equal(stopLine(model('heavy')), 'Ended: a hero was badly hurt (2 or more Health blocks).');
    assert.equal(stopLine(model('budget')), 'Ended: the rolls were trimmed to fit the note size.');
    assert.equal(stopLine(model('decisive')), 'Ended: a decisive round (old rule).');
    assert.equal(stopLine(model('over')), 'Ended: the fight was decided (old rule).');
    assert.equal(stopLine(model('none')), '');
    assert.equal(stopLine(model('unknown')), '');
    assert.equal(stopLine(null), '');
});

test('stop-line-old-record-unchanged', () => {
    const old = {
        v: 1, key: '1-old', pace: 'normal', checks: [], refused: [], summary: { exchanges: 1, acts: [], refused: 0 },
        rounds: [{ n: 1, decisive: false, lines: [{ kind: 'act', outcome: 'success', skill: null,
            pc: { who: 'Astra', die: 10, stat: 'str', statBonus: 5, classValue: 2, classBonus: 4, rank: 0, edge: 0, total: 19 },
            foe: { slot: 1, name: 'Bristle-boar', die: 5, base: 5, classValue: 1, classBonus: 2, total: 12 } }] }],
    };
    const read = readResolve(old);
    const snapshot = JSON.stringify(read);
    assert.equal(stopLine(read), '');
    assert.equal(stopHint(read), '');
    assert.equal(JSON.stringify(read), snapshot, 'reading the stop never changes the record');
});

test('careful-one-exchange-says-pace', () => {
    const careful = model('pace', { pace: 'careful', rounds: [{ n: 1, decisive: true, lines: [] }] });
    assert.equal(stopLine(careful), 'Ended: careful pace allows 1 exchange.');
    assert.doesNotMatch(stopLine(careful), /decisive/i);
    assert.equal(stopHint(careful), 'The fight goes on next reply. To allow more per reply: Settings → RPG → Difficulty → Custom → Most exchanges per reply.');
});

test('cap-uses-rules-roundcap', () => {
    assert.equal(stopLine({ stop: 'cap', flow: 2, rules: { roundCap: 3 } }), 'Ended: reached the most exchanges per reply (3).');
    assert.equal(stopLine({ stop: 'cap', pace: 'normal' }), 'Ended: reached the most exchanges per reply (5).', 'a roll before the flow keeps 5');
    assert.equal(stopHint({ stop: 'cap', flow: 2, cap: 8 }), 'The fight goes on next reply. To allow more per reply: Settings → RPG → Difficulty → Custom → Most exchanges per reply.');
});

test('board-record-no-pace-words', () => {
    const board = { board: true, pace: 'careful', flow: 2, cap: 1, rules: { roundCap: 8 }, stop: 'open' };
    assert.equal(stopLine(board), 'Fight continues: you pick the next exchange.');
    assert.doesNotMatch(stopLine(board), /careful|pace|cap/i);
    assert.equal(stopHint(board), '');
    assert.equal(stopLine({ ...board, stop: 'fled' }), 'Ended: the party fled.');
    assert.equal(stopLine({ ...board, stop: 'won' }), 'Ended: every foe is down.');
    assert.equal(stopLine({ ...board, stop: 'lost' }), 'Ended: the party is down.');
});
