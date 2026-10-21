// ss.meter, ss.radar, ss.skill-tree, ss.portrait, ss.badge, ss.timeline: what each draws, how it updates,
// its accessibility attributes, and its commands.
import test from 'node:test';
import assert from 'node:assert/strict';
import { badge, counterText } from '../../../../src/v2/view/widgets/badge.js';
import { meter, meterCells, meterRatio } from '../../../../src/v2/view/widgets/meter.js';
import { portrait } from '../../../../src/v2/view/widgets/portrait.js';
import { radar, radarAxes, radarPoint, radarPoints } from '../../../../src/v2/view/widgets/radar.js';
import { columnCentre, skillTree, treeLinks, treeTiers } from '../../../../src/v2/view/widgets/skill-tree.js';
import { currentIndex, timeline, timelineEvents } from '../../../../src/v2/view/widgets/timeline.js';
import { fakeApi, host, installDom, texts } from './fake-dom.js';

function mount(widget, props, api = fakeApi()) {
    const doc = installDom();
    const el = host(doc);
    const handle = widget.render(el, props, api);
    return { doc, el, api, handle, root: el.children[0] };
}

test('meter: ratio, value text, ARIA meter attributes, tone and the fill property', () => {
    assert.equal(meterRatio(77, 0, 82), 77 / 82);
    assert.equal(meterRatio(120, 0, 100), 1);
    assert.equal(meterRatio(-5, 0, 100), 0);
    assert.equal(meterRatio(5, 10, 10), 0);
    const m = mount(meter, { value: 77, max: 82, label: 'HP', tone: 'good', icon: 'fa-heart' });
    assert.equal(m.root.getAttribute('role'), 'meter');
    assert.equal(m.root.getAttribute('aria-label'), 'HP');
    assert.equal(m.root.getAttribute('aria-valuenow'), '77');
    assert.equal(m.root.getAttribute('aria-valuemin'), '0');
    assert.equal(m.root.getAttribute('aria-valuemax'), '82');
    assert.equal(m.root.getAttribute('aria-valuetext'), '77 / 82');
    assert.equal(m.el.querySelector('.ss-w-meter-label').textContent, 'HP');
    assert.equal(m.el.querySelector('.ss-w-meter-value').textContent, '77 / 82');
    assert.equal(m.el.querySelector('.ss-w-meter-track').style.getPropertyValue('--ss-w-ratio'), '0.939');
    assert.ok(m.root.classList.contains('ss-w-tone-good'));
    assert.ok(m.el.querySelector('i.fa-heart'));
    m.handle.update({ value: '90', max: '82', tone: 'bad', text: 'Full!', showValue: 'false' });
    assert.equal(m.root.getAttribute('aria-valuenow'), '82', 'clamped for ARIA');
    assert.equal(m.root.getAttribute('aria-valuetext'), 'Full!');
    assert.ok(m.el.querySelector('.ss-w-meter-value').hidden);
    assert.ok(m.root.classList.contains('ss-w-full'));
    assert.ok(m.root.classList.contains('ss-w-tone-bad') && !m.root.classList.contains('ss-w-tone-good'));
    assert.equal(m.root.getAttribute('aria-label'), null);
    assert.ok(m.el.querySelector('.ss-w-meter-icon').hidden);
});

