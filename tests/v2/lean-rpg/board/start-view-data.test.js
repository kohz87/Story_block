// The pure start-view mapping: a staged fight's sheet labels, and the two-choice attack hold.

import test from 'node:test';
import assert from 'node:assert/strict';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';
import { openBoard } from '../../../../src/v2/lean-rpg/board/session.js';
import { offerLineData, pauseViewData } from '../../../../src/v2/lean-rpg/board/start-view-data.js';
import { character, levelFoeBlock, sheetDomain } from '../helpers.js';

function state() {
    return { domains: { dataModules: sheetDomain({
        hero: { role: 'character', fields: character('Astra') },
        foes: { role: 'foes', fields: levelFoeBlock([['Sluice Rats', 3, 1, 5], ['Eels', 1, 1, 4]]) },
    }) } };
}

function openedFight() {
    const value = state(), meta = {};
    const result = openBoard(meta, value, { sid: 'reply-1', rules: { ...STANDARD_FORMULA, levelDivisor: 5 } });
    assert.equal(result.error, undefined, result.error);
    return { fight: result.session, state: value };
}

test('the offer line names the staged fight and hides for this fight when asked', () => {
    const { fight, state: value } = openedFight();
    const shown = offerLineData(fight, { state: value });
    assert.equal(shown.visible, true);
    assert.deepEqual(shown.foes.map(foe => foe.name), ['Sluice Rats', 'Eels']);
    assert.equal(shown.text, 'A fight started: Sluice Rats, Eels.');
    assert.deepEqual([shown.boardLabel, shown.autoLabel].filter(Boolean), ['Fight on the board', 'Auto-fight']);
    const hidden = offerLineData(fight, { state: value, hidden: true });
    assert.equal(hidden.visible, false);
    assert.equal(hidden.text, shown.text, 'hiding keeps the same fight wording');
    assert.equal(offerLineData(null, { state: value }), null);
});

test('the known pause reads foe groups from the sheet with level and health', () => {
    const { fight, state: value } = openedFight();
    const data = pauseViewData({ fight, state: value });
    assert.equal(data.mode, 'known');
    assert.match(data.title, /^This is an attack on Sluice Rats \(3\)/);
    assert.equal(data.note, 'Your message waits while the fight is played on the board.');
    assert.deepEqual([data.boardLabel, data.autoLabel].filter(Boolean), ['Fight on the board', 'Auto-fight (up to 3 exchanges)'], 'two choices, no narration');
    assert.equal(pauseViewData({ fight, state: value, cap: 1 }).autoLabel, 'Auto-fight (up to 1 exchange)');
    assert.equal(pauseViewData({ fight, state: value, cap: 9 }).autoLabel, 'Auto-fight (until the end)');
});

test('the helpers do not change their inputs, and with no standing foe there is no pause', () => {
    const { fight, state: value } = openedFight();
    const before = JSON.stringify({ fight, value });
    offerLineData(fight, { state: value });
    pauseViewData({ fight, state: value });
    assert.equal(JSON.stringify({ fight, value }), before);
    assert.equal(pauseViewData({}), null);
    assert.equal(pauseViewData({ waiting: true }), null, 'there is no planner wait any more');
});
