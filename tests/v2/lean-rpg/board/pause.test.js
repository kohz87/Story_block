// The pause screen: known foes, the planner wait, new foes with approach checks, both callbacks and touch sizing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPauseView } from '../../../../src/v2/lean-rpg/board/pause.js';
import { setupDom } from '../../view/mounts/helpers.js';

const foe = { name: 'Rat Swarms', label: 'Rat Swarms · Lv 3', health: 'Unhurt' };
const known = {
    mode: 'known', title: 'Your message starts a fight', foeTitle: 'Foes', foes: [foe], checks: [], edge: '',
    note: 'The reply is waiting. Choose how this fight is played.', label: 'Fight paused',
    boardLabel: 'Fight it on the board', narrateLabel: 'Narrate it instead',
};
const refreshed = {
    ...known, mode: 'new', foeTitle: 'New foes',
    checks: [{ label: 'Astra · Obscure (DEX): SUCCESS 18 vs 15', outcome: 'success' }],
    edge: 'Edge: ambush · Astra acts first', note: '',
};

test('known foes render with the two actions and both callback payloads', () => {
    const doc = setupDom(), calls = [];
    const view = createPauseView({ doc, onBoard: chosen => calls.push(['board', chosen]), onNarrate: chosen => calls.push(['narrate', chosen]) });
    const host = doc.createElement('div'); doc.body.appendChild(host);
    const node = view.render(host, known);
    assert.match(node.className, /rpg-fight-pause-known/);
    assert.equal(node.getAttribute('role'), 'region');
    assert.match(node.textContent, /Your message starts a fight/);
    assert.match(node.textContent, /Rat Swarms · Lv 3/);
    assert.match(node.textContent, /Unhurt/);
    assert.match(node.textContent, /The reply is waiting\. Choose how this fight is played\./);
    const buttons = node.querySelectorAll('button');
    assert.deepEqual(buttons.map(button => button.textContent), ['Fight it on the board', 'Narrate it instead']);
    assert.ok(buttons.every(button => button.getAttribute('type') === 'button'));
    buttons[0].click(); buttons[1].click();
    assert.deepEqual(calls, [['board', known], ['narrate', known]]);
    view.destroy();
});

test('the working state is a live status with the exact text and no actions', () => {
    const doc = setupDom(), view = createPauseView({ doc }), host = doc.createElement('div');
    const node = view.render(host, { mode: 'working', status: 'Working out the fight…', foes: [], checks: [], actions: [] });
    assert.match(node.className, /rpg-fight-pause-working/);
    const status = node.querySelector('[role="status"]');
    assert.equal(status.getAttribute('aria-live'), 'polite');
    assert.match(status.textContent, /Working out the fight…/);
    assert.equal(node.querySelectorAll('button').length, 0);
    view.update(refreshed);
    assert.match(host.textContent, /New foes/);
    assert.equal(host.querySelectorAll('button').length, 2);
    view.destroy();
});

test('new foes show approach checks and the edge before the two actions', () => {
    const doc = setupDom(), view = createPauseView({ doc }), host = doc.createElement('div');
    const node = view.render(host, refreshed);
    const text = node.textContent;
    assert.match(text, /New foes/);
    assert.match(text, /Astra · Obscure \(DEX\): SUCCESS 18 vs 15/);
    assert.match(text, /Edge: ambush · Astra acts first/);
    assert.equal(node.querySelectorAll('.rpg-fight-pause-check').length, 1);
    assert.match(node.querySelector('.rpg-fight-pause-check').className, /rpg-fight-pause-success/);
    assert.deepEqual(node.querySelectorAll('button').map(button => button.textContent), ['Fight it on the board', 'Narrate it instead']);
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
