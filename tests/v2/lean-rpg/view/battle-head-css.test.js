// USER 3 Nov: the battle panel's header sat flush against the card edge with no divider. `.rpg-battle button` (a
// reset for the panel's buttons) outranked `.rpg-bl-head` and `.rpg-act-line`, both buttons, and took their padding and
// border. Their own rules must outrank the reset.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../../../src/v2/lean-rpg/view/lean-rpg.css', import.meta.url), 'utf8');
// Specificity of a simple selector list item: [ids, classes/attributes/pseudo-classes, types].
const specificity = selector => {
    const s = selector.replace(/::?[a-z-]+\([^)]*\)/g, ' ');
    return [(s.match(/#[\w-]+/g) ?? []).length, (s.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+/g) ?? []).length, (s.match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length];
};
const ruleOf = (pattern, prop) => {
    const found = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(([, sel, body]) => pattern.test(sel) && new RegExp(`(^|;)\\s*${prop}\\s*:`).test(body));
    assert.ok(found.length, `${pattern} sets ${prop}`);
    return found.map(([, sel]) => sel.trim());
};
const beats = (a, b) => { for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] > b[i]; return false; };

test('the header and action lines keep their padding and the header its divider over the button reset', () => {
    const reset = specificity(ruleOf(/\.rpg-battle button\b/, 'padding')[0]);
    for (const [cls, prop] of [['rpg-bl-head', 'padding'], ['rpg-bl-head', 'border-bottom'], ['rpg-act-line', 'padding-left']]) {
        const own = ruleOf(new RegExp(`\\.${cls}\\s*$`), prop).map(specificity);
        assert.ok(own.some(spec => beats(spec, reset)), `${cls} ${prop} outranks .rpg-battle button`);
    }
});
