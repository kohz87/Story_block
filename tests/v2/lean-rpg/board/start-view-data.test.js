// The pure start-view mapping: a staged fight's sheet labels, the planner's opened foes and checks, and the wait text.

import test from 'node:test';
import assert from 'node:assert/strict';
import { STANDARD_FORMULA } from '../../../../src/v2/lean-rpg/rules.js';
import { openBoard } from '../../../../src/v2/lean-rpg/board/session.js';
import { WORKING_TEXT, offerLineData, pauseViewData } from '../../../../src/v2/lean-rpg/board/start-view-data.js';
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
    assert.deepEqual(shown.names, ['Sluice Rats', 'Eels']);
    assert.equal(shown.text, 'A fight started: Sluice Rats, Eels.');
    assert.deepEqual(shown.actions.map(action => action.label), ['Fight on the board', 'Keep narrating']);
    const hidden = offerLineData(fight, { state: value, hidden: true });
    assert.equal(hidden.visible, false);
    assert.equal(hidden.text, shown.text, 'hiding keeps the same fight wording');
    assert.equal(offerLineData(null, { state: value }), null);
});

test('the known pause reads foe groups from the sheet with level and health', () => {
    const { fight, state: value } = openedFight();
    const data = pauseViewData({ fight, state: value });
    assert.equal(data.mode, 'known');
    assert.match(data.foes[0].label, /^Sluice Rats ×3 · Lv 1$/);
    assert.match(data.foes[0].health, /Unhurt|Fresh/);
    assert.match(data.note, /The reply is waiting/);
    assert.deepEqual(data.actions.map(action => action.label), ['Fight it on the board', 'Narrate it instead']);
});

test('the planner opening shows new foes, the rolled approach checks and the ambush edge', () => {
    const opening = { data: { v2: { result: {
        opened: [{ name: 'Rat Swarms', count: 3, level: 3 }], order: [{ name: 'Astra', party: true }, { name: 'Rat Swarms', party: false }],
        checks: [{ kind: 'check', skill: 'Obscure', ambush: true, pc: { who: 'Astra', stat: 'dex', total: 18 }, dc: 15, outcome: 'success' }],
        ambush: { who: 'Astra', skill: 'Obscure', outcome: 'success', success: true, total: 18, dc: 15 },
    } } } };
    const data = pauseViewData({ opening });
    assert.equal(data.mode, 'new');
    assert.equal(data.title, 'Your message starts a fight');
    assert.equal(data.foeTitle, 'New foes');
    assert.match(data.foes[0].label, /^Rat Swarms ×3 · Lv 3$/);
    assert.equal(data.checks[0].label, 'Astra · Obscure (DEX): SUCCESS 18 vs 15');
    assert.equal(data.edge, 'Edge: ambush · Astra acts first');
    assert.deepEqual(data.actions.map(action => action.label), ['Fight it on the board', 'Narrate it instead']);
});

test('the waiting pause is the exact planner text and the helpers do not change their inputs', () => {
    const { fight, state: value } = openedFight();
    const opening = { opened: [{ name: 'Rat Swarms', count: 3, level: 3 }], checks: [{ kind: 'check', skill: 'Hide', ambush: true, pc: { who: 'Astra', stat: 'dex', total: 18 }, dc: 15, outcome: 'success' }] };
    const before = JSON.stringify({ fight, value, opening });
    offerLineData(fight, { state: value });
    pauseViewData({ fight, opening, state: value });
    assert.equal(JSON.stringify({ fight, value, opening }), before);
    const data = pauseViewData({ waiting: true });
    assert.equal(data.mode, 'working');
    assert.equal(data.status, WORKING_TEXT);
    assert.equal(data.status, 'Working out the fight…');
    assert.deepEqual(data.actions, []);
    assert.equal(pauseViewData({}), null);
});