test('meter: segments mark full and partly full cells', () => {
    assert.deepEqual(meterCells(0.5, 4), { full: 2, part: false });
    assert.deepEqual(meterCells(0.6, 4), { full: 2, part: true });
    assert.deepEqual(meterCells(1, 4), { full: 4, part: false });
    assert.deepEqual(meterCells(0.3, 10), { full: 3, part: false }, 'no float dust');
    const m = mount(meter, { value: 3, max: 5, segments: 5, label: 'Charges' });
    assert.ok(m.root.classList.contains('ss-w-segmented'));
    const cells = m.el.querySelectorAll('.ss-w-meter-cell');
    assert.equal(cells.length, 5);
    assert.deepEqual(cells.map(cell => cell.classList.contains('ss-w-on')), [true, true, true, false, false]);
    m.handle.update({ value: 2.5, max: 5, segments: 5 });
    assert.deepEqual(m.el.querySelectorAll('.ss-w-meter-cell').map(cell => cell.getAttribute('class')), [
        'ss-w-meter-cell ss-w-on', 'ss-w-meter-cell ss-w-on', 'ss-w-meter-cell ss-w-part', 'ss-w-meter-cell', 'ss-w-meter-cell',
    ]);
    m.handle.update({ value: 1, segments: 100000 });
    assert.equal(m.el.querySelectorAll('.ss-w-meter-cell').length, 64, 'capped');
    m.handle.update({ value: 1 });
    assert.equal(m.el.querySelectorAll('.ss-w-meter-cell').length, 0);
});

test('radar: axes cleaned, points on a clockwise polygon from the top', () => {
    assert.deepEqual(radarPoint(0, 4, 1), { x: 0, y: -100 });
    assert.deepEqual(radarPoint(1, 4, 1), { x: 100, y: 0 });
    assert.deepEqual(radarPoint(2, 4, 0.5), { x: 0, y: 50 });
    assert.deepEqual(radarPoint(3, 4, 2), { x: -100, y: 0 }, 'ratios clamp to 1');
    assert.equal(radarPoints([1, 1, 1, 1]), '0,-100 100,0 0,100 -100,0');
    assert.deepEqual(radarAxes([{ label: 'STR', value: 12 }, { name: 'AGI', value: 30, max: 40 }, 5], [10]), [
        { label: 'STR', value: 12, max: 30, before: 10 },
        { label: 'AGI', value: 30, max: 40, before: null },
        { label: '', value: 5, max: 30, before: null },
    ]);
    assert.deepEqual(radarAxes([{ label: 'A', value: 3, before: 1 }], null, 10), [{ label: 'A', value: 3, max: 10, before: 1 }]);
    assert.equal(radarAxes(Array.from({ length: 40 }, () => ({ value: 1 }))).length, 24);
});

test('radar: draws rings, spokes, the series, a dashed "before", labels, and a list for screen readers', () => {
    const m = mount(radar, { label: 'Stats', axes: [{ label: 'STR', value: 10, max: 20 }, { label: 'AGI', value: 20, max: 20 }, { label: 'INT', value: 5, max: 20 }, { label: 'LUK', value: 0, max: 20 }], before: [8, 20, 6, 0], levels: 2 });
    const svg = m.el.querySelector('.ss-w-radar-svg');
    assert.equal(svg.namespaceURI, 'http://www.w3.org/2000/svg');
    assert.equal(svg.getAttribute('aria-hidden'), 'true');
    assert.equal(m.el.querySelectorAll('.ss-w-radar-ring').length, 2);
    assert.equal(m.el.querySelectorAll('.ss-w-radar-spoke').length, 4);
    assert.equal(m.el.querySelector('.ss-w-radar-area').getAttribute('points'), '0,-50 100,0 0,25 0,0');
    assert.equal(m.el.querySelector('.ss-w-radar-before').getAttribute('points'), '0,-40 100,0 0,30 0,0');
    assert.deepEqual(m.el.querySelectorAll('.ss-w-radar-dot').map(dot => dot.getAttribute('class')), [
        'ss-w-radar-dot ss-w-up', 'ss-w-radar-dot', 'ss-w-radar-dot ss-w-down', 'ss-w-radar-dot',
    ]);
    const labels = m.el.querySelectorAll('.ss-w-radar-label');
    assert.deepEqual(labels.map(label => label.textContent), ['STR10', 'AGI20', 'INT5', 'LUK0']);
    assert.deepEqual(labels.map(label => label.getAttribute('text-anchor')), ['middle', 'start', 'middle', 'end']);
    assert.deepEqual(texts(m.el, '.ss-w-sr li'), ['STR: 10 of 20 (was 8)', 'AGI: 20 of 20', 'INT: 5 of 20 (was 6)', 'LUK: 0 of 20']);
    assert.equal(m.el.querySelector('figcaption').textContent, 'Stats');
    m.handle.update({ axes: [{ label: 'A', value: 1 }, { label: 'B', value: 2 }, { label: 'C', value: 3 }], showValues: false });
    assert.equal(m.el.querySelector('.ss-w-radar-before'), null);
    assert.deepEqual(texts(m.el, '.ss-w-radar-label'), ['A', 'B', 'C']);
    m.handle.update({ axes: [] });
    assert.equal(m.el.querySelector('.ss-w-radar-svg').children.length, 0);
    assert.ok(!m.el.querySelector('.ss-w-empty-note').hidden);
});

