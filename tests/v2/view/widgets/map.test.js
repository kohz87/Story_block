// ss.map: the view maths (fit, zoom about a point, pan limits, screen ↔ world, minimap box), the
// deterministic auto-layout, and the widget: pan/zoom by pointer, wheel, pinch, buttons and keys, layer
// filter, fog, minimap, legend, and node selection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { map } from '../../../../src/v2/view/widgets/map.js';
import {
    autoLayout, clampView, clientToWorld, fitView, minimapBox, minimapToWorld, panBy, toPercent, withAspect,
    worldBounds, zoomAt, zoomLevel, ZOOM_IN_LIMIT, ZOOM_OUT_LIMIT,
} from '../../../../src/v2/view/widgets/map-math.js';
import { fakeApi, host, installDom, texts } from './fake-dom.js';

const close = (actual, expected, message, eps = 1e-6) => assert.ok(Math.abs(actual - expected) < eps, `${message ?? ''} ${actual} ≈ ${expected}`);
const closeView = (actual, expected, message) => {
    for (const key of ['x', 'y', 'w', 'h']) close(actual[key], expected[key], `${message ?? ''} ${key}`);
};

test('worldBounds and fitView: padded bounds, centred fit at the stage aspect', () => {
    const world = worldBounds([{ x: 0, y: 0 }, { x: 200, y: 100 }]);
    assert.deepEqual(world, { x: -30, y: -30, w: 260, h: 160 });
    const lone = worldBounds([{ x: 5, y: 5 }]);
    close(lone.w, 130); close(lone.x + lone.w / 2, 5);
    assert.deepEqual(worldBounds([]), { x: -50, y: -50, w: 100, h: 100 });
    const wide = fitView(world, 1);              // a square stage: the world's width decides
    closeView(wide, { x: -30, y: -80, w: 260, h: 260 });
    const tall = fitView(world, 4);              // a very wide stage: the height decides
    closeView(tall, { x: 100 - 320, y: -30, w: 640, h: 160 });
    closeView(fitView(world, 0), fitView(world, 4 / 3), 'a bad aspect falls back to 4:3');
});

test('zoomAt: keeps the focus point fixed on screen, clamps to the zoom limits', () => {
    const world = { x: 0, y: 0, w: 400, h: 300 };
    const view = fitView(world, 4 / 3);
    const rect = { left: 0, top: 0, width: 400, height: 300 };
    const before = clientToWorld(view, rect, 100, 75);
    const zoomed = zoomAt(view, 2, before.x, before.y, world);
    close(zoomed.w, 200); close(zoomed.h, 150);
    const after = clientToWorld(zoomed, rect, 100, 75);
    close(after.x, before.x, 'focus x'); close(after.y, before.y, 'focus y');
    close(zoomLevel(zoomed, world, 4 / 3), 2);
    const deep = zoomAt(view, 1000, 200, 150, world);
    close(zoomLevel(deep, world, 4 / 3), ZOOM_IN_LIMIT, 'zoom in limit');
    const far = zoomAt(view, 0.001, 200, 150, world);
    close(zoomLevel(far, world, 4 / 3), ZOOM_OUT_LIMIT, 'zoom out limit');
    closeView(zoomAt(zoomAt(view, 2, 50, 50, world), 0.5, 50, 50, world), view, 'zooming back returns');
});

test('panBy and clampView: the view centre stays inside the world', () => {
    const world = { x: 0, y: 0, w: 400, h: 300 };
    const view = { x: 100, y: 75, w: 200, h: 150 };
    assert.deepEqual(panBy(view, 10, -5, world), { x: 110, y: 70, w: 200, h: 150 });
    assert.deepEqual(panBy(view, 10000, 10000, world), { x: 300, y: 225, w: 200, h: 150 });
    assert.deepEqual(panBy(view, -10000, -10000, world), { x: -100, y: -75, w: 200, h: 150 });
    assert.deepEqual(clampView(view, world), view);
});

