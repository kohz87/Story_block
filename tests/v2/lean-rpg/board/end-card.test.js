// The board's end card: Send acts on the press itself (a redraw between press and release cannot eat it), fires once,
// and the settled note leaves out a bar that moved within one word.

import test from 'node:test';
import assert from 'node:assert/strict';
import { pressButton } from '../../../../src/v2/lean-rpg/board/view.js';
import { barMovement } from '../../../../src/v2/lean-rpg/board/note.js';
import { STAGES, stageWord } from '../../../../src/v2/lean-rpg/names.js';

const stubDoc = () => ({
    createElement: tag => {
        const handlers = {};
        return {
            tag, disabled: false, className: '', textContent: '', attrs: {},
            setAttribute(name, value) { this.attrs[name] = value; },
            addEventListener(type, fn) { (handlers[type] ??= []).push(fn); },
            emit(type, event = {}) { for (const fn of handlers[type] ?? []) fn({ preventDefault() {}, ...event }); },
        };
    },
});

test('Send acts on the press and fires once, even if a click follows', () => {
    let sent = 0;
    const node = pressButton(stubDoc(), 'Send with this fight', 'rpg-board-send', () => { sent += 1; });
    node.emit('pointerdown', { button: 0, pointerType: 'mouse' });
    node.emit('click');
    assert.equal(sent, 1);
});

test('a touch press sends; a right-button press does not; a keyboard click still sends', () => {
    let sent = 0;
    const touch = pressButton(stubDoc(), 'Send', 'x', () => { sent += 1; });
    touch.emit('pointerdown', { button: -1, pointerType: 'touch' });
    assert.equal(sent, 1);
    const right = pressButton(stubDoc(), 'Send', 'x', () => { sent += 1; });
    right.emit('pointerdown', { button: 2, pointerType: 'mouse' });
    assert.equal(sent, 1, 'a right-button press does nothing');
    right.emit('click');
    assert.equal(sent, 2, 'the keyboard / click path still works');
});

test('a disabled Send does nothing', () => {
    let sent = 0;
    const node = pressButton(stubDoc(), 'Send', 'x', () => { sent += 1; });
    node.disabled = true;
    node.emit('pointerdown', { button: 0 });
    node.emit('click');
    assert.equal(sent, 0);
});

test('the settled note leaves out a bar that moved within one word, and keeps a change of word', () => {
    const size = 5;
    const words = Array.from({ length: size + 1 }, (_, n) => stageWord(STAGES.stamina, n, size));
    const same = words.findIndex((word, n) => n > 0 && word === words[n - 1]);
    if (same > 0) assert.equal(barMovement({ name: 'Astra', id: 'astra:stamina', from: same, to: same - 1, size }, true), '');
    assert.equal(barMovement({ name: 'Astra', id: 'astra:stamina', from: 3, to: 3, size }, true), '');
    const change = words.findIndex((word, n) => n > 0 && word !== words[n - 1]);
    assert.match(barMovement({ name: 'Astra', id: 'astra:stamina', from: change, to: change - 1, size }, true), /^Astra stamina \S.* → \S/);
});
