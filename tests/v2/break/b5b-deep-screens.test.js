// B-b5b-robust-8/9: a screen's template or CSS within the 64 KB code limit (packs/limits.js `code`) that is
// deeply nested. Packs and character cards may carry screens; pack install accepts both of these.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTemplate } from '../../../src/v2/view/template/index.js';
import { scopeCss } from '../../../src/v2/view/css.js';
import { createHost } from '../../../testkit/index.js';

const deepTemplate = depth => `${'<div>'.repeat(depth)}x`;
const deepCss = depth => `${'@media (min-width: 1px) {'.repeat(depth)}.a { color: red }${'}'.repeat(depth)}`;

test('B-b5b-robust-8: a 5 000-deep template (25 KB) is refused or compiled, never a stack overflow', () => {
    const html = deepTemplate(5000);
    assert.ok(html.length < 64 * 1024);
    let compiled = null;
    assert.doesNotThrow(() => { compiled = compileTemplate(html); }, 'compileTemplate must not throw RangeError (sanitize.js filterNodes / index.js compileChildren recurse per level)');
    assert.ok(compiled.warnings.length > 0 || compiled.nodes.length > 0);
});

test('B-b5b-robust-8: pack install refuses a template nested past what the renderer can draw', async () => {
    const host = await createHost();
    try {
        const pack = {
            id: 'deep-template', version: '1.0.0', name: 'Deep', requires: { storyBlock: '^2' }, content: {},
            screens: [{ id: 'deep-board', title: 'Board', mounts: ['tab'], template: deepTemplate(5000) }],
        };
        const result = await host.packs.packs.install(JSON.stringify(pack), { origin: 'pack.json' });
        let drawable = true;
        try { compileTemplate(pack.screens[0].template); } catch { drawable = false; }
        assert.ok(!result.ok || drawable, 'installed, yet every draw ends in "could not be drawn: Maximum call stack size exceeded"');
    } finally {
        host.close();
    }
});

test('B-b5b-robust-9: scopeCss is not cubic in nesting depth (1 000 nested @media, 26 KB)', () => {
    const css = deepCss(1000);
    assert.ok(css.length < 64 * 1024);
    const start = Date.now();
    const out = scopeCss(css, 'deep-board');
    const took = Date.now() - start;
    assert.ok(took < 500, `scopeCss took ${took} ms on the main thread (2 000 levels, 52 KB, take ~35 s); output ${out.css.length} chars`);
});
