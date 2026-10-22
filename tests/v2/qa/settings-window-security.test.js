// QA: the settings window (src/v2/view/settings/) with a hostile module. Module names, settings labels, help text, group
// names, option labels, feature labels and descriptions, fold titles and stored values come from modules, so from packs
// and at one remove from the model: all of it reaches the page as text. No markup is parsed (the fake DOM throws on
// innerHTML, outerHTML and insertAdjacentHTML), no class is picked by data, no event attribute, style or URL is set, and
// a search box holding the same text only filters. The markers are harmless text that looks like markup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { FakeElement } from '../../ui-fake-dom.js';
import { createHost } from '../../../testkit/index.js';
import { setupDom } from '../view/mounts/helpers.js';
import { openSettingsWindow } from '../../../src/v2/view/settings/window.js';

const forbid = name => function () { throw new Error(`markup was parsed: ${name}`); };
Object.defineProperty(FakeElement.prototype, 'innerHTML', { configurable: true, get: forbid('innerHTML get'), set: forbid('innerHTML set') });
Object.defineProperty(FakeElement.prototype, 'outerHTML', { configurable: true, get: forbid('outerHTML get'), set: forbid('outerHTML set') });
FakeElement.prototype.insertAdjacentHTML = forbid('insertAdjacentHTML');
const attributes = [];
const setAttribute = FakeElement.prototype.setAttribute;
FakeElement.prototype.setAttribute = function (name, value) {
    attributes.push([this.tagName, String(name), String(value)]);
    return setAttribute.call(this, name, value);
};

const MARK = '<b data-marker="one">"\'></b><i class="marker-two" style="x:1">';
const TAGS = new Set(['DIV', 'SECTION', 'HEADER', 'NAV', 'DETAILS', 'SUMMARY', 'H2', 'H3', 'H4', 'H5', 'SPAN', 'B', 'SMALL', 'P', 'LABEL', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'BUTTON', 'OUTPUT', 'I', 'UL', 'OL', 'LI', 'TABLE', 'CAPTION', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'METER', 'PRE']);
const walk = node => [node, ...node.children.flatMap(walk)];

const hostile = () => ({
    id: 'evil-mod',
    name: `Mod ${MARK}`,
    features: [{ id: 'evil-mod.on', label: '<b data-marker="f">"\'>', describe: `About ${MARK}` }],
    settings: {
        defaults: { flag: true, pick: 'a', note: MARK },
        schema: {
            flag: { type: 'bool', label: `Group ${MARK}: Flag ${MARK}`, help: MARK, group: MARK },
            pick: { type: 'choice', label: MARK, options: [{ value: 'a', label: MARK }, 'b'] },
            note: { type: 'text', label: MARK, help: MARK, max: 50 },
        },
        folds: [{ id: 'f', title: MARK, hint: MARK, render: el => { el.textContent = MARK; } }],
    },
});

test('hostile module text is drawn as text only: no markup, no data-picked class, no event attribute, no style or URL', async () => {
    const doc = setupDom();
    const host = await createHost({ modules: [hostile()] });
    const win = openSettingsWindow({ registry: host.registry, settings: host.settings, features: host.features, doc, sdk: host.sdk, openState: new Map() });
    const root = win.root;
    const input = root.querySelector('.ss-search-input');
    for (const text of [MARK, '<b', 'marker-two', '']) {
        input.value = text;
        input.dispatch('input');
    }
    win.select('modules');
    for (const node of walk(root)) {
        assert.ok(TAGS.has(node.tagName), `no <${node.tagName}>`);
        for (const name of node.attributeNames()) {
            assert.doesNotMatch(name, /^on/i, `${node.tagName} ${name}`);
            assert.ok(!['style', 'href', 'src', 'srcdoc', 'action', 'formaction'].includes(name.toLowerCase()), `no ${name}`);
        }
        for (const token of node.classes()) assert.match(token, /^[a-z0-9_-]+$/i, `class "${token}"`);
        // A style is only a custom property set from a number (a slider's fill).
        for (const [key, value] of Object.entries(node.styleProps)) assert.ok(/^--ss-[a-z-]+$/.test(key) && /^[\d.]+$/.test(value), `style ${key}: ${value}`);
    }
    for (const [tag, name, value] of attributes) {
        assert.doesNotMatch(name, /^on|^style$|^href$|^src$/i, `${tag} ${name}`);
        if (name === 'class') assert.doesNotMatch(value, /marker-two|data-marker/, 'no class from data');
    }
    // The text is there, whole, as text; nothing was made of it.
    assert.ok(root.textContent.includes(MARK), 'shown as text');
    assert.equal(root.querySelectorAll('img, svg, script, iframe, style, a').length, 0);
    assert.equal(root.querySelectorAll('b').filter(node => node.children.length).length, 0, 'a <b> holds only text');
    assert.equal(root.querySelectorAll('[data-marker]').length, 0);
    win.close();
    host.close();
});

test('no innerHTML, outerHTML, insertAdjacentHTML, document.write or eval in the settings window\'s sources', () => {
    const dir = new URL('../../../src/v2/view/settings/', import.meta.url);
    const files = readdirSync(dir).filter(file => file.endsWith('.js'));
    assert.deepEqual(files.sort(), ['bodies.js', 'search.js', 'sections.js', 'window.js']);
    for (const file of files) {
        const source = readFileSync(new URL(file, dir), 'utf8');
        assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|Math\.random|Date\.now/, file);
        assert.doesNotMatch(source, /\.on[a-z]+\s*=(?!=)/, `${file} assigns no on* handler`);
        assert.doesNotMatch(source, /setAttribute\(\s*['"]on/i, `${file} sets no on* attribute`);
        assert.doesNotMatch(source, /setAttribute\(\s*['"](?:style|href|src)/i, `${file} sets no style, href or src`);
    }
});
