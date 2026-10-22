// QA: the form engine (src/v2/view/form) with hostile schemas, values and names. Labels, help text, option names, group
// names, profile names and stored values come from module settings, so from packs and at one remove from the model: all
// of it is drawn as text; no markup is parsed, no class is picked by data, no event attribute, style or URL is set.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { installFakeDom } from '../../ui-fake-dom.js';
import { createSettings } from '../../../src/v2/sdk.js';
import { renderSettingsForm } from '../../../src/v2/view/form/index.js';

const doc = installFakeDom();
const EVIL = '<img src=x onerror=alert(1)>"\'><svg onload=alert(1)>';
const SCHEMA = {
    [EVIL]: { type: 'bool', label: EVIL, help: EVIL },
    'a b"c': { type: 'text', label: `Group ${EVIL}: ${EVIL}`, help: EVIL, group: EVIL, max: 40 },
    n: { type: 'int', label: EVIL, min: 1, max: 9, help: EVIL },
    s: { type: 'int', label: EVIL, min: 0, max: 10, form: 'slider', unit: EVIL },
    c: { type: 'choice', label: EVIL, options: [{ value: EVIL, label: EVIL }, EVIL] },
    chips: { type: 'choice', form: 'chips', label: EVIL, options: [{ value: EVIL, label: EVIL }, 'b'] },
    many: { type: 'choice', form: 'chips', multiple: true, label: EVIL, options: [EVIL, 'b'] },
    p: { type: 'profile', label: EVIL },
    l: { type: 'list', label: EVIL, help: EVIL, of: { name: { type: 'text', label: EVIL, max: 20 }, n: { type: 'int', label: EVIL, min: 0, max: 9 }, flag: { type: 'bool', label: EVIL }, pick: { type: 'choice', label: EVIL, options: [EVIL, 'x'] } } },
    lt: { type: 'list', label: EVIL, of: { name: { type: 'text', label: EVIL, max: 20 }, n: { type: 'int', label: EVIL, min: 0, max: 9 } } },
    f: { type: 'hologram', label: EVIL },
};
const DEFAULTS = { [EVIL]: true, 'a b"c': EVIL, n: 3, s: 4, c: EVIL, chips: EVIL, many: [EVIL], p: EVIL, l: [{ name: EVIL, n: 2, flag: true, pick: EVIL }], lt: [{ name: EVIL, n: 1 }], f: EVIL };
const TAGS = new Set(['DIV', 'SECTION', 'DETAILS', 'SUMMARY', 'H2', 'H3', 'SPAN', 'SMALL', 'P', 'LABEL', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'BUTTON', 'OUTPUT']);
const CLASS = /^ss-[a-z0-9-]+$/;
const DATA = new Set(['data-wide', 'data-module', 'data-field', 'data-kind', 'data-type', 'data-readonly', 'data-index', 'data-form', 'data-value', 'data-id']);

function walk(node) { return [node, ...node.children.flatMap(walk)]; }

test('hostile names and values are drawn as text only: no markup, no data-picked class, no event attribute, no style or URL', () => {
    const es = {};
    const settings = createSettings({ root: () => es, registry: { module: () => ({ settings: { schema: SCHEMA, defaults: DEFAULTS } }) }, save: () => {} });
    const parent = doc.createElement('div');
    doc.body.appendChild(parent);
    const form = renderSettingsForm(parent, {
        moduleId: 'm', schema: SCHEMA, settings, doc, title: EVIL, hint: EVIL, search: true,
        profiles: () => ({ usable: true, profiles: [{ name: EVIL }, { name: 'ok' }] }),
    });
    form.filter(EVIL);
    form.filter('');
    // Drive a few of them, with hostile text typed in.
    const text = form.field('a b"c').handle.input;
    text.value = EVIL;
    text.dispatch('change');
    form.field('l').row.querySelector('.ss-lines-add').click();
    form.field('lt').row.querySelector('.ss-lines-toggle').click();
    const area = form.field('lt').row.querySelector('.ss-lines-text');
    area.value = `${EVIL}: 3: 4\n${EVIL}`;
    area.dispatch('change');
    for (const node of walk(parent)) {
        assert.ok(TAGS.has(node.tagName), `no <${node.tagName}>`);
        for (const name of node.attributeNames()) {
            assert.doesNotMatch(name, /^on/i, `${node.tagName} ${name}`);
            assert.ok(!['style', 'href', 'src', 'srcdoc', 'action', 'formaction'].includes(name.toLowerCase()), `no ${name}`);
            if (name.startsWith('data-')) assert.ok(DATA.has(name), `data attribute ${name}`);
        }
        for (const token of node.classes()) assert.match(token, CLASS, `class "${token}"`);
        // A style is only a custom property set from a number (the slider's fill, the lines' none).
        for (const [key, value] of Object.entries(node.styleProps)) assert.ok(/^--ss-fill$/.test(key) && /^[\d.]+$/.test(value), `style ${key}: ${value}`);
    }
    // The hostile text is there as text, whole.
    const all = parent.textContent;
    assert.ok(all.includes(EVIL), 'shown as text');
    assert.equal(parent.querySelectorAll('img, svg, script').length, 0);
    assert.equal(form.field('f'), undefined, 'an unknown type is not drawn');
    // The key that is not a plain name only reaches a data attribute.
    assert.equal(form.field('a b"c').row.getAttribute('data-field'), 'a b"c');
    form.destroy();
});

test('no innerHTML, outerHTML, insertAdjacentHTML, document.write or eval in the form engine\'s sources', () => {
    const dir = new URL('../../../src/v2/view/form/', import.meta.url);
    const files = readdirSync(dir).filter(file => file.endsWith('.js'));
    assert.ok(files.length >= 4);
    for (const file of files) {
        const source = readFileSync(new URL(file, dir), 'utf8');
        assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|Math\.random|Date\.now/, file);
        assert.doesNotMatch(source, /\.on[a-z]+\s*=(?!=)/, `${file} assigns no on* handler`);
        assert.doesNotMatch(source, /setAttribute\(\s*['"]on/i, `${file} sets no on* attribute`);
        assert.doesNotMatch(source, /setAttribute\(\s*['"](?:style|href|src)/i, `${file} sets no style, href or src`);
    }
});
