// view/scroll.js (phone hotfix): scrolling and focus inside the settings window move nothing around the page scroller.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BOTTOM_SLACK, atBottom, bottomSlack, followViewport, focusNode, gapBelow, holdPage, keepAtBottom, revealIn, scrollToBottom, scrollerOf, showAndFocus, zoomOf } from '../../../src/v2/view/scroll.js';

// A scroller with a box and a scrollTop that clamps like a browser's; ancestors that must never move.
function scene({ nodeTop = 500, nodeHeight = 40, scrollTop = 0, sticky = 0 } = {}) {
    const ancestors = { layer: { scrollTop: 0, scrollLeft: 0 }, window: { scrollTop: 0, scrollLeft: 0 } };
    const doc = { defaultView: { getComputedStyle: node => ({ position: node.sticky ? 'sticky' : 'static' }) } };
    const head = { sticky: sticky > 0, hidden: false, getBoundingClientRect: () => ({ top: 100, bottom: 100 + sticky, height: sticky }) };
    let top = scrollTop;
    const scroller = {
        ownerDocument: doc,
        get scrollTop() { return top; },
        set scrollTop(value) { top = Math.max(0, Math.min(2000, value)); },
        getBoundingClientRect: () => ({ top: 100, bottom: 700, height: 600 }),
        querySelector: selector => (selector.includes('ss-settings-page-head') ? head : null),
    };
    // The node's top moves with the scroller's scrollTop, like a real layout's.
    const node = {
        getBoundingClientRect: () => ({ top: nodeTop - top, bottom: nodeTop - top + nodeHeight, height: nodeHeight }),
        closest: selector => (selector === '.ss-settings-content' ? scroller : null),
    };
    return { scroller, node, ancestors };
}

test('revealIn("start") sets the scroller\'s scrollTop only, putting the node a little under the top', () => {
    const { scroller, node, ancestors } = scene({ nodeTop: 500 });
    assert.equal(revealIn(scroller, node, 'start'), true);
    assert.equal(node.getBoundingClientRect().top, 100 + 8);
    assert.deepEqual(ancestors, { layer: { scrollTop: 0, scrollLeft: 0 }, window: { scrollTop: 0, scrollLeft: 0 } });
});

test('revealIn leaves room for the sticky heading strip, and finds the scroller from the node when none is given', () => {
    const { scroller, node } = scene({ nodeTop: 500, sticky: 80 });
    assert.equal(revealIn(null, node, 'start'), true);
    assert.equal(node.getBoundingClientRect().top, 100 + 80 + 8);
    assert.equal(scrollerOf(node), scroller);
    assert.equal(scrollerOf({ closest: () => null }), null);
});

test('revealIn "center" and "nearest"', () => {
    const a = scene({ nodeTop: 600, nodeHeight: 40 });
    revealIn(a.scroller, a.node, 'center');
    assert.equal(Math.round(a.node.getBoundingClientRect().top + 20), 100 + 300);
    const seen = scene({ nodeTop: 300, nodeHeight: 40 });
    assert.equal(revealIn(seen.scroller, seen.node, 'nearest'), false, 'already in view: nothing moves');
    assert.equal(seen.scroller.scrollTop, 0);
    const below = scene({ nodeTop: 690, nodeHeight: 40 });
    assert.equal(revealIn(below.scroller, below.node, 'nearest'), true);
    assert.ok(below.node.getBoundingClientRect().bottom <= 700);
});

test('zoomOf: the browser\'s currentCSSZoom, else drawn width over own width, else 1', () => {
    assert.equal(zoomOf({ currentCSSZoom: 0.8, offsetWidth: 100, getBoundingClientRect: () => ({ width: 50 }) }), 0.8);
    assert.equal(zoomOf({ offsetWidth: 500, getBoundingClientRect: () => ({ width: 400 }) }), 0.8);
    assert.equal(zoomOf({ offsetWidth: 0, getBoundingClientRect: () => ({ width: 0 }) }), 1, 'no layout');
    assert.equal(zoomOf({ currentCSSZoom: 0 }), 1);
    assert.equal(zoomOf({}), 1);
    assert.equal(zoomOf(null), 1);
});

