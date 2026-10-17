// Dice display: one card per roll, the honesty line, the reel, plain fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, texts } from './ui-fake-dom.js';

const doc = installFakeDom();
const dice = await import('../src/ui/displays/dice.js');

const def = { id: 'dice', name: 'Dice', icon: '🎲', tag: 'Dice', kind: 'turn', format: 'text', display: 'dice' };
const LOCK = '🎲 Pick the **lock** — d20+3 vs DC 15 → 12+3 = 15 · success';
const CLIMB = '🎲 Climb the wall — d20-1 vs DC 12 → 9-1 = 8 · fail, the rope snaps';
const TALK = '🎲 Persuade the guard — d20 vs DC 10 → 20 · critical success';
const DODGE = '🎲 Dodge — d20 vs DC 13 → 1 · critical fail';
const HAGGLE = '🎲 Haggle — d20+2 vs DC 14 → 11+2 = 13 · success, at a cost';
const FIVE = [LOCK, CLIMB, TALK, DODGE, HAGGLE].join('\n');
let keys = 0;

function show(options) {
    const pane = doc.createElement('div');
    doc.body.appendChild(pane);
    // A fresh uiKey per render unless a test pins one: the reel plays once per key and text.
    dice.render(pane, { def, uiKey: `test-${++keys}`, ...options });
    return pane;
}

function withMotion(reduce, fn) {
    const saved = globalThis.matchMedia;
    globalThis.matchMedia = query => ({ matches: reduce && /prefers-reduced-motion:\s*reduce/.test(query) });
    try { return fn(); } finally {
        if (saved === undefined) delete globalThis.matchMedia;
        else globalThis.matchMedia = saved;
    }
}

test('dice: one roll draws one card with face, attempt, sum, pill', () => {
    const pane = show({ state: { text: LOCK } });
    assert.ok(pane.classList.contains('story-block-display'));
    assert.ok(pane.classList.contains('story-block-display-dice'));
    assert.equal(pane.querySelector('.story-block-title').textContent, 'Dice');
    assert.equal(pane.querySelector('.story-block-summary').textContent, '1 roll');
    const list = pane.querySelector('.story-block-dice ol.story-block-dice-list');
    assert.equal(list.getAttribute('aria-label'), 'Dice');
    const cards = pane.querySelectorAll('.story-block-dice-card');
    assert.equal(cards.length, 1);
    const card = cards[0];
    assert.equal(card.tagName, 'LI');
    assert.equal(card.querySelector('.story-block-dice-roll').textContent, '12');
    assert.equal(card.querySelector('.story-block-dice-die').textContent, 'd20');
    assert.equal(card.querySelector('.story-block-dice-attempt').textContent, 'Pick the lock');
    assert.equal(card.querySelector('.story-block-dice-total').textContent, '15');
    assert.equal(card.querySelector('.story-block-dice-mod').textContent, '(12 + 3)');
    assert.equal(card.querySelector('.story-block-dice-vs').textContent, 'vs');
    assert.equal(card.querySelector('.story-block-dice-dc').textContent, 'DC 15');
    assert.equal(card.querySelector('.story-block-dice-pill').textContent, 'success');
    assert.equal(card.querySelector('.story-block-dice-note'), null);
    assert.equal(card.querySelector('.story-block-dice-sum-warning'), null);
    // Face first, so it sits on the left.
    assert.ok(card.children[0].classList.contains('story-block-dice-face'));
});

test('dice: several rolls, outcome classes and labels, mod shown only when set', () => {
    const pane = show({ state: { text: FIVE } });
    assert.equal(pane.querySelector('.story-block-summary').textContent, '5 rolls');
    const cards = pane.querySelectorAll('.story-block-dice-card');
    assert.equal(cards.length, 5);
    assert.deepEqual(cards.map(card => card.dataset.outcome), ['success', 'fail', 'crit', 'critfail', 'cost']);
    for (const card of cards) {
        assert.ok(card.classList.contains(`is-${card.dataset.outcome}`));
        assert.ok(card.querySelector('.story-block-dice-pill').classList.contains(`is-${card.dataset.outcome}`));
    }
    assert.deepEqual(texts(pane, '.story-block-dice-pill'), ['success', 'fail', 'critical success', 'critical fail', 'success, at a cost']);
    assert.deepEqual(texts(pane, '.story-block-dice-roll'), ['12', '9', '20', '1', '11']);
    assert.deepEqual(texts(pane, '.story-block-dice-total'), ['15', '8', '20', '1', '13']);
    // Negative modifiers use a real minus; no modifier, no breakdown.
    assert.equal(cards[1].querySelector('.story-block-dice-mod').textContent, '(9 − 1)');
    assert.equal(cards[2].querySelector('.story-block-dice-mod'), null);
    assert.equal(cards[3].querySelector('.story-block-dice-mod'), null);
});