test('screen ↔ world: clientToWorld, toPercent, withAspect', () => {
    const view = { x: 10, y: 20, w: 200, h: 100 };
    const rect = { left: 50, top: 10, width: 400, height: 200 };
    assert.deepEqual(clientToWorld(view, rect, 50, 10), { x: 10, y: 20 });
    assert.deepEqual(clientToWorld(view, rect, 450, 210), { x: 210, y: 120 });
    assert.deepEqual(clientToWorld(view, rect, 250, 110), { x: 110, y: 70 });
    assert.deepEqual(toPercent(view, 110, 70), { left: 50, top: 50 });
    assert.deepEqual(toPercent(view, 10, 120), { left: 0, top: 100 });
    assert.deepEqual(withAspect(view, 1), { x: 10, y: -30, w: 200, h: 200 });
    assert.deepEqual(withAspect(view, 0), view);
});

test('minimap: the viewport box is the view clipped to the world; clicks map back through the letterbox', () => {
    const world = { x: 0, y: 0, w: 400, h: 200 };
    assert.deepEqual(minimapBox({ x: 100, y: 50, w: 100, h: 50 }, world), { x: 100, y: 50, w: 100, h: 50 });
    assert.deepEqual(minimapBox({ x: -100, y: -50, w: 200, h: 100 }, world), { x: 0, y: 0, w: 100, h: 50 });
    assert.deepEqual(minimapBox({ x: 350, y: 150, w: 200, h: 100 }, world), { x: 350, y: 150, w: 50, h: 50 });
    assert.deepEqual(minimapBox({ x: 500, y: 0, w: 50, h: 50 }, world), { x: 500, y: 0, w: 0, h: 50 });
    // 200×200 minimap: the 400×200 world is scaled by 0.5 and letterboxed 50px top and bottom.
    const rect = { left: 10, top: 10, width: 200, height: 200 };
    assert.deepEqual(minimapToWorld(world, rect, 10, 60), { x: 0, y: 0 });
    assert.deepEqual(minimapToWorld(world, rect, 210, 160), { x: 400, y: 200 });
    assert.deepEqual(minimapToWorld(world, rect, 110, 110), { x: 200, y: 100 });
});

test('autoLayout: deterministic, keeps given coordinates, grid without edges, force with edges', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }];
    const grid = autoLayout(nodes, []);
    assert.deepEqual(grid, {
        a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, c: { x: 200, y: 0 }, d: { x: 0, y: 100 }, e: { x: 100, y: 100 },
    });
    const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd' }, { from: 'd', to: 'e' }, { from: 'e', to: 'a' }];
    const one = autoLayout(nodes, edges);
    const two = autoLayout(nodes.map(node => ({ ...node })), edges.map(edge => ({ ...edge })));
    assert.deepEqual(one, two, 'same input, same layout');
    const points = Object.values(one);
    assert.equal(points.length, 5);
    for (const point of points) assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
    for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
            assert.ok(Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) > 20, 'nodes are spread apart');
        }
    }
    // Linked nodes end up closer than the farthest pair.
    const dist = (p, q) => Math.hypot(one[p].x - one[q].x, one[p].y - one[q].y);
    assert.ok(dist('a', 'b') < Math.max(...['c', 'd'].map(id => dist('a', id))) + 1e-9);

    const mixed = autoLayout([{ id: 'town', x: 0, y: 0 }, { id: 'farm', x: 300, y: 0 }, { id: 'mill' }, { id: 'well' }], [{ from: 'town', to: 'mill' }, { from: 'farm', to: 'mill' }]);
    assert.deepEqual(mixed.town, { x: 0, y: 0 });
    assert.deepEqual(mixed.farm, { x: 300, y: 0 });
    assert.deepEqual(mixed, autoLayout([{ id: 'town', x: 0, y: 0 }, { id: 'farm', x: 300, y: 0 }, { id: 'mill' }, { id: 'well' }], [{ from: 'town', to: 'mill' }, { from: 'farm', to: 'mill' }]));
    assert.ok(mixed.mill.x > 0 && mixed.mill.x < 400, 'pulled between the two places it links');
    assert.deepEqual(autoLayout([{ id: 'x', x: 1, y: 2 }], []), { x: { x: 1, y: 2 } });
    assert.deepEqual(autoLayout([], []), {});
});