test('revealIn in a zoomed window (size.css): the measured distance is drawn pixels, scrollTop the scroller\'s own, so it lands as at 100%', () => {
    // At 80% a node 400 drawn pixels below the scroller's top is 500 of its own; scrolling by 400 would leave it 80 drawn pixels short.
    const { scroller, node } = scene({ nodeTop: 500 });
    let top = 0;
    Object.defineProperty(scroller, 'scrollTop', { get: () => top, set: value => { top = Math.max(0, Math.min(2000, value)); } });
    scroller.currentCSSZoom = 0.8;
    node.getBoundingClientRect = () => ({ top: 100 + (400 - top * 0.8), bottom: 100 + (400 - top * 0.8) + 32, height: 32 });
    assert.equal(revealIn(scroller, node, 'start'), true);
    assert.ok(Math.abs(node.getBoundingClientRect().top - (100 + 8)) < 1e-9, `top ${node.getBoundingClientRect().top}`);
});

test('revealIn does nothing, and does not throw, with no layout or no node (the tests\' fake DOM)', () => {
    assert.equal(revealIn(null, null), false);
    assert.equal(revealIn({}, {}), false);
    assert.equal(revealIn({ getBoundingClientRect: () => ({ top: 0, height: 0 }), scrollTop: 0 }, { getBoundingClientRect: () => ({ top: 5, bottom: 9, height: 4 }) }), false);
    assert.equal(showAndFocus(null), false);
});

test('focusNode focuses without scrolling the page; a browser that rejects the option still focuses', () => {
    const calls = [];
    assert.equal(focusNode({ focus: options => calls.push(options) }), true);
    assert.deepEqual(calls, [{ preventScroll: true }]);
    let plain = 0;
    assert.equal(focusNode({ focus(options) { if (options) throw new TypeError('no options'); plain += 1; } }), true);
    assert.equal(plain, 1);
    assert.equal(focusNode(null), false);
    assert.equal(focusNode({}), true);
});

test('showAndFocus reveals in the page scroller and focuses with preventScroll', () => {
    const { node, scroller } = scene({ nodeTop: 450 });
    const calls = [];
    node.focus = options => calls.push(options);
    assert.equal(showAndFocus(node, 'start'), true);
    assert.deepEqual(calls, [{ preventScroll: true }]);
    assert.ok(scroller.scrollTop > 0);
});

test('holdPage puts the document back where it was when something scrolls it, stops overscroll chaining, and lets go', () => {
    const listeners = [];
    const root = { scrollTop: 30, scrollLeft: 0 };
    const doc = { scrollingElement: root, documentElement: { style: { overscrollBehavior: 'auto' } }, addEventListener: (type, fn) => listeners.push([type, fn]), removeEventListener: (type, fn) => { const at = listeners.findIndex(item => item[0] === type && item[1] === fn); if (at >= 0) listeners.splice(at, 1); } };
    const release = holdPage(doc);
    assert.equal(doc.documentElement.style.overscrollBehavior, 'none');
    root.scrollTop = 160;
    for (const [, fn] of listeners) fn();
    assert.equal(root.scrollTop, 30);
    release();
    assert.equal(doc.documentElement.style.overscrollBehavior, 'auto');
    assert.equal(listeners.length, 0);
    assert.equal(typeof holdPage({})(), 'undefined', 'no document to hold: nothing to do');
});