const TIERS = [
    { title: 'Novice', skills: [{ id: 'sk_slash', name: 'Slash', icon: 'fa-khanda', level: 3, max: 5, active: true }, { id: 'sk_guard', name: 'Guard', level: 0 }] },
    { title: 'Adept', skills: [{ id: 'sk_cleave', name: 'Cleave', requires: ['sk_slash'] }, { id: 'sk_wall', name: 'Iron Wall', locked: true, requires: ['sk_guard', 'sk_slash'] }] },
];

test('skill-tree: tiers cleaned, column centres and connectors', () => {
    const tiers = treeTiers([...TIERS, { skills: [{ id: 'sk_slash', name: 'dup' }, null, { name: 'Named only' }] }]);
    assert.equal(tiers[2].skills.length, 1, 'duplicate ids and junk dropped');
    assert.equal(tiers[2].skills[0].id, 'Named only');
    assert.equal(columnCentre(0, 2), 25);
    assert.equal(columnCentre(1, 3), 50);
    assert.deepEqual(treeLinks(tiers[0], tiers[1], false), [
        { x1: 25, x2: 25, state: 'learned' },
        { x1: 75, x2: 75, state: 'locked' },
        { x1: 25, x2: 75, state: 'locked' },
    ]);
    assert.deepEqual(treeLinks(tiers[0], tiers[1], true), [{ x1: 50, x2: 50, state: 'open' }]);
});

test('skill-tree: badges, check marks, locks, ARIA labels, and click → command (not when locked)', () => {
    const m = mount(skillTree, { tiers: TIERS, onSelect: 'party.learnSkill' });
    assert.deepEqual(texts(m.el, '.ss-w-tree-title'), ['Novice', 'Adept']);
    const skills = m.el.querySelectorAll('.ss-w-tree-skill');
    assert.deepEqual(skills.map(skill => skill.getAttribute('data-state')), ['active', 'available', 'available', 'locked']);
    assert.deepEqual(texts(m.el, '.ss-w-tree-level'), ['3/5', '0']);
    assert.equal(m.el.querySelectorAll('.ss-w-tree-check').length, 1);
    assert.ok(skills[0].querySelector('.ss-w-tree-check i.fa-check'));
    assert.ok(skills[0].querySelector('i.fa-khanda'));
    assert.equal(skills[0].getAttribute('aria-label'), 'Slash, level 3 of 5, active');
    assert.equal(skills[3].getAttribute('aria-label'), 'Iron Wall, locked');
    assert.equal(skills[3].getAttribute('aria-disabled'), 'true');
    assert.equal(skills[3].localName, 'div', 'a locked skill is not a button');
    assert.equal(m.el.querySelectorAll('.ss-w-tree-skills')[0].style.getPropertyValue('--ss-w-count'), '2');
    assert.equal(m.el.querySelectorAll('.ss-w-tree-link').length, 3);
    skills[2].querySelector('.ss-w-tree-name').click();
    skills[3].click();
    assert.deepEqual(m.api.commands, [{ type: 'party.learnSkill', payload: { skill: 'sk_cleave' } }]);
    m.handle.update({ tiers: [{ title: 'Only', skills: [{ id: 'sk_a', name: 'A' }] }, { skills: [{ id: 'sk_b', name: 'B' }] }], onSelect: 'party.learnSkill' });
    assert.equal(m.el.querySelectorAll('.ss-w-tree-link').length, 1, 'trunk when no skill names requirements');
    m.el.querySelector('.ss-w-tree-skill').click();
    assert.deepEqual(m.api.commands.at(-1), { type: 'party.learnSkill', payload: { skill: 'sk_a' } });
    m.handle.update({ tiers: [] });
    assert.ok(m.el.querySelector('.ss-w-empty-note'));
    const plain = mount(skillTree, { tiers: TIERS });
    assert.equal(plain.el.querySelectorAll('button').length, 0, 'no command: no buttons');
});

