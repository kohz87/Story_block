// Controls' `type` through SillyTavern's DOMPurify (live test, 2026-10-22). The host's DOMPurify drops an
// <input>'s and a <button>'s `type`, so a radio or checkbox drew as a text box showing its value (RPG
// Battle's race cards showed "pack.ersveil-bluewatch/human"). compileTemplate carries the type past it as
// data-ss-type (markControlTypes) and the allow-list reads it back, held to the same allowed types as a
// written one. Checked with the testkit's stand-in for SillyTavern's DOMPurify (testkit/purify.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTemplate } from '../../../../src/v2/view/template/index.js';
import { TYPE_MARK, markControlTypes } from '../../../../src/v2/view/template/sanitize.js';
import { stPurify } from '../../../../testkit/index.js';
import { inventoryScreen } from '../../../../src/v2/screens/inventory.js';
import { changesCardScreen } from '../../../../src/v2/screens/changes-card.js';

/** Every element of a compiled template, depth first: [{ tag, attrs }]. */
function elements(nodes, out = []) {
    for (const node of nodes ?? []) {
        if (node.tag) out.push(node);
        elements(node.children, out);
    }
    return out;
}
const typeOf = node => node.attrs.find(([name]) => name === 'type')?.[1] ?? null;
const controls = (html, sanitize = stPurify) => {
    const compiled = compileTemplate(html, { sanitize });
    return { compiled, list: elements(compiled.nodes).filter(node => node.tag === 'input' || node.tag === 'button') };
};

test('the stand-in drops the type, as SillyTavern\'s DOMPurify does', () => {
    assert.equal(stPurify('<input type="radio" name="a" data-x="1"><button type="button" onclick="x()">b</button><script>1</script>'),
        '<input name="a" data-x="1"><button>b</button>');
});

test('markControlTypes renames only a control\'s type attribute', () => {
    assert.equal(markControlTypes('<input type="radio"><INPUT Type=checkbox/><button type=\'reset\'>x</button>'),
        `<input ${TYPE_MARK}="radio"><INPUT ${TYPE_MARK}=checkbox/><button ${TYPE_MARK}='reset'>x</button>`);
    // Other tags, other attributes, values and text are left as they are.
    const same = '<div type="x" data-type="y"><inputs type="z"></inputs><p>type="radio" in text</p><input data-props=\'{"type":"x > y"}\' value="type=1"></div>';
    assert.equal(markControlTypes(same), same);
});

test('after DOMPurify each control keeps its type: radio, checkbox, number, range, search, colour, text, and button types', () => {
    const html = ['radio', 'checkbox', 'number', 'range', 'search', 'color', 'text', 'hidden'].map(t => `<input type="${t}" data-draft="f${t}">`).join('')
        + '<form data-submit="m.go"><button type="button" data-command="m.a">a</button><button type="submit">b</button><button type="reset">c</button></form>';
    const { compiled, list } = controls(html);
    assert.deepEqual(compiled.warnings, []);
    assert.deepEqual(list.map(typeOf), ['radio', 'checkbox', 'number', 'range', 'search', 'color', 'text', 'hidden', 'button', 'submit', 'reset']);
    assert.ok(list.every(node => !node.attrs.some(([name]) => name === TYPE_MARK)), 'the carrier never reaches the page');
    assert.deepEqual(list.filter(node => node.tag === 'input').map(node => node.draft?.type), ['radio', 'checkbox', 'number', 'range', 'search', 'color', 'text', 'hidden']);
});

test('the same allow-list as a written type: file and image refused, anything else a text box, on any path', () => {
    for (const sanitize of [stPurify, null]) {
        const { compiled, list } = controls('<input type="file"><input type="image" src="https://x/y.png"><input type="javascript:alert(1)"><button type="menu">m</button>', sanitize);
        assert.deepEqual(list.map(typeOf), [null, null, 'text', 'button']);
        assert.ok(compiled.warnings.some(w => /type="file"/.test(w)) && compiled.warnings.some(w => /type="image"/.test(w)));
    }
    // A template writing the carrier itself gets no more than writing `type`.
    const own = controls(`<input ${TYPE_MARK}="file"><input ${TYPE_MARK}="checkbox"><div ${TYPE_MARK}="radio"></div>`, null);
    assert.deepEqual(own.list.map(typeOf), [null, 'checkbox']);
    assert.ok(!elements(own.compiled.nodes).find(node => node.tag === 'div').attrs.length, 'not on other elements');
    // One type per control: the first.
    assert.deepEqual(controls(`<input type="radio" ${TYPE_MARK}="file">`, null).list.map(typeOf), ['radio']);
});

test('Story Block\'s own screens keep their checkboxes and search box after DOMPurify', () => {
    for (const screen of [inventoryScreen, changesCardScreen]) {
        const plain = controls(screen.template, null).list.map(typeOf);
        const purified = controls(screen.template).list.map(typeOf);
        assert.ok(plain.some(type => type === 'checkbox'), screen.id);
        assert.deepEqual(purified, plain, screen.id);
    }
});

test('marking stays linear on a template full of unclosed tags', () => {
    for (const html of ['<input a=b '.repeat(40000), '<input a="'.repeat(40000), '<button '.repeat(40000)]) {
        const start = process.hrtime.bigint();
        markControlTypes(html);
        assert.ok(Number(process.hrtime.bigint() - start) / 1e6 < 500, `${html.slice(0, 12)}… took too long`);
    }
});
