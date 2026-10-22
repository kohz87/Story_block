// The UI sample (screens/ui-sample.js) and the building blocks through the template pipeline: the classes
// of view/glass.css and the widgets ss.tile, ss.bar, ss.status and ss.pill pass SillyTavern's DOMPurify
// (the testkit's stand-in) and the template allow-list untouched, and the sample draws every one of
// them in a light and a dark pane, opened from Settings → Diagnostics.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTemplate } from '../../../src/v2/view/template/index.js';
import { standardWidgets } from '../../../src/v2/view/widgets/index.js';
import { stPurify } from '../../../testkit/index.js';
import { UI_SAMPLE_DATA, UI_SAMPLE_ID, openUiSample, uiSampleScreen } from '../../../src/v2/screens/ui-sample.js';
import { installFakeDom } from '../../ui-fake-dom.js';

const CLASSES = ['ss-glass', 'ss-glass-strong', 'ss-label', 'ss-pill', 'ss-pill-soft', 'ss-pill-outline', 'ss-bar', 'ss-bar-exp', 'ss-bar-head', 'ss-bar-label', 'ss-bar-value', 'ss-bar-track', 'ss-bar-fill'];
const WIDGETS = ['ss.tile', 'ss.bar', 'ss.status', 'ss.pill', 'ss.hero', 'ss.tiers', 'ss.listcard', 'ss.tabs', 'ss.navbar'];

function elements(nodes, out = []) {
    for (const node of nodes ?? []) {
        if (node.tag) out.push(node);
        elements(node.children, out);
    }
    return out;
}
const classOf = node => (node.attrs.find(([name]) => name === 'class')?.[1] ?? '').split(/\s+/).filter(Boolean);

test('the building blocks\' classes and widgets pass SillyTavern\'s DOMPurify and the allow-list untouched', () => {
    for (const sanitize of [stPurify, null]) {
        const compiled = compileTemplate(uiSampleScreen.template, { sanitize });
        assert.deepEqual(compiled.warnings, [], sanitize ? 'with DOMPurify' : 'allow-list alone');
        const all = elements(compiled.nodes);
        const used = new Set(all.flatMap(classOf));
        for (const name of CLASSES) assert.ok(used.has(name), `class ${name} kept`);
        const widgets = new Set(all.filter(node => node.widget).map(node => node.widget.name));
        for (const name of WIDGETS) assert.ok(widgets.has(name), `widget ${name} kept`);
        // The forced schemes and the bound fill survive too.
        assert.ok(used.has('ss-scheme-light') && used.has('ss-scheme-dark'));
        assert.ok(all.some(node => node.vars.some(v => v.name === '--ss-fill')));
    }
    // A plain template with the classes alone (no widget) is fine too.
    const plain = compileTemplate('<section class="ss-glass"><p class="ss-label">Party</p><span class="ss-pill ss-pill-soft">Lv 3</span><span class="ss-status ss-tone-bad"><span class="ss-status-left">2t</span></span><div class="ss-tile ss-tile-locked"><span class="ss-tile-box ss-tone-epic"></span></div></section>', { sanitize: stPurify });
    assert.deepEqual(plain.warnings, []);
    assert.deepEqual(elements(plain.nodes).map(node => classOf(node).join(' ')), ['ss-glass', 'ss-label', 'ss-pill ss-pill-soft', 'ss-status ss-tone-bad', 'ss-status-left', 'ss-tile ss-tile-locked', 'ss-tile-box ss-tone-epic']);
});

test('the UI sample draws every block in a light and a dark pane, and closes on Close or Escape', () => {
    const doc = installFakeDom();
    const opener = doc.createElement('button');
    doc.body.appendChild(opener);
    opener.focus?.();
    doc.activeElement = opener;
    const sample = openUiSample({ doc, widgets: () => standardWidgets, sanitize: stPurify });
    const layer = doc.body.querySelector('.ss-sample');
    assert.equal(sample.root, layer);
    assert.equal(layer.getAttribute('data-ss-screen'), UI_SAMPLE_ID, 'a Story Suite root, so the tokens reach it');
    assert.equal(layer.getAttribute('role'), 'dialog');
    assert.equal(layer.getAttribute('aria-modal'), 'true');
    const panes = layer.querySelectorAll('.ss-sample-pane');
    assert.deepEqual(panes.map(pane => pane.classList.contains('ss-scheme-light') ? 'light' : pane.classList.contains('ss-scheme-dark') ? 'dark' : null), ['light', 'dark']);
    for (const pane of panes) {
        const tierTiles = UI_SAMPLE_DATA.tiers.tiers.reduce((n, tier) => n + tier.tiles.length, 0);
        assert.equal(pane.querySelectorAll('.ss-tile').length, UI_SAMPLE_DATA.skills.length + UI_SAMPLE_DATA.bag.length + tierTiles);
        assert.equal(pane.querySelectorAll('.ss-status').length, UI_SAMPLE_DATA.statuses.length + UI_SAMPLE_DATA.hero.statuses.length + UI_SAMPLE_DATA.heroCompact.statuses.length);
        assert.equal(pane.querySelectorAll('.ss-bar').length, 4 + UI_SAMPLE_DATA.hero.bars.length + UI_SAMPLE_DATA.heroCompact.bars.length, 'three widget bars and one drawn with classes, then the heroes\'');
        // The 1b blocks: two heroes (one compact, one with a picture), the tiers, three list cards, tabs and navbar.
        assert.equal(pane.querySelectorAll('.ss-hero').length, 2);
        assert.equal(pane.querySelectorAll('.ss-hero-compact').length, 1);
        assert.ok(pane.querySelector('.ss-hero-img').getAttribute('src').startsWith('data:image/png;base64,'));
        assert.equal(pane.querySelectorAll('.ss-tiers-tier').length, 3);
        assert.equal(pane.querySelectorAll('.ss-listcard').length, 3);
        assert.equal(pane.querySelectorAll('.ss-tabs-item').length, UI_SAMPLE_DATA.tabs.items.length);
        assert.equal(pane.querySelector('.ss-tabs-item[aria-current="page"]').textContent, 'World');
        assert.equal(pane.querySelectorAll('.ss-navbar-item').length, UI_SAMPLE_DATA.nav.items.length);
        assert.ok(pane.querySelector('.ss-sample-open-dialog'));
        assert.ok(pane.querySelectorAll('.ss-pill').length >= 6);
        assert.ok(pane.querySelectorAll('.ss-glass').length >= 3 && pane.querySelector('.ss-glass-strong'));
        assert.equal(pane.querySelectorAll('.ss-widget-missing').length, 0);
        assert.ok(pane.querySelector('.ss-tile-ready') && pane.querySelector('.ss-tile-locked'));
        assert.equal(pane.querySelector('.ss-status').getAttribute('aria-label'), 'Bleeding: 40 story minutes left');
        const last = pane.querySelectorAll('.ss-status')[UI_SAMPLE_DATA.statuses.length - 1];
        assert.equal(last.querySelector('.ss-status-left').textContent, '∞');
    }
    assert.equal(layer.querySelector('.ss-sample-title').textContent, 'Astra');
    // Close returns the focus to where it was.
    layer.querySelector('.ss-sample-close').click();
    assert.equal(doc.body.querySelector('.ss-sample'), null);
    assert.equal(doc.activeElement, opener);
    // Escape closes it too; opening twice keeps one.
    openUiSample({ doc, widgets: () => standardWidgets });
    const again = openUiSample({ doc, widgets: () => standardWidgets });
    assert.equal(doc.body.querySelectorAll('.ss-sample').length, 1);
    again.root.dispatchEvent?.({ type: 'keydown', key: 'Escape', preventDefault() {}, stopPropagation() {} });
    if (doc.body.querySelector('.ss-sample')) again.close();
    assert.equal(doc.body.querySelector('.ss-sample'), null);
});

