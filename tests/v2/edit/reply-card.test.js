import test from 'node:test';
import assert from 'node:assert/strict';
import { replyEdits, replyRules } from '../../../src/v2/reply-cards.js';
import { changesCardScreen, changesSummary } from '../../../src/v2/screens/changes-card.js';
import { core, queries, show, stocked, text } from '../screens/helpers.js';

test('edits and fired rules follow receipt order and skip inactive blocks', () => {
    const record = { receipts: [
        { id: 'a', summary: 'You set Torch to 3.', data: { edit: true } },
        { id: 'b', summary: 'Not used.', data: { edit: true } },
        { id: 'c', summary: 'Story.', data: { v2: { result: { rules: ['threshold'] } } } },
    ] };
    const problems = [{ index: 4, receipts: ['b'] }];
    assert.deepEqual(replyEdits(record, problems, 4), [{ text: 'You set Torch to 3.' }]);
    assert.equal(replyRules(record, problems, 4)[0].text, 'Rule: threshold');
    assert.equal(replyEdits(record, problems, 3).length, 2);
});

test('the changed card shows full edit lines and a hint only on the latest reply', () => {
    const module = core();
    const state = stocked(module);
    const edits = [{ text: 'You set Torch to 3.' }, { text: 'You set the purse to 5 silver.' }];
    const draw = editableHead => show(changesCardScreen, { state, query: queries(module, state), changes: [], extra: { edits, editableHead, moduleLines: [] } });
    const latest = draw(true);
    assert.deepEqual(latest.view.warnings, []);
    assert.deepEqual(latest.el.querySelectorAll('.edit').map(text), edits.map(edit => edit.text));
    assert.match(text(latest.el.querySelector('.edit-hint')), /swipe or delete/);
    assert.equal(draw(false).el.querySelector('.edit-hint'), null);
    assert.match(changesSummary({ edits: edits.length }), /2 edits of yours/);
});