// --- the widget ---------------------------------------------------------------------------------------

const PLACES = [
    { id: 'pl_town', name: 'Bluewatch', x: 0, y: 0, kind: 'town', icon: 'fa-house', layer: 'surface' },
    { id: 'pl_weir', name: 'The Weir', x: 300, y: 0, kind: 'wild', layer: 'surface' },
    { id: 'pl_mill', name: 'Old Mill', x: 300, y: 150, kind: 'ruin', layer: 'surface' },
    { id: 'pl_cave', name: 'Glow Cave', x: 100, y: 100, kind: 'dungeon', layer: 'underground' },
    { id: 'pl_well', name: 'Well Shaft', x: 0, y: 50, kind: 'stairs' },     // on every layer
];
const ROUTES = [
    { from: 'pl_town', to: 'pl_weir', kind: 'road' },
    { from: 'pl_weir', to: 'pl_mill', kind: 'trail' },
    { from: 'pl_well', to: 'pl_cave', kind: 'tunnel' },
    { from: 'pl_town', to: 'pl_well', kind: 'road' },
];

function mount(props, { rect = { left: 0, top: 0, width: 400, height: 300 }, observer = false } = {}) {
    const doc = installDom({ resizeObserver: observer });
    const el = host(doc);
    const api = fakeApi();
    const handle = map.render(el, props, api);
    const stage = el.querySelector('.ss-w-map-stage');
    if (rect) stage.rect = rect;
    const viewBox = () => el.querySelector('.ss-w-map-svg').getAttribute('viewBox').split(' ').map(Number);
    const view = () => { const [x, y, w, h] = viewBox(); return { x, y, w, h }; };
    const names = () => texts(el, '.ss-w-map-name');
    const node = id => el.querySelector(`.ss-w-map-node[data-id="${id}"]`);
    const pointer = (type, id, x, y, extra = {}) => stage.dispatch(type, { pointerId: id, clientX: x, clientY: y, pointerType: 'touch', button: 0, ...extra });
    return { doc, el, api, handle, stage, view, names, node, pointer };
}

test('map: draws the shown layer, fits it, and positions places by custom properties', () => {
    const m = mount({ nodes: PLACES, edges: ROUTES, current: 'pl_town', onSelect: 'scene.travel' });
    assert.deepEqual(m.names(), ['Bluewatch', 'The Weir', 'Old Mill', 'Well Shaft']);
    // Surface places span x 0…300, y 0…150 → padded world → fitted at 4:3.
    const world = worldBounds(PLACES.filter(place => place.layer !== 'underground'));
    closeView(m.view(), fitView(world, 4 / 3));
    const town = m.node('pl_town');
    const at = toPercent(m.view(), 0, 0);
    assert.equal(town.style.getPropertyValue('--ss-w-x'), String(at.left));
    assert.equal(town.style.getPropertyValue('--ss-w-y'), String(at.top));
    assert.equal(town.localName, 'button');
    assert.equal(town.getAttribute('aria-current'), 'location');
    assert.equal(town.getAttribute('aria-label'), 'Bluewatch (town), you are here');
    assert.ok(town.classList.contains('ss-w-current'));
    assert.ok(town.querySelector('i.fa-house'), 'the node icon is a Font Awesome glyph');
    assert.equal(m.node('pl_weir').getAttribute('data-kind'), 'wild');
    // Routes between shown places only (the tunnel goes underground).
    assert.deepEqual(m.el.querySelectorAll('.ss-w-map-edge').map(line => line.getAttribute('data-kind')), ['road', 'trail', 'road']);
    const road = m.el.querySelector('.ss-w-map-edge');
    assert.deepEqual(['x1', 'y1', 'x2', 'y2'].map(name => road.getAttribute(name)), ['0', '0', '300', '0']);
    assert.equal(road.namespaceURI, 'http://www.w3.org/2000/svg');
    assert.equal(m.el.querySelector('.ss-w-map-svg').getAttribute('preserveAspectRatio'), 'none');
});