test('dice: the note line carries what follows the outcome word', () => {
    const pane = show({ state: { text: FIVE } });
    const cards = pane.querySelectorAll('.story-block-dice-card');
    assert.equal(cards[1].querySelector('.story-block-dice-note').textContent, 'the rope snaps');
    assert.deepEqual(texts(pane, '.story-block-dice-note'), ['the rope snaps']);
});

test('dice: other dice sizes label the face', () => {
    const pane = show({ state: { text: 'Sneak past — d6 vs DC 4 → 5 · success' } });
    assert.equal(pane.querySelector('.story-block-dice-die').textContent, 'd6');
    assert.equal(pane.querySelector('.story-block-dice-roll').textContent, '5');
});

test('dice: model text is never markup', () => {
    const pane = show({ state: { text: '🎲 <img src=x onerror=alert(1)> — d20 vs DC 10 → 14 · success, <b>loud</b>' } });
    assert.equal(pane.querySelector('.story-block-dice-attempt').textContent, '<img src=x onerror=alert(1)>');
    assert.equal(pane.querySelector('img'), null);
    assert.equal(pane.querySelector('b'), null);
    assert.equal(pane.innerHTML.includes('<img'), true, 'shown literally as text');
});

test('dice: honesty ok shows the quiet rolled-by line with the handed numbers', () => {
    const pane = show({ state: { text: FIVE }, rolls: [12, 9, 20, 1, 11, 7] });
    const line = pane.querySelector('.story-block-dice-honesty');
    assert.ok(line.classList.contains('is-ok'));
    assert.equal(line.textContent, 'Rolled by Story Block · 12, 9, 20, 1, 11, 7');
    assert.equal(pane.querySelectorAll('.story-block-dice-card.is-flagged').length, 0);
    // After the cards.
    const body = pane.querySelector('.story-block-dice');
    assert.equal(body.children[body.children.length - 1], line);
});

test('dice: honesty mismatch lists every problem and marks the affected cards', () => {
    const pane = show({ state: { text: [LOCK, CLIMB, TALK].join('\n') }, rolls: [9, 12] });
    const box = pane.querySelector('.story-block-dice-honesty');
    assert.ok(box.classList.contains('is-mismatch'));
    assert.equal(box.getAttribute('role'), 'note');
    assert.equal(box.querySelector('.story-block-dice-honesty-head').textContent, 'These rolls don\'t match the dice Story Block rolled');
    assert.deepEqual(texts(box, '.story-block-dice-problem'), [
        'Roll 1: 12 was used out of order (expected 9)',
        'Roll 2: 9 was used out of order (expected 12)',
        'Roll 3 was not handed over (only 2 were)',
    ]);
    assert.deepEqual(box.querySelectorAll('.story-block-dice-problem').map(item => item.dataset.kind), ['order', 'order', 'invented']);
    assert.equal(box.querySelector('.story-block-dice-handed').textContent, 'Story Block rolled: 9, 12');
    const cards = pane.querySelectorAll('.story-block-dice-card');
    assert.ok(cards.every(card => card.classList.contains('is-flagged')));
    assert.deepEqual(cards.map(card => card.dataset.problems), ['order', 'order', 'invented']);
    // The mark is text too, not colour alone.
    assert.deepEqual(texts(pane, '.story-block-dice-flag'), ['Used out of order', 'Used out of order', 'Not a rolled number']);
});

test('dice: only the mismatched card is marked', () => {
    const pane = show({ state: { text: [LOCK, CLIMB].join('\n') }, rolls: [12, 4] });
    const cards = pane.querySelectorAll('.story-block-dice-card');
    assert.equal(cards[0].classList.contains('is-flagged'), false);
    assert.equal(cards[0].dataset.problems, undefined);
    assert.ok(cards[1].classList.contains('is-flagged'));
    assert.deepEqual(texts(pane, '.story-block-dice-problem'), ['Roll 2: 9 is not one of the rolls handed over']);
});