test('portrait: safe image, initials fallback (no picture, unsafe URL, load error), frames and sizes', () => {
    const m = mount(portrait, { src: 'https://example.com/ren.png', name: 'Ren Avel', frame: 'hex', size: 'lg', caption: 'Ren' });
    const img = m.el.querySelector('img');
    assert.equal(img.getAttribute('src'), 'https://example.com/ren.png');
    assert.equal(img.getAttribute('alt'), '');
    assert.ok(!img.hidden);
    assert.ok(m.el.querySelector('.ss-w-portrait-initials').hidden);
    assert.equal(m.el.querySelector('.ss-w-portrait-frame').getAttribute('aria-label'), 'Portrait of Ren Avel');
    assert.ok(m.root.classList.contains('ss-w-frame-hex') && m.root.classList.contains('ss-w-size-lg'));
    assert.equal(m.el.querySelector('figcaption').textContent, 'Ren');
    img.dispatch('error');
    assert.ok(img.hidden);
    assert.equal(m.el.querySelector('.ss-w-portrait-initials').textContent, 'RA');
    assert.ok(!m.el.querySelector('.ss-w-portrait-initials').hidden);
    m.handle.update({ src: 'https://example.com/ren.png', name: 'Ren Avel' });
    assert.ok(img.hidden, 'a URL that failed stays on the fallback');
    m.handle.update({ src: '/thumbnail?type=persona&file=user.png', name: 'Ren Avel', frame: 'bogus', size: 'huge' });
    assert.equal(img.getAttribute('src'), '/thumbnail?type=persona&file=user.png', 'same-origin avatar paths are allowed');
    assert.ok(!img.hidden);
    assert.ok(m.root.classList.contains('ss-w-frame-circle') && !m.root.classList.contains('ss-w-frame-hex'));
    assert.ok(m.root.classList.contains('ss-w-size-md'));
    for (const unsafe of ['javascript:alert(1)', 'http://example.com/x.png', '//evil.example/x.png', 'data:text/html,<script>']) {
        m.handle.update({ src: unsafe, name: 'Astra' });
        assert.equal(img.getAttribute('src'), null, unsafe);
        assert.ok(img.hidden, unsafe);
        assert.equal(m.el.querySelector('.ss-w-portrait-initials').textContent, 'A');
    }
});

test('badge: icon, counter (capped), spoken label; a button with onSelect', () => {
    assert.equal(counterText(3), '3');
    assert.equal(counterText(150), '99+');
    assert.equal(counterText(150, 9), '9+');
    assert.equal(counterText(null), '');
    const m = mount(badge, { icon: 'fa-skull-crossbones', label: 'Poisoned', counter: 3, unit: 'turns left', tone: 'bad', kind: 'poisoned' });
    assert.equal(m.root.localName, 'span');
    assert.equal(m.root.getAttribute('role'), 'img');
    assert.equal(m.root.getAttribute('aria-label'), 'Poisoned: 3 turns left');
    assert.equal(m.el.querySelector('.ss-w-badge-count').textContent, '3');
    assert.ok(m.el.querySelector('.ss-w-badge-label').hidden, 'the label is spoken, not shown, next to an icon');
    assert.ok(m.root.classList.contains('ss-w-tone-bad'));
    assert.equal(m.root.getAttribute('data-kind'), 'poisoned');
    m.handle.update({ label: 'Blessed', counter: null, showLabel: true });
    assert.ok(m.el.querySelector('.ss-w-badge-count').hidden);
    assert.equal(m.el.querySelector('.ss-w-badge-label').textContent, 'Blessed');
    assert.ok(!m.el.querySelector('.ss-w-badge-label').hidden);
    assert.equal(m.root.getAttribute('aria-label'), 'Blessed');
    m.handle.update({ label: 'Poisoned', counter: 2, id: 'cond_poison', onSelect: 'party.inspect' });
    const button = m.el.children[0];
    assert.equal(button.localName, 'button');
    assert.equal(m.el.children.length, 1);
    button.click();
    assert.deepEqual(m.api.commands, [{ type: 'party.inspect', payload: { badge: 'cond_poison' } }]);
    m.handle.update({ label: 'Poisoned' });
    assert.equal(m.el.children[0].localName, 'span');
    m.handle.destroy();
    assert.equal(m.el.children.length, 0);
});

