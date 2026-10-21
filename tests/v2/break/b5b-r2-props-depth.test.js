// B-b5b-robust-r2-3: the depth caps (64 elements, 8 @-rules, pack JSON 16) miss a widget's `data-props`,
// JSON inside a template string. Props nested 2 000–3 000 deep (12–18 KB) make renderTemplate itself throw
// (structuredClone / fill recursion: "Maximum call stack size exceeded"; in Chromium at 3 000 deep "Cannot
// read properties of null (reading 'bind')") instead of the widget's own "failed" note, and pack install
// accepts the screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../../ui-fake-dom.js';
import { compileTemplate, renderTemplate } from '../../../src/v2/view/template/index.js';
import { standardWidgets } from '../../../src/v2/view/widgets/index.js';
import { createHost } from '../../../testkit/index.js';

const template = depth => `<ss-widget name="ss.badge" data-props='${'{"a":'.repeat(depth)}1${'}'.repeat(depth)}'></ss-widget>`;

test('B-b5b-robust-r2-3: deeply nested data-props never make renderTemplate throw', () => {
    const doc = installFakeDom();
    const el = doc.createElement('div');
    assert.doesNotThrow(() => renderTemplate(el, compileTemplate(template(3000)), {}, { evaluate: () => true, widgets: standardWidgets }));
});

test('B-b5b-robust-r2-3: pack install refuses data-props nested past the pack depth limit', async () => {
    const host = await createHost();
    try {
        const pack = {
            id: 'deep-props', version: '1.0.0', name: 'Deep', requires: { storyBlock: '^2' }, content: {},
            screens: [{ id: 'deep-props-board', title: 'Board', mounts: ['tab'], template: template(3000) }],
        };
        const result = await host.packs.packs.install(JSON.stringify(pack), { origin: 'pack.json' });
        assert.equal(result.ok, false, 'a screen with props nested 3 000 deep was installed');
    } finally {
        host.close();
    }
});
