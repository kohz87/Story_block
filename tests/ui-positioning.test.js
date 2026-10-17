// SillyTavern gives <html> a transform and a zero height, so it is the containing block of
// every position:fixed element: bottom, inset and percentage offsets resolve against a
// zero-height box and put the sidebar, sheet, scrim and edge handle off screen (seen in a
// live SillyTavern 1.19 on phone and tablet). These rules must use top-left viewport units.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Comments stripped so a rule's selector is just the selector.
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function rulesFor(selectorPattern) {
    const out = [];
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (selectorPattern.test(match[1].trim())) out.push({ selector: match[1].trim(), body: match[2] });
    }
    return out;
}

test('fixed Story Block elements never use bottom, inset or percentage top/height', () => {
    const rules = rulesFor(/^\.story-block-(layer|sidebar|scrim|handle)(\[data-mode="(docked|drawer|sheet)"\])?(\[data-sheet="full"\])?(\.is-open)?$/);
    assert.ok(rules.length >= 5, 'found the sidebar, mode, scrim and handle rules');
    for (const { selector, body } of rules) {
        assert.doesNotMatch(body, /(^|[\s;])bottom\s*:/, `${selector} uses bottom`);
        assert.doesNotMatch(body, /(^|[\s;])inset\s*:/, `${selector} uses inset`);
        assert.doesNotMatch(body, /(^|[\s;])(top|height)\s*:\s*[\d.]+%/, `${selector} uses a percentage`);
    }
});

test('the sheet, drawer, scrim and handle are placed in viewport units', () => {
    const body = selector => rulesFor(new RegExp(`^${selector.replace(/[.[\]"=]/g, '\\$&')}$`)).map(rule => rule.body).join('\n');
    assert.match(body('.story-block-sidebar[data-mode="sheet"]'), /top:\s*38dvh/);
    assert.match(body('.story-block-sidebar[data-mode="sheet"][data-sheet="full"]'), /top:\s*max\(12dvh/);
    assert.match(body('.story-block-sidebar[data-mode="drawer"]'), /height:\s*100dvh/);
    assert.match(body('.story-block-scrim'), /height:\s*100dvh/);
    assert.match(body('.story-block-handle'), /top:\s*45dvh/);
});

// A closed drawer or sheet waits just off screen. Unclipped, that made SillyTavern's page
// scrollable (1367px tall on an 844px phone), so focusing the panel or opening the keyboard
// scrolled the whole page and stranded the send form mid-screen.
test('the sidebar, scrim and handle sit in one clipping layer, never fixed themselves', () => {
    const body = selector => rulesFor(new RegExp(`^${selector.replace(/[.[\]"=]/g, '\\$&')}$`)).map(rule => rule.body).join('\n');
    const layer = body('.story-block-layer');
    assert.match(layer, /position:\s*fixed/);
    assert.match(layer, /overflow:\s*clip/);
    assert.match(layer, /height:\s*100dvh/);
    for (const selector of ['.story-block-sidebar', '.story-block-scrim', '.story-block-handle']) {
        assert.match(body(selector), /position:\s*absolute/, `${selector} is placed inside the layer`);
    }
    assert.doesNotMatch(css, /story-block-(sidebar|scrim|handle)[^{]*\{[^}]*position:\s*fixed/, 'nothing escapes the clip');
});
