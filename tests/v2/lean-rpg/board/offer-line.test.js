// The reply offer line: its text, two labelled actions, callback payloads, dot and cleanup.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createOfferDot, createOfferLineView } from '../../../../src/v2/lean-rpg/board/offer-line.js';
import { setupDom } from '../../view/mounts/helpers.js';

const data = {
    visible: true, text: 'A fight started: Sluice Rats.', label: 'Fight offer: Sluice Rats',
    boardLabel: 'Fight on the board', narrateLabel: 'Keep narrating',
};

test('the offer line renders the sentence and exactly two callback actions', () => {
    const doc = setupDom(), calls = [];
    const view = createOfferLineView({ doc, onFight: chosen => calls.push(['fight', chosen]), onNarrate: chosen => calls.push(['narrate', chosen]) });
    const reply = doc.createElement('div');
    doc.body.appendChild(reply);
    const node = view.render(reply, data);
    assert.equal(node.className, 'rpg-fight-offer');
    assert.equal(node.getAttribute('role'), 'group');
    assert.equal(node.getAttribute('aria-label'), 'Fight offer: Sluice Rats');
    assert.equal(reply.querySelector('.rpg-fight-offer-line').textContent, '⚔A fight started: Sluice Rats.');
    const buttons = reply.querySelectorAll('button');
    assert.equal(buttons.length, 2);
    assert.deepEqual(buttons.map(button => button.textContent), ['Fight on the board', 'Keep narrating']);
    assert.ok(buttons.every(button => button.getAttribute('type') === 'button'));
    assert.match(buttons[0].className, /rpg-fight-offer-fight/);
    assert.match(buttons[1].className, /rpg-fight-offer-narrate/);
    buttons[0].click(); buttons[1].click();
    assert.deepEqual(calls, [['fight', data], ['narrate', data]]);
    view.render(reply, { ...data, visible: false });
    assert.equal(reply.querySelector('.rpg-fight-offer'), null, 'Keep narrating hides this fight\'s line');
    view.destroy();
});

test('the offer text is text, and the Fight-tab dot names the open offer', () => {
    const doc = setupDom(), view = createOfferLineView({ doc }), reply = doc.createElement('div');
    const node = view.render(reply, { ...data, text: 'A fight started: <b>not markup</b>.' });
    assert.equal(node.querySelector('b'), null);
    assert.match(node.textContent, /<b>not markup<\/b>/);
    const dot = createOfferDot(doc, { dotLabel: 'Fight offer open' });
    assert.equal(dot.className, 'rpg-fight-offer-dot');
    assert.equal(dot.getAttribute('role'), 'img');
    assert.equal(dot.getAttribute('aria-label'), 'Fight offer open');
    view.destroy();
});

test('the offer buttons are at least 44px touch targets at once and 48px before phone zoom', () => {
    const css = readFileSync(new URL('../../../../src/v2/lean-rpg/board/fight-start.css', import.meta.url), 'utf8');
    assert.match(css, /\.rpg-fight-offer-actions > button[\s\S]*?min-height: 44px/);
    assert.match(css, /touch-action: manipulation/);
    assert.match(css, /min-height: calc\(48px \/ var\(--ss-zoomed, 1\)\)/);
    assert.match(css, /\.rpg-fight-offer-dot \{[^}]*width: 9px;[^}]*height: 9px;/);
});
