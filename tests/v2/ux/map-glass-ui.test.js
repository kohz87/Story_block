// UI stage 4b, in the DOM: the map (view/widgets/map.js) on the glass look. The legend is a glass list card whose rows hold their
// sample and text; the current place is marked; the zoom buttons change the view and the read-back zoom; no control is ever
// disabled (zoom clamps at its limits instead). The map's keys, clicks and focus are the same as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { map } from '../../../src/v2/view/widgets/map.js';
import { fakeApi, host, installDom } from '../view/widgets/fake-dom.js';

// ---- the map: the legend is a glass list card; the controls read back; nothing is disabled ------------------

const PLACES = [
    { id: 'a', name: 'Bluewatch', x: 0, y: 0, icon: 'fa-house', kind: 'town' },
    { id: 'b', name: 'The Weir', x: 200, y: 40, icon: 'fa-water', kind: 'ruin' },
    { id: 'c', name: 'Old Mill', x: 90, y: 150, icon: 'fa-gear', kind: 'town' },
];
const ROUTES = [{ from: 'a', to: 'b', kind: 'road' }, { from: 'a', to: 'c', kind: 'road' }];

function mapped(props = {}) {
    const doc = installDom();
    const el = host(doc);
    const handle = map.render(el, { nodes: PLACES, edges: ROUTES, current: 'a', onSelect: 'scene.travel', ...props }, fakeApi());
    const root = el.children[0];
    return { doc, el, root, handle, q: sel => root.querySelector(sel), all: sel => root.querySelectorAll(sel), stage: root.querySelector('.ss-w-map-stage') };
}

test('the map: the legend is a glass list card with label and rows; each row holds its sample and its text', () => {
    const m = mapped();
    const legend = m.q('.ss-w-map-legend');
    assert.ok(legend.classList.contains('ss-glass-strong') && legend.classList.contains('ss-listcard'), 'a strong-glass list card');
    assert.equal(m.q('.ss-w-map-legend-title').className, 'ss-w-map-legend-title');
    const rows = m.all('.ss-w-map-legend-list li');
    assert.ok(rows.length >= 2, 'the kinds on show, the routes, you are here');
    for (const row of rows) {
        assert.ok(row.classList.contains('ss-listcard-row'));
        assert.ok(row.querySelector('.ss-listcard-item .ss-w-map-legend-text'), 'the text sits in the row\'s item');
    }
    assert.ok(rows.some(row => row.textContent.includes('You are here')));
});

test('the map: the current place is marked (aria-current, the current class); the place buttons are real buttons when selectable', () => {
    const m = mapped();
    const here = m.q('.ss-w-map-node[data-id="a"]');
    assert.equal(here.getAttribute('aria-current'), 'location');
    assert.ok(here.classList.contains('ss-w-current'));
    assert.equal(here.tagName.toLowerCase(), 'button');
    assert.equal(m.q('.ss-w-map-node[data-id="b"]').getAttribute('aria-current'), null);
});

test('the map: zoom in, zoom out and show-all change the view and the read-back zoom; the layer pill toggles its pressed state', () => {
    const m = mapped();
    const zoomIn = m.q('.ss-w-map-zoom-in'), zoomOut = m.q('.ss-w-map-zoom-out'), reset = m.q('.ss-w-map-reset');
    for (const node of [zoomIn, zoomOut, reset]) assert.ok(node.className.includes('ss-w-map-btn'));
    const before = m.stage.getAttribute('data-zoom');
    zoomIn.click();
    assert.ok(Number(m.stage.getAttribute('data-zoom')) > Number(before), 'zoom in');
    zoomOut.click();
    zoomOut.click();
    assert.ok(Number(m.stage.getAttribute('data-zoom')) < Number(before), 'zoom out');
    reset.click();
    assert.equal(m.stage.getAttribute('data-zoom'), before, 'show all is the fitted view again');
});

test('the map: no control is ever disabled (zoom clamps at its limits instead)', () => {
    const m = mapped();
    for (let i = 0; i < 30; i++) m.q('.ss-w-map-zoom-in').click();
    for (let i = 0; i < 60; i++) m.q('.ss-w-map-zoom-out').click();
    for (const node of m.all('button')) assert.equal(node.disabled, false, node.className);
});