test('followViewport: the layer takes the visual viewport\'s top and height on a phone (the keyboard, a pan) and clears when it is back', () => {
    const handlers = {};
    const vv = { offsetTop: 0, height: 800, addEventListener: (type, fn) => { handlers[type] = fn; }, removeEventListener: type => { delete handlers[type]; } };
    const view = { visualViewport: vv, innerHeight: 800, matchMedia: () => ({ matches: true }) };
    const layer = { style: { top: '', height: '' } };
    const stop = followViewport({ defaultView: view }, layer);
    assert.deepEqual(layer.style, { top: '', height: '' }, 'visible area is the screen: nothing set');
    vv.height = 480;
    handlers.resize();
    assert.deepEqual(layer.style, { top: '0px', height: '480px' }, 'the keyboard is up');
    vv.offsetTop = 120;
    handlers.scroll();
    assert.deepEqual(layer.style, { top: '120px', height: '480px' }, 'the browser panned the visual viewport');
    vv.offsetTop = 0;
    vv.height = 800;
    handlers.resize();
    assert.deepEqual(layer.style, { top: '', height: '' });
    vv.height = 400;
    handlers.resize();
    stop();
    assert.deepEqual(layer.style, { top: '', height: '' }, 'stopped: the layer is as the style sheet has it');
    assert.deepEqual(Object.keys(handlers), []);
});

test('followViewport leaves a wide screen and a browser with no visual viewport alone', () => {
    const vv = { offsetTop: 90, height: 300, addEventListener() {}, removeEventListener() {} };
    const layer = { style: { top: '', height: '' } };
    followViewport({ defaultView: { visualViewport: vv, innerHeight: 900, matchMedia: () => ({ matches: false }) } }, layer);
    assert.deepEqual(layer.style, { top: '', height: '' });
    assert.equal(typeof followViewport({ defaultView: {} }, layer), 'function');
    assert.equal(typeof followViewport(null, null), 'function');
});

// A list that grows at its end: scrollTop clamps like a browser's.
function list({ height = 400, content = 1000, top = null } = {}) {
    const box = { clientHeight: height, scrollHeight: content, scrollTop: 0 };
    let at = top ?? content - height;
    Object.defineProperty(box, 'scrollTop', { get: () => at, set: value => { at = Math.max(0, Math.min(box.scrollHeight - box.clientHeight, value)); } });
    return box;
}

test('gapBelow, atBottom and scrollToBottom: the space under what is shown, within half a screen, and a jump to the end', () => {
    const box = list({ top: 600 });
    assert.equal(gapBelow(box), 0);
    assert.equal(atBottom(box), true);
    assert.equal(bottomSlack(box), 200, 'half of the 400 shown');
    assert.equal(bottomSlack({ clientHeight: 2000 }), BOTTOM_SLACK, 'never more than 400');
    box.scrollTop = 600 - 200;
    assert.equal(atBottom(box), true, 'content added after the last scroll still counts');
    box.scrollTop = 600 - 201;
    assert.equal(atBottom(box), false, 'more than half a screen up is scrolled up');
    assert.equal(atBottom(box, 300), true, 'the slack can be given');
    assert.equal(scrollToBottom(box), true);
    assert.equal(box.scrollTop, 600);
    assert.equal(scrollToBottom(box), false, 'already there: nothing moved');
    // no layout (the fake DOM, a hidden chat): never "at the bottom", nothing moves, nothing throws
    for (const none of [null, {}, { scrollHeight: 0, scrollTop: 0, clientHeight: 0 }]) {
        assert.equal(gapBelow(none), null);
        assert.equal(atBottom(none), false);
        assert.equal(scrollToBottom(none), false);
        assert.equal(keepAtBottom(none).settle(), false);
    }
});

test('keepAtBottom: a list that was at the bottom is taken there again after it grew; one that was scrolled up never moves', () => {
    const atEnd = list({ top: 600 });
    const watch = keepAtBottom(atEnd);
    assert.equal(watch.wasAtBottom, true);
    atEnd.scrollHeight += 300;
    assert.equal(watch.settle(), true);
    assert.equal(atEnd.scrollTop, 900);
    const up = list({ top: 100 });   // 500 from the bottom
    const away = keepAtBottom(up);
    assert.equal(away.wasAtBottom, false);
    up.scrollHeight += 300;
    assert.equal(away.settle(), false);
    assert.equal(up.scrollTop, 100);
});
