// glass.css: the fight offer line (.rpg-fight-offer) and the pause card (.rpg-fight-pause) are mounted inside a chat message,
// outside every other Story Suite root, so each .ss-button / .ss-iconbutton rule must list them in its :where() container list;
// otherwise the buttons fall back to the browser default (near-white, unreadable on a dark theme).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cssOf } from '../helpers/css-parts.js';

const glass = cssOf('glass').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...glass.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => m[1]).filter(s => /\.ss-(button|iconbutton)\b/.test(s));

test('every .ss-button / .ss-iconbutton selector in glass.css lists the fight offer and pause roots', () => {
    assert.ok(rules.length >= 8, 'the button rules are found');
    for (const selector of rules) {
        for (const part of selector.split(/,\s*(?=:where)/)) {
            assert.match(part, /:where\([^)]*\.rpg-fight-offer\b[^)]*\)/, `offer root in: ${part.trim().slice(-80)}`);
            assert.match(part, /:where\([^)]*\.rpg-fight-pause\b[^)]*\)/, `pause root in: ${part.trim().slice(-80)}`);
        }
    }
});
