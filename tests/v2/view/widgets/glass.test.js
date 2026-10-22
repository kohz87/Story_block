// ss.tile, ss.bar, ss.status, ss.pill (view/widgets/glass.js): the building blocks of Story Suite's look as
// widgets: what each draws (the glass.css classes), how it updates, what it says to a screen reader, and
// the tile's command.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BAR_KINDS, GLASS_TONES, bar, barRatio, leftSpoken, leftText, pill, status, tile, tileSpoken } from '../../../../src/v2/view/widgets/glass.js';
import { standardWidgets } from '../../../../src/v2/view/widgets/index.js';
import { fakeApi, host, installDom } from './fake-dom.js';

function mount(widget, props, api = fakeApi()) {
    const doc = installDom();
    const el = host(doc);
    const handle = widget.render(el, props, api);
    return { doc, el, api, handle, root: el.children[0] };
}
const classes = node => (node.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);

test('the four are standard widgets by their ss. names', () => {
    for (const [name, widget] of [['ss.tile', tile], ['ss.bar', bar], ['ss.status', status], ['ss.pill', pill]]) assert.equal(standardWidgets[name], widget, name);
});

test('tile: icon, label, level badge, tick, lock, ring tone, chosen; spoken in words', () => {
    const m = mount(tile, { label: 'Moonlight Slash', icon: 'fa-wand-sparkles', count: 3, state: 'ready', tone: 'info', hint: 'Lv 3', id: 'moon' });
    assert.ok(classes(m.root).includes('ss-tile') && classes(m.root).includes('ss-tile-ready'));
    assert.equal(m.root.tagName, 'DIV', 'not a button without onSelect');
    assert.equal(m.root.getAttribute('role'), 'group');
    assert.equal(m.root.getAttribute('aria-label'), 'Moonlight Slash, Lv 3, ready');
    assert.ok(m.el.querySelector('.ss-tile-box').classList.contains('ss-tone-info'));
    assert.ok(m.el.querySelector('.ss-tile-icon i.fa-wand-sparkles'));
    assert.equal(m.el.querySelector('.ss-tile-count').textContent, '3');
    assert.ok(m.el.querySelector('.ss-tile-mark i.fa-check'));
    assert.equal(m.el.querySelector('.ss-tile-label').textContent, 'Moonlight Slash');
    // Locked: a lock, dimmed (the class), said so.
    m.handle.update({ label: 'Death Soul', count: '–', state: 'locked', tone: 'nonsense' });
    assert.ok(classes(m.root).includes('ss-tile-locked') && !classes(m.root).includes('ss-tile-ready'));
    assert.ok(m.el.querySelector('.ss-tile-mark i.fa-lock'));
    assert.equal(m.root.getAttribute('aria-label'), 'Death Soul, –, locked');
    assert.ok(!classes(m.el.querySelector('.ss-tile-box')).some(c => c.startsWith('ss-tone-')), 'an unknown tone is no ring class');
    // No icon: the label's first letter; no count: no badge; corner style for a bag.
    m.handle.update({ label: 'élan', count: '', countStyle: 'corner' });
    assert.equal(m.el.querySelector('.ss-tile-icon').textContent, 'é');
    assert.ok(m.el.querySelector('.ss-tile-count').hidden);
    assert.ok(m.el.querySelector('.ss-tile-mark').hidden);
    m.handle.update({ label: 'Rope', count: '2', countStyle: 'corner', showLabel: false });
    assert.ok(m.el.querySelector('.ss-tile-count').classList.contains('ss-tile-corner'));
    assert.ok(m.el.querySelector('.ss-tile-label').hidden);
    assert.equal(tileSpoken({ label: 'Rope', count: '2', state: 'none', hint: '' }), 'Rope, 2');
});

test('tile with onSelect: a button, pressed while chosen, runs its command with { tile }; a locked one is not a button', () => {
    const api = fakeApi();
    const m = mount(tile, { label: 'Frost Hex', id: 'frost', selected: true, onSelect: 'party.pickSkill' }, api);
    assert.equal(m.root.tagName, 'BUTTON');
    assert.equal(m.root.getAttribute('type'), 'button');
    assert.equal(m.root.getAttribute('aria-pressed'), 'true');
    m.root.click();
    assert.deepEqual(api.commands, [{ type: 'party.pickSkill', payload: { tile: 'frost' } }]);
    m.handle.update({ label: 'Frost Hex', id: 'frost', selected: false, onSelect: 'party.pickSkill' });
    assert.equal(m.el.children[0].getAttribute('aria-pressed'), 'false');
    m.handle.update({ label: 'Frost Hex', id: 'frost', state: 'locked', onSelect: 'party.pickSkill' });
    assert.equal(m.el.children.length, 1, 'rebuilt, not doubled');
    assert.equal(m.el.children[0].tagName, 'DIV');
    m.handle.destroy();
    assert.equal(m.el.children.length, 0);
});