test('dice: unchecked says nothing; an explicit empty list says "not verified"', () => {
    for (const rolls of [null, undefined]) {
        const pane = show({ state: { text: LOCK }, rolls });
        assert.equal(pane.querySelector('.story-block-dice-honesty'), null);
        assert.equal(pane.querySelector('.story-block-dice-card.is-flagged'), null);
    }
    const pane = show({ state: { text: LOCK }, rolls: [] });
    const line = pane.querySelector('.story-block-dice-honesty');
    assert.ok(line.classList.contains('is-unverified'));
    assert.match(line.textContent, /^Rolls not verified/);
    assert.equal(pane.querySelector('.story-block-dice-card.is-flagged'), null);
});

test('dice: a sum that does not add up says so, checked or not', () => {
    const bad = '🎲 Force the door — d20+2 vs DC 15 → 10+2 = 15 · success';
    const unchecked = show({ state: { text: bad } });
    assert.match(unchecked.querySelector('.story-block-dice-sum-warning').textContent, /^Doesn't add up: 10 \+ 2 is 12, not 15$/);
    assert.equal(unchecked.querySelector('.story-block-dice-honesty'), null);

    const checked = show({ state: { text: bad }, rolls: [10] });
    const card = checked.querySelector('.story-block-dice-card');
    assert.ok(card.classList.contains('is-flagged'));
    assert.equal(card.dataset.problems, 'sum');
    assert.ok(card.querySelector('.story-block-dice-sum-warning'));
    // The sum line already explains it: no second flag.
    assert.equal(card.querySelector('.story-block-dice-flag'), null);
    assert.ok(checked.querySelector('.story-block-dice-honesty').classList.contains('is-mismatch'));
    assert.equal(checked.querySelectorAll('.story-block-dice-problem').length, 1);

    const noMod = show({ state: { text: 'Sneak — d6 vs DC 4 → 3 = 5' } });
    assert.match(noMod.querySelector('.story-block-dice-sum-warning').textContent, /rolled 3, written as 5/);
});

test('dice: reelDecoys is deterministic, never the roll, stays on the die', () => {
    assert.deepEqual(dice.reelDecoys(12), [19, 6, 13, 20, 7]);
    assert.deepEqual(dice.reelDecoys(12), dice.reelDecoys(12));
    for (const sides of [4, 6, 8, 10, 12, 20, 100]) {
        for (let roll = 1; roll <= sides; roll++) {
            const decoys = dice.reelDecoys(roll, sides);
            assert.equal(decoys.length, 5);
            assert.ok(decoys.every(value => value !== roll && value >= 1 && value <= sides), `d${sides} roll ${roll}: ${decoys}`);
            assert.notEqual(decoys[decoys.length - 1], roll);
        }
    }
});

test('dice: the reel spins only when animate is set, landing on the roll', () => {
    const still = withMotion(false, () => show({ state: { text: LOCK } }));
    assert.equal(still.querySelector('.story-block-dice-reel'), null);
    assert.equal(still.querySelector('.story-block-dice-card.is-animated'), null);

    const pane = withMotion(false, () => show({ state: { text: LOCK }, animate: true }));
    const card = pane.querySelector('.story-block-dice-card');
    assert.ok(card.classList.contains('is-animated'));
    const reel = card.querySelector('.story-block-dice-reel');
    assert.equal(reel.getAttribute('aria-hidden'), 'true');
    const strip = reel.querySelector('.story-block-dice-strip');
    assert.deepEqual(strip.children.map(node => node.textContent), ['19', '6', '13', '20', '7', '12']);
    assert.ok(strip.children.at(-1).classList.contains('story-block-dice-landed'));
    assert.equal(strip.style.getPropertyValue('--sb-dice-decoys'), '5');
    // Screen readers hear the rolled number once, not the strip.
    const spoken = card.querySelector('.story-block-dice-roll');
    assert.equal(spoken.textContent, '12');
    assert.ok(spoken.classList.contains('story-block-dice-sr'));
    assert.equal(card.querySelector('.story-block-dice-die').textContent, 'd20');
});

test('dice: no reel under prefers-reduced-motion', () => {
    const pane = withMotion(true, () => show({ state: { text: LOCK }, animate: true }));
    assert.equal(pane.querySelector('.story-block-dice-reel'), null);
    assert.equal(pane.querySelector('.story-block-dice-roll').textContent, '12');
});

test('dice: the reel plays once per block and uiKey, not on every refresh', () => {
    const run = (uiKey, text = LOCK) => withMotion(false, () => show({ state: { text }, animate: true, uiKey }));
    assert.ok(run('refresh').querySelector('.story-block-dice-reel'));
    assert.equal(run('refresh').querySelector('.story-block-dice-reel'), null, 'a re-render rests');
    assert.ok(run('refresh', CLIMB).querySelector('.story-block-dice-reel'), 'new rolls spin');
    assert.ok(run('refresh-sidebar').querySelector('.story-block-dice-reel'), 'each surface spins once');
});

test('dice: text that is not roll lines falls back to plain', () => {
    const pane = show({ state: { text: `${LOCK}\nThe guard eyes you warily.` } });
    assert.ok(pane.classList.contains('story-block-display-plain'));
    assert.equal(pane.classList.contains('story-block-display-dice'), false);
    assert.equal(pane.querySelector('.story-block-dice-card'), null);
    assert.match(pane.querySelector('.story-block-plain-text').textContent, /The guard eyes you warily\./);
    assert.match(pane.querySelector('.story-block-plain-text').textContent, /Pick the lock/);
});

test('dice: a pane reused across displays keeps only the current display class', () => {
    const pane = doc.createElement('div');
    dice.render(pane, { def, state: { text: 'Just prose.' } });
    assert.ok(pane.classList.contains('story-block-display-plain'));
    dice.render(pane, { def, state: { text: LOCK } });
    assert.ok(pane.classList.contains('story-block-display-dice'));
    assert.equal(pane.classList.contains('story-block-display-plain'), false);
    dice.render(pane, { def, state: { text: 'Just prose.' } });
    assert.equal(pane.classList.contains('story-block-display-dice'), false);
});

test('dice: a cut-off block shows as plain text with the notice', () => {
    const pane = show({ state: { text: LOCK }, truncated: true, rolls: [3] });
    assert.ok(pane.classList.contains('story-block-display-plain'));
    assert.equal(pane.querySelector('.story-block-dice-card'), null);
    assert.equal(pane.querySelector('.story-block-dice-honesty'), null, 'no accusation from half a line');
    assert.match(pane.querySelector('.story-block-notice.is-truncated').textContent, /cut off/);
});

test('dice: error notice above the cards', () => {
    const pane = show({ state: { text: LOCK }, error: 'Unclosed tag.' });
    const note = pane.querySelector('.story-block-notice.is-error');
    assert.match(note.textContent, /This reply's Dice couldn't be read: Unclosed tag\./);
    assert.ok(pane.querySelector('.story-block-dice-card'));
    assert.ok(pane.children.indexOf(note) < pane.children.indexOf(pane.querySelector('.story-block-dice')));
});

test('dice: edit button calls onEdit and stops the click', () => {
    let edits = 0;
    const pane = show({ state: { text: LOCK }, onEdit: () => { edits += 1; } });
    const edit = pane.querySelector('.story-block-edit');
    assert.equal(edit.getAttribute('aria-label'), 'Edit Dice');
    const event = edit.click();
    assert.equal(edits, 1);
    assert.equal(event.stopped, true);
    assert.equal(show({ state: { text: LOCK } }).querySelector('.story-block-edit'), null);
});

test('dice: empty and missing states', () => {
    const missing = show({ state: null });
    assert.equal(missing.querySelector('.story-block-empty').textContent, 'No Dice in the latest reply.');
    assert.ok(missing.classList.contains('story-block-display-dice'));
    assert.equal(missing.querySelector('.story-block-summary'), null);
    const empty = show({ state: { text: '  \n ' }, rolls: [4] });
    assert.equal(empty.querySelector('.story-block-empty').textContent, 'Dice is empty. It fills in as the story goes.');
    assert.equal(empty.querySelector('.story-block-dice-honesty'), null);
});
