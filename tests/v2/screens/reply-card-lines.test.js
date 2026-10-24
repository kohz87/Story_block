// The modules' own lines on the "Changed this reply" card (MODULES §F125, `hooks.replyCard`): cleaned by
// replyCardLines, told in the header line after the rest, drawn as plain text in the card's list, and the
// "Nothing changed" line left out when a module had something to say.
import test from 'node:test';
import assert from 'node:assert/strict';
import { REPLY_LINES_MAX, changesCardScreen, changesSummary, replyCardLines } from '../../../src/v2/screens/index.js';
import { core, queries, renderSkip, show, stocked, text } from './helpers.js';

const skip = renderSkip;

test('replyCardLines: one line each, cut, a known icon or the default; a hook that throws or answers no list adds nothing', () => {
    const seen = [];
    const lines = replyCardLines([
        { moduleId: 'rpg-battle', fn: info => { seen.push(info); return [{ text: 'AGI check\n— pursuing', summary: 'AGI 10 vs 10: success', flag: 'story said fail', icon: 'fa-dice-d20' }, 'plain words', { text: '' }, null]; } },
        { moduleId: 'broken', fn: () => { throw new Error('no'); } },
        { moduleId: 'async', fn: async () => [{ text: 'late' }] },
        { moduleId: 'odd', fn: () => [{ text: 'x'.repeat(500), icon: 'fa-x" onclick="y' }] },
    ], { index: 4, state: { domains: {} }, changes: ['/domains/checks/log/ck_1'] });
    assert.equal(seen[0].index, 4);
    assert.deepEqual(seen[0].changes, ['/domains/checks/log/ck_1']);
    assert.deepEqual(lines.map(line => [line.module, line.text]), [['rpg-battle', 'AGI check — pursuing'], ['rpg-battle', 'plain words'], ['odd', 'x'.repeat(200)]]);
    assert.equal(lines[0].icon, 'fa-dice-d20');
    assert.equal(lines[0].flag, 'story said fail');
    assert.equal(lines[1].icon, 'fa-circle-info');
    assert.equal(lines[2].icon, 'fa-circle-info', 'an icon that is not a plain fa- name is replaced');
    const many = replyCardLines([{ moduleId: 'm', fn: () => Array.from({ length: 20 }, (_, n) => `line ${n}`) }], {});
    assert.equal(many.length, REPLY_LINES_MAX);
});

test('changesSummary: the modules\' lines after the rest, by their summary (else text); alone they replace "No changes"', () => {
    const lines = [{ summary: 'AGI 10 vs DC 10: success', text: 'long' }, { summary: '', text: 'Perception 4 vs DC 15: fail' }];
    assert.equal(changesSummary({ lines }), 'AGI 10 vs DC 10: success · Perception 4 vs DC 15: fail');
    assert.equal(changesSummary({ lines, refused: 1 }), 'AGI 10 vs DC 10: success · Perception 4 vs DC 15: fail · 1 line not applied');
    assert.equal(changesSummary({}), 'No changes');
});

test('changes card: module lines drawn as text with their flag and note; no "Nothing changed" then', { skip }, () => {
    const module = core();
    const state = stocked(module);
    const moduleLines = replyCardLines([{ moduleId: 'rpg-battle', fn: () => [{ text: 'Wessel, AGI (pursuing the wolf): d20 8 + AGI +2 = 10 vs DC 10 → success', flag: 'Story said fail; dice said success', note: '<b>not bold</b>', icon: 'fa-dice-d20' }] }], {});
    const { el, view } = show(changesCardScreen, { state, query: queries(module, state), changes: [], extra: { moduleLines } });
    assert.deepEqual(view.warnings, []);
    const line = el.querySelector('.extra');
    assert.ok(line, 'the module line is drawn');
    assert.equal(text(line.querySelector('.main')), 'Wessel, AGI (pursuing the wolf): d20 8 + AGI +2 = 10 vs DC 10 → success');
    assert.equal(text(line.querySelector('.flag')), 'Story said fail; dice said success');
    assert.equal(text(line.querySelector('.note')), '<b>not bold</b>', 'module text is printed, never parsed');
    assert.equal(line.querySelector('b'), null);
    assert.ok(line.querySelector('i').getAttribute('class').includes('fa-dice-d20'));
    assert.equal(el.querySelector('.none'), null);
});

test('changes card: without module lines (or another host that gives none) the card is as before', { skip }, () => {
    const module = core();
    const state = stocked(module);
    const { el } = show(changesCardScreen, { state, query: queries(module, state), changes: [] });
    assert.equal(el.querySelector('.extra'), null);
    assert.ok(el.querySelector('.none'), 'Nothing changed in the inventory or the scene.');
});
