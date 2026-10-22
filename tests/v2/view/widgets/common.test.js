// The standard widget set as a whole: names, shape, props handling, safe URLs and icons, styles, the
// render → update → destroy lifecycle of every widget, and no innerHTML anywhere in the widget sources.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { faClasses, propProblems, resolveProps, safeImageUrl, standardWidgets, unfoldValue, widgetCss } from '../../../../src/v2/view/widgets/index.js';
import { iconNode, initials } from '../../../../src/v2/view/widgets/dom.js';
import { fakeApi, host, installDom } from './fake-dom.js';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCES = join(here, '../../../../src/v2/view/widgets');

// One realistic props object per widget.
export const SAMPLES = {
    'ss.meter': { value: 77, max: 82, label: 'HP', tone: 'good' },
    'ss.radar': { axes: [{ label: 'STR', value: 12, max: 20 }, { label: 'AGI', value: 8, max: 20 }, { label: 'INT', value: 15, max: 20 }], before: [10, 8, 15] },
    'ss.map': {
        nodes: [{ id: 'pl_a', name: 'Bluewatch', x: 0, y: 0, kind: 'town' }, { id: 'pl_b', name: 'Weir', x: 100, y: 50, kind: 'wild' }],
        edges: [{ from: 'pl_a', to: 'pl_b', kind: 'road' }],
        current: 'pl_a',
        onSelect: 'scene.travel',
    },
    'ss.skill-tree': { tiers: [{ title: 'Novice', skills: [{ id: 'sk_a', name: 'Slash', level: 2, active: true }] }, { title: 'Adept', skills: [{ id: 'sk_b', name: 'Cleave', locked: true, requires: ['sk_a'] }] }], onSelect: 'party.learnSkill' },
    'ss.portrait': { src: 'https://example.com/ren.png', name: 'Ren Avel', frame: 'hex' },
    'ss.badge': { icon: 'fa-skull-crossbones', label: 'Poisoned', counter: 3, unit: 'turns left', tone: 'bad' },
    'ss.timeline': { events: [{ time: 'Day 1', title: 'Arrived', text: 'At Bluewatch.' }, { time: 'Day 2', title: 'The weir' }], current: 1 },
    'ss.stepper': { name: 'STR', value: 5, min: 1, max: 10, budget: 3, label: 'Strength' },
    'ss.tile': { label: 'Moonlight Slash', icon: 'fa-wand-sparkles', count: '3', state: 'ready', tone: 'info' },
    'ss.bar': { label: 'HP', kind: 'hp', value: 50, max: 82 },
    'ss.status': { label: 'Bleeding', icon: 'fa-droplet', left: 40, unit: 'minutes', tone: 'bad' },
    'ss.pill': { text: 'Soul Class II · Lv 12', style: 'solid' },
    'ss.hero': { name: 'Astra', className: 'Soul Class II', level: '12', place: 'North Cut', bars: [{ kind: 'hp', label: 'HP', value: 50, max: 82 }], statuses: [{ label: 'Bleeding', icon: 'fa-droplet', left: 40, unit: 'minutes', tone: 'bad' }] },
    'ss.tiers': { tiers: [{ title: 'Basic', tiles: [{ id: 'moon', label: 'Moonlight Slash', icon: 'fa-wand-sparkles', count: '3' }] }, { title: 'Advanced', tiles: [{ id: 'death', label: 'Death Soul', state: 'locked' }] }], onSelect: 'party.pick' },
    'ss.listcard': { title: 'Ready to turn in', rows: [{ id: 'wolf', title: 'The North Cut Wolf', sub: 'to Elula', value: '4 silver', tag: 'new', tone: 'good' }], onSelect: 'quests.open' },
    'ss.tabs': { items: [{ id: 'world', label: 'World' }, { id: 'quests', label: 'Quests' }], current: 'world', onSelect: 'ui.go' },
    'ss.navbar': { items: [{ id: 'party', label: 'Party', icon: 'fa-users' }, { id: 'bag', label: 'Bag', icon: 'fa-bag-shopping', count: '2' }], current: 'party', onSelect: 'ui.go' },
    'ss.dialog': { title: 'Rest?', text: 'Eight hours.', actions: [{ id: 'rest', label: 'Rest', kind: 'primary' }], onSelect: 'ui.dialog' },
};