test('timeline: events in order, current by id or index, past/future, aria-current', () => {
    const events = [
        { id: 'ev_1', time: 'Day 1, 08:00', title: 'Arrived', text: 'At Bluewatch.', kind: 'travel' },
        { id: 'ev_2', time: 'Day 1, 12:00', title: 'Rats', kind: 'quest', icon: 'fa-flag' },
        { time: 'Day 2', title: 'The weir' },
    ];
    assert.equal(currentIndex(timelineEvents(events), 'ev_2'), 1);
    assert.equal(currentIndex(timelineEvents(events), 2), 2);
    assert.equal(currentIndex(timelineEvents(events), '0'), 0);
    assert.equal(currentIndex(timelineEvents(events), 7), -1);
    assert.equal(currentIndex(timelineEvents(events), null), -1);
    const m = mount(timeline, { events, current: 'ev_2', label: 'Story so far' });
    assert.equal(m.el.querySelector('ol').getAttribute('aria-label'), 'Story so far');
    const items = m.el.querySelectorAll('.ss-w-tl-event');
    assert.deepEqual(items.map(item => item.getAttribute('class')), ['ss-w-tl-event ss-w-past', 'ss-w-tl-event ss-w-current', 'ss-w-tl-event ss-w-future']);
    assert.equal(items[1].getAttribute('aria-current'), 'step');
    assert.equal(items[1].querySelector('.ss-w-tl-now').textContent, 'Now');
    assert.ok(items[1].querySelector('.ss-w-tl-dot i.fa-flag'));
    assert.deepEqual(texts(m.el, '.ss-w-tl-title'), ['Arrived', 'Rats', 'The weir']);
    assert.deepEqual(texts(m.el, '.ss-w-tl-time'), ['Day 1, 08:00', 'Day 1, 12:00', 'Day 2']);
    assert.deepEqual(texts(m.el, '.ss-w-tl-text'), ['At Bluewatch.']);
    assert.equal(items[0].getAttribute('data-kind'), 'travel');
    m.handle.update({ events });
    assert.equal(m.el.querySelectorAll('.ss-w-current').length, 0);
    assert.equal(m.el.querySelectorAll('[aria-current]').length, 0);
    m.handle.update({ events: [] });
    assert.ok(m.el.querySelector('ol').hidden);
    assert.ok(!m.el.querySelector('.ss-w-empty-note').hidden);
});

test('text from data is text: markup in names stays literal', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const parts = [
        mount(meter, { value: 1, label: evil }),
        mount(radar, { axes: [{ label: evil, value: 1 }, { label: 'b', value: 1 }, { label: 'c', value: 1 }] }),
        mount(skillTree, { tiers: [{ title: evil, skills: [{ id: 'sk_x', name: evil }] }] }),
        mount(timeline, { events: [{ title: evil, text: evil }] }),
        mount(badge, { label: evil, showLabel: true }),
        mount(portrait, { name: evil, caption: evil }),
    ];
    for (const part of parts) {
        assert.ok(part.el.textContent.includes(evil));
        assert.equal(part.el.querySelectorAll('img').filter(img => img.getAttribute('src') === 'x').length, 0);
    }
});