test('map: clicking a place runs onSelect with its id; a drag that ends on it does not', () => {
    const m = mount({ nodes: PLACES, edges: ROUTES, onSelect: 'scene.travel' });
    m.node('pl_weir').click();
    assert.deepEqual(m.api.commands, [{ type: 'scene.travel', payload: { node: 'pl_weir' } }]);
    // A drag starting on a place: pointerdown, moves past the threshold, pointerup, then the browser's click.
    const target = m.node('pl_mill');
    target.dispatch('pointerdown', { pointerId: 1, clientX: 200, clientY: 150, pointerType: 'mouse', button: 0 });
    target.dispatch('pointermove', { pointerId: 1, clientX: 230, clientY: 150 });
    assert.ok(m.stage.captured.has(1), 'captured once it is a drag');
    target.dispatch('pointerup', { pointerId: 1, clientX: 230, clientY: 150 });
    assert.equal(m.stage.captured.size, 0, 'released');
    target.click();
    assert.equal(m.api.commands.length, 1, 'no command after a drag');
    target.click();
    assert.equal(m.api.commands.length, 2, 'the next plain click selects again');
    // A tiny jitter is still a click.
    target.dispatch('pointerdown', { pointerId: 2, clientX: 200, clientY: 150, pointerType: 'mouse', button: 0 });
    target.dispatch('pointermove', { pointerId: 2, clientX: 201, clientY: 151 });
    target.dispatch('pointerup', { pointerId: 2, clientX: 201, clientY: 151 });
    target.click();
    assert.equal(m.api.commands.length, 3);
});

test('map: without onSelect (or api.command) places are not buttons and run nothing', () => {
    const m = mount({ nodes: PLACES, edges: ROUTES });
    const town = m.node('pl_town');
    assert.equal(town.localName, 'div');
    assert.equal(town.getAttribute('role'), 'img');
    town.click();
    assert.equal(m.api.commands.length, 0);
});

test('map: pointer drag pans by the pixel distance in world units', () => {
    const m = mount({ nodes: PLACES, edges: ROUTES });
    const start = m.view();
    m.pointer('pointerdown', 1, 100, 100);
    m.pointer('pointermove', 1, 140, 120);
    m.pointer('pointerup', 1, 140, 120);
    const unit = start.w / 400;
    closeView(m.view(), { x: start.x - 40 * unit, y: start.y - 20 * unit, w: start.w, h: start.h });
    assert.ok(!m.stage.classList.contains('ss-w-dragging'));
    // A secondary mouse button does not pan.
    const now = m.view();
    m.pointer('pointerdown', 3, 100, 100, { pointerType: 'mouse', button: 2 });
    m.pointer('pointermove', 3, 300, 300);
    closeView(m.view(), now);
});

test('map: wheel zooms about the cursor; + / − / reset buttons; zoom level exposed', () => {
    const m = mount({ nodes: PLACES, edges: ROUTES });
    const fit = m.view();
    const rect = m.stage.getBoundingClientRect();
    const under = clientToWorld(fit, rect, 80, 60);
    const wheel = m.stage.dispatch('wheel', { clientX: 80, clientY: 60, deltaY: -200, deltaMode: 0 });
    assert.ok(wheel.defaultPrevented, 'the page does not scroll');
    const zoomed = m.view();
    assert.ok(zoomed.w < fit.w, 'scrolling up zooms in');
    const still = clientToWorld(zoomed, rect, 80, 60);
    close(still.x, under.x, 'cursor point x', 1e-3); close(still.y, under.y, 'cursor point y', 1e-3);
    m.el.querySelector('.ss-w-map-reset').click();
    closeView(m.view(), fit, 'reset fits again');
    m.el.querySelector('.ss-w-map-zoom-in').click();
    close(m.view().w, fit.w / 1.25, 'zoom in button', 1e-3);
    assert.equal(m.stage.getAttribute('data-zoom'), '1.25');
    m.el.querySelector('.ss-w-map-zoom-out').click();
    m.el.querySelector('.ss-w-map-zoom-out').click();
    close(m.view().w, fit.w * 1.25, 'zoom out button', 1e-3);
    for (let i = 0; i < 20; i++) m.el.querySelector('.ss-w-map-zoom-out').click();
    close(m.view().w, fit.w / ZOOM_OUT_LIMIT, 'zoom out stops at the limit', 1e-3);
    for (let i = 0; i < 40; i++) m.stage.dispatch('wheel', { clientX: 200, clientY: 150, deltaY: -500, deltaMode: 0 });
    close(m.view().w, fit.w / ZOOM_IN_LIMIT, 'zoom in stops at the limit', 1e-3);
    for (const button of m.el.querySelectorAll('.ss-w-map-zoom button')) assert.ok(button.getAttribute('aria-label'));
});

