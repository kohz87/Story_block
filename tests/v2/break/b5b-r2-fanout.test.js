// B-b5b-robust-r2-2: the 64-deep element cap does not bound what a template draws. data-each loops
// multiply: three nested loops over a 54-row list (the Ersveil pack's `atlas.places`, which a pack screen
// can name in its `data`) draw 160 000 elements from an 85-byte template, 1.4 s here, and again on every
// head change; four loops are 8.5 million. Chromium: 1 000 rows × 2 loops = 1 001 000 elements, 5.6 s first
// draw, 1.7 s each later one. Pack install accepts such a screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../../ui-fake-dom.js';
import { compileTemplate, renderTemplate } from '../../../src/v2/view/template/index.js';
import { createHost } from '../../../testkit/index.js';

const nested = depth => {
    let html = 'x';
    for (let d = depth - 1; d >= 0; d -= 1) html = `<i data-each="q.p as ${'abcdefgh'[d]}">${html}</i>`;
    return html;
};
const rows = n => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Place ${i}` }));

test('B-b5b-robust-r2-2: nested data-each over a 54-row list does not draw 160 000 elements', () => {
    const doc = installFakeDom();
    const el = doc.createElement('div');
    const warnings = [];
    const start = Date.now();
    renderTemplate(el, compileTemplate(nested(3)), { q: { p: rows(54) } }, { evaluate: () => null, onWarn: w => warnings.push(w) });
    const took = Date.now() - start;
    const drawn = el.querySelectorAll('i').length;
    assert.ok(drawn <= 20_000, `drew ${drawn} elements in ${took} ms from a ${nested(3).length}-byte template (warnings: ${warnings.join(' ') || 'none'})`);
});

test('B-b5b-robust-r2-2: pack install refuses (or caps) a screen whose loops nest past a sane bound', async () => {
    const host = await createHost();
    try {
        const pack = {
            id: 'fan-out', version: '1.0.0', name: 'Fan', requires: { storyBlock: '^2' }, content: {},
            screens: [{ id: 'fan-board', title: 'Board', mounts: ['tab'], data: { p: { query: 'atlas.places' } }, template: nested(4) }],
        };
        const result = await host.packs.packs.install(JSON.stringify(pack), { origin: 'pack.json' });
        const doc = installFakeDom();
        const el = doc.createElement('div');
        let drawn = 0;
        if (result.ok) {
            renderTemplate(el, compileTemplate(nested(4)), { q: { p: rows(12) } }, { evaluate: () => null });
            drawn = el.querySelectorAll('i').length;
        }
        assert.ok(!result.ok || drawn <= 20_000, `installed; 12 rows already draw ${drawn} elements (54 rows: 8.5 million)`);
    } finally {
        host.close();
    }
});
