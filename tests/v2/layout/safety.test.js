// No markup parsing anywhere in the layout code: a source scan (the runtime side is the
// fake DOM in helpers/, which throws on innerHTML for every other layout test).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAYOUT_CSS } from '../../../src/v2/layout/index.js';

const dir = fileURLToPath(new URL('../../../src/v2/layout/', import.meta.url));
const walk = path => readdirSync(path).flatMap(name => {
    const full = join(path, name);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.js') ? [full] : [];
});

test('layout code never parses markup or evaluates code', () => {
    const files = walk(dir);
    assert.ok(files.length >= 4, 'scanned the layout folder');
    const forbidden = /innerHTML|outerHTML|insertAdjacentHTML|document\.write|DOMParser|createContextualFragment|srcdoc|\beval\s*\(|new\s+Function\b|setAttribute\(\s*['"]on|setAttribute\(\s*['"]style|setAttribute\(\s*['"]href|Math\.random|Date\.now/;
    for (const file of files) {
        const lines = readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, index) => assert.doesNotMatch(line, forbidden, `${file}:${index + 1}`));
    }
});

test('the stylesheet scopes every rule to ss-l- classes and loads nothing', () => {
    assert.doesNotMatch(LAYOUT_CSS, /url\(|@import|expression/);
    const selectors = LAYOUT_CSS.replace(/@(container|media)[^{]*\{/g, '').match(/^[^{}@\n][^{}]*(?=\{)/gm) ?? [];
    assert.ok(selectors.length > 20);
    for (const selector of selectors) {
        for (const part of selector.split(',')) assert.match(part.trim(), /^\.ss-l-/, `rule "${part.trim()}"`);
    }
    assert.match(LAYOUT_CSS, /@container \(max-width: 480px\)[^}]*\.ss-l-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/);
    assert.match(LAYOUT_CSS, /\.ss-l-root \{[^}]*container-type: inline-size/);
});
