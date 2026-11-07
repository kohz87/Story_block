// The pause screen: a typed attack on standing foes with its two choices, both callbacks and touch sizing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPauseView } from '../../../../src/v2/lean-rpg/board/pause.js';
import { setupDom } from '../../view/mounts/helpers.js';

const foe = { name: 'Rat Swarms', label: 'Rat Swarms · Lv 3', health: 'Unhurt' };
const known = {
    mode: 'known', title: 'Your message starts a fight', foes: [foe],
    note: 'The reply is waiting. Choose how this fight is played.', label: 'Fight paused',
    boardLabel: 'Fight on the board', autoLabel: 'Auto-fight (up to 3 exchanges)',
};
test('known foes render with the two actions and both callback payloads', () => {
    const doc = setupDom(), calls = [];
    const view = createPauseView({ doc, onBoard: chosen => calls.push(['board', chosen]), onAuto: chosen => calls.push(['auto', chosen]) });
    const host = doc.createElement('div'); doc.body.appendChild(host);
    const node = view.render(host, known);
    assert.match(node.className, /rpg-fight-pause-known/);
    assert.equal(node.getAttribute('role'), 'region');
    assert.match(node.textContent, /Your message starts a fight/);
    assert.match(node.textContent, /The reply is waiting\. Choose how this fight is played\./);
    const buttons = node.querySelectorAll('button');
    assert.deepEqual(buttons.map(button => button.textContent), ['Fight on the board', 'Auto-fight (up to 3 exchanges)']);
    assert.ok(buttons.every(button => button.getAttribute('type') === 'button'));
    buttons[0].click(); buttons[1].click();
    assert.deepEqual(calls, [['board', known], ['auto', known]]);
    view.destroy();
});

test('the pause has only the two choices: no narration, no planner wait', () => {
    const doc = setupDom(), view = createPauseView({ doc }), host = doc.createElement('div');
    const node = view.render(host, { ...known, narrateLabel: 'Narrate it instead' });
    assert.deepEqual(node.querySelectorAll('button').map(button => button.textContent), ['Fight on the board', 'Auto-fight (up to 3 exchanges)']);
    assert.equal(node.querySelector('[role="status"]'), null);
    view.render(host, null);
    assert.equal(host.querySelector('.rpg-fight-pause'), null);
    view.destroy();
});

test('the pause actions keep the board\'s 44px/48px touch targets and stack on phones', () => {
    const css = readFileSync(new URL('../../../../src/v2/lean-rpg/board/fight-start.css', import.meta.url), 'utf8');
    assert.match(css, /\.rpg-fight-pause-actions > button[\s\S]*?min-height: 44px/);
    assert.match(css, /\.rpg-fight-pause-actions > button[\s\S]*?touch-action: manipulation/);
    assert.match(css, /\.rpg-fight-pause-actions \{ flex-direction: column; \}/);
    assert.match(css, /\.rpg-fight-pause-actions > button \{ flex-basis: auto; width: 100%; \}/);
});