test('standardWidgets: the eighteen namespaced widgets, each { props, render, validate }', () => {
    assert.deepEqual(Object.keys(standardWidgets), ['ss.meter', 'ss.radar', 'ss.map', 'ss.skill-tree', 'ss.portrait', 'ss.badge', 'ss.timeline', 'ss.stepper', 'ss.tile', 'ss.bar', 'ss.status', 'ss.pill', 'ss.hero', 'ss.tiers', 'ss.listcard', 'ss.tabs', 'ss.navbar', 'ss.dialog']);
    for (const [name, widget] of Object.entries(standardWidgets)) {
        assert.equal(typeof widget.render, 'function', name);
        assert.equal(typeof widget.validate, 'function', name);
        for (const [prop, spec] of Object.entries(widget.props)) {
            assert.ok(spec.type, `${name}.${prop} has a type`);
            assert.ok(!('default' in spec) || spec.default === null || typeof spec.default !== 'object' || Object.isFrozen(spec.default), `${name}.${prop} default is shared, so frozen`);
        }
        assert.deepEqual(widget.validate(SAMPLES[name]), [], `${name} sample is valid`);
    }
});

test('validate: wrong types in plain words; required data may come through a binding, so it is not demanded', () => {
    assert.deepEqual(standardWidgets['ss.meter'].validate({}), []);
    assert.deepEqual(propProblems(standardWidgets['ss.meter'].props, {}), ['The "value" setting is missing.']);
    assert.deepEqual(standardWidgets['ss.meter'].validate({ value: 'full' }), ['The "value" setting should be a number.']);
    assert.deepEqual(standardWidgets['ss.map'].validate({ value: { nodes: 'x' } }), ['The "nodes" setting should be a list.'], 'a bound value is unfolded first');
    assert.deepEqual(standardWidgets['ss.map'].validate({ nodes: 'x', minimap: 3 }), [
        'The "nodes" setting should be a list.',
        'The "minimap" setting should be a boolean.',
    ]);
    assert.deepEqual(standardWidgets['ss.map'].validate({ nodes: [], kinds: [] }), ['The "kinds" setting should be an object.']);
    assert.deepEqual(standardWidgets['ss.timeline'].validate({ events: [], current: true }), ['The "current" setting should be a string or a number.']);
});

test('resolveProps: defaults, template strings coerced, wrong types fall back', () => {
    const schema = {
        n: { type: 'number', default: 1 }, s: { type: 'string', default: 'x' }, b: { type: 'boolean', default: false },
        a: { type: 'array', default: null }, o: { type: 'object' }, either: { type: ['number', 'string'], default: null },
    };
    assert.deepEqual(resolveProps(schema, undefined), { n: 1, s: 'x', b: false, a: null, o: null, either: null });
    assert.deepEqual(resolveProps(schema, { n: '77', s: 5, b: 'true', a: [1], o: { k: 1 }, either: '3' }), { n: 77, s: '5', b: true, a: [1], o: { k: 1 }, either: 3 });
    assert.deepEqual(resolveProps(schema, { n: 'lots', s: {}, b: 'yes', a: {}, o: [], either: 'id_1' }), { n: 1, s: 'x', b: false, a: null, o: null, either: 'id_1' });
    assert.deepEqual(resolveProps(schema, { n: NaN, s: null }), { n: 1, s: 'x', b: false, a: null, o: null, either: null });
    assert.equal(resolveProps(schema, { n: Infinity }).n, 1);
    assert.equal(resolveProps(schema, { n: '-2.5' }).n, -2.5);
    assert.deepEqual(propProblems(schema, [1, 2]), []);
});

