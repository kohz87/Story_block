// The extension's own icons (view/icons, Phosphor): clean path data, the SVG built with DOM calls only, the `ph-*` ids in
// iconNode and icon (and their fallback), the suite's screen icons, and the credits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ICON_SET } from '../../../src/v2/view/icons/set.js';
import { TAB_ICONS, hasIcon, iconFor, svgIcon, tabIcon } from '../../../src/v2/view/icons/index.js';
import { SVG_NS, iconNode } from '../../../src/v2/view/widgets/dom.js';
import { icon } from '../../../src/v2/view/mounts/common.js';
import { SUITE_NAV, HOME_ID } from '../../../src/v2/view/screens.js';
import { installDom } from './widgets/fake-dom.js';

const readRepo = rel => readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8');
const PATH_DATA = /^[MLHVCSQTAZmlhvcsqtaz0-9.,\s-]+$/;

test('ICON_SET: frozen ph-* entries, each with a line and a solid path of path data only', () => {
    assert.ok(Object.isFrozen(ICON_SET));
    const ids = Object.keys(ICON_SET);
    assert.ok(ids.length >= 40, `${ids.length} icons`);
    for (const [id, entry] of Object.entries(ICON_SET)) {
        assert.match(id, /^ph-[a-z0-9]+(?:-[a-z0-9]+)*$/, id);
        assert.ok(Object.isFrozen(entry), id);
        for (const weight of ['regular', 'fill']) {
            assert.ok(entry[weight].length > 20, `${id} ${weight}`);
            assert.match(entry[weight], PATH_DATA, `${id} ${weight} is path data only`);
        }
        assert.notEqual(entry.regular, entry.fill, `${id}: the two weights differ`);
    }
});

test('svgIcon: one <svg> and one <path> through createElementNS, the weight from the id or the option', () => {
    const doc = installDom();
    const line = svgIcon(doc, 'ph-house', { className: 'ss-w-icon' });
    assert.equal(line.tagName.toLowerCase(), 'svg');
    assert.equal(line.namespaceURI, SVG_NS);
    assert.equal(line.getAttribute('viewBox'), '0 0 256 256');
    assert.equal(line.getAttribute('fill'), 'currentColor');
    assert.equal(line.getAttribute('aria-hidden'), 'true');
    assert.equal(line.getAttribute('focusable'), 'false');
    assert.equal(line.getAttribute('class'), 'ss-w-icon ss-icon-svg');
    assert.equal(line.children.length, 1);
    assert.equal(line.children[0].getAttribute('d'), ICON_SET['ph-house'].regular);
    assert.equal(svgIcon(doc, 'ph-house:fill').children[0].getAttribute('d'), ICON_SET['ph-house'].fill);
    assert.equal(svgIcon(doc, 'ph-house', { weight: 'fill' }).getAttribute('data-weight'), 'fill');
    for (const bad of ['', 'ph-nope', 'ph-house:bold', 'ph-house:fill:x', 'fa-house', 'house', null, 7]) {
        assert.equal(hasIcon(bad), false, String(bad));
        assert.equal(svgIcon(doc, bad), null, String(bad));
    }
    const source = readRepo('src/v2/view/icons/index.js');
    assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|DOMParser|outerHTML/);
});

test('iconNode and icon: ph-* ids draw the SVG; an unknown ph-* id is the default icon; everything else as before', () => {
    const doc = installDom();
    assert.equal(iconNode(doc, 'ph-sword').getAttribute('data-icon'), 'ph-sword');
    assert.equal(iconNode(doc, 'ph-sword:fill').getAttribute('data-weight'), 'fill');
    const unknown = iconNode(doc, 'ph-not-an-icon');
    assert.equal(unknown.tagName.toLowerCase(), 'i');
    assert.ok(unknown.className.includes('fa-table-columns'));
    const fa = iconNode(doc, 'fa-map');
    assert.equal(fa.tagName.toLowerCase(), 'i');
    assert.ok(fa.className.includes('fa-solid') && fa.className.includes('fa-map'));
    assert.equal(iconNode(doc, '⚔').tagName.toLowerCase(), 'span');
    assert.equal(icon(doc, 'ph-gear-six').getAttribute('data-icon'), 'ph-gear-six');
    assert.ok(icon(doc, 'ph-nope').className.includes('fa-table-columns'));
    assert.ok(icon(doc, 'fa-star').className.includes('fa-star'));
});

test('the suite\'s screens have their own icons; a module\'s own icon wins on a screen that is not the suite\'s', () => {
    for (const id of [HOME_ID, ...SUITE_NAV]) assert.ok(hasIcon(tabIcon(id)), `${id} → ${tabIcon(id)}`);
    for (const value of Object.values(TAB_ICONS)) assert.ok(hasIcon(value), value);
    assert.equal(iconFor('story-director/world', 'fa-star'), tabIcon('story-director/world'), 'the suite\'s screen keeps its icon');
    assert.equal(iconFor('someone/party', 'fa-star'), 'fa-star', 'another module\'s screen keeps its own icon');
    assert.equal(iconFor('someone/party', ''), 'ph-users-three', 'with no icon of its own, the default for its name');
    assert.equal(iconFor('someone/odd', ''), '');
});

test('credits: ICONS-CREDITS.md has the MIT text and every id; README and Diagnostics name Phosphor', () => {
    const credits = readRepo('ICONS-CREDITS.md');
    assert.match(credits, /MIT License/);
    assert.match(credits, /Copyright \(c\) \d{4} Phosphor Icons/);
    for (const id of Object.keys(ICON_SET)) assert.ok(credits.includes(`\`${id}\``), id);
    assert.match(readRepo('README.md'), /Phosphor Icons/);
    assert.match(readRepo('src/v2/host-ui.js'), /credits: 'Icons: Phosphor Icons/);
    assert.equal(JSON.parse(readRepo('package.json')).dependencies?.['@phosphor-icons/core'], undefined, 'inlined, not a dependency');
});