test('map: pinch zooms about the fingers and pans with them', () => {
    const m = mount({ nodes: PLACES, edges: ROUTES });
    const fit = m.view();
    const rect = m.stage.getBoundingClientRect();
    const mid = clientToWorld(fit, rect, 200, 150);
    m.pointer('pointerdown', 1, 150, 150);
    m.pointer('pointerdown', 2, 250, 150);
    m.pointer('pointermove', 2, 350, 150);       // fingers 100px → 200px apart; midpoint 200 → 250
    const pinched = m.view();
    close(pinched.w, fit.w / 2, 'twice as close', 1e-3);
    const nowUnder = clientToWorld(pinched, rect, 250, 150);
    close(nowUnder.x, mid.x, 'the old midpoint follows the fingers', 1e-3);
    close(nowUnder.y, mid.y, '', 1e-3);
    m.pointer('pointerup', 2, 350, 150);
    m.pointer('pointerup', 1, 150, 150);
    m.node('pl_town').click();
    assert.equal(m.api.commands.length, 0, 'a pinch never selects');
});

test('map: keyboard pans with arrows, zooms with + and −, fits with 0', () => {
    const m = mount({ nodes: PLACES, edges: ROUTES });
    const fit = m.view();
    const key = name => m.stage.dispatch('keydown', { key: name });
    assert.ok(key('ArrowRight').defaultPrevented);
    close(m.view().x, fit.x + fit.w * 0.1);
    key('ArrowDown');
    close(m.view().y, fit.y + fit.h * 0.1);
    key('+');
    close(m.view().w, fit.w / 1.25, '', 1e-3);
    key('-');
    close(m.view().w, fit.w, '', 1e-3);
    key('0');
    closeView(m.view(), fit);
    assert.ok(!key('a').defaultPrevented, 'other keys pass through');
    assert.equal(m.stage.getAttribute('tabindex'), '0');
    assert.ok(m.stage.getAttribute('aria-label').includes('arrow keys'));
});

test('map: the minimap shows the world and the viewport box; clicking it centres the view', () => {
    const m = mount({ nodes: PLACES, edges: ROUTES, current: 'pl_weir' });
    const mini = m.el.querySelector('.ss-w-map-mini');
    const [wx, wy, ww, wh] = mini.getAttribute('viewBox').split(' ').map(Number);
    const world = { x: wx, y: wy, w: ww, h: wh };
    closeView(world, worldBounds(PLACES.filter(place => place.layer !== 'underground')), 'minimap shows the world');
    const box = () => ['x', 'y', 'width', 'height'].map(name => Number(m.el.querySelector('.ss-w-map-viewport').getAttribute(name)));
    const fitBox = minimapBox(m.view(), world);
    assert.deepEqual(box(), [fitBox.x, fitBox.y, fitBox.w, fitBox.h].map(v => Math.round(v * 10000) / 10000));
    m.el.querySelector('.ss-w-map-zoom-in').click();
    m.el.querySelector('.ss-w-map-zoom-in').click();
    const zoomBox = minimapBox(m.view(), world);
    assert.deepEqual(box(), [zoomBox.x, zoomBox.y, zoomBox.w, zoomBox.h].map(v => Math.round(v * 10000) / 10000), 'the box follows the view');
    assert.ok(box()[2] < fitBox.w);
    assert.equal(m.el.querySelectorAll('.ss-w-map-mini-node').length, 4);
    assert.equal(m.el.querySelectorAll('.ss-w-map-mini-node.ss-w-current').length, 1);
    mini.rect = { left: 0, top: 0, width: 160, height: 120 };
    const target = minimapToWorld(world, mini.getBoundingClientRect(), 120, 30);
    mini.dispatch('pointerdown', { pointerId: 9, clientX: 120, clientY: 30 });
    const view = m.view();
    close(view.x + view.w / 2, target.x, 'centre x', 1e-3);
    close(view.y + view.h / 2, target.y, 'centre y', 1e-3);
    m.handle.update({ nodes: PLACES, edges: ROUTES, minimap: false, legend: false });
    assert.equal(mini.style.getPropertyValue('display'), 'none');
    assert.ok(m.el.querySelector('.ss-w-map-side').hidden);
});