test('a bound value (layout `bind` → props.value) is unfolded into the widget\'s props', () => {
    assert.deepEqual(unfoldValue({ value: { nodes: [1], current: 'a' }, current: 'b' }, standardWidgets['ss.map'].props, 'nodes'), { nodes: [1], current: 'b' });
    assert.deepEqual(unfoldValue({ value: [1, 2], label: 'x' }, standardWidgets['ss.radar'].props, 'axes'), { axes: [1, 2], label: 'x' });
    assert.deepEqual(unfoldValue({ value: [1], axes: [2] }, standardWidgets['ss.radar'].props, 'axes'), { value: [1], axes: [2] }, 'the given prop wins');
    assert.deepEqual(unfoldValue({ value: 7, max: 9 }, standardWidgets['ss.meter'].props, 'value'), { value: 7, max: 9 });
    assert.deepEqual(unfoldValue({ value: '/User Avatars/u.png' }, standardWidgets['ss.portrait'].props, 'src'), { src: '/User Avatars/u.png' });
    assert.equal(unfoldValue(null, {}, 'x'), null);
    const doc = installDom();
    const el = host(doc);
    standardWidgets['ss.meter'].render(el, { value: { cur: 30, max: 40 }, label: 'HP' });
    assert.equal(el.querySelector('.ss-w-meter').getAttribute('aria-valuetext'), '30 / 40', 'a bound pool fills value and max');
    const handle = standardWidgets['ss.timeline'].render(el, { value: [{ title: 'One' }] });
    assert.equal(el.querySelector('.ss-w-tl-title').textContent, 'One');
    handle.update({ value: [{ title: 'Two' }] });
    assert.equal(el.querySelector('.ss-w-tl-title').textContent, 'Two', 'updates unfold too');
});

test('safeImageUrl: data:image, https and same-origin root paths only', () => {
    for (const ok of [
        'https://example.com/a.png', 'data:image/png;base64,iVBORw0KGgo=', 'data:image/jpeg;base64,AAAA', 'data:image/webp;base64,UklGR', '/thumbnail?type=avatar&file=Ren.png', '/User Avatars/user.png',
    ]) assert.notEqual(safeImageUrl(ok), '', ok);
    for (const bad of [
        'javascript:alert(1)', ' JAVASCRIPT:alert(1)', 'vbscript:x', 'http://example.com/a.png', '//evil.example/a.png',
        '/\\evil.example/a.png', '/a\\b.png', 'data:text/html;base64,PHNjcmlwdD4=', 'data:image/png\u0000;base64,AA', 'data:image/svg+xml;utf8,%3Csvg%3E',
        'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png,rawbytes', 'data:image/png;base64,AA"><b',
        'blob:https://x/1', 'file:///etc/passwd', 'img/a.png', './a.png', '../a.png', 'https://user:pw@example.com/a.png',
        'https://exa mple.com/a.png', 'https:\n//example.com', '', null, 42, {},
    ]) assert.equal(safeImageUrl(bad), '', String(bad));
    assert.equal(safeImageUrl('  https://example.com/a b.png'), '');
});

test('icons: Font Awesome classes, safe images, short glyphs; nothing else', () => {
    assert.deepEqual(faClasses('fa-map'), ['fa-solid', 'fa-map']);
    assert.deepEqual(faClasses('fa-regular fa-map'), ['fa-regular', 'fa-map']);
    assert.deepEqual(faClasses('fas fa-map'), ['fas', 'fa-map']);
    for (const bad of ['fa-solid', 'map', 'fa-map evil', 'fa-map"><b', 'fa-map x-y', '', null]) assert.equal(faClasses(bad), null, String(bad));
    const doc = installDom();
    const fa = iconNode(doc, 'fa-dragon');
    assert.equal(fa.localName, 'i');
    assert.equal(fa.getAttribute('class'), 'ss-w-icon fa-solid fa-dragon');
    assert.equal(fa.getAttribute('aria-hidden'), 'true');
    const img = iconNode(doc, 'https://example.com/i.png');
    assert.equal(img.localName, 'img');
    assert.equal(img.getAttribute('src'), 'https://example.com/i.png');
    assert.equal(img.getAttribute('alt'), '');
    assert.equal(iconNode(doc, '🐟').textContent, '🐟');
    assert.equal(iconNode(doc, 'javascript:alert(1)'), null);
    assert.equal(iconNode(doc, 'http://example.com/i.png'), null);
    assert.equal(iconNode(doc, 'a much longer string'), null);
    assert.equal(iconNode(doc, ''), null);
});

test('initials: one or two letters, unicode-safe', () => {
    assert.equal(initials('Ren Avel'), 'RA');
    assert.equal(initials('astra'), 'A');
    assert.equal(initials('  Old  Man  Weir '), 'OW');
    assert.equal(initials('Élodie'), 'É');
    assert.equal(initials('𝔄lpha beta'), '𝔄B');
    assert.equal(initials(''), '?');
    assert.equal(initials(null), '?');
});

