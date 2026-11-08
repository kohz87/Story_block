// Every notice that tells the reader to discard a fight also says where the button is.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boardFailure, restoreHint } from '../../../src/v2/turn/held-board.js';

const WHERE = '(Fight tab, Discard fight)';
const FILES = ['lean-rpg/precall.js', 'lean-rpg/board/view.js', 'lean-rpg/board/commit.js', 'lean-rpg/board/session.js',
    'lean-rpg/board/start-controller.js', 'lean-rpg/board/engine.js', 'turn/held-board.js', 'turn/reread.js', 'turn/events.js', 'turn/prompt-build.js'];

test('discard advice in held-board helpers names the Fight tab button', () => {
    assert.ok(restoreHint('x').includes(`discard the fight ${WHERE}.`));
    assert.ok(restoreHint('x', ' before retrying.').includes(`${WHERE} before retrying.`));
    assert.equal(restoreHint('Discard it and start again'), '');
    assert.ok(boardFailure('Could not save:', 'sheet moved').endsWith(`discard the fight ${WHERE}.`));
});

test('no shipped string tells the reader to discard without saying where', () => {
    for (const file of FILES) {
        const text = readFileSync(new URL(`../../../src/v2/${file}`, import.meta.url), 'utf8');
        for (const m of text.matchAll(/[Dd]iscard (the fight|it)(?! \(Fight tab, Discard fight\))[^'`\n]*['`]/g)) {
            assert.fail(`${file}: "${m[0]}" does not say where`);
        }
    }
});