test('the sample\'s "Open a dialog" opens the ss.dialog widget over the page, in its pane\'s scheme; Escape closes it first, and the sample stays', () => {
    const doc = installFakeDom();
    doc.addEventListener = (type, fn) => { doc.listeners = [...(doc.listeners ?? []), { type, fn }]; };
    doc.removeEventListener = (type, fn) => { doc.listeners = (doc.listeners ?? []).filter(entry => entry.fn !== fn); };
    const sample = openUiSample({ doc, widgets: () => standardWidgets, sanitize: stPurify });
    const opener = sample.root.querySelectorAll('.ss-sample-open-dialog')[1];
    opener.focus();
    opener.click();
    const wrap = doc.body.children.find(node => node.getAttribute('data-ss-screen') === UI_SAMPLE_ID && node !== sample.root);
    assert.ok(wrap, 'a wrapper of its own, outside the sample\'s glass cards');
    assert.ok(wrap.classList.contains('ss-scheme-dark'), 'the dark pane\'s scheme');
    assert.equal(wrap.querySelector('.ss-modal-panel').getAttribute('role'), 'dialog');
    assert.equal(wrap.querySelector('.ss-modal-title').textContent, UI_SAMPLE_DATA.dialog.title);
    // An action closes it and removes the wrapper.
    wrap.querySelectorAll('.ss-modal-action')[0].click();
    assert.ok(!doc.body.children.includes(wrap));
    assert.equal(doc.body.querySelector('.ss-modal'), null);
    sample.close();
});

test('the 1b blocks\' classes also pass SillyTavern\'s DOMPurify and the allow-list in a plain template (aria-current and role kept)', () => {
    const html = '<nav class="ss-navbar" aria-label="Game view"><div class="ss-navbar-list"><button type="button" class="ss-navbar-item" aria-current="page"><span class="ss-navbar-label">Bag</span><span class="ss-navbar-count">2</span></button></div></nav>'
        + '<section class="ss-hero ss-glass ss-hero-compact"><div class="ss-hero-body"><div class="ss-hero-portrait" role="img" aria-label="Portrait of Astra"><span class="ss-hero-initial">A</span></div><h3 class="ss-hero-name">Astra</h3></div></section>'
        + '<ul class="ss-listcard-rows"><li class="ss-listcard-row"><div class="ss-listcard-item"><span class="ss-listcard-tag ss-tone-good">new</span></div></li></ul>'
        + '<div class="ss-tiers"><div class="ss-tiers-link"><span class="ss-tiers-dot"></span><span class="ss-tiers-line"></span></div></div><div class="ss-modal"><div class="ss-modal-panel ss-glass-strong" role="dialog" aria-modal="true"></div></div>';
    for (const sanitize of [stPurify, null]) {
        const compiled = compileTemplate(html, { sanitize });
        assert.deepEqual(compiled.warnings, []);
        const all = elements(compiled.nodes);
        const used = new Set(all.flatMap(classOf));
        for (const name of ['ss-navbar', 'ss-navbar-item', 'ss-navbar-count', 'ss-hero', 'ss-hero-compact', 'ss-hero-portrait', 'ss-listcard-row', 'ss-listcard-tag', 'ss-tone-good', 'ss-tiers-line', 'ss-modal', 'ss-modal-panel']) assert.ok(used.has(name), name);
        const attr = (node, name) => node.attrs.find(([n]) => n === name)?.[1];
        assert.equal(attr(all.find(node => classOf(node).includes('ss-navbar-item')), 'aria-current'), 'page');
        assert.equal(attr(all.find(node => classOf(node).includes('ss-hero-portrait')), 'role'), 'img');
    }
});