test('map: the layer switcher filters places and routes and refits; layerless places show on every layer', () => {
    const m = mount({ nodes: PLACES, edges: ROUTES, layers: [{ id: 'surface', name: 'Surface' }, { id: 'underground', name: 'Below' }] });
    const buttons = m.el.querySelectorAll('.ss-w-map-layer');
    assert.deepEqual(buttons.map(button => button.textContent), ['Surface', 'Below']);
    assert.deepEqual(buttons.map(button => button.getAttribute('aria-pressed')), ['true', 'false']);
    buttons[1].click();
    assert.deepEqual(m.names(), ['Glow Cave', 'Well Shaft']);
    assert.deepEqual(m.el.querySelectorAll('.ss-w-map-edge').map(line => line.getAttribute('data-kind')), ['tunnel']);
    closeView(m.view(), fitView(worldBounds([{ x: 100, y: 100 }, { x: 0, y: 50 }]), 4 / 3));
    assert.deepEqual(m.el.querySelectorAll('.ss-w-map-layer').map(button => button.getAttribute('aria-pressed')), ['false', 'true']);
    // Layers derived from the nodes when the prop is absent, starting on the current place's layer.
    const n = mount({ nodes: PLACES, edges: ROUTES, current: 'pl_cave' });
    assert.deepEqual(texts(n.el, '.ss-w-map-layer'), ['surface', 'underground']);
    assert.deepEqual(n.names(), ['Glow Cave', 'Well Shaft']);
    // The layer prop picks the first layer; a single layer hides the switcher.
    const o = mount({ nodes: PLACES, edges: ROUTES, layer: 'underground', current: 'pl_town' });
    assert.deepEqual(o.names(), ['Glow Cave', 'Well Shaft']);
    const p = mount({ nodes: PLACES.filter(place => place.layer !== 'underground'), edges: ROUTES });
    assert.ok(p.el.querySelector('.ss-w-map-layers').hidden);
});

test('map: undiscovered places are hidden, or shown nameless with fog "unknown"', () => {
    const m = mount({ nodes: PLACES, edges: ROUTES, discovered: ['pl_town'], current: 'pl_well', onSelect: 'scene.travel' });
    assert.deepEqual(m.names(), ['Bluewatch', 'Well Shaft'], 'the current place always counts as discovered');
    assert.deepEqual(m.el.querySelectorAll('.ss-w-map-edge').map(line => line.getAttribute('data-kind')), ['road']);
    const f = mount({ nodes: PLACES, edges: ROUTES, discovered: ['pl_town'], fog: 'unknown', onSelect: 'scene.travel' });
    assert.deepEqual(f.names(), ['Bluewatch']);
    const unknown = f.el.querySelectorAll('.ss-w-map-node.ss-w-unknown');
    assert.deepEqual(unknown.map(node => node.getAttribute('data-id')), ['pl_weir', 'pl_well']);
    for (const node of unknown) {
        assert.equal(node.textContent, '?');
        assert.equal(node.getAttribute('aria-label'), 'Unexplored place');
        assert.equal(node.getAttribute('data-kind'), null, 'the kind is not given away');
        assert.equal(node.localName, 'div');
        node.click();
    }
    assert.equal(f.api.commands.length, 0, 'an unexplored place cannot be selected');
    assert.equal(f.el.querySelectorAll('.ss-w-map-edge.ss-w-unknown').length, 2);
    assert.ok(texts(f.el, '.ss-w-map-legend-text').includes('Unexplored'));
});