test('every widget renders, updates and destroys cleanly (sample, empty and junk props)', () => {
    for (const [name, widget] of Object.entries(standardWidgets)) {
        const doc = installDom({ resizeObserver: true });
        const el = host(doc);
        const api = fakeApi();
        const handle = widget.render(el, SAMPLES[name], api);
        assert.equal(typeof handle.update, 'function', name);
        assert.equal(typeof handle.destroy, 'function', name);
        assert.equal(el.children.length, 1, `${name} adds one root`);
        const root = el.children[0];
        assert.ok(root.classList.contains('ss-w'), name);
        assert.ok(root.classList.contains(`ss-w-${name.slice(3)}`), name);
        handle.update({});
        handle.update({ ...SAMPLES[name] });
        handle.update(null);
        handle.update({ value: 'NaN', axes: 'x', nodes: [null, 3, { id: '' }], tiers: [null, { skills: 'x' }], events: [1, null], src: 'javascript:alert(1)' });
        handle.update(SAMPLES[name]);
        assert.equal(el.children.length, 1, `${name} keeps one root through updates`);
        handle.destroy();
        assert.equal(el.children.length, 0, `${name} removes its root`);
        assert.equal(root.allListeners().length, 0, `${name} removes its listeners`);
        assert.ok(doc.observers.every(observer => !observer.connected), `${name} disconnects observers`);
        handle.update(SAMPLES[name]);
        handle.destroy();
        assert.equal(el.children.length, 0, `${name}: update and destroy after destroy do nothing`);
        assert.equal(api.commands.length, 0, `${name} runs no command by itself`);
        assert.equal(api.drafts.length, 0, `${name} changes no draft by itself`);
    }
});

test('every widget renders without an api and without a head element', () => {
    for (const [name, widget] of Object.entries(standardWidgets)) {
        const doc = installDom();
        delete doc.head;
        const el = host(doc);
        const handle = widget.render(el, SAMPLES[name]);
        el.querySelectorAll('button').forEach(button => button.click());
        handle.destroy();
        assert.equal(el.children.length, 0, name);
    }
});

test('styles: added once per document, every rule without specificity', () => {
    const doc = installDom();
    const el = host(doc);
    standardWidgets['ss.meter'].render(el, SAMPLES['ss.meter']);
    standardWidgets['ss.badge'].render(el, SAMPLES['ss.badge']);
    const styles = doc.head.querySelectorAll('style[data-ss-widgets]');
    assert.equal(styles.length, 1);
    assert.equal(styles[0].textContent, widgetCss);
    const selectors = widgetCss.replace(/\/\*[^]*?\*\//g, '').match(/[^{}]+(?=\{)/g).map(text => text.trim()).filter(Boolean);
    for (const selector of selectors) assert.match(selector, /^:where\(/, selector);
    assert.doesNotMatch(widgetCss, /position:\s*fixed|@import|url\(/);
});

test('no innerHTML / outerHTML / insertAdjacentHTML / document.write / eval in the widget sources', () => {
    const files = readdirSync(SOURCES).filter(file => file.endsWith('.js'));
    assert.ok(files.length >= 10);
    for (const file of files) {
        const source = readFileSync(join(SOURCES, file), 'utf8');
        assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|Math\.random|Date\.now/, file);
        assert.doesNotMatch(source, /\.on[a-z]+\s*=(?!=)/, `${file} assigns no on* handler`);
        assert.doesNotMatch(source, /setAttribute\(\s*['"]on/i, `${file} sets no on* attribute`);
    }
});

test('data never becomes a class name: tones and kinds go through allow-lists and data-* attributes', () => {
    const doc = installDom();
    const el = host(doc);
    standardWidgets['ss.meter'].render(el, { value: 1, tone: 'good x" onclick="y' });
    standardWidgets['ss.badge'].render(el, { label: 'x', kind: 'evil class', tone: 'ss-w-map' });
    const all = el.descendants();
    for (const node of all) {
        for (const name of (node.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)) {
            assert.match(name, /^(?:ss-w(?:-[a-z0-9-]+)?|fa-[a-z0-9-]+|fa[srlbdt]?)$/, name);
        }
    }
    assert.ok(el.querySelector('.ss-w-meter').classList.contains('ss-w-tone-neutral'));
    assert.equal(el.querySelector('.ss-w-badge').getAttribute('data-kind'), 'evil class');
});