test('bar: label, value text, fill property, the suite\'s bar colours, ARIA meter', () => {
    assert.equal(barRatio(50, 82), 50 / 82);
    assert.equal(barRatio(90, 82), 1);
    assert.equal(barRatio(-1, 82), 0);
    assert.equal(barRatio(5, 0), 0);
    const m = mount(bar, { label: 'HP', kind: 'hp', value: 50, max: 82 });
    assert.ok(classes(m.root).includes('ss-bar') && classes(m.root).includes('ss-bar-hp'));
    assert.equal(m.root.getAttribute('role'), 'meter');
    assert.equal(m.root.getAttribute('aria-valuenow'), '50');
    assert.equal(m.root.getAttribute('aria-valuemax'), '82');
    assert.equal(m.root.getAttribute('aria-valuetext'), '50 / 82');
    assert.equal(m.el.querySelector('.ss-bar-label').textContent, 'HP');
    assert.equal(m.el.querySelector('.ss-bar-value').textContent, '50 / 82');
    assert.equal(m.el.querySelector('.ss-bar-track').style.getPropertyValue('--ss-fill'), '0.6098');
    m.handle.update({ label: 'Soul growth', kind: 'exp', value: '640', max: '1000', text: '640 / 1000 to Class III' });
    assert.ok(classes(m.root).includes('ss-bar-exp') && !classes(m.root).includes('ss-bar-hp'));
    assert.equal(m.root.getAttribute('aria-valuetext'), '640 / 1000 to Class III');
    m.handle.update({ value: 3, max: 9, kind: 'neon' });
    assert.ok(!BAR_KINDS.some(kind => classes(m.root).includes(`ss-bar-${kind}`)), 'an unknown kind: the accent');
    assert.ok(m.el.querySelector('.ss-bar-label').hidden);
});

test('status: the time left in the corner, short, and in full words for a screen reader', () => {
    assert.equal(leftText(2, 'turns'), '2t');
    assert.equal(leftText(1, 'rounds'), '1r');
    assert.equal(leftText(40, 'minutes'), '40m');
    assert.equal(leftText(150, 'minutes'), '2h');
    assert.equal(leftText(3000, 'minutes'), '2d');
    assert.equal(leftText(null), '∞');
    assert.equal(leftText(250, 'turns'), '99+t');
    assert.equal(leftText(-3, 'turns'), '0t');
    assert.equal(leftSpoken(40, 'minutes'), '40 story minutes left');
    assert.equal(leftSpoken(1, 'rounds'), '1 round left');
    assert.equal(leftSpoken(2, 'turns'), '2 turns left');
    assert.equal(leftSpoken(undefined), 'no set end');
    const m = mount(status, { label: 'Bleeding', icon: 'fa-droplet', left: 40, unit: 'minutes', tone: 'bad' });
    assert.ok(classes(m.root).includes('ss-status') && classes(m.root).includes('ss-tone-bad'));
    assert.equal(m.root.getAttribute('role'), 'img');
    assert.equal(m.root.getAttribute('aria-label'), 'Bleeding: 40 story minutes left');
    assert.equal(m.el.querySelector('.ss-status-left').textContent, '40m');
    assert.ok(m.el.querySelector('i.fa-droplet'));
    m.handle.update({ label: 'Blessed', left: '', tone: 'oops', unit: 'weeks' });
    assert.equal(m.el.querySelector('.ss-status-left').textContent, '∞');
    assert.equal(m.root.getAttribute('aria-label'), 'Blessed: no set end');
    assert.ok(classes(m.root).includes('ss-tone-accent'), 'an unknown tone: the accent');
    assert.equal(m.el.querySelector('.ss-status-icon').textContent, 'B', 'no icon: the first letter');
});

test('pill: text, optional icon, solid, soft or outline', () => {
    const m = mount(pill, { text: 'Soul Class II · Lv 12' });
    assert.ok(classes(m.root).includes('ss-pill'));
    assert.equal(m.el.querySelector('.ss-pill-text').textContent, 'Soul Class II · Lv 12');
    assert.ok(m.el.querySelector('.ss-pill-icon').hidden);
    m.handle.update({ text: 'Drizzle', icon: 'fa-cloud-rain', style: 'soft' });
    assert.ok(classes(m.root).includes('ss-pill-soft'));
    assert.ok(m.el.querySelector('i.fa-cloud-rain'));
    m.handle.update({ text: 'x', style: 'outline' });
    assert.ok(classes(m.root).includes('ss-pill-outline') && !classes(m.root).includes('ss-pill-soft'));
    m.handle.update({ text: 'x', style: '<b>' });
    assert.ok(!classes(m.root).some(c => c === 'ss-pill-outline' || c === 'ss-pill-soft'));
});

test('tones a ring takes: the widget tones and the rarities', () => {
    assert.deepEqual(GLASS_TONES, ['neutral', 'accent', 'good', 'warn', 'bad', 'info', 'uncommon', 'rare', 'epic', 'legendary']);
});