test('map: the legend lists the kinds on show, the routes and "You are here"', () => {
    const m = mount({ nodes: PLACES, edges: ROUTES, current: 'pl_town', kinds: { town: { label: 'Town' }, wild: { icon: 'fa-tree' }, road: { label: 'Road' } } });
    assert.deepEqual(texts(m.el, '.ss-w-map-legend-text'), ['Town', 'wild', 'ruin', 'stairs', 'Road', 'trail', 'You are here']);
    assert.ok(m.el.querySelector('.ss-w-map-node-sample[data-kind="town"] i.fa-house'), 'icon taken from a node of that kind');
    assert.ok(m.el.querySelector('.ss-w-map-node-sample[data-kind="wild"] i.fa-tree'), 'icon from kinds');
    assert.ok(m.node('pl_weir').querySelector('i.fa-tree'), 'a node without an icon uses its kind icon');
    assert.ok(m.el.querySelector('.ss-w-map-edge-sample[data-kind="trail"]'));
});

test('map: update keeps the reader’s view unless the layer prop changes; reset still fits', () => {
    const m = mount({ nodes: PLACES, edges: ROUTES, current: 'pl_town' });
    m.el.querySelector('.ss-w-map-zoom-in').click();
    m.stage.dispatch('keydown', { key: 'ArrowRight' });
    const moved = m.view();
    m.handle.update({ nodes: PLACES, edges: ROUTES, current: 'pl_weir' });
    closeView(m.view(), moved, 'a state update does not jump the map');
    assert.equal(m.node('pl_weir').getAttribute('aria-current'), 'location');
    assert.equal(m.node('pl_town').getAttribute('aria-current'), null);
    m.handle.update({ nodes: PLACES, edges: ROUTES, current: 'pl_weir', layer: 'underground' });
    assert.deepEqual(m.names(), ['Glow Cave', 'Well Shaft']);
    m.handle.update({ nodes: [], edges: [] });
    assert.ok(!m.el.querySelector('.ss-w-empty-note').hidden);
    assert.ok(m.el.querySelector('.ss-w-map-body').hidden);
});

test('map: places without coordinates are laid out deterministically', () => {
    const nodes = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
    const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }];
    const one = mount({ nodes, edges });
    const first = one.el.querySelectorAll('.ss-w-map-edge').map(line => ['x1', 'y1', 'x2', 'y2'].map(name => line.getAttribute(name)));
    const two = mount({ nodes, edges });
    const second = two.el.querySelectorAll('.ss-w-map-edge').map(line => ['x1', 'y1', 'x2', 'y2'].map(name => line.getAttribute(name)));
    assert.deepEqual(first, second);
    assert.equal(first.length, 2);
    assert.ok(first.flat().every(value => Number.isFinite(Number(value))));
});

test('map: junk data is dropped (duplicate ids, unknown edge ends, self loops, bad coordinates)', () => {
    const m = mount({
        nodes: [{ id: 'a', name: 'A', x: 0, y: 0 }, { id: 'a', name: 'Again', x: 9, y: 9 }, { id: 'b', x: 'east', y: 3 }, null, { name: 'no id' }],
        edges: [{ from: 'a', to: 'zz' }, { from: 'a', to: 'a' }, { from: 'a', to: 'b', kind: 'road' }, 'x'],
    });
    assert.deepEqual(m.names(), ['A', 'b']);
    assert.equal(m.el.querySelectorAll('.ss-w-map-edge').length, 1);
});

test('map: the stage aspect is measured, and a resize observer keeps it in step', () => {
    const m = mount({ nodes: PLACES, edges: ROUTES }, { rect: null, observer: true });
    const first = m.view();
    close(first.w / first.h, 4 / 3, 'default aspect before layout');
    m.stage.rect = { left: 0, top: 0, width: 600, height: 300 };
    for (const observer of m.doc.observers) observer.fn([]);
    const wide = m.view();
    close(wide.w / wide.h, 2, 'aspect follows the stage');
    close(wide.w, first.w, 'same width and centre');
    m.handle.destroy();
    assert.ok(m.doc.observers.every(observer => !observer.connected));
});
